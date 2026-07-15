// ─────────────────────────────────────────────
// tracing/explicit · Trazador explícito ADAPTATIVO (Fase B)
// ─────────────────────────────────────────────
//
// Primer algoritmo matemático REAL del motor nuevo, desacoplado del antiguo. Es
// el muestreo adaptativo de obs-graph (densidad ligada a píxeles + refinado por
// salto en pantalla + detección de polos/asíntotas + recorte de extremos),
// EXTRAÍDO —no transportado— detrás del contrato `TrazadorExplicito`.
//
// Comportamiento matemático observable IDÉNTICO al de obs-graph: se conservan las
// mismas constantes probadas (MUESTRAS, SALTO_PX_MAX=8, PROF_MAX) y la misma
// lógica de `tramo`. Solo cambia la ENVOLTURA de E/S:
//
//     FuncionReal + Viewport + Tolerancia   →   Rama[]
//
// Lo que NO vive aquí (pertenece a otras capas, fuera del trazador):
//   • el dibujo de las asíntotas punteadas → overlay/render (fase posterior);
//     aquí se DETECTAN (las necesita el refinado) pero no se exponen todavía.
//   • quad strips, WebGL, buffers, interacción, carril, panel, caché → fuera.
//
// Este archivo NO importa nada de src/render/ ni de src/engines/: es autónomo.

import type {
  TrazadorExplicito,
  ResultadoTrazadoExplicito,
  FuncionReal,
  Viewport,
  Tolerancia,
  Rama,
} from "../../contracts";

