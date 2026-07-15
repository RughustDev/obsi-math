// ─────────────────────────────────────────────
// Análisis numérico de f(x) — helpers
// ─────────────────────────────────────────────

// pasos: resolución del muestreo. Más fino que antes (era 200) para no perder
// raíces juntas en funciones oscilantes (p.ej. tan, sin de alta frecuencia).
const RANGO_X = { min: -10, max: 10, pasos: 1000 };

// Por encima de este número de raíces (o de vértices), la función se considera
// con "demasiados" puntos notables (p.ej. sin/cos/tan, oscilantes): no se dibujan
// marcadores individuales de ese grupo y el panel muestra un resumen en su lugar.
const LIMITE_PUNTOS_NOTABLES = 20;

// Tolerancia (en coords de mundo) para FUSIONAR dos puntos notables en un único
// marcador. Solo deben fusionarse los que son REALMENTE el mismo punto: una raíz
// doble que coincide con su vértice (parábola tangente al eje), o un vértice en el
// origen que también es la intersección Y. Esos casos coinciden hasta el paso de
// muestreo (delta = 20/1000 = 0.02), así que basta un margen de unas pocas
// muestras. El valor anterior (0.15) era ~7× el paso y se "tragaba" mínimos reales:
// p.ej. en 2/(2x+1)+(x³−3)/π la curva apenas cruza el eje, baja a un mínimo y vuelve
// a subir; el vértice (≈0.79, −0.02) quedaba a 0.13 de la raíz en 0.93 y desaparecía.
const TOLERANCIA_FUSION = 0.05;

export interface Vertice { x: number; y: number; tipo: "min" | "max" }

/** Tramo continuo de raíces (la curva DESCANSA sobre el eje X): f=0 en todo [a,b],
 *  con cada extremo abierto o cerrado según f valga 0 en él (⌊x⌋ → raíces x∈[0,1):
 *  0 incluido, 1 no). Lo producen las funciones escalón y los productos con ellas.
 *  `a`/`b` pueden ser ±Infinity: el tramo se extiende sin fin más allá del rango de
 *  análisis (⌊1/x⌋=0 para todo x>1 → x∈(1,∞)); ese extremo va siempre ABIERTO. */
export interface IntervaloRaiz {
  a: number;
  b: number;
  cerradoA: boolean;
  cerradoB: boolean;
}

// Nº mínimo de muestras consecutivas en cero para considerar el conjunto un TRAMO
// (intervalo) y no raíces puntuales: 3 muestras = ancho ≥ 2·delta (0.04 en el rango
// fijo). Un cruce transversal normal produce a lo sumo 1 muestra exactamente en cero.
const MIN_MUESTRAS_TRAMO = 3;

/** Frontera del conjunto {f=0} entre una muestra FUERA del tramo (f≠0 o no finita)
 *  y una DENTRO (f=0), por bisección sobre el predicado "f(m)=0". Devuelve la
 *  abscisa límite y si el propio extremo PERTENECE al tramo (cerrado): se evalúa f
 *  en el valor "limpio" más cercano (redondeo a 1e-9) porque la bisección converge
 *  a un pelo del límite real (0.999…9 de 1) y evaluar ahí respondería por el lado
 *  equivocado del salto. */
function fronteraTramo(
  evaluar: (x: number) => number,
  xFuera: number,
  xCero: number
): { x: number; cerrado: boolean } {
  let fuera = xFuera, dentro = xCero;
  for (let i = 0; i < 60; i++) {
    const m = (fuera + dentro) / 2;
    if (evaluar(m) === 0) dentro = m; else fuera = m;
  }
  const limpio = Math.round(dentro * 1e9) / 1e9;
  return { x: limpio, cerrado: evaluar(limpio) === 0 };
}

/**
 * Localiza con precisión la raíz dentro de [a, b] (donde f cambia de signo) por
 * bisección, y DISTINGUE una raíz real de un polo (asíntota vertical como en
 * tan x o 1/x, que también cambian de signo entre dos muestras).
 *
 * Criterio: en una raíz real f→0 al estrechar el intervalo; en un polo f se
 * dispara (±∞ o magnitud enorme) o se vuelve no-finita. Tras refinar:
 *   - valor no-finito en el camino           → polo  (null)
 *   - |f| sigue siendo grande al converger   → polo  (null)
 *   - |f| ≈ 0                                 → raíz  (devuelve x)
 */
