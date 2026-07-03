import {
  MarkdownRenderer,
  MarkdownRenderChild,
  Plugin,
  type MarkdownPostProcessorContext,
} from "obsidian";

import { parsearSistemaCases, sistemaCasesALatex } from "../../sistemas-latex";
import {
  resolverSistema,
  parsearEcuacionLineal,
  type EcuacionLineal,
} from "../../algebra-lineal";
import { parsearEcuacion, type EcuacionGeneral } from "../../solver/ecuacion";
import { interseccionesNumericas, type Punto } from "../../solver/solverNumerico";
import { contorno } from "../../render/marchingSquares";
import { muestrearFuncion } from "../../render/muestreoExplicito";
import { crearPrograma, construirQuadStrip } from "../../webgl";

// Si la ecuación se puede DESPEJAR en y como una o varias ramas explícitas y=f(x),
// devuelve esas ramas para renderizarlas con el sampler 1D de obs-graph (calidad
// superior y, sobre todo, MANEJO CORRECTO DE POLOS/ASÍNTOTAS, que la rejilla 2D de
// marching squares no resuelve: cerca de un polo la curva es una astilla casi
// vertical pegada a la asíntota que la rejilla pierde). Dos formas:
//
//   (A) LINEAL en y:  F = a·y + b(x), a≠0  ⇒  1 rama  y = −b(x)/a.
//       `y=sin(x²)`, `x−y=0`, `y+x²=3`.
//   (B) CUADRÁTICA PAR en y:  F = a·y² + c(x), a≠0  ⇒  2 ramas  y = ±√(−c(x)/a)
//       (donde el radicando ≥ 0). `tan x + y² = 2`, `x²+y²=49`, `y²=x`.
//
// El resto (`sin(xy)=…`, `x²+y²+xy=1`, mezclas con término lineal Y cuadrático en y)
// → null → marching squares. Comprobación NUMÉRICA en varios (x,y): (A) ∂F/∂y debe
// ser la misma constante; (B) F par en y y (F(x,y)−F(x,0))/y² la misma constante.
function despejarRamas(
  F: (x: number, y: number) => number
): ((x: number) => number)[] | null {
  const xs = [0.37, 1.13, -0.91, 2.07, -1.6];
  const ys = [0.41, -0.72, 2.33, 1.05, -0.3];

  // ── (A) Lineal en y: ∂F/∂y = const ≠ 0 ───────────────────────────────────
  const h = 1e-5;
  let a0: number | null = null;
  let esLineal = true;
  for (let i = 0; i < xs.length; i++) {
    const d = (F(xs[i], ys[i] + h) - F(xs[i], ys[i] - h)) / (2 * h);
    if (!Number.isFinite(d)) { esLineal = false; break; }
    if (a0 === null) a0 = d;
    else if (Math.abs(d - a0) > 1e-6 * (1 + Math.abs(a0))) { esLineal = false; break; }
  }
  if (esLineal && a0 !== null && Math.abs(a0) >= 1e-9) {
    const a = a0;
    return [(x: number) => -F(x, 0) / a]; // y = −b(x)/a, con b(x)=F(x,0)
  }

  // ── (B) Cuadrática PAR en y: F = a·y² + c(x) ─────────────────────────────
  // a = (F(x,y)−F(x,0))/y² debe ser la MISMA constante en varios (x,y) y F par en y.
  let a2: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = Math.abs(ys[i]) + 0.5; // y ≠ 0
    const f0 = F(x, 0), fy = F(x, y), fmy = F(x, -y);
    if (!Number.isFinite(f0) || !Number.isFinite(fy) || !Number.isFinite(fmy)) return null;
    if (Math.abs(fy - fmy) > 1e-6 * (1 + Math.abs(fy))) return null; // no par en y
    const a = (fy - f0) / (y * y);
    if (a2 === null) a2 = a;
    else if (Math.abs(a - a2) > 1e-6 * (1 + Math.abs(a2))) return null; // no cuadrática pura
  }
  if (a2 === null || Math.abs(a2) < 1e-9) return null;
  const a = a2;
  const g = (x: number) => -F(x, 0) / a; // y² = g(x) = −c(x)/a
  return [
    (x: number) => { const v = g(x); return v >= 0 ? Math.sqrt(v) : NaN; },  // rama +
    (x: number) => { const v = g(x); return v >= 0 ? -Math.sqrt(v) : NaN; }, // rama −
  ];
}

// Recta lineal del sistema lista para dibujar: coeficientes en los dos ejes del
// plano (a·x + b·y = c) más su color asignado. Una ecuación con solo x es una
// recta vertical (b≈0); una con solo y, horizontal (a≈0).
interface RectaSistema {
  a: number;
  b: number;
  c: number;
  color: [number, number, number, number];
}

// Paleta de colores para las rectas (se recicla si hay más ecuaciones que
// colores). El azul/naranja iniciales coinciden con el estilo de obs-graph.
const COLORES: [number, number, number, number][] = [
  [0.31, 0.62, 1.0, 1.0],   // azul
  [1.0, 0.63, 0.20, 1.0],   // naranja
  [0.40, 0.85, 0.45, 1.0],  // verde
  [0.85, 0.45, 0.90, 1.0],  // morado
  [0.95, 0.40, 0.45, 1.0],  // rojo
  [0.35, 0.80, 0.85, 1.0],  // cian
];

export class SystemEngine {
  private obsSistemaUpdateCount = 0;

  constructor(
    private plugin: Plugin,
    private habilitado: boolean
  ) {}

