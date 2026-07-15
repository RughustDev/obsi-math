// ─────────────────────────────────────────────
// rendering · RendererCanvas2D (consumidor PURO de Geometria)
// ─────────────────────────────────────────────
//
// Renderizador mínimo de Fase A. Dibuja en Canvas 2D (más simple y de menor
// riesgo que WebGL para el esqueleto; es un `Renderer` enchufable más, ver §7 del
// documento de arquitectura). La REGLA CLAVE que valida esta fase:
//
//   El renderizador solo conoce `Rama`, `Geometria`, `Estilo` y `Viewport`.
//   NO sabe si la geometría vino de una explícita, una implícita o lo que sea.
//
// Recibe pares {geometria, estilo}. Mapea mundo→pantalla con las utilidades
// compartidas y traza cada polilínea. Nada de matemática de curvas aquí.

import type { Geometria, Estilo, Viewport, Punto } from "../contracts";
import { aPantallaX, aPantallaY } from "../scene/viewport-utils";

export interface ItemDibujo {
  readonly geometria: Geometria;
  readonly estilo: Estilo;
}

const css = (c: readonly [number, number, number, number]): string =>
  `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${c[3]})`;

// Recorte visual en píxeles (mismo criterio que `dibujar`): Canvas2D no maneja
// coordenadas astronómicas (cerca de un polo la Y se dispara). Módulo-nivel para
// compartirlo entre el trazo de ramas y el relleno de la región de integral.
const LIM_PX = 1e6;
const clampPx = (v: number): number => (v < -LIM_PX ? -LIM_PX : v > LIM_PX ? LIM_PX : v);

// Tintes del RELLENO de la integral definida (obs-integral). Dos colores fijos para que
// el ÁREA CON SIGNO se lea de un vistazo, independientemente del color de la curva: frío
// sobre el eje (f>0), cálido bajo el eje (f<0). Translúcidos para no tapar rejilla ni curva.
export const RELLENO_POSITIVO = "rgba(90, 165, 255, 0.20)";
export const RELLENO_NEGATIVO = "rgba(240, 110, 90, 0.20)";

// Tramado DIAGONAL sobre el relleno (estilo libro de cálculo): hace legible la región
// aunque el tinte translúcido se confunda con el fondo, sin taparla (trazo fino, SÓLIDO
// y translúcido, mismo frío/cálido que el relleno para conservar el signo).
export const TRAMA_POSITIVA = "rgba(140, 195, 255, 0.30)";
export const TRAMA_NEGATIVA = "rgba(255, 150, 125, 0.30)";
const TRAMA_PASO_PX = 12;      // separación entre diagonales

// Borde de la región: línea vertical del eje a la curva en cada extremo (x=a y x=b),
// para que los LÍMITES de integración se lean en el plano y no solo en el LaTeX. Azul
// de la familia del relleno pero sólido (el blanco deslumbraba sobre el tema oscuro).
export const BORDE_REGION = "rgba(110, 175, 255, 0.95)";
const BORDE_GROSOR_PX = 2;

export class RendererCanvas2D {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  // Dibuja SOLO las ramas (capa intermedia). El fondo, la rejilla y los ejes los
  // pinta el Overlay (capa inferior); el crosshair va encima. No limpia el canvas:
  // el Overlay lo hizo al principio del frame.
  dibujar(items: readonly ItemDibujo[], vp: Viewport): void {
    const ctx = this.ctx;

    // La Rama lleva geometría REAL (sin recortar). El recorte visual es cosa del
    // renderer: se acota la coordenada de pantalla a un margen amplio fuera del
    // lienzo para que Canvas2D no maneje coordenadas astronómicas (p.ej. exp(x) o
    // cerca de un polo). El segmento sigue saliendo del lienzo casi vertical/horizontal,
    // como debe. Se acotan AMBOS ejes: una asíntota vertical dispara la Y (tan x), pero
    // una curva x=g(y) con polos (tan y+x=5) dispara la X a ~1e9 cerca del polo → sin
    // acotar la X, Canvas traza esos puntos como líneas que cruzan todo el lienzo.
    const clamp = clampPx;

    // Las ramas de cada geometría, con su estilo. Una sola maquinaria para todo.
    for (const { geometria, estilo } of items) {
      ctx.strokeStyle = css(estilo.color);
      ctx.lineWidth = estilo.grosorPx;
      ctx.lineJoin = "round";
      for (const rama of geometria.ramas) {
        const p = rama.puntos;
        if (p.length < 4) continue;
        ctx.beginPath();
        ctx.moveTo(clamp(aPantallaX(vp, p[0])), clamp(aPantallaY(vp, p[1])));
        for (let k = 2; k < p.length; k += 2) {
          ctx.lineTo(clamp(aPantallaX(vp, p[k])), clamp(aPantallaY(vp, p[k + 1])));
        }
        ctx.stroke();
      }
    }
  }

