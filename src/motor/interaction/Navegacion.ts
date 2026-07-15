// ─────────────────────────────────────────────
// interaction · Navegacion (teclado: pan libre + carril, AGNÓSTICO de la fórmula)
// ─────────────────────────────────────────────
//
// Dos modalidades (mismo esquema y velocidades que el GraphEngine original):
//
//   • SIN carril → navegación LIBRE: WASD/flechas desplazan la vista (W↑ A← S↓ D→),
//     con diagonal normalizada para no ir más rápido en oblicuo.
//   • CON carril (botón ⌖) → A/D recorren la curva en x, W/S hacen zoom continuo
//     (W acerca, S aleja) centrado en el punto, y la cámara lo sigue.
//
// La clave del carril: la `y` del punto se obtiene de la GEOMETRÍA (callback
// `yEnCurva`, que lee la `Rama`), NUNCA evaluando f. Así es agnóstico de la
// estrategia, igual que el crosshair. Mientras una tecla esté pulsada, un bucle de
// requestAnimationFrame mueve la vista/el punto de forma continua.

import type { Camara } from "./Camara";
import type { Viewport } from "../contracts";
import { factorRampaVerticalidad, PENDIENTE_CORTE_CARRIL } from "../analysis/lecturaRama";

/** Lectura de la curva que sigue el carril (la geometría, nunca la fórmula). */
export interface LectorCurva {
  /** y sobre la curva en un x de mundo, o null si el tramo trazado no lo cubre. */
  y(worldX: number): number | null;
  /** Avance por LONGITUD DE ARCO EN PANTALLA: desde el punto (x,y) sobre la curva, camina
   *  `deltaPx` px a lo largo de la polilínea (signo = dirección). Con `recortar` se camina la
   *  curva sin sus tramos casi verticales (Caso A: el arco acaba y salta). Devuelve además
   *  `evento`: "salto" cruzó a una rama vecina (Caso A), "tope" se pegó a un borde sin vecina,
   *  "normal" ni una cosa ni la otra. null si no hay curva. */
  avanzarArco(
    x: number, y: number, deltaPx: number, vp: Viewport, recortar?: boolean
  ): { x: number; y: number; evento: "normal" | "salto" | "tope"; hueco: number } | null;
  /** ¿Hay una RAMA VECINA ALCANZABLE a la que saltar avanzando en `dir` (+1/−1) desde (x,y)?
   *  Detección Caso A (tan x: la curva sigue al otro lado del polo) / Caso B (arccot(x²)/(2√x):
   *  convergencia real, el dominio acaba) EN TIEMPO REAL sobre la geometría recortada por
   *  PENDIENTE (no por el viewport), y por tanto independiente del encuadre. */
  hayVecina(x: number, y: number, dir: number, vp: Viewport): boolean;
  /** ¿La curva seleccionada tiene asíntotas verticales (tan, sec, 1/x…)? Activa el modo
   *  carril de inercia (cámara-siempre-siguiendo con rampa de verticalidad y freno Caso B). */
  tieneAsintotasVerticales(): boolean;
}

const MAPA: Record<string, string> = {
  w: "w", a: "a", s: "s", d: "d",
  arrowup: "w", arrowleft: "a", arrowdown: "s", arrowright: "d",
};
const VEL_PAN_PX = 175;       // velocidad de recorrido a lo largo de la curva (px/seg)
const VEL_ZOOM_POR_SEG = 2.5; // factor de zoom por segundo (W/S)
// Modo precisión (Shift mantenido): escala TODA la velocidad de teclado (recorrido,
// zoom y paneo libre). El movimiento es continuo (float), así que con Shift el punto
// avanza décimas de píxel por frame → se puede aterrizar en cualquier valor
// intermedio aunque la vista esté muy alejada.
const FACTOR_PRECISION = 0.1;

