import { dividirEcuaciones } from "../motor/parsing/dividirEcuaciones";
import { construirObjeto } from "../motor/parsing/construirObjeto";
import { insertarProductoImplicito } from "../motor/parsing/productoImplicito";
import { normalizarEntrada } from "../parser";
import { bloqueALatex } from "../latex";
import { simplificarEcuaciones } from "../simplificar";
import { despejarEcuaciones, despejarY } from "../despejar";
import {
  extraerFuncion,
  derivarEcuacion,
  derivadaLatex,
  derivadaOperadorLatex,
  derivadaOperadorSimplificadoLatex,
} from "../derivar";
import {
  extraerIntegral,
  integralOperadorLatex,
  integralValorLatex,
  integralPrimitivaLatex,
  cuerpoAreaLatexExacto,
  etiquetaIntegral,
} from "../integral";

// ─────────────────────────────────────────────
// Trazador de transformaciones (herramienta de desarrollo)
// ─────────────────────────────────────────────
//
// Núcleo PURO (sin DOM, sin Obsidian) que reproduce, paso a paso, lo que hace un bloque
// obs-graph / obs-system / obs-derivate SIN pintar nada: para cada paso del pipeline
// devuelve tanto el STRING mathjs re-parseable (lo que el motor ENTREGA/grafica) como el
// LaTeX que el panel pasaría a KaTeX (lo que RENDERIZA), más un diagnóstico de
// clasificación. No reimplementa el pipeline: llama a las MISMAS funciones que el panel y
// el motor (`dividirEcuaciones`, `simplificarEcuaciones`, `despejarEcuaciones`,
// `bloqueALatex`, `derivada*Latex`, `derivarEcuacion`), así el trazado no puede divergir
// de lo que el usuario ve realmente. Lo consumen la CLI de terminal y el global de consola.

/** Los cuatro bloques Markdown del plugin, como identificador corto interno. */
export type TipoBloque = "graph" | "system" | "derivate" | "integral";

/** Un paso del pipeline: su etiqueta, el/los string(s) mathjs que grafica y su LaTeX. */
export interface Paso {
  etiqueta: string;
  /** Strings re-parseables (lo que el motor evaluaría/grafica en este paso). */
  mathjs: readonly string[];
  /** LaTeX que el panel entregaría a KaTeX en este paso. */
  latex: string;
  /** Aclaración opcional (p. ej. "sin cambio", "despeje parcial", "no derivable"). */
  nota?: string;
}

/** Clasificación de UNA ecuación de entrada (independiente de las transformaciones). */
export interface Diagnostico {
  entrada: string;
  /** La entrada tras `normalizarEntrada` + producto implícito: lo que el motor compila. */
  normalizada: string;
  /** Tipo del objeto (`explicita`/`implicita`/`parametrica`/`polar`) o motivo si no clasifica. */
  tipo: string;
  /** Notas adicionales (despeje completo/parcial, función derivable, etc.). */
  extra?: string;
}

/** Trazado de UN bloque lógico (una curva de obs-graph/derivate, o el sistema completo). */
export interface BloqueTrazado {
  entrada: readonly string[];
  pasos: Paso[];
  diagnostico: Diagnostico[];
}

/** Resultado completo: uno o varios bloques (varios cuando se pasan varias ecuaciones a
 *  graph/derivate: cada ecuación es una curva independiente y se traza por separado). */
export interface Trazado {
  tipo: TipoBloque;
  bloques: BloqueTrazado[];
}

/** Normaliza un tipo escrito por el usuario a su identificador interno. Acepta los nombres
 *  de bloque (`obs-graph`), formas cortas (`graph`) y sinónimos en español (`grafo`). */
export function normalizarTipo(bruto: string): TipoBloque {
  const t = bruto.trim().toLowerCase().replace(/^obs-/, "");
  if (t === "system" || t === "sistema") return "system";
  if (t === "derivate" || t === "derivada" || t === "derivar") return "derivate";
  if (t === "integral" || t === "integrate" || t === "integrar") return "integral";
  return "graph"; // por defecto y para "graph"/"grafo"/"grafico"
}

/**
 * Parte la entrada de la herramienta en ecuaciones. DOS formas:
 *  - Corchetes con `/`: `[ec1/ec2]` → separa por `/` (sintaxis de la herramienta para dar
 *    VARIAS ecuaciones en una línea de terminal/consola, donde los saltos de línea son
 *    incómodos). El `/` solo separa DENTRO de los corchetes: `x/2` (sin corchetes) sigue
 *    siendo una división normal, no se parte.
 *  - Sin corchetes: se delega en `dividirEcuaciones` (saltos de línea, `\begin{cases}`…),
 *    exactamente como un bloque real.
 */
