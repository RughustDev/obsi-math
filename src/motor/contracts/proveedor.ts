// ─────────────────────────────────────────────
// Lenguaje común · Proveedor de geometría (LA COSTURA UNIVERSAL)
// ─────────────────────────────────────────────
//
// Esta es la interfaz central del motor. Un ProveedorGeometria sabe producir la
// `Geometria` de UN objeto matemático para un viewport y una tolerancia dados.
// Es la única costura que el orquestador (Scene) y, a través de él, el render
// necesitan conocer.
//
// CLAVE ARQUITECTÓNICA: NO hay un pipeline lineal fijo "descubrir→trazar→render"
// impuesto a todos. Eso era pensamiento centrado en implícitas. La realidad:
//   • ProveedorExplicito   → usa SOLO un TrazadorExplicito (sin descubrimiento).
//   • ProveedorParametrico → usa SOLO un TrazadorParametrico.
//   • ProveedorPolar       → idem.
//   • ProveedorImplicito   → usa EstrategiaDescubrimiento + TrazadorContinuacion.
//   • ProveedorRegion      → usa el descubrimiento como clasificación de celdas.
//   • ProveedorSistema     → compone varios proveedores.
//
// Es decir, descubrimiento y trazado son COLABORADORES INTERNOS de algunos
// proveedores, no etapas globales obligatorias. Esto hace que "GraphEngine" sea
// literalmente un ProveedorGeometria más entre iguales, todos detrás de la misma
// interfaz, alimentando el mismo renderizador.

import type { Geometria } from "./geometria";
import type { Viewport, Tolerancia } from "./viewport";

export interface ProveedorGeometria {
  /** Id del objeto que este proveedor representa (para estilo/selección). */
  readonly objetoId: string;

  /**
   * Produce la geometría para este viewport y tolerancia. Debe ser DETERMINISTA
   * por (objeto, región de mundo, tolerancia): la geometría no puede depender del
   * encuadre de la cámara, solo de qué región del mundo se ve y a qué resolución
   * (invarianza de cámara → estabilidad en pan; el zoom cambia la resolución).
   * Una implementación puede cachear internamente por banda de escala.
   */
  geometria(viewport: Viewport, tolerancia: Tolerancia): Geometria;
}
