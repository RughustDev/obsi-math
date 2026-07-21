import { parse, simplify } from "mathjs";

import { trigDeY, inversionTrig, familiaPeriodica, despejeTrigCuadratico, type TrigInvertible } from "./despejeInverso";
import { normalizarEntrada, contieneYLibre } from "./parser";
import { insertarProductoImplicito } from "./motor/parsing/productoImplicito";
import { ramaDoble, expandirDobleSigno } from "./motor/parsing/dobleSigno";
import { componenteParametrica } from "./motor/parsing/componentesParametricas";
import { bloqueALatex } from "./latex";
import { compilarFuncion } from "./evaluador";
import { simplificarCondiciones } from "./condiciones";
import { simplificarExpr } from "./simplificar";
import {
  contieneVariable, terminos, factores, flip, renderTerminos, renderCanonico,
  racionalizarFracciones, formatearCanonico, combinarFracciones, valorConstanteFactor,
  profundidadFraccion, esNoNegativo, esSiempreNegativo, sinFactoresConstantes,
  type Termino, type Factor, type Nodo,
} from "./formatoExpr";

// ─────────────────────────────────────────────
// Despeje de la variable y
// ─────────────────────────────────────────────
//
// Aísla y en una ecuación, RESPETANDO la formalidad. Estrategia aditiva: se lleva todo
// a D = (lhs) − (rhs), se aplanan los términos con su signo (`terminos`) y los que NO
// contienen y pasan al otro lado con el signo cambiado. El lado derecho se serializa
// con los POSITIVOS primero (`renderTerminos`) → `2 - tan(x)`, nunca `-tan(x) + 2`.
//
// El núcleo (`despejar`) produce la ecuación como STRING mathjs re-parseable, para poder
// ENCADENAR transformaciones (p.ej. despejar y luego simplificar) y detectar si una
// transformación cambia algo. El LaTeX se deriva pasando ese string por el pipeline del
// panel (`bloqueALatex`), así el despeje comparte tipografía con el resto.
//
// Alcance ("despeja lo más que pueda; si no, detente"):
//   • lado-y = `y` (coef +1)  → y = …            (completo)
//   • lado-y = c·y (c libre de y) → y = (…)/c      (completo; −1 se absorbe negando)
//   • lado-y = (libres de y)·yⁿ (n entero) → se dividen los libres y se saca la raíz
//     n-ésima. IMPAR: `x³+y³=9` → `y = ∛(9−x³)` (raíz real única). PAR: `x²+y²=16` →
//     `y = ±√(16−x²)` (las DOS ramas, con el centinela `pm(·)` que el LaTeX pinta `\pm`);
//     ambos completos.
//   • lado-y = (libres de y)·ⁿ√y (raíz de base exacta y) → se ELEVA a la n para
//     invertirla: `x−√y=27` → `y = (x−27)²` (completo). Inverso de la raíz principal.
//   • lado-y = (factores con y)·(factores libres de y) → se dividen los factores libres
//     al otro lado: `tan(y)·(x²+1) = √(x+1)` → `tan(y) = √(x+1)/(x²+1)` (incompleto).
//   • y en un DENOMINADOR → se multiplica por él y se re-despeja lo polinómico:
//     `(y−1)/(y+2) = x` → `y = (2x+1)/(1−x)` (completo).
//   • ecuación AFÍN en y con coeficiente cualquiera → A y B por evaluación:
//     `y − (y+2)eˣ − 1 = 0` → `y = (2eˣ+1)/(1−eˣ)` (completo).
//   • RAÍCES cuadradas repartidas → se aísla una y se eleva al cuadrado, tantas veces como
//     haga falta, arrastrando la guarda de dominio de cada paso: `√(y+1)+√(y−2) = x` →
//     `y = (x⁴+2x²+9)/(4x²)` con su condición (completo, validado numéricamente).
//   • lado-y NO lineal irreducible (y^y, sin y + y²…) → `lado-y = …` sin más (incompleto).

const contieneY = (n: Nodo): boolean => contieneVariable(n, "y");

/** ¿El factor es exactamente `y` (posiblemente con menos unarios/paréntesis alrededor)?
 *  Devuelve el signo acumulado (+1 / −1) o null si no es la y desnuda. Así `-y` cuenta como
 *  y-lineal con signo −1 (el `-y/2` que mathjs parsea como `(-y)/2`). */
function factorEsY(n: Nodo): 1 | -1 | null {
  if (n.type === "ParenthesisNode") return factorEsY(n.content);
  if (n.type === "SymbolNode" && n.name === "y") return 1;
  if (n.type === "OperatorNode" && n.op === "-" && n.args.length === 1) {
    const s = factorEsY(n.args[0]);
    return s === null ? null : (-s as 1 | -1);
  }
  return null;
}

/** Si el término es LINEAL en y —exactamente un factor `y` (el símbolo desnudo, exp +1,
 *  quizá con un menos) y el resto libre de y— devuelve el signo efectivo y los factores
 *  libres (el "coeficiente" como producto/cociente); si no (y², √y, tan(y), y en varios
 *  factores…), null. Usa `factores`, así reconoce `c·y`, `y/c` (÷ = factor exp −1) y `-y`. */
function linealEnY(t: Termino): { signo: 1 | -1; libres: Factor[] } | null {
  const fs = factores(t.nodo);
  const conYf = fs.filter((f) => contieneY(f.nodo));
  if (conYf.length !== 1 || conYf[0].exp !== 1) return null;
  const s = factorEsY(conYf[0].nodo);
  if (s === null) return null;
  return { signo: (t.signo * s) as 1 | -1, libres: fs.filter((f) => !contieneY(f.nodo)) };
}

/** Limpia el lado derecho de un despeje lineal con coeficiente ≠ 1: reduce fracciones
 *  (`2x/4`→`x/2`), invierte la división por una fracción (`y/2=x`→`y=2x`, no `y=x·2`),
 *  ordena canónicamente y recupera las fracciones exactas (mismo pipeline que Simplificar,
 *  que sobre un cociente lineal solo distribuye/reduce, no expande de más). */
function limpiarRHS(rhs: string): string {
  const n = simplificarExpr(rhs);
  return n ? formatearCanonico(racionalizarFracciones(n)) : rhs;
}

/** Serializa una lista de factores como producto mathjs (numerador/denominador). */
function renderProducto(fs: Factor[]): string {
  const env = (f: Factor) => `(${f.nodo.toString()})`;
  const num = fs.filter((f) => f.exp === 1).map(env);
  const den = fs.filter((f) => f.exp === -1).map(env);
  const n = num.length ? num.join("*") : "1";
  return den.length ? `(${n})/(${den.join("*")})` : n;
}

/** Lado derecho tras pasar los factores LIBRES de y de `t` al otro lado: divide los
 *  del denominador (exp +1) y multiplica los del numerador (−1) sobre `derecha` (con el
 *  signo del término absorbido). `render` elige el orden del numerador: `renderTerminos`
 *  (positivos primero) dentro de una raíz; `renderCanonico` (variables primero) a nivel
 *  superior. String mathjs re-parseable (mathjs normaliza paréntesis). */
function ladoDerecho(
  t: Termino, derecha: Termino[], libres: Factor[],
  render: (ts: Termino[]) => string = renderTerminos
): string {
  const numTs = t.signo === 1 ? derecha : flip(derecha);
  const numStr = render(numTs);
  let rhs = numTs.length > 1 ? `(${numStr})` : numStr; // paréntesis si hay suma
  const suben = libres.filter((f) => f.exp === -1).map((f) => `(${f.nodo.toString()})`);
  const bajan = libres.filter((f) => f.exp === 1).map((f) => `(${f.nodo.toString()})`);
  if (suben.length) rhs = [rhs, ...suben].join("*");
  if (bajan.length) rhs = `(${rhs})/(${bajan.join("*")})`;
  return rhs;
}

/** Quita los ParenthesisNode envolventes (la entrada LaTeX `y^{3}` normaliza a
 *  `y^(3)`, cuyo exponente es un ParenthesisNode, no un ConstantNode directo). */
function desParen(n: Nodo): Nodo {
  return n.type === "ParenthesisNode" ? desParen(n.content) : n;
}

/** Exponente entero n≥2 si el nodo es `y^n` (base exactamente y), o null. */
function exponenteY(n: Nodo): number | null {
  const nodo = desParen(n);
  if (nodo.type === "OperatorNode" && nodo.op === "^" && nodo.args.length === 2) {
    const base = desParen(nodo.args[0]);
    const exp = desParen(nodo.args[1]);
    if (base.type === "SymbolNode" && base.name === "y" &&
        exp.type === "ConstantNode" && Number.isInteger(exp.value) && exp.value >= 2)
      return exp.value;
  }
  return null;
}

/** Único término-y de la forma (libres)·yⁿ (n entero ≥2): divide los libres y saca la
 *  raíz n-ésima. IMPAR → `y = ∛(rhs)` (raíz real única). PAR → `y = ±ⁿ√(rhs)`: las DOS
 *  ramas, con el centinela `pm(·)` para el ± (ver abajo). Ambos completos. null si la
 *  parte con y no es un `y^n` puro. */
function despejePotencia(t: Termino, derecha: Termino[]): { ecuacion: string; completo: boolean } | null {
  const fs = factores(t.nodo);
  const conYf = fs.filter((f) => contieneY(f.nodo));
  const libres = fs.filter((f) => !contieneY(f.nodo));
  if (conYf.length !== 1 || conYf[0].exp !== 1) return null;
  const n = exponenteY(conYf[0].nodo);
  if (n === null) return null;

  // El radicando va con POSITIVOS primero (renderTerminos, el render por defecto de
  // `ladoDerecho`) → `16 - x²`, no `-x² + 16`. Igual para impar y par.
  const rad = ladoDerecho(t, derecha, libres);
  // IMPAR → raíz real única: `y = ∛(9−x³)`.
  if (n % 2 === 1)
    return { ecuacion: `y = nthRoot(${rad}, ${n})`, completo: true };
  // PAR → y = ±ⁿ√(rhs): la potencia par tiene DOS raíces reales. El ± se representa con el
  // centinela unario `pm(·)`, una función que el pipeline reconoce (registrada en
  // productoImplicito) y que `toTex` pinta como `\pm` (ver latex.ts). Así el string sigue
  // siendo re-parseable y encadenable, igual que `nthRoot`. n=2 usa `sqrt` (→ `\sqrt`, sin
  // índice); n≥4 usa `nthRoot(…, n)` (→ `\sqrt[n]`).
  const raiz = n === 2 ? `sqrt(${rad})` : `nthRoot(${rad}, ${n})`;
  const doble = ramaDoble(raiz, rad);   // presupuesto de ramas: ver dobleSigno.ramaDoble
  return doble === null ? null : { ecuacion: `y = ${doble}`, completo: true };
}

/** Índice n de la raíz si el nodo es una RAÍZ de base exacta `y`: `sqrt(y)`→2,
 *  `cbrt(y)`→3, `nthRoot(y, n)`→n (n entero ≥2). null si no lo es. Ve a través de los
 *  ParenthesisNode (misma normalización que `exponenteY`). */
function raizY(n: Nodo): number | null {
  const nodo = desParen(n);
  if (nodo.type !== "FunctionNode") return null;
  const nombre = nodo.fn?.name;
  const arg0 = nodo.args[0] && desParen(nodo.args[0]);
  if (!arg0 || arg0.type !== "SymbolNode" || arg0.name !== "y") return null;
  if (nombre === "sqrt" && nodo.args.length === 1) return 2;
  if (nombre === "cbrt" && nodo.args.length === 1) return 3;
  if (nombre === "nthRoot" && nodo.args.length === 2) {
    const k = desParen(nodo.args[1]);
    if (k.type === "ConstantNode" && Number.isInteger(k.value) && k.value >= 2) return k.value;
  }
  return null;
}

/** Envuelve el cuerpo de un despeje con la GUARDA DE DOMINIO `cond ≥ 0` (centinela `dom`): la
 *  inversión de una raíz PAR o de un valor absoluto solo vale donde el otro lado es no negativo.
 *  ÚNICO punto del motor que decide qué pasa con una condición de dominio; toda la matemática
 *  de la decisión vive en el análisis de signo (`signoDe`, formatoExpr), no aquí:
 *   • condición demostrablemente ≥0 (`x²+1`, `|x|+3`, `2|x|`, `√x+|x|`, `pi`) → el cuerpo TAL
 *     CUAL: la guarda sería siempre cierta y la coletilla, ruido;
 *   • condición demostrablemente <0 (`-x²-1`, `pi-4`) → null: la ecuación NO tiene solución
 *     real y no se fuerza un despeje inventado; queda la forma parcial;
 *   • en otro caso `dom(cuerpo, cond)`, con la condición ya REDUCIDA de factores constantes
 *     (`x/2` → `x`): así el motor evalúa y el panel pinta exactamente la misma condición. */
