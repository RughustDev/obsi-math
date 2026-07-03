import { parse } from "mathjs";

import { normalizarEntrada } from "./parser";

// ─────────────────────────────────────────────
// LaTeX → presentación
// ─────────────────────────────────────────────

/**
 * Reescribe el LaTeX que mathjs genera para las inversas (`\sin^{-1}`, …) a la
 * notación pedida: arcsin/arccos/arctan como comandos `\arc…` y las menos
 * comunes como `\text{arc…}` (KaTeX no tiene comando propio para ellas).
 */
function embellecerInversasLatex(tex: string): string {
  return tex
    .replace(/\\sin\s*\^\{-1\}/g, "\\arcsin")
    .replace(/\\cos\s*\^\{-1\}/g, "\\arccos")
    .replace(/\\tan\s*\^\{-1\}/g, "\\arctan")
    .replace(/\\csc\s*\^\{-1\}/g, "\\text{arccsc}")
    .replace(/\\sec\s*\^\{-1\}/g, "\\text{arcsec}")
    .replace(/\\cot\s*\^\{-1\}/g, "\\text{arccot}");
}

// Nombre LaTeX de cada función de "operador con nombre" a la que se le aplica la
// política tipográfica de paréntesis. Las inversas usan aquí el nombre arc…
// directamente (así no dependen de embellecerInversasLatex, que opera sobre el
// patrón `\sin^{-1}` que esta política ya no produce).
const NOMBRE_FUNCION_TEX: Record<string, string> = {
  sin: "\\sin", cos: "\\cos", tan: "\\tan",
  sec: "\\sec", csc: "\\csc", cot: "\\cot",
  sinh: "\\sinh", cosh: "\\cosh", tanh: "\\tanh", coth: "\\coth",
  log: "\\ln",            // en mathjs `log` (un argumento) es el logaritmo natural
  exp: "\\exp",
  asin: "\\arcsin", acos: "\\arccos", atan: "\\arctan",
  acsc: "\\text{arccsc}", asec: "\\text{arcsec}", acot: "\\text{arccot}",
};

/**
 * Handler de `toTex` que aplica una política de paréntesis basada en el AST:
 * para las funciones de NOMBRE_FUNCION_TEX con UN argumento, omite los paréntesis
 * si el argumento es un átomo (SymbolNode = variable/constante con nombre como
 * x, θ, π, e; o ConstantNode = literal numérico) y los añade para cualquier otro
 * nodo (operador, función anidada, raíz, |x|, potencia…). Reproduce la tipografía
 * matemática usual: `\sin x`, `\ln x`, pero `\sin\left(x+1\right)`, `\exp\left(x^2\right)`.
 *
 * Devuelve `undefined` para el resto de nodos (incl. funciones de 2 argumentos
 * como `log(x,2)` → `\log_{2}` y raíces/abs), dejando el render por defecto de
 * mathjs. Recurre con `arg.toTex(options)` para que la política se propague a
 * funciones anidadas.
 */
function manejadorFuncionesTex(node: any, options: any): string | undefined {
  if (node.type === "FunctionNode" && node.args.length === 1) {
    const nombreTex = NOMBRE_FUNCION_TEX[node.fn?.name];
    if (nombreTex) {
      const arg = node.args[0];
      const argTex = arg.toTex(options);
      const atomico = arg.type === "SymbolNode" || arg.type === "ConstantNode";
      return atomico
        ? `${nombreTex} ${argTex.trim()}`
        : `${nombreTex}\\left(${argTex}\\right)`;
    }
  }
  return undefined;
}

// Opciones de toTex compartidas: paréntesis mínimos de operadores + política
// tipográfica de funciones (ver manejadorFuncionesTex).
export const OPCIONES_TEX = { parenthesis: "auto", handler: manejadorFuncionesTex } as const;

/** Elimina artefactos de espaciado que mathjs introduce en el LaTeX generado. */
export function limpiarTex(tex: string): string {
  let resultado = embellecerInversasLatex(tex);
  resultado = resultado.replace(/~\s*/g, "");
  // Colapsa SÓLO grupos `{x}` sueltos (artefactos de mathjs). No toca los que
  // son argumento de un comando (`\sqrt{x}`) ni de un sub/superíndice (`_{x}`,
  // `^{x}`) ni de una raíz n-ésima (`\sqrt[3]{x}`, llave tras `]`): si se
  // quitaran, `\sqrt{x}` se volvería `\sqrtx` (comando inválido → KaTeX lo pinta
  // en rojo) y `\frac{x}{2}` se rompería.
  resultado = resultado.replace(/(^|[^a-zA-Z\\^_}\]])\{\s*([a-zA-Z0-9])\s*\}/g, "$1$2");
  resultado = resultado.replace(/(\d)\s+([a-zA-Z\\])/g, "$1$2");
  return resultado.trim();
}

/** Quita llaves externas redundantes de una cadena LaTeX. */
export function quitarLlavesExternas(texto: string): string {
  let resultado = texto.trim();
  while (resultado.startsWith("{") && resultado.endsWith("}")) {
    let profundidad = 0;
    let envuelveTodo = true;

    for (let i = 0; i < resultado.length; i++) {
      if (resultado[i] === "{") profundidad++;
      else if (resultado[i] === "}") profundidad--;

      if (profundidad === 0 && i < resultado.length - 1) {
        envuelveTodo = false;
        break;
      }
    }

    if (!envuelveTodo) break;
    resultado = resultado.slice(1, -1).trim();
  }
  return resultado;
}

// Convierte UN lado de una ecuación a LaTeX por el MISMO pipeline que obs-graph:
// normalizarEntrada (texto o LaTeX → sintaxis mathjs) → parse → toTex(OPCIONES_TEX)
// → limpiarTex. Así la tipografía (exponentes, paréntesis mínimos, raíces, trig e
// inversas, logaritmos, funciones especiales) es IDÉNTICA a la de obs-graph. Si el
// lado no se puede parsear, cae al texto normalizado (KaTeX suele renderizarlo).
function ladoALatex(lado: string): string {
  const norm = normalizarEntrada(lado.trim());
  try {
    return limpiarTex(parse(norm).toTex(OPCIONES_TEX));
  } catch {
    return norm;
  }
}

/** Convierte una ecuación de texto a LaTeX (opcionalmente con `&=` para alineación). */
export function ecuacionALatex(ecuacion: string, alineada = false): string {
  const partes = ecuacion.split("=");
  if (partes.length !== 2) return ecuacion;
  // AMBOS lados por el pipeline compartido. Antes el RHS con LaTeX (`includes("\\")`)
  // se desviaba por una ruta de regex (agregarParentesisFuncionesLatex) que NO usaba
  // toTex, produciendo tipografía distinta a obs-graph e incluso cambiando el
  // significado (`\sin x^2` → `\sin\left(x\right)^2` = (sin x)² en vez de sin(x²)).
  // normalizarEntrada ya convierte el LaTeX de entrada a mathjs, así que esa ruta
  // sobraba: ahora obs-system y obs-graph comparten EXACTAMENTE el mismo pipeline.
  const signo = alineada ? "&=" : "=";
  return ladoALatex(partes[0]) + signo + ladoALatex(partes[1]);
}