  async process(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    const contenedor = el.createDiv({ cls: "obsi-math-container" });

    // Igual que obs-graph: Obsidian re-renderiza el bloque (editar, scroll,
    // cambiar de nota…) creando un contenedor nuevo cada vez. Sin liberar el
    // contexto WebGL anterior se acumulan hasta "Too many active WebGL contexts".
    // Este MarkdownRenderChild ejecuta sus register() al quitar el elemento del
    // DOM, donde liberamos GL, observers y listeners globales.
    const limpieza = new MarkdownRenderChild(contenedor);
    ctx.addChild(limpieza);

    if (!this.habilitado) {
      contenedor.createEl("p", {
        text: "⚠️ obs-system está deshabilitado temporalmente.",
        cls: "obsi-math-aviso",
      });
      return;
    }

    try {
      const { ecuaciones, espacios } = parsearSistemaCases(source);
      if (ecuaciones.length < 2) {
        contenedor.createEl("p", {
          text: "Error: se necesitan al menos 2 ecuaciones",
          cls: "obsi-math-aviso",
        });
        return;
      }

      // ── Parseo general (cualquier ecuación: lineal, no lineal o implícita) ──
      // Usa el MISMO parser/evaluador que obs-graph (parsearEcuacion → F(x,y)) y
      // detecta la linealidad de forma ROBUSTA (afinidad fuera de los ejes).
      const ecuacionesGen = ecuaciones.map(parsearEcuacion);
      const todasVarsGen = Array.from(
        new Set(ecuacionesGen.flatMap((e) => (e ? e.variables : [])))
      ).sort();
      const xVarG = todasVarsGen.find((v) => v === "x") ?? todasVarsGen[0];
      const yVarG =
        todasVarsGen.find((v) => v === "y") ?? todasVarsGen.find((v) => v !== xVarG);

      // ── Parseo lineal (ruta analítica/exacta para sistemas lineales) ────────
      // Coeficientes lineales por ecuación (parser de álgebra lineal). Determina
      // además las dos variables que actúan como ejes del plano.
      const parseadas = ecuaciones.map(parsearEcuacionLineal);
      // TODAS las ecuaciones lineales: exige tanto que el parser de álgebra lineal
      // saque coeficientes como que el chequeo de afinidad robusto lo confirme
      // (descarta falsos positivos tipo sqrt(x²+y²), lineal solo sobre los ejes).
      const todoLineal =
        parseadas.every((p) => p !== null) &&
        ecuacionesGen.every((e) => e !== null && e.esLineal);
      const todasVars = Array.from(
        new Set(
          parseadas.flatMap((p) => (p ? Object.keys(p.vars) : []))
        )
      ).sort();
      const xVar = todasVars.find((v) => v === "x") ?? todasVars[0];
      const yVar = todasVars.find((v) => v === "y") ?? todasVars.find((v) => v !== xVar);

      // Solución analítica: solo tiene sentido si TODAS las ecuaciones son
      // lineales (resolverSistema clasifica de forma exacta —única / infinitas /
      // inconsistente— para cualquier número de variables). Con alguna no lineal
      // no hay vía analítica y se resuelve numéricamente más abajo.
      const resultado = todoLineal ? resolverSistema(ecuaciones) : null;

      // El plano solo representa sistemas de 2 variables. Caso LINEAL: rectas
      // exactas (a·x+b·y=c) — ruta original intacta. Caso GENERAL (alguna no
      // lineal): curvas implícitas por marching squares. Con 0/1/≥3 incógnitas no
      // hay nada que dibujar: velo informativo (igual que obs-graph degenerado).
      const esLineal =
        todoLineal &&
        todasVars.length === 2 &&
        xVar !== undefined &&
        yVar !== undefined;
      const general =
        !esLineal &&
        todasVarsGen.length === 2 &&
        ecuacionesGen.every((e) => e !== null) &&
        xVarG !== undefined &&
        yVarG !== undefined;
      const graficable = esLineal || general;

      // Rectas exactas (solo caso lineal).
      const rectas: RectaSistema[] = [];
      if (esLineal) {
        parseadas.forEach((p, i) => {
          const a = (p as EcuacionLineal).vars[xVar] ?? 0;
          const b = (p as EcuacionLineal).vars[yVar] ?? 0;
          const c = (p as EcuacionLineal).rhs;
          // Ecuación sin coeficientes (0 = c): no define una recta; se omite.
          if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) return;
          rectas.push({ a, b, c, color: COLORES[i % COLORES.length] });
        });
      }

      // Curvas implícitas y sus intersecciones (solo caso general/no lineal).
      // Cada curva lleva su F(x,y) ya mapeada a los ejes del plano y su color. Las
      // intersecciones se hallan numéricamente (Newton) una sola vez, sobre un
      // rango amplio fijo, y se dibujan como marcadores de solución.
      const curvas: {
        F: (x: number, y: number) => number;
        // Si la ecuación se despeja en y (1 rama lineal o 2 ramas ±√ cuadráticas),
        // sus f(x) para el sampler 1D; null → curva implícita → marching squares.
        ramas: ((x: number) => number)[] | null;
        color: [number, number, number, number];
      }[] = [];
      let intersecciones: Punto[] = [];
      if (general) {
        ecuacionesGen.forEach((e, i) => {
          const ec = e as EcuacionGeneral;
          const F = (x: number, y: number) =>
            ec.evaluar({ [xVarG as string]: x, [yVarG as string]: y });
          curvas.push({ F, ramas: despejarRamas(F), color: COLORES[i % COLORES.length] });
        });
        intersecciones = interseccionesNumericas(
          curvas.map((c) => c.F), -12, 12, -12, 12
        );
      }

      // ── Panel LaTeX (izquierda) con scroll horizontal + fades ──────────────
      // Misma experiencia que obs-graph: la fórmula se centra si cabe y se hace
      // scrolleable (rueda + barra fina + degradados en los bordes) si desborda.
      const panelLatex = contenedor.createDiv({ cls: "obsi-math-latex" });
      panelLatex.style.cssText =
        "position:relative; width:50%; height:261px; padding:0; overflow:hidden;";

      const contenedorLatex = panelLatex.createDiv({ cls: "obsi-math-latex" });
      contenedorLatex.style.cssText =
        "width:100%; height:100%; padding:24px; box-sizing:border-box; " +
        "display:flex; align-items:center; justify-content:safe center; " +
        "overflow-x:hidden; overflow-y:hidden;";
      contenedorLatex.style.scrollbarWidth = "thin";
      contenedorLatex.style.scrollbarColor = "#3a3a3a #1e1e1e";

      await MarkdownRenderer.render(
        this.plugin.app,
        "$$" + sistemaCasesALatex(ecuaciones, espacios) + "$$",
        contenedorLatex,
        ctx.sourcePath,
        this.plugin
      );

      // Overlay de fade en los bordes (no intercepta el ratón).
      const fadeOverlay = panelLatex.createDiv();
      fadeOverlay.style.cssText =
        "position:absolute; inset:0; pointer-events:none;";
      const fadeColor = "rgba(30, 30, 30, 0.85)";
      const fadeIzq = fadeOverlay.createDiv();
      fadeIzq.style.cssText =
        "position:absolute; top:0; bottom:0; left:0; width:32px; opacity:0; " +
        "transition:opacity 0.15s ease; " +
        `background:linear-gradient(to right, ${fadeColor}, transparent);`;
      const fadeDer = fadeOverlay.createDiv();
      fadeDer.style.cssText =
        "position:absolute; top:0; bottom:0; right:0; width:32px; opacity:0; " +
        "transition:opacity 0.15s ease; " +
        `background:linear-gradient(to left, ${fadeColor}, transparent);`;

      const TOLERANCIA_SCROLL = 3;
      const actualizarFade = () => {
        const max = contenedorLatex.scrollWidth - contenedorLatex.clientWidth;
        const desborda = max > TOLERANCIA_SCROLL;
        contenedorLatex.style.overflowX = desborda ? "auto" : "hidden";
        const sl = contenedorLatex.scrollLeft;
        fadeIzq.style.opacity = desborda && sl > 0 ? "1" : "0";
        fadeDer.style.opacity = desborda && sl < max - 1 ? "1" : "0";
      };
      contenedorLatex.addEventListener("scroll", actualizarFade);
      contenedorLatex.addEventListener(
        "wheel",
        (e: WheelEvent) => {
          if (
            contenedorLatex.scrollWidth - contenedorLatex.clientWidth <=
            TOLERANCIA_SCROLL
          )
            return;
          e.preventDefault();
          const desplazamiento = e.deltaY + e.deltaX;
          contenedorLatex.scrollLeft += Math.max(-40, Math.min(40, desplazamiento));
        },
        { passive: false }
      );
      requestAnimationFrame(actualizarFade);
      window.addEventListener("resize", actualizarFade);
      limpieza.register(() => window.removeEventListener("resize", actualizarFade));
      const observadorLatex = new ResizeObserver(() => actualizarFade());
      observadorLatex.observe(contenedorLatex);
      limpieza.register(() => observadorLatex.disconnect());

      // ── Motor gráfico ──────────────────────────────────────────────────────
      // W se mide del tamaño real en pantalla (ver redimensionar()); 768 es solo
      // un respaldo inicial. H es la altura fija del panel.
      let W = 768; const H = 261;
      const dpr = Math.ceil(window.devicePixelRatio || 1);
      const wrapGrafica = contenedor.createDiv({ cls: "obsi-math-grafica" });
      wrapGrafica.style.cssText = `position:relative; width:100%; height:${H}px;`;

      const canvasGL = wrapGrafica.createEl("canvas");
      const canvas2D = wrapGrafica.createEl("canvas");
      const canvasCross = wrapGrafica.createEl("canvas");

      canvasGL.width = W * dpr; canvasGL.height = H * dpr;
      // cursor:none oculta el cursor del sistema SOLO sobre el área del plano (los
      // botones, hijos con su propio cursor:pointer, no se ven afectados). En su
      // lugar el motor dibuja una cruz propia sobre canvasCross (dibujarCursorCruz).
      canvasGL.style.cssText =
        "position:absolute; top:0; left:0; width:100%; height:100%; cursor:none;";
      canvas2D.width = W * dpr; canvas2D.height = H * dpr;
      canvas2D.style.cssText =
        "position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;";
      canvasCross.width = W * dpr; canvasCross.height = H * dpr;
      canvasCross.style.cssText =
        "position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;";

      const gl = canvasGL.getContext("webgl", { antialias: true });
      const ctx2d = canvas2D.getContext("2d");
      const ctxCross = canvasCross.getContext("2d");

      if (gl) {
        limpieza.register(() =>
          gl.getExtension("WEBGL_lose_context")?.loseContext()
        );
      }

      if (!gl || !ctx2d || !ctxCross) {
        wrapGrafica.createEl("p", { text: "Error: WebGL no disponible" });
        return;
      }

      // domX se recalcula en redimensionar() para celdas 1:1 con el ancho real.
      let domX: [number, number] = [-8.3453, 8.3453];
      let domY: [number, number] = [-7, 7];

      // Posición del cursor en píxeles CSS dentro del canvas (null = fuera).
      let cursorPx: number | null = null;
      let cursorPy: number | null = null;

      // ── Sistema de carril (rail), portado de obs-graph ──────────────────────
      // Curvas que el carril puede seguir: en sistemas LINEALES son las rectas
      // (F = a·x + b·y − c) y en sistemas GENERALES las curvas implícitas (su
      // F(x,y)). El carril sigue UNA a la vez, la seleccionada con su botón de
      // color. Mismo concepto que obs-graph (railX/seguirRail), pero la y del punto
      // se obtiene resolviendo F(railX, y)=0 (continuación de Newton en y) en vez de
      // un f(x) explícito, para servir por igual a rectas y a curvas implícitas.
      const curvasRail: {
        F: (x: number, y: number) => number;
        color: [number, number, number, number];
      }[] = [];
      if (esLineal) {
        for (const r of rectas)
          curvasRail.push({ F: (x, y) => r.a * x + r.b * y - r.c, color: r.color });
      } else if (general) {
        for (const c of curvas) curvasRail.push({ F: c.F, color: c.color });
      }

      // Ecuación SELECCIONADA (índice en curvasRail). Como en el obs-system
      // original: los botones de color SOLO cambian esta selección; el crosshair
      // sigue la curva seleccionada y, si el carril está activo, opera sobre ella.
      // La selección persiste con el carril encendido o apagado.
      let lineaSeleccionada = 0;
      // Modo carril ON/OFF: lo controla EXCLUSIVAMENTE el botón ⌖ (igual que
      // obs-graph). El carril sigue SIEMPRE a la ecuación seleccionada; el punto
      // vive en (railX, railY) sobre ella, con A/D se recorre en X (la cámara lo
      // sigue) y con W/S se hace zoom.
      let railOn = false;
      let railX = 0;
      let railY = NaN;

      // Topes de seguridad/encuadre (idénticos a obs-graph).
      const LIMITE_CARRIL_Y = 1e9;   // |y| finita por encima → PELIGRO (no avanzar)
      const RANGO_SEMI_MIN = 1e-4;   // zoom-in máximo (semianchura mínima en Y)
      const RANGO_SEMI_MAX = 1e9;    // zoom-out máximo (semianchura máxima en Y)
      const VEL_ZOOM_POR_SEG = 2.5;  // factor de zoom por segundo (W/S en carril)

      const sx = (x: number) => ((x - domX[0]) / (domX[1] - domX[0])) * W;
      const sy = (y: number) => H - ((y - domY[0]) / (domY[1] - domY[0])) * H;

      // y sobre la curva activa en `x`, partiendo de un valor previo `ySeed`
      // (continuación de Newton en y). Para una recta no vertical converge en 1
      // paso al valor exacto; para una curva implícita sigue UNA rama. Devuelve NaN
      // si pierde la rama (∂F/∂y≈0: línea vertical, tangente vertical) o no converge.
      const resolverYCerca = (
        F: (x: number, y: number) => number, x: number, ySeed: number
      ): number => {
        let y = ySeed;
        if (!Number.isFinite(y)) return NaN;
        const h = 1e-6;
        for (let it = 0; it < 40; it++) {
          const f = F(x, y);
          if (!Number.isFinite(f)) return NaN;
          if (Math.abs(f) < 1e-10) return y;
          const dfdy = (F(x, y + h) - F(x, y - h)) / (2 * h);
          if (!Number.isFinite(dfdy) || Math.abs(dfdy) < 1e-12) return NaN;
          const paso = f / dfdy;
          y -= paso;
          if (!Number.isFinite(y)) return NaN;
          if (Math.abs(paso) < 1e-12) break;
        }
        return Math.abs(F(x, y)) < 1e-6 ? y : NaN;
      };

      // Busca un valor inicial de y sobre la curva activa en `x`, escaneando el
      // rango vertical visible en busca de un cambio de signo de F y afinándolo.
      // Usado al activar/cambiar de carril o al re-enganchar una rama perdida.
      const buscarYInicial = (
        F: (x: number, y: number) => number, x: number
      ): number => {
        const N = 200;
        const y0 = domY[0], y1 = domY[1];
        let prevY = y0, prevF = F(x, y0);
        for (let i = 1; i <= N; i++) {
          const yy = y0 + ((y1 - y0) * i) / N;
          const ff = F(x, yy);
          if (Number.isFinite(prevF) && Number.isFinite(ff) && prevF * ff <= 0 &&
              (prevF !== 0 || ff !== 0)) {
            let a = prevY, fa = prevF, b = yy;
            for (let k = 0; k < 60; k++) {
              const m = (a + b) / 2;
              const fm = F(x, m);
              if (!Number.isFinite(fm)) break;
              if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
            }
            const ym = (a + b) / 2;
            const refinada = resolverYCerca(F, x, ym);
            return Number.isFinite(refinada) ? refinada : ym;
          }
          prevY = yy; prevF = ff;
        }
        return NaN;
      };

      // Recoloca la vista para centrar el carril (igual que obs-graph). X SIEMPRE
      // sigue a railX; Y se recentra solo si railY es finita. `factor`≠1 aplica zoom
      // con clamp a un rango sano.
      const seguirRail = (factor = 1) => {
        if (!railOn) return;
        const semiYAnt = (domY[1] - domY[0]) / 2;
        const semiYNueva = Math.max(RANGO_SEMI_MIN, Math.min(RANGO_SEMI_MAX, semiYAnt * factor));
        const f = semiYNueva / semiYAnt;        // factor efectivo tras el clamp
        const semiX = ((domX[1] - domX[0]) / 2) * f;
        domX = [railX - semiX, railX + semiX];  // X siempre sigue al carril
        if (Number.isFinite(railY)) {
          domY = [railY - semiYNueva, railY + semiYNueva];
        } else if (f !== 1) {
          const cyV = (domY[0] + domY[1]) / 2;   // indef + zoom: escala en su centro
          domY = [cyV - semiYNueva, cyV + semiYNueva];
        }
      };

      // Restaura la vista por defecto (igual que obs-graph / al abrir la gráfica).
      const restaurarVistaInicial = () => {
        domY = [-7, 7];
        const semiX = ((domY[1] - domY[0]) / 2) * (W / H);
        domX = [-semiX, semiX];
      };

      // Intenta mover el carril a railX+delta sobre la curva activa. Recalcula railY
      // por continuación (y re-engancha una rama si se perdió). Solo BLOQUEA el caso
      // "peligro" (|y|>tope); un valor indef (NaN) SÍ se permite —se explora, sin
      // dibujar punto—, igual que obs-graph.
      const avanzarRail = (delta: number): boolean => {
        if (!railOn) return false;
        const F = curvasRail[lineaSeleccionada].F;
        const nx = railX + delta;
        let ny = resolverYCerca(F, nx, railY);
        if (!Number.isFinite(ny)) ny = buscarYInicial(F, nx); // re-enganche de rama
        if (Number.isFinite(ny) && Math.abs(ny) > LIMITE_CARRIL_Y) return false;
        railX = nx;
        railY = ny;
        return true;
      };

      const generarTicks = (min: number, max: number, maxTicks = 10): number[] => {
        const rango = max - min;
        const paso = Math.pow(10, Math.floor(Math.log10(rango / maxTicks)));
        const pasos = [1, 2, 5, 10].map((m) => m * paso);
        const pasoFinal =
          pasos.find((p) => rango / p <= maxTicks) ?? pasos[pasos.length - 1];
        const ticks: number[] = [];
        const inicio = Math.ceil(min / pasoFinal) * pasoFinal;
        for (let t = inicio; t <= max + 1e-9; t += pasoFinal)
          ticks.push(parseFloat(t.toPrecision(10)));
        return ticks;
      };

      const formatearNumero = (n: number): string => {
        if (Math.abs(n) < 1e-9) return "0";
        if (Math.abs(n) >= 1000 || (Math.abs(n) < 0.01 && n !== 0))
          return n.toExponential(1);
        return parseFloat(n.toPrecision(4)).toString();
      };

      // Punto de intersección (solución única). Se mapea la solución a los ejes
      // del plano. Si el sistema no tiene solución única, queda null.
      const puntoSolucion: { x: number; y: number } | null =
        resultado !== null && typeof resultado !== "string" &&
        xVar !== undefined && yVar !== undefined &&
        Number.isFinite(resultado[xVar]) && Number.isFinite(resultado[yVar])
          ? { x: resultado[xVar], y: resultado[yVar] }
          : null;

      // Marcador circular reutilizable (anillo tenue + disco). Radio en píxeles:
      // tamaño visual constante con el zoom. Mismo estilo que obs-graph.
      const dibujarPuntoMarcador = (
        ctx: CanvasRenderingContext2D,
        px: number,
        py: number,
        color: string
      ) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      };

