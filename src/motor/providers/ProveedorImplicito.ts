// ─────────────────────────────────────────────
// providers · ProveedorImplicito (F(x,y)=0 por descubrimiento + continuación)
// ─────────────────────────────────────────────
//
// Implementa la costura universal `ProveedorGeometria` para curvas implícitas.
// A diferencia del explícito, SÍ usa descubrimiento (para localizar las
// componentes) y un trazador por continuación (para seguirlas). Ambos son
// colaboradores internos inyectados: cambiar el descubridor (p.ej. a intervalos)
// o el trazador no toca esta clase. NO conoce mathjs ni WebGL.
//
// PUNTOS NOTABLES INVARIANTES: la geometría se traza por continuación, pero los
// puntos notables se calculan DESPEJANDO y=f(x) (`despejarRamas`, si F = a·yⁿ+c(x))
// y aplicando el MISMO análisis que las explícitas, así `x³+y³=9` da los mismos
// puntos que `y=∛(9−x³)`. Solo si el despeje no es posible se quedan vacíos (el
// análisis implícito directo no está implementado). Requiere un TrazadorExplicito
// para muestrear las ramas despejadas (solo en la pasada final).

import type {
  ProveedorGeometria,
  EstrategiaDescubrimiento,
  TrazadorContinuacion,
  TrazadorExplicito,
  ObjetoImplicito,
  Viewport,
  Tolerancia,
  Geometria,
  Rama,
  PuntoNotable,
} from "../contracts";
import { despejarRamas } from "../analysis/separarImplicita";
import { analizarPuntosNotables } from "../analysis/puntosNotablesDeRama";

export class ProveedorImplicito implements ProveedorGeometria {
  public readonly objetoId: string;

  constructor(
    private readonly objeto: ObjetoImplicito,
    private readonly descubrimiento: EstrategiaDescubrimiento,
    private readonly trazador: TrazadorContinuacion,
    private readonly trazadorExplicito: TrazadorExplicito
  ) {
    this.objetoId = objeto.id;
  }

  geometria(viewport: Viewport, tolerancia: Tolerancia): Geometria {
    const { semillas, singularidades } = this.descubrimiento.descubrir(
      this.objeto.F, viewport, tolerancia
    );
    const ramas = this.trazador.trazar(
      this.objeto.F, this.objeto.id, semillas, singularidades, viewport, tolerancia
    );
    // Extras (puntos notables) solo en la pasada final, como el resto de proveedores.
    const esFinal = tolerancia.pasada === "final";
    return {
      ramas: parametrizarMonotonasEnX(ramas),
      singularidades: [],
      puntosNotables: esFinal ? this.puntosNotablesPorDespeje(viewport, tolerancia) : [],
      asintotas: [],
    };
  }

  /**
   * Puntos notables por DESPEJE: si F = a·yⁿ + c(x) se despeja a 1–2 ramas y=f(x)
   * (`despejarRamas`), se muestrean con el sampler explícito y se analizan con el
   * MISMO `analizarPuntosNotables` que las explícitas → puntos INVARIANTES respecto a
   * la forma despejada equivalente. Si no se puede despejar, vacío (sin análisis
   * implícito directo). Las ramas muestreadas son EFÍMERAS: solo para el análisis, la
   * geometría dibujada sigue siendo la de continuación.
   */
  private puntosNotablesPorDespeje(viewport: Viewport, tolerancia: Tolerancia): PuntoNotable[] {
    const ramasExplicitas = despejarRamas(this.objeto.F);
    if (!ramasExplicitas) return [];
    const ramas: Rama[] = [];
    for (const f of ramasExplicitas)
      for (const r of this.trazadorExplicito.trazar(f, this.objeto.id, viewport, tolerancia).ramas)
        ramas.push(r);
    return analizarPuntosNotables(ramas, this.objeto.id, viewport);
  }
}

/**
 * La continuación parametriza por ARCO, así que sus ramas no llevan el `parametro`=x
 * que `yEnRamas` (crosshair/carril) necesita. Aquí se adjunta a las ramas cuya x es
 * ESTRICTAMENTE monótona —una función de x: recta (x+y=0), y=∛x…—, reorientándolas a
 * x creciente. Las que se PLIEGAN en x (círculo x²+y²=9, parábola x=y², cónicas
 * cerradas) se dejan SIN `parametro`: no son función de x y no deben ser recorribles.
 * Es la única vía por la que una implícita función-de-x se vuelve recorrible (las
 * separables en y ya vienen con `parametro` del sampler; las transpuestas x=g(y), NO,
 * a propósito). El plegado sí se preserva como geometría; solo cambia la parametrización.
 */
function parametrizarMonotonasEnX(ramas: readonly Rama[]): Rama[] {
  return ramas.map((r) => {
    const p = r.puntos;
    const n = p.length / 2;
    if (n < 2) return r;
    let creciente = true, decreciente = true;
    for (let i = 1; i < n; i++) {
      const xa = p[(i - 1) * 2], xb = p[i * 2];
      if (!(xb > xa)) creciente = false;
      if (!(xb < xa)) decreciente = false;
    }
    if (!creciente && !decreciente) return r; // se pliega en x → no es función de x
    const puntos = decreciente ? invertirPolilinea(p) : p;
    const parametro = new Float64Array(n);
    for (let i = 0; i < n; i++) parametro[i] = puntos[i * 2];
    return { ...r, puntos, parametro };
  });
}

/** Invierte el orden de los vértices de una polilínea (x decreciente → creciente). */
function invertirPolilinea(p: Float64Array): Float64Array {
  const n = p.length / 2;
  const q = new Float64Array(p.length);
  for (let i = 0; i < n; i++) {
    q[i * 2] = p[(n - 1 - i) * 2];
    q[i * 2 + 1] = p[(n - 1 - i) * 2 + 1];
  }
  return q;
}