function refinarRaiz(
  evaluar: (x: number) => number,
  a: number, fa: number,
  b: number
): number | null {
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    const fm = evaluar(m);
    if (!Number.isFinite(fm)) return null;     // discontinuidad/polo
    if (fm === 0) return m;
    if (fa * fm < 0) { b = m; }
    else { a = m; fa = fm; }
  }
  const m = (a + b) / 2;
  const fm = evaluar(m);
  // En la raíz, el intervalo es ínfimo y |f| ha colapsado a ~0; en un polo el
  // valor sigue siendo grande aunque el cambio de signo "engañe".
  return Number.isFinite(fm) && Math.abs(fm) < 1e-3 ? m : null;
}

/** ¿El tramo de ceros que TOCA el borde del rango muestreado continúa hasta el
 *  infinito en el sentido `signo`? Sondea f en magnitudes crecientes (×10, de 100 a
 *  ~1e16): si TODAS valen 0, el conjunto de raíces no termina (⌊1/x⌋=0 para todo x>1
 *  → x∈(1,∞)) y el extremo es ±∞. Un solo valor ≠0 o no finito lo corta: el tramo
 *  acaba en el borde. Es una heurística: no detecta un cero que reaparezca aún más
 *  lejos tras un hueco, pero cubre las escalón monótonas (floor/ceil de 1/x, √x…). */
function tramoHastaInfinito(evaluar: (x: number) => number, signo: 1 | -1): boolean {
  let x = signo * 100;
  for (let i = 0; i < 15; i++) {
    if (evaluar(x) !== 0) return false;
    x *= 10;
  }
  return true;
}

/** Raíces reales en [min, max]: cruces PUNTUALES del eje X (excluyendo polos) +
 *  TRAMOS de ceros (la curva descansa sobre el eje: floor/ceil y sus productos),
 *  devueltos como intervalos con extremos refinados y apertura/cierre evaluados. */
function detectarRaices(
  evaluar: (x: number) => number,
  xs: number[], ys: number[]
): { puntos: number[]; intervalos: IntervaloRaiz[] } {
  const raices: number[] = [];
  const agregar = (x: number) => {
    if (!raices.some(r => Math.abs(r - x) < 1e-4)) raices.push(x);
  };

  // Función idénticamente nula (f(x)=0): TODA muestra sería "raíz". No son raíces
  // aisladas, así que no se devuelve ninguna; el caso se representa con un único
  // marcador en la intersección Y (0,0), no con miles solapados sobre el eje.
  let finitos = 0, ceros = 0;
  for (const y of ys) {
    if (!Number.isFinite(y)) continue;
    finitos++;
    if (y === 0) ceros++;
  }
  if (finitos > 0 && ceros === finitos) return { puntos: [], intervalos: [] };

  // TRAMOS de ceros: rachas de ≥ MIN_MUESTRAS_TRAMO muestras consecutivas en cero.
  // Sus índices se excluyen de las raíces puntuales (un tramo no es una lista de
  // puntos) y sus fronteras se refinan por bisección contra la muestra vecina.
  const intervalos: IntervaloRaiz[] = [];
  const enTramo = new Set<number>();
  for (let i = 0; i < ys.length; ) {
    if (ys[i] !== 0) { i++; continue; }
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === 0) j++;
    if (j - i + 1 >= MIN_MUESTRAS_TRAMO) {
      // Un tramo que TOCA un borde del rango puede en realidad extenderse sin fin
      // (⌊1/x⌋=0 para todo x>1). Se sondea más allá: si f sigue en 0, el extremo es
      // ±∞ (abierto); si no, se cierra en el borde como antes. Así el conjunto es el
      // MATEMÁTICO completo, no el recortado por el rango de análisis.
      const izq = i > 0
        ? fronteraTramo(evaluar, xs[i - 1], xs[i])
        : tramoHastaInfinito(evaluar, -1)
          ? { x: -Infinity, cerrado: false }
          : { x: xs[0], cerrado: true };
      const der = j < ys.length - 1
        ? fronteraTramo(evaluar, xs[j + 1], xs[j])
        : tramoHastaInfinito(evaluar, 1)
          ? { x: Infinity, cerrado: false }
          : { x: xs[ys.length - 1], cerrado: true };
      intervalos.push({ a: izq.x, cerradoA: izq.cerrado, b: der.x, cerradoB: der.cerrado });
      for (let k = i; k <= j; k++) enTramo.add(k);
    }
    i = j + 1;
  }

  for (let i = 0; i < xs.length - 1; i++) {
    const ya = ys[i], yb = ys[i + 1];
    if (!Number.isFinite(ya) || !Number.isFinite(yb)) continue;
    if (ya === 0) { if (!enTramo.has(i)) agregar(xs[i]); continue; }
    if (ya * yb < 0) {
      const r = refinarRaiz(evaluar, xs[i], ya, xs[i + 1]);
      if (r !== null) agregar(r);
    }
  }
  const n = xs.length - 1;
  if (Number.isFinite(ys[n]) && ys[n] === 0 && !enTramo.has(n)) agregar(xs[n]);

  return { puntos: raices.sort((p, q) => p - q), intervalos };
}

