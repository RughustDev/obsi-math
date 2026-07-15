// ─────────────────────────────────────────────
// analysis · Puntos notables DESDE la geometría (AGNÓSTICO de la fórmula)
// ─────────────────────────────────────────────
//
// Extrae raíces, extremos (máx/mín) e intersecciones con el eje Y escaneando la
// POLILÍNEA ya trazada (`Rama`), sin evaluar f. Al trabajar sobre la geometría es
// agnóstico de la estrategia y reutilizable por cualquier proveedor futuro
// (implícito, paramétrico…). La polilínea cumple el contrato de píxeles, así que
// la posición de cada punto es exacta a escala de pantalla.
//
// Si una categoría tiene demasiados elementos (curvas muy oscilatorias como
// sin(x²)), se OMITE para no saturar el plano (mismo espíritu que el "demasiadas"
// de obs-graph). `resumenPuntosNotables` expone las listas SIN capar para el
// panel ⓘ (que resume "infinitas/demasiadas" en vez de dibujar).

import type { Rama, PuntoNotable, Viewport } from "../contracts";

const LIMITE_POR_CATEGORIA = 30;

/** Listas completas (sin capar) por categoría. */
export interface ResumenNotables {
  raices: PuntoNotable[];
  vertices: PuntoNotable[];
  interseccionesY: PuntoNotable[];
}