function conDominio(cuerpo: string, cond: string): string | null {
  let c: Nodo;
  try { c = parse(cond) as unknown as Nodo; } catch { return `dom(${cuerpo}, ${cond})`; }
  if (esNoNegativo(c)) return cuerpo;
  if (esSiempreNegativo(c)) return null;
  return `dom(${cuerpo}, ${sinFactoresConstantes(c).toString()})`;
}

/** Único término-y de la forma (libres)·ⁿ√y: divide los libres y ELEVA a la n para
 *  invertir la raíz. `x−√y=27` → `y = (x−27)²` (completo). El elevar es el inverso de
 *  la raíz principal; formalmente añade la rama del radicando negativo (misma licencia
 *  que el elevar al cuadrado toma en un despeje de manual), pero deja y aislada. El rhs
 *  es la BASE de una potencia a nivel superior → orden canónico. null si la parte con y
 *  no es una raíz pura de y. */
function despejeRaiz(t: Termino, derecha: Termino[]): { ecuacion: string; completo: boolean } | null {
  const fs = factores(t.nodo);
  const conYf = fs.filter((f) => contieneY(f.nodo));
  const libres = fs.filter((f) => !contieneY(f.nodo));
  if (conYf.length !== 1 || conYf[0].exp !== 1) return null;
  const n = raizY(conYf[0].nodo);
  if (n === null) return null;
  const R = ladoDerecho(t, derecha, libres, renderCanonico);
  // Índice IMPAR (∛y…): x↦xⁿ es biyección en ℝ, elevar es EXACTO → sin guarda. Índice PAR
  // (√y…): `√y=R` exige R≥0; elevar a R² dibujaría la rama fantasma R<0 → guarda de dominio.
  if (n % 2 === 1) return { ecuacion: `y = (${R})^${n}`, completo: true };
  const cuerpo = conDominio(`(${R})^${n}`, R);
  return cuerpo === null ? null : { ecuacion: `y = ${cuerpo}`, completo: true };
}

/** Índice de raíz `n` y potencia `m` si el nodo es `ⁿ√(y^m)` —una raíz (sqrt/cbrt/nthRoot)
 *  cuyo radicando es una POTENCIA de y (base exactamente y, m entero ≥2)—: `∛(y²)`→{n:3,m:2}.
 *  La raíz de la y DESNUDA (m=1) es asunto de `despejeRaiz`; aquí solo m≥2. null si no encaja. */
function raizDePotenciaY(n0: Nodo): { n: number; m: number } | null {
  const nodo = desParen(n0);
  if (nodo.type !== "FunctionNode") return null;
  const nombre = nodo.fn?.name;
  let n: number | null = null;
  let rad: Nodo | undefined;
  if (nombre === "sqrt" && nodo.args.length === 1) { n = 2; rad = nodo.args[0]; }
  else if (nombre === "cbrt" && nodo.args.length === 1) { n = 3; rad = nodo.args[0]; }
  else if (nombre === "nthRoot" && nodo.args.length === 2) {
    const k = desParen(nodo.args[1]);
    if (k.type === "ConstantNode" && Number.isInteger(k.value) && k.value >= 2) { n = k.value; rad = nodo.args[0]; }
  }
  if (n === null || rad === undefined) return null;
  const m = exponenteY(rad); // `y^m` con base exactamente y, m entero ≥2
  return m === null ? null : { n, m };
}

/** Único término-y de la forma (libres)·ⁿ√(y^m): pasa los libres al otro lado, ELEVA a n
 *  para invertir la raíz (`y^m = Rⁿ`) y saca la raíz m-ésima para aislar y. El astroide
 *  `∛(y²)=1−∛(x²)` → `y² = (1−∛(x²))³` → `y = ±√((1−∛(x²))³)`. m PAR → las DOS ramas (centinela
 *  `pm`); m IMPAR → raíz real única. Como `∛(y²)≥0` obliga a R≥0, elevar no añade soluciones
 *  espurias: donde R<0 (fuera del dominio) el radicando sale negativo y la raíz par es NaN, es
 *  decir sin curva —igual que la original—. Completo. null si el factor con y no es `ⁿ√(y^m)`. */
function despejeRaizDePotencia(t: Termino, derecha: Termino[]): { ecuacion: string; completo: boolean } | null {
  const fs = factores(t.nodo);
  const conYf = fs.filter((f) => contieneY(f.nodo));
  const libres = fs.filter((f) => !contieneY(f.nodo));
  if (conYf.length !== 1 || conYf[0].exp !== 1) return null;
  const info = raizDePotenciaY(conYf[0].nodo);
  if (info === null) return null;
  const { n, m } = info;
  // ⁿ√(y^m) = R (libres al otro lado, radicando con positivos primero) ⇒ y^m = Rⁿ.
  const R = ladoDerecho(t, derecha, libres);
  const base = `(${R})^${n}`;
  const cuerpo = m % 2 === 1
    ? `nthRoot(${base}, ${m})`
    : ramaDoble(m === 2 ? `sqrt(${base})` : `nthRoot(${base}, ${m})`, R);
  if (cuerpo === null) return null;   // presupuesto de ramas agotado → parcial honesto
  // Índice externo IMPAR: Rⁿ preserva el signo, así que donde R<0 el radicando sale negativo
  // y la raíz par da NaN (sin fantasma) → fiel sin guarda. Índice externo PAR: Rⁿ≥0 SIEMPRE
  // (borra el signo de R) y `ⁿ√(yᵐ)=R` exige R≥0 → guarda de dominio (era el bug: `√(y⁴)=−3`
  // salía con curva inventada).
  if (n % 2 === 1) return { ecuacion: `y = ${cuerpo}`, completo: true };
  const guardado = conDominio(cuerpo, R);
  return guardado === null ? null : { ecuacion: `y = ${guardado}`, completo: true };
}

/** Valor ENTERO de un exponente. Usa `valorConstanteFactor` (compartido) porque la entrada
 *  `|y|^{-1}` normaliza a `abs(y)^(-1)`, cuyo exponente mathjs NO parsea como
 *  `ConstantNode(−1)` sino como paréntesis sobre un menos unario: sin desenvolverlo, el
 *  exponente negativo no se reconocía y el despeje se quedaba parcial. null si no es entero. */
function exponenteEntero(n: Nodo): number | null {
  const v = valorConstanteFactor(n);
  return v !== null && Number.isInteger(v) ? v : null;
}

/** ¿El nodo es exactamente `abs(y)` (posibles paréntesis)? El valor absoluto de la y
 *  desnuda —no `abs(y+1)` ni `abs(2y)`, que exigirían despejar el interior. */
function esAbsDeY(n: Nodo): boolean {
  const nodo = desParen(n);
  if (nodo.type !== "FunctionNode" || nodo.fn?.name !== "abs" || nodo.args.length !== 1) return false;
  const arg = desParen(nodo.args[0]);
  return arg.type === "SymbolNode" && arg.name === "y";
}

/** Reduce num/den a términos mínimos con den>0. null si den es 0. */
function normalizarFraccion(num: number, den: number): { num: number; den: number } | null {
  if (den === 0) return null;
  if (den < 0) { num = -num; den = -den; }
  const g = mcdEnteros(Math.abs(num), den) || 1;
  return { num: num / g, den: den / g };
}

/** Valor RACIONAL de un exponente constante como fracción num/den (num con signo). Va más
 *  allá de `exponenteEntero` para reconocer los exponentes fraccionarios `|y|^{1/2}` (que
 *  mathjs parsea como el `OperatorNode` `/`, no un ConstantNode). null si no es una fracción
 *  de enteros (un símbolo como `pi`, un decimal raro…). */
function racionalConstante(n: Nodo): { num: number; den: number } | null {
  const nodo = desParen(n);
  if (nodo.type === "OperatorNode" && nodo.op === "/" && nodo.args.length === 2) {
    const a = racionalConstante(nodo.args[0]);
    const b = racionalConstante(nodo.args[1]);
    if (a === null || b === null || b.num === 0) return null;
    return normalizarFraccion(a.num * b.den, a.den * b.num);
  }
  if (nodo.type === "OperatorNode" && nodo.op === "-" && nodo.args.length === 1) {
    const a = racionalConstante(nodo.args[0]);
    return a === null ? null : { num: -a.num, den: a.den };
  }
  const v = valorConstanteFactor(nodo);
  return v !== null && Number.isInteger(v) ? { num: v, den: 1 } : null;
}

/** Índice n y radicando de una RAÍZ (sqrt→2, cbrt→3, nthRoot(·,n)→n, n entero ≥2), o null.
 *  `√|y|` es `sqrt(abs(y))`, es decir `|y|^{1/2}`: la raíz es un exponente fraccionario más. */
function indiceRaiz(n: Nodo): { n: number; rad: Nodo } | null {
  const nodo = desParen(n);
  if (nodo.type !== "FunctionNode") return null;
  const nombre = nodo.fn?.name;
  if (nombre === "sqrt" && nodo.args.length === 1) return { n: 2, rad: nodo.args[0] };
  if (nombre === "cbrt" && nodo.args.length === 1) return { n: 3, rad: nodo.args[0] };
  if (nombre === "nthRoot" && nodo.args.length === 2) {
    const k = exponenteEntero(nodo.args[1]);
    if (k !== null && k >= 2) return { n: k, rad: nodo.args[0] };
  }
  return null;
}

/** Único término-y de la forma (libres)·abs(y)^e: exponente EFECTIVO `e = num/den` de abs(y)
 *  (RACIONAL, no solo entero) y los factores libres de y. null si el factor con y no es abs(y)
 *  puro. El exponente puede venir de: el signo del factor (±1, num/denominador de la fracción
 *  —`1/|y|` es abs(y)^(-1)—), una potencia explícita `|y|^{k}` con k racional (`|y|^{1/2}`), o
 *  una RAÍZ envolvente `ⁿ√|y|` (`√|y|` = `|y|^{1/2}`). Unifica también las dos formas de `1/|y|`:
 *  cruda `abs(y)^(-1)` (potencia) o simplificada `1/abs(y)` (factor en denominador, `exp=-1`). */
function absYExponente(t: Termino): { num: number; den: number; libres: Factor[] } | null {
  const fs = factores(t.nodo);
  const conYf = fs.filter((f) => contieneY(f.nodo));
  const libres = fs.filter((f) => !contieneY(f.nodo));
  if (conYf.length !== 1) return null;
  let num = conYf[0].exp, den = 1;              // ±1 según numerador/denominador
  let nucleo = desParen(conYf[0].nodo);
  // Potencia explícita `abs(y)^k` (k racional; la que `factores` no separa): acumula el k.
  if (nucleo.type === "OperatorNode" && nucleo.op === "^" && nucleo.args.length === 2) {
    const k = racionalConstante(nucleo.args[1]);
    if (k === null || k.num === 0) return null;
    num *= k.num; den *= k.den;
    nucleo = desParen(nucleo.args[0]);
  } else {
    // Raíz envolvente `ⁿ√(abs(y))` (√|y|, ∛|y|, ⁿ√|y|): un exponente 1/n más sobre abs(y).
    const r = indiceRaiz(nucleo);
    if (r !== null) { den *= r.n; nucleo = desParen(r.rad); }
  }
  if (!esAbsDeY(nucleo)) return null;
  const frac = normalizarFraccion(num, den);
  return frac === null ? null : { ...frac, libres };
}

/** Aplana la expresión de |y| a una sola fracción legible (`1/(1−1/|x|)` → `|x|/(|x|−1)`):
 *  combina fracciones anidadas y recupera fracciones exactas. Sin la guarda de dominio de
 *  Simplificar (que rechazaría la cancelación por diferir en x=0): aquí el ± ya cambia el
 *  dominio a propósito. String mathjs re-parseable. */
function limpiarAbsoluto(s: string): string {
  try { return formatearCanonico(racionalizarFracciones(combinarFracciones(parse(s) as unknown as Nodo))); }
  catch { return s; }
}

/** Único término-y de la forma (libres)·abs(y)^e (e RACIONAL): aísla |y| y saca las DOS ramas
 *  del absoluto. `1/|x|+1/|y|=1` → `|y| = |x|/(|x|−1)` → `y = ±|x|/(|x|−1)`; `√|y|+tan x=2` →
 *  `|y| = (2−tan x)²` → `y = ±(2−tan x)²`. Se pasan los libres al otro lado (`abs(y)^e = R`) y
 *  se INVIERTE el exponente para aislar `|y| = R^{1/e}`; con `e = num/den`, `1/e = den/num` es la
 *  fracción `a/b` (a=den, b=|num|, con el signo de num haciendo el recíproco). Como el despeje de
 *  raíz, añade formalmente la rama del signo opuesto (licencia de "álgebra de manual"); deja y
 *  aislada → completo. null si la parte con y no es un abs(y) puro.
 *
 *  El radicando/base va en orden CANÓNICO (`renderCanonico`, como en `despejeRaiz`): es la base
 *  de una potencia de nivel superior, así `(2−x²)` sale `-x^2 + 2`, no `2 - x^2`. */
