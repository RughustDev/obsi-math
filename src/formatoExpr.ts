import { parse, fraction, rationalize, OperatorNode } from "mathjs";

// ─────────────────────────────────────────────
// Formato algebraico compartido (términos con signo)
// ─────────────────────────────────────────────
//
// Utilidades comunes a `despejar` y `simplificar`: aplanar los términos aditivos de
// una expresión con su signo y volverlos a serializar. Dos convenciones de orden:
//   • `renderTerminos` — POSITIVOS PRIMERO (`2 - x`, nunca `-x + 2`). Para expresiones
//     dentro de raíces/funciones y donde importa no arrancar con signo negativo.
//   • `renderCanonico` — VARIABLES ANTES QUE CONSTANTES en lo polinómico (`-2x + 6`,
//     `-x + 8`, forma `mx+b`), pero cae a "positivos primero" si hay una función
//     transcendental (sin/tan/√…) para conservar `2 - tan(x)` (evita el doble signo).
// Ambas son IDEMPOTENTES en formato → permiten detectar de forma fiable "no cambia nada"
// y que Simplificar tras Despejar (que comparten `renderCanonico`) sea un no-op.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Nodo = any;
export interface Termino { signo: 1 | -1; nodo: Nodo }
/** Factor de un producto; `exp` = +1 numerador, −1 denominador. */
export interface Factor { exp: 1 | -1; nodo: Nodo }

/** ¿El subárbol referencia el símbolo `nombre`? */
export function contieneVariable(n: Nodo, nombre: string): boolean {
  return n.filter((nn: Nodo) => nn.type === "SymbolNode" && nn.name === nombre).length > 0;
}

// ─────────────────────────────────────────────
// Cuarentena de `rationalize` (guarda de expansión)
// ─────────────────────────────────────────────
//
// `rationalize` (mathjs) es la ÚNICA operación del proyecto capaz de colgar el hilo
// principal de Obsidian: expande la potencia de forma NAIVE (sin combinar semejantes
// durante el proceso) y luego pasa el árbol resultante por el motor de reglas de
// `simplify`, que es superexponencial en el tamaño de ese árbol. El coste no depende
// del texto de entrada sino del nº de MONOMIOS que produce la expansión:
//
//     (x+y)^3        →  2³ =  8 monomios  →   0.06 s
//     (x+y+1)^2      →  3² =  9           →   0.07 s
//     (x+y)^4        →  2⁴ = 16           →   1.4  s
//     (x+y+1)^3      →  3³ = 27           →  12    s
//     (x²+y²−1)³     →  3³ = 27           →  NUNCA TERMINA
//     (x+1)^12       →  2¹² = 4096        →  NUNCA TERMINA
//
// El corte es abrupto entre 16 y 27, así que se rechaza todo lo que pase de
// `LIMITE_EXPANSION`. `simplify` a secas NO tiene el problema (no expande potencias):
// es el fallback seguro de los llamadores. La guarda es DETERMINISTA (no un timeout):
// la misma entrada da siempre el mismo resultado → caché y pruebas estables.

/** Máximo de monomios que se admite expandir. Ver la tabla de arriba: 16 es el último
 *  valor con coste tolerable (~1 s); 27 ya es inviable. */
export const LIMITE_EXPANSION = 16;

/**
 * Nº de MONOMIOS que produciría la expansión naive del árbol (la magnitud que gobierna
 * el coste de `rationalize`). Suma en `+`/`−`, PRODUCTO en `*`/`/`, POTENCIA en `^` con
 * exponente entero. Las funciones (sin, √…) valen 1: hacen que `rationalize` aborte de
 * inmediato por no polinómica, así que no inflan nada. No itera sobre el exponente
 * (`Math.pow`) → un exponente absurdo devuelve `Infinity` en O(1), nunca cuelga.
 */
export function costeExpansion(n: Nodo): number {
  if (!n || typeof n !== "object") return 1;
  if (n.type === "ParenthesisNode") return costeExpansion(n.content);
  if (n.type === "OperatorNode") {
    const args = (n.args ?? []) as Nodo[];
    if (args.length === 1) return costeExpansion(args[0]);          // menos unario
    const a = costeExpansion(args[0]), b = costeExpansion(args[1]);
    if (n.op === "+" || n.op === "-") return a + b;
    if (n.op === "*") return a * b;
    if (n.op === "/") return a * b;                                  // común denominador
    if (n.op === "^") {
      const k = valorConstanteFactor(args[1]);
      // Exponente NO entero (x^{2/3}) → no es polinómica: `rationalize` aborta sin
      // expandir. Se devuelve el coste de la base para no bloquearla por nada.
      if (k === null || !Number.isInteger(k)) return a;
      return Math.pow(a, Math.abs(k));
    }
    return a + b;
  }
  return 1; // símbolo, constante, función (átomo para la expansión)
}

/**
 * `rationalize` con la guarda de expansión: null si la expresión desbordaría el
 * presupuesto (o si mathjs la rechaza por no polinómica). Es el ÚNICO punto por el que
 * el proyecto llama a `rationalize` → una expresión no puede colgar Obsidian.
 */
