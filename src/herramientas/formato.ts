import type { Trazado, BloqueTrazado, Paso } from "./trazador";

// ─────────────────────────────────────────────
// Formateo del trazado a texto plano (compartido por CLI de terminal y consola de Obsidian)
// ─────────────────────────────────────────────
//
// Convierte un `Trazado` en un bloque de texto legible. Sin color ni caracteres exóticos
// (funciona igual en la terminal de Windows y en la consola de DevTools de Obsidian). El
// usuario puede pedir SOLO una faceta —lo que grafica, el LaTeX, o el diagnóstico— con las
// banderas de `Contenido`; por defecto muestra las tres.

/** Qué facetas incluir. Todas true = vista completa. */
export interface Contenido {
  grafica: boolean;   // el string mathjs re-parseable (lo que ENTREGA/grafica)
  latex: boolean;     // el LaTeX que pinta KaTeX (lo que RENDERIZA)
  diagnostico: boolean; // tipo de objeto, normalizada, estado de despeje
}

export const TODO: Contenido = { grafica: true, latex: true, diagnostico: true };

const NOMBRE: Record<Trazado["tipo"], string> = {
  graph: "obs-graph",
  system: "obs-system",
  derivate: "obs-derivate",
  integral: "obs-integral",
};

function formatearPaso(p: Paso, q: Contenido): string[] {
  const lineas: string[] = [`  • ${p.etiqueta}${p.nota ? `  (${p.nota})` : ""}`];
  // Varias ecuaciones (sistema) se muestran numeradas; una sola, en línea.
  const uno = (campo: string, valores: readonly string[]) => {
    if (valores.length <= 1) return [`      ${campo}: ${valores[0] ?? ""}`];
    return [`      ${campo}:`, ...valores.map((v, i) => `        [${i + 1}] ${v}`)];
  };
  if (q.grafica) lineas.push(...uno("grafica", p.mathjs));
  if (q.latex) lineas.push(...uno("latex  ", [p.latex]));
  return lineas;
}

function formatearBloque(b: BloqueTrazado, q: Contenido, indice: number | null): string[] {
  const lineas: string[] = [];
  if (indice !== null) lineas.push(`── Curva ${indice} ──  ${b.entrada.join("  /  ")}`);
  if (q.diagnostico) {
    for (const d of b.diagnostico) {
      lineas.push(`  Diagnóstico [${d.entrada}]:`);
      lineas.push(`      tipo: ${d.tipo}`);
      lineas.push(`      normaliza a: ${d.normalizada}`);
      if (d.extra) lineas.push(`      ${d.extra}`);
    }
  }
  for (const p of b.pasos) lineas.push(...formatearPaso(p, q));
  return lineas;
}

/** Texto completo del trazado. `q` elige qué facetas mostrar (por defecto todas). */
export function formatear(t: Trazado, q: Contenido = TODO): string {
  const cab = `━━━ ${NOMBRE[t.tipo]} ━━━`;
  // Solo se numeran las curvas si hay más de un bloque (varias ecuaciones en graph/derivate).
  const varias = t.bloques.length > 1;
  const cuerpo = t.bloques.flatMap((b, i) => formatearBloque(b, q, varias ? i + 1 : null));
  return [cab, ...cuerpo].join("\n");
}
