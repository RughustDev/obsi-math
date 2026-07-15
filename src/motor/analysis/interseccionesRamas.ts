// ─────────────────────────────────────────────
// analysis · Intersecciones entre geometrías (AGNÓSTICO de la fórmula)
// ─────────────────────────────────────────────
//
// Intersecciones de un SISTEMA derivadas de la geometría YA trazada: dónde se
// cruzan las polilíneas (`Rama`) de dos objetos DISTINTOS. No evalúa oráculos ni
// sabe qué estrategia produjo cada rama (explícita, continuación, paramétrica,
// separable…) → sirve para cualquier par de tipos, presentes y futuros. Es el
// mismo principio que crosshair/carril/puntos notables: el análisis lee de la
// `Rama`, no de la fórmula. (Reemplaza al solver de Newton del SystemEngine, que
// necesitaba conocer las fórmulas del sistema y se retiró junto a ese motor.)
//
// Límites deliberados, aceptados a cambio de esa agnosticidad:
//   • Precisión = la del trazado (subpíxel en pantalla), no 1e-9 de Newton.
//   • Tangencias sin cruce pueden no detectarse (las cuerdas no se cortan).
//   • Curvas solapadas (segmentos colineales) no producen puntos aislados.

import type { Geometria, Punto, Rama } from "../contracts";

/** Cota determinista de trabajo/salida para pares patológicos (curvas densas).
 *  Si el resultado ALCANZA esta cota, la enumeración quedó incompleta y sesgada
 *  por el orden de barrido → el consumidor debe tratarla como "no enumerable"
 *  (la Escena descarta los marcadores y el panel avisa). */
export const MAX_PUNTOS = 200;

/** Un segmento que abarca más celdas que esto (vertical de polo, |y| enorme) no
 *  entra en la rejilla: va a una lista aparte testeada contra todo (acotado). */
const LIMITE_CELDAS = 256;

/**
 * Punto de cruce de los segmentos AB y CD, o null si no se cortan. Paralelos y
 * colineales (det≈0, umbral RELATIVO a las longitudes) devuelven null: un solape
 * no tiene puntos aislados que listar.
 */
export function interseccionSegmentos(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
): Punto | null {
  const rx = bx - ax, ry = by - ay;
  const sx = dx - cx, sy = dy - cy;
  const det = rx * sy - ry * sx;
  if (Math.abs(det) <= 1e-12 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return null;
  const qx = cx - ax, qy = cy - ay;
  const t = (qx * sy - qy * sx) / det;
  const u = (qx * ry - qy * rx) / det;
  const EPS = 1e-9; // holgura para contactos exactos en un extremo
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: ax + t * rx, y: ay + t * ry };
}

/**
 * ¿Los segmentos AB y CD son COLINEALES y se SOLAPAN sobre una longitud positiva?
 * (dos curvas que coinciden en un tramo → infinitas soluciones ahí, no un cruce
 * aislado). Exige: (1) casi paralelos, (2) C sobre la recta de AB dentro de `eps`
 * (misma recta, no dos paralelas separadas), (3) el solape en el parámetro cubra
 * más de la mitad del segmento más corto (descarta el roce tangente en un extremo).
 */
export function solapanColineales(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
  eps: number
): boolean {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const lenR = Math.hypot(rx, ry), lenS = Math.hypot(sx, sy);
  if (lenR < 1e-12 || lenS < 1e-12) return false;
  if (Math.abs(rx * sy - ry * sx) > 1e-6 * lenR * lenS) return false;   // no paralelos
  const qx = cx - ax, qy = cy - ay;
  if (Math.abs(rx * qy - ry * qx) / lenR > eps) return false;           // recta distinta
  // Proyección de C y D sobre AB (parámetro t∈[0,1] = A→B); ¿solape con [0,1]?
  const inv = 1 / (lenR * lenR);
  let tc = (qx * rx + qy * ry) * inv;
  let td = ((dx - ax) * rx + (dy - ay) * ry) * inv;
  if (tc > td) { const t = tc; tc = td; td = t; }
  const lo = Math.max(0, tc), hi = Math.min(1, td);
  if (hi <= lo) return false;
  return (hi - lo) * lenR > 0.5 * Math.min(lenR, lenS);
}

