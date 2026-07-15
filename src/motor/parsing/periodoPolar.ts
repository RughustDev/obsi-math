// ─────────────────────────────────────────────
// parsing · Dominio de θ de una polar r=g(θ) por PERIODO (CUARENTENA de mathjs)
// ─────────────────────────────────────────────
//
// El trazador paramétrico recorre TODO el dominio del parámetro, así que una polar
// solo se dibuja entera si su dominio cubre un periodo completo de la curva. El
// defecto histórico `[0, 2π]` corta las curvas cuyo periodo es mayor: `r = sin(θ/10)`
// tiene periodo 20π (solo se veía 1/10, un arquito junto al origen).
//
// La curva (r·cosθ, r·sinθ) es periódica en θ con periodo LCM(P_r, 2π), donde P_r es
// el periodo de r(θ) como función escalar (el factor 2π viene de cosθ/sinθ). Para r
// compuesto de trig de argumento AFÍN en θ (`sin(aθ+b)`), P_r = LCM de los 2π/|a_i|.
// Combinando ambos: P = 2π·m, con m = LCM de los NUMERADORES de 1/|a_i| (en fracción
// reducida) — el LCM con 2π absorbe los denominadores. Ejemplos:
//   • r=sin(θ/10):  a=1/10 → 1/a=10/1 → m=10 → 20π (10 lazos).
//   • r=sin(3θ):    a=3    → 1/a=1/3  → m=1  → 2π  (la rosa se retraza, pero entera).
//   • r=sin(θ/10)+cos(θ/4): m=LCM(10,4)=20 → 40π.
// Sin trig de θ (círculo r=2, espiral r=θ) → sin periodo detectable → `[0, 2π]`.
//
// El resultado se VERIFICA numéricamente (r(θ+P)≈r(θ)); si la dependencia en θ no es
// realmente periódica (r=θ+sinθ) cae al defecto. mathjs vive confinado aquí (parsing).

import { parse } from "mathjs";
import { compilarFuncion } from "../../evaluador";

const DOS_PI = 2 * Math.PI;
export const DOMINIO_POLAR_DEFECTO: readonly [number, number] = [0, DOS_PI];

// Solo las trig CIRCULARES son periódicas (las hiperbólicas no).
const TRIG = new Set(["sin", "cos", "tan", "cot", "sec", "csc"]);
// Cota del multiplicador: evita dominios/presupuestos desmedidos (r=sin(θ/1000)).
const MULT_MAX = 60;

const aNumero = (v: unknown): number => (typeof v === "number" ? v : NaN);
const mcd = (a: number, b: number): number => (b === 0 ? a : mcd(b, a % b));
const mcm = (a: number, b: number): number => (a / mcd(a, b)) * b;

/** Fracción reducida p/q ≈ x (x>0) por fracciones continuas (denominador ≤ maxDen).
 *  Devuelve el NUMERADOR p, que es lo único que necesita el cálculo del periodo. */
function numeradorFraccion(x: number, maxDen = 1000): number | null {
  if (!Number.isFinite(x) || x <= 0) return null;
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0, b = x;
  for (let i = 0; i < 64; i++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0, k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (Math.abs(h1 / k1 - x) < 1e-9) break;
    const frac = b - a;
    if (frac < 1e-12) break;
    b = 1 / frac;
  }
  return h1 > 0 ? h1 : null;
}

/** ¿El subárbol referencia θ (`theta`)? */
function contieneTheta(n: any): boolean {
  return n.filter((nn: any) => nn.type === "SymbolNode" && nn.name === "theta").length > 0;
}

/** Pendiente a de un argumento AFÍN en θ (arg = a·θ + b), o null si no es lineal. */
function pendienteLineal(arg: any): number | null {
  let g: (v: number) => any;
  try { g = compilarFuncion(arg.toString(), "theta"); } catch { return null; }
  const y0 = aNumero(g(0.3)), y1 = aNumero(g(1.3)), y2 = aNumero(g(2.3));
  if (![y0, y1, y2].every(Number.isFinite)) return null;
  const a1 = y1 - y0, a2 = y2 - y1;
  if (Math.abs(a1 - a2) > 1e-7) return null; // curvatura → no afín
  return a1;
}

/** Verifica numéricamente que r(θ+P) ≈ r(θ) en varios θ (≥2 comprobados finitos). */
function periodoValido(exprR: string, P: number): boolean {
  let g: (v: number) => any;
  try { g = compilarFuncion(exprR, "theta"); } catch { return false; }
  let ok = 0;
  for (const th of [0.1, 0.9, 1.7, 2.6, 3.9, 5.1]) {
    const a = aNumero(g(th)), b = aNumero(g(th + P));
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (Math.abs(a - b) > 1e-6 * (1 + Math.abs(a))) return false;
    ok++;
  }
  return ok >= 2;
}

/** Dominio [0, P] de θ para trazar la polar r=g(θ) entera; `[0, 2π]` si no hay un
 *  periodo mayor detectable/verificable. `exprR` YA normalizada en la variable θ. */
export function dominioPolar(exprR: string): readonly [number, number] {
  let m = 1;
  let algunTrig = false;
  try {
    const arbol: any = parse(exprR);
    const trigs = arbol.filter(
      (n: any) => n.type === "FunctionNode" && n.fn && TRIG.has(n.fn.name)
    );
    for (const t of trigs) {
      const arg = t.args[0];
      if (!arg || !contieneTheta(arg)) continue; // arg sin θ: no aporta al periodo
      const a = pendienteLineal(arg);
      if (a === null) return DOMINIO_POLAR_DEFECTO; // arg no afín → sin periodo fiable
      if (Math.abs(a) < 1e-9) continue;
      const num = numeradorFraccion(1 / Math.abs(a));
      if (num === null) return DOMINIO_POLAR_DEFECTO;
      algunTrig = true;
      m = mcm(m, num);
      if (m >= MULT_MAX) { m = MULT_MAX; break; }
    }
  } catch { return DOMINIO_POLAR_DEFECTO; }

  if (!algunTrig) return DOMINIO_POLAR_DEFECTO;
  const P = DOS_PI * m;
  return periodoValido(exprR, P) ? [0, P] : DOMINIO_POLAR_DEFECTO;
}
