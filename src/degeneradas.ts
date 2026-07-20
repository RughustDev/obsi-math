// ─────────────────────────────────────────────
// Clasificación de funciones degeneradas (no graficables)
// ─────────────────────────────────────────────

export interface FuncionDegenerada { etiqueta: string; detalle: string }

/**
 * Detecta funciones que NO son graficables en ℝ porque no toman ningún valor
 * real, y las clasifica formalmente. Muestrea un rango amplio (para no marcar
 * por error una función definida sólo lejos del origen, p.ej. sqrt(x-500)) más
 * un tramo fino central. Si aparece algún valor real → es graficable (null).
 *
 * Sin valores reales, se distingue por qué:
 *   - algún ±∞ (división por cero, p.ej. log en base 1: ln(x)/ln(1)) → Indefinida
 *   - algún valor complejo (p.ej. sqrt(-1))                          → No definida en ℝ
 *   - sólo NaN (forma indeterminada, p.ej. 0/0)                      → Indeterminada
 *
 * Bonus: evita el motor de curva en estos casos, que de otro modo dibujaba
 * asíntotas falsas (las transiciones a ±∞ de log en base 1 se tomaban por polos).
 */
export function clasificarDegenerada(
  evaluar: (x: number) => unknown
): FuncionDegenerada | null {
  let reales = 0, infinitos = 0, complejos = 0; // (los NaN son el resto)

  const muestra = (x: number) => {
    const v = evaluar(x);
    if (typeof v === "number") {
      if (Number.isFinite(v)) reales++;
      else if (v === Infinity || v === -Infinity) infinitos++;
      // NaN: no se cuenta (es el caso por defecto)
    } else if (v && typeof v === "object" && typeof (v as { im?: unknown }).im === "number") {
      complejos++;
    }
  };

  for (let i = 0; i <= 500; i++) muestra(-1000 + (2000 * i) / 500); // rango amplio
  for (let i = 0; i <= 200; i++) muestra(-10 + (20 * i) / 200);     // detalle central

  if (reales > 0) return null; // graficable

  if (infinitos > 0)
    return {
      etiqueta: "Indefinida",
      detalle: "La expresión no está definida en ℝ.",
    };
  if (complejos > 0)
    return {
      etiqueta: "No definida en ℝ",
      detalle: "La expresión produce valores complejos y no puede representarse en el plano real.",
    };
  return {
    etiqueta: "Indeterminada",
    detalle: "La expresión produce una forma indeterminada.",
  };
}