/**
 * Vértices locales (min/max) por cambio de signo de la pendiente discreta,
 * DISTINGUIENDO extremos reales de picos de asíntota (tan, sec, csc, cot…).
 *
 * Clave: un extremo real es un máximo/mínimo ACOTADO; el "pico" en una asíntota es
 * un artefacto del muestreo (la muestra previa al polo es grande y la siguiente
 * saltó a la rama opuesta). La firma robusta de la asíntota: entre dos muestras
 * consecutivas hay un CAMBIO DE SIGNO con |f| DIVERGIENDO (pasa por ±∞), frente a
 * una raíz (cambio de signo con |f|→0) o un extremo real (sin cambio de signo).
 * `cruzaPolo` lo detecta con una búsqueda ternaria del máximo de |f|. Esto es
 * INDEPENDIENTE DE LA ESCALA: el filtro anterior comparaba la pendiente con un
 * umbral ABSOLUTO (50), que fallaba al escalar la función —0.001·tan x tiene
 * pendientes pequeñas en el polo y sus picos se colaban como falsos máximos
 * "infinitos"—.
 */
function detectarVertices(
  xs: number[], ys: number[], delta: number,
  evaluar: (x: number) => number
): Vertice[] {
  // ¿El cambio de signo entre (xL,yL) y (xR,yR) es un POLO (asíntota) y no una
  // raíz? Búsqueda ternaria del máximo de |f| en el intervalo: si diverge muy por
  // encima de la escala de los extremos (o se vuelve no finita) hay una asíntota
  // entre medias. Sólo se invoca en candidatos con cambio de signo (extremos
  // reales no lo tienen → coste nulo para ellos).
  const cruzaPolo = (xL: number, yL: number, xR: number, yR: number): boolean => {
    if (yL * yR >= 0) return false;
    let lo = xL, hi = xR;
    for (let k = 0; k < 40; k++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (Math.abs(evaluar(m1)) < Math.abs(evaluar(m2))) lo = m1; else hi = m2;
    }
    const pico = Math.abs(evaluar((lo + hi) / 2));
    return !Number.isFinite(pico) || pico > Math.max(Math.abs(yL), Math.abs(yR)) * 4;
  };

  const vertices: Vertice[] = [];
  for (let i = 1; i < xs.length - 1; i++) {
    const yPrev = ys[i - 1], yCurr = ys[i], yNext = ys[i + 1];
    if (!Number.isFinite(yPrev) || !Number.isFinite(yCurr) || !Number.isFinite(yNext)) continue;

    // Polo cercano: una muestra no finita a ±2 pasos delata una asíntota próxima.
    if (
      !Number.isFinite(ys[i - 2] ?? 0) || !Number.isFinite(ys[i + 2] ?? 0)
    ) continue;

    const dAntes = yCurr - yPrev;
    const dDespues = yNext - yCurr;
    const tipo: "min" | "max" | null =
      dAntes < 0 && dDespues > 0 ? "min" :
      dAntes > 0 && dDespues < 0 ? "max" : null;
    if (tipo === null) continue;

    // Descarta picos de asíntota (escala-invariante): cambio de signo con polo
    // entre la muestra y cualquiera de sus vecinas.
    if (cruzaPolo(xs[i - 1], yPrev, xs[i], yCurr) ||
        cruzaPolo(xs[i], yCurr, xs[i + 1], yNext)) continue;

    // Refinamiento parabólico: la muestra `i` solo es la MÁS cercana al extremo,
    // no el extremo en sí (puede estar a ±delta/2). Ajustamos la parábola que pasa
    // por (yPrev, yCurr, yNext) y tomamos su vértice. Sin esto el marcador caía en
    // la rejilla de muestreo (p.ej. x=0.80 en vez del mínimo real x=0.792) y, en
    // dips poco profundos entre dos raíces juntas, ni siquiera quedaba centrado.
    const denom = yPrev - 2 * yCurr + yNext; // curvatura · delta²; >0 en min, <0 en max
    let xVert = xs[i], yVert = yCurr;
    if (Number.isFinite(denom) && Math.abs(denom) > 1e-12) {
      const t = (yPrev - yNext) / (2 * denom); // desplazamiento en pasos, |t|≤0.5 normalmente
      if (Math.abs(t) <= 1) {
        xVert = xs[i] + t * delta;
        yVert = yCurr - ((yPrev - yNext) * (yPrev - yNext)) / (8 * denom);
      }
    }
    vertices.push({ x: xVert, y: yVert, tipo });
  }
  return vertices;
}

