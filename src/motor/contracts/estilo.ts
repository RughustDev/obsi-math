// ─────────────────────────────────────────────
// Lenguaje común · Estilo (preocupación PURA de render)
// ─────────────────────────────────────────────
//
// El estilo es lo único que separa "qué dibujar" (Geometria, en mundo) de "cómo
// se ve pintado" (color, grosor). Se mantiene APARTE de la geometría a propósito:
// la misma rama puede repintarse con otro color sin recalcular geometría, y el
// trazador/descubridor nunca tienen que saber de colores.

export interface Estilo {
  /** Color RGBA normalizado [0..1] (formato directo para WebGL). */
  readonly color: readonly [number, number, number, number];
  /** Grosor del trazo en píxeles (constante a cualquier zoom). */
  readonly grosorPx: number;
  /** Patrón de guiones en píxeles (p.ej. [4,6]); vacío = línea continua. */
  readonly guiones?: readonly number[];
  /** Relleno para regiones/inecuaciones (color con alfa bajo). */
  readonly relleno?: readonly [number, number, number, number];
}
