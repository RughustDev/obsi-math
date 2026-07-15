// ─────────────────────────────────────────────
// discovery/sampled · Descubrimiento por muestreo (semillas)
// ─────────────────────────────────────────────
//
// Implementación inicial de `EstrategiaDescubrimiento` (PLUGGABLE; un futuro
// upgrade por intervalos la reemplaza tras esta misma interfaz). Su trabajo es
// "¿DÓNDE está la curva?", no dibujarla: muestrea F en una rejilla ligada al
// viewport y emite una SEMILLA en cada arista de celda donde F cambia de signo
// (un punto ≈ sobre la curva). El trazador por continuación parte de ahí y
// recorre cada componente; las semillas redundantes se descartan al trazar.
//
// REFINADO ADAPTATIVO (la rejilla sola NO basta). Sus celdas están ligadas a los
// PÍXELES, pero una curva ACOTADA tiene tamaño fijo en MUNDO: al alejar el zoom, el
// corazón `(x²+y²−1)³=x²y³` o la astroide `x^{2/3}+y^{2/3}=1` (radio ~1) acaban
// cabiendo ENTEROS dentro de una celda → ninguna arista cambia de signo → cero
// semillas → la curva DESAPARECE. Y como la pasada interactiva y la final usan
// rejillas distintas, cada una la perdía a un zoom distinto → PARPADEO durante el
// gesto. El remedio es un descenso tipo quadtree (el que ya anticipa el contrato):
// las celdas SIN cambio de signo se ordenan por |F| mínimo en sus esquinas y las más
// prometedoras se subdividen recursivamente, siguiendo el sub-cuadro de |F| menor.
// Es un DESCENSO SOBRE |F|, cuyo mínimo (=0) está sobre la propia curva: si hay
// componente escondida, la encuentra. Las semillas siguen naciendo SOLO de cambios de
// signo reales → no se inventa geometría; lo único que cambia es DÓNDE se busca.
// El coste está acotado (celdas × profundidad × nodos) y es determinista.
//
// Alcance Fase D: solo localización de componentes suaves. Sin clasificar
// singularidades (se devuelve lista vacía); eso es trabajo posterior.

import type {
  EstrategiaDescubrimiento,
  ResultadoDescubrimiento,
  Semilla,
  CampoEscalar,
  Viewport,
  Tolerancia,
} from "../../contracts";

// Presupuesto del refinado (determinista, no depende del reloj). El peor caso son
// MAX_SUBDIVISIONES × (SUB+1)² ≈ 240 × 25 = 6000 evaluaciones, del orden de la rejilla
// base (~8800) y sin dependencia del reloj → geometría reproducible y caché estable.
const CELDAS_REFINADAS = 16;    // celdas "sospechosas" de la rejilla base que entran a la cola
const PROF_MAX = 5;             // niveles de descenso: 4⁵ = 1024× más fino que la celda
const SUB = 4;                  // subdivisiones por lado en cada nivel
const MAX_SUBDIVISIONES = 240;  // tope de celdas subdivididas (coste)
const MAX_SEMILLAS_REFINADO = 96;
// El refinado solo hace falta cuando la curva es PEQUEÑA frente a la celda (ahí es donde se
// esconde). Si la nube de semillas de la rejilla base ya se extiende varias celdas, la curva
// está perfectamente resuelta y refinar es tirar ~6000 evaluaciones POR FRAME (el lag
// perceptible al hacer zoom). Este es el umbral: diagonal de la nube > CELDAS_RESUELTA celdas.
const CELDAS_RESUELTA = 3;

