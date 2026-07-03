// ─────────────────────────────────────────────
// Muestreo de funciones explícitas y=f(x) → polilíneas
// ─────────────────────────────────────────────
//
// Sampler 1D COMPARTIDO entre obs-graph y obs-system. Antes vivía inline dentro de
// `GraphEngine.dibujarCurvaGL`; se extrajo aquí para que AMBOS motores lo usen: una
// función explícita (o una rama despejable y=f(x) de un sistema) se muestrea con
// densidad ligada a píxeles + refinado adaptativo por salto en pantalla, igual que
// obs-graph — sin los puntos ciegos de una rejilla 2D (marching squares).
//
// Devuelve polilíneas en coordenadas de MUNDO (cada rama continua como
// [x0,y0,x1,y1,…]) y las x de las asíntotas verticales. Cada motor mapea mundo→clip
// con su propio cx/cy y dibuja; como el recorte de valores extremos se hace al
// equivalente en mundo de clip ±3, el resultado en clip es idéntico al que producía
// obs-graph inline (cero cambio de comportamiento).

export interface ParamsMuestreo {
  // f(x). Puede devolver no-número (complejo de mathjs), NaN o ±Infinity fuera del
  // dominio real; se tratan como "sin valor" vía Number.isFinite, igual que obs-graph.
  evalX: (x: number) => number;
  domX: [number, number];
  domY: [number, number];
  H: number;            // alto del lienzo en px (para medir el salto en pantalla)
  interactivo: boolean; // gesto en curso → menos muestras / refinado (más rápido)
}

export interface SalidaMuestreo {
  polilineas: number[][]; // ramas continuas en MUNDO: [x0,y0,x1,y1,…]
  asintotas: number[];    // x (mundo) de las asíntotas verticales detectadas
}