function despejeAbsoluto(t: Termino, derecha: Termino[]): { ecuacion: string; completo: boolean } | null {
  const info = absYExponente(t);
  if (!info) return null;
  const { num, den, libres } = info;
  // abs(y)^e = R (los factores libres pasan dividiendo/multiplicando al otro lado).
  const R = ladoDerecho(t, derecha, libres, renderCanonico);
  // |y| = R^{1/e} = R^{a/b}, con a=den, b=|num|; num<0 hace el recíproco. Una raíz b-ésima
  // usa `sqrt` (b=2, → `\sqrt` sin índice) o `nthRoot` (b≥3, → `\sqrt[b]`), la MISMA convención
  // que `despejePotencia`; una potencia entera (b=1, a≥2) se ELEVA literalmente, como el inverso
  // de la raíz en `despejeRaiz` (`|y|^{1/2}=R` ⇒ `|y|=R²`).
  const a = den, b = Math.abs(num), neg = num < 0;
  const raizDe = (r: string, n: number) => (n === 2 ? `sqrt(${r})` : `nthRoot((${r}), ${n})`);
  let mag: string;
  let esPotencia = false;   // ¿|y| es una BASE elevada a un entero? → no aplanar (expandiría)
  if (b === 1) {
    if (a === 1) mag = R;                             // |y| = R
    else { mag = `(${R})^${a}`; esPotencia = true; } // |y| = Rᵃ
  } else if (a === 1) {
    mag = raizDe(R, b);                              // |y| = ᵇ√R
  } else {
    mag = `nthRoot((${R})^${a}, ${b})`;             // |y| = ᵇ√(Rᵃ)
    esPotencia = true;
  }
  const aby = neg ? `1/(${mag})` : mag;
  // Las formas con potencia se dejan literales (como `despejeRaiz`): `limpiarAbsoluto` EXPANDIRÍA
  // `(-x²+2)²`. El resto (recíprocos, raíces, e=1) sí se aplanan a una fracción legible.
  const cuerpo = esPotencia ? aby : limpiarAbsoluto(aby);
  const doble = ramaDoble(cuerpo, R);   // presupuesto de ramas: ver dobleSigno.ramaDoble
  if (doble === null) return null;
  // GUARDA DE DOMINIO: como `abs(y)^e ≥ 0` (e racional), la ecuación `abs(y)^e = R` exige R≥0
  // —donde R<0 no hay y—. La condición es R (el lado derecho), NO la magnitud `R^{1/e}` (que
  // al invertir el exponente PAR ya es ≥0 y no captaría la restricción: `√|y|=1−x` ⇒ |y|=(1−x)²
  // parece libre, pero solo vale x≤1). Constante <0 → sin solución → parcial.
  const guardado = conDominio(doble, R);
  return guardado === null ? null : { ecuacion: `y = ${guardado}`, completo: true };
}

/** Único término-y de la forma (libres)·T(y) con T trig PERIÓDICA de la y desnuda:
 *  pasa los libres al otro lado e invierte con la solución GENERAL —una FAMILIA
 *  discreta infinita, no una función—: `tan(y)+x=2` → `y = atan(2 - x) + fam(k, pi)`
 *  (= arctan(2−x)+kπ, k∈ℤ). La tabla de inversas y la semántica del centinela `fam`
 *  viven en despejeInverso.ts; aquí solo la manipulación de términos. Completo. */
function despejeTrigInverso(t: Termino, derecha: Termino[]): { ecuacion: string; completo: boolean } | null {
  const fs = factores(t.nodo);
  const conYf = fs.filter((f) => contieneY(f.nodo));
  const libres = fs.filter((f) => !contieneY(f.nodo));
  if (conYf.length !== 1 || conYf[0].exp !== 1) return null;
  const tipo = trigDeY(conYf[0].nodo);
  if (tipo === null) return null;
  const rhs = inversionTrig(tipo, ladoDerecho(t, derecha, libres));
  return rhs === null ? null : { ecuacion: `y = ${rhs}`, completo: true };
}

/** Un único término-y que es un PRODUCTO: divide los factores libres de y al otro
 *  lado. `tan(y)·(x²+1) = √(x+1)` → `tan(y) = √(x+1)/(x²+1)`. null si no hay factores
 *  libres que separar (todo el término contiene y). El string es re-parseable: mathjs
 *  normaliza los paréntesis redundantes y produce el `\frac` al pasar por el pipeline. */
function despejeMultiplicativo(t: Termino, derecha: Termino[]): string | null {
  const fs = factores(t.nodo);
  const conYf = fs.filter((f) => contieneY(f.nodo));
  const libres = fs.filter((f) => !contieneY(f.nodo));
  if (libres.length === 0 || conYf.length === 0) return null;
  return `${renderProducto(conYf)} = ${ladoDerecho(t, derecha, libres)}`;
}

/** Único término-y de la forma (libres)·E⁻¹ con E conteniendo y (y en el DENOMINADOR):
 *  invierte el recíproco —E sube, `derecha` baja— y RECURRE para aislar y de E, que ninguna
 *  otra estrategia toca (todas exigen la y en el NUMERADOR, exp +1). `1/y=x` → `y=1/x`;
 *  `x/y=2` → `y=x/2`; `1/(x²+y²)=kπ` → `x²+y²=1/(kπ)` → `y=±√(1/(kπ)−x²)`. Es EXACTO: un
 *  recíproco `1/E` nunca vale 0, y donde `derecha=0` ambas formas quedan indefinidas (mismo
 *  dominio). Solo se acepta si la recursión COMPLETA el despeje; si no, null → forma parcial de
 *  siempre. La recursión es de un nivel: tras invertir, la y de E queda en el numerador. */
function despejeReciproco(t: Termino, derecha: Termino[]): { ecuacion: string; completo: boolean } | null {
  const fs = factores(t.nodo);
  const conYf = fs.filter((f) => contieneY(f.nodo));
  const libres = fs.filter((f) => !contieneY(f.nodo));
  if (conYf.length !== 1 || conYf[0].exp !== -1) return null;
  if (derecha.length === 0) return null; // `1/E = 0`: sin solución (el recíproco nunca es 0)
  const E = conYf[0].nodo.toString();
  const numFree = libres.filter((f) => f.exp === 1).map((f) => `(${f.nodo.toString()})`);
  const denFree = libres.filter((f) => f.exp === -1).map((f) => `(${f.nodo.toString()})`);
  // signo·numFree·E⁻¹ / denFree = derecha  ⇒  E = signo·numFree / (derecha·denFree).
  const arriba = (t.signo === -1 ? "-" : "") + (numFree.length ? numFree.join("*") : "1");
  // Los factores libres del denominador van DELANTE del valor de `derecha` (coeficiente
  // numérico primero: `5/(2y)=x` → `y=5/(2x)`, no `5/(x2)` —`x·2` se pinta pegado y al revés).
  const abajo = [...denFree, `(${renderTerminos(derecha)})`].join("*");
  const rec = despejar(`${E} = (${arriba})/(${abajo})`);
  return rec && rec.completo ? rec : null;
}

/** Familia de `T(u) = 0` (RHS de `u = …`): dónde se anula cada trig. `sin`/`tan` → kπ;
 *  `cos`/`cot` → π/2 + kπ; `sec`/`csc` NUNCA se anulan (sin solución). */
const TRIG_CERO: Record<string, { periodo: string; base: string | null } | null | undefined> = {
  sin: { periodo: "pi", base: null }, tan: { periodo: "pi", base: null },
  cos: { periodo: "pi", base: "pi/2" }, cot: { periodo: "pi", base: "pi/2" },
  sec: null, csc: null,
};

/** ¿La expresión (aún con y sin aislar) es SIEMPRE > 0 sobre una malla del plano (x,y)?
 *  Decide si la familia `kπ` de `sin(u)=0`/`tan(u)=0` es ℕ (kπ debe ser > 0 para que exista
 *  curva: `u=1/(x²+y²)>0`) o ℤ. Conservador: cualquier valor ≤ 0 —o malla sin evidencia
 *  suficiente— → false (ℤ). Mismo espíritu numérico que `ramaReal`. */
function uSiemprePositivo(uStr: string): boolean {
  let f: (s: Record<string, number>) => unknown;
  try { const c = parse(insertarProductoImplicito(normalizarEntrada(uStr))).compile(); f = (s) => c.evaluate(s); }
  catch { return false; }
  const malla = [-8, -3.5, -1.5, -0.5, 0.3, 0.9, 2.2, 5.1];
  let vistos = 0;
  for (const x of malla) for (const y of malla) {
    let v: unknown;
    try { v = f({ x, y }); } catch { continue; }
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v <= 1e-9) return false;
    vistos++;
  }
  return vistos >= 8; // evidencia mínima: no declarar "positivo" por una malla casi toda NaN
}

/** `T(u) = 0` con T trig y u conteniendo y (NO desnuda) → invierte a la familia
 *  `u = base + k·período` y RECURRE para aislar y de u. `sin(1/(x²+y²))=0` → `1/(x²+y²)=kπ`
 *  → (recíproco + círculo) → `y = ±√(1/(kπ)−x²)`. Para `sin`/`tan` (familia kπ) el parámetro
 *  es ℕ si u>0 en todo el plano (kπ debe ser positivo para que haya curva) y ℤ si no; `cos`/
 *  `cot` (π/2+kπ) van a ℤ. Solo la forma pura `T(u)=0` sin factores libres —la del ejemplo—;
 *  `T(y)` desnuda es de `despejeTrigInverso`. null si no encaja o la recursión no completa. */
function despejeTrigCero(t: Termino, derecha: Termino[]): { ecuacion: string; completo: boolean } | null {
  // Solo `T(u) = 0`: el lado libre de y debe ser 0 (el RHS `= 0` deja el término constante
  // `0` en `derecha`, que aquí se ignora; un `T(u) = c≠0` sí se descarta —otra estrategia—).
  const noNulos = derecha.filter((d) => {
    const n = desParen(d.nodo);
    return !(n.type === "ConstantNode" && n.value === 0);
  });
  if (noNulos.length !== 0) return null;
  const nodo = desParen(t.nodo);
  if (nodo.type !== "FunctionNode" || nodo.args?.length !== 1) return null;
  const info = TRIG_CERO[nodo.fn?.name ?? ""];
  if (!info) return null; // no es trig soportada, o sec/csc (nunca 0 → sin solución)
  const u = desParen(nodo.args[0]);
  if (!contieneY(u) || (u.type === "SymbolNode" && u.name === "y")) return null; // desnuda → otra vía
  const uStr = u.toString();
  // El parámetro se ASIGNA (no se fija en `k`): la recursión de abajo puede invertir otra
  // periódica y necesitar el suyo propio. `natural` = sin/tan con u>0 ⇒ kπ debe ser positivo.
  const cero = familiaPeriodica(info.periodo, uStr, info.base === null && uSiemprePositivo(uStr));
  if (cero === null) return null;
  const rhs = info.base ? `${info.base} + ${cero}` : cero;
  const rec = despejar(`${uStr} = ${rhs}`);
  return rec && rec.completo ? rec : null;
}

// ─────────────────────────────────────────────
// Despeje CUADRÁTICO en y^g (bicuadráticas y cuadráticas en y)
// ─────────────────────────────────────────────
//
// Las estrategias de arriba aíslan y cuando aparece en UN solo término manejable. Una
// ecuación como `(x²+y²)² − 2(x²−y²) = 0` (lemniscata) es, tras expandir, un POLINOMIO en y
// de grado 4 con SOLO potencias pares: `y⁴ + (2x²+2)y² + (x⁴−2x²) = 0`, es decir CUADRÁTICA en
// u = y². Se resuelve con la fórmula reducida (completar cuadrados) `u = −p ± √(p²−q)` con
// `p = B/2A`, `q = C/A`: así `p²−q` sale como POLINOMIO limpio (`4x²+1`) sin tener que factorizar
// un cuadrado perfecto del discriminante. Luego `y = ±√u` (g par) o `y = u` (g=1, cuadrática en y).
//
// La RAMA física se elige NUMÉRICAMENTE (`ramaReal`): de las dos raíces u₊, u₋, solo se muestran
// las que dan y real en la muestra (para la lemniscata, u₋ = −(x²+1)−√(4x²+1) < 0 siempre → se
// descarta, quedando `y = ±√(−(x²+1)+√(4x²+1))`). Y TODO el resultado se valida sustituyéndolo en
// la ecuación original: una rama que no la cumpla se descarta (corrección garantizada).

