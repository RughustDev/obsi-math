import { parse, simplify } from "mathjs";

import { normalizarEntrada, contieneYLibre } from "./parser";
import { insertarProductoImplicito } from "./motor/parsing/productoImplicito";
import { componenteParametrica } from "./motor/parsing/componentesParametricas";
import { bloqueALatex } from "./latex";
import { simplificarExpr } from "./simplificar";
import {
  contieneVariable, terminos, factores, flip, renderTerminos, renderCanonico,
  racionalizarFracciones, formatearCanonico, combinarFracciones, valorConstanteFactor,
  profundidadFraccion,
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
  return { ecuacion: `y = pm(${raiz})`, completo: true };
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
  return { ecuacion: `y = (${ladoDerecho(t, derecha, libres, renderCanonico)})^${n}`, completo: true };
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

/** Único término-y de la forma (libres)·abs(y)^e: exponente EFECTIVO `e` de abs(y) (entero,
 *  incl. negativo si va en el denominador —`1/|y|` es abs(y)^(-1)— o por una potencia
 *  explícita `|y|^{k}`) y los factores libres de y. null si el factor con y no es abs(y)
 *  puro. Unifica las dos formas con que puede llegar `1/|y|`: cruda `abs(y)^(-1)` (un solo
 *  factor con potencia) o ya simplificada `1/abs(y)` (factor en denominador, `exp=-1`). */
function absYExponente(t: Termino): { e: number; libres: Factor[] } | null {
  const fs = factores(t.nodo);
  const conYf = fs.filter((f) => contieneY(f.nodo));
  const libres = fs.filter((f) => !contieneY(f.nodo));
  if (conYf.length !== 1) return null;
  let e: number = conYf[0].exp;                 // ±1 según numerador/denominador
  let nucleo = desParen(conYf[0].nodo);
  // Potencia entera explícita `abs(y)^k` (la que `factores` no separa): acumula el k.
  if (nucleo.type === "OperatorNode" && nucleo.op === "^" && nucleo.args.length === 2) {
    const k = exponenteEntero(nucleo.args[1]);
    if (k === null || k === 0) return null;
    e *= k;
    nucleo = desParen(nucleo.args[0]);
  }
  return esAbsDeY(nucleo) ? { e, libres } : null;
}

/** Aplana la expresión de |y| a una sola fracción legible (`1/(1−1/|x|)` → `|x|/(|x|−1)`):
 *  combina fracciones anidadas y recupera fracciones exactas. Sin la guarda de dominio de
 *  Simplificar (que rechazaría la cancelación por diferir en x=0): aquí el ± ya cambia el
 *  dominio a propósito. String mathjs re-parseable. */
function limpiarAbsoluto(s: string): string {
  try { return formatearCanonico(racionalizarFracciones(combinarFracciones(parse(s)))); }
  catch { return s; }
}

/** Único término-y de la forma (libres)·abs(y)^e (e entero): aísla |y| y saca las DOS ramas
 *  del absoluto. `1/|x|+1/|y|=1` → `|y| = |x|/(|x|−1)` → `y = ±|x|/(|x|−1)`. Se pasan los
 *  libres al otro lado (`abs(y)^e = R`), se invierte el exponente (`|y| = R^{1/e}`) y se
 *  emite `y = ±(…)` con el centinela `pm`. Como el despeje de raíz, añade formalmente la
 *  rama del signo opuesto (licencia de "álgebra de manual"); deja y aislada → completo.
 *  null si la parte con y no es un abs(y) puro. */
function despejeAbsoluto(t: Termino, derecha: Termino[]): { ecuacion: string; completo: boolean } | null {
  const info = absYExponente(t);
  if (!info) return null;
  const { e, libres } = info;
  // abs(y)^e = R (los factores libres pasan dividiendo/multiplicando al otro lado).
  const R = ladoDerecho(t, derecha, libres);
  // Invertir el exponente para aislar |y| = R^{1/e}. e=±1 son los casos comunes (1/|y|);
  // |e|≥2 introduce una raíz e-ésima. n=2 usa `sqrt` (→ `\sqrt`, sin índice) y n≥3
  // `nthRoot` (→ `\sqrt[n]`), la MISMA convención que `despejePotencia`.
  const raizDe = (r: string, n: number) => (n === 2 ? `sqrt(${r})` : `nthRoot((${r}), ${n})`);
  const aby =
    e === 1 ? R :
    e === -1 ? `1/(${R})` :
    e > 0 ? raizDe(R, e) :
    `1/(${raizDe(R, -e)})`;
  return { ecuacion: `y = pm(${limpiarAbsoluto(aby)})`, completo: true };
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
  try { return contieneX(parse(s)) ? s : simpDesp(s); } catch { return s; }
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
      const D = simplify(parse(`(${base.toString()}) - (${raiz})`));
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
    try { R = parse(renderTerminos(otroLado)); } catch { continue; }
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
      return parse(`nthRoot((${base.args[0].toString()})^(${k}), ${idx})`);
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
  try { const c = DVal.compile(); evalD = (x, y) => { try { return c.evaluate({ x, y }) as number; } catch { return NaN; } }; }
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
    const b2 = plegarRaicesImpares(parse(simpDesp(`(${B})^2`))).toString();
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
      .map((s) => ({ s, prof: profundidadFraccion(parse(s)), len: s.length }))
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
    L = parse(norm(partes[0]));
    R = parse(norm(partes[1]));
    D = parse(`(${norm(partes[0])})-(${norm(partes[1])})`);
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
    // (libres)·abs(y)^e → aislar |y| y sacar las dos ramas (`y = ±…`). Antes que el
    // multiplicativo, que dejaría `1/|y| = …` incompleto en vez de aislar y.
    const abs = despejeAbsoluto(conY[0], derecha);
    if (abs) return abs;
    // Otros factores libres de y en un producto → se dividen al otro lado.
    const mult = despejeMultiplicativo(conY[0], derecha);
    if (mult) return { ecuacion: mult, completo: false };
  }

  // Varios términos-y: ¿es CUADRÁTICA en y^g (bicuadrática/cuadrática)? → fórmula reducida.
  // `(x²+y²)²−2(x²−y²)=0` → `y=±√(−(x²+1)+√(4x²+1))`. Validada numéricamente contra la original.
  const cuad = despejeCuadratico(D, DVal);
  if (cuad) return cuad;

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
