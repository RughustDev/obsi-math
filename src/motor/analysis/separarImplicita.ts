// ─────────────────────────────────────────────
// analysis · Separación algebraica de implícitas en ramas explícitas
// ─────────────────────────────────────────────
//
// AGNÓSTICO y NUMÉRICO (Ring 1): opera SOLO sobre el oráculo `CampoEscalar`, sin
// mathjs ni símbolos. Detecta dos formas SEPARABLES de F(x,y)=0:
//   (A) LINEAL en y      F = a·y + c(x)        → 1 rama   y = −c(x)/a
//   (B) CUADRÁTICA PAR    F = a·y² + c(x)       → 2 ramas  y = ±√(−c(x)/a)
// con a constante (verificado en varios puntos) y c(x)=F(x,0). Si no es ninguna,
// devuelve null (la implícita va al trazador por continuación, lo general).
//
// POR QUÉ: una curva separable CON POLOS (p.ej. tan x + y² = 2 ⇒ y=±√(2−tan x)) es
// una astilla casi vertical pegada a cada asíntota que la continuación por gradiente
// numérico no resuelve de forma fiable al alejar el zoom (cruza el polo y conecta
// cálices vecinos). Pero como 1–2 funciones explícitas, el sampler 1D la traza
// perfecto a cualquier zoom (corta limpio en los polos). Es el "reutilizar el mejor
// algoritmo" del proyecto. El composition root solo deriva a esta ruta cuando F ES
// separable Y `tienePolos` (las cónicas suaves siguen por continuación → lazos cerrados).

import type { CampoEscalar, FuncionReal } from "../contracts";

/**
 * Campo TRANSPUESTO: Ft(x,y) = F(y,x). Permite reutilizar `despejarRamas`/`tienePolos`/
 * `localizarPolos` para las implícitas separables en X (F = a·xⁿ + c(y), p.ej.
 * tan(y)+x=5 ⇒ x = 5−tan y): se despeja la transpuesta como y=g(x) y el proveedor
 * gira el resultado (ver ProveedorImplicitoSeparable con `transpuesta=true`).
 */
export function campoTranspuesto(F: CampoEscalar): CampoEscalar {
  return { eval: (x, y) => F.eval(y, x) };
}

const XS = [0.37, 1.13, -0.91, 2.07, -1.6];   // puntos de prueba en x
const YS = [0.41, -0.72, 2.33, 1.05, -0.3];   // puntos de prueba en y (sin ceros)
const TOL_REL = 1e-6;
const A_MIN = 1e-9;

const N_MAX = 6; // grado máximo en y que se intenta despejar

/**
 * Devuelve las ramas explícitas y=f(x) de una implícita separable de la forma
 * F(x,y) = a·yⁿ + c(x) (UN solo monomio en y), o null. Cubre lineal (n=1, 1 rama),
 * cuadrática par (n=2, 2 ramas ±√), cúbica (n=3, 1 rama ∛), y en general:
 *   • n IMPAR → 1 rama   y = signo(g)·|g|^(1/n)   (real para todo g = −c/a)
 *   • n PAR   → 2 ramas  y = ±|g|^(1/n)  donde g ≥ 0  (NaN si g < 0)
 * Detección: para cada n se comprueba que a = (F(x,y)−F(x,0))/yⁿ es la MISMA constante
 * en todos los puntos de prueba (distintos x Y distintos y) — eso descarta a la vez las
 * mezclas de potencias (p.ej. y³−3xy del folium → a varía → null) y lo no polinómico.
 */
export function despejarRamas(F: CampoEscalar): FuncionReal[] | null {
  for (let n = 1; n <= N_MAX; n++) {
    let a0: number | null = null;
    let ok = true;
    for (let i = 0; i < XS.length; i++) {
      const x = XS[i], y = YS[i];                  // YS no tiene ceros
      const f0 = F.eval(x, 0), fy = F.eval(x, y);
      if (!Number.isFinite(f0) || !Number.isFinite(fy)) { ok = false; break; }
      const yn = Math.pow(y, n);
      if (Math.abs(yn) < 1e-12) { ok = false; break; }
      const a = (fy - f0) / yn;
      if (a0 === null) a0 = a;
      else if (Math.abs(a - a0) > TOL_REL * (1 + Math.abs(a0))) { ok = false; break; }
    }
    if (ok && a0 !== null && Math.abs(a0) >= A_MIN) return ramasMonomio(F, n, a0);
  }
  return null;
}