function recolectar(
  ramas: readonly Rama[],
  objetoId: string,
  viewport?: Viewport
): ResumenNotables {
  const raices: PuntoNotable[] = [];
  const vertices: PuntoNotable[] = [];
  const interseccionesY: PuntoNotable[] = [];

  // Extremos locales en la muestra CENTRAL de un triple (previo, actual, siguiente).
  // Un extremo de y (pico/valle en altura) = tangente HORIZONTAL; un extremo de x
  // (punto más a la izq/der) = tangente VERTICAL. Para y=f(x) e implícitas función-
  // de-x solo aplica el de y (una función no se pliega en x), pero una curva
  // PARAMÉTRICA/polar (ramas SIN `parametro`, t≠x) sí se dobla: sus extremos en x son
  // tan geométricos como los de y —los cuatro lados del "bounding box" de una
  // Lissajous, no artefactos del muestreo de t—. Guardas SIMÉTRICAS: el extremo de y
  // exige x estricta a ambos lados (y el de x, y estricta), para no confundir un
  // segmento SINTÉTICO vertical/horizontal (borde de polo con dx=0, o dy=0) con un
  // extremo real (era el filtro `xEstricta` original, ahora también en el eje x).
  const agregarExtremos = (
    xp: number, yp: number, x: number, y: number, xn: number, yn: number,
    sinParam: boolean
  ): void => {
    if (x !== xp && x !== xn && ((yp < y && y > yn) || (yp > y && y < yn)))
      vertices.push({ punto: { x, y }, tipo: "vertice", objetoId }); // tangente horizontal
    if (sinParam && y !== yp && y !== yn && ((xp < x && x > xn) || (xp > x && x < xn)))
      vertices.push({ punto: { x, y }, tipo: "vertice", objetoId }); // tangente vertical
  };

  for (const rama of ramas) {
    const p = rama.puntos;
    const n = p.length / 2;
    if (n < 2) continue;
    // Sin `parametro` ⇒ paramétrica/polar (o implícita plegada): habilita los
    // extremos en x. Las de función-de-x llevan `parametro` (x monótona) → no.
    const sinParam = rama.parametro === undefined;

    for (let i = 1; i < n; i++) {
      const x = p[i * 2], y = p[i * 2 + 1];
      const xp = p[(i - 1) * 2], yp = p[(i - 1) * 2 + 1];

      // Raíz: cambio de signo de y entre dos muestras → interpolar x en y=0.
      if ((yp < 0 && y > 0) || (yp > 0 && y < 0)) {
        const r = yp / (yp - y);
        raices.push({ punto: { x: xp + r * (x - xp), y: 0 }, tipo: "raiz", objetoId });
      } else if (y === 0) {
        // Solo el cero AISLADO (ambos vecinos fuera del eje) es raíz puntual: el
        // toque tangente clásico (x² en 0). Una RACHA de muestras en y=0 es la curva
        // DESCANSANDO sobre el eje (meseta de ⌊x⌋): no es una lista de raíces —el ⓘ
        // la describe como intervalo x∈[a,b)— y marcarla sembraba una fila de puntos.
        // Los vecinos EFECTIVOS saltan las muestras DUPLICADAS exactas: el sampler
        // emite el extremo del dominio dos veces al cortar en su borde (√(9−x²)
        // termina …(3,0)(3,0)) y ese eco no es "otra muestra sobre el eje" — sin
        // saltarlo, el toque puntual del círculo en (±3,0) pasaba por falsa meseta.
        let s = i + 1;
        while (s < n && p[s * 2] === x && p[s * 2 + 1] === 0) s++;
        let a = i - 1;
        while (a >= 0 && p[a * 2] === x && p[a * 2 + 1] === 0) a--;
        const ySig = s < n ? p[s * 2 + 1] : NaN;
        const yAnt = a >= 0 ? p[a * 2 + 1] : NaN;
        if (yAnt !== 0 && ySig !== 0)
          raices.push({ punto: { x, y: 0 }, tipo: "raiz", objetoId });
      }

      // Intersección con Y: cada cruce de x=0 → interpolar y. Son TODOS, no solo el
      // primero: una función y=f(x) cruza el eje Y a lo sumo una vez (mismo resultado
      // de siempre), pero una curva multivaluada (tan(y)=x, trig periódica, implícitas
      // por continuación) lo cruza en cada rama — antes solo se marcaba la primera.
      // Los `<=` en AMBOS lados cubren la rama que NACE o MUERE exactamente en x=0
      // sin cruzarlo: el corte de salto de ⌊x⌋ parte las ramas justo ahí (la meseta
      // [0,1) EMPIEZA en la muestra x=0) y sin esto su (0,0) se perdía. El duplicado
      // del cruce que además cae en muestra exacta lo funde `dedupe`.
      if ((xp <= 0 && x >= 0) || (xp >= 0 && x <= 0)) {
        const r = xp === x ? 0 : (0 - xp) / (x - xp);
        interseccionesY.push({
          punto: { x: 0, y: yp + r * (y - yp) },
          tipo: "interseccion-y",
          objetoId,
        });
      }

      // Extremo local: pico/valle estricto en la muestra i (necesita el vecino i+1).
      if (i < n - 1)
        agregarExtremos(xp, yp, x, y, p[(i + 1) * 2], p[(i + 1) * 2 + 1], sinParam);
    }

    // Costura de una rama CERRADA: la muestra 0 (≈ la última) es un punto INTERIOR
    // del recorrido, con vecinos la penúltima (antes de la costura) y la segunda
    // (después). Un extremo justo ahí —p.ej. el punto más a la derecha de un círculo,
    // en t=0— se perdería sin esto. Solo para cerradas: en una abierta los extremos
    // de rama son bordes del dominio, no vértices.
    if (rama.cerrada && n >= 3)
      agregarExtremos(
        p[(n - 2) * 2], p[(n - 2) * 2 + 1], // penúltima (antes de la costura)
        p[0], p[1],                          // costura (= última muestra)
        p[2], p[3],                          // segunda (después de la costura)
        sinParam
      );
  }

  // Raíces de EXTREMO de rama (dominios parciales): una rama que NACE o MUERE
  // tocando el eje X, como √(x+1) o tan(y)=√(x+1)/(x²+1) en (−1, 0). El sampler
  // bisecta el borde del dominio hasta subpíxel, así que si la curva nace en el
  // eje su extremo queda a <½px de y=0 — pero sin cambio de signo, el escaneo de
  // arriba no la ve. Requiere `viewport` (da la escala px y los bordes): un extremo
  // pegado al BORDE x de la vista NO cuenta (es recorte del dominio visible, no fin
  // del dominio real: las colas de 1/x quedarían marcadas como raíces falsas).
  if (viewport) {
    const epsY = ((viewport.domY[1] - viewport.domY[0]) / viewport.altoPx) * 0.5; // ½ px
    const margenX = ((viewport.domX[1] - viewport.domX[0]) / viewport.anchoPx) * 2; // 2 px
    for (const rama of ramas) {
      const p = rama.puntos;
      const n = p.length / 2;
      if (n < 2 || rama.cerrada) continue;
      for (const i of [0, n - 1]) {
        const x = p[i * 2], y = p[i * 2 + 1];
        if (Math.abs(y) > epsY) continue;
        // Rama que DESCANSA sobre el eje (meseta de ⌊x⌋): su extremo no es una raíz
        // donde la curva "nace del eje" —la vecina también está en y=0 EXACTO—; en
        // √(x+1) la vecina ya se despega (y=√δ≠0) y el extremo sí se marca. La
        // vecina EFECTIVA salta duplicados exactos del extremo (…(3,0)(3,0), eco
        // del corte en el borde del dominio), igual que en el escaneo principal.
        const paso = i === 0 ? 1 : -1;
        let v = i + paso;
        while (v + paso >= 0 && v + paso < n && p[v * 2] === x && p[v * 2 + 1] === y)
          v += paso;
        const yVecina = p[v * 2 + 1];
        if (y === 0 && yVecina === 0) continue;
        if (x < viewport.domX[0] + margenX || x > viewport.domX[1] - margenX) continue;
        if (raices.some((r) => Math.abs(r.punto.x - x) <= margenX)) continue; // ya marcada
        raices.push({ punto: { x, y: 0 }, tipo: "raiz", objetoId });
      }
    }
  }

  // Deduplicación por categoría: varias ramas que comparten un punto (las dos ramas
  // ±√ de una implícita despejada tocan el eje X en el MISMO extremo) generarían el
  // mismo punto repetido. Se fusionan los que coinciden dentro de una tolerancia (~3px
  // si hay viewport; casi exacta si no), conservando el primero.
  const tolX = viewport ? ((viewport.domX[1] - viewport.domX[0]) / viewport.anchoPx) * 3 : 1e-6;
  const tolY = viewport ? ((viewport.domY[1] - viewport.domY[0]) / viewport.altoPx) * 3 : 1e-6;
  return {
    raices: dedupe(raices, tolX, tolY),
    vertices: dedupe(vertices, tolX, tolY),
    interseccionesY: dedupe(interseccionesY, tolX, tolY),
  };
}

