import { parse } from "mathjs";

import { opNodo, simboloNodo, funcNodo, esNoNegativo, type Nodo } from "./formatoExpr";
import { normalizarEntrada, contieneYLibre } from "./parser";
import { parametrosDeFamilia } from "./despejeInverso";
import { simplificarCondiciones, type ExtremoCond, type ResultadoCond } from "./condiciones";
import { insertarProductoImplicito } from "./motor/parsing/productoImplicito";
import { funcionDelParametro } from "./motor/parsing/componentesParametricas";
import { CENTINELAS_SIGNO } from "./motor/parsing/dobleSigno";

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
  // Inversas HIPERBÓLICAS: mismo criterio `arc…` que las circulares (mathjs las pintaría
  // `\sinh^{-1}`, que además se lee como un recíproco). Las emite el despeje por inversión
  // estructural al invertir `sinh(y)=x` / `tanh(y)=x`.
  asinh: "\\operatorname{arcsinh}", acosh: "\\operatorname{arccosh}", atanh: "\\operatorname{arctanh}",
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
// Centinela de "parentizar SIEMPRE": mathjs, con `parenthesis:"auto"`, descarta un
// ParenthesisNode que juzga redundante ante un producto —así que no se puede forzar
// `\left(\cos x\right)` con paréntesis reales—. En su lugar, `agruparFuncionesDesnudasEnProducto`
// envuelve el factor en `parenDesnuda(u)` (un FunctionNode con este nombre) y el handler lo
// pinta como `\left(<u>\right)`: un nodo de función SIEMPRE se renderiza, mathjs no lo poda.
const PAREN_DESNUDA = "parenDesnuda";

