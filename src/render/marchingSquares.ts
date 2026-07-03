// ─────────────────────────────────────────────
// Marching squares: contorno de F(x,y)=0 → segmentos
// ─────────────────────────────────────────────
//
// Renderiza una curva IMPLÍCITA (la solución de una ecuación general, no
// despejable como y=f(x)). Es el caso 2D análogo al muestreador de obs-graph: en
// vez de muestrear y=f(x) por columnas de píxel, marching squares da los puntos
// donde F=0 cruza las aristas de una rejilla y cómo se conectan dentro de cada
// celda (las rectas son un caso particular). Las celdas con algún vértice no
// finito (fuera del dominio real: complejos→NaN, polos) se omiten.
//
// PRINCIPIOS DE CALIDAD PORTADOS DE obs-graph (ver GraphEngine.dibujarCurvaGL):
//   1. Los VÉRTICES caen EXACTAMENTE sobre la curva. obs-graph evalúa y=f(x); aquí
//      el cruce de arista es solo interpolación LINEAL (≈ sobre F=0), con un error
//      ~ (tamaño de celda)²·curvatura. Por eso cada vértice se PROYECTA sobre F=0
//      con un paso de Newton a lo largo del gradiente (proyectarSobreCurva). Igual
//      que obs-graph, los vértices están en la curva, no cerca.
//   2. DENSIDAD ADAPTATIVA con criterio en PÍXELES. obs-graph subdivide mientras el
//      salto en pantalla supera un umbral en px. Aquí cada cuerda se subdivide
//      mientras la curva real se separe de ella más que `tolMundo` (que el llamador
//      deriva de mundo/píxel → estable a cualquier zoom). Las zonas planas no se
//      subdividen (coste ≈0); el detalle se concentra donde hay curvatura.
//   3. Grosor constante en clip y color opaco los dan el renderer/llamador, así que
//      —igual que en obs-graph— las juntas subpíxel entre cuerdas son invisibles y
//      no hace falta inglete (miter). La suavidad sale de la densidad+proyección,
//      no de las juntas.

// Proyecta (x,y) sobre F=0 con unos pasos de Newton a lo largo del gradiente
// (estimado por diferencias centradas con paso h). Devuelve el punto corregido o
// null si el gradiente se anula (punto crítico: no hay dirección de proyección).
// El arranque ya está ≈ sobre la curva (cruce de arista o punto medio de una
// cuerda corta), así que |F| es pequeño y converge en 2–3 iteraciones.
function proyectarSobreCurva(
  F: (x: number, y: number) => number,
  x: number, y: number, h: number
): [number, number] | null {
  // |F| de partida: proyectar sobre F=0 debe REDUCIRLO. Si al final |F| ha crecido,
  // Newton cruzó una DISCONTINUIDAD (polo de tan/1/x…): el gradiente enorme junto a
  // la asíntota empuja el vértice al otro lado del polo (de la rama real a un punto
  // con |F| gigante). Ese salto es justo el que producía segmentos espurios que
  // atravesaban la asíntota pese a que la celda no se descartara. Se rechaza.
  const f0 = Math.abs(F(x, y));
  for (let it = 0; it < 3; it++) {
    const f = F(x, y);
    if (!Number.isFinite(f)) return null;
    const gx = (F(x + h, y) - F(x - h, y)) / (2 * h);
    const gy = (F(x, y + h) - F(x, y - h)) / (2 * h);
    const g2 = gx * gx + gy * gy;
    if (!Number.isFinite(g2) || g2 < 1e-30) return null; // gradiente nulo/no finito
    const paso = f / g2;
    x -= paso * gx;
    y -= paso * gy;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const ff = Math.abs(F(x, y));
  // Cruzó un polo si |F| aumentó (con holgura para no descartar ceros ya casi
  // exactos por ruido numérico). En un cero suave |F| siempre decae hacia 0.
  if (!Number.isFinite(ff) || ff > f0 + 1e-9) return null;
  return [x, y];
}

// Proyecta un VÉRTICE (extremo de cuerda) sobre F=0, pero solo acepta el resultado
// si no se aleja más de `maxMov` del punto de partida (guard anti-salto de rama:
// cerca de una autointersección/silla la proyección podría irse a otra rama). Si
// se aleja o falla, conserva el punto original (el cruce lineal, ya ≈ sobre F=0).
function proyectarVertice(
  F: (x: number, y: number) => number,
  x: number, y: number, h: number, maxMov2: number
): [number, number] {
  const p = proyectarSobreCurva(F, x, y, h);
  if (!p) return [x, y];
  const dx = p[0] - x, dy = p[1] - y;
  if (dx * dx + dy * dy > maxMov2) return [x, y];
  return p;
}

// Distancia² del punto P a la recta que pasa por A y B (la cuerda).
function dist2PuntoRecta(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-30) {
    const ex = px - ax, ey = py - ay;
    return ex * ex + ey * ey;
  }
  // Componente perpendicular de (P-A) respecto a la dirección (B-A).
  const cross = (px - ax) * dy - (py - ay) * dx;
  return (cross * cross) / len2;
}