const contieneX = (n: Nodo): boolean => contieneVariable(n, "x");
const mcdEnteros = (a: number, b: number): number => (b === 0 ? Math.abs(a) : mcdEnteros(b, Math.abs(a % b)));

/** Simplificación completa (expande/reduce) de un string a string mathjs canónico; el propio
 *  string si falla. Base de todo el álgebra del despeje cuadrático (mismo pipeline que Simplificar). */
function simpDesp(s: string): string {
  try { const n = simplificarExpr(s); return n ? formatearCanonico(racionalizarFracciones(n)) : s; }
  catch { return s; }
}
/** Simplifica SOLO si la expresión es constante (sin x): limpia los casos numéricos
 *  (`√4`→`2`, `−(−5/2)`→`5/2`) sin distribuir ni reordenar los simbólicos (`−(x²+1)` intacto). */
function simpSiConstante(s: string): string {
  try { return contieneX(parse(s) as unknown as Nodo) ? s : simpDesp(s); } catch { return s; }
}
const sumarStrings = (a: string[]): string => (a.length ? a.map((s) => `(${s})`).join(" + ") : "0");

/** Potencia entera de y (≥1) y su coeficiente (factores libres de y, con el signo del término)
 *  si el término es (libres)·y^k con y SOLO en ese factor y en el numerador; si no (y en el
 *  denominador, `sin(y)`, y repartida en varios factores…), null → la ecuación no es polinómica en y. */
function potenciaYCoef(t: Termino): { power: number; coef: string } | null {
  const fs = factores(t.nodo);
  const conYf = fs.filter((f) => contieneY(f.nodo));
  const libres = fs.filter((f) => !contieneY(f.nodo));
  if (conYf.length !== 1 || conYf[0].exp !== 1) return null;
  const yn = desParen(conYf[0].nodo);
  let power: number;
  if (yn.type === "SymbolNode" && yn.name === "y") power = 1;
  else { const k = exponenteY(yn); if (k === null) return null; power = k; }
  const coef = renderProducto(libres);
  return { power, coef: t.signo === 1 ? coef : `-(${coef})` };
}

/** ¿La rama `u(x)` (una raíz de la cuadrática en u=y^g) da y REAL que cumple la ecuación original
 *  `evalD(x,y)=0` en la muestra? Rechaza (false) si algún punto viable falla; exige ≥2 puntos
 *  viables (para no aceptar por vacuidad una rama que nunca es real). Para g par, y=±u^{1/g} exige
 *  u≥0; para g impar, y es la raíz real con signo. */
function ramaReal(uStr: string, g: number, evalD: (x: number, y: number) => number): boolean {
  let fu: (x: number) => unknown;
  try { const c = parse(uStr).compile(); fu = (x) => c.evaluate({ x }); }
  catch { return false; }
  // Muestra con valores PEQUEÑOS además de los grandes: hay curvas cuyo dominio en x es
  // estrecho (`x·y²+y+x=0` solo existe para |x|≤½) y con una muestra toda "ancha" no se
  // alcanzaban los 2 puntos viables que exige la validación → una rama CORRECTA se
  // descartaba y el despeje salía parcial.
  const muestras = [-2.3, -1.1, -0.4, -0.15, 0.15, 0.35, 0.7, 1.6, 3.2];
  let viables = 0;
  for (const x of muestras) {
    let u: unknown;
    try { u = fu(x); } catch { continue; }
    if (typeof u !== "number" || !Number.isFinite(u)) continue;
    const escala = 1 + x * x * x * x;
    if (g % 2 === 0) {
      if (u < -1e-9) continue;
      const y = Math.pow(Math.max(u, 0), 1 / g);
      for (const yy of [y, -y]) {
        const d = evalD(x, yy);
        if (!Number.isFinite(d) || Math.abs(d) > 1e-6 * (escala + y * y * y * y)) return false;
      }
    } else {
      const y = Math.sign(u) * Math.pow(Math.abs(u), 1 / g);
      const d = evalD(x, y);
      if (!Number.isFinite(d) || Math.abs(d) > 1e-6 * (escala + y * y * y * y)) return false;
    }
    viables++;
  }
  return viables >= 2;
}

// ─────────────────────────────────────────────
// Reducción por RAÍZ IMPAR: (L)^n = R  ⇒  L = ⁿ√R  (n impar)
// ─────────────────────────────────────────────
//
// La familia `(A(x) + y²)^n = B(x)·y^n` con n IMPAR —el corazón `(x²+y²−1)³ = x²y³`— no la
// despeja ninguna estrategia de arriba: y aparece en varios términos y, sin tocar la potencia,
// la ecuación es de grado 6 en y. Pero una potencia IMPAR es INVERTIBLE en todo ℝ (x↦xⁿ es
// biyectiva), así que se puede sacar la raíz n-ésima real de AMBOS lados SIN perder ni añadir
// soluciones —a diferencia de una potencia par, donde ⁿ√(uⁿ)=|u| y haría falta un ±—:
//
//     (x²+y²−1)³ = x²y³   ⇒   x²+y²−1 = ∛(x²y³) = ∛(x²)·y   ⇒   y² − ∛(x²)·y + (x²−1) = 0
//
// y eso ya es una CUADRÁTICA en y, que `despejeCuadratico` resuelve por la fórmula general.
// La clave es que ∛ ENTRA en el producto y libera la y: ∛(x²y³) = ∛(x²)·∛(y³) = ∛(x²)·y,
// porque el exponente de y (3) es múltiplo del índice. `raizImpar` hace justo esa extracción.

/** Base y exponente ENTERO de un factor: `x^2`→(x,2), `y`→(y,1), con el ±1 de num/den. */
function baseYExponente(f: Factor): { base: Nodo; k: number } {
  const nodo = desParen(f.nodo);
  if (nodo.type === "OperatorNode" && nodo.op === "^" && nodo.args.length === 2) {
    const k = exponenteEntero(nodo.args[1]);
    if (k !== null) return { base: desParen(nodo.args[0]), k: k * f.exp };
  }
  return { base: nodo, k: f.exp };
}

/**
 * ⁿ√R con n IMPAR, sacando del radical los factores cuyo exponente es MÚLTIPLO de n:
 * `∛(x²y³)` → `y·∛(x²)`, `∛(x³)` → `x`. Devuelve null si dentro del radical quedaría una `y`
 * (entonces el resultado no sería polinómico en y y no habríamos ganado nada).
 */
function raizImpar(R: Nodo, n: number): string | null {
  const fuera: string[] = [];
  const dentro: string[] = [];
  for (const f of factores(R)) {
    const { base, k } = baseYExponente(f);
    const pot = (e: number) => (e === 1 ? `(${base.toString()})` : `(${base.toString()})^(${e})`);
    if (k % n === 0) fuera.push(pot(k / n));
    else {
      if (contieneY(base)) return null;   // la y quedaría ATRAPADA bajo el radical
      dentro.push(pot(k));
    }
  }
  if (dentro.length === 0) return fuera.length ? fuera.join("*") : "1";
  const radicando = dentro.join("*");
  const raiz = `nthRoot(${radicando}, ${n})`;
  return fuera.length ? `${fuera.join("*")}*${raiz}` : raiz;
}

/**
 * Si un lado de la ecuación es una potencia de exponente IMPAR ≥3, saca la raíz n-ésima real de
 * los dos lados y devuelve la NUEVA diferencia D = L − ⁿ√R (ya simplificada), o null. La
 * equivalencia es exacta en ℝ (potencia impar = biyección), así que no cambia la curva: solo la
 * escribe en una forma donde y sí es despejable.
 */
function reducirRaizImpar(L: Nodo, R: Nodo): Nodo | null {
  const intento = (potencia: Nodo, otro: Nodo): Nodo | null => {
    const p = desParen(potencia);
    if (!(p.type === "OperatorNode" && p.op === "^" && p.args.length === 2)) return null;
    const n = exponenteEntero(p.args[1]);
    if (n === null || n < 3 || n % 2 === 0) return null;   // par: ⁿ√(uⁿ)=|u|, haría falta ±
    const base = desParen(p.args[0]);
    if (!contieneY(base)) return null;                     // la y debe quedar del lado reducido
    const raiz = raizImpar(otro, n);
    if (raiz === null) return null;
    // `simplify` y NO `simplificarExpr`: la reducción deja cancelaciones entre lados
    // (`(x+y)³=x³` → `(x+y) − x`) y `rationalize` NO combina términos semejantes entre
    // variables distintas (deja `x + y - x` tal cual, y el despeje saldría `y = -x + x`).
    // `simplify` sí las cancela. Si a cambio FACTORIZA algo, no importa: la vía cuadrática
    // vuelve a expandir con `simplificarExpr` antes de leer los coeficientes.
    try {
      const D = simplify(parse(`(${base.toString()}) - (${raiz})`)) as unknown as Nodo;
      return D && contieneY(D) ? D : null;
    } catch { return null; }
  };
  return intento(L, R) ?? intento(R, L);
}

/**
 * La reducción de arriba necesita que la potencia impar sea un LADO entero de la ecuación, pero
 * la forma natural de escribir una curva implícita es con todo a la izquierda (el corazón como
 * `(x²+y²−1)³ − x²y³`, o una expresión SUELTA ≡ expr=0): ahí la potencia es un TÉRMINO, no un
 * lado, y `reducirRaizImpar` no la veía → la MISMA curva se despejaba con `=` y no sin él.
 * Remedio: reconstruir los dos lados —la potencia a un miembro, el resto de términos al otro con
 * el signo cambiado (`s·P + resto = 0` ⇒ `P = −resto/s`)— y reintentar. La equivalencia es la de
 * pasar términos de miembro, y el resultado se sigue validando contra la ecuación original.
 */
function reducirRaizImparPorTerminos(D: Nodo): Nodo | null {
  const ts = terminos(D);
  if (ts.length < 2) return null;
  for (let i = 0; i < ts.length; i++) {
    const p = desParen(ts[i].nodo);
    if (!(p.type === "OperatorNode" && p.op === "^" && p.args.length === 2)) continue;
    const n = exponenteEntero(p.args[1]);
    if (n === null || n < 3 || n % 2 === 0) continue;      // par: ⁿ√(uⁿ)=|u|, haría falta ±
    const base = desParen(p.args[0]);
    if (!contieneY(base)) continue;
    // `y^n` DESNUDA no es asunto de esta reducción: ya la aísla `despejePotencia`, y en su
    // forma (`y = ∛(9−x³)`, sin paréntesis sobrantes). Aquí solo las bases COMPUESTAS.
    if (base.type === "SymbolNode") continue;
    const resto = ts.filter((_, j) => j !== i);
    const otroLado = ts[i].signo === 1 ? flip(resto) : resto;
    let R: Nodo;
    try { R = parse(renderTerminos(otroLado)) as unknown as Nodo; } catch { continue; }
    const reducido = reducirRaizImpar(p, R);
    if (reducido) return reducido;
  }
  return null;
}

/** `ⁿ√(u)^k` → `ⁿ√(u^k)` con n IMPAR (válido en todo ℝ). Deja `(∛(x²))²` como `∛(x⁴)`, que es
 *  como se escribe el discriminante del corazón a mano. */
function plegarRaicesImpares(n: Nodo): Nodo {
  try {
    return n.transform((nn: Nodo) => {
      if (nn.type !== "OperatorNode" || nn.op !== "^" || nn.args.length !== 2) return nn;
      const base = desParen(nn.args[0]);
      const k = exponenteEntero(nn.args[1]);
      if (k === null || base.type !== "FunctionNode" || base.fn?.name !== "nthRoot") return nn;
      if (base.args.length !== 2) return nn;
      const idx = exponenteEntero(base.args[1]);
      if (idx === null || idx < 3 || idx % 2 === 0) return nn;
      return parse(`nthRoot((${base.args[0].toString()})^(${k}), ${idx})`) as unknown as Nodo;
    });
  } catch { return n; }
}

/**
 * Despeje de y cuando la ecuación, expandida, es CUADRÁTICA en u = y^g (g = mcd de las potencias
 * de y presentes): cuadrática `A·y²+B·y+C=0` (g=1) o bicuadrática `A·y⁴+B·y²+C=0` (g=2, y en
 * general g PAR). Devuelve la(s) rama(s) real(es), o null si no encaja (no polinómica en y,
 * grado ≠2 en u, g impar>1, sin rama real, o la validación numérica falla). Completo siempre.
 * `DVal` es la ecuación contra la que se VALIDA numéricamente (la ORIGINAL, aunque `D0` venga ya
 * reducido por raíz impar): así una reducción errónea no podría colarse.
 */
