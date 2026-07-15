// ─────────────────────────────────────────────
// analysis · Área de una integral definida (bloque obs-integral)
// ─────────────────────────────────────────────
//
// Calcula ∫ₐᵇ f dx (área CON SIGNO) y clasifica los casos límite con ETIQUETAS formales
// del mismo estilo que `degeneradas.ts` ({etiqueta, detalle}) — no mensajes ad-hoc: la
// integral definida es una propiedad de (f, a, b), no del encuadre, así que el VALOR se
// calcula sobre la `FuncionReal` compilada (cuadratura adaptativa), independiente del zoom.
// El recorte de la polilínea para el SOMBREADO (dependiente de la vista) va aparte.
//
// Ring 1: depende solo de `contracts`. El oráculo `FuncionReal` coacciona complejo/no-número
// a NaN (= "fuera de dominio") pero CONSERVA ±∞ (= polo), así que aquí se distinguen los dos.
//
// Dos niveles de fallo, alineados con el reparto que hace `clasificarBloque`:
//   • Nivel 1 (integrando degenerado, 0/0, √−1) → lo etiqueta el HOST sobre el integrando,
//     con velo sobre el plano. Aquí NO se toca.
//   • Nivel 2 (la curva es válida pero el ÁREA no existe: polo interior, dominio parcial,
//     límites no numéricos) → estas etiquetas, mostradas donde iría el número.

import type { FuncionReal, Rama } from "../contracts";

/** Área calculada. `impropia`: hubo una singularidad en un extremo pero la integral
 *  CONVERGE (el valor es aproximado — cuadratura sobre el intervalo encogido). */
export interface ValorArea {
  readonly tipo: "valor";
  readonly valor: number;
  readonly impropia: boolean;
}

/** Caso límite del Nivel 2, con la misma forma que `FuncionDegenerada`. */
export interface EtiquetaArea {
  readonly tipo: "etiqueta";
  readonly etiqueta: string;
  readonly detalle: string;
}

export type ResultadoArea = ValorArea | EtiquetaArea;

// Etiquetas del Nivel 2 (estilo de `degeneradas.ts`). Exportadas para que el host las
// reutilice y para poder afirmarlas en los tests sin hardcodear el texto dos veces.
export const ETIQUETA_DIVERGENTE: EtiquetaArea = {
  tipo: "etiqueta",
  etiqueta: "Integral divergente",
  detalle: "La integral no converge: la función no es acotada en el intervalo.",
};
export const ETIQUETA_FUERA_DOMINIO: EtiquetaArea = {
  tipo: "etiqueta",
  etiqueta: "Fuera de dominio",
  detalle: "El intervalo de integración sale del dominio real de la función.",
};
export const ETIQUETA_LIMITES: EtiquetaArea = {
  tipo: "etiqueta",
  etiqueta: "Límites no numéricos",
  detalle: "Los límites de integración no evalúan a un número real.",
};

// — Constantes numéricas —
const MUESTRAS_ESCANEO = 512;   // muestras para localizar polos/huecos en [a,b]
const SPIKE_ABS = 1e5;          // |f| que despierta la sospecha de polo del mismo signo
const HUGE = 1e10;              // magnitud que confirma un blow-up (polo)
const CAP_DIVERGENCIA = 1e15;   // |área| por encima → se considera divergente
const TOL_SIMPSON = 1e-11;      // tolerancia relativa del Simpson adaptativo
const PROF_MAX = 50;            // profundidad máxima de la recursión de Simpson
const TOL_CONV = 1e-4;          // Δ relativo para dar por convergida una impropia
const ITERS_EPS = 40;           // pasos de encogido de ε en el extremo singular

const signo = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Regla de Simpson simple sobre [a,b] con el punto medio ya evaluado. */
function simpson(fa: number, fm: number, fb: number, a: number, b: number): number {
  return ((b - a) / 6) * (fa + 4 * fm + fb);
}

/**
 * Simpson adaptativo recursivo. Devuelve NaN si topa con un valor no finito dentro (un polo
 * que el escaneo no filtró): el llamador lo trata como divergente. Refina donde el error
 * estimado (regla de Richardson, factor 15) supera la tolerancia.
 */
function adaptativo(
  f: (x: number) => number,
  a: number, b: number,
  fa: number, fb: number, fm: number,
  entero: number, tol: number, prof: number
): number {
  const m = (a + b) / 2;
  const lm = (a + m) / 2, rm = (m + b) / 2;
  const flm = f(lm), frm = f(rm);
  if (!Number.isFinite(flm) || !Number.isFinite(frm)) return NaN;
  const izq = simpson(fa, flm, fm, a, m);
  const der = simpson(fm, frm, fb, m, b);
  const suma = izq + der;
  if (prof <= 0 || Math.abs(suma - entero) <= 15 * tol)
    return suma + (suma - entero) / 15;
  return (
    adaptativo(f, a, m, fa, fm, flm, izq, tol / 2, prof - 1) +
    adaptativo(f, m, b, fm, fb, frm, der, tol / 2, prof - 1)
  );
}

