import { Plugin, Notice, MarkdownRenderer } from "obsidian";
import { evaluate, simplify, parse } from "mathjs";

// ─────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────

const FUNCIONES_TRIG = ["sin", "cos", "tan", "sec", "csc", "cot"] as const;
const FUNCIONES_LATEX = "sin|cos|tan|sec|csc|cot|log|ln";

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

/** Convierte sintaxis LaTeX/Unicode a sintaxis que MathJS pueda evaluar. */
function normalizarEntrada(raw: string): string {
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

  // — Fracciones LaTeX (antes de otros reemplazos) —
  expr = expr.replace(
    /\(\s*\{\\frac\{([^}]+)\}\{([^}]+)\}\s*\}\s*\)/g,
    "(($1)/($2))"
  );
  expr = expr.replace(/\(\s*\{([^{}]+)\}\s*\)/g, "($1)");
  expr = expr.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1)/($2)");

  // — Exponentes con llaves —
  expr = expr.replace(/\^\{([^}]+)\}/g, (_, exp) =>
    /^-?[a-zA-Z0-9]+$/.test(exp.trim()) ? "^" + exp.trim() : "^(" + exp.trim() + ")"
  );

  // — Logaritmos y logaritmo natural —
  expr = expr.replace(/\\log_\{([^{}]+)\}\s*\{([^{}]+)\}/g, "log($2,$1)");
  expr = expr.replace(/\\log_\{([^{}]+)\}\s*\(([^()]+)\)/g, "log($2,$1)");
  expr = expr.replace(/\\log_([a-zA-Z0-9.]+)\s*\{([^{}]+)\}/g, "log($2,$1)");
  expr = expr.replace(/\\log_([a-zA-Z0-9.]+)\s*\(([^()]+)\)/g, "log($2,$1)");
  expr = expr.replace(/\\ln\s*\{([^{}]+)\}/g, "log($1)");
  expr = expr.replace(/\\ln\s*\(([^()]+)\)/g, "log($1)");
  expr = expr.replace(/\\log\s*\{([^{}]+)\}/g, "log($1)");

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
  expr = expr.replace(/\\sqrt\{([^}]+)\}/g, "sqrt($1)");
  expr = expr.replace(/\\cdot/g, "*");
  expr = expr.replace(/\\([a-zA-Z]+)/g, "$1"); // comandos LaTeX residuales

  // — Radianes para literales numéricos en trig —
  expr = normalizarTrigonometria(expr);

  return expr;
}

// ─────────────────────────────────────────────
// LaTeX → presentación
// ─────────────────────────────────────────────

/** Elimina artefactos de espaciado que mathjs introduce en el LaTeX generado. */
function limpiarTex(tex: string): string {
  let resultado = tex;
  resultado = resultado.replace(/~\s*/g, "");
  resultado = resultado.replace(/\{\s*([a-zA-Z0-9])\s*\}/g, "$1");
  resultado = resultado.replace(/(\d)\s+([a-zA-Z\\])/g, "$1$2");
  return resultado.trim();
}

/**
 * Asegura que las funciones matemáticas en LaTeX lleven `\left(…\right)`.
 * Limitación conocida: los patrones de `\frac` son planos y no capturan
 * fracciones anidadas; en ese caso el renderizador de KaTeX lo resuelve igual.
 */
function agregarParentesisFuncionesLatex(tex: string): string {
  let resultado = tex;
  const fn = FUNCIONES_LATEX;

  // \sin{\frac{...}{...}} → \sin\left(\frac{...}{...}\right)
  resultado = resultado.replace(
    new RegExp(`\\\\(${fn})\\s*\\{(\\\\frac\\{[^{}]+\\}\\{[^{}]+\\})\\}`, "g"),
    "\\$1\\left($2\\right)"
  );

  // \sin{arg} → \sin\left(arg\right)
  resultado = resultado.replace(
    new RegExp(`\\\\(${fn})\\s*\\{([^{}]+)\\}`, "g"),
    "\\$1\\left($2\\right)"
  );

  // \operatorname{sin}\frac{...}{...} → \operatorname{sin}\left(\frac{...}{...}\right)
  resultado = resultado.replace(
    new RegExp(
      `\\\\operatorname\\{(${fn})\\}\\s*(\\\\frac\\{[^{}]+\\}\\{[^{}]+\\})`,
      "g"
    ),
    "\\operatorname{$1}\\left($2\\right)"
  );

  // \operatorname{sin} arg → \operatorname{sin}\left(arg\right)
  resultado = resultado.replace(
    new RegExp(`\\\\operatorname\\{(${fn})\\}\\s*([a-zA-Z0-9]+)`, "g"),
    "\\operatorname{$1}\\left($2\\right)"
  );

  // \sin \frac{...}{...} → \sin\left(\frac{...}{...}\right)
  resultado = resultado.replace(
    new RegExp(`\\\\(${fn})\\s*(\\\\frac\\{[^{}]+\\}\\{[^{}]+\\})`, "g"),
    "\\$1\\left($2\\right)"
  );

  // \sin arg → \sin\left(arg\right)
  resultado = resultado.replace(
    new RegExp(`\\\\(${fn})\\s+([a-zA-Z0-9]+)`, "g"),
    "\\$1\\left($2\\right)"
  );

  return resultado;
}

