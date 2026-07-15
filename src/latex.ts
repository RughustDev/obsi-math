import { OperatorNode, parse } from "mathjs";

import { normalizarEntrada, contieneYLibre } from "./parser";
import { insertarProductoImplicito } from "./motor/parsing/productoImplicito";
import { funcionDelParametro } from "./motor/parsing/componentesParametricas";

// ─────────────────────────────────────────────
// LaTeX → presentación
// ─────────────────────────────────────────────

/**
 * Reescribe el LaTeX que mathjs genera para las inversas (`\sin^{-1}`, …) a la
 * notación pedida: arcsin/arccos/arctan como comandos `\arc…` y las menos comunes
 * como `\operatorname{arc…}` (no `\text{…}`: `\operatorname` usa la fuente de nombre
 * de función y añade el espaciado de operador ante el argumento, como `\sin`/`\log`).
 */
function embellecerInversasLatex(tex: string): string {
  return tex
    .replace(/\\sin\s*\^\{-1\}/g, "\\arcsin")
    .replace(/\\cos\s*\^\{-1\}/g, "\\arccos")
    .replace(/\\tan\s*\^\{-1\}/g, "\\arctan")
    .replace(/\\csc\s*\^\{-1\}/g, "\\operatorname{arccsc}")
    .replace(/\\sec\s*\^\{-1\}/g, "\\operatorname{arcsec}")
    .replace(/\\cot\s*\^\{-1\}/g, "\\operatorname{arccot}");
}

// Nombre LaTeX de cada función de "operador con nombre" a la que se le aplica la
// política tipográfica de paréntesis. Las inversas usan aquí el nombre arc…
// directamente (así no dependen de embellecerInversasLatex, que opera sobre el
// patrón `\sin^{-1}` que esta política ya no produce).
const NOMBRE_FUNCION_TEX: Record<string, string> = {
  sin: "\\sin", cos: "\\cos", tan: "\\tan",
  sec: "\\sec", csc: "\\csc", cot: "\\cot",
  sinh: "\\sinh", cosh: "\\cosh", tanh: "\\tanh", coth: "\\coth",
  log: "\\ln",            // en mathjs `log` (un argumento) es el logaritmo natural
  exp: "\\exp",
  asin: "\\arcsin", acos: "\\arccos", atan: "\\arctan",
  acsc: "\\operatorname{arccsc}", asec: "\\operatorname{arcsec}", acot: "\\operatorname{arccot}",
};

/**
 * Handler de `toTex` que aplica una política de paréntesis basada en el AST:
 * para las funciones de NOMBRE_FUNCION_TEX con UN argumento, omite los paréntesis
 * si el argumento es un átomo (SymbolNode = variable/constante con nombre como
 * x, θ, π, e; o ConstantNode = literal numérico) y los añade para cualquier otro
 * nodo (operador, función anidada, raíz, |x|, potencia…). Reproduce la tipografía
 * matemática usual: `\sin x`, `\ln x`, pero `\sin\left(x+1\right)`, `\exp\left(x^2\right)`.
 *
 * POTENCIA de función: `pow(sin(x), n)` se renderiza `\sin^{n} x` (exponente SOBRE la
 * función), NO `{\sin x}^{n}` (que mathjs pinta como `\sin x^n`, leído como `sin(xⁿ)`).
 * Es la notación estándar `\tan^{2}(x)` y desambigua de la función compuesta. No aplica a
 * exponente negativo constante (`\sin^{-1}` se leería como la inversa).
 *
 * Devuelve `undefined` para el resto de nodos (incl. funciones de 2 argumentos
 * como `log(x,2)` → `\log_{2}` y raíces/abs), dejando el render por defecto de
 * mathjs. Recurre con `arg.toTex(options)` para que la política se propague a
 * funciones anidadas.
 */
