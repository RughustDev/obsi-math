// ─────────────────────────────────────────────
// parsing · Componentes de una paramétrica escritas por separado: x(t)=… / y(t)=…
// ─────────────────────────────────────────────
//
// La tupla `(X(t), Y(t))` es la forma canónica del motor (construirObjeto), pero NADIE
// escribe así una curva a mano: los libros —y Desmos— dan las dos componentes en líneas
// aparte (`x(t)=5\cos t-\cos 5t` / `y(t)=5\sin t-\sin 5t`, la epitrocoide). Sin reconocerlas,
// `x(t)` normaliza al PRODUCTO `x*t` y el bloque se clasificaba como implícita basura (una
// variable `t` fantasma que el campo escalar evalúa a NaN → plano vacío, sin explicación).
//
// El reconocedor vive aquí —y no en construirObjeto— porque la fusión es de N líneas a UNA
// ecuación: es un asunto de la DIVISIÓN del bloque (dividirEcuaciones), el único choke point
// por el que pasan a la vez el grafo, el panel y el trazador. El panel (latex.ts) reusa el
// reconocedor para DECLARAR la dependencia, igual que hace con `f(x)=` y `r(θ)=`.
//
// El parámetro es SIEMPRE `t`: es lo que evalúa `crearParametrizacionCartesiana` (el scope de
// mathjs se llena con `t`). Admitir otra letra exigiría reescribir la expresión, y una
// sustitución textual de una variable es justo el tipo de "arreglo" que rompe `\cot s`.

import { SymbolNode, parse } from "mathjs";
import { normalizarEntrada } from "../../parser";
import { insertarProductoImplicito } from "./productoImplicito";

/** Una componente suelta: el eje que define, y su expresión en `t` (tal como se escribió). */
export interface ComponenteParametrica {
  eje: "x" | "y";
  expr: string;
}

// `x(t) = …` / `y(t) = …`, tolerando el `\left(…\right)` que emite LaTeX. El paréntesis debe
// contener EXACTAMENTE el parámetro: `x(t+1)=…` no es una declaración de componente sino un
// producto, y como tal se sigue tratando.
const COMPONENTE = /^([xy])\s*(?:\\left)?\(\s*t\s*(?:\\right)?\)\s*=([\s\S]+)$/;

/** Si `ec` es `x(t)=…` o `y(t)=…`, devuelve su eje y su expresión; si no, null. */
export function componenteParametrica(ec: string): ComponenteParametrica | null {
  const m = COMPONENTE.exec(ec.trim());
  if (!m) return null;
  const expr = m[2].trim();
  return expr ? { eje: m[1] as "x" | "y", expr } : null;
}

/**
 * Fusiona las DOS componentes de una paramétrica en la tupla canónica `(X, Y)` que ya entiende
 * `construirObjeto` (y que el panel pinta como par ordenado). Orden de escritura libre: se
 * coloca X primero, como manda la tupla.
 *
 * Solo dispara con el par COMPLETO: una componente suelta se devuelve intacta (el host la
 * etiqueta como paramétrica incompleta — media curva no es una curva, y graficar `x(t)` contra
 * un `y` inventado sería fabricar geometría). Cualquier otra combinación de líneas queda igual:
 * un sistema de ecuaciones normal no se ve afectado.
 */
export function fusionarComponentes(lineas: readonly string[]): string[] {
  if (lineas.length !== 2) return [...lineas];
  const a = componenteParametrica(lineas[0]);
  const b = componenteParametrica(lineas[1]);
  if (!a || !b || a.eje === b.eje) return [...lineas];
  const [x, y] = a.eje === "x" ? [a, b] : [b, a];
  return [`(${x.expr}, ${y.expr})`];
}

// ── Función DEL PARÁMETRO (una sola componente) ──────────────────────────────
//
// Una componente sola SÍ es graficable: es la función t ↦ expr, una curva del plano como
// cualquier otra. La MISMA explícita de siempre, con la variable independiente llamada `t` en
// vez de `x`: por eso no hay tipo ni proveedor nuevos —se renombra la variable
// (`renombrarParametroAX`) y la traza el `ProveedorExplicito`—.
//
// El NOMBRE de la componente dice en qué eje cae el VALOR, y la variable independiente ocupa el
// otro. Es lo que la componente SIGNIFICA, no una convención de estilo: `x(t)` afirma que el
// punto de parámetro t tiene ESA abscisa, así que su gráfica es {(x(t), t)} — sale TUMBADA, con
// el parámetro subiendo por el eje vertical (`ObjetoExplicito.salida="x"`). `y(t)` afirma lo
// contrario y da la curva de pie {(t, y(t))}, la gráfica clásica.
//
// Se reconoce también la expresión SUELTA en `t` (`5\cos t-\cos(5t)`, sin declaración): si sus
// símbolos libres incluyen `t` y no aparecen ni `x` ni `y`, la variable independiente que el
// autor tenía en la cabeza es `t` —compilarla contra `x` daría NaN en todo el eje: plano vacío y
// un falso "Indeterminada"—. Sin declaración no hay nada que diga que su valor sea la abscisa,
// así que es la gráfica de siempre: valor en la ORDENADA (eje `y`) y el panel la declara `y(t)=…`.

/**
 * Si `ec` es una función del parámetro —componente `x(t)=…`/`y(t)=…`, o expresión suelta en
 * `t`—, devuelve el eje que declara y su expresión (tal como se escribió). Si no, null.
 */
export function funcionDelParametro(ec: string): ComponenteParametrica | null {
  const comp = componenteParametrica(ec);
  if (comp) return comp;
  const s = ec.trim();
  if (s === "" || s.includes("=")) return null; // una ECUACIÓN en t no es una f(t)
  return esExpresionEnT(s) ? { eje: "y", expr: s } : null;
}

/** ¿La expresión (tal como se escribió) depende de `t` y de ninguna coordenada (`x`, `y`)? */
function esExpresionEnT(expr: string): boolean {
  const libres = simbolosLibres(insertarProductoImplicito(normalizarEntrada(expr)));
  return libres.has("t") && !libres.has("x") && !libres.has("y");
}

/**
 * Símbolos LIBRES de una expresión ya normalizada (sintaxis mathjs). El nombre de una función
 * (`cos` en `cos(t)`) es un SymbolNode más para mathjs, pero NO es una variable: se descarta
 * por su posición (`path === "fn"`). Sin ese filtro, `t` y `cos` pesarían igual.
 */
function simbolosLibres(exprNorm: string): Set<string> {
  const libres = new Set<string>();
  try {
    parse(exprNorm).traverse((nodo: any, path: string, padre: any) => {
      if (nodo.isSymbolNode && !(padre?.isFunctionNode && path === "fn")) libres.add(nodo.name);
    });
  } catch {
    /* no parsea: sin símbolos que ofrecer (el resto del pipeline ya lo dirá) */
  }
  return libres;
}

/**
 * Renombra la abscisa `t` → `x` en una expresión YA normalizada, para que la grafique el
 * trazador explícito de siempre. Se hace sobre el ÁRBOL (no con un reemplazo textual, que
 * destrozaría `\cot t` o cualquier nombre con una `t` dentro) y respetando los nombres de
 * función.
 */
export function renombrarParametroAX(exprNorm: string): string {
  try {
    const arbol = parse(exprNorm).transform((nodo: any, path: string, padre: any) =>
      nodo.isSymbolNode && nodo.name === "t" && !(padre?.isFunctionNode && path === "fn")
        ? new SymbolNode("x")
        : nodo
    );
    return arbol.toString();
  } catch {
    return exprNorm;
  }
}
