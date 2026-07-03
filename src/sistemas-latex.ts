import { quitarLlavesExternas, ecuacionALatex } from "./latex";

// ─────────────────────────────────────────────
// Sistemas de ecuaciones — LaTeX
// ─────────────────────────────────────────────

interface SistemaParseado {
  ecuaciones: string[];
  espacios: string[];
  usaCases: boolean;
}

export function parsearSistemaCases(source: string): SistemaParseado {
  const texto = source.trim();
  const matchCases = texto.match(/^\\begin\{cases\}([\s\S]*)\\end\{cases\}$/);

  if (!matchCases) {
    return {
      ecuaciones: texto.split("\n").map(l => l.trim()).filter(Boolean),
      espacios: [],
      usaCases: false,
    };
  }

  const partes = matchCases[1].trim().split(/\\\\(?:\s*\[([^\]]+)\])?/g);
  const ecuaciones: string[] = [];
  const espacios: string[] = [];

  for (let i = 0; i < partes.length; i += 2) {
    const ecuacion = quitarLlavesExternas(partes[i]);
    if (!ecuacion) continue;

    ecuaciones.push(ecuacion);

    if (i + 1 < partes.length) {
      const espacio = partes[i + 1]?.trim();
      espacios.push(espacio ? `[${espacio}]` : "[1.5ex]");
    }
  }

  return { ecuaciones, espacios, usaCases: true };
}

export function sistemaCasesALatex(ecuaciones: string[], espacios: string[]): string {
  const lineas = ecuaciones.map(ec => ecuacionALatex(ec, true));
  const contenido = lineas
    .map((linea, i) =>
      i < lineas.length - 1 ? linea + "\\\\" + (espacios[i] ?? "[1.5ex]") : linea
    )
    .join("");

  return `\\begin{cases}\\begin{aligned}${contenido}\\end{aligned}\\end{cases}`;
}
