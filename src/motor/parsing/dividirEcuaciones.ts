// ─────────────────────────────────────────────
// parsing · División del bloque en ecuaciones (sistema)
// ─────────────────────────────────────────────
//
// Un bloque puede contener VARIAS ecuaciones (un sistema): cada una se grafica como
// un objeto independiente con su color. Convención:
//   • una ecuación por LÍNEA;
//   • o la forma LaTeX `\begin{cases} eq1 \\ eq2 … \end{cases}` (separador `\\`),
//     posiblemente con un `\begin{aligned}…\end{aligned}` (o `array`) ANIDADO y
//     marcadores de alineación `&` — que es EXACTAMENTE lo que emite el panel LaTeX
//     (`sistemaCasesALatex` en latex.ts: `\begin{cases}\begin{aligned}x+y&=2\\[1.5ex]…`).
//     Así el round-trip funciona: lo que se muestra se puede volver a pegar como entrada.
// Se divide por saltos de línea y por `\\` (con su posible argumento de espaciado
// `[1ex]`/`[1.5ex]`), NUNCA por comas → la tupla paramétrica `(x(t), y(t))` (que lleva
// coma) NO se rompe. Confinada a la capa nueva (sin depender de `latex.ts`).
//
// Devuelve las ecuaciones no vacías, en orden. Un bloque de 1 línea → 1 ecuación
// (comportamiento idéntico al de antes: no hay sistema, hay un solo objeto).
//
// Además DESENVUELVE la notación de definición de función nombrada `f(x)=rhs` → `rhs`
// (azúcar estilo Desmos): aquí, porque es el ÚNICO punto por el que pasan a la vez el
// grafo (composicion.ts), el panel (MotorExperimental) y el trazador → un solo sitio y
// todo queda coherente.

// Y FUSIONA las dos componentes de una paramétrica escritas por separado (`x(t)=…` en una
// línea, `y(t)=…` en otra) en la tupla canónica `(X, Y)`: por el mismo motivo (un solo sitio
// → grafo, panel y trazador coherentes). Ver componentesParametricas.ts.

import { fusionarComponentes } from "./componentesParametricas";

// Letras sueltas que NO son etiqueta de función sino variable de coordenada (x/y) o
// constante de mathjs (e = Euler, i = imaginaria): `f(x)=…` es una definición, pero
// `x(x)=…` es el producto implícito `x·x` y `e(x)=…` no tiene sentido como etiqueta.
const NO_ES_ETIQUETA = new Set(["x", "y", "e", "i"]);

/**
 * Desenvuelve `nombre(x) = rhs` → `rhs` cuando `nombre` es una LETRA suelta que actúa como
 * etiqueta de función (estilo Desmos). En este plugin TODA función explícita se grafica
 * como y=f(x) y el panel ya la pinta con el prefijo `f(x)=` (latex.ts → lineaALatex), así
 * que `f(x)=rhs` equivale exactamente a escribir `rhs` a secas. Sin esto, `construirObjeto`
 * parte por `=`, `f(x)` normaliza a `f*x` (producto implícito) y el bloque se clasifica como
 * IMPLÍCITA `f*x - rhs = 0` (basura: variable `f` fantasma, "sin y que despejar").
 *
 * Solo se reescribe si el nombre NO es coordenada ni constante (`NO_ES_ETIQUETA`) —ninguna
 * función conocida es de una sola letra, por eso basta esa lista— y el argumento es la `x`
 * de graficado. Así `sin(x)=0.5` (función real de ≥2 letras) o `x(x+1)=…` (producto)
 * siguen siendo ecuaciones implícitas. Tolera el `\left(x\right)` de LaTeX.
 */
function desenvolverDefinicionFuncion(ec: string): string {
  const m = /^([a-zA-Z])\s*(?:\\left)?\(\s*x\s*(?:\\right)?\)\s*=([\s\S]+)$/.exec(ec);
  if (!m || NO_ES_ETIQUETA.has(m[1])) return ec;
  return m[2].trim();
}

export function dividirEcuaciones(source: string): string[] {
  let s = source.trim();

  // Desenvuelve las capas de entorno LaTeX de fuera hacia dentro: cases envolviendo
  // aligned (el anidamiento que produce el propio panel), array con su spec de
  // columnas `{lcl}`, matrix, etc. Se quita cada par \begin{env}[args]…\end{env}
  // que envuelva TODO el contenido, hasta que no quede ninguno. Genérico (no cablea
  // "cases"/"aligned") para tolerar cualquier combinación amsmath.
  for (;;) {
    const ini = s.match(/^\\begin\{[a-zA-Z*]+\}(?:\{[^}]*\}|\[[^\]]*\])*\s*/);
    const fin = s.match(/\s*\\end\{[a-zA-Z*]+\}$/);
    if (!ini || !fin) break;
    s = s.slice(ini[0].length, s.length - fin[0].length);
  }

  const lineas = s
    // Salto de línea del bloque, o `\\` del cases con su argumento opcional `[1ex]`.
    .split(/\r?\n|\\\\(?:\[[^\]]*\])?/)
    // El `&` de `aligned` solo marca la columna de alineación (`x+y&=2` ≡ `x+y=2`);
    // no es un operador → se elimina antes de que construirObjeto parta por `=`.
    .map((l) => l.replace(/&/g, "").trim())
    .filter((l) => l.length > 0)
    // `f(x)=rhs` (definición de función nombrada) → `rhs` (explícita canónica).
    .map(desenvolverDefinicionFuncion);

  // `x(t)=X` + `y(t)=Y` (dos líneas) → `(X, Y)`: UNA paramétrica, no dos ecuaciones sueltas.
  return fusionarComponentes(lineas);
}
