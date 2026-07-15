// ─────────────────────────────────────────────
// providers · ProveedorConCache (memoización de geometría — DECORADOR)
// ─────────────────────────────────────────────
//
// Envuelve CUALQUIER ProveedorGeometria y memoiza su último resultado. Reutiliza la
// estrategia del GraphEngine: la geometría es función PURA de (región de mundo,
// resolución, tolerancia) —el contrato lo exige: "la geometría no puede depender
// del encuadre de la cámara, solo de qué región del mundo se ve y a qué resolución"—
// así que mientras esa firma no cambie, el trazado anterior sigue siendo válido y se
// devuelve tal cual, SIN volver a muestrear.
//
// Por qué un decorador y no lógica dentro de cada proveedor:
//   • Un solo lugar: explícitas, implícitas, paramétricas… se cachean igual.
//   • Cero acoplamiento: el proveedor interno no sabe que existe la caché; la Escena,
//     el render y la interacción tampoco. Solo se compone en el composition root.
//   • Respeta la costura: implementa la MISMA interfaz ProveedorGeometria, es
//     "un proveedor más" para todo lo de arriba.
//
// QUÉ SE CACHEA: la última `Geometria` producida (ramas + asíntotas + puntos
// notables), junto con la firma de las entradas que la determinan.
//
// CUÁNDO SE INVALIDA: automáticamente, en cuanto la firma de entrada difiere de la
// cacheada — es decir, cuando cambia la REGIÓN visible (domX/domY: pan o zoom), la
// RESOLUCIÓN (anchoPx/altoPx) o la TOLERANCIA (pasada interactiva↔final, ε, paso).
// Un cambio de FUNCIÓN reconstruye el motor entero (nuevo proveedor → nueva caché),
// así que no necesita una firma propia. El movimiento del cursor, el crosshair y el
// carril NO tocan estas entradas → nunca invalidan → nunca retrazan.
//
// ALCANCE (honesto): es una caché de UNA entrada (el último frame). Evita el
// retrazado redundante cuando se pide dos veces la MISMA vista (p.ej. repintar tras
// mover el cursor, o un actualizar idéntico). Durante un gesto continuo de pan/zoom
// cada frame es una región distinta → fallo de caché por diseño, igual que el
// GraphEngine. La caché por BANDA DE ESCALA (muestrear una región mayor que la
// vista para que pans pequeños caigan dentro) es la mejora de la Fase F; aquí no se
// adelanta para no inventar un sistema distinto del que ya usa el motor original.

import type {
  ProveedorGeometria,
  Viewport,
  Tolerancia,
  Geometria,
} from "../contracts";

/**
 * Firma de las entradas que DETERMINAN la geometría. Incluye la región de mundo
 * (domX/domY), la resolución (anchoPx/altoPx) y la tolerancia (pasada + métricas).
 * Deliberadamente NO incluye el dpr (no afecta al muestreo en px CSS) ni nada del
 * encuadre de cámara ajeno a la región.
 */
function firma(vp: Viewport, t: Tolerancia): string {
  return (
    `${vp.domX[0]}|${vp.domX[1]}|${vp.domY[0]}|${vp.domY[1]}|` +
    `${vp.anchoPx}|${vp.altoPx}|${t.pasada}|${t.desviacionMaxPx}|${t.pasoMaxPx}`
  );
}

export class ProveedorConCache implements ProveedorGeometria {
  public readonly objetoId: string;

  private claveCache: string | null = null;
  private geometriaCache: Geometria | null = null;

  constructor(private readonly interno: ProveedorGeometria) {
    this.objetoId = interno.objetoId;
  }

  geometria(viewport: Viewport, tolerancia: Tolerancia): Geometria {
    const clave = firma(viewport, tolerancia);
    if (clave === this.claveCache && this.geometriaCache !== null) {
      return this.geometriaCache; // ACIERTO: misma vista → cero retrazado.
    }
    const g = this.interno.geometria(viewport, tolerancia);
    this.claveCache = clave;
    this.geometriaCache = g;
    return g;
  }
}
