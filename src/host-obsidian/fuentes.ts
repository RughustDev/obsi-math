// ─────────────────────────────────────────────
// host-obsidian · Registro de fuentes de la interfaz (CUARENTENA de Obsidian)
// ─────────────────────────────────────────────
//
// Registra la familia "Lora" para el TEXTO de la interfaz del plugin. La aplicación
// de la fuente se hace en styles.css, acotada a `.lmath-grafica` (los overlays
// DOM del plano); aquí solo se CARGA la familia.
//
// Los `.ttf` se IMPORTAN como Data URI: esbuild los incrusta en el bundle (main.js)
// con el loader `dataurl` (ver package.json → script "build"). Así la release cumple
// el estándar de Obsidian —solo main.js, manifest.json y styles.css— sin distribuir
// la carpeta assets/fonts ni depender de `getResourcePath`. La fuente ya viaja dentro
// del bundle, así que no toca la API del vault; se conserva el parámetro `plugin` solo
// por compatibilidad de la API pública.

import type { Plugin } from "obsidian";

// Data URIs incrustados por esbuild en tiempo de build (loader dataurl → string).
import loraNormalUri from "../../assets/fonts/Lora/Lora-VariableFont_wght.ttf";
import loraItalicUri from "../../assets/fonts/Lora/Lora-Italic-VariableFont_wght.ttf";

// Fuentes variables de Lora (un solo archivo cubre los pesos 400–700 que usa la UI:
// texto normal y los títulos en 600). La itálica se registra por si algún texto la usa.
const CARAS: ReadonlyArray<{ uri: string; estilo: "normal" | "italic" }> = [
  { uri: loraNormalUri, estilo: "normal" },
  { uri: loraItalicUri, estilo: "italic" },
];

/**
 * Carga y registra la familia "Lora" una sola vez por documento. Idempotente
 * (reactivar el plugin no duplica las caras). Falla en silencio por cara: si una
 * fuente no carga, la UI cae al fallback del stack CSS (var(--font-interface)).
 *
 * El parámetro `plugin` ya no se usa (la fuente viaja embebida en el bundle); se
 * mantiene por compatibilidad con la API pública y llamadas existentes.
 */
export async function registrarFuenteLora(_plugin?: Plugin): Promise<void> {
  // Ya registrada (recarga del plugin en la misma sesión de Obsidian) → nada que hacer.
  let yaEsta = false;
  document.fonts.forEach((f) => { if (f.family === "Lora") yaEsta = true; });
  if (yaEsta) return;

  for (const { uri, estilo } of CARAS) {
    try {
      const cara = new FontFace("Lora", `url("${uri}")`, { weight: "400 700", style: estilo });
      await cara.load();
      document.fonts.add(cara);
    } catch (e) {
      console.warn("LMath: no se pudo cargar la fuente Lora", estilo, e);
    }
  }
}