export function rationalizeSeguro(expr: Nodo | string): Nodo | null {
  let nodo: Nodo;
  try { nodo = typeof expr === "string" ? parse(expr) : expr; } catch { return null; }
  if (costeExpansion(nodo) > LIMITE_EXPANSION) return null;
  try { return rationalize(nodo); } catch { return null; }
}

/** ¿El término es constante (sin ningún símbolo/variable)? Un literal numérico. */
function esConstante(n: Nodo): boolean {
  return n.filter((nn: Nodo) => nn.type === "SymbolNode").length === 0;
}

/** ¿El subárbol contiene alguna FUNCIÓN (sin, cos, tan, sqrt, nthRoot…)? Marca los
 *  términos NO polinómicos, para los que no se aplica el orden canónico. */
function contieneFuncion(n: Nodo): boolean {
  return n.filter((nn: Nodo) => nn.type === "FunctionNode").length > 0;
}

/** Aplana los términos aditivos de nivel superior con su signo (atraviesa paréntesis,
 *  sumas, restas y el menos unario; pliega constantes negativas). */
export function terminos(n: Nodo, signo: 1 | -1 = 1): Termino[] {
  if (n.type === "ParenthesisNode") return terminos(n.content, signo);
  if (n.type === "OperatorNode") {
    if (n.op === "+" && n.args.length === 2)
      return [...terminos(n.args[0], signo), ...terminos(n.args[1], signo)];
    if (n.op === "-" && n.args.length === 2)
      return [...terminos(n.args[0], signo), ...terminos(n.args[1], (-signo) as 1 | -1)];
    if (n.op === "-" && n.args.length === 1)
      return terminos(n.args[0], (-signo) as 1 | -1);
  }
  if (n.type === "ConstantNode" && typeof n.value === "number" && n.value < 0)
    return [{ signo: (-signo) as 1 | -1, nodo: parse(String(-n.value)) }];
  return [{ signo, nodo: n }];
}

/** Aplana los factores multiplicativos de nivel superior con su exponente ±1
 *  (atraviesa paréntesis, productos y divisiones). `x·(y/z)` → [x⁺, y⁺, z⁻]. */
export function factores(n: Nodo, exp: 1 | -1 = 1): Factor[] {
  if (n.type === "ParenthesisNode") return factores(n.content, exp);
  if (n.type === "OperatorNode" && n.args.length === 2) {
    if (n.op === "*") return [...factores(n.args[0], exp), ...factores(n.args[1], exp)];
    if (n.op === "/") return [...factores(n.args[0], exp), ...factores(n.args[1], (-exp) as 1 | -1)];
  }
  return [{ exp, nodo: n }];
}

/** Valor numérico de un factor SIN símbolos, o null si no lo es. Reconoce la constante
 *  literal (`ConstantNode`) PERO TAMBIÉN el menos UNARIO que mathjs deja como coeficiente
 *  negativo dentro de un producto: al distribuir `-pi*(2x+4)` emite `pi * -2 * x`, donde el
 *  `-2` es un `OperatorNode` unario, no un `ConstantNode`. Sin desenvolverlo, ese `-2` se
 *  tomaba por factor SIMBÓLICO → el reordenamiento no juntaba el coeficiente y mathjs pintaba
 *  `\pi\cdot-2\cdot x`, que `limpiarTex` colapsaba a `\pi-2x` (bug: `f(x)=\pi-2x-4\pi`). */
export function valorConstanteFactor(nodo: Nodo): number | null {
  if (nodo.type === "ConstantNode" && typeof nodo.value === "number") return nodo.value;
  if (nodo.type === "ParenthesisNode") return valorConstanteFactor(nodo.content);
  if (nodo.type === "OperatorNode" && nodo.op === "-" && nodo.args.length === 1) {
    const v = valorConstanteFactor(nodo.args[0]);
    return v === null ? null : -v;
  }
  return null;
}

/** Invierte el signo de cada término. */
export const flip = (ts: Termino[]): Termino[] =>
  ts.map((t) => ({ signo: (-t.signo) as 1 | -1, nodo: t.nodo }));

/** Serializa una lista YA ORDENADA de términos a STRING mathjs (signo del 1º al frente,
 *  luego ` + ` / ` - `). */
function serializar(orden: Termino[]): string {
  let out = "";
  orden.forEach((t, i) => {
    const s = t.nodo.toString();
    if (i === 0) out = t.signo === 1 ? s : `-${s}`;
    else out += t.signo === 1 ? ` + ${s}` : ` - ${s}`;
  });
  return out;
}

/** Descarta los términos 0. */
const sinCeros = (ts: Termino[]): Termino[] =>
  ts.filter((t) => !(t.nodo.type === "ConstantNode" && t.nodo.value === 0));

/** Serializa términos con signo, POSITIVOS primero (no empieza con un signo negativo
 *  salvo que no haya positivos). Descarta los términos 0. */
export function renderTerminos(ts: Termino[]): string {
  const nz = sinCeros(ts);
  if (nz.length === 0) return "0";
  return serializar([...nz.filter((t) => t.signo === 1), ...nz.filter((t) => t.signo === -1)]);
}

/** Serializa términos con orden CANÓNICO: en lo polinómico, las variables antes que las
 *  constantes (`-2x + 6`, `-x + 8`), con el signo tal cual (admite negativo al frente).
 *  Si hay algún término con función transcendental cae a "positivos primero" (`2 - tan(x)`,
 *  para no dejar el doble signo). Descarta los términos 0. */
