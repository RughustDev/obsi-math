// ─────────────────────────────────────────────
// rendering · Crosshair (lee la GEOMETRÍA, no la matemática)
// ─────────────────────────────────────────────
//
// Cruz informativa que sigue al cursor. La clave arquitectónica de la Fase C:
// el crosshair obtiene la `y` sobre la curva INTERPOLANDO la `Rama` ya trazada
// (su polilínea + el parámetro intrínseco x), NO evaluando f(x). El shell es
// AGNÓSTICO de la fórmula: solo conoce `Rama`/`Geometria`/`Viewport`. Esto valida
// que "la interacción se alimenta de la geometría", base del carril, el picking y
// la navegación que vendrán después.

import type { Viewport } from "../contracts";
import type { ItemDibujo } from "./RendererCanvas2D";
import { aPantallaY, aMundoX } from "../scene/viewport-utils";
import { yEnRamas } from "../analysis/lecturaRama";
import { formatearNumero } from "./overlay/Overlay";

export class Crosshair {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  /**
   * Cruz (+) propia del cursor, centrada exactamente en (px, py) del ratón.
   * Sustituye al cursor del sistema (oculto con cursor:none en el canvas). Mismo
   * estilo que obs-system: 14px, blanca, 1.25px. Es independiente del crosshair
   * matemático: se muestra siempre que el puntero esté sobre el plano.
   */
  dibujarCursorCruz(px: number, py: number): void {
    const R = 7; // semibrazo → cruz de 14px
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(235, 238, 245, 0.95)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(px - R, py); ctx.lineTo(px + R, py);
    ctx.moveTo(px, py - R); ctx.lineTo(px, py + R);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Dibuja la cruz en cursorPx (px CSS). Sigue la curva SELECCIONADA (`item`, que el
   * host elige con los botones de color); el marcador toma el color de esa curva.
   * Obtiene la y INTERPOLANDO la `Rama` (no evalúa f). `anclado` añade el anillo
   * naranja del modo carril.
   */
  dibujar(
    vp: Viewport,
    cursorPx: number,
    item: ItemDibujo | undefined,
    anclado = false,
    yMundo?: number | null
  ): void {
    const ctx = this.ctx;
    const W = vp.anchoPx;
    const H = vp.altoPx;

    const worldX = aMundoX(vp, cursorPx);
    // En modo carril se pasa la y EXPLÍCITA (la misma que centró la cámara) para
    // que el punto quede centrado por construcción y nunca salga del viewport.
    // En modo libre, se interpola de la geometría.
    const y =
      yMundo !== undefined ? yMundo : item ? yEnRamas(item.geometria.ramas, worldX) : null;

    // Sin y sobre la curva en este x (curva implícita que `yEnRamas` no sabe seguir
    // —sus ramas no llevan `parametro`—, o x fuera del dominio trazado), el crosshair
    // no tiene nada a lo que referirse: no se dibuja ni la línea vertical ni las
    // etiquetas, queda solo la cruz del cursor (que pinta Escena aparte). Antes salía
    // la línea con "y = —", inútil.
    if (y === null || !Number.isFinite(y)) return;

    const py = aPantallaY(vp, y);
    const yVisible = py >= 0 && py <= H;

    ctx.save();

    // Líneas de PUNTOS redondos (estilo referencia): dash corto + lineCap round
    // produce puntos circulares espaciados, en vez de guiones largos.
    ctx.lineCap = "round";
    ctx.setLineDash([1.5, 5]);
    ctx.strokeStyle = "rgba(140, 170, 255, 0.3)";
    ctx.lineWidth = 1.25;
    ctx.beginPath(); ctx.moveTo(cursorPx, 0); ctx.lineTo(cursorPx, H); ctx.stroke();
    if (yVisible) {
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineCap = "butt";

    // Marcador en el punto sobre la curva.
    if (yVisible) {
      ctx.beginPath();
      ctx.arc(cursorPx, py, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cursorPx, py, 3, 0, Math.PI * 2);
      // Disco del color de la curva seleccionada (coincide con su botón); azul si falta.
      const c = item?.estilo.color;
      ctx.fillStyle = c
        ? `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, 1)`
        : "rgba(80, 160, 255, 1.0)";
      ctx.fill();
      // Modo carril: anillo naranja para distinguir el punto anclado.
      if (anclado) {
        ctx.strokeStyle = "rgba(255, 160, 40, 0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cursorPx, py, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Etiquetas x / y a un lado de la línea (cambia de lado cerca del borde).
    const aLaDerecha = cursorPx < W * 0.75;
    ctx.textAlign = aLaDerecha ? "left" : "right";
    ctx.textBaseline = "top";
    ctx.font = "11px monospace";
    const tx = cursorPx + (aLaDerecha ? 5 : -5);
    ctx.fillStyle = "rgba(200, 210, 255, 0.9)";
    ctx.fillText(`x = ${formatearNumero(worldX)}`, tx, 4);
    ctx.fillText(`y = ${formatearNumero(y)}`, tx, 18);

    ctx.restore();
  }
}