      const COLOR_PUNTO_SOLUCION = "rgba(168, 85, 247, 1.0)"; // morado #A855F7

      // Recorta la recta a·x + b·y = c al rectángulo visible [domX]×[domY] y
      // devuelve sus dos extremos en coordenadas de mundo, o null si no cruza la
      // vista. Maneja por igual rectas oblicuas, verticales y horizontales.
      const recortarRecta = (
        a: number,
        b: number,
        c: number
      ): [[number, number], [number, number]] | null => {
        const EPS = 1e-12;
        const dentroX = (x: number) =>
          x >= domX[0] - 1e-9 && x <= domX[1] + 1e-9;
        const dentroY = (y: number) =>
          y >= domY[0] - 1e-9 && y <= domY[1] + 1e-9;
        const candidatos: [number, number][] = [];
        const agregar = (x: number, y: number) => {
          if (!dentroX(x) || !dentroY(y)) return;
          if (candidatos.some((p) => Math.abs(p[0] - x) < 1e-9 && Math.abs(p[1] - y) < 1e-9))
            return;
          candidatos.push([x, y]);
        };
        if (Math.abs(b) > EPS) {
          // Cruces con los bordes verticales (x = domX[0] / domX[1]).
          agregar(domX[0], (c - a * domX[0]) / b);
          agregar(domX[1], (c - a * domX[1]) / b);
        }
        if (Math.abs(a) > EPS) {
          // Cruces con los bordes horizontales (y = domY[0] / domY[1]).
          agregar((c - b * domY[0]) / a, domY[0]);
          agregar((c - b * domY[1]) / a, domY[1]);
        }
        if (candidatos.length < 2) return null;
        return [candidatos[0], candidatos[1]];
      };