export function renderCanonico(ts: Termino[]): string {
  const nz = sinCeros(ts);
  if (nz.length === 0) return "0";
  if (nz.some((t) => contieneFuncion(t.nodo))) return renderTerminos(nz);
  return serializar([...nz.filter((t) => !esConstante(t.nodo)), ...nz.filter((t) => esConstante(t.nodo))]);
}

/** Aplana una CADENA de productos (solo `*`; la división y los paréntesis son átomos). */
function cadenaProducto(n: Nodo, out: Nodo[] = []): Nodo[] {
  if (n.type === "OperatorNode" && n.op === "*" && n.args.length === 2) {
    cadenaProducto(n.args[0], out); cadenaProducto(n.args[1], out);
  } else out.push(n);
  return out;
}

/**
 * Pone el COEFICIENTE NUMÉRICO al frente de cada producto del árbol, a cualquier profundidad
 * (incluido el interior de una función, donde `combinarYordenar` no entra por ser no polinómica).
 * `simplify` de mathjs deja el número DETRÁS del símbolo al racionalizar un decimal
 * (`sin(3.5·θ)` → `sin(θ·7/2)`), y su LaTeX sale como `\frac{\theta7}{2}`: número pegado tras la
 * letra, ilegible y matemáticamente confuso. Con el coeficiente delante → `\frac{7\theta}{2}`.
 * Estable (no altera el orden relativo de los factores simbólicos) y devuelve el nodo INTACTO
 * si ya está en orden → el resto del proyecto queda byte-idéntico.
 */
export function coeficientesAlFrente(n: Nodo): Nodo {
  const rec = (m: Nodo): Nodo => {
    const t = m.map(rec);
    if (!(t.type === "OperatorNode" && t.op === "*" && t.args.length === 2)) return t;
    const fs = cadenaProducto(t);
    const nums = fs.filter((f) => valorConstanteFactor(f) !== null);
    const resto = fs.filter((f) => valorConstanteFactor(f) === null);
    if (nums.length === 0 || nums.length === fs.length) return t;
    // Coeficiente de magnitud 1 → NO se emite como factor: `simplify` deja `pi*(-1)/6`
    // dentro de una función y sacarlo al frente daba el literal `-1*pi/6` (LaTeX
    // `\frac{-1\pi}{6}`, que se lee "menos uno por π"). Se colapsa al signo: `-pi/6`.
    const val = nums.reduce((a, f) => a * (valorConstanteFactor(f) as number), 1);
    if (Math.abs(val) === 1) {
      const cuerpo = resto.reduce((a, b) => new OperatorNode("*", "multiply", [a, b]));
      return val === 1 ? cuerpo : new OperatorNode("-", "unaryMinus", [cuerpo]);
    }
    const orden = [...nums, ...resto];
    if (orden.every((f, i) => f === fs[i])) return t;          // ya estaban delante
    return orden.reduce((a, b) => new OperatorNode("*", "multiply", [a, b]));
  };
  return rec(n);
}

/** Reordena los términos aditivos de nivel superior de un nodo a "positivos primero"
 *  y lo devuelve como string mathjs (no expande ni combina más de lo que ya está). */
export function formatearPositivosPrimero(n: Nodo): string {
  return renderTerminos(terminos(coeficientesAlFrente(n)));
}

/** Igual que `formatearPositivosPrimero` pero con orden CANÓNICO (variables antes que
 *  constantes en lo polinómico). Lo usa Simplificar para coincidir con Despejar. */
export function formatearCanonico(n: Nodo): string {
  return renderCanonico(terminos(coeficientesAlFrente(n)));
}

// ─────────────────────────────────────────────
// Recuperación de fracciones exactas
// ─────────────────────────────────────────────
//
// `rationalize` (mathjs) expande y reduce, pero SERIALIZA los coeficientes racionales
// como decimales de punto flotante: `x/2`→`0.5·x`, `x/3`→`0.333…·x`, `x²/4`→`0.25·x²`.
// Eso rompe la tipografía deseada (fracción, no decimal periódico). Aquí se recupera la
// fracción exacta de cada coeficiente decimal y se reescribe el término como
// `numerador/denominador` (`x/2`, `5·x/6`, `x²/4`), que el pipeline pinta con `\frac`.

/** String de un factor SEGURO dentro de un producto: si el nodo tiene una suma/resta
 *  en el nivel superior se envuelve en paréntesis. `factores()` atraviesa los
 *  `ParenthesisNode`, así que un factor-suma llega DESNUDO: unirlo con `*` sin
 *  re-parentetizar rompería la precedencia (`a*(b+c)` ≠ `a*b+c`). */
function strFactorSeguro(n: Nodo): string {
  const s = n.toString();
  const raiz = n.type === "ParenthesisNode" ? n.content : n;
  const esAditivo = raiz.type === "OperatorNode" && (raiz.op === "+" || raiz.op === "-");
  return esAditivo ? `(${s})` : s;
}

/** Máximo común divisor (enteros no negativos). */
function mcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

/** Fracción exacta n/d (d>0) de un número, si `fraction` la recupera con denominador
 *  razonable y reproduce el valor (evita convertir irracionales/ruido a fracciones
 *  monstruosas). Enteros → {n, d:1}. null si no es representable de forma limpia. */
