import { ConstantNode, FunctionNode, OperatorNode, SymbolNode, derivative, parse, simplify } from "mathjs";

import { normalizarEntrada, contieneYLibre } from "./parser";
import { insertarProductoImplicito } from "./motor/parsing/productoImplicito";
import { exprALatex } from "./latex";
import { simplificarEcuaciones } from "./simplificar";
import { racionalizarFracciones, combinarFracciones, resimbolizarConstantes, terminos as terminosAditivos, profundidadFraccion, type Nodo } from "./formatoExpr";
import { compilarFuncion } from "./evaluador";
import { clasificarDegenerada } from "./degeneradas";

// ─────────────────────────────────────────────
// Derivar (bloque obs-derivate)
// ─────────────────────────────────────────────
//
// Deriva simbólicamente f(x) respecto de x reutilizando mathjs (`derivative`, que ya
// simplifica el resultado por defecto: `x^2` → `2x`, `sin(x)·x` → `cos(x)·x + sin(x)`).
// Sigue el MISMO patrón que despejar.ts / simplificar.ts: transforma texto de usuario en
// un STRING mathjs re-parseable (lo que el motor grafica) y deriva su LaTeX por el
// pipeline tipográfico compartido (exprALatex), para que la derivada se vea EXACTAMENTE
// con la misma tipografía que obs-graph.
//
// A diferencia de obs-graph, aquí el plano NO grafica lo escrito sino su DERIVADA: el
// panel izquierdo muestra el operador sin evaluar en "Original" (`\frac{d}{dx}(f)`) y la
// derivada evaluada en "Derivada" (`f'(x) = …`); ver host-obsidian/MotorExperimental.

// Variable de derivación. obs-derivate deriva una función de una variable respecto de x
// (la misma variable independiente que grafica el motor).
const VAR = "x";

// Prefijo del operador de derivada de Leibniz respecto de x: `\frac{d}{dx}`. La variable
// del denominador DEBE ser `x` (la única respecto de la que este bloque deriva): otra
// (`\frac{d}{dy}`, `\frac{d}{dt}`) pide una derivada que aquí no se calcula → no es el
// operador y se rechaza más abajo (antes se aceptaba pero se derivaba wrt x igual, dando
// un resultado incorrecto: `\frac{d}{dy}(x^2)` → `2x`). Se tolera espacio arbitrario
// porque KaTeX/Obsidian no lo normalizan.
const RE_OPERADOR_DERIVADA = /^\s*\\frac\s*\{\s*d\s*\}\s*\{\s*d\s*x\s*\}\s*/;

// Cualquier fracción de Leibniz `\frac{d…}{d…}` (numerador y denominador que empiezan por
// `d`): el operador de derivada en CUALQUIER variante —`\frac{d}{dy}`, `\frac{dy}{dx}`,
// `\frac{d^2}{dx^2}`…—. Solo el caso exacto `\frac{d}{dx}(f)` lo desenvuelve
// `quitarOperadorDerivada`; las demás son notación que este bloque no puede evaluar y se
// RECHAZAN (null) en vez de dejar que `d` llegue al parser como variable y grafique basura
// (`\frac{dy}{dx}` daba `-(y/x^2)`). Mismo principio que la extracción de la integral:
// clasificar/extraer la estructura ANTES de que nada llegue al parser algebraico.
const RE_LEIBNIZ = /\\frac\s*\{\s*d[^{}]*\}\s*\{\s*d[^{}]*\}/;

/** ¿La expresión es una función SOLO de x? (sin `y` libre). Un `y` suelto delata una
 *  relación implícita escrita sin `=` (`x^2+y^2-16`), que NO es una f(x): derivarla wrt x
 *  daría un ∂/∂x silencioso (`2x`). Misma normalización y misma guarda `contieneYLibre`
 *  que usa `construirObjeto` para separar explícita de implícita. */