function manejadorFuncionesTex(node: any, options: any): string | undefined {
  // Argumento de una función trig: `\sin x` (átomo) o `\sin\left(x+1\right)` (compuesto).
  const argFuncion = (arg: any, nombreTex: string): string => {
    const argTex = arg.toTex(options);
    const atomico = arg.type === "SymbolNode" || arg.type === "ConstantNode";
    return atomico ? `${nombreTex} ${argTex.trim()}` : `${nombreTex}\\left(${argTex}\\right)`;
  };

  // Centinela del ± del despeje (despejar.ts): `pm(u)` → `\pm <u>`. Una raíz o una
  // fracción se leen solas → sin paréntesis (NO se enruta por NOMBRE_FUNCION_TEX/argFuncion,
  // que envolvería en `\left(\right)`). Pero un argumento con SUMA/RESTA de nivel superior
  // SÍ los necesita: el despeje de |y| puede dar `pm(x-1)`, y `\pm x-1` se leería como
  // `(\pm x)-1` —el ± solo afectaría al primer término—, que es otra ecuación.
  const SIGNO_TEX: Record<string, string> = { pm: "\\pm", mp: "\\mp" };
  if (node.type === "FunctionNode" && SIGNO_TEX[node.fn?.name] && node.args.length === 1) {
    const arg = node.args[0];
    const raiz = arg.type === "ParenthesisNode" ? arg.content : arg;
    const aditivo = raiz.type === "OperatorNode" && (raiz.op === "+" || raiz.op === "-") &&
      raiz.args?.length === 2;
    const cuerpo = arg.toTex(options);
    const signo = SIGNO_TEX[node.fn.name];
    return aditivo ? `${signo}\\left(${cuerpo}\\right)` : `${signo} ${cuerpo}`;
  }

  // SUMA con el centinela ± a la derecha: `a + pm(b)` → `a \pm b` (NO `a + \pm b`). Es la
  // forma de la fórmula cuadrática `y = (-b ± √Δ)/(2a)`, donde el ± no está a nivel superior
  // (como en `y = ±√u`) sino DENTRO de un numerador, junto a otro término. Sin esta regla el
  // despeje cuadrático general no se podía pintar: por eso estaba fuera de alcance.
  if (node.type === "OperatorNode" && node.op === "+" && node.args?.length === 2 &&
      node.args[1].type === "FunctionNode" && SIGNO_TEX[node.args[1].fn?.name]) {
    return `${node.args[0].toTex(options)} ${node.args[1].toTex(options)}`;
  }

  if (node.type === "FunctionNode" && node.args.length === 1) {
    const nombreTex = NOMBRE_FUNCION_TEX[node.fn?.name];
    if (nombreTex) return argFuncion(node.args[0], nombreTex);
  }
  // Potencia de función: (trig(arg))^n → `\trig^{n}(arg)`. La base suele venir envuelta
  // en un ParenthesisNode (`(tan(x))^2`); se desenvuelve para llegar al FunctionNode.
  if (node.type === "OperatorNode" && node.op === "^" && node.args.length === 2) {
    const [base, exp] = node.args;
    let b = base;
    while (b.type === "ParenthesisNode") b = b.content;
    const nombreTex = b.type === "FunctionNode" && b.args.length === 1
      ? NOMBRE_FUNCION_TEX[b.fn?.name] : undefined;
    const expNegativo = exp.type === "ConstantNode" && exp.value < 0;
    if (nombreTex && !expNegativo)
      return argFuncion(b.args[0], `${nombreTex}^{${exp.toTex(options)}}`);
  }
  return undefined;
}

// Opciones de toTex compartidas: paréntesis mínimos de operadores + política
// tipográfica de funciones (ver manejadorFuncionesTex).
export const OPCIONES_TEX = { parenthesis: "auto", handler: manejadorFuncionesTex } as const;