      const dibujarOverlay = () => {
        ctx2d.clearRect(0, 0, W, H);
        const ticksX = generarTicks(domX[0], domX[1]);
        const ticksY = generarTicks(domY[0], domY[1]);

        ctx2d.strokeStyle = "rgba(130,130,150,0.12)";
        ctx2d.lineWidth = 0.5;
        for (const x of ticksX) {
          ctx2d.beginPath(); ctx2d.moveTo(sx(x), 0); ctx2d.lineTo(sx(x), H); ctx2d.stroke();
        }
        for (const y of ticksY) {
          ctx2d.beginPath(); ctx2d.moveTo(0, sy(y)); ctx2d.lineTo(W, sy(y)); ctx2d.stroke();
        }

        ctx2d.strokeStyle = "rgba(160,160,170,0.7)";
        ctx2d.lineWidth = 1;
        if (domY[0] <= 0 && domY[1] >= 0) {
          ctx2d.beginPath(); ctx2d.moveTo(0, sy(0)); ctx2d.lineTo(W, sy(0)); ctx2d.stroke();
        }
        if (domX[0] <= 0 && domX[1] >= 0) {
          ctx2d.beginPath(); ctx2d.moveTo(sx(0), 0); ctx2d.lineTo(sx(0), H); ctx2d.stroke();
        }

        const ceroY = Math.max(4, Math.min(H - 4, sy(0)));
        const ceroX = Math.max(4, Math.min(W - 4, sx(0)));
        ctx2d.font = "11px monospace";

        ctx2d.textAlign = "center"; ctx2d.textBaseline = "top";
        for (const x of ticksX) {
          if (Math.abs(x) < 1e-9) continue;
          const px = sx(x);
          if (px < 10 || px > W - 10) continue;
          ctx2d.strokeStyle = "rgba(160,160,170,0.5)"; ctx2d.lineWidth = 0.75;
          ctx2d.beginPath(); ctx2d.moveTo(px, ceroY - 3); ctx2d.lineTo(px, ceroY + 3); ctx2d.stroke();
          ctx2d.fillStyle = "rgba(160,160,170,0.85)";
          ctx2d.fillText(formatearNumero(x), px, ceroY + 5);
        }

        ctx2d.textAlign = "right"; ctx2d.textBaseline = "middle";
        for (const y of ticksY) {
          if (Math.abs(y) < 1e-9) continue;
          const py = sy(y);
          if (py < 10 || py > H - 10) continue;
          ctx2d.strokeStyle = "rgba(160,160,170,0.5)"; ctx2d.lineWidth = 0.75;
          ctx2d.beginPath(); ctx2d.moveTo(ceroX - 3, py); ctx2d.lineTo(ceroX + 3, py); ctx2d.stroke();
          ctx2d.fillStyle = "rgba(160,160,170,0.85)";
          ctx2d.fillText(formatearNumero(y), ceroX - 6, py);
        }

        // Marcador de la solución (intersección) encima de ejes/grid.
        if (puntoSolucion) {
          const px = sx(puntoSolucion.x);
          const py = sy(puntoSolucion.y);
          if (px >= 0 && px <= W && py >= 0 && py <= H)
            dibujarPuntoMarcador(ctx2d, px, py, COLOR_PUNTO_SOLUCION);
        }
        // Marcadores de las intersecciones numéricas (caso general/no lineal).
        for (const p of intersecciones) {
          const px = sx(p.x);
          const py = sy(p.y);
          if (px >= 0 && px <= W && py >= 0 && py <= H)
            dibujarPuntoMarcador(ctx2d, px, py, COLOR_PUNTO_SOLUCION);
        }

        dibujarCrosshair(cursorPx, cursorPy);
      };

      // Crosshair informativo que sigue al cursor: líneas punteadas + etiqueta de
      // coordenadas (x, y) del plano. Al acercarse al punto solución muestra su
      // etiqueta destacada en naranja. Vive en su propio canvas (canvasCross).
      const colorTuplaCss = (col: [number, number, number, number]): string =>
        `rgba(${Math.round(col[0] * 255)}, ${Math.round(col[1] * 255)}, ` +
        `${Math.round(col[2] * 255)}, 1)`;

