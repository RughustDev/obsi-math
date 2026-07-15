// ─────────────────────────────────────────────
// parsing · Multiplicación implícita (3xy → 3*x*y, x(x+1) → x*(x+1))
// ─────────────────────────────────────────────
//
// Paso de normalización propio del motor NUEVO (NO toca el parser compartido ni el
// motor viejo). Inserta el `*` que el usuario omite, como en Desmos:
//   3xy → 3*x*y     xy → x*y      2sin(x) → 2*sin(x)     x(x+1) → x*(x+1)
//   (x+1)(x-1) → (x+1)*(x-1)      xsin(x) → x*sin(x)     2theta → 2*theta
// SIN romper:
//   • nombres de FUNCIÓN: `sin`, `cos`, `sqrt`, `log`, `nthRoot`… se reconocen como
//     átomos (no se parten letra a letra) → "si aparece sin, no es variable".
//   • CONSTANTES de varias letras: `pi`, `theta`, `tau`, `phi` (y `e`).
//   • NOTACIÓN CIENTÍFICA: `2e5`, `1.5e-3` (la `e` exponencial no es variable).
//
// Se aplica a la expresión YA normalizada (tras `normalizarEntrada`): el LaTeX ya se
// convirtió, las funciones están en forma mathjs y las constantes son `pi`/`e`, así
// que el análisis es puramente algebraico. Es retrocompatible: hoy `3xy` da NaN
// (mathjs lee `xy` como UNA variable libre), así que insertar el `*` no rompe nada
// que ya funcionara; solo habilita lo que antes fallaba.

// Funciones reconocidas (forma mathjs, tras normalizar). Si una secuencia de letras
// coincide con una de estas, se preserva como un solo átomo (no se multiplica dentro).
const FUNCIONES = new Set([
  "sin", "cos", "tan", "sec", "csc", "cot",
  "asin", "acos", "atan", "acsc", "asec", "acot", "atan2",
  "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
  "sech", "csch", "coth", // hiperbólicas recíprocas: mathjs las tiene, faltaban como átomo

  "log", "log10", "log2", "ln", "exp", "expm1",
  "sqrt", "cbrt", "nthRoot", "pow", "hypot",
  "abs", "sign", "floor", "ceil", "round", "fix",
  "gamma", "factorial", "min", "max", "mod", "gcd", "lcm",
  // Centinelas del DOBLE SIGNO (`y = pm(sqrt(16-x²))` = ±√…), que emiten tanto el despeje
  // par (despejar.ts) como el `\pm`/`\mp` escrito por el usuario (parser.ts). Son átomos
  // (si no, se partirían en `p*m`), se evalúan en su rama principal (constantes.ts) y el
  // motor los expande en las DOS ramas (motor/parsing/dobleSigno.ts). `toTex` los pinta
  // `\pm` / `\mp` (latex.ts).
  "pm", "mp",
]);
// Constantes/variables de varias letras que NO deben partirse.
const CONSTANTES = new Set(["pi", "theta", "tau", "phi", "Infinity", "NaN"]);

const ATOMOS = [...FUNCIONES, ...CONSTANTES].sort((a, b) => b.length - a.length);

const esDigito = (c: string): boolean => c >= "0" && c <= "9";
const esLetra = (c: string): boolean => /[a-zA-Z_]/.test(c);
const esLetraODigito = (c: string): boolean => /[a-zA-Z0-9_]/.test(c);

/** Parte una secuencia de letras en producto de átomos conocidos + variables de 1 letra. */
function expandir(run: string): string {
  const piezas: string[] = [];
  let j = 0;
  while (j < run.length) {
    let atomo: string | null = null;
    for (const a of ATOMOS) {
      if (run.startsWith(a, j)) { atomo = a; break; } // ATOMOS está por longitud desc
    }
    if (atomo) { piezas.push(atomo); j += atomo.length; }
    else { piezas.push(run[j]); j++; }
  }
  return piezas.join("*");
}

/** El sufijo de función conocida MÁS LARGO de `run` (p.ej. "xsin" → "sin"), o "". */
function sufijoFuncion(run: string): string {
  for (const f of ATOMOS) {
    if (FUNCIONES.has(f) && run.endsWith(f)) return f;
  }
  return "";
}

export function insertarProductoImplicito(expr: string): string {
  let out = "";
  const prev = (): string => {
    for (let k = out.length - 1; k >= 0; k--) if (out[k] !== " ") return out[k];
    return "";
  };

  let i = 0;
  while (i < expr.length) {
    const c = expr[i];

    // Notación científica: una `e`/`E` precedida de dígito o '.' y seguida de dígito
    // (o signo + dígito) es el exponente de un número, NO una variable. Se copia tal cual.
    if (c === "e" || c === "E") {
      const p = prev();
      const sig = expr[i + 1] ?? "";
      const sig2 = expr[i + 2] ?? "";
      const cientifica =
        (esDigito(p) || p === ".") &&
        (esDigito(sig) || ((sig === "+" || sig === "-") && esDigito(sig2)));
      if (cientifica) { out += c; i++; continue; }
    }

    if (esLetra(c)) {
      let j = i;
      while (j < expr.length && esLetraODigito(expr[j])) j++;
      const run = expr.slice(i, j);
      // `*` implícito si lo anterior cierra un operando (número, ')', '.' o el final de
      // otra variable/identificador, p.ej. "x cos(y)" → "x*cos(y)").
      const p = prev();
      if (esDigito(p) || p === ")" || p === "." || esLetra(p)) out += "*";
      // ¿seguido de '(' (saltando espacios)? → llamada a función o variable·paréntesis.
      let k = j;
      while (k < expr.length && expr[k] === " ") k++;
      const seguidoParen = expr[k] === "(";
      if (seguidoParen) {
        if (FUNCIONES.has(run)) {
          out += run;                          // función directa: sin(, sqrt(, …
        } else {
          const fs = sufijoFuncion(run);
          if (fs && /^[a-zA-Z]+$/.test(run.slice(0, run.length - fs.length))) {
            const pref = run.slice(0, run.length - fs.length);
            out += (pref ? expandir(pref) + "*" : "") + fs; // xsin( → x*sin(
          } else {
            // No es función conocida: trátalo como variables que multiplican el paréntesis.
            out += expandir(run) + "*";          // x( → x*( ,  xy( → x*y*(
          }
        }
      } else {
        out += expandir(run);                    // xy → x*y , 2theta-run → theta
      }
      i = j;
      continue;
    }

    if (c === "(") {
      const p = prev();
      if (esDigito(p) || p === ")" || p === ".") out += "*"; // 3( , )( , x)( …
      out += c; i++; continue;
    }

    out += c; i++;
  }
  return out;
}
