import { parse, evaluate } from "mathjs";

import { normalizarEntrada } from "../parser";
import { compilarExpresion } from "../evaluador";

// ─────────────────────────────────────────────
// Ecuación general (lhs = rhs) → F = lhs - rhs
// ─────────────────────────────────────────────
//
// Forma de cualquier ecuación válida —lineal o no, explícita o implícita— como
// una función F(scope) = lhs - rhs que vale 0 sobre la curva solución. Usa el
// MISMO parser (normalizarEntrada) y el MISMO evaluador (compilarExpresion, con
// las inversas inyectadas) que obs-graph, así que reconoce idéntica sintaxis.

export interface EcuacionGeneral {
  // Variables simbólicas detectadas (sin las constantes de mathjs como pi/e),
  // ordenadas alfabéticamente.
  variables: string[];
  // ¿Es AFÍN (lineal) en todas sus variables? (ver esAfin).
  esLineal: boolean;
  // Evalúa F = (lhs)-(rhs) en un scope { variable: valor }. Un resultado complejo
  // o no numérico (fuera del dominio real) y cualquier error se devuelven como
  // NaN, lo que el contorno y el solver tratan como "sin valor real" en el punto.
  evaluar: (scope: Record<string, number>) => number;
}

// ¿F = lhs-rhs es AFÍN (lineal) en todas sus variables? El detector del solver
// lineal (parsearEcuacionLineal) solo muestrea sobre los EJES (una variable a la
// vez), y da falsos positivos en expresiones lineales sobre los ejes pero no en
// general (p.ej. sqrt(x²+y²), |x|+|y|, que sobre cada eje valen |x|=x). Aquí se
// comprueba la afinidad en puntos FUERA de los ejes (varias variables no nulas y
// distintas a la vez): F debe valer exactamente c + Σ aᵢ·vᵢ en todos ellos.
function esAfin(
  evaluar: (scope: Record<string, number>) => number,
  vars: string[]
): boolean {
  if (vars.length === 0) return true; // sin variables: constante → afín
  const cero: Record<string, number> = {};
  for (const v of vars) cero[v] = 0;
  const c = evaluar(cero);
  if (!Number.isFinite(c)) return false;

  // Coeficiente de cada variable: pendiente sobre su eje.
  const coef: Record<string, number> = {};
  for (const v of vars) {
    const f1 = evaluar({ ...cero, [v]: 1 });
    if (!Number.isFinite(f1)) return false;
    coef[v] = f1 - c;
  }

  // Puntos de prueba con VARIAS variables no nulas y distintas entre sí, donde
  // los términos no lineales / cruzados se delatan. F debe coincidir con la forma
  // afín c + Σ aᵢ·vᵢ en todos ellos.
  const patrones = [2, -1, 3, 0.5, -2];
  for (const base of patrones) {
    const punto: Record<string, number> = {};
    vars.forEach((v, i) => { punto[v] = base * (i + 1); });
    const real = evaluar(punto);
    let esperado = c;
    for (const v of vars) esperado += coef[v] * punto[v];
    if (!Number.isFinite(real) ||
        Math.abs(real - esperado) > 1e-7 * (1 + Math.abs(esperado)))
      return false;
  }
  return true;
}

// Parsea una ecuación "lhs=rhs" a su forma general. Devuelve null si no tiene
// exactamente un "=" o si no se puede parsear como expresión.
export function parsearEcuacion(ecuacion: string): EcuacionGeneral | null {
  try {
    const partes = ecuacion.split("=");
    if (partes.length !== 2) return null;

    const lhs = normalizarEntrada(partes[0].trim());
    const rhs = normalizarEntrada(partes[1].trim());
    const exprDiferencia = `(${lhs})-(${rhs})`;
    const nodo = parse(exprDiferencia);

    // Variables simbólicas: los SymbolNode que NO son constantes evaluables de
    // mathjs (mismo criterio que parsearEcuacionLineal).
    const variables = new Set<string>();
    (nodo as any).traverse((n: any) => {
      if (n.type !== "SymbolNode") return;
      try { evaluate(n.name); } catch { variables.add(n.name); }
    });
    const vars = Array.from(variables).sort();

    const evaluarRaw = compilarExpresion(exprDiferencia);
    const evaluar = (scope: Record<string, number>): number => {
      const v = evaluarRaw(scope);
      return typeof v === "number" ? v : NaN;
    };

    return {
      variables: vars,
      esLineal: esAfin(evaluar, vars),
      evaluar,
    };
  } catch {
    return null;
  }
}