/** Construye las ramas y = (−c/a)^(1/n) (g=−c/a = yⁿ). Impar: 1 rama; par: 2 (±). */
function ramasMonomio(F: CampoEscalar, n: number, a: number): FuncionReal[] {
  const g = (x: number): number => -F.eval(x, 0) / a;           // yⁿ = g(x)
  if (n % 2 === 1) {
    // Raíz impar: real para todo g (incluido negativo).
    return [{ eval: (x: number) => { const v = g(x); return Math.sign(v) * Math.pow(Math.abs(v), 1 / n); } }];
  }
  // Raíz par: dos ramas, solo donde g ≥ 0.
  return [
    { eval: (x: number) => { const v = g(x); return v >= 0 ? Math.pow(v, 1 / n) : NaN; } },
    { eval: (x: number) => { const v = g(x); return v >= 0 ? -Math.pow(v, 1 / n) : NaN; } },
  ];
}

// ─── Separación TRIGONOMÉTRICA en y (periódica) ──────────────────────────────
//
// Detecta la forma F(x,y) = a(x)·T(y) + c(x) con T una trig PERIÓDICA de y (tan,
// cot, sin, cos, sec, csc) y a(x) NO constante en general (a diferencia de
// despejarRamas, que exige a constante). Entonces T(y) = g(x) = −c(x)/a(x) y la
// curva son INFINITAS ramas explícitas y = T⁻¹(g(x)) + k·período — que la
// continuación pierde al alejar el zoom (el grid de semillas no las ve todas),
// p.ej. tan(y)·(x²+1)=√(x+1). Es la "misma filosofía" de las separables con polos
// (Etapa 7/12) en HORIZONTAL: reducir a funciones explícitas y usar el sampler 1D.
//
// Detección NUMÉRICA (sin símbolos): para cada x de prueba se resuelven a(x), c(x)
// con dos y de referencia y se VERIFICA la afinidad en el resto de ys. Cualquier
// dependencia extra en y (y·tan y, tan²y, y+tan y…) rompe la afinidad → null.

export type TrigY = "tan" | "cot" | "sin" | "cos" | "sec" | "csc";
export interface SeparacionTrigY {
  tipo: TrigY;
  /** g(x) = −c(x)/a(x): el valor que debe tomar T(y) sobre la curva. */
  g: (x: number) => number;
}

const TRIGS: ReadonlyArray<{ tipo: TrigY; T: (y: number) => number }> = [
  { tipo: "tan", T: Math.tan },
  { tipo: "cot", T: (y) => 1 / Math.tan(y) },
  { tipo: "sin", T: Math.sin },
  { tipo: "cos", T: Math.cos },
  { tipo: "sec", T: (y) => 1 / Math.cos(y) },
  { tipo: "csc", T: (y) => 1 / Math.sin(y) },
];

/**
 * Devuelve la separación trigonométrica en y de F, o null. y₁,y₂ resuelven el
 * sistema lineal {F = a·Tᵢ + c}; los demás ys verifican. Los x donde F no es
 * finita (dominios parciales tipo √(x+1)) se saltan; se exigen ≥3 x válidos y
 * que a(x) no sea ~0 en todos (si no, F no depende de y por esta vía).
 */
export function separarTrigY(F: CampoEscalar): SeparacionTrigY | null {
  const [y1, y2, ...resto] = YS;
  for (const { tipo, T } of TRIGS) {
    const T1 = T(y1), T2 = T(y2);
    let validos = 0, maxA = 0, ok = true;
    for (const x of XS) {
      const F1 = F.eval(x, y1), F2 = F.eval(x, y2);
      if (!Number.isFinite(F1) || !Number.isFinite(F2)) continue;
      const a = (F1 - F2) / (T1 - T2);
      const c = F1 - a * T1;
      let escala = 1 + Math.abs(a) + Math.abs(c);
      let valido = true;
      for (const y of resto) {
        const real = F.eval(x, y);
        if (!Number.isFinite(real)) { valido = false; break; }
        escala = Math.max(escala, 1 + Math.abs(real));
        if (Math.abs(a * T(y) + c - real) > TOL_REL * escala) { ok = false; break; }
      }
      if (!ok) break;
      if (!valido) continue;
      validos++;
      maxA = Math.max(maxA, Math.abs(a));
    }
    if (ok && validos >= 3 && maxA >= A_MIN) {
      const g = (x: number): number => {
        const F1 = F.eval(x, y1), F2 = F.eval(x, y2);
        const a = (F1 - F2) / (T1 - T2);
        return -(F1 - a * T1) / a;
      };
      return { tipo, g };
    }
  }
  return null;
}

