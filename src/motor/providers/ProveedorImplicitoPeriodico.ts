// ─────────────────────────────────────────────
// providers · ProveedorImplicitoPeriodico (trig en y → infinitas ramas explícitas)
// ─────────────────────────────────────────────
//
// Implementa `ProveedorGeometria` para una implícita F(x,y) = a(x)·T(y) + c(x) = 0 con
// T trig PERIÓDICA de y (ver analysis/separarTrigY): T(y) = g(x) ⇒ INFINITAS ramas
//     y = T⁻¹(g(x)) + k·período      (1–2 inversas base según T)
// La continuación por gradiente pierde estas ramas casi horizontales al alejar el zoom
// (el grid de semillas no las ve todas, p.ej. tan(y)·(x²+1)=√(x+1)). Aquí se reduce a
// funciones EXPLÍCITAS y se reutiliza el sampler 1D — la "misma filosofía" que las
// separables con polos (Etapas 7/12), ahora en HORIZONTAL (ramas apiladas en y).
//
// CLAVE de coste: todas las copias k son TRASLACIONES VERTICALES exactas de la misma
// curva base (el viewport es lineal en y → misma geometría en px). Se traza la base UNA
// vez por inversa (en un viewport auxiliar centrado en su rango, con la MISMA escala
// px/mundo) y se emiten copias trasladadas: O(1 trazado) aunque haya cientos de ramas.
//
// `transpuesta=true` cubre el caso simétrico F = a(y)·T(x) + c(y) (columnas de ramas
// casi verticales): se trabaja en el mundo transpuesto y se gira el resultado, igual
// que ProveedorImplicitoSeparable. NO conoce mathjs ni Canvas (Ring 2).

import type {
  ProveedorGeometria,
  TrazadorExplicito,
  Viewport,
  Tolerancia,
  Geometria,
  Rama,
} from "../contracts";
import type { SeparacionTrigY, TrigY } from "../analysis/separarImplicita";
import { analizarPuntosNotables } from "../analysis/puntosNotablesDeRama";
import { crearViewport } from "../scene/viewport-utils";
import { girarGeometria } from "./ProveedorImplicitoSeparable";

const PI = Math.PI;

/** Inversas base de cada T y el rango de y que cubren (una "planta" del edificio
 *  periódico). sec/csc invierten vía 1/v (|g|<1 → NaN = hueco, igual que el dominio
 *  real de la curva); sin/cos con |g|>1 → NaN también. */
const INVERSAS: Record<TrigY, { periodo: number; bases: ReadonlyArray<{ inv: (v: number) => number; rango: readonly [number, number] }> }> = {
  tan: { periodo: PI, bases: [{ inv: Math.atan, rango: [-PI / 2, PI / 2] }] },
  cot: { periodo: PI, bases: [{ inv: (v) => PI / 2 - Math.atan(v), rango: [0, PI] }] },
  sin: {
    periodo: 2 * PI,
    bases: [
      { inv: Math.asin, rango: [-PI / 2, PI / 2] },
      { inv: (v) => PI - Math.asin(v), rango: [PI / 2, (3 * PI) / 2] },
    ],
  },
  cos: {
    periodo: 2 * PI,
    bases: [
      { inv: Math.acos, rango: [0, PI] },
      { inv: (v) => -Math.acos(v), rango: [-PI, 0] },
    ],
  },
  sec: {
    periodo: 2 * PI,
    bases: [
      { inv: (v) => Math.acos(1 / v), rango: [0, PI] },
      { inv: (v) => -Math.acos(1 / v), rango: [-PI, 0] },
    ],
  },
  csc: {
    periodo: 2 * PI,
    bases: [
      { inv: (v) => Math.asin(1 / v), rango: [-PI / 2, PI / 2] },
      { inv: (v) => PI - Math.asin(1 / v), rango: [PI / 2, (3 * PI) / 2] },
    ],
  },
};

// Tope de copias por inversa base: a partir de aquí las ramas distan <1–2 px en
// cualquier lienzo razonable (moiré) y añadirlas solo cuesta memoria/render.
const MAX_COPIAS = 400;

export class ProveedorImplicitoPeriodico implements ProveedorGeometria {
  constructor(
    public readonly objetoId: string,
    private readonly sep: SeparacionTrigY,
    private readonly trazador: TrazadorExplicito,
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
    const { periodo, bases } = INVERSAS[this.sep.tipo];
    const g = this.sep.g;
    // Escala px/mundo en y del viewport REAL: el auxiliar la conserva para que el
    // refinado por salto-en-píxeles decida idéntico a como lo haría en la vista.
    const pxPorY = viewport.altoPx / (viewport.domY[1] - viewport.domY[0]);
    const ramas: Rama[] = [];
    for (const b of bases) {
      // Viewport auxiliar centrado en el rango de la inversa base (±½ período de
      // holgura), misma domX/anchoPx (la densidad de muestreo en x no cambia).
      const y0 = b.rango[0] - periodo / 2, y1 = b.rango[1] + periodo / 2;
      const vpBase = crearViewport(
        viewport.domX, [y0, y1], viewport.anchoPx, Math.max(4, pxPorY * (y1 - y0)), viewport.dpr
      );
      const base = this.trazador.trazar(
        { eval: (x) => b.inv(g(x)) }, this.objetoId, vpBase, tolerancia
      );
      // Copias k cuyo rango [rango+k·per] toca la vista (±1 período de margen).
      let kLo = Math.ceil((viewport.domY[0] - b.rango[1]) / periodo) - 1;
      let kHi = Math.floor((viewport.domY[1] - b.rango[0]) / periodo) + 1;
      if (kHi - kLo + 1 > MAX_COPIAS) {
        const kC = Math.round((viewport.domY[0] + viewport.domY[1]) / 2 / periodo);
        kLo = kC - MAX_COPIAS / 2;
        kHi = kC + MAX_COPIAS / 2;
      }
      for (let k = kLo; k <= kHi; k++) {
        for (const r of base.ramas) ramas.push(trasladarY(r, k * periodo));
      }
    }
    const esFinal = tolerancia.pasada === "final";
    return {
      ramas,
      singularidades: [],
      puntosNotables: esFinal ? analizarPuntosNotables(ramas, this.objetoId, viewport) : [],
      asintotas: [],
    };
  }
}

/** Copia de una rama desplazada k·período en y (misma x, mismo `parametro`). */
function trasladarY(r: Rama, dy: number): Rama {
  if (dy === 0) return r;
  const p = r.puntos;
  const q = new Float64Array(p.length);
  for (let i = 0; i < p.length; i += 2) { q[i] = p[i]; q[i + 1] = p[i + 1] + dy; }
  return { puntos: q, cerrada: r.cerrada, calidad: r.calidad, objetoId: r.objetoId, parametro: r.parametro };
}
