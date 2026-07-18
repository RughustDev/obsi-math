// ─────────────────────────────────────────────
// host-obsidian · MotorExperimental (adaptador Plugin → motor nuevo)
// ─────────────────────────────────────────────
//
// ADAPTADOR del host. Su única responsabilidad es traducir el ciclo de vida de
// Obsidian (process(source, el, ctx)) a la infraestructura del motor nuevo, sin
// modificar ni el plugin ni el motor. Es la ÚNICA pieza que toca la API de
// Obsidian (cuarentena del host); el resto del motor es agnóstico del framework.
//
// Reproduce la presentación del GraphEngine original: panel LaTeX a la izquierda
// (mismo pipeline tipográfico, scroll con fades) y gráfica a la derecha, con las
// etiquetas formales para bloques vacíos o funciones degeneradas (0/0, √−1…).

import {
  MarkdownRenderChild,
  MarkdownRenderer,
  Plugin,
  type MarkdownPostProcessorContext,
} from "obsidian";

import { Camara } from "../motor/interaction/Camara";
import { Navegacion } from "../motor/interaction/Navegacion";
import { crearMotor, crearMotorSistema } from "../motor/app/composicion";
import { dividirEcuaciones } from "../motor/parsing/dividirEcuaciones";
import { construirObjeto } from "../motor/parsing/construirObjeto";
import { insertarProductoImplicito } from "../motor/parsing/productoImplicito";
import { funcionDelParametro, renombrarParametroAX } from "../motor/parsing/componentesParametricas";
import { aPantallaX } from "../motor/scene/viewport-utils";
import { formatearNumero } from "../motor/rendering/overlay/Overlay";
import { simplify } from "mathjs";
import { bloqueALatex } from "../latex";
import { despejarEcuaciones } from "../despejar";
import { simplificarEcuaciones } from "../simplificar";
import { extraerFuncion, derivarEcuacion, derivadaOperadorLatex, derivadaOperadorSimplificadoLatex, derivadaLatex } from "../derivar";
import {
  extraerIntegral, evaluarLimite, integralOperadorLatex, integralValorLatex,
  integralPrimitivaLatex, cuerpoAreaLatexExacto, etiquetaIntegral,
} from "../integral";
import { AJUSTES_POR_DEFECTO, type AjustesTransformaciones } from "./ajustes";
import { t, localizarVelo } from "../i18n";
import { normalizarEntrada, contieneYLibre, comandosNoSoportados } from "../parser";
import { compilarFuncion } from "../evaluador";
import { clasificarDegenerada, type FuncionDegenerada } from "../degeneradas";
import { analizarFuncion, tieneTrigonometria, estadoGrupo, raicesALatex } from "../analisis";

// Estilo visual de una tarjeta de fórmula del panel izquierdo. Enum (no un booleano
// `alwaysFramed`) para que el catálogo de estilos crezca sin multiplicar banderas: hoy
// "enmarcado" (caja redondeada, la ÚNICA que usa el panel: regla "una expresión = una
// tarjeta") y "plano" (sin recuadro, llena el hueco), reservado para futuros paneles.
type EstiloTarjeta = "plano" | "enmarcado";

export class MotorExperimental {
  // `sistema=false` → bloque obs-graph (una función). `sistema=true` → bloque
  // obs-system (varias ecuaciones, cada una con su color). `derivada=true` → bloque
  // obs-derivate: como obs-graph (una función, sistema=false) pero el plano grafica la
  // DERIVADA f'(x) de lo escrito y el panel alterna operador/derivada (ver `process`).
  // `obtenerAjustes`: getter de las preferencias VIVAS del plugin (no una foto), para que
  // un cambio en la pestaña de configuración afecte a los bloques que se re-rendericen.
  // Por defecto, sin transformaciones automáticas (comportamiento clásico).
  // `integral=true` → bloque obs-integral: como obs-graph (una función, sistema=false) pero
  // el plano grafica el INTEGRANDO f(x) y SOMBREA ∫ₐᵇ f dx; el panel alterna operador/valor.
  // Se añade como ÚLTIMO parámetro (opcional) para no desplazar las llamadas existentes.
  constructor(
    private readonly plugin: Plugin,
    private readonly sistema = false,
    private readonly derivada = false,
    private readonly obtenerAjustes: () => AjustesTransformaciones = () => AJUSTES_POR_DEFECTO,
    private readonly integral = false
  ) {}

  async process(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    const contenedor = el.createDiv({ cls: "lmath-container" });
    const limpieza = new MarkdownRenderChild(contenedor);
    ctx.addChild(limpieza);

    // Ecuaciones del bloque. obs-graph solo grafica la PRIMERA, así que su panel
    // LaTeX y su clasificación también miran solo esa (coherencia panel↔plano).
    const ecuaciones = dividirEcuaciones(source);
    const visibles = this.sistema ? ecuaciones : ecuaciones.slice(0, 1);

    // ── obs-derivate: el plano grafica la DERIVADA f'(x) de la 1ª función, no lo
    // escrito. `graficadas`/`fuenteGrafico` son la ecuación derivada que alimenta al
    // motor, la clasificación de bloque y el ⓘ; el panel (montarPanelDerivada) muestra
    // el operador/derivada a partir de lo ORIGINAL (`visibles`). Si no se puede derivar
    // (o el bloque está vacío) → sin ecuación graficada: cae a la etiqueta "Sin función".
    // La función ESCRITA, clasificada antes de derivar: si no toma ningún valor real (0/0,
    // √−1, log base 1) NO hay nada que derivar. Sin esta guarda, mathjs derivaba la forma
    // indeterminada como si fuera álgebra (`d/dx(0/0)` → `0`) y el bloque mostraba una
    // derivada inventada —"f'(x) = 0"— y graficaba la recta y=0, sin velo ni aviso: la
    // clasificación miraba la DERIVADA (ya reducida a `0`, perfectamente sana), no la función.
    // OJO: se clasifica la FUNCIÓN EXTRAÍDA (`extraerFuncion`), no la ecuación escrita. Si el
    // usuario escribe el propio operador (`\frac{d}{dx}x^{2}`), la ecuación cruda normaliza a
    // `(d)/(d*x)*x^2` —con `d` como símbolo libre → NaN en todo x— y el bloque se velaba como
    // "Indeterminada" pese a ser una derivada perfectamente válida. `extraerFuncion` es quien
    // sabe quitar el operador (§6.4); a partir de ahí clasificamos la f(x) de verdad.
    const funcionEscrita = this.derivada && visibles.length ? extraerFuncion(visibles[0]) : null;
    const degeneradaOrigen = funcionEscrita ? this.degeneradaDeEcuacion(funcionEscrita) : null;
    const derivadaExpr = this.derivada && visibles.length && !degeneradaOrigen
      ? derivarEcuacion(visibles[0]) : null;

    // ── obs-integral: el plano grafica el INTEGRANDO f(x) de `\int_a^b f dx` (no lo escrito
    // como bloque). `integralDatos` descompone la notación; `graficadas`/`fuenteGrafico` son el
    // integrando que alimenta el motor, la clasificación y el sombreado. El VALOR ∫ₐᵇ y el
    // panel operador/valor los monta montarPanelIntegral. Si no hay integral válida → sin
    // ecuación graficada → etiqueta "Sin integral".
    const integralDatos = this.integral ? extraerIntegral(source) : null;

    const graficadas = this.integral
      ? (integralDatos ? [integralDatos.integrando] : [])
      : this.derivada ? (derivadaExpr ? [derivadaExpr] : []) : visibles;
    const fuenteGrafico = this.integral
      ? (integralDatos?.integrando ?? "")
      : this.derivada ? (derivadaExpr ?? "") : source;

    // ── Panel LaTeX (mitad izquierda), mismo pipeline y UX que el GraphEngine ──
    if (this.integral) await this.montarPanelIntegral(contenedor, source, ctx, limpieza);
    else if (this.derivada) await this.montarPanelDerivada(contenedor, visibles, ctx, limpieza);
    else await this.montarPanelLatex(contenedor, visibles, ctx, limpieza);

    // ── Gráfica (derecha). MISMO layout que el motor original: el panel LaTeX
    // pide width:50% y la gráfica width:100% inline; en el flex row del contenedor
    // eso reparte ⅓ para la fórmula y ⅔ para el plano (50 : 100).
    const H = 261;
    const wrap = contenedor.createDiv({ cls: "lmath-grafica" });
    wrap.style.cssText = `position:relative; width:100%; height:${H}px;`;

    // Marca del motor experimental: badge discreto (el texto completo, en tooltip)
    // para no alterar el layout de dos mitades del contenedor original.
    const badge = wrap.createDiv({ text: "⚙" });
    badge.setAttribute(
      "title",
      this.sistema
        ? t().badge.sistema
        : this.integral
          ? t().badge.integral
          : t().badge.general
    );
    badge.style.cssText =
      "position:absolute; top:6px; right:8px; font-size:12px; z-index:5; " +
      "color:rgba(120,180,255,0.55); cursor:default; user-select:none;";

    const canvas = wrap.createEl("canvas");
    // cursor:none oculta el cursor del sistema SOLO sobre el área del plano (los
    // botones, con su propio cursor:pointer, no se ven afectados). En su lugar el
    // motor dibuja su propia cruz (Crosshair.dibujarCursorCruz), igual que obs-system.
    canvas.style.cssText =
      "position:absolute; top:0; left:0; width:100%; height:100%; cursor:none;";

    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) {
      wrap.createEl("p", { text: t().canvasNoDisponible });
      return;
    }

    // Composición del motor (composition root) + cámara (interacción). obs-graph
    // grafica UNA función; obs-system grafica el SISTEMA (varias ecuaciones/colores).
    const escena = this.sistema ? crearMotorSistema(ctx2d, source) : crearMotor(ctx2d, fuenteGrafico);

    // obs-integral: si los límites evalúan a número, marca la escena para SOMBREAR ∫ₐᵇ
    // (el recorte del integrando lo hace la escena en `actualizar`). Con límites simbólicos/∞
    // no hay franja concreta → no se sombrea (el panel muestra la etiqueta "Límites no numéricos").
    if (this.integral && integralDatos) {
      const a = evaluarLimite(integralDatos.a), b = evaluarLimite(integralDatos.b);
      if (a !== null && b !== null) escena.fijarIntegral(a, b);
    }