      // Cursor propio: una cruz (+) de 14px centrada exactamente en (px, py) del
      // ratón, en canvasCross (capa superior) — sustituye al cursor del sistema
      // oculto con cursor:none. Independiente del crosshair: se muestra siempre
      // que el puntero esté sobre el plano, sea o no graficable el sistema.
      const dibujarCursorCruz = (px: number, py: number) => {
        const R = 7; // semibrazo → cruz de 14px
        ctxCross.save();
        ctxCross.setLineDash([]);
        ctxCross.strokeStyle = "rgba(235, 238, 245, 0.95)";
        ctxCross.lineWidth = 1.25;
        ctxCross.beginPath();
        ctxCross.moveTo(px - R, py); ctxCross.lineTo(px + R, py);
        ctxCross.moveTo(px, py - R); ctxCross.lineTo(px, py + R);
        ctxCross.stroke();
        ctxCross.restore();
      };

      const dibujarCrosshair = (px: number | null, py: number | null) => {
        ctxCross.clearRect(0, 0, W, H);

        // ── Carril ACTIVO (botón ⌖): punto ANCLADO en (railX, railY) sobre la
        // ecuación SELECCIONADA; se IGNORA el cursor (como obs-graph). Líneas
        // punteadas, marcador del color de la curva + anillo naranja, etiquetas x/y.
        if (railOn) {
          const xPix = sx(railX);
          const yFin = Number.isFinite(railY);
          const yPix = yFin ? sy(railY) : null;
          const yVisible = yPix !== null && yPix >= 0 && yPix <= H;

          ctxCross.save();
          ctxCross.setLineDash([4, 6]);
          ctxCross.strokeStyle = "rgba(100, 150, 255, 0.4)";
          ctxCross.lineWidth = 1;
          ctxCross.beginPath(); ctxCross.moveTo(xPix, 0); ctxCross.lineTo(xPix, H); ctxCross.stroke();
          if (yVisible) {
            ctxCross.beginPath(); ctxCross.moveTo(0, yPix!); ctxCross.lineTo(W, yPix!); ctxCross.stroke();
          }
          ctxCross.setLineDash([]);

          if (yVisible) {
            dibujarPuntoMarcador(ctxCross, xPix, yPix!, colorTuplaCss(curvasRail[lineaSeleccionada].color));
            ctxCross.save();
            ctxCross.strokeStyle = "rgba(255, 160, 40, 0.9)";
            ctxCross.lineWidth = 1.5;
            ctxCross.beginPath(); ctxCross.arc(xPix, yPix!, 7, 0, Math.PI * 2); ctxCross.stroke();
            ctxCross.restore();
          }

          const aLaDerecha = xPix < W * 0.75;
          ctxCross.textAlign = aLaDerecha ? "left" : "right";
          ctxCross.textBaseline = "top";
          ctxCross.font = "11px monospace";
          const tx = xPix + (aLaDerecha ? 5 : -5);
          ctxCross.fillStyle = "rgba(200, 210, 255, 0.9)";
          ctxCross.fillText(`x = ${formatearNumero(railX)}`, tx, 4);
          ctxCross.fillText(yFin ? `y = ${formatearNumero(railY)}` : "y = indef.", tx, 18);
          ctxCross.restore();

          // El cursor propio se sigue mostrando si el puntero está sobre el plano.
          if (px !== null && py !== null) dibujarCursorCruz(px, py);
          return;
        }

        // ── Carril APAGADO: comportamiento original del obs-system. ───────────────
        // Puntero fuera del plano: nada (ni crosshair ni cursor propio).
        if (px === null || py === null) return;
        // Sistema no graficable (≠2 variables o no interpretable): solo el cursor.
        if (!graficable) { dibujarCursorCruz(px, py); return; }

        const cursorX = domX[0] + (px / W) * (domX[1] - domX[0]);
        const cursorY = domY[1] - (py / H) * (domY[1] - domY[0]);

        if (esLineal) {
          // Caso LINEAL (original): el crosshair se ENGANCHA a la recta
          // SELECCIONADA. Recta normal: x = x del cursor, y = recta(x). Recta
          // vertical (x = k): se fija x = k y la y sigue al cursor.
          const r = rectas[lineaSeleccionada];
          let wx = cursorX, wy = cursorY;
          let colorPunto = "rgba(80, 160, 255, 1.0)";
          if (r) {
            colorPunto = colorTuplaCss(r.color);
            if (Math.abs(r.b) >= 1e-12) { wx = cursorX; wy = (r.c - r.a * wx) / r.b; }
            else { wx = r.c / r.a; wy = cursorY; }
          }
          const ppx = sx(wx);
          const ppy = sy(wy);
          const yVisible = ppy >= 0 && ppy <= H;

          ctxCross.save();
          ctxCross.setLineDash([4, 6]);
          ctxCross.strokeStyle = "rgba(100, 150, 255, 0.4)";
          ctxCross.lineWidth = 1;
          ctxCross.beginPath(); ctxCross.moveTo(ppx, 0); ctxCross.lineTo(ppx, H); ctxCross.stroke();
          if (yVisible) {
            ctxCross.beginPath(); ctxCross.moveTo(0, ppy); ctxCross.lineTo(W, ppy); ctxCross.stroke();
          }
          ctxCross.setLineDash([]);

          // Marcador sobre la recta seguida (con su color), estilo obs-graph.
          if (yVisible) dibujarPuntoMarcador(ctxCross, ppx, ppy, colorPunto);

          // Realce del punto solución cuando el crosshair pasa por él.
          if (puntoSolucion) {
            const spx = sx(puntoSolucion.x);
            const spy = sy(puntoSolucion.y);
            if (Math.hypot(spx - ppx, spy - ppy) <= 16 && spx >= 0 && spx <= W && spy >= 0 && spy <= H) {
              ctxCross.save();
              ctxCross.strokeStyle = "rgba(168, 85, 247, 0.9)"; // morado #A855F7
              ctxCross.lineWidth = 1.5;
              ctxCross.beginPath(); ctxCross.arc(spx, spy, 7, 0, Math.PI * 2); ctxCross.stroke();
              ctxCross.restore();
            }
          }

          // Etiqueta: coordenadas del PUNTO sobre la recta (coinciden con las líneas).
          const aLaDerecha = ppx < W * 0.75;
          ctxCross.textAlign = aLaDerecha ? "left" : "right";
          ctxCross.textBaseline = "top";
          ctxCross.font = "11px monospace";
          const tx = ppx + (aLaDerecha ? 5 : -5);
          ctxCross.fillStyle = "rgba(200, 210, 255, 0.9)";
          ctxCross.fillText(`x = ${formatearNumero(wx)}`, tx, 4);
          ctxCross.fillText(`y = ${formatearNumero(wy)}`, tx, 18);
          ctxCross.restore();
        } else {
          // Caso GENERAL (curvas implícitas): crosshair LIBRE en el cursor (una
          // implícita tiene varias ramas / varios y por cada x).
          ctxCross.save();
          ctxCross.setLineDash([4, 6]);
          ctxCross.strokeStyle = "rgba(100, 150, 255, 0.4)";
          ctxCross.lineWidth = 1;
          ctxCross.beginPath(); ctxCross.moveTo(px, 0); ctxCross.lineTo(px, H); ctxCross.stroke();
          ctxCross.beginPath(); ctxCross.moveTo(0, py); ctxCross.lineTo(W, py); ctxCross.stroke();
          ctxCross.setLineDash([]);
          const aLaDerecha = px < W * 0.75;
          ctxCross.textAlign = aLaDerecha ? "left" : "right";
          ctxCross.textBaseline = "top";
          ctxCross.font = "11px monospace";
          const tx = px + (aLaDerecha ? 5 : -5);
          ctxCross.fillStyle = "rgba(200, 210, 255, 0.9)";
          ctxCross.fillText(`x = ${formatearNumero(cursorX)}`, tx, 4);
          ctxCross.fillText(`y = ${formatearNumero(cursorY)}`, tx, 18);
          ctxCross.restore();
        }

        // Cursor propio por ENCIMA del crosshair (último en dibujarse).
        dibujarCursorCruz(px, py);
      };

