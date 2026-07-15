// ─────────────────────────────────────────────
// Lenguaje común · Viewport y Tolerancia
// ─────────────────────────────────────────────
//
// El Viewport es un VALUE OBJECT INMUTABLE: una fotografía del estado de la
// cámara en un instante. La interacción es la única dueña del estado mutable de
// cámara; cuando hay que producir geometría, toma una foto inmutable y la pasa
// hacia abajo. Esto evita que dos pasadas (interactiva/final) compitan por un
// mismo objeto mutable (causa clásica de parpadeos y carreras).

/** Fotografía inmutable de la cámara. Todo lo demás se deriva de aquí. */
export interface Viewport {
  /** Rango de mundo visible en X: [min, max]. */
  readonly domX: readonly [number, number];
  /** Rango de mundo visible en Y: [min, max]. */
  readonly domY: readonly [number, number];
  /** Ancho del lienzo en píxeles CSS. */
  readonly anchoPx: number;
  /** Alto del lienzo en píxeles CSS. */
  readonly altoPx: number;
  /** devicePixelRatio (resolución física = px · dpr). */
  readonly dpr: number;
}

/**
 * CONTRATO DE CALIDAD: la métrica ÚNICA a la que toda estrategia debe refinar.
 * Que todas compartan esta tolerancia, medida igual (desviación en PÍXELES), es
 * lo que hace que sus salidas sean indistinguibles. La métrica objetivo es de
 * tipo Fréchet en espacio de pantalla (no Hausdorff): controla el recorrido, no
 * solo la cercanía, así que también garantiza suavidad visual.
 */
export interface Tolerancia {
  /** ε: desviación máxima de la cuerda respecto a la curva real, en píxeles. */
  readonly desviacionMaxPx: number;
  /** Cota superior de separación entre muestras consecutivas, en píxeles. */
  readonly pasoMaxPx: number;
  /**
   * Presupuesto de la pasada. "interactiva" = durante un gesto (rápida, menos
   * profunda); "final" = al asentarse (máxima calidad). Misma geometría objetivo,
   * distinto presupuesto de tiempo.
   */
  readonly pasada: "interactiva" | "final";
}

// NOTA DE DISEÑO: las funciones de mapeo mundo↔pantalla (sx/sy, mundoPorPixel,
// generación de ticks) NO viven aquí. contracts/ es solo tipos, sin lógica. Esos
// helpers son utilidades puras y vivirán en scene/ (o un módulo geometria-utils),
// para que el paquete de contratos no tenga ninguna implementación que mantener.
