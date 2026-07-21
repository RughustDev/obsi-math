import { parse } from "mathjs";

import { compilarFuncion } from "./evaluador";
import { type Nodo } from "./formatoExpr";

// ─────────────────────────────────────────────
// Simplificador de CONDICIONES de dominio (sistema de desigualdades en x)
// ─────────────────────────────────────────────
//
// El despeje emite sus guardas de una en una, tal como las va descubriendo: cada capa de rango
// restringido y cada elevación al cuadrado añade su `dom(cuerpo, c)` y el panel las lista todas.
// Eso es CORRECTO pero ilegible, porque son condiciones sobre la MISMA variable y nadie mira el
// sistema entero: `√(y+1)+√(y−2) = x` acaba mostrando
//     (x²+3)/(2x) ≥ 0,  (x²−3)/(2x) ≥ 0
// cuando lo que dicen las dos juntas es, simplemente, `x ≥ √3`.
//
// Aquí se resuelve el sistema. La pieza clave es que una condición `c(x) ≥ 0` con c RACIONAL se
// decide por su TABLA DE SIGNOS: los ceros del numerador y del denominador parten la recta en
// tramos donde el signo es constante, así que basta con localizar esos puntos críticos y probar
// un punto de cada tramo. El resultado es una unión de intervalos, y el sistema completo es su
// INTERSECCIÓN —que es donde se van solas las redundancias (una condición implicada por otra no
// recorta nada), donde se funden los tramos contiguos y donde se detecta la contradicción (la
// intersección vacía: no hay curva)—.
//
// Los puntos críticos se calculan de forma SIMBÓLICA (no numérica) porque son los que se van a
// mostrar: la raíz de `x²−3` tiene que salir como `√3`, no como `1.7320508`. De ahí que el
// alcance sea el de las raíces con forma cerrada de manual: grado 1, grado 2 por la fórmula
// general —con el factor cuadrado extraído del radicando, `√12 = 2√3`— y grados superiores solo
// si se dejan deflactar por raíces enteras.
//
// Fuera de eso (una condición con `tan x`, `|x|`, `√x`… o un polinomio que no se deja factorizar)
// el módulo devuelve null y quien llama SIGUE MOSTRANDO las condiciones tal cual. Es un
// simplificador de PRESENTACIÓN: no decide nada que el motor no supiera ya, y su fallo es
// siempre "no simplifico", nunca "simplifico mal".

const VAR = "x";

/** Extremo de un intervalo: la expresión (string mathjs) y si el propio punto entra. */
export interface ExtremoCond { expr: string; cerrado: boolean }

/** Rango solución del sistema. `null` en un extremo = no acotado por ese lado. */
export interface RangoCond { min: ExtremoCond | null; max: ExtremoCond | null }

/** Resultado de simplificar un sistema de condiciones:
 *   • "rango"     un único intervalo (lo que se puede escribir como `a ≤ x ≤ b`);
 *   • "siempre"   se cumple en todo ℝ → no hay coletilla que mostrar;
 *   • "imposible" la intersección es vacía → el despeje no describe ninguna curva real.
 *  `null` = fuera de alcance; quien llama debe conservar las condiciones sin tocar. */
export type ResultadoCond =
  | { tipo: "rango"; rango: RangoCond }
  | { tipo: "siempre" }
  | { tipo: "imposible" }
  | null;

// ── Aritmética de polinomios y funciones racionales ──────────────────────────
//
// Un polinomio es su vector de coeficientes (`p[i]` acompaña a `x^i`) y una racional, el par
// numerador/denominador. Se construyen recorriendo el AST, así que la extracción es EXACTA (no
// depende de que `rationalize` sepa expandir la expresión) y falla limpio ante lo que no sea
// racional en x, que es justo la frontera del módulo.

type Poli = number[];
interface Racional { num: Poli; den: Poli }

const EPS = 1e-12;

/** Quita los ceros de cabecera (el grado real del polinomio). */
function podar(p: Poli): Poli {
  let i = p.length - 1;
  while (i > 0 && Math.abs(p[i]) < EPS) i--;
  return p.slice(0, i + 1);
}

function sumaPoli(a: Poli, b: Poli): Poli {
  const out = new Array<number>(Math.max(a.length, b.length)).fill(0);
  a.forEach((v, i) => { out[i] += v; });
  b.forEach((v, i) => { out[i] += v; });
  return podar(out);
}

function multPoli(a: Poli, b: Poli): Poli {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  a.forEach((va, i) => b.forEach((vb, j) => { out[i + j] += va * vb; }));
  return podar(out);
}

const escalarPoli = (p: Poli, k: number): Poli => podar(p.map((v) => v * k));

/** ¿El polinomio es la constante 0? (denominador nulo, condición degenerada). */
const esCero = (p: Poli): boolean => p.every((v) => Math.abs(v) < EPS);

