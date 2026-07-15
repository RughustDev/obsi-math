// ─────────────────────────────────────────────
// tests · Suite LENTA: barrido de zoom (regresión "la curva desaparece / parpadea")
// ─────────────────────────────────────────────
//
// Vive APARTE de `motor.test.ts` por una razón de COSTE, no de tema: este barrido traza cada
// curva en ~150 viewports × 2 lienzos × 2 pasadas y se lleva ~80 s, cuatro veces más que TODO
// el resto de la suite junta. Mezclado, convertía el `npm run test` de cada cambio pequeño en
// una espera de dos minutos, y el ciclo corto es lo que hace que la validación se ejecute de
// verdad. Aquí el muestreo FINO es innegociable: los fallos aparecían en bandas estrechas de
// zoom (semiY≈24.0–24.75) que un barrido grueso se salta —recortarlo sería no probar nada—.
//
// Se corre con `npm run test:zoom`, y `npm run test:todo` encadena las dos suites (lo que hay
// que pasar antes de dar por cerrado un cambio del trazado/descubrimiento).
//
// Regresión del "al alejar el zoom, parte de la curva desaparece y parpadea". La rejilla
// de descubrimiento tiene celdas ligadas a los PÍXELES, pero una curva acotada (corazón,
// astroide: radio ~1) tiene tamaño fijo en MUNDO → al alejar el zoom cabe entera en una
// celda, ninguna arista cambia de signo y no se siembra nada. Y como cada pasada usa una
// rejilla distinta, cada una la perdía a un zoom distinto: de ahí el PARPADEO (aparece al
// soltar el gesto, desaparece al arrastrar).
//
// Se exige lo que el usuario ve: a CUALQUIER zoom y en LAS DOS pasadas, la curva se
// dibuja (nunca cero ramas) y con el mismo nº de arcos que a zoom normal en el rango
// donde la figura aún tiene tamaño de sobra en pantalla.

import { describe, test, assert, resumen } from "./runner";
import { crearViewport } from "../src/motor/scene/viewport-utils";
import { TrazadorContinuacion } from "../src/motor/tracing/continuation/TrazadorContinuacion";
import { construirObjeto } from "../src/motor/parsing/construirObjeto";
import { crearProveedor } from "../src/motor/app/composicion";
import type { Viewport, Tolerancia, Geometria, ObjetoImplicito, Semilla } from "../src/motor/contracts";

const VP: Viewport = crearViewport([-8, 8], [-7, 7], 768, 261, 1);
const TOL_FINAL: Tolerancia = { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada: "final" };
const TOL_INT: Tolerancia = { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada: "interactiva" };

/** Longitud TOTAL trazada, en unidades de mundo. Es la métrica que refleja lo que el usuario
 *  VE: una curva mutilada pierde longitud. El nº de RAMAS no sirve —la misma curva puede salir
 *  partida en 2 o en 4 polilíneas según si la continuación cruza o no una cúspide, con idéntico
 *  dibujo—, y usarlo como criterio fue lo que dejó pasar el bug la primera vez. */
function longitudTrazada(g: Geometria): number {
  let L = 0;
  for (const r of g.ramas)
    for (let k = 2; k < r.puntos.length; k += 2)
      L += Math.hypot(r.puntos[k] - r.puntos[k - 2], r.puntos[k + 1] - r.puntos[k - 1]);
  return L;
}

/** Viewport como el que arma `Camara`: domY es el mando del zoom, domX sale del ASPECTO. */
const vpZoom = (semiY: number, ancho: number, alto: number): Viewport =>
  crearViewport([-semiY * (ancho / alto), semiY * (ancho / alto)], [-semiY, semiY], ancho, alto, 1);

