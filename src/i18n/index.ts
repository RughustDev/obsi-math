// ─────────────────────────────────────────────
// i18n · Textos de la interfaz (internacionalización)
// ─────────────────────────────────────────────
//
// Módulo AGNÓSTICO del framework (no toca Obsidian ni el DOM): solo tablas de textos y
// un puntero al idioma activo. El host (host-obsidian/*) fija el idioma al cargar el
// plugin y en cada cambio de la pestaña de ajustes, y consume `t()` para pintar.
//
// El MOTOR (src/motor, degeneradas.ts, integral.ts…) NO depende de este módulo: sigue
// devolviendo sus etiquetas canónicas en español (las fijan los tests). Esas —y solo
// esas— se traducen en la frontera del host con `localizarVelo`, un mapa es→en de las
// etiquetas del velo. Por eso el idioma por defecto es inglés pero el núcleo no cambia.

export type Idioma = "en" | "es";

export const IDIOMAS: readonly Idioma[] = ["en", "es"];
export const IDIOMA_POR_DEFECTO: Idioma = "en";

/** Etiqueta + detalle de una tarjeta del velo (misma forma que `FuncionDegenerada`). */
interface EtiquetaVelo { etiqueta: string; detalle: string }

/** Contrato de todos los textos de la interfaz. Las entradas con interpolación son
 *  funciones; el resto, strings. Ambos idiomas implementan esta MISMA forma. */
export interface Textos {
  aviso: { cargado: string };
  ajustes: {
    transformaciones: string;
    despejarAuto: EtiquetaVelo;
    plano: string;
    puntosNotables: EtiquetaVelo;
    encuadreAuto: EtiquetaVelo;
    idioma: {
      seccion: string;
      nombre: string;
      desc: string;
      opcionEn: string;
      opcionEs: string;
    };
  };
  badge: { sistema: string; integral: string; general: string };
  canvasNoDisponible: string;
  botones: {
    vistaInicial: string;
    acercar: string;
    alejar: string;
    carril: string;
    seleccionarEcuacion: (n: number) => string;
    solucionesSistema: string;
    resumenNotables: string;
    original: string;
    transformaciones: string;
    despejarY: string;
    operador: string;
    derivadaEvaluada: string;
    derivada: string;
    operadorYDerivada: string;
    primitivaEvaluada: string;
    primitiva: string;
    operadorYPrimitiva: string;
  };
  solucion: {
    sinSistema: string;
    sistemaIncompleto: string;
    infinitasCoinciden: string;
    infinitasPeriodico: string;
    demasiadas: string;
    sinSolucion: string;
    unaSolucion: string;
    nSoluciones: (n: number) => string;
    yMas: (n: number) => string;
    enVista: string;
  };
  resumen: {
    interseccionesYInfinitas: string;
    interseccionesYDemasiadas: string;
    interseccionY: (y: string) => string;
    noCortaY: string;
    raicesInfinitas: string;
    raicesDemasiadas: string;
    raicesPrefijo: string;
    noRaices: string;
    verticesInfinitos: string;
    verticesDemasiados: string;
    noVertices: string;
    vertice: (x: string, y: string) => string;
    interseccionYCero: string;
    identicamenteCero: string;
    interseccionYNoDefinida: string;
    verticeMin: (x: string, y: string) => string;
    verticeMax: (x: string, y: string) => string;
    enVista: string;
  };
  velo: {
    simboloNoSoportado: string;
    simbolosNoSoportados: string;
    simboloDetalle: (lista: string) => string;
    integrandoNoValido: EtiquetaVelo;
    sinIntegral: EtiquetaVelo;
    sinSistema: EtiquetaVelo;
    sistemaIncompleto: EtiquetaVelo;
    sinFuncion: EtiquetaVelo;
  };
}