export function muestrearFuncion(p: ParamsMuestreo): SalidaMuestreo {
  const { evalX, domX, domY, H, interactivo } = p;

  // Densidad ligada a píxeles (igual que obs-graph): muestras-por-ancho acotadas
  // arriba, así la densidad por píxel se mantiene a cualquier zoom.
  const MUESTRAS = interactivo
    ? Math.min(2000, Math.max(1000, Math.floor((domX[1] - domX[0]) * 20)))
    : Math.min(8000, Math.max(2000, Math.floor((domX[1] - domX[0]) * 50)));
  const dx = (domX[1] - domX[0]) / MUESTRAS;
  const SALTO_PX_MAX = 8;            // salto en Y > 8px → refinar
  const PROF_MAX = interactivo ? 12 : 18;

  // Recorte de valores extremos al equivalente en MUNDO de clip ±3 (3 = un alto de
  // vista más allá del borde). Mantiene la geometría sana lejos del eje sin que el
  // motor tenga que recortar luego: cy(yTop)=+3, cy(yBot)=-3.
  const Hmundo = domY[1] - domY[0];
  const yTop = domY[1] + Hmundo;
  const yBot = domY[0] - Hmundo;
  const syPx = (y: number) => H - ((y - domY[0]) / (domY[1] - domY[0])) * H;

  const polilineas: number[][] = [];
  const asintotas: number[] = [];
  let segmento: number[] = [];

  const flush = () => {
    if (segmento.length >= 4) polilineas.push(segmento);
    segmento = [];
  };
  // Emite un punto recortando valores extremos (sale del viewport para tocar el
  // borde, pero sin geometría astronómica). No-finito → al borde según el signo.
  const emit = (x: number, y: number) => {
    let yy = y;
    if (!Number.isFinite(yy)) yy = y > 0 ? yTop : yBot;
    else yy = Math.max(yBot, Math.min(yTop, yy));
    segmento.push(x, yy);
  };
  // Fuerza el punto al borde según hacia dónde dispara la rama (signo de y), para
  // que TREPE al borde aunque la última muestra finita no sea enorme.
  const emitPolo = (x: number, y: number) => {
    segmento.push(x, y >= 0 ? yTop : yBot);
  };
  const registrarAsintota = (x: number) => { asintotas.push(x); };

  // Distingue overflow numérico (x^1000 → Infinity sin ser polo) de divergencia
  // real: escanea desde el extremo infinito hacia el borde; si reaparece finito es
  // polo, si no, overflow.
  const esOverflowPersistente = (xInf: number, xFin: number): boolean => {
    const dir = Math.sign(xInf - xFin) || 1;
    const borde = dir > 0 ? domX[1] : domX[0];
    const PASOS = 16;
    const paso = (borde - xInf) / PASOS;
    if (Math.abs(paso) < 1e-12) return false;
    for (let k = 1; k <= PASOS; k++) {
      if (Number.isFinite(evalX(xInf + k * paso))) return false;
    }
    return true;
  };

  // Asíntotas de la MISMA rama (ambos lados → +∞ o ambos → -∞: 1/x², ln|tan x|…),
  // por su firma topológica robusta (|f| tiene un máximo local que DIVERGE),
  // independiente de que una muestra caiga sobre la singularidad → estables al zoom.
  const detectarAsintotasMismaRama = (): number[] => {
    const out: number[] = [];
    const N = Math.min(4000, Math.max(500, Math.ceil((domX[1] - domX[0]) * 30)));
    const paso = (domX[1] - domX[0]) / N;
    const magLado = (xPolo: number, d: number): number => {
      const a = evalX(xPolo - d), b = evalX(xPolo + d);
      const af = Number.isFinite(a) ? Math.abs(a) : -Infinity;
      const bf = Number.isFinite(b) ? Math.abs(b) : -Infinity;
      return Math.max(af, bf);
    };
    const registrar = (xIzq: number, xDer: number) => {
      let lo = xIzq, hi = xDer;
      for (let k = 0; k < 60; k++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        if (Math.abs(evalX(m1)) < Math.abs(evalX(m2))) lo = m1; else hi = m2;
      }
      const xPolo = (lo + hi) / 2;
      const m1 = magLado(xPolo, 1e-3);
      const m2 = magLado(xPolo, 1e-7);
      const m3 = magLado(xPolo, 1e-11);
      const diverge = Number.isFinite(m3) && m3 > m2 + 2 && m2 > m1 + 2;
      if (diverge && !out.some(q => Math.abs(q - xPolo) < paso)) out.push(xPolo);
    };
    let xA = domX[0], yA = evalX(xA);
    let xB = xA + paso, yB = evalX(xB);
    for (let i = 2; i <= N; i++) {
      const xC = domX[0] + i * paso;
      const yC = evalX(xC);
      if ((yB === Infinity || yB === -Infinity) &&
          Number.isFinite(yA) && Number.isFinite(yC) &&
          Math.sign(yA) === Math.sign(yC)) {
        registrar(xA, xC);
      } else if (Number.isFinite(yA) && Number.isFinite(yB) && Number.isFinite(yC)) {
        const aB = Math.abs(yB);
        const maxLocal =
          Math.abs(yA) <= aB && aB >= Math.abs(yC) && aB > 1.5 &&
          Math.sign(yA) === Math.sign(yB) && Math.sign(yB) === Math.sign(yC);
        if (maxLocal) registrar(xA, xC);
      }
      xA = xB; yA = yB; xB = xC; yB = yC;
    }
    return out;
  };
  const asintotasMismaRama = detectarAsintotasMismaRama();

  // Procesa el intervalo (xa, xb]. NO emite (xa,ya): lo asume ya emitido. Subdivide
  // donde la pendiente en píxeles es grande y CORTA al localizar un polo.
  const tramo = (xa: number, ya: number, xb: number, yb: number, prof: number) => {
    const finA = Number.isFinite(ya), finB = Number.isFinite(yb);
    const pyA = finA ? syPx(ya) : (ya > 0 ? -1e7 : 1e7);
    const pyB = finB ? syPx(yb) : (yb > 0 ? -1e7 : 1e7);
    const saltoPx = Math.abs(pyB - pyA);

    const fueraMismoLado =
      (ya > domY[1] && yb > domY[1]) || (ya < domY[0] && yb < domY[0]);
    const poloEnTramo =
      asintotasMismaRama.some(q => q > Math.min(xa, xb) && q < Math.max(xa, xb));
    const cambioSigno = finA && finB && ya * yb < 0;

    const refinar =
      prof < PROF_MAX &&
      (poloEnTramo || cambioSigno || (saltoPx > SALTO_PX_MAX && !fueraMismoLado));
    if (refinar) {
      const xm = (xa + xb) / 2;
      const ym = evalX(xm);
      tramo(xa, ya, xm, ym, prof + 1);
      tramo(xm, ym, xb, yb, prof + 1);
      return;
    }

    const cruza = (ya > domY[1] && yb < domY[0]) || (ya < domY[0] && yb > domY[1]);
    const algunNoFinito = !finA || !finB;
    const poloMismoLado = poloEnTramo && finA && finB && !cruza && ya * yb > 0;
    if (cruza || algunNoFinito || poloMismoLado) {
      let esPolo = cruza || poloMismoLado;
      if (!esPolo && finA !== finB) {
        const xf = finA ? xa : xb;
        const yf = finA ? ya : yb;
        const xn = finA ? xb : xa;
        let lo = xf, hi = xn, magCerca = Math.abs(yf);
        for (let k = 0; k < 40; k++) {
          const mid = (lo + hi) / 2;
          const ym = evalX(mid);
          if (Number.isFinite(ym)) { lo = mid; magCerca = Math.abs(ym); }
          else hi = mid;
        }
        esPolo = !Number.isFinite(magCerca) || magCerca > Math.abs(yf) + 1;
      }
      if (esPolo && !cruza && finA !== finB) {
        const yInf = finA ? yb : ya;
        if (yInf === Infinity || yInf === -Infinity) {
          const xInf = finA ? xb : xa;
          const xFin = finA ? xa : xb;
          if (esOverflowPersistente(xInf, xFin)) esPolo = false;
        }
      }
      if (esPolo) {
        if (finA) { emit(xa, ya); emitPolo(xa, ya); }
        if (!poloMismoLado) registrarAsintota((xa + xb) / 2);
        flush();
        if (finB) { emitPolo(xb, yb); emit(xb, yb); }
      } else {
        if (finA) emit(xa, ya);
        flush();
        if (finB) emit(xb, yb);
      }
    } else {
      emit(xb, yb);
    }
  };

  // Muestreo uniforme grueso + refinamiento adaptativo.
  let x0 = domX[0];
  let y0 = evalX(x0);
  if (Number.isFinite(y0)) emit(x0, y0);
  for (let i = 1; i <= MUESTRAS; i++) {
    const x1 = domX[0] + i * dx;
    const y1 = evalX(x1);
    tramo(x0, y0, x1, y1, 0);
    x0 = x1; y0 = y1;
  }
  flush();

  for (const xp of asintotasMismaRama) registrarAsintota(xp);
  return { polilineas, asintotas };
}
