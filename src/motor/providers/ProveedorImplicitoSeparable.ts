// ─────────────────────────────────────────────
// providers · ProveedorImplicitoSeparable (implícita separable → ramas explícitas)
// ─────────────────────────────────────────────
//
// Implementa la costura `ProveedorGeometria` para una implícita F(x,y)=0 que se ha
// SEPARADO algebraicamente en 1–2 ramas explícitas y=f(x) (ver analysis/separarImplicita).
// Traza cada rama con el MISMO sampler explícito que las funciones y=f(x) normales (el
// portado de obs-graph, que corta limpio en polos/asíntotas) y fusiona las geometrías.
//
// POR QUÉ existe: una curva separable con polos (tan x + y² = 2 = ±√(2−tan x)) la
// resuelve el sampler 1D a cualquier zoom, mientras la continuación por gradiente la
// cruza al alejar el zoom. El composition root elige este proveedor solo para implícitas
// separables CON polos; las cónicas suaves siguen por continuación (lazos cerrados). NO
// conoce mathjs ni Canvas; reemplazar el sampler = inyectar otro TrazadorExplicito.

import type {
  ProveedorGeometria,
  TrazadorExplicito,
  FuncionReal,
  CampoEscalar,
  Asintota,
  PuntoNotable,
  Viewport,
  Tolerancia,
  Geometria,
  Rama,
} from "../contracts";
import { analizarPuntosNotables } from "../analysis/puntosNotablesDeRama";
import { localizarPolos } from "../analysis/separarImplicita";
import { crearViewport } from "../scene/viewport-utils";

export class ProveedorImplicitoSeparable implements ProveedorGeometria {
  /**
   * `transpuesta=true` → las ramas despejadas son x=g(y) (separable en X, p.ej.
   * tan(y)+x=5; `campo` es el TRANSPUESTO Ft(x,y)=F(y,x)): se transpone el viewport
   * a la entrada, se trabaja igual que siempre en el mundo transpuesto, y se giran
   * las coordenadas del resultado a la salida (ver `girarGeometria`).
   */
  constructor(
    public readonly objetoId: string,
    private readonly ramasExplicitas: readonly FuncionReal[],
    private readonly trazador: TrazadorExplicito,
    private readonly campo: CampoEscalar,
    private readonly transpuesta = false
  ) {}

  geometria(viewport: Viewport, tolerancia: Tolerancia): Geometria {
    if (this.transpuesta) {
      const vpT = crearViewport(
        viewport.domY, viewport.domX, viewport.altoPx, viewport.anchoPx, viewport.dpr
      );
      return girarGeometria(this.geometriaEnEjePropio(vpT, tolerancia), this.objetoId, tolerancia);
    }
    return this.geometriaEnEjePropio(viewport, tolerancia);
  }

  private geometriaEnEjePropio(viewport: Viewport, tolerancia: Tolerancia): Geometria {
    // Polos de c(x)=F(x,0) dentro de la vista: se usan para CORTAR las ramas en cada
    // asíntota que el sampler 1D no detecte (la ∛ comprime el polo y a muestreo grueso
    // |y| no llega a ∞ → el sampler conectaría a través). General para cualquier raíz.
    const polos = localizarPolos(this.campo, viewport.domX[0], viewport.domX[1]);
    // Borde "una pantalla más allá" (como el band del sampler): al cortar en un polo se
    // EXTIENDE el extremo de la rama hasta aquí si aún no llegó, para que la asíntota se
    // dibuje vertical hasta el borde también en la pasada rápida (donde la raíz comprimida
    // —∛— no refina lo bastante cerca del polo). El renderer recorta a la vista.
    const H = viewport.domY[1] - viewport.domY[0];
    const yTop = viewport.domY[1] + H, yBot = viewport.domY[0] - H;
    const ramas: Rama[] = [];
    const asintotas: Asintota[] = [];
    for (const f of this.ramasExplicitas) {
      const r = this.trazador.trazar(f, this.objetoId, viewport, tolerancia);
      for (const rama of r.ramas) for (const sub of partirEnPolos(rama, polos, yTop, yBot)) ramas.push(sub);
      for (const a of r.asintotas) asintotas.push(a);
    }
    // Dos pasadas (igual que ProveedorExplicito): los extras solo en la final.
    const esFinal = tolerancia.pasada === "final";
    // `viewport` habilita las raíces de extremo de rama (√ que nace en el eje X).
    // En la variante transpuesta este viewport es el del eje propio, pero da igual:
    // girarGeometria recalcula los puntos notables sobre la geometría ya girada.
    const puntosNotables: PuntoNotable[] = esFinal ? analizarPuntosNotables(ramas, this.objetoId, viewport) : [];
    return {
      ramas,
      singularidades: [],
      puntosNotables,
      asintotas: esFinal ? dedupAsintotas(asintotas) : [],
    };
  }
}