const esFuncionDeX = (f: string): boolean =>
  !contieneYLibre(insertarProductoImplicito(normalizarEntrada(f)));

/**
 * Si `ec` es el OPERADOR de derivada respecto de x escrito por el usuario
 * (`\frac{d}{dx}(x^2)`, `\frac{d}{dx}\left(x^2\right)` o SIN agrupar `\frac{d}{dx} x^2`),
 * devuelve el argumento a derivar; si no empieza por ese operador, null. Motivo: en
 * obs-derivate se escribe SOLO la función f(x) y el bloque le aplica d/dx por su cuenta;
 * si el usuario escribe además el operador, `normalizarEntrada` trataría `d` como una
 * variable (`\frac{d}{dx}(x^2)` → `d·x²/(d·x)`) y saldría una derivada basura. Aquí lo
 * reconocemos y lo quitamos para quedarnos con la función. Como `RE_OPERADOR_DERIVADA` ya
 * exige el prefijo exacto `\frac{d}{dx}` (y `d` nunca es una variable real de este bloque),
 * el prefijo es SIEMPRE el operador: también se acepta el argumento sin paréntesis
 * (`\frac{d}{dx} x^2` → `x^2`), que antes se dejaba pasar y grafica basura. Solo desenvuelve
 * UN nivel: un operador doble (segunda derivada) no lo calcula el bloque.
 */
function quitarOperadorDerivada(ec: string): string | null {
  const m = RE_OPERADOR_DERIVADA.exec(ec);
  if (!m) return null;
  const resto = ec.slice(m[0].length).trim();
  if (resto === "") return null;

  // Argumento SIN agrupar (`\frac{d}{dx} x^2`): el resto entero es la función a derivar.
  const usaLeft = resto.startsWith("\\left(");
  if (!usaLeft && !resto.startsWith("(")) return resto;

  // Argumento agrupado: si el grupo inicial envuelve TODO el resto devolvemos su interior
  // (`(x^2)` → `x^2`); si cierra ANTES (`(x)+1`, `(x)(x+1)`) el operador no envuelve un
  // único grupo, así que el resto entero es la función (misma convención que el caso sin
  // agrupar: se deriva todo lo que sigue al operador).
  let profundidad = 0;
  for (let i = 0; i < resto.length; i++) {
    if (resto.startsWith("\\left(", i)) { profundidad++; i += "\\left(".length - 1; continue; }
    if (resto.startsWith("\\right)", i)) { profundidad--; i += "\\right)".length - 1; }
    else if (resto[i] === "(") profundidad++;
    else if (resto[i] === ")") profundidad--;

    if (profundidad === 0) {
      if (i !== resto.length - 1) return resto; // el grupo no envuelve todo → resto entero
      const abre = usaLeft ? "\\left(".length : 1;
      const cierra = usaLeft ? "\\right)".length : 1;
      return resto.slice(abre, resto.length - cierra).trim() || null;
    }
  }
  return resto; // paréntesis sin cerrar: el parser lo rechazará (derivarExpr → null)
}

/**
 * Expresión f(x) de una ecuación del bloque: una expresión suelta (`x^2`), o el lado
 * no-`y` de `y = f(x)` / `f(x) = y`. Null si no es una forma explícita de x reconocible
 * (implícita, notación de Leibniz que no sea `d/dx`, `y` libre, tupla paramétrica,
 * vacía…): esas no se derivan como función de x. Si el usuario escribió el propio
 * operador `\frac{d}{dx}(f)` (con o sin paréntesis), se queda con f.
 *
 * Principio (el mismo que la extracción de la integral): la estructura del bloque se
 * clasifica y extrae ANTES de que nada llegue al parser algebraico, para que ningún token
 * estructural (`d`, `dx`, la `y` de una implícita) se cuele como variable y grafique basura.
 */