/** Elimina artefactos de espaciado que mathjs introduce en el LaTeX generado. */
export function limpiarTex(tex: string): string {
  let resultado = embellecerInversasLatex(tex);
  // Una VARIABLE de una sola letra se pinta en cursiva, como manda la tipografía matemática.
  // mathjs pinta con `\mathrm{}` (fuente recta, la de las UNIDADES) los símbolos cuyo nombre
  // coincide con una unidad suya: la `t` del parámetro paramétrico es la tonelada, así que
  // `(\cos t, \sin t)` salía como `\cos\mathrm{t}` — la única letra recta en toda la fórmula.
  // Solo se desenvuelven las de UNA letra: los nombres de función (`\mathrm{arccot}`) no se tocan.
  resultado = resultado.replace(/\\mathrm\{([a-zA-Z])\}/g, "$1");
  resultado = resultado.replace(/~\s*/g, "");
  // Un símbolo con NOMBRE (`\pi`, `\theta`, `\alpha`…) multiplicado por una VARIABLE no
  // puede yuxtaponerse pegando la letra al comando: `\pi\cdot x` → `\pix` es un comando
  // inexistente y KaTeX lo pinta en ROJO. Se protege la variable con llaves: `\pi\cdot x`
  // → `\pi{x}` (que KaTeX lee como π·x). Va ANTES del colapso general de `\cdot` —que es el
  // que produciría el pegado— y solo cuando el factor derecho es una letra suelta (si es
  // otro comando, `\pi\cdot\theta` → `\pi\theta`, el pegado es válido y lo hace el colapso).
  // Las llaves sobreviven al colapso posterior (va precedido de letra, no de artefacto).
  resultado = resultado.replace(/(\\[a-zA-Z]+)\s*\\cdot\s*([a-zA-Z])/g, "$1{$2}");
  // Multiplicación explícita → yuxtaposición: `2\cdot x` → `2x`, `x\cdot y` → `xy`
  // (tipografía usual). Se CONSERVA solo entre dos números (`2\cdot 3`; si no, se
  // fundiría en `23`). Va ANTES del colapso de llaves para que `3\cdot{x}` acabe en
  // `3x` y no en `3{x}`. Beneficia a todo el pipeline (panel, despeje, simplificación).
  resultado = resultado.replace(
    /([^\s])\s*\\cdot\s*(?=(\S))/g,
    (_m, antes: string, desp: string) =>
      /\d/.test(antes) && /\d/.test(desp) ? `${antes}\\cdot ` : `${antes}`
  );
  // mathjs abre sus llaves con un espacio sobrante (`{ x}`, `\sqrt{ x}`, `\frac{ x}{2}`).
  // El colapso de llaves sueltas lo tolera, pero las llaves que SÍ se conservan (argumento
  // de `\sqrt`/`\frac`/`^`, o la variable protegida tras `\pi`) lo arrastraban. Se quita
  // aquí: dentro de una llave el espacio es tipográficamente irrelevante.
  resultado = resultado.replace(/\{[ \t]+/g, "{");
  // Colapsa SÓLO grupos `{x}` sueltos (artefactos de mathjs). No toca los que
  // son argumento de un comando (`\sqrt{x}`) ni de un sub/superíndice (`_{x}`,
  // `^{x}`) ni de una raíz n-ésima (`\sqrt[3]{x}`, llave tras `]`): si se
  // quitaran, `\sqrt{x}` se volvería `\sqrtx` (comando inválido → KaTeX lo pinta
  // en rojo) y `\frac{x}{2}` se rompería.
  resultado = resultado.replace(/(^|[^a-zA-Z\\^_}\]])\{\s*([a-zA-Z0-9])\s*\}/g, "$1$2");
  resultado = resultado.replace(/(\d)\s+([a-zA-Z\\])/g, "$1$2");
  // Todos los paréntesis a la forma ESCALABLE `\left(…\right)` (crecen con su contenido:
  // fracciones, exponentes, raíces). Solo los que aún no lo son: el lookbehind evita
  // duplicar (`\left\left(`). El LaTeX generado siempre tiene los paréntesis balanceados,
  // así que `\left`/`\right` quedan emparejados.
  resultado = resultado
    .replace(/(?<!\\left)\(/g, "\\left(")
    .replace(/(?<!\\right)\)/g, "\\right)");
  return resultado.trim();
}