export function parsearEntrada(bruto: string): string[] {
  const t = bruto.trim();
  const m = /^\[([\s\S]*)\]$/.exec(t);
  if (m) return m[1].split("/").map((s) => s.trim()).filter((s) => s.length > 0);
  return dividirEcuaciones(t);
}

/** `normalizarEntrada` + producto implícito: exactamente lo que el motor compila y grafica. */
function normalizada(ec: string): string {
  return insertarProductoImplicito(normalizarEntrada(ec.trim()));
}

/** Tipo del objeto, capturando cualquier fallo de clasificación en un motivo legible. */
function tipoDe(ec: string): string {
  if (normalizarEntrada(ec.trim()) === "") return "vacía";
  try {
    return construirObjeto(ec, "trazador").tipo;
  } catch (e) {
    return `no clasificable (${(e as Error).message})`;
  }
}

/** Diagnóstico de una ecuación para graph/system: tipo + normalizada + estado de despeje. */
function diagnosticoGraph(ec: string): Diagnostico {
  const d = despejarY(ec);
  const extra = d ? (d.completo ? "despeje completo" : "despeje PARCIAL (y no aislable del todo)")
                  : "sin y que despejar";
  return { entrada: ec, normalizada: normalizada(ec), tipo: tipoDe(ec), extra };
}

