// ─────────────────────────────────────────────
// scene · Escena (orquestador: separa CALCULAR de PINTAR)
// ─────────────────────────────────────────────
//
// Conoce los proveedores de geometría y las tres capas de dibujo (overlay,
// renderer de ramas, crosshair) y las conecta. La separación clave de la Fase C:
//
//   • actualizar(viewport) → COSTOSO: pide la `Geometria` a cada proveedor y la
//     cachea. Se llama solo cuando cambia el viewport (pan/zoom/resize).
//   • pintar(viewport, cursor) → BARATO: dibuja la geometría YA cacheada + overlay
//     + crosshair. Se llama también al mover el cursor, SIN recomputar la curva.
//
// Esto evita que mover el ratón vuelva a muestrear la función (lo que sería caro)
// y es el germen de la caché de la Fase F. En Fase C no hay caché por banda de
// escala todavía: cada cambio de viewport recomputa una vez.

import type { ProveedorGeometria, Estilo, Viewport, Tolerancia, Punto, Rama } from "../contracts";
import type { RendererCanvas2D, ItemDibujo } from "../rendering/RendererCanvas2D";
import type { Overlay } from "../rendering/overlay/Overlay";
import type { Crosshair } from "../rendering/Crosshair";
import {
  yEnRamas, avanzarPorArco, recortarRamasPorPendiente, PENDIENTE_CORTE_CARRIL, podarVerticesDePolo,
  existeRamaVecina, curvaConBlowupVertical,
} from "../analysis/lecturaRama";
import { interseccionesDeGeometrias, MAX_PUNTOS } from "../analysis/interseccionesRamas";
import { recortarRegion } from "../analysis/areaBajoRama";
import { resumenPuntosNotables, type ResumenNotables } from "../analysis/puntosNotablesDeRama";
import { semiYAutoencuadre } from "./autoencuadre";

export interface ObjetoEscena {
  readonly proveedor: ProveedorGeometria;
  readonly estilo: Estilo;
}

export class Escena {
  // Geometría calculada en el último `actualizar`, reutilizada por `pintar`.
  private items: ItemDibujo[] = [];
  // Intersecciones del SISTEMA (cruces entre ramas de objetos distintos), en
  // MUNDO. Se recalculan solo en pasada "final" (ver actualizar).
  private puntosCruce: readonly Punto[] = [];
  // true si la última pasada final ALCANZÓ el cap de intersecciones: hay más de
  // las enumerables y el subconjunto sería sesgado → no se pintan (fallar limpio).
  private cruceSaturado = false;
  // true si en la última pasada final DOS curvas coinciden en un tramo (solución
  // continua): infinitas soluciones, cualitativamente distinto de la saturación.
  private cruceSolapa = false;
  // Índice del objeto que SIGUEN el crosshair y el carril (selección de línea). El
  // número de objetos es fijo (los del constructor), así que sobrevive a `actualizar`.
  private seleccion = 0;
  // ¿Se le ha visto ALGUNA VEZ a este objeto una asíntota vertical FORMAL (declarada por el
  // trazador)? Latch MONÓTONO: tener polos es una propiedad de la FUNCIÓN, no del encuadre — tan(x)
  // los tiene aunque el zoom actual no muestre ninguno. Sin el latch, hacer zoom-in hasta dejar el
  // polo fuera de la vista apagaba el modo carril de inercia y el punto acababa cabalgando el polo
  // con la cámara pegada. Solo las pasadas FINALES exponen asíntotas (la interactiva las omite por
  // coste), así que solo ellas lo encienden.
  private asintotasFormalesPorObjeto: boolean[] = [];
  // Presencia EFECTIVA de asíntota vertical por objeto = formal (latcheada) OR blow-up de borde de
  // dominio. El blow-up se deriva de la geometría y se refresca en pasada FINAL: es una heurística
  // (extremo interior, off-screen y casi vertical) que sobre geometría interactiva muy ampliada
  // confundiría una TANGENTE vertical (x³+y³=9 en ∛9) con una asíntota.
  private asintotasVertPorObjeto: boolean[] = [];

