import { parse, simplify } from "mathjs";

import { normalizarEntrada } from "./parser";
import { insertarProductoImplicito } from "./motor/parsing/productoImplicito";
import { componenteParametrica } from "./motor/parsing/componentesParametricas";
import { bloqueALatex } from "./latex";
import {
  formatearCanonico, racionalizarFracciones, combinarYordenar, combinarFracciones,
  profundidadFraccion, rationalizeSeguro, type Nodo,
} from "./formatoExpr";
import { compilarExpresion } from "./evaluador";

// ─────────────────────────────────────────────
// Simplificar y expandir
// ─────────────────────────────────────────────
//
// Reduce y DESARROLLA una expresión preservando la equivalencia, reutilizando mathjs:
//   • `rationalize` lleva un polinomio (o fracción de polinomios) a FORMA CANÓNICA:
//     expande potencias enteras y productos, reduce términos semejantes, evalúa
//     constantes, quita ×1/+0/^1 y dobles negativos, y combina fracciones.
//   • Para lo NO polinómico (sin, tan, log…) rationalize no aplica → `simplify` (reduce
//     lo que pueda; sin x + cos x se deja intacto). Así no se modifica lo irreducible.
//   • NO se hace `simplify(rationalize(...))`: simplify re-factoriza lo expandido.
//
// El resultado se reformatea con `formatearCanonico` (variables antes que constantes en
// lo polinómico: `-2x + 6`; "positivos primero" si hay funciones: `2 - tan(x)`) para (a)
// dar la MISMA forma que Despejar —así Simplificar tras Despejar es un no-op— y (b) ser
// IDEMPOTENTE en formato → detectar de forma fiable cuándo la transformación no cambia nada.
//
// Produce ecuaciones como STRING mathjs (encadenable); el LaTeX deriva por `bloqueALatex`.

// Reglas EXTRA sobre las de fábrica de `simplify`. Solo identidades válidas en TODO ℝ
// (no alteran el dominio de lo graficado, que es la expresión original):
//   • log(e^u) = u — cierto para todo u real (e^u > 0 siempre). mathjs no la trae y
//     dejaba `\ln(e^{3x})` sin reducir; con ella → `3x`.
// NO se añade la inversa e^(log u) = u: solo vale para u > 0 (cambiaría el dominio
// aparente respecto de la curva dibujada). Mismo criterio por el que (x²−1)/(x−1)
// NO se cancela a x+1 (difieren en x=1).
const REGLAS_SIMPLIFY: unknown[] = (simplify as unknown as { rules: unknown[] }).rules
  .concat(["log(e^n1) -> n1", "log(e) -> 1"]);

/** Simplifica y expande una expresión YA NORMALIZADA (mathjs). Nodo equivalente, o null.
 *  La expansión pasa por `rationalizeSeguro`: si el polinomio desbordaría el presupuesto
 *  de monomios (el corazón `(x²+y²−1)³=x²y³` colgaba aquí el hilo de Obsidian, y con él
 *  la nota entera) se cae a `simplify`, que NO expande potencias y siempre termina. La
 *  fórmula se muestra entonces sin desarrollar: degradación honesta, no congelación. */
export function simplificarExpr(exprNorm: string): Nodo | null {
  let base: Nodo;
  try { base = parse(exprNorm); } catch { return null; }
  const r = rationalizeSeguro(base);
  if (r) return r;
  try { return simplify(base, REGLAS_SIMPLIFY as never); } catch { return base; }
}

// Constantes con NOMBRE que NO son variables libres (no se muestrean en la equivalencia).
const CONSTANTES_EVAL = new Set(["pi", "e", "tau", "phi", "Infinity", "NaN"]);
// Muestra "anodina" (no entera, ambos signos, cerca y lejos del origen) para el guardián de
// equivalencia: evita caer justo en raíces/simetrías. Misma filosofía que en `derivar.ts`.
const MUESTRA = [-7.3, -2.6, -1.2, -0.7, -0.3, 0.4, 1.1, 2.7, 5.8, 11.4];

/** Variables LIBRES de una expresión (SymbolNode que no son constantes con nombre): las que
 *  hay que muestrear para comparar dos formas (x en obs-graph; x e y en implícitas/sistemas).
 *  El NOMBRE de una función es también un SymbolNode en mathjs (el `fn` del FunctionNode): hay
 *  que EXCLUIRLO —si `log` o `sqrt` entran como variable, el scope de la evaluación los sombrea
 *  con un número y la expresión entera da NaN → toda forma con funciones se declaraba "no
 *  equivalente"—. El `parent`/`path` del filtro es lo que distingue una cosa de la otra. */
function variablesLibres(expr: string): string[] {
  try {
    const nombres = new Set<string>();
    const esNombreDeFuncion = (padre: Nodo | null, camino: string) =>
      padre !== null && padre.type === "FunctionNode" && camino === "fn";
    (parse(expr).filter(
      (nn: Nodo, camino: string, padre: Nodo | null) =>
        nn.type === "SymbolNode" && !esNombreDeFuncion(padre, camino)
    ) as Nodo[]).forEach((nn) => { if (!CONSTANTES_EVAL.has(nn.name)) nombres.add(nn.name); });
    return [...nombres];
  } catch { return []; }
}

/** ¿`a` y `b` (strings mathjs) definen la MISMA función sobre una muestra de sus variables
 *  libres, INCLUIDA la no-finitud (fidelidad de DOMINIO: una forma que "rellene" un hueco
 *  —p. ej. cancelar √u/√u— queda rechazada)? Conservador: ante cualquier duda → false, y el
 *  llamador conserva la forma original. Cada variable toma un valor distinto de la muestra
 *  (índices desfasados) para no correlacionarlas en x=y. */
