// ─────────────────────────────────────────────
// host-obsidian · Registro de fuentes de la interfaz (CUARENTENA de Obsidian)
// ─────────────────────────────────────────────
//
// Registra la familia "Lora" (empaquetada en assets/fonts) para el TEXTO de la
// interfaz del plugin. La aplicación de la fuente se hace en styles.css, acotada a
// `.obsi-math-grafica` (los overlays DOM del plano); aquí solo se CARGA la familia.
//
// Por qué por la API FontFace y no con @font-face en styles.css: las `url()`
// relativas de un CSS de plugin NO resuelven a la carpeta del plugin en Obsidian
// (se resuelven contra el documento de la app). La vía fiable es leer el archivo
// por el adapter del vault → `getResourcePath` da una URL `app://` usable, y se
// añade la `FontFace` a `document.fonts`. Toca la API de Obsidian (adapter,
// manifest) → vive en el host (Ring 3), nunca en el motor.

import type { Plugin } from "obsidian";

// Fuentes variables de Lora (un solo archivo cubre los pesos 400–700 que usa la UI:
// texto normal y los títulos en 600). La itálica se registra por si algún texto la usa.
const ARCHIVOS: ReadonlyArray<{ archivo: string; estilo: "normal" | "italic" }> = [
  { archivo: "Lora-VariableFont_wght.ttf", estilo: "normal" },
  { archivo: "Lora-Italic-VariableFont_wght.ttf", estilo: "italic" },
];

/**
 * Carga y registra la familia "Lora" una sola vez por documento. Idempotente
 * (reactivar el plugin no duplica las caras). Falla en silencio por archivo: si una
 * fuente no carga, la UI cae al fallback del stack CSS (var(--font-interface)).
 */
export async function registrarFuenteLora(plugin: Plugin): Promise<void> {
  // Ya registrada (recarga del plugin en la misma sesión de Obsidian) → nada que hacer.
  let yaEsta = false;
  document.fonts.forEach((f) => { if (f.family === "Lora") yaEsta = true; });
  if (yaEsta) return;

  const dir = plugin.manifest.dir;
  if (!dir) return; // sin ruta del plugin no se puede localizar el asset

  for (const { archivo, estilo } of ARCHIVOS) {
    try {
      const ruta = `${dir}/assets/fonts/Lora/${archivo}`;
      const url = plugin.app.vault.adapter.getResourcePath(ruta);
      const cara = new FontFace("Lora", `url("${url}")`, { weight: "400 700", style: estilo });
      await cara.load();
      document.fonts.add(cara);
    } catch (e) {
      console.warn("Obsi Math: no se pudo cargar la fuente Lora", archivo, e);
    }
  }
}