/** Quita llaves externas redundantes de una cadena LaTeX. */
export function quitarLlavesExternas(texto: string): string {
  let resultado = texto.trim();
  while (resultado.startsWith("{") && resultado.endsWith("}")) {
    let profundidad = 0;
    let envuelveTodo = true;

    for (let i = 0; i < resultado.length; i++) {
      if (resultado[i] === "{") profundidad++;
      else if (resultado[i] === "}") profundidad--;

      if (profundidad === 0 && i < resultado.length - 1) {
        envuelveTodo = false;
        break;
      }
    }

    if (!envuelveTodo) break;
    resultado = resultado.slice(1, -1).trim();
  }
  return resultado;
}

// ─────────────────────────────────────────────
// Orden descendente de grado (presentación polinómica)
// ─────────────────────────────────────────────
//
// Variable de graficación respecto de la que se mide el grado. mathjs entrega las
// derivadas y sumas ya simplificadas SIN orden canónico (`2x + x^2`); esta etapa las
// pinta como se leen a mano —grado descendente: `x^2 + 2x + …`— sin tocar el string
// que grafica el motor (es puramente tipográfica, en la salida LaTeX).
const VAR_ORDEN = "x";

/** ¿El subárbol contiene la variable de graficación en algún lugar? */
function contieneVarOrden(n: any): boolean {
  return n.filter((s: any) => s.type === "SymbolNode" && s.name === VAR_ORDEN).length > 0;
}

/**
 * Grado en x de un TÉRMINO (0 = constante o término sin x). Devuelve `null` si el
 * término NO es polinómico en x —x dentro de una función (`sin x`), en un denominador
 * (`1/x`) o con exponente no entero/negativo (`x^{1/2}`, `x^{-1}`)—: la política ante
 * cualquier término no polinómico es NO reordenar (ver `ordenarPolinomioDescendente`),
 * así que ese `null` propaga «no tocar». Producto suma grados; potencia multiplica por
 * el exponente entero; suma anidada (base de una potencia, p. ej. `(x+1)^2`) toma el
 * máximo de sus sumandos.
 */
function gradoEnX(n: any): number | null {
  switch (n.type) {
    case "ParenthesisNode": return gradoEnX(n.content);
    case "ConstantNode": return 0;
    case "SymbolNode": return n.name === VAR_ORDEN ? 1 : 0;
    case "FunctionNode": return contieneVarOrden(n) ? null : 0;
    case "OperatorNode": {
      if (n.args.length === 1) return gradoEnX(n.args[0]); // unario ±u
      if (n.op === "*") {
        let g = 0;
        for (const a of n.args) { const ga = gradoEnX(a); if (ga === null) return null; g += ga; }
        return g;
      }
      if (n.op === "/") {
        const gd = gradoEnX(n.args[1]);
        if (gd !== 0) return null; // x en el denominador → racional, no polinómico
        return gradoEnX(n.args[0]);
      }
      if (n.op === "^") {
        const [base, exp] = n.args;
        if (exp.type !== "ConstantNode" || !Number.isInteger(exp.value) || exp.value < 0)
          return contieneVarOrden(n) ? null : 0; // exponente variable/no entero/negativo
        const gb = gradoEnX(base);
        return gb === null ? null : gb * exp.value;
      }
      if (n.op === "+" || n.op === "-") { // suma anidada: grado = máx de sus sumandos
        let g = 0;
        for (const a of n.args) { const ga = gradoEnX(a); if (ga === null) return null; g = Math.max(g, ga); }
        return g;
      }
      return contieneVarOrden(n) ? null : 0;
    }
    default: return contieneVarOrden(n) ? null : 0;
  }
}

