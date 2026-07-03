import { FUNCIONES_TRIG } from "./constantes";

// ─────────────────────────────────────────────
// Utilidades de texto / parsing
// ─────────────────────────────────────────────

/** Devuelve el índice del ')' que cierra el '(' en `inicio`. -1 si no se encuentra. */
function encontrarParentesisCierre(texto: string, inicio: number): number {
  let profundidad = 0;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === "(") profundidad++;
    else if (texto[i] === ")") {
      profundidad--;
      if (profundidad === 0) return i;
    }
  }
  return -1;
}

/** Como encontrarParentesisCierre pero para llaves `{` `}`. -1 si no cierra. */
function encontrarLlaveCierre(texto: string, inicio: number): number {
  let profundidad = 0;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === "{") profundidad++;
    else if (texto[i] === "}") {
      profundidad--;
      if (profundidad === 0) return i;
    }
  }
  return -1;
}

/**
 * Convierte `\frac{NUM}{DEN}` a `(NUM)/(DEN)` respetando llaves balanceadas y
 * fracciones/exponentes anidados. La versión anterior usaba una regex plana
 * `\\frac\{([^}]+)\}\{([^}]+)\}` que cortaba el numerador en la primera `}`
 * interna (p.ej. la del exponente en `\frac{x^{2}-1}{x-1}`), dejaba `\frac` sin
 * convertir y mathjs fallaba con "Unexpected operator {".
 *
 * Produce paréntesis SIMPLES `(NUM)/(DEN)` (no `((NUM)/(DEN))`) a propósito: la
 * regex de exponentes-fraccionarios que corre justo después espera ese formato
 * para reconocer `x^{\frac{1}{2}}` → `x^{(1)/(2)}` como raíz.
 */
function convertirFracciones(expr: string): string {
  let idx = expr.indexOf("\\frac{");
  while (idx !== -1) {
    const inicioNum = idx + 5;               // la '{' del numerador (\frac = 5 chars)
    const finNum = encontrarLlaveCierre(expr, inicioNum);
    if (finNum === -1) break;                // sin cierre: se deja igual
    if (expr[finNum + 1] !== "{") {          // denominador no contiguo: no es \frac válido
      idx = expr.indexOf("\\frac{", idx + 1);
      continue;
    }
    const inicioDen = finNum + 1;
    const finDen = encontrarLlaveCierre(expr, inicioDen);
    if (finDen === -1) break;

    const num = convertirFracciones(expr.slice(inicioNum + 1, finNum));
    const den = convertirFracciones(expr.slice(inicioDen + 1, finDen));
    expr = expr.slice(0, idx) + `(${num})/(${den})` + expr.slice(finDen + 1);
    idx = expr.indexOf("\\frac{", idx);
  }
  return expr;
}

/**
 * Si el argumento es un literal numérico puro lo convierte a radianes
 * añadiendo `*pi/180`; en caso contrario lo devuelve sin cambios.
 */
function argumentoTrigonometrico(arg: string): string {
  return /^[+-]?\d+(\.\d+)?$/.test(arg.trim()) ? arg.trim() + "*pi/180" : arg.trim();
}

/** Reescribe los argumentos numéricos de funciones trigonométricas a radianes. */
function normalizarTrigonometria(expr: string): string {
  let resultado = expr;

  for (const fn of FUNCIONES_TRIG) {
    let desde = 0;
    while (desde < resultado.length) {
      const idx = resultado.indexOf(fn + "(", desde);
      if (idx === -1) break;

      // Evita casar `sin(` DENTRO de `asin(`, `cos(` dentro de `acos(`, etc.: el
      // argumento de una inversa es un cociente, no grados, y no debe pasar a
      // radianes. Si hay una letra justo antes, no es una llamada trig directa.
      if (idx > 0 && /[a-zA-Z]/.test(resultado[idx - 1])) {
        desde = idx + fn.length + 1;
        continue;
      }

      const inicioArg = idx + fn.length;
      const finArg = encontrarParentesisCierre(resultado, inicioArg);
      if (finArg === -1) break; // paréntesis no balanceado; se detiene sin lanzar

      const arg = resultado.slice(inicioArg + 1, finArg);
      const argNorm = argumentoTrigonometrico(arg);
      resultado =
        resultado.slice(0, inicioArg + 1) + argNorm + resultado.slice(finArg);
      desde = inicioArg + argNorm.length + 2;
    }
  }

  return resultado;
}

/**
 * Convierte exponentes `^{...}` a `^(...)` respetando llaves balanceadas y
 * exponentes anidados (p.ej. `x^{3^{\pi}}` → `x^(3^(\pi))`). La versión anterior
 * usaba una regex plana `\^\{([^}]+)\}` que cortaba en la primera `}` y dejaba
 * llaves descuadradas (`x^(3^{pi)}`), que mathjs interpretaba como objeto.
 */