export function analizarFuncion(
  evaluar: (x: number) => number
): { raices: number[]; vertices: Vertice[]; intervalosRaiz: IntervaloRaiz[] } {
  const { min, max, pasos } = RANGO_X;
  const delta = (max - min) / pasos;

  // Muestreo uniforme único, reutilizado por raíces y vértices.
  const xs: number[] = new Array(pasos + 1);
  const ys: number[] = new Array(pasos + 1);
  for (let i = 0; i <= pasos; i++) {
    const x = min + i * delta;
    xs[i] = x;
    ys[i] = evaluar(x);
  }

  const { puntos, intervalos } = detectarRaices(evaluar, xs, ys);
  return {
    raices: puntos,
    vertices: detectarVertices(xs, ys, delta, evaluar),
    intervalosRaiz: intervalos,
  };
}

/**
 * LaTeX del conjunto de raíces cuando hay TRAMOS: `x\in[0,1)` (⌊x⌋), varios tramos
 * unidos con ∪, y las raíces puntuales sueltas como conjunto finito al final
 * (`x\in[0,1)\cup\{-3\}`). Números compactos: enteros sin decimales, resto con
 * hasta 4 decimales sin ceros de relleno. Un extremo ±∞ se pinta `\infty` (siempre
 * con paréntesis, abierto). Solo la PARTE MATEMÁTICA (el prefijo "Raíces:" es texto
 * plano del panel, en Lora, no LaTeX).
 */
export function raicesALatex(
  intervalos: readonly IntervaloRaiz[],
  sueltas: readonly number[]
): string {
  const num = (v: number): string => {
    if (v === Infinity) return "\\infty";
    if (v === -Infinity) return "-\\infty";
    const r = parseFloat(v.toFixed(4));
    return Object.is(r, -0) ? "0" : String(r);
  };
  const partes = intervalos.map(
    (t) => `${t.cerradoA ? "[" : "("}${num(t.a)},${num(t.b)}${t.cerradoB ? "]" : ")"}`
  );
  if (sueltas.length > 0) partes.push(`\\{${sueltas.map(num).join(",\\ ")}\\}`);
  return `x\\in ${partes.join("\\cup ")}`;
}

