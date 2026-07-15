// ─────────────────────────────────────────────
// Lenguaje común · Trazado (geometría de calidad)
// ─────────────────────────────────────────────
//
// El trazador convierte "dónde está la curva" (semillas) en "cómo se ve" (ramas
// suaves a ε-pantalla). Es el PRIMITIVO GEOMÉTRICO universal del motor. Su
// criterio de refinamiento es SIEMPRE el error en píxeles del Contrato de
// Calidad → todas las ramas, vengan de donde vengan, comparten firma visual.
//
// PLUGGABLE por tipo de primitivo:
//   • TrazadorExplicito   — muestreo 1D adaptativo en x (el sampler de obs-graph).
//   • TrazadorParametrico — muestreo 1D adaptativo en t (sirve a polares también).
//   • TrazadorContinuacion— predictor-corrector por arco para implícitas.
// Todos implementan la misma interfaz y devuelven el mismo tipo `Rama`.

import type { Rama, Asintota } from "./geometria";
import type { CampoEscalar, FuncionReal, Parametrizacion } from "./oraculos";
import type { Viewport, Tolerancia } from "./viewport";
import type { Semilla, Singularidad } from "./descubrimiento";

/**
 * Salida del trazador explícito: las ramas continuas + las asíntotas verticales
 * que el muestreo detectó como subproducto (las necesita para refinar cerca de
 * los polos). El proveedor las traslada a `Geometria.asintotas` para que el
 * overlay las dibuje. Otras estrategias (paramétrica, continuación) tienen su
 * propia salida natural; por eso cada interfaz de trazador es independiente.
 */
export interface ResultadoTrazadoExplicito {
  readonly ramas: readonly Rama[];
  readonly asintotas: readonly Asintota[];
}

/** Traza una función explícita y=f(x) muestreando en x (parámetro extrínseco). */
export interface TrazadorExplicito {
  trazar(
    f: FuncionReal,
    objetoId: string,
    viewport: Viewport,
    tolerancia: Tolerancia
  ): ResultadoTrazadoExplicito;
}

/** Traza una parametrización (x(t),y(t)) muestreando en t. */
export interface TrazadorParametrico {
  trazar(
    p: Parametrizacion,
    objetoId: string,
    viewport: Viewport,
    tolerancia: Tolerancia
  ): readonly Rama[];
}

/**
 * Traza una curva implícita F=0 por continuación a partir de semillas. Recibe las
 * singularidades para tratarlas como zonas de "no confiar en la tangente". El
 * parámetro intrínseco de las ramas resultantes es la longitud de arco.
 */
export interface TrazadorContinuacion {
  trazar(
    F: CampoEscalar,
    objetoId: string,
    semillas: readonly Semilla[],
    singularidades: readonly Singularidad[],
    viewport: Viewport,
    tolerancia: Tolerancia
  ): readonly Rama[];
}
