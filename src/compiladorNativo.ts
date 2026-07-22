import { parse } from "mathjs";

import { CENTINELAS_SIGNO } from "./motor/parsing/dobleSigno";
import { FUNCIONES_ESCALON_RAPIDAS } from "./constantes";

// ─────────────────────────────────────────────
// Compilador NATIVO de expresiones (acelerador del evaluador)
// ─────────────────────────────────────────────
//
// mathjs sigue siendo el PARSER (su AST es la fuente de verdad de la sintaxis); lo que
// cambia aquí es QUIÉN EVALÚA. `mathjs.compile().evaluate(scope)` paga, en CADA muestra,
// el despacho de typed-function y la construcción del scope: medido, ~14× más lento que
// una función JS directa. Su propio autor lo confirma (~15×). Como el trazado hace de
// 2.500 a 220.000 evaluaciones por pasada, esa envoltura ERA el grueso del tiempo de
// frame — no la matemática.
//
// Aquí se recorre el AST de mathjs UNA vez y se construye un ÁRBOL DE CIERRES: cada nodo
// se convierte en una función JS que ya tiene resuelto —cerrado sobre sí— qué operación
// hace y quiénes son sus operandos. Evaluar es entonces bajar por ese árbol llamando
// funciones monomórficas de dos argumentos; no queda ni despacho por tipo, ni objeto de
// scope, ni búsqueda de nombres. Es la técnica de "closure compilation" (partial
// evaluation): todo el trabajo que depende solo de la EXPRESIÓN se hace al compilar, y en
// tiempo de muestreo solo queda el trabajo que depende del PUNTO.
//
// NADA DE `new Function` NI `eval`. La versión anterior generaba código fuente y lo
// compilaba en caliente, lo que era más rápido todavía pero (a) exigía `unsafe-eval` en la
// Content Security Policy y (b) hace el plugin no auditable estáticamente. El árbol de
// cierres conserva el grueso de la ganancia sin ejecutar código generado: no hay ninguna
// cadena que se convierta en programa, solo composición de funciones ya escritas en este
// archivo.
//
// TRES SALVAGUARDAS, porque acelerar el evaluador no vale un solo cambio de dibujo:
//
//   1. WHITELIST. Solo se compila lo que tiene semántica VERIFICADA idéntica a la de
//      mathjs (ver la tabla de equivalencias más abajo). Cualquier nodo desconocido —una
//      función rara, un símbolo libre, una matriz— aborta devolviendo `null`.
//   2. VALIDACIÓN DIFERENCIAL. Aunque la compilación tenga éxito, la función resultante se
//      COMPARA contra mathjs sobre una batería de puntos de sonda antes de darla por
//      buena. Si discrepan en un solo punto, se devuelve `null`. Esto convierte cualquier
//      error de traducción que se me haya escapado en una pérdida de rendimiento, nunca
//      en un cambio de resultado.
//   3. FALLBACK. `null` significa "usa mathjs como siempre". El camino antiguo queda
//      intacto y sigue siendo el que responde por todo lo que no se sepa acelerar.
//
// EQUIVALENCIAS VERIFICADAS (sondeadas contra mathjs, ver la tabla de `PUNTOS_SONDA`):
//   • Fuera del dominio real, mathjs devuelve un Complex que los oráculos coaccionan a
//     NaN; las `Math.*` nativas devuelven NaN directamente → mismo resultado observable.
//     Comprobado en sqrt(−1), log(−1), asin(2), acosh(0.5), atanh(2), x^(1/3) con x<0.
//   • `floor`/`ceil` usan las RÁPIDAS del motor (`FUNCIONES_ESCALON_RAPIDAS`), no las de
//     `Math`: conservan la corrección epsilon de mathjs (floor(0.1·30) = 3, no 2).
//   • `mod`/`%` siguen el signo del DIVISOR (mathjs), no el del dividendo (JS): −4 mod 3
//     es 2, no −1. Se compila la forma `a − b·floor(a/b)`.
//   • `acot`/`asec`/`acsc` usan las convenciones INYECTADAS por el motor
//     (`FUNCIONES_INVERSAS_EXTRA`), no las de mathjs: acot es π/2 − atan (rango continuo).
//   • Los centinelas de doble signo (`pm`/`mp`/…) y la guarda de dominio (`dom`) se
//     resuelven aquí, leyendo los signos de `CENTINELAS_SIGNO` para no duplicar esa tabla.

/** Firma de una expresión compilada: tantos argumentos como variables, resultado real. */
export type FuncionNativa = (...valores: number[]) => number;

/**
 * Nodo ya compilado. La ARIDAD ES FIJA (dos huecos, `a` y `b`) aunque la expresión use una
 * sola variable: una firma fija evita construir un array de argumentos por evaluación y
 * mantiene monomórficos todos los sitios de llamada del árbol, que es de donde sale el
 * rendimiento. El motor nunca compila más de dos variables (f(x) e F(x,y)).
 */
