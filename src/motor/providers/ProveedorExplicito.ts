// ─────────────────────────────────────────────
// providers · ProveedorExplicito (el "GraphEngine" como un proveedor más)
// ─────────────────────────────────────────────
//
// Implementa la costura universal `ProveedorGeometria` para el caso y=f(x).
// Recibe el `ObjetoExplicito` (modelo: id + oráculo f + hechos) y un
// `TrazadorExplicito` (estrategia), ambos inyectados. NO usa descubrimiento: una
// explícita va directa al trazador 1D. NO conoce mathjs ni WebGL. Reemplazar el
// algoritmo de trazado = inyectar otro TrazadorExplicito, sin tocar esta clase.

import type {
  ProveedorGeometria,
  TrazadorExplicito,
  ObjetoExplicito,
  Viewport,
  Tolerancia,
  Geometria,
} from "../contracts";
import { analizarPuntosNotables } from "../analysis/puntosNotablesDeRama";
import { girarGeometria } from "./ProveedorImplicitoSeparable";
import { crearViewport } from "../scene/viewport-utils";

export class ProveedorExplicito implements ProveedorGeometria {
  public readonly objetoId: string;

  constructor(
    private readonly objeto: ObjetoExplicito,
    private readonly trazador: TrazadorExplicito
  ) {
    this.objetoId = objeto.id;
  }

  geometria(viewport: Viewport, tolerancia: Tolerancia): Geometria {
    // Salida en X (componente `x(t)=…`): el VALOR de f es la abscisa y la variable
    // independiente ocupa el eje vertical → la MISMA curva, tumbada. Se traza en el mundo
    // TRANSPUESTO (donde vuelve a ser la explícita de siempre, con todo su sampler adaptativo
    // y su corte en polos) y se giran las coordenadas a la salida. Mismo truco que la
    // separable transpuesta (tan(y)+x=5); así se cubre el alto VISIBLE entero, en vez de un
    // dominio fijo del parámetro.
    if (this.objeto.salida === "x") {
      const vpT = crearViewport(
        viewport.domY, viewport.domX, viewport.altoPx, viewport.anchoPx, viewport.dpr
      );
      return girarGeometria(this.geometriaEnEjePropio(vpT, tolerancia), this.objetoId, tolerancia);
    }
    return this.geometriaEnEjePropio(viewport, tolerancia);
  }

  private geometriaEnEjePropio(viewport: Viewport, tolerancia: Tolerancia): Geometria {
    const { ramas, asintotas } = this.trazador.trazar(
      this.objeto.f, this.objeto.id, viewport, tolerancia
    );
    // Estrategia de dos pasadas (igual que GraphEngine): las extras —puntos
    // notables y asíntotas— solo se calculan/exponen en la pasada FINAL. Durante
    // un gesto (pasada "interactiva") se omiten para que sea rápida; reaparecen al
    // asentarse la cámara.
    const esFinal = tolerancia.pasada === "final";
    const puntosNotables = esFinal ? analizarPuntosNotables(ramas, this.objeto.id, viewport) : [];
    return {
      ramas,
      singularidades: [],
      puntosNotables,
      asintotas: esFinal ? asintotas : [],
    };
  }
}
