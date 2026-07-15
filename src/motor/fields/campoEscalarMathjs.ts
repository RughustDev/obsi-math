// ─────────────────────────────────────────────
// fields · Oráculo CampoEscalar sobre mathjs (CUARENTENA de mathjs)
// ─────────────────────────────────────────────
//
// Convierte la expresión diferencia F(x,y) = (lhs)-(rhs) de una ecuación
// implícita en un `CampoEscalar` evaluable. REUTILIZA `compilarExpresion` del
// motor antiguo (mismas funciones que obs-graph/obs-system). Coacciona cualquier
// no-número (Complex de mathjs) a NaN = "fuera del dominio real", igual que el
// oráculo explícito. No provee gradiente analítico: el descubridor y el trazador
// usan diferencias finitas (el contrato lo permite).

import { compilarExpresion } from "../../evaluador";
import type { CampoEscalar } from "../contracts";

export function crearCampoEscalar(exprDiferencia: string): CampoEscalar {
  try {
    const g = compilarExpresion(exprDiferencia);
    return {
      eval: (x: number, y: number): number => {
        const v = g({ x, y });
        return typeof v === "number" ? v : NaN;
      },
    };
  } catch {
    return { eval: () => NaN };
  }
}
