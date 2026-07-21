import { derivative, parse, simplify, type MathNode, type SimplifyRule } from "mathjs";

import { normalizarEntrada } from "./parser";
import { insertarProductoImplicito } from "./motor/parsing/productoImplicito";
import { compilarFuncion } from "./evaluador";
import { racionalizarFracciones, resimbolizarConstantes, type Nodo } from "./formatoExpr";

// ─────────────────────────────────────────────
// Integrar (antiderivada simbólica para el bloque obs-integral)
// ─────────────────────────────────────────────
//
// mathjs SABE derivar simbólicamente pero NO integrar; aquí vive un integrador PROPIO,
// espejo conceptual de derivar.ts. No pretende ser un motor completo (la integración
// simbólica general es indecidible): cubre el repertorio de un libro de cálculo —linealidad,
// regla de la potencia, exponenciales, logaritmo `1/x`, trigonométricas básicas y el arco
// tangente `1/(kx²+m)`— MÁS la sustitución LINEAL `∫f(ax+b)dx = (1/a)F(ax+b)` (detectada por
// derivada constante del argumento), que multiplica el alcance (sin(2x), e^{3x}, (2x+1)^5…).
//
// Filosofía CLAVE: una primitiva INCORRECTA es peor que ninguna (el panel cae al valor
// numérico). Por eso toda candidata pasa una GUARDA numérica —se deriva por diferencias
// finitas y debe reproducir el integrando en una muestra—; si no, se descarta y devuelve
// null. La guarda usa derivación NUMÉRICA (no la simbólica de mathjs) para no depender de que
// mathjs sepa derivar `abs`, `atan`, etc. La constante de integración es irrelevante en una
// integral definida (se cancela en la resta de Barrow), así que la primitiva se da sin `+C`.
//
// Como derivar.ts, produce un STRING mathjs re-parseable; el panel lo pasa por `exprALatex`
// (misma tipografía que obs-graph). La entrada se normaliza e inserta el producto implícito.

const VAR = "x";

// Muestra para la guarda numérica: valores "anodinos" (no enteros, ambos signos, cerca y
// lejos del 0) para no caer en raíces, simetrías ni singularidades típicas (ídem derivar.ts).
const MUESTRAS = [-7.3, -2.6, -1.2, -0.7, -0.3, 0.4, 1.1, 2.7, 5.8, 11.4];

/**
 * Canonicalización TRIGONOMÉTRICA: reescribe el integrando en el alfabeto mínimo `sin`/`cos` y
 * abre el ángulo doble. Es la reescritura que convierte expresiones "de identidad" en algo que
 * las reglas estructurales de abajo sí reconocen: `1/(csc 2x − cot 2x)` → `sin 2x/(1−cos 2x)` →
 * `cos x/sin x`, que ya es una derivada logarítmica. Se usa SOLO como reintento (ver
 * `integrarExpr`): la forma original va primero, para que `∫sin(2x)` siga saliendo `−cos(2x)/2`
 * y no la versión desarrollada. Las reglas propias van ANTES de las de mathjs para que actúen
 * sobre el árbol antes de que la simplificación genérica lo reordene.
 */
const REGLAS_TRIG: SimplifyRule[] = [
  { l: "csc(n1)", r: "1/sin(n1)" },
  { l: "sec(n1)", r: "1/cos(n1)" },
  { l: "cot(n1)", r: "cos(n1)/sin(n1)" },
  { l: "tan(n1)", r: "sin(n1)/cos(n1)" },
  { l: "sin(2*n1)", r: "2*sin(n1)*cos(n1)" },
  { l: "cos(2*n1)", r: "1-2*sin(n1)^2" },
  ...simplify.rules,
];

/** ¿La expresión contiene la variable de integración `x`? (un factor sin x es constante). */
function dependeDeX(n: Nodo): boolean {
  return n.filter((nodo: Nodo) => nodo.isSymbolNode === true && nodo.name === VAR).length > 0;
}