function fraccionExacta(v: number): { n: number; d: number } | null {
  if (!Number.isFinite(v)) return null;
  if (Number.isInteger(v)) return { n: v, d: 1 };
  try {
    const f = fraction(v) as { s: number; n: number; d: number };
    if (f.d > 1e6) return null;
    const val = (f.s * f.n) / f.d;
    return Math.abs(val - v) < 1e-9 ? { n: f.s * f.n, d: f.d } : null;
  } catch { return null; }
}

/** Reescribe UN término (nodo sin signo aditivo) a numerador/denominador con coeficiente
 *  RACIONAL: acumula todos los factores numéricos en una fracción n/d reducida y deja el
 *  resto como factores simbólicos. `0.5·x`→ num `x`, den `2`; `0.833·x`→ num `5*x`, den `6`;
 *  `0.5`→ num `1`, den `2`. Devuelve `num`/`den` (den null si es 1) SIEMPRE positivos y el
 *  signo aparte. null si no hay nada que racionalizar (todo entero, sin denominador) o si
 *  algún coeficiente no es fracción limpia. */
function terminoRacional(nodo: Nodo): { num: string; den: string | null; signo: 1 | -1 } | null {
  const fs = factores(nodo);
  let n = 1, d = 1;                          // fracción acumulada de los factores numéricos
  const simbNum: string[] = [], simbDen: string[] = [];
  let huboDecimal = false;
  for (const f of fs) {
    const val = valorConstanteFactor(f.nodo);
    if (val !== null) {
      const fr = fraccionExacta(val);
      if (!fr) return null;                  // coeficiente no reducible → no tocar el término
      if (!Number.isInteger(val)) huboDecimal = true;
      if (f.exp === 1) { n *= fr.n; d *= fr.d; } else { n *= fr.d; d *= fr.n; }
    } else {
      (f.exp === 1 ? simbNum : simbDen).push(strFactorSeguro(f.nodo));
    }
  }
  if (!huboDecimal && d === 1) return null;  // no hay fracción decimal que arreglar
  let signo: 1 | -1 = 1;
  if (n < 0) { signo = -signo as 1 | -1; n = -n; }
  if (d < 0) { signo = -signo as 1 | -1; d = -d; }
  const g = mcd(n, d) || 1; n /= g; d /= g;
  // Numerador: el coeficiente entero (si ≠1 o no hay símbolos) seguido de los símbolos.
  const num = [...(n !== 1 || simbNum.length === 0 ? [String(n)] : []), ...simbNum].join("*");
  const denPartes = [...(d !== 1 ? [String(d)] : []), ...simbDen];
  return { num, den: denPartes.length ? denPartes.join("*") : null, signo };
}

/** Devuelve un nodo equivalente con los coeficientes DECIMALES convertidos a fracciones
 *  exactas (`0.5x`→`x/2`, `0.333x`→`x/3`). Reescribe término a término y re-parsea; los
 *  términos que no se pueden racionalizar se conservan tal cual. Pensado para la salida de
 *  `rationalize`, que serializa los racionales como decimales. El signo negativo va DENTRO
 *  del numerador del término inicial (`-x/2`→`\frac{-x}{2}`) y como resta binaria en los
 *  siguientes (` - x/2`), evitando el feo `-\left(x/2\right)`. */
export function racionalizarFracciones(n: Nodo): Nodo {
  const ts = terminos(n);
  if (ts.length === 0) return n;
  const racs = ts.map((t) => terminoRacional(t.nodo));
  // Ningún término tiene fracción decimal que arreglar → nodo INTACTO (conserva la
  // tipografía nativa de mathjs, p. ej. el menos FUERA de la fracción en `-1/x²`).
  if (racs.every((r) => r === null)) return n;
  let out = "";
  ts.forEach((t, i) => {
    const rac = racs[i];
    // Término racionalizado: signo DENTRO del numerador (`\frac{-2x}{3}`, no
    // `-\left(\frac{2x}{3}\right)`). Término intacto: signo fuera, como lo da mathjs.
    if (rac) {
      const signo: 1 | -1 = (t.signo * rac.signo) as 1 | -1;
      const cuerpo = (numerador: string) => (rac.den ? `(${numerador})/(${rac.den})` : numerador);
      if (i === 0) out = signo === 1 ? cuerpo(rac.num) : cuerpo(`-${rac.num}`);
      else out += signo === 1 ? ` + ${cuerpo(rac.num)}` : ` - ${cuerpo(rac.num)}`;
    } else {
      const s = t.nodo.toString();
      if (i === 0) out = t.signo === 1 ? s : `-(${s})`;
      else out += t.signo === 1 ? ` + ${s}` : ` - ${s}`;
    }
  });
  try { return parse(out); } catch { return n; }
}