    // Bloque vacío o función degenerada (0/0, log base 1, √−1…): el plano queda
    // interactivo (zoom/pan) pero oscurecido, con la etiqueta formal flotando
    // delante (mismas capas pointer-events:none que el GraphEngine original).
    // `clasificarBloque`/`degeneradaOrigen` pueden traer etiquetas del NÚCLEO en español
    // canónico (degeneradas.ts / integral.ts); `localizarVelo` las pasa al idioma activo
    // (las del propio host ya salen traducidas por `t()`, y las deja intactas).
    const degeneradaCruda = degeneradaOrigen ?? this.clasificarBloque(graficadas, source);
    const degenerada = degeneradaCruda ? localizarVelo(degeneradaCruda) : null;
    if (degenerada) {
      const velo = wrap.createDiv();
      velo.style.cssText =
        "position:absolute; inset:0; background:rgba(18,18,18,0.55); " +
        "pointer-events:none;";
      const msg = wrap.createDiv();
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

    // Botón ⓘ de obs-graph: resumen de puntos notables de la función (intersección
    // Y, raíces, vértices), con los estados "infinitas"/"demasiadas" del análisis.
    // Solo para una función explícita graficable (no en sistemas ni en degeneradas).
    const exprGraph = this.exprExplicita(graficadas);
    if (exprGraph && !degenerada) this.montarBotonInfo(wrap, exprGraph, ctx);

    // La cámara emite dos eventos: onViewport (recomputar geometría + pintar) y
    // onCursor (solo pintar el crosshair). `pintar` reusa la geometría cacheada.
    // En modo carril, el crosshair se ancla en railX (no en el ratón).
    let camara!: Camara;
    let navegacion!: Navegacion;
    const pintar = () => {
      const vp = camara.viewport();
      // Preferencia de marcadores, leída VIVA en cada pintado (asignar un booleano es
      // gratis): así apagar el ajuste se ve en el siguiente repintado del bloque —basta
      // pasar el ratón por el plano— sin recargar el plugin.
      escena.mostrarNotables(this.obtenerAjustes().puntosNotables);
      // Posición REAL del ratón para la cruz del cursor (en ambos modos).
      const mx = camara.cursorPx();
      const my = camara.cursorPy();
      if (navegacion.railOn) {
        // Crosshair matemático anclado en railX con railY explícito (mismo valor
        // que centró la cámara) → punto centrado, nunca sale del viewport. La cruz
        // del cursor, en cambio, sigue al ratón.
        escena.pintar(vp, aPantallaX(vp, navegacion.railX), true, navegacion.railY, mx, my);
      } else {
        escena.pintar(vp, mx, false, undefined, mx, my);
      }
    };
    // ── Renderizado progresivo en dos pasadas (portado de GraphEngine) ──────────
    // Pasada INTERACTIVA (rápida): durante pan/zoom/carril. Coalescida por rAF
    // (a lo sumo un redibujo por frame); muestreo ligero y SIN puntos notables ni
    // asíntotas (las omite el proveedor en pasada "interactiva").
    // Pasada FINAL (máxima calidad): 150ms después de que la cámara deja de
    // moverse; muestreo denso + puntos notables + asíntotas.
    // Instrumentación temporal de rendimiento: separa el coste de RECOMPUTAR
    // (muestreo, mathjs) del de PINTAR (Canvas2D). Pon DIAG=false para silenciar.
    const DIAG = false;
    let accCalc = 0, accPaint = 0, maxCalc = 0, maxPaint = 0, nFrames = 0;
    const diag = (etiqueta: string, dCalc: number, dPaint: number) => {
      if (!DIAG) return;
      accCalc += dCalc; accPaint += dPaint;
      if (dCalc > maxCalc) maxCalc = dCalc;
      if (dPaint > maxPaint) maxPaint = dPaint;
      if (++nFrames >= 30) {
        console.log(
          `[motor ${etiqueta}] ${nFrames}f · calc avg ${(accCalc / nFrames).toFixed(2)}ms max ${maxCalc.toFixed(2)} · ` +
          `paint avg ${(accPaint / nFrames).toFixed(2)}ms max ${maxPaint.toFixed(2)}`
        );
        accCalc = accPaint = maxCalc = maxPaint = nFrames = 0;
      }
    };

    let rafId: number | null = null;
    let pendienteRecomputar = false;
    const ejecutarFrame = () => {
      rafId = null;
      const t0 = performance.now();
      if (pendienteRecomputar) {
        escena.actualizar(camara.viewport(), "interactiva");
        pendienteRecomputar = false;
      }
      const t1 = performance.now();
      pintar();
      const t2 = performance.now();
      diag("interactiva", t1 - t0, t2 - t1);
    };
    const programarRedibujo = () => {   // pan/zoom/carril → recomputar (ligero) + pintar
      pendienteRecomputar = true;
      if (rafId === null) rafId = requestAnimationFrame(ejecutarFrame);
    };
    const programarPintado = () => {    // solo cursor → repintar, sin recomputar
      if (rafId === null) rafId = requestAnimationFrame(ejecutarFrame);
    };
    let timerFinal: number | null = null;
    // Aviso al panel de solución (ⓘ, solo sistemas) de que hay pasada final nueva:
    // las intersecciones pudieron cambiar. Se asigna al crear el panel, más abajo.
    let alRecalcularFinal: (() => void) | null = null;
    const programarFinal = () => {      // al detenerse la cámara → pasada de máxima calidad
      if (timerFinal !== null) clearTimeout(timerFinal);
      timerFinal = window.setTimeout(() => {
        timerFinal = null;
        escena.actualizar(camara.viewport(), "final");
        pintar();
        alRecalcularFinal?.();
      }, 150);
    };
    limpieza.register(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (timerFinal !== null) clearTimeout(timerFinal);
    });

    camara = new Camara(canvas, H, {
      // pan/zoom: pasada interactiva mientras dura el gesto + programa la final
      // (cada evento reinicia el debounce → la final se dispara al parar).
      onViewport: () => { programarRedibujo(); programarFinal(); },
      onCursor: () => programarPintado(),
    });

    // Carril (teclado): misma estrategia. Su bucle llama a este callback en cada
    // frame de movimiento (pasada interactiva) y una vez más al soltar las teclas;
    // como cada llamada reinicia programarFinal, la pasada final se dispara al parar.
    navegacion = new Navegacion(canvas, camara, {
      y: (x) => escena.yEnCurva(x),
      avanzarArco: (x, y, deltaPx, vp, recortar) => escena.avanzarArcoEnCurva(x, y, deltaPx, vp, recortar),
      hayVecina: (x, y, dir, vp) => escena.hayRamaVecinaCarril(x, y, dir, vp),
      tieneAsintotasVerticales: () => escena.tieneAsintotasVerticales(),
    }, () => {
      escena.actualizar(camara.viewport(), "interactiva");
      pintar();
      programarFinal();
    });
    limpieza.register(() => navegacion.destruir());

    // Ajuste de la resolución física del canvas al tamaño real en pantalla, y
    // primer render (calcular + pintar). Mismo patrón de ciclo de vida que el
    // motor antiguo (host).
    // La métrica se MIDE del canvas (su caja CSS real), no se asume: el alto nominal H
    // y el dpr del primer render caducan. Ctrl+rueda (zoom de la app) cambia el
    // devicePixelRatio, y un tema que exprese el ancho de nota en rem/em
    // (--file-line-width) reflowa el bloque al cambiar la fuente. Si el búfer del canvas
    // conserva una métrica vieja, el navegador estira ese mapa de bits hasta la caja CSS
    // nueva: la gráfica sale DEFORMADA (celdas rectangulares en vez de cuadradas).
    let W = 0, Hcss = 0, dprPrev = 0;
    const redimensionar = () => {
      const caja = canvas.getBoundingClientRect();
      const ancho = Math.max(1, Math.round(caja.width || wrap.clientWidth || 768));
      const alto = Math.max(1, Math.round(caja.height || H));
      const dpr = Math.ceil(window.devicePixelRatio || 1);
      if (ancho === W && alto === Hcss && dpr === dprPrev) return;
      W = ancho; Hcss = alto; dprPrev = dpr;
      camara.redimensionar(ancho, alto, dpr);
      canvas.width = ancho * dpr;
      canvas.height = alto * dpr;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      escena.actualizar(camara.viewport());
      pintar();
    };
    redimensionar();

    // AUTOENCUADRE (ajuste `encuadreAuto`): la vista por defecto ([-7,7]) le queda enorme a una
    // curva ACOTADA y pequeña (corazón, lemniscata, astroide, círculo unidad), que sale como un
    // garabato en el centro. Se decide UNA SOLA VEZ, aquí, sobre la geometría que `redimensionar()`
    // acaba de trazar con la vista por defecto: solo ACERCA (si la curva toca un borde puede
    // continuar fuera → no se toca nada) y solo escala (centro en el origen: los ejes siguen en
    // cuadro). No puede vivir en el callback de la cámara: reencuadrar en cada pan/zoom impediría
    // al usuario alejarse de la curva. Acercar solo MEJORA el descubrimiento (más semillas por
    // curva), así que la geometría de la segunda pasada nunca es peor que la de la primera.
    if (this.obtenerAjustes().encuadreAuto) {
      const semiY = escena.encuadreAutomatico(camara.viewport());
      if (semiY !== null) {
        camara.fijarEncuadreBase(semiY);
        escena.actualizar(camara.viewport());
        pintar();
      }
    }

    const observador = new ResizeObserver(() => redimensionar());
    observador.observe(wrap);
    limpieza.register(() => observador.disconnect());
    // El zoom de la app puede cambiar SOLO el dpr (misma caja CSS): el ResizeObserver
    // no se entera, pero `resize` de la ventana sí llega. Sin esto, el búfer se queda a
    // la resolución vieja (gráfica borrosa) tras un Ctrl+rueda que no reflowe el bloque.
    window.addEventListener("resize", redimensionar);
    limpieza.register(() => window.removeEventListener("resize", redimensionar));
    limpieza.register(() => camara.destruir());

    // ── Botones 🏠︎ (vista base) y + / − (zoom centrado en la vista) ───────────────
    // Zoom y reencuadre sin rueda ni teclado (portátiles con trackpad, táctil), al estilo de
    // GeoGebra/Desmos: cada clic de + / − equivale a UNA muesca de rueda, pero anclada al CENTRO
    // de la vista en vez de al cursor (Camara.zoomCentrado) → lo que estás mirando sigue en el
    // sitio; 🏠︎ deshace zoom Y pan y devuelve la vista base del bloque (la del autoencuadre, si
    // lo hubo). Los tres animan la vista (rAF, perfil exponencial: rápido y frenando hasta clavar
    // el destino) y emiten onViewport por frame, así que el redibujo lo pide la cámara misma.
    // Apilados bajo el badge ⚙ (esquina superior derecha), que ocupa `top:6px`.
    const estiloZoom = (arriba: number) =>
      "position:absolute; right:8px; top:" + arriba + "px; width:22px; height:22px; " +
      "display:flex; align-items:center; justify-content:center; font-size:15px; " +
      "line-height:1; border-radius:50%; cursor:pointer; user-select:none; z-index:5; " +
      "color:rgba(220,220,220,0.85); background:rgba(30,30,30,0.85); " +
      "border:1px solid rgba(255,255,255,0.18);";
    const btnInicio = wrap.createDiv({ text: "🏠︎" });
    btnInicio.setAttribute("title", t().botones.vistaInicial);
    // El glifo de casa es EMOJI (🏠︎): la fuente lo pinta con su propia caja, más grande y con más
    // tinta que un signo tipográfico como + o −, así que a la misma medida se ve desproporcionado
    // dentro del botón. Se le baja el cuerpo para que pese lo mismo que sus vecinos.
    btnInicio.style.cssText = estiloZoom(26) + "font-size:12px;";
    const btnMas = wrap.createDiv({ text: "+" });
    btnMas.setAttribute("title", t().botones.acercar);
    btnMas.style.cssText = estiloZoom(52);
    const btnMenos = wrap.createDiv({ text: "−" });
    btnMenos.setAttribute("title", t().botones.alejar);
    btnMenos.style.cssText = estiloZoom(78);
    btnInicio.addEventListener("click", () => camara.volverAVistaBase());
    btnMas.addEventListener("click", () => camara.zoomCentrado(true));
    btnMenos.addEventListener("click", () => camara.zoomCentrado(false));