/** Valor numérico de un nodo CONSTANTE (sin x), o null si no evalúa a un número finito. */
function valorConstante(n: Nodo): number | null {
  try {
    const v = n.evaluate();
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Coeficiente `a` de `u = a·x + b` si `u` es AFÍN en x (derivada constante NO nula), o null.
 * Es el gozne de la sustitución lineal: si du/dx es una constante a≠0, entonces u es una recta
 * y `∫f(u)dx = (1/a)F(u)`. Para `u = x` da a=1; para `2x+1` da 2; para `x²` (derivada 2x, no
 * constante) da null → esa función no admite la sustitución simple.
 */
function coefLineal(u: Nodo): number | null {
  try {
    const a = valorConstante(simplify(derivative(u as unknown as MathNode, VAR)) as unknown as Nodo);
    return a !== null && a !== 0 ? a : null;
  } catch {
    return null;
  }
}

/** Factores de un PRODUCTO de nivel superior (solo `*`): `a*b*c` → [a,b,c]. */
function factoresProducto(n: Nodo): Nodo[] {
  if (n.type === "ParenthesisNode") return factoresProducto(n.content);
  if (n.type === "OperatorNode" && n.op === "*" && n.args.length === 2)
    return [...factoresProducto(n.args[0]), ...factoresProducto(n.args[1])];
  return [n];
}

/**
 * `∫ u^n dx` con `n` constante y `u = base` AFÍN en x. Regla de la potencia con sustitución
 * lineal: `n≠−1 → u^(n+1)/((n+1)·a)`; `n=−1 → ln|u|/a`. Devuelve string o null (base no afín).
 */
function integrarPotencia(base: Nodo, n: number): string | null {
  const a = coefLineal(base);
  if (a === null) return null;
  const u = base.toString();
  if (Math.abs(n + 1) < 1e-12) return `log(abs(${u}))/(${a})`; // ∫u⁻¹ = ln|u|/a
  const np1 = n + 1;
  return `((${u})^(${np1}))/(${np1 * a})`;
}

/**
 * `∫ 1/q dx` con `q` dependiente de x. Casos: `q = base^k` (k const, base afín) → potencia de
 * exponente −k; `q` afín → `ln|q|/a`; `q = k·x²+m` (k,m>0, sin término lineal) → arco tangente
 * `atan(x·√(k/m))/√(k·m)`. null si no encaja ninguno.
 */
function integrarReciproco(q: Nodo): string | null {
  if (q.type === "OperatorNode" && q.op === "^" && q.args.length === 2 && !dependeDeX(q.args[1])) {
    const k = valorConstante(q.args[1]);
    if (k === null) return null;
    return integrarPotencia(q.args[0], -k);
  }
  const a = coefLineal(q);
  if (a !== null) return `log(abs(${q.toString()}))/(${a})`;
  return integrarArcotangente(q);
}

/** `∫ 1/(k·x²+m) dx = atan(x·√(k/m))/√(k·m)` con k,m>0 y SIN término lineal; si no, null. */
function integrarArcotangente(q: Nodo): string | null {
  let d1: Nodo;
  try {
    d1 = simplify(derivative(q as unknown as MathNode, VAR)) as unknown as Nodo; // dq/dx debe ser 2k·x (lineal pura)
  } catch {
    return null;
  }
  const dosK = coefLineal(d1); // derivada de 2k·x = 2k (constante) ⇒ q es cuadrática pura
  if (dosK === null) return null;
  const k = dosK / 2;
  try {
    const fd = compilarFuncion(d1.toString(), VAR);
    const en0 = fd(0);
    if (typeof en0 !== "number" || Math.abs(en0) > 1e-9) return null; // hay término lineal
    const m = compilarFuncion(q.toString(), VAR)(0);
    if (typeof m !== "number" || !Number.isFinite(m) || k <= 0 || m <= 0) return null;
    return `atan(x*sqrt((${k})/(${m})))/sqrt((${k})*(${m}))`;
  } catch {
    return null;
  }
}

/**
 * Constante numérica en su forma "de libro": racional de denominador pequeño si lo admite con
 * holgura de máquina (`0.5` → `(1)/(2)`), y si no el decimal tal cual. Evita que una razón
 * calculada por diferencias finitas se imprima como `0.4999999999`.
 */
function constanteLegible(c: number): string {
  for (let den = 1; den <= 24; den++) {
    const num = Math.round(c * den);
    if (Math.abs(c * den - num) < 1e-9) return den === 1 ? `${num}` : `(${num})/(${den})`;
  }
  return `${c}`;
}

/**
 * DERIVADA LOGARÍTMICA: `∫ (c·q'/q) dx = c·ln|q|`. Es el caso que faltaba del cociente con x en
 * numerador Y denominador —hasta ahora null— y de él cuelga una familia entera: `∫tan = ∫sin/cos`,
 * `∫cot = ∫cos/sin`, `∫2x/(x²+1)`, `∫f'/f` en general.
 *
 * La razón `p/q'` se mide NUMÉRICAMENTE (diferencias finitas centradas, como la guarda) en vez de
 * derivar q con mathjs: así no depende de que mathjs sepa derivar `csc`, `abs` y compañía, y basta
 * con que la razón sea la MISMA constante en toda la muestra. Se saltan los puntos donde algo no
 * es finito o `q'` casi se anula (la razón ahí es ruido). Como toda candidata, pasa después por la
 * guarda numérica global, que es quien garantiza la corrección.
 */
function integrarDerivadaLogaritmica(p: Nodo, q: Nodo): string | null {
  let fp: (v: number) => unknown, fq: (v: number) => unknown;
  try {
    fp = compilarFuncion(p.toString(), VAR);
    fq = compilarFuncion(q.toString(), VAR);
  } catch {
    return null;
  }
  const h = 1e-6;
  let c: number | null = null;
  let comparables = 0;
  for (const x of MUESTRAS) {
    const vp = fp(x), q1 = fq(x + h), q0 = fq(x - h);
    if (typeof vp !== "number" || !Number.isFinite(vp)) continue;
    if (typeof q1 !== "number" || typeof q0 !== "number" || !Number.isFinite(q1) || !Number.isFinite(q0)) continue;
    const dq = (q1 - q0) / (2 * h);
    if (Math.abs(dq) < 1e-6) continue; // q' ≈ 0: la razón no es informativa
    const razon = vp / dq;
    if (c === null) c = razon;
    else if (Math.abs(razon - c) > 1e-6 * (1 + Math.abs(c))) return null; // no es constante ⇒ no es f'/f
    comparables++;
  }
  if (c === null || comparables < 3) return null;
  return `(${constanteLegible(c)})*log(abs(${q.toString()}))`;
}

/** `∫ b^u dx` con base `b` constante y exponente `u` AFÍN: `b^u/(a·ln b)` (b=e ⇒ ln b=1). */
function integrarExponencial(base: Nodo, exp: Nodo): string | null {
  const a = coefLineal(exp);
  if (a === null) return null;
  const b = base.toString();
  return `((${b})^(${exp.toString()}))/((${a})*log(${b}))`;
}

/** Tabla de antiderivadas de `f(u)` con `u` AFÍN (`a = du/dx`): trig, exp, √. null si no está. */
function integrarFuncion(nombre: string, arg: Nodo): string | null {
  const a = coefLineal(arg);
  if (a === null) return null; // argumento no afín: sin sustitución simple
  const u = arg.toString();
  switch (nombre) {
    case "sin": return `-cos(${u})/(${a})`;
    case "cos": return `sin(${u})/(${a})`;
    case "exp": return `exp(${u})/(${a})`;
    case "tan": return `-log(abs(cos(${u})))/(${a})`; // ∫tan = −ln|cos|
    case "cot": return `log(abs(sin(${u})))/(${a})`; // ∫cot = ln|sin|
    case "sec": return `log(abs(sec(${u})+tan(${u})))/(${a})`;
    case "csc": return `-log(abs(csc(${u})+cot(${u})))/(${a})`;
    case "sinh": return `cosh(${u})/(${a})`;
    case "cosh": return `sinh(${u})/(${a})`;
    case "sqrt": return `(2*(${u})^(3/2))/(3*(${a}))`; // ∫√u = (2/3)u^{3/2}/a
    default: return null;
  }
}

/**
 * Integra un nodo respecto de x devolviendo un STRING mathjs de la antiderivada, o null si no
 * sabe. Estructura: constante → c·x; suma/resta → linealidad; producto con UN solo factor
 * dependiente de x → saca las constantes; división → 1/constante o constante/q; potencia →
 * regla de la potencia o exponencial; función de un argumento → tabla; `x` suelto → x²/2.
 */
function integrar(n: Nodo): string | null {
  if (n.type === "ParenthesisNode") return integrar(n.content);

  // Constante (sin x): ∫c dx = c·x.
  if (!dependeDeX(n)) return `(${n.toString()})*x`;

  if (n.type === "OperatorNode") {
    const { op, args } = n;

    // Linealidad: ∫(f±g) = ∫f ± ∫g.
    if ((op === "+" || op === "-") && args.length === 2) {
      const A = integrar(args[0]);
      const B = integrar(args[1]);
      return A !== null && B !== null ? `(${A})${op}(${B})` : null;
    }
    if (op === "-" && args.length === 1) {
      const A = integrar(args[0]);
      return A !== null ? `-(${A})` : null;
    }

    // Producto: se sacan los factores constantes; solo integrable si queda UN factor con x
    // (no hay regla del producto general para integrar; dos factores con x → null).
    if (op === "*") {
      const factores = factoresProducto(n);
      const xdep = factores.filter(dependeDeX);
      if (xdep.length !== 1) return null;
      const I = integrar(xdep[0]);
      if (I === null) return null;
      const consts = factores.filter((f) => !dependeDeX(f));
      if (consts.length === 0) return I;
      return `(${consts.map((f) => `(${f.toString()})`).join("*")})*(${I})`;
    }

    // División.
    if (op === "/" && args.length === 2) {
      const [p, q] = args;
      if (!dependeDeX(q)) {
        const I = integrar(p); // ∫(p/const) = (1/const)·∫p
        return I !== null ? `(${I})/(${q.toString()})` : null;
      }
      if (!dependeDeX(p)) {
        const I = integrarReciproco(q); // ∫(const/q) = const·∫(1/q)
        return I !== null ? `(${p.toString()})*(${I})` : null;
      }
      return integrarDerivadaLogaritmica(p, q); // p y q con x: solo si p = c·q' (⇒ c·ln|q|)
    }

    // Potencia.
    if (op === "^" && args.length === 2) {
      const [base, exp] = args;
      if (dependeDeX(exp)) {
        return dependeDeX(base) ? null : integrarExponencial(base, exp); // b^u (b const)
      }
      const n2 = valorConstante(exp);
      return n2 !== null ? integrarPotencia(base, n2) : null;
    }
  }

  if (n.type === "FunctionNode" && n.args.length === 1) return integrarFuncion(n.fn.name, n.args[0]);

  if (n.type === "SymbolNode" && n.name === VAR) return "x^2/2"; // ∫x dx

  return null;
}

/**
 * ¿La derivada de `primitiva` reproduce `integrando` en la muestra? Deriva por DIFERENCIAS
 * FINITAS centradas (no depende de la derivación simbólica de mathjs) y compara. Ignora los
 * puntos donde el integrando o la primitiva no son finitos (dominio parcial) y exige un mínimo
 * de coincidencias para no aceptar por vacuidad. La constante de integración no afecta (se
 * deriva). Es el filtro que garantiza corrección pese a la cobertura parcial del integrador.
 */
function verificaNumerica(integrando: string, primitiva: string): boolean {
  let f: (v: number) => unknown, F: (v: number) => unknown;
  try {
    f = compilarFuncion(integrando, VAR);
    F = compilarFuncion(primitiva, VAR);
  } catch {
    return false;
  }
  const h = 1e-6;
  let comparables = 0;
  for (const x of MUESTRAS) {
    const vf = f(x);
    if (typeof vf !== "number" || !Number.isFinite(vf)) continue;
    const F1 = F(x + h), F0 = F(x - h);
    if (typeof F1 !== "number" || typeof F0 !== "number" || !Number.isFinite(F1) || !Number.isFinite(F0)) continue;
    const aprox = (F1 - F0) / (2 * h); // derivada numérica central
    if (Math.abs(aprox - vf) > 1e-4 * (1 + Math.abs(vf))) return false;
    comparables++;
  }
  return comparables >= 3;
}

/**
 * Antiderivada simbólica de una expresión respecto de x, como STRING mathjs re-parseable, o
 * null si el integrador no la cubre o la GUARDA numérica la rechaza. Sin `+C` (irrelevante en
 * la integral definida). La entrada se normaliza (LaTeX/Unicode → mathjs) e inserta el producto
 * implícito, igual que el resto del pipeline.
 */
export function integrarExpr(expr: string): string | null {
  const norm = insertarProductoImplicito(normalizarEntrada(expr.trim()));
  if (norm === "") return null;
  let raiz: Nodo;
  try {
    raiz = parse(norm) as unknown as Nodo;
  } catch {
    return null;
  }
  // Forma ORIGINAL primero (conserva la tipografía natural: `∫sin(2x) = −cos(2x)/2`); si no la
  // cubre, se reintenta sobre la canonicalización trigonométrica, que resuelve las expresiones
  // escritas "por identidad" (`1/(csc 2x − cot 2x)` es `cot x`). La guarda de abajo compara
  // siempre contra el integrando ORIGINAL, así que el reintento no puede colar una primitiva mala.
  let cruda = integrar(raiz);
  if (cruda === null) {
    try {
      cruda = integrar(simplify(norm, REGLAS_TRIG) as unknown as Nodo);
    } catch {
      return null;
    }
  }
  if (cruda === null) return null;

  // Limpieza (fracciones colapsadas, constantes reducidas: log(e)→1, etc.) y RE-SIMBOLIZACIÓN
  // de las constantes que simplify decimaliza (`∫2^x = 2^x/\ln 2`, no `1.4427·2^x`), último
  // paso para que simplify no las vuelva a decimalizar. Tolerante: conserva la cruda si falla.
  let limpio = cruda;
  try {
    limpio = resimbolizarConstantes(racionalizarFracciones(simplify(cruda) as unknown as Nodo)).toString();
  } catch {
    try {
      limpio = simplify(cruda).toString();
    } catch {
      /* se conserva la cruda */
    }
  }

  return verificaNumerica(norm, limpio) ? limpio : null;
}