// ─────────────────────────────────────────────
// Orden de factores (constantes con nombre delante) + combinación de semejantes
// ─────────────────────────────────────────────
//
// `rationalize` (mathjs) NO combina términos semejantes cuando interviene una constante con
// NOMBRE como π: `(x²+5x−x)·π` queda `x²·π + 5·π·x − x·π` (ni junta 5πx−πx=4πx, ni mantiene
// π del mismo lado). Aquí, SOLO en lo polinómico, se reordenan los factores de cada término
// poniendo las constantes con nombre (π, e…) DELANTE de las variables —como coeficiente
// simbólico: `\pi x`, no `x\pi`— y se SUMAN los términos con los mismos símbolos. Devuelve el
// nodo INTACTO si no hay nada que reordenar ni combinar (los casos ya correctos quedan
// byte-idénticos aguas abajo: no altera el resto del proyecto).

/** Constantes matemáticas con NOMBRE (símbolos, no números): van delante de las variables. */
const CONSTANTES_CON_NOMBRE = new Set(["pi", "e", "tau", "phi"]);

/** Nombre base de un factor para ordenar/agrupar: la variable/constante subyacente (`x` de
 *  `x^2`), o su string si no es símbolo ni potencia de símbolo. */
function baseFactor(nodo: Nodo): string {
  if (nodo.type === "SymbolNode") return nodo.name;
  if (nodo.type === "OperatorNode" && nodo.op === "^" && nodo.args?.[0]?.type === "SymbolNode")
    return nodo.args[0].name;
  return nodo.toString();
}

/** Clave de orden de un factor: (0 constante-con-nombre / 1 variable, base, string). */
function claveFactor(nodo: Nodo): string {
  const base = baseFactor(nodo);
  return `${CONSTANTES_CON_NOMBRE.has(base) ? 0 : 1}|${base}|${nodo.toString()}`;
}

/**
 * Reordena factores (constantes con nombre delante) y combina términos semejantes en una
 * expresión POLINÓMICA. Nodo intacto si hay funciones transcendentales, si algún término no
 * es un producto de símbolos por un coeficiente racional limpio, o si no hay nada que cambiar.
 */
export function combinarYordenar(n: Nodo): Nodo {
  const ts = terminos(n);
  if (ts.length === 0 || ts.some((t) => contieneFuncion(t.nodo))) return n;

  interface Desc { signo: 1 | -1; n: number; d: number; num: Nodo[]; den: Nodo[]; reord: boolean }
  const descs: (Desc | null)[] = ts.map((t) => {
    let num1 = 1, den1 = 1;
    const num: Nodo[] = [], den: Nodo[] = [];
    // Un coeficiente numérico que NO es un `ConstantNode` limpio (p. ej. el menos unario
    // `-2` de `pi * -2 * x`) exige re-emitir el término aunque los símbolos ya estén en
    // orden: al reconstruirlo lo sacamos al frente como signo+valor canónico (`-2*pi*x`).
    let coefSucio = false;
    for (const f of factores(t.nodo)) {
      const val = valorConstanteFactor(f.nodo);
      if (val !== null) {
        const fr = fraccionExacta(val);
        if (!fr) return null;                    // coeficiente no racional limpio → no combinar
        if (f.nodo.type !== "ConstantNode") coefSucio = true;
        if (f.exp === 1) { num1 *= fr.n; den1 *= fr.d; } else { num1 *= fr.d; den1 *= fr.n; }
      } else (f.exp === 1 ? num : den).push(f.nodo);
    }
    let signo = t.signo;
    if (num1 < 0) { signo = -signo as 1 | -1; num1 = -num1; }
    if (den1 < 0) { signo = -signo as 1 | -1; den1 = -den1; }
    const g = mcd(num1, den1) || 1; num1 /= g; den1 /= g;
    const orden = (xs: Nodo[]) => [...xs].sort((a, b) => (claveFactor(a) < claveFactor(b) ? -1 : claveFactor(a) > claveFactor(b) ? 1 : 0));
    const numS = orden(num), denS = orden(den);
    const reord = coefSucio || num.some((x, i) => x !== numS[i]) || den.some((x, i) => x !== denS[i]);
    return { signo, n: num1, d: den1, num: numS, den: denS, reord };
  });
  if (descs.some((x) => x === null)) return n;
  const ds = descs as Desc[];

  // Agrupa por firma de símbolos (num/den ya ordenados) sumando coeficientes (fracciones).
  const firma = (t: Desc) => `${t.num.map((s) => s.toString()).join("*")}/${t.den.map((s) => s.toString()).join("*")}`;
  const grupos = new Map<string, { n: number; d: number; num: string[]; den: string[] }>();
  for (const t of ds) {
    const sn = t.signo * t.n;
    const g = grupos.get(firma(t));
    if (!g) grupos.set(firma(t), { n: sn, d: t.d, num: t.num.map(strFactorSeguro), den: t.den.map(strFactorSeguro) });
    else {
      const nn = g.n * t.d + sn * g.d, dd = g.d * t.d, s = nn < 0 ? -1 : 1, an = Math.abs(nn), gg = mcd(an, dd) || 1;
      g.n = (s * an) / gg; g.d = dd / gg;
    }
  }
  // Nada que cambiar (ni se combinó ni se reordenó) → nodo intacto.
  if (grupos.size === ds.length && !ds.some((t) => t.reord)) return n;

  // Emisión: no-constantes en orden de aparición, la constante (firma "/") al final; ceros fuera.
  const entradas = [...grupos.entries()].filter(([, g]) => g.n !== 0);
  const grps = [...entradas.filter(([k]) => k !== "/"), ...entradas.filter(([k]) => k === "/")].map(([, g]) => g);
  if (grps.length === 0) return parse("0");
  let out = "";
  grps.forEach((g, i) => {
    const signo = g.n < 0 ? -1 : 1, valN = Math.abs(g.n);
    const numStr = [...(valN !== 1 || g.num.length === 0 ? [String(valN)] : []), ...g.num].join("*");
    const denPartes = [...(g.d !== 1 ? [String(g.d)] : []), ...g.den];
    const cuerpo = (numerador: string) => (denPartes.length ? `(${numerador})/(${denPartes.join("*")})` : numerador);
    if (i === 0) out = signo === 1 ? cuerpo(numStr) : cuerpo(`-${numStr}`);
    else out += signo === 1 ? ` + ${cuerpo(numStr)}` : ` - ${cuerpo(numStr)}`;
  });
  try { return parse(out); } catch { return n; }
}