function formasEquivalentes(a: string, b: string): boolean {
  try {
    const vars = [...new Set([...variablesLibres(a), ...variablesLibres(b)])];
    const fa = compilarExpresion(a), fb = compilarExpresion(b);
    return MUESTRA.every((_, i) => {
      const scope: Record<string, number> = {};
      vars.forEach((v, k) => { scope[v] = MUESTRA[(i + 3 * k) % MUESTRA.length]; });
      const va = fa(scope) as number, vb = fb(scope) as number;
      const finA = typeof va === "number" && Number.isFinite(va);
      const finB = typeof vb === "number" && Number.isFinite(vb);
      if (!finA || !finB) return finA === finB;
      return Math.abs(va - vb) <= 1e-8 * (1 + Math.abs(va));
    });
  } catch { return false; }
}

/** Formato final compartido: reordena factores/combina semejantes (`combinarYordenar`),
 *  recupera fracciones exactas de los decimales de `rationalize` (`0.5x`→`x/2`) y ordena
 *  canónico (variables antes que constantes). Idempotente en formato. */
function formatear(n: Nodo): string {
  return formatearCanonico(racionalizarFracciones(combinarYordenar(n)));
}

const costo = (n: Nodo): [number, number] => [profundidadFraccion(n), n.toString().length];
const menor = (a: [number, number], b: [number, number]): boolean =>
  a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];

/** Simplifica un lado (o expresión suelta) y lo devuelve como string mathjs, en orden
 *  canónico (variables antes que constantes). Si no se puede, la forma normalizada. */
function simplificarLado(lado: string): string {
  const norm = insertarProductoImplicito(normalizarEntrada(lado.trim()));
  const n = simplificarExpr(norm);
  if (!n) return norm;
  const actual = formatear(n);
  // GUARDIÁN DE FIDELIDAD sobre el resultado principal (antes solo se aplicaba a las
  // candidatas de más abajo). `simplify`/`rationalize` de mathjs son álgebra FORMAL: reducen
  // `0/0` a `0` —FABRICAN un valor donde no hay ninguno— y el panel acababa mostrando
  // `f(x)=0` sobre un plano velado con "Indeterminada" (y `\frac{d}{dx}(0)`, y `∫₀¹0\,dx`:
  // el mismo `simplificarEcuaciones` alimenta el panel de los cuatro bloques). Si la forma
  // simplificada NO coincide con la escrita —incluida la NO-FINITUD— se conserva la escrita:
  // el panel nunca puede afirmar algo que la función no dice.
  if (!formasEquivalentes(actual, norm)) return norm;
  // Solo intervenimos ante una FRACCIÓN DE FRACCIONES (anidamiento ≥2): con funciones,
  // `rationalize` se rinde y `simplify` a veces EMPEORA la forma (convierte una suma de
  // fracciones legible en una anidada, `arccot(x²)/(2√x) − 2x√x/(x⁴+1)` → `(…)/√x`). Todo lo
  // ya plano queda BYTE-IDÉNTICO a antes → idempotencia y tests intactos.
  let curNodo: Nodo;
  try { curNodo = parse(actual); } catch { return actual; }
  if (profundidadFraccion(curNodo) < 2) return actual;
  // Candidatas MÁS PLANAS (menos anidada, luego más corta):
  //  · la ENTRADA ORIGINAL formateada — si `simplify` la anidó de más, se RECUPERA la forma
  //    legible del usuario (`arccot(x²)/(2√x) − 2x√x/(x⁴+1)`, no su versión combinada);
  //  · `combinarFracciones` — aplana a UNA fracción (`(sin x/2 + cos x/3)/x` → `(3sin+2cos)/6x`).
  // Se adopta la de menor coste que sea numéricamente EQUIVALENTE al ORIGINAL (no cambiar el
  // dominio graficado: combinar puede cancelar √u/√u). Si ninguna mejora, se conserva `actual`.
  const candidatas: string[] = [];
  try { candidatas.push(formatear(parse(norm))); } catch { /* original no reparseable */ }
  try { candidatas.push(formatear(combinarFracciones(n))); } catch { /* estructura no soportada */ }
  let mejorStr = actual, mejorCosto = costo(curNodo);
  for (const s of candidatas) {
    try {
      const cost = costo(parse(s));
      if (menor(cost, mejorCosto) && formasEquivalentes(s, norm)) { mejorStr = s; mejorCosto = cost; }
    } catch { /* candidata inválida */ }
  }
  return mejorStr;
}

/** Simplifica y expande cada ecuación de un bloque (ambos lados). Devuelve strings
 *  re-parseables (para encadenar/comparar transformaciones). */
export function simplificarEcuaciones(ecuaciones: readonly string[]): string[] {
  return ecuaciones.map((ec) => {
    // Componente paramétrica (`x(t)=…`): el LHS no es una expresión sino una DECLARACIÓN de
    // función del parámetro. Pasarlo por el pipeline lo leería como el producto `x·t` y el
    // panel acabaría mostrando `t·x = …` (una implícita inventada). Se simplifica el cuerpo y
    // se reconstruye la declaración.
    const comp = componenteParametrica(ec);
    if (comp) return `${comp.eje}(t) = ${simplificarLado(comp.expr)}`;
    const partes = ec.split("=");
    if (partes.length === 2) return `${simplificarLado(partes[0])} = ${simplificarLado(partes[1])}`;
    return simplificarLado(ec); // expresión suelta
  });
}

/** LaTeX del bloque simplificado y expandido (deriva del string por el pipeline). */
export function simplificarBloqueLatex(ecuaciones: readonly string[]): string {
  return bloqueALatex(simplificarEcuaciones(ecuaciones));
}