export class DescubrimientoMuestreado implements EstrategiaDescubrimiento {
  descubrir(
    F: CampoEscalar,
    viewport: Viewport,
    tolerancia: Tolerancia
  ): ResultadoDescubrimiento {
    const [x0, x1] = viewport.domX;
    const [y0, y1] = viewport.domY;
    // Dos pasadas: durante un gesto ("interactiva") se usa una rejilla más gruesa
    // (menos nodos que evaluar y menos semillas → continuación más barata por
    // frame). Al asentarse ("final") la rejilla es fina y recupera componentes
    // delgadas que la gruesa pudiera saltarse. Mismo espíritu que el sampler 1D.
    const interactivo = tolerancia.pasada === "interactiva";
    const divX = interactivo ? 22 : 14;
    const divY = interactivo ? 13 : 8;
    const cols = Math.min(110, Math.max(interactivo ? 16 : 24, Math.round(viewport.anchoPx / divX)));
    const rows = Math.min(80, Math.max(interactivo ? 10 : 16, Math.round(viewport.altoPx / divY)));
    const dx = (x1 - x0) / cols;
    const dy = (y1 - y0) / rows;

    // Muestreo de F en los nodos de la rejilla (reutilizado por aristas vecinas).
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= cols; i++) xs[i] = x0 + i * dx;
    for (let j = 0; j <= rows; j++) ys[j] = y0 + j * dy;
    const val: number[][] = [];
    for (let i = 0; i <= cols; i++) {
      val[i] = [];
      for (let j = 0; j <= rows; j++) val[i][j] = F.eval(xs[i], ys[j]);
    }

    const semillas: Semilla[] = [];
    // Cambio de signo en una arista. Para distinguir un CRUCE POR CERO real de un
    // salto a través de un POLO (p.ej. tan(x) que va de +∞ a −∞: ambos finitos pero
    // de signos opuestos), se evalúa F en el punto medio de la arista: en un cruce
    // continuo |F(medio)| queda ACOTADO por los extremos; junto a un polo se dispara.
    // Esto evita semillas espurias (y trabajo y ruido visual) en campos con polos.
    const cruceReal = (a: number, b: number, xm: number, ym: number): boolean => {
      if (!(Number.isFinite(a) && Number.isFinite(b) && a * b < 0)) return false;
      const fm = F.eval(xm, ym);
      return Number.isFinite(fm) && Math.abs(fm) <= Math.max(Math.abs(a), Math.abs(b));
    };