// ── Inglés (idioma por defecto) ──────────────────────────────────────────────
const EN: Textos = {
  aviso: { cargado: "LMath loaded successfully!" },
  ajustes: {
    transformaciones: "Transformations",
    despejarAuto: {
      etiqueta: "Solve automatically",
      detalle:
        "When rendering an equation, show the solved result (y = f(x)) directly " +
        "without pressing «Solve». The «Solve» button is hidden from the panel.",
    },
    plano: "Plane",
    puntosNotables: {
      etiqueta: "Show notable points",
      detalle:
        "Draws the markers for roots, vertices, Y-intercepts and the solutions " +
        "(crossings) of systems on the plane. When disabled the plane stays clean: " +
        "the ⓘ summary still lists them, and the crosshair and rail mode do not change. " +
        "Applies when the block is re-rendered.",
    },
    encuadreAuto: {
      etiqueta: "Automatic framing",
      detalle:
        "Zooms the initial view in when the curve is bounded and leaves a lot of empty " +
        "plane (heart, lemniscate, astroid…). It only zooms in, never out: if the curve " +
        "reaches the edge of the view the usual framing is kept. The view stays centered " +
        "on the origin and is the one the restore key returns to. Applies when the block is re-rendered.",
    },
    idioma: {
      seccion: "Language",
      nombre: "Language",
      desc:
        "Language of the plugin interface (labels, buttons and messages). Applies " +
        "immediately to the settings; open blocks update when they are re-rendered.",
      opcionEn: "English",
      opcionEs: "Español",
    },
  },
  badge: {
    sistema: "Experimental engine — system of equations",
    integral: "Experimental engine — definite integral (area under the curve)",
    general: "Experimental engine — explicit · implicit · parametric · polar",
  },
  canvasNoDisponible: "Error: Canvas 2D not available",
  botones: {
    vistaInicial: "Initial view (undo zoom and pan)",
    acercar: "Zoom in (+)",
    alejar: "Zoom out (−)",
    carril: "Rail: follow the curve with A/D, zoom with W/S (Shift = precision)",
    seleccionarEcuacion: (n) => `Select equation ${n}`,
    solucionesSistema: "System solutions",
    resumenNotables: "Notable points summary",
    original: "Original",
    transformaciones: "Transformations",
    despejarY: "Solve for y",
    operador: "Operator",
    derivadaEvaluada: "Evaluated derivative",
    derivada: "Derivative",
    operadorYDerivada: "Operator and derivative",
    primitivaEvaluada: "Evaluated antiderivative",
    primitiva: "Antiderivative",
    operadorYPrimitiva: "Operator and antiderivative",
  },
  solucion: {
    sinSistema: "There is no system. Write at least two equations (one per line).",
    sistemaIncompleto:
      "Incomplete system: at least one equation is missing. A system needs at least " +
      "two equations and two unknowns.",
    infinitasCoinciden:
      "Infinitely many solutions: the curves coincide over a stretch (they are the same).",
    infinitasPeriodico:
      "Infinitely many solutions: the system is periodic (the solutions repeat endlessly).",
    demasiadas: "Too many solutions in this view to list; zoom in.",
    sinSolucion: "No solution in the current view.",
    unaSolucion: "Solution:",
    nSoluciones: (n) => `Solutions (${n}):`,
    yMas: (n) => `… and ${n} more`,
    enVista: "In the current view.",
  },
  resumen: {
    interseccionesYInfinitas: "Y-axis intercepts: infinitely many",
    interseccionesYDemasiadas: "Y-axis intercepts: too many to show",
    interseccionY: (y) => `Y-intercept: (0, ${y})`,
    noCortaY: "Does not cross the Y axis",
    raicesInfinitas: "Roots: infinitely many",
    raicesDemasiadas: "Roots: too many to show",
    raicesPrefijo: "Roots: ",
    noRaices: "No real roots",
    verticesInfinitos: "Vertices: infinitely many",
    verticesDemasiados: "Vertices: too many to show",
    noVertices: "No vertices",
    vertice: (x, y) => `Vertex: (${x}, ${y})`,
    interseccionYCero: "Y-intercept: (0, 0)",
    identicamenteCero: "Every value of x is a root (identically zero function).",
    interseccionYNoDefinida: "Y-intercept: undefined (discontinuity at x=0)",
    verticeMin: (x, y) => `Minimum vertex: (${x}, ${y})`,
    verticeMax: (x, y) => `Maximum vertex: (${x}, ${y})`,
    enVista: "In the current view.",
  },
  velo: {
    simboloNoSoportado: "Unsupported symbol",
    simbolosNoSoportados: "Unsupported symbols",
    simboloDetalle: (lista) =>
      `The engine does not recognize ${lista}. Rewrite the expression without that ` +
      "symbol (or use its equivalent: \\cdot, \\times, \\div, \\pm, \\sqrt, \\frac…).",
    integrandoNoValido: {
      etiqueta: "Invalid integrand",
      detalle:
        "The integrand must be a function of x. An equation (implicit curve, with `=` " +
        "or with `y`) is not integrated: graph it in an obs-graph block.",
    },
    sinIntegral: {
      etiqueta: "No integral",
      detalle: "Write a definite integral in LaTeX, e.g. \\int_{a}^{b} f(x)\\,dx.",
    },
    sinSistema: {
      etiqueta: "No system",
      detalle: "Write a system of equations, one per line (at least two).",
    },
    sistemaIncompleto: {
      etiqueta: "Incomplete system",
      detalle:
        "At least one equation is missing: a system needs at least two equations " +
        "and two unknowns.",
    },
    sinFuncion: {
      etiqueta: "No function",
      detalle: "Write a math expression to graph.",
    },
  },
};

