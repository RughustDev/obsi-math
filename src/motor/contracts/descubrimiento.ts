// ─────────────────────────────────────────────
// Lenguaje común · Descubrimiento (topología y semillas)
// ─────────────────────────────────────────────
//
// El descubrimiento responde a "¿DÓNDE está la curva y qué forma tiene?", SIN
// dibujarla con calidad. Es un colaborador INTERNO del proveedor de implícitas:
// las explícitas/paramétricas/polares NO lo necesitan (su parámetro ya está dado).
//
// Es el punto ENCHUFABLE más importante del motor. La implementación por defecto
// será muestreo adaptativo (quadtree); un upgrade futuro será aritmética de
// intervalos (estilo Plantinga–Vegter) DETRÁS DE ESTA MISMA INTERFAZ, sin que el
// trazador ni el render se enteren. La certificación es una evolución, no un
// cimiento obligatorio.

import type { Punto } from "./geometria";
import type { CampoEscalar } from "./oraculos";
import type { Viewport, Tolerancia } from "./viewport";

/** Semilla: punto que se sabe (o casi) sobre la curva, con datos locales. */
export interface Semilla {
  readonly punto: Punto;
  /** Dirección tangente estimada (para arrancar la continuación), si se conoce. */
  readonly tangente?: readonly [number, number];
  /** 0..1 — cuán seguro está el descubridor de que hay curva aquí. */
  readonly confianza: number;
}

/**
 * Singularidad: ENTORNO donde la curva deja de ser una variedad suave (nodo,
 * cúspide, punto aislado, cruce). Se describe como un punto + un radio de
 * entorno donde el trazador NO debe confiar en la tangente y debe pedir
 * resolución local. La clasificación es best-effort; `confianza` lo refleja.
 */
export interface Singularidad {
  readonly punto: Punto;
  readonly radio: number;
  readonly clase: "nodo" | "cuspide" | "aislado" | "desconocida";
  readonly confianza: number;
}

export interface ResultadoDescubrimiento {
  /** Al menos una semilla por componente conexa visible. */
  readonly semillas: readonly Semilla[];
  readonly singularidades: readonly Singularidad[];
}

/**
 * Estrategia de descubrimiento. PLUGGABLE: muestreada (por defecto) o certificada
 * (futuro). El contrato es estable; la garantía que ofrece cada implementación se
 * refleja en `confianza` y, aguas abajo, en la `CalidadRama` de las ramas.
 */
export interface EstrategiaDescubrimiento {
  descubrir(
    F: CampoEscalar,
    viewport: Viewport,
    tolerancia: Tolerancia
  ): ResultadoDescubrimiento;
}