/**
 * ¿La expresión contiene una función trigonométrica (sin, cos, tan, sec, csc,
 * cot) como LLAMADA? Estas funciones son periódicas: si su curva toca el eje X
 * lo hace infinitas veces, y si oscila tiene infinitos extremos. Es una prueba
 * léxica sobre la expresión ya normalizada (no álgebra simbólica). El lookbehind
 * `(?<![a-zA-Z])` exige que NO haya una letra justo antes, lo que evita falsos
 * positivos con inversas/hiperbólicas (asin, sinh…), que NO son periódicas, pero
 * SÍ admite un dígito u operador delante (multiplicación implícita: `0.9tan(x)`,
 * `2sin(x)`) —donde `\b` fallaba porque `9t` no es un borde de palabra—. El
 * `\s*\(` exige que sea una llamada, no un identificador.
 */
const TRIG_LLAMADA = /(?<![a-zA-Z])(sin|cos|tan|sec|csc|cot)\s*\(/;
export function tieneTrigonometria(expr: string): boolean {
  return TRIG_LLAMADA.test(expr);
}

// A partir de cuántas raíces/vértices una función trigonométrica se considera
// que OSCILA de verdad (periódica → infinitos), y no que solo ondula cruzando
// una vez. Distingue sin(x) (≈7 raíces) de x+sin(x) (monótona, 1 sola raíz).
const MIN_PUNTOS_PERIODICO = 3;

// Estado de un grupo de puntos notables (raíces o vértices):
//   normal     → se dibujan y se listan
//   infinitas  → trig que oscila (≥ umbral periódico): no se dibujan, se resumen
//   demasiadas → no-trig con demasiados (> umbral): no se dibujan, se resumen
type EstadoGrupo = "normal" | "infinitas" | "demasiadas";

export function estadoGrupo(cantidad: number, esTrig: boolean): EstadoGrupo {
  // Trigonométrica que cruza/oscila VARIAS veces (≥ umbral): infinitos. Una sola
  // raíz/extremo (p.ej. x+sin(x), monótona salvo ondulación, o sin(x)+2 que flota
  // sin tocar el eje) NO es periódica → cae a normal y se lista/oculta como tal.
  if (esTrig && cantidad >= MIN_PUNTOS_PERIODICO) return "infinitas";
  // No-trig: solo se resume cuando hay demasiados; si no, comportamiento normal.
  if (cantidad > LIMITE_PUNTOS_NOTABLES) return "demasiadas";
  return "normal";
}

interface PuntoNotable {
  x: number;
  y: number;
  tipo: "raiz" | "min" | "max" | "interseccion-y";
}

/**
 * Reúne raíces, vértices e intersección con Y en una sola lista de puntos
 * notables para dibujarlos sobre el plano. Fusiona los que coinciden en posición
 * (p.ej. una raíz que cae sobre un vértice, o un vértice en el origen que también
 * es la intersección Y) para que se muestre UN único marcador. La tolerancia de
 * fusión es en coordenadas de mundo (independiente del zoom), del orden del paso
 * de muestreo de analizarFuncion, de modo que absorbe el ruido numérico.
 */
export function construirPuntosNotables(
  analisis: { raices: number[]; vertices: Vertice[] },
  interseccionY: number,
  estadoRaices: EstadoGrupo,
  estadoVertices: EstadoGrupo
): PuntoNotable[] {
  const puntos: PuntoNotable[] = [];
  // Cada grupo (raíces / vértices) solo aporta marcadores si su estado es normal;
  // si es periódico ("infinitas") o excesivo ("demasiadas"), no se dibujan sus
  // marcadores y se resumen en el botón ⓘ. La intersección Y se muestra siempre:
  // es un único punto.
  if (estadoRaices === "normal")
    for (const x of analisis.raices) puntos.push({ x, y: 0, tipo: "raiz" });
  if (estadoVertices === "normal")
    for (const v of analisis.vertices) puntos.push({ x: v.x, y: v.y, tipo: v.tipo });
  if (Number.isFinite(interseccionY))
    puntos.push({ x: 0, y: interseccionY, tipo: "interseccion-y" });

  const fusionados: PuntoNotable[] = [];
  for (const p of puntos) {
    const coincide = fusionados.some(
      q => Math.abs(q.x - p.x) < TOLERANCIA_FUSION &&
           Math.abs(q.y - p.y) < TOLERANCIA_FUSION
    );
    if (!coincide) fusionados.push(p);
  }
  return fusionados;
}