/** Integral de f sobre [a,b] por Simpson adaptativo (a,b sin singularidades). NaN si
 *  algún sub-punto es no finito. */
function integrar(f: (x: number) => number, a: number, b: number): number {
  const fa = f(a), fb = f(b), fm = f((a + b) / 2);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || !Number.isFinite(fm)) return NaN;
  const entero = simpson(fa, fm, fb, a, b);
  const tol = TOL_SIMPSON * (1 + Math.abs(entero));
  return adaptativo(f, a, b, fa, fb, fm, entero, tol, PROF_MAX);
}

/**
 * Entre dos muestras con CAMBIO DE SIGNO, ¿hay un polo (blow-up) o una raíz (cruce suave)?
 * Biseca hacia el cambio de signo: en una raíz |f|→0 (nunca explota); en un polo |f|→∞.
 */
function poloEntreSignos(f: (x: number) => number, x1: number, x2: number): boolean {
  let a = x1, b = x2, fa = f(a);
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2, fm = f(m);
    if (!Number.isFinite(fm)) return true;
    if (Math.abs(fm) > HUGE) return true;
    if (signo(fm) === signo(fa)) { a = m; fa = fm; } else { b = m; }
  }
  return false; // se estabilizó sin explotar → raíz
}

/** Barrido fino en [xa,xb] (una o dos celdas alrededor de un pico): ¿la magnitud explota
 *  (polo del mismo signo, que no da cambio de signo)? */
function poloEnCelda(f: (x: number) => number, xa: number, xb: number): boolean {
  const N = 256;
  let mx = 0;
  for (let i = 0; i <= N; i++) {
    const v = Math.abs(f(xa + ((xb - xa) * i) / N));
    if (!Number.isFinite(v)) return true;
    if (v > mx) mx = v;
  }
  return mx > HUGE;
}

/**
 * Escanea el INTERIOR abierto (a,b) buscando lo que rompe la integral:
 *   "hueco" → alguna muestra NaN (parte del intervalo fuera del dominio real);
 *   "polo"  → alguna muestra ±∞, o un blow-up (cambio de signo que explota, o pico del
 *             mismo signo confirmado por barrido fino);
 *   null    → limpio.
 * Se excluyen los extremos exactos (se tratan aparte: pueden ser impropias convergentes).
 */
function escanearInterior(f: (x: number) => number, a: number, b: number): "hueco" | "polo" | null {
  const paso = (b - a) / MUESTRAS_ESCANEO;
  const xs: number[] = [], fs: number[] = [];
  let escala = 0, nEscala = 0;
  for (let i = 1; i < MUESTRAS_ESCANEO; i++) {
    const x = a + paso * i, v = f(x);
    if (Number.isNaN(v)) return "hueco";
    if (v === Infinity || v === -Infinity) return "polo";
    xs.push(x); fs.push(v);
    escala += Math.abs(v); nEscala++;
  }
  const media = nEscala > 0 ? escala / nEscala : 0;
  const umbralPico = Math.max(SPIKE_ABS, 1000 * media);

  for (let i = 0; i + 1 < fs.length; i++) {
    // Cambio de signo: raíz o polo.
    if (signo(fs[i]) !== 0 && signo(fs[i + 1]) !== 0 && signo(fs[i]) !== signo(fs[i + 1])) {
      if (poloEntreSignos(f, xs[i], xs[i + 1])) return "polo";
    }
    // Pico del mismo signo: posible polo sin cambio de signo (1/(x−c)²).
    if (Math.abs(fs[i]) > umbralPico) {
      const xa = i > 0 ? xs[i - 1] : xs[i];
      const xb = i + 1 < xs.length ? xs[i + 1] : xs[i];
      if (poloEnCelda(f, xa, xb)) return "polo";
    }
  }
  return null;
}

/**
 * Integral con singularidad en uno o ambos EXTREMOS (o(1/√x), ln x): integra el intervalo
 * ENCOGIDO en ε y encoge ε geométricamente. Converge si Δ cae bajo la tolerancia (valor
 * aproximado, `impropia:true`); diverge si crece sin cota o Δ nunca se estabiliza (1/x, 1/x²).
 */