  // Bloque obs-integral: límites de la integral definida (o null si no es un bloque de
  // integral). Los fija el host tras crear la escena. El SOMBREADO se recorta del
  // integrando (primer objeto) en `actualizar` y se cachea aquí, como `puntosCruce`.
  private integral: { a: number; b: number } | null = null;
  private regionIntegral: Float64Array[] = [];

  // ¿Se PINTAN los marcadores de puntos notables (raíces, vértices, cortes Y) y las
  // intersecciones del sistema? Preferencia del usuario (host), puramente de RENDER: la
  // geometría se sigue calculando igual —el ⓘ y los tests la leen— y el crosshair/carril,
  // que no son marcadores sino lectura interactiva, no se ven afectados.
  private notablesVisibles = true;

  constructor(
    private readonly objetos: readonly ObjetoEscena[],
    private readonly overlay: Overlay,
    private readonly renderer: RendererCanvas2D,
    private readonly crosshair: Crosshair
  ) {}

  /**
   * COSTOSO: recomputa la geometría de cada objeto para el viewport y la cachea.
   * `pasada` selecciona la calidad (campo del contrato Tolerancia): "interactiva"
   * = ligera durante un gesto; "final" = máxima calidad al asentarse. El host
   * decide cuál con la estrategia de dos pasadas (programarRedibujo/programarFinal).
   */
  /**
   * Marca esta escena como bloque de INTEGRAL DEFINIDA sobre [a,b] (obs-integral): el
   * SOMBREADO se recorta del integrando (primer objeto) en cada `actualizar`. Lo llama
   * el host tras crear la escena; sin llamarla, la escena se pinta como siempre.
   */
  fijarIntegral(a: number, b: number): void {
    this.integral = { a, b };
  }

  /**
   * Muestra u oculta los MARCADORES de puntos notables e intersecciones (preferencia del
   * plugin). Solo afecta al pintado: no se recorta nada de la geometría, así que el ⓘ
   * sigue describiendo la curva entera y el carril/crosshair siguen funcionando.
   */
  mostrarNotables(visibles: boolean): void {
    this.notablesVisibles = visibles;
  }

  /** Región de integral cacheada (polilíneas recortadas a [a,b]); para el render y tests. */
  regionesIntegral(): readonly Float64Array[] {
    return this.regionIntegral;
  }

  /**
   * Semirrango vertical al que la vista debería acercarse para encuadrar la geometría YA
   * calculada (o `null` si no procede). Criterio y guardas en `autoencuadre.ts`; aquí solo
   * se reúnen las ramas de TODOS los objetos —en un sistema, una sola curva ilimitada basta
   * para que no se encuadre nada— y se PODAN los vértices sintéticos de polo, que viven
   * fuera de la vista a propósito y romperían la contención de cualquier función con asíntota.
   */
  encuadreAutomatico(viewport: Viewport): number | null {
    const ramas = this.items.flatMap((it) => podarVerticesDePolo(it.geometria.ramas, viewport));
    return semiYAutoencuadre(ramas, viewport);
  }

