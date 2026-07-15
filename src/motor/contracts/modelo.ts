// ─────────────────────────────────────────────
// Lenguaje común · Modelo del objeto matemático
// ─────────────────────────────────────────────
//
// El ObjetoMatematico es el resultado de PARSEAR e INTERPRETAR la entrada: una
// descripción estructural + los oráculos numéricos + hechos simbólicos baratos.
// Es lo que lee el "planificador" (dispatcher) para decidir QUÉ proveedor de
// geometría usar. No contiene nada de píxeles, render ni estilo.
//
// Es una UNIÓN ETIQUETADA (discriminated union por `tipo`): añadir un tipo nuevo
// de objeto = añadir un miembro a la unión + su proveedor, sin tocar el resto.

import type { CampoEscalar, FuncionReal, Parametrizacion } from "./oraculos";

export type TipoObjeto =
  | "explicita"     // y = f(x)
  | "implicita"     // F(x,y) = 0
  | "parametrica"   // (x(t), y(t))
  | "polar"         // r = g(θ)
  | "relacion"      // F(x,y) < 0  (inecuación / región)
  | "sistema";      // conjunto de ecuaciones a la vez

export interface ObjetoBase {
  readonly id: string;
  readonly tipo: TipoObjeto;
  /** Texto original (para LaTeX, depuración, mensajes). */
  readonly fuente: string;
  /** Variables simbólicas detectadas (sin constantes como π, e). */
  readonly variables: readonly string[];
}

/**
 * Hechos simbólicos BARATOS que ayudan a elegir estrategia y semillas. Todos
 * opcionales: el motor funciona sin ninguno (degradando a lo general). Nunca se
 * apoya una decisión de CORRECCIÓN en estos hechos heurísticos, solo de
 * OPTIMIZACIÓN (qué ruta rápida intentar primero).
 */
export interface HechosSimbolicos {
  /** Grado polinómico en y (p.ej. 2 → cónica despejable por fórmula cerrada). */
  readonly gradoEnY?: number;
  /** ¿La expresión es periódica en alguna variable (trig)? Periodo si se conoce. */
  readonly periodo?: number;
  /** ¿Es afín (lineal) en todas sus variables? (recta/plano). */
  readonly esAfin?: boolean;
}

export interface ObjetoExplicito extends ObjetoBase {
  readonly tipo: "explicita";
  readonly f: FuncionReal;
  readonly hechos?: HechosSimbolicos;
  /**
   * Coordenada donde va el VALOR de f; la variable independiente ocupa el otro eje.
   * Por defecto `"y"` (la explícita de toda la vida: y=f(x), abscisa horizontal).
   * `"x"` es la lectura de una componente paramétrica `x(t)=…`: el valor es la ABSCISA,
   * así que el parámetro sube por el eje vertical y la curva sale TUMBADA (x=f(y)). No es
   * un tipo nuevo —misma f, mismo trazador 1D—: solo cambia qué eje ocupa cada variable.
   */
  readonly salida?: "y" | "x";
}

export interface ObjetoImplicito extends ObjetoBase {
  readonly tipo: "implicita";
  readonly F: CampoEscalar;
  readonly hechos?: HechosSimbolicos;
}

export interface ObjetoParametrico extends ObjetoBase {
  readonly tipo: "parametrica";
  readonly p: Parametrizacion;
}

export interface ObjetoPolar extends ObjetoBase {
  readonly tipo: "polar";
  readonly p: Parametrizacion; // ya convertida a cartesiana
}

export interface ObjetoRelacion extends ObjetoBase {
  readonly tipo: "relacion";
  readonly F: CampoEscalar;
  /** La región es { (x,y) : signo·F(x,y) ≥ 0 }. */
  readonly signo: 1 | -1;
  readonly estricta: boolean; // < vs ≤
}

export interface ObjetoSistema extends ObjetoBase {
  readonly tipo: "sistema";
  readonly miembros: readonly ObjetoMatematico[];
}

export type ObjetoMatematico =
  | ObjetoExplicito
  | ObjetoImplicito
  | ObjetoParametrico
  | ObjetoPolar
  | ObjetoRelacion
  | ObjetoSistema;