// ─────────────────────────────────────────────
// Combinación de fracciones (ratsimp casero, para la derivada)
// ─────────────────────────────────────────────
//
// `derivative` (mathjs) produce fracciones ANIDADAS con factores repetidos
// (d/dx atan(√(x+1)/(x²+1)) → cuatro niveles de división) y ni `simplify` ni
// `rationalize` las combinan: simplify no reescribe fracciones compuestas y
// rationalize directamente se CUELGA con fracciones racionales anidadas (>60 s).
// Aquí se hace la combinación estructural: toda la expresión se lleva a UNA
// fracción (numerador/denominador como listas de factores con exponente entero),
// las sumas se pasan a común denominador, los factores IDÉNTICOS (clave = string)
// se cancelan entre num y den, y las sumas polinómicas pequeñas del resultado se
// expanden con rationalize (seguro: polinomio puro y tamaño acotado). NO garantiza
// equivalencia de dominio (cancelar √u/√u lo extiende): el LLAMADOR debe validar
// numéricamente contra la expresión original antes de adoptar el resultado
// (ver `derivar.simplificarDerivada`).

/** Factor con exponente entero (>0). num/den de una fracción estructural. */
interface FactorPot { nodo: Nodo; exp: number }
interface FraccionPot { num: FactorPot[]; den: FactorPot[] }

const clavePot = (f: FactorPot): string => f.nodo.toString();

/** Descompone un nodo en fracción de listas de factores. Atraviesa * / − unario,
 *  potencias de exponente entero y sumas (a común denominador). Las FUNCIONES son
 *  átomos (no se entra en sus argumentos). */
function aFraccionPot(n: Nodo): FraccionPot {
  if (n.type === "ParenthesisNode") return aFraccionPot(n.content);
  if (n.type === "OperatorNode") {
    const [a, b] = (n.args ?? []) as [Nodo, Nodo];
    if (n.op === "*" && n.args.length === 2) {
      const A = aFraccionPot(a), B = aFraccionPot(b);
      return { num: [...A.num, ...B.num], den: [...A.den, ...B.den] };
    }
    if (n.op === "/" && n.args.length === 2) {
      const A = aFraccionPot(a), B = aFraccionPot(b);
      return { num: [...A.num, ...B.den], den: [...A.den, ...B.num] };
    }
    if (n.op === "-" && n.args.length === 1) {
      const A = aFraccionPot(a);
      return { num: [...A.num, { nodo: parse("-1"), exp: 1 }], den: A.den };
    }
    if ((n.op === "+" || n.op === "-") && n.args.length === 2) {
      const A = aFraccionPot(a), B = aFraccionPot(b);
      // Común denominador: unión por clave con el exponente MÁXIMO; cada término se
      // multiplica por el complemento que le falta y se suma como nodo. El sustraendo
      // de una resta sí necesita paréntesis (podría ser una suma o llevar signo).
      const denU = unionPot(A.den, B.den);
      const tA = renderFactoresPot([...A.num, ...restaPot(denU, A.den)]);
      const tB = renderFactoresPot([...B.num, ...restaPot(denU, B.den)]);
      const suma = n.op === "+" ? `${tA} + ${tB}` : `${tA} - (${tB})`;
      return { num: [{ nodo: parse(suma), exp: 1 }], den: denU };
    }
    // Exponente entero: `valorConstanteFactor` (no `b.type === "ConstantNode"`) porque la
    // entrada `x^{-1}` normaliza a `x^(-1)`, cuyo exponente mathjs deja como PARÉNTESIS
    // sobre un menos unario, no como ConstantNode(−1). Sin desenvolverlo, un factor con
    // exponente negativo no se reconocía como DENOMINADOR: `1/(1−|x|^{-1})` quedaba con
    // `|x|^{-1}` de átomo opaco y no se combinaba a `|x|/(|x|−1)`.
    if (n.op === "^") {
      const k0 = valorConstanteFactor(b);
      if (k0 !== null && Number.isInteger(k0) && k0 !== 0) {
        const A = aFraccionPot(a), k = Math.abs(k0);
        const pot = (fs: FactorPot[]) => fs.map((f) => ({ nodo: f.nodo, exp: f.exp * k }));
        return k0 > 0
          ? { num: pot(A.num), den: pot(A.den) }
          : { num: pot(A.den), den: pot(A.num) };
      }
    }
  }
  return { num: [{ nodo: n, exp: 1 }], den: [] };
}