type Compilada = (a: number, b: number) => number;

/** Máximo de variables soportado — el que impone la firma fija de `Compilada`. */
const MAX_VARIABLES = 2;

// ── Traducciones directas a `Math` (semántica idéntica, verificada) ──────────────────
// Se guardan las FUNCIONES, no sus nombres: el cierre cierra sobre la referencia y la
// llamada no vuelve a buscar la propiedad en `Math`.
const FUNCIONES_MATH: Readonly<Record<string, (...v: number[]) => number>> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  exp: Math.exp, abs: Math.abs, sign: Math.sign,
  sqrt: Math.sqrt, cbrt: Math.cbrt,
  log10: Math.log10, log2: Math.log2,
  min: Math.min, max: Math.max,
};

/** Constantes simbólicas de mathjs con equivalente exacto. */
const CONSTANTES: Readonly<Record<string, number>> = {
  pi: Math.PI, e: Math.E, tau: 2 * Math.PI, Infinity: Infinity, NaN: NaN,
};

/** Centinela de doble signo → su signo (+1/−1), para resolverlos al compilar. */
const SIGNO_CENTINELA = new Map<string, number>(CENTINELAS_SIGNO.map(([n, s]) => [n, s]));

/**
 * Puntos de sonda de la validación diferencial. Cubren a propósito los casos donde una
 * traducción descuidada divergiría: negativos (dominios de raíz/log), el cero y sus
 * alrededores (polos), medios enteros (redondeos), magnitudes extremas (overflow), y
 * `0.1*30` —el valor que delata si `floor` perdió la corrección epsilon de mathjs—.
 * Se incluyen irracionales para no caer siempre en posiciones "bonitas" donde dos
 * implementaciones distintas coincidirían por casualidad.
 */
const PUNTOS_SONDA: readonly number[] = [
  0, 1, -1, 2, -2, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 3, -3,
  0.1, -0.1, 0.001, -0.001, 10, -10, 100, -100, 1e6, -1e6, 1e-6, -1e-6,
  Math.PI, -Math.PI, Math.PI / 2, -Math.PI / 2, Math.E, -Math.E,
  0.1 * 30, 1 / 3, -1 / 3, 0.7071067811865476, -1.4142135623730951,
  7.389056098930649, 0.36787944117144233, 123.456, -987.654,
];

// ── Auxiliares de los que cierran los nodos compilados ───────────────────────────────

/** Resto con el signo del DIVISOR (semántica de mathjs). */
function modNativo(a: number, b: number): number {
  return a - b * Math.floor(a / b);
}

/** Raíz n-ésima real: negativa admitida solo con índice impar (como mathjs). */
function nthRootNativo(x: number, n: number): number {
  if (x < 0) return Math.abs(n % 2) === 1 ? -Math.pow(-x, 1 / n) : NaN;
  return Math.pow(x, 1 / n);
}

const floorRapido = FUNCIONES_ESCALON_RAPIDAS.floor;
const ceilRapido = FUNCIONES_ESCALON_RAPIDAS.ceil;

/** Combina dos nodos con un operador aritmético de mathjs, o `null` si no es uno. */
function binario(fn: string, p: Compilada, q: Compilada): Compilada | null {
  switch (fn) {
    case "add": return (a, b) => p(a, b) + q(a, b);
    case "subtract": return (a, b) => p(a, b) - q(a, b);
    case "multiply": return (a, b) => p(a, b) * q(a, b);
    case "divide": return (a, b) => p(a, b) / q(a, b);
    default: return null;
  }
}

/**
 * Compila un nodo del AST a su cierre, o `null` si aparece algo fuera de la whitelist.
 * `variables` es la lista ORDENADA de nombres: su posición decide si un símbolo lee el
 * primer hueco o el segundo.
 */
