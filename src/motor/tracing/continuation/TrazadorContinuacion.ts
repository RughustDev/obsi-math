// ─────────────────────────────────────────────
// tracing/continuation · Trazador por continuación (predictor-corrector adaptativo)
// ─────────────────────────────────────────────
//
// Sigue una curva implícita F(x,y)=0 a partir de SEMILLAS, parametrizándola por
// LONGITUD DE ARCO. Es la tesis arquitectónica del motor: un trazado 1D suave,
// axis-agnóstico, que produce la misma `Rama` que el sampler explícito → "no se
// nota la estrategia". Al no privilegiar ningún eje, traza tangentes verticales
// (p.ej. el círculo en x=±3) SIN artefactos, cosa imposible despejando a ±√.
//
// Esquema por componente (continuación numérica estándar):
//   • Corrector: Newton hacia F=0 a lo largo del gradiente (proyección), con
//     criterio de convergencia (rechaza puntos que no convergen → no acepta basura
//     cerca de singularidades).
//   • Predictor de PASO ADAPTATIVO por la TANGENTE (⟂∇F): se acepta un paso solo si
//     converge, avanza hacia delante y el GIRO respecto al avance previo es pequeño;
//     si no, se reduce el paso a la mitad y se reintenta. Esto resuelve curvas muy
//     cerradas (y mejora la precisión ε) y hace que en una CÚSPIDE el corrector
//     devuelva un punto "hacia atrás" → se rechaza → el paso colapsa → fin limpio.
//   • CRUCE RECTO en singularidades (∇F≈0): si el paso normal no progresa, se
//     extrapola en línea recta (dirección de avance previa) a través de la región
//     singular y se reproyecta. Si hay continuación casi recta → se acepta (NODO
//     transversal: sigue la MISMA rama, no salta). Si no → se detiene sin oscilar
//     (CÚSPIDE: no hay curva recta enfrente).
//   • Se traza hacia delante y hacia atrás desde la semilla; se cierra el lazo si se
//     vuelve al inicio; se detiene en el borde (con margen) o por tope de seguridad.
//
// COMPLETITUD: la conectividad topológica en una singularidad no se garantiza (es
// best-effort, como Desmos); la COBERTURA VISUAL sí, porque el descubrimiento siembra
// cada arista de la rejilla con cambio de signo → cada rama que sale de una
// singularidad tiene su propia semilla y se traza desde ahí. Las clasificaciones de
// nodo/cúspide certificadas (vía Hessiano) son evolución futura documentada.

import type {
  TrazadorContinuacion as ITrazadorContinuacion,
  CampoEscalar,
  Semilla,
  Singularidad,
  Viewport,
  Tolerancia,
  Rama,
} from "../../contracts";

type Vec = { x: number; y: number };
type Avance = { punto: Vec; dir: Vec; h: number };
type Grad = (x: number, y: number) => [number, number];
// Presupuesto de trabajo: cota DETERMINISTA del nº de evaluaciones de F por trazado.
// Acota el peor caso (curvas con miles de componentes / altísima frecuencia, p.ej.
// sin(x·y)=0 con mucho zoom-out) sin depender del reloj (la geometría sigue siendo
// determinista → caché y pruebas estables). No afecta a curvas normales (usan
// órdenes de magnitud menos evaluaciones que el tope).
type Presupuesto = { evals: number; max: number };

// Paso del predictor en píxeles (cota superior; el algoritmo lo reduce localmente).
// La pasada "final" busca calidad (paso fino); la "interactiva" usa paso mayor →
// menos puntos y menos evaluaciones de F durante el gesto.
const PASO_PX_FINAL = 2.5;
const PASO_PX_INTERACTIVO = 4.5;
const MAX_PASOS = 20000;       // tope de seguridad por dirección (= puntos máx. por dirección)
const MAX_COMPONENTES = 200;
// Cota de MEMORIA, complementaria al presupuesto de evaluaciones: este acota el TIEMPO,
// pero una curva que avanzara con pasos baratísimos podría acumular geometría hasta agotar
// la RAM. 200k puntos = 2 vértices × 8 bytes → ~3,2 MB de Float64Array, techo asumible.
const MAX_PUNTOS_TOTAL = 200_000;
const MAX_EVALS_FINAL = 600_000;       // curvas normales usan 5k–20k evals
const MAX_EVALS_INTERACTIVO = 180_000; // cota por frame durante un gesto
const COS_GIRO_MAX = 0.7;      // giro máx por paso normal (~45°); si se supera, reduce
const COS_GIRO_RECTO = 0.5;    // el cruce recto debe seguir a < 60° del avance previo
const FWD_MIN = 0.2;           // progreso mínimo hacia delante (evita pasos "de vuelta")

