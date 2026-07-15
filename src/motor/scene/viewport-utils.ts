// ─────────────────────────────────────────────
// scene · utilidades puras de Viewport (mapeo mundo↔pantalla)
// ─────────────────────────────────────────────
//
// Funciones PURAS sin estado. Viven aquí (no en contracts/, que es solo tipos) y
// las comparten render e interacción. Todo el mapeo mundo↔pantalla pasa por un
// único sitio para que no haya dos convenciones distintas en el motor.

import type { Viewport } from "../contracts";

/** Construye un Viewport inmutable (copia las tuplas para que nadie las mute). */
export function crearViewport(
  domX: readonly [number, number],
  domY: readonly [number, number],
  anchoPx: number,
  altoPx: number,
  dpr: number
): Viewport {
  return {
    domX: [domX[0], domX[1]],
    domY: [domY[0], domY[1]],
    anchoPx,
    altoPx,
    dpr,
  };
}

/** Mundo → pantalla (px CSS), eje X. */
export function aPantallaX(vp: Viewport, x: number): number {
  return ((x - vp.domX[0]) / (vp.domX[1] - vp.domX[0])) * vp.anchoPx;
}

/** Mundo → pantalla (px CSS), eje Y (invertido: y crece hacia arriba). */
export function aPantallaY(vp: Viewport, y: number): number {
  return vp.altoPx - ((y - vp.domY[0]) / (vp.domY[1] - vp.domY[0])) * vp.altoPx;
}

/** Pantalla (px CSS) → mundo, eje X (lo usa el crosshair para leer x bajo el cursor). */
export function aMundoX(vp: Viewport, px: number): number {
  return vp.domX[0] + (px / vp.anchoPx) * (vp.domX[1] - vp.domX[0]);
}