/** Quita llaves externas redundantes de una cadena LaTeX. */
function quitarLlavesExternas(texto: string): string {
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

/** Convierte una ecuación de texto a LaTeX (opcionalmente con `&=` para alineación). */
function ecuacionALatex(ecuacion: string, alineada = false): string {
  try {
    const partes = ecuacion.split("=");
    if (partes.length !== 2) return ecuacion;

    const lhsNorm = normalizarEntrada(partes[0].trim());
    const rhsOriginal = partes[1].trim();
    const rhsNorm = normalizarEntrada(rhsOriginal);

    const texLhs = agregarParentesisFuncionesLatex(
      limpiarTex(parse(lhsNorm).toTex({ parenthesis: "keep" }))
    );

    // Si el RHS ya contiene LaTeX lo usamos directamente para evitar doble conversión.
    const texRhs = rhsOriginal.includes("\\")
      ? agregarParentesisFuncionesLatex(rhsOriginal.trim())
      : agregarParentesisFuncionesLatex(
          limpiarTex(parse(rhsNorm).toTex({ parenthesis: "keep" }))
        );

    const signo = alineada ? "&=" : "=";
    return texLhs + signo + texRhs;
  } catch {
    return ecuacion;
  }
}

// ─────────────────────────────────────────────
// Sistemas de ecuaciones — LaTeX
// ─────────────────────────────────────────────

interface SistemaParseado {
  ecuaciones: string[];
  espacios: string[];
  usaCases: boolean;
}

function parsearSistemaCases(source: string): SistemaParseado {
  const texto = source.trim();
  const matchCases = texto.match(/^\\begin\{cases\}([\s\S]*)\\end\{cases\}$/);

  if (!matchCases) {
    return {
      ecuaciones: texto.split("\n").map(l => l.trim()).filter(Boolean),
      espacios: [],
      usaCases: false,
    };
  }

  const partes = matchCases[1].trim().split(/\\\\(?:\s*\[([^\]]+)\])?/g);
  const ecuaciones: string[] = [];
  const espacios: string[] = [];

  for (let i = 0; i < partes.length; i += 2) {
    const ecuacion = quitarLlavesExternas(partes[i]);
    if (!ecuacion) continue;

    ecuaciones.push(ecuacion);

    if (i + 1 < partes.length) {
      const espacio = partes[i + 1]?.trim();
      espacios.push(espacio ? `[${espacio}]` : "[1.5ex]");
    }
  }

  return { ecuaciones, espacios, usaCases: true };
}

function sistemaCasesALatex(ecuaciones: string[], espacios: string[]): string {
  const lineas = ecuaciones.map(ec => ecuacionALatex(ec, true));
  const contenido = lineas
    .map((linea, i) =>
      i < lineas.length - 1 ? linea + "\\\\" + (espacios[i] ?? "[1.5ex]") : linea
    )
    .join("");

  return `\\begin{cases}\\begin{aligned}${contenido}\\end{aligned}\\end{cases}`;
}

// ─────────────────────────────────────────────
// Sistemas de ecuaciones — Álgebra lineal
// ─────────────────────────────────────────────

interface EcuacionLineal {
  vars: Record<string, number>;
  rhs: number;
}

function parsearEcuacionLineal(ecuacion: string): EcuacionLineal | null {
  try {
    const partes = ecuacion.split("=");
    if (partes.length !== 2) return null;

    const lhs = normalizarEntrada(partes[0].trim());
    const rhs = normalizarEntrada(partes[1].trim());
    const exprDiferencia = `(${lhs})-(${rhs})`;
    const nodo = parse(exprDiferencia);

    // Recolectar variables simbólicas (las que no son constantes de MathJS)
    const variables = new Set<string>();
    (nodo as any).traverse((n: any) => {
      if (n.type !== "SymbolNode") return;
      try { evaluate(n.name); } catch { variables.add(n.name); }
    });

    const nombresVars = Array.from(variables).sort();
    const scopeCero: Record<string, number> = Object.fromEntries(
      nombresVars.map((v: string) => [v, 0])
    );

    const constante = evaluate(exprDiferencia, scopeCero);
    if (!isFinite(constante)) return null;

    const coefs: Record<string, number> = {};
    for (const v of nombresVars) {
      const valorConUno = evaluate(exprDiferencia, { ...scopeCero, [v as string]: 1 });
      if (!isFinite(valorConUno)) return null;
      const coef = valorConUno - constante;
      if (Math.abs(coef) > 1e-10) coefs[v] = coef;
    }

    // Verificar linealidad con valor=2
    for (const v of nombresVars) {
      const valorConDos = evaluate(exprDiferencia, { ...scopeCero, [v as string]: 2 });
      const esperado = constante + 2 * (coefs[v] ?? 0);
      if (!isFinite(valorConDos) || Math.abs(valorConDos - esperado) > 1e-8) return null;
    }

    return { vars: coefs, rhs: -constante };
  } catch {
    return null;
  }
}

/** Calcula el rango de una matriz mediante eliminación gaussiana con pivoteo parcial. */
function rangoMatriz(matrizOriginal: number[][]): number {
  const m = matrizOriginal.map(fila => fila.slice());
  const filas = m.length;
  const cols = m[0]?.length ?? 0;
  let rango = 0;

  for (let col = 0; col < cols && rango < filas; col++) {
    // Pivoteo parcial
    let maxFila = rango;
    for (let f = rango + 1; f < filas; f++) {
      if (Math.abs(m[f][col]) > Math.abs(m[maxFila][col])) maxFila = f;
    }
    if (Math.abs(m[maxFila][col]) < 1e-10) continue;

    [m[rango], m[maxFila]] = [m[maxFila], m[rango]];
    const pivote = m[rango][col];
    for (let j = col; j < cols; j++) m[rango][j] /= pivote;

    for (let f = 0; f < filas; f++) {
      if (f === rango) continue;
      const factor = m[f][col];
      for (let j = col; j < cols; j++) m[f][j] -= factor * m[rango][j];
    }
    rango++;
  }

  return rango;
}

type ResultadoSistema = Record<string, number> | string;