    // ── Botón ⌖ (carril) + botones de SELECCIÓN de línea ────────────────────────
    // El crosshair y el carril siguen UNA curva (la seleccionada en la Escena). Con
    // varias ecuaciones (obs-system) hay un botón de color por curva para elegir cuál;
    // el ⌖ solo se muestra si la curva seleccionada es RECORRIBLE como y=f(x) (círculo,
    // separable transpuesta tan y=x o paramétrica → no; el crosshair ya se auto-oculta
    // al no haber y). `redimensionar()` ya corrió una pasada, así que la recorribilidad
    // (propiedad del TIPO de curva, no del zoom) es estable aquí.
    const btnCarril = wrap.createDiv();
    btnCarril.setAttribute("title", t().botones.carril);
    // Mismo formato EXACTO que el botón ⌖ (btnFijar) de obs-graph/GraphEngine.
    const estiloBtn = (activo: boolean) => {
      btnCarril.style.cssText =
        "position:absolute; bottom:8px; left:8px; width:22px; height:22px; " +
        "display:flex; align-items:center; justify-content:center; font-size:14px; " +
        "line-height:1; border-radius:50%; cursor:pointer; user-select:none; z-index:5; " +
        (activo
          ? "color:rgba(20,20,20,0.95); background:rgba(255,170,60,0.95); " +
            "border:1px solid rgba(255,170,60,0.95);"
          : "color:rgba(255,200,130,0.95); background:rgba(30,30,30,0.85); " +
            "border:1px solid rgba(255,160,40,0.5);");
    };
    estiloBtn(false);
    // Glifo ⌖ subido SOLO en vertical (métrica de la fuente). El span persiste aunque
    // estiloBtn reescriba el cssText del div en cada toggle.
    btnCarril.createSpan({ text: "⌖" }).style.cssText =
      "line-height:1; transform:translateY(-1px);";
    btnCarril.addEventListener("click", () => {
      navegacion.alternarCarril();
      estiloBtn(navegacion.railOn);
    });