/**
 * Reordena SOLO el nivel superior de una suma polinómica en grado descendente de x
 * (`2x + x^2` → `x^2 + 2x`; `3 - x^2` → `-x^2 + 3`). Actúa únicamente si el nodo es una
 * cadena aditiva de ≥2 términos y TODOS son polinómicos en x; si alguno no lo es
 * (función de x, x en denominador, exponente variable) se deja intacto, para no alterar
 * expresiones no polinómicas. Reordenación cosmética: la suma es conmutativa, así que NO
 * cambia el valor. ESTABLE (los términos de igual grado conservan su orden) y NO recursiva:
 * las subexpresiones anidadas (denominadores, bases de potencia) se pintan como las produce
 * mathjs (evita reordenar, p. ej., el denominador de una derivada de cociente).
 */
function ordenarPolinomioDescendente(node: any): any {
  // Aplana la cadena aditiva de nivel superior en términos con su signo (+/−).
  const terminos: { signo: number; nodo: any }[] = [];
  const aplanar = (n: any, signo: number): void => {
    if (n.type === "OperatorNode" && n.args.length === 2 && (n.op === "+" || n.op === "-")) {
      aplanar(n.args[0], signo);
      aplanar(n.args[1], n.op === "-" ? -signo : signo);
    } else terminos.push({ signo, nodo: n });
  };
  aplanar(node, 1);
  if (terminos.length < 2) return node; // no es una suma: nada que reordenar

  const grados = terminos.map((t) => gradoEnX(t.nodo));
  if (grados.some((g) => g === null)) return node; // algún término no polinómico: intacto

  // Índices ordenados de forma ESTABLE por grado descendente (no se reordena si ya lo está).
  const orden = terminos.map((_, i) => i).sort((a, b) => (grados[b] as number) - (grados[a] as number));
  if (orden.every((i, k) => i === k)) return node;

  // Reconstruye la suma en el nuevo orden respetando los signos (el primer término, si es
  // negativo, se envuelve en menos unario; los siguientes se encadenan con suma/resta).
  const primero = terminos[orden[0]];
  let acc: any = primero.signo < 0 ? new OperatorNode("-", "unaryMinus", [primero.nodo]) : primero.nodo;
  for (let k = 1; k < orden.length; k++) {
    const t = terminos[orden[k]];
    acc = t.signo < 0
      ? new OperatorNode("-", "subtract", [acc, t.nodo])
      : new OperatorNode("+", "add", [acc, t.nodo]);
  }
  return acc;
}

// Convierte UN lado de una ecuación a LaTeX por el MISMO pipeline que obs-graph:
// normalizarEntrada (texto o LaTeX → sintaxis mathjs) → parse → toTex(OPCIONES_TEX)
// → limpiarTex. Así la tipografía (exponentes, paréntesis mínimos, raíces, trig e
// inversas, logaritmos, funciones especiales) es IDÉNTICA a la de obs-graph. Si el
// lado no se puede parsear, cae al texto normalizado (KaTeX suele renderizarlo).
function ladoALatex(lado: string): string {
  // MISMO preprocesado que grafica el motor: normalizar + INSERTAR el producto implícito.
  // Sin este último, un factor pegado a una función (`2x\sqrt{x}` → `2xsqrt(x)`, `x\sin x`
  // → `xsin(x)`) se parsea como UN identificador/función (`xsqrt`, `xsin`) y toTex lo pinta
  // `\mathrm{xsqrt}\left(x\right)` en vez de `2x\sqrt{x}`. El resto del pipeline (despejar,
  // derivar, simplificar, construirObjeto) ya inserta el `*`; el panel debe hacer lo mismo.
  const norm = insertarProductoImplicito(normalizarEntrada(lado.trim()));
  // Lado vacío ("y=" a medio escribir): parse("") de mathjs devuelve el nodo
  // "undefined" (toTex → "undefined"), que KaTeX pintaría como u·n·d·e·f… en
  // cursiva. Se muestra el marcador de "sin expresión".
  if (norm === "") return "\\text{[...]}";
  try {
    // Antes de pintar: reordena la suma polinómica de nivel superior a grado descendente
    // (`2x + x^2` → `x^2 + 2x`), pura presentación (no cambia lo que grafica el motor).
    return limpiarTex(ordenarPolinomioDescendente(parse(norm)).toTex(OPCIONES_TEX));
  } catch {
    return norm;
  }
}