export function extraerFuncion(ec: string): string | null {
  // 1) Operador de derivada respecto de x (`\frac{d}{dx}(f)` / `\frac{d}{dx} f`): su f.
  const interior = quitarOperadorDerivada(ec);
  if (interior !== null) return esFuncionDeX(interior) ? interior : null;

  // 2) Otra notación de Leibniz (`\frac{d}{dy}…`, `\frac{dy}{dx}`, 2ª derivada…): pide una
  //    derivada que este bloque NO calcula. Rechazar antes de que `d` llegue al parser.
  if (RE_LEIBNIZ.test(ec)) return null;

  // 3) Forma explícita: expresión suelta, o el lado no-`y` de `y=f(x)` / `f(x)=y`.
  const partes = ec.split("=");
  let f: string | null = null;
  if (partes.length === 1) f = partes[0].trim() || null;
  else if (partes.length === 2) {
    if (normalizarEntrada(partes[0].trim()) === "y") f = partes[1].trim() || null;
    else if (normalizarEntrada(partes[1].trim()) === "y") f = partes[0].trim() || null;
  }
  // La `y` LIBRE en lo extraído delata una implícita escrita sin `=` (`x^2+y^2-16`): no es
  // una f(x) y no se deriva (evitaría el ∂/∂x silencioso → `2x`).
  return f && esFuncionDeX(f) ? f : null;
}

// Reglas extra para la simplificación de la derivada: `sqrt(u)² → u` limpia los
// `sqrt(x+1)^2` que deja la regla de la cadena. OJO: por sí sola AMPLÍA el dominio
// (√u indefinida para u<0); la guardia numérica de `simplificarDerivada` rechaza el
// resultado si eso cambia la función en algún punto de muestra.
const REGLAS_DERIVADA: unknown[] = ["sqrt(n1)^2 -> n1"]
  .concat((simplify as unknown as { rules: unknown[] }).rules as never[]);

// Muestras para la guardia de equivalencia: valores "anodinos" (no enteros, ambos
// signos, cerca y lejos del origen) para no caer justo en raíces o simetrías.
const PUNTOS_EQUIVALENCIA = [-7.3, -2.6, -1.2, -0.7, -0.3, 0.4, 1.1, 2.7, 5.8, 11.4];

/** ¿Las dos expresiones (strings mathjs) definen la MISMA función de x sobre la
 *  muestra? Exige coincidir también en dónde NO son finitas (fidelidad de dominio:
 *  una simplificación que "rellene" huecos del dominio queda rechazada). */
function derivadasEquivalentes(a: string, b: string): boolean {
  try {
    const fa = compilarFuncion(a, VAR), fb = compilarFuncion(b, VAR);
    return PUNTOS_EQUIVALENCIA.every((x) => {
      const va = fa(x) as number, vb = fb(x) as number;
      const finA = typeof va === "number" && Number.isFinite(va);
      const finB = typeof vb === "number" && Number.isFinite(vb);
      if (!finA || !finB) return finA === finB;
      return Math.abs(va - vb) <= 1e-8 * (1 + Math.abs(va));
    });
  } catch { return false; }
}

/** Factores de un PRODUCTO de nivel superior (solo `*`, no `/`): `a*b*c` → [a,b,c]. La
 *  división NO se reparte (sería la regla del cociente, que mathjs ya combina bien). */
function factoresProducto(n: Nodo): Nodo[] {
  if (n.type === "ParenthesisNode") return factoresProducto(n.content);
  if (n.type === "OperatorNode" && n.op === "*" && n.args.length === 2)
    return [...factoresProducto(n.args[0]), ...factoresProducto(n.args[1])];
  return [n];
}

/** Extrae el signo GLOBAL de una fracción/producto ya limpio y devuelve su magnitud (sin
 *  el menos), para poder emitir `A - B` en vez del feo `A + (-B)`. */
