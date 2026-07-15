// ─────────────────────────────────────────────
// tests · Runner mínimo sin dependencias
// ─────────────────────────────────────────────
//
// Micro-framework de pruebas (cero dependencias). Se bundlea con esbuild y se
// ejecuta con node (`npm run test`). Sale con código ≠ 0 si algo falla, para que
// el comando falle en CI/consola. No usa DOM ni Obsidian: solo lógica pura del
// motor (trazadores, descubrimiento, análisis, fields, viewport-utils).
//
// `process` es un global de Node disponible en tiempo de ejecución (node ejecuta el
// bundle de esbuild). Se declara aquí lo MÍNIMO que usamos para que el editor no pida
// `@types/node` — así no arrastramos los tipos de Node a todo el proyecto.
declare const process: { exit(code: number): never; exitCode?: number };

let pasaron = 0;
let fallaron = 0;
const fallos: string[] = [];
let grupoActual = "";

export function describe(nombre: string, fn: () => void): void {
  grupoActual = nombre;
  console.log(`\n${nombre}`);
  const t0 = Date.now();
  fn();
  // Se cronometra CADA grupo: la suite se reparte en dos comandos (rápido / lento) y este
  // número es el criterio para decidir en cuál vive un bloque nuevo. Sin él, un test caro
  // se cuela en la suite rápida sin que nadie lo note hasta que el ciclo ya duele.
  const ms = Date.now() - t0;
  if (ms >= 500) console.log(`  … ${(ms / 1000).toFixed(1)}s`);
  grupoActual = "";
}

export function test(nombre: string, fn: () => void): void {
  try {
    fn();
    pasaron++;
    console.log(`  ✓ ${nombre}`);
  } catch (e) {
    fallaron++;
    const etiqueta = grupoActual ? `${grupoActual} › ${nombre}` : nombre;
    fallos.push(etiqueta);
    console.log(`  ✗ ${nombre}\n      ${(e as Error).message}`);
  }
}

export function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function igual<T>(a: T, b: T, msg = ""): void {
  if (a !== b) throw new Error(`${msg} esperado ${String(b)}, obtuve ${String(a)}`);
}

export function aprox(a: number, b: number, eps: number, msg = ""): void {
  if (!(Math.abs(a - b) <= eps)) {
    throw new Error(`${msg} esperado ${b} ± ${eps}, obtuve ${a} (Δ=${Math.abs(a - b)})`);
  }
}

export function resumen(): void {
  console.log(`\n${"─".repeat(40)}`);
  console.log(`${pasaron} pasaron, ${fallaron} fallaron`);
  if (fallaron > 0) {
    console.log(`FALLOS: ${fallos.join(", ")}`);
    process.exit(1);
  }
  console.log("OK — todas las pruebas pasaron.");
}