function manejadorFuncionesTex(node: Nodo, options: object): string | undefined {
  // Centinela de parentización forzada: `parenDesnuda(u)` → `\left(<u>\right)`.
  if (node.type === "FunctionNode" && node.fn?.name === PAREN_DESNUDA && node.args.length === 1)
    return `\\left(${node.args[0].toTex(options)}\\right)`;

  // Argumento de una función trig: `\sin x` (átomo) o `\sin\left(x+1\right)` (compuesto).
  const argFuncion = (arg: Nodo, nombreTex: string): string => {
    // Un paréntesis EXPLÍCITO alrededor de un átomo es redundante: lo pone el despeje al
    // componer sus strings (`e^y=x` ⇒ `log((x))`), no el usuario. Se pela para que la
    // atomicidad se juzgue sobre el contenido y salga `\ln x`, como en el resto del panel,
    // y no `\ln\left(x\right)`. Mismo criterio que los centinelas pm/fam de más abajo.
    let raiz = arg;
    while (raiz.type === "ParenthesisNode") raiz = raiz.content;
    const atomico = raiz.type === "SymbolNode" || raiz.type === "ConstantNode";
    const argTex = (atomico ? raiz : arg).toTex(options);
    return atomico ? `${nombreTex} ${argTex.trim()}` : `${nombreTex}\\left(${argTex}\\right)`;
  };

  // Centinela del ± del despeje (despejar.ts): `pm(u)` → `\pm <u>`. Una raíz o una
  // fracción se leen solas → sin paréntesis (NO se enruta por NOMBRE_FUNCION_TEX/argFuncion,
  // que envolvería en `\left(\right)`). Pero un argumento con SUMA/RESTA de nivel superior
  // SÍ los necesita: el despeje de |y| puede dar `pm(x-1)`, y `\pm x-1` se leería como
  // `(\pm x)-1` —el ± solo afectaría al primer término—, que es otra ecuación.
  // Todos los ejes de signo se pintan igual (`\pm`/`\mp`): dos ± independientes en una fórmula
  // se leen como tales en notación matemática (`±arccos((a ± √d)/2)`), el eje es interno.
  const SIGNO_TEX: Record<string, string> =
    Object.fromEntries(CENTINELAS_SIGNO.map(([n, s]) => [n, s === 1 ? "\\pm" : "\\mp"]));
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

  // Centinela de FAMILIA PERIÓDICA (despejeInverso.ts): `fam(k, p)` es el término
  // `k·p` de una solución general trig (`y = arctan(g) + fam(k, pi)` = …+kπ, k∈ℤ; la
  // coletilla `, k∈ℤ` la añade ecuacionALatex a nivel de ecuación). El coeficiente
  // numérico del período va DELANTE del parámetro, como se escribe a mano:
  // `fam(k, pi)` → `k\pi`, `fam(k, 2*pi)` → `2k\pi`. Período no reconocido →
  // `k\left(p\right)` (paréntesis para que el producto no se lea mal).
  if (node.type === "FunctionNode" && (node.fn?.name === "fam" || node.fn?.name === "famN") &&
      node.args.length === 2) {
    const kTex = node.args[0].toTex(options).trim();
    let p = node.args[1];
    while (p.type === "ParenthesisNode") p = p.content;
    if (p.type === "SymbolNode" && p.name === "pi") return `${kTex}\\pi`;
    if (p.type === "OperatorNode" && p.op === "*" && p.args?.length === 2 &&
        p.args[0].type === "ConstantNode" && p.args[1].type === "SymbolNode" &&
        p.args[1].name === "pi") {
      return `${p.args[0].toTex(options)}${kTex}\\pi`;
    }
    return `${kTex}\\left(${p.toTex(options)}\\right)`;
  }

  // Centinela de CONDICIÓN DE DOMINIO (despejar.ts): `dom(cuerpo, R)` se pinta como el CUERPO
  // a secas; la condición `R≥0` la añade `ecuacionALatex` como coletilla a nivel de ecuación
  // (igual que `fam` añade `, k∈ℤ`). Así el RHS se lee limpio y el dominio va aparte.
  if (node.type === "FunctionNode" && node.fn?.name === "dom" && node.args.length === 2)
    return node.args[0].toTex(options);

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
function contieneVarOrden(n: Nodo): boolean {
  return n.filter((s: Nodo) => s.type === "SymbolNode" && s.name === VAR_ORDEN).length > 0;
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
function gradoEnX(n: Nodo): number | null {
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
function ordenarPolinomioDescendente(node: Nodo): Nodo {
  // Aplana la cadena aditiva de nivel superior en términos con su signo (+/−).
  const terminos: { signo: number; nodo: Nodo }[] = [];
  const aplanar = (n: Nodo, signo: number): void => {
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
  let acc: Nodo = primero.signo < 0 ? opNodo("-", "unaryMinus", [primero.nodo]) : primero.nodo;
  for (let k = 1; k < orden.length; k++) {
    const t = terminos[orden[k]];
    acc = t.signo < 0
      ? opNodo("-", "subtract", [acc, t.nodo])
      : opNodo("+", "add", [acc, t.nodo]);
  }
  return acc;
}

// ─────────────────────────────────────────────
// Funciones "desnudas" agrupadas en el producto (desambiguación tipográfica)
// ─────────────────────────────────────────────
//
// Una función con nombre y argumento ATÓMICO se pinta SIN paréntesis (`\cos x`, política
// de manejadorFuncionesTex). Eso es correcto cuando la función es lo ÚLTIMO del producto
// (`e^x\cos x`), pero si le sigue OTRO factor su argumento parece tragárselo: `cos(x)·e^x`
// salía `\cos x{e}^{x}`, que se lee como cos(x·e^x). En un producto que MEZCLA funciones
// desnudas con factores no-función se aplican dos retoques puramente tipográficos (la
// multiplicación es CONMUTATIVA, así que NO cambia el string mathjs que grafica el motor):
//   1) SIEMPRE se REORDENA de forma estable llevando las funciones desnudas al FINAL, donde
//      su argumento sin paréntesis ya no puede tragarse el factor siguiente (`2\cos x`,
//      `x\sin x`, `e^x\cos x`).
//   2) SOLO si algún factor acompañante es una POTENCIA (`e^x`, `x^2`, `3^x` —algo con
//      superíndice, visualmente denso junto a la función) se PARENTIZA además la función
//      (`e^x\left(\cos x\right)`). Con un coeficiente numérico o una variable suelta se deja
//      limpio (`2\cos x`, no `2\left(\cos x\right)`). Los paréntesis reales no sirven (mathjs
//      los poda por redundantes ante un producto), así que se fuerzan con el centinela
//      PAREN_DESNUDA.
// Misma filosofía que ordenarPolinomioDescendente para las sumas.

/** Nombre mathjs de un factor que se pinta como `\nombre <átomo>` sin paréntesis (una
 *  función de NOMBRE_FUNCION_TEX con un único argumento atómico), o undefined. */
function nombreFuncionDesnuda(n: Nodo): string | undefined {
  if (n.type === "FunctionNode" && n.args?.length === 1 && NOMBRE_FUNCION_TEX[n.fn?.name]) {
    const a = n.args[0];
    if (a.type === "SymbolNode" || a.type === "ConstantNode") return n.fn.name;
  }
  return undefined;
}

/** ¿El factor se pinta con un argumento atómico SIN paréntesis que un factor a su derecha
 *  podría parecer tragarse? Cubre `\cos x` y la potencia de función `\cos^{2} x` (exponente
 *  constante no negativo, la forma que emite manejadorFuncionesTex). */
function esFuncionDesnuda(n: Nodo): boolean {
  if (nombreFuncionDesnuda(n)) return true;
  if (n.type === "OperatorNode" && n.op === "^" && n.args.length === 2) {
    let base = n.args[0];
    while (base.type === "ParenthesisNode") base = base.content;
    const exp = n.args[1];
    return !!nombreFuncionDesnuda(base) &&
      exp.type === "ConstantNode" && typeof exp.value === "number" && exp.value >= 0;
  }
  return false;
}

/** ¿El factor es una POTENCIA (`e^x`, `x^2`, `3^x`)? Su superíndice lo hace visualmente denso
 *  junto a una función desnuda, y es el caso donde se prefieren los paréntesis. */
function esPotencia(n: Nodo): boolean {
  while (n.type === "ParenthesisNode") n = n.content;
  return n.type === "OperatorNode" && n.op === "^" && n.args.length === 2;
}

/**
 * Reescribe RECURSIVAMENTE cada cadena de productos `a*b*c…` de nivel superior que MEZCLE
 * funciones desnudas (ver `esFuncionDesnuda`) con factores no-función: las funciones se
 * llevan al final de forma ESTABLE y —solo si algún factor acompañante es una POTENCIA— se
 * envuelven en el centinela `parenDesnuda` para que el handler las parentice (`cos(x)·e^x` →
 * `e^x\left(\cos x\right)`, pero `2·cos x` → `2\cos x`). Si no hay mezcla, deja el nodo
 * intacto. Conmutatividad → no cambia el valor; puramente tipográfico.
 */
function agruparFuncionesDesnudasEnProducto(node: Nodo): Nodo {
  // Fuera de un producto: recurre a las subexpresiones (argumentos de función, denominadores…).
  if (!(node.type === "OperatorNode" && node.op === "*" && node.args.length === 2))
    return node.map(agruparFuncionesDesnudasEnProducto);

  // En el `*` MÁS EXTERNO se aplana TODA la cadena de una vez (no se recurre por los sub-`*`,
  // que son el mismo producto): así el reordenamiento se decide sobre todos los factores
  // juntos. Cada factor SÍ se procesa por dentro (su árbol interno puede tener más productos).
  const factores: Nodo[] = [];
  const aplanar = (n: Nodo): void => {
    if (n.type === "OperatorNode" && n.op === "*" && n.args.length === 2) {
      aplanar(n.args[0]); aplanar(n.args[1]);
    } else factores.push(agruparFuncionesDesnudasEnProducto(n));
  };
  aplanar(node);

  const funcs = factores.filter(esFuncionDesnuda);
  const resto = factores.filter((f) => !esFuncionDesnuda(f));
  // Sin mezcla (nada que reordenar): se preserva la ESTRUCTURA original del producto —con
  // sus flags de multiplicación implícita/explícita, de los que depende el espaciado que
  // limpiarTex protege (`\pi\cdot x` → `\pi{x}`)— recorriendo por `map` en vez de reconstruir.
  if (funcs.length === 0 || resto.length === 0) return node.map(agruparFuncionesDesnudasEnProducto);

  // Parentizar solo si algún factor acompañante es una potencia (si no, se deja limpio).
  const parentizar = resto.some(esPotencia);
  const alFinal = parentizar
    ? funcs.map((f) => funcNodo(simboloNodo(PAREN_DESNUDA), [f]))
    : funcs;
  // Reconstruye el producto (no-función primero, en orden estable; luego las funciones al
  // final) con `\cdot` explícito: limpiarTex lo colapsa a yuxtaposición donde corresponde y
  // lo CONSERVA entre dos números (evita fundir `2\cdot 3` en `23`).
  return [...resto, ...alFinal].reduce((acc, f) => opNodo("*", "multiply", [acc, f]));
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
    // Antes de pintar, dos retoques puramente tipográficos (no cambian lo que grafica el
    // motor): las funciones desnudas de cada producto se agrupan y parentizan al final
    // (`cos(x)·e^x` → `e^x\left(\cos x\right)`, evita que `\cos x` parezca tragarse el factor
    // siguiente) y luego la suma polinómica de nivel superior a grado descendente
    // (`2x + x^2` → `x^2 + 2x`).
    const arbol = ordenarPolinomioDescendente(agruparFuncionesDesnudasEnProducto(parse(norm) as unknown as Nodo));
    return limpiarTex(arbol.toTex(OPCIONES_TEX));
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

/** Separación entre la solución y su coletilla (condición de dominio, `k∈ℤ`): son DOS
 *  afirmaciones distintas, no un par de la misma expresión, y con el `\ ` de una coma normal
 *  quedaban tan pegadas que se leían como una sola. `\quad` es el hueco convencional en
 *  matemáticas para "…, sujeto a…". */
const SEPARADOR_COLETILLA = ",\\quad ";

/** Presentación de UNA condición `R ≥ 0`. La simplificación de CONJUNTO (quitar factores
 *  constantes, `x/2 ≥ 0 ⇔ x ≥ 0`) ya la hizo el despeje al emitir el centinela, de modo que el
 *  motor evalúa y el panel pinta exactamente lo mismo; aquí solo queda la parte TIPOGRÁFICA:
 *  una condición negada se lee mejor con el sentido invertido (`−x ≥ 0` → `x ≤ 0`) que con el
 *  menos delante. Cadena vacía si la condición resultó ser siempre cierta. */
function condicionLatex(cond: Nodo): string {
  let n = cond;
  while (n.type === "ParenthesisNode") n = n.content;
  if (esNoNegativo(n)) return "";   // `x²+1 ≥ 0`, `|x|+3 ≥ 0`: cierta siempre, es ruido
  const negada = n.type === "OperatorNode" && n.op === "-" && n.args.length === 1;
  const cuerpo = negada ? n.args[0] : n;
  return `${ladoALatex(cuerpo.toString())} ${negada ? "\\le" : "\\ge"} 0`;
}

/** Coletilla de CONDICIÓN DE DOMINIO: si el RHS lleva el centinela `dom(cuerpo, R)` (despeje
 *  de una inversa de rango restringido: √ par, |·|), la condición `R ≥ 0` —el despeje solo
 *  vale donde el radicando/argumento es no negativo—. Cadena vacía si no hay `dom`. Análoga a
 *  la coletilla `, k∈ℤ` de la familia periódica: la información de dominio va a nivel de
 *  ecuación, no incrustada en el RHS (que se lee limpio). Con VARIAS guardas (una torre de
 *  capas de rango restringido) se listan todas, cada una tras su `\quad`: son condiciones
 *  independientes y omitir cualquiera haría la fórmula más laxa que la curva. */
function coletillaDominio(rhs: string): string {
  if (!/(?<![a-zA-Z0-9_])dom\s*\(/.test(rhs)) return "";
  let nodo: Nodo;
  try { nodo = parse(insertarProductoImplicito(normalizarEntrada(rhs.trim()))) as unknown as Nodo; }
  catch { return ""; }
  const doms = nodo.filter((n: Nodo) => n.type === "FunctionNode" && n.fn?.name === "dom" && n.args.length === 2);

  // Las guardas nacen de una en una (cada capa invertida, cada elevación al cuadrado añade la
  // suya), pero son un SISTEMA de desigualdades sobre la misma x: se resuelve entero antes de
  // pintarlo. `(x²+3)/(2x) ≥ 0` y `(x²−3)/(2x) ≥ 0` dicen juntas `x ≥ √3`, y así es como se lee.
  const resuelto = simplificarCondiciones(doms.map((d: Nodo) => d.args[1].toString()));
  if (resuelto !== null) return coletillaRango(resuelto);

  // Fuera del alcance del simplificador (una guarda con `tan x`, `|x|`, un polinomio que no se
  // deja factorizar): se listan tal cual, cada una tras su `\quad`. Son independientes y omitir
  // cualquiera haría la fórmula más laxa que la curva.
  const vistas = new Set<string>();
  let out = "";
  for (const d of doms) {
    const cond = condicionLatex(d.args[1]);
    if (cond === "" || vistas.has(cond)) continue;   // trivial, o repetida por la recursión
    vistas.add(cond);
    out += `${SEPARADOR_COLETILLA}${cond}`;
  }
  return out;
}

/** El rango resuelto como coletilla: `x ≥ a`, `x ≤ b`, `a ≤ x ≤ b` (con `<` donde el extremo no
 *  entra). Sin coletilla si se cumple siempre; tampoco la hay si es imposible —ese caso no debería
 *  llegar aquí (el despeje se descarta antes), y si llega, mejor callar que afirmar un dominio. */
function coletillaRango(r: NonNullable<ResultadoCond>): string {
  if (r.tipo !== "rango") return "";
  const { min, max } = r.rango;
  const x = "x";
  const lado = (e: ExtremoCond): string => ladoALatex(e.expr);
  // Intervalo degenerado (`x ≥ 0` y `x ≤ 0`): es un punto, y se lee como tal.
  if (min !== null && max !== null && min.expr === max.expr && min.cerrado && max.cerrado)
    return `${SEPARADOR_COLETILLA}${x} = ${lado(min)}`;
  if (min !== null && max !== null)
    return `${SEPARADOR_COLETILLA}${lado(min)} ${min.cerrado ? "\\le" : "<"} ${x} ${max.cerrado ? "\\le" : "<"} ${lado(max)}`;
  if (min !== null) return `${SEPARADOR_COLETILLA}${x} ${min.cerrado ? "\\ge" : ">"} ${lado(min)}`;
  if (max !== null) return `${SEPARADOR_COLETILLA}${x} ${max.cerrado ? "\\le" : "<"} ${lado(max)}`;
  return "";
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
  // Coletilla de FAMILIA PERIÓDICA: una ecuación con el centinela `fam`/`famN` es una familia
  // discreta de soluciones (despeje trig inverso: `y = arctan(g)+kπ`), y el rango de `k` es
  // parte de la MATEMÁTICA, no un adorno —sin él, `+kπ` se leería como una constante—. `famN`
  // restringe a k∈ℕ (`sin(1/(x²+y²))=0` → `y=±√(1/(kπ)−x²), k∈ℕ`); `fam`, a k∈ℤ.
  // UNA coletilla por PARÁMETRO: una torre de dos inversiones periódicas (`sin(cos y)=x`) tiene
  // dos enteros independientes, y declarar solo `k∈ℤ` haría leer la fórmula como si fueran el
  // mismo —afirmando la diagonal, un subconjunto propio de las soluciones—.
  const coletilla = parametrosDeFamilia(ecuacion)
    .map((p) => `${SEPARADOR_COLETILLA}${p.nombre}\\in\\mathbb{${p.natural ? "N" : "Z"}}`)
    .join("");
  return ladoALatex(partes[0]) + signo + ladoALatex(partes[1]) + coletillaDominio(partes[1]) + coletilla;
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