/** Igualdad laxa de dos listas de strings (para detectar pasos que no cambian nada). */
function igualLista(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Traza graph (una curva) o system (el sistema entero): Escrito → Simplificado → Despejar y. */
function trazarGraphSystem(ecs: readonly string[], sistema: boolean): BloqueTrazado {
  // Paso 1 — ORIGINAL (lo escrito): el motor grafica esta forma normalizada; el panel la
  // pinta por `bloqueALatex`. Es la forma de PARTIDA (aún sin simplificar).
  const escrito: Paso = {
    etiqueta: "Original (escrito)",
    mathjs: ecs.map(normalizada),
    latex: bloqueALatex(ecs, sistema),
  };

  // Paso 2 — SIMPLIFICADO: la base que el panel muestra por defecto (simplificación
  // automática e incondicional). Cada transformación va en su try/catch como en el panel.
  let simp: string[] = ecs.slice();
  try { simp = simplificarEcuaciones(ecs); } catch { /* conserva lo anterior */ }
  const simplificado: Paso = {
    etiqueta: "Simplificado",
    mathjs: simp,
    latex: bloqueALatex(simp, sistema),
    nota: igualLista(simp, ecs.map((e) => normalizarEntrada(e.trim()))) ? "sin cambio" : undefined,
  };

  // Paso 3 — DESPEJAR y: transformación manual del menú, encadenada SOBRE el simplificado
  // (igual que el toggle, cuyo estado parte de la base simplificada).
  let desp: string[] = simp.slice();
  try { desp = despejarEcuaciones(simp); } catch { /* conserva lo anterior */ }
  const despejado: Paso = {
    etiqueta: "Despejar y",
    mathjs: desp,
    latex: bloqueALatex(desp, sistema),
    nota: igualLista(desp, simp) ? "sin cambio (ya despejada o sin y)" : undefined,
  };

  return {
    entrada: ecs,
    pasos: [escrito, simplificado, despejado],
    diagnostico: ecs.map(diagnosticoGraph),
  };
}

/** Traza obs-derivate para UNA función: Operador (con f simplificada) → Derivada evaluada. */
function trazarDerivate(ec: string): BloqueTrazado {
  const f = extraerFuncion(ec); // ya desenvuelve un operador `\frac{d}{dx}(f)` si lo hubiera
  const derivada = derivarEcuacion(ec); // el STRING que el plano realmente grafica

  // Vista por defecto: el OPERADOR sin evaluar con la función ya simplificada (la forma de
  // partida del panel); cae al operador crudo si el bloque no es explícito.
  const operadorLatex = derivadaOperadorSimplificadoLatex([ec]) ?? derivadaOperadorLatex([ec]);
  const operador: Paso = {
    etiqueta: "Operador (función simplificada)",
    mathjs: [f ?? "(no explícito: no se deriva)"],
    latex: operadorLatex,
  };

  // La derivada EVALUADA: el resultado `f'(x)=…`; su string mathjs es lo que se grafica.
  const evaluada: Paso = {
    etiqueta: "Derivada evaluada",
    mathjs: [derivada ?? "(no derivable)"],
    latex: derivadaLatex([ec]),
    nota: "← el string mathjs es lo que grafica el plano",
  };

  const extra = f === null ? "no explícito: obs-derivate no lo deriva"
              : derivada === null ? `f(x)=${f} — mathjs no supo derivarla`
              : `f(x)=${f}`;

  return {
    entrada: [ec],
    pasos: [operador, evaluada],
    diagnostico: [{ entrada: ec, normalizada: normalizada(ec), tipo: tipoDe(ec), extra }],
  };
}

/**
 * Traza obs-integral: DETECTA la integral y EXTRAE sus piezas ANTES de tocar el parser
 * algebraico (que sobre `\int_a^b f\,dx` haría `i*n*t·…·d*x`). `extraerIntegral` separa
 * límites, integrando y variable; SOLO el integrando pasa a `normalizada` y es lo que el
 * plano grafica. Los pasos reflejan el panel (§6.5): Operador sin evaluar → Primitiva/Valor.
 */
function trazarIntegral(ec: string): BloqueTrazado {
  const it = extraerIntegral(ec);
  if (!it) {
    // No se reconoce como integral (sin `\int` o sin límites): se dice explícitamente, en vez
    // de mandar la cadena entera al parser algebraico (que la corrompería a `i*n*t…`).
    return {
      entrada: [ec],
      pasos: [],
      diagnostico: [{
        entrada: ec,
        normalizada: "(no aplica: no es una integral)",
        tipo: "no es una integral definida (falta \\int o algún límite)",
      }],
    };
  }

  // El plano grafica el INTEGRANDO (como el modo derivada grafica f′): solo esa pieza pasa por
  // el parser algebraico. Aquí se ve que recibe `(acot(x^2))/(2*sqrt(x))`, NO la integral entera.
  const integrandoNorm = normalizada(it.integrando);
  const operador = integralOperadorLatex(ec);
  const primitiva = integralPrimitivaLatex(ec);
  const { cuerpo, conector } = cuerpoAreaLatexExacto(ec);
  // Sin valor (`cuerpo === null`): el panel muestra solo la FÓRMULA y la etiqueta formal va al
  // plano (`etiquetaIntegral`). El trazador imprime esa etiqueta como NOTA, para que se vea qué
  // pintaría el bloque sin mentir sobre el contenido del panel.
  const etiqueta = cuerpo === null ? etiquetaIntegral(ec) : null;
  const valorLatex = cuerpo === null
    ? (primitiva ?? operador)
    : primitiva ? `${primitiva} ${conector} ${cuerpo}` : integralValorLatex(ec, cuerpo, conector);

  const pasoOperador: Paso = {
    etiqueta: "Operador (integral sin evaluar)",
    mathjs: [integrandoNorm],
    latex: operador,
    nota: "el plano grafica el integrando f(x)",
  };
  const pasoValor: Paso = {
    etiqueta: primitiva ? "Primitiva evaluada (Barrow)" : "Valor",
    mathjs: [integrandoNorm],
    latex: valorLatex,
    nota: etiqueta
      ? `sin valor → el PLANO muestra la etiqueta "${etiqueta.etiqueta}" (el panel, solo la fórmula)`
      : primitiva ? undefined : "sin primitiva elemental → valor numérico",
  };

  const extra = `∫  inferior=${it.a}  superior=${it.b}  integrando=${it.integrando}  variable=${it.variable}`;
  return {
    entrada: [ec],
    pasos: [pasoOperador, pasoValor],
    diagnostico: [{ entrada: ec, normalizada: integrandoNorm, tipo: tipoDe(it.integrando), extra }],
  };
}

/**
 * Traza la entrada completa para un tipo de bloque. En graph/derivate, varias ecuaciones
 * (`[ec1/ec2]`) se trazan como bloques INDEPENDIENTES (cada una es su propia curva); en
 * system, todas juntas forman UN sistema; en integral, la entrada es UNA integral completa
 * (no se parte por líneas: el `\int_{1/2}^{2}…` con `/` en un límite no debe dividirse).
 */
export function trazar(entrada: string, tipo: TipoBloque): Trazado {
  if (tipo === "integral") {
    return { tipo, bloques: [trazarIntegral(entrada.trim())] };
  }
  const ecs = parsearEntrada(entrada);
  if (tipo === "system") {
    return { tipo, bloques: [trazarGraphSystem(ecs, true)] };
  }
  if (tipo === "derivate") {
    return { tipo, bloques: (ecs.length ? ecs : [""]).map(trazarDerivate) };
  }
  return { tipo, bloques: (ecs.length ? ecs : [""]).map((ec) => trazarGraphSystem([ec], false)) };
}