// Subdivide la cuerda A→B (ambos YA proyectados sobre F=0) acumulando en `out` los
// puntos intermedios proyectados sobre la curva, mientras su separación de la
// cuerda supere la tolerancia y quede presupuesto de recursión. Análogo a `tramo`
// de obs-graph, pero el criterio es la desviación geométrica respecto a la cuerda
// (no el salto vertical en píxeles), apto para curvas implícitas multivaluadas.
function refinarCuerda(
  F: (x: number, y: number) => number,
  ax: number, ay: number,
  bx: number, by: number,
  tol2: number, h: number, prof: number,
  out: number[]
): void {
  if (prof <= 0) return;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const p = proyectarSobreCurva(F, mx, my, h);
  if (!p) return;
  const [px, py] = p;
  // Salvaguarda anti-pico: si la proyección se fuga más de media cuerda del punto
  // medio geométrico, probablemente saltó a otra rama. No subdividir (cuerda recta).
  const exc = (px - mx) * (px - mx) + (py - my) * (py - my);
  const chord2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
  if (exc > 0.25 * chord2) return;
  // Si la curva ya pega a la cuerda, no hace falta más detalle.
  if (dist2PuntoRecta(px, py, ax, ay, bx, by) <= tol2) return;
  refinarCuerda(F, ax, ay, px, py, tol2, h, prof - 1, out);
  out.push(px, py);
  refinarCuerda(F, px, py, bx, by, tol2, h, prof - 1, out);
}