// ── Modo carril de INERCIA (curvas con asíntota vertical) ──
// UN SOLO motor de movimiento de cámara: un muelle exponencial framerate-independiente
// (`RIGIDEZ_CAMARA`). Todo lo demás es a qué se le apunta:
//   • Caso A (hay rama vecina: tan, sec, x⁻²) → apunta al PUNTO, en X y en Y, sin tope alguno.
//   • Caso B (convergencia real sin vecina: arccot(x²)/(2√x)) → apunta en Y a un DESTINO FIJO,
//     y=0, con la curva de velocidad ×10→×1; en X sigue persiguiendo al punto con normalidad.
const RIGIDEZ_CAMARA = 2.5;   // 1/seg (suave a propósito: es la inercia que se percibe)
// Caso B: ALTURA a la que el punto se considera FUGADO por la asíntota, en SEMI-ALTURAS de la vista
// (≈ y=126 con la vista por defecto, semiY=7). Ahí entra el modo escape y arranca la animación de
// cámara a y=0. Se expresa en semi-alturas, no en un `y` de mundo fijo: un `y=100` literal caería a
// media pantalla con zoom-out (la cámara se anclaría con el punto aún bien visible) y exigiría trepar
// 2000 alturas de pantalla con zoom-in. Hasta esa altura la cámara sube FIJA en el punto.
const ALTURA_ESCAPE_SEMIALTURAS = 18;
// Caso B: la animación hacia y=0 arranca ×FACTOR_ARRANQUE_ANCLA de rígida y decae a ×1 conforme
// se acerca al destino → sale rápido de la zona del polo y se ASIENTA sin rebote en y=0 exacto.
const FACTOR_ARRANQUE_ANCLA = 10;
// Un movimiento de cámara (reenganche del salto o anclaje a y=0) se da por terminado cuando le
// queda menos de medio píxel: por debajo de eso el muelle exponencial nunca llega y el encuadre es
// indistinguible del destino. Sirve para FIJAR el valor exacto y apagar el bucle.
const FIN_MOVIMIENTO_PX = 0.5;

export class Navegacion {
  private _railOn = false;
  private _railX = 0;
  private _railY: number | null = null;

  // Estado del modo carril de inercia (asíntotas verticales):
  //   • _pendiente = verticalidad local (|Δy/Δx| en mundo, celdas 1:1 ⇒ ≈ pantalla) del último
  //     avance → rampa de velocidad del PRÓXIMO frame. ∞ tras un salto (entra casi-vertical, ×MAX).
  //   • _sinVecina = no hay rama vecina en la dirección de marcha (curva de Caso B). Mientras el punto
  //     no ESCAPE, la cámara va FIJA en él: su muelle de Y se endurece con la misma rampa de
  //     verticalidad que acelera al punto, así lo acompaña hasta el borde de la zona recorrible en vez
  //     de quedarse rezagada en la línea base (con el muelle suave la cámara llegaba a cy≈0.7 con el
  //     punto ya en y≈8: al anclar, el viaje a y=0 medía dos décimas y no se veía).
  //   • _anclaY  = Caso B en curso: la cámara dejó de perseguir al punto en Y y se anima a y=0.
  //   • _d0Ancla = |cy| al entrar en Caso B; referencia de la curva de velocidad ×10→×1.
  //   • _dxReenganche = DESFASE en x (mundo) entre la cámara y el punto tras un salto de Caso A:
  //     camX = railX − _dxReenganche. El salto traslada el punto a la rama vecina de golpe; si la
  //     cámara lo acompañara (camX = railX siempre), el punto quedaría clavado en el centro y serían
  //     los ejes, la rejilla y la curva los que darían el brinco → se lee como TELETRANSPORTE en
  //     cuanto el hueco es angosto o el borde poco vertical (x⁻²). Absorbiendo el corte, la cámara se
  //     queda donde estaba y REENGANCHA al punto con el mismo muelle exponencial (RIGIDEZ_CAMARA).
  //     Solo se amortigua la DISCONTINUIDAD: el movimiento continuo se sigue exacto (un muelle sobre
  //     railX rezagaría también el recorrido → se sentiría como lag).
  //   • _camaraEnMovimiento = queda animación de cámara por terminar (reenganche del salto o viaje a
  //     y=0). Mantiene vivo el bucle aunque se suelten las teclas: si no, soltar A/D a mitad de la
  //     animación la dejaría congelada donde estuviera (el muelle solo avanza dentro del bucle).
  //   • _escape / _yEscape / _xEscape / _dirSubida / _signoEscape = MODO ESCAPE de Caso B. El punto
  //     deja de leerse de la polilínea y su `y` pasa a INTEGRARSE aquí, a la misma velocidad de
  //     pantalla. Hace falta porque la geometría es finita: la rama que sube al polo termina en una
  //     PUNTA (hasta donde llegó el refinado) y el trazador la cierra con un vértice de clamp a 3
  //     semi-alturas. Caminando el arco, el punto rebasaba la punta, BAJABA por ese segmento
  //     sintético (330, 329, 328…) y se clavaba en y=21 (=3·7). Integrando la y, sube sin límite y
  //     el regreso con D es EXACTO ("se hace y se deshace"), cosa que la re-proyección sobre una
  //     polilínea re-trazada cada frame no garantiza. La `x` queda fijada en la de la fuga: sobre la
  //     asíntota la curva ya es esa vertical.
  private _pendiente = 0;
  private _sinVecina = false;
  private _escape = false;
  private _yEscape = 0;
  private _xEscape = 0;
  private _yFuga = 0;
  private _dirSubida = 0;
  private _signoEscape = 1;
  private _anclaY = false;
  private _d0Ancla = 0;
  private _dxReenganche = 0;
  private _camaraEnMovimiento = false;