// ─── Separación por MONOMIO recíproco/absoluto en y ──────────────────────────
//
// Detecta F(x,y) = a(x)·M(y) + c(x) con M un monomio de y RECÍPROCO o ABSOLUTO
// (1/|y|, 1/y, 1/y², |y|). Entonces M(y) = g(x) = −c(x)/a(x) y la curva son 1–2
// ramas explícitas y = M⁻¹(g(x)), que el sampler 1D traza a cualquier zoom.
//
// POR QUÉ (no lo cubre `despejarRamas`): esa ancla c(x) en F(x,0), y un monomio
// RECÍPROCO hace F(x,0) INFINITA (1/|y| → ∞ en y=0) → su detección aborta; y el
// monomio ABSOLUTO rompe el test de a constante (a·|y|/y cambia de signo con y).
// Ambas familias caían al descubrimiento por rejilla, que las PIERDE al alejar el
// zoom: la curva se pega a su asíntota (1/|x|+1/|y|=1 tiende a |y|=1) y el cambio de
// signo de F queda DENTRO de una celda —además, la fila y=0 de la rejilla es un polo
// (F no finita) y se descarta—, así que no se siembra ninguna semilla y las ramas
// DESAPARECEN. Como funciones explícitas y=±|x|/(|x|−1), el sampler 1D las clava.
//
// Detección NUMÉRICA (misma estructura que `separarTrigY`): a(x), c(x) se resuelven
// con dos y de referencia y se VERIFICA la afinidad en el resto. La verificación es
// lo que discrimina las bases entre sí (una F en 1/y no pasa el test con base 1/|y|,
// ni un polinomio con ninguna) → sin falsos positivos.

interface MonomioY {
  nombre: string;
  /** El monomio M(y). */
  M: (y: number) => number;
  /** Las y con M(y)=g: 2 (monomio PAR: ± ), 1 (IMPAR) o 0 (sin solución real). */
  inversa: (g: number) => number[];
  /** Nº de ramas explícitas que produce (2 par / 1 impar). */
  nRamas: number;
}

const MONOMIOS: readonly MonomioY[] = [
  // 1/|y| (par): 1/|x|+1/|y|=1 ⇒ |y| = 1/g ⇒ y = ±1/g, solo donde g>0.
  { nombre: "1/|y|", M: (y) => 1 / Math.abs(y), nRamas: 2,
    inversa: (g) => (g > 0 ? [1 / g, -1 / g] : []) },
  // 1/y (impar): 1/x+1/y=1 ⇒ y = 1/g (real para todo g≠0).
  { nombre: "1/y", M: (y) => 1 / y, nRamas: 1,
    inversa: (g) => (g !== 0 && Number.isFinite(g) ? [1 / g] : []) },
  // 1/y² (par): 1/x²+1/y²=1 ⇒ y = ±1/√g, solo donde g>0.
  { nombre: "1/y^2", M: (y) => 1 / (y * y), nRamas: 2,
    inversa: (g) => (g > 0 ? [1 / Math.sqrt(g), -1 / Math.sqrt(g)] : []) },
  // |y| (par): |x|+|y|=1 (rombo) ⇒ y = ±g, solo donde g≥0.
  { nombre: "|y|", M: (y) => Math.abs(y), nRamas: 2,
    inversa: (g) => (g >= 0 ? [g, -g] : []) },
];

/**
 * Ramas explícitas y=f(x) de una implícita AFÍN en un monomio recíproco/absoluto de y
 * (F = a(x)·M(y) + c(x)), o null si no encaja en ninguna base. 2 ramas si M es par
 * (±), 1 si es impar. Fuera del dominio (g sin solución real) la rama devuelve NaN →
 * el sampler la parte, como con cualquier función explícita.
 */