function convertirExponentes(expr: string): string {
  let out = "";
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "^" && expr[i + 1] === "{") {
      let profundidad = 0;
      let j = i + 1;
      for (; j < expr.length; j++) {
        if (expr[j] === "{") profundidad++;
        else if (expr[j] === "}") {
          profundidad--;
          if (profundidad === 0) break;
        }
      }
      if (profundidad !== 0) { out += expr[i]; continue; } // sin cierre: se deja igual
      out += "^(" + convertirExponentes(expr.slice(i + 2, j)) + ")";
      i = j; // salta hasta la `}` de cierre
    } else {
      out += expr[i];
    }
  }
  return out;
}

/**
 * Convierte cada `\comando{ARG}` en `envolver(ARG)` respetando llaves
 * balanceadas, de modo que ARG pueda contener llaves anidadas (otro comando, un
 * exponente `^{…}`, una raíz, etc.). Sustituye a la regex plana
 * `\\comando\{([^{}]+)\}`, que cortaba ARG en la primera `}` interna y dejaba el
 * comando a medio convertir (mathjs fallaba con "Unexpected operator {" o
 * "Parenthesis ) expected"). Usado por `\ln{…}` y `\log{…}`.
 */
function reemplazarComandoLlaves(
  expr: string,
  comando: string,
  envolver: (arg: string) => string,
): string {
  const marca = `\\${comando}{`;
  let idx = expr.indexOf(marca);
  while (idx !== -1) {
    const inicioLlave = idx + marca.length - 1; // posición de la '{'
    const fin = encontrarLlaveCierre(expr, inicioLlave);
    if (fin === -1) break;                       // sin cierre: se deja igual
    const reemplazo = envolver(expr.slice(inicioLlave + 1, fin));
    expr = expr.slice(0, idx) + reemplazo + expr.slice(fin + 1);
    idx = expr.indexOf(marca, idx + reemplazo.length);
  }
  return expr;
}

/**
 * Convierte `\sqrt[n]{ARG}` → `nthRoot(ARG,n)` y `\sqrt{ARG}` → `sqrt(ARG)`
 * respetando llaves balanceadas, de modo que el radicando ARG pueda contener
 * llaves anidadas (otra raíz, un `\log{…}` ya convertido, un exponente, etc.).
 * La versión anterior usaba regex planas `\{([^}]+)\}` que cortaban el radicando
 * en la primera `}` interna y producían paréntesis descuadrados (mathjs fallaba
 * con "Parenthesis ) expected"). Recursiva para raíces anidadas. Para índices
 * impares con radicando negativo nthRoot da la raíz real (∛-8 = -2).
 */
function convertirRaices(expr: string): string {
  let idx = expr.indexOf("\\sqrt");
  while (idx !== -1) {
    let i = idx + 5;                 // posición tras "\sqrt"
    let indice: string | null = null;
    if (expr[i] === "[") {           // índice n del radical: \sqrt[n]{…}
      const cierre = expr.indexOf("]", i);
      if (cierre === -1) break;
      indice = expr.slice(i + 1, cierre).trim();
      i = cierre + 1;
    }
    if (expr[i] !== "{") {           // \sqrt sin radicando en llaves: se omite
      idx = expr.indexOf("\\sqrt", i);
      continue;
    }
    const fin = encontrarLlaveCierre(expr, i);
    if (fin === -1) break;           // sin cierre: se deja igual
    const arg = convertirRaices(expr.slice(i + 1, fin)); // raíces anidadas
    const reemplazo =
      indice === null ? `sqrt(${arg})` : `nthRoot(${arg},${indice})`;
    expr = expr.slice(0, idx) + reemplazo + expr.slice(fin + 1);
    idx = expr.indexOf("\\sqrt", idx + reemplazo.length);
  }
  return expr;
}

/** Último carácter no-espacio de `s`, o "" si no hay ninguno. */
function ultimoNoEspacio(s: string): string {
  for (let i = s.length - 1; i >= 0; i--) if (s[i] !== " ") return s[i];
  return "";
}

/**
 * Convierte barras de valor absoluto `|…|` a `abs(…)`. Las barras son ambiguas
 * (la misma `|` abre y cierra), así que NO se usan regex: se recorre la cadena
 * llevando una pila de `abs(` abiertos. Una `|` CIERRA cuando hay uno abierto y
 * el carácter significativo previo termina un operando (letra, dígito, `)`, `]`,
 * `}`, `.`); en cualquier otro caso ABRE. Esto resuelve casos con paréntesis,
 * fracciones internas e incluso anidados como `||x|-1|` → `abs(abs(x)-1)`.
 *
 * Debe ejecutarse DESPUÉS de eliminar `\left`/`\right` (así `\left|…\right|` ya
 * llegó como `|…|`) y ANTES de convertir fracciones (el cierre se apoya en la
 * `}` de `\frac{…}{…}`). Si las barras quedan desbalanceadas la entrada es
 * ambigua y se devuelve sin tocar para no corromperla.
 */
