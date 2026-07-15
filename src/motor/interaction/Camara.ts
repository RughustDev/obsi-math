// ─────────────────────────────────────────────
// interaction · Camara (estado de cámara + cursor; agnóstica de estrategia)
// ─────────────────────────────────────────────
//
// Posee el estado mutable de la vista (domX/domY) y del cursor, y traduce los
// gestos en cambios. Emite DOS notificaciones distintas para que el repintado sea
// barato cuando solo se mueve el ratón:
//
//   • onViewport → la vista cambió (pan/zoom): hay que RECOMPUTAR la geometría.
//   • onCursor   → solo se movió el cursor: basta REPINTAR (crosshair).
//
// No sabe qué se dibuja. En Fase C implementa pan, zoom y seguimiento de cursor;
// carril y teclado llegan después.

import type { Viewport } from "../contracts";
import { crearViewport } from "../scene/viewport-utils";

export interface CallbacksCamara {
  /** La vista cambió (pan/zoom): recomputar geometría + pintar. */
  readonly onViewport: () => void;
  /** Solo el cursor cambió: pintar (crosshair) sin recomputar. */
  readonly onCursor: () => void;
}

// Rango vertical por defecto de la vista (el horizontal se deriva del aspecto,
// celdas 1:1). Es el estado inicial y al que vuelve `restaurarVista`.
const DOM_Y_DEFECTO: readonly [number, number] = [-7, 7];

/**
 * Factor de UNA muesca de rueda al ALEJAR (>1 = la vista abarca más mundo). Acercar es su
 * inverso exacto, `1/FACTOR_ZOOM_MUESCA`: así una muesca de más y otra de menos devuelven la
 * vista EXACTA de partida (con 0.95, `1.05·0.95 = 0.9975` ≠ 1 → cada ida y vuelta encogía la
 * vista un 0,25%, deriva que los botones ± harían visible a fuerza de clics).
 */
export const FACTOR_ZOOM_MUESCA = 1.05;

/**
 * Constante de tiempo del suavizado del zoom por botón (ms): en cada frame se consume la
 * fracción `1 − e^(−dt/TAU)` de lo que queda. Con 90 ms, una muesca está prácticamente resuelta
 * en ~200 ms —se ve el movimiento sin que el botón se sienta perezoso— y el gasto es de unas
 * pocas pasadas interactivas, no más caras que las de un gesto de rueda.
 */
const TAU_ZOOM_MS = 90;

/** Resto de zoom (en logaritmo) por debajo del cual se salda de golpe: e^0.0001 − 1 ≈ 0,01%. */
const LOG_ZOOM_MINIMO = 1e-4;

/**
 * Centro de encuadre ACOTADO para el seguimiento del carril: el encuadre
 * [c−semi, c+semi] solo es numéricamente sano mientras el semirrango sea grande
 * frente al ULP del centro. Con |c| > semi·2⁴⁶ quedan <2⁶ pasos representables por
 * semirrango: la rejilla sale a escalones, el render degenera y en el extremo el
 * span colapsa a 0 (era el camino al bucle infinito de ticks siguiendo una
 * derivada explosiva como 2x·e^(x²+1)). Se recorta el centro a ese borde sano:
 * la cámara deja de subir, el punto del carril puede continuar fuera de vista.
 */
export function centroCarrilAcotado(centro: number, semirrango: number): number {
  const max = semirrango * 2 ** 46;
  return Math.max(-max, Math.min(max, centro));
}

export class Camara {
  private domX: [number, number] = [-8.3453, 8.3453];
  private domY: [number, number] = [...DOM_Y_DEFECTO];
  // Semirrango vertical de la vista BASE: el del arranque y al que vuelve `restaurarVista`.
  // Es DOM_Y_DEFECTO salvo que el autoencuadre lo estreche (`fijarEncuadreBase`). Si el reset
  // devolviera al [-7,7] fijo, en un bloque autoencuadrado la tecla de restaurar ALEJARÍA la
  // curva hasta el garabato del que veníamos: la vista base del bloque es la encuadrada.
  private semiYBase = (DOM_Y_DEFECTO[1] - DOM_Y_DEFECTO[0]) / 2;
  private anchoPx = 768;
  private altoPx: number;
  private dpr: number;

