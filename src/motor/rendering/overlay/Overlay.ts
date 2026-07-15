// ─────────────────────────────────────────────
// rendering/overlay · Overlay (ejes, grid, ticks, etiquetas)
// ─────────────────────────────────────────────
//
// Capa de fondo del plano: rejilla tenue, ejes principales, marcas y números.
// Es AGNÓSTICA de la matemática: solo necesita el `Viewport`. No conoce curvas,
// ni proveedores, ni la fórmula. Reimplementada en el motor nuevo (no se importa
// del GraphEngine): son utilidades genéricas de plano, no su algoritmo.

import type { Viewport } from "../../contracts";
import { aPantallaX, aPantallaY } from "../../scene/viewport-utils";

/** Paso "bonito" (1·10ⁿ, 2·10ⁿ, 5·10ⁿ) que cubre `rango` con ≤ maxTicks divisiones. */
function pasoBonito(rango: number, maxTicks: number): number {
  const base = Math.pow(10, Math.floor(Math.log10(rango / maxTicks)));
  const pasos = [1, 2, 5, 10].map((m) => m * base);
  return pasos.find((p) => rango / p <= maxTicks) ?? pasos[pasos.length - 1];
}

/**
 * Ticks en múltiplos de `paso` dentro de [min,max], con un cap defensivo `capN` de
 * iteraciones. Bucle por ÍNDICE entero, nunca acumulando `t += paso`: con la vista
 * centrada en un valor ENORME (el carril siguiendo 2x·e^(x²+1) lleva domY a ~1e17) el
 * paso (~2) cae por debajo del ULP de t (16) y `t += paso` NO cambia t → bucle infinito
 * en el hilo principal que congelaba Obsidian entero. El índice entero termina siempre;
 * n queda acotado por construcción (rango/paso ≤ maxTicks) y `capN` cubre cualquier
 * aritmética flotante degenerada.
 */
function ticksConPaso(min: number, max: number, paso: number, capN: number): number[] {
  if (!(paso > 0)) return [];
  const inicio = Math.ceil(min / paso) * paso;
  const n = Math.floor((max + 1e-9 - inicio) / paso);
  if (!Number.isFinite(n) || n < 0) return [];
  const ticks: number[] = [];
  for (let i = 0; i <= Math.min(n, capN); i++) {
    ticks.push(parseFloat((inicio + i * paso).toPrecision(10)));
  }
  return ticks;
}

/** Ticks "bonitos" (1·10ⁿ, 2·10ⁿ, 5·10ⁿ) para un rango. */
export function generarTicks(min: number, max: number, maxTicks = 10): number[] {
  const rango = max - min;
  if (!(rango > 0)) return [];
  return ticksConPaso(min, max, pasoBonito(rango, maxTicks), 4 * maxTicks);
}

/**
 * Ticks de rejilla con CELDAS CUADRADAS. La cámara mantiene la escala px/unidad
 * IDÉNTICA en ambos ejes (domX se deriva de domY·aspecto en redimensionar), así que
 * basta con usar EL MISMO paso de mundo en X e Y para que cada celda mida lo mismo en
 * píxeles: mismo paso · misma escala ⇒ mismo lado en px. NO toca los dominios.
 *
 * El paso común se elige a partir del eje MÁS CORTO en mundo (que con escala 1:1 es el
 * más corto en píxeles) para que ese eje conserve ~maxTicks divisiones; el eje más largo
 * recibe proporcionalmente MÁS líneas, todas del mismo tamaño (antes cada eje elegía su
 * paso "bonito" por separado: el ancho caía en 5 y el alto en 2 → celdas rectangulares).
 */