  // Relleno de la región bajo la curva de una integral definida (obs-integral), capa
  // ENTRE la rejilla/asíntotas y las ramas (el trazo de la curva queda encima). Recibe las
  // polilíneas YA recortadas a x∈[a,b] por `recortarRegion` (analysis). Cada polilínea se
  // parte en tramos de signo constante (corte en y=0) y se rellena hasta el eje con su
  // tinte: frío arriba (f>0), cálido abajo (f<0) → el ÁREA CON SIGNO es visible. Si el eje
  // y=0 queda fuera de vista, el relleno llega al borde del lienzo (sigue siendo "al eje").
  dibujarRegion(regiones: readonly Float64Array[], vp: Viewport): void {
    if (regiones.length === 0) return;
    const ctx = this.ctx;
    const ejeY = Math.max(0, Math.min(vp.altoPx, aPantallaY(vp, 0)));

    // Tramado diagonal DENTRO del polígono recién trazado: `clip()` recorta al contorno
    // actual (el path sobrevive al fill) y se barren diagonales a 45° sobre todo el
    // lienzo — el clip descarta el resto y el coste es trivial a este tamaño.
    // La familia de diagonales xPx+yPx = c se ANCLA AL MUNDO (fase referida al origen):
    // así el rayado acompaña al pan de la cámara; anclado a la pantalla se quedaba
    // quieto y parecía deslizarse sobre la región al mover.
    const tramar = (color: string) => {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      const fase = (aPantallaX(vp, 0) + aPantallaY(vp, 0)) % TRAMA_PASO_PX;
      const cMax = vp.anchoPx + vp.altoPx;
      ctx.beginPath();
      for (let c = fase - TRAMA_PASO_PX; c < cMax + TRAMA_PASO_PX; c += TRAMA_PASO_PX) {
        ctx.moveTo(c - vp.altoPx, vp.altoPx);
        ctx.lineTo(c, 0);
      }
      ctx.stroke();
      ctx.restore();
    };

    ctx.save();
    for (const poly of regiones) {
      let run: number[] = []; // [xPx,yPx, …] del tramo de signo constante actual
      let signo = 0;
      const rellenar = () => {
        if (run.length >= 4 && signo !== 0) {
          ctx.beginPath();
          ctx.moveTo(run[0], ejeY);
          for (let i = 0; i < run.length; i += 2) ctx.lineTo(run[i], run[i + 1]);
          ctx.lineTo(run[run.length - 2], ejeY);
          ctx.closePath();
          ctx.fillStyle = signo > 0 ? RELLENO_POSITIVO : RELLENO_NEGATIVO;
          ctx.fill();
          tramar(signo > 0 ? TRAMA_POSITIVA : TRAMA_NEGATIVA);
        }
        run = []; signo = 0;
      };
      let px = 0, py = 0, hay = false; // último vértice en MUNDO (para interpolar el cruce)
      for (let k = 0; k < poly.length; k += 2) {
        const x = poly[k], y = poly[k + 1];
        const s = y > 0 ? 1 : y < 0 ? -1 : 0;
        if (hay && s !== 0 && signo !== 0 && s !== signo) {
          // Cruce por y=0 entre (px,py) y (x,y): punto de corte en mundo (x donde y=0).
          const t = py / (py - y);
          const cortePx = clampPx(aPantallaX(vp, px + (x - px) * t));
          run.push(cortePx, ejeY);
          rellenar();
          run.push(cortePx, ejeY);
          signo = s;
        }
        if (s !== 0 && signo === 0) signo = s;
        run.push(clampPx(aPantallaX(vp, x)), clampPx(aPantallaY(vp, y)));
        px = x; py = y; hay = true;
      }
      rellenar();

      // Bordes de la región: en los EXTREMOS de la polilínea recortada (x=a y x=b, ya
      // interpolados por `recortarRegion`) una vertical clara del eje a la curva. Si el
      // extremo cae en y=0 (p.ej. a=0 en x²) el trazo degenera a un punto: invisible, bien.
      if (poly.length >= 4) {
        ctx.strokeStyle = BORDE_REGION;
        ctx.lineWidth = BORDE_GROSOR_PX;
        for (const k of [0, poly.length - 2]) {
          const bx = clampPx(aPantallaX(vp, poly[k]));
          const by = clampPx(aPantallaY(vp, poly[k + 1]));
          ctx.beginPath();
          ctx.moveTo(bx, ejeY);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // Asíntotas verticales y horizontales como líneas punteadas (estilo overlay).
  // Lee Geometria.asintotas; agnóstico de cómo se detectaron.
  dibujarAsintotas(items: readonly ItemDibujo[], vp: Viewport): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = "rgba(100, 150, 255, 0.3)";
    ctx.lineWidth = 1;
    for (const { geometria } of items) {
      for (const a of geometria.asintotas) {
        if (typeof a.valor !== "number") continue;
        if (a.tipo === "vertical") {
          const px = aPantallaX(vp, a.valor);
          if (px < 0 || px > vp.anchoPx) continue;
          ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, vp.altoPx); ctx.stroke();
        } else if (a.tipo === "horizontal") {
          const py = aPantallaY(vp, a.valor);
          if (py < 0 || py > vp.altoPx) continue;
          ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(vp.anchoPx, py); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // Marcadores de puntos notables (anillo tenue + disco naranja). Radio en
  // píxeles → tamaño constante con el zoom. Lee Geometria.puntosNotables.
  dibujarPuntosNotables(items: readonly ItemDibujo[], vp: Viewport): void {
    const ctx = this.ctx;
    for (const { geometria } of items) {
      for (const pn of geometria.puntosNotables) {
        const px = aPantallaX(vp, pn.punto.x);
        const py = aPantallaY(vp, pn.punto.y);
        if (px < 0 || px > vp.anchoPx || py < 0 || py > vp.altoPx) continue;
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 160, 40, 1.0)";
        ctx.fill();
      }
    }
  }

  // Marcadores de intersección del sistema (anillo tenue + disco morado, el
  // COLOR_PUNTO_SOLUCION del obs-system original). Solo conoce Punto+Viewport.
  dibujarIntersecciones(puntos: readonly Punto[], vp: Viewport): void {
    const ctx = this.ctx;
    for (const p of puntos) {
      const px = aPantallaX(vp, p.x);
      const py = aPantallaY(vp, p.y);
      if (px < 0 || px > vp.anchoPx || py < 0 || py > vp.altoPx) continue;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(168, 85, 247, 1.0)";
      ctx.fill();
    }
  }
}