export function ramasMonomioY(F: CampoEscalar): FuncionReal[] | null {
  const [y1, y2, ...resto] = YS;
  for (const m of MONOMIOS) {
    const M1 = m.M(y1), M2 = m.M(y2);
    if (!Number.isFinite(M1) || !Number.isFinite(M2) || Math.abs(M1 - M2) < 1e-12) continue;

    let validos = 0, maxA = 0, ok = true;
    for (const x of XS) {
      const F1 = F.eval(x, y1), F2 = F.eval(x, y2);
      if (!Number.isFinite(F1) || !Number.isFinite(F2)) continue;
      const a = (F1 - F2) / (M1 - M2);
      const c = F1 - a * M1;
      let escala = 1 + Math.abs(a) + Math.abs(c);
      let valido = true;
      for (const y of resto) {
        const real = F.eval(x, y);
        if (!Number.isFinite(real)) { valido = false; break; }
        escala = Math.max(escala, 1 + Math.abs(real));
        if (Math.abs(a * m.M(y) + c - real) > TOL_REL * escala) { ok = false; break; }
      }
      if (!ok) break;
      if (!valido) continue;
      validos++;
      maxA = Math.max(maxA, Math.abs(a));
    }
    if (!ok || validos < 3 || maxA < A_MIN) continue;

    // g(x) = −c(x)/a(x): el valor que M(y) debe tomar sobre la curva (a y c se re-resuelven
    // en cada x, así que a(x) NO tiene que ser constante —a diferencia de `despejarRamas`).
    const g = (x: number): number => {
      const F1 = F.eval(x, y1), F2 = F.eval(x, y2);
      const a = (F1 - F2) / (M1 - M2);
      return -(F1 - a * M1) / a;
    };
    // Una FuncionReal por rama: la k-ésima solución de M(y)=g(x), o NaN fuera del dominio.
    return Array.from({ length: m.nRamas }, (_, k): FuncionReal => ({
      eval: (x: number) => {
        const ys = m.inversa(g(x));
        return k < ys.length ? ys[k] : NaN;
      },
    }));
  }
  return null;
}

/**
 * ¿F tiene POLOS (asíntotas verticales) en c(x)=F(x,0)? Escanea F(x,0) y detecta un
 * cambio de signo donde la magnitud es GRANDE a ambos lados (firma de polo +∞↔−∞;
 * un cero real tiene |F| pequeño cerca). Distingue tan(x)−2 (poled) de x²−9 (no). El
 * gate que decide continuación (cónica suave) vs ramas explícitas (separable con polos).
 */
export function tienePolos(F: CampoEscalar): boolean {
  const N = 2000, x0 = -50, x1 = 50;
  const paso = (x1 - x0) / N;
  let prev = F.eval(x0, 0);
  for (let i = 1; i <= N; i++) {
    const x = x0 + i * paso;
    const v = F.eval(x, 0);
    if (!Number.isFinite(v)) { prev = v; continue; }
    if (Number.isFinite(prev) && prev * v < 0) {
      // cambio de signo: pequeño en ambos lados = cero real; grande = polo.
      if (Math.min(Math.abs(prev), Math.abs(v)) > 1) return true;
    }
    prev = v;
  }
  return false;
}

/**
 * Localiza las x de los POLOS de c(x)=F(x,0) dentro de [x0,x1] (asíntotas verticales
 * de las ramas despejadas). Detecta cada salto +∞↔−∞ (cambio de signo con |F| grande a
 * ambos lados) y lo bisecta hasta la asíntota. Lo usa el proveedor separable para CORTAR
 * las ramas en los polos que el sampler 1D no detecta cuando la raíz los comprime (p.ej.
 * ∛ aplana el polo: `cbrt(2−tan x)` no dispara el corte por |y|→∞ a muestreo grueso).
 */
export function localizarPolos(F: CampoEscalar, x0: number, x1: number): number[] {
  // Paso fino (≤0.08 de mundo) para bracketar polos densos (tan tiene uno cada π).
  // Acotado para no disparar el coste en vistas enormes; suficiente para ~40/periodo.
  const N = Math.min(20000, Math.max(1500, Math.ceil((x1 - x0) / 0.08)));
  const paso = (x1 - x0) / N;
  const polos: number[] = [];
  let xa = x0, fa = F.eval(x0, 0);
  for (let i = 1; i <= N; i++) {
    const xb = x0 + i * paso;
    const fb = F.eval(xb, 0);
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa * fb < 0 &&
        Math.min(Math.abs(fa), Math.abs(fb)) > 1) {
      // Bisección hacia el cambio de signo (la asíntota) dentro de [xa,xb].
      let lo = xa, hi = xb, flo = fa;
      for (let k = 0; k < 50; k++) {
        const m = (lo + hi) / 2, fm = F.eval(m, 0);
        if (!Number.isFinite(fm) || flo * fm < 0) hi = m; else { lo = m; flo = fm; }
      }
      polos.push((lo + hi) / 2);
    }
    xa = xb; fa = fb;
  }
  return polos;
}