function extraerSigno(n: Nodo): { signo: 1 | -1; mag: Nodo } {
  if (n.type === "ParenthesisNode") return extraerSigno(n.content);
  if (n.type === "OperatorNode") {
    if (n.op === "-" && n.args.length === 1) {
      const r = extraerSigno(n.args[0]); return { signo: -r.signo as 1 | -1, mag: r.mag };
    }
    if (n.op === "/" && n.args.length === 2) {
      const a = extraerSigno(n.args[0]);
      return { signo: a.signo, mag: new OperatorNode("/", "divide", [a.mag, n.args[1]]) };
    }
    if (n.op === "*" && n.args.length === 2) {
      const a = extraerSigno(n.args[0]), b = extraerSigno(n.args[1]);
      return { signo: (a.signo * b.signo) as 1 | -1, mag: new OperatorNode("*", "multiply", [a.mag, b.mag]) };
    }
  }
  if (n.type === "ConstantNode" && typeof n.value === "number" && n.value < 0)
    return { signo: -1, mag: new ConstantNode(-n.value) };
  return { signo: 1, mag: n };
}

/**
 * Candidata DISTRIBUIDA de la derivada de un PRODUCTO de nivel superior: aplica la regla
 * del producto término a término (`(u·v)' = u'·v + u·v'`) y limpia CADA término por
 * separado (`combinarFracciones`), SIN unificar a común denominador. Frente a la forma
 * combinada —una sola fracción cuyo numerador vuelve a contener fracciones, p. ej.
 * `(arccot(x²)/2 − 2x²/(x⁴+1))/√x`— esta reparte la división y saca las raíces al
 * numerador donde toca (`u'·√x = 2x√x/(x⁴+1)`), dando términos PLANOS y legibles:
 * `arccot(x²)/(2√x) − 2x√x/(x⁴+1)`. Ordena positivos primero. null si no hay producto
 * (≥2 factores) o si algún factor no es derivable (escalón); esos casos caen a las demás
 * candidatas. Solo se ADOPTA si `simplificarDerivada` la juzga menos anidada/más corta Y
 * numéricamente equivalente a la derivada cruda.
 */
function derivadaDistribuida(norm: string): Nodo | null {
  let raiz: Nodo;
  try { raiz = parse(norm); } catch { return null; }
  const fs = factoresProducto(raiz);
  if (fs.length < 2) return null;
  const partes: { signo: 1 | -1; mag: Nodo }[] = [];
  for (let i = 0; i < fs.length; i++) {
    let di: Nodo;
    try { di = derivative(fs[i] as never, VAR); } catch { return null; } // factor no derivable (escalón)
    if (esCeroLiteral(di)) continue;                                     // factor constante: no aporta
    let termino: Nodo = di;
    for (let j = 0; j < fs.length; j++) if (j !== i)
      termino = new OperatorNode("*", "multiply", [termino, fs[j]]);
    try { termino = combinarFracciones(simplify(termino, REGLAS_DERIVADA as never)); }
    catch { /* término crudo: sigue siendo correcto, solo menos pulido */ }
    for (const t of terminosAditivos(termino)) {
      const { signo, mag } = extraerSigno(t.nodo);
      partes.push({ signo: (t.signo * signo) as 1 | -1, mag });
    }
  }
  if (partes.length === 0) return parse("0");
  const orden = [...partes.filter((p) => p.signo === 1), ...partes.filter((p) => p.signo === -1)];
  let s = "";
  orden.forEach((p, i) => {
    const cuerpo = p.mag.toString();
    if (i === 0) s = p.signo === 1 ? cuerpo : `-(${cuerpo})`;
    else s += p.signo === 1 ? ` + ${cuerpo}` : ` - (${cuerpo})`;
  });
  try { return parse(s); } catch { return null; }
}