  private arrastrando = false;
  private ultimo = { x: 0, y: 0 };
  private curX: number | null = null;
  private curY: number | null = null;

  // ── Animación de vista (botones + / − y 🏠) ────────────────────────────────────────────
  // UN solo bucle rAF para las dos, y EXCLUYENTES entre sí: son destinos incompatibles (el
  // zoom escala donde estés; el regreso vuelve a la vista base) y dos bucles pisándose darían
  // un movimiento errático. Cualquier gesto del usuario (arrastre, rueda) las cancela: quien
  // toca la vista manda sobre lo que la animación creía que quería.
  private rafAnim: number | null = null;
  private tAnimPrev = 0;
  // Zoom pendiente por BOTÓN, en el LOGARITMO del factor (no en el factor): el zoom es
  // multiplicativo (dos muescas = factor²), así que en logaritmo es una SUMA → pulsar dos veces
  // seguidas ACUMULA (log f + log f) y la animación en curso solo extiende su recorrido, sin
  // saltos ni reinicios.
  private logZoomPendiente = 0;
  // ¿La animación en curso es el regreso a la vista base (🏠)?
  private volviendoAInicio = false;

  private readonly limpiezas: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    altoPx: number,
    private readonly cb: CallbacksCamara
  ) {
    this.altoPx = altoPx;
    this.dpr = Math.ceil(window.devicePixelRatio || 1);

    const onDown = (e: PointerEvent) => {
      this.cancelarAnimacion(); // arrastrar mientras la vista se mueve sola sería un tira y afloja
      this.arrastrando = true;
      this.ultimo = { x: e.offsetX, y: e.offsetY };
      this.curX = null; this.curY = null; // ocultar cruz/crosshair durante el arrastre
      this.canvas.setPointerCapture(e.pointerId);
      this.cb.onCursor();
    };
    const onMove = (e: PointerEvent) => {
      if (this.arrastrando) {
        const dx = e.offsetX - this.ultimo.x;
        const dy = e.offsetY - this.ultimo.y;
        this.ultimo = { x: e.offsetX, y: e.offsetY };
        const rx = (this.domX[1] - this.domX[0]) / this.anchoPx;
        const ry = (this.domY[1] - this.domY[0]) / this.altoPx;
        this.domX = [this.domX[0] - dx * rx, this.domX[1] - dx * rx];
        this.domY = [this.domY[0] + dy * ry, this.domY[1] + dy * ry];
        this.cb.onViewport();
      } else {
        this.curX = e.offsetX;
        this.curY = e.offsetY;
        this.cb.onCursor();
      }
    };
    const onUp = (e: PointerEvent) => {
      this.arrastrando = false;
      this.canvas.releasePointerCapture(e.pointerId);
    };
    const onLeave = () => {
      this.curX = null; this.curY = null;
      this.cb.onCursor();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.cancelarAnimacion(); // la rueda toma el mando: la animación en curso ya no vale
      const factor = e.deltaY > 0 ? FACTOR_ZOOM_MUESCA : 1 / FACTOR_ZOOM_MUESCA;
      const mx = this.domX[0] + (e.offsetX / this.anchoPx) * (this.domX[1] - this.domX[0]);
      const my = this.domY[1] - (e.offsetY / this.altoPx) * (this.domY[1] - this.domY[0]);
      this.domX = [mx + (this.domX[0] - mx) * factor, mx + (this.domX[1] - mx) * factor];
      this.domY = [my + (this.domY[0] - my) * factor, my + (this.domY[1] - my) * factor];
      this.cb.onViewport();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    this.limpiezas.push(
      () => canvas.removeEventListener("pointerdown", onDown),
      () => canvas.removeEventListener("pointermove", onMove),
      () => canvas.removeEventListener("pointerup", onUp),
      () => canvas.removeEventListener("pointerleave", onLeave),
      () => canvas.removeEventListener("wheel", onWheel)
    );
  }

  /** Foto inmutable del estado actual de cámara. */
  viewport(): Viewport {
    return crearViewport(this.domX, this.domY, this.anchoPx, this.altoPx, this.dpr);
  }

  /** Posición X del cursor en px CSS, o null si está fuera / arrastrando. */
  cursorPx(): number | null {
    return this.curX;
  }

  /** Posición Y del cursor en px CSS, o null si está fuera / arrastrando. */
  cursorPy(): number | null {
    return this.curY;
  }

  /**
   * Restaura la vista a los dominios por defecto: Y = DOM_Y_DEFECTO y X centrada
   * en el origen con celdas 1:1 (mismo cálculo que `redimensionar`). Deshace
   * cualquier pan/zoom acumulado. Mutador pasivo: no emite onViewport.
   */
  restaurarVista(): void {
    this.domY = [-this.semiYBase, this.semiYBase];
    const semiX = this.semiYBase * (this.anchoPx / this.altoPx);
    this.domX = [-semiX, semiX];
  }

  /**
   * Fija la vista BASE del bloque a [−semiY, semiY] (centrada en el ORIGEN, celdas 1:1) y
   * la aplica. Solo el AUTOENCUADRE la llama, una vez, en el primer render: escalar sin
   * trasladar mantiene los ejes en cuadro. Mutador pasivo (no emite onViewport): quien la
   * llama recomputa y pinta.
   */
  fijarEncuadreBase(semiY: number): void {
    this.semiYBase = semiY;
    this.restaurarVista();
  }

  /**
   * Zoom de UNA muesca de rueda anclado al CENTRO de la vista, no al cursor (botones ± del
   * plano, al estilo de GeoGebra/Desmos): el punto que hay bajo el centro se queda donde está
   * y el mundo se acerca o se aleja a su alrededor. `acercar=true` → misma escala que una
   * muesca de rueda hacia arriba; ambos sentidos son inversos EXACTOS (ver FACTOR_ZOOM_MUESCA),
   * así que + y − seguidos devuelven la vista de partida.
   *
   * SUAVE, no instantáneo: el salto de una muesca aplicado de golpe se lee como un parpadeo
   * (nada guía al ojo entre la vista vieja y la nueva; con la rueda no pasa porque la sucesión
   * de muescas ya es continua). Se reparte en varios frames con un suavizado EXPONENCIAL
   * (avanza una fracción fija de lo que queda por frame → arranque rápido, frenada progresiva,
   * y aterriza sin rebote sea cual sea el número de clics acumulados).
   *
   * Mutador ACTIVO (a diferencia de `panear`/`enfocarCarril`): emite onViewport en cada frame,
   * porque el clic de un botón no es parte de un gesto con su propio bucle de repintado. El host
   * lo trata como cualquier pan/zoom: pasada interactiva por frame + final al detenerse.
   */
  zoomCentrado(acercar: boolean): void {
    const factor = acercar ? 1 / FACTOR_ZOOM_MUESCA : FACTOR_ZOOM_MUESCA;
    this.volviendoAInicio = false; // el zoom manda sobre un regreso en curso
    this.logZoomPendiente += Math.log(factor);
    this.arrancarAnimacion();
  }

  /**
   * Regreso SUAVE a la vista base del bloque (botón 🏠): deshace el zoom Y el pan acumulados
   * —la vista base está centrada en el origen (§ `restaurarVista`)—, con el mismo perfil
   * exponencial que los botones ± : rápido al principio, frenando cada vez más, hasta clavar
   * la posición EXACTA (la última fracción se salda de golpe; ver `pasoAnimacion`).
   *
   * Las dos magnitudes se interpolan como cada una manda: el CENTRO, linealmente (es una
   * traslación); el SEMIRRANGO, geométricamente (el zoom es multiplicativo: ir de 0.5 a 8 debe
   * "sentirse" igual de largo que de 8 a 128). Interpolar la escala en lineal daría un final
   * arrastrado y un principio de golpe.
   */
  volverAVistaBase(): void {
    this.logZoomPendiente = 0; // el regreso manda sobre un zoom por botón en curso
    this.volviendoAInicio = true;
    this.arrancarAnimacion();
  }

  /** Corta cualquier animación de vista en curso: un gesto del usuario manda sobre ella. */
  private cancelarAnimacion(): void {
    if (this.rafAnim !== null) cancelAnimationFrame(this.rafAnim);
    this.rafAnim = null;
    this.logZoomPendiente = 0;
    this.volviendoAInicio = false;
  }

  private arrancarAnimacion(): void {
    if (this.rafAnim !== null) return; // el bucle ya corre: absorbe el destino nuevo
    this.tAnimPrev = performance.now();
    const paso = (t: number) => {
      // dt REAL (no un paso fijo por frame): a 30 fps la animación debe durar lo mismo que a
      // 144, o el movimiento sería el doble de lento en la mitad de las máquinas. Se acota por
      // si la pestaña estuvo dormida entre frames (un dt enorme la resuelve de golpe, que es lo
      // correcto: nadie estaba mirando).
      const dt = Math.min(100, t - this.tAnimPrev);
      this.tAnimPrev = t;
      // Fracción de lo que QUEDA que se consume en este frame (suavizado exponencial de
      // constante TAU_ZOOM_MS): esto es lo que da el perfil rápido-al-principio y cada vez más
      // lento, sin rebote, sea cual sea la distancia que quede por recorrer.
      const avance = 1 - Math.exp(-dt / TAU_ZOOM_MS);
      const sigue = this.pasoAnimacion(avance);
      this.cb.onViewport();
      this.rafAnim = sigue ? requestAnimationFrame(paso) : null;
      if (!sigue) this.volviendoAInicio = false;
    };
    this.rafAnim = requestAnimationFrame(paso);
  }

  /** Un frame de la animación activa. Devuelve `true` si aún queda camino. */
  private pasoAnimacion(avance: number): boolean {
    if (this.volviendoAInicio) {
      // Solo se vigila Y: el semiX de la vista base y el actual se derivan ambos del aspecto
      // (celdas 1:1), así que convergen a la vez. El aterrizaje exacto lo firma `restaurarVista`.
      const semiYObj = this.semiYBase;
      const cx = (this.domX[0] + this.domX[1]) / 2;
      const cy = (this.domY[0] + this.domY[1]) / 2;
      const semiX = (this.domX[1] - this.domX[0]) / 2;
      const semiY = (this.domY[1] - this.domY[0]) / 2;
      // Escala: interpolación GEOMÉTRICA (en logaritmo). Centro: LINEAL hacia el origen.
      const logRestante = Math.log(semiYObj / semiY);
      const centroLejos = Math.max(Math.abs(cx), Math.abs(cy)) > semiYObj * 1e-4;
      if (Math.abs(logRestante) < LOG_ZOOM_MINIMO && !centroLejos) {
        this.restaurarVista(); // la cola se salda de golpe: se clava la vista EXACTA
        return false;
      }
      const f = Math.exp(logRestante * avance);
      const ncx = cx * (1 - avance), ncy = cy * (1 - avance);
      const nsemiX = semiX * f, nsemiY = semiY * f;
      this.domX = [ncx - nsemiX, ncx + nsemiX];
      this.domY = [ncy - nsemiY, ncy + nsemiY];
      return true;
    }
    let log = this.logZoomPendiente * avance;
    // Cola: por debajo de este resto el factor que queda es <0,01% (imperceptible) y la
    // exponencial nunca llegaría a cero. Se salda de una vez → la animación TERMINA.
    if (Math.abs(this.logZoomPendiente - log) < LOG_ZOOM_MINIMO) log = this.logZoomPendiente;
    this.logZoomPendiente -= log;
    this.aplicarZoomCentrado(Math.exp(log));
    return this.logZoomPendiente !== 0;
  }

  /** Escala la vista por `factor` dejando fijo su CENTRO (el zoom no traslada). */
  private aplicarZoomCentrado(factor: number): void {
    const cx = (this.domX[0] + this.domX[1]) / 2;
    const cy = (this.domY[0] + this.domY[1]) / 2;
    const semiX = ((this.domX[1] - this.domX[0]) / 2) * factor;
    const semiY = ((this.domY[1] - this.domY[0]) / 2) * factor;
    this.domX = [cx - semiX, cx + semiX];
    this.domY = [cy - semiY, cy + semiY];
  }

  /**
   * Desplaza la vista en unidades de MUNDO (paneo por teclado). Mutador pasivo,
   * como `enfocarCarril`: NO emite onViewport; quien lo llama decide cuándo
   * recomputar/pintar (Navegacion usa su propio bucle rAF + onCambio).
   */
  panear(dxMundo: number, dyMundo: number): void {
    this.domX = [this.domX[0] + dxMundo, this.domX[1] + dxMundo];
    this.domY = [this.domY[0] + dyMundo, this.domY[1] + dyMundo];
  }

  /**
   * Reencuadra para seguir un punto de carril (railX, railY) con zoom opcional.
   * Recibe railX/railY YA calculados (la cámara no conoce la curva): X siempre
   * sigue a railX; Y se recentra solo si railY es finito. Mismo comportamiento que
   * el modo carril de obs-graph (seguirRail).
   */
  enfocarCarril(railX: number, railY: number | null, factor: number): void {
    const RANGO_SEMI_MIN = 1e-4;
    const RANGO_SEMI_MAX = 1e9;
    const semiYAnt = (this.domY[1] - this.domY[0]) / 2;
    const semiYNueva = Math.max(RANGO_SEMI_MIN, Math.min(RANGO_SEMI_MAX, semiYAnt * factor));
    const f = semiYNueva / semiYAnt;
    const semiX = ((this.domX[1] - this.domX[0]) / 2) * f;
    // Centros ACOTADOS (centroCarrilAcotado): siguiendo una derivada explosiva
    // (2x·e^(x²+1)) railY crece sin límite, y un encuadre [c−semi, c+semi] con |c|
    // enorme DEGENERA en flotante (el semirrango cae bajo el ULP del centro: span 0
    // o a escalones), alimentando de basura a rejilla y render. La cámara sigue el
    // punto solo mientras el encuadre es numéricamente sano; más allá se queda en
    // el borde (el punto del carril puede continuar fuera de vista).
    const cx = centroCarrilAcotado(railX, semiX);
    this.domX = [cx - semiX, cx + semiX];
    if (railY !== null && Number.isFinite(railY)) {
      const cy = centroCarrilAcotado(railY, semiYNueva);
      this.domY = [cy - semiYNueva, cy + semiYNueva];
    } else if (f !== 1) {
      const cy = (this.domY[0] + this.domY[1]) / 2;
      this.domY = [cy - semiYNueva, cy + semiYNueva];
    }
  }

  /**
   * Ajusta la MÉTRICA del lienzo (ancho/alto en px CSS y dpr) y reencuadra X para
   * celdas 1:1 con Y. Alto y dpr no son constantes de por vida: el zoom de la app
   * (Ctrl+rueda) cambia el devicePixelRatio, y un tema que ligue el ancho de nota a
   * la fuente (--file-line-width en rem/em) cambia la caja CSS al vuelo. Si la cámara
   * se quedara con los valores del primer render, la relación mundo→píxel dejaría de
   * coincidir con la caja real y la gráfica saldría deformada (celdas no cuadradas).
   */
  redimensionar(anchoPx: number, altoPx: number = this.altoPx, dpr: number = this.dpr): void {
    this.anchoPx = anchoPx;
    this.altoPx = altoPx;
    this.dpr = dpr;
    const centroX = (this.domX[0] + this.domX[1]) / 2;
    const semiX = ((this.domY[1] - this.domY[0]) / 2) * (anchoPx / altoPx);
    this.domX = [centroX - semiX, centroX + semiX];
  }

  dprActual(): number {
    return this.dpr;
  }

  destruir(): void {
    // El rAF de la animación de vista sobrevive al bloque si no se cancela: seguiría llamando a
    // onViewport (recomputar + pintar) sobre una escena y un canvas ya desmontados.
    this.cancelarAnimacion();
    for (const f of this.limpiezas) f();
  }
}