/** Quita TODOS los paréntesis envolventes: el despeje compone sus strings a base de envolver, y
 *  llegan aquí anidados (`((x^2+3))/(2x)`); con un solo nivel pelado el nodo seguía siendo un
 *  paréntesis y la condición se descartaba por "no racional". */
function desParen(n: Nodo): Nodo {
  return n.type === "ParenthesisNode" ? desParen(n.content) : n;
}

function potenciaRacional(r: Racional, k: number): Racional | null {
  if (!Number.isInteger(k)) return null;
  if (k < 0) return potenciaRacional({ num: r.den, den: r.num }, -k);
  let out: Racional = { num: [1], den: [1] };
  for (let i = 0; i < k; i++) out = { num: multPoli(out.num, r.num), den: multPoli(out.den, r.den) };
  return out;
}

/** La expresión como función racional de x, o null si no lo es (otra variable, `sin`, `√`, `|·|`,
 *  un exponente no entero…). Es el filtro de entrada del módulo. */
function racionalDe(n0: Nodo): Racional | null {
  const n = desParen(n0);
  if (n.type === "ConstantNode") {
    const v = Number(n.value);
    return Number.isFinite(v) ? { num: [v], den: [1] } : null;
  }
  if (n.type === "SymbolNode") return n.name === VAR ? { num: [0, 1], den: [1] } : null;
  if (n.type === "OperatorNode") {
    if (n.args.length === 1 && n.op === "-") {
      const a = racionalDe(n.args[0]);
      return a && { num: escalarPoli(a.num, -1), den: a.den };
    }
    if (n.args.length === 2) {
      const a = racionalDe(n.args[0]);
      if (a === null) return null;
      if (n.op === "^") {
        const e = desParen(n.args[1]);
        return e.type === "ConstantNode" ? potenciaRacional(a, Number(e.value)) : null;
      }
      const b = racionalDe(n.args[1]);
      if (b === null) return null;
      switch (n.op) {
        case "+": return { num: sumaPoli(multPoli(a.num, b.den), multPoli(b.num, a.den)), den: multPoli(a.den, b.den) };
        case "-": return { num: sumaPoli(multPoli(a.num, b.den), escalarPoli(multPoli(b.num, a.den), -1)), den: multPoli(a.den, b.den) };
        case "*": return { num: multPoli(a.num, b.num), den: multPoli(a.den, b.den) };
        case "/": return { num: multPoli(a.num, b.den), den: multPoli(a.den, b.num) };
        default: return null;
      }
    }
  }
  return null;
}

// ── Raíces con forma cerrada ─────────────────────────────────────────────────

/** Punto crítico: su valor numérico (para ordenar y muestrear) y su forma EXACTA (para mostrar). */
interface Critico { valor: number; expr: string }

const mcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : mcd(b, Math.abs(a % b)));

/** Mayor s con s² | g: saca el factor cuadrado del radicando (`√12 = 2√3`). */
function mayorCuadrado(g: number): number {
  for (let s = Math.floor(Math.sqrt(g)); s >= 2; s--) if (g % (s * s) === 0) return s;
  return 1;
}

/** Racional exacto `p/q` (q ≤ 64) como string, o null si el valor no lo es. */
function fraccion(v: number): string | null {
  for (let q = 1; q <= 64; q++) {
    const p = Math.round(v * q);
    if (Math.abs(v * q - p) < 1e-9 * Math.max(1, Math.abs(p))) return q === 1 ? `${p}` : `${p}/${q}`;
  }
  return null;
}

/** `(b ± s√r)/d` en su forma más limpia: se reduce por el mcd, el signo se absorbe en el
 *  coeficiente del radical (`-sqrt(2)`, no `-(-1*sqrt(2))`) y se omite lo trivial. */
function raizCuadratica(b: number, s: number, r: number, d: number, signo: 1 | -1): string | null {
  let [B, S, D] = [b, s * signo, d];
  const g = mcd(mcd(Math.round(B), Math.round(S)), Math.round(D));
  if (g > 1 && [B, S, D].every((v) => Math.abs(v - Math.round(v)) < 1e-9)) { B /= g; S /= g; D /= g; }
  if (D < 0) { B = -B; S = -S; D = -D; }   // el signo del denominador sube al numerador
  const abs = Math.abs(S);
  const cuerpo = r === 1 ? `${abs}` : abs === 1 ? `sqrt(${r})` : `${abs}*sqrt(${r})`;
  const arriba = Math.abs(B) < EPS
    ? (S < 0 ? `-${cuerpo}` : cuerpo)
    : `${fraccion(B) ?? B} ${S < 0 ? "-" : "+"} ${cuerpo}`;
  return Math.abs(D - 1) < EPS ? arriba : `(${arriba})/(${D})`;
}