function compilarNodo(nodo: unknown, variables: readonly string[]): Compilada | null {
  const n = nodo as {
    type?: string; value?: unknown; name?: string; content?: unknown;
    fn?: unknown; op?: string; args?: unknown[];
  };

  switch (n.type) {
    case "ConstantNode": {
      // Solo constantes NUMÉRICAS: un ConstantNode puede llevar una cadena o un booleano
      // (mathjs los admite) y traducirlos como número sería inventar semántica.
      const v = n.value;
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      return () => v;
    }

    case "SymbolNode": {
      const nombre = n.name ?? "";
      const i = variables.indexOf(nombre);
      if (i === 0) return (a) => a;
      if (i === 1) return (_a, b) => b;
      // Símbolo libre desconocido: mathjs lanzaría y el evaluador daría NaN. No se
      // reproduce aquí; se cede a mathjs (fallback) para no duplicar ese contrato.
      if (!(nombre in CONSTANTES)) return null;
      const k = CONSTANTES[nombre];
      return () => k;
    }

    case "ParenthesisNode":
      return compilarNodo(n.content, variables);

    case "OperatorNode": {
      const args = compilarArgs(n.args, variables);
      if (args === null || args.length === 0) return null;
      const fn = typeof n.fn === "string" ? n.fn : "";
      const [p, q] = args;

      if (fn === "unaryMinus") return args.length === 1 ? (a, b) => -p(a, b) : null;
      if (fn === "unaryPlus") return args.length === 1 ? p : null;
      // `^` de mathjs = Math.pow: base negativa con exponente no entero da Complex
      // (→NaN al coaccionar) igual que Math.pow da NaN. Verificado en x^(1/3), x^0.5.
      if (fn === "pow") return args.length === 2 ? (a, b) => Math.pow(p(a, b), q(a, b)) : null;
      // mathjs: el resto toma el signo del DIVISOR (−4 mod 3 = 2). El `%` de JS toma el
      // del dividendo (−1), así que NO se puede traducir literalmente.
      if (fn === "mod") return args.length === 2 ? (a, b) => modNativo(p(a, b), q(a, b)) : null;

      if (args.length < 2) return null;
      // Asociativo por la izquierda, igual que el árbol que produce mathjs. Con exactamente
      // dos operandos —el caso normal— esto es una sola combinación, sin plegado.
      let acc = binario(fn, p, q);
      for (let i = 2; i < args.length && acc !== null; i++) acc = binario(fn, acc, args[i]);
      return acc;
    }

    case "FunctionNode": {
      const ref = n.fn as { name?: string } | string | undefined;
      const nombre = typeof ref === "string" ? ref : ref?.name ?? "";
      const args = compilarArgs(n.args, variables);
      if (args === null) return null;
      const [p, q] = args;
      const unaria = args.length === 1;

      // Centinelas del doble signo: pm(u)=+u, mp(u)=−u (ver dobleSigno.ts). Se resuelven
      // leyendo la tabla real, así añadir un eje nuevo no exige tocar este archivo.
      const signo = SIGNO_CENTINELA.get(nombre);
      if (signo !== undefined) {
        if (!unaria) return null;
        return signo > 0 ? p : (a, b) => -p(a, b);
      }
      // Guarda de dominio del despeje: dom(cuerpo, R) vale cuerpo donde R≥0 y NaN si no.
      // Con `cond` NaN, `NaN >= 0` es false → NaN, igual que la versión inyectada.
      if (nombre === "dom") {
        return args.length === 2 ? (a, b) => (q(a, b) >= 0 ? p(a, b) : NaN) : null;
      }
      // Recíprocas: mathjs las trae nativas y son exactamente estas (sec(0)=1,
      // csc(0)=Infinity, cot(0)=Infinity — verificado).
      if (nombre === "sec") return unaria ? (a, b) => 1 / Math.cos(p(a, b)) : null;
      if (nombre === "csc") return unaria ? (a, b) => 1 / Math.sin(p(a, b)) : null;
      if (nombre === "cot") return unaria ? (a, b) => 1 / Math.tan(p(a, b)) : null;
      // Inversas INYECTADAS por el motor (FUNCIONES_INVERSAS_EXTRA): estas convenciones
      // mandan sobre las de mathjs, porque son las que el scope de evaluación aplica.
      if (nombre === "acot") return unaria ? (a, b) => Math.PI / 2 - Math.atan(p(a, b)) : null;
      if (nombre === "acsc") return unaria ? (a, b) => Math.asin(1 / p(a, b)) : null;
      if (nombre === "asec") return unaria ? (a, b) => Math.acos(1 / p(a, b)) : null;
      // Escalón: las RÁPIDAS del motor, con la corrección epsilon de mathjs.
      if (nombre === "floor") return unaria ? (a, b) => floorRapido(p(a, b)) : null;
      if (nombre === "ceil") return unaria ? (a, b) => ceilRapido(p(a, b)) : null;
      // log(x) natural; log(x, base) = ln x / ln base (verificado: log(8,2)=3).
      if (nombre === "log") {
        if (unaria) return (a, b) => Math.log(p(a, b));
        if (args.length === 2) return (a, b) => Math.log(p(a, b)) / Math.log(q(a, b));
        return null;
      }
      // nthRoot(x,n): real y NEGATIVA para índice impar (nthRoot(−8,3) = −2), NaN para
      // índice par con radicando negativo. Math.pow(−8,1/3) daría NaN, así que hace falta
      // la forma explícita.
      if (nombre === "nthRoot") {
        if (unaria) return (a, b) => Math.cbrt(p(a, b));
        if (args.length === 2) return (a, b) => nthRootNativo(p(a, b), q(a, b));
        return null;
      }

      const f = FUNCIONES_MATH[nombre];
      if (!f || args.length === 0) return null;
      if (unaria) return (a, b) => f(p(a, b));
      if (args.length === 2) return (a, b) => f(p(a, b), q(a, b));
      // n-aria (solo min/max): aquí sí hay que materializar los argumentos, pero es un
      // caso marginal que no aparece en el bucle de muestreo típico.
      return (a, b) => f(...args.map((g) => g(a, b)));
    }

    default:
      return null;
  }
}