/**
 * LaTeX de UNA expresión suelta (un lado, sin `=`), por el pipeline compartido
 * (normalizarEntrada → parse → toTex → limpiarTex). Público para quien necesita
 * incrustar la tipografía de una expresión dentro de otra construcción LaTeX
 * (p. ej. `obs-derivate`: el cuerpo de `\frac{d}{dx}\left(…\right)`).
 */
export function exprALatex(expr: string): string {
  return ladoALatex(expr);
}

/** Convierte una ecuación de texto a LaTeX (opcionalmente con `&=` para alineación). */
export function ecuacionALatex(ecuacion: string, alineada = false): string {
  const partes = ecuacion.split("=");
  if (partes.length !== 2) return ecuacion;
  // AMBOS lados por el pipeline compartido. Antes el RHS con LaTeX (`includes("\\")`)
  // se desviaba por una ruta de regex (agregarParentesisFuncionesLatex) que NO usaba
  // toTex, produciendo tipografía distinta a obs-graph e incluso cambiando el
  // significado (`\sin x^2` → `\sin\left(x\right)^2` = (sin x)² en vez de sin(x²)).
  // normalizarEntrada ya convierte el LaTeX de entrada a mathjs, así que esa ruta
  // sobraba: ahora obs-system y obs-graph comparten EXACTAMENTE el mismo pipeline.
  const signo = alineada ? "&=" : "=";
  return ladoALatex(partes[0]) + signo + ladoALatex(partes[1]);
}

/**
 * LaTeX de un BLOQUE completo (panel de fórmula de obs-graph/obs-system): cada
 * ecuación por el pipeline compartido. Reglas por línea:
 *   • "lhs = rhs"        → ecuación tal cual (ecuacionALatex)
 *   • "(X, Y)" (tupla)   → par ordenado paramétrico \left(X,\ Y\right)
 *   • expresión suelta   → "f(x) = expr" (obs-graph clásico)
 * Con 2+ ecuaciones (un SISTEMA) se usa el MISMO formato que el motor antiguo
 * (sistemaCasesALatex): \begin{cases} con \begin{aligned} anidado, `&=` alineados
 * y separación vertical [1ex] entre ecuaciones.
 * Bloque vacío → marcador \text{[...]} (parse("") de mathjs da el nodo "undefined",
 * que KaTeX pintaría como u·n·d·e·f… en cursiva). En un obs-system (`sistema`) el
 * marcador vacío conserva la llave del sistema (`\begin{cases}…[...]…\end{cases}`),
 * no la forma `f(x)=`, para que el panel anticipe que se espera un SISTEMA.
 */
export function bloqueALatex(ecuaciones: readonly string[], sistema = false): string {
  if (ecuaciones.length === 0) {
    return sistema
      ? "\\begin{cases}~\\\\\\text{[...]}\\\\~\\end{cases}"
      : "f(x)=\\text{[...]}";
  }
  const multi = ecuaciones.length >= 2;
  const lineas = ecuaciones.map((ec) => lineaALatex(ec, multi));
  return multi
    ? `\\begin{cases}\\begin{aligned}${lineas.join("\\\\[1ex]")}\\end{aligned}\\end{cases}`
    : lineas[0];
}