/** Raíces REALES de un polinomio con su forma cerrada, o null si no se sabe factorizar del todo
 *  (grado ≥3 sin raíces enteras: sin forma cerrada mostrable, el módulo se retira). */
function raices(p0: Poli): Critico[] | null {
  let p = podar(p0);
  if (esCero(p)) return null;                       // idénticamente nulo: no parte la recta
  const out: Critico[] = [];

  // Factor x^m: la raíz 0, que es además la más común (denominadores `2x`).
  let m = 0;
  while (p.length > 1 && Math.abs(p[0]) < EPS) { p = p.slice(1); m++; }
  if (m > 0) out.push({ valor: 0, expr: "0" });

  // Deflación por raíces ENTERAS pequeñas mientras el grado sea ≥3 (Ruffini).
  let vueltas = 0;
  while (p.length - 1 >= 3 && vueltas++ < 6) {
    let encontrada = false;
    for (let r = -12; r <= 12 && !encontrada; r++) {
      const v = p.reduce((s, c, i) => s + c * Math.pow(r, i), 0);
      if (Math.abs(v) > 1e-9 * p.reduce((s, c) => s + Math.abs(c), 0)) continue;
      const q = new Array<number>(p.length - 1).fill(0);   // división sintética por (x − r)
      for (let i = p.length - 1; i >= 1; i--) q[i - 1] = p[i] + (i < p.length - 1 ? q[i] * r : 0);
      out.push({ valor: r, expr: `${r}` });
      p = podar(q);
      encontrada = true;
    }
    if (!encontrada) return null;                   // grado alto irreducible: fuera de alcance
  }

  const g = p.length - 1;
  if (g <= 0) return out;                           // constante no nula: sin más raíces
  if (g === 1) {
    const v = -p[0] / p[1];
    const e = fraccion(v);
    return e === null ? null : [...out, { valor: v, expr: e }];
  }
  // Grado 2: fórmula general con el factor cuadrado fuera del radical.
  const [c, b, a] = [p[0], p[1], p[2]];
  const disc = b * b - 4 * a * c;
  if (disc < -1e-12) return out;                    // sin raíces reales: signo constante
  if (Math.abs(disc) < 1e-12) {
    const v = -b / (2 * a);
    const e = fraccion(v);
    return e === null ? null : [...out, { valor: v, expr: e }];
  }
  const entero = Math.round(disc);
  if (Math.abs(disc - entero) > 1e-9) return null;  // discriminante no exacto: no se muestra bien
  const s = mayorCuadrado(entero);
  const r = entero / (s * s);
  const raiz = Math.sqrt(disc);
  const mas = raizCuadratica(-b, s, r, 2 * a, 1);
  const menos = raizCuadratica(-b, s, r, 2 * a, -1);
  if (mas === null || menos === null) return null;
  return [...out,
    { valor: (-b + raiz) / (2 * a), expr: mas },
    { valor: (-b - raiz) / (2 * a), expr: menos }];
}

// ── Tabla de signos → unión de intervalos ────────────────────────────────────

/** Un intervalo de la solución. `null` en un extremo = no acotado por ese lado. */
interface Tramo { min: Critico | null; max: Critico | null; minCerrado: boolean; maxCerrado: boolean }

/** Conjunto donde `cond ≥ 0`, como unión ORDENADA y disjunta de intervalos. null si la condición
 *  no es racional en x o si sus raíces no tienen forma cerrada. */