// ─────────────────────────────────────────────
// Dos escalas distintas, y NO hay que confundirlas (lo hice, y costó caro)
// ─────────────────────────────────────────────
//
// Una curva ACOTADA (el corazón, la astroide) tiene tamaño FIJO en MUNDO, así que al alejar el
// zoom se encoge hasta medir unos pocos píxeles. Ahí degenera TODO lo que estaba atado al paso:
// los arcos salen de 2–3 puntos, el lazo se cierra antes de tiempo y —lo peor— los umbrales de
// `marcarVisitadas`/`eliminarDuplicados` (múltiplos del paso) pasan a cubrir la curva ENTERA: la
// primera rama trazada se COME las semillas de las vecinas, que ya no se trazan → curva MUTILADA,
// y distinta en cada pasada → PARPADEO.
//
// La tentación es arreglarlo encogiendo el PASO hasta que los umbrales vuelvan a ser pequeños.
// Funciona… y trae un LAG perceptible al hacer zoom: obliga a trazar una curva de 40 px con
// cientos de puntos, y el coste del trazado (que es quien domina) se multiplica.
//
// Son dos necesidades independientes y hay que darles dos magnitudes independientes:
//   • el PASO gobierna la CALIDAD y el COSTE → se mide en PÍXELES (con un mínimo de pasos por
//     curva para que una figura diminuta no salga como un triángulo).
//   • el UMBRAL DE PROXIMIDAD ("¿esta semilla es de la rama que acabo de trazar?") gobierna la
//     COMPLETITUD → debe ser pequeño frente a la CURVA, no frente a la pantalla.
// 24 es el mínimo con cobertura PERFECTA (medido: con 12 se mutilan 3 zooms; con 8, 112). Y
// bajarlo no compensa: de 24 a 12 el coste solo cae un 6% (14,4k → 13,6k evaluaciones por
// pasada), porque el paso NO es el coste dominante. Así que se elige el valor seguro.
const PASOS_MINIMOS_CURVA = 24;   // pasos mínimos a lo ancho de una curva diminuta (calidad)
const CURVA_POR_SEMILLA = 60;     // umbral "semilla ya trazada" ≤ curva/60 (completitud)
const CURVA_POR_DUPLICADO = 50;   // umbral "rama re-trazada" ≤ curva/50
const CURVA_POR_CIERRE = 40;      // radio de "lazo cerrado" ≤ curva/40
const DIVISOR_SUELO_PASO = 512;

/** Diagonal de la nube de semillas = tamaño de la CURVA (dónde está). Infinity si no se puede
 *  medir (0–1 semillas, o degenerada) → entonces las cotas por curva no muerden. */
function escalaCurva(semillas: readonly Semilla[]): number {
  if (semillas.length < 2) return Infinity;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of semillas) {
    x0 = Math.min(x0, s.punto.x); x1 = Math.max(x1, s.punto.x);
    y0 = Math.min(y0, s.punto.y); y1 = Math.max(y1, s.punto.y);
  }
  const d = Math.hypot(x1 - x0, y1 - y0);
  return Number.isFinite(d) && d > 0 ? d : Infinity;
}