/**
 * Etapa de simplificación algebraica POSTERIOR a `derivative`. Candidatas: reglas de
 * raíces (`sqrt(u)²→u`), `combinarFracciones` (una sola fracción: común denominador,
 * cancelación, numerador expandido) y —para productos— `derivadaDistribuida` (regla del
 * producto por términos). Se adopta la de MENOR COSTE léxico —primero MENOS fracciones
 * ANIDADAS, luego más corta— que sea numéricamente EQUIVALENTE a la derivada cruda (mismos
 * valores y mismo dominio sobre la muestra). La cruda es la referencia y el suelo del
 * coste: si ninguna candidata mejora, se conserva. Así la legibilidad nunca compra un
 * cambio de la función graficada, y una fracción de fracciones pierde ante términos planos
 * equivalentes (`arccot(x²)/(2√x) − 2x√x/(x⁴+1)`, no `(arccot(x²)/2 − 2x²/(x⁴+1))/√x`).
 */
function simplificarDerivada(cruda: Nodo, norm: string): Nodo {
  const ref = cruda.toString();
  const candidatas: Nodo[] = [];
  try {
    const conRaices = simplify(cruda, REGLAS_DERIVADA as never);
    try { candidatas.push(combinarFracciones(conRaices)); } catch { /* estructura no soportada */ }
    candidatas.push(conRaices);
  } catch { /* sin candidatas: se queda la cruda */ }
  const dist = derivadaDistribuida(norm);
  if (dist) candidatas.push(dist);
  const costo = (n: Nodo): [number, number] => [profundidadFraccion(n), n.toString().length];
  const menor = (a: [number, number], b: [number, number]): boolean =>
    a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];
  let mejor: Nodo = cruda, mejorCosto = costo(cruda);
  for (const c of candidatas) {
    try {
      if (menor(costo(c), mejorCosto) && derivadasEquivalentes(c.toString(), ref)) {
        mejor = c; mejorCosto = costo(c);
      }
    } catch { /* candidata inválida: se ignora */ }
  }
  return mejor;
}

// Funciones ESCALÓN (piso y techo): `derivative` de mathjs no sabe derivarlas (lanza).
// Política: derivada "donde existe" — un escalón es localmente CONSTANTE, así que su
// aporte por regla de la cadena es 0 fuera de los saltos; los saltos (argumento entero,
// medida cero, invisibles al graficar) no se representan. El DOMINIO del argumento SÍ
// se conserva: cada escalón añade un término 0·u′ (NaN donde u no es derivable), de
// modo que d/dx ⌊√x⌋ vale 0 solo donde √x existe, no en toda la recta. La guardia
// numérica de `simplificarDerivada` protege ese término: una candidata que lo pliegue
// a un 0 liso se rechaza si cambia la no-finitud en algún punto de muestra.
const FUNCIONES_ESCALON = new Set(["floor", "ceil"]);

/** ¿El nodo es el literal 0? (para no encadenar sumas `0 + …` al componer términos). */
const esCeroLiteral = (n: Nodo): boolean => n.type === "ConstantNode" && n.value === 0;

/**
 * `derivative` con soporte de floor/ceil por SUSTITUCIÓN: cada escalón se reemplaza
 * (de dentro hacia fuera) por un símbolo opaco que `derivative` trata como constante
 * —que ES su comportamiento local—; se deriva, se suman los términos 0·u′ de dominio
 * y se restauran los escalones originales en el resultado (sobreviven donde la regla
 * del producto los conserva: d/dx (x·⌊x⌋) = ⌊x⌋). Sin escalones, la ruta de siempre.
 */