  actualizar(viewport: Viewport, pasada: "interactiva" | "final" = "final"): void {
    const tolerancia: Tolerancia = { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada };
    this.items = this.objetos.map((o) => ({
      geometria: o.proveedor.geometria(viewport, tolerancia),
      estilo: o.estilo,
    }));
    // Sombreado de la integral: recorta el integrando (primer objeto) a la franja [a,b].
    // Barato y recomputado en ambas pasadas (sigue a la curva mientras se re-traza).
    if (this.integral && this.items.length > 0) {
      this.regionIntegral = recortarRegion(this.items[0].geometria.ramas, this.integral.a, this.integral.b);
    }
    // Solo la pasada final expone asíntotas. Las FORMALES se acumulan en un latch monótono (una vez
    // vistas, la función las tiene aunque el zoom actual no las muestre); el blow-up de borde de
    // dominio se re-evalúa en cada final. Ver los campos.
    if (pasada === "final") {
      this.asintotasVertPorObjeto = this.items.map((it, i) => {
        if (it.geometria.asintotas.some((a) => a.tipo === "vertical")) this.asintotasFormalesPorObjeto[i] = true;
        return this.asintotasFormalesPorObjeto[i] === true ||
          curvaConBlowupVertical(it.geometria.ramas, viewport);
      });
    }
    // Intersecciones del sistema: propiedad del CONJUNTO (par de objetos), por eso
    // viven aquí y no en un proveedor (que es por-objeto). Solo en pasada final,
    // como los demás extras; durante el gesto se conservan las últimas (son puntos
    // de MUNDO → siguen siendo correctos mientras la cámara se mueve).
    if (this.objetos.length >= 2 && pasada === "final") {
      const epsMundo = ((viewport.domX[1] - viewport.domX[0]) / viewport.anchoPx) * 3;
      // Región = la vista con un pequeño margen (no perder cruces justo en el borde);
      // el recorte a región acota los segmentos de polo y mantiene la rejilla sana.
      const region = {
        x0: viewport.domX[0] - epsMundo, x1: viewport.domX[1] + epsMundo,
        y0: viewport.domY[0] - epsMundo, y1: viewport.domY[1] + epsMundo,
      };
      const estado = { solapa: false };
      const crudos = interseccionesDeGeometrias(
        this.items.map((it) => it.geometria), epsMundo, undefined, region, estado
      );
      this.cruceSolapa = estado.solapa;
      // Cap alcanzado = enumeración incompleta y sesgada por el orden de barrido:
      // mejor no pintar un subconjunto engañoso (el panel ⓘ avisa de la saturación).
      this.cruceSaturado = crudos.length >= MAX_PUNTOS;
      this.puntosCruce = this.cruceSaturado ? [] : crudos.filter((p) =>
        p.x >= viewport.domX[0] && p.x <= viewport.domX[1] &&
        p.y >= viewport.domY[0] && p.y <= viewport.domY[1]);
    }
  }

  /**
   * BARATO: dibuja overlay + asíntotas + ramas + puntos notables + crosshair, todo
   * sobre la geometría YA cacheada. `anclado` marca el crosshair en modo carril.
   */
  pintar(
    viewport: Viewport,
    cursorPx: number | null,
    anclado = false,
    yMundo?: number | null,
    ratonPx?: number | null,
    ratonPy?: number | null
  ): void {
    this.overlay.dibujar(viewport);
    this.renderer.dibujarAsintotas(this.items, viewport);
    // Relleno de la integral ANTES de las ramas: el trazo de la curva queda encima.
    if (this.integral) this.renderer.dibujarRegion(this.regionIntegral, viewport);
    this.renderer.dibujar(this.items, viewport);
    if (this.notablesVisibles) {
      this.renderer.dibujarPuntosNotables(this.items, viewport);
      this.renderer.dibujarIntersecciones(this.puntosCruce, viewport);
    }
    // Crosshair matemático (línea en cursorPx / railX, marcador sobre la curva).
    // Sigue la curva SELECCIONADA (selección de línea); solo si esa curva es RECORRIBLE
    // como y=f(x): sin fórmula, implícita no trazable o MULTIVALUADA (varias ramas en la
    // misma franja de x) no hay una y sin ambigüedad → se omite (igual que se oculta el ⌖).
    if (cursorPx !== null && this.curvaRecorrible()) {
      this.crosshair.dibujar(viewport, cursorPx, this.items[this.seleccion], anclado, yMundo);
    }
    // Cruz propia del cursor, en la posición REAL del ratón (encima de todo).
    // Independiente del crosshair: en modo carril el crosshair va en railX pero la
    // cruz sigue al ratón.
    if (ratonPx !== null && ratonPx !== undefined && ratonPy !== null && ratonPy !== undefined) {
      this.crosshair.dibujarCursorCruz(ratonPx, ratonPy);
    }
  }

  /** Intersecciones del sistema visibles en la última pasada final (en MUNDO),
   *  para el panel de solución del host. Agnóstico: derivadas de las Ramas. */
  intersecciones(): readonly Punto[] {
    return this.puntosCruce;
  }

