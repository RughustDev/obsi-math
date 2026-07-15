// ─────────────────────────────────────────────
// providers · ProveedorParametrico (paramétricas Y polares)
// ─────────────────────────────────────────────
//
// Implementa la costura universal `ProveedorGeometria` para objetos definidos por
// una `Parametrizacion` p(t). Sirve a AMBOS tipos —paramétrica y polar— porque el
// contrato define `ObjetoPolar.p` como una parametrización YA cartesiana (la
// conversión r→(x,y) la hizo `fields`); aquí no hay diferencia entre uno y otro.
// NO usa descubrimiento (el parámetro ya está dado): va directo al trazador 1D en
// t. NO conoce mathjs ni Canvas. Reemplazar el algoritmo de trazado = inyectar otro
// `TrazadorParametrico`, sin tocar esta clase.
//
// No expone puntos notables ni asíntotas: son conceptos centrados en x (raíces,
// extremos en y, intersección-Y) que no aplican a una curva no funcional. (Las
// intersecciones con ejes por parámetro serían una mejora futura.)

import type {
  ProveedorGeometria,
  TrazadorParametrico,
  ObjetoParametrico,
  ObjetoPolar,
  Viewport,
  Tolerancia,
  Geometria,
} from "../contracts";

export class ProveedorParametrico implements ProveedorGeometria {
  public readonly objetoId: string;

  constructor(
    private readonly objeto: ObjetoParametrico | ObjetoPolar,
    private readonly trazador: TrazadorParametrico
  ) {
    this.objetoId = objeto.id;
  }

  geometria(viewport: Viewport, tolerancia: Tolerancia): Geometria {
    const ramas = this.trazador.trazar(this.objeto.p, this.objeto.id, viewport, tolerancia);
    return { ramas, singularidades: [], puntosNotables: [], asintotas: [] };
  }
}