function derivarConEscalones(norm: string): Nodo {
  const escalones: { nombre: string; original: Nodo; arg: Nodo }[] = [];
  const sustituir = (n: Nodo): Nodo => {
    const m = n.map(sustituir);
    if (m.type === "FunctionNode" && m.args?.length === 1 && FUNCIONES_ESCALON.has(m.fn?.name)) {
      const nombre = `escalonInterno${escalones.length}`;
      // `original` es el subárbol INTACTO (con sus escalones interiores reales);
      // `arg` es el argumento YA sustituido, para derivar u′ tratando los escalones
      // anidados también como constantes.
      escalones.push({ nombre, original: n, arg: m.args[0] });
      return new SymbolNode(nombre);
    }
    return m;
  };
  const cuerpo = sustituir(parse(norm));
  if (escalones.length === 0) return derivative(norm, VAR); // sin escalones: intacto

  let total: Nodo = derivative(cuerpo as never, VAR);
  for (const e of escalones) {
    const du: Nodo = derivative(e.arg as never, VAR);
    // u′ constante = argumento derivable en toda la recta: su 0·u′ es un 0 liso que
    // no aporta dominio; se omite para no ensuciar la derivada mostrada.
    if (du.type === "ConstantNode") continue;
    const termino = new OperatorNode("*", "multiply", [new ConstantNode(0), du]);
    total = esCeroLiteral(total)
      ? termino
      : new OperatorNode("+", "add", [total, termino]);
  }
  const porNombre = new Map(escalones.map((e) => [e.nombre, e.original]));
  const restaurar = (n: Nodo): Nodo => {
    const m = n.map(restaurar);
    return m.type === "SymbolNode" && porNombre.has(m.name) ? porNombre.get(m.name) : m;
  };
  return restaurar(total);
}

// ── Doble signo (±, ∓) ───────────────────────────────────────────────────────
//
// `derivative` de mathjs no conoce los centinelas `pm`/`mp` (parser.ts) y lanza. Pero la
// derivada del doble signo es trivial —`d/dx(±u) = ±u′`: el signo es una CONSTANTE ±1—, así
// que se aplica el mismo truco que con los escalones: sustituir el centinela por un SÍMBOLO
// opaco (que `derivative` trata como constante), derivar, y restaurarlo en el resultado.
// Así `\frac{d}{dx}(\pm\sqrt{x})` da `\pm 1/(2√x)` en vez de "no derivable" (o, peor: lo que
// hacía antes, derivar la sopa de letras `p*m*...` y mostrar una derivada FALSA).
const SIMBOLO_SIGNO: Record<string, string> = { pm: "signoPmInterno", mp: "signoMpInterno" };
const CENTINELA_DE_SIMBOLO = new Map(Object.entries(SIMBOLO_SIGNO).map(([fn, s]) => [s, fn]));

/** Nº de veces que aparece el símbolo `nombre` en el subárbol. */
function contarSimbolo(n: Nodo, nombre: string): number {
  let total = 0;
  n.forEach((h: Nodo) => { total += contarSimbolo(h, nombre); });
  return total + (n.type === "SymbolNode" && n.name === nombre ? 1 : 0);
}

/** Producto que NO arrastra el factor 1 que deja la extracción del símbolo de signo (si no,
 *  `d/dx(±x²)` saldría como `\pm 2·1·x`). */
const producto = (a: Nodo, b: Nodo): Nodo =>
  a.type === "ConstantNode" && a.value === 1 ? b
    : b.type === "ConstantNode" && b.value === 1 ? a
      : new OperatorNode("*", "multiply", [a, b]);

/** El nodo SIN el símbolo `nombre`, que debe estar como FACTOR multiplicativo (posiblemente
 *  en el numerador de una fracción o bajo un menos unario). null si no lo está: entonces el
 *  ± no se puede sacar factor común del término y la derivada no se representa con `pm`. */