export class TrazadorExplicitoAdaptativo implements TrazadorExplicito {
  trazar(
    f: FuncionReal,
    objetoId: string,
    viewport: Viewport,
    tolerancia: Tolerancia
  ): ResultadoTrazadoExplicito {
    // ── Adaptación de E/S a los contratos del motor ──────────────────────────
    const evalX = (x: number): number => f.eval(x);
    const domX = viewport.domX;
    const domY = viewport.domY;
    const H = viewport.altoPx; // alto del lienzo en px (mide el salto en pantalla)
    // `pasada` del contrato de calidad ↔ el antiguo flag `interactivo`: gesto en
    // curso = menos muestras / refinado (rápido); pasada final = máxima calidad.
    const interactivo = tolerancia.pasada === "interactiva";

    // ── Núcleo adaptativo (idéntico a obs-graph) ─────────────────────────────
    // Densidad ligada a píxeles: muestras-por-ancho acotadas, así la densidad por
    // píxel se mantiene a cualquier zoom.
    const MUESTRAS = interactivo
      ? Math.min(2000, Math.max(1000, Math.floor((domX[1] - domX[0]) * 20)))
      : Math.min(8000, Math.max(2000, Math.floor((domX[1] - domX[0]) * 50)));
    const dx = (domX[1] - domX[0]) / MUESTRAS;
    const SALTO_PX_MAX = 8; // salto en Y > 8px → refinar
    const PROF_MAX = interactivo ? 12 : 18;

    // Recorte de valores extremos al equivalente en MUNDO de clip ±3 (un alto de
    // vista más allá del borde): geometría sana lejos del eje sin recortar luego.
    const Hmundo = domY[1] - domY[0];
    const yTop = domY[1] + Hmundo;
    const yBot = domY[0] - Hmundo;
    // Ancho de UN píxel en mundo: umbral del corte defensivo de discontinuidades
    // (ver el else final de `tramo`).
    const pxMundo = (domX[1] - domX[0]) / Math.max(1, viewport.anchoPx);
    const syPx = (y: number): number =>
      H - ((y - domY[0]) / (domY[1] - domY[0])) * H;

    const polilineas: number[][] = [];
    const asintotas: number[] = []; // detectadas para el refinado; no se exponen aún
    let segmento: number[] = [];

    const flush = () => {
      if (segmento.length >= 4) polilineas.push(segmento);
      segmento = [];
    };
    // Emite un punto. Los valores FINITOS se emiten REALES (sin recortar a la
    // vista): así el crosshair y el carril leen la y verdadera de la curva aunque
    // quede fuera de pantalla (el recorte visual lo hace el renderer). Un valor
    // no finito (polo) trepa al borde según el signo.
    const emit = (x: number, y: number) => {
      segmento.push(x, Number.isFinite(y) ? y : y > 0 ? yTop : yBot);
    };
    // Fuerza el punto al borde según hacia dónde dispara la rama (signo de y).
    const emitPolo = (x: number, y: number) => {
      segmento.push(x, y >= 0 ? yTop : yBot);
    };
    const registrarAsintota = (x: number) => {
      asintotas.push(x);
    };

    // Distingue overflow numérico (x^1000 → Infinity sin ser polo) de divergencia
    // real: escanea desde el extremo infinito hacia el borde; si reaparece finito
    // es polo, si no, overflow.
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

    // Asíntotas de la MISMA rama (ambos lados → +∞ o ambos → -∞: 1/x², ln|tan x|…)
    // por su firma topológica robusta (|f| tiene un máximo local que DIVERGE),
    // estable al zoom.
    const detectarAsintotasMismaRama = (): number[] => {
      const out: number[] = [];
      const N = Math.min(4000, Math.max(500, Math.ceil((domX[1] - domX[0]) * 30)));
      const paso = (domX[1] - domX[0]) / N;
      const magLado = (xPolo: number, d: number): number => {
        const a = evalX(xPolo - d),
          b = evalX(xPolo + d);
        const af = Number.isFinite(a) ? Math.abs(a) : -Infinity;
        const bf = Number.isFinite(b) ? Math.abs(b) : -Infinity;
        return Math.max(af, bf);
      };
      const registrar = (xIzq: number, xDer: number) => {
        let lo = xIzq,
          hi = xDer;
        for (let k = 0; k < 60; k++) {
          const m1 = lo + (hi - lo) / 3;
          const m2 = hi - (hi - lo) / 3;
          if (Math.abs(evalX(m1)) < Math.abs(evalX(m2))) lo = m1;
          else hi = m2;
        }
        const xPolo = (lo + hi) / 2;
        const m1 = magLado(xPolo, 1e-3);
        const m2 = magLado(xPolo, 1e-7);
        const m3 = magLado(xPolo, 1e-11);
        const diverge = Number.isFinite(m3) && m3 > m2 + 2 && m2 > m1 + 2;
        if (diverge && !out.some((q) => Math.abs(q - xPolo) < paso)) out.push(xPolo);
      };
      let xA = domX[0],
        yA = evalX(xA);
      let xB = xA + paso,
        yB = evalX(xB);
      for (let i = 2; i <= N; i++) {
        const xC = domX[0] + i * paso;
        const yC = evalX(xC);
        if (
          (yB === Infinity || yB === -Infinity) &&
          Number.isFinite(yA) &&
          Number.isFinite(yC) &&
          Math.sign(yA) === Math.sign(yC)
        ) {
          registrar(xA, xC);
        } else if (Number.isFinite(yA) && Number.isFinite(yB) && Number.isFinite(yC)) {
          const aB = Math.abs(yB);
          // Máximo local ESTRICTO por ambos lados: hacia un polo real las vecinas son
          // estrictamente menores (monótonas hacia la divergencia); con `<=`/`>=` una
          // MESETA de función escalón (floor/ceil con |y|>1.5) empataba en cada terna
          // y disparaba la búsqueda ternaria de `registrar` (60 iteraciones × ~130
          // evaluaciones) cientos de veces por frame → ~1 s/frame con mathjs.
          const maxLocal =
            Math.abs(yA) < aB &&
            aB > Math.abs(yC) &&
            aB > 1.5 &&
            Math.sign(yA) === Math.sign(yB) &&
            Math.sign(yB) === Math.sign(yC);
          if (maxLocal) registrar(xA, xC);
        }
        xA = xB;
        yA = yB;
        xB = xC;
        yB = yC;
      }
      return out;
    };
    const asintotasMismaRama = detectarAsintotasMismaRama();

    // ¿El tramo NO RESUELTO (xa,xb) esconde un salto FINITO entre dos mesetas (una
    // función escalón: floor, ceil)? Sondea puntos interiores: en un salto todos caen
    // sobre el nivel de UN extremo o del OTRO (la función es localmente constante a
    // ambos lados de la discontinuidad); en una pendiente continua sin resolver (la ∛
    // que comprime un polo de tan en zoom-out) toman valores intermedios o mayores
    // (divergen hacia el polo) y se responde false para CONECTAR como siempre. Solo
    // se llama con el refinado agotado: ~7 evaluaciones en los tramos dudosos.
    const esSaltoFinito = (xa: number, ya: number, xb: number, yb: number): boolean => {
      const tol = 0.05 * Math.abs(yb - ya);
      const N = 8;
      for (let k = 1; k < N; k++) {
        const v = evalX(xa + (k / N) * (xb - xa));
        if (!Number.isFinite(v)) return false;
        if (Math.abs(v - ya) > tol && Math.abs(v - yb) > tol) return false;
      }
      return true;
    };

    // Procesa el intervalo (xa, xb]. NO emite (xa,ya): lo asume ya emitido.
    // Subdivide donde la pendiente en píxeles es grande y CORTA al localizar polo.
    const tramo = (xa: number, ya: number, xb: number, yb: number, prof: number) => {
      const finA = Number.isFinite(ya),
        finB = Number.isFinite(yb);
      const pyA = finA ? syPx(ya) : ya > 0 ? -1e7 : 1e7;
      const pyB = finB ? syPx(yb) : yb > 0 ? -1e7 : 1e7;
      const saltoPx = Math.abs(pyB - pyA);

      const fueraMismoLado =
        (ya > domY[1] && yb > domY[1]) || (ya < domY[0] && yb < domY[0]);
      const poloEnTramo = asintotasMismaRama.some(
        (q) => q > Math.min(xa, xb) && q < Math.max(xa, xb)
      );
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

      const cruza =
        (ya > domY[1] && yb < domY[0]) || (ya < domY[0] && yb > domY[1]);
      const algunNoFinito = !finA || !finB;
      const poloMismoLado = poloEnTramo && finA && finB && !cruza && ya * yb > 0;
      if (cruza || algunNoFinito || poloMismoLado) {
        let esPolo = cruza || poloMismoLado;
        if (!esPolo && finA !== finB) {
          const xf = finA ? xa : xb;
          const yf = finA ? ya : yb;
          const xn = finA ? xb : xa;
          let lo = xf,
            hi = xn,
            magCerca = Math.abs(yf);
          for (let k = 0; k < 40; k++) {
            const mid = (lo + hi) / 2;
            const ym = evalX(mid);
            if (Number.isFinite(ym)) {
              lo = mid;
              magCerca = Math.abs(ym);
            } else hi = mid;
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
          if (finA) {
            emit(xa, ya);
            emitPolo(xa, ya);
          }
          if (!poloMismoLado) registrarAsintota((xa + xb) / 2);
          flush();
          if (finB) {
            emitPolo(xb, yb);
            emit(xb, yb);
          }
        } else {
          if (finA) emit(xa, ya);
          flush();
          if (finB) emit(xb, yb);
        }
      } else {
        // Corte DEFENSIVO de discontinuidad no resuelta: con el refinado AGOTADO
        // (prof = PROF_MAX), un salto de más de una vista de alto en un intervalo
        // SUBPÍXEL que ATRAVIESA la banda visible es un polo enmascarado (un cero
        // pegado al polo —tan(y)=5 a 0.197 de π/2— lo esconde del escaneo en zoom
        // out): conectar pintaría, al GIRAR la geometría (x=g(y)), una línea que
        // cruza todo el lienzo. Exigir que toque la banda visible preserva la
        // paridad con el motor original (las colas del MISMO lado fuera de vista
        // —vecinas de un polo real como 1/x— se conectan igual que siempre), y
        // cortar es visualmente seguro: un trazo real así de vertical mediría <1px.
        const tocaVista = Math.min(ya, yb) < domY[1] && Math.max(ya, yb) > domY[0];
        const agotadoSubpixel = prof >= PROF_MAX && finA && finB && xb - xa < pxMundo;
        // Salto FINITO de una función escalón (floor, ceil): con el refinado agotado
        // en un intervalo subpíxel y el salto aún sobre el umbral, si los sondeos
        // interiores confirman DOS MESETAS (esSaltoFinito) es una discontinuidad de
        // salto: conectar pintaría el "peldaño" vertical que la función no tiene. La
        // pendiente continua sin resolver (∛ sobre un polo de tan en zoom-out) NO pasa
        // el sondeo y se conecta como siempre; las colas del MISMO lado fuera de vista
        // (fueraMismoLado) se exceptúan, preservando la paridad con el motor original.
        if (agotadoSubpixel &&
            ((tocaVista && Math.abs(yb - ya) > Hmundo) ||
             (saltoPx > SALTO_PX_MAX && !fueraMismoLado && esSaltoFinito(xa, ya, xb, yb))))
          flush();
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
      x0 = x1;
      y0 = y1;
    }
    flush();

    // Asíntotas de la misma rama (1/x², ln|tan x|…): se añaden al registro igual
    // que en obs-graph, para que `asintotas` contenga TODAS las detectadas.
    for (const xp of asintotasMismaRama) registrarAsintota(xp);

    // ── Envoltura de salida: polilíneas (mundo) → Rama[] del contrato ────────
    // Una explícita no produce lazos cerrados ni geometría certificada: cada rama
    // continua es `best-effort`. El parámetro intrínseco es x (alineado 1:1).
    const ramas: Rama[] = [];
    for (const poli of polilineas) {
      const puntos = Float64Array.from(poli);
      const parametro = new Float64Array(puntos.length / 2);
      for (let k = 0; k < parametro.length; k++) parametro[k] = puntos[k * 2];
      ramas.push({ puntos, cerrada: false, calidad: "best-effort", objetoId, parametro });
    }

    // Asíntotas verticales detectadas (x de mundo) → tipo del contrato.
    const asintotasOut = asintotas.map(
      (x): import("../../contracts").Asintota => ({ tipo: "vertical", valor: x })
    );
    return { ramas, asintotas: asintotasOut };
  }
}