export function generarTicksCuadrados(
  vp: Viewport,
  maxTicks = 10
): { x: number[]; y: number[] } {
  const rangoX = vp.domX[1] - vp.domX[0];
  const rangoY = vp.domY[1] - vp.domY[0];
  if (!(rangoX > 0) || !(rangoY > 0)) return { x: [], y: [] };
  const rangoMin = Math.min(rangoX, rangoY);
  const paso = pasoBonito(rangoMin, maxTicks);
  // El eje largo necesita hasta (rangoMax/rangoMin) veces más líneas que el corto; el
  // cap acompaña esa proporción para no recortar la rejilla en vistas muy apaisadas,
  // manteniéndose acotado (misma defensa anti-cuelgue que generarTicks).
  const cap = 4 * maxTicks * Math.max(1, Math.ceil(Math.max(rangoX, rangoY) / rangoMin));
  return {
    x: ticksConPaso(vp.domX[0], vp.domX[1], paso, cap),
    y: ticksConPaso(vp.domY[0], vp.domY[1], paso, cap),
  };
}

/** Formato compacto de número para etiquetas de eje. */
export function formatearNumero(n: number): string {
  if (Math.abs(n) < 1e-9) return "0";
  if (Math.abs(n) >= 1000 || (Math.abs(n) < 0.01 && n !== 0)) return n.toExponential(1);
  return parseFloat(n.toPrecision(4)).toString();
}

export class Overlay {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  /** Pinta el fondo + grid + ejes + ticks + etiquetas para este viewport. */
  dibujar(vp: Viewport): void {
    const ctx = this.ctx;
    const W = vp.anchoPx;
    const H = vp.altoPx;

    // Fondo (capa más baja del frame).
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, W, H);

    // Ticks COMUNES a ambos ejes → celdas cuadradas (la escala px/unidad es 1:1).
    const { x: ticksX, y: ticksY } = generarTicksCuadrados(vp);

    // Rejilla tenue.
    ctx.strokeStyle = "rgba(130,130,150,0.12)";
    ctx.lineWidth = 0.5;
    for (const x of ticksX) {
      const px = aPantallaX(vp, x);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
    }
    for (const y of ticksY) {
      const py = aPantallaY(vp, y);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
    }

    // Ejes principales.
    ctx.strokeStyle = "rgba(160,160,170,0.7)";
    ctx.lineWidth = 1;
    if (vp.domY[0] <= 0 && vp.domY[1] >= 0) {
      const y = aPantallaY(vp, 0);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    if (vp.domX[0] <= 0 && vp.domX[1] >= 0) {
      const x = aPantallaX(vp, 0);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }

    // Marcas + números, anclados al eje (o al borde si el eje no se ve).
    const ceroY = Math.max(4, Math.min(H - 4, aPantallaY(vp, 0)));
    const ceroX = Math.max(4, Math.min(W - 4, aPantallaX(vp, 0)));
    ctx.font = "11px monospace";

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const x of ticksX) {
      if (Math.abs(x) < 1e-9) continue;
      const px = aPantallaX(vp, x);
      if (px < 10 || px > W - 10) continue;
      ctx.strokeStyle = "rgba(160,160,170,0.5)"; ctx.lineWidth = 0.75;
      ctx.beginPath(); ctx.moveTo(px, ceroY - 3); ctx.lineTo(px, ceroY + 3); ctx.stroke();
      ctx.fillStyle = "rgba(160,160,170,0.85)";
      ctx.fillText(formatearNumero(x), px, ceroY + 5);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const y of ticksY) {
      if (Math.abs(y) < 1e-9) continue;
      const py = aPantallaY(vp, y);
      if (py < 10 || py > H - 10) continue;
      ctx.strokeStyle = "rgba(160,160,170,0.5)"; ctx.lineWidth = 0.75;
      ctx.beginPath(); ctx.moveTo(ceroX - 3, py); ctx.lineTo(ceroX + 3, py); ctx.stroke();
      ctx.fillStyle = "rgba(160,160,170,0.85)";
      ctx.fillText(formatearNumero(y), ceroX - 6, py);
    }
  }
}