describe("Zoom-out: las curvas acotadas no desaparecen ni parpadean", () => {
  // Curvas ACOTADAS con su longitud REAL (no depende del zoom) y los lienzos con los que se
  // barre. El zoom de rueda es CONTINUO: se barre en pasos finos, porque los fallos aparecían
  // en BANDAS ESTRECHAS de zoom (semiY≈24.0–24.75) que un muestreo grueso se salta.
  const CURVAS: ReadonlyArray<{ nombre: string; fuente: string; largo: number }> = [
    { nombre: "corazón (x²+y²−1)³=x²y³", fuente: "(x^2+y^2-1)^3=x^2*y^3", largo: 7.5 },
    { nombre: "astroide x^{2/3}+y^{2/3}=1", fuente: "x^{2/3}+y^{2/3}=1", largo: 6.0 },
    { nombre: "lemniscata (nodo en el origen)", fuente: "(x^2+y^2)^2=2*(x^2-y^2)", largo: 7.4 },
    { nombre: "cardioide (cúspide)", fuente: "(x^2+y^2+x)^2=x^2+y^2", largo: 8.0 },
    { nombre: "círculo (control)", fuente: "x^2+y^2=9", largo: 18.85 },
  ];
  const LIENZOS: ReadonlyArray<[number, number]> = [[490, 330], [768, 261]];

  for (const { nombre, fuente, largo } of CURVAS) {
    test(`${nombre}: se traza ENTERA a cualquier zoom y en las dos pasadas`, () => {
      for (const [ancho, alto] of LIENZOS) {
        for (let semiY = 3; semiY <= 40; semiY += 0.25) {
          const vp = vpZoom(semiY, ancho, alto);
          for (const tol of [TOL_INT, TOL_FINAL]) {
            const g = crearProveedor(construirObjeto(fuente, "z")).geometria(vp, tol);
            const cobertura = longitudTrazada(g) / largo;
            assert(
              cobertura >= 0.9,
              `${ancho}x${alto} semiY=${semiY.toFixed(2)} ${tol.pasada}: solo se trazó el ` +
              `${(cobertura * 100).toFixed(0)}% de la curva (mutilada)`
            );
          }
        }
      }
    });
  }

  test("las dos pasadas trazan LO MISMO (la discrepancia entre ellas ES el parpadeo)", () => {
    // El parpadeo es que la pasada interactiva (durante el gesto) y la final (al soltar)
    // dibujen cosas distintas. Se exige que sus longitudes coincidan al 10%.
    for (const { nombre, fuente } of CURVAS) {
      for (let semiY = 3; semiY <= 40; semiY += 0.5) {
        const vp = vpZoom(semiY, 490, 330);
        const L = [TOL_INT, TOL_FINAL].map((tol) =>
          longitudTrazada(crearProveedor(construirObjeto(fuente, "z")).geometria(vp, tol))
        );
        const dif = Math.abs(L[0] - L[1]) / Math.max(L[0], L[1], 1e-9);
        assert(dif < 0.1, `${nombre} semiY=${semiY.toFixed(2)}: int=${L[0].toFixed(2)} vs fin=${L[1].toFixed(2)}`);
      }
    }
  });

  test("las curvas NO acotadas (control) siguen intactas", () => {
    const CONTROL: ReadonlyArray<[string, string, number]> = [
      ["hipérbola", "x^2-y^2=4", 2],
      ["cúbica", "x^3+y^3=9", 1],
      ["folium", "x^3+y^3=3*x*y", 1],
    ];
    for (const [nombre, fuente, esperadas] of CONTROL)
      for (const semiY of [6, 15, 30]) {
        const g = crearProveedor(construirObjeto(fuente, "z")).geometria(vpZoom(semiY, 768, 261), TOL_FINAL);
        assert(g.ramas.length >= esperadas, `${nombre} a semiY=${semiY}: ${g.ramas.length} ramas`);
        assert(longitudTrazada(g) > 5, `${nombre} a semiY=${semiY}: geometría no vacía`);
      }
  });

  test("una semilla sobre una CÚSPIDE arranca igual (∇F=0 no mata la curva)", () => {
    // La astroide con mucho zoom-out solo recibe semillas sobre los ejes = sus cuatro
    // cúspides, donde el corrector converge al propio punto singular y el primer paso
    // gira ~63° (más de lo que admite el predictor) → sin el arranque robusto, la curva
    // entera salía vacía. Se siembra a mano EXACTAMENTE en las cúspides.
    const F = (construirObjeto("x^{2/3}+y^{2/3}=1", "z") as ObjetoImplicito).F;
    const cuspides: Semilla[] = [
      { punto: { x: 1, y: 0 }, confianza: 1 },
      { punto: { x: -1, y: 0 }, confianza: 1 },
      { punto: { x: 0, y: 1 }, confianza: 1 },
      { punto: { x: 0, y: -1 }, confianza: 1 },
    ];
    const ramas = new TrazadorContinuacion().trazar(F, "z", cuspides, [], VP, TOL_FINAL);
    assert(ramas.length > 0, "sembrando SOLO en las cúspides, la curva sigue trazándose");
    // Cota HOLGADA a propósito: justo EN la cúspide ∂F/∂y es infinita, así que |F| deja de
    // medir bien el error de posición (el peor punto da |F|≈3·10⁻³, pero como ∂F/∂x=2/3 eso
    // son ~5·10⁻³ unidades de desvío: subpíxel a cualquier zoom razonable).
    for (const r of ramas)
      for (let k = 0; k < r.puntos.length; k += 2)
        assert(Math.abs(F.eval(r.puntos[k], r.puntos[k + 1])) < 1e-2, "los puntos están sobre la curva");
  });
});

resumen();
