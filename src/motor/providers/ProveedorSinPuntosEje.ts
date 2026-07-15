// ─────────────────────────────────────────────
// providers · ProveedorSinPuntosEje (oculta los puntos notables sobre los ejes — DECORADOR)
// ─────────────────────────────────────────────
//
// Envuelve CUALQUIER ProveedorGeometria y elimina de la geometría los puntos notables
// que caen SOBRE los ejes del plano: las raíces (cruce con el eje X, y=0) y la
// intersección con el eje Y (x=0). Los vértices (máx/mín) y todo lo demás se conservan.
//
// POR QUÉ y DÓNDE: en el bloque `obs-system` (varias curvas) esas marcas de cruce con
// los ejes saturan el plano y aportan poco frente a los CRUCES ENTRE CURVAS (que se
// pintan aparte, en Escena.dibujarIntersecciones). Es una política de PRESENTACIÓN del
// sistema, así que —como ProveedorConCache— vive como decorador y se compone SOLO en el
// composition root (crearMotorSistema); `obs-graph` no lo usa y mantiene sus puntos.

import type {
  ProveedorGeometria,
  Viewport,
  Tolerancia,
  Geometria,
} from "../contracts";

export class ProveedorSinPuntosEje implements ProveedorGeometria {
  public readonly objetoId: string;

  constructor(private readonly interno: ProveedorGeometria) {
    this.objetoId = interno.objetoId;
  }

  geometria(viewport: Viewport, tolerancia: Tolerancia): Geometria {
    const g = this.interno.geometria(viewport, tolerancia);
    return {
      ...g,
      puntosNotables: g.puntosNotables.filter(
        (pn) => pn.tipo !== "raiz" && pn.tipo !== "interseccion-y"
      ),
    };
  }
}