/** Agrupa una lista de factores por clave sumando exponentes. */
function agruparPot(fs: FactorPot[]): Map<string, FactorPot> {
  const m = new Map<string, FactorPot>();
  for (const f of fs) {
    const k = clavePot(f), prev = m.get(k);
    if (prev) prev.exp += f.exp;
    else m.set(k, { nodo: f.nodo, exp: f.exp });
  }
  return m;
}

/** Unión por clave con exponente máximo (común denominador de una suma). */
function unionPot(a: FactorPot[], b: FactorPot[]): FactorPot[] {
  const ma = agruparPot(a), mb = agruparPot(b), out: FactorPot[] = [];
  for (const k of new Set([...ma.keys(), ...mb.keys()])) {
    const fa = ma.get(k), fb = mb.get(k);
    out.push({ nodo: (fa ?? fb)!.nodo, exp: Math.max(fa?.exp ?? 0, fb?.exp ?? 0) });
  }
  return out;
}

/** a − b como multiconjunto por clave (exponentes que le sobran a `a`). */
function restaPot(a: FactorPot[], b: FactorPot[]): FactorPot[] {
  const mb = agruparPot(b), out: FactorPot[] = [];
  for (const [k, f] of agruparPot(a)) {
    const exp = f.exp - (mb.get(k)?.exp ?? 0);
    if (exp > 0) out.push({ nodo: f.nodo, exp });
  }
  return out;
}

/** ¿El factor tiene una SUMA en el nivel superior? (para ordenarlas al final). */
function esSuma(n: Nodo): boolean {
  if (n.type === "ParenthesisNode") return esSuma(n.content);
  return n.type === "OperatorNode" && (n.op === "+" || n.op === "-") && n.args.length === 2;
}

/** ¿El nodo es atómico como operando de `*` / base de `^`? (símbolo, constante,
 *  llamada a función: no necesita paréntesis). */
function esAtomo(n: Nodo): boolean {
  if (n.type === "ParenthesisNode") return esAtomo(n.content);
  return n.type === "SymbolNode" || n.type === "ConstantNode" || n.type === "FunctionNode";
}

/** Serializa factores como producto mathjs: coeficiente racional plegado al frente,
 *  luego factores sin suma, luego los factores-suma (leen mejor al final). "1" si vacío.
 *  Paréntesis solo donde hacen falta (átomos y potencias van desnudos). */
function renderFactoresPot(fs: FactorPot[]): string {
  let coefN = 1, coefD = 1;
  const resto: FactorPot[] = [];
  for (const f of fs) {
    const v = valorConstanteFactor(f.nodo);
    const fr = v !== null ? fraccionExacta(v) : null;
    if (fr) { coefN *= Math.pow(fr.n, f.exp); coefD *= Math.pow(fr.d, f.exp); }
    else resto.push(f);
  }
  let signo = 1;
  if (coefN < 0) { signo = -signo; coefN = -coefN; }
  const g = mcd(coefN, coefD) || 1; coefN /= g; coefD /= g;
  const orden = [...resto.filter((f) => !esSuma(f.nodo)), ...resto.filter((f) => esSuma(f.nodo))];
  const cuerpo = orden.map((f) => {
    const base = esAtomo(f.nodo) ? f.nodo.toString() : `(${f.nodo.toString()})`;
    return f.exp === 1 ? (esAtomo(f.nodo) ? base : strFactorSeguro(f.nodo)) : `${base}^${f.exp}`;
  });
  const partes = [
    ...(coefN !== 1 || cuerpo.length === 0 ? [String(coefN)] : []),
    ...cuerpo,
  ];
  let out = partes.join(" * ");
  if (coefD !== 1) out = `(${out}) / ${coefD}`;
  return signo === 1 ? out : `-(${out})`;
}

/** Expande una suma POLINÓMICA pequeña (sin funciones, tamaño acotado) con
 *  rationalize + orden canónico. Intacta si no aplica. El tope de LONGITUD no basta
 *  como salvaguarda (`(x+1)^12` son 9 caracteres y no termina nunca): el presupuesto
 *  real es `rationalizeSeguro` (nº de monomios de la expansión). */
function expandirSumaPolinomica(n: Nodo): Nodo {
  if (!esSuma(n) || contieneFuncion(n)) return n;
  const s = n.toString();
  if (s.length > 240) return n;
  const r0 = rationalizeSeguro(s);
  if (!r0) return n;
  try {
    const r = combinarYordenar(r0);
    return parse(formatearCanonico(racionalizarFracciones(r)));
  } catch { return n; }
}

/**
 * Combina TODA la expresión en una sola fracción: sumas a común denominador,
 * factores idénticos cancelados (num vs den, por clave y exponente) y numeradores
 * polinómicos expandidos. Devuelve un nodo re-parseado; puede AMPLIAR el dominio
 * (cancelaciones tipo √u/√u): validar numéricamente en el llamador.
 */
export function combinarFracciones(n: Nodo): Nodo {
  const fr = aFraccionPot(n);
  const num = restaPot(fr.num, fr.den).map((f) => ({ ...f, nodo: expandirSumaPolinomica(f.nodo) }));
  const den = restaPot(fr.den, fr.num);
  const numS = renderFactoresPot(num);
  if (den.length === 0) return parse(numS);
  return parse(`(${numS}) / (${renderFactoresPot(den)})`);
}