function despejeCuadratico(D0: Nodo, DVal: Nodo = D0): { ecuacion: string; completo: boolean } | null {
  // Expandir: `(x²+y²)²` → términos individuales por potencia de y (defensivo: el panel suele
  // pre-simplificar, pero así funciona también sobre la forma sin expandir).
  let D = D0;
  try { const e = simplificarExpr(D0.toString()); if (e) D = e; } catch { /* usa D0 */ }

  const ts = terminos(D);
  const conY = ts.filter((t) => contieneY(t.nodo));
  const sinY = ts.filter((t) => !contieneY(t.nodo));
  if (conY.length === 0) return null;

  const pcs = conY.map(potenciaYCoef);
  if (pcs.some((p) => p === null)) return null;              // no polinómica en y
  const P = pcs as { power: number; coef: string }[];
  const g = P.map((p) => p.power).reduce(mcdEnteros);
  // g impar > 1 (y⁶+y³…): la vuelta y = ᵍ√u metería el ± dentro de una raíz impar y no aporta
  // forma legible; fuera de alcance. g=1 (cuadrática CON término lineal) y g PAR (bicuadrática)
  // sí se resuelven, cada uno con su fórmula.
  if (g !== 1 && g % 2 !== 0) return null;
  const degs = P.map((p) => p.power / g);
  if (degs.some((d) => d > 2)) return null;

  const A = sumarStrings(P.filter((_, i) => degs[i] === 2).map((p) => p.coef));
  const B = sumarStrings(P.filter((_, i) => degs[i] === 1).map((p) => p.coef));
  const C = sumarStrings(sinY.map((t) => (t.signo === 1 ? t.nodo.toString() : `-(${t.nodo.toString()})`)));

  // La validación numérica va SIEMPRE contra la ecuación de entrada del usuario (`DVal`), no
  // contra la reducida: si la reducción por raíz impar fuese incorrecta, la rama no cumpliría la
  // original y se descartaría. Corrección garantizada.
  let evalD: (x: number, y: number) => number;
  try { const c = DVal.compile(); evalD = (x, y) => { try { return c.evaluate({ x, y }); } catch { return NaN; } }; }
  catch { return null; }

  // Sin término de grado 2 en u → la ecuación es LINEAL en u=y^g: A·y^g + C = 0 ⇒ y = ᵍ√(−C/A),
  // con A dependiente de x (si fuera constante lo habría cogido `despejePotencia`). Cubre
  // `x²y²+x²+y²=4` ⇒ `y = ±√((4−x²)/(x²+1))`, que antes quedaba parcial.
  if (!degs.includes(2)) {
    if (!degs.includes(1)) return null;
    const u = simpDesp(`-(${C})/(${B})`);   // el coeficiente de y^g es B (grado 1 en u)
    if (!ramaReal(u, g, evalD)) return null;
    const raizDeU = g === 1 ? u : g === 2 ? `sqrt(${u})` : `nthRoot(${u}, ${g})`;
    // g par → las DOS ramas (±); g impar → la raíz real es única.
    const cuerpo = simpSiConstante(raizDeU);
    return { ecuacion: `y = ${g % 2 === 0 ? `pm(${cuerpo})` : cuerpo}`, completo: true };
  }

  // g=1 → CUADRÁTICA EN y con término lineal: fórmula general y = (−B ± √(B²−4AC)) / 2A. Es la
  // que resuelve el corazón ya reducido (y² − ∛(x²)·y + x²−1 = 0). Se emite en la forma de menor
  // coste entre la FRACCIÓN ÚNICA —`(−B ± √Δ)/2A`, la del libro— y la SEPARADA —`−B/2A ± √Δ/2A`,
  // que gana cuando se reduce (x²+y²=2xy+4 → `x ± 2`, no `(2x ± 4)/2`).
  if (g === 1) {
    // B² y −4AC se simplifican POR SEPARADO y luego se suman: juntos, `simplify` (que es quien
    // actúa cuando hay una raíz, porque `rationalize` se rinde) deja el `−4·(x²−1)` sin
    // distribuir. Por partes, cada trozo es polinómico y `rationalize` sí lo expande.
    const b2 = plegarRaicesImpares(parse(simpDesp(`(${B})^2`)) as unknown as Nodo).toString();
    const m4ac = simpDesp(`-4*(${A})*(${C})`);
    const disc = simpDesp(`(${b2}) + (${m4ac})`);
    const num = simpDesp(`-(${B})`);
    const den = simpDesp(`2*(${A})`);
    const raiz = simpSiConstante(`sqrt(${disc})`);

    const yMas = `((${num}) + (${raiz}))/(${den})`;
    const yMenos = `((${num}) - (${raiz}))/(${den})`;
    const reales = [yMas, yMenos].filter((u) => ramaReal(u, 1, evalD));
    if (reales.length === 0) return null;
    if (reales.length === 1)
      return { ecuacion: `y = ${simpDesp(reales[0])}`, completo: true };

    const conPm = (cuerpo: string, mas: string) => (mas === "0" ? `pm(${cuerpo})` : `${mas} + pm(${cuerpo})`);
    const unica = den === "1" ? conPm(raiz, num) : `(${conPm(raiz, num)})/(${den})`;
    const separada = conPm(simpDesp(`(${raiz})/(${den})`), simpDesp(`(${num})/(${den})`));
    const barata = [unica, separada]
      .map((s) => ({ s, prof: profundidadFraccion(parse(s) as unknown as Nodo), len: s.length }))
      .sort((a, b) => (a.prof !== b.prof ? a.prof - b.prof : a.len - b.len))[0].s;
    return { ecuacion: `y = ${barata}`, completo: true };
  }

  // g PAR → BICUADRÁTICA. Forma reducida (completar cuadrados): u = −p ± √(p²−q), p=B/2A, q=C/A.
  // p²−q sale POLINÓMICO limpio (sin factorizar el discriminante).
  const p = simpDesp(`(${B})/(2*(${A}))`);
  const disc = simpDesp(`((${B})/(2*(${A})))^2 - (${C})/(${A})`);

  const uMas = `(-(${p})) + (sqrt(${disc}))`;
  const uMenos = `(-(${p})) - (sqrt(${disc}))`;
  const validas = [uMas, uMenos].filter((u) => ramaReal(u, g, evalD));
  if (validas.length === 0) return null;

  if (validas.length === 1) {
    // Una rama física (el caso típico: lemniscata, óvalos): `y = ±√(rama)`, sin ± interior.
    const inner = simpSiConstante(`sqrt(${validas[0]})`);
    return { ecuacion: `y = pm(${inner})`, completo: true };
  }
  // Ambas ramas reales → las cuatro soluciones en forma compacta `y = ±√(±√disc − p)`.
  const raizDisc = simpSiConstante(`sqrt(${disc})`);
  return { ecuacion: `y = pm(sqrt(pm(${raizDisc}) + (${simpDesp(`-(${p})`)})))`, completo: true };
}

// ─────────────────────────────────────────────
// Lineal en y por EVALUACIÓN: A(x)·y + B(x) = 0 (keystone)
// ─────────────────────────────────────────────
//
// El despeje lineal de arriba lee el coeficiente de la y de la ESTRUCTURA del término, así que
// exige la y como factor desnudo, y la vía cuadrática necesita que `rationalize` expanda —lo que
// solo hace con polinomios—. Entre las dos se cuela cualquier ecuación afín en y cuyo coeficiente
// NO sea polinómico: `y − (y+2)eˣ − 1 = 0`, `y·ln x + y = 3`, `y sin x = y + 1`.
//
// Pero una función afín está determinada por dos valores: A = D|_{y=1} − D|_{y=0} y B = D|_{y=0},
// y esas dos evaluaciones son SUSTITUCIONES, no expansión algebraica —funcionan con cualquier
// coeficiente—. La afinidad, que es lo único que hay que suponer, se comprueba numéricamente
// (una D no afín, `y²−x`, daría A y B igualmente: el filtro es lo que la distingue).

/** La expresión con y sustituida por una constante, simplificada. */
function enY(D: Nodo, valor: number): string {
  try {
    return simpDesp(D.transform((n: Nodo) =>
      n.type === "SymbolNode" && n.name === "y" ? parse(String(valor)) as unknown as Nodo : n
    ).toString());
  } catch { return ""; }
}

/** Ternas de y EQUIESPACIADAS donde se mide la afinidad. A ambos lados del 0 y con varios
 *  espaciados a propósito: `|y|` es perfectamente afín en cualquier terna de y positivos, y con
 *  una muestra así de ingenua `|y| = −3` se "despejaba" a `y = −3`. Los quiebros (`|·|`, raíces,
 *  escalones) solo se delatan si la terna los cruza. */
const TERNAS_Y: ReadonlyArray<readonly [number, number, number]> = [
  [-2.5, -0.5, 1.5], [-1.3, 0.7, 2.7], [-3.1, -1.1, 0.9], [-0.6, 1.9, 4.4],
];

/** ¿`D(x,y)` es AFÍN en y (una recta en y para cada x)? Sobre una malla del plano: en una terna
 *  equiespaciada, la segunda diferencia de una recta es 0. Los puntos donde D no es finita
 *  (dominios parciales) se saltan; se exigen varios para no aceptar por vacuidad. */
function esAfinEnY(D: Nodo): boolean {
  let f: (x: number, y: number) => unknown;
  try { const c = D.compile(); f = (x, y) => { try { return c.evaluate({ x, y }); } catch { return NaN; } }; }
  catch { return false; }
  let comprobados = 0;
  for (const x of [-3.7, -1.3, -0.4, 0.6, 1.9, 4.2]) {
    for (const terna of TERNAS_Y) {
      const [a, b, c2] = terna.map((y) => f(x, y));
      if (![a, b, c2].every((d) => typeof d === "number" && Number.isFinite(d))) continue;
      const [va, vb, vc] = [a as number, b as number, c2 as number];
      if (Math.abs((vc - vb) - (vb - va)) > 1e-7 * (1 + Math.abs(va) + Math.abs(vb) + Math.abs(vc)))
        return false;
      comprobados++;
    }
  }
  return comprobados >= 4;
}

/** Pares de y donde MEDIR la recta. Cualquier par fijo puede caer en una singularidad —`y=1` en
 *  `(y²−1)/(y−1)`, que evalúa 0/0—, y de ahí salían coeficientes `Infinity` que se colaban hasta
 *  la fórmula (`y = ∞x + ∞`). Se prueba el siguiente par hasta dar con uno limpio. */
const PARES_Y: ReadonlyArray<readonly [number, number]> = [[0, 1], [3, 4], [-4, -3], [5, 7]];

/** ¿La expresión evaluó a algo utilizable? Un `Infinity`/`NaN` en el string delata que la
 *  sustitución cayó en un polo: ese par de y no sirve para medir la recta. */
function expresionUtil(s: string): boolean {
  return s !== "" && !/(?<![a-zA-Z0-9_])(Infinity|NaN)(?![a-zA-Z0-9_])/.test(s);
}

/** Despeje de una ecuación AFÍN en y con coeficientes cualesquiera: `y = −B/A`. null si no es
 *  afín, si el coeficiente A es idénticamente nulo (la y no queda determinada), si ningún par de
 *  y da coeficientes limpios o si la solución NO reproduce la ecuación de partida.
 *
 *  Esa última validación es la que respeta los AGUJEROS: `(y²−4)/(y+2) = x` es afín en y en todo
 *  su dominio y da `y = x+2`, pero la curva no contiene el punto y=−2 (allí la original es 0/0),
 *  o sea que le falta el hueco en x=−4. Como `dom` no sabe expresar un `≠`, la fórmula sería más
 *  laxa que la curva: se descarta y la ecuación se queda como está. */
function despejeLinealEnY(D: Nodo): { ecuacion: string; completo: boolean } | null {
  if (!contieneY(D) || !esAfinEnY(D)) return null;
  const evalD = evaluadorDe(D);
  if (evalD === null) return null;
  for (const [y0, y1] of PARES_Y) {
    const D0 = enY(D, y0), D1 = enY(D, y1);
    if (!expresionUtil(D0) || !expresionUtil(D1)) continue;
    const A = simpDesp(`((${D1}) - (${D0}))/(${y1 - y0})`);   // pendiente en y
    if (A === "0" || !expresionUtil(A)) continue;
    const B = simpDesp(`(${D0}) - (${y0})*(${A})`);           // D(x,y) = A·y + B
    if (!expresionUtil(B)) continue;
    const rhs = limpiarRHS(`(-(${B}))/(${A})`);
    if (solucionValida(rhs, evalD)) return { ecuacion: `y = ${rhs}`, completo: true };
  }
  return null;
}