  /** true si en la última pasada final había MÁS intersecciones que el cap
   *  enumerable (vista demasiado alejada): la lista/los marcadores se omiten. */
  interseccionesSaturadas(): boolean {
    return this.cruceSaturado;
  }

  /** true si en la última pasada final DOS curvas coincidían en un tramo dentro de
   *  la vista: el sistema tiene INFINITAS soluciones (una recta/curva común), no un
   *  conjunto de puntos aislados. */
  solucionesInfinitas(): boolean {
    return this.cruceSolapa;
  }

  /** y sobre la curva SELECCIONADA en un x de mundo, leída de la geometría cacheada
   *  (para el carril). Agnóstico: no evalúa f. */
  yEnCurva(worldX: number): number | null {
    const it = this.items[this.seleccion];
    return it ? yEnRamas(it.geometria.ramas, worldX) : null;
  }

  /** Ramas de la curva seleccionada listas para el carril. Con `recortar` (curvas con asíntota
   *  vertical) se descartan los tramos casi verticales (`recortarRamasPorPendiente`), para que la
   *  rama TERMINE donde la curva deja de ser recorrible y el arco pueda alcanzar ese extremo y
   *  saltar a la vecina. El corte es GEOMÉTRICO (pendiente), no depende del encuadre. Si no queda
   *  nada recorrible (el punto está dentro del chorro del polo), se devuelve la geometría cruda:
   *  el punto sigue subiendo por la asíntota en vez de quedarse sin polilínea bajo los pies. */
  private ramasCarril(ramas: readonly Rama[], viewport: Viewport, recortar: boolean): readonly Rama[] {
    // SIEMPRE se podan los vértices sintéticos con que el trazador cierra las ramas en un polo: son
    // para el render, y el carril los caminaría como si fueran curva (ver `podarVerticesDePolo`).
    const sanas = podarVerticesDePolo(ramas, viewport);
    if (!recortar) return sanas;
    const recortadas = recortarRamasPorPendiente(sanas, viewport, PENDIENTE_CORTE_CARRIL);
    return recortadas.length > 0 ? recortadas : sanas;
  }

  /** Avance de carril por LONGITUD DE ARCO EN PANTALLA sobre la curva seleccionada (nunca
   *  fuera de ella): camina `deltaPx` px a lo largo de la polilínea desde (x,y), saltando
   *  huecos o pegándose al borde. Con `recortar` se camina la geometría sin los tramos casi
   *  verticales (Caso A: así el arco acaba y salta a la vecina). Devuelve además el `evento`
   *  (salto/tope/normal). null si no hay curva legible. */
  avanzarArcoEnCurva(
    x: number, y: number, deltaPx: number, viewport: Viewport, recortar = false
  ): { x: number; y: number; evento: "normal" | "salto" | "tope"; hueco: number } | null {
    const it = this.items[this.seleccion];
    if (!it) return null;
    return avanzarPorArco(this.ramasCarril(it.geometria.ramas, viewport, recortar), x, y, deltaPx, viewport);
  }

  /** ¿Hay una RAMA VECINA ALCANZABLE a la que saltar avanzando en `dir` (+1/−1) desde (x,y)?
   *  Detección Caso A (tan x: al otro lado del polo sigue la curva) / Caso B (arccot(x²)/(2√x):
   *  convergencia real, el dominio TERMINA ahí) del carril, en tiempo real sobre la MISMA
   *  geometría recortada por pendiente que usa el avance → lo que detecta es exactamente lo que
   *  ocurrirá. Ver existeRamaVecina. */
  hayRamaVecinaCarril(x: number, y: number, dir: number, viewport: Viewport): boolean {
    const it = this.items[this.seleccion];
    if (!it) return false;
    return existeRamaVecina(this.ramasCarril(it.geometria.ramas, viewport, true), x, y, dir, viewport);
  }

  /** ¿La curva SELECCIONADA tiene asíntotas verticales (tan, sec, 1/x…)? El carril usa
   *  esto para activar su modo especial: congela el seguimiento vertical (para que la
   *  rama termine en el borde de la vista y el salto de rama se dispare) y rampa la
   *  velocidad hacia el borde. En curvas sin asíntota vertical (x²…) el carril no cambia. */
  tieneAsintotasVerticales(): boolean {
    // Lee la presencia capturada en la última pasada FINAL (no la geometría cacheada,
    // que durante el gesto es interactiva y no lleva asíntotas). Ver el campo.
    return this.asintotasVertPorObjeto[this.seleccion] === true;
  }

