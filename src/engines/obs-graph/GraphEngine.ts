import {
  MarkdownRenderer,
  MarkdownRenderChild,
  Plugin,
  type MarkdownPostProcessorContext,
} from "obsidian";
import { parse, simplify } from "mathjs";

import { normalizarEntrada } from "../../parser";
import { compilarFuncion } from "../../evaluador";
import { limpiarTex, OPCIONES_TEX } from "../../latex";
import {
  analizarFuncion,
  tieneTrigonometria,
  estadoGrupo,
  construirPuntosNotables,
  type Vertice,
} from "../../analisis";
import { clasificarDegenerada, type FuncionDegenerada } from "../../degeneradas";
import { crearPrograma, construirQuadStrip } from "../../webgl";
import { muestrearFuncion } from "../../render/muestreoExplicito";

export class GraphEngine {
  private obsMathUpdateCount = 0;

  constructor(private plugin: Plugin) {}

  async process(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
        const contenedor = el.createDiv({ cls: "obsi-math-container" });

        // Obsidian re-renderiza el bloque (editar, scroll, cambiar de nota…)
        // creando un contenedor nuevo cada vez. Sin liberar el contexto WebGL
        // anterior se acumulan hasta "Too many active WebGL contexts". Este
        // MarkdownRenderChild ejecuta sus callbacks register() cuando el
        // elemento se quita del DOM, que es donde liberamos GL, observers y
        // listeners globales.
        const limpieza = new MarkdownRenderChild(contenedor);
        ctx.addChild(limpieza);

        try {
          const partes = source.trim().split("=");
          const exprRaw = partes.length > 1 ? partes[1].trim() : partes[0].trim();
          const expr = normalizarEntrada(exprRaw);

          // Renderizar LaTeX
          let latex = "f(x)=" + expr;
          try {
            // "auto": mathjs pone sólo los paréntesis necesarios. Con "keep"
            // conservaba los redundantes y x^{3^{\pi}} salía como
            // x^{\left(3^{\left(\pi\right)}\right)} en vez de x^{3^{\pi}}.
            // El handler aplica además la política tipográfica de funciones
            // (\sin x sin paréntesis, \sin(x+1) con ellos): ver OPCIONES_TEX.
            const tex = limpiarTex(parse(expr).toTex(OPCIONES_TEX));
            // Con el bloque vacío, parse("") de mathjs devuelve el nodo "undefined"
            // (toTex → "undefined"), que KaTeX pintaría como u·n·d·e·f… en cursiva.
            // Lo mostramos como marcador de "sin función": \text{[...]}.
            latex = "f(x)=" + (tex === "undefined" ? "\\text{[...]}" : tex);
          } catch (e) {
            console.warn("ObsiMath: no se pudo generar LaTeX para", expr, e);
          }

          // Panel izquierdo: contenedor posicionado que aloja el área de scroll
          // de la fórmula y el overlay de fade. El overlay tiene que ser hermano
          // del área scrolleable (no hijo): un elemento absolute dentro de un
          // scroller se desplaza junto al contenido y el fade "viajaría".
          const panelLatex = contenedor.createDiv({ cls: "obsi-math-latex" });
          panelLatex.style.cssText =
            "position:relative; width:50%; height:261px; padding:0; overflow:hidden;";

          // Área scrolleable horizontal. Conserva la clase para heredar el
          // tamaño de fuente de KaTeX (no se reduce ni se escala el contenido).
          // `justify-content:safe center` centra la fórmula cuando cabe y la
          // alinea al inicio (totalmente scrolleable) cuando desborda.
          const contenedorLatex = panelLatex.createDiv({ cls: "obsi-math-latex" });
          // overflow-x lo gestiona actualizarFade(): arranca en `hidden` y sólo
          // pasa a `auto` cuando hay desbordamiento real (ver tolerancia abajo).
          contenedorLatex.style.cssText =
            "width:100%; height:100%; padding:24px; box-sizing:border-box; " +
            "display:flex; align-items:center; justify-content:safe center; " +
            "overflow-x:hidden; overflow-y:hidden;";
          // Barra de scroll discreta: delgada y en tonos oscuros del plugin.
          contenedorLatex.style.scrollbarWidth = "thin";
          contenedorLatex.style.scrollbarColor = "#3a3a3a #1e1e1e";

          await MarkdownRenderer.render(
            this.plugin.app, "$$" + latex + "$$", contenedorLatex, ctx.sourcePath, this.plugin
          );

          // Overlay de fade en los bordes (no intercepta el ratón). Dos
          // gradientes laterales de rgba(30,30,30,0.85) → transparente, ~32px.
          const fadeOverlay = panelLatex.createDiv();
          fadeOverlay.style.cssText = "position:absolute; inset:0; pointer-events:none;";
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

          // Visibilidad de los fades según la posición de scroll:
          //  - sin desbordar           → ninguno
          //  - scrollLeft = 0          → solo derecho
          //  - intermedio              → ambos
          //  - scrollLeft = máximo     → solo izquierdo
          // KaTeX puede dejar 1–2px de desbordamiento sub-pixel aunque la fórmula
          // quepa de sobra (p.ej. x^{1000}); con overflow-x:auto eso bastaba para
          // que apareciera una barra de scroll espuria. Sólo consideramos que
          // desborda (y activamos scroll + fades) por encima de esta tolerancia.
          const TOLERANCIA_SCROLL = 3;
          const actualizarFade = () => {
            const max = contenedorLatex.scrollWidth - contenedorLatex.clientWidth;
            const desborda = max > TOLERANCIA_SCROLL;
            // La barra horizontal consume alto, no ancho, así que alternar
            // overflow-x no altera clientWidth ni provoca oscilación.
            contenedorLatex.style.overflowX = desborda ? "auto" : "hidden";
            const sl = contenedorLatex.scrollLeft;
            fadeIzq.style.opacity = desborda && sl > 0 ? "1" : "0";
            fadeDer.style.opacity = desborda && sl < max - 1 ? "1" : "0";
          };
          contenedorLatex.addEventListener("scroll", actualizarFade);

          // Rueda del ratón sobre la fórmula → scroll horizontal directo.
          // Movemos scrollLeft exactamente lo que indica la rueda y se detiene,
          // igual que las flechas de la scrollbar nativa: sin inercia ni rAF.
          contenedorLatex.addEventListener(
            "wheel",
            (e: WheelEvent) => {
              if (contenedorLatex.scrollWidth - contenedorLatex.clientWidth <= TOLERANCIA_SCROLL) return;
              e.preventDefault();
              // e.deltaY varía mucho según el dispositivo, así que limitamos el
              // desplazamiento por tick a ±40px (≈ un clic en las flechas de la
              // scrollbar nativa), conservando la dirección.
              const desplazamiento = e.deltaY + e.deltaX;
              contenedorLatex.scrollLeft +=
                Math.max(-40, Math.min(40, desplazamiento));
            },
            { passive: false }
          );

          // El layout de KaTeX no está medido hasta el siguiente frame; además
          // recalculamos al cambiar el tamaño de la ventana.
          requestAnimationFrame(actualizarFade);
          window.addEventListener("resize", actualizarFade);
          limpieza.register(() => window.removeEventListener("resize", actualizarFade));

          // Las fuentes matemáticas de KaTeX cargan de forma asíncrona: tras la
          // primera medida la fórmula se reajusta y cambia de ancho. Sin volver a
          // medir, el estado de desbordamiento (barra fina + fades) quedaba
          // obsoleto. Un ResizeObserver sobre el contenedor recalcula en cuanto
          // el ancho real cambia.
          const observadorLatex = new ResizeObserver(() => actualizarFade());
          observadorLatex.observe(contenedorLatex);
          limpieza.register(() => observadorLatex.disconnect());

// ── Motor gráfico ─────────────────────────
          // W se mide del tamaño real en pantalla (ver redimensionar()); 768 es
          // solo un valor inicial de respaldo. H es la altura fija del panel.
          let W = 768; const H = 261;
          const dpr = Math.ceil(window.devicePixelRatio || 1);
          const wrapGrafica = contenedor.createDiv({ cls: "obsi-math-grafica" });
          wrapGrafica.style.cssText = `position:relative; width:100%; height:${H}px;`;

          const canvasGL = wrapGrafica.createEl("canvas");
          const canvas2D = wrapGrafica.createEl("canvas");
          // Canvas dedicado al crosshair: capa superior independiente para poder
          // borrar y redibujar la línea del cursor sin tocar el overlay (ejes,
          // grid, etiquetas, asíntotas), que vive en canvas2D.
          const canvasCross = wrapGrafica.createEl("canvas");

          // Canvas GL: resolución física
          canvasGL.width = W * dpr; canvasGL.height = H * dpr;
          canvasGL.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%;`;

          // Canvas 2D overlay: misma resolución física, transparente
          canvas2D.width = W * dpr; canvas2D.height = H * dpr;
          canvas2D.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;`;

          // Canvas crosshair: encima de todo, transparente a eventos
          canvasCross.width = W * dpr; canvasCross.height = H * dpr;
          canvasCross.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;`;

          const gl = canvasGL.getContext("webgl", { antialias: true });
          const ctx2d = canvas2D.getContext("2d");
          const ctxCross = canvasCross.getContext("2d");

          // Libera el contexto WebGL al desmontar el bloque. Sin esto cada
          // re-render deja un contexto vivo hasta agotar el límite del navegador.
          if (gl) {
            limpieza.register(() =>
              gl.getExtension("WEBGL_lose_context")?.loseContext()
            );
          }

          // Evaluador COMPARTIDO con obs-system: compila la expresión normalizada
          // e inyecta las trig inversas extra. Así ambos motores reconocen las
          // mismas funciones (ver compilarFuncion / FUNCIONES_INVERSAS_EXTRA).
          const evalX = compilarFuncion(expr, "x");

          // Funciones que no toman ningún valor real (log en base 1, 0/0,
          // sqrt(-1)…) no se grafican: se muestra una etiqueta formal en su
          // lugar. Esto también evita el motor de curva, que dibujaba asíntotas
          // falsas en estos casos. Caso aparte: el bloque vacío (sin expresión)
          // no es una indeterminación, sino que aún no hay nada que graficar; se
          // intercepta antes para mostrar un mensaje propio en vez de "Indeterminada".
          const degenerada: FuncionDegenerada | null = expr.trim() === ""
            ? {
                etiqueta: "Sin función",
                detalle: "Escribe una expresión matemática para graficar.",
              }
            : clasificarDegenerada(evalX);

          // Puntos notables (raíces, vértices e intersección con Y): se calculan
          // UNA sola vez y se reutilizan tanto para dibujarlos sobre el plano como
          // para listarlos en el cuadro de información de abajo. En funciones no
          // graficables (degeneradas) no hay nada que analizar.
          const analisis = degenerada
            ? { raices: [] as number[], vertices: [] as Vertice[] }
            : analizarFuncion(evalX);
          const interseccionY = evalX(0);
          // Estado de cada grupo (normal / infinitas / demasiadas), calculado una
          // sola vez y reutilizado por la gráfica, el botón de resumen y el panel.
          // Las trigonométricas (sin/cos/tan/sec/csc/cot) con puntos notables se
          // consideran con infinitos; el resto se rige por el umbral de cantidad.
          const esTrig = tieneTrigonometria(expr);
          const estadoRaices = estadoGrupo(analisis.raices.length, esTrig);
          const estadoVertices = estadoGrupo(analisis.vertices.length, esTrig);
          const puntosNotables = construirPuntosNotables(
            analisis, interseccionY, estadoRaices, estadoVertices
          );

          if (!gl || !ctx2d || !ctxCross) {
            wrapGrafica.createEl("p", { text: "Error: WebGL no disponible" });
          } else {
            // La escala dpr del contexto 2D se aplica en redimensionar(), porque
            // cada vez que se reasigna canvas2D.width el transform se reinicia.

            // domX se recalcula en redimensionar() para que el grid sea 1:1 con
            // el ancho real; este valor inicial es solo un respaldo provisional.
            let domX: [number, number] = [-7, 7];
            let domY: [number, number] = [-7, 7];

            // Posición del cursor en píxeles CSS dentro del canvas (null = fuera).
            // Se guardan X e Y: X mueve el crosshair vertical; (X,Y) sirve para
            // detectar cuándo el cursor pasa por encima/cerca de un punto notable
            // y mostrar entonces su etiqueta de coordenadas.
            let cursorPx: number | null = null;
            let cursorPy: number | null = null;

            // Punto FIJADO estilo "carril" (botón ⌖): se ancla una POSICIÓN X sobre
            // la curva; el punto vive en (railX, f(railX)) y la cámara lo sigue en X.
            // Con A/D se viaja por la curva; con W/S se hace zoom.
            let railX: number | null = null;

            // Tope de seguridad: una |f| finita por encima de esto es PELIGROSA
            // (riesgo de overflow/coste/congelación: x^10000, exp(exp(x)), 10^(10^x)).
            const LIMITE_CARRIL_Y = 1e9;

            // Evaluador CENTRALIZADO del carril. Toda la lógica del modo carril lo
            // consulta en vez de asumir que f(x) siempre es un valor válido. Estados:
            //   • "ok"      → valor finito y dentro del rango seguro (hay coord. Y).
            //   • "indef"   → NaN/±Infinity: fuera de dominio o polo/asíntota (ln x en
            //                 x≤0, 1/x en 0, √x en x<0…). Se explora, se muestra
            //                 "f(x) = indef"/"→ ±∞", pero NO se dibuja punto (sin Y).
            //   • "peligro" → finito pero gigantesco (>tope): riesgo para el motor.
            // (Para llegar a un overflow SOSTENIDO hay que cruzar antes una zona
            // finita-gigante, que ya queda bloqueada como "peligro"; por eso tratar
            // ±Infinity como "indef" es seguro: solo deja pasar polos aislados.)
            type EstadoCarril =
              | { estado: "ok"; y: number }
              | { estado: "indef" }
              | { estado: "peligro" };
            const evaluarCarrilSeguro = (x: number): EstadoCarril => {
              let y: number;
              try { y = evalX(x); } catch { return { estado: "indef" }; }
              if (!Number.isFinite(y)) return { estado: "indef" };          // NaN o ±Infinity
              if (Math.abs(y) > LIMITE_CARRIL_Y) return { estado: "peligro" };
              return { estado: "ok", y };
            };

            // Recoloca la vista para que el carril quede centrado. X SIEMPRE sigue a
            // railX. Y solo se recentra si f(railX) es "ok"; si es indef/peligro NO se
            // toca el encuadre vertical (no hay coordenada Y válida sobre la que
            // centrar). El zoom (`factor`≠1) escala con clamp a un rango sano.
            const RANGO_SEMI_MIN = 1e-4;   // zoom-in máximo (semianchura mínima en Y)
            const RANGO_SEMI_MAX = 1e9;    // zoom-out máximo (semianchura máxima en Y)
            const seguirRail = (factor = 1) => {
              if (railX === null) return;
              const semiYAnt = (domY[1] - domY[0]) / 2;
              const semiYNueva = Math.max(RANGO_SEMI_MIN, Math.min(RANGO_SEMI_MAX, semiYAnt * factor));
              const f = semiYNueva / semiYAnt;        // factor efectivo tras el clamp
              const semiX = (domX[1] - domX[0]) / 2 * f;
              domX = [railX - semiX, railX + semiX];  // X siempre sigue al carril
              const r = evaluarCarrilSeguro(railX);
              if (r.estado === "ok") {
                domY = [r.y - semiYNueva, r.y + semiYNueva];
              } else if (f !== 1) {
                const cyV = (domY[0] + domY[1]) / 2;  // indef/peligro + zoom: escala en su centro
                domY = [cyV - semiYNueva, cyV + semiYNueva];
              }
            };

            // Restaura la vista por defecto (igual que al abrir la gráfica): domY
            // fijo y domX centrado en 0 con celdas 1:1 respecto al ancho real.
            const restaurarVistaInicial = () => {
              domY = [-7, 7];
              const semiX = (domY[1] - domY[0]) / 2 * (W / H);
              domX = [-semiX, semiX];
            };

            // Intenta mover el carril a railX+delta. Solo BLOQUEA el caso "peligro"
            // (conserva la última posición válida, evita congelar Obsidian). Un valor
            // "indef" SÍ se permite: se explora el dominio como con el crosshair.
            const avanzarRail = (delta: number): boolean => {
              if (railX === null) return false;
              if (evaluarCarrilSeguro(railX + delta).estado === "peligro") return false;
              railX += delta;
              return true;
            };

            const sx = (x: number) => ((x - domX[0]) / (domX[1] - domX[0])) * W;
            const sy = (y: number) => H - ((y - domY[0]) / (domY[1] - domY[0])) * H;

            // Genera ticks "bonitos" para un rango dado
            const generarTicks = (min: number, max: number, maxTicks = 10): number[] => {
              const rango = max - min;
              const paso = Math.pow(10, Math.floor(Math.log10(rango / maxTicks)));
              const pasos = [1, 2, 5, 10].map(m => m * paso);
              const pasoFinal = pasos.find(p => rango / p <= maxTicks) ?? pasos[pasos.length - 1];
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

            // En `x`, evalX devolvió ±Infinity. ¿Es un DESBORDAMIENTO numérico
            // (la función vale un número finito pero mayor que el máximo de un
            // double, ~1.8·10³⁰⁸ —p.ej. x^10000 ≈ 10⁵⁸⁰⁶, que NO es infinito) o
            // una DIVERGENCIA real (polo: tan x, 1/(x-2), donde el límite sí es
            // ±∞)? Mismo criterio que el motor de curva: alejándose del origen
            // (hacia |x| mayor), un overflow de función creciente sigue infinito
            // hasta el borde; un polo vuelve a valores finitos pasada la
            // singularidad. Escaneamos sólo hacia afuera para no cruzar la zona
            // central finita (x^10000 es finita en |x|<1.08).
            const esDesbordamiento = (x: number): boolean => {
              const dir = Math.sign(x) || 1;
              const borde = dir > 0 ? domX[1] : domX[0];
              const PASOS = 14;
              const paso = (borde - x) / PASOS;
              if (Math.abs(paso) < 1e-12) return false;
              for (let k = 1; k <= PASOS; k++) {
                if (Number.isFinite(evalX(x + k * paso))) return false; // polo
              }
              return true; // infinito hasta el borde alejándose → overflow
            };

            // Clasifica una singularidad x0 (donde evalX = ±Infinity) mirando los
            // límites LATERALES, para decidir el texto: "pos" (ambos lados definidos
            // divergen a +∞ → 1/x²), "neg" (ambos a -∞ → -1/x²), o "indef" (lados de
            // signo distinto → 1/x; o ambiguo). Un lado fuera del dominio (NaN o
            // complejo, p.ej. ln x en x<0) NO cuenta: manda el lado definido (ln x en
            // 0: solo x>0 existe y tiende a -∞ → "neg").
            const ladoDiverge = (x0: number, dir: 1 | -1): "pos" | "neg" | "nan" | "fin" => {
              const v = evalX(x0 + dir * 1e-6);
              const c = typeof v === "number" ? v : NaN;   // complejo → fuera de dominio
              if (Number.isNaN(c)) return "nan";
              if (!Number.isFinite(c)) return c > 0 ? "pos" : "neg";   // ±Infinity
              if (Math.abs(c) > 1e6) return c > 0 ? "pos" : "neg";     // ya enorme
              const v2 = evalX(x0 + dir * 1e-3);
              const l = typeof v2 === "number" ? v2 : NaN;
              // Divergencia lenta (ln): |f| crece al acercarse a x0.
              if (!Number.isNaN(l) && Math.abs(c) > Math.abs(l) && Math.abs(c) > 10) {
                return c > 0 ? "pos" : "neg";
              }
              return "fin";
            };
            const clasificarSingularidad = (x0: number): "pos" | "neg" | "indef" => {
              const lados = [ladoDiverge(x0, -1), ladoDiverge(x0, 1)].filter(s => s !== "nan");
              if (lados.length > 0 && lados.every(s => s === "pos")) return "pos";
              if (lados.length > 0 && lados.every(s => s === "neg")) return "neg";
              return "indef";
            };

            // Marcador circular reutilizable: anillo exterior tenue + disco
            // interior de color. Lo comparten el crosshair (azul) y los puntos
            // notables (naranja). El radio es en PÍXELES, así que su tamaño visual
            // se mantiene constante con el zoom.
            const dibujarPuntoMarcador = (
              ctx: CanvasRenderingContext2D,
              px: number,
              py: number,
              color: string
            ) => {
              ctx.save();
              // Borde exterior tenue para dar profundidad
              ctx.beginPath();
              ctx.arc(px, py, 4.5, 0, Math.PI * 2);
              ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
              ctx.fill();
              // Disco interior del color indicado
              ctx.beginPath();
              ctx.arc(px, py, 3, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
              ctx.restore();
            };

            // Crosshair vertical que sigue al cursor. Se dibuja en su propio
            // canvas (canvasCross), por encima del overlay, de modo que limpiarlo
            // y redibujarlo no afecta ejes, grid, etiquetas ni asíntotas.
            // Crosshair informativo. En modo SEGUIMIENTO (carril) el punto de
            // referencia es el del carril (railX), sobre la curva, y se IGNORA el
            // cursor del ratón —así el crosshair normal no reaparece ni compite—.
            // Fuera del carril, sigue al cursor. En ambos casos dibuja lo mismo:
            // línea vertical y horizontal punteadas, marcador del punto y etiquetas
            // x / f(x); en modo carril añade un anillo naranja al marcador.
            const dibujarCrosshair = (cursorX: number | null) => {
              ctxCross.clearRect(0, 0, W, H);
              if (degenerada) return;

              let xPix: number;
              let xMath: number;
              const modoCarril = railX !== null;
              if (railX !== null) {
                xMath = railX;
                xPix = sx(railX);
              } else if (cursorX !== null) {
                xPix = cursorX;
                xMath = domX[0] + (cursorX / W) * (domX[1] - domX[0]);
              } else {
                return; // ni carril ni cursor: nada que dibujar
              }

              const yMath = evalX(xMath);
              const finita = Number.isFinite(yMath);
              const py = finita ? sy(yMath) : null;
              const yVisible = py !== null && py >= 0 && py <= H;

              ctxCross.save();

              // Líneas punteadas: vertical (en x) y horizontal (en f(x) si es visible)
              ctxCross.setLineDash([4, 6]);
              ctxCross.strokeStyle = "rgba(100, 150, 255, 0.4)";
              ctxCross.lineWidth = 1;
              ctxCross.beginPath();
              ctxCross.moveTo(xPix, 0); ctxCross.lineTo(xPix, H);
              ctxCross.stroke();
              if (yVisible) {
                ctxCross.beginPath();
                ctxCross.moveTo(0, py!); ctxCross.lineTo(W, py!);
                ctxCross.stroke();
              }
              ctxCross.setLineDash([]);

              // Indicador del punto (intersección con la curva). En modo carril, un
              // anillo naranja distingue que está bloqueado sobre la línea.
              if (yVisible) {
                dibujarPuntoMarcador(ctxCross, xPix, py!, "rgba(80, 160, 255, 1.0)");
                if (modoCarril) {
                  ctxCross.save();
                  ctxCross.strokeStyle = "rgba(255, 160, 40, 0.9)";
                  ctxCross.lineWidth = 1.5;
                  ctxCross.beginPath();
                  ctxCross.arc(xPix, py!, 7, 0, Math.PI * 2);
                  ctxCross.stroke();
                  ctxCross.restore();
                }
              }

              // Etiquetas x / f(x) a la derecha de la línea salvo cerca del borde.
              const aLaDerecha = xPix < W * 0.75;
              ctxCross.textAlign = aLaDerecha ? "left" : "right";
              ctxCross.textBaseline = "top";
              ctxCross.font = "11px monospace";
              const tx = xPix + (aLaDerecha ? 5 : -5);

              ctxCross.fillStyle = "rgba(200, 210, 255, 0.9)";
              ctxCross.fillText(`x = ${formatearNumero(xMath)}`, tx, 4);

              let textoY: string;
              if (finita) {
                textoY = `f(x) = ${formatearNumero(yMath)}`;
              } else if (yMath === Infinity || yMath === -Infinity) {
                // Distinguir overflow (valor finito fuera de rango) de divergencia.
                if (esDesbordamiento(xMath)) {
                  textoY = yMath < 0 ? "f(x) < -10³⁰⁸" : "f(x) > 10³⁰⁸";
                } else {
                  // Polo: el signo depende de AMBOS límites laterales, no del valor
                  // puntual. Solo +∞/-∞ si los dos lados coinciden; si difieren
                  // (1/x: -∞ izq, +∞ der) o es ambiguo → "indef".
                  const clase = clasificarSingularidad(xMath);
                  textoY = clase === "pos" ? "f(x) → +∞"
                         : clase === "neg" ? "f(x) → -∞"
                         : "f(x) = indef";
                }
              } else {
                textoY = "f(x) = indef.";
              }
              ctxCross.fillText(textoY, tx, 18);

              // Etiquetas de puntos notables al pasar el cursor cerca (SOLO en modo
              // libre: dependen de la posición del ratón, que en carril se ignora).
              if (!modoCarril && cursorPy !== null) {
                const RADIO_HOVER = 16; // px de cercanía para "activar" la etiqueta
                const colocadas: RectEtiqueta[] = [];
                for (const p of puntosNotables) {
                  const px = sx(p.x);
                  const pyN = sy(p.y);
                  if (px < 0 || px > W || pyN < 0 || pyN > H) continue;
                  if (Math.hypot(px - xPix, pyN - cursorPy) > RADIO_HOVER) continue;
                  dibujarEtiquetaPunto(
                    ctxCross, px, pyN,
                    `(${formatearNumero(p.x)}, ${formatearNumero(p.y)})`,
                    colocadas
                  );
                }
              }

              ctxCross.restore();
            };

            const COLOR_PUNTO_NOTABLE = "rgba(255, 160, 40, 1.0)";

            type RectEtiqueta = { x0: number; y0: number; x1: number; y1: number };
            const solapanRect = (a: RectEtiqueta, b: RectEtiqueta) =>
              !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);

            // Dibuja la etiqueta de coordenadas de un punto: prueba varias
            // posiciones candidatas y elige la primera que cabe en el plano y no
            // se solapa con otra etiqueta ya colocada (anti-superposición cuando
            // dos puntos quedan muy juntos). Si ninguna cabe, no dibuja nada.
            // Estética tipo Desmos: fondo oscuro semitransparente + texto naranja.
            const dibujarEtiquetaPunto = (
              ctx: CanvasRenderingContext2D,
              px: number, py: number, texto: string, colocadas: RectEtiqueta[]
            ) => {
              ctx.save();
              ctx.font = "11px monospace";
              ctx.textBaseline = "middle";
              const ancho = ctx.measureText(texto).width;
              const PAD = 3;
              const candidatos: { dx: number; dy: number; align: CanvasTextAlign }[] = [
                { dx: 9, dy: -9, align: "left" },
                { dx: 9, dy: 11, align: "left" },
                { dx: -9, dy: -9, align: "right" },
                { dx: -9, dy: 11, align: "right" },
              ];
              for (const c of candidatos) {
                const tx = px + c.dx;
                const ty = py + c.dy;
                const x0 = (c.align === "left" ? tx : tx - ancho) - PAD;
                const rect: RectEtiqueta = { x0, y0: ty - 8, x1: x0 + ancho + 2 * PAD, y1: ty + 8 };
                if (rect.x0 < 0 || rect.x1 > W || rect.y0 < 0 || rect.y1 > H) continue;
                if (colocadas.some(r => solapanRect(r, rect))) continue;
                colocadas.push(rect);
                ctx.fillStyle = "rgba(18, 18, 18, 0.7)";
                ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
                ctx.textAlign = c.align;
                ctx.fillStyle = "rgba(255, 200, 130, 0.95)";
                ctx.fillText(texto, tx, ty);
                break;
              }
              ctx.restore();
            };

            // Marcadores de puntos notables (raíces, vértices e intersección Y)
            // sobre el plano, en el Canvas 2D (junto a ejes y grid). Respetan
            // pan/zoom vía sx/sy, mantienen tamaño constante (radio en píxeles) y
            // se omiten si caen fuera del viewport. SOLO el marcador: la etiqueta
            // de coordenadas se muestra al pasar el cursor cerca (ver crosshair).
            const dibujarPuntosNotables = () => {
              if (degenerada || puntosNotables.length === 0) return;
              for (const p of puntosNotables) {
                const px = sx(p.x);
                const py = sy(p.y);
                if (px < 0 || px > W || py < 0 || py > H) continue; // fuera del viewport
                dibujarPuntoMarcador(ctx2d, px, py, COLOR_PUNTO_NOTABLE);
              }
            };

            const dibujarOverlay = () => {
              ctx2d.clearRect(0, 0, W, H);

              const ticksX = generarTicks(domX[0], domX[1]);
              const ticksY = generarTicks(domY[0], domY[1]);

              // Grid tenue
              ctx2d.strokeStyle = "rgba(130,130,150,0.12)";
              ctx2d.lineWidth = 0.5;
              for (const x of ticksX) {
                ctx2d.beginPath(); ctx2d.moveTo(sx(x), 0); ctx2d.lineTo(sx(x), H); ctx2d.stroke();
              }
              for (const y of ticksY) {
                ctx2d.beginPath(); ctx2d.moveTo(0, sy(y)); ctx2d.lineTo(W, sy(y)); ctx2d.stroke();
              }

              // Ejes principales
              ctx2d.strokeStyle = "rgba(160,160,170,0.7)";
              ctx2d.lineWidth = 1;
              if (domY[0] <= 0 && domY[1] >= 0) {
                ctx2d.beginPath(); ctx2d.moveTo(0, sy(0)); ctx2d.lineTo(W, sy(0)); ctx2d.stroke();
              }
              if (domX[0] <= 0 && domX[1] >= 0) {
                ctx2d.beginPath(); ctx2d.moveTo(sx(0), 0); ctx2d.lineTo(sx(0), H); ctx2d.stroke();
              }

              // Etiquetas
              ctx2d.fillStyle = "rgba(160,160,170,0.85)";
              ctx2d.font = `${11}px monospace`;

              const ceroY = Math.max(4, Math.min(H - 4, sy(0)));
              const ceroX = Math.max(4, Math.min(W - 4, sx(0)));

              ctx2d.textAlign = "center";
              ctx2d.textBaseline = "top";
              for (const x of ticksX) {
                if (Math.abs(x) < 1e-9) continue;
                const px = sx(x);
                if (px < 10 || px > W - 10) continue;
                // tick mark
                ctx2d.strokeStyle = "rgba(160,160,170,0.5)";
                ctx2d.lineWidth = 0.75;
                ctx2d.beginPath(); ctx2d.moveTo(px, ceroY - 3); ctx2d.lineTo(px, ceroY + 3); ctx2d.stroke();
                ctx2d.fillText(formatearNumero(x), px, ceroY + 5);
              }

              ctx2d.textAlign = "right";
              ctx2d.textBaseline = "middle";
              for (const y of ticksY) {
                if (Math.abs(y) < 1e-9) continue;
                const py = sy(y);
                if (py < 10 || py > H - 10) continue;
                ctx2d.strokeStyle = "rgba(160,160,170,0.5)";
                ctx2d.lineWidth = 0.75;
                ctx2d.beginPath(); ctx2d.moveTo(ceroX - 3, py); ctx2d.lineTo(ceroX + 3, py); ctx2d.stroke();
                ctx2d.fillText(formatearNumero(y), ceroX - 6, py);
              }

              // Puntos notables encima de ejes/grid (en el mismo Canvas 2D).
              dibujarPuntosNotables();

              // Redibuja el crosshair tras cada repintado del overlay (zoom/pan/
              // resize) para que refleje el nuevo dominio si el cursor sigue dentro.
              dibujarCrosshair(cursorPx);
            };

            const programa = crearPrograma(gl);
            const aPos = gl.getAttribLocation(programa, "a_pos");
            const uColor = gl.getUniformLocation(programa, "u_color");
            const buffer = gl.createBuffer()!;

            const aspectoInicial = (domY[1] - domY[0]) / (domX[1] - domX[0]);

const dibujarCurvaGL = (motivo: "inicio" | "zoom" | "pan") => {
  this.obsMathUpdateCount++;
  console.log('Actualizaciones motor gráfico (obs-graph): ' + this.obsMathUpdateCount);
  gl.viewport(0, 0, W * dpr, H * dpr);
  gl.clearColor(0.118, 0.118, 0.118, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  // Función no graficable: plano vacío (sin curva ni asíntotas). El overlay de
  // ejes/grid sí se dibuja (dibujarOverlay) y el zoom/pan sigue activo.
  if (degenerada) return;
  gl.useProgram(programa);
  gl.uniform4f(uColor, 0.31, 0.62, 1.0, 1.0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const cx = (x: number) => ((x - domX[0]) / (domX[1] - domX[0])) * 2 - 1;
const cy = (y: number) => ((y - domY[0]) / (domY[1] - domY[0])) * 2 - 1;

const interactivo = (motivo === "pan" || motivo === "zoom");
const GROSOR_CLIP = 0.004;
const dibujarAsintota = (xa: number) => {
  const px = sx(xa);
  if (px < 0 || px > W) return;
  ctx2d.save();
  ctx2d.setLineDash([4, 6]);
  ctx2d.strokeStyle = "rgba(100, 150, 255, 0.3)";
  ctx2d.lineWidth = 1;
  ctx2d.beginPath(); ctx2d.moveTo(px, 0); ctx2d.lineTo(px, H); ctx2d.stroke();
  ctx2d.restore();
};

// (El sampler 1D —MUESTRAS, refinado adaptativo `tramo`, detección de polos y
// asíntotas, overflow— se extrajo a render/muestreoExplicito y lo comparten
// obs-graph y obs-system. Aquí solo queda el mapeo a clip y el dibujo.)

// Muestreo 1D COMPARTIDO (sampler extraído a render/muestreoExplicito; obs-system
// usa el MISMO módulo). Devuelve ramas continuas en MUNDO + las x de las asíntotas
// verticales; aquí se mapean a clip y se dibujan con el grosor constante de siempre.
const { polilineas, asintotas } = muestrearFuncion({
  evalX, domX: [domX[0], domX[1]], domY: [domY[0], domY[1]], H, interactivo,
});
for (const poli of polilineas) {
  const clip: number[] = [];
  for (let k = 0; k < poli.length; k += 2) clip.push(cx(poli[k]), cy(poli[k + 1]));
  const quads = construirQuadStrip(clip, GROSOR_CLIP);
  if (quads.length === 0) continue;
  gl.bufferData(gl.ARRAY_BUFFER, quads, gl.DYNAMIC_DRAW);
  gl.drawArrays(gl.TRIANGLES, 0, quads.length / 2);
}
for (const xp of asintotas) dibujarAsintota(xp);
};

// Ajusta la resolución interna de ambos canvas al tamaño REAL que ocupan en
// pantalla. Sin esto, el bitmap (768px de ancho) se estira al ancho del panel y
// aplasta horizontalmente el texto y el plano. Se llama al inicio y cada vez que
// el panel cambia de tamaño.
let dibujado = false;
const redimensionar = () => {
  const ancho = Math.max(1, Math.round(wrapGrafica.clientWidth || W));
  if (dibujado && ancho === W) return;
  W = ancho;
  dibujado = true;
  // Ajusta domX para que el grid tenga cuadrados 1:1 con el W real recién
  // medido: misma cantidad de unidades por píxel en X que en Y. Conserva el
  // centro horizontal actual y la vista vertical (domY) como referencia.
  const centroX = (domX[0] + domX[1]) / 2;
  const semirangoX = (domY[1] - domY[0]) / 2 * (W / H);
  domX = [centroX - semirangoX, centroX + semirangoX];
  canvasGL.width = W * dpr; canvasGL.height = H * dpr;
  canvas2D.width = W * dpr; canvas2D.height = H * dpr;
  canvasCross.width = W * dpr; canvasCross.height = H * dpr;
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctxCross.setTransform(dpr, 0, 0, dpr, 0, 0);
  dibujarOverlay();
  dibujarCurvaGL("inicio");
};
redimensionar();
const observadorTamano = new ResizeObserver(() => redimensionar());
observadorTamano.observe(wrapGrafica);
limpieza.register(() => observadorTamano.disconnect());

// Función no graficable: el plano queda interactivo (zoom/pan) pero vacío y
// oscurecido, con la etiqueta formal flotando delante. Ambas capas no
// interceptan el ratón (pointer-events:none), así que la interacción con el
// plano sigue igual que siempre.
if (degenerada) {
  const velo = wrapGrafica.createDiv();
  velo.style.cssText =
    "position:absolute; inset:0; background:rgba(18,18,18,0.55); " +
    "pointer-events:none;";

  const msg = wrapGrafica.createDiv();
  msg.style.cssText =
    "position:absolute; inset:0; display:flex; flex-direction:column; " +
    "align-items:center; justify-content:center; text-align:center; " +
    "gap:8px; padding:24px; box-sizing:border-box; pointer-events:none;";
  const titulo = msg.createDiv({ text: degenerada.etiqueta });
  titulo.style.cssText =
    "font-size:20px; font-weight:600; color:rgba(200,210,255,0.95);";
  const detalle = msg.createDiv({ text: degenerada.detalle });
  detalle.style.cssText =
    "font-size:12px; line-height:1.4; max-width:320px; " +
    "color:rgba(190,195,210,0.85);";
}

          // ── Zoom / Pan ─────────────────────────
            let isDragging = false;
            let lastPointer = { x: 0, y: 0 };

            let rafPendiente = false;
let motivoPendiente: "zoom" | "pan" = "pan";

const programarRedibujo = (motivo: "zoom" | "pan") => {
  // zoom tiene prioridad sobre pan
  if (motivo === "zoom") motivoPendiente = "zoom";
  else if (!rafPendiente) motivoPendiente = "pan";
  
  if (!rafPendiente) {
    rafPendiente = true;
    requestAnimationFrame(() => {
      rafPendiente = false;
      dibujarOverlay();
      dibujarCurvaGL(motivoPendiente);
      motivoPendiente = "pan";
    });
  }
};

let timerFinal: number | null = null;
limpieza.register(() => { if (timerFinal !== null) clearTimeout(timerFinal); });
const programarFinal = () => {
  if (timerFinal !== null) clearTimeout(timerFinal);
  timerFinal = window.setTimeout(() => {
    timerFinal = null;
    dibujarOverlay();
    dibujarCurvaGL("inicio");   // pasada completa, máxima calidad
  }, 150);
};

canvasGL.addEventListener("pointerdown", e => {
  isDragging = true;
  lastPointer = { x: e.offsetX, y: e.offsetY };
  // Durante el arrastre el crosshair no se muestra: lo borramos al empezar.
  cursorPx = null;
  cursorPy = null;
  dibujarCrosshair(null);
  canvasGL.setPointerCapture(e.pointerId);
});

// Crosshair: sólo cuando no se está arrastrando (separado del pan).
canvasGL.addEventListener("pointermove", e => {
  if (isDragging) return;
  cursorPx = e.offsetX;
  cursorPy = e.offsetY;
  dibujarCrosshair(e.offsetX);
});

canvasGL.addEventListener("pointerleave", () => {
  cursorPx = null;
  cursorPy = null;
  dibujarCrosshair(null);
});

canvasGL.addEventListener("pointermove", e => {
  if (!isDragging) return;
  const dx = e.offsetX - lastPointer.x;
  const dy = e.offsetY - lastPointer.y;
  lastPointer = { x: e.offsetX, y: e.offsetY };
  const rx = (domX[1] - domX[0]) / W;
  const ry = (domY[1] - domY[0]) / H;
  if (railX !== null) {
    // Carril activo: arrastrar mueve la x sobre la curva (la cámara sigue al
    // punto). El arrastre vertical se ignora: el punto vive en la línea. El guard
    // de seguridad evita avanzar a zonas no finitas/explosivas.
    avanzarRail(-dx * rx);
    seguirRail();
  } else {
    domX = [domX[0] - dx * rx, domX[1] - dx * rx];
    domY = [domY[0] + dy * ry, domY[1] + dy * ry];
  }
  programarRedibujo("pan");
});

canvasGL.addEventListener("pointerup", e => {
  isDragging = false;
  canvasGL.releasePointerCapture(e.pointerId);
  programarFinal();             // al soltar el arrastre, refina
});

canvasGL.addEventListener("wheel", e => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 1.05 : 0.95;
  if (railX !== null) {
    seguirRail(factor);                  // zoom centrado en el punto del carril
  } else {
    const mx = domX[0] + (e.offsetX / W) * (domX[1] - domX[0]);
    const my = domY[1] - (e.offsetY / H) * (domY[1] - domY[0]);
    domX = [mx + (domX[0] - mx) * factor, mx + (domX[1] - mx) * factor];
    domY = [my + (domY[0] - my) * factor, my + (domY[1] - my) * factor];
  }
  programarRedibujo("zoom");
  programarFinal();             // cada rueda reinicia el debounce; al parar, refina
}, { passive: false });

// ── Navegación con teclado (WASD / flechas), alternativa al pan con ratón ──
// El canvas se hace enfocable: al hacer clic en él (que ya inicia el pan con
// ratón) o tabular, recibe el teclado, y SÓLO la gráfica enfocada se mueve (no se
// roba el foco al editor de Obsidian ni interfiere con escribir en la nota).
// Mientras una tecla esté pulsada, un bucle de requestAnimationFrame desplaza la
// vista de forma CONTINUA (estilo videojuego). La velocidad es en píxeles/seg y se
// convierte a unidades de mundo con rx/ry, así el ritmo es el mismo a cualquier
// zoom; la diagonal se normaliza para no ir más rápido.
canvasGL.tabIndex = 0;
canvasGL.style.outline = "none";
const VEL_PAN_PX = 175;                       // velocidad de desplazamiento (px/seg)
const VEL_ZOOM_POR_SEG = 2.5;                 // factor de zoom por segundo (W/S en carril)
const MAPA_TECLAS: Record<string, string> = { // tecla → dirección
  w: "w", a: "a", s: "s", d: "d",
  arrowup: "w", arrowleft: "a", arrowdown: "s", arrowright: "d",
};
const teclasPan = new Set<string>();
let rafTeclado: number | null = null;
let ultimoTeclado = 0;

const pasoTeclado = (t: number) => {
  if (teclasPan.size === 0) {                  // sin teclas: cierra el bucle y refina
    rafTeclado = null;
    ultimoTeclado = 0;
    programarFinal();
    return;
  }
  const dt = ultimoTeclado ? Math.min(0.05, (t - ultimoTeclado) / 1000) : 0;
  ultimoTeclado = t;
  if (railX !== null) {
    // CARRIL activo: A/D viajan por la curva; W/S hacen zoom CONTINUO centrado en
    // el punto (la cámara lo sigue). Ambos pueden actuar a la vez sin interrupción.
    let dirX = 0;
    if (teclasPan.has("a")) dirX -= 1;         // A → recorrer hacia la izquierda
    if (teclasPan.has("d")) dirX += 1;         // D → recorrer hacia la derecha
    let dirZoom = 0;
    if (teclasPan.has("w")) dirZoom -= 1;      // W → acercar (reduce el rango)
    if (teclasPan.has("s")) dirZoom += 1;      // S → alejar (aumenta el rango)
    if (dt > 0 && (dirX !== 0 || dirZoom !== 0)) {
      let cambiado = false;
      if (dirX !== 0) {
        const delta = dirX * VEL_PAN_PX * dt * ((domX[1] - domX[0]) / W);
        // El guard de seguridad puede frenar el avance (función explosiva): en ese
        // caso el punto se queda en la última posición válida.
        if (avanzarRail(delta)) cambiado = true;
      }
      // Zoom continuo (exponencial → suave y sin saltos), centrado en el punto.
      const factor = dirZoom !== 0 ? Math.pow(VEL_ZOOM_POR_SEG, dirZoom * dt) : 1;
      if (dirZoom !== 0) cambiado = true;
      if (cambiado) {
        seguirRail(factor);                    // recentra en el punto y aplica el zoom a su alrededor
        dibujarOverlay();
        dibujarCurvaGL("pan");
      }
    }
  } else {
    // Navegación libre con WASD (sin carril).
    let mx = 0, my = 0;
    if (teclasPan.has("a")) mx -= 1;           // A → vista a la izquierda
    if (teclasPan.has("d")) mx += 1;           // D → vista a la derecha
    if (teclasPan.has("w")) my += 1;           // W → vista hacia arriba
    if (teclasPan.has("s")) my -= 1;           // S → vista hacia abajo
    if ((mx !== 0 || my !== 0) && dt > 0) {
      const norm = Math.hypot(mx, my);
      const desX = (mx / norm) * VEL_PAN_PX * dt * ((domX[1] - domX[0]) / W);
      const desY = (my / norm) * VEL_PAN_PX * dt * ((domY[1] - domY[0]) / H);
      domX = [domX[0] + desX, domX[1] + desX];
      domY = [domY[0] + desY, domY[1] + desY];
      dibujarOverlay();
      dibujarCurvaGL("pan");                   // calidad interactiva (rápida)
    }
  }
  rafTeclado = requestAnimationFrame(pasoTeclado);
};

canvasGL.addEventListener("keydown", e => {
  const dir = MAPA_TECLAS[e.key.toLowerCase()];
  if (!dir) return;
  e.preventDefault();                          // evita scroll de página con flechas
  e.stopPropagation();                         // no dispares atajos de Obsidian
  teclasPan.add(dir);
  if (rafTeclado === null) rafTeclado = requestAnimationFrame(pasoTeclado);
});
canvasGL.addEventListener("keyup", e => {
  const dir = MAPA_TECLAS[e.key.toLowerCase()];
  if (dir) { e.preventDefault(); teclasPan.delete(dir); }
});
// Realimentación visual de que la gráfica está activa para WASD; al perder el foco
// se limpian las teclas para que no queden "pegadas" si se soltó fuera del canvas.
canvasGL.addEventListener("focus", () => {
  canvasGL.style.outline = "1px solid rgba(100,150,255,0.35)";
});
canvasGL.addEventListener("blur", () => {
  canvasGL.style.outline = "none";
  teclasPan.clear();
});
limpieza.register(() => { if (rafTeclado !== null) cancelAnimationFrame(rafTeclado); });

// Botón "fijar punto" (⌖): ancla el ÚLTIMO punto del crosshair sobre la curva como
// un CARRIL (ver railX/seguirRail) y centra la vista en él; luego con A/D se viaja
// por la curva y la cámara sigue al punto (siempre sobre la línea). Mismo estilo que
// el botón ⓘ. Toggle: pulsar de nuevo lo libera. Va abajo-izquierda (ⓘ va dcha).
const btnFijar = wrapGrafica.createDiv({ text: "⌖" });
btnFijar.setAttribute("title", "Fijar la vista al punto del crosshair");
const estiloBtnFijar = (activo: boolean) => {
  btnFijar.style.cssText =
    "position:absolute; bottom:8px; left:8px; width:22px; height:22px; " +
    "display:flex; align-items:center; justify-content:center; font-size:14px; " +
    "line-height:1; border-radius:50%; cursor:pointer; user-select:none; z-index:5; " +
    (activo
      ? "color:rgba(20,20,20,0.95); background:rgba(255,170,60,0.95); " +
        "border:1px solid rgba(255,170,60,0.95);"
      : "color:rgba(255,200,130,0.95); background:rgba(30,30,30,0.85); " +
        "border:1px solid rgba(255,160,40,0.5);");
};
estiloBtnFijar(false);
if (degenerada) btnFijar.style.display = "none";

btnFijar.addEventListener("click", () => {
  if (railX !== null) {
    railX = null;                          // salir del modo seguimiento
    estiloBtnFijar(false);
    restaurarVistaInicial();               // restaura la vista por defecto (X e Y)
  } else {
    railX = 0;                             // empieza SIEMPRE en el origen x=0 (sin buscar)
    // Si f(0) es válida, centra la cámara en el punto; si es indef/peligro NO se
    // recentra (no hay Y válida): se deja la vista por defecto del motor.
    if (evaluarCarrilSeguro(0).estado === "ok") seguirRail();
    else restaurarVistaInicial();
    estiloBtnFijar(true);
    canvasGL.focus();                      // habilita A/D para recorrer la curva
  }
  dibujarOverlay();
  dibujarCurvaGL("inicio");                // pasada de máxima calidad tras recentrar
  dibujarCrosshair(cursorPx);
});
            // ── Fin zoom/pan ───────────────────────
          } // cierre del else (WebGL disponible)
          // ── Fin motor gráfico ──────────────────────

          // ── Botón de resumen de puntos notables ──
          // El panel inferior (.obsi-math-info) está oculto por CSS, así que
          // cuando un grupo (raíces o vértices) NO está en estado normal —periódico
          // ("infinitas") o excesivo ("demasiadas"), por lo que no se dibujan sus
          // marcadores para no saturar el plano— el resumen se ofrece en un pequeño
          // botón ⓘ sobre la gráfica. Al pulsarlo muestra/oculta un popover.
          const msgRaices =
            estadoRaices === "infinitas" ? "Raíces: infinitas"
            : estadoRaices === "demasiadas" ? "Raíces: demasiadas para mostrar"
            : null;
          const msgVertices =
            estadoVertices === "infinitas" ? "Vértices: infinitos"
            : estadoVertices === "demasiadas" ? "Vértices: demasiados para mostrar"
            : null;
          if (msgRaices || msgVertices) {
            const btnResumen = wrapGrafica.createDiv({ text: "ⓘ" });
            btnResumen.setAttribute("title", "Resumen de puntos notables");
            btnResumen.style.cssText =
              "position:absolute; bottom:8px; right:8px; width:22px; height:22px; " +
              "display:flex; align-items:center; justify-content:center; " +
              "font-size:14px; line-height:1; color:rgba(255,200,130,0.95); " +
              "background:rgba(30,30,30,0.85); border:1px solid rgba(255,160,40,0.5); " +
              "border-radius:50%; cursor:pointer; user-select:none; z-index:5;";

            const popResumen = wrapGrafica.createDiv();
            popResumen.style.cssText =
              "position:absolute; bottom:36px; right:8px; display:none; " +
              "max-width:230px; padding:8px 10px; box-sizing:border-box; " +
              "background:rgba(20,20,20,0.95); border:1px solid rgba(255,255,255,0.12); " +
              "border-radius:6px; font-size:11px; line-height:1.5; white-space:nowrap; " +
              "color:rgba(230,230,235,0.92); z-index:5; " +
              "box-shadow:0 4px 12px rgba(0,0,0,0.4);";

            if (msgRaices) popResumen.createEl("div", { text: msgRaices });
            if (msgVertices) popResumen.createEl("div", { text: msgVertices });

            btnResumen.addEventListener("click", e => {
              e.stopPropagation();
              popResumen.style.display = popResumen.style.display === "none" ? "block" : "none";
            });
          }

          // Análisis numérico - Cálculos
          const infoBox = contenedor.createDiv({ cls: "obsi-math-info" });

          let formaSimplificada = "";
          try { formaSimplificada = simplify(expr).toString(); }
          catch (e) { console.warn("ObsiMath: no se pudo simplificar", expr, e); }

          if (formaSimplificada === "0") {
            infoBox.createEl("p", { text: "Interseccion Y: (0, 0.0000)" });
            infoBox.createEl("p", { text: "Todos los valores de x son raices (funcion identicamente cero)" });
          } else {
            infoBox.createEl("p", {
              text: isFinite(interseccionY)
                ? `Interseccion Y: (0, ${interseccionY.toFixed(4)})`
                : "Interseccion Y: no definida (discontinuidad en x=0)",
            });

            if (estadoRaices === "infinitas") {
              infoBox.createEl("p", { text: "Raices: infinitas" });
            } else if (estadoRaices === "demasiadas") {
              infoBox.createEl("p", { text: "Raices: demasiadas para mostrar" });
            } else if (analisis.raices.length > 0) {
              infoBox.createEl("p", { text: "Raices: " + analisis.raices.map(r => r.toFixed(4)).join(", ") });
            } else {
              infoBox.createEl("p", { text: "No hay raices reales" });
            }

            if (estadoVertices === "infinitas") {
              infoBox.createEl("p", { text: "Vertices: infinitos" });
            } else if (estadoVertices === "demasiadas") {
              infoBox.createEl("p", { text: "Vertices: demasiados para mostrar" });
            } else {
              for (const v of analisis.vertices) {
                infoBox.createEl("p", {
                  text: `Vertice ${v.tipo}: (${v.x.toFixed(4)}, ${v.y.toFixed(4)})`,
                });
              }
            }
          }
        } catch (error) {
          contenedor.createEl("p", { text: "Error: " + (error as Error).message });
        }
  }
}