/** Región de mundo a la que se recortan los segmentos (típicamente la vista). */
export interface RegionMundo {
  readonly x0: number; readonly x1: number;
  readonly y0: number; readonly y1: number;
}

/**
 * Intersecciones entre las ramas de objetos DISTINTOS (pares i<j), deduplicadas
 * a `epsilonMundo` (típicamente unos px convertidos a mundo por quien llama).
 * Determinista; a lo sumo `maxPuntos` resultados. Si se pasa `region`, los
 * segmentos se RECORTAN a ella antes de cruzarse (solo interesan los cruces de
 * la vista, y el recorte acota los verticales de polo, |y|~1e15, que de otro
 * modo degradan la rejilla espacial).
 */
export function interseccionesDeGeometrias(
  geometrias: readonly Geometria[],
  epsilonMundo: number,
  maxPuntos = MAX_PUNTOS,
  region?: RegionMundo,
  estado?: EstadoInterseccion
): Punto[] {
  const out: Punto[] = [];
  for (let i = 0; i < geometrias.length && out.length < maxPuntos; i++) {
    for (let j = i + 1; j < geometrias.length && out.length < maxPuntos; j++) {
      cruzarRamas(geometrias[i].ramas, geometrias[j].ramas, epsilonMundo, maxPuntos, out, region, estado);
    }
  }
  return out;
}

/** Acumulador opcional de estado cualitativo del cruce: `solapa=true` si algún par
 *  de curvas COINCIDE en un tramo (solución continua → infinitas soluciones), que
 *  es distinto de "muchos puntos aislados" (saturación del cap). */
export interface EstadoInterseccion { solapa: boolean; }

/** Segmentos finitos de un conjunto de ramas, empaquetados [ax,ay,bx,by, …],
 *  recortados a `region` (Liang–Barsky) si se pasa. */
function segmentosDe(ramas: readonly Rama[], region?: RegionMundo): Float64Array {
  let n = 0;
  for (const r of ramas) n += Math.max(0, r.puntos.length / 2 - 1);
  const segs = new Float64Array(n * 4);
  let k = 0;
  for (const r of ramas) {
    const p = r.puntos;
    for (let m = 0; m + 3 < p.length; m += 2) {
      let ax = p[m], ay = p[m + 1], bx = p[m + 2], by = p[m + 3];
      if (!Number.isFinite(ax) || !Number.isFinite(ay) ||
          !Number.isFinite(bx) || !Number.isFinite(by)) continue;
      if (region) {
        // Recorte Liang–Barsky del segmento al rectángulo (sin arrays: cero GC).
        const dx = bx - ax, dy = by - ay;
        let t0 = 0, t1 = 1, fuera = false;
        for (let lado = 0; lado < 4 && !fuera; lado++) {
          const pp = lado === 0 ? -dx : lado === 1 ? dx : lado === 2 ? -dy : dy;
          const qq = lado === 0 ? ax - region.x0 : lado === 1 ? region.x1 - ax
                   : lado === 2 ? ay - region.y0 : region.y1 - ay;
          if (pp === 0) { if (qq < 0) fuera = true; continue; }
          const t = qq / pp;
          if (pp < 0) { if (t > t1) fuera = true; else if (t > t0) t0 = t; }
          else { if (t < t0) fuera = true; else if (t < t1) t1 = t; }
        }
        if (fuera) continue;
        bx = ax + t1 * dx; by = ay + t1 * dy;
        ax = ax + t0 * dx; ay = ay + t0 * dy;
      }
      segs[k++] = ax; segs[k++] = ay; segs[k++] = bx; segs[k++] = by;
    }
  }
  return k === segs.length ? segs : (segs.subarray(0, k) as Float64Array);
}

function agregarUnico(out: Punto[], p: Punto, eps: number, maxPuntos: number): void {
  if (out.length >= maxPuntos) return;
  for (const q of out) if (Math.hypot(q.x - p.x, q.y - p.y) < eps) return;
  out.push(p);
}

/**
 * Cruza todos los segmentos de A contra los de B con una rejilla espacial sobre A
 * (celda ≈ longitud media de segmento → consulta ~O(1) por segmento de B; mismo
 * idioma que `eliminarDuplicados` del trazador de continuación).
 */
function cruzarRamas(
  ramasA: readonly Rama[],
  ramasB: readonly Rama[],
  eps: number,
  maxPuntos: number,
  out: Punto[],
  region?: RegionMundo,
  estado?: EstadoInterseccion
): void {
  const A = segmentosDe(ramasA, region);
  const B = segmentosDe(ramasB, region);
  const nA = A.length / 4, nB = B.length / 4;
  if (nA === 0 || nB === 0) return;

  // Celda = MEDIANA de las longitudes de segmento (no la media: los verticales
  // de polo miden ~1e15 y dispararían la media → una sola celda → O(nA·nB)).
  const longitudes = new Float64Array(nA);
  for (let s = 0; s < nA; s++) {
    longitudes[s] = Math.hypot(A[s * 4 + 2] - A[s * 4], A[s * 4 + 3] - A[s * 4 + 1]);
  }
  longitudes.sort();
  let celda = Math.max(longitudes[nA >> 1], eps);
  if (!(celda > 0)) celda = 1;

  const mapa = new Map<string, number[]>();
  const fuera: number[] = []; // segmentos de A demasiado grandes para la rejilla
  for (let s = 0; s < nA; s++) {
    const cx0 = Math.floor(Math.min(A[s * 4], A[s * 4 + 2]) / celda);
    const cx1 = Math.floor(Math.max(A[s * 4], A[s * 4 + 2]) / celda);
    const cy0 = Math.floor(Math.min(A[s * 4 + 1], A[s * 4 + 3]) / celda);
    const cy1 = Math.floor(Math.max(A[s * 4 + 1], A[s * 4 + 3]) / celda);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > LIMITE_CELDAS) { fuera.push(s); continue; }
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const clave = cx + "," + cy;
        const lista = mapa.get(clave);
        if (lista) lista.push(s); else mapa.set(clave, [s]);
      }
    }
  }

  // `visto` evita re-testear el mismo segmento de A para un mismo segmento de B
  // (un segmento vive en varias celdas). Sello por índice de B.
  const visto = new Int32Array(nA).fill(-1);
  const testear = (sa: number, sb: number) => {
    if (visto[sa] === sb) return;
    visto[sa] = sb;
    const ax = A[sa * 4], ay = A[sa * 4 + 1], bx = A[sa * 4 + 2], by = A[sa * 4 + 3];
    const cx = B[sb * 4], cy = B[sb * 4 + 1], dx = B[sb * 4 + 2], dy = B[sb * 4 + 3];
    const p = interseccionSegmentos(ax, ay, bx, by, cx, cy, dx, dy);
    if (p) agregarUnico(out, p, eps, maxPuntos);
    // Cruce propio (det≠0) descarta el solape; solo se comprueba si NO hubo punto.
    else if (estado && !estado.solapa && solapanColineales(ax, ay, bx, by, cx, cy, dx, dy, eps))
      estado.solapa = true;
  };

  for (let sb = 0; sb < nB && out.length < maxPuntos; sb++) {
    const cx0 = Math.floor(Math.min(B[sb * 4], B[sb * 4 + 2]) / celda);
    const cx1 = Math.floor(Math.max(B[sb * 4], B[sb * 4 + 2]) / celda);
    const cy0 = Math.floor(Math.min(B[sb * 4 + 1], B[sb * 4 + 3]) / celda);
    const cy1 = Math.floor(Math.max(B[sb * 4 + 1], B[sb * 4 + 3]) / celda);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > LIMITE_CELDAS) {
      // Segmento de B enorme (vertical de polo): contra todo A, sin rejilla.
      for (let sa = 0; sa < nA; sa++) testear(sa, sb);
      continue;
    }
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const lista = mapa.get(cx + "," + cy);
        if (lista) for (const sa of lista) testear(sa, sb);
      }
    }
    for (const sa of fuera) testear(sa, sb);
  }
}