function resolverSistema(ecuaciones: string[]): ResultadoSistema {
  const parseadas = ecuaciones.map(parsearEcuacionLineal);
  if (parseadas.some(p => p === null))
    return "No se pudo parsear una o mas ecuaciones";

  // Unión de todas las variables
  const todasVars = Array.from(
    new Set(parseadas.flatMap((p: EcuacionLineal | null) => Object.keys(p!.vars)))
  ).sort();
  const numVars = todasVars.length;

  // Construir matriz aumentada
  const matrizAumentada = parseadas.map((p: EcuacionLineal | null) => [
    ...todasVars.map(v => p!.vars[v as string] ?? 0),
    p!.rhs,
  ]);

  const matrizCoefs = matrizAumentada.map(fila => fila.slice(0, numVars));
  const rangoCoefs = rangoMatriz(matrizCoefs);
  const rangoAumentada = rangoMatriz(matrizAumentada);

  if (rangoAumentada > rangoCoefs)
    return "Sistema inconsistente: no tiene solucion";
  if (numVars === 0)
    return "Sistema consistente y dependiente: todas las ecuaciones son identidades; hay infinitas soluciones";
  if (rangoCoefs < numVars)
    return "Sistema consistente y dependiente: infinitas soluciones";

  // Seleccionar filas linealmente independientes
  const filasIndep: number[][] = [];
  for (const p of parseadas) {
    const fila = [...todasVars.map(v => p!.vars[v as string] ?? 0), p!.rhs];
    const candidato = [...filasIndep.map(f => f.slice(0, numVars)), fila.slice(0, numVars)];
    if (rangoMatriz(candidato) > filasIndep.length) filasIndep.push(fila);
    if (filasIndep.length === numVars) break;
  }

  // Eliminación gaussiana in-place sobre las filas independientes
  const m = filasIndep;
  for (let col = 0; col < numVars; col++) {
    let maxFila = col;
    for (let f = col + 1; f < numVars; f++) {
      if (Math.abs(m[f][col]) > Math.abs(m[maxFila][col])) maxFila = f;
    }
    [m[col], m[maxFila]] = [m[maxFila], m[col]];

    if (Math.abs(m[col][col]) < 1e-10) return "El sistema no tiene solucion unica";

    for (let f = col + 1; f < numVars; f++) {
      const factor = m[f][col] / m[col][col];
      for (let j = col; j <= numVars; j++) m[f][j] -= factor * m[col][j];
    }
  }

  // Sustitución hacia atrás
  const solucion = new Array<number>(numVars).fill(0);
  for (let i = numVars - 1; i >= 0; i--) {
    solucion[i] = m[i][numVars];
    for (let j = i + 1; j < numVars; j++) solucion[i] -= m[i][j] * solucion[j];
    solucion[i] /= m[i][i];
  }

  return Object.fromEntries(todasVars.map((v: string, i: number) => [v, solucion[i]]));
}

// ─────────────────────────────────────────────
// Análisis numérico de f(x) — helpers
// ─────────────────────────────────────────────

const RANGO_X = { min: -10, max: 10, pasos: 200 };
const UMBRAL_PENDIENTE = 50;

interface Vertice { x: number; y: number; tipo: "min" | "max" }

function analizarFuncion(
  evaluar: (x: number) => number
): { raices: number[]; vertices: Vertice[] } {
  const { min, max, pasos } = RANGO_X;
  const delta = (max - min) / pasos;

  const raices: number[] = [];
  const vertices: Vertice[] = [];

  let xPrev = min;
  let yPrev = evaluar(xPrev);
  let xCurr = min + delta;
  let yCurr = evaluar(xCurr);

  for (let i = 2; i <= pasos; i++) {
    const xNext = min + i * delta;
    const yNext = evaluar(xNext);

    if (isFinite(yPrev) && isFinite(yCurr) && isFinite(yNext)) {
      const pendiente = Math.abs((yNext - yPrev) / delta);
      const dAntes = yCurr - yPrev;
      const dDespues = yNext - yCurr;

      if (pendiente < UMBRAL_PENDIENTE) {
        if (dAntes < 0 && dDespues > 0) vertices.push({ x: xCurr, y: yCurr, tipo: "min" });
        else if (dAntes > 0 && dDespues < 0) vertices.push({ x: xCurr, y: yCurr, tipo: "max" });

        if (yPrev === 0) {
          raices.push(xPrev);
        } else if (yPrev * yCurr < 0) {
          raices.push(xPrev - yPrev * (xCurr - xPrev) / (yCurr - yPrev));
        }
      }
    }

    xPrev = xCurr; yPrev = yCurr;
    xCurr = xNext; yCurr = yNext;
  }

  return { raices, vertices };
}

// ─────────────────────────────────────────────
// Plugin principal
// ─────────────────────────────────────────────

function crearShader(gl: WebGLRenderingContext, tipo: number, fuente: string): WebGLShader {
  const shader = gl.createShader(tipo)!;
  gl.shaderSource(shader, fuente);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error("Shader: " + gl.getShaderInfoLog(shader));
  return shader;
}

function crearPrograma(gl: WebGLRenderingContext): WebGLProgram {
  const vert = crearShader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
  `);
  const frag = crearShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec4 u_color;
    void main() { gl_FragColor = u_color; }
  `);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error("Programa WebGL: " + gl.getProgramInfoLog(prog));
  return prog;
}

