import { normalizarEntrada, contieneYLibre } from "./parser";
import { insertarProductoImplicito } from "./motor/parsing/productoImplicito";
import { tieneDobleSigno } from "./motor/parsing/dobleSigno";
import { exprALatex } from "./latex";
import { compilarExpresion, compilarFuncion } from "./evaluador";
import { clasificarDegenerada, type FuncionDegenerada } from "./degeneradas";
import { crearFuncionReal } from "./motor/fields/funcionRealMathjs";
import { areaDefinida, type ResultadoArea } from "./motor/analysis/areaBajoRama";
import { simplificarEcuaciones } from "./simplificar";
import { integrarExpr } from "./integrar";

export type { ResultadoArea };

// ─────────────────────────────────────────────
// Integral definida (bloque obs-integral)
// ─────────────────────────────────────────────
//
// El bloque obs-integral grafica una función f(x) (el INTEGRANDO, un objeto explícito
// normal reutilizando todo el motor de obs-graph) y, encima, sombrea la región bajo la
// curva entre dos límites a y b mostrando el VALOR del área con signo. Aquí vive el PARSER
// de la notación, el LaTeX del panel y la fachada de evaluación del área.
//
// La entrada PRINCIPAL es LaTeX —`\int_{a}^{b} x^{2}\,dx`—, la forma en que de verdad se
// escribe una integral; se acepta además, por comodidad, una forma por líneas
// (`f(x)=…` / `a=…` / `b=…`). Sigue el mismo patrón que derivar.ts: extrae piezas de texto
// crudas y deja que cada consumidor las pase por el pipeline compartido
// (`insertarProductoImplicito(normalizarEntrada(…))` para graficar/evaluar, `exprALatex`
// para el panel) → tipografía y semántica idénticas a obs-graph, sin duplicar reglas.

/** Descomposición de una integral definida escrita por el usuario. Las piezas son texto
 *  CRUDO (tal como se escribió), no normalizado: cada consumidor aplica su propia ruta. */
export interface Integral {
  /** Integrando f: expresión suelta re-parseable por el pipeline (p. ej. `x^{2}`). */
  integrando: string;
  /** Límite inferior, tal como se escribió (`a`, `0`, `\pi`, `-1`). Puede ser simbólico. */
  a: string;
  /** Límite superior, tal como se escribió. */
  b: string;
  /** Variable de integración leída del diferencial `dx`/`dt` (por defecto `x`). */
  variable: string;
}

/**
 * Lee el grupo que sigue a `_` o `^`: un `{…}` con llaves balanceadas, un comando
 * `\pi`, un número completo (aunque no vaya entre llaves — más indulgente que LaTeX, que
 * en `^10` tomaría solo el `1`; aquí el intento del usuario es `10`) o un solo carácter.
 * Devuelve el texto (sin las llaves) y el índice tras el grupo, o null si la llave no cierra.
 */
function leerGrupo(s: string, i: number): { texto: string; fin: number } | null {
  while (i < s.length && /\s/.test(s[i])) i++;
  if (i >= s.length) return null;

  if (s[i] === "{") {
    let prof = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === "{") prof++;
      else if (s[j] === "}" && --prof === 0) return { texto: s.slice(i + 1, j), fin: j + 1 };
    }
    return null; // llave sin cerrar
  }
  if (s[i] === "\\") {
    const m = /^\\[a-zA-Z]+/.exec(s.slice(i)); // comando (\pi, \tau…)
    if (m) return { texto: m[0], fin: i + m[0].length };
    return { texto: s.slice(i, i + 2), fin: i + 2 }; // \<símbolo> suelto (raro)
  }
  const num = /^-?\d+(?:\.\d+)?/.exec(s.slice(i)); // número completo, con signo
  if (num) return { texto: num[0], fin: i + num[0].length };
  return { texto: s[i], fin: i + 1 }; // token de un carácter (a, b, x…)
}

/**
 * Parsea la forma LaTeX `\int_{a}^{b} f\,dx`. Tolerancias deliberadas:
 *   • el desliz `\in_`/`\in^` (∈, "pertenece a") por `\int` — inequívoco aquí, donde el
 *     bloque ENTERO es una integral y `\in` va seguido de un límite;
 *   • `\displaystyle` y `\limits` decorativos;
 *   • límites en cualquier orden (`_a^b` o `^b_a`);
 *   • diferencial ausente (`\int_0^2 x^2` sin `dx`) → variable por defecto `x`.
 * Devuelve null si no hay `\int` o si falta algún límite (una integral INDEFINIDA no es
 * una integral definida: este bloque necesita los dos extremos).
 */
