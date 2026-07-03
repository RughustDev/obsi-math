// ─────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────

export const FUNCIONES_TRIG = ["sin", "cos", "tan", "sec", "csc", "cot"] as const;
export const FUNCIONES_LATEX = "sin|cos|tan|sec|csc|cot|log|ln";

// Trigonométricas inversas que MathJS NO trae nativas. Se inyectan en el scope
// de evaluación como wrappers de dominio real:
//   acsc(x)=asin(1/x)   asec(x)=acos(1/x)   acot(x)=pi/2 - atan(x)
// acsc/asec usan Math.* para devolver NaN —no un complejo— fuera del dominio,
// que es lo que el motor de curvas ya filtra con Number.isFinite.
// acot usa la convención CONTINUA de rango (0, π) —la de Desmos/cálculo—, no
// atan(1/x): esta última salta de +π/2 a −π/2 en x=0. pi/2-atan(x) decrece sin
// cortes de π (en −∞) a 0 (en +∞), pasando por π/2 en x=0.
export const FUNCIONES_INVERSAS_EXTRA = {
  acsc: (x: number) => Math.asin(1 / x),
  asec: (x: number) => Math.acos(1 / x),
  acot: (x: number) => Math.PI / 2 - Math.atan(x),
};
