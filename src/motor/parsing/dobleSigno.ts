// ─────────────────────────────────────────────
// parsing · Doble signo (±, ∓): una escritura, DOS ecuaciones
// ─────────────────────────────────────────────
//
// `y = ±√(4−x²)` no es una función: es la FAMILIA de dos funciones (`+√…` y `−√…`), que
// juntas son la circunferencia entera. Ningún proveedor de geometría puede trazar "las dos
// a la vez" desde una sola expresión —el sampler 1D devuelve UNA y por x—, así que el ±
// se resuelve donde debe: ANTES de construir el objeto, expandiendo la ecuación escrita en
// las dos ecuaciones que realmente representa. Cada una sigue el camino normal (explícita,
// implícita, paramétrica…) y `ProveedorUnion` las presenta como UN objeto (un color, un id).
//
// Los signos de una misma expresión están CORRELACIONADOS, que es la convención de LaTeX:
// en la rama `+`, todo `±` vale + y todo `∓` vale −; en la rama `−`, al revés. Por eso
// `y = ±x ∓ 1` son DOS rectas (`x−1` y `−x+1`), no las cuatro combinaciones: son dos ramas
// pase lo que pase, no 2ⁿ.
//
// La entrada llega con los centinelas `pm(u)`/`mp(u)` que produce `normalizarEntrada`
// (parser.ts) —tanto desde `\pm`/`±` escritos por el usuario como desde el despeje par de
// `despejar.ts`—, así que aquí no se vuelve a mirar LaTeX: solo se sustituye el centinela
// por su signo. La sustitución es TEXTUAL sobre paréntesis balanceados (no por AST) porque
// la ecuación aún no es un AST: puede ser una tupla paramétrica `(t, ±t)` o llevar un `=`.

/** Nombres de los centinelas y el signo que toma cada uno en la rama `+`. */
const CENTINELAS: ReadonlyArray<readonly [string, 1 | -1]> = [["pm", 1], ["mp", -1]];

/** ¿La expresión (ya normalizada) contiene algún doble signo? */
export function tieneDobleSigno(exprNorm: string): boolean {
  return /(?<![a-zA-Z0-9_])(pm|mp)\s*\(/.test(exprNorm);
}

/** Índice del ')' que cierra el '(' de `inicio`; -1 si no cierra. */
function cierreParentesis(texto: string, inicio: number): number {
  let prof = 0;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === "(") prof++;
    else if (texto[i] === ")" && --prof === 0) return i;
  }
  return -1;
}

/**
 * La expresión con TODOS sus centinelas resueltos para la rama `rama` (+1 o −1):
 * `pm(u)` → `(+1*(u))` en la rama +, `(-1*(u))` en la −; `mp(u)` al revés. El factor
 * numérico explícito (en vez de un `+`/`-` prefijo) evita cualquier duda de precedencia:
 * `a + pm(b)` → `a + (-1*(b))` es exactamente `a − b` sin depender de dónde caiga el signo.
 */
function resolverCentinelas(exprNorm: string, rama: 1 | -1): string {
  let expr = exprNorm;
  for (const [nombre, signoBase] of CENTINELAS) {
    const marca = new RegExp(`(?<![a-zA-Z0-9_])${nombre}\\s*\\(`);
    for (let m = marca.exec(expr); m; m = marca.exec(expr)) {
      const abre = m.index + m[0].length - 1;
      const cierra = cierreParentesis(expr, abre);
      if (cierra === -1) break; // paréntesis sin cerrar: el parser lo rechazará después
      const cuerpo = expr.slice(abre + 1, cierra);
      const signo = signoBase * rama;
      expr = expr.slice(0, m.index) + `(${signo}*(${cuerpo}))` + expr.slice(cierra + 1);
    }
  }
  return expr;
}

/**
 * Las ecuaciones REALES que representa una ecuación escrita con ±/∓: dos (rama + y rama −)
 * si tiene doble signo, o ella misma si no. Devolver siempre una lista deja al llamador
 * (composicion.ts) sin ramificación especial: mapea y ya.
 */
export function expandirDobleSigno(exprNorm: string): string[] {
  if (!tieneDobleSigno(exprNorm)) return [exprNorm];
  return [resolverCentinelas(exprNorm, 1), resolverCentinelas(exprNorm, -1)];
}
