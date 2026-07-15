import { trazar, normalizarTipo, type Trazado } from "../herramientas/trazador";
import { formatear, TODO, type Contenido } from "../herramientas/formato";

// ─────────────────────────────────────────────
// Consola de desarrollo (global `obsiMath` en DevTools de Obsidian)
// ─────────────────────────────────────────────
//
// Expone el trazador de transformaciones como un objeto global para la consola de Obsidian
// (Ctrl+Shift+I). Cada método imprime el trazado formateado Y devuelve el objeto estructurado
// (`Trazado`) para inspeccionarlo a mano. Es la MISMA maquinaria pura que la CLI de terminal
// (`herramientas/trazar.ts`): aquí solo se envuelve para la consola y se engancha en `window`.
//
// Vive en host-obsidian porque toca `window` (Ring 3). El núcleo (`herramientas/`) es puro.

export const NOMBRE_GLOBAL = "obsiMath";

/** Ejecuta el trazado y lo imprime en consola con las facetas pedidas; devuelve el objeto. */
function correr(entrada: string, tipoBruto: string, q: Contenido): Trazado {
  const t = trazar(entrada, normalizarTipo(tipoBruto));
  console.log(formatear(t, q));
  return t;
}

const AYUDA = [
  `obsiMath — trazador de transformaciones de Obsi Math`,
  ``,
  `  obsiMath.trazar(entrada, tipo)      todo (grafica + latex + diagnóstico)`,
  `  obsiMath.grafica(entrada, tipo)     solo el string mathjs que grafica`,
  `  obsiMath.latex(entrada, tipo)       solo el LaTeX que renderiza KaTeX`,
  `  obsiMath.diagnostico(entrada, tipo) solo la clasificación`,
  ``,
  `  tipo: "obs-graph" (por defecto) | "obs-system" | "obs-derivate" | "obs-integral"`,
  `        (valen también "graph"/"sistema"/"derivada"/"integrar"…)`,
  `  entrada: una ecuación, o varias con [ec1/ec2] (el / separa DENTRO de los corchetes).`,
  ``,
  `  Ej:  obsiMath.trazar("x^3+y^3=9")`,
  `       obsiMath.trazar("[x^2/x^3]")            // dos curvas independientes`,
  `       obsiMath.trazar("x-y=1\\nx+y=3", "obs-system")`,
  `       obsiMath.derivada("\\\\frac{d}{dx}(x^2)") // obs-derivate`,
  `       obsiMath.integral("\\\\int_{0}^{2}x^2\\\\,dx") // obs-integral`,
].join("\n");

/**
 * Crea el objeto global de consola. `tipo` es opcional en todos los métodos (por defecto
 * `obs-graph`). `derivada`/`sistema`/`grafo` son atajos que fijan el tipo.
 */
export function crearConsolaDev() {
  const api = {
    trazar: (entrada: string, tipo = "graph") => correr(entrada, tipo, TODO),
    grafica: (entrada: string, tipo = "graph") =>
      correr(entrada, tipo, { grafica: true, latex: false, diagnostico: false }),
    latex: (entrada: string, tipo = "graph") =>
      correr(entrada, tipo, { grafica: false, latex: true, diagnostico: false }),
    diagnostico: (entrada: string, tipo = "graph") =>
      correr(entrada, tipo, { grafica: false, latex: false, diagnostico: true }),
    // Atajos por tipo (evitan pasar el segundo argumento).
    grafo: (entrada: string) => correr(entrada, "graph", TODO),
    sistema: (entrada: string) => correr(entrada, "system", TODO),
    derivada: (entrada: string) => correr(entrada, "derivate", TODO),
    integral: (entrada: string) => correr(entrada, "integral", TODO),
    ayuda: () => { console.log(AYUDA); },
  };
  return api;
}