function convertirValorAbsoluto(expr: string): string {
  if (!expr.includes("|")) return expr;
  const totalBarras = (expr.match(/\|/g) || []).length;
  if (totalBarras % 2 !== 0) return expr;

  let out = "";
  const pila: number[] = [];
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c !== "|") { out += c; continue; }
    const prev = ultimoNoEspacio(out);
    const cierraOperando = prev !== "" && /[A-Za-z0-9.)\]}]/.test(prev);
    if (pila.length > 0 && cierraOperando) { pila.pop(); out += ")"; }
    else { pila.push(i); out += "abs("; }
  }
  return pila.length === 0 ? out : expr;
}

/**
 * Normaliza las seis trigonométricas inversas a los nombres internos que MathJS
 * (o los wrappers de FUNCIONES_INVERSAS_EXTRA) entienden:
 *   arcsin / sin⁻¹ / sin^{-1} → asin   (idem cos, tan, csc, sec, cot)
 * Cubre la forma `arc…`, el superíndice Unicode `⁻¹` y el `^{-1}`/`^-1` de LaTeX.
 * Debe correr ANTES de normalizarTrigonometria (radianes) y del barrido de
 * comandos LaTeX residuales, que convierte `\arcsin`→`arcsin`→`asin`.
 */
function normalizarFuncionesInversas(expr: string): string {
  const t = "sin|cos|tan|csc|sec|cot";
  expr = expr.replace(new RegExp(`(${t})\\s*⁻¹`, "g"), "a$1");
  expr = expr.replace(new RegExp(`(${t})\\s*\\^\\{?\\s*-\\s*1\\s*\\}?`, "g"), "a$1");
  expr = expr.replace(new RegExp(`\\barc(${t})\\b`, "g"), "a$1");
  // Argumento en llaves LaTeX: `\arctan{x}` ya quedó como `\atan{x}`; aquí su
  // `{…}` pasa a `(…)`. Las trig DIRECTAS tienen su propia regla más abajo, pero
  // las inversas no entran en ese patrón, así que sin esto MathJS veía `atan{x}`
  // y fallaba ("Unexpected operator {"). Usa llaves balanceadas para no cortar un
  // `\frac` interno; convertirFracciones lo resuelve después.
  for (const fn of ["asin", "acos", "atan", "acsc", "asec", "acot"]) {
    let desde = 0;
    let idx: number;
    while ((idx = expr.indexOf(fn + "{", desde)) !== -1) {
      const prev = idx > 0 ? expr[idx - 1] : "";
      if (/[A-Za-z0-9]/.test(prev)) { desde = idx + fn.length; continue; } // sufijo de otro id
      const inicioLlave = idx + fn.length;
      const fin = encontrarLlaveCierre(expr, inicioLlave);
      if (fin === -1) break; // sin cierre: se deja igual
      expr =
        expr.slice(0, inicioLlave) + "(" + expr.slice(inicioLlave + 1, fin) +
        ")" + expr.slice(fin + 1);
      desde = fin + 1;
    }
  }
  return expr;
}