// Segmentos [x0,y0,x1,y1] en coordenadas de MUNDO que aproximan F(x,y)=0 dentro
// de [xMin,xMax]×[yMin,yMax], sobre una rejilla de cols×rows celdas. La rejilla da
// la TOPOLOGÍA (qué aristas se conectan); el suavizado geométrico lo da el refinado
// adaptativo, igual que obs-graph separa muestreo grueso de refinamiento.
//
// `tolMundo` (opcional): tolerancia de suavizado en unidades de mundo (típicamente
// ~⅓ de píxel; el llamador la deriva de mundo/píxel → estable al zoom). Si >0, los
// vértices se proyectan sobre F=0 y cada cuerda se subdivide adaptativamente; si
// es 0/omitida se devuelve el contorno crudo (comportamiento clásico).
// `profMax`: profundidad máxima de subdivisión por CUERDA (suavizado geométrico).
// `maxNivelCelda`: profundidad máxima de subdivisión adaptativa de CELDA (quadtree).
// Resuelve el muestreo: la rejilla base (~6px) ALIASA curvas muy oscilatorias
// (sin(x²), sin(xy)…) porque una celda puede contener varios lóbulos que los 4
// signos de esquina no ven (Nyquist). Como obs-graph refina el MUESTREO donde la
// función varía rápido (`tramo` por `saltoPx`), aquí cada celda base se subdivide
// recursivamente donde un sondeo interior (centro + medios de arista) revela
// estructura oculta. 0 = sin subdivisión de celda (comportamiento previo).
export function contorno(
  F: (x: number, y: number) => number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  cols: number,
  rows: number,
  tolMundo = 0,
  profMax = 6,
  maxNivelCelda = 0
): number[][] {
  const segmentos: number[][] = [];
  const dx = (xMax - xMin) / cols;
  const dy = (yMax - yMin) / rows;

  // Parámetros del refinado.
  const refinar = tolMundo > 0;
  const tol2 = tolMundo * tolMundo;
  const hGrad = Math.min(Math.abs(dx), Math.abs(dy)) * 1e-3 || 1e-9;
  // Un vértice no puede moverse al proyectar más de ~media celda (si lo hace, el
  // cruce lineal estaba en otra rama: se conserva el original).
  const maxMov2 = Math.pow(0.5 * Math.max(Math.abs(dx), Math.abs(dy)), 2);

  // Rejilla anclada a una LATTICE FIJA DE MUNDO (múltiplos de dx,dy), NO al borde
  // del viewport. Antes los nodos eran `xMin + i*dx`, con `xMin = domX[0]` (el borde
  // izquierdo de la cámara): toda la rejilla se DESPLAZABA al hacer pan, así que los
  // cruces de arista, la conectividad y la desambiguación de sillas cambiaban con la
  // cámara → la curva "cambiaba de forma" al moverse. Ahora los nodos caen en
  // posiciones de mundo FIJAS (k·dx, k·dy); al hacer pan, dx/dy no cambian (el ancho
  // del viewport es constante) y solo varía QUÉ celdas de esa lattice son visibles
  // → la geometría es idéntica, solo trasladada en pantalla (invariante a la cámara,
  // como obs-graph). La rejilla se extiende hasta una celda más allá del viewport
  // (snap hacia fuera) para cubrirlo por completo; los segmentos que caen fuera se
  // recortan en clip space y dejan que la curva llegue justo al borde.
  if (!(dx > 0) || !(dy > 0)) return segmentos; // viewport degenerado
  const iMin = Math.floor(xMin / dx);
  const jMin = Math.floor(yMin / dy);
  const nx = Math.max(1, Math.ceil(xMax / dx) - iMin);
  const ny = Math.max(1, Math.ceil(yMax / dy) - jMin);

  // Muestreo de F en los nodos de la rejilla (reutilizado por celdas vecinas).
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= nx; i++) xs[i] = (iMin + i) * dx;
  for (let j = 0; j <= ny; j++) ys[j] = (jMin + j) * dy;
  const val: number[][] = [];
  for (let i = 0; i <= nx; i++) {
    val[i] = [];
    for (let j = 0; j <= ny; j++) val[i][j] = F(xs[i], ys[j]);
  }

  // ¿El cambio de signo de F en la arista a→b es una DISCONTINUIDAD (polo) y no un
  // cero real? tan(x), 1/x, etc. saltan de +∞ a −∞: mathjs no devuelve Infinity en
  // el polo (no cae justo sobre él), sino un finito GIGANTE, así que las dos esquinas
  // tienen signos opuestos y marching squares las uniría con un trazo vertical
  // espurio SOBRE la asíntota (el fallo de `tan x + y² = 2`). Distinción robusta y
  // sin escala fija: bisecando hacia el cambio de signo, hacia un CERO la magnitud
  // de F decae (→0) y hacia un POLO crece (→∞). Es la misma idea que obs-graph usa
  // para cortar la curva en los polos (magnitud que diverge), llevada a la arista 2D.
  const cruceDiscontinuo = (
    xa: number, ya: number, va: number,
    xb: number, yb: number, vb: number
  ): boolean => {
    if (va * vb >= 0) return false; // sin cambio de signo en esta arista
    // Atajo barato y CONSERVADOR: en un cero real F decae por DEBAJO de ambas
    // esquinas, así que |F(P)| ≪ la MENOR de las dos (no la mayor). Usar la mayor
    // fallaba en saltos ASIMÉTRICOS de polo (p.ej. +290 / −57): el punto de cruce
    // lineal cae cerca de la esquina pequeña con |F|≈72 ≈ 0.25·290, “colándose” como
    // cruce real y dejando el trazo vertical espurio. Contra la MENOR, ese caso no
    // se acepta y pasa a la bisección (la prueba fiable). El atajo solo descarta
    // trabajo cuando es INEQUÍVOCAMENTE un cero; lo dudoso siempre biseca.
    const minMag = Math.min(Math.abs(va), Math.abs(vb));
    const t = va / (va - vb);
    const fp = F(xa + t * (xb - xa), ya + t * (yb - ya));
    if (Number.isFinite(fp) && Math.abs(fp) < 0.25 * minMag) return false;
    // Dudoso: bisecar hacia el cambio de signo y observar la magnitud en el bracket.
    let ax = xa, ay = ya, fa = va, bx = xb, by = yb, fb = vb;
    const magIni = Math.min(Math.abs(va), Math.abs(vb));
    for (let k = 0; k < 24; k++) {
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const fm = F(mx, my);
      if (!Number.isFinite(fm)) return true; // cae sobre la singularidad → polo
      if (fa * fm <= 0) { bx = mx; by = my; fb = fm; }
      else { ax = mx; ay = my; fa = fm; }
    }
    const magFin = Math.min(Math.abs(fa), Math.abs(fb));
    return magFin > magIni; // la magnitud creció hacia el cambio → polo/discontinuidad
  };

  // Punto donde F=0 sobre la arista a→b. Parte de la interpolación LINEAL (exacta
  // si F es ~lineal en la arista: el caso normal) y, SOLO si ese punto no cae sobre
  // la curva, lo AFINA por bisección. Esto importa junto a un polo: una celda cuya
  // esquina queda pegada a la asíntota tiene un |F| gigante (p.ej. −937) frente al
  // otro extremo (p.ej. +36); el cruce real es casi vertical y MUY cerca del polo,
  // pero la recta entre −937 y +36 lo ubica lejísimos (donde F≈+36, fuera de la
  // curva) → vértice espurio. La celda NO es descartable (sí tiene un cero real),
  // así que hay que CLAVAR el cero, no quitarlo. La bisección lo hace bien aun con F
  // hiperbólica. El atajo lineal mantiene el coste ~1 evaluación en el caso liso.
  const interp = (
    xa: number, ya: number, va: number,
    xb: number, yb: number, vb: number
  ): [number, number] => {
    const t0 = va / (va - vb);
    let x = xa + t0 * (xb - xa), y = ya + t0 * (yb - ya);
    const f0 = F(x, y);
    const minMag = Math.min(Math.abs(va), Math.abs(vb));
    // El cruce lineal ya está sobre la curva (|F| ≪ menor esquina): caso liso, listo.
    if (!Number.isFinite(f0) || Math.abs(f0) <= 0.25 * minMag) return [x, y];
    // Afinar por bisección en t∈[0,1] (hay un cero porque va·vb<0).
    let lo = 0, hi = 1, flo = va, t = t0;
    for (let k = 0; k < 40; k++) {
      x = xa + t * (xb - xa); y = ya + t * (yb - ya);
      const fm = F(x, y);
      if (!Number.isFinite(fm)) break;
      if (Math.abs(fm) <= 1e-9) break;
      if (flo * fm < 0) hi = t; else { lo = t; flo = fm; }
      t = (lo + hi) / 2;
    }
    return [x, y];
  };

  // Emite la cuerda a→b: si el refinado está activo, proyecta ambos extremos sobre
  // F=0 (vértices exactamente en la curva, como obs-graph) y subdivide entre ellos;
  // si no, emite la cuerda recta cruda.
  const push = (a: [number, number], b: [number, number]) => {
    if (!refinar) {
      segmentos.push([a[0], a[1], b[0], b[1]]);
      return;
    }
    // Vértices proyectados sobre la curva. Como ambas celdas vecinas calculan el
    // MISMO cruce de arista y lo proyectan igual, el punto compartido sigue siendo
    // idéntico → la curva no se rompe en las fronteras de celda.
    const A = proyectarVertice(F, a[0], a[1], hGrad, maxMov2);
    const B = proyectarVertice(F, b[0], b[1], hGrad, maxMov2);
    const medios: number[] = [];
    refinarCuerda(F, A[0], A[1], B[0], B[1], tol2, hGrad, profMax, medios);
    // Encadena A → (puntos medios) → B en subsegmentos rectos cortos.
    let px = A[0], py = A[1];
    for (let k = 0; k < medios.length; k += 2) {
      segmentos.push([px, py, medios[k], medios[k + 1]]);
      px = medios[k]; py = medios[k + 1];
    }
    segmentos.push([px, py, B[0], B[1]]);
  };

  // Marching squares clásico sobre UNA celda de esquinas finitas: traza el/los
  // segmento(s) donde F cambia de signo. La geometría fina (vértices sobre F=0 +
  // subdivisión de cuerda) la añade `push`. Asume las 4 esquinas finitas.
  const emitCelda = (
    x0: number, y0: number, x1: number, y1: number,
    v00: number, v10: number, v11: number, v01: number
  ) => {
    let code = 0;
    if (v00 > 0) code |= 1;
    if (v10 > 0) code |= 2;
    if (v11 > 0) code |= 4;
    if (v01 > 0) code |= 8;
    if (code === 0 || code === 15) return; // sin cruce

    // Descarta celdas atravesadas por una DISCONTINUIDAD (polo de tan/1/x…): el
    // cambio de signo en una arista es un salto ±∞→∓∞, no un cero de F. Sin esto,
    // marching squares uniría las dos ramas con un segmento vertical espurio sobre
    // la asíntota (p.ej. `tan x + y² = 2`). Igual que obs-graph corta en los polos,
    // aquí dejamos un hueco limpio. Solo las aristas con cambio de signo hacen trabajo.
    if (
      cruceDiscontinuo(x0, y0, v00, x1, y0, v10) || // inferior
      cruceDiscontinuo(x1, y0, v10, x1, y1, v11) || // derecha
      cruceDiscontinuo(x0, y1, v01, x1, y1, v11) || // superior
      cruceDiscontinuo(x0, y0, v00, x0, y1, v01)    // izquierda
    ) return;

    const eInf = () => interp(x0, y0, v00, x1, y0, v10); // inferior
    const eDer = () => interp(x1, y0, v10, x1, y1, v11); // derecha
    const eSup = () => interp(x0, y1, v01, x1, y1, v11); // superior
    const eIzq = () => interp(x0, y0, v00, x0, y1, v01); // izquierda

    switch (code) {
      case 1: case 14: push(eIzq(), eInf()); break;
      case 2: case 13: push(eInf(), eDer()); break;
      case 3: case 12: push(eIzq(), eDer()); break;
      case 4: case 11: push(eDer(), eSup()); break;
      case 6: case 9:  push(eInf(), eSup()); break;
      case 7: case 8:  push(eIzq(), eSup()); break;
      // Sillas: F cambia de signo en las cuatro aristas y hay DOS formas de
      // conectarlas. Se desambigua con el valor en el centro de la celda (media de
      // las cuatro esquinas): se aíslan las esquinas de signo OPUESTO al centro, lo
      // que evita el "aspa" espuria (un pico cruzando la celda) de la elección fija.
      case 5: case 10: {
        const centro = (v00 + v10 + v11 + v01) / 4;
        const positivoEnCentro = centro > 0;
        if (code === 5) {
          if (positivoEnCentro) { push(eIzq(), eSup()); push(eInf(), eDer()); }
          else { push(eIzq(), eInf()); push(eDer(), eSup()); }
        } else {
          if (positivoEnCentro) { push(eIzq(), eInf()); push(eDer(), eSup()); }
          else { push(eInf(), eDer()); push(eIzq(), eSup()); }
        }
        break;
      }
    }
  };

  // Subdivisión adaptativa (quadtree) de UNA celda. El criterio NO es un sondeo a
  // escala de celda (esquinas / 3×3) —que aliasa al MISMO ritmo que la oscilación
  // que intenta detectar, dejando de subdividir antes de tiempo (era el fallo de
  // raíz)— sino el GRADIENTE FINO de F en un punto (paso hGrad ≪ celda): la tasa de
  // cambio REAL, inmune al aliasing porque el paso está muy por debajo de la
  // longitud de onda. Se subdivide mientras esa tasa real supere la que ven las
  // esquinas (gradiente grueso): en una recta/círculo liso coinciden → no se
  // subdivide; en una zona oscilatoria fino≫grueso → se subdivide hasta resolver la
  // oscilación. Es el principio de obs-graph (refinar por la pendiente real hasta
  // que el muestreo discreto la capte) llevado a 2D. Todas las posiciones
  // muestreadas son puntos de mundo FIJOS → determinista por posición, invariante al
  // pan.
  const refinarCelda = (
    x0: number, y0: number, x1: number, y1: number,
    v00: number, v10: number, v11: number, v01: number,
    nivel: number
  ) => {
    // Celda con esquina no finita (polo/borde de dominio): se omite, igual que el
    // recorrido base — evita trazos espurios en discontinuidades.
    if (!Number.isFinite(v00) || !Number.isFinite(v10) ||
        !Number.isFinite(v11) || !Number.isFinite(v01)) return;

    if (nivel >= maxNivelCelda) { emitCelda(x0, y0, x1, y1, v00, v10, v11, v01); return; }

    const todasPos = v00 > 0 && v10 > 0 && v11 > 0 && v01 > 0;
    const todasNeg = v00 < 0 && v10 < 0 && v11 < 0 && v01 < 0;
    const hayCruce = !todasPos && !todasNeg;
    const minC = Math.min(Math.abs(v00), Math.abs(v10), Math.abs(v11), Math.abs(v01));

    const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
    const diag = Math.hypot(x1 - x0, y1 - y0);

    // Tasa de cambio REAL en el centro por gradiente fino (paso hGrad ≪ celda).
    const vc = F(xm, ym);
    const gx = (F(xm + hGrad, ym) - F(xm - hGrad, ym)) / (2 * hGrad);
    const gy = (F(xm, ym + hGrad) - F(xm, ym - hGrad)) / (2 * hGrad);
    const gradFino = Math.hypot(gx, gy);

    // ¿La curva F=0 entra en la celda? Hay cruce de signo, el centro cruza, o la
    // VARIACIÓN REAL a lo largo de la celda (gradFino·diag) alcanza el menor |valor|
    // de los nodos. Esto último capta celdas oscilatorias cuyas esquinas comparten
    // signo (cruces ocultos) — donde el sondeo grueso fallaba — porque gradFino es
    // grande en toda la banda oscilatoria, no solo donde la curva cruza una esquina.
    const varCelda = Number.isFinite(gradFino) ? gradFino * diag : Infinity;
    const cerca = hayCruce || (Number.isFinite(vc) && vc * v00 < 0) ||
      Math.min(minC, Math.abs(vc)) <= varCelda;
    if (!cerca) { emitCelda(x0, y0, x1, y1, v00, v10, v11, v01); return; }

    // Subdividir mientras la tasa real (gradFino) supere a la que ven las ESQUINAS
    // (gradiente grueso, diferencias a escala de celda). Recta/círculo liso:
    // fino≈grueso → no subdivide. Oscilatoria: el grueso se cancela por promediado y
    // fino≫grueso → subdivide; al encoger la celda el grueso tiende al fino → para
    // en la escala de la oscilación. `loboCentral` añade un disparo por si el centro
    // cruza con esquinas del mismo signo.
    if (nivel < maxNivelCelda && Number.isFinite(gradFino)) {
      const ggx = ((v10 - v00) + (v11 - v01)) / (2 * (x1 - x0));
      const ggy = ((v01 - v00) + (v11 - v10)) / (2 * (y1 - y0));
      const gradGrueso = Math.hypot(ggx, ggy);
      const loboCentral = (todasPos || todasNeg) && Number.isFinite(vc) && vc * v00 < 0;
      if (gradFino > gradGrueso * 1.8 || loboCentral) {
        // Reusa centro + 4 medios de arista como esquinas de las 4 subceldas.
        const vm0 = F(xm, y0), v1m = F(x1, ym), vm1 = F(xm, y1), v0m = F(x0, ym);
        refinarCelda(x0, y0, xm, ym, v00, vm0, vc, v0m, nivel + 1);
        refinarCelda(xm, y0, x1, ym, vm0, v10, v1m, vc, nivel + 1);
        refinarCelda(xm, ym, x1, y1, vc, v1m, v11, vm1, nivel + 1);
        refinarCelda(x0, ym, xm, y1, v0m, vc, vm1, v01, nivel + 1);
        return;
      }
    }
    emitCelda(x0, y0, x1, y1, v00, v10, v11, v01);
  };

  // Recorre las celdas base ancladas a mundo. Con maxNivelCelda>0 cada una entra al
  // quadtree adaptativo; con 0 se emite directa (comportamiento previo).
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const v00 = val[i][j];         // inferior-izquierda
      const v10 = val[i + 1][j];     // inferior-derecha
      const v11 = val[i + 1][j + 1]; // superior-derecha
      const v01 = val[i][j + 1];     // superior-izquierda
      const x0 = xs[i], x1 = xs[i + 1];
      const y0 = ys[j], y1 = ys[j + 1];
      if (maxNivelCelda > 0) {
        refinarCelda(x0, y0, x1, y1, v00, v10, v11, v01, 0);
      } else {
        if (!Number.isFinite(v00) || !Number.isFinite(v10) ||
            !Number.isFinite(v11) || !Number.isFinite(v01)) continue;
        emitCelda(x0, y0, x1, y1, v00, v10, v11, v01);
      }
    }
  }
  return segmentos;
}