    // Aristas horizontales: cambio de signo en x dentro de una fila.
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i < cols; i++) {
        const va = val[i][j], vb = val[i + 1][j];
        if (cruceReal(va, vb, xs[i] + dx / 2, ys[j])) {
          const t = va / (va - vb);
          semillas.push({ punto: { x: xs[i] + t * dx, y: ys[j] }, confianza: 1 });
        }
      }
    }
    // Aristas verticales: cambio de signo en y dentro de una columna.
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j < rows; j++) {
        const va = val[i][j], vb = val[i][j + 1];
        if (cruceReal(va, vb, xs[i], ys[j] + dy / 2)) {
          const t = va / (va - vb);
          semillas.push({ punto: { x: xs[i], y: ys[j] + t * dy }, confianza: 1 });
        }
      }
    }

    // ¿Hace falta refinar? Solo si la curva puede estar ESCONDIDA entre las celdas, es decir si
    // la rejilla base NO la resolvió: sin semillas, o con una nube de semillas que cabe en unas
    // pocas celdas (curva diminuta). Si la nube ya se extiende varias celdas, la curva es grande
    // frente a la rejilla, está bien resuelta, y refinar solo quema ~6000 evaluaciones POR FRAME
    // —el lag perceptible al hacer zoom—. LIMITACIÓN CONOCIDA: una curva grande que además
    // esconda una componente diminuta no la encontraría; ninguna curva del repertorio lo hace.
    if (semillas.length > 0) {
      let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity;
      for (const s of semillas) {
        sx0 = Math.min(sx0, s.punto.x); sx1 = Math.max(sx1, s.punto.x);
        sy0 = Math.min(sy0, s.punto.y); sy1 = Math.max(sy1, s.punto.y);
      }
      const diagNube = Math.hypot(sx1 - sx0, sy1 - sy0);
      const diagCelda = Math.hypot(dx, dy);
      if (diagNube > CELDAS_RESUELTA * diagCelda)
        return { semillas: deduplicarSemillas(semillas), singularidades: [] };
    }

    // ─── Refinado adaptativo de las celdas más CERCANAS a la curva ───────────
    // Candidatas: TODAS las celdas, ordenadas por el |F| MÁS PEQUEÑO de sus cuatro esquinas
    // —la medida de cercanía a la curva, que es donde F=0—. Se refinan las primeras.
    //
    // Ojo: NO se excluyen las celdas que YA dieron semilla. Parece lo lógico (¿para qué
    // refinar donde ya hay semilla?) y es un error: una celda puede dar UNA semilla
    // degenerada y esconder el resto de la curva. La lemniscata con mucho zoom-out cabe
    // entera en una celda y solo siembra su NODO (0,0) —donde ∇F=0 y el trazado muere—;
    // excluida del refinado, sus dos lóbulos no se sembraban nunca y la curva salía VACÍA.
    // Y en la astroide, refinar su celda reparte semillas por los cuatro arcos en vez de
    // dejarlas amontonadas junto a un eje, donde `marcarVisitadas` se comía las de los arcos
    // vecinos y se perdía media curva.
    const candidatas: { i: number; j: number; m: number }[] = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const m = minAbs([val[i][j], val[i + 1][j], val[i][j + 1], val[i + 1][j + 1]]);
        if (Number.isFinite(m)) candidatas.push({ i, j, m });
      }
    }
    candidatas.sort((a, b) => a.m - b.m);
    const cola: Celda[] = candidatas.slice(0, CELDAS_REFINADAS).map((c) => ({
      x0: xs[c.i], x1: xs[c.i + 1], y0: ys[c.j], y1: ys[c.j + 1], prof: 0, m: c.m,
    }));
    this.refinar(F, cruceReal, cola, semillas);

    return { semillas: deduplicarSemillas(semillas), singularidades: [] };
  }

  /**
   * Refinado quadtree POR NIVELES sobre una cola de celdas sospechosas: se subdivide en SUB×SUB,
   * se siembran los cambios de signo que aparezcan a esa resolución, y los sub-cuadros que NO
   * produjeron semilla vuelven a la cola un nivel más hondos. El orden de exploración es
   * **primero por PROFUNDIDAD (anchura), y a igualdad de nivel por |F| menor**.
   *
   * POR QUÉ por NIVELES y no por |F| a secas (que sería lo natural, ya que el mínimo de |F| es 0
   * y se alcanza SOBRE la curva): con prioridad puramente por |F| la cola SE MUERE DE HAMBRE. La
   * celda VECINA a la curva tiene una esquina con |F| pequeño y FIJO (esa esquina es un nodo: su
   * valor no cambia por mucho que se subdivida), así que sus descendientes conservan esa m
   * minúscula y se cuelan siempre por delante de la celda que SÍ contiene la curva —cuyas
   * esquinas pueden tener |F| mayor—. Medido en el corazón a semiY=27.5: la cola gastaba las 240
   * subdivisiones cavando una esquina sin curva y devolvía CERO semillas. Por niveles, toda celda
   * candidata se subdivide antes de que nadie baje otro nivel: la curva se encuentra a la primera.
   *
   * Y POR QUÉ una cola y no un descenso por un único camino: bajando solo por el sub-cuadro de |F|
   * menor se siembra únicamente la parte de la curva que cae en él. La astroide ocupa VARIOS
   * sub-cuadros, así que unos arcos recibían semillas y otros no → curva MUTILADA en bandas
   * concretas de zoom, distintas en cada pasada → PARPADEO.
   */
  private refinar(
    F: CampoEscalar,
    cruceReal: (a: number, b: number, xm: number, ym: number) => boolean,
    cola: Celda[],
    semillas: Semilla[]
  ): void {
    let subdivisiones = 0;
    while (cola.length > 0 && subdivisiones < MAX_SUBDIVISIONES &&
           semillas.length < MAX_SEMILLAS_REFINADO) {
      // Extrae la celda MENOS PROFUNDA y, a igualdad, la de |F| menor (búsqueda lineal + swap).
      let k = 0;
      for (let i = 1; i < cola.length; i++) {
        const a = cola[i], b = cola[k];
        if (a.prof < b.prof || (a.prof === b.prof && a.m < b.m)) k = i;
      }
      const c = cola[k];
      cola[k] = cola[cola.length - 1];
      cola.pop();
      subdivisiones++;

      const dx = (c.x1 - c.x0) / SUB, dy = (c.y1 - c.y0) / SUB;
      const xs: number[] = [], ys: number[] = [];
      for (let i = 0; i <= SUB; i++) xs[i] = c.x0 + i * dx;
      for (let j = 0; j <= SUB; j++) ys[j] = c.y0 + j * dy;
      const val: number[][] = [];
      for (let i = 0; i <= SUB; i++) {
        val[i] = [];
        for (let j = 0; j <= SUB; j++) val[i][j] = F.eval(xs[i], ys[j]);
      }

      // Semillas de este nivel (cambios de signo en las aristas del sub-mallado).
      for (let j = 0; j <= SUB; j++)
        for (let i = 0; i < SUB; i++) {
          const va = val[i][j], vb = val[i + 1][j];
          if (cruceReal(va, vb, xs[i] + dx / 2, ys[j]))
            semillas.push({ punto: { x: xs[i] + (va / (va - vb)) * dx, y: ys[j] }, confianza: 1 });
        }
      for (let i = 0; i <= SUB; i++)
        for (let j = 0; j < SUB; j++) {
          const va = val[i][j], vb = val[i][j + 1];
          if (cruceReal(va, vb, xs[i], ys[j] + dy / 2))
            semillas.push({ punto: { x: xs[i], y: ys[j] + (va / (va - vb)) * dy }, confianza: 1 });
        }

      if (c.prof + 1 > PROF_MAX) continue;
      // TODOS los sub-cuadros vuelven a la cola, hayan dado semilla o no.
      //
      // Tentación (y ERROR): saltarse los que ya dieron semilla, "para no gastar presupuesto
      // donde la curva ya está encontrada". Una semilla NO significa que la curva esté
      // resuelta ahí: la lemniscata con mucho zoom-out siembra su NODO (0,0) —donde ∇F=0 y el
      // trazado muere— y esa semilla marcaba como cubiertos los sub-cuadros vecinos, que son
      // justo los que contienen los LÓBULOS → la curva salía VACÍA. Explorar de más es barato
      // (el presupuesto lo acota) y las semillas sobrantes las descarta el trazador; explorar
      // de menos pierde curva.
      for (let i = 0; i < SUB; i++)
        for (let j = 0; j < SUB; j++) {
          const m = minAbs([val[i][j], val[i + 1][j], val[i][j + 1], val[i + 1][j + 1]]);
          if (!Number.isFinite(m)) continue;   // sub-cuadro fuera del dominio
          cola.push({ x0: xs[i], x1: xs[i + 1], y0: ys[j], y1: ys[j + 1], prof: c.prof + 1, m });
        }
    }
  }
}

