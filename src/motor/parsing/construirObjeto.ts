// ─────────────────────────────────────────────
// parsing · Entrada del usuario → ObjetoMatematico (explícita/implícita/paramétrica/polar)
// ─────────────────────────────────────────────
//
// Clasificador mínimo + constructor. Convención (la del usuario, estilo Desmos):
//   • "(X(t), Y(t))"   (tupla con UNA coma de nivel 0)  → PARAMÉTRICA  p(t)
//   • "r = expr(θ)"    (un lado normaliza a "r")        → POLAR        r=g(θ)
//   • "y = expr"  o  "expr = y"  o  un solo lado sin "="  → EXPLÍCITA   y=f(x)
//     (salvo que el lado suelto contenga `y` LIBRE → IMPLÍCITA expr=0)
//   • cualquier otro "lhs = rhs"                          → IMPLÍCITA   F=(lhs)-(rhs)=0
//
// El orden importa: la PARAMÉTRICA se detecta ANTES del split por "=" (su tupla no
// lleva "="), y la POLAR dentro del caso "lhs=rhs". Explícita/implícita quedan
// EXACTAMENTE igual que antes (sin regresión). Reutiliza `normalizarEntrada` (texto
// puro) y delega la compilación numérica a `fields` (única con mathjs).
//
// Dominio del parámetro: paramétricas por defecto [0, 2π] (constante); las POLARES lo
// calculan por su PERIODO real (`dominioPolar`: `sin(θ/10)`→[0,20π], antes se cortaba a
// 1/10). El dominio a medida por el usuario (sintaxis para fijar el rango de t/θ) sigue
// siendo una extensión de UX PENDIENTE.

import { normalizarEntrada, contieneYLibre } from "../../parser";
import { insertarProductoImplicito } from "./productoImplicito";
import { crearFuncionReal } from "../fields/funcionRealMathjs";
import { crearCampoEscalar } from "../fields/campoEscalarMathjs";
import {
  crearParametrizacionCartesiana,
  crearParametrizacionPolar,
} from "../fields/parametrizacionMathjs";
import { dominioPolar } from "./periodoPolar";
import { funcionDelParametro, renombrarParametroAX } from "./componentesParametricas";
import type { ObjetoMatematico } from "../contracts";

const DOMINIO_DEFECTO: readonly [number, number] = [0, 2 * Math.PI];

/**
 * Normaliza una pieza de expresión: convierte LaTeX/Unicode (parser compartido) y
 * luego inserta la multiplicación implícita propia del motor nuevo (3xy → 3*x*y).
 */
const norm = (s: string): string => insertarProductoImplicito(normalizarEntrada(s));

export function construirObjeto(source: string, id: string): ObjetoMatematico {
  const s = source.trim();

  // 1) Paramétrica: (X(t), Y(t)) — tupla entre paréntesis envolventes con 1 coma de nivel 0.
  const par = intentarParametrica(s);
  if (par) return parametrica(id, source, par[0], par[1]);

  // 1b) UNA sola componente (`x(t)=…`, `y(t)=…`) o una expresión suelta en `t`: es la función
  // t ↦ expr, o sea la explícita de siempre con la variable independiente llamada `t` (se
  // renombra a x y la grafica el ProveedorExplicito; ver componentesParametricas.ts). El NOMBRE
  // dice en qué eje cae el VALOR: `y(t)` → ordenada (curva de pie, la gráfica clásica);
  // `x(t)` → ABSCISA, así que el parámetro sube por el eje vertical y la curva sale TUMBADA
  // (`salida:"x"`). No es una convención de Desmos: es lo que la componente SIGNIFICA —el punto
  // de parámetro t tiene esa x—. Sin esto, `x(t)` normaliza al producto `x*t` (implícita basura
  // con una `t` fantasma) y la expresión suelta en `t` se compila contra `x` → NaN en todo el eje.
  const comp = funcionDelParametro(s);
  if (comp) {
    const f = explicita(id, source, renombrarParametroAX(norm(comp.expr)));
    return comp.eje === "x" ? { ...f, salida: "x" } : f;
  }

  const partes = source.split("=");
  if (partes.length === 2) {
    const lhs = norm(partes[0].trim());
    const rhs = norm(partes[1].trim());
    if (lhs === "y") return explicita(id, source, rhs);
    if (rhs === "y") return explicita(id, source, lhs);
    // 2) Polar: r = g(θ)  (o  g(θ) = r). El ángulo es `theta` (también \theta y θ).
    if (lhs === "r") return polar(id, source, partes[1]);
    if (rhs === "r") return polar(id, source, partes[0]);
    // Implícita: F(x,y) = (lhs) - (rhs) = 0.
    return implicita(id, source, `(${lhs})-(${rhs})`);
  }

  // Expresión suelta. Si contiene `y` LIBRE no puede ser y=f(x) (evaluarla solo con x
  // daría NaN en todo el eje → plano vacío + falso "Indeterminada"): se toma como
  // IMPLÍCITA expr = 0 (p. ej. `tan(y)(x²+1)-√(x+1)` ≡ `tan(y)(x²+1)=√(x+1)`).
  const expr = norm(partes[0].trim());
  if (contieneYLibre(expr)) return implicita(id, source, expr);
  return explicita(id, source, expr);
}