function parsearLatex(entrada: string): Integral | null {
  // Normaliza el desliz `\in` (seguido de límite) a `\int`. El `\in` que vive DENTRO de un
  // `\int` va seguido de `t`, no de `_`/`^`, así que el lookahead no lo toca (no hay doble
  // conversión). Quita también `\displaystyle`, mero decorado del render.
  let s = entrada.replace(/\\in(?=\s*[_^])/g, "\\int").replace(/\\displaystyle/g, " ");

  const idx = s.search(/\\int/);
  if (idx < 0) return null;
  let i = idx + "\\int".length;

  const lim = /^\\limits/.exec(s.slice(i)); // \int\limits_a^b
  if (lim) i += lim[0].length;

  // Dos límites, en cualquier orden.
  let a: string | null = null, b: string | null = null;
  for (let k = 0; k < 2; k++) {
    while (i < s.length && /\s/.test(s[i])) i++;
    const marca = s[i];
    if (marca !== "_" && marca !== "^") break;
    const g = leerGrupo(s, i + 1);
    if (!g) return null;
    if (marca === "_") a = g.texto; else b = g.texto;
    i = g.fin;
  }
  if (a === null || b === null) return null;

  // Resto = integrando + diferencial. Se recorta el diferencial FINAL: espacios finos
  // (`\,` `\;` `\!` `\ ` `\quad`) opcionales + `d`/`\mathrm{d}` + la variable. Su índice
  // marca el fin del integrando. Sin diferencial, se grafica en x.
  let resto = s.slice(i).trim();
  const dif = /(?:\\[,;! ]|\\quad|\\qquad|\s)*(?:\\mathrm\s*\{\s*d\s*\}|\\mathrm\s+d|d)\s*([a-zA-Z])\s*$/.exec(resto);
  let variable = "x";
  if (dif) { variable = dif[1]; resto = resto.slice(0, dif.index).trim(); }
  if (resto === "") return null;

  return { integrando: resto, a, b, variable };
}

/** Integrando de una línea `f(x)=expr`, `y=expr`/`expr=y` o una expresión suelta. Null si
 *  no es una forma explícita reconocible. Espejo reducido de `derivar.extraerFuncion`. */