export class TrazadorContinuacion implements ITrazadorContinuacion {
  trazar(
    F: CampoEscalar,
    objetoId: string,
    semillas: readonly Semilla[],
    _singularidades: readonly Singularidad[],
    viewport: Viewport,
    tolerancia: Tolerancia
  ): readonly Rama[] {
    const anchoMundo = viewport.domX[1] - viewport.domX[0];
    const h = anchoMundo * 1e-5 || 1e-9;                 // paso de diferencias finitas
    const pasoPx = tolerancia.pasada === "interactiva" ? PASO_PX_INTERACTIVO : PASO_PX_FINAL;
    // PASO (calidad/coste): píxeles, con un mínimo de pasos a lo ancho de la curva para que una
    // figura diminuta no salga como un triángulo. Suelo para que nunca colapse a 0.
    const escala = escalaCurva(semillas);
    const porPantalla = Math.max(1e-12, (anchoMundo / viewport.anchoPx) * pasoPx);
    const hMax = Number.isFinite(escala)
      ? Math.min(porPantalla, Math.max(porPantalla / DIVISOR_SUELO_PASO, escala / PASOS_MINIMOS_CURVA))
      : porPantalla;
    // UMBRAL DE PROXIMIDAD (completitud): "¿esta semilla pertenece a la rama ya trazada?".
    // Se mide contra los SEGMENTOS de la polilínea (no contra sus vértices), así que basta con
    // que cubra el error de trazado —muy inferior al paso—; ponerlo en medio paso es de sobra.
    // Al ser pequeño frente a la curva (hMax ya está acotado por escala/PASOS_MINIMOS_CURVA), una
    // rama NO se come las semillas de las arcos vecinos, que es lo que mutilaba la figura.
    // Holgura de PASO Y MEDIO (no de medio paso): una semilla nace de interpolar F linealmente
    // sobre una arista de la rejilla, y si F es muy alineal ahí —junto a un polo de tan(x)— cae
    // BASTANTE lejos de la curva. Con el umbral apretado no se la reconocía como "ya trazada" y
    // volvía a trazar su rama entera: medido, 108 trazados de la MISMA rama hasta agotar el
    // presupuesto, quedándose en 5 de las 7 de tan(x) (y quemando 600k evaluaciones = lag).
    const umbralSemilla = Math.min(hMax * 1.5, escala / CURVA_POR_SEMILLA);
    // El de DUPLICADOS compara vértice contra vértice de dos polilíneas distintas, que caen
    // intercalados: necesita holgura de un paso. Pero acotado por la curva, o en una figura
    // diminuta declararía duplicadas dos ramas realmente distintas.
    const umbralDuplicado = Math.min(hMax * 1.5, escala / CURVA_POR_DUPLICADO);
    // Radio de CIERRE de lazo, también atado a la curva (ver `trazarDireccion`).
    const radioCierre = Math.min(hMax, escala / CURVA_POR_CIERRE);
    // F envuelto para contar evaluaciones (presupuesto de trabajo determinista).
    const presupuesto: Presupuesto = {
      evals: 0,
      max: tolerancia.pasada === "interactiva" ? MAX_EVALS_INTERACTIVO : MAX_EVALS_FINAL,
    };
    const Fc: CampoEscalar = {
      eval: (x, y) => { presupuesto.evals++; return F.eval(x, y); },
    };
    const grad: Grad = (x, y) => [
      (Fc.eval(x + h, y) - Fc.eval(x - h, y)) / (2 * h),
      (Fc.eval(x, y + h) - Fc.eval(x, y - h)) / (2 * h),
    ];

    const ramas: Rama[] = [];
    const visitada = new Array(semillas.length).fill(false);
    let puntosEmitidos = 0;

    // Las semillas se PROYECTAN sobre la curva antes de nada. Nacen de interpolar F linealmente
    // sobre una arista de la rejilla, y donde F es muy alineal —junto a un polo de tan(x)— caen
    // lejos de la curva real. Como el "¿ya está trazada esta semilla?" se decide por DISTANCIA a
    // la polilínea, una semilla descolocada no se reconocía y volvía a trazar su rama ENTERA:
    // medido, 85 trazados para 7 ramas de tan(x) (≈470k evaluaciones, casi todo tirado a la
    // basura por `eliminarDuplicados`) — eso era el LAG. Proyectarlas cuesta ~50 evaluaciones
    // cada una y ahorra cientos de miles. Si una no converge, se queda la cruda.
    const proyectadas = semillas.map((s) => this.corregir(Fc, grad, s.punto, hMax) ?? s.punto);

    for (let s = 0; s < semillas.length && ramas.length < MAX_COMPONENTES; s++) {
      if (visitada[s]) continue;
      if (presupuesto.evals > presupuesto.max) break;    // tope de trabajo alcanzado
      if (puntosEmitidos > MAX_PUNTOS_TOTAL) break;      // tope de memoria alcanzado
      visitada[s] = true;
      const p0 = this.arranque(Fc, grad, semillas[s].punto, hMax);
      if (!p0) continue;

      const comp = this.trazarComponente(Fc, grad, p0, viewport, hMax, presupuesto, radioCierre);
      if (!comp || comp.pts.length < 4) continue;

      puntosEmitidos += comp.pts.length / 2;
      this.marcarVisitadas(proyectadas, visitada, comp.pts, umbralSemilla, hMax);
      ramas.push({
        puntos: Float64Array.from(comp.pts),
        cerrada: comp.cerrada,
        calidad: "best-effort",
        objetoId,
        // Sin `parametro` x: una implícita no es monovaluada en x, así que el
        // crosshair/carril por-x no aplica (lo omiten al ver parametro ausente).
      });
    }

    // Salvaguarda de geometría: en contactos TANGENCIALES (tacnodos, curvas casi
    // coincidentes) el cruce recto puede ser no determinista y `marcarVisitadas`
    // dejar pasar trazados solapados → ramas DUPLICADAS y cuentas inestables. Se
    // descarta toda rama cuya mayoría de puntos ya esté cubierta por una rama previa.
    // Es general (no un parche por caso) y conservadora: ramas realmente distintas
    // se solapan poco (p.ej. y=x² e y=−x² solo se tocan en el origen) → se conservan.
    return this.eliminarDuplicados(ramas, umbralDuplicado, hMax);
  }

