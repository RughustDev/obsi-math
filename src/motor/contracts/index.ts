// ─────────────────────────────────────────────
// Paquete de CONTRATOS del motor gráfico general
// ─────────────────────────────────────────────
//
// Ring 0 de la arquitectura: SOLO tipos e interfaces, CERO lógica, CERO
// dependencias (ni mathjs, ni Obsidian, ni WebGL). Todos los demás módulos
// dependen de este paquete; este paquete no depende de ninguno. Es el "lenguaje
// común" (ubiquitous language) sobre el que se construye el motor entero.
//
// Barril de re-exportación para que el resto del código importe desde
// "motor/contracts" en vez de archivos sueltos.

export type { Punto, Polilinea, CalidadRama, Rama, Asintota, PuntoNotable, Geometria } from "./geometria";
export type { Viewport, Tolerancia } from "./viewport";
export type { CampoEscalar, FuncionReal, Parametrizacion } from "./oraculos";
export type {
  TipoObjeto, HechosSimbolicos, ObjetoBase,
  ObjetoExplicito, ObjetoImplicito, ObjetoParametrico,
  ObjetoPolar, ObjetoRelacion, ObjetoSistema, ObjetoMatematico,
} from "./modelo";
export type {
  Semilla, Singularidad, ResultadoDescubrimiento, EstrategiaDescubrimiento,
} from "./descubrimiento";
export type {
  ResultadoTrazadoExplicito,
  TrazadorExplicito, TrazadorParametrico, TrazadorContinuacion,
} from "./trazado";
export type { ProveedorGeometria } from "./proveedor";
export type { Estilo } from "./estilo";
