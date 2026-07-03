import { parse } from "mathjs";

import { FUNCIONES_INVERSAS_EXTRA } from "./constantes";

// ─────────────────────────────────────────────
// Evaluador (compartido por obs-graph y obs-system)
// ─────────────────────────────────────────────

// Compila una expresión YA NORMALIZADA (ver normalizarEntrada) a una función que
// la evalúa en un scope dado. Inyecta SIEMPRE las trigonométricas inversas que
// mathjs no trae nativas (FUNCIONES_INVERSAS_EXTRA: acsc/asec/acot), de modo que
// obs-graph y obs-system reconozcan EXACTAMENTE las mismas funciones. Devuelve
// NaN ante cualquier error de evaluación (símbolo libre, fuera de dominio…). El
// nodo se compila UNA sola vez; la función devuelta reutiliza esa compilación.
export function compilarExpresion(
  expr: string
): (scope: Record<string, number>) => any {
  const compilada = parse(expr).compile();
  return (scope) => {
    try { return compilada.evaluate({ ...scope, ...FUNCIONES_INVERSAS_EXTRA }); }
    catch { return NaN; }
  };
}

// Atajo para funciones de UNA variable (p.ej. la f(x) de obs-graph): compila la
// expresión y devuelve g(v) = expr evaluada con { [varName]: v }. Equivale a
// evaluar la expresión con esa única variable en el scope.
export function compilarFuncion(
  expr: string,
  varName: string
): (v: number) => any {
  const evaluar = compilarExpresion(expr);
  return (v) => evaluar({ [varName]: v });
}
