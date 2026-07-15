// ─────────────────────────────────────────────
// scene · Autoencuadre (la vista inicial se ajusta a la curva, solo ACERCANDO)
// ─────────────────────────────────────────────
//
// La vista por defecto ([-7,7] en Y) es un compromiso: a una curva ACOTADA y pequeña
// —el corazón, la lemniscata, la astroide, un círculo de radio 1— le sobra plano por
// todas partes y se ve como un garabato en el centro. Este módulo mira la geometría YA
// TRAZADA con la vista por defecto y decide si merece la pena acercar.
//
// TRES decisiones de diseño, y las tres son la razón de que esto sea seguro:
//
//  1. SOLO ACERCA, NUNCA ALEJA. Si la curva TOCA cualquier borde de la vista, no se
//     toca nada: fuera del cuadro puede continuar indefinidamente (una recta, una
//     parábola, tan x) y "encuadrarla" sería perseguir un infinito. El disparo exige
//     contención ESTRICTA, con un colchón de unos píxeles.
//  2. CENTRO EN EL ORIGEN. Solo se escala; no se traslada. Los ejes siguen siempre en
//     cuadro, que es lo que uno espera de un plano cartesiano (una circunferencia lejos
//     del origen no deja la gráfica sin ejes de referencia).
//  3. SEMIRRANGO CUANTIZADO a mantisa {1, 2, 2.5, 5}×10ᵏ, redondeando HACIA ARRIBA.
//     Con el centro en el origen, un semirrango redondo deja ticks simétricos y limpios
//     (±1, ±2, ±5); el redondeo hacia arriba solo añade aire, nunca recorta la curva.
//
// Es una función PURA de (ramas, viewport): quien la llama (Escena/host) decide CUÁNDO
// —una sola vez, en el primer render— y qué hacer con el número.

import type { Rama, Viewport } from "../contracts";

/** Dispara solo si el encuadre que pide la curva es < esta fracción del actual. */
export const FRACCION_DISPARO = 0.6;

/**
 * Fracción del semirrango de la vista que puede llegar a ocupar la curva. NO es un "margen"
 * (curva + un poco de aire): un margen porcentual pequeño encuadra la curva PEGADA a los bordes
 * —la lemniscata salía tocando los dos lados del plano, sin sitio para leerla— porque el aire que
 * hace falta no es proporcional a la curva, es el que necesita el OJO para verla como un objeto
 * dentro de un plano. Con 0.6 la curva usa el 60% del cuadro y el 40% restante es respiración,
 * que es el aire que dejan GeoGebra/Desmos al encuadrar.
 */
export const OCUPACION_MAXIMA = 0.6;

/** Colchón de contención, en px: una rama a menos de esto del borde cuenta como que lo TOCA. */
const COLCHON_PX = 2;

/** Tamaño en mundo por debajo del cual la "curva" es un punto degenerado: no se encuadra. */
const TAMANO_MINIMO = 1e-9;

/**
 * Mantisas admitidas del semirrango cuantizado (ver cabecera). Todas dan ticks limpios con el
 * centro en el origen (subdivisiones de 0.5 o de 1 en su década). La tabla es FINA a propósito:
 * con solo {1, 2, 2.5, 5}, saltar de 1 a 2 DUPLICA la vista, y el redondeo hacia arriba tira por
 * la borda hasta la mitad del encuadre calculado (la lemniscata pedía 1.29 y aterrizaba en 2).
 */
const MANTISAS = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];

/**
 * Redondea `v` HACIA ARRIBA al siguiente valor de mantisa {1, 2, 2.5, 5}×10ᵏ. Nunca
 * devuelve menos que `v` → el aire solo puede sobrar, la curva nunca se recorta.
 */
export function cuantizarSemirrango(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return v;
  const k = Math.floor(Math.log10(v));
  const base = 10 ** k;
  const m = v / base;
  // El error de log10/potencia puede dejar m fuera de [1,10) por un ULP: la última
  // mantisa (10) lo absorbe sin salirse de la tabla.
  for (const cand of MANTISAS) if (m <= cand * (1 + 1e-12)) return cand * base;
  return 10 * base;
}

/**
 * Semirrango vertical al que debería ir la vista para encuadrar estas ramas, o `null`
 * si no procede (curva que toca un borde, curva que ya llena la vista, sin geometría,
 * curva degenerada a un punto). El llamador debe pasar las ramas YA PODADAS de vértices
 * sintéticos de polo (`podarVerticesDePolo`): esos vértices viven fuera de la vista a
 * propósito y harían fallar la contención de cualquier función con asíntota.
 */
export function semiYAutoencuadre(ramas: readonly Rama[], vp: Viewport): number | null {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const r of ramas) {
    const p = r.puntos;
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i], y = p[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null; // sin geometría
  if (x1 - x0 < TAMANO_MINIMO && y1 - y0 < TAMANO_MINIMO) return null; // punto degenerado

  // Contención ESTRICTA: si la curva llega al borde (o casi), asumimos que continúa
  // fuera y no encuadramos. El colchón se mide en px y se traduce a mundo por eje.
  const holguraX = ((vp.domX[1] - vp.domX[0]) / vp.anchoPx) * COLCHON_PX;
  const holguraY = ((vp.domY[1] - vp.domY[0]) / vp.altoPx) * COLCHON_PX;
  if (x0 <= vp.domX[0] + holguraX || x1 >= vp.domX[1] - holguraX) return null;
  if (y0 <= vp.domY[0] + holguraY || y1 >= vp.domY[1] - holguraY) return null;

  // Encuadre CENTRADO EN EL ORIGEN: el semirrango Y debe cubrir la extensión vertical de
  // la curva Y TAMBIÉN la horizontal, porque semiX se deriva de semiY con celdas 1:1
  // (semiX = semiY · ancho/alto) → una curva ancha y plana (la lemniscata) la gobierna X.
  const maxAbsY = Math.max(Math.abs(y0), Math.abs(y1));
  const maxAbsX = Math.max(Math.abs(x0), Math.abs(x1));
  const semiNecesario =
    Math.max(maxAbsY, (maxAbsX * vp.altoPx) / vp.anchoPx) / OCUPACION_MAXIMA;
  if (!Number.isFinite(semiNecesario) || semiNecesario <= 0) return null;

  const semiActual = (vp.domY[1] - vp.domY[0]) / 2;
  if (semiNecesario >= semiActual * FRACCION_DISPARO) return null; // no sobra tanto espacio

  const semi = cuantizarSemirrango(semiNecesario);
  // La cuantización hacia arriba puede devolvernos al encuadre actual (o pasarse): en ese
  // caso no hay nada que ganar y se deja la vista por defecto.
  return semi < semiActual ? semi : null;
}