      const programa = crearPrograma(gl);
      const aPos = gl.getAttribLocation(programa, "a_pos");
      const uColor = gl.getUniformLocation(programa, "u_color");
      const buffer = gl.createBuffer()!;

      // `interactivo`: durante un gesto (zoom/pan/teclado) se usa una pasada más
      // ligera (refinado menos profundo); al asentarse, la pasada final va a fondo.
      // Mismo patrón de dos niveles de calidad que obs-graph.
      const dibujarContenidoGL = (interactivo = false) => {
        this.obsSistemaUpdateCount++;
        console.log("Actualizaciones motor gráfico (obs-system): " + this.obsSistemaUpdateCount);
        gl.viewport(0, 0, W * dpr, H * dpr);
        gl.clearColor(0.118, 0.118, 0.118, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (rectas.length === 0 && curvas.length === 0) return;
        gl.useProgram(programa);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        const cx = (x: number) => ((x - domX[0]) / (domX[1] - domX[0])) * 2 - 1;
        const cy = (y: number) => ((y - domY[0]) / (domY[1] - domY[0])) * 2 - 1;
        // Grosor constante (no dependiente del zoom), igual que obs-graph: el
        // trazo se mantiene uniforme al hacer zoom/pan en vez de adelgazar/engordar.
        const GROSOR_CLIP = 0.004;

        // Caso LINEAL: rectas exactas recortadas a la vista (ruta original).
        for (const recta of rectas) {
          const segmento = recortarRecta(recta.a, recta.b, recta.c);
          if (!segmento) continue;
          const [p0, p1] = segmento;
          const puntos = [cx(p0[0]), cy(p0[1]), cx(p1[0]), cy(p1[1])];
          const quads = construirQuadStrip(puntos, GROSOR_CLIP);
          if (quads.length === 0) continue;
          gl.uniform4f(uColor, recta.color[0], recta.color[1], recta.color[2], recta.color[3]);
          gl.bufferData(gl.ARRAY_BUFFER, quads, gl.DYNAMIC_DRAW);
          gl.drawArrays(gl.TRIANGLES, 0, quads.length / 2);
        }

        // Caso GENERAL: curvas implícitas por marching squares sobre la vista
        // actual. Cada segmento del contorno se engruesa a un quad y todos los de
        // una misma curva se agrupan en un único draw call con su color.
        if (curvas.length > 0) {
          const cols = Math.min(220, Math.max(60, Math.round(W / 6)));
          const rows = Math.min(140, Math.max(40, Math.round(H / 6)));
          // Tolerancia de suavizado en MUNDO ≈ ⅓ de píxel: cada cuerda del contorno
          // se subdivide proyectando sobre F=0 hasta separarse menos que esto de la
          // curva real. Al derivarse del tamaño de píxel (mundo/píxel), la suavidad
          // es la misma a cualquier zoom (estable al acercar y al alejar). En un
          // gesto interactivo se afloja un poco y se recorta la profundidad (rápido);
          // la pasada final aprieta a ⅓px y va más honda (máxima calidad).
          const mundoPorPixel = (domX[1] - domX[0]) / W;
          const tolMundo = mundoPorPixel * (interactivo ? 0.6 : 0.34);
          const profMax = interactivo ? 4 : 7;
          // Subdivisión adaptativa de celda (quadtree): resuelve curvas muy
          // oscilatorias que la rejilla base aliasa. Más honda en la pasada final
          // (calidad) que durante un gesto (fluidez). Una celda base ~6px subdividida
          // 3 niveles llega a ~0.75px (sub-píxel), el límite útil (como obs-graph).
          const maxNivelCelda = interactivo ? 2 : 4;
          for (const curva of curvas) {
            const verts: number[] = [];
            if (curva.ramas) {
              // DESPEJABLE en y (1 rama lineal o 2 ramas ±√): sampler 1D de obs-graph
              // (módulo compartido) por cada rama. Calidad obs-graph y, clave aquí,
              // CORTE LIMPIO EN LOS POLOS (p.ej. `tan x + y² = 2`), que la rejilla 2D
              // pierde cerca de las asíntotas. Cada rama, una tira conectada.
              for (const rama of curva.ramas) {
                const { polilineas } = muestrearFuncion({
                  evalX: rama,
                  domX: [domX[0], domX[1]], domY: [domY[0], domY[1]],
                  H, interactivo,
                });
                for (const poli of polilineas) {
                  const clip: number[] = [];
                  for (let k = 0; k < poli.length; k += 2)
                    clip.push(cx(poli[k]), cy(poli[k + 1]));
                  const quads = construirQuadStrip(clip, GROSOR_CLIP);
                  for (let k = 0; k < quads.length; k++) verts.push(quads[k]);
                }
              }
            } else {
              // IMPLÍCITA F(x,y)=0: marching squares adaptativo.
              const segmentos = contorno(
                curva.F, domX[0], domX[1], domY[0], domY[1],
                cols, rows, tolMundo, profMax, maxNivelCelda
              );
              for (const s of segmentos) {
                const quad = construirQuadStrip(
                  [cx(s[0]), cy(s[1]), cx(s[2]), cy(s[3])], GROSOR_CLIP
                );
                for (let k = 0; k < quad.length; k++) verts.push(quad[k]);
              }
            }
            if (verts.length === 0) continue;
            const arr = new Float32Array(verts);
            gl.uniform4f(uColor, curva.color[0], curva.color[1], curva.color[2], curva.color[3]);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, arr.length / 2);
          }
        }
      };

      // Ajusta la resolución interna de los canvas al tamaño real en pantalla y
      // mantiene celdas 1:1 (misma escala en X y en Y). Igual que obs-graph.
      let dibujado = false;
      const redimensionar = () => {
        const ancho = Math.max(1, Math.round(wrapGrafica.clientWidth || W));
        if (dibujado && ancho === W) return;
        W = ancho;
        dibujado = true;
        const centroX = (domX[0] + domX[1]) / 2;
        const semirangoX = ((domY[1] - domY[0]) / 2) * (W / H);
        domX = [centroX - semirangoX, centroX + semirangoX];
        canvasGL.width = W * dpr; canvasGL.height = H * dpr;
        canvas2D.width = W * dpr; canvas2D.height = H * dpr;
        canvasCross.width = W * dpr; canvasCross.height = H * dpr;
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctxCross.setTransform(dpr, 0, 0, dpr, 0, 0);
        dibujarOverlay();
        dibujarContenidoGL();
      };
      redimensionar();
      const observadorTamano = new ResizeObserver(() => redimensionar());
      observadorTamano.observe(wrapGrafica);
      limpieza.register(() => observadorTamano.disconnect());

      // Sistema no graficable (≠2 variables o ecuaciones no lineales): plano
      // interactivo pero vacío, oscurecido, con etiqueta formal. Igual que las
      // funciones degeneradas de obs-graph.
      if (!graficable) {
        const velo = wrapGrafica.createDiv();
        velo.style.cssText =
          "position:absolute; inset:0; background:rgba(18,18,18,0.55); pointer-events:none;";
        const msg = wrapGrafica.createDiv();
        msg.style.cssText =
          "position:absolute; inset:0; display:flex; flex-direction:column; " +
          "align-items:center; justify-content:center; text-align:center; " +
          "gap:8px; padding:24px; box-sizing:border-box; pointer-events:none;";
        const titulo = msg.createDiv({ text: "Sin representación en el plano" });
        titulo.style.cssText =
          "font-size:18px; font-weight:600; color:rgba(200,210,255,0.95);";
        const numVarsMostrar = todasVarsGen.length || todasVars.length;
        const detalle = msg.createDiv({
          text:
            numVarsMostrar === 2
              ? "Alguna ecuación no se pudo interpretar."
              : `El plano solo representa sistemas de 2 variables (este tiene ${numVarsMostrar}). Consulta la solución en ⓘ.`,
        });
        detalle.style.cssText =
          "font-size:12px; line-height:1.4; max-width:320px; color:rgba(190,195,210,0.85);";
      }

