// ─────────────────────────────────────────────
// fields · Oráculo Parametrizacion sobre mathjs (CUARENTENA de mathjs)
// ─────────────────────────────────────────────
//
// Convierte expresiones de usuario en una `Parametrizacion` p(t)=(x(t),y(t)).
// REUTILIZA `compilarFuncion` del evaluador antiguo (mismas funciones que el resto
// del motor) → reconoce EXACTAMENTE las mismas trig/inversas/raíces. Coacciona
// cualquier no-número (Complex de mathjs, fuera de dominio) a NaN, igual que los
// demás oráculos: un punto no finito = "fuera del dominio", que el trazador trata
// como hueco (parte la rama). Dos constructores:
//   • cartesiana: (x(t), y(t)) directos, variable `t`.
//   • polar:      r(θ) → (r·cosθ, r·sinθ), variable `theta`. Una polar NO es más
//     que una paramétrica cartesiana (lo dice el contrato), así que comparte
//     trazador y proveedor; lo único propio es esta conversión.

import { compilarFuncion } from "../../evaluador";
import type { Parametrizacion } from "../contracts";

const aNumero = (v: unknown): number => (typeof v === "number" ? v : NaN);

/** p(t) = (x(t), y(t)) con expresiones YA normalizadas en la variable `t`. */
export function crearParametrizacionCartesiana(
  exprX: string,
  exprY: string,
  dominio: readonly [number, number],
  periodica?: boolean
): Parametrizacion {
  try {
    const gx = compilarFuncion(exprX, "t");
    const gy = compilarFuncion(exprY, "t");
    return {
      eval: (t: number) => ({ x: aNumero(gx(t)), y: aNumero(gy(t)) }),
      dominio,
      periodica,
    };
  } catch {
    return { eval: () => ({ x: NaN, y: NaN }), dominio, periodica };
  }
}

/**
 * p(θ) = (r(θ)·cosθ, r(θ)·sinθ) con `exprR` YA normalizada en la variable `theta`.
 * El ángulo va en radianes (consistente con `cos`/`sin` del motor); un `r` no
 * finito produce un punto no finito → el trazador parte la rama (p.ej. polos
 * polares como r=tan(θ) o r=1/θ).
 */
export function crearParametrizacionPolar(
  exprR: string,
  dominio: readonly [number, number],
  periodica?: boolean
): Parametrizacion {
  try {
    const gr = compilarFuncion(exprR, "theta");
    return {
      eval: (t: number) => {
        const r = aNumero(gr(t));
        return { x: r * Math.cos(t), y: r * Math.sin(t) };
      },
      dominio,
      periodica,
    };
  } catch {
    return { eval: () => ({ x: NaN, y: NaN }), dominio, periodica };
  }
}