  // Descarta ramas redundantes: si > FRAC_CUBIERTA de los puntos de una rama caen a < `umbral`
  // de una rama ya conservada, es un re-trazado y se elimina.
  //
  // La distancia se mide a los SEGMENTOS de las ramas conservadas, no a sus vértices: dos
  // trazados de la MISMA curva, arrancados desde semillas distintas, colocan sus vértices
  // INTERCALADOS (hasta medio paso unos de otros), así que con un umbral pequeño la comparación
  // vértice-a-vértice no los reconocía y el duplicado sobrevivía —el corazón salía con 3 ramas y
  // media curva dibujada dos veces—. Contra los segmentos la distancia real es ~0 y el umbral
  // puede seguir siendo pequeño, que es lo que impide fusionar dos arcos realmente distintos.
  // Rejilla espacial → O(total de puntos), sin O(n²).
  private eliminarDuplicados(ramas: readonly Rama[], umbral: number, paso: number): Rama[] {
    // 0.6, y NO menos: en una curva con NODO (la lemniscata cruza por el origen) dos trazados
    // arrancados en lóbulos distintos se solapan ~la mitad, así que ambos sobreviven y la curva se
    // dibuja una vez y media. Es SOBRE-trazado: invisible (son los mismos píxeles, del mismo
    // color) y solo cuesta trabajo. Bajar el listón a 0.45 para evitarlo se probó y es MUCHO peor:
    // empieza a borrar ramas legítimas que se solapan un poco (medido: 177 zooms con curva
    // MUTILADA, que sí se ve). Ante la duda, conservar: perder curva es el pecado grave.
    const FRAC_CUBIERTA = 0.6;
    const u2 = umbral * umbral;
    // Celda ≥ paso: si un punto cae cerca de un segmento, alguno de sus extremos está en las 9
    // celdas vecinas y el segmento entra en el examen.
    const celda = Math.max(paso, umbral) * 1.5;
    const clave = (cx: number, cy: number) => cx + "," + cy;
    // hash: celda → lista de [rama, índice de vértice] conservados
    const hash = new Map<string, Array<[Float64Array, number]>>();

    const distSeg2 = (p: Float64Array, i: number, px: number, py: number): number => {
      const ax = p[i * 2], ay = p[i * 2 + 1];
      const bx = p[(i + 1) * 2], by = p[(i + 1) * 2 + 1];
      const vx = bx - ax, vy = by - ay;
      const L2 = vx * vx + vy * vy;
      let t = L2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - (ax + t * vx), dy = py - (ay + t * vy);
      return dx * dx + dy * dy;
    };

    const cubierto = (x: number, y: number): boolean => {
      const cx = Math.floor(x / celda), cy = Math.floor(y / celda);
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          const arr = hash.get(clave(cx + a, cy + b));
          if (!arr) continue;
          for (const [p, i] of arr) {
            const n = p.length / 2;
            if (i > 0 && distSeg2(p, i - 1, x, y) < u2) return true;
            if (i < n - 1 && distSeg2(p, i, x, y) < u2) return true;
          }
        }
      }
      return false;
    };

    const conservadas: Rama[] = [];
    for (const rama of ramas) {
      const p = rama.puntos;
      const n = p.length / 2;
      let cubiertos = 0;
      for (let k = 0; k < p.length; k += 2) if (cubierto(p[k], p[k + 1])) cubiertos++;
      if (n > 0 && cubiertos / n > FRAC_CUBIERTA) continue; // re-trazado → descartar

      conservadas.push(rama);
      for (let i = 0; i < n; i++) {
        const cx = Math.floor(p[i * 2] / celda), cy = Math.floor(p[i * 2 + 1] / celda);
        const kk = clave(cx, cy);
        let arr = hash.get(kk);
        if (!arr) { arr = []; hash.set(kk, arr); }
        arr.push([p, i]);
      }
    }
    return conservadas;
  }

  /**
   * Punto de ARRANQUE utilizable a partir de una semilla: sobre F=0 y desde el cual se
   * puede DAR UN PASO. Si el directo no sirve, se busca en el entorno de la semilla.
   *
   * POR QUÉ el criterio es "puede dar un paso" y no "tiene tangente": el corrector de
   * Newton converge a un punto de la curva… que puede ser una CÚSPIDE, donde la tangente
   * existe pero el trazado no arranca. La astroide `x^{2/3}+y^{2/3}=1` lo exhibe puro: al
   * alejar el zoom, las aristas de la rejilla son tan largas que TODAS las semillas caen
   * sobre los ejes, y desde ahí Newton converge exactamente a las cuatro cúspides. El
   * primer paso desde una cúspide gira ~63°, más de lo que admiten `COS_GIRO_MAX` (45°) y
   * `COS_GIRO_RECTO` (60°) → se rechaza en TODAS las escalas → la componente sale con
   * cero puntos y la curva DESAPARECÍA entera.
   *
   * Un punto un poco apartado de la cúspide sí es un buen arranque (ahí la curva es
   * suave), y desde él la continuación recorre el arco y se detiene sola en las cúspides,
   * como debe. Se prueban 8 direcciones a dos distancias. Es un ARRANQUE, no una
   * clasificación de la singularidad: solo hay que entrar en la curva bien orientado.
   */
  private arranque(F: CampoEscalar, grad: Grad, semilla: Vec, hMax: number): Vec | null {
    const hMin = hMax / 64;
    // Un arranque sirve si, puesto sobre la curva, admite un paso en ALGUNA de las dos
    // direcciones de la tangente (una punta de arco solo puede avanzar hacia un lado).
    const util = (p: Vec | null): Vec | null => {
      if (!p) return null;
      const t = this.tangente(grad, p, null);
      if (!t) return null;
      const atras = { x: -t.x, y: -t.y };
      const puede =
        this.pasoAdaptativo(F, grad, p, t, hMax, hMin) ||
        this.pasoAdaptativo(F, grad, p, atras, hMax, hMin);
      return puede ? p : null;
    };

    const directo = util(this.corregir(F, grad, semilla, hMax));
    if (directo) return directo;

    // Distancias de tanteo. Las CORTAS bastan cuando la semilla solo está mal colocada;
    // las LARGAS son imprescindibles cuando cae en un punto SINGULAR (∇F=0, como (±1,0)
    // en el corazón): ahí Newton, lanzado desde muy cerca, vuelve a caer en la propia
    // singularidad —el paso k=F/|∇F|² se dispara con el gradiente casi nulo—. Hay que
    // salir de su vecindad para engancharse a un tramo suave. Como hMax ya es
    // proporcional al tamaño de la curva (ver `pasoDeTrazado`), estos múltiplos son
    // escala-relativos: hMax·16 ≈ un quinto de la curva, sea cual sea el zoom.
    for (const d of [hMax, hMax * 0.25, hMax * 4, hMax * 16]) {
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const q = { x: semilla.x + Math.cos(a) * d, y: semilla.y + Math.sin(a) * d };
        const p = util(this.corregir(F, grad, q, hMax));
        if (p) return p;
      }
    }
    return null;
  }

  // Tangente unitaria (⟂ gradiente), con signo consistente respecto a `prev`.
  private tangente(grad: Grad, p: Vec, prev: Vec | null): Vec | null {
    const [gx, gy] = grad(p.x, p.y);
    const n = Math.hypot(gx, gy);
    if (!Number.isFinite(n) || n < 1e-30) return null;
    let tx = -gy / n, ty = gx / n;
    if (prev && tx * prev.x + ty * prev.y < 0) { tx = -tx; ty = -ty; }
    return { x: tx, y: ty };
  }

  // Proyecta p sobre F=0 con Newton a lo largo del gradiente. Devuelve null si NO
  // converge (criterio clave: no aceptar puntos sin convergencia, p.ej. cerca de ∇F≈0).
  private corregir(F: CampoEscalar, grad: Grad, p: Vec, hh: number): Vec | null {
    let x = p.x, y = p.y;
    const tol = Math.max(1e-12, hh * 0.01);
    let conv = false;
    for (let it = 0; it < 10; it++) {
      const f = F.eval(x, y);
      if (!Number.isFinite(f)) return null;
      const [gx, gy] = grad(x, y);
      const g2 = gx * gx + gy * gy;
      if (!Number.isFinite(g2) || g2 < 1e-30) return null;
      const k = f / g2;
      const dx = -k * gx, dy = -k * gy;
      x += dx; y += dy;
      if (Math.hypot(dx, dy) < tol) { conv = true; break; }
    }
    if (!conv) return null;
    return Number.isFinite(F.eval(x, y)) ? { x, y } : null;
  }

  private fueraDeLimites(p: Vec, vp: Viewport): boolean {
    const mx = (vp.domX[1] - vp.domX[0]) * 0.5;
    const my = (vp.domY[1] - vp.domY[0]) * 0.5;
    return (
      p.x < vp.domX[0] - mx || p.x > vp.domX[1] + mx ||
      p.y < vp.domY[0] - my || p.y > vp.domY[1] + my
    );
  }

  // Un paso normal por la tangente con paso adaptativo. Devuelve el avance aceptado o
  // null si en ninguna escala (h…hMin) hay un paso convergente, hacia delante y suave.
  private pasoAdaptativo(
    F: CampoEscalar, grad: Grad, p: Vec, dirAnt: Vec, h: number, hMin: number
  ): Avance | null {
    // La tangente se calcula UNA vez: ni `p` ni `dirAnt` cambian entre reintentos, así que
    // recalcularla dentro del bucle era evaluar el MISMO gradiente en el MISMO punto hasta 9
    // veces (4 evaluaciones de F cada una). Puro desperdicio, y justo donde más duele: en las
    // zonas de mucha curvatura, que son las que agotan los reintentos.
    const T = this.tangente(grad, p, dirAnt);
    if (!T) return null;                         // ∇F≈0 → que decida el cruce recto
    let hh = h;
    for (let intento = 0; intento < 9; intento++) {
      const pc = this.corregir(F, grad, { x: p.x + T.x * hh, y: p.y + T.y * hh }, hh);
      if (pc) {
        const dx = pc.x - p.x, dy = pc.y - p.y;
        const L = Math.hypot(dx, dy);
        if (L > 1e-15) {
          const ux = dx / L, uy = dy / L;
          const giro = ux * dirAnt.x + uy * dirAnt.y;   // cos del giro vs avance previo
          const fwd = ux * T.x + uy * T.y;              // progreso a lo largo de la tangente
          if (fwd > FWD_MIN && giro > COS_GIRO_MAX) {
            return { punto: pc, dir: { x: ux, y: uy }, h: hh };
          }
        }
      }
      hh *= 0.5;
      if (hh < hMin) break;
    }
    return null;
  }

  // Cruce de una singularidad en LÍNEA RECTA: extrapola por dirAnt y reproyecta. De
  // hMax hacia abajo: la primera distancia que cae en una continuación casi recta hacia
  // delante se acepta (nodo transversal). Si ninguna sirve → null (cúspide: fin limpio).
  private cruceRecto(
    F: CampoEscalar, grad: Grad, p: Vec, dirAnt: Vec, hMax: number, hMin: number
  ): Avance | null {
    for (let hh = hMax; hh >= hMin; hh *= 0.5) {
      const pc = this.corregir(F, grad, { x: p.x + dirAnt.x * hh, y: p.y + dirAnt.y * hh }, hh);
      if (!pc) continue;
      const dx = pc.x - p.x, dy = pc.y - p.y;
      const L = Math.hypot(dx, dy);
      if (L < hMin * 0.5) continue;              // no avanzó (volvió al mismo punto)
      const ux = dx / L, uy = dy / L;
      if (ux * dirAnt.x + uy * dirAnt.y > COS_GIRO_RECTO) {
        return { punto: pc, dir: { x: ux, y: uy }, h: hh };
      }
    }
    return null;
  }

  // Recorre la curva en UNA dirección desde p0 con dirección de avance inicial dir0.
  // `radioCierre`: a qué distancia de p0 se considera que el lazo se ha cerrado. Va atado a la
  // CURVA, no al paso —es el TERCER umbral que no debe confundirse con hMax—: si fuese un
  // múltiplo del paso, con paso grueso sobre una curva pequeña el trazado se daría por cerrado
  // a los tres pasos y devolvería un muñón (curva mutilada). Desacoplarlo es lo que permite
  // usar un paso barato sin perder curva.
  private trazarDireccion(
    F: CampoEscalar, grad: Grad, p0: Vec, dir0: Vec, vp: Viewport, hMax: number,
    presupuesto: Presupuesto, radioCierre: number
  ): { pts: Vec[]; cerrada: boolean } {
    const pts: Vec[] = [];
    const hMin = hMax / 64;
    let p = p0;
    let dirAnt = dir0;
    let h = hMax;
    let arco = 0;
    let cerrada = false;

    for (let i = 0; i < MAX_PASOS; i++) {
      if (presupuesto.evals > presupuesto.max) break;    // tope de trabajo alcanzado
      let av = this.pasoAdaptativo(F, grad, p, dirAnt, h, hMin);
      if (!av) av = this.cruceRecto(F, grad, p, dirAnt, hMax, hMin);
      if (!av) break;                            // singularidad sin salida / fin de dominio

      arco += Math.hypot(av.punto.x - p.x, av.punto.y - p.y);
      if (i > 2 && arco > radioCierre * 6 &&
          Math.hypot(av.punto.x - p0.x, av.punto.y - p0.y) < radioCierre) {
        cerrada = true; break;
      }
      if (this.fueraDeLimites(av.punto, vp)) { pts.push(av.punto); break; }

      pts.push(av.punto);
      dirAnt = av.dir;
      p = av.punto;
      h = Math.min(hMax, av.h * 1.3);            // recupera el paso tras una reducción
    }
    return { pts, cerrada };
  }

  // Traza la componente completa: hacia delante y, si no cerró, hacia atrás.
  private trazarComponente(
    F: CampoEscalar, grad: Grad, p0: Vec, vp: Viewport, hMax: number, presupuesto: Presupuesto,
    radioCierre: number
  ): { pts: number[]; cerrada: boolean } | null {
    const t0 = this.tangente(grad, p0, null);
    if (!t0) return null;

    const adelante = this.trazarDireccion(F, grad, p0, t0, vp, hMax, presupuesto, radioCierre);
    let orden: Vec[];
    if (adelante.cerrada) {
      orden = [p0, ...adelante.pts];
    } else {
      const atras = this.trazarDireccion(
        F, grad, p0, { x: -t0.x, y: -t0.y }, vp, hMax, presupuesto, radioCierre);
      orden = [...atras.pts.reverse(), p0, ...adelante.pts];
    }
    if (orden.length < 2) return null;

    const pts: number[] = [];
    for (const q of orden) pts.push(q.x, q.y);
    if (adelante.cerrada && orden.length > 2) pts.push(orden[0].x, orden[0].y); // cerrar lazo
    return { pts, cerrada: adelante.cerrada };
  }

  // Marca como visitadas las semillas que YA están sobre la componente recién trazada, para no
  // volver a trazar la misma curva desde otra semilla.
  //
  // Contra los SEGMENTOS de la polilínea, no contra sus vértices. Una semilla está sobre la
  // CURVA, pero los vértices están espaciados un paso: medida a los vértices, una semilla
  // perfectamente válida puede quedar a medio paso del más cercano y ESCAPARSE → lanza un
  // re-trazado completo de la misma curva que luego `eliminarDuplicados` tira a la basura. Con
  // cientos de semillas eso eran decenas de trazados redundantes (el lag al hacer zoom). Contra
  // los segmentos, la distancia real es el error de trazado (ínfimo) → se absorben todas, y el
  // umbral puede ser PEQUEÑO, que es lo que impide comerse las semillas de los arcos vecinos.
  //
  // Por REJILLA ESPACIAL, no por doble bucle: O(semillas × puntos) se disparaba con cientos de
  // semillas y ramas de miles de puntos (medido: UNA pasada de 245 s, otro cuelgue del hilo).
  private marcarVisitadas(
    proyectadas: readonly Vec[], visitada: boolean[], pts: number[], umbral: number, paso: number
  ): void {
    const u2 = umbral * umbral;
    // La celda ha de ser ≥ el paso: así, si una semilla cae cerca de un SEGMENTO, alguno de sus
    // dos extremos está en las 9 celdas vecinas y el segmento entra en el examen.
    const celda = Math.max(paso, umbral) * 1.5;
    const n = pts.length / 2;
    const hash = new Map<string, number[]>();      // "cx,cy" → índices de vértice
    for (let i = 0; i < n; i++) {
      const clave = Math.floor(pts[i * 2] / celda) + "," + Math.floor(pts[i * 2 + 1] / celda);
      let arr = hash.get(clave);
      if (!arr) { arr = []; hash.set(clave, arr); }
      arr.push(i);
    }

    // Distancia² del punto (px,py) al SEGMENTO i→i+1.
    const distSeg2 = (i: number, px: number, py: number): number => {
      const ax = pts[i * 2], ay = pts[i * 2 + 1];
      const bx = pts[(i + 1) * 2], by = pts[(i + 1) * 2 + 1];
      const vx = bx - ax, vy = by - ay;
      const L2 = vx * vx + vy * vy;
      let t = L2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - (ax + t * vx), dy = py - (ay + t * vy);
      return dx * dx + dy * dy;
    };

    for (let s = 0; s < proyectadas.length; s++) {
      if (visitada[s]) continue;
      const sx = proyectadas[s].x, sy = proyectadas[s].y;
      const cx = Math.floor(sx / celda), cy = Math.floor(sy / celda);
      buscar:
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          const arr = hash.get(cx + a + "," + (cy + b));
          if (!arr) continue;
          for (const i of arr) {
            // Los dos segmentos que tocan el vértice i.
            if (i > 0 && distSeg2(i - 1, sx, sy) < u2) { visitada[s] = true; break buscar; }
            if (i < n - 1 && distSeg2(i, sx, sy) < u2) { visitada[s] = true; break buscar; }
          }
        }
      }
    }
  }
}