/** Quita puntos que coinciden en posición (dentro de tolerancia), conservando el 1º. */
function dedupe(pts: PuntoNotable[], tolX: number, tolY: number): PuntoNotable[] {
  const out: PuntoNotable[] = [];
  for (const p of pts)
    if (!out.some((q) => Math.abs(q.punto.x - p.punto.x) <= tolX && Math.abs(q.punto.y - p.punto.y) <= tolY))
      out.push(p);
  return out;
}

/** Puntos a DIBUJAR sobre el plano: cada categoría se omite entera si excede el
 *  límite (no pintar un subconjunto engañoso). `viewport` habilita además las
 *  raíces de extremo de rama (ver `recolectar`). */
export function analizarPuntosNotables(
  ramas: readonly Rama[],
  objetoId: string,
  viewport?: Viewport
): PuntoNotable[] {
  const { raices, vertices, interseccionesY } = recolectar(ramas, objetoId, viewport);
  const out: PuntoNotable[] = [];
  if (interseccionesY.length <= LIMITE_POR_CATEGORIA) out.push(...interseccionesY);
  if (raices.length <= LIMITE_POR_CATEGORIA) out.push(...raices);
  if (vertices.length <= LIMITE_POR_CATEGORIA) out.push(...vertices);
  return out;
}

/** Listas COMPLETAS por categoría (sin el cap de dibujo), para el panel ⓘ:
 *  ahí los excesos se RESUMEN ("infinitas"/"demasiadas") en vez de omitirse. */
export function resumenPuntosNotables(
  ramas: readonly Rama[],
  objetoId: string,
  viewport?: Viewport
): ResumenNotables {
  return recolectar(ramas, objetoId, viewport);
}