    // Selección de línea: un botón de color por ecuación (solo si hay ≥2). El botón
    // seleccionado lleva borde blanco; al pulsarlo, crosshair y carril pasan a seguir
    // esa curva (Escena.seleccionar) y se resincroniza la visibilidad del ⌖.
    const colores = escena.colores();
    const estilosSel: Array<(sel: boolean) => void> = [];
    if (colores.length >= 2) {
      colores.forEach((c, i) => {
        const b = wrap.createDiv();
        b.setAttribute("title", t().botones.seleccionarEcuacion(i + 1));
        const rgb = `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
        const estilo = (sel: boolean) => {
          b.style.cssText =
            `position:absolute; bottom:10px; left:${38 + i * 24}px; width:18px; height:18px; ` +
            "border-radius:50%; cursor:pointer; user-select:none; z-index:5; box-sizing:border-box; " +
            `background:${rgb}; ` +
            (sel ? "border:2px solid rgba(255,255,255,0.95);" : "border:2px solid rgba(0,0,0,0.35);");
        };
        estilo(i === escena.seleccionActual());
        b.addEventListener("click", () => {
          escena.seleccionar(i);
          sincronizarControles();
          pintar();
        });
        estilosSel.push(estilo);
      });
    }

    // Resalta la curva elegida y muestra/oculta el ⌖ según su recorribilidad; si deja
    // de ser recorrible con el carril activo, lo apaga.
    const sincronizarControles = () => {
      const sel = escena.seleccionActual();
      estilosSel.forEach((estilo, i) => estilo(i === sel));
      const recorrible = escena.curvaRecorrible();
      if (!recorrible && navegacion.railOn) { navegacion.alternarCarril(); estiloBtn(false); }
      btnCarril.style.display = recorrible ? "flex" : "none";
    };
    sincronizarControles();

    // ── Botón de solución (ⓘ) + popover: intersecciones del sistema ─────────
    // Reincorpora el panel de solución del obs-system original (retirado en la
    // Etapa 10 con el SystemEngine), ahora derivado de la geometría: lista las
    // intersecciones que la Escena calculó sobre las Ramas trazadas (las de la
    // vista actual, en la última pasada final). Mismos estilos que el original.
    if (this.sistema) {
      const btnSolucion = wrap.createDiv({ text: "ⓘ" });
      btnSolucion.setAttribute("title", t().botones.solucionesSistema);
      btnSolucion.style.cssText =
        "position:absolute; bottom:8px; right:8px; width:22px; height:22px; " +
        "display:flex; align-items:center; justify-content:center; font-size:14px; " +
        "line-height:1; color:rgba(255,200,130,0.95); background:rgba(30,30,30,0.85); " +
        "border:1px solid rgba(255,160,40,0.5); border-radius:50%; cursor:pointer; " +
        "user-select:none; z-index:5;";

      const popSolucion = wrap.createDiv();
      popSolucion.style.cssText =
        "position:absolute; bottom:36px; right:8px; display:none; max-width:260px; " +
        "max-height:200px; overflow-y:auto; padding:8px 10px; box-sizing:border-box; " +
        "background:rgba(20,20,20,0.95); border:1px solid rgba(255,255,255,0.12); " +
        "border-radius:6px; font-size:11px; line-height:1.5; " +
        "color:rgba(230,230,235,0.92); z-index:5; box-shadow:0 4px 12px rgba(0,0,0,0.4);";

      // ¿El sistema es PERIÓDICO? (alguna ecuación usa una función trig como sin/
      // cos/tan…). Un sistema periódico repite sus soluciones sin fin → si además
      // hay varias en la vista, son INFINITAS (discretas, pero ilimitadas), que es
      // distinto del solape continuo y de la mera saturación del cap. Mismo criterio
      // que el motor antiguo para las raíces de una trig (ver analisis.estadoGrupo).
      const sistemaPeriodico = visibles.some((ec) =>
        ec.split("=").some((lado) =>
          tieneTrigonometria(insertarProductoImplicito(normalizarEntrada(lado.trim())))));
      const MIN_PERIODICO = 3; // nº de soluciones en vista a partir del cual "repite"

      const MAX_LISTA = 20; // cap visual; los marcadores del plano no se capan
      const refrescarSolucion = () => {
        popSolucion.empty();
        // Un sistema necesita ≥2 ecuaciones: sin ellas no hay soluciones que buscar.
        if (visibles.length === 0) {
          popSolucion.createEl("div", { text: t().solucion.sinSistema });
          return;
        }
        if (visibles.length === 1) {
          popSolucion.createEl("div", { text: t().solucion.sistemaIncompleto });
          return;
        }
        // Infinitas (curvas que coinciden en un tramo) ANTES que la saturación: son
        // cosas distintas —una solución continua, no "muchos puntos aislados".
        if (escena.solucionesInfinitas()) {
          popSolucion.createEl("div", { text: t().solucion.infinitasCoinciden });
          return;
        }
        const pts = escena.intersecciones();
        // Infinitas por PERIODICIDAD: un sistema con función trig que muestra varias
        // soluciones (o satura el cap) las repite sin fin. Va ANTES de "demasiadas":
        // esto es infinito de verdad, no solo muchas finitas por estar muy alejado.
        if (sistemaPeriodico && (escena.interseccionesSaturadas() || pts.length >= MIN_PERIODICO)) {
          popSolucion.createEl("div", { text: t().solucion.infinitasPeriodico });
          return;
        }
        if (escena.interseccionesSaturadas()) {
          popSolucion.createEl("div", { text: t().solucion.demasiadas });
          return;
        }
        if (pts.length === 0) {
          popSolucion.createEl("div", { text: t().solucion.sinSolucion });
          return;
        }
        popSolucion.createEl("div", {
          text: pts.length === 1 ? t().solucion.unaSolucion : t().solucion.nSoluciones(pts.length),
          attr: { style: "font-weight:600; margin-bottom:4px;" },
        });
        for (const p of pts.slice(0, MAX_LISTA)) {
          popSolucion.createEl("div", {
            text: `(${formatearNumero(p.x)}, ${formatearNumero(p.y)})`,
          });
        }
        if (pts.length > MAX_LISTA) {
          popSolucion.createEl("div", {
            text: t().solucion.yMas(pts.length - MAX_LISTA),
            attr: { style: "opacity:0.6;" },
          });
        }
        popSolucion.createEl("div", {
          text: t().solucion.enVista,
          attr: { style: "margin-top:4px; opacity:0.6;" },
        });
      };
      // Si el popover está abierto cuando aterriza una pasada final, se refresca.
      alRecalcularFinal = () => {
        if (popSolucion.style.display !== "none") refrescarSolucion();
      };
      btnSolucion.addEventListener("click", (e) => {
        e.stopPropagation();
        const abierto = popSolucion.style.display !== "none";
        if (!abierto) refrescarSolucion();
        popSolucion.style.display = abierto ? "none" : "block";
      });
    }

    // ── Botón ⓘ GEOMÉTRICO (obs-graph, curva NO explícita) ──────────────────
    // El resumen clásico (montarBotonInfo) evalúa f(x) y solo existe para y=f(x).
    // Para las demás curvas de obs-graph (implícitas, trig periódicas: tan(y)=x,
    // tan(y)·(x²+1)=√(x+1)…) el resumen se deriva de la GEOMETRÍA cacheada
    // (filosofía del motor: la interacción lee la Rama), con los mismos estados
    // "infinitas"/"demasiadas" (estadoGrupo + presencia de trig en la ecuación).
    // Se recalcula al abrir el popover y en cada pasada final con él abierto.
    if (!this.sistema && !degenerada && graficadas.length > 0 && !exprGraph) {
      // ¿La curva está ACOTADA por su período? Las paramétricas/polares se trazan
      // sobre UN período (dominio [0, 2π] por defecto): son un conjunto acotado, así
      // que sus puntos notables son FINITOS por construcción —la periodicidad en t/θ
      // hace que la curva se RE-RECORRA, no que sume cruces nuevos (una Lissajous
      // (sin 2t, sin 3t) cruza cada eje un nº fijo de veces por período)—. La
      // heurística "trig ⇒ infinitas" (estadoGrupo) SOLO vale para dominios NO
      // acotados en x (y=f(x), implícitas sobre x∈ℝ), donde una trig sí oscila sin
      // fin. Para las acotadas se cuentan los eventos de un período y se DEDUPLICAN
      // por posición (lo hace resumenPuntosNotables, tolerancia periódica espacial) →
      // nunca "infinitas": conteos finitos, o "demasiadas" si de verdad hay muchos.
      let tipo: string;
      try { tipo = construirObjeto(graficadas[0], "info").tipo; } catch { tipo = ""; }
      const acotadaPorPeriodo = tipo === "parametrica" || tipo === "polar";

      const esTrig = !acotadaPorPeriodo && graficadas[0].split("=").some((lado) =>
        tieneTrigonometria(insertarProductoImplicito(normalizarEntrada(lado.trim()))));

      const btnInfo = wrap.createDiv();
      btnInfo.setAttribute("title", t().botones.resumenNotables);
      btnInfo.style.cssText =
        "position:absolute; bottom:8px; right:8px; width:22px; height:22px; " +
        "display:flex; align-items:center; justify-content:center; font-size:14px; " +
        "line-height:1; color:rgba(255,200,130,0.95); background:rgba(30,30,30,0.85); " +
        "border:1px solid rgba(255,160,40,0.5); border-radius:50%; cursor:pointer; " +
        "user-select:none; z-index:5;";
      btnInfo.createSpan({ text: "ⓘ" }).style.cssText = "line-height:1; transform:translateY(-1px);";

      const pop = wrap.createDiv();
      pop.style.cssText =
        "position:absolute; bottom:36px; right:8px; display:none; max-width:260px; " +
        "max-height:200px; overflow-y:auto; padding:8px 10px; box-sizing:border-box; " +
        "background:rgba(20,20,20,0.95); border:1px solid rgba(255,255,255,0.12); " +
        "border-radius:6px; font-size:11px; line-height:1.5; " +
        "color:rgba(230,230,235,0.92); z-index:5; box-shadow:0 4px 12px rgba(0,0,0,0.4);";

      const refrescarInfo = () => {
        pop.empty();
        const r = escena.resumenNotables(camara.viewport());
        const lineas: string[] = [];

        const T = t().resumen;
        const estIY = estadoGrupo(r.interseccionesY.length, esTrig);
        if (estIY === "infinitas") lineas.push(T.interseccionesYInfinitas);
        else if (estIY === "demasiadas") lineas.push(T.interseccionesYDemasiadas);
        else if (r.interseccionesY.length > 0)
          for (const p of r.interseccionesY)
            lineas.push(T.interseccionY(p.punto.y.toFixed(4)));
        else lineas.push(T.noCortaY);

        const estR = estadoGrupo(r.raices.length, esTrig);
        if (estR === "infinitas") lineas.push(T.raicesInfinitas);
        else if (estR === "demasiadas") lineas.push(T.raicesDemasiadas);
        else if (r.raices.length > 0)
          lineas.push(T.raicesPrefijo + r.raices.map((p) => p.punto.x.toFixed(4)).join(", "));
        else lineas.push(T.noRaices);

        const estV = estadoGrupo(r.vertices.length, esTrig);
        if (estV === "infinitas") lineas.push(T.verticesInfinitos);
        else if (estV === "demasiadas") lineas.push(T.verticesDemasiados);
        else if (r.vertices.length > 0)
          for (const v of r.vertices)
            lineas.push(T.vertice(v.punto.x.toFixed(4), v.punto.y.toFixed(4)));
        else lineas.push(T.noVertices);

        for (const linea of lineas) pop.createEl("div", { text: linea });
        pop.createEl("div", {
          text: T.enVista,
          attr: { style: "margin-top:4px; opacity:0.6;" },
        });
      };
      alRecalcularFinal = () => {
        if (pop.style.display !== "none") refrescarInfo();
      };
      btnInfo.addEventListener("click", (e) => {
        e.stopPropagation();
        const abierto = pop.style.display !== "none";
        if (!abierto) refrescarInfo();
        pop.style.display = abierto ? "none" : "block";
      });
    }
  }

  /**
   * Crea el "scroller" del panel izquierdo (portado del GraphEngine): contenedor
   * posicionado que aloja una o varias ÁREAS de scroll horizontal, cada una con su
   * overlay de fade en los bordes. El overlay tiene que ser HERMANO del área
   * scrolleable (no hijo): un elemento absolute dentro de un scroller se desplaza
   * junto al contenido y el fade "viajaría". Devuelve `panelLatex` (para colgar la
   * barra de toggle encima) y `renderLatex` (pinta uno o varios LaTeX).
   *
   * Regla de presentación UNIFICADA (todos los bloques): **una expresión = una
   * tarjeta**. `renderLatex` crea un área INDEPENDIENTE por fórmula —cada una con su
   * PROPIA scrollbar, fades, centrado, rueda y observador de tamaño—, enmarcada en una
   * caja redondeada un punto más oscura que el panel. Con una fórmula, esa única
   * tarjeta ocupa el panel (obs-graph, obs-system, y los operadores/valores simples de
   * obs-derivate/obs-integral); con varias (vistas "ambas"), se apilan en columna y se
   * desplaza una sin mover la otra. No depende del NÚMERO de fórmulas: el estilo de
   * tarjeta es fijo ("enmarcado"). Común a `montarPanelLatex` (toggle
   * Original/Opciones), `montarPanelDerivada` y `montarPanelIntegral`.
   */
  private crearScrollerLatex(
    contenedor: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    limpieza: MarkdownRenderChild
  ): { panelLatex: HTMLElement; renderLatex: (latex: string | readonly string[]) => Promise<void> } {
    // Constantes de layout del panel izquierdo. Se derivan entre sí para que el alto de
    // una tarjeta única case EXACTO con el de una ranura del par "ambas".
    const ALTO_PANEL = 261;   // px, alto fijo del panel
    const PAD_SUP = 32;       // px reservados arriba (bajo la barra de toggle) en "ambas"
    const PAD_LADO = 8;       // px de hueco lateral e inferior
    const HUECO = 10;         // px entre tarjetas apiladas ("ambas")
    // Alto de UNA ranura del par "ambas" = alto útil (con 2 cajas y su hueco) / 2. Es el
    // alto MÍNIMO (y por defecto) de la tarjeta: una fórmula que cabe se ve idéntica en todos
    // los bloques (=105.5px). Una tarjeta única con una fórmula que CABE se queda aquí (no
    // crece); solo si el contenido SUPERA este mínimo se ajusta hacia arriba (altura dinámica).
    const ALTO_TARJETA = (ALTO_PANEL - PAD_SUP - PAD_LADO - HUECO) / 2;
    // Techo del alto DINÁMICO de la tarjeta única: una fórmula alta (un despeje con fracción y
    // raíz anidadas) CRECE hasta aquí en vez de quedar cortada. Deja simétrico el hueco de la
    // barra de toggle; si ni así cabe, el área gana su propio scroll VERTICAL.
    const ALTO_TARJETA_MAX = ALTO_PANEL - 2 * PAD_SUP;

    const panelLatex = contenedor.createDiv({ cls: "lmath-latex" });
    panelLatex.style.cssText =
      `position:relative; width:50%; height:${ALTO_PANEL}px; padding:0; overflow:hidden;`;

    // Zona persistente que aloja las áreas de scroll; `renderLatex` la reconstruye en
    // cada cambio de vista. Es HERMANA de la barra de toggle (que se cuelga después
    // sobre `panelLatex`), por eso vaciarla no borra la barra. Columna: en "ambas"
    // apila los dos sub-paneles; con una sola fórmula, su única área la llena.
    const zona = panelLatex.createDiv();
    // Sin overflow propio: cada tarjeta tiene alto FIJO y su PROPIO scroll vertical interno
    // (barra INDEPENDIENTE por fórmula); la `zona` solo las apila.
    zona.style.cssText =
      "position:absolute; inset:0; display:flex; flex-direction:column; box-sizing:border-box;";

    // KaTeX puede dejar 1–2px de desbordamiento sub-pixel aunque la fórmula quepa de
    // sobra; solo se considera que desborda (scroll + fades) por encima de esto.
    const TOLERANCIA_SCROLL = 3;

    // Construye un ÁREA de scroll horizontal AUTÓNOMA dentro de `padre`: su propio
    // desbordamiento, fades laterales, rueda y observador de tamaño. El `estilo` fija
    // solo su aspecto: "enmarcado" la envuelve en una caja redondeada y algo más oscura
    // que el panel (`rgba(0,0,0,.22)` = oscurece lo que haya detrás, sin fijar un color
    // de tema); "plano" la deja sin recuadro llenando el hueco (reservado a futuros
    // paneles; el panel actual usa siempre "enmarcado"). `compartirAlto` es un eje
    // ORTOGONAL al estilo (layout, no aspecto): true → la tarjeta reparte a partes iguales la
    // altura de la columna (varias tarjetas de la vista "ambas", cada una = ALTO_TARJETA, sin
    // crecer); false → una sola tarjeta arranca en ese mínimo y CRECE con el contenido si lo
    // supera (`ajustarAlto`, hasta `ALTO_TARJETA_MAX`), con la `zona` centrándola en vertical.
    // Devuelve el área donde pintar, su `actualizarFade` (para recalcular tras el render)
    // y un `soltar` que retira sus listeners globales (evita fugas al alternar de vista).
    const crearArea = (
      padre: HTMLElement,
      estilo: EstiloTarjeta,
      compartirAlto: boolean
    ): { area: HTMLElement; actualizarFade: () => void; soltar: () => void } => {
      const enmarcado = estilo === "enmarcado";
      // Alto del marco. Varias ("ambas") reparten la columna a partes iguales (`flex:1 1 0` →
      // cada una = ALTO_TARJETA, sin crecer; una fórmula alta gana su scroll propio). Una SOLA
      // arranca en ese mínimo (`flex:0 0 auto; height:ALTO_TARJETA`) y `ajustarAlto` la CRECE
      // si el contenido lo supera; la `zona` la centra en vertical (se ve como una del par).
      const flexMarco = compartirAlto
        ? "flex:1 1 0;"
        : `flex:0 0 auto; height:${ALTO_TARJETA}px;`;
      const marco = padre.createDiv();
      marco.style.cssText =
        "position:relative; overflow:hidden; min-height:0; " + flexMarco +
        (enmarcado
          ? " border:1px solid rgba(255,255,255,0.11); border-radius:12px; " +
            "background:rgba(0,0,0,0.22);"
          : "");

      // Área scrolleable (hereda el tamaño de fuente KaTeX por la clase). Centra la
      // fórmula si cabe y la vuelve totalmente scrolleable si desborda (`safe center`).
      // En caja enmarcada se recorta el padding vertical para dejar más alto útil. Llena
      // el marco (`height:100%`): el marco tiene siempre alto DEFINIDO (flex o `calc`),
      // así el interior —padding, centrado, scroll— es idéntico con una o varias tarjetas.
      const area = marco.createDiv({ cls: "lmath-latex" });
      // `safe center` TAMBIÉN en vertical: si la fórmula desborda a lo alto (gana
      // scroll-Y), el inicio queda alcanzable en vez de recortado por el centrado.
      area.style.cssText =
        "width:100%; height:100%; box-sizing:border-box; " +
        `padding:${enmarcado ? "8px 24px" : "24px"}; ` +
        "display:flex; align-items:safe center; justify-content:safe center; " +
        "overflow-x:hidden; overflow-y:hidden;";
      area.style.scrollbarWidth = "thin";
      area.style.scrollbarColor = "#3a3a3a #1e1e1e";

      // Overlay de fade: HERMANO del área (un absolute dentro del scroller viajaría con
      // el contenido). Se ciñe al marco redondeado con el mismo recorte.
      const fadeOverlay = marco.createDiv();
      fadeOverlay.style.cssText =
        "position:absolute; inset:0; pointer-events:none; overflow:hidden; " +
        (enmarcado ? "border-radius:12px;" : "");
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

      // Visibilidad de los fades según la posición de scroll (sin desbordar → ninguno;
      // scrollLeft 0 → solo derecho; intermedio → ambos; máximo → solo izquierdo).
      const actualizarFade = () => {
        const max = area.scrollWidth - area.clientWidth;
        const desborda = max > TOLERANCIA_SCROLL;
        // La barra horizontal consume alto, no ancho: alternar overflow-x no altera
        // clientWidth ni provoca oscilación.
        area.style.overflowX = desborda ? "auto" : "hidden";
        const sl = area.scrollLeft;
        fadeIzq.style.opacity = desborda && sl > 0 ? "1" : "0";
        fadeDer.style.opacity = desborda && sl < max - 1 ? "1" : "0";
      };
      area.addEventListener("scroll", actualizarFade);

      // Alto de la tarjeta ÚNICA con UMBRAL: mientras la fórmula CABE en el mínimo (una
      // integral, una derivada, un despeje corto) la tarjeta se queda en `ALTO_TARJETA` —no se
      // agranda ni saca barra—; solo cuando el contenido SUPERA ese mínimo se ajusta hacia
      // arriba (crece con el contenido hasta `ALTO_TARJETA_MAX`). Si ni el techo alcanza, el
      // área gana su propio scroll vertical, con el contenido centrado (`safe center`). Las
      // tarjetas del par "ambas" NO crecen (reparten la columna): solo su scroll independiente.
      const ajustarAlto = () => {
        if (!compartirAlto) {
          // Se mide el alto INTRÍNSECO del CONTENIDO (el hijo renderizado), NO `area.scrollHeight`.
          // `scrollHeight` nunca baja de `clientHeight`, así que al fijar el alto del marco —que
          // agranda el área— la siguiente medición salía mayor y realimentaba: el marco se disparaba
          // hasta el techo y quedaba ATASCADO ahí (el bug al reactivar el plugin: KaTeX medía alto
          // con la fuente de reserva, cruzaba el umbral y arrancaba el bucle, sin volver atrás). El
          // hijo NO se estira (`safe center`, no `stretch`): su alto es el del contenido, INDEPENDIENTE
          // del de la tarjeta, así que la medición es estable y el crecimiento, reversible.
          const hijo = area.firstElementChild as HTMLElement | null;
          const padV = enmarcado ? 16 : 48;          // padding vertical del área (8+8 / 24+24)
          const necesario = (hijo?.scrollHeight ?? 0) + padV + 2;   // + padding y bordes del marco
          const alto = necesario > ALTO_TARJETA + TOLERANCIA_SCROLL
            ? Math.min(ALTO_TARJETA_MAX, necesario)   // supera el mínimo → altura dinámica
            : ALTO_TARJETA;                           // cabe → se queda en el mínimo
          marco.style.height = `${alto}px`;
        }
        area.style.overflowY =
          area.scrollHeight - area.clientHeight > TOLERANCIA_SCROLL ? "auto" : "hidden";
      };
      // Refresco completo (alto + fades): para el render inicial, el resize y el
      // ResizeObserver. El listener de scroll queda SOLO con los fades (recalcular el
      // alto en cada tick de scroll forzaría reflow sin necesidad: el tamaño no cambia).
      const refrescar = () => { ajustarAlto(); actualizarFade(); };

      // Rueda del ratón sobre la fórmula → scroll horizontal directo, limitado a ±40px
      // por tick (≈ un clic en las flechas de la scrollbar nativa).
      const onWheel = (e: WheelEvent) => {
        if (area.scrollWidth - area.clientWidth <= TOLERANCIA_SCROLL) return;
        e.preventDefault();
        const desplazamiento = e.deltaY + e.deltaX;
        area.scrollLeft += Math.max(-40, Math.min(40, desplazamiento));
      };
      area.addEventListener("wheel", onWheel, { passive: false });

      // El layout de KaTeX no está medido hasta el siguiente frame; se recalcula al
      // cambiar el tamaño de la ventana y cuando las fuentes asíncronas de KaTeX
      // reajustan el ancho real (ResizeObserver).
      window.addEventListener("resize", refrescar);
      const observador = new ResizeObserver(() => refrescar());
      observador.observe(area);
      const soltar = () => {
        window.removeEventListener("resize", refrescar);
        observador.disconnect();
      };
      return { area, actualizarFade: refrescar, soltar };
    };

    // Áreas de la vista actual y su liberación diferida (se sueltan al re-renderizar
    // o al destruir el bloque). Arranca como no-op: el primer render no tiene qué soltar.
    let soltarAreas: () => void = () => {};
    limpieza.register(() => soltarAreas());

    // Renderiza uno o varios LaTeX: suelta las áreas previas, limpia la zona y crea una
    // TARJETA enmarcada por fórmula (regla "una expresión = una tarjeta", igual con una o
    // con varias). La zona reserva SIEMPRE los mismos márgenes —el borde superior para la
    // barra de toggle (evita que la primera tarjeta corra por detrás) y un hueco lateral
    // e inferior para que las cajas floten dentro del panel—, así una sola fórmula queda
    // colocada IGUAL en todos los bloques (consistencia visual) y varias ("ambas") se
    // separan con `gap`. La barra de toggle es opcional: sin ella (obs-graph sin
    // transformaciones) el margen superior es solo aire uniforme, coherente con el resto.
    // VARIAS tarjetas se reparten la altura (`compartirAlto`, sin crecer, con scroll propio si
    // no caben); una sola arranca en el alto de ranura y CRECE con su contenido cuando lo supera
    // (altura dinámica hasta `ALTO_TARJETA_MAX`; una fórmula que cabe se queda en el mínimo).
    const renderLatex = async (latex: string | readonly string[]) => {
      soltarAreas();
      zona.empty();
      const formulas = typeof latex === "string" ? [latex] : latex;
      const compartirAlto = formulas.length > 1;
      // Varias tarjetas: reserva arriba (`PAD_SUP`) para que la primera no corra bajo la
      // barra de toggle y se llena la columna desde arriba (`flex-start`). Una sola:
      // márgenes SIMÉTRICOS (`PAD_LADO`) y `center` → queda centrada en el eje del panel
      // (su alto de ranura la mantiene lejos de la barra), como una tarjeta del par.
      zona.style.padding = compartirAlto
        ? `${PAD_SUP}px ${PAD_LADO}px ${PAD_LADO}px ${PAD_LADO}px`
        : `${PAD_LADO}px`;
      zona.style.gap = `${HUECO}px`;
      zona.style.justifyContent = compartirAlto ? "flex-start" : "center";

      const areas: Array<{ area: HTMLElement; actualizarFade: () => void }> = [];
      const disposers: Array<() => void> = [];
      for (const formula of formulas) {
        const a = crearArea(zona, "enmarcado", compartirAlto);
        areas.push(a);
        disposers.push(a.soltar);
        await MarkdownRenderer.render(
          this.plugin.app, "$$" + formula + "$$", a.area, ctx.sourcePath, this.plugin
        );
        a.area.scrollLeft = 0;
      }
      soltarAreas = () => disposers.forEach((d) => d());
      // Tras medir el layout (rAF): recalcula alto/fades y CENTRA el scroll vertical. Si la
      // fórmula desborda (una tarjeta del par "ambas" con un operador alto), el thumb queda a
      // media altura —el contenido se ve centrado y se sube/baja por igual— en vez de arrancar
      // pegado arriba (`scrollTop = 0`). El horizontal ya arranca en 0 (lectura de izq. a der.).
      requestAnimationFrame(() =>
        areas.forEach((a) => {
          a.actualizarFade();
          const maxY = a.area.scrollHeight - a.area.clientHeight;
          if (maxY > TOLERANCIA_SCROLL) a.area.scrollTop = maxY / 2;
        })
      );
    };

    return { panelLatex, renderLatex };
  }

  /** Resaltado compartido (color, fondo, borde, sombra) de los botones de la barra del
   *  panel según estén ACTIVOS (resaltado) o no (atenuado). Lo comparten el botón de
   *  texto (`estiloBotonPanel`) y el botón-icono de opciones (`estiloBotonOpciones`). */
  private chromeBotonPanel(activo: boolean): string {
    return activo
      ? "color:rgba(240,240,245,0.96); background:rgba(58,58,64,0.96); " +
        "border:1px solid rgba(255,255,255,0.18); box-shadow:0 2px 6px rgba(0,0,0,0.45);"
      : "color:rgba(205,205,215,0.7); background:rgba(40,40,44,0.92); " +
        "border:1px solid rgba(255,255,255,0.08); box-shadow:0 2px 5px rgba(0,0,0,0.35);";
  }

  /** Estilo compartido de los botones de TEXTO de la barra (Original, Derivada): activo =
   *  resaltado; inactivo = atenuado. Texto en Lora. */
  private estiloBotonPanel(b: HTMLElement, activo: boolean): void {
    b.style.cssText =
      "pointer-events:auto; padding:3px 10px; font-size:11px; line-height:1.15; " +
      "cursor:pointer; user-select:none; border-radius:8px; white-space:nowrap; " +
      "font-family:\"Lora\", var(--font-interface); " +
      "transition:background 0.12s ease, color 0.12s ease; " +
      this.chromeBotonPanel(activo);
  }

  /** Estilo del botón-icono "hamburguesa" (3 líneas) que abre el menú de opciones:
   *  CUADRADO de esquinas suaves, mismo resaltado activo/inactivo que los de texto. Las
   *  líneas usan `currentColor`, así que siguen el color del botón (se avivan al activarse). */
  private estiloBotonOpciones(b: HTMLElement, activo: boolean): void {
    b.style.cssText =
      "pointer-events:auto; box-sizing:border-box; width:26px; height:22px; " +
      "display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; " +
      "cursor:pointer; user-select:none; border-radius:7px; " +
      "transition:background 0.12s ease, color 0.12s ease; " +
      this.chromeBotonPanel(activo);
  }

  /** Crea el botón-icono de opciones (hamburguesa de 3 líneas) dentro de la barra dada y lo
   *  devuelve. Reemplaza al antiguo "Opciones ▾"; común a los tres bloques. El resaltado se
   *  aplica luego con `estiloBotonOpciones` (en cada `sincronizar`). */
  private crearBotonOpciones(barra: HTMLElement, titulo: string): HTMLElement {
    const b = barra.createDiv();
    b.setAttribute("title", titulo);
    b.setAttribute("aria-label", titulo);
    for (let i = 0; i < 3; i++) {
      const linea = b.createDiv();
      linea.style.cssText =
        "width:14px; height:2px; border-radius:2px; background:currentColor; " +
        "transition:background 0.12s ease;";
    }
    return b;
  }

  /** Renderiza LaTeX INLINE como ETIQUETA de un botón/opción del toggle (glifo matemático
   *  en vez de texto): limpia `el`, pinta `$tex$` con KaTeX (mismo pipeline que el panel) y
   *  desenvuelve el `<p>` para que quede en línea. El color lo hereda del botón (KaTeX no
   *  fuerza color), así sigue el resaltado activo/inactivo. Async (no bloquea el montaje). */
  private montarEtiquetaMath(
    el: HTMLElement, tex: string, ctx: MarkdownPostProcessorContext
  ): void {
    el.empty();
    void MarkdownRenderer.render(this.plugin.app, `$${tex}$`, el, ctx.sourcePath, this.plugin)
      .then(() => {
        const p = el.querySelector("p");
        if (p) { while (p.firstChild) el.appendChild(p.firstChild); p.remove(); }
      });
  }

  /**
   * Aplica las transformaciones AUTOMÁTICAS activas (ajustes del plugin) al bloque, en el
   * orden formal despejar → simplificar, y devuelve el resultado que el panel muestra por
   * defecto. Reutiliza el MISMO pipeline que los botones (despejarEcuaciones/
   * simplificarEcuaciones): sin lógica duplicada. Si una transformación FALLA (lanza), se
   * conserva el resultado anterior —nunca rompe el render—.
   */
  private baseAutomatica(
    ecuaciones: readonly string[],
    ajustes: AjustesTransformaciones
  ): readonly string[] {
    let base: readonly string[] = ecuaciones;
    if (ajustes.despejarAuto) {
      try { base = despejarEcuaciones(base); } catch { /* conserva el resultado anterior */ }
    }
    // La simplificación es SIEMPRE automática (no configurable): todo bloque se muestra ya
    // simplificado/expandido, sin botón. Va tras el despeje (orden formal despejar → simplificar).
    try { base = simplificarEcuaciones(base); } catch { /* conserva el resultado anterior */ }
    return base;
  }

  /**
   * Panel izquierdo de obs-graph / obs-system: el scroller de fórmula + la barra de
   * toggle de transformaciones ([Original] [Opciones ▾] con Simplificar / Despejar y).
   */
  private async montarPanelLatex(
    contenedor: HTMLElement,
    ecuaciones: readonly string[],
    ctx: MarkdownPostProcessorContext,
    limpieza: MarkdownRenderChild
  ): Promise<void> {
    const { panelLatex, renderLatex } = this.crearScrollerLatex(contenedor, ctx, limpieza);

    // ── Toggle de transformaciones del panel ────────────────────────────────────
    // Botones centrados arriba del panel para alternar la fórmula MOSTRADA (no cambia
    // lo graficado): [Original] [Opciones ▾]. La SIMPLIFICACIÓN es automática e
    // incondicional (siempre aplicada en `base`, sin botón: `x+x+x`→`3x`, `x/2` intacto).
    // La única transformación de MENÚ es Despejar y, para implícitas (`x³+y³=9`→`y=∛(9−x³)`),
    // y solo si no está en automático; se deshabilita si no cambiaría lo mostrado. La
    // `variable` de la etiqueta se renderiza en MATEMÁTICA (KaTeX), no con Lora: "Despejar $y$",
    // nombrando la variable explícitamente de cara a soportar despejar otras. Botones/menú
    // redondeados; el texto de interfaz usa Lora.
    // Base MOSTRADA por defecto: el panel arranca ya SIMPLIFICADO (y despejado si `despejarAuto`
    // está activo; orden formal despejar → simplificar), no en lo escrito; "Original" revierte a
    // ESA base. La transformación automática (despejar) se RETIRA del menú.
    const ajustes = this.obtenerAjustes();
    const base = this.baseAutomatica(ecuaciones, ajustes);
    const original = bloqueALatex(base, this.sistema);
    // Simplificar YA NO es una opción de menú: es automática e incondicional (aplicada en
    // `base`). La única transformación manual posible es Despejar y (para implícitas), y solo
    // si no está en automático. Sin ninguna manual no hay nada que alternar → se omite la barra.
    const todas: ReadonlyArray<{
      etiqueta: string; tex: string; auto: boolean; fn: (e: readonly string[]) => string[];
    }> = [
      // `etiqueta` = título accesible; `tex` = glifo matemático RENDERIZADO en el botón.
      { etiqueta: t().botones.despejarY, tex: "y=f(x)", auto: ajustes.despejarAuto, fn: despejarEcuaciones },
    ];
    const transformaciones = todas.filter((t) => !t.auto);

    if (ecuaciones.length > 0 && transformaciones.length > 0) {
      // ESTADO encadenable: la expresión actual (strings re-parseables). Las
      // transformaciones se aplican sobre el estado ACTUAL (parte de la base mostrada).
      let estado: readonly string[] = base;

      const barra = panelLatex.createDiv();
      barra.style.cssText =
        "position:absolute; top:8px; left:0; right:0; z-index:6; display:flex; gap:6px; " +
        "justify-content:center; pointer-events:none;";
      const estiloBoton = (b: HTMLElement, activo: boolean) => this.estiloBotonPanel(b, activo);
      // "Original" ahora es un GLIFO matemático: `f(x)` en obs-graph; el sistema
      // `\scriptscriptstyle\begin{cases}~\\[1.1ex]~\end{cases}` (filas vacías) en obs-system. Título accesible aparte.
      const btnOriginal = barra.createDiv();
      btnOriginal.setAttribute("title", t().botones.original);
      this.montarEtiquetaMath(
        btnOriginal,
        this.sistema ? "\\scriptscriptstyle\\begin{cases}~\\\\[1.1ex]~\\end{cases}" : "f(x)",
        ctx
      );
      const btnOpciones = this.crearBotonOpciones(barra, t().botones.transformaciones);

      // Menú desplegable de transformaciones (bajo la barra, centrado).
      const menu = panelLatex.createDiv();
      menu.style.cssText =
        "position:absolute; top:36px; left:0; right:0; z-index:7; display:none; " +
        "flex-direction:column; align-items:center; pointer-events:none;";
      const caja = menu.createDiv();
      caja.style.cssText =
        "pointer-events:auto; display:flex; flex-direction:column; gap:2px; padding:4px; " +
        "border-radius:10px; background:rgba(38,38,42,0.98); " +
        "border:1px solid rgba(255,255,255,0.1); box-shadow:0 4px 12px rgba(0,0,0,0.5); " +
        "font-family:\"Lora\", var(--font-interface);";
      // Estilo de cada opción según esté HABILITADA (produciría un cambio) o no
      // (oscurecida y sin poder clicar, vía pointer-events).
      const itemEstilo = (el: HTMLElement, habilitado: boolean) => {
        el.style.cssText =
          "padding:5px 14px; font-size:11px; line-height:1.15; user-select:none; " +
          "border-radius:6px; white-space:nowrap; text-align:center; " +
          "transition:background 0.12s ease, color 0.12s ease; " +
          (habilitado
            ? "color:rgba(225,225,232,0.92); cursor:pointer; pointer-events:auto;"
            : "color:rgba(150,150,160,0.32); cursor:default; pointer-events:none;");
      };
      // Cada opción es un div cuyo contenido es el GLIFO matemático de la transformación
      // (`y=f(x)` para Despejar), renderizado con KaTeX; el `etiqueta` queda como título
      // accesible. El estilo (habilitado/no) lo pone itemEstilo en cada sincronización.
      const items = transformaciones.map((t) => {
        const el = caja.createDiv();
        el.setAttribute("title", t.etiqueta);
        this.montarEtiquetaMath(el, t.tex, ctx);
        return el;
      });

      let abierto = false;
      const esOriginal = () => bloqueALatex(estado) === original;
      // Una transformación está HABILITADA si aplicada al estado ACTUAL cambiaría la
      // expresión mostrada (se compara el LaTeX resultante con el actual).
      const sincronizar = () => {
        estiloBoton(btnOriginal, esOriginal());
        this.estiloBotonOpciones(btnOpciones, !esOriginal() || abierto);
        const actual = bloqueALatex(estado);
        items.forEach((el, i) => itemEstilo(el, bloqueALatex(transformaciones[i].fn(estado)) !== actual));
        menu.style.display = abierto ? "flex" : "none";
      };
      const aplicar = async (i: number) => {
        abierto = false;
        const nuevo = transformaciones[i].fn(estado);
        if (bloqueALatex(nuevo) !== bloqueALatex(estado)) { estado = nuevo; await renderLatex(bloqueALatex(estado)); }
        sincronizar();
      };
      btnOriginal.addEventListener("click", async () => {
        abierto = false;
        if (!esOriginal()) { estado = base; await renderLatex(original); }
        sincronizar();
      });
      btnOpciones.addEventListener("click", (e) => { e.stopPropagation(); abierto = !abierto; sincronizar(); });
      items.forEach((el, i) => el.addEventListener("click", () => void aplicar(i)));

      // Clic fuera de la barra/menú → cerrar el desplegable.
      const onDocDown = (e: MouseEvent) => {
        if (abierto && !barra.contains(e.target as Node) && !caja.contains(e.target as Node)) {
          abierto = false;
          sincronizar();
        }
      };
      document.addEventListener("mousedown", onDocDown);
      limpieza.register(() => document.removeEventListener("mousedown", onDocDown));

      sincronizar();
    }

    await renderLatex(original);
  }

  /**
   * Panel izquierdo de obs-derivate: el scroller de fórmula + una barra de toggle de
   * DOS vistas —[Original] muestra el operador sin evaluar `\frac{d}{dx}\left(f\right)`;
   * [Derivada] muestra la derivada evaluada `f'\left(x\right) = …`—. No transforma lo
   * graficado (el plano SIEMPRE grafica la derivada, ver `process`): solo alterna la
   * fórmula MOSTRADA, como el toggle de obs-graph. Arranca en la vista "Derivada" (es el
   * resultado, el foco del bloque).
   */
  private async montarPanelDerivada(
    contenedor: HTMLElement,
    ecuaciones: readonly string[],
    ctx: MarkdownPostProcessorContext,
    limpieza: MarkdownRenderChild
  ): Promise<void> {
    const { panelLatex, renderLatex } = this.crearScrollerLatex(contenedor, ctx, limpieza);

    // Las DOS representaciones que puede mostrar el panel: el OPERADOR sin evaluar YA con la
    // función SIMPLIFICADA (`d/dx(6x)`, la vista "Original"/por defecto, análoga a `f(x)` de
    // obs-graph: la forma de PARTIDA) y la DERIVADA evaluada (`f'(x)=…`, la opción del menú:
    // el RESULTADO). El operador NO cambia la derivada evaluada: solo muestra lo que se deriva.
    const operadorSimp = derivadaOperadorSimplificadoLatex(ecuaciones); // null si no es explícito
    // El operador con la función simplificada; si el bloque no es explícito (no hay forma
    // simplificable), cae al operador crudo `d/dx(f)`.
    const operador = operadorSimp ?? derivadaOperadorLatex(ecuaciones);
    const derivada = derivadaLatex(ecuaciones);

    // Tres vistas: el OPERADOR sin evaluar, la DERIVADA evaluada y AMBAS a la vez
    // (operador arriba, derivada debajo). En "ambas" `latexDe` devuelve las dos fórmulas
    // y `renderLatex` las apila, cada una en su propio contenedor con el mismo estilo que
    // las vistas individuales.
    type Vista = "operador" | "derivada" | "ambas";
    const latexDe = (v: Vista): string | readonly string[] =>
      v === "operador" ? operador : v === "derivada" ? derivada : [operador, derivada];
    // Firma comparable de una vista: las arrays no se comparan por identidad, así que se
    // colapsan a un string para decidir si una opción cambiaría lo mostrado (habilitarla).
    const firmaDe = (v: Vista): string => {
      const l = latexDe(v);
      return typeof l === "string" ? l : l.join(" ");
    };

    // ── Barra de toggle: [Original] [Opciones ▾] ────────────────────────────────
    // "Original" (glifo `d/dx(f(x))`) es el operador; "Opciones" despliega la derivada
    // evaluada (glifo `f'(x)`). Mismo lenguaje visual y de interacción que obs-graph.
    const barra = panelLatex.createDiv();
    barra.style.cssText =
      "position:absolute; top:8px; left:0; right:0; z-index:6; display:flex; gap:6px; " +
      "justify-content:center; pointer-events:none;";
    const btnOriginal = barra.createDiv();
    btnOriginal.setAttribute("title", t().botones.operador);
    this.montarEtiquetaMath(btnOriginal, "\\frac{d}{dx}\\left(f(x)\\right)", ctx);
    const btnOpciones = this.crearBotonOpciones(barra, t().botones.derivadaEvaluada);

    // Menú desplegable (bajo la barra, centrado), idéntico al de obs-graph.
    const menu = panelLatex.createDiv();
    menu.style.cssText =
      "position:absolute; top:36px; left:0; right:0; z-index:7; display:none; " +
      "flex-direction:column; align-items:center; pointer-events:none;";
    const caja = menu.createDiv();
    caja.style.cssText =
      "pointer-events:auto; display:flex; flex-direction:column; gap:2px; padding:4px; " +
      "border-radius:10px; background:rgba(38,38,42,0.98); " +
      "border:1px solid rgba(255,255,255,0.1); box-shadow:0 4px 12px rgba(0,0,0,0.5); " +
      "font-family:\"Lora\", var(--font-interface);";
    const itemEstilo = (el: HTMLElement, habilitado: boolean) => {
      el.style.cssText =
        "padding:5px 14px; font-size:11px; line-height:1.15; user-select:none; " +
        "border-radius:6px; white-space:nowrap; text-align:center; " +
        "transition:background 0.12s ease, color 0.12s ease; " +
        (habilitado
          ? "color:rgba(225,225,232,0.92); cursor:pointer; pointer-events:auto;"
          : "color:rgba(150,150,160,0.32); cursor:default; pointer-events:none;");
    };

    // Única opción del menú: la derivada evaluada, con el glifo `f'(x)`. Se habilita/
    // deshabilita según cambie o no la fórmula mostrada, igual que el resto del toggle.
    const opciones: ReadonlyArray<{ etiqueta: string; tex: string; vista: Vista }> = [
      { etiqueta: t().botones.derivada, tex: "f'(x)", vista: "derivada" },
      // Vista combinada: su glifo APILA el operador sobre la derivada (representa que
      // muestra ambas expresiones a la vez, una debajo de la otra).
      {
        etiqueta: t().botones.operadorYDerivada,
        tex: "\\begin{matrix}\\frac{d}{dx}\\left(f(x)\\right)\\\\ f'\\left(x\\right)\\end{matrix}",
        vista: "ambas",
      },
    ];
    const items = opciones.map((o) => {
      const el = caja.createDiv();
      el.setAttribute("title", o.etiqueta);
      this.montarEtiquetaMath(el, o.tex, ctx);
      return el;
    });

    // "operador" (forma de partida) es la vista por defecto.
    let vista: Vista = "operador";
    let abierto = false;
    // La opción está HABILITADA si aplicarla cambiaría la fórmula mostrada (su LaTeX
    // difiere del actual): así "Derivada" se apaga estando ya en la derivada evaluada.
    const sincronizar = () => {
      this.estiloBotonPanel(btnOriginal, vista === "operador");
      this.estiloBotonOpciones(btnOpciones, vista !== "operador" || abierto);
      const actual = firmaDe(vista);
      items.forEach((el, i) => itemEstilo(el, firmaDe(opciones[i].vista) !== actual));
      menu.style.display = abierto ? "flex" : "none";
    };
    const aplicar = async (i: number) => {
      abierto = false;
      const v = opciones[i].vista;
      if (firmaDe(v) !== firmaDe(vista)) { vista = v; await renderLatex(latexDe(vista)); }
      sincronizar();
    };
    btnOriginal.addEventListener("click", async () => {
      abierto = false;
      if (vista !== "operador") { vista = "operador"; await renderLatex(operador); }
      sincronizar();
    });
    btnOpciones.addEventListener("click", (e) => { e.stopPropagation(); abierto = !abierto; sincronizar(); });
    items.forEach((el, i) => el.addEventListener("click", () => void aplicar(i)));

    // Clic fuera de la barra/menú → cerrar el desplegable.
    const onDocDown = (e: MouseEvent) => {
      if (abierto && !barra.contains(e.target as Node) && !caja.contains(e.target as Node)) {
        abierto = false;
        sincronizar();
      }
    };
    document.addEventListener("mousedown", onDocDown);
    limpieza.register(() => document.removeEventListener("mousedown", onDocDown));

    sincronizar();

    await renderLatex(operador);
  }

  /**
   * Panel izquierdo de obs-integral: el scroller de fórmula + una barra de toggle de TRES
   * vistas, espejo EXACTO del panel de obs-derivate (§6.4):
   *   • [Operador] (por defecto): la integral sin evaluar `\int_a^b f\,dx` (forma de partida).
   *   • Primitiva: la regla de BARROW `\left[F(x)\right]_a^b = <valor>`, con F la antiderivada
   *     simbólica (`integralPrimitivaLatex` → `integrarExpr`) y el valor numérico ya presente.
   *     Es el análogo de la "derivada evaluada" (`f'(x)=…`). Si el integrador NO cubre este
   *     integrando, cae al VALOR sin corchete (`\int_a^b f\,dx = <área>`, la vista de siempre).
   *   • Operador y primitiva: ambas apiladas (operador arriba, primitiva debajo) — la forma
   *     del mockup del usuario.
   * No cambia lo graficado (el plano SIEMPRE grafica el integrando y sombrea la región): solo
   * alterna la fórmula MOSTRADA. El área se calcula UNA vez; si es un caso límite del Nivel 2,
   * el cuerpo es la etiqueta (`\text{Integral divergente}`).
   */
  private async montarPanelIntegral(
    contenedor: HTMLElement,
    source: string,
    ctx: MarkdownPostProcessorContext,
    limpieza: MarkdownRenderChild
  ): Promise<void> {
    const { panelLatex, renderLatex } = this.crearScrollerLatex(contenedor, ctx, limpieza);

    const operador = integralOperadorLatex(source);
    // El VALOR del área, en su representación EXACTA cuando existe (`\frac{8}{3}`, `\frac{\pi}{2}`,
    // `\ln 3`…) vía Barrow simbólico, y `\approx <decimal>` si es irracional sin forma cerrada.
    const { cuerpo, conector } = cuerpoAreaLatexExacto(source);
    // La PRIMITIVA en forma de Barrow, con el valor enganchado por el mismo conector
    // (`\left[F\right]_a^b = <valor exacto>`): muestra la antiderivada Y conserva el número. Si
    // `integralPrimitivaLatex` devuelve null (integrando fuera de alcance), la vista "resultado"
    // cae al valor sin corchete = la vista "Valor" de antes.
    const barrow = integralPrimitivaLatex(source);
    // SIN valor (`cuerpo === null`: integrando degenerado, integral divergente, límites no
    // numéricos…): el panel se queda con la FÓRMULA —los corchetes de Barrow, o el operador— y
    // NINGUNA etiqueta. El diagnóstico vive en un solo sitio, el PLANO (velo + etiqueta formal,
    // como "Indeterminada"); una etiqueta en el panel LaTeX lo repetía en el lugar equivocado:
    // el panel es la fórmula, no el veredicto.
    const resultado = cuerpo === null
      ? (barrow ?? operador)
      : barrow
        ? `${barrow} ${conector} ${cuerpo}`
        : integralValorLatex(source, cuerpo, conector);

    type Vista = "operador" | "resultado" | "ambas";
    const latexDe = (v: Vista): string | readonly string[] =>
      v === "operador" ? operador : v === "resultado" ? resultado : [operador, resultado];
    const firmaDe = (v: Vista): string => {
      const l = latexDe(v);
      return typeof l === "string" ? l : l.join(" ");
    };

    // ── Barra de toggle: [Operador] [Opciones ▾] (mismo lenguaje visual que obs-derivate) ──
    const barra = panelLatex.createDiv();
    barra.style.cssText =
      "position:absolute; top:8px; left:0; right:0; z-index:6; display:flex; gap:6px; " +
      "justify-content:center; pointer-events:none;";
    const btnOriginal = barra.createDiv();
    btnOriginal.setAttribute("title", t().botones.operador);
    // Glifo del botón principal: el operador integral (`∫ₐᵇ f dx`), análogo al `d/dx(f(x))`
    // del botón "Operador" de obs-derivate.
    this.montarEtiquetaMath(btnOriginal, "\\int_a^b f(x)\\,dx", ctx);
    const btnOpciones = this.crearBotonOpciones(barra, t().botones.primitivaEvaluada);

    const menu = panelLatex.createDiv();
    menu.style.cssText =
      "position:absolute; top:36px; left:0; right:0; z-index:7; display:none; " +
      "flex-direction:column; align-items:center; pointer-events:none;";
    const caja = menu.createDiv();
    caja.style.cssText =
      "pointer-events:auto; display:flex; flex-direction:column; gap:2px; padding:4px; " +
      "border-radius:10px; background:rgba(38,38,42,0.98); " +
      "border:1px solid rgba(255,255,255,0.1); box-shadow:0 4px 12px rgba(0,0,0,0.5); " +
      "font-family:\"Lora\", var(--font-interface);";
    const itemEstilo = (el: HTMLElement, habilitado: boolean) => {
      el.style.cssText =
        "padding:5px 14px; font-size:11px; line-height:1.15; user-select:none; " +
        "border-radius:6px; white-space:nowrap; text-align:center; " +
        "transition:background 0.12s ease, color 0.12s ease; " +
        (habilitado
          ? "color:rgba(225,225,232,0.92); cursor:pointer; pointer-events:auto;"
          : "color:rgba(150,150,160,0.32); cursor:default; pointer-events:none;");
    };

    // Dos opciones del menú: la PRIMITIVA evaluada (glifo `[F(x)]_a^b`) y AMBAS (operador
    // apilado sobre primitiva). Espejo de "Derivada" / "Operador y derivada" de obs-derivate.
    const opciones: ReadonlyArray<{ etiqueta: string; tex: string; vista: Vista }> = [
      { etiqueta: t().botones.primitiva, tex: "\\left[F(x)\\right]_a^b", vista: "resultado" },
      {
        etiqueta: t().botones.operadorYPrimitiva,
        tex: "\\begin{matrix}\\int_a^b f\\,dx\\\\ \\left[F(x)\\right]_a^b\\end{matrix}",
        vista: "ambas",
      },
    ];
    const items = opciones.map((o) => {
      const el = caja.createDiv();
      el.setAttribute("title", o.etiqueta);
      this.montarEtiquetaMath(el, o.tex, ctx);
      return el;
    });

    let vista: Vista = "operador";
    let abierto = false;
    const sincronizar = () => {
      this.estiloBotonPanel(btnOriginal, vista === "operador");
      this.estiloBotonOpciones(btnOpciones, vista !== "operador" || abierto);
      const actual = firmaDe(vista);
      items.forEach((el, i) => itemEstilo(el, firmaDe(opciones[i].vista) !== actual));
      menu.style.display = abierto ? "flex" : "none";
    };
    const aplicar = async (i: number) => {
      abierto = false;
      const v = opciones[i].vista;
      if (firmaDe(v) !== firmaDe(vista)) { vista = v; await renderLatex(latexDe(vista)); }
      sincronizar();
    };
    btnOriginal.addEventListener("click", async () => {
      abierto = false;
      if (vista !== "operador") { vista = "operador"; await renderLatex(operador); }
      sincronizar();
    });
    btnOpciones.addEventListener("click", (e) => { e.stopPropagation(); abierto = !abierto; sincronizar(); });
    items.forEach((el, i) => el.addEventListener("click", () => void aplicar(i)));

    const onDocDown = (e: MouseEvent) => {
      if (abierto && !barra.contains(e.target as Node) && !caja.contains(e.target as Node)) {
        abierto = false;
        sincronizar();
      }
    };
    document.addEventListener("mousedown", onDocDown);
    limpieza.register(() => document.removeEventListener("mousedown", onDocDown));

    sincronizar();
    await renderLatex(operador);
  }

  /**
   * Etiqueta formal del bloque, o null si es graficable: bloque VACÍO → "Sin
   * función"; forma explícita clásica (expr suelta o y=expr) sin ningún valor real
   * → clasificación del GraphEngine (Indeterminada / Indefinida / No definida en ℝ,
   * con el MISMO evaluador compartido, que preserva los valores complejos). Las
   * demás formas (implícitas, paramétricas, polares, sistemas) no se clasifican:
   * el motor grafica lo que pueda.
   */
  private clasificarBloque(ecuaciones: readonly string[], source = ""): FuncionDegenerada | null {
    // Comando LaTeX que el parser no sabe traducir (`\alpha`, `\ge`, `\sum`…). Se mira el
    // SOURCE escrito, no las ecuaciones graficadas (en derivate/integral estas ya son la
    // derivada/el integrando, en sintaxis mathjs). Va PRIMERO: sin esta etiqueta el comando
    // se degrada a símbolos libres y el bloque no dibuja nada SIN decir por qué —o peor, en
    // obs-derivate deriva esa basura y muestra una derivada falsa (ver parser.ts).
    const noSoportados = comandosNoSoportados(source);
    if (noSoportados.length > 0) {
      return {
        etiqueta: noSoportados.length === 1 ? t().velo.simboloNoSoportado : t().velo.simbolosNoSoportados,
        detalle: t().velo.simboloDetalle(noSoportados.join(", ")),
      };
    }

    // Bloque obs-integral: sin integrando graficable (no se reconoció `\int_a^b f dx` o falta
    // un límite) → "Sin integral". Con integrando presente, se clasifica como una explícita
    // normal más abajo (0/0, √−1 sobre el INTEGRANDO → velo, Nivel 1); los fallos del VALOR
    // (divergente, límites no numéricos) NO oscurecen el plano: van al panel (Nivel 2).
    if (this.integral && ecuaciones.length === 0) {
      // Se escribió una integral, pero su integrando no es una función de x (una ECUACIÓN:
      // `\int_0^1 (x²+y²−1)³=x²y³ dx`; ver `esIntegrandoValido`). Decirlo, y decir a dónde va
      // ese contenido: de una curva implícita no se integra nada, se GRAFICA (obs-graph).
      if (/\\int/.test(source)) {
        return { ...t().velo.integrandoNoValido };
      }
      return { ...t().velo.sinIntegral };
    }
    // Integral SIN valor: el integrando no toma valores reales (Nivel 1) o el número no existe
    // (Nivel 2: divergente, `\int_{-\infty}`, hueco del dominio). TODAS las etiquetas del bloque
    // salen aquí, sobre el plano: el panel LaTeX solo muestra la fórmula (ver montarPanelIntegral).
    if (this.integral) {
      const etiqueta = etiquetaIntegral(source);
      if (etiqueta) return etiqueta;
    }

    // Bloque obs-system: un SISTEMA necesita ≥2 ecuaciones (y ≥2 incógnitas). Se
    // clasifica por número de ecuaciones; con 2+ no se clasifica (grafica normal).
    if (this.sistema) {
      if (ecuaciones.length === 0) {
        return { ...t().velo.sinSistema };
      }
      if (ecuaciones.length === 1) {
        return { ...t().velo.sistemaIncompleto };
      }
      return null;
    }
    if (ecuaciones.length === 0) {
      return { ...t().velo.sinFuncion };
    }
    return this.degeneradaDeEcuacion(ecuaciones[0]);
  }

  /**
   * Clasificación formal de UNA ecuación explícita (`y=f(x)` o expresión suelta): la etiqueta
   * del velo (Indeterminada / Indefinida / No definida en ℝ), o null si es graficable o no es
   * una f(x). Extraída de `clasificarBloque` porque obs-derivate necesita clasificar la función
   * ESCRITA (no la derivada): `\frac{0}{0}` deriva a `0` y el bloque graficaba la recta y=0 con
   * su derivada "f'(x) = 0" — un resultado inventado sobre una función que no existe.
   */
  private degeneradaDeEcuacion(ec: string): FuncionDegenerada | null {
    // Función del parámetro (`x(t)=…`, o una expresión suelta en `t`): el motor la grafica como
    // explícita con la abscisa renombrada a x, así que se clasifica sobre ESA (compilar la `t`
    // contra `x` daría NaN en todo el eje → falso "Indeterminada" sobre una curva bien dibujada).
    const comp = funcionDelParametro(ec);
    if (comp) {
      const enX = renombrarParametroAX(insertarProductoImplicito(normalizarEntrada(comp.expr.trim())));
      try {
        return clasificarDegenerada(compilarFuncion(enX, "x"));
      } catch {
        return null;
      }
    }

    const partes = ec.split("=");
    let expr: string | null = null;
    if (partes.length === 1) expr = partes[0];
    else if (partes.length === 2) {
      if (normalizarEntrada(partes[0].trim()) === "y") expr = partes[1];
      else if (normalizarEntrada(partes[1].trim()) === "y") expr = partes[0];
    }
    if (expr === null) return null; // no es y=f(x): sin clasificación
    if (expr.trim() === "") {
      // "y=" a medio escribir: no es una indeterminación, aún no hay expresión.
      return { ...t().velo.sinFuncion };
    }
    try {
      // MISMA normalización que grafica el motor (`construirObjeto.norm`): incluye el
      // producto implícito. Sin él, `\pi(2x+4)` quedaba como `pi(2x+4)`, que mathjs lee
      // como LLAMADA a `pi` (no es función) → NaN en todo x → falso "Indeterminada".
      const norm = insertarProductoImplicito(normalizarEntrada(expr.trim()));
      // Expresión suelta con `y` libre: NO es f(x) — el motor la grafica como implícita
      // expr=0 (`construirObjeto`); compilarla solo con x daría NaN en todo el eje y un
      // falso "Indeterminada" sobre una curva bien dibujada.
      if (contieneYLibre(norm)) return null;
      const evalX = compilarFuncion(norm, "x");
      return clasificarDegenerada(evalX);
    } catch {
      return null; // no compila: el motor ya no dibuja nada; sin etiqueta formal
    }
  }

  /**
   * Expresión f(x) de un bloque obs-graph (la 1ª ecuación, si es explícita y=f(x)),
   * NORMALIZADA a sintaxis mathjs, o null si no aplica (sistema, vacío, implícita,
   * paramétrica…). Es la MISMA que grafica el motor, así que el resumen ⓘ coincide
   * con lo dibujado.
   */
  private exprExplicita(ecuaciones: readonly string[]): string | null {
    if (this.sistema || ecuaciones.length === 0) return null;
    // Solo las curvas EXPLÍCITAS (y=f(x) o expresión suelta) tienen un f(x) que
    // compilar. Las PARAMÉTRICAS `(X, Y)` (sin `=`, caían al caso "expresión suelta"),
    // implícitas y polares NO → null (el ⓘ geométrico las cubre). Sin este filtro,
    // `montarBotonInfo` compilaba la tupla como f(x) y `compilarFuncion` lanzaba
    // ("Parenthesis ) expected"), abortando el render del plano (bug de paramétricas).
    let tipo: string;
    try { tipo = construirObjeto(ecuaciones[0], "info").tipo; } catch { return null; }
    if (tipo !== "explicita") return null;
    // Función del parámetro. Con el valor en la ORDENADA (`y(t)=…`, o una expresión suelta en
    // `t`) el ⓘ vale tal cual: es la gráfica clásica, solo que la abscisa se llama `t` → se
    // analiza la MISMA f que grafica el motor (la renombrada t→x). Con el valor en la ABSCISA
    // (`x(t)=…`) la curva sale TUMBADA: las "raíces" y los "vértices" de f no son los del dibujo
    // (están en el otro eje) → sin ⓘ analítico, antes que describir una curva que no es esa.
    const comp = funcionDelParametro(ecuaciones[0]);
    if (comp) {
      if (comp.eje === "x") return null;
      const enX = renombrarParametroAX(insertarProductoImplicito(normalizarEntrada(comp.expr.trim())));
      return enX === "" ? null : enX;
    }
    const partes = ecuaciones[0].split("=");
    let expr: string | null = null;
    if (partes.length === 1) expr = partes[0];
    else if (partes.length === 2) {
      if (normalizarEntrada(partes[0].trim()) === "y") expr = partes[1];
      else if (normalizarEntrada(partes[1].trim()) === "y") expr = partes[0];
    }
    if (expr === null) return null;
    // MISMA normalización que grafica el motor (producto implícito incluido): el ⓘ
    // analiza EXACTAMENTE la f(x) dibujada (`\pi(2x+4)` → `pi*(2*x+4)`, no `pi(2x+4)`).
    const norm = insertarProductoImplicito(normalizarEntrada(expr.trim()));
    return norm === "" ? null : norm;
  }

  /**
   * Botón ⓘ + popover con el resumen de puntos notables de la función (portado del
   * GraphEngine): intersección con Y, raíces y vértices. Los grupos periódicos
   * (trig que oscila → "infinitas") o excesivos ("demasiadas") se resumen en vez de
   * enumerarse. El análisis es sobre el rango fijo de `analizarFuncion` (agnóstico
   * de la vista actual), igual que en el motor original.
   */
  private montarBotonInfo(
    wrap: HTMLElement, expr: string, ctx: MarkdownPostProcessorContext
  ): void {
    // Defensivo: si `expr` no compila como f(x) (p.ej. una tupla paramétrica que se
    // colara), NO lanzar —abortaría el render del plano—, simplemente no montar el ⓘ.
    let evalX: (x: number) => number;
    try { evalX = compilarFuncion(expr, "x"); } catch { return; }
    const analisis = analizarFuncion(evalX);
    const interseccionY = evalX(0);
    const esTrig = tieneTrigonometria(expr);
    // Un TRAMO de raíces (x∈[0,1) de ⌊x⌋) cuenta como UN elemento del grupo, no como
    // sus infinitos puntos: sin esto, floor caía en "demasiadas para mostrar".
    const estadoRaices = estadoGrupo(
      analisis.raices.length + analisis.intervalosRaiz.length, esTrig);
    const estadoVertices = estadoGrupo(analisis.vertices.length, esTrig);

    // Función idénticamente cero (simplifica a "0"): TODO x es raíz y la intersección
    // Y es (0,0). Se detecta como en el GraphEngine, con simplify sobre la expresión.
    let idénticamenteCero = false;
    try { idénticamenteCero = simplify(expr).toString() === "0"; } catch { /* no simplificable */ }

    // Cada línea es texto plano (fuente Lora, heredada de `.lmath-grafica`); si
    // lleva `tex`, esa parte MATEMÁTICA se renderiza con KaTeX a continuación del
    // texto. Así el prefijo "Raíces:" queda como texto normal (Lora) y solo la
    // expresión del conjunto (`x∈(1,∞)`) va en LaTeX.
    const T = t().resumen;
    const lineas: { texto: string; tex?: string }[] = [];
    if (idénticamenteCero) {
      lineas.push({ texto: T.interseccionYCero });
      lineas.push({ texto: T.identicamenteCero });
    } else {
      lineas.push({
        texto: Number.isFinite(interseccionY)
          ? T.interseccionY((interseccionY as number).toFixed(4))
          : T.interseccionYNoDefinida,
      });
      if (estadoRaices === "infinitas") lineas.push({ texto: T.raicesInfinitas });
      else if (estadoRaices === "demasiadas") lineas.push({ texto: T.raicesDemasiadas });
      else if (analisis.intervalosRaiz.length > 0)
        // Raíces por TRAMOS (escalones): "Raíces:" como texto normal (Lora) y el
        // conjunto en notación de intervalos renderizado en KaTeX a continuación.
        lineas.push({ texto: T.raicesPrefijo, tex: raicesALatex(analisis.intervalosRaiz, analisis.raices) });
      else if (analisis.raices.length > 0)
        lineas.push({ texto: T.raicesPrefijo + analisis.raices.map((r) => r.toFixed(4)).join(", ") });
      else lineas.push({ texto: T.noRaices });

      if (estadoVertices === "infinitas") lineas.push({ texto: T.verticesInfinitos });
      else if (estadoVertices === "demasiadas") lineas.push({ texto: T.verticesDemasiados });
      else if (analisis.vertices.length > 0)
        for (const v of analisis.vertices)
          lineas.push({
            texto: (v.tipo === "min" ? T.verticeMin : T.verticeMax)(v.x.toFixed(4), v.y.toFixed(4)),
          });
      else lineas.push({ texto: T.noVertices });
    }

    const btnInfo = wrap.createDiv();
    btnInfo.setAttribute("title", t().botones.resumenNotables);
    btnInfo.style.cssText =
      "position:absolute; bottom:8px; right:8px; width:22px; height:22px; " +
      "display:flex; align-items:center; justify-content:center; font-size:14px; " +
      "line-height:1; color:rgba(255,200,130,0.95); background:rgba(30,30,30,0.85); " +
      "border:1px solid rgba(255,160,40,0.5); border-radius:50%; cursor:pointer; " +
      "user-select:none; z-index:5;";
    // Glifo ⓘ subido SOLO en vertical (métrica de la fuente), como en el GraphEngine.
    btnInfo.createSpan({ text: "ⓘ" }).style.cssText = "line-height:1; transform:translateY(-1px);";

    const pop = wrap.createDiv();
    pop.style.cssText =
      "position:absolute; bottom:36px; right:8px; display:none; max-width:260px; " +
      "max-height:200px; overflow-y:auto; padding:8px 10px; box-sizing:border-box; " +
      "background:rgba(20,20,20,0.95); border:1px solid rgba(255,255,255,0.12); " +
      "border-radius:6px; font-size:11px; line-height:1.5; " +
      "color:rgba(230,230,235,0.92); z-index:5; box-shadow:0 4px 12px rgba(0,0,0,0.4);";
    for (const l of lineas) {
      const div = pop.createEl("div", { text: l.texto });
      // La parte matemática (p. ej. `x\in[0,1)`) va renderizada con KaTeX en línea,
      // por el mismo helper que los glifos del toggle; hereda color y tamaño.
      if (l.tex) this.montarEtiquetaMath(div.createSpan(), l.tex, ctx);
    }

    btnInfo.addEventListener("click", (e) => {
      e.stopPropagation();
      pop.style.display = pop.style.display === "none" ? "block" : "none";
    });
  }
}