function integrarExtremoSingular(
  f: (x: number) => number, a: number, b: number,
  loSing: boolean, hiSing: boolean, orient: number
): ResultadoArea {
  const span = b - a;
  const epsMin = span * 1e-13;
  let epsL = loSing ? span * 1e-2 : 0;
  let epsR = hiSing ? span * 1e-2 : 0;
  let prev = NaN, convergio = false, ultimo = NaN;

  for (let k = 0; k < ITERS_EPS; k++) {
    const est = integrar(f, a + epsL, b - epsR);
    if (!Number.isFinite(est) || Math.abs(est) > CAP_DIVERGENCIA) return ETIQUETA_DIVERGENTE;
    ultimo = est;
    if (Number.isFinite(prev) && Math.abs(est - prev) <= TOL_CONV * (1 + Math.abs(est))) {
      convergio = true;
      break;
    }
    prev = est;
    if ((loSing && epsL <= epsMin) || (hiSing && epsR <= epsMin)) break; // no encoger más
    epsL /= 4; epsR /= 4;
  }
  if (!convergio) return ETIQUETA_DIVERGENTE; // Δ no se estabilizó → no converge
  return { tipo: "valor", valor: orient * ultimo, impropia: true };
}

/**
 * Área con signo de ∫ₐᵇ f dx, o una etiqueta formal del Nivel 2 si no hay número honesto.
 * Independiente del viewport: el número es propiedad de (f, a, b).
 */
export function areaDefinida(f: FuncionReal, a: number, b: number): ResultadoArea {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return ETIQUETA_LIMITES;
  if (a === b) return { tipo: "valor", valor: 0, impropia: false };

  // Intervalo orientado: ∫ₐᵇ = −∫ᵦₐ. Se calcula sobre [lo,hi] y se aplica el signo.
  const orient = a < b ? 1 : -1;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const g = (x: number): number => f.eval(x);

  const interior = escanearInterior(g, lo, hi);
  if (interior === "hueco") return ETIQUETA_FUERA_DOMINIO;
  if (interior === "polo") return ETIQUETA_DIVERGENTE;

  const loSing = !Number.isFinite(g(lo));
  const hiSing = !Number.isFinite(g(hi));
  if (loSing || hiSing) return integrarExtremoSingular(g, lo, hi, loSing, hiSing, orient);

  const val = integrar(g, lo, hi);
  if (!Number.isFinite(val) || Math.abs(val) > CAP_DIVERGENCIA) return ETIQUETA_DIVERGENTE;
  return { tipo: "valor", valor: orient * val, impropia: false };
}

/**
 * Recorta las ramas del integrando a la franja x∈[a,b] para el SOMBREADO (lo consume el
 * renderer en la fase siguiente). Devuelve una polilínea por tramo continuo dentro de la
 * franja (interpolando los puntos de corte en x=a y x=b), rompiendo en los huecos (NaN) y al
 * salir/entrar del intervalo. El coloreo por signo (arriba/abajo del eje) es cosa del render.
 */
export function recortarRegion(ramas: readonly Rama[], a: number, b: number): Float64Array[] {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const salida: Float64Array[] = [];

  for (const rama of ramas) {
    const p = rama.puntos;
    let buffer: number[] = [];
    const cerrar = () => {
      if (buffer.length >= 4) salida.push(Float64Array.from(buffer));
      buffer = [];
    };

    for (let i = 0; i + 3 < p.length; i += 2) {
      const x1 = p[i], y1 = p[i + 1], x2 = p[i + 2], y2 = p[i + 3];
      if (!(Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2))) {
        cerrar(); continue;
      }
      const dx = x2 - x1;
      let t0 = 0, t1 = 1;
      if (dx !== 0) {
        const ta = (lo - x1) / dx, tb = (hi - x1) / dx;
        t0 = Math.max(0, Math.min(ta, tb));
        t1 = Math.min(1, Math.max(ta, tb));
      } else if (x1 < lo || x1 > hi) {
        cerrar(); continue; // segmento vertical fuera de la franja
      }
      if (t0 > t1) { cerrar(); continue; } // segmento enteramente fuera de [lo,hi]

      const xs = x1 + dx * t0, ys = y1 + (y2 - y1) * t0;
      const xe = x1 + dx * t1, ye = y1 + (y2 - y1) * t1;
      if (buffer.length === 0) {
        buffer.push(xs, ys);
      } else {
        // Discontinuidad respecto al último punto → hubo un salto: cierra y reabre.
        const lx = buffer[buffer.length - 2], ly = buffer[buffer.length - 1];
        if (Math.abs(xs - lx) > 1e-9 || Math.abs(ys - ly) > 1e-9) { cerrar(); buffer.push(xs, ys); }
      }
      buffer.push(xe, ye);
    }
    cerrar();
  }
  return salida;
}