function conjuntoDe(cond: string): Tramo[] | null {
  let r: Racional | null;
  try { r = racionalDe(parse(cond) as unknown as Nodo); } catch { return null; }
  if (r === null || esCero(r.den)) return null;

  const rn = raices(r.num), rd = raices(r.den);
  if (rn === null || rd === null) return null;
  // Puntos críticos únicos y ordenados: los del numerador (donde la condición se anula) y los del
  // denominador (donde ni siquiera está definida) parten la recta en tramos de signo constante.
  const criticos: Critico[] = [];
  for (const c of [...rn, ...rd]) if (!criticos.some((z) => Math.abs(z.valor - c.valor) < 1e-9)) criticos.push(c);
  criticos.sort((a, b) => a.valor - b.valor);

  let f: (x: number) => unknown;
  try { f = compilarFuncion(cond, VAR); } catch { return null; }
  const cumple = (x: number): boolean => {
    const v = f(x);
    return typeof v === "number" && Number.isFinite(v) && v >= -1e-12;
  };

  // Un punto de prueba por tramo (los abiertos, a distancia 1 del crítico extremo) y el propio
  // punto crítico, que entra solo si la condición está definida y es ≥0 justo ahí.
  const dentroTramo: boolean[] = [];
  for (let i = 0; i <= criticos.length; i++) {
    const izq = i === 0 ? null : criticos[i - 1].valor;
    const der = i === criticos.length ? null : criticos[i].valor;
    const prueba = izq === null ? (der as number) - 1 : der === null ? izq + 1 : (izq + der) / 2;
    dentroTramo.push(cumple(prueba));
  }
  const dentroPunto = criticos.map((c) => cumple(c.valor));

  // Fusión de tramos y puntos contiguos en intervalos maximales.
  const tramos: Tramo[] = [];
  let abierto: Tramo | null = null;
  for (let i = 0; i <= criticos.length; i++) {
    if (dentroTramo[i] && abierto === null) abierto = { min: i === 0 ? null : criticos[i - 1], max: null, minCerrado: i > 0 && dentroPunto[i - 1], maxCerrado: false };
    if (!dentroTramo[i] && abierto !== null) {
      abierto.max = criticos[i - 1];
      abierto.maxCerrado = dentroPunto[i - 1];
      tramos.push(abierto);
      abierto = null;
    }
    // Punto crítico AISLADO (los dos tramos vecinos fuera): un cero suelto, p.ej. `x² ≥ 0` al
    // revés. Se registra como intervalo degenerado para no perderlo en la intersección.
    if (i < criticos.length && dentroPunto[i] && !dentroTramo[i] && !dentroTramo[i + 1])
      tramos.push({ min: criticos[i], max: criticos[i], minCerrado: true, maxCerrado: true });
  }
  if (abierto !== null) tramos.push(abierto);
  return tramos;
}

// ── Intersección del sistema ─────────────────────────────────────────────────

const valorMin = (t: Tramo): number => (t.min === null ? -Infinity : t.min.valor);
const valorMax = (t: Tramo): number => (t.max === null ? Infinity : t.max.valor);

/** Intersección de dos uniones de intervalos. En cada extremo gana el MÁS RESTRICTIVO, y ahí es
 *  donde una condición redundante desaparece sola: no recorta nada. */
function intersecar(A: Tramo[], B: Tramo[]): Tramo[] {
  const out: Tramo[] = [];
  for (const a of A) {
    for (const b of B) {
      const [ia, ib] = [valorMin(a), valorMin(b)];
      const [sa, sb] = [valorMax(a), valorMax(b)];
      const inf = Math.max(ia, ib), sup = Math.min(sa, sb);
      if (inf > sup + 1e-12) continue;
      const desdeA = ia > ib + 1e-12 ? a : ib > ia + 1e-12 ? b : null;   // null = empatan
      const hastaA = sa < sb - 1e-12 ? a : sb < sa - 1e-12 ? b : null;
      const minCerrado = desdeA ? desdeA.minCerrado : a.minCerrado && b.minCerrado;
      const maxCerrado = hastaA ? hastaA.maxCerrado : a.maxCerrado && b.maxCerrado;
      // Se tocan en UN punto (`(0,∞)` con `[−√3,0)`): solo hay intersección si ese punto entra
      // por los dos lados. Sin esta comprobación salía un intervalo degenerado fantasma que
      // rompía la unificación del sistema.
      if (Math.abs(sup - inf) < 1e-12 && !(minCerrado && maxCerrado)) continue;
      out.push({
        min: inf === -Infinity ? null : (desdeA ?? a).min,
        max: sup === Infinity ? null : (hastaA ?? a).max,
        minCerrado, maxCerrado,
      });
    }
  }
  return out;
}

/**
 * Simplifica un SISTEMA de condiciones `cᵢ(x) ≥ 0` a su forma mínima: resuelve cada una por su
 * tabla de signos, interseca y devuelve el resultado. `null` si alguna cae fuera de alcance —quien
 * llama debe entonces conservar las condiciones tal como estaban—. Varias componentes inconexas
 * también dan `null`: `a ≤ x ≤ b` se lee de un vistazo, una unión de tramos no, y mostrarla mal
 * sería peor que mostrar las condiciones originales.
 */
export function simplificarCondiciones(conds: readonly string[]): ResultadoCond {
  if (conds.length === 0) return { tipo: "siempre" };
  let acum: Tramo[] = [{ min: null, max: null, minCerrado: false, maxCerrado: false }];
  for (const c of conds) {
    const t = conjuntoDe(c);
    if (t === null) return null;
    acum = intersecar(acum, t);
    if (acum.length === 0) return { tipo: "imposible" };
  }
  if (acum.length === 0) return { tipo: "imposible" };
  if (acum.length > 1) return null;
  const t = acum[0];
  if (t.min === null && t.max === null) return { tipo: "siempre" };
  return {
    tipo: "rango",
    rango: {
      min: t.min === null ? null : { expr: t.min.expr, cerrado: t.minCerrado },
      max: t.max === null ? null : { expr: t.max.expr, cerrado: t.maxCerrado },
    },
  };
}