// ── Español ──────────────────────────────────────────────────────────────────
const ES: Textos = {
  aviso: { cargado: "¡LMath se ha cargado correctamente!" },
  ajustes: {
    transformaciones: "Transformaciones",
    despejarAuto: {
      etiqueta: "Despejar automáticamente",
      detalle:
        "Al renderizar una ecuación, muestra directamente el resultado despejado " +
        "(y = f(x)) sin pulsar «Despejar». El botón «Despejar» se oculta del panel.",
    },
    plano: "Plano",
    puntosNotables: {
      etiqueta: "Mostrar puntos notables",
      detalle:
        "Pinta en el plano los marcadores de raíces, vértices, cortes con Y y las " +
        "soluciones (cruces) de los sistemas. Al desactivarlo el plano queda limpio: " +
        "el resumen ⓘ los sigue listando, y el crosshair y el modo carril no cambian. " +
        "Se aplica al volver a renderizar el bloque.",
    },
    encuadreAuto: {
      etiqueta: "Encuadre automático",
      detalle:
        "Acerca la vista inicial cuando la curva es acotada y deja mucho plano vacío " +
        "(corazón, lemniscata, astroide…). Solo acerca, nunca aleja: si la curva llega al " +
        "borde de la vista se deja el encuadre de siempre. La vista queda centrada en el " +
        "origen y es a la que vuelve la tecla de restaurar. Se aplica al volver a renderizar el bloque.",
    },
    idioma: {
      seccion: "Idioma",
      nombre: "Idioma",
      desc:
        "Idioma de la interfaz del plugin (etiquetas, botones y mensajes). Se aplica " +
        "de inmediato a los ajustes; los bloques abiertos se actualizan al volver a renderizarse.",
      opcionEn: "English",
      opcionEs: "Español",
    },
  },
  badge: {
    sistema: "Motor experimental — sistema de ecuaciones",
    integral: "Motor experimental — integral definida (área bajo la curva)",
    general: "Motor experimental — explícitas · implícitas · paramétricas · polares",
  },
  canvasNoDisponible: "Error: Canvas 2D no disponible",
  botones: {
    vistaInicial: "Vista inicial (deshace zoom y desplazamiento)",
    acercar: "Acercar (zoom +)",
    alejar: "Alejar (zoom −)",
    carril: "Carril: recorrer la curva con A/D, zoom con W/S (Shift = precisión)",
    seleccionarEcuacion: (n) => `Seleccionar ecuación ${n}`,
    solucionesSistema: "Soluciones del sistema",
    resumenNotables: "Resumen de puntos notables",
    original: "Original",
    transformaciones: "Transformaciones",
    despejarY: "Despejar y",
    operador: "Operador",
    derivadaEvaluada: "Derivada evaluada",
    derivada: "Derivada",
    operadorYDerivada: "Operador y derivada",
    primitivaEvaluada: "Primitiva evaluada",
    primitiva: "Primitiva",
    operadorYPrimitiva: "Operador y primitiva",
  },
  solucion: {
    sinSistema: "No hay ningún sistema. Escribe al menos dos ecuaciones (una por línea).",
    sistemaIncompleto:
      "Sistema incompleto: falta al menos una ecuación. Un sistema necesita como " +
      "mínimo dos ecuaciones y dos incógnitas.",
    infinitasCoinciden:
      "Infinitas soluciones: las curvas coinciden en un tramo (son la misma).",
    infinitasPeriodico:
      "Infinitas soluciones: el sistema es periódico (las soluciones se repiten sin fin).",
    demasiadas: "Demasiadas soluciones en esta vista para enumerarlas; acerca el zoom.",
    sinSolucion: "Sin solución en la vista actual.",
    unaSolucion: "Solución:",
    nSoluciones: (n) => `Soluciones (${n}):`,
    yMas: (n) => `… y ${n} más`,
    enVista: "En la vista actual.",
  },
  resumen: {
    interseccionesYInfinitas: "Intersecciones con el eje Y: infinitas",
    interseccionesYDemasiadas: "Intersecciones con el eje Y: demasiadas para mostrar",
    interseccionY: (y) => `Intersección Y: (0, ${y})`,
    noCortaY: "No corta el eje Y",
    raicesInfinitas: "Raíces: infinitas",
    raicesDemasiadas: "Raíces: demasiadas para mostrar",
    raicesPrefijo: "Raíces: ",
    noRaices: "No hay raíces reales",
    verticesInfinitos: "Vértices: infinitos",
    verticesDemasiados: "Vértices: demasiados para mostrar",
    noVertices: "No hay vértices",
    vertice: (x, y) => `Vértice: (${x}, ${y})`,
    interseccionYCero: "Intersección Y: (0, 0)",
    identicamenteCero: "Todos los valores de x son raíces (función idénticamente cero).",
    interseccionYNoDefinida: "Intersección Y: no definida (discontinuidad en x=0)",
    verticeMin: (x, y) => `Vértice mínimo: (${x}, ${y})`,
    verticeMax: (x, y) => `Vértice máximo: (${x}, ${y})`,
    enVista: "En la vista actual.",
  },
  velo: {
    simboloNoSoportado: "Símbolo no soportado",
    simbolosNoSoportados: "Símbolos no soportados",
    simboloDetalle: (lista) =>
      `El motor no reconoce ${lista}. Reescribe la expresión sin ese símbolo ` +
      "(o usa su equivalente: \\cdot, \\times, \\div, \\pm, \\sqrt, \\frac…).",
    integrandoNoValido: {
      etiqueta: "Integrando no válido",
      detalle:
        "El integrando debe ser una función de x. Una ecuación (curva implícita, " +
        "con `=` o con `y`) no se integra: grafícala en un bloque obs-graph.",
    },
    sinIntegral: {
      etiqueta: "Sin integral",
      detalle: "Escribe una integral definida en LaTeX, p. ej. \\int_{a}^{b} f(x)\\,dx.",
    },
    sinSistema: {
      etiqueta: "Sin sistema",
      detalle: "Escribe un sistema de ecuaciones, una por línea (mínimo dos).",
    },
    sistemaIncompleto: {
      etiqueta: "Sistema incompleto",
      detalle:
        "Falta al menos una ecuación: un sistema necesita como mínimo dos ecuaciones " +
        "y dos incógnitas.",
    },
    sinFuncion: {
      etiqueta: "Sin función",
      detalle: "Escribe una expresión matemática para graficar.",
    },
  },
};

