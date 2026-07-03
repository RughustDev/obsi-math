// ─────────────────────────────────────────────
// Solver numérico de intersecciones (Newton sembrado en rejilla)
// ─────────────────────────────────────────────
//
// Halla numéricamente las soluciones de un sistema de 2 incógnitas cuando NO hay
// vía analítica (sistemas no lineales/implícitos/trascendentes). Independiente
// del parser: recibe directamente las funciones F_i(x,y)=0.

export interface Punto {
  x: number;
  y: number;
}

// Puntos (x,y) que anulan SIMULTÁNEAMENTE las dos primeras ecuaciones (F1, F2) y
// —si hay más— también el resto del sistema. Método: Newton-Raphson 2×2 con
// Jacobiano por diferencias centrales, sembrado desde una rejilla sobre
// [xMin,xMax]×[yMin,yMax]; las raíces que convergen se deduplican por cercanía.
export function interseccionesNumericas(
  Fs: ((x: number, y: number) => number)[],
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  pasos = 28
): Punto[] {
  if (Fs.length < 2) return [];
  const F1 = Fs[0];
  const F2 = Fs[1];
  const resto = Fs.slice(2);
  const soluciones: Punto[] = [];
  const TOL = 1e-9;       // |F|≈0 para aceptar la raíz
  const H = 1e-6;         // paso del Jacobiano numérico

  const agregar = (x: number, y: number) => {
    // Dentro del rango sembrado y satisfaciendo el resto de ecuaciones.
    if (x < xMin - 1e-9 || x > xMax + 1e-9 || y < yMin - 1e-9 || y > yMax + 1e-9) return;
    for (const F of resto) if (Math.abs(F(x, y)) > 1e-4) return;
    if (soluciones.some((p) => Math.hypot(p.x - x, p.y - y) < 1e-4)) return;
    soluciones.push({ x, y });
  };

  const dx = (xMax - xMin) / pasos;
  const dy = (yMax - yMin) / pasos;
  for (let i = 0; i <= pasos; i++) {
    for (let j = 0; j <= pasos; j++) {
      let x = xMin + i * dx;
      let y = yMin + j * dy;
      let converge = false;
      for (let it = 0; it < 40; it++) {
        const f1 = F1(x, y);
        const f2 = F2(x, y);
        if (!Number.isFinite(f1) || !Number.isFinite(f2)) break;
        if (Math.abs(f1) < TOL && Math.abs(f2) < TOL) { converge = true; break; }
        // Jacobiano por diferencias centrales.
        const f1x = (F1(x + H, y) - F1(x - H, y)) / (2 * H);
        const f1y = (F1(x, y + H) - F1(x, y - H)) / (2 * H);
        const f2x = (F2(x + H, y) - F2(x - H, y)) / (2 * H);
        const f2y = (F2(x, y + H) - F2(x, y - H)) / (2 * H);
        const det = f1x * f2y - f1y * f2x;
        if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
        // Paso de Newton: Δ = J⁻¹ · F.
        const pasoX = (f1 * f2y - f2 * f1y) / det;
        const pasoY = (f2 * f1x - f1 * f2x) / det;
        x -= pasoX;
        y -= pasoY;
        if (!Number.isFinite(x) || !Number.isFinite(y)) break;
      }
      if (converge) agregar(x, y);
    }
  }
  return soluciones;
}