/**
 * Parte una rama explícita (parámetro = x monótono) en los polos que caigan DENTRO de
 * un segmento (asíntota entre dos muestras): la curva no es continua ahí. Devuelve las
 * sub-ramas (≥2 puntos). Si no hay cortes, la rama original. Evita la conexión espuria a
 * través de un polo cuando el sampler no lo detectó (raíces que comprimen el polo).
 */
function partirEnPolos(rama: Rama, polos: readonly number[], yTop: number, yBot: number): Rama[] {
  const t = rama.parametro;
  if (polos.length === 0 || !t || t.length < 2) return [rama];
  const p = rama.puntos;
  const n = t.length;
  // Cortes: cada {k, px} = hay un polo px en el segmento (t[k], t[k+1]) → cortar tras k.
  const cortes: { k: number; px: number }[] = [];
  for (let k = 0; k < n - 1; k++) {
    const lo = Math.min(t[k], t[k + 1]), hi = Math.max(t[k], t[k + 1]);
    const px = polos.find((q) => q > lo && q < hi);
    if (px !== undefined) cortes.push({ k, px });
  }
  if (cortes.length === 0) return [rama];

  const out: Rama[] = [];
  // Punto de borde hacia un polo, SOLO si el extremo no llegó ya al borde (|y| < |yBorde|).
  const yBorde = (y: number): number | null => {
    if (y >= 0) return y < yTop ? yTop : null;
    return y > yBot ? yBot : null;
  };
  const empuja = (a: number, b: number, prePx: number | null, postPx: number | null) => {
    if (b < a) return;
    const pts: number[] = [], par: number[] = [];
    if (prePx !== null) { const ye = yBorde(p[a * 2 + 1]); if (ye !== null) { pts.push(prePx, ye); par.push(prePx); } }
    for (let i = a; i <= b; i++) { pts.push(p[i * 2], p[i * 2 + 1]); par.push(t[i]); }
    if (postPx !== null) { const ye = yBorde(p[b * 2 + 1]); if (ye !== null) { pts.push(postPx, ye); par.push(postPx); } }
    if (pts.length >= 4)
      out.push({ puntos: Float64Array.from(pts), cerrada: false, calidad: rama.calidad, objetoId: rama.objetoId, parametro: Float64Array.from(par) });
  };

  let ini = 0;
  let prePx: number | null = null;            // polo a la izquierda de la sub-rama
  for (const { k, px } of cortes) { empuja(ini, k, prePx, px); ini = k + 1; prePx = px; }
  empuja(ini, n - 1, prePx, null);
  return out;
}

/**
 * Gira una geometría del mundo TRANSPUESTO al real: (x,y) → (y,x) en cada rama, y las
 * asíntotas verticales pasan a horizontales. `parametro` se OMITE (tras el giro sería la
 * y, y `yEnRamas` lo leería como x — mismo estado que las ramas de la continuación). Los
 * puntos notables se recalculan sobre la polilínea YA girada (las ramas x=g(y) monótonas
 * dan sus raíces igualmente); los del mundo transpuesto se descartan (semántica en x).
 * Exportada: la reutiliza ProveedorImplicitoPeriodico para su variante transpuesta.
 */
export function girarGeometria(g: Geometria, objetoId: string, tolerancia: Tolerancia): Geometria {
  const ramas: Rama[] = g.ramas.map((r) => {
    const p = r.puntos;
    const q = new Float64Array(p.length);
    for (let i = 0; i < p.length; i += 2) { q[i] = p[i + 1]; q[i + 1] = p[i]; }
    return { puntos: q, cerrada: r.cerrada, calidad: r.calidad, objetoId };
  });
  const asintotas: Asintota[] = g.asintotas.map((a): Asintota =>
    a.tipo === "vertical" ? { tipo: "horizontal", valor: a.valor }
    : a.tipo === "horizontal" ? { tipo: "vertical", valor: a.valor }
    : a);
  const esFinal = tolerancia.pasada === "final";
  return {
    ramas,
    singularidades: [],
    puntosNotables: esFinal ? analizarPuntosNotables(ramas, objetoId) : [],
    asintotas,
  };
}

/** Quita asíntotas verticales repetidas entre ramas (misma x ⇒ misma línea). */
function dedupAsintotas(asintotas: readonly Asintota[]): Asintota[] {
  const out: Asintota[] = [];
  for (const a of asintotas) {
    if (a.tipo === "vertical" && out.some((b) => b.tipo === "vertical" && Math.abs((b.valor as number) - (a.valor as number)) < 1e-6)) continue;
    out.push(a);
  }
  return out;
}