const RECURSOS: Record<Idioma, Textos> = { en: EN, es: ES };

// Traducciones al INGLÉS de las etiquetas del velo que produce el NÚCLEO (motor), keadas
// por su texto CANÓNICO en español (el que fijan los tests). En español se devuelven tal
// cual (el núcleo ya las produce en ese idioma), así que solo se necesita el mapa es→en.
const VELO_NUCLEO_EN: Record<string, EtiquetaVelo> = {
  "Indefinida": {
    etiqueta: "Undefined",
    detalle: "The expression is not defined over ℝ.",
  },
  "No definida en ℝ": {
    etiqueta: "Not defined over ℝ",
    detalle: "The expression produces complex values and cannot be represented on the real plane.",
  },
  "Indeterminada": {
    etiqueta: "Indeterminate",
    detalle: "The expression produces an indeterminate form.",
  },
  "Integral divergente": {
    etiqueta: "Divergent integral",
    detalle: "The integral does not converge: the function is unbounded on the interval.",
  },
  "Fuera de dominio": {
    etiqueta: "Out of domain",
    detalle: "The integration interval falls outside the function's real domain.",
  },
  "Límites no numéricos": {
    etiqueta: "Non-numeric limits",
    detalle: "The integration limits do not evaluate to a real number.",
  },
};

let idiomaActual: Idioma = IDIOMA_POR_DEFECTO;

/** Fija el idioma activo (validado; un valor desconocido cae al idioma por defecto). */
export function fijarIdioma(id: string | undefined): void {
  idiomaActual = (IDIOMAS as readonly string[]).includes(id ?? "")
    ? (id as Idioma)
    : IDIOMA_POR_DEFECTO;
}

/** Idioma activo. */
export function idiomaActivo(): Idioma {
  return idiomaActual;
}

/** Textos del idioma activo. Uso: `t().botones.acercar`, `t().solucion.yMas(3)`. */
export function t(): Textos {
  return RECURSOS[idiomaActual];
}

/**
 * Localiza una etiqueta de velo PRODUCIDA POR EL NÚCLEO (español canónico) al idioma
 * activo. En español se devuelve intacta; en inglés se busca su traducción por el texto
 * canónico y, si no está mapeada, se conserva el original (nunca rompe el render).
 */
export function localizarVelo(velo: EtiquetaVelo): EtiquetaVelo {
  if (idiomaActual === "es") return velo;
  return VELO_NUCLEO_EN[velo.etiqueta] ?? velo;
}