// ─────────────────────────────────────────────
// Racionalización de RADICALES: aislar y elevar al cuadrado (keystone)
// ─────────────────────────────────────────────
//
// Una raíz cuadrada suelta ya la invierte `despejeRaiz`/`aislarInversion`, pero con DOS raíces
// —o una raíz más la y fuera— la y no está agrupada y ninguna capa se deja pelar:
// `√(y+1) + √(y−2) = x`, `√(y+1) + y = x`. El método de manual es aislar UNA raíz y elevar al
// cuadrado, repitiendo hasta que no queden; lo que sale es polinómico en y y lo remata la
// maquinaria de siempre (lineal o cuadrática):
//   √(y+1) = x − √(y−2)  ⇒  y+1 = x² − 2x√(y−2) + y−2  ⇒  2x√(y−2) = x²−3
//   4x²(y−2) = (x²−3)²   ⇒  y = (x⁴+2x²+9)/(4x²)
//
// ELEVAR AL CUADRADO NO ES EQUIVALENTE: `A = B` ⟺ `A² = B²` **y** `B ≥ 0` (A es una raíz, luego
// no negativa). Sin esa condición aparece la rama fantasma —arriba, todo x < 0—, así que cada
// elevación APUNTA su guarda `B ≥ 0` y todas viajan al resultado como centinelas `dom`, que es
// la misma pieza con que el motor ya marca el dominio de `√y = R`. Las guardas se escriben en
// función de x sustituyendo hacia atrás lo que cada paso posterior averiguó (el paso 2 dice que
// √(y−2) vale (x²−3)/(2x), y con eso la guarda del paso 1 deja de tener y). Al final, la
// candidata se valida NUMÉRICAMENTE contra la ecuación original dentro de su propio dominio: si
// no la reproduce, se descarta entera.

const MAX_ELEVACIONES = 3; // dos raíces necesitan dos pasadas; una tercera cubre el resto

/** Radicando de una raíz CUADRADA que contiene y, si el factor lo es (exponente +1). */
function radicandoDeY(f: Factor): Nodo | null {
  if (f.exp !== 1) return null;
  const n = desParen(f.nodo);
  return n.type === "FunctionNode" && n.fn?.name === "sqrt" && n.args.length === 1 && contieneY(n)
    ? n.args[0] : null;
}

/** Término partido en `coef · √(rad)`: `rad` null si el término no lleva raíz con y. Con VARIAS
 *  raíces en el mismo término, la primera es la aislada y las demás se quedan en el coeficiente
 *  (elevar al cuadrado las racionaliza igual, solo que en otra pasada). */
function partirRadical(t: Termino): { coef: string; rad: Nodo | null } {
  const fs = factores(t.nodo);
  const i = fs.findIndex((f) => radicandoDeY(f) !== null);
  const rad = i === -1 ? null : radicandoDeY(fs[i]);
  const resto = i === -1 ? fs : fs.filter((_, j) => j !== i);
  const coef = renderProducto(resto);
  return { coef: t.signo === 1 ? coef : `-(${coef})`, rad };
}

/** Cuadrado de una suma de términos, EXPANDIDO a mano: `(Σtᵢ)² = ΣᵢΣⱼ tᵢtⱼ`. mathjs no
 *  desarrolla `(√u − x)²` (deja la potencia intacta) y sin desarrollar no hay términos que
 *  aislar en la siguiente pasada. Al multiplicar dos raíces del MISMO radicando se escribe el
 *  radicando: es justo la cancelación que hace avanzar el método. */
function cuadradoExpandido(ts: Termino[]): string {
  const ps = ts.map(partirRadical);
  const trozos: string[] = [];
  for (let i = 0; i < ps.length; i++) {
    for (let j = 0; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      const raices = a.rad === null ? (b.rad === null ? "1" : `sqrt(${b.rad.toString()})`)
        : b.rad === null ? `sqrt(${a.rad.toString()})`
        : a.rad.toString() === b.rad.toString() ? `(${a.rad.toString()})`
        : `sqrt(${a.rad.toString()})*sqrt(${b.rad.toString()})`;
      trozos.push(`(${a.coef})*(${b.coef})*(${raices})`);
    }
  }
  return trozos.length ? trozos.join(" + ") : "0";
}

/** Una elevación al cuadrado: aísla el primer término con raíz de y (`c·√u = −resto`) y devuelve
 *  la diferencia elevada (`c²u − resto²`) junto con lo que el paso AVERIGUA —`√u = −resto/c`—,
 *  que sirve a la vez de guarda de dominio y de sustitución para las guardas anteriores.
 *  null si ya no queda ninguna raíz con y. */
function elevarAlCuadrado(D: Nodo): { D: Nodo; radical: string; valor: string } | null {
  const ts = terminos(D);
  const i = ts.findIndex((t) => partirRadical(t).rad !== null);
  if (i === -1) return null;
  const { coef, rad } = partirRadical(ts[i]);
  if (rad === null) return null;
  const resto = ts.filter((_, j) => j !== i);
  const valor = `-(${renderTerminos(resto)})/(${coef})`;
  let out: Nodo;
  try {
    out = simplify(`(${coef})^2*(${rad.toString()}) - (${cuadradoExpandido(resto)})`) as unknown as Nodo;
  } catch { return null; }
  return { D: out, radical: `sqrt(${rad.toString()})`, valor };
}

/** Sustituye en `expr` cada radical por el valor que un paso posterior le asignó (y, si aun así
 *  queda y, la propia solución) para que la guarda quede en función de x. String simplificado. */
function guardaEnX(expr: string, pasos: Array<{ radical: string; valor: string }>, yFinal: string): string {
  let s = expr;
  for (const p of pasos) s = s.split(p.radical).join(`(${p.valor})`);
  let n: Nodo;
  try { n = parse(s) as unknown as Nodo; } catch { return s; }
  if (contieneY(n)) {
    try {
      n = n.transform((z: Nodo) =>
        z.type === "SymbolNode" && z.name === "y" ? parse(`(${yFinal})`) as unknown as Nodo : z);
    } catch { return s; }
  }
  return simpDesp(n.toString());
}

/** ¿La solución `y = f(x)` cumple la ecuación ORIGINAL allí donde sus guardas se cumplen? Los x
 *  fuera del dominio (guarda falsa → `dom` evalúa NaN) no son fallos: ahí la fórmula no afirma
 *  nada. Exige ≥2 puntos válidos para no aceptar por vacuidad una fórmula que nunca existe. */
function solucionValida(rhs: string, evalD: (x: number, y: number) => number): boolean {
  // Cada rama del ± por separado: `expandirDobleSigno` es quien las enumera para graficar, así
  // que validar sobre ellas comprueba EXACTAMENTE lo que el motor va a dibujar (evaluar el `pm`
  // a secas solo mediría la rama principal y la otra entraría sin comprobar).
  //
  // Ninguna rama puede CONTRADECIR la ecuación; que una quede VACÍA no es un fallo (su guarda de
  // dominio la anula en todo x, que es justo lo que le toca a la rama extraña que introduce el
  // elevar al cuadrado). Basta con que entre todas haya curva.
  let total = 0;
  for (const rama of expandirDobleSigno(rhs)) {
    const n = puntosValidos(rama, evalD);
    if (n === null) return false;
    total += n;
  }
  return total >= 2;
}

/** Evaluador numérico de una diferencia `D(x,y)` (NaN donde no esté definida). */
function evaluadorDe(D: Nodo): ((x: number, y: number) => number) | null {
  try {
    const c = D.compile();
    return (x, y) => { try { return c.evaluate({ x, y }); } catch { return NaN; } };
  } catch { return null; }
}

/** Puntos de la rama que cumplen la ecuación original, o null si alguno la CONTRADICE. */
function puntosValidos(rhs: string, evalD: (x: number, y: number) => number): number | null {
  // Con el scope del motor: el RHS lleva centinelas `dom`, que NO son funciones de mathjs sino
  // del evaluador —compilarlo a pelo daría símbolo libre y descartaría la solución entera.
  let f: (x: number) => unknown;
  try { f = compilarFuncion(rhs, "x"); }
  catch { return null; }
  let validos = 0;
  for (let i = 0; i <= 120; i++) {
    const x = -6 + (i * 12) / 120;
    let y: unknown;
    try { y = f(x); } catch { continue; }
    if (typeof y !== "number" || !Number.isFinite(y)) continue;
    const d = evalD(x, y);
    if (!Number.isFinite(d) || Math.abs(d) > 1e-6 * (1 + x * x * x * x + y * y * y * y)) return null;
    validos++;
  }
  return validos;
}

/** Despeje por elevaciones sucesivas al cuadrado, con las guardas de dominio de cada paso y
 *  validación numérica contra la ecuación original. null si no hay raíces de y, si tras el tope
 *  de pasadas queda alguna, si la ecuación racionalizada no se completa o si la candidata no
 *  reproduce la curva. */
function despejeRadicales(D0: Nodo, DVal: Nodo): { ecuacion: string; completo: boolean } | null {
  let D = D0;
  const pasos: Array<{ radical: string; valor: string }> = [];
  for (let i = 0; i < MAX_ELEVACIONES; i++) {
    const paso = elevarAlCuadrado(D);
    if (paso === null) break;
    pasos.push({ radical: paso.radical, valor: paso.valor });
    D = paso.D;
  }
  if (pasos.length === 0) return null;                 // no había radicales de y: otra vía
  if (elevarAlCuadrado(D) !== null) return null;       // quedan raíces: fuera de alcance
  if (!contieneY(D)) return null;                      // la y se canceló: la ecuación no la fija

  // Lo racionalizado suele quedar afín en y con la y repartida entre paréntesis (`x²(4(y−2)+6)`):
  // recolectar el coeficiente por evaluación da la fracción ÚNICA `(x⁴+2x²+9)/(4x²)`, mientras
  // que el despeje estructural iría pelando capa a capa y dejaría fracciones anidadas.
  const rhsCrudo = rhsCompleto(despejeLinealEnY(D) ?? despejarAnidado(`${D.toString()} = 0`));
  if (rhsCrudo === null) return null;

  // Guardas de FUERA hacia dentro: cada una se escribe con lo que los pasos POSTERIORES
  // averiguaron (por eso se recorren al revés y cada guarda solo usa los pasos que la siguen).
  let rhs = rhsCrudo;
  const guardas: string[] = [];
  for (let i = pasos.length - 1; i >= 0; i--) {
    const cond = guardaEnX(pasos[i].valor, pasos.slice(i + 1), rhsCrudo);
    const conG = conDominio(rhs, cond);
    if (conG === null) return null; // guarda imposible por sí sola: no hay curva real
    if (conG !== rhs) guardas.push(cond);  // (si `conDominio` la absorbió, era trivialmente cierta)
    rhs = conG;
  }
  // Guardas INCOMPATIBLES entre sí: cada una puede ser satisfacible y el sistema no. `conDominio`
  // solo mira una cada vez, así que la contradicción se busca resolviendo el sistema entero.
  if (simplificarCondiciones(guardas)?.tipo === "imposible") return null;

  const evalD = evaluadorDe(DVal);
  return evalD !== null && solucionValida(rhs, evalD)
    ? { ecuacion: `y = ${rhs}`, completo: true } : null;
}

// ─────────────────────────────────────────────
// Eliminación de DENOMINADORES con y (keystone)
// ─────────────────────────────────────────────
//
// Con la y en un denominador, ninguna estrategia aditiva la alcanza: `terminos`/`factores` la ven
// en un factor de exponente −1 y `despejeReciproco` solo cubre el caso puro `(libres)/E`. Pero
// multiplicar por los denominadores es el primer paso de cualquier despeje de manual y deja una
// ecuación POLINÓMICA que la maquinaria de siempre ya sabe rematar: `(y−1)/(y+2) = x` pasa a
// `y − 1 − x(y+2) = 0`, lineal en y repartida en dos términos → `y = (2x+1)/(1−x)`.
//
// PERO no es una transformación gratuita: multiplicar por `q` solo conserva la curva donde q≠0, y
// donde q se anula la ecuación original ni siquiera está definida. La ecuación limpia SÍ está
// definida ahí, así que puede traerse soluciones que no existen: `(y²−1)/(y−1) = x` limpia a
// `y²−1 = x(y−1)`, cuyas raíces son `y = x−1` **y** `y = 1`, y esta última no es curva (en y=1 la
// original es 0/0). El despeje se lo creería entero.
//
// La condición `q ≠ 0` no se puede escribir con el centinela `dom` (que expresa `≥ 0`), así que se
// COMPRUEBA en vez de arrastrarse: la candidata se valida rama a rama contra la ecuación ORIGINAL
// —la de antes de multiplicar—, que es la única que sabe de sus propios agujeros. Si alguna rama
// la contradice, se descarta el despeje entero y la ecuación se queda como estaba. Solo se acepta
// si además la re-entrada COMPLETA el despeje.