/** Compila la lista de argumentos de un nodo, o `null` si alguno queda fuera de la whitelist. */
function compilarArgs(args: unknown[] | undefined, variables: readonly string[]): Compilada[] | null {
  const salida: Compilada[] = [];
  for (const arg of args ?? []) {
    const c = compilarNodo(arg, variables);
    if (c === null) return null;
    salida.push(c);
  }
  return salida;
}

/**
 * ¿Dos resultados son observablemente el MISMO valor para el motor? Se comparan bajo la
 * coacción que los oráculos ya aplican (no-número → NaN), así que un Complex de mathjs y
 * un NaN nativo cuentan como iguales: es exactamente lo que el trazador verá.
 */
function equivalentes(a: unknown, b: number): boolean {
  const va = typeof a === "number" ? a : NaN;
  const naA = Number.isNaN(va), naB = Number.isNaN(b);
  if (naA || naB) return naA && naB;
  if (!Number.isFinite(va) || !Number.isFinite(b)) return va === b; // ±Infinity con signo
  // Tolerancia RELATIVA: ambas rutas hacen la misma aritmética IEEE, pero el orden de las
  // operaciones puede diferir en el último bit (mathjs mete llamadas intermedias).
  return Math.abs(va - b) <= 1e-12 * Math.max(1, Math.abs(va), Math.abs(b));
}

/**
 * Compila `expr` (YA normalizada) a una función JS nativa de las `variables` dadas, o
 * devuelve `null` si no se puede garantizar que sea equivalente a mathjs — en cuyo caso
 * el llamador debe usar el camino de mathjs de siempre.
 *
 * `referencia` es la evaluación por mathjs con la que se valida el resultado. Se pide al
 * llamador (que ya la tiene compilada) en vez de crearla aquí: así la validación mide
 * exactamente contra el camino que se va a sustituir, incluido su scope inyectado.
 */
export function compilarNativo(
  expr: string,
  variables: readonly string[],
  referencia: (valores: readonly number[]) => unknown
): FuncionNativa | null {
  if (variables.length > MAX_VARIABLES) return null;

  let candidata: FuncionNativa;
  try {
    const raiz = compilarNodo(parse(expr), variables);
    if (raiz === null) return null;
    // Se adapta la firma fija de dos huecos a la aridad real. El hueco sobrante vale 0 y
    // ningún nodo lo lee: `compilarNodo` solo emite lecturas de `b` si hay dos variables.
    candidata = variables.length === 2
      ? (x, y) => raiz(x, y)
      : (x) => raiz(x, 0);
  } catch {
    return null; // expresión no parseable → mathjs
  }

  // ── Validación diferencial ─────────────────────────────────────────────────────────
  // Se barre el producto de los puntos de sonda sobre todas las variables. Con una
  // variable son ~40 evaluaciones; con dos, la diagonal y algunos cruces (el producto
  // completo sería 40² = 1600, innecesario para detectar una traducción mal hecha).
  const combinaciones = puntosDeSonda(variables.length);
  for (const punto of combinaciones) {
    let esperado: unknown;
    try {
      esperado = referencia(punto);
    } catch {
      esperado = NaN; // el camino de mathjs coacciona sus errores a NaN
    }
    let obtenido: number;
    try {
      obtenido = candidata(...punto);
    } catch {
      return null;
    }
    if (!equivalentes(esperado, obtenido)) return null;
  }
  return candidata;
}

/**
 * Puntos de sonda para `n` variables. Con n=1, todos. Con n≥2 se usa la DIAGONAL más
 * varios desplazamientos entre ejes: basta para delatar una traducción errónea (que lo
 * es en todo el dominio, no en un punto aislado) sin pagar un producto cartesiano.
 */
function puntosDeSonda(n: number): number[][] {
  if (n <= 0) return [[]];
  if (n === 1) return PUNTOS_SONDA.map((v) => [v]);
  const puntos: number[][] = [];
  for (const v of PUNTOS_SONDA) puntos.push(new Array<number>(n).fill(v));
  for (let d = 1; d < PUNTOS_SONDA.length; d++) {
    const fila: number[] = [];
    for (let k = 0; k < n; k++) fila.push(PUNTOS_SONDA[(d * (k + 1)) % PUNTOS_SONDA.length]);
    puntos.push(fila);
  }
  return puntos;
}