  /**
   * ¿La curva SELECCIONADA se puede RECORRER como y=f(x)? Necesita (a) que sus ramas
   * lleven el `parametro` x-monótono que `yEnRamas` usa Y (b) que sea SINGULAR-VALUADA:
   * las ramas no pueden SOLAPARSE en x (una recta vertical debe cortar la curva ≤1 vez).
   *
   * El (b) es lo que distingue una función de x de una relación multivaluada que, pese
   * a trazarse con ramas x-monótonas, NO es función: p.ej. `tan(y)·(x²+1)=√(x+1)` sale
   * por continuación como VARIAS ramas casi horizontales SOLAPADAS en la misma franja
   * de x (la vertical las corta a todas) → el crosshair vertical sería ambiguo. En
   * cambio `tan(x)` u otras con polos dan ramas en franjas de x DISJUNTAS → sí función.
   *
   * FALSO también para implícitas no separables (círculo x²+y²=9), separables
   * transpuestas x=g(y) (tan y=x) y paramétricas/polares (sin `parametro`). Gobierna si
   * el crosshair y el carril tienen sentido: si no, no se ofrecen (ni ⌖ ni crosshair).
   */
  curvaRecorrible(): boolean {
    const it = this.items[this.seleccion];
    if (!it) return false;
    const rangos = it.geometria.ramas
      .filter((r) => r.parametro !== undefined && r.parametro.length >= 2)
      .map((r): readonly [number, number] => {
        const t = r.parametro!;
        const a = t[0], b = t[t.length - 1];
        return a <= b ? [a, b] : [b, a];
      })
      .sort((p, q) => p[0] - q[0]);
    if (rangos.length === 0) return false;
    // Función de x ⇔ las franjas de x de las ramas NO se solapan (salvo un roce mínimo,
    // p.ej. el borde de un polo donde el muestreo se pasa un pelo). Un solape apreciable
    // ⇒ multivaluada ⇒ el crosshair vertical es ambiguo → no recorrible.
    for (let i = 1; i < rangos.length; i++) {
      const prev = rangos[i - 1], cur = rangos[i];
      const solape = Math.min(prev[1], cur[1]) - cur[0];
      const menor = Math.min(prev[1] - prev[0], cur[1] - cur[0]);
      if (solape > 1e-6 && solape > 0.05 * menor) return false;
    }
    return true;
  }

  /**
   * Resumen COMPLETO (sin el cap de dibujo) de los puntos notables de la curva
   * SELECCIONADA, recalculado de su geometría cacheada. Para el panel ⓘ de
   * obs-graph con curvas no explícitas: ahí "demasiados" se RESUME en texto
   * ("infinitas raíces", …) en vez de omitirse como hace el plano. `viewport`
   * habilita las raíces de extremo de rama (misma semántica que el dibujo).
   */
  resumenNotables(viewport: Viewport): ResumenNotables {
    const it = this.items[this.seleccion];
    if (!it) return { raices: [], vertices: [], interseccionesY: [] };
    return resumenPuntosNotables(it.geometria.ramas, it.geometria.ramas[0]?.objetoId ?? "", viewport);
  }

  /** Número de curvas del sistema (objetos de la escena). */
  numeroCurvas(): number {
    return this.objetos.length;
  }

  /** Color de cada curva (para los botones de selección del host). */
  colores(): ReadonlyArray<readonly [number, number, number, number]> {
    return this.objetos.map((o) => o.estilo.color);
  }

  /** Índice de la curva que siguen crosshair y carril. */
  seleccionActual(): number {
    return this.seleccion;
  }

  /** Selecciona la curva que seguirán crosshair y carril (índice acotado). */
  seleccionar(indice: number): void {
    if (indice >= 0 && indice < this.objetos.length) this.seleccion = indice;
  }
}