/** Denominadores DISTINTOS que contienen y (factores de exponente −1 de cualquier término). */
function denominadoresConY(D: Nodo): string[] {
  const dens = new Set<string>();
  for (const t of terminos(D))
    for (const f of factores(t.nodo))
      if (f.exp === -1 && contieneY(f.nodo)) dens.add(f.nodo.toString());
  return [...dens];
}

/** Despeje tras MULTIPLICAR por los denominadores que contienen y. null si no hay ninguno, si la
 *  multiplicación no los cancela (no se ha ganado nada: sin esta guarda la re-entrada sería
 *  circular) o si la ecuación resultante no se completa. */
function despejeSinDenominadores(D: Nodo): { ecuacion: string; completo: boolean } | null {
  const dens = denominadoresConY(D);
  if (dens.length === 0) return null;
  let limpio: Nodo;
  try {
    const prod = dens.map((d) => `(${d})`).join("*");
    limpio = simplify(`(${D.toString()})*(${prod})`) as unknown as Nodo;
  } catch { return null; }
  if (!contieneY(limpio) || denominadoresConY(limpio).length > 0) return null;
  const rhs = rhsCompleto(despejarAnidado(`${limpio.toString()} = 0`));
  if (rhs === null) return null;
  // Contra la ecuación de ANTES de multiplicar: es la que tiene los agujeros que la limpia perdió.
  const evalD = evaluadorDe(D);
  return evalD !== null && solucionValida(rhs, evalD)
    ? { ecuacion: `y = ${rhs}`, completo: true } : null;
}

// ─────────────────────────────────────────────
// Inversión estructural: la y AGRUPADA bajo una torre invertible (keystone)
// ─────────────────────────────────────────────
//
// Las estrategias de arriba cubren cada una UNA capa concreta alrededor de la y (yⁿ, ⁿ√y,
// T(y) desnuda, 1/y…). Cuando la y va envuelta en una COMPOSICIÓN —o en una función sin
// estrategia propia— ninguna encaja: `log(y)=x`, `e^{y}=x`, `sin(2y)=x`, `(y+1)³=x`, `e^{y³}=x`.
// Aquí se aísla pelando la composición de FUERA hacia dentro: en cada nodo, la inversa EXACTA de
// la operación externa pasa al otro lado y se recurre sobre el hijo que contiene la y.
//
// Lo que se pela es la capa ENTERA, así que la y no tiene por qué aparecer una sola vez: basta
// con que un solo hijo la contenga en cada nivel. Si la torre se ATASCA (la y se reparte entre
// las dos ramas, `ln((y−1)/(y+2)) = x`), lo pelado es una ecuación equivalente y más simple, y
// se re-despeja desde cero. Completo para cualquier torre de operaciones invertibles.
//
// FIDELIDAD AL DOMINIO: solo se aplican inversas EXACTAS. Las INYECTIVAS (log/exp, aˣ,
// hiperbólicas, raíz IMPAR) pasan sin más; donde la ecuación no tiene solución, la inversa da
// NaN/complejo (log de ≤0, atanh fuera de (−1,1)…) → sin rama fantasma, igual que la curva
// original. Las trig llevan su familia periódica (`fam`). Y las de RANGO RESTRINGIDO (√ e ⁿ√
// de índice PAR, potencia PAR, |·|) son exactas SOLO bajo la guarda `R≥0` que ya usan las
// estrategias específicas (`conDominio` → centinela `dom`), más el `±` de las dos ramas cuando
// la capa no es inyectiva: con esas dos piezas se pelan también aquí en vez de rendirse.
// Lo que NO tiene inversa exacta (arcos, y en dos posiciones, exponente no entero) sigue
// devolviendo null: la ecuación se queda como está antes que inventar una rama.

// ── Re-entrada controlada en el despejador ───────────────────────────────────
//
// Varias estrategias TRANSFORMAN la ecuación en otra equivalente y más simple (pelar una capa,
// quitar el denominador, elevar al cuadrado) y necesitan volver a empezar sobre la nueva. Cada
// transformación reduce la estructura, así que la recursión termina sola; el tope es una red de
// seguridad barata frente a una transformación que devolviera algo equivalente a su entrada.

const MAX_ANIDAMIENTO = 6;
let anidamiento = 0;

/** `despejar` re-entrante con tope de profundidad. null al pasarse (la ecuación se queda como
 *  esté en el nivel de arriba, que es la forma parcial de siempre). */
function despejarAnidado(ecuacion: string): { ecuacion: string; completo: boolean } | null {
  if (anidamiento >= MAX_ANIDAMIENTO) return null;
  anidamiento++;
  try { return despejar(ecuacion); } finally { anidamiento--; }
}


/** Inversa EXACTA (inyectiva) de una función unaria: dado el objetivo `t` al que iguala la
 *  función, el string al que iguala su argumento. Solo funciones cuya inversa es fiel al
 *  dominio y sobrevive el pipeline (registradas en productoImplicito.FUNCIONES). */
const INVERSA_INYECTIVA: Record<string, (t: string) => string> = {
  exp: (t) => `log(${t})`,               // e^u = t ⇒ u = ln t
  log: (t) => `e^(${t})`,                // ln u = t ⇒ u = e^t (se emite `e^…` → LaTeX `e^{…}`, no `\exp`)
  sinh: (t) => `asinh(${t})`,            // biyección en ℝ
  tanh: (t) => `atanh(${t})`,            // atanh NaN fuera de (−1,1) → sin fantasma
  asinh: (t) => `sinh(${t})`,
  atanh: (t) => `tanh(${t})`,
  cbrt: (t) => `(${t})^3`,               // ∛u = t ⇒ u = t³ (raíz impar, biyección en ℝ)
};

/** Trig periódicas: su inversa es la familia general (fam), fiel al dominio. */
const TRIG_PERIODICA = new Set<string>(["sin", "cos", "tan", "cot", "sec", "csc"]);

/** Nuevo objetivo tras pelar una capa de RANGO RESTRINGIDO: `cuerpo` es la inversa aplicada al
 *  objetivo actual y la guarda es el objetivo mismo (`√u = t ⇒ u = t², válido donde t ≥ 0`).
 *  Delega en `conDominio`, que además absorbe los dos casos degenerados: guarda trivialmente
 *  cierta (`t = x²`) → sin coletilla, y guarda constante negativa (`√u = −3`) → null, sin
 *  solución real, la ecuación se queda como está. */
const objetivoConGuarda = (cuerpo: string, target: string): string | null =>
  conDominio(cuerpo, target);

/** Qué hacer cuando el pelado se ATASCA: la capa externa ya no tiene inversa exacta, o la y se
 *  reparte entre las dos ramas del operador. Lo pelado hasta ahí es una ecuación EQUIVALENTE y
 *  más simple, así que se delega en el despejador completo (ver `despejePorInversion`). */
interface ContextoPelado {
  /** Resuelve `resto = target` y devuelve el RHS de `y = …`, o null si no lo completa. */
  alTope: (resto: Nodo, target: string) => string | null;
  /** Capas ya peladas. En el nivel 0 NO se llama a `alTope`: sería la ecuación de partida
   *  otra vez (recursión infinita). Solo con algo pelado el residuo es un problema nuevo. */
  nivel: number;
}

/** Aísla la y de `nodo` igualándola a `target` (string mathjs), pelando la composición externa
 *  con inversas fieles al dominio. Devuelve el RHS de `y = …` o null si topa con una capa sin
 *  inversa exacta (y `ctx` no rescata el residuo). */
function aislarInversion(nodo: Nodo, target: string, ctx?: ContextoPelado): string | null {
  const n = desParen(nodo);
  const pelado = pelarCapa(n, target, ctx);
  if (pelado !== null) return pelado;
  return ctx && ctx.nivel > 0 && contieneY(n) ? ctx.alTope(n, target) : null;
}

/** Una capa del pelado de `aislarInversion` (misma semántica; null = capa no invertible). */
function pelarCapa(n: Nodo, target: string, ctx?: ContextoPelado): string | null {
  const dentro = ctx && { alTope: ctx.alTope, nivel: ctx.nivel + 1 };
  const aislar = (hijo: Nodo, t: string): string | null => aislarInversion(hijo, t, dentro);
  if (n.type === "SymbolNode" && n.name === "y") return target;

  if (n.type === "OperatorNode") {
    if (n.args.length === 1 && n.op === "-") return aislar(n.args[0], `-(${target})`);
    if (n.args.length === 2) {
      const [a, b] = n.args;
      const enA = contieneY(a), enB = contieneY(b);
      if (enA === enB) return null; // 0 o 2 apariciones en este nivel: no aplicable
      const sa = a.toString(), sb = b.toString();
      switch (n.op) {
        case "+": return enA ? aislar(a, `(${target}) - (${sb})`) : aislar(b, `(${target}) - (${sa})`);
        case "-": return enA ? aislar(a, `(${target}) + (${sb})`) : aislar(b, `(${sa}) - (${target})`);
        case "*": return enA ? aislar(a, `(${target}) / (${sb})`) : aislar(b, `(${target}) / (${sa})`);
        case "/": return enA ? aislar(a, `(${target}) * (${sb})`) : aislar(b, `(${sa}) / (${target})`);
        case "^": {
          if (enA) {
            const k = exponenteEntero(b);
            if (k === null || k < 1) return null; // exponente no entero (o ≤0) → sin inversa exacta aquí
            if (k % 2 === 0) {
              // uᵏ = t con k PAR ⇒ u = ±ᵏ√t donde t ≥ 0 (`e^{y²}=x` ⇒ y = ±√(ln x), ln x ≥ 0).
              const pm = ramaDoble(k === 2 ? `sqrt(${target})` : `nthRoot(${target}, ${k})`, target);
              const conG = pm === null ? null : objetivoConGuarda(pm, target);
              return conG === null ? null : aislar(a, conG);
            }
            const raiz = k === 1 ? target : k === 3 ? `cbrt(${target})` : `nthRoot(${target}, ${k})`;
            return aislar(a, raiz);
          }
          // y en el EXPONENTE (base libre de y): a^y = t ⇒ y = ln t / ln a (e^y ⇒ y = ln t).
          const div = sa === "e" ? `log(${target})` : `log(${target}) / log(${sa})`;
          return aislar(b, div);
        }
        default: return null;
      }
    }
    return null;
  }

  if (n.type === "FunctionNode") {
    const fn = n.fn?.name ?? "";
    if (n.args.length === 1) {
      if (INVERSA_INYECTIVA[fn]) return aislar(n.args[0], INVERSA_INYECTIVA[fn](target));
      if (TRIG_PERIODICA.has(fn)) {
        // cos/sec/sin/csc emiten su propio `pm` (las dos raíces del período); tan/cot no.
        // `inversionTrig` ya aplica el presupuesto de ramas y devuelve null si no cabe.
        const inv = inversionTrig(fn as TrigInvertible, target);
        return inv === null ? null : aislar(n.args[0], inv);
      }
      // √u = t ⇒ u = t² donde t ≥ 0 (`√(tan y+1)=x` ⇒ y = arctan(x²−1)+kπ, x ≥ 0).
      if (fn === "sqrt") {
        const conG = objetivoConGuarda(`(${target})^2`, target);
        return conG === null ? null : aislar(n.args[0], conG);
      }
      // |u| = t ⇒ u = ±t donde t ≥ 0.
      if (fn === "abs") {
        const pm = ramaDoble(target, target);
        const conG = pm === null ? null : objetivoConGuarda(pm, target);
        return conG === null ? null : aislar(n.args[0], conG);
      }
      return null; // acos/asin/… (rango restringido de dos lados, no expresable con `dom`)
    }
    if (fn === "nthRoot" && n.args.length === 2) {
      const k = exponenteEntero(n.args[1]);
      if (k === null || k < 2) return null;
      // Índice PAR: ⁿ√u = t ⇒ u = tⁿ donde t ≥ 0 (la raíz par nunca es negativa). Impar: directo.
      if (k % 2 === 0) {
        const conG = objetivoConGuarda(`(${target})^${k}`, target);
        return conG === null ? null : aislar(n.args[0], conG);
      }
      return aislar(n.args[0], `(${target})^${k}`);
    }
  }
  return null;
}

