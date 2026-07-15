// ─────────────────────────────────────────────
// tracing/parametric · Trazador paramétrico ADAPTATIVO (Etapa 6)
// ─────────────────────────────────────────────
//
// Traza una curva p(t)=(x(t),y(t)) muestreando el PARÁMETRO t y refinando por
// geometría EN PANTALLA. Sirve por igual a paramétricas y polares (una polar es
// una paramétrica cartesiana). Misma filosofía que el sampler explícito —densidad
// ligada a píxeles, refinado por error en pantalla, corte en discontinuidades—
// pero en 2D, porque la curva no es función de x: el criterio de refinamiento es
// la DESVIACIÓN del punto medio respecto a la cuerda en píxeles (error de Fréchet
// en pantalla, justo lo que promete `Tolerancia.desviacionMaxPx`).
//
// Produce la MISMA `Rama` que los demás trazadores → "no se nota la estrategia".
// Las ramas paramétricas se emiten SIN `parametro`: `analysis/lecturaRama` usa
// `parametro` como la x (crosshair/carril por-x), y t≠x lo leería mal; el
// crosshair/carril por t/arco es trabajo futuro (igual que en implícitas).
//
// Casos generales (no parches por función):
//   • Hueco de dominio (p(t) no finito: raíz de negativo, etc.) → parte la rama,
//     bisecando para acercar el borde del dominio.
//   • Discontinuidad / polo (salto enorme en pantalla que NO se reduce al
//     subdividir, p.ej. r→∞ en una polar, o tan) → parte la rama (no une el salto).
//   • Cierre: una sola rama sin cortes con extremos coincidentes en pantalla →
//     `cerrada` (círculos, cardioides…).

import type {
  TrazadorParametrico,
  Parametrizacion,
  Viewport,
  Tolerancia,
  Rama,
} from "../../contracts";

// `util` = el punto sirve para trazar: es finito Y está dentro del viewport
// expandido por un margen. Un punto finito pero MUY lejos (p.ej. una polar con
// r→∞ cerca de un polo, o tan) NO es útil: se trata como borde de hueco (se cierra
// la rama y se reanuda al volver a la vista), igual que un valor no finito. Así se
// evita la fragmentación en miles de micro-ramas mientras la curva corre al
// infinito, y se acota el trabajo a lo que se ve (el renderer recorta a la vista).
type Pt = { x: number; y: number; sx: number; sy: number; util: boolean };
type Presupuesto = { evals: number; max: number };

const N0_FINAL = 400;            // muestras uniformes iniciales (pasada final)
const N0_INTERACTIVO = 200;
const PROF_MAX_FINAL = 20;       // profundidad de subdivisión por tramo
const PROF_MAX_INTERACTIVO = 14;
const SALTO_PX_FINAL = 10;       // cuerda en pantalla que fuerza subdivisión (densidad)
const SALTO_PX_INTERACTIVO = 16;
const MAX_EVALS_FINAL = 300_000;       // cota determinista (polares/paramétricas densas)
const MAX_EVALS_INTERACTIVO = 100_000;