function sacarFactorSimbolo(n: Nodo, nombre: string): Nodo | null {
  if (n.type === "SymbolNode" && n.name === nombre) return new ConstantNode(1);
  if (n.type === "ParenthesisNode") return sacarFactorSimbolo(n.content, nombre);
  if (n.type === "OperatorNode" && n.op === "-" && n.args.length === 1) {
    const a = sacarFactorSimbolo(n.args[0], nombre);
    return a && new OperatorNode("-", "unaryMinus", [a]);
  }
  if (n.type === "OperatorNode" && n.args.length === 2) {
    if (n.op === "*") {
      const izq = sacarFactorSimbolo(n.args[0], nombre);
      if (izq) return producto(izq, n.args[1]);
      const der = sacarFactorSimbolo(n.args[1], nombre);
      return der && producto(n.args[0], der);
    }
    if (n.op === "/") {
      const num = sacarFactorSimbolo(n.args[0], nombre);
      return num && new OperatorNode("/", "divide", [num, n.args[1]]);
    }
  }
  return null;
}

/** Restaura los centinelas ± en la derivada: por cada TÉRMINO aditivo que contenga un
 *  símbolo de signo, lo saca como factor y envuelve el término en `pm(…)`/`mp(…)`. Lanza si
 *  el símbolo no es un factor del término (p. ej. quedó dentro de un seno): ese resultado no
 *  es representable con un solo ± y es preferible declararlo no derivable. */
function restaurarSignos(n: Nodo): Nodo {
  if (n.type === "OperatorNode" && (n.op === "+" || n.op === "-") && n.args.length === 2)
    return new OperatorNode(n.op, n.fn, [restaurarSignos(n.args[0]), restaurarSignos(n.args[1])]);
  if (n.type === "ParenthesisNode") return restaurarSignos(n.content);

  for (const [simbolo, centinela] of CENTINELA_DE_SIMBOLO) {
    const veces = contarSimbolo(n, simbolo);
    if (veces === 0) continue;
    const sin = veces === 1 ? sacarFactorSimbolo(n, simbolo) : null;
    if (!sin) throw new Error("signo no factorizable");
    return new FunctionNode(new SymbolNode(centinela), [sin]);
  }
  return n;
}

/** La expresión con los centinelas ± sustituidos por símbolos opacos (constantes para
 *  `derivative`). Devuelve el string mathjs y si hubo alguna sustitución. */
function sustituirSignos(norm: string): { expr: string; hay: boolean } {
  const raiz = parse(norm);
  let hay = false;
  const sustituir = (n: Nodo): Nodo => {
    const m = n.map(sustituir);
    const s = m.type === "FunctionNode" && m.args?.length === 1 ? SIMBOLO_SIGNO[m.fn?.name] : undefined;
    if (!s) return m;
    hay = true;
    return new OperatorNode("*", "multiply", [new SymbolNode(s), m.args[0]]);
  };
  const expr = sustituir(raiz).toString();
  return { expr, hay };
}

/**
 * Derivada simbólica de una expresión respecto de x, como STRING mathjs re-parseable
 * (encadenable, igual que despejar/simplificar), o null si no compila o mathjs no sabe
 * derivarla. La entrada se normaliza (LaTeX/Unicode → mathjs) e inserta el producto
 * implícito (3xy → 3*x*y) igual que el resto del pipeline.
 */