/** Celda pendiente de refinar: su rectángulo, su profundidad y su |F| mínimo (la prioridad). */
interface Celda {
  x0: number; x1: number; y0: number; y1: number;
  prof: number;
  /** Menor |F| en las esquinas: cuanto menor, más cerca de la curva → antes se explora. */
  m: number;
}

/** Nº de semillas por lado de la curva que se conservan tras deduplicar (rejilla de dedup). */
const RESOLUCION_SEMILLAS = 120;

/**
 * Quita las semillas REDUNDANTES: las que caen en la misma celdilla de una rejilla fina ligada
 * al tamaño de la nube. El refinado re-encola TODOS los sub-cuadros (a propósito: excluir los
 * que ya dieron semilla perdía curva), así que siembra la MISMA curva otra vez en cada nivel
 * más hondo → cientos de semillas casi coincidentes. Cada una intenta luego su arranque y su
 * trazado, que `eliminarDuplicados` acaba tirando: trabajo puro de más, y el lag perceptible al
 * hacer zoom. Una semilla por celdilla basta —solo hacen falta para SABER DÓNDE hay curva—, y la
 * cobertura no cambia porque las descartadas están sobre curva ya sembrada.
 */
function deduplicarSemillas(semillas: readonly Semilla[]): Semilla[] {
  if (semillas.length < 2) return [...semillas];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of semillas) {
    x0 = Math.min(x0, s.punto.x); x1 = Math.max(x1, s.punto.x);
    y0 = Math.min(y0, s.punto.y); y1 = Math.max(y1, s.punto.y);
  }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (!Number.isFinite(diag) || diag <= 0) return [...semillas];
  const celda = diag / RESOLUCION_SEMILLAS;
  const vistas = new Set<string>();
  const salida: Semilla[] = [];
  for (const s of semillas) {
    const clave = Math.floor(s.punto.x / celda) + "," + Math.floor(s.punto.y / celda);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push(s);
  }
  return salida;
}

/** Menor |v| de una lista, ignorando los no-finitos (fuera del dominio). Infinity si
 *  no hay ninguno finito. Es la "distancia a la curva" con que se ordena el refinado. */
function minAbs(vs: readonly number[]): number {
  let m = Infinity;
  for (const v of vs) if (Number.isFinite(v)) m = Math.min(m, Math.abs(v));
  return m;
}
