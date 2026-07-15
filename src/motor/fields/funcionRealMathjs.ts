// ─────────────────────────────────────────────
// fields · Oráculo FuncionReal sobre mathjs (CUARENTENA de mathjs)
// ─────────────────────────────────────────────
//
// ÚNICO punto del motor nuevo donde vive mathjs (transitivamente, vía el
// evaluador existente). Convierte una expresión YA NORMALIZADA en un `FuncionReal`
// (oráculo y=f(x)). REUTILIZA `compilarFuncion` del motor antiguo —no se
// reescribe el evaluador—, de modo que el motor nuevo reconoce EXACTAMENTE las
// mismas funciones (incluidas las trig inversas inyectadas) que obs-graph.
//
// `compilarFuncion` devuelve `any`: un número, NaN, ±Infinity o un Complex de
// mathjs (p.ej. sqrt(-1)). El contrato `FuncionReal.eval` es `number`, donde
// "no finito" = fuera del dominio real. Por eso se COACCIONA todo lo que no sea
// `number` a NaN: es la semántica correcta del contrato y es indistinguible para
// el muestreo (que ya filtra con Number.isFinite, igual que obs-graph).

import { compilarFuncion } from "../../evaluador";
import type { FuncionReal } from "../contracts";

export function crearFuncionReal(exprNormalizada: string): FuncionReal {
  try {
    const g = compilarFuncion(exprNormalizada, "x");
    return {
      eval: (x: number): number => {
        const v = g(x);
        return typeof v === "number" ? v : NaN; // Complex / no-número → fuera de dominio
      },
    };
  } catch {
    // Expresión vacía o no compilable: función sin valor (plano vacío).
    return { eval: () => NaN };
  }
}