// Convierte una lista de puntos en clip space a tira de quads con grosor dado
function construirQuadStrip(puntos: number[], grosorClip: number): Float32Array {
  const verts: number[] = [];
  const n = puntos.length / 2;
  if (n < 2) return new Float32Array(0);

  for (let i = 0; i < n - 1; i++) {
    const x0 = puntos[i * 2], y0 = puntos[i * 2 + 1];
    const x1 = puntos[(i + 1) * 2], y1 = puntos[(i + 1) * 2 + 1];

    // Vector perpendicular normalizado
    let dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) continue;
    dx /= len; dy /= len;
    const nx = -dy * grosorClip, ny = dx * grosorClip;

    // Dos triángulos formando un quad
    verts.push(
      x0 + nx, y0 + ny,
      x0 - nx, y0 - ny,
      x1 + nx, y1 + ny,
      x1 - nx, y1 - ny,
      x1 + nx, y1 + ny,
      x0 - nx, y0 - ny
    );
  }
  return new Float32Array(verts);
}

export default class ObsiMathPlugin extends Plugin {
  // Flag temporal: pon en `true` para reactivar el bloque obs-sistema.
  private readonly OBS_SISTEMA_HABILITADO = false;

  async onload() {
    let obsMathUpdateCount = 0;
    let obsSistemaUpdateCount = 0;
    console.log("Obsi Math: plugin cargado");
    new Notice("¡Obsi Math se ha cargado correctamente!");

    // ── Bloque obs-math ───────────────────────
    this.registerMarkdownCodeBlockProcessor(
      "obs-math",
      async (source, el, ctx) => {
        const contenedor = el.createDiv({ cls: "obsi-math-container" });

        try {
          const partes = source.trim().split("=");
          const exprRaw = partes.length > 1 ? partes[1].trim() : partes[0].trim();
          const expr = normalizarEntrada(exprRaw);

          // Renderizar LaTeX
          let latex = "f(x)=" + expr;
          try {
            const tex = limpiarTex(parse(expr).toTex({ parenthesis: "keep" }));
            latex = "f(x)=" + tex;
          } catch (e) {
            console.warn("ObsiMath: no se pudo generar LaTeX para", expr, e);
          }

          const contenedorLatex = contenedor.createDiv({ cls: "obsi-math-latex" });
          await MarkdownRenderer.render(
            this.app, "$$" + latex + "$$", contenedorLatex, ctx.sourcePath, this
          );

// ── Motor gráfico ─────────────────────────
          const W = 600, H = 280;
          const dpr = Math.ceil(window.devicePixelRatio || 1);
          const wrapGrafica = contenedor.createDiv({ cls: "obsi-math-grafica" });
          wrapGrafica.style.cssText = `position:relative; width:100%; height:${H}px;`;

          const canvasGL = wrapGrafica.createEl("canvas");
          const canvas2D = wrapGrafica.createEl("canvas");

          // Canvas GL: resolución física
          canvasGL.width = W * dpr; canvasGL.height = H * dpr;
          canvasGL.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%;`;

          // Canvas 2D overlay: misma resolución física, transparente
          canvas2D.width = W * dpr; canvas2D.height = H * dpr;
          canvas2D.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;`;

          const gl = canvasGL.getContext("webgl", { antialias: true });
          const ctx2d = canvas2D.getContext("2d");

          const evalX = (x: number) => evaluate(expr, { x });

          if (!gl || !ctx2d) {
            wrapGrafica.createEl("p", { text: "Error: WebGL no disponible" });
          } else {
            ctx2d.scale(dpr, dpr);

            let domX: [number, number] = [-7, 7];
            let domY: [number, number] = [-7, 7];

            const sx = (x: number) => ((x - domX[0]) / (domX[1] - domX[0])) * W;
            const sy = (y: number) => H - ((y - domY[0]) / (domY[1] - domY[0])) * H;

            // Genera ticks "bonitos" para un rango dado
            const generarTicks = (min: number, max: number, maxTicks = 10): number[] => {
              const rango = max - min;
              const paso = Math.pow(10, Math.floor(Math.log10(rango / maxTicks)));
              const pasos = [1, 2, 5, 10].map(m => m * paso);
              const pasoFinal = pasos.find(p => rango / p <= maxTicks) ?? pasos[pasos.length - 1];
              const ticks: number[] = [];
              const inicio = Math.ceil(min / pasoFinal) * pasoFinal;
              for (let t = inicio; t <= max + 1e-9; t += pasoFinal)
                ticks.push(parseFloat(t.toPrecision(10)));
              return ticks;
            };

            const formatearNumero = (n: number): string => {
              if (Math.abs(n) < 1e-9) return "0";
              if (Math.abs(n) >= 1000 || (Math.abs(n) < 0.01 && n !== 0))
                return n.toExponential(1);
              return parseFloat(n.toPrecision(4)).toString();
            };

            const dibujarOverlay = () => {
              ctx2d.clearRect(0, 0, W, H);

              const ticksX = generarTicks(domX[0], domX[1]);
              const ticksY = generarTicks(domY[0], domY[1]);

              // Grid tenue
              ctx2d.strokeStyle = "rgba(130,130,150,0.12)";
              ctx2d.lineWidth = 0.5;
              for (const x of ticksX) {
                ctx2d.beginPath(); ctx2d.moveTo(sx(x), 0); ctx2d.lineTo(sx(x), H); ctx2d.stroke();
              }
              for (const y of ticksY) {
                ctx2d.beginPath(); ctx2d.moveTo(0, sy(y)); ctx2d.lineTo(W, sy(y)); ctx2d.stroke();
              }

              // Ejes principales
              ctx2d.strokeStyle = "rgba(160,160,170,0.7)";
              ctx2d.lineWidth = 1;
              if (domY[0] <= 0 && domY[1] >= 0) {
                ctx2d.beginPath(); ctx2d.moveTo(0, sy(0)); ctx2d.lineTo(W, sy(0)); ctx2d.stroke();
              }
              if (domX[0] <= 0 && domX[1] >= 0) {
                ctx2d.beginPath(); ctx2d.moveTo(sx(0), 0); ctx2d.lineTo(sx(0), H); ctx2d.stroke();
              }

              // Etiquetas
              ctx2d.fillStyle = "rgba(160,160,170,0.85)";
              ctx2d.font = `${11}px monospace`;

              const ceroY = Math.max(4, Math.min(H - 4, sy(0)));
              const ceroX = Math.max(4, Math.min(W - 4, sx(0)));

              ctx2d.textAlign = "center";
              ctx2d.textBaseline = "top";
              for (const x of ticksX) {
                if (Math.abs(x) < 1e-9) continue;
                const px = sx(x);
                if (px < 10 || px > W - 10) continue;
                // tick mark
                ctx2d.strokeStyle = "rgba(160,160,170,0.5)";
                ctx2d.lineWidth = 0.75;
                ctx2d.beginPath(); ctx2d.moveTo(px, ceroY - 3); ctx2d.lineTo(px, ceroY + 3); ctx2d.stroke();
                ctx2d.fillText(formatearNumero(x), px, ceroY + 5);
              }

              ctx2d.textAlign = "right";
              ctx2d.textBaseline = "middle";
              for (const y of ticksY) {
                if (Math.abs(y) < 1e-9) continue;
                const py = sy(y);
                if (py < 10 || py > H - 10) continue;
                ctx2d.strokeStyle = "rgba(160,160,170,0.5)";
                ctx2d.lineWidth = 0.75;
                ctx2d.beginPath(); ctx2d.moveTo(ceroX - 3, py); ctx2d.lineTo(ceroX + 3, py); ctx2d.stroke();
                ctx2d.fillText(formatearNumero(y), ceroX - 6, py);
              }
            };

            const programa = crearPrograma(gl);
            const aPos = gl.getAttribLocation(programa, "a_pos");
            const uColor = gl.getUniformLocation(programa, "u_color");
            const buffer = gl.createBuffer()!;

            const aspectoInicial = (domY[1] - domY[0]) / (domX[1] - domX[0]);

const dibujarCurvaGL = (motivo: "inicio" | "zoom" | "pan") => {
  obsMathUpdateCount++;
  console.log('Actualizaciones motor gráfico (obs-math): ' + obsMathUpdateCount);
  gl.viewport(0, 0, W * dpr, H * dpr);
  gl.clearColor(0.118, 0.118, 0.118, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(programa);
  gl.uniform4f(uColor, 0.31, 0.62, 1.0, 1.0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const cx = (x: number) => ((x - domX[0]) / (domX[1] - domX[0])) * 2 - 1;
  const cy = (y: number) => ((y - domY[0]) / (domY[1] - domY[0])) * 2 - 1;

  const MUESTRAS = Math.min(8000, Math.max(2000, Math.floor((domX[1] - domX[0]) * 50)));
  const dx = (domX[1] - domX[0]) / MUESTRAS;
  const GROSOR_CLIP = 0.004;
  let segmento: number[] = [];
  let yPrev: number | null = null;
  let xPrev: number | null = null;

  const flushSegmento = () => {
    if (segmento.length < 4) { segmento = []; return; }
    const quads = construirQuadStrip(segmento, GROSOR_CLIP);
    if (quads.length === 0) { segmento = []; return; }
    gl.bufferData(gl.ARRAY_BUFFER, quads, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, quads.length / 2);
    segmento = [];
  };
let contadorDetecciones = 0;
const detectarAsintota = (xa: number, ya: number, xb: number, yb: number, profundidad: number): boolean => {
  contadorDetecciones++;
  if (profundidad === 0) return true;
  const paso = (xb - xa) / 10;
  let xPrevD = xa, yPrevD = ya;
  for (let k = 1; k <= 10; k++) {
    const xK = xa + k * paso;
    const yK = evalX(xK);
    if (!isFinite(yK) || Math.abs(yK) > 1e15) return true;
    const salto = Math.abs(yK - yPrevD) / (domY[1] - domY[0]);
    if (salto > 0.15) return detectarAsintota(xPrevD, yPrevD, xK, yK, profundidad - 1);
    xPrevD = xK; yPrevD = yK;
  }
  return false;
};

const dibujarAsintota = (xAsintota: number) => {
  const px = sx(xAsintota);
  if (px < 0 || px > W) return;
  ctx2d.save();
  ctx2d.setLineDash([4, 6]);
  ctx2d.strokeStyle = "rgba(100, 150, 255, 0.3)";
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();
  ctx2d.moveTo(px, 0);
  ctx2d.lineTo(px, H);
  ctx2d.stroke();
  ctx2d.restore();
};
  for (let i = 0; i <= MUESTRAS; i++) {
    const x = domX[0] + i * dx;
    const y = evalX(x);

    if (!isFinite(y) || Math.abs(y) > 1e15) {
      flushSegmento(); yPrev = null; xPrev = null; continue;
    }

    if (yPrev !== null && xPrev !== null) {
      const rangoY = domY[1] - domY[0];
      const saltoRelativo = Math.abs(y - yPrev) / rangoY;
      if (saltoRelativo > 0.05) {
  console.log(`[ObsiMath] x=${x.toFixed(3)} y=${y.toFixed(3)} yPrev=${yPrev.toFixed(3)} saltoRelativo=${saltoRelativo.toFixed(3)} domY=[${domY[0].toFixed(1)},${domY[1].toFixed(1)}]`);
}
if (saltoRelativo > 0.15 && yPrev * y < 0) {
  if (detectarAsintota(xPrev, yPrev, x, y, 1)) {
    dibujarAsintota((xPrev + x) / 2);
    segmento.push(cx(xPrev), cy(yPrev));
    flushSegmento();
    yPrev = null; xPrev = null;
    continue;
  }
}
    }

    segmento.push(cx(x), cy(y));
    yPrev = y; xPrev = x;
  }
  console.log(`[ObsiMath] Total llamadas a detectarAsintota: ${contadorDetecciones}`);
  flushSegmento();
};

dibujarOverlay();
dibujarCurvaGL("inicio");
          
          // ── Zoom / Pan ─────────────────────────
            let isDragging = false;
            let lastPointer = { x: 0, y: 0 };

            let rafPendiente = false;
let motivoPendiente: "zoom" | "pan" = "pan";

const programarRedibujo = (motivo: "zoom" | "pan") => {
  // zoom tiene prioridad sobre pan
  if (motivo === "zoom") motivoPendiente = "zoom";
  else if (!rafPendiente) motivoPendiente = "pan";
  
  if (!rafPendiente) {
    rafPendiente = true;
    requestAnimationFrame(() => {
      rafPendiente = false;
      dibujarOverlay();
      dibujarCurvaGL(motivoPendiente);
      motivoPendiente = "pan";
    });
  }
};

canvasGL.addEventListener("pointerdown", e => {
  isDragging = true;
  lastPointer = { x: e.offsetX, y: e.offsetY };
  canvasGL.setPointerCapture(e.pointerId);
});

canvasGL.addEventListener("pointermove", e => {
  if (!isDragging) return;
  const dx = e.offsetX - lastPointer.x;
  const dy = e.offsetY - lastPointer.y;
  lastPointer = { x: e.offsetX, y: e.offsetY };
  const rx = (domX[1] - domX[0]) / W;
  const ry = (domY[1] - domY[0]) / H;
  domX = [domX[0] - dx * rx, domX[1] - dx * rx];
  domY = [domY[0] + dy * ry, domY[1] + dy * ry];
  programarRedibujo("pan");
});

canvasGL.addEventListener("pointerup", e => {
  isDragging = false;
  canvasGL.releasePointerCapture(e.pointerId);
});

canvasGL.addEventListener("wheel", e => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 1.05 : 0.95;
  const mx = domX[0] + (e.offsetX / W) * (domX[1] - domX[0]);
  const my = domY[1] - (e.offsetY / H) * (domY[1] - domY[0]);
  domX = [mx + (domX[0] - mx) * factor, mx + (domX[1] - mx) * factor];
  domY = [my + (domY[0] - my) * factor, my + (domY[1] - my) * factor];
  programarRedibujo("zoom");
}, { passive: false });
            // ── Fin zoom/pan ───────────────────────
          } // cierre del else (WebGL disponible)
          // ── Fin motor gráfico ──────────────────────

          // Análisis numérico - Cálculos
          const infoBox = contenedor.createDiv({ cls: "obsi-math-info" });

          let formaSimplificada = "";
          try { formaSimplificada = simplify(expr).toString(); }
          catch (e) { console.warn("ObsiMath: no se pudo simplificar", expr, e); }

          if (formaSimplificada === "0") {
            infoBox.createEl("p", { text: "Interseccion Y: (0, 0.0000)" });
            infoBox.createEl("p", { text: "Todos los valores de x son raices (funcion identicamente cero)" });
          } else {
            const interseccionY = evalX(0);
            infoBox.createEl("p", {
              text: isFinite(interseccionY)
                ? `Interseccion Y: (0, ${interseccionY.toFixed(4)})`
                : "Interseccion Y: no definida (discontinuidad en x=0)",
            });

            const { raices, vertices } = analizarFuncion(evalX);

            if (raices.length > 0) {
              infoBox.createEl("p", { text: "Raices: " + raices.map(r => r.toFixed(4)).join(", ") });
            } else {
              infoBox.createEl("p", { text: "No hay raices reales" });
            }

            for (const v of vertices) {
              infoBox.createEl("p", {
                text: `Vertice ${v.tipo}: (${v.x.toFixed(4)}, ${v.y.toFixed(4)})`,
              });
            }
          }
        } catch (error) {
          contenedor.createEl("p", { text: "Error: " + (error as Error).message });
        }
      }
    );

    // ── Bloque obs-sistema ────────────────────
    this.registerMarkdownCodeBlockProcessor("obs-sistema", async (source, el, ctx) => {
  const contenedor = el.createDiv({ cls: "obsi-math-container" });
  if (!this.OBS_SISTEMA_HABILITADO) {
    contenedor.createEl("p", {
      text: "⚠️ obs-sistema está deshabilitado temporalmente.",
    });
    return;
  }

  try {
    const { ecuaciones, espacios } = parsearSistemaCases(source);
    if (ecuaciones.length < 2) {
      contenedor.createEl("p", { text: "Error: se necesitan al menos 2 ecuaciones" });
      return;
    }

    // ── LaTeX izquierda ──────────────────────
    const infoBox = contenedor.createDiv({ cls: "obsi-math-latex" });
    const contenedorCases = infoBox.createDiv();
    await MarkdownRenderer.render(
      this.app,
      "$$" + sistemaCasesALatex(ecuaciones, espacios) + "$$",
      contenedorCases,
      ctx.sourcePath,
      this
    );

    // ── Motor gráfico ────────────────────────
    const W = 600, H = 280;
    const dpr = window.devicePixelRatio || 1;
    const wrapGrafica = contenedor.createDiv({ cls: "obsi-math-grafica" });
    wrapGrafica.style.cssText = `position:relative; width:100%; height:${H}px;`;

    const canvasGL = wrapGrafica.createEl("canvas");
    const canvas2D = wrapGrafica.createEl("canvas");

    canvasGL.width = W * dpr; canvasGL.height = H * dpr;
    canvasGL.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%;`;
    canvas2D.width = W * dpr; canvas2D.height = H * dpr;
    canvas2D.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;`;

    const gl = canvasGL.getContext("webgl", { antialias: true });
    const ctx2d = canvas2D.getContext("2d");

    if (!gl || !ctx2d) {
      wrapGrafica.createEl("p", { text: "Error: WebGL no disponible" });
      return;
    }

    ctx2d.scale(dpr, dpr);

    let domX: [number, number] = [-7, 7];
    let domY: [number, number] = [-7, 7];

    const sx = (x: number) => ((x - domX[0]) / (domX[1] - domX[0])) * W;
    const sy = (y: number) => H - ((y - domY[0]) / (domY[1] - domY[0])) * H;

    const generarTicks = (min: number, max: number, maxTicks = 10): number[] => {
      const rango = max - min;
      const paso = Math.pow(10, Math.floor(Math.log10(rango / maxTicks)));
      const pasos = [1, 2, 5, 10].map(m => m * paso);
      const pasoFinal = pasos.find(p => rango / p <= maxTicks) ?? pasos[pasos.length - 1];
      const ticks: number[] = [];
      const inicio = Math.ceil(min / pasoFinal) * pasoFinal;
      for (let t = inicio; t <= max + 1e-9; t += pasoFinal)
        ticks.push(parseFloat(t.toPrecision(10)));
      return ticks;
    };

    const formatearNumero = (n: number): string => {
      if (Math.abs(n) < 1e-9) return "0";
      if (Math.abs(n) >= 1000 || (Math.abs(n) < 0.01 && n !== 0)) return n.toExponential(1);
      return parseFloat(n.toPrecision(4)).toString();
    };

    // Resolver sistema
    const resultado = resolverSistema(ecuaciones);

    // Convertir ecuaciones a funciones y(x)
    const evalEcuacion = (ec: string, x: number): number => {
      try {
        const partes = ec.split("=");
        if (partes.length !== 2) return NaN;
        const lhs = normalizarEntrada(partes[0].trim());
        const rhs = normalizarEntrada(partes[1].trim());
        // Despejar y: y = rhs - lhs + y_coef*y → resolver numéricamente
        const yCoef = evaluate(`(${lhs})-(${rhs})`, { x: 0, y: 1 }) - evaluate(`(${lhs})-(${rhs})`, { x: 0, y: 0 });
        if (Math.abs(yCoef) < 1e-10) return NaN; // no tiene y
        const constante = evaluate(`(${lhs})-(${rhs})`, { x, y: 0 });
        return -constante / yCoef;
      } catch { return NaN; }
    };

    const dibujarOverlay = () => {
      ctx2d.clearRect(0, 0, W, H);
      const ticksX = generarTicks(domX[0], domX[1]);
      const ticksY = generarTicks(domY[0], domY[1]);

      ctx2d.strokeStyle = "rgba(130,130,150,0.12)";
      ctx2d.lineWidth = 0.5;
      for (const x of ticksX) { ctx2d.beginPath(); ctx2d.moveTo(sx(x), 0); ctx2d.lineTo(sx(x), H); ctx2d.stroke(); }
      for (const y of ticksY) { ctx2d.beginPath(); ctx2d.moveTo(0, sy(y)); ctx2d.lineTo(W, sy(y)); ctx2d.stroke(); }

      ctx2d.strokeStyle = "rgba(160,160,170,0.7)";
      ctx2d.lineWidth = 1;
      if (domY[0] <= 0 && domY[1] >= 0) { ctx2d.beginPath(); ctx2d.moveTo(0, sy(0)); ctx2d.lineTo(W, sy(0)); ctx2d.stroke(); }
      if (domX[0] <= 0 && domX[1] >= 0) { ctx2d.beginPath(); ctx2d.moveTo(sx(0), 0); ctx2d.lineTo(sx(0), H); ctx2d.stroke(); }

      const ceroY = Math.max(4, Math.min(H - 4, sy(0)));
      const ceroX = Math.max(4, Math.min(W - 4, sx(0)));
      ctx2d.fillStyle = "rgba(160,160,170,0.85)";
      ctx2d.font = "11px monospace";

      ctx2d.textAlign = "center"; ctx2d.textBaseline = "top";
      for (const x of ticksX) {
        if (Math.abs(x) < 1e-9) continue;
        const px = sx(x);
        if (px < 10 || px > W - 10) continue;
        ctx2d.strokeStyle = "rgba(160,160,170,0.5)"; ctx2d.lineWidth = 0.75;
        ctx2d.beginPath(); ctx2d.moveTo(px, ceroY - 3); ctx2d.lineTo(px, ceroY + 3); ctx2d.stroke();
        ctx2d.fillStyle = "rgba(160,160,170,0.85)";
        ctx2d.fillText(formatearNumero(x), px, ceroY + 5);
      }

      ctx2d.textAlign = "right"; ctx2d.textBaseline = "middle";
      for (const y of ticksY) {
        if (Math.abs(y) < 1e-9) continue;
        const py = sy(y);
        if (py < 10 || py > H - 10) continue;
        ctx2d.strokeStyle = "rgba(160,160,170,0.5)"; ctx2d.lineWidth = 0.75;
        ctx2d.beginPath(); ctx2d.moveTo(ceroX - 3, py); ctx2d.lineTo(ceroX + 3, py); ctx2d.stroke();
        ctx2d.fillStyle = "rgba(160,160,170,0.85)";
        ctx2d.fillText(formatearNumero(y), ceroX - 6, py);
      }

      // Punto de intersección
      if (typeof resultado !== "string") {
        const vars = Object.keys(resultado);
        const xVar = vars.find(v => v === "x") ?? vars[0];
        const yVar = vars.find(v => v === "y") ?? vars[1];
        if (xVar && yVar) {
          const px = sx(resultado[xVar]);
          const py = sy(resultado[yVar]);
          if (px >= 0 && px <= W && py >= 0 && py <= H) {
            // Punto de alta calidad
            const r = 5 * dpr;
            ctx2d.save();
            ctx2d.scale(1 / dpr, 1 / dpr);
            // Sombra suave
            ctx2d.shadowColor = "rgba(255,255,255,0.4)";
            ctx2d.shadowBlur = 6;
            // Borde blanco
            ctx2d.beginPath();
            ctx2d.arc(px * dpr, py * dpr, r + 1.5, 0, Math.PI * 2);
            ctx2d.fillStyle = "white";
            ctx2d.fill();
            // Interior negro
            ctx2d.shadowBlur = 0;
            ctx2d.beginPath();
            ctx2d.arc(px * dpr, py * dpr, r - 1, 0, Math.PI * 2);
            ctx2d.fillStyle = "black";
            ctx2d.fill();
            ctx2d.restore();
          }
        }
      }
    };

    const programa = crearPrograma(gl);
    const aPos = gl.getAttribLocation(programa, "a_pos");
    const uColor = gl.getUniformLocation(programa, "u_color");
    const buffer = gl.createBuffer()!;

    const COLORES = [
      [0.31, 0.62, 1.0, 1.0],   // azul
      [1.0, 0.63, 0.20, 1.0],   // naranja
    ];

    const dibujarCurvas = () => {
      obsSistemaUpdateCount++;
      console.log('Actualizaciones motor gráfico (obs-sistema): ' + obsSistemaUpdateCount);
      gl.viewport(0, 0, W * dpr, H * dpr);
      gl.clearColor(0.118, 0.118, 0.118, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(programa);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      const cx = (x: number) => ((x - domX[0]) / (domX[1] - domX[0])) * 2 - 1;
      const cy = (y: number) => ((y - domY[0]) / (domY[1] - domY[0])) * 2 - 1;
      const MUESTRAS = 2000;
      const rangoX = domX[1] - domX[0];
      const GROSOR_CLIP = Math.min(0.009, Math.max(0.003, 0.0055 * (10 / rangoX)));
      const dx = rangoX / MUESTRAS;

      for (let e = 0; e < Math.min(ecuaciones.length, 2); e++) {
        const color = COLORES[e] ?? COLORES[0];
        gl.uniform4f(uColor, color[0], color[1], color[2], color[3]);

        let segmento: number[] = [];
        const flushSegmento = () => {
          if (segmento.length < 4) { segmento = []; return; }
          const quads = construirQuadStrip(segmento, GROSOR_CLIP);
          if (quads.length === 0) { segmento = []; return; }
          gl.bufferData(gl.ARRAY_BUFFER, quads, gl.DYNAMIC_DRAW);
          gl.drawArrays(gl.TRIANGLES, 0, quads.length / 2);
          segmento = [];
        };

        let yPrev: number | null = null;
        for (let i = 0; i <= MUESTRAS; i++) {
          const x = domX[0] + i * dx;
          const y = evalEcuacion(ecuaciones[e], x);
          if (!isFinite(y) || Math.abs(y) > 1e15) { flushSegmento(); yPrev = null; continue; }
          segmento.push(cx(x), cy(y));
          yPrev = y;
        }
        flushSegmento();
      }
    };

    dibujarOverlay();
    dibujarCurvas();

    // ── Zoom / Pan ───────────────────────────
    let isDragging = false;
    let lastPointer = { x: 0, y: 0 };
    let rafPendiente = false;
    let motivoPendiente: "zoom" | "pan" = "pan";

    const programarRedibujo = (motivo: "zoom" | "pan") => {
      if (motivo === "zoom") motivoPendiente = "zoom";
      else if (!rafPendiente) motivoPendiente = "pan";
      if (!rafPendiente) {
        rafPendiente = true;
        requestAnimationFrame(() => {
          rafPendiente = false;
          dibujarOverlay();
          dibujarCurvas();
          motivoPendiente = "pan";
        });
      }
    };

    canvasGL.addEventListener("pointerdown", e => {
      isDragging = true;
      lastPointer = { x: e.offsetX, y: e.offsetY };
      canvasGL.setPointerCapture(e.pointerId);
    });
    canvasGL.addEventListener("pointermove", e => {
      if (!isDragging) return;
      const dx = e.offsetX - lastPointer.x;
      const dy = e.offsetY - lastPointer.y;
      lastPointer = { x: e.offsetX, y: e.offsetY };
      const rx = (domX[1] - domX[0]) / W;
      const ry = (domY[1] - domY[0]) / H;
      domX = [domX[0] - dx * rx, domX[1] - dx * rx];
      domY = [domY[0] + dy * ry, domY[1] + dy * ry];
      programarRedibujo("pan");
    });
    canvasGL.addEventListener("pointerup", e => {
      isDragging = false;
      canvasGL.releasePointerCapture(e.pointerId);
    });
    canvasGL.addEventListener("wheel", e => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.05 : 0.95;
      const mx = domX[0] + (e.offsetX / W) * (domX[1] - domX[0]);
      const my = domY[1] - (e.offsetY / H) * (domY[1] - domY[0]);
      domX = [mx + (domX[0] - mx) * factor, mx + (domX[1] - mx) * factor];
      domY = [my + (domY[0] - my) * factor, my + (domY[1] - my) * factor];
      programarRedibujo("zoom");
    }, { passive: false });

  } catch (error) {
    contenedor.createEl("p", { text: "Error: " + (error as Error).message });
  }
});
  }

  onunload() {
    console.log("Obsi Math: plugin descargado:");
  }
}

// https://github.com/RughustDev/obsi-math