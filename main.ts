import { Plugin, Notice } from "obsidian";

import { GraphEngine } from "./src/engines/obs-graph/GraphEngine";
import { SystemEngine } from "./src/engines/obs-system/SystemEngine";

// ─────────────────────────────────────────────
// Plugin principal
// ─────────────────────────────────────────────
export default class ObsiMathPlugin extends Plugin {
  // Flag temporal: pon en `true` para reactivar el bloque obs-system.
  private readonly OBS_SISTEMA_HABILITADO = true;

  async onload() {
    console.log("Obsi Math: plugin cargado");
    new Notice("¡Obsi Math se ha cargado correctamente!");

    // ── Bloque obs-graph ───────────────────────
    const graphEngine = new GraphEngine(this);
    this.registerMarkdownCodeBlockProcessor(
      "obs-graph",
      (source, el, ctx) => graphEngine.process(source, el, ctx)
    );

    // ── Bloque obs-system ────────────────────
    const systemEngine = new SystemEngine(this, this.OBS_SISTEMA_HABILITADO);
    this.registerMarkdownCodeBlockProcessor(
      "obs-system",
      (source, el, ctx) => systemEngine.process(source, el, ctx)
    );
  }

  onunload() {
    console.log("Obsi Math: plugin descargado:");
  }
}

// https://github.com/RughustDev/obsi-math