/** Convierte sintaxis LaTeX/Unicode a sintaxis que MathJS pueda evaluar. */
export function normalizarEntrada(raw: string): string {
  let expr = raw;

  // — Unicode y operadores simbólicos —
  expr = expr.replace(/π/g, "pi");
  expr = expr.replace(/√/g, "sqrt");
  expr = expr.replace(/[·×]/g, "*");
  expr = expr.replace(/÷/g, "/");
  expr = expr.replace(/²/g, "^2");
  expr = expr.replace(/³/g, "^3");
  expr = expr.replace(/∞/g, "Infinity");

  // — Delimitadores LaTeX —
  expr = expr.replace(/\\left/g, "");
  expr = expr.replace(/\\right/g, "");

  // — Valor absoluto |…| → abs(…) (tras quitar \left/\right, antes de \frac) —
  expr = convertirValorAbsoluto(expr);

  // — Trigonométricas inversas (arcsin / sin⁻¹ / sin^{-1} → asin, …) —
  expr = normalizarFuncionesInversas(expr);

  // — Fracciones LaTeX (antes de otros reemplazos) —
  expr = expr.replace(
    /\(\s*\{\\frac\{([^}]+)\}\{([^}]+)\}\s*\}\s*\)/g,
    "(($1)/($2))"
  );
  expr = expr.replace(/\(\s*\{([^{}]+)\}\s*\)/g, "($1)");
  expr = convertirFracciones(expr);

  // — Exponentes fraccionarios como raíces: x^{m/n} → nthRoot(x^m, n) (= ⁿ√xᵐ).
  //   También cubre x^{\frac{m}{n}} (ya convertido a `(m)/(n)` arriba: por eso los
  //   paréntesis del índice y exponente son opcionales en la regex). Debe ir ANTES
  //   de convertirExponentes (que transforma `^{…}` en `^(…)`).
  //   Se usa nthRoot, no x^(m/n), para obtener la raíz REAL con base negativa
  //   donde está definida (p.ej. ∛x², x^{2/3} en x<0) en vez de un complejo/NaN,
  //   y para que se renderice como radical `\sqrt[n]{x^m}`. Casos:
  //     m=1 → radicando = base (sin `^1`);  n=2 → sqrt() para que salga `\sqrt{…}`
  //     sin el índice "2".
  expr = expr.replace(
    /([a-zA-Z][a-zA-Z0-9._]*|\d+(?:\.\d+)?|\([^()]+\))\^\{\s*\(?\s*(\d+)\s*\)?\s*\/\s*\(?\s*(\d+)\s*\)?\s*\}/g,
    (_, base, m, n) => {
      const radicando = m === "1" ? base : `${base}^${m}`;
      return n === "2" ? `sqrt(${radicando})` : `nthRoot(${radicando},${n})`;
    }
  );

  // — Exponentes con llaves (incluye anidados como x^{3^{\pi}}) —
  expr = convertirExponentes(expr);

  // — Logaritmos y logaritmo natural —
  expr = expr.replace(/\\log_\{([^{}]+)\}\s*\{([^{}]+)\}/g, "log($2,$1)");
  expr = expr.replace(/\\log_\{([^{}]+)\}\s*\(([^()]+)\)/g, "log($2,$1)");
  expr = expr.replace(/\\log_([a-zA-Z0-9.]+)\s*\{([^{}]+)\}/g, "log($2,$1)");
  expr = expr.replace(/\\log_([a-zA-Z0-9.]+)\s*\(([^()]+)\)/g, "log($2,$1)");
  // Llaves balanceadas: el argumento puede contener otro comando con llaves
  // (`\ln{\sqrt{…}}`); una regex `[^{}]+` se cortaría en la primera `}` interna.
  expr = reemplazarComandoLlaves(expr, "ln", (a) => `log(${a})`);
  expr = reemplazarComandoLlaves(expr, "log", (a) => `log(${a})`);
  expr = expr.replace(/\\ln\s*\(([^()]+)\)/g, "log($1)");
  // `ln` SIN backslash: mathjs llama `log` al logaritmo natural (no conoce `ln`).
  // Va después de las reglas de `\ln` (que ya las convirtió) y como palabra
  // completa para no tocar identificadores que contengan esas letras.
  expr = expr.replace(/\bln\b/g, "log");

  // — Funciones trigonométricas con argumento LaTeX —
  const TRIG_PATRON = "sin|cos|tan|sec|csc|cot";
  expr = expr.replace(
    new RegExp(`\\\\(${TRIG_PATRON})\\s*\\{\\\\frac\\{([^}]+)\\}\\{([^}]+)\\}\\}`, "g"),
    "$1(($2)/($3))"
  );
  expr = expr.replace(
    new RegExp(`\\\\(${TRIG_PATRON})\\s*\\\\frac\\{([^}]+)\\}\\{([^}]+)\\}`, "g"),
    "$1(($2)/($3))"
  );
  expr = expr.replace(
    new RegExp(`\\\\(${TRIG_PATRON})\\s*\\{([^{}]+)\\}`, "g"),
    "$1($2)"
  );
  expr = expr.replace(
    new RegExp(`\\\\(${TRIG_PATRON})\\s+([+-]?\\d+(\\.\\d+)?)`, "g"),
    "$1($2)"
  );

  // — Miscelánea LaTeX —
  // Raíces \sqrt[n]{…} → nthRoot(…,n) y \sqrt{…} → sqrt(…), con llaves
  // balanceadas para que el radicando pueda contener `\log{…}`, otra raíz, un
  // exponente, etc. (ver convertirRaices). Se hace tras convertir ln/log/trig
  // para que esos comandos del radicando ya estén en sintaxis mathjs.
  expr = convertirRaices(expr);
  expr = expr.replace(/\\cdot/g, "*");
  expr = expr.replace(/\\([a-zA-Z]+)/g, "$1"); // comandos LaTeX residuales

  // — Radianes para literales numéricos en trig —
  expr = normalizarTrigonometria(expr);

  return expr;
}