/** Profundidad de ANIDAMIENTO de fracciones de un árbol: 0 sin división; 1 = fracción
 *  plana `a/b`; 2 = una fracción DENTRO del numerador/denominador de otra (fracción de
 *  fracciones), etc. Métrica de legibilidad compartida: menos anidamiento se lee mejor.
 *  La usan la derivada (`simplificarDerivada`) y Simplificar para elegir la forma plana. */
export function profundidadFraccion(n: Nodo): number {
  let max = 0;
  const rec = (node: Nodo, d: number): void => {
    if (!node || typeof node !== "object") return;
    const nd = node.type === "OperatorNode" && node.op === "/" ? d + 1 : d;
    if (nd > max) max = nd;
    if (node.content) rec(node.content, nd);
    for (const a of (node.args ?? [])) rec(a, nd);
  };
  rec(n, 0);
  return max;
}

// ─────────────────────────────────────────────
// Re-simbolización de constantes irracionales que mathjs decimaliza
// ─────────────────────────────────────────────
//
// `derivative` y `simplify` (mathjs) EVALÚAN a decimal las constantes irracionales que
// aparecen al operar: `d/dx 3^x` → `1.0986… · 3^x` (era `\ln 3 · 3^x`), y `simplify(\ln 3)`,
// `atan(1)`… igual. Ese decimal, además de perder la forma exacta, ROMPE el LaTeX: `\ln 3`
// junto al siguiente número se pega (`1.0986…3^{x}` → `\ln 33^{x}`). Aquí se RECUPERA la
// forma simbólica: se reconoce el valor decimal contra `\ln k`, `1/\ln k`, `\pi`, `\sqrt k`
// (tolerancia estrecha 1e-9: un decimal cualquiera no cae por azar en `\ln k`) y se sustituye
// el nodo por su forma exacta. Como `\ln k` renderiza `\ln k` (sin paréntesis) y se PEGA al
// factor siguiente, además se mueve el factor con logaritmo al FINAL de su producto
// (`\ln 3 · 3^x` → `3^x · \ln 3`, que sí renderiza bien). La usan `derivar` e `integrar`.

/** Forma simbólica (string mathjs) de un decimal que es una constante irracional conocida,
 *  o null. Reconoce `\ln k` y su recíproco `1/\ln k` (coeficiente típico de `∫a^x`), `π`, `e`
 *  y `√k`, con su signo. Tolerancia estrecha: solo el decimal EXACTO de la constante casa. */
function formaSimbolica(v: number): string | null {
  if (!Number.isFinite(v) || Number.isInteger(v)) return null;
  const cerca = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * (1 + Math.abs(b));
  if (cerca(Math.abs(v), Math.PI)) return v < 0 ? "-pi" : "pi";
  if (cerca(Math.abs(v), Math.E)) return v < 0 ? "-e" : "e";
  for (let k = 2; k <= 100; k++) {
    const lk = Math.log(k);
    if (cerca(v, lk)) return `log(${k})`;
    if (cerca(v, -lk)) return `-log(${k})`;
    if (cerca(v, 1 / lk)) return `1/log(${k})`;
    if (cerca(v, -1 / lk)) return `-1/log(${k})`;
  }
  for (let k = 2; k <= 40; k++) {
    const s = Math.sqrt(k);
    if (!Number.isInteger(s) && cerca(Math.abs(v), s)) return v < 0 ? `-sqrt(${k})` : `sqrt(${k})`;
  }
  return null;
}

/** ¿El subárbol contiene una llamada a `log` (natural)? Para reordenar el factor al final. */
function contieneLog(n: Nodo): boolean {
  return n.filter((x: Nodo) => x.type === "FunctionNode" && x.fn?.name === "log").length > 0;
}

/**
 * Recupera las constantes irracionales decimalizadas por mathjs (`\ln k`, `1/\ln k`, `π`, `√k`)
 * en un árbol y mueve el factor con logaritmo al FINAL de su producto (evita el pegado del
 * LaTeX `\ln k` con el número siguiente). Preserva el valor numérico EXACTO: solo cambia la
 * FORMA. Es el último paso de `derivarExpr`/`integrarExpr`; no re-simplifica después (simplify
 * volvería a decimalizar).
 */
export function resimbolizarConstantes(n: Nodo): Nodo {
  const resimbolizado = n.transform((node: Nodo) => {
    if (node.isConstantNode && typeof node.value === "number") {
      const s = formaSimbolica(node.value);
      if (s) return parse(s);
    }
    return node;
  });
  const logAlFinal = (m: Nodo): Nodo => {
    const t = m.map(logAlFinal);
    if (t.type === "OperatorNode" && t.op === "*" && t.args.length === 2) {
      const [l, r] = t.args;
      const dep = (x: Nodo) => x.filter((y: Nodo) => y.isSymbolNode && y.name === "x").length > 0;
      // Constante con logaritmo × algo con la variable → variable primero, log al final.
      if (contieneLog(l) && !dep(l) && dep(r)) return new OperatorNode("*", "multiply", [r, l]);
    }
    return t;
  };
  return logAlFinal(resimbolizado);
}
