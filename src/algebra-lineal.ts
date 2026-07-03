import { parse, evaluate } from "mathjs";

import { normalizarEntrada } from "./parser";

// ─────────────────────────────────────────────
// Sistemas de ecuaciones — Álgebra lineal
// ─────────────────────────────────────────────

export interface EcuacionLineal {
  vars: Record<string, number>;
  rhs: number;
}

export function parsearEcuacionLineal(ecuacion: string): EcuacionLineal | null {
  try {
    const partes = ecuacion.split("=");
    if (partes.length !== 2) return null;

    const lhs = normalizarEntrada(partes[0].trim());
    const rhs = normalizarEntrada(partes[1].trim());
    const exprDiferencia = `(${lhs})-(${rhs})`;
    const nodo = parse(exprDiferencia);

    // Recolectar variables simbólicas (las que no son constantes de MathJS)
    const variables = new Set<string>();
    (nodo as any).traverse((n: any) => {
      if (n.type !== "SymbolNode") return;
      try { evaluate(n.name); } catch { variables.add(n.name); }
    });

    const nombresVars = Array.from(variables).sort();
    const scopeCero: Record<string, number> = Object.fromEntries(
      nombresVars.map((v: string) => [v, 0])
    );

    const constante = evaluate(exprDiferencia, scopeCero);
    if (!isFinite(constante)) return null;

    const coefs: Record<string, number> = {};
    for (const v of nombresVars) {
      const valorConUno = evaluate(exprDiferencia, { ...scopeCero, [v as string]: 1 });
      if (!isFinite(valorConUno)) return null;
      const coef = valorConUno - constante;
      if (Math.abs(coef) > 1e-10) coefs[v] = coef;
    }

    // Verificar linealidad con valor=2
    for (const v of nombresVars) {
      const valorConDos = evaluate(exprDiferencia, { ...scopeCero, [v as string]: 2 });
      const esperado = constante + 2 * (coefs[v] ?? 0);
      if (!isFinite(valorConDos) || Math.abs(valorConDos - esperado) > 1e-8) return null;
    }

    return { vars: coefs, rhs: -constante };
  } catch {
    return null;
  }
}

/** Calcula el rango de una matriz mediante eliminación gaussiana con pivoteo parcial. */
function rangoMatriz(matrizOriginal: number[][]): number {
  const m = matrizOriginal.map(fila => fila.slice());
  const filas = m.length;
  const cols = m[0]?.length ?? 0;
  let rango = 0;

  for (let col = 0; col < cols && rango < filas; col++) {
    // Pivoteo parcial
    let maxFila = rango;
    for (let f = rango + 1; f < filas; f++) {
      if (Math.abs(m[f][col]) > Math.abs(m[maxFila][col])) maxFila = f;
    }
    if (Math.abs(m[maxFila][col]) < 1e-10) continue;

    [m[rango], m[maxFila]] = [m[maxFila], m[rango]];
    const pivote = m[rango][col];
    for (let j = col; j < cols; j++) m[rango][j] /= pivote;

    for (let f = 0; f < filas; f++) {
      if (f === rango) continue;
      const factor = m[f][col];
      for (let j = col; j < cols; j++) m[f][j] -= factor * m[rango][j];
    }
    rango++;
  }

  return rango;
}

type ResultadoSistema = Record<string, number> | string;

export function resolverSistema(ecuaciones: string[]): ResultadoSistema {
  const parseadas = ecuaciones.map(parsearEcuacionLineal);
  if (parseadas.some(p => p === null))
    return "No se pudo parsear una o mas ecuaciones";

  // Unión de todas las variables
  const todasVars = Array.from(
    new Set(parseadas.flatMap((p: EcuacionLineal | null) => Object.keys(p!.vars)))
  ).sort();
  const numVars = todasVars.length;

  // Construir matriz aumentada
  const matrizAumentada = parseadas.map((p: EcuacionLineal | null) => [
    ...todasVars.map(v => p!.vars[v as string] ?? 0),
    p!.rhs,
  ]);

  const matrizCoefs = matrizAumentada.map(fila => fila.slice(0, numVars));
  const rangoCoefs = rangoMatriz(matrizCoefs);
  const rangoAumentada = rangoMatriz(matrizAumentada);

  if (rangoAumentada > rangoCoefs)
    return "Sistema inconsistente: no tiene solucion";
  if (numVars === 0)
    return "Sistema consistente y dependiente: todas las ecuaciones son identidades; hay infinitas soluciones";
  if (rangoCoefs < numVars)
    return "Sistema consistente y dependiente: infinitas soluciones";

  // Seleccionar filas linealmente independientes
  const filasIndep: number[][] = [];
  for (const p of parseadas) {
    const fila = [...todasVars.map(v => p!.vars[v as string] ?? 0), p!.rhs];
    const candidato = [...filasIndep.map(f => f.slice(0, numVars)), fila.slice(0, numVars)];
    if (rangoMatriz(candidato) > filasIndep.length) filasIndep.push(fila);
    if (filasIndep.length === numVars) break;
  }

  // Eliminación gaussiana in-place sobre las filas independientes
  const m = filasIndep;
  for (let col = 0; col < numVars; col++) {
    let maxFila = col;
    for (let f = col + 1; f < numVars; f++) {
      if (Math.abs(m[f][col]) > Math.abs(m[maxFila][col])) maxFila = f;
    }
    [m[col], m[maxFila]] = [m[maxFila], m[col]];

    if (Math.abs(m[col][col]) < 1e-10) return "El sistema no tiene solucion unica";

    for (let f = col + 1; f < numVars; f++) {
      const factor = m[f][col] / m[col][col];
      for (let j = col; j <= numVars; j++) m[f][j] -= factor * m[col][j];
    }
  }

  // Sustitución hacia atrás
  const solucion = new Array<number>(numVars).fill(0);
  for (let i = numVars - 1; i >= 0; i--) {
    solucion[i] = m[i][numVars];
    for (let j = i + 1; j < numVars; j++) solucion[i] -= m[i][j] * solucion[j];
    solucion[i] /= m[i][i];
  }

  return Object.fromEntries(todasVars.map((v: string, i: number) => [v, solucion[i]]));
}