export class TrazadorParametricoAdaptativo implements TrazadorParametrico {
  trazar(
    p: Parametrizacion,
    objetoId: string,
    viewport: Viewport,
    tolerancia: Tolerancia
  ): readonly Rama[] {
    const [t0, t1] = p.dominio;
    if (!(t1 > t0) || !Number.isFinite(t0) || !Number.isFinite(t1)) return [];

    const interactivo = tolerancia.pasada === "interactiva";
    const N0 = interactivo ? N0_INTERACTIVO : N0_FINAL;
    const PROF_MAX = interactivo ? PROF_MAX_INTERACTIVO : PROF_MAX_FINAL;
    const SALTO_PX = interactivo ? SALTO_PX_INTERACTIVO : SALTO_PX_FINAL;
    // Umbral de desviación en píxeles: HONRA el campo del contrato (primer consumidor
    // real de `desviacionMaxPx`); durante el gesto se afloja ×2 (menos puntos).
    const desvBase =
      Number.isFinite(tolerancia.desviacionMaxPx) && tolerancia.desviacionMaxPx > 0
        ? tolerancia.desviacionMaxPx
        : 0.5;
    const DESV = Math.max(0.05, desvBase) * (interactivo ? 2 : 1);
    // Salto que se considera DISCONTINUIDAD si no se reduce al subdividir.
    const SALTO_DISC = Math.max(viewport.anchoPx, viewport.altoPx) * 0.5;

    const ax = viewport.anchoPx / (viewport.domX[1] - viewport.domX[0]);
    const ay = viewport.altoPx / (viewport.domY[1] - viewport.domY[0]);
    const sx = (x: number): number => (x - viewport.domX[0]) * ax;
    const sy = (y: number): number => viewport.altoPx - (y - viewport.domY[0]) * ay;
    // Margen de utilidad: viewport expandido 1× su tamaño por cada lado (3× total).
    // Lo de fuera no se traza (el renderer recorta a la vista); evita perseguir ∞.
    const mx = viewport.domX[1] - viewport.domX[0];
    const my = viewport.domY[1] - viewport.domY[0];
    const enMargen = (x: number, y: number): boolean =>
      x > viewport.domX[0] - mx && x < viewport.domX[1] + mx &&
      y > viewport.domY[0] - my && y < viewport.domY[1] + my;

    const presupuesto: Presupuesto = {
      evals: 0,
      max: interactivo ? MAX_EVALS_INTERACTIVO : MAX_EVALS_FINAL,
    };
    const ev = (t: number): Pt => {
      presupuesto.evals++;
      const q = p.eval(t);
      const util = Number.isFinite(q.x) && Number.isFinite(q.y) && enMargen(q.x, q.y);
      return { x: q.x, y: q.y, sx: util ? sx(q.x) : NaN, sy: util ? sy(q.y) : NaN, util };
    };

    const ramas: Rama[] = [];
    let seg: number[] = [];
    let corte = false; // ¿hubo algún corte (hueco/discontinuidad)? → no puede cerrar
    const flush = () => {
      if (seg.length >= 4)
        ramas.push({ puntos: Float64Array.from(seg), cerrada: false, calidad: "best-effort", objetoId });
      seg = [];
    };
    const push = (q: Pt) => { seg.push(q.x, q.y); };

    // Procesa (ta,A] → (tb,B], asumiendo A ya emitido. Subdivide por desviación.
    const tramo = (ta: number, A: Pt, tb: number, B: Pt, prof: number): void => {
      if (presupuesto.evals > presupuesto.max) { if (A.util) push(A); return; }

      if (A.util && B.util) {
        const dxs = B.sx - A.sx, dys = B.sy - A.sy;
        const cuerda = Math.hypot(dxs, dys);
        if (prof < PROF_MAX) {
          const tm = (ta + tb) / 2;
          const M = ev(tm);
          if (M.util) {
            // Distancia perpendicular de M a la cuerda A–B, en píxeles.
            const dev = cuerda < 1e-9
              ? Math.hypot(M.sx - A.sx, M.sy - A.sy)
              : Math.abs(dxs * (A.sy - M.sy) - (A.sx - M.sx) * dys) / cuerda;
            if (dev > DESV || cuerda > SALTO_PX) {
              tramo(ta, A, tm, M, prof + 1);
              tramo(tm, M, tb, B, prof + 1);
              return;
            }
          } else {
            // El punto medio sale del margen (hueco de dominio o salida de la vista).
            tramo(ta, A, tm, M, prof + 1);
            tramo(tm, M, tb, B, prof + 1);
            return;
          }
        }
        // Profundidad agotada: salto enorme = discontinuidad (no se redujo) → corta.
        if (cuerda > SALTO_DISC) { push(A); flush(); corte = true; push(B); return; }
        push(B);
        return;
      }

      // A útil, B fuera (hueco de dominio o fuera de la vista) → bisecar el borde y cerrar.
      if (A.util && !B.util) {
        let lo = ta, hi = tb, ultimo = A;
        for (let k = 0; k < 24; k++) {
          const M = ev((lo + hi) / 2);
          if (M.util) { lo = (lo + hi) / 2; ultimo = M; } else hi = (lo + hi) / 2;
        }
        push(ultimo); flush(); corte = true;
        return;
      }
      // A fuera, B útil → bisecar el borde e iniciar nueva rama.
      if (!A.util && B.util) {
        if (seg.length > 0) flush();
        let lo = tb, hi = ta, ultimo = B;
        for (let k = 0; k < 24; k++) {
          const M = ev((lo + hi) / 2);
          if (M.util) { lo = (lo + hi) / 2; ultimo = M; } else hi = (lo + hi) / 2;
        }
        corte = true;
        push(ultimo); push(B);
        return;
      }
      // Ambos fuera → hueco; cierra lo que hubiera.
      if (seg.length > 0) { flush(); corte = true; }
    };

    const dt = (t1 - t0) / N0;
    let tA = t0;
    let A = ev(tA);
    if (A.util) push(A); else corte = true;
    for (let i = 1; i <= N0 && presupuesto.evals <= presupuesto.max; i++) {
      const tB = t0 + i * dt;
      const B = ev(tB);
      tramo(tA, A, tB, B, 0);
      tA = tB;
      A = B;
    }
    flush();

    // Cierre: una sola rama sin cortes y con extremos que coinciden en pantalla.
    if (!corte && ramas.length === 1) {
      const r = ramas[0].puntos, n = r.length;
      if (n >= 6) {
        const d = Math.hypot(sx(r[0]) - sx(r[n - 2]), sy(r[1]) - sy(r[n - 1]));
        if (d < Math.max(1, DESV * 2)) ramas[0] = { ...ramas[0], cerrada: true };
      }
    }
    return ramas;
  }
}