function lineaALatex(ec: string, alineada: boolean): string {
  const s = ec.trim();
  const tupla = separarTupla(s);
  // Par ordenado paramétrico. Se DECLARA la dependencia —`\left(x(t),\ y(t)\right)=…`— igual
  // que en las explícitas (`f(x)=`) y las polares (`r(θ)=`): la tupla desnuda no decía de qué
  // variable dependen sus componentes, y es además la forma en que el usuario las escribe
  // (dos líneas `x(t)=…` / `y(t)=…`, que dividirEcuaciones fusiona en esta tupla).
  if (tupla) {
    const par = `\\left(x\\left(t\\right),\\ y\\left(t\\right)\\right)`;
    return `${par}${alineada ? "&=" : "="}\\left(${ladoALatex(tupla[0])},\\ ${ladoALatex(tupla[1])}\\right)`;
  }
  // Función del PARÁMETRO: una componente suelta (`x(t)=…`) o una expresión suelta en `t`
  // (`5\cos t-\cos 5t`). El motor la grafica como explícita con la abscisa renombrada a x, pero
  // el panel conserva la variable que el autor escribió: `x(t)=…`, no `f(x)=…` (que hablaría de
  // una x que no aparece) ni el producto `x·t` (que es lo que salía).
  const comp = funcionDelParametro(s);
  if (comp) return `${comp.eje}\\left(t\\right)${alineada ? "&=" : "="}${ladoALatex(comp.expr)}`;
  // POLAR antes del caso general "lhs=rhs": el motor la grafica como r=g(θ)
  // (construirObjeto), y el panel debe DECLARAR la dependencia igual que hace con
  // `f(x)=…` en las explícitas. Sin esto el LHS se pinta como la variable suelta `r`,
  // que no distingue una polar de una implícita en `r`.
  const g = ladoPolar(s);
  if (g !== null) return `r\\left(\\theta\\right)${alineada ? "&=" : "="}${ladoALatex(g)}`;
  if (s.split("=").length === 2) return ecuacionALatex(s, alineada);
  // Expresión suelta con `y` LIBRE: el motor la grafica como implícita expr=0
  // (construirObjeto), así que el panel muestra `expr = 0`, no un falso `f(x)=…`.
  if (s !== "" && contieneYLibre(normalizarEntrada(s)))
    return `${ladoALatex(s)}${alineada ? "&=" : "="}0`;
  return `f(x)${alineada ? "&=" : "="}${s === "" ? "\\text{[...]}" : ladoALatex(s)}`;
}

/** Si la línea es una POLAR ("r = g(θ)" o "g(θ) = r"), devuelve el lado g(θ); si no, null.
 *  MISMO criterio que `construirObjeto`: un lado NORMALIZADO (LaTeX/Unicode → mathjs)
 *  es exactamente `r`. Así el panel y el motor coinciden siempre en qué es una polar. */
function ladoPolar(s: string): string | null {
  const partes = s.split("=");
  if (partes.length !== 2) return null;
  const lhs = normalizarEntrada(partes[0].trim());
  const rhs = normalizarEntrada(partes[1].trim());
  if (lhs === "r" && rhs !== "r") return partes[1];
  if (rhs === "r" && lhs !== "r") return partes[0];
  return null;
}

/** "(X, Y)": paréntesis que envuelven TODO + una coma de nivel 0 → [X, Y], o null.
 *  (Mismo criterio que la detección paramétrica de parsing/construirObjeto.) */
function separarTupla(s: string): [string, string] | null {
  if (s.length < 2 || s[0] !== "(" || s[s.length - 1] !== ")") return null;
  let prof = 0, coma = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[" || c === "{") prof++;
    else if (c === ")" || c === "]" || c === "}") {
      if (--prof === 0 && i < s.length - 1) return null; // el "(" inicial no envuelve todo
    } else if (c === "," && prof === 1) {
      if (coma !== -1) return null; // más de una coma: no es un par
      coma = i;
    }
  }
  if (coma === -1) return null;
  const x = s.slice(1, coma).trim(), y = s.slice(coma + 1, -1).trim();
  return x && y ? [x, y] : null;
}