/** RHS de un despeje COMPLETO (`y = …`) devuelto por la recursión, o null si no completó. */
function rhsCompleto(r: { ecuacion: string; completo: boolean } | null): string | null {
  if (!r || !r.completo) return null;
  const m = r.ecuacion.match(/^y\s*=\s*([\s\S]+)$/);
  return m ? m[1] : null;
}

/** Despeje por inversión estructural: toda la y de la ecuación está a UN lado, y ese lado es una
 *  torre de capas invertibles. No hace falta que la y aparezca una sola vez: lo que se pela es la
 *  capa ENTERA, así que basta con que un solo hijo la contenga en cada nivel. Cuando la torre se
 *  atasca —la y se reparte entre las dos ramas (`(y−1)/(y+2)`) o la capa no tiene inversa— lo
 *  pelado ya es una ecuación EQUIVALENTE y más simple, y se re-despeja: `ln((y−1)/(y+2)) = x`
 *  pela el logaritmo y delega `(y−1)/(y+2) = eˣ`, que se resuelve quitando el denominador.
 *  Completo siempre (o null: nunca devuelve una forma a medias). */
function despejePorInversion(L: Nodo, R: Nodo): { ecuacion: string; completo: boolean } | null {
  const enL = contieneY(L), enR = contieneY(R);
  if (enL === enR) return null; // y en los DOS lados (o en ninguno): no es una torre
  const conY = enL ? L : R;
  const otro = enL ? R : L;
  const rhs = aislarInversion(conY, `(${otro.toString()})`, {
    nivel: 0,
    alTope: (resto, target) => rhsCompleto(despejarAnidado(`${resto.toString()} = ${target}`)),
  });
  return rhs === null ? null : { ecuacion: `y = ${rhs}`, completo: true };
}

/** Núcleo: despeja y como ECUACIÓN en sintaxis mathjs, o null si no hay `=`, no aparece
 *  y, o no se puede parsear. `completo`=true si quedó `y = …`. */
function despejar(ecuacion: string): { ecuacion: string; completo: boolean } | null {
  // Componente paramétrica (`y(t)=…`): su `y` es el NOMBRE de la componente, no la incógnita.
  // Sin esta guarda, `y(t)=5\sin t` se leía como el producto `y·t` y el despeje entregaba una
  // ecuación inventada (`y = (5 sin t)/t`) sobre una curva que no es esa.
  if (componenteParametrica(ecuacion)) return null;
  let partes = ecuacion.split("=");
  const norm = (s: string) => insertarProductoImplicito(normalizarEntrada(s.trim()));
  // Expresión SUELTA con y libre ≡ expr = 0 (la MISMA convención con que construirObjeto
  // la grafica): también se despeja (`tan(y)(x²+1)-√(x+1)` → `tan(y)=√(x+1)/(x²+1)`).
  if (partes.length === 1 && contieneYLibre(norm(partes[0]))) partes = [partes[0], "0"];
  if (partes.length !== 2) return null;
  let D: Nodo;
  let L: Nodo, R: Nodo;
  try {
    L = parse(norm(partes[0])) as unknown as Nodo;
    R = parse(norm(partes[1])) as unknown as Nodo;
    D = parse(`(${norm(partes[0])})-(${norm(partes[1])})`) as unknown as Nodo;
  } catch { return null; }
  if (!contieneY(D)) return null;

  // RAÍZ IMPAR: `(x²+y²−1)³ = x²y³` ⇒ `x²+y²−1 = ∛(x²)·y`. Una potencia impar es invertible en
  // todo ℝ, así que la ecuación reducida es EQUIVALENTE (misma curva) pero con y en grado 2 →
  // pasa a ser despejable. Se conserva la original (`DVal`) para validar el resultado.
  const DVal = D;
  D = reducirRaizImpar(L, R) ?? reducirRaizImparPorTerminos(D) ?? D;

  const ts = terminos(D);
  const conY = ts.filter((t) => contieneY(t.nodo));
  const sinY = ts.filter((t) => !contieneY(t.nodo));
  if (conY.length === 0) return null;
  const derecha = flip(sinY); // los términos sin y pasan al otro lado con signo cambiado

  if (conY.length === 1) {
    const lin = linealEnY(conY[0]);
    if (lin) {
      const numerador = lin.signo === 1 ? derecha : flip(derecha); // y = derecha / coef
      // Coeficiente 1 (sin factores libres): forma CANÓNICA directa (`y = -2x + 6`, no
      // `6 - 2x`), sin pasar por la limpieza (que distribuiría/expandiría sin necesidad).
      if (lin.libres.length === 0)
        return { ecuacion: `y = ${renderCanonico(numerador)}`, completo: true };
      // Coeficiente ≠ 1 (incl. fraccionario `y/2`): y = numerador / (producto de libres).
      // El signo va en el numerador; `limpiarRHS` reduce, ordena e invierte el ÷fracción
      // (`y/2=x`→`y=2x`, no `y=x·2`). renderProducto arma bien num/den de los libres.
      const rhs = `(${renderCanonico(numerador)}) / (${renderProducto(lin.libres)})`;
      return { ecuacion: `y = ${limpiarRHS(rhs)}`, completo: true };
    }
    // (libres)·yⁿ → dividir libres y sacar la raíz n-ésima (impar) o dejar yⁿ = … (par).
    const pot = despejePotencia(conY[0], derecha);
    if (pot) return pot;
    // (libres)·ⁿ√y → dividir libres y ELEVAR a la n (inverso de la raíz). Antes que el
    // multiplicativo, que dejaría `√y = …` incompleto en vez de aislar y.
    const raiz = despejeRaiz(conY[0], derecha);
    if (raiz) return raiz;
    // (libres)·ⁿ√(y^m) → elevar a n y sacar la raíz m-ésima. El astroide `∛(y²)=1−∛(x²)`
    // → `y = ±√((1−∛(x²))³)`. Antes que el multiplicativo (que dejaría `∛(y²)=…` incompleto).
    const raizPot = despejeRaizDePotencia(conY[0], derecha);
    if (raizPot) return raizPot;
    // (libres)·abs(y)^e → aislar |y| y sacar las dos ramas (`y = ±…`). Antes que el
    // multiplicativo, que dejaría `1/|y| = …` incompleto en vez de aislar y.
    const abs = despejeAbsoluto(conY[0], derecha);
    if (abs) return abs;
    // (libres)·T(y) trig periódica → solución GENERAL y = T⁻¹(…) + k·período (familia
    // infinita, centinela `fam`; despejeInverso.ts). Antes que el multiplicativo, que
    // dejaría `tan(y) = …` incompleto en vez de aislar y.
    const trig = despejeTrigInverso(conY[0], derecha);
    if (trig) return trig;
    // `T(u) = 0` con u COMPUESTA (y anidada) → invierte a `u = base + kπ` y recurre.
    const trigCero = despejeTrigCero(conY[0], derecha);
    if (trigCero) return trigCero;
    // (libres)·E⁻¹ con y en el DENOMINADOR → invierte el recíproco y recurre para aislar y.
    // Antes que el multiplicativo, que dejaría `1/E = …` (o su forma cruda) sin aislar y.
    const recip = despejeReciproco(conY[0], derecha);
    if (recip) return recip;
    // Otros factores libres de y en un producto → se dividen al otro lado.
    const mult = despejeMultiplicativo(conY[0], derecha);
    if (mult) {
      // Si la y quedó ATRAPADA en el numerador de una fracción (la simplificación
      // reúne `x²+…−3x⁻²` en `(x⁴+3x³+x²y²−3)/x²`), `despejeMultiplicativo` solo despeja
      // el denominador y deja un resultado PARCIAL, aunque la ecuación sea perfectamente
      // aislable. Pero el string que produce YA es polinómico (sin fracción): al
      // re-despejarlo, `y²` es un término propio y sale `y = ±√(…)`. La recursión es de
      // un solo nivel (el clearing quita el denominador → no vuelve a esta rama) y solo
      // se acepta si COMPLETA; si no, se conserva el parcial de siempre.
      const limpio = despejar(mult);
      if (limpio && limpio.completo) return limpio;
      return { ecuacion: mult, completo: false };
    }
  }

  // DENOMINADORES con y: se multiplica por ellos y se re-despeja la ecuación ya polinómica
  // (`(y−1)/(y+2) = x` → `y − 1 − x(y+2) = 0` → lineal repartida). Va antes que la cuadrática,
  // que necesita los términos-y en el numerador para leer sus potencias.
  const sinDen = despejeSinDenominadores(D);
  if (sinDen) return sinDen;

  // Varios términos-y: ¿es CUADRÁTICA en y^g (bicuadrática/cuadrática)? → fórmula reducida.
  // `(x²+y²)²−2(x²−y²)=0` → `y=±√(−(x²+1)+√(4x²+1))`. Validada numéricamente contra la original.
  const cuad = despejeCuadratico(D, DVal);
  if (cuad) return cuad;

  // AFÍN en y con coeficiente no polinómico (`y − (y+2)eˣ − 1 = 0`): A y B por evaluación.
  // Tras la cuadrática, que ya cubre —con mejor tipografía— todo lo polinómico.
  const linEval = despejeLinealEnY(D);
  if (linEval) return linEval;

  // ¿CUADRÁTICA EN cos(y) tras expandir la trig de argumentos compuestos (cos(x±y),
  // cos(2y)…)? → fórmula general en u=cos y e inversión y = ±arccos(u) + 2kπ (familia).
  // También validada contra la original. Tabla y pipeline en despejeInverso.ts.
  const trigCuad = despejeTrigCuadratico(D, DVal);
  if (trigCuad) return trigCuad;

  // INVERSIÓN estructural (keystone): la y aparece UNA sola vez pero anidada o en una función
  // sin estrategia propia (log, e^y, sin(2y), (y+1)³…). Se pela la composición con inversas
  // fieles al dominio. Va al final: solo cuando ninguna estrategia específica la aisló.
  const inv = despejePorInversion(L, R);
  if (inv) return inv;

  // RADICALES repartidos (`√(y+1)+√(y−2)=x`, `√(y+1)+y=x`): elevaciones sucesivas al cuadrado
  // con la guarda de dominio de cada paso. La última de la lista: es la única que introduce
  // condiciones, así que solo se recurre a ella cuando ninguna vía exacta ha servido.
  const rad = despejeRadicales(D, DVal);
  if (rad) return rad;

  // No lineal irreducible o varios términos-y: forma aislada (RHS en orden canónico).
  return { ecuacion: `${renderTerminos(conY)} = ${renderCanonico(derecha)}`, completo: false };
}

/** Despeja y en cada ecuación de un bloque; las que no se pueden se dejan igual.
 *  Devuelve strings re-parseables (para encadenar/comparar transformaciones). */
export function despejarEcuaciones(ecuaciones: readonly string[]): string[] {
  return ecuaciones.map((ec) => despejar(ec)?.ecuacion ?? ec);
}

/** LaTeX del bloque con la y despejada (deriva del string por el pipeline del panel). */
export function despejarBloqueLatex(ecuaciones: readonly string[]): string {
  return bloqueALatex(despejarEcuaciones(ecuaciones));
}

/** Despeje de UNA ecuación en LaTeX (+ si quedó completo). null si no aplica. */
export function despejarY(ecuacion: string): { latex: string; completo: boolean } | null {
  const r = despejar(ecuacion);
  return r ? { latex: bloqueALatex([r.ecuacion]), completo: r.completo } : null;
}

/** Si la ecuación implícita se despeja a una función y = f(x) de UN SOLO VALOR, devuelve `f(x)`
 *  como string mathjs re-parseable; si no, null. Sirve para GRAFICAR la curva por el muestreo
 *  explícito (traza la cola completa hasta el borde) en vez de la continuación implícita (que la
 *  corta en ~2× la vista). Se RECHAZAN las multivaluadas: el ± del doble signo (`pm`/`mp`) y la
 *  familia periódica (`fam`/`famN`) dan varios y por x —no son una función—. La guarda de
 *  dominio `dom` SÍ se admite: es de un solo valor y `crearFuncionReal` la evalúa a NaN fuera del
 *  dominio (media parábola de `x−√y=c`, no la rama fantasma). El RHS debe ser función de x pura
 *  (sin y residual). */
export function despejeExplicito(ecuacion: string): string | null {
  const r = despejar(ecuacion);
  if (!r || !r.completo) return null;
  const m = r.ecuacion.match(/^y\s*=\s*([\s\S]+)$/);
  if (!m) return null;
  const rhs = m[1];
  if (/(?<![a-zA-Z0-9_])(pm|mp|fam|famN)\s*\(/.test(rhs)) return null;   // multivaluada → no es y=f(x)
  if (/(?<![a-zA-Z0-9_])y(?![a-zA-Z0-9_])/.test(rhs)) return null;        // y sin aislar del todo
  return rhs;
}