export function derivarExpr(expr: string): string | null {
  let norm = insertarProductoImplicito(normalizarEntrada(expr.trim()));
  if (norm === "") return null;
  // Función DEGENERADA (0/0, √−1, log base 1): no toma ningún valor real, así que no tiene
  // derivada. mathjs, en cambio, es álgebra formal y deriva la forma indeterminada como si
  // nada (`d/dx(0/0)` → `0`): el panel mostraba "f'(x) = 0" y el plano graficaba la recta y=0.
  // Aquí se corta, y el bloque cae a su etiqueta formal (el velo lo pone MotorExperimental).
  try {
    if (clasificarDegenerada(compilarFuncion(norm, VAR))) return null;
  } catch { /* no compila: lo resuelve el try de más abajo */ }
  let conSigno = false;
  try {
    const s = sustituirSignos(norm);
    norm = s.expr;
    conSigno = s.hay;
  } catch { return null; } // no parsea: nada que derivar
  try {
    if (conSigno) {
      // Con ±: derivar el símbolo opaco y restaurar el centinela en el resultado (arriba).
      return resimbolizarConstantes(
        racionalizarFracciones(restaurarSignos(simplificarDerivada(derivarConEscalones(norm), norm)))
      ).toString();
    }
    // Tras derivar: etapa de simplificación (fracciones combinadas, factores
    // cancelados; ver `simplificarDerivada`) y después `racionalizarFracciones`,
    // que colapsa los racionales anidados que deja `derivative` (`d/dx √x` →
    // `(1/2)/√x` → `1/(2√x)`). `resimbolizarConstantes` es el ÚLTIMO paso: recupera
    // las constantes irracionales que mathjs decimaliza (`d/dx 3^x` = `\ln 3·3^x`,
    // no `1.0986·3^x` —que además rompe el LaTeX pegando `\ln 3` al `3^x`—). Sigue
    // siendo re-parseable/graficable igual (el valor no cambia, solo la forma).
    return resimbolizarConstantes(
      racionalizarFracciones(simplificarDerivada(derivarConEscalones(norm), norm))
    ).toString();
  } catch {
    return null; // no compila, o mathjs no sabe derivar esta expresión
  }
}

/**
 * Derivada de la PRIMERA ecuación del bloque, como string mathjs re-parseable (lo que
 * grafica el motor), o null. obs-derivate grafica una sola función, igual que obs-graph.
 */
export function derivarEcuacion(ec: string): string | null {
  const f = extraerFuncion(ec);
  return f ? derivarExpr(f) : null;
}

/**
 * LaTeX del OPERADOR sin evaluar pero con la función original YA SIMPLIFICADA:
 * `\frac{d}{dx}\left(simplify(f)\right)` (p. ej. `x+x+x+x+x+x` → `\frac{d}{dx}(6x)`), o null
 * si el bloque no es explícito. Simplifica la FUNCIÓN escrita con el MISMO pipeline que el
 * "Simplificar" de obs-graph (`simplificarEcuaciones`, orden canónico) y la incrusta en el
 * operador por `exprALatex`. Alimenta la opción "Simplificar" del panel de obs-derivate: NO
 * toca la derivada evaluada (que sigue siendo la misma), solo limpia lo que se deriva. El
 * host la ofrece solo si difiere del operador sin simplificar (si no, no habría nada que
 * simplificar).
 */
export function derivadaOperadorSimplificadoLatex(ecuaciones: readonly string[]): string | null {
  const f = ecuaciones.length ? extraerFuncion(ecuaciones[0]) : null;
  if (f === null) return null;
  const simp = simplificarEcuaciones([f])[0];
  return `\\frac{d}{d${VAR}}\\left(${exprALatex(simp)}\\right)`;
}

/**
 * LaTeX del OPERADOR sin evaluar (vista "Original" del panel): `\frac{d}{dx}\left(f\right)`,
 * con f la función de entrada por el pipeline tipográfico compartido. Bloque vacío o no
 * explícito → marcador `\text{[...]}`.
 */
export function derivadaOperadorLatex(ecuaciones: readonly string[]): string {
  const f = ecuaciones.length ? extraerFuncion(ecuaciones[0]) : null;
  const cuerpo = f ? exprALatex(f) : "\\text{[...]}";
  return `\\frac{d}{d${VAR}}\\left(${cuerpo}\\right)`;
}

/**
 * LaTeX de la derivada EVALUADA (vista "Derivada" del panel): `f'\left(x\right) = …`.
 * Si no se puede derivar, `\text{[...]}` tras el signo (mismo criterio que el operador).
 */
export function derivadaLatex(ecuaciones: readonly string[]): string {
  const d = ecuaciones.length ? derivarEcuacion(ecuaciones[0]) : null;
  const cuerpo = d ? exprALatex(d) : "\\text{[...]}";
  return `f'\\left(${VAR}\\right) = ${cuerpo}`;
}