// ── Detección de tupla paramétrica ───────────────────────────────────────────
/** Si `s` es "(X, Y)" (paréntesis envolventes + 1 coma de nivel 0), devuelve [normX, normY]. */
function intentarParametrica(s: string): [string, string] | null {
  if (s.length < 2 || s[0] !== "(") return null;
  if (cierreParentesis(s, 0) !== s.length - 1) return null; // el paréntesis debe envolver TODO
  const interior = s.slice(1, -1);
  const coma = comaNivel0(interior);
  if (coma === -1) return null;
  // Debe haber EXACTAMENTE una coma de nivel 0 (es un par, no una terna).
  if (comaNivel0(interior.slice(coma + 1)) !== -1) return null;
  const xs = interior.slice(0, coma).trim();
  const ys = interior.slice(coma + 1).trim();
  if (!xs || !ys) return null;
  return [norm(xs), norm(ys)];
}

/** Índice del ')' que cierra el '(' en `inicio`, o -1. */
function cierreParentesis(texto: string, inicio: number): number {
  let prof = 0;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === "(") prof++;
    else if (texto[i] === ")" && --prof === 0) return i;
  }
  return -1;
}

/** Índice de la primera coma de nivel 0 (fuera de (), [], {}), o -1. */
function comaNivel0(texto: string): number {
  let prof = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === "(" || c === "[" || c === "{") prof++;
    else if (c === ")" || c === "]" || c === "}") prof--;
    else if (c === "," && prof === 0) return i;
  }
  return -1;
}

// ── Constructores por tipo ───────────────────────────────────────────────────
function explicita(id: string, source: string, expr: string): ObjetoMatematico {
  return { id, tipo: "explicita", fuente: source, variables: ["x"], f: crearFuncionReal(expr) };
}

function implicita(id: string, source: string, exprDiferencia: string): ObjetoMatematico {
  return { id, tipo: "implicita", fuente: source, variables: ["x", "y"], F: crearCampoEscalar(exprDiferencia) };
}

function parametrica(id: string, source: string, exprX: string, exprY: string): ObjetoMatematico {
  return {
    id, tipo: "parametrica", fuente: source, variables: ["t"],
    p: crearParametrizacionCartesiana(exprX, exprY, DOMINIO_DEFECTO, true),
  };
}

function polar(id: string, source: string, ladoExpr: string): ObjetoMatematico {
  // θ (Unicode) → theta; \theta lo resuelve normalizarEntrada (quita el backslash).
  const expr = norm(ladoExpr.trim().replace(/θ/g, "theta"));
  // Dominio por PERIODO real de la curva (`sin(θ/10)` necesita 20π, no 2π).
  return {
    id, tipo: "polar", fuente: source, variables: ["theta"],
    p: crearParametrizacionPolar(expr, dominioPolar(expr), true),
  };
}
