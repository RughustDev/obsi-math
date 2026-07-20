import { trazar, normalizarTipo } from "../src/herramientas/trazador";
import { formatear, TODO, type Contenido } from "../src/herramientas/formato";

// ─────────────────────────────────────────────
// CLI del trazador de transformaciones (terminal)
// ─────────────────────────────────────────────
//
// Acceso de TERMINAL al mismo núcleo puro que la consola de Obsidian (`herramientas/`).
// Se bundlea UNA vez con `npm run trazar` (ver package.json) y luego se ejecuta con `node`
// DIRECTO sobre el bundle. Imprime el trazado del bloque sin abrir Obsidian.
//
//   node herramientas/.trazar.cjs <tipo> "<entrada>" [--grafica] [--latex] [--diagnostico]
//
// IMPORTANTE (Windows): se invoca con `node`, NO con `npm run trazar -- …`. El shim
// `npm.cmd` pasa por `cmd.exe`, que trata `^` (exponentes) y `()` como escape y corrompe la
// entrada (`x^3` → `x^^3`). PowerShell/bash llamando a `node` directamente NO tienen ese
// problema. Por eso el script npm SOLO compila; la ejecución va aparte.
//
//   <tipo>    obs-graph (por defecto) | obs-system | obs-derivate | obs-integral
//   <entrada> una ecuación, o varias con [ec1/ec2] (el / separa DENTRO de los corchetes)
//   banderas  sin ninguna → muestra todo; con una o varias → solo esas facetas
//
// Ej:  node herramientas/.trazar.cjs obs-graph "x^3+y^3=9"
//      node herramientas/.trazar.cjs obs-graph "[x^2/x^3]" --latex
//      node herramientas/.trazar.cjs obs-derivate "\frac{d}{dx}(x^2)"
//      node herramientas/.trazar.cjs obs-integral "\int_{0}^{2}x^2\,dx"

const AYUDA = [
  `Uso: node herramientas/.trazar.cjs <tipo> "<entrada>" [--grafica] [--latex] [--diagnostico]`,
  ``,
  `  (compila antes con:  npm run trazar)`,
  `  <tipo>    obs-graph (por defecto) | obs-system | obs-derivate | obs-integral`,
  `  <entrada> una ecuación, o varias con [ec1/ec2] (/ separa dentro de los corchetes)`,
  `  banderas  sin ninguna → todo; con una o varias → solo esas facetas`,
  `  NB Windows: usa 'node', no 'npm run trazar --' (cmd.exe corrompe ^ y paréntesis).`,
  ``,
  `Ej:  node herramientas/.trazar.cjs obs-graph "x^3+y^3=9"`,
  `     node herramientas/.trazar.cjs obs-derivate "\\frac{d}{dx}(x^2)"`,
  `     node herramientas/.trazar.cjs obs-integral "\\int_{0}^{2}x^2\\,dx"`,
].join("\n");

function main(argv: readonly string[]): number {
  const banderas = argv.filter((a) => a.startsWith("--")).map((a) => a.slice(2).toLowerCase());
  const posic = argv.filter((a) => !a.startsWith("--"));

  if (banderas.includes("help") || banderas.includes("ayuda") || posic.length === 0) {
    process.stdout.write(AYUDA + "\n");
    return posic.length === 0 && !banderas.includes("help") && !banderas.includes("ayuda") ? 1 : 0;
  }

  // Si solo se pasa un argumento posicional, es la ENTRADA (tipo por defecto obs-graph);
  // con dos, el primero es el tipo. Así `npm run trazar -- "x^2"` funciona sin escribir el tipo.
  const [tipoBruto, entrada] = posic.length >= 2 ? [posic[0], posic.slice(1).join(" ")]
                                                 : ["graph", posic[0]];

  // Sin banderas de faceta → todo; con alguna → solo las pedidas.
  const pedidas = banderas.filter((b) => b === "grafica" || b === "latex" || b === "diagnostico");
  const q: Contenido = pedidas.length === 0 ? TODO : {
    grafica: pedidas.includes("grafica"),
    latex: pedidas.includes("latex"),
    diagnostico: pedidas.includes("diagnostico"),
  };

  process.stdout.write(formatear(trazar(entrada, normalizarTipo(tipoBruto)), q) + "\n");
  return 0;
}

process.exit(main(process.argv.slice(2)));
