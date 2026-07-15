// ─────────────────────────────────────────────
// providers · ProveedorUnion (varias expresiones, UN objeto — COMPOSITOR)
// ─────────────────────────────────────────────
//
// Presenta VARIOS proveedores como UNO SOLO: concatena sus geometrías (ramas, asíntotas,
// puntos notables, singularidades) bajo un único `objetoId`. La escena, el render y la
// interacción no notan nada — siguen viendo un objeto con sus ramas, como manda la costura
// universal ("no se nota la estrategia").
//
// POR QUÉ existe: el doble signo. `y = ±√(4−x²)` es UNA curva escrita (un color, una
// selección de carril, una entrada del panel) pero DOS funciones (`motor/parsing/dobleSigno`).
// Sin este compositor habría que elegir entre graficar media curva o convertir la familia en
// dos objetos de escena distintos —dos colores, dos curvas en el selector, cruces "entre
// curvas" espurios entre las dos mitades de la misma circunferencia—.
//
// Es un COMPOSITOR, no un decorador: no altera la geometría de nadie, solo la suma. Se
// compone en el composition root, dentro de la caché (una sola entrada por vista).

import type { ProveedorGeometria, Viewport, Tolerancia, Geometria } from "../contracts";

export class ProveedorUnion implements ProveedorGeometria {
  constructor(
    public readonly objetoId: string,
    private readonly internos: readonly ProveedorGeometria[]
  ) {}

  geometria(viewport: Viewport, tolerancia: Tolerancia): Geometria {
    const gs = this.internos.map((p) => p.geometria(viewport, tolerancia));
    return {
      ramas: gs.flatMap((g) => g.ramas),
      singularidades: gs.flatMap((g) => g.singularidades),
      puntosNotables: gs.flatMap((g) => g.puntosNotables),
      asintotas: gs.flatMap((g) => g.asintotas),
    };
  }
}