  private readonly teclas = new Set<string>();
  private fino = false; // Shift mantenido → modo precisión (velocidad ×0.1)
  private raf: number | null = null;
  private ultimo = 0;
  private readonly limpiezas: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camara: Camara,
    private readonly curva: LectorCurva,
    private readonly onCambio: () => void
  ) {
    canvas.tabIndex = 0;
    canvas.style.outline = "none";

    const onKeyDown = (e: KeyboardEvent) => {
      this.fino = e.shiftKey; // sincroniza el modo precisión en cada evento
      const d = MAPA[e.key.toLowerCase()];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      this.teclas.add(d);
      if (this.raf === null) this.raf = requestAnimationFrame(this.paso);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.fino = e.shiftKey;
      const d = MAPA[e.key.toLowerCase()];
      if (d) { e.preventDefault(); this.teclas.delete(d); }
    };
    // Realimentación visual de que la gráfica está activa para el teclado; al
    // perder el foco se limpian las teclas para que no queden "pegadas" si se
    // soltaron fuera del canvas (mismo comportamiento que el GraphEngine).
    const onFocus = () => {
      canvas.style.outline = "1px solid rgba(100,150,255,0.35)";
    };
    const onBlur = () => {
      canvas.style.outline = "none";
      this.teclas.clear();
      this.fino = false;
    };

    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("focus", onFocus);
    canvas.addEventListener("blur", onBlur);
    this.limpiezas.push(
      () => canvas.removeEventListener("keydown", onKeyDown),
      () => canvas.removeEventListener("keyup", onKeyUp),
      () => canvas.removeEventListener("focus", onFocus),
      () => canvas.removeEventListener("blur", onBlur)
    );
  }

  private paso = (t: number) => {
    // El bucle sigue vivo sin teclas mientras la cámara tenga una animación a medias (reenganche del
    // salto, viaje a y=0): soltar A/D en mitad la dejaría congelada donde estuviera.
    if (this.teclas.size === 0 && !(this._railOn && this._camaraEnMovimiento)) {
      this.raf = null;
      this.ultimo = 0;
      this.onCambio(); // pasada final tras soltar
      return;
    }
    const dt = this.ultimo ? Math.min(0.05, (t - this.ultimo) / 1000) : 0;
    this.ultimo = t;
    if (dt > 0) {
      const vp = this.camara.viewport();
      // Shift mantenido → modo precisión: toda la velocidad se escala ×0.1 para
      // poder aterrizar en valores intermedios (el movimiento es float continuo).
      const escala = this.fino ? FACTOR_PRECISION : 1;
      if (this._railOn) {
        // CARRIL: A/D viajan por la curva; W/S zoom continuo centrado en el punto.
        let dirX = 0;
        if (this.teclas.has("a")) dirX -= 1;
        if (this.teclas.has("d")) dirX += 1;
        let dirZoom = 0;
        if (this.teclas.has("w")) dirZoom -= 1;
        if (this.teclas.has("s")) dirZoom += 1;

        // Semilla de y para LOCALIZAR el punto en la polilínea (arco): railY mantenido si
        // existe; si no, la y por x; y si TAMPOCO (arranque sobre una asíntota como 1/x en
        // x=0, o dominio que no cubre x=0 como arccot(x²)/(2√x)), el CENTRO vertical de la
        // vista. Con la semilla, avanzarArco ENGANCHA por cercanía en pantalla el punto de la
        // curva más próximo aunque en railX no haya y → el punto aparece igual (antes railY
        // quedaba null: el crosshair no dibujaba nada y A/D no hacía nada).
        const ySeed = this.ySemilla(vp);
        const factor = dirZoom !== 0 ? Math.pow(VEL_ZOOM_POR_SEG, dirZoom * dt * escala) : 1;
        // Curvas con ASÍNTOTA VERTICAL (tan, sec, 1/x…): modo carril de INERCIA (cámara siempre
        // siguiendo con rampa de verticalidad, salto Caso A / freno Caso B). El resto: seguimiento
        // directo (la cámara centra domY en el punto, como siempre).
        if (this.curva.tieneAsintotasVerticales()) {
          this.pasoCarrilAsintota(vp, dirX, escala, dt, factor, ySeed);
        } else {
          // CARRIL por LONGITUD DE ARCO EN PANTALLA: A/D recorren ~VEL_PAN_PX px A LO LARGO de
          // la curva, no en x (en casi-vertical un paso en x se dispararía). Sin A/D, re-proyecta
          // (arco 0) sobre la polilínea re-trazada para seguir exacto tras el zoom.
          const deltaPx = dirX * VEL_PAN_PX * escala * dt;
          const pos = this.curva.avanzarArco(this._railX, ySeed, deltaPx, vp);
          if (pos) { this._railX = pos.x; this._railY = pos.y; }
          this.camara.enfocarCarril(this._railX, this._railY, factor);
        }
        this.onCambio();
      } else {
        // Navegación LIBRE: WASD desplaza la vista (W↑ A← S↓ D→). Velocidad en
        // px/seg convertida a mundo → mismo ritmo a cualquier zoom; la diagonal
        // se normaliza para no ir más rápido.
        let mx = 0, my = 0;
        if (this.teclas.has("a")) mx -= 1;
        if (this.teclas.has("d")) mx += 1;
        if (this.teclas.has("w")) my += 1;
        if (this.teclas.has("s")) my -= 1;
        if (mx !== 0 || my !== 0) {
          const norm = Math.hypot(mx, my);
          const v = VEL_PAN_PX * escala * dt;
          const dx = (mx / norm) * v * ((vp.domX[1] - vp.domX[0]) / vp.anchoPx);
          const dy = (my / norm) * v * ((vp.domY[1] - vp.domY[0]) / vp.altoPx);
          this.camara.panear(dx, dy);
          this.onCambio();
        }
      }
    }
    this.raf = requestAnimationFrame(this.paso);
  };

  /**
   * Un frame del carril de INERCIA en curvas con asíntota vertical. Dos comportamientos, elegidos EN
   * TIEMPO REAL por si hay o no rama vecina ALCANZABLE (`hayVecina`, medido sobre la geometría
   * recortada por PENDIENTE) — nunca por el tipo de función ni por el encuadre de la cámara:
   *
   *  • CASO A (tan x, sec x, x⁻² — hay vecina): la cámara persigue al punto LIBREMENTE en X y en Y con
   *    el muelle de inercia, sin tope de viewport. El punto sube por la rama (rampa de VERTICALIDAD
   *    ×1→×10) hasta donde la curva deja de ser recorrible (pendiente en pantalla > 50) y SALTA a la
   *    vecina, que entra por su tramo simétrico. La cámara no acompaña el corte en X: lo absorbe como
   *    desfase (`_dxReenganche`) y reengancha; el corte en Y lo suaviza el propio muelle. Como el corte
   *    de la curva es GEOMÉTRICO, el cruce ocurre en el mismo punto de la función a cualquier zoom.
   *
   *  • CASO B (arccot(x²)/(2√x) — sin vecina: convergencia real, el dominio termina ahí): dos fases.
   *    APROXIMACIÓN — la cámara va FIJA en el punto y sube con él (muelle endurecido por la rampa,
   *    ver `centroCamaraSeguimiento`). FUGA — al superar `ALTURA_ESCAPE_SEMIALTURAS`·semiY el punto
   *    entra en MODO ESCAPE: su `y` se integra aquí (sube sin límite, a velocidad de pantalla
   *    constante) en vez de leerse de la polilínea, y la cámara deja de perseguirlo en Y para animarse
   *    al destino FIJO y=0 con curva ×10→×1 (`centroCamaraAncla`); en X lo sigue con normalidad.
   *    Invertir la dirección deshace el camino exactamente y re-engancha el punto a la curva.
   */
  private pasoCarrilAsintota(
    vp: Viewport, dirX: number, escala: number, dt: number, factor: number, ySeed: number
  ): void {
    const semiY = (vp.domY[1] - vp.domY[0]) / 2;
    const cyActual = (vp.domY[0] + vp.domY[1]) / 2;
    const semiX = (vp.domX[1] - vp.domX[0]) / 2;

    const alturaEscape = ALTURA_ESCAPE_SEMIALTURAS * semiY;

    if (dirX !== 0 && this._escape) {
      // MODO ESCAPE: el punto ya no se lee de la geometría. Su `y` se integra a la misma velocidad de
      // pantalla (siempre en el chorro ⇒ rampa ×MAX), hacia arriba si se mantiene la dirección con la
      // que se fugó y hacia abajo si se invierte → el regreso deshace el camino exactamente.
      const pasoMundo = VEL_PAN_PX * escala * factorRampaVerticalidad(Infinity) * dt
        * ((vp.domY[1] - vp.domY[0]) / vp.altoPx);
      const sentido = (dirX >= 0 ? 1 : -1) === this._dirSubida ? 1 : -1;
      this._yEscape += sentido * this._signoEscape * pasoMundo;
      this._pendiente = Infinity;
      this._sinVecina = true;
      // Se sale del escape al DESCENDER hasta el punto EXACTO por el que se fugó, y se restaura ese
      // punto tal cual: nada de re-proyectar sobre la polilínea. La re-proyección aterrizaba en el
      // segmento de clamp que el trazador añade al cerrar la rama —cuyo recorrido va hacia ARRIBA,
      // hacia la punta— y el punto se fugaba otra vez en vez de volver. Restaurando la fuga, ir y
      // volver son exactamente inversos. Exigir el descenso evita salir en el mismo frame de entrar.
      if (sentido < 0 && Math.abs(this._yEscape) <= Math.abs(this._yFuga)) {
        this._escape = false;
        this._railX = this._xEscape;
        this._railY = this._yFuga;
      } else {
        this._railX = this._xEscape;
        this._railY = this._yEscape;
      }
    } else if (dirX !== 0) {
      const dir = dirX >= 0 ? 1 : -1;
      const rampa = factorRampaVerticalidad(this._pendiente);
      const deltaPx = dirX * VEL_PAN_PX * escala * rampa * dt;

      // Caso A/B por TOPOLOGÍA: ¿la curva continúa al otro lado, o el dominio acaba aquí? Se mide
      // sobre la geometría recortada por pendiente, la misma que caminará el avance → lo detectado es
      // exactamente lo que ocurrirá. Lejos de la asíntota una curva de una sola rama tampoco tiene
      // vecina, y ahí no hay nada que hacer (sería un escape espurio en el tramo llano).
      const hayVecina = this.curva.hayVecina(this._railX, ySeed, dir, vp);
      this._sinVecina = !hayVecina;

      // Caso A camina la curva RECORTADA (su arco acaba → salta a la vecina). Caso B la CRUDA: no hay
      // a dónde saltar y el punto debe poder seguir subiendo por la asíntota más allá de lo visible.
      const pos = this.curva.avanzarArco(this._railX, ySeed, deltaPx, vp, hayVecina);
      if (pos) {
        const yAnt = this._railY ?? pos.y;
        // Verticalidad local (|Δy/Δx| de mundo, celdas 1:1 ⇒ ≈ pantalla) para la rampa del PRÓXIMO
        // frame. Un SALTO (entra casi-vertical) o un TOPE (pegado a un borde, donde la y queda
        // clampada y Δy/Δx daría 0 espurio) mantienen ×MAX (∞): la rampa no se desploma en la
        // asíntota, ni el anclaje de Caso B se suelta por un falso tramo llano.
        const dx = Math.abs(pos.x - this._railX);
        const enChorro = !hayVecina && this._pendiente > PENDIENTE_CORTE_CARRIL;
        this._pendiente = pos.evento === "salto" || pos.evento === "tope" ? Infinity
          : dx > 1e-12 ? Math.abs(pos.y - yAnt) / dx : Infinity;
        // SALTO de Caso A: el punto reaparece en la rama vecina, un hueco más allá. SOLO ese hueco
        // (`pos.hueco`, la discontinuidad pura — no el desplazamiento del frame, que con zoom-out
        // abarca varios períodos) se acumula como desfase de cámara: el encuadre no da el brinco y el
        // muelle lo reabsorbe. Saltos encadenados suman sobre el desfase vivo, sin discontinuidad.
        this._dxReenganche += pos.hueco;
        this._railX = pos.x;
        this._railY = pos.y;

        // ¿FUGA? Estando ya en el chorro de una asíntota sin vecina, el punto escapa al superar la
        // altura de fuga, o antes si la polilínea se AGOTA (evento "tope": el refinado no llegó más
        // arriba). A partir de ahí la `y` la lleva el modo escape. Solo se comprueba subiendo: al
        // BAJAR por el chorro (regreso) no hay nada de lo que fugarse.
        // `>=` y no `>`: pegado al tope de la punta la y ya no crece, y aun así hay que fugarse.
        const subiendo = Math.abs(pos.y) >= Math.abs(yAnt);
        if (enChorro && subiendo && (Math.abs(pos.y) > alturaEscape || pos.evento === "tope")) {
          this._escape = true;
          this._yFuga = pos.y; // último punto REAL de la curva: exactamente a él se vuelve
          this._yEscape = this._yFuga;
          this._xEscape = this._railX;
          this._dirSubida = dir;
          this._signoEscape = Math.sign(this._yFuga) || 1;
        }
      }
    } else if (!this._escape) {
      // Sin A/D (zoom o quieto): re-proyecta sobre la curva CRUDA re-trazada (arco 0). Sin recortar:
      // el punto puede estar dentro del chorro del polo y ha de poder reencontrarse a sí mismo.
      // Fugado NO se re-proyecta: no hay polilínea a esa altura y lo devolvería a la punta.
      const pos = this.curva.avanzarArco(this._railX, ySeed, 0, vp);
      if (pos) { this._railX = pos.x; this._railY = pos.y; }
    }

    // El anclaje de cámara a y=0 es exactamente el modo escape: mientras el punto está fugado por la
    // asíntota, la cámara deja de perseguirlo en Y (nunca lo alcanzaría) y viaja al eje.
    if (this._escape && !this._anclaY) { this._anclaY = true; this._d0Ancla = Math.abs(cyActual); }
    else if (!this._escape && this._anclaY) { this._anclaY = false; }

    // Encuadre: X persigue al punto (o lo alcanza por muelle si hay reenganche tras un salto); Y
    // persigue al punto (Caso A y aproximación de Caso B) o se anima al destino fijo y=0 (fugado).
    const cyObjetivo = this._anclaY
      ? this.centroCamaraAncla(cyActual, dt, semiY, vp.altoPx)
      : this.centroCamaraSeguimiento(cyActual, dt);
    const cxObjetivo = this.centroCamaraReenganche(semiX, vp.anchoPx, dt);
    this._camaraEnMovimiento = this._dxReenganche !== 0 || (this._anclaY && cyObjetivo !== 0);
    this.camara.enfocarCarril(cxObjetivo, cyObjetivo, factor);
  }

  /** Centro horizontal objetivo de la cámara: el punto MENOS el desfase que dejó el último salto de
   *  Caso A. El desfase se disuelve con el MISMO muelle exponencial (framerate-independiente,
   *  `RIGIDEZ_CAMARA`) que reengancha la Y en Caso B, para que ambos reenganches se sientan igual; el
   *  movimiento continuo, en cambio, se sigue EXACTO. Se acota a una semianchura porque la geometría
   *  solo se traza sobre `domX`: un punto fuera del encuadre no tendría polilínea donde apoyarse el
   *  frame siguiente (hueco mayor que la vista, con zoom muy cerca) → ahí la cámara lo arrastra pegado
   *  al borde en vez de perderlo. */
  private centroCamaraReenganche(semiX: number, anchoPx: number, dt: number): number {
    if (this._dxReenganche === 0) return this._railX;
    const dx = this._dxReenganche * Math.exp(-RIGIDEZ_CAMARA * dt);
    const acotado = Math.max(-semiX, Math.min(semiX, dx));
    // Alcanzado el punto (queda menos de medio píxel): la cámara se fija y retoma el seguimiento normal.
    const pxRestantes = (Math.abs(acotado) / (2 * semiX)) * anchoPx;
    this._dxReenganche = !Number.isFinite(acotado) || pxRestantes < FIN_MOVIMIENTO_PX ? 0 : acotado;
    return this._railX - this._dxReenganche;
  }

  /** Centro vertical objetivo: PERSECUCIÓN del punto con el muelle de inercia, sin tope alguno.
   *
   *  • CASO A (hay vecina): rigidez base. Como railY pasa poco tiempo en los extremos rápidos de la
   *    rama (junto al polo) y mucho en su parte lenta, el muelle se asienta de por sí cerca de la
   *    línea base y no se dispara al cruzar; el corte de y del salto también lo suaviza.
   *  • CASO B (sin vecina): la rigidez se multiplica por la MISMA rampa de verticalidad que acelera
   *    al punto, así la cámara va FIJA en él y sube a su lado hasta el borde de la zona recorrible.
   *    Sin eso, el punto (1.5 unidades/frame en la asíntota) dejaba atrás al muelle suave y el
   *    posterior viaje a y=0 arrancaba a dos décimas del destino: no se veía animación ninguna. */
  private centroCamaraSeguimiento(cyActual: number, dt: number): number {
    const rY = this._railY;
    if (rY === null) return cyActual;
    const rigidez = RIGIDEZ_CAMARA * (this._sinVecina ? factorRampaVerticalidad(this._pendiente) : 1);
    return cyActual + (rY - cyActual) * (1 - Math.exp(-rigidez * dt));
  }

  /** CASO B · Centro vertical objetivo: el MISMO motor de inercia apuntado a un destino FIJO, y=0
   *  (el eje X a media altura), en vez de al punto —que se va a infinito—. La rigidez se escala de
   *  ×FACTOR_ARRANQUE_ANCLA (lejos del destino) a ×1 (encima de él): arranca rápido, sale de la zona
   *  del polo y DESACELERA hasta asentarse; a menos de medio píxel se fija en y=0 exacto. */
  private centroCamaraAncla(cyActual: number, dt: number, semiY: number, altoPx: number): number {
    if (this._d0Ancla <= 0) return 0;
    const fraccion = Math.min(1, Math.abs(cyActual) / this._d0Ancla);
    const rigidez = RIGIDEZ_CAMARA * (1 + (FACTOR_ARRANQUE_ANCLA - 1) * fraccion);
    const cy = cyActual * Math.exp(-rigidez * dt);
    const pxRestantes = (Math.abs(cy) / (2 * semiY)) * altoPx;
    return !Number.isFinite(cy) || pxRestantes < FIN_MOVIMIENTO_PX ? 0 : cy;
  }

  /**
   * y de partida para localizar el punto del carril en la polilínea. railY mantenido si
   * es válido; si no, la y por x en railX; y si TAMPOCO existe (arranque sobre una asíntota
   * o fuera del dominio en railX), el CENTRO vertical de la vista como semilla. Nunca null:
   * garantiza que avanzarArco pueda enganchar el punto de la curva más cercano en pantalla.
   */
  private ySemilla(vp: Viewport): number {
    if (this._railY !== null && Number.isFinite(this._railY)) return this._railY;
    const yx = this.curva.y(this._railX);
    if (yx !== null && Number.isFinite(yx)) return yx;
    return (vp.domY[0] + vp.domY[1]) / 2;
  }

  /**
   * Enciende/apaga el carril. En AMBOS sentidos restaura la vista a los dominios
   * por defecto (deshace el pan/zoom acumulado). Al encender, el punto arranca en x=0
   * si la curva existe ahí; si no (asíntota como 1/x, o dominio x>0 como arccot(x²)/(2√x)),
   * se ENGANCHA al punto de la curva más cercano en pantalla (no se conserva la posición
   * de la sesión anterior).
   */
  alternarCarril(): void {
    this._railOn = !this._railOn;
    this.camara.restaurarVista();
    this._railX = 0;
    this._railY = null;
    // Estado del carril de inercia a cero: sin verticalidad previa (rampa ×1), ni anclaje de Caso B,
    // ni reenganche a medias (dejaría la cámara descentrada respecto del punto recién enganchado).
    this._pendiente = 0;
    this._sinVecina = false;
    this._escape = false;
    this._anclaY = false;
    this._d0Ancla = 0;
    this._dxReenganche = 0;
    this._camaraEnMovimiento = false;
    if (this._railOn) {
      this.canvas.focus();
      // Primer onCambio: recomputa la geometría de la vista YA restaurada (la
      // cacheada era del encuadre anterior y podría no cubrir x=0). Después se
      // sitúa el punto sobre esa geometría fresca y se repinta anclado.
      this.onCambio();
      const vp = this.camara.viewport();
      // Punto inicial SOBRE la curva: se engancha por arco 0 al segmento más cercano en
      // pantalla a (x=0, semilla). Si en x=0 la curva existe, la semilla es su propia y y
      // el punto cae ahí; si no, cae en el punto más próximo (p.ej. (1,1) en 1/x) → aparece
      // igual, en vez de quedar null (crosshair invisible, A/D inertes).
      const pos = this.curva.avanzarArco(0, this.ySemilla(vp), 0, vp);
      this._railY = pos ? pos.y : null;
      if (pos) this._railX = pos.x;
    }
    this.onCambio();
  }

  get railOn(): boolean { return this._railOn; }
  get railX(): number { return this._railX; }
  /** y del punto del carril (la MISMA sobre la que se centró la cámara), o null. */
  get railY(): number | null { return this._railY; }

  destruir(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    for (const f of this.limpiezas) f();
  }
}