function integrandoDeLinea(l: string): string | null {
  const partes = l.split("=");
  if (partes.length === 1) return partes[0].trim() || null;
  if (partes.length === 2) {
    const izq = partes[0].trim(), der = partes[1].trim();
    if (normalizarEntrada(izq) === "y") return der || null;
    if (normalizarEntrada(der) === "y") return izq || null;
    if (/^f\s*\(/i.test(izq)) return der || null; // f(x)=expr
  }
  return null;
}

/**
 * Parsea la forma por LÍNEAS (comodidad secundaria): las líneas `a=…` y `b=…` fijan los
 * límites; la primera línea restante es el integrando. Null si falta algún límite o el
 * integrando no es explícito.
 */
function parsearLineas(entrada: string): Integral | null {
  const lineas = entrada.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  let a: string | null = null, b: string | null = null;
  const otras: string[] = [];
  for (const l of lineas) {
    const ma = /^a\s*=\s*(.+)$/i.exec(l);
    const mb = /^b\s*=\s*(.+)$/i.exec(l);
    if (ma) a = ma[1].trim();
    else if (mb) b = mb[1].trim();
    else otras.push(l);
  }
  if (a === null || b === null || otras.length === 0) return null;
  const f = integrandoDeLinea(otras[0]);
  return f ? { integrando: f, a, b, variable: "x" } : null;
}

/**
 * Blindaje contra caracteres invisibles del copiar-pegar: los de ANCHO CERO (ZWSP U+200B,
 * ZWNJ U+200C, ZWJ U+200D, BOM U+FEFF) se ELIMINAN; los espacios EXÓTICOS (no-rompible
 * U+00A0, espacios Unicode U+2000–200A, U+202F, U+205F, ideográfico U+3000) se normalizan a
 * un espacio normal. Sin esto, un `\, dx` pegado desde otra app podía traer un espacio que
 * `\s` no reconoce (no casa U+200B) o un carácter fantasma que rompía el `dx` o los límites,
 * de modo que `\int_0^2 x^2` (a mano) funcionaba pero `\int_{0}^{2} x^2 \, dx` (pegado) no.
 */
function normalizarInvisibles(texto: string): string {
  return texto
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
}

/**
 * Descompone el bloque en su integral definida, o null si no se reconoce (sin `\int` ni
 * límites, integrando vacío…). LaTeX primero (la vía principal); si no, la forma por líneas.
 */
export function extraerIntegral(source: string): Integral | null {
  const s = normalizarInvisibles(source).trim();
  if (s === "") return null;
  const it = /\\in/.test(s) ? parsearLatex(s) : parsearLineas(s); // \int (o el desliz \in)
  return it && esIntegrandoValido(it.integrando) ? it : null;
}

/**
 * ¿El integrando es una FUNCIÓN de la variable de integración? Un integrando con `=` o con
 * `y` libre es una ECUACIÓN (una curva implícita: `\int_0^1 (x²+y²−1)³=x²y³\,dx`), y de una
 * curva no se integra nada. Sin esta guarda se compilaba como f(x), evaluaba NaN en todo el
 * intervalo y el bloque lo reportaba como "Fuera de dominio" —una etiqueta del Nivel 2 (el
 * NÚMERO no existe) para un fallo del Nivel 1 (no hay función)—, con un LaTeX que ni siquiera
 * se podía tipografiar. Mismo principio que `derivar.esFuncionDeX`: la estructura del bloque
 * se clasifica ANTES de que nada llegue al parser algebraico.
 */
function esIntegrandoValido(integrando: string): boolean {
  if (integrando.includes("=")) return false;
  const norm = insertarProductoImplicito(normalizarEntrada(integrando));
  return norm !== "" && !contieneYLibre(norm);
}

/**
 * Evalúa un límite (`a`/`b`) a número, o null si es simbólico o no evaluable (`a`, `b` sin
 * valor, `\pi/0`…). Lo usan el área y el panel para decidir si hay un valor que mostrar.
 * Pasa por la MISMA ruta que grafica el motor.
 */
export function evaluarLimite(raw: string): number | null {
  const norm = insertarProductoImplicito(normalizarEntrada(raw.trim()));
  if (norm === "") return null;
  try {
    const v = compilarExpresion(norm)({});
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** LaTeX de una pieza cruda por el pipeline compartido; marcador si falla/está vacía. */
function latexSeguro(expr: string): string {
  try {
    return exprALatex(expr) || "\\text{[...]}";
  } catch {
    return "\\text{[...]}";
  }
}

/**
 * LaTeX del OPERADOR sin evaluar (vista "Original" del panel): `\int_{a}^{b} f\,dx`, con
 * cada pieza por el pipeline tipográfico compartido (misma tipografía que obs-graph).
 * Bloque no reconocido → operador con marcadores `\text{[...]}` (sigue leyéndose como una
 * integral incompleta, no como texto suelto).
 */
export function integralOperadorLatex(source: string): string {
  const it = extraerIntegral(source);
  if (!it) return `\\int_{\\text{[...]}}^{\\text{[...]}}\\text{[...]}\\,dx`;
  // El integrando se muestra SIMPLIFICADO, igual que el operador de obs-derivate muestra la
  // función ya simplificada: misma filosofía "tu expresión original, adaptada al bloque".
  // Si la simplificación falla, se conserva el integrando crudo (nunca rompe el panel).
  let integrando = it.integrando;
  try { integrando = simplificarEcuaciones([integrando])[0]; } catch { /* conserva el crudo */ }
  return `\\int_{${latexSeguro(it.a)}}^{${latexSeguro(it.b)}} ${latexSeguro(integrando)}\\,d${it.variable}`;
}

/**
 * LaTeX de la PRIMITIVA en forma de la regla de Barrow (vista "Primitiva" del panel):
 * `\left[F(x)\right]_{a}^{b}`, con `F` la antiderivada simbólica del integrando (`integrarExpr`)
 * por el pipeline tipográfico compartido y los límites en crudo. Devuelve null si el integrador
 * NO cubre este integrando (o su primitiva no supera la guarda numérica): el panel cae entonces
 * al VALOR numérico, igual que antes. Es el análogo de `derivadaLatex` para obs-integral, pero
 * puede fallar (integrar es más difícil que derivar), y por eso avisa con null en vez de un
 * marcador `\text{[...]}` (que sí se usa cuando ni siquiera hay una integral reconocible).
 */
export function integralPrimitivaLatex(source: string): string | null {
  const it = extraerIntegral(source);
  if (!it) return null;
  const primitiva = integrarExpr(it.integrando);
  if (!primitiva) return null;
  return `\\left[${latexSeguro(primitiva)}\\right]_{${latexSeguro(it.a)}}^{${latexSeguro(it.b)}}`;
}

/**
 * LaTeX de la integral EVALUADA (vista "Valor" del panel): `\int_{a}^{b} f\,dx <conector> <cuerpo>`.
 * `conector` es `=` (valor exacto) o `\approx` (impropia convergente, valor aproximado). El
 * cuerpo lo provee el llamador ya renderizado (número o etiqueta), como `derivar.derivadaLatex`.
 */
export function integralValorLatex(source: string, cuerpoLatex: string, conector = "="): string {
  return `${integralOperadorLatex(source)} ${conector} ${cuerpoLatex}`;
}

/**
 * Evalúa el ÁREA del bloque (fachada del bloque obs-integral): parsea, evalúa los límites y
 * calcula ∫ₐᵇ f dx sobre la `FuncionReal` compilada (`areaDefinida`). Devuelve el
 * `ResultadoArea` (valor con signo o etiqueta del Nivel 2), o null si no hay integral que
 * evaluar. Límites simbólicos/∞ → `ETIQUETA_LIMITES` (vía `areaDefinida`, que recibe NaN).
 */
export function evaluarArea(source: string): ResultadoArea | null {
  const it = extraerIntegral(source);
  if (!it) return null;
  const a = evaluarLimite(it.a), b = evaluarLimite(it.b);
  const f = crearFuncionReal(insertarProductoImplicito(normalizarEntrada(it.integrando)));
  // a/b no numéricos → NaN → areaDefinida devuelve ETIQUETA_LIMITES (sin recalcular aquí).
  return areaDefinida(f, a ?? NaN, b ?? NaN);
}

/** Formatea un área a un número legible en LaTeX: entero si lo es, si no 4 decimales sin
 *  ceros sobrantes (`8/3` → `2.6667`). No intenta recuperar la fracción exacta. */
function formatearArea(v: number): string {
  const r = Math.round(v);
  if (Math.abs(v - r) < 1e-9) return String(r);
  return parseFloat(v.toFixed(4)).toString();
}

/**
 * Cuerpo LaTeX del valor para el panel a partir de un `ResultadoArea`: el número (o una
 * etiqueta del Nivel 2 como `\text{Integral divergente}`) y el conector adecuado
 * (`\approx` si la integral es impropia convergente, `=` si es exacta).
 */
export function cuerpoAreaLatex(r: ResultadoArea): { cuerpo: string; conector: string } {
  if (r.tipo === "etiqueta") return { cuerpo: `\\text{${r.etiqueta}}`, conector: "=" };
  return { cuerpo: formatearArea(r.valor), conector: r.impropia ? "\\approx" : "=" };
}

// ─────────────────────────────────────────────
// Valor EXACTO del área (Barrow) — reconocimiento simbólico
// ─────────────────────────────────────────────
//
// Con la primitiva simbólica F, el valor de ∫ₐᵇ es F(b)−F(a), y ese número (evaluado a
// precisión de máquina) suele ser una forma cerrada: una fracción `8/3`, un múltiplo de π,
// un radical, un logaritmo. `valorExactoLatex` lo RECONOCE por aproximación racional de alta
// precisión (fracciones continuas): si el valor —o su cociente por π/e/√k/ln k— es un racional
// de denominador PEQUEÑO dentro de 1e-9, se representa EXACTO; si no lo es (irracional sin
// forma cerrada reconocible), el panel usa `\approx <decimal>`. Es exactamente lo pedido:
// representación exacta cuando existe, aproximación honesta cuando no.

/** Mejor aproximación racional `p/q` de `v` (fracciones continuas), con denominador ≤ `qmax`
 *  y error ≤ `tol`, o null. El denominador PEQUEÑO es la clave: un irracional necesita `q`
 *  enorme para acercarse, así que no se confunde con un racional legítimo (`8/3`, `1/2`). */
function racionalDe(v: number, tol = 1e-9, qmax = 1000): { p: number; q: number } | null {
  if (!Number.isFinite(v)) return null;
  const signo = v < 0 ? -1 : 1;
  let x = Math.abs(v);
  let hm1 = 1, hm2 = 0, km1 = 0, km2 = 1; // convergentes h/k (numerador/denominador)
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(x);
    const h = a * hm1 + hm2, k = a * km1 + km2;
    if (k > qmax) break;
    if (Math.abs((signo * h) / k - v) <= tol * (1 + Math.abs(v))) return { p: signo * h, q: k };
    hm2 = hm1; hm1 = h; km2 = km1; km1 = k;
    const frac = x - a;
    if (frac < 1e-15) break;
    x = 1 / frac;
  }
  return null;
}

/** String mathjs de `p/q` (entero si q=1). */
const racionalStr = (r: { p: number; q: number }): string => (r.q === 1 ? String(r.p) : `${r.p}/${r.q}`);

/** String mathjs de `(p/q)·símbolo` con paréntesis y signo mínimos (`pi/2` → `(pi)/2`). */
function multSimbolo(r: { p: number; q: number }, sym: string): string {
  const signo = r.p < 0 ? "-" : "";
  const ap = Math.abs(r.p);
  const num = ap === 1 ? sym : `${ap}*${sym}`;
  return r.q === 1 ? `${signo}${num}` : `${signo}(${num})/${r.q}`;
}

/** Forma cerrada (string mathjs) de un valor: racional, o racional × {π, e, √k, ln k}, o null. */
function valorExactoExpr(v: number): string | null {
  if (!Number.isFinite(v)) return null;
  const r = racionalDe(v);
  if (r) return racionalStr(r);
  const consts: [number, string][] = [[Math.PI, "pi"], [Math.E, "e"]];
  for (let k = 2; k <= 50; k++) { const s = Math.sqrt(k); if (!Number.isInteger(s)) consts.push([s, `sqrt(${k})`]); }
  for (let k = 2; k <= 50; k++) consts.push([Math.log(k), `log(${k})`]);
  for (const [c, sym] of consts) {
    const rr = racionalDe(v / c);
    if (rr) return multSimbolo(rr, sym);
  }
  return null;
}

/** LaTeX de la forma cerrada EXACTA de un valor (por `exprALatex`), o null si es irracional
 *  sin forma reconocible (→ el panel usa `\approx`). */
function valorExactoLatex(v: number): string | null {
  const e = valorExactoExpr(v);
  if (!e) return null;
  try { return exprALatex(e); } catch { return null; }
}

/** Decimal legible para el conector `\approx` (4 cifras significativas sin ceros sobrantes). */
const formatearAprox = (v: number): string => parseFloat(v.toFixed(4)).toString();

/**
 * Cuerpo LaTeX del VALOR del área, prefiriendo la representación EXACTA vía Barrow. Si hay
 * primitiva simbólica y F(b)−F(a) es consistente con el área numérica (⇒ Barrow aplica: el
 * integrando es continuo en [a,b], no hay polo interior que haría divergente la integral aunque
 * F sea finita), se reconoce el valor exacto (`= \frac{8}{3}`, `= \frac{\pi}{2}`, `= \ln 3`…) o,
 * si es irracional sin forma cerrada, `\approx <decimal>`. Sin primitiva o con caso límite del
 * Nivel 2 (divergente, etc.), cae al comportamiento numérico de `cuerpoAreaLatex`.
 */
export function cuerpoAreaLatexExacto(source: string): { cuerpo: string | null; conector: string } {
  // SIN VALOR que mostrar: o el integrando es degenerado (Nivel 1: no hay curva) o el número no
  // existe (Nivel 2: divergente, límites no numéricos, hueco del dominio). En ambos casos el
  // panel NO lleva etiqueta: `cuerpo = null` y el panel se queda con la FÓRMULA (el operador, o
  // los corchetes de Barrow). La etiqueta formal va SIEMPRE al plano —es el sitio único de los
  // diagnósticos, igual que "Indeterminada"—; ver `etiquetaIntegral` y `clasificarBloque`.
  if (etiquetaIntegral(source)) return { cuerpo: null, conector: "=" };

  const r = cuerpoAreaExactoBase(source);
  // Integrando con DOBLE SIGNO (`\int_0^2 \pm x\,dx`): el área también lo tiene, porque
  // ∫(±f) = ±∫f. El número se calcula sobre la rama principal (pm(u)=+u; ver constantes.ts)
  // y aquí se le devuelve su ± —en magnitud: `\pm(−2)` y `\pm 2` son la misma pareja—. Sin
  // esto el panel afirmaría un solo valor de una familia de dos.
  const it = extraerIntegral(source);
  const doble = it && tieneDobleSigno(insertarProductoImplicito(normalizarEntrada(it.integrando)));
  if (!doble || r.cuerpo.startsWith("\\text{")) return r;
  return { cuerpo: `\\pm ${r.cuerpo.replace(/^-/, "")}`, conector: r.conector };
}

/**
 * La ETIQUETA FORMAL del bloque obs-integral, o null si la integral tiene un valor que mostrar.
 * Punto ÚNICO del diagnóstico, y el host la pinta SOBRE EL PLANO (como "Indeterminada"): el panel
 * LaTeX solo muestra la fórmula —la integral con sus límites, o los corchetes de Barrow—, nunca
 * un `= \text{Integral divergente}`. Cubre los dos niveles con la misma forma `{etiqueta, detalle}`:
 *   • Nivel 1 — el integrando no toma ningún valor real (0/0, √−1): `degeneradas.ts`.
 *   • Nivel 2 — la curva existe pero el número no: divergente, límites no numéricos (`\int_{-\infty}`),
 *     hueco del dominio dentro de [a,b] (`\int_{-1}^{1}\sqrt{x}`): las etiquetas de `areaBajoRama`.
 */
export function etiquetaIntegral(source: string): FuncionDegenerada | null {
  const it = extraerIntegral(source);
  if (!it) return null; // sin integral reconocible: eso lo etiqueta el host (Sin integral / no válido)
  const norm = insertarProductoImplicito(normalizarEntrada(it.integrando));
  try {
    const deg = clasificarDegenerada(compilarFuncion(norm, "x"));
    if (deg) return deg;
  } catch { /* no compila: sin etiqueta de Nivel 1 */ }
  const area = evaluarArea(source);
  return area && area.tipo === "etiqueta"
    ? { etiqueta: area.etiqueta, detalle: area.detalle }
    : null;
}

function cuerpoAreaExactoBase(source: string): { cuerpo: string; conector: string } {
  const area = evaluarArea(source);
  if (!area) return { cuerpo: "\\text{[...]}", conector: "=" };
  if (area.tipo === "etiqueta") return cuerpoAreaLatex(area); // divergente / fuera de dominio / límites

  const it = extraerIntegral(source);
  const primitiva = it ? integrarExpr(it.integrando) : null;
  const a = it ? evaluarLimite(it.a) : null, b = it ? evaluarLimite(it.b) : null;
  if (primitiva && a !== null && b !== null) {
    try {
      const F = crearFuncionReal(primitiva);
      const v = (F.eval(b) as number) - (F.eval(a) as number);
      // Consistencia con el área numérica: si NO coincide, Barrow no aplica (polo interior:
      // ∫₋₁¹1/x tiene F=ln|x| finita en los extremos pero diverge) → se respeta el numérico.
      if (Number.isFinite(v) && Math.abs(v - area.valor) <= 1e-5 * (1 + Math.abs(area.valor))) {
        const exacto = valorExactoLatex(v);
        if (exacto) return { cuerpo: exacto, conector: "=" };
        return { cuerpo: formatearAprox(v), conector: "\\approx" };
      }
    } catch { /* cae al numérico */ }
  }

  // Sin primitiva utilizable: el valor es SOLO numérico (cuadratura de Simpson) → `\approx`,
  // salvo que sea un entero limpio (ahí el número es fiable). Es más honesto que afirmar `=`
  // sobre una aproximación.
  const ent = Math.round(area.valor);
  if (Math.abs(area.valor - ent) < 1e-9) return { cuerpo: String(ent), conector: "=" };
  return { cuerpo: formatearAprox(area.valor), conector: "\\approx" };
}
