// ─────────────────────────────────────────────
// Lenguaje común · Oráculos numéricos
// ─────────────────────────────────────────────
//
// Un "oráculo" es la frontera donde una EXPRESIÓN matemática se convierte en una
// FUNCIÓN numérica evaluable. Es la abstracción que aísla a todo el motor de
// mathjs: el trazador y el descubridor consumen estos oráculos y NO saben que por
// debajo hay mathjs (o, en el futuro, autodiferenciación o aritmética de
// intervalos). Reemplazar el backend de evaluación = reimplementar estos
// oráculos, sin tocar geometría ni render.

/**
 * Campo escalar F(x,y). Un valor no finito (NaN/±Infinity) significa "fuera del
 * dominio real" (complejo, polo, raíz de negativo…), que el descubridor y el
 * trazador tratan como ausencia de curva en ese punto.
 */
export interface CampoEscalar {
  eval(x: number, y: number): number;
  /**
   * Gradiente analítico (∂F/∂x, ∂F/∂y) si el backend puede darlo (autodiff o
   * simbólico). Opcional: si falta, el consumidor usa diferencias finitas. Tener
   * el gradiente mejora la proyección/continuación y la detección de
   * singularidades (donde ∇F≈0).
   */
  gradiente?(x: number, y: number): readonly [number, number];
}

/** Función real y = f(x) para el caso explícito (el "GraphEngine" de siempre). */
export interface FuncionReal {
  eval(x: number): number;
}

/**
 * Parametrización p(t) = (x(t), y(t)). Sirve por igual a curvas paramétricas y
 * polares (una polar r=g(θ) es la paramétrica x=g(θ)cosθ, y=g(θ)sinθ). El
 * trazado de paramétricas/polares NO necesita descubrimiento: el parámetro ya
 * está dado, así que van directas al trazador 1D.
 */
export interface Parametrizacion {
  eval(t: number): import("./geometria").Punto;
  readonly dominio: readonly [number, number];
  /** ¿El recorrido es periódico (cerrar el lazo al volver al inicio)? */
  readonly periodica?: boolean;
}
