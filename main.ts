import { Plugin, Notice } from "obsidian";

import { GraphEngine } from "./src/engines/obs-graph/GraphEngine";
import { MotorExperimental } from "./src/host-obsidian/MotorExperimental";
import { registrarFuenteLora } from "./src/host-obsidian/fuentes";
import { crearConsolaDev, NOMBRE_GLOBAL } from "./src/host-obsidian/consolaDev";
import {
  AJUSTES_POR_DEFECTO,
  PestanaAjustesObsiMath,
  type AjustesTransformaciones,
  type PluginConAjustes,
} from "./src/host-obsidian/ajustes";

// ─────────────────────────────────────────────
// Plugin principal
// ─────────────────────────────────────────────
export default class ObsiMathPlugin extends Plugin implements PluginConAjustes {
  // Selector del motor para el bloque obs-graph. `true` → motor nuevo (src/motor/);
  // `false` → GraphEngine antiguo (intacto, reactivable con esta sola bandera).
  // El bloque obs-system usa SIEMPRE el motor nuevo: el SystemEngine antiguo, que
  // resolvía las implícitas por marching squares, quedó retirado y no tiene vuelta atrás.
  private readonly MOTOR_EXPERIMENTAL = true;

  // Preferencias persistentes (loadData/saveData). Se cargan en onload; los motores las
  // leen VIVAS por un getter (`() => this.ajustes`), así un cambio en la pestaña de
  // configuración afecta a los bloques que se re-rendericen sin recargar el plugin.
  ajustes: AjustesTransformaciones = { ...AJUSTES_POR_DEFECTO };

  async onload() {
    console.log("Obsi Math: plugin cargado");
    new Notice("¡Obsi Math se ha cargado correctamente!");

    // Ajustes persistentes ANTES de registrar los motores (los capturan por referencia).
    await this.cargarAjustes();
    this.addSettingTab(new PestanaAjustesObsiMath(this.app, this));

    // Fuente Lora para el texto de la interfaz del plugin (se aplica en styles.css,
    // acotada a .obsi-math-grafica). Sin await: no bloquea la carga; hasta que
    // resuelve, la UI usa el fallback del stack CSS.
    void registrarFuenteLora(this);

    // Getter de ajustes VIVOS compartido por los motores (ver arriba).
    const ajustes = () => this.ajustes;

    // ── Bloque obs-graph (UNA función) ─────────
    // La bandera decide el motor; GraphEngine permanece intacto como fallback.
    const graphEngine = new GraphEngine(this);
    const motorGraph = new MotorExperimental(this, false, false, ajustes);
    this.registerMarkdownCodeBlockProcessor(
      "obs-graph",
      (source, el, ctx) =>
        this.MOTOR_EXPERIMENTAL
          ? motorGraph.process(source, el, ctx)
          : graphEngine.process(source, el, ctx)
    );

    // ── Bloque obs-system (SISTEMA de ecuaciones) ──
    // Motor nuevo: cada ecuación con su mejor proveedor (continuación/separable/…),
    // sin marching squares. (Panel de solución/intersecciones: trabajo futuro.)
    const motorSistema = new MotorExperimental(this, true, false, ajustes);
    this.registerMarkdownCodeBlockProcessor(
      "obs-system",
      (source, el, ctx) => motorSistema.process(source, el, ctx)
    );

    // ── Bloque obs-derivate (DERIVADA de una función) ──
    // Como obs-graph (una función, motor nuevo) pero el plano grafica la DERIVADA
    // f'(x) de lo escrito; el panel alterna [Original] (operador d/dx sin evaluar) y
    // [Derivada] (f'(x) = …). Deriva simbólicamente con mathjs (src/derivar.ts).
    const motorDerivada = new MotorExperimental(this, false, true, ajustes);
    this.registerMarkdownCodeBlockProcessor(
      "obs-derivate",
      (source, el, ctx) => motorDerivada.process(source, el, ctx)
    );

    // ── Bloque obs-integral (INTEGRAL DEFINIDA de una función) ──
    // Como obs-graph (una función, motor nuevo) pero el plano grafica el INTEGRANDO f(x) de
    // `\int_a^b f dx` y SOMBREA la región entre a y b; el panel alterna [Operador] (∫ₐᵇ f dx
    // sin evaluar, con el integrando simplificado) y [Valor] (`∫ₐᵇ f dx = <área con signo>`,
    // o una etiqueta si diverge / sale de dominio / los límites no son numéricos). El área se
    // calcula numéricamente (mathjs no integra simbólicamente): src/integral.ts + areaBajoRama.
    const motorIntegral = new MotorExperimental(this, false, false, ajustes, true);
    this.registerMarkdownCodeBlockProcessor(
      "obs-integral",
      (source, el, ctx) => motorIntegral.process(source, el, ctx)
    );

    // Herramienta de desarrollo: global `obsiMath` en la consola de Obsidian (Ctrl+Shift+I)
    // para trazar el pipeline de un bloque (grafica + LaTeX + diagnóstico) sin pintar nada.
    // La MISMA maquinaria pura que la CLI `npm run trazar`. `obsiMath.ayuda()` lista el uso.
    (window as unknown as Record<string, unknown>)[NOMBRE_GLOBAL] = crearConsolaDev();
    console.log(`Obsi Math: consola de desarrollo lista → ${NOMBRE_GLOBAL}.ayuda()`);
  }

  onunload() {
    console.log("Obsi Math: plugin descargado:");
    // Retira el global de consola para no dejar referencias colgando al recargar el plugin.
    delete (window as unknown as Record<string, unknown>)[NOMBRE_GLOBAL];
  }

  /** Carga las preferencias (loadData) copiando SOLO las claves vigentes (las de
   *  AJUSTES_POR_DEFECTO) y de tipo correcto; las ausentes toman su default. NO se fusiona
   *  el objeto del disco entero: un ajuste RETIRADO del código (`simplificarAuto`, de cuando
   *  Simplificar era opcional) quedaba en el data.json del vault, el merge ciego lo
   *  re-adoptaba y guardarAjustes() lo re-persistía para siempre. */
  async cargarAjustes(): Promise<void> {
    const disco = ((await this.loadData()) ?? {}) as Record<string, unknown>;
    const ajustes = { ...AJUSTES_POR_DEFECTO };
    for (const k of Object.keys(ajustes) as (keyof AjustesTransformaciones)[]) {
      if (typeof disco[k] === typeof ajustes[k]) (ajustes[k] as unknown) = disco[k];
    }
    this.ajustes = ajustes;
    // Si el disco traía claves fósiles, se re-persiste ya filtrado: el data.json queda
    // limpio en esta misma carga, no en el siguiente cambio de ajustes.
    if (Object.keys(disco).some((k) => !(k in ajustes))) await this.guardarAjustes();
  }

  /** Persiste las preferencias actuales (saveData). La llama la pestaña de ajustes. */
  async guardarAjustes(): Promise<void> {
    await this.saveData(this.ajustes);
  }
}

// https://github.com/RughustDev/obsi-math