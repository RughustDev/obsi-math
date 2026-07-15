// ─────────────────────────────────────────────
// analysis · Lectura de geometría (AGNÓSTICA de la fórmula)
// ─────────────────────────────────────────────
//
// Primitivos compartidos por el crosshair y el carril, que se alimentan SOLO de la
// `Rama`/`Geometria` (nunca evalúan f):
//   • `yEnRamas` — y sobre la curva en un x de mundo (lookup por x). Lo usa el crosshair,
//     que ES por-x (línea vertical bajo el cursor). Asume ramas x-monótonas (explícitas).
//   • `avanzarPorArco` — avance del CARRIL por LONGITUD DE ARCO EN PANTALLA sobre la
//     polilínea trazada. NO depende de que x sea buen parámetro: camina los vértices
//     dibujados, así que en una sección casi vertical avanza en y a ritmo uniforme y el
//     punto NUNCA se sale de la línea (está siempre sobre un segmento). Base de que el
//     carril funcione en verticales y —a futuro— en implícitas (parámetro = arco).

import type { Rama, Viewport } from "../contracts";
import { aPantallaX, aPantallaY } from "../scene/viewport-utils";

/** Punto de MUNDO en el segmento [k, k+1] de una rama a fracción u∈[0,1]. */
function puntoEnSegmento(rama: Rama, k: number, u: number): { x: number; y: number } {
  const p = rama.puntos;
  return {
    x: p[2 * k] + u * (p[2 * k + 2] - p[2 * k]),
    y: p[2 * k + 1] + u * (p[2 * k + 3] - p[2 * k + 1]),
  };
}

/** Vecina en dirección +x/−x del borde `xBorde`: la rama distinta cuyo extremo de ENTRADA
 *  (mín-x si vamos +x, máx-x si vamos −x) está más allá y más cerca. Cruza los HUECOS del
 *  dominio (√(x²−1)) sin consumir arco. Asume ramas x-crecientes por índice (explícitas). */
function ramaVecina(
  ramas: readonly Rama[], rActual: number, xBorde: number, dir: number
): { r: number; k: number; u: number } | null {
  let mejor: { r: number; k: number; u: number; x: number } | null = null;
  for (let r = 0; r < ramas.length; r++) {
    if (r === rActual) continue;
    const n = ramas[r].puntos.length >> 1;
    if (n < 2) continue;
    const entrada = dir > 0 ? 0 : n - 1;             // extremo por el que se ENTRA
    const xEntrada = ramas[r].puntos[2 * entrada];
    if ((xEntrada - xBorde) * dir > 1e-12 && (mejor === null || (xEntrada - mejor.x) * dir < 0))
      mejor = { r, k: dir > 0 ? 0 : n - 2, u: dir > 0 ? 0 : 1, x: xEntrada };
  }
  return mejor ? { r: mejor.r, k: mejor.k, u: mejor.u } : null;
}

/** Segmento MÁS CERCANO en PANTALLA al punto de mundo (x,y) sobre cualquier rama con ≥2
 *  puntos: (r, k, u) = rama, índice de segmento y fracción del pie de perpendicular. Es la
 *  RE-PROYECCIÓN del punto del carril sobre la polilínea re-trazada cada frame (robusta en
 *  verticales, donde muchos vértices comparten x). null si no hay ninguna polilínea legible. */
function localizarSegmento(
  ramas: readonly Rama[], x: number, y: number, vp: Viewport
): { r: number; k: number; u: number } | null {
  const px = aPantallaX(vp, x), py = aPantallaY(vp, y);
  let loc: { r: number; k: number; u: number; d2: number } | null = null;
  for (let r = 0; r < ramas.length; r++) {
    const p = ramas[r].puntos;
    const n = p.length >> 1;
    for (let k = 0; k < n - 1; k++) {
      const ax = aPantallaX(vp, p[2 * k]), ay = aPantallaY(vp, p[2 * k + 1]);
      const bx = aPantallaX(vp, p[2 * k + 2]), by = aPantallaY(vp, p[2 * k + 3]);
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let u = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const fx = ax + u * dx, fy = ay + u * dy;
      const d2 = (px - fx) * (px - fx) + (py - fy) * (py - fy);
      if (loc === null || d2 < loc.d2) loc = { r, k, u, d2 };
    }
  }
  return loc ? { r: loc.r, k: loc.k, u: loc.u } : null;
}

/**
 * ¿Existe una RAMA VECINA REAL a la que saltar avanzando en dirección `dir` (+1/−1) desde el
 * punto (x,y)? Es la DETECCIÓN Caso A / Caso B del carril de asíntotas, EN TIEMPO REAL sobre la
 * geometría ya recortada a la franja: localiza la rama del punto y mira si, más allá de su borde
 * de salida (máx-x si +x, mín-x si −x), nace otra rama por el lado opuesto (como el siguiente
 * período de tan(x)). true → Caso A (hay a dónde saltar: `avanzarPorArco` cruzará). false → Caso B
 * (asíntota única sin continuación: `arccot(x²)/(2√x)` contra x=0) → el carril frena la cámara.
 * NO depende del TIPO de función, solo de si hay geometría real a la que saltar en ESE momento.
 */
export function existeRamaVecina(
  ramas: readonly Rama[], x: number, y: number, dir: number, vp: Viewport
): boolean {
  const loc = localizarSegmento(ramas, x, y, vp);
  if (loc === null) return false;
  const p = ramas[loc.r].puntos;
  const n = p.length >> 1;
  const xBorde = dir > 0 ? p[2 * (n - 1)] : p[0]; // extremo de SALIDA de la rama actual
  return ramaVecina(ramas, loc.r, xBorde, dir) !== null;
}

/**
 * Avance del CARRIL por LONGITUD DE ARCO EN PANTALLA. Desde el punto (x,y) —que está sobre
 * la curva— camina `|deltaPx|` píxeles a LO LARGO de la polilínea trazada (signo = dirección
 * del índice, que en explícitas es +x). SIEMPRE devuelve un punto sobre un segmento dibujado,
 * así que en una sección casi vertical el punto avanza en y a ritmo uniforme y NO se descarrila
 * (a diferencia del avance por x, que leía la y en un x recortado/interpolado y saltaba fuera).
 *
 * Cómo: (1) LOCALIZA el segmento más cercano en PANTALLA a (x,y) —robusto en verticales, donde
 * muchos vértices comparten x; re-proyecta sobre la polilínea RE-TRAZADA cada frame—. (2) CAMINA
 * consumiendo longitudes de segmento en pantalla. La transformación mundo→pantalla es AFÍN por
 * eje, así que la fracción a lo largo de un segmento es la misma en pantalla y en mundo: se
 * miden distancias en pantalla y se devuelve el punto de mundo con esa fracción. Al acabar la
 * rama, SALTA a la vecina (hueco del dominio) o se PEGA al borde (la cámara lo sigue y re-traza →
 * "cabalga" la vertical). null si no hay ninguna polilínea legible.
 *
 * `hueco` acumula el salto en x de los cruces de rama de ESTE avance (0 si no hubo). Es la
 * DISCONTINUIDAD pura, no el desplazamiento del frame: el carril la usa para que la cámara no
 * acompañe el corte. Distinguirlas importa con zoom-out, donde un frame recorre varios períodos
 * (usar el desplazamiento total desfasaría la cámara cientos de unidades).
 */
export function avanzarPorArco(
  ramas: readonly Rama[],
  x: number,
  y: number,
  deltaPx: number,
  vp: Viewport
): { x: number; y: number; evento: "normal" | "salto" | "tope"; hueco: number } | null {
  // 1) Segmento MÁS CERCANO en pantalla a (x,y): re-proyección sobre la polilínea re-trazada.
  const loc = localizarSegmento(ramas, x, y, vp);
  if (loc === null) return null;

  // 2) Caminar |deltaPx| px a lo largo de la polilínea desde el punto localizado.
  const segLenPx = (r: number, k: number): number => {
    const p = ramas[r].puntos;
    return Math.hypot(
      aPantallaX(vp, p[2 * k + 2]) - aPantallaX(vp, p[2 * k]),
      aPantallaY(vp, p[2 * k + 3]) - aPantallaY(vp, p[2 * k + 1])
    );
  };
  const dir = deltaPx >= 0 ? 1 : -1;
  let { r, k, u } = loc;
  let resto = Math.abs(deltaPx);
  // `evento` informa al carril de qué pasó al agotar la rama: "salto" cruzó a una rama vecina
  // (Caso A de asíntota), "tope" se pegó al borde SIN vecina (Caso B / clamp), "normal" ni una
  // cosa ni la otra. El carril lo usa para gobernar el freno de cámara y el tope duro.
  let evento: "normal" | "salto" | "tope" = "normal";
  let hueco = 0;
  // Cota dura de iteraciones = nº total de vértices: el bucle termina siempre (nunca cuelga).
  let guardia = ramas.reduce((s, ra) => s + (ra.puntos.length >> 1), 0) + 4;
  while (resto > 1e-9 && guardia-- > 0) {
    const n = ramas[r].puntos.length >> 1;
    const L = segLenPx(r, k);
    const dispo = dir > 0 ? L * (1 - u) : L * u; // px disponibles hasta el extremo del segmento
    // Solo un segmento con LONGITUD REAL puede ser el punto de reposo. Un segmento de
    // longitud CERO (vértices duplicados, que el trazador emite en las costuras del
    // refinado) NO detiene el avance: se SALTA (dispo=0, resto intacto) hacia el
    // siguiente. Antes se retornaba en él → el carril se quedaba clavado en la costura.
    if (L > 0 && resto <= dispo) {
      u += dir * (resto / L);
      return { ...puntoEnSegmento(ramas[r], k, u < 0 ? 0 : u > 1 ? 1 : u), evento, hueco };
    }
    resto -= dispo;
    if (dir > 0 && k + 1 < n - 1) { k++; u = 0; continue; } // siguiente segmento de la rama
    if (dir < 0 && k > 0) { k--; u = 1; continue; }         // anterior segmento de la rama
    // Fin de rama: saltar el hueco a la vecina, o pegarse al borde (clamp).
    const borde = puntoEnSegmento(ramas[r], k, dir > 0 ? 1 : 0);
    const sig = ramaVecina(ramas, r, borde.x, dir);
    if (sig) {
      const entrada = puntoEnSegmento(ramas[sig.r], sig.k, sig.u);
      hueco += entrada.x - borde.x; // solo la DISCONTINUIDAD, no el arco recorrido
      r = sig.r; k = sig.k; u = sig.u; evento = "salto"; continue;
    }
    return { ...borde, evento: "tope", hueco };
  }
  return { ...puntoEnSegmento(ramas[r], k, u), evento, hueco };
}

/**
 * Poda los vértices SINTÉTICOS de polo con que el trazador cierra una rama. Al topar con un valor
 * no finito, `TrazadorExplicitoAdaptativo.emitPolo` añade un vértice en `yTop = domY[1] + alto` (o
 * `yBot`), es decir a 3 semi-alturas del centro: con la vista por defecto, y = ±21 exactos.
 *
 * Para el RENDER eso está bien (cierra el trazo en el borde). Para el CARRIL es veneno: la polilínea
 * sube hasta su punta real y luego BAJA por ese segmento sintético hasta ±21. Caminando el arco, el
 * punto rebasaba la punta, descendía (…330, 329, 328…) y se clavaba en y=21; y al volver de una fuga,
 * la re-proyección aterrizaba en ese mismo segmento —que se recorre hacia ARRIBA— y el punto se
 * fugaba otra vez en lugar de regresar. Podados, la rama TERMINA en su punta real.
 */
export function podarVerticesDePolo(ramas: readonly Rama[], vp: Viewport): readonly Rama[] {
  const alto = vp.domY[1] - vp.domY[0];
  const yTop = vp.domY[1] + alto, yBot = vp.domY[0] - alto;
  const eps = 1e-9 * Math.max(1, Math.abs(yTop), Math.abs(yBot));
  const esSintetico = (y: number) => Math.abs(y - yTop) < eps || Math.abs(y - yBot) < eps;
  let algunoPodado = false;
  const salida = ramas.map((rama) => {
    const p = rama.puntos;
    const n = p.length >> 1;
    let ini = 0, fin = n - 1;
    while (fin - ini > 1 && esSintetico(p[2 * ini + 1])) ini++;
    while (fin - ini > 1 && esSintetico(p[2 * fin + 1])) fin--;
    if (ini === 0 && fin === n - 1) return rama;
    algunoPodado = true;
    return { ...rama, puntos: p.slice(2 * ini, 2 * fin + 2), parametro: undefined };
  });
  return algunoPodado ? salida : ramas;
}

/** Pendiente en PANTALLA (|Δy/Δx| en px) a partir de la cual un segmento se considera parte del
 *  "chorro" que sube hacia la asíntota, y no curva recorrible. Vale 50 porque para tan(x) —cuya
 *  pendiente es 1+y²— eso corta en |y|=7, que es justo la semi-altura de la vista por defecto: el
 *  cruce se ve igual que con el recorte al borde que sustituye, pero YA NO depende del encuadre. */
export const PENDIENTE_CORTE_CARRIL = 50;

/**
 * Recorta las ramas quedándose SOLO con los tramos cuya pendiente en PANTALLA no supera
 * `pendienteMax`: los trozos casi verticales (el chorro que sube al polo) se DESCARTAN y la rama
 * se parte en los tramos "recorribles" que quedan.
 *
 * Por qué existe: el trazador NO recorta la rama en y — la polilínea de tan(x) sube literalmente
 * hasta y≈2·10⁷ junto al polo, y su longitud de arco es ~1.6·10⁹ px (días de recorrido). Sin
 * recortar, el carril "cabalga" el polo y NUNCA alcanza el extremo de la rama → nunca salta a la
 * vecina. Recortada, la rama TERMINA donde la curva se vuelve impracticable y `avanzarPorArco`
 * salta a la vecina por su ENTRADA (el tramo simétrico del período siguiente).
 *
 * Por qué por PENDIENTE y no por una franja de y ligada a la cámara: la pendiente es una propiedad
 * GEOMÉTRICA de la curva (con celdas 1:1, la de pantalla coincide con la de mundo), así que el
 * corte cae siempre en el mismo punto de la función sea cual sea el zoom o el encuadre. Un corte
 * ligado al viewport hacía que el cruce dependiera del `domY` con el que se activó el carril.
 *
 * Los segmentos de longitud CERO (vértices duplicados de las costuras del refinado) son
 * transparentes: ni cortan ni se anexan.
 */
export function recortarRamasPorPendiente(
  ramas: readonly Rama[], vp: Viewport, pendienteMax: number
): Rama[] {
  const salida: Rama[] = [];
  for (const rama of ramas) {
    const p = rama.puntos;
    const n = p.length >> 1;
    let run: number[] = [];
    const cerrar = () => {
      if (run.length >= 4) salida.push({
        puntos: Float64Array.from(run), cerrada: false,
        calidad: rama.calidad, objetoId: rama.objetoId,
      });
      run = [];
    };
    for (let k = 0; k < n - 1; k++) {
      const ax = aPantallaX(vp, p[2 * k]), ay = aPantallaY(vp, p[2 * k + 1]);
      const bx = aPantallaX(vp, p[2 * k + 2]), by = aPantallaY(vp, p[2 * k + 3]);
      const dxPx = Math.abs(bx - ax), dyPx = Math.abs(by - ay);
      if (dxPx === 0 && dyPx === 0) continue;          // vértice duplicado: transparente
      if (dyPx > pendienteMax * dxPx) { cerrar(); continue; } // demasiado vertical: se descarta
      if (run.length === 0) run.push(p[2 * k], p[2 * k + 1]);
      run.push(p[2 * k + 2], p[2 * k + 3]);
    }
    cerrar();
  }
  return salida;
}

/**
 * ¿Alguna rama BLOW-UP a una asíntota vertical de BORDE DE DOMINIO no marcada como asíntota
 * formal por el trazador (p. ej. `arccot(x²)/(2√x)` en x=0⁺, o `1/√x`)? El trazador solo marca
 * los POLOS bilaterales (tan, 1/x); las asíntotas donde el dominio TERMINA en un x finito con
 * |y|→∞ quedan sin marcar. Se detectan por geometría: una rama cuyo EXTREMO está en un x INTERIOR
 * de la vista (no en el borde de `domX`) con |y| fuera de pantalla y una aproximación casi-vertical.
 *
 * El requisito de x INTERIOR es lo que distingue una asíntota (el dominio acaba dentro de la vista)
 * de un POLINOMIO grande (`x³` llega a ±4000 pero en el BORDE de domX: no es asíntota, al ensanchar
 * la vista sigue la curva). Gobierna, junto con las asíntotas formales, el modo carril de inercia.
 */
export function curvaConBlowupVertical(ramas: readonly Rama[], vp: Viewport): boolean {
  const semiY = (vp.domY[1] - vp.domY[0]) / 2;
  const epsX = 0.02 * (vp.domX[1] - vp.domX[0]); // margen para "está en el borde de domX"
  for (const r of ramas) {
    const p = r.puntos;
    const n = p.length >> 1;
    if (n < 2) continue;
    // Examina los DOS extremos de la rama (índice del extremo y su vecino interior).
    const extremos: ReadonlyArray<readonly [number, number]> = [[0, 1], [n - 1, n - 2]];
    for (const [ie, iv] of extremos) {
      const x = p[2 * ie], y = p[2 * ie + 1];
      const interior = x > vp.domX[0] + epsX && x < vp.domX[1] - epsX;
      if (!interior || Math.abs(y) <= semiY) continue; // extremo en el borde de domX o dentro de la vista
      const dxPx = aPantallaX(vp, x) - aPantallaX(vp, p[2 * iv]);
      const dyPx = aPantallaY(vp, y) - aPantallaY(vp, p[2 * iv + 1]);
      if (Math.abs(dyPx) > 3 * Math.abs(dxPx)) return true; // extremo interior, off-screen y casi-vertical
    }
  }
  return false;
}

/** Factor de VELOCIDAD del carril en asíntotas verticales según la VERTICALIDAD local de la
 *  curva en pantalla (pendiente |dy/dx| en px): ×1 donde el tramo es suave (el "centro" de la
 *  rama, tan'(0)=1) → ×FACTOR_MAX donde es casi vertical (junto a la asíntota). Es GEOMÉTRICA
 *  —no mira la fórmula ni el tipo de función—, así vale igual para tan(x) (acelera hacia el polo,
 *  frena al reaparecer en el centro de la vecina) que para `arccot(x²)/(2√x)` (acelera hacia su
 *  única asíntota). `pendiente` se mide en pantalla (celdas 1:1 ⇒ ≈ |Δy/Δx| de mundo). */
export function factorRampaVerticalidad(pendiente: number): number {
  const FACTOR_MAX = 10;
  const p = Math.abs(pendiente);
  if (!Number.isFinite(p)) return FACTOR_MAX;
  return Math.max(1, Math.min(FACTOR_MAX, p));
}

/** y interpolada sobre la primera rama cuyo rango de x contiene worldX, o null. */
export function yEnRamas(ramas: readonly Rama[], worldX: number): number | null {
  for (const rama of ramas) {
    const t = rama.parametro;
    const p = rama.puntos;
    if (!t || t.length < 2) continue;
    if (worldX < t[0] || worldX > t[t.length - 1]) continue;
    // Búsqueda binaria del tramo [lo, hi] que contiene worldX (t creciente).
    let lo = 0;
    let hi = t.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= worldX) lo = mid;
      else hi = mid;
    }
    const xa = t[lo], xb = t[hi];
    const ya = p[lo * 2 + 1], yb = p[hi * 2 + 1];
    const r = xb === xa ? 0 : (worldX - xa) / (xb - xa);
    return ya + r * (yb - ya);
  }
  return null;
}