      // ── Zoom / Pan ──────────────────────────────────────────────────────────
      let isDragging = false;
      let lastPointer = { x: 0, y: 0 };
      let rafPendiente = false;

      const programarRedibujo = () => {
        if (rafPendiente) return;
        rafPendiente = true;
        requestAnimationFrame(() => {
          rafPendiente = false;
          dibujarOverlay();
          dibujarContenidoGL(true); // gesto en curso → pasada ligera
        });
      };

      // Tras un gesto de zoom/pan, una pasada final tranquila (las rectas ya son
      // exactas, pero mantiene el patrón y refresca el overlay con calma).
      let timerFinal: number | null = null;
      limpieza.register(() => { if (timerFinal !== null) clearTimeout(timerFinal); });
      const programarFinal = () => {
        if (timerFinal !== null) clearTimeout(timerFinal);
        timerFinal = window.setTimeout(() => {
          timerFinal = null;
          dibujarOverlay();
          dibujarContenidoGL();
        }, 150);
      };

      canvasGL.addEventListener("pointerdown", (e) => {
        isDragging = true;
        lastPointer = { x: e.offsetX, y: e.offsetY };
        cursorPx = null; cursorPy = null;
        dibujarCrosshair(null, null);
        canvasGL.setPointerCapture(e.pointerId);
      });
      canvasGL.addEventListener("pointermove", (e) => {
        if (isDragging) return;
        cursorPx = e.offsetX; cursorPy = e.offsetY;
        dibujarCrosshair(e.offsetX, e.offsetY);
      });
      canvasGL.addEventListener("pointerleave", () => {
        cursorPx = null; cursorPy = null;
        dibujarCrosshair(null, null);
      });
      canvasGL.addEventListener("pointermove", (e) => {
        if (!isDragging) return;
        const dx = e.offsetX - lastPointer.x;
        const dy = e.offsetY - lastPointer.y;
        lastPointer = { x: e.offsetX, y: e.offsetY };
        const rx = (domX[1] - domX[0]) / W;
        const ry = (domY[1] - domY[0]) / H;
        if (railOn) {
          // Carril activo: arrastrar recorre la curva en X (la cámara sigue al
          // punto); el arrastre vertical se ignora (el punto vive en la curva).
          avanzarRail(-dx * rx);
          seguirRail();
        } else {
          domX = [domX[0] - dx * rx, domX[1] - dx * rx];
          domY = [domY[0] + dy * ry, domY[1] + dy * ry];
        }
        programarRedibujo();
      });
      canvasGL.addEventListener("pointerup", (e) => {
        isDragging = false;
        canvasGL.releasePointerCapture(e.pointerId);
        programarFinal();
      });
      canvasGL.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          const factor = e.deltaY > 0 ? 1.05 : 0.95;
          if (railOn) {
            seguirRail(factor);                  // zoom centrado en el punto del carril
          } else {
            const mx = domX[0] + (e.offsetX / W) * (domX[1] - domX[0]);
            const my = domY[1] - (e.offsetY / H) * (domY[1] - domY[0]);
            domX = [mx + (domX[0] - mx) * factor, mx + (domX[1] - mx) * factor];
            domY = [my + (domY[0] - my) * factor, my + (domY[1] - my) * factor];
          }
          programarRedibujo();
          programarFinal();
        },
        { passive: false }
      );

      // ── Navegación con teclado (WASD / flechas) ──────────────────────────────
      // El canvas se hace enfocable; mientras una tecla esté pulsada, un bucle de
      // requestAnimationFrame desplaza la vista de forma continua. Mismo esquema
      // que obs-graph (sin modo carril, que es propio de una única curva).
      canvasGL.tabIndex = 0;
      canvasGL.style.outline = "none";
      const VEL_PAN_PX = 175;
      const MAPA_TECLAS: Record<string, string> = {
        w: "w", a: "a", s: "s", d: "d",
        arrowup: "w", arrowleft: "a", arrowdown: "s", arrowright: "d",
      };
      const teclasPan = new Set<string>();
      let rafTeclado: number | null = null;
      let ultimoTeclado = 0;

      const pasoTeclado = (t: number) => {
        if (teclasPan.size === 0) {
          rafTeclado = null;
          ultimoTeclado = 0;
          programarFinal();
          return;
        }
        const dt = ultimoTeclado ? Math.min(0.05, (t - ultimoTeclado) / 1000) : 0;
        ultimoTeclado = t;
        if (railOn) {
          // CARRIL activo: A/D recorren la curva; W/S hacen zoom CONTINUO centrado
          // en el punto (la cámara lo sigue). Igual que obs-graph.
          let dirX = 0;
          if (teclasPan.has("a")) dirX -= 1;       // A → recorrer a la izquierda
          if (teclasPan.has("d")) dirX += 1;       // D → recorrer a la derecha
          let dirZoom = 0;
          if (teclasPan.has("w")) dirZoom -= 1;    // W → acercar (reduce el rango)
          if (teclasPan.has("s")) dirZoom += 1;    // S → alejar (aumenta el rango)
          if (dt > 0 && (dirX !== 0 || dirZoom !== 0)) {
            let cambiado = false;
            if (dirX !== 0) {
              const delta = dirX * VEL_PAN_PX * dt * ((domX[1] - domX[0]) / W);
              if (avanzarRail(delta)) cambiado = true;
            }
            const factor = dirZoom !== 0 ? Math.pow(VEL_ZOOM_POR_SEG, dirZoom * dt) : 1;
            if (dirZoom !== 0) cambiado = true;
            if (cambiado) {
              seguirRail(factor);                  // recentra en el punto y aplica zoom
              dibujarOverlay();
              dibujarContenidoGL(true); // gesto de teclado en curso → pasada ligera
            }
          }
        } else {
          // Navegación libre con WASD (sin carril).
          let mx = 0, my = 0;
          if (teclasPan.has("a")) mx -= 1;
          if (teclasPan.has("d")) mx += 1;
          if (teclasPan.has("w")) my += 1;
          if (teclasPan.has("s")) my -= 1;
          if ((mx !== 0 || my !== 0) && dt > 0) {
            const norm = Math.hypot(mx, my);
            const desX = (mx / norm) * VEL_PAN_PX * dt * ((domX[1] - domX[0]) / W);
            const desY = (my / norm) * VEL_PAN_PX * dt * ((domY[1] - domY[0]) / H);
            domX = [domX[0] + desX, domX[1] + desX];
            domY = [domY[0] + desY, domY[1] + desY];
            dibujarOverlay();
            dibujarContenidoGL(true); // pan de teclado en curso → pasada ligera
          }
        }
        rafTeclado = requestAnimationFrame(pasoTeclado);
      };

      canvasGL.addEventListener("keydown", (e) => {
        const dir = MAPA_TECLAS[e.key.toLowerCase()];
        if (!dir) return;
        e.preventDefault();
        e.stopPropagation();
        teclasPan.add(dir);
        if (rafTeclado === null) rafTeclado = requestAnimationFrame(pasoTeclado);
      });
      canvasGL.addEventListener("keyup", (e) => {
        const dir = MAPA_TECLAS[e.key.toLowerCase()];
        if (dir) { e.preventDefault(); teclasPan.delete(dir); }
      });
      canvasGL.addEventListener("focus", () => {
        canvasGL.style.outline = "1px solid rgba(100,150,255,0.35)";
      });
      canvasGL.addEventListener("blur", () => {
        canvasGL.style.outline = "none";
        teclasPan.clear();
      });
      limpieza.register(() => { if (rafTeclado !== null) cancelAnimationFrame(rafTeclado); });

      // ── Botón de solución (ⓘ) ────────────────────────────────────────────────
      // El panel inferior .obsi-math-info está oculto por CSS, así que la solución
      // se ofrece en un botón ⓘ sobre la gráfica (mismo patrón que el resumen de
      // obs-graph). Al pulsarlo muestra/oculta un popover con la solución.
      const btnSolucion = wrapGrafica.createDiv({ text: "ⓘ" });
      btnSolucion.setAttribute("title", "Solución del sistema");
      btnSolucion.style.cssText =
        "position:absolute; bottom:8px; right:8px; width:22px; height:22px; " +
        "display:flex; align-items:center; justify-content:center; font-size:14px; " +
        "line-height:1; color:rgba(255,200,130,0.95); background:rgba(30,30,30,0.85); " +
        "border:1px solid rgba(255,160,40,0.5); border-radius:50%; cursor:pointer; " +
        "user-select:none; z-index:5;";

      const popSolucion = wrapGrafica.createDiv();
      popSolucion.style.cssText =
        "position:absolute; bottom:36px; right:8px; display:none; max-width:260px; " +
        "padding:8px 10px; box-sizing:border-box; background:rgba(20,20,20,0.95); " +
        "border:1px solid rgba(255,255,255,0.12); border-radius:6px; font-size:11px; " +
        "line-height:1.5; color:rgba(230,230,235,0.92); z-index:5; " +
        "box-shadow:0 4px 12px rgba(0,0,0,0.4);";

      if (resultado === null) {
        // Sistema general (alguna ecuación no lineal): intersecciones numéricas.
        if (intersecciones.length > 0) {
          popSolucion.createEl("div", {
            text: intersecciones.length === 1 ? "Intersección:" : "Intersecciones:",
            attr: { style: "font-weight:600; margin-bottom:4px;" },
          });
          for (const p of intersecciones) {
            popSolucion.createEl("div", {
              text: `(${formatearNumero(p.x)}, ${formatearNumero(p.y)})`,
            });
          }
        } else {
          popSolucion.createEl("div", {
            text: general
              ? "Sin intersección detectada en el rango analizado."
              : "No se pudo interpretar el sistema.",
          });
        }
      } else if (typeof resultado === "string") {
        popSolucion.createEl("div", { text: resultado });
      } else {
        popSolucion.createEl("div", {
          text: "Solución única:",
          attr: { style: "font-weight:600; margin-bottom:4px;" },
        });
        for (const v of Object.keys(resultado).sort()) {
          popSolucion.createEl("div", { text: `${v} = ${formatearNumero(resultado[v])}` });
        }
      }

      btnSolucion.addEventListener("click", (e) => {
        e.stopPropagation();
        popSolucion.style.display =
          popSolucion.style.display === "none" ? "block" : "none";
      });

      // ── Controles del carril (abajo-izquierda) ───────────────────────────────
      // Botón ⌖ (igual que obs-graph): ÚNICO control que activa/desactiva el modo
      // carril. Le siguen los botones de color, uno por ecuación, que SOLO cambian
      // la ecuación seleccionada (la selección persiste con el carril on u off, y
      // sirve también al crosshair-sigue-recta cuando el carril está apagado). El
      // carril sigue SIEMPRE a la seleccionada; cambiarla con el carril activo
      // reengancha al instante SIN reiniciar el modo.
      if (curvasRail.length >= 1) {
        const controles = wrapGrafica.createDiv();
        controles.style.cssText =
          "position:absolute; bottom:8px; left:8px; display:flex; align-items:center; " +
          "gap:6px; z-index:5;";

        // Botón ⌖: toggle del modo carril (no toca la selección).
        const btnRail = controles.createDiv({ text: "⌖" });
        btnRail.setAttribute(
          "title", "Activar/desactivar el carril sobre la ecuación seleccionada"
        );
        const estiloBtnRail = (activo: boolean) => {
          btnRail.style.cssText =
            "width:22px; height:22px; display:flex; align-items:center; " +
            "justify-content:center; font-size:14px; line-height:1; border-radius:50%; " +
            "cursor:pointer; user-select:none; box-sizing:border-box; " +
            (activo
              ? "color:rgba(20,20,20,0.95); background:rgba(255,170,60,0.95); " +
                "border:1px solid rgba(255,170,60,0.95);"
              : "color:rgba(255,200,130,0.95); background:rgba(30,30,30,0.85); " +
                "border:1px solid rgba(255,160,40,0.5);");
        };
        estiloBtnRail(false);

        btnRail.addEventListener("click", (e) => {
          e.stopPropagation();
          if (railOn) {
            railOn = false;                        // apagar: solo quita el carril
            restaurarVistaInicial();               // (no cambia la selección)
          } else {
            railOn = true;                         // activar: sigue a la seleccionada
            railX = 0;                             // empieza en x=0 (como obs-graph)
            // Intenta sembrar en la vista actual (conserva el zoom si la curva pasa
            // por x=0 en pantalla); si no, restaura la vista por defecto y reintenta.
            railY = buscarYInicial(curvasRail[lineaSeleccionada].F, railX);
            if (!Number.isFinite(railY)) {
              restaurarVistaInicial();
              railY = buscarYInicial(curvasRail[lineaSeleccionada].F, railX);
            }
            if (Number.isFinite(railY)) seguirRail();
            else restaurarVistaInicial();
            canvasGL.focus();                      // habilita A/D para recorrer
          }
          estiloBtnRail(railOn);
          dibujarOverlay();
          dibujarContenidoGL();
          dibujarCrosshair(cursorPx, cursorPy);
        });

        // Botones de color: SELECCIÓN de ecuación (solo si hay 2+ para elegir).
        if (curvasRail.length >= 2) {
          const botones: ((sel: boolean) => void)[] = [];
          const refrescarBotones = () =>
            botones.forEach((f, j) => f(j === lineaSeleccionada));

          curvasRail.forEach((curva, i) => {
            const btn = controles.createDiv();
            btn.setAttribute("title", `Seleccionar la ecuación ${i + 1}`);
            const colorCss = colorTuplaCss(curva.color);
            const estilo = (sel: boolean) => {
              btn.style.cssText =
                "width:22px; height:22px; border-radius:50%; cursor:pointer; " +
                "user-select:none; box-sizing:border-box; " +
                (sel
                  ? `background:${colorCss}; border:2px solid rgba(255,255,255,0.9);`
                  : `background:rgba(30,30,30,0.85); border:2px solid ${colorCss};`);
            };
            botones.push(estilo);

            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              lineaSeleccionada = i;               // SOLO cambia la selección
              refrescarBotones();
              // Con el carril activo, reengancha sobre la nueva curva al instante,
              // conservando railX y SIN apagar el modo.
              if (railOn) {
                railY = buscarYInicial(curvasRail[lineaSeleccionada].F, railX);
                if (Number.isFinite(railY)) seguirRail();
                dibujarOverlay();
                dibujarContenidoGL();
                canvasGL.focus();                  // conserva A/D tras cambiar de curva
              }
              dibujarCrosshair(cursorPx, cursorPy);
            });
          });
          refrescarBotones();
        }
      }

      // Panel oculto (.obsi-math-info) por coherencia con obs-graph: registra la
      // solución también ahí aunque el CSS no lo muestre.
      const infoBox = contenedor.createDiv({ cls: "obsi-math-info" });
      if (resultado === null) {
        for (const p of intersecciones)
          infoBox.createEl("p", { text: `(${p.x.toFixed(4)}, ${p.y.toFixed(4)})` });
      } else if (typeof resultado === "string") {
        infoBox.createEl("p", { text: resultado });
      } else {
        for (const v of Object.keys(resultado).sort())
          infoBox.createEl("p", { text: `${v} = ${resultado[v].toFixed(4)}` });
      }
    } catch (error) {
      contenedor.createEl("p", { text: "Error: " + (error as Error).message });
    }
  }
}
