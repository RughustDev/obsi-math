// ─────────────────────────────────────────────
// Lenguaje común · Geometría
// ─────────────────────────────────────────────
//
// Tipos puros (sin lógica) que describen el RESULTADO geométrico que produce
// CUALQUIER objeto matemático del motor: explícito, implícito, paramétrico,
// polar, sistema o región. La regla de oro de toda la arquitectura:
//
//   El renderizador y la interacción solo conocen estos tipos.
//   NUNCA conocen qué algoritmo (sampler, continuación, intervalos…) los produjo.
//
// Si dos estrategias distintas emiten la misma `Rama`, el resultado en pantalla
// es idéntico por construcción → "no se nota la estrategia".

/** Punto en coordenadas de MUNDO (no de pantalla). */
export interface Punto {
  readonly x: number;
  readonly y: number;
}

/**
 * Polilínea como coordenadas de mundo INTERCALADAS: [x0,y0, x1,y1, …].
 * Longitud siempre par. Se usa Float64Array (no Punto[]) porque una rama puede
 * tener decenas de miles de vértices y este es el formato que el empaquetado a
 * WebGL y el trazador adaptativo consumen sin coste de objetos intermedios.
 */
export type Polilinea = Float64Array;

/**
 * Grado de confianza geométrica/topológica de una rama. Permite que el motor
 * sea "best-effort certificado": entrega lo mejor que pudo probar y marca lo que
 * no pudo, en vez de prometer una garantía dura imposible en tiempo real.
 */
export type CalidadRama = "exacta" | "best-effort" | "incierta";

/**
 * RAMA: pieza CONEXA de curva, trazada como polilínea ordenada en mundo. Es la
 * unidad atómica de salida del motor. TODO objeto (incluida una y=f(x)) termina
 * produciendo un conjunto de ramas; esa es la unificación.
 */
export interface Rama {
  readonly puntos: Polilinea;
  /** ¿La rama es un lazo cerrado (último punto ≈ primero)? */
  readonly cerrada: boolean;
  readonly calidad: CalidadRama;
  /** Id del ObjetoMatematico al que pertenece (para color/estilo y selección). */
  readonly objetoId: string;
  /**
   * Muestras del parámetro INTRÍNSECO alineadas 1:1 con cada punto (x en
   * explícitas, t en paramétricas, longitud de arco en implícitas). Opcional:
   * habilita carril/navegación por la curva sin re-resolver geometría.
   */
  readonly parametro?: Float64Array;
}

/** Asíntota vertical/horizontal/oblicua detectada (se dibuja punteada aparte). */
export interface Asintota {
  readonly tipo: "vertical" | "horizontal" | "oblicua";
  /** Para vertical: x. Horizontal: y. Oblicua: y = m·x + b → [m, b]. */
  readonly valor: number | readonly [number, number];
}

/** Punto destacado para el overlay/interacción (raíz, vértice, intersección…). */
export interface PuntoNotable {
  readonly punto: Punto;
  readonly tipo: "raiz" | "vertice" | "interseccion" | "interseccion-y" | "otro";
  readonly objetoId: string;
}

/**
 * GEOMETRÍA: realización geométrica COMPLETA de un objeto para un viewport dado.
 * Es exactamente lo que recibe el renderizador. No contiene nada de píxeles ni
 * de estilo: solo el "qué" geométrico en coordenadas de mundo.
 */
export interface Geometria {
  readonly ramas: readonly Rama[];
  readonly singularidades: readonly Singularidad[];
  readonly puntosNotables: readonly PuntoNotable[];
  readonly asintotas: readonly Asintota[];
}

// Re-exportado desde descubrimiento.ts para que Geometria sea autocontenida sin
// crear un ciclo (la definición canónica vive en descubrimiento.ts).
import type { Singularidad } from "./descubrimiento";
export type { Singularidad };
