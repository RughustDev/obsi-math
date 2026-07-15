// ─────────────────────────────────────────────
// tests · Suite del motor gráfico general
// ─────────────────────────────────────────────
//
// Pruebas de lógica PURA (sin DOM/Canvas/Obsidian). Cubren:
//   • Paridad del sampler explícito nuevo vs `src/render/muestreoExplicito` (la
//     referencia compartida con GraphEngine): deben diferir SOLO en el recorte de
//     valores finitos (corrección "rail v2"), nada más.
//   • Continuación implícita: círculo, dos componentes, hipérbola, recta, vacío.
//   • Caché de geometría (aciertos/fallos).
//   • Lectura de geometría (yEnRamas) y puntos notables.
//
// Es la suite RÁPIDA (`npm run test`, ~30 s): la que se corre en CADA cambio. El barrido de
// zoom vive aparte en `zoom.test.ts` (~80 s, `npm run test:zoom`) porque su coste dominaba el
// ciclo. Regla para un bloque nuevo: si tarda más de unos segundos (el runner cronometra cada
// `describe`), va a la suite lenta; si no, aquí.

import { describe, test, assert, igual, aprox, resumen } from "./runner";
import { crearViewport } from "../src/motor/scene/viewport-utils";
import { TrazadorExplicitoAdaptativo } from "../src/motor/tracing/explicit/TrazadorExplicitoAdaptativo";
import { TrazadorContinuacion } from "../src/motor/tracing/continuation/TrazadorContinuacion";
import { TrazadorParametricoAdaptativo } from "../src/motor/tracing/parametric/TrazadorParametricoAdaptativo";
import { DescubrimientoMuestreado } from "../src/motor/discovery/sampled/DescubrimientoMuestreado";
import { ProveedorConCache } from "../src/motor/providers/ProveedorConCache";
import { ProveedorImplicitoSeparable } from "../src/motor/providers/ProveedorImplicitoSeparable";
import { despejarRamas, tienePolos, separarTrigY, ramasMonomioY } from "../src/motor/analysis/separarImplicita";
import { ProveedorImplicitoPeriodico } from "../src/motor/providers/ProveedorImplicitoPeriodico";
import { yEnRamas, avanzarPorArco, factorRampaVerticalidad, existeRamaVecina, recortarRamasPorPendiente, PENDIENTE_CORTE_CARRIL, podarVerticesDePolo } from "../src/motor/analysis/lecturaRama";
import { analizarPuntosNotables, resumenPuntosNotables } from "../src/motor/analysis/puntosNotablesDeRama";
import { estadoGrupo, analizarFuncion, raicesALatex } from "../src/analisis";
import { despejarEcuaciones, despejarY } from "../src/despejar";
import { simplificarEcuaciones } from "../src/simplificar";
import { costeExpansion, rationalizeSeguro, LIMITE_EXPANSION } from "../src/formatoExpr";
import { derivadaLatex, derivarExpr } from "../src/derivar";
import { extraerIntegral, evaluarLimite, integralOperadorLatex, integralValorLatex, integralPrimitivaLatex, evaluarArea, cuerpoAreaLatex, cuerpoAreaLatexExacto, etiquetaIntegral } from "../src/integral";
import { integrarExpr } from "../src/integrar";
import { areaDefinida, recortarRegion, ETIQUETA_DIVERGENTE, ETIQUETA_FUERA_DOMINIO, ETIQUETA_LIMITES } from "../src/motor/analysis/areaBajoRama";
import { RELLENO_POSITIVO, RELLENO_NEGATIVO, TRAMA_POSITIVA, BORDE_REGION } from "../src/motor/rendering/RendererCanvas2D";
import { crearFuncionReal } from "../src/motor/fields/funcionRealMathjs";
import { trazar, parsearEntrada, normalizarTipo } from "../src/herramientas/trazador";
import { bloqueALatex, exprALatex } from "../src/latex";
import { normalizarEntrada, comandosNoSoportados } from "../src/parser";
import { compilarFuncion } from "../src/evaluador";
import { parse } from "mathjs";
import { muestrearFuncion } from "../src/render/muestreoExplicito";
import { construirObjeto } from "../src/motor/parsing/construirObjeto";
import { insertarProductoImplicito } from "../src/motor/parsing/productoImplicito";
import { dividirEcuaciones } from "../src/motor/parsing/dividirEcuaciones";
import { crearProveedor, construirObjetosEscena } from "../src/motor/app/composicion";
import { ProveedorExplicito } from "../src/motor/providers/ProveedorExplicito";
import { ProveedorImplicito } from "../src/motor/providers/ProveedorImplicito";
import { ProveedorParametrico } from "../src/motor/providers/ProveedorParametrico";
import type {
  FuncionReal, CampoEscalar, Viewport, Tolerancia, Rama, Geometria, ObjetoExplicito,
  ObjetoImplicito, ObjetoParametrico, ObjetoPolar, Punto, ProveedorGeometria, Estilo,
  Semilla,
} from "../src/motor/contracts";
import { semiYAutoencuadre, cuantizarSemirrango } from "../src/motor/scene/autoencuadre";
import { interseccionSegmentos, interseccionesDeGeometrias, MAX_PUNTOS } from "../src/motor/analysis/interseccionesRamas";
import { campoTranspuesto } from "../src/motor/analysis/separarImplicita";
import { Escena } from "../src/motor/scene/Escena";
import { Overlay, generarTicks } from "../src/motor/rendering/overlay/Overlay";
import { RendererCanvas2D } from "../src/motor/rendering/RendererCanvas2D";
import { Crosshair } from "../src/motor/rendering/Crosshair";
import { Camara, centroCarrilAcotado } from "../src/motor/interaction/Camara";
import { Navegacion } from "../src/motor/interaction/Navegacion";

const VP: Viewport = crearViewport([-8, 8], [-7, 7], 768, 261, 1);
const TOL_FINAL: Tolerancia = { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada: "final" };
const TOL_INT: Tolerancia = { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada: "interactiva" };

const fr = (f: (x: number) => number): FuncionReal => ({ eval: f });
const ce = (f: (x: number, y: number) => number): CampoEscalar => ({ eval: f });

// Recorte a la banda [yBot, yTop] que usa muestreoExplicito (3× alto de vista).
function clampBanda(y: number, vp: Viewport): number {
  const H = vp.domY[1] - vp.domY[0];
  const yTop = vp.domY[1] + H, yBot = vp.domY[0] - H;
  if (!Number.isFinite(y)) return y > 0 ? yTop : yBot;
  return Math.max(yBot, Math.min(yTop, y));
}

// ════════════════════════════════════════════════
describe("Sampler explícito: paridad con muestreoExplicito (solo difiere el recorte)", () => {
  const casos: Array<[string, (x: number) => number]> = [
    ["sin(x)", Math.sin],
    ["x^2 (fuera de banda en bordes)", (x) => x * x],
    ["1/x (polo en 0)", (x) => 1 / x],
    ["tan(x) (polos múltiples)", Math.tan],
    ["x^3 - 2x", (x) => x * x * x - 2 * x],
  ];
  for (const [nombre, f] of casos) {
    for (const interactivo of [false, true]) {
      const tol = interactivo ? TOL_INT : TOL_FINAL;
      test(`${nombre} [${interactivo ? "interactiva" : "final"}]`, () => {
        const nuevo = new TrazadorExplicitoAdaptativo().trazar(fr(f), "id", VP, tol);
        const viejo = muestrearFuncion({
          evalX: f, domX: [VP.domX[0], VP.domX[1]], domY: [VP.domY[0], VP.domY[1]],
          H: VP.altoPx, interactivo,
        });
        igual(nuevo.ramas.length, viejo.polilineas.length, "nº de ramas");
        for (let r = 0; r < nuevo.ramas.length; r++) {
          const pn = nuevo.ramas[r].puntos;
          const pv = viejo.polilineas[r];
          igual(pn.length, pv.length, `nº de puntos rama ${r}`);
          for (let k = 0; k < pv.length; k += 2) {
            igual(pn[k], pv[k], `x[${k}] rama ${r}`);
            // El nuevo emite y REAL; recortarla a la banda debe dar la y del viejo.
            aprox(clampBanda(pn[k + 1], VP), pv[k + 1], 1e-9, `y[${k}] rama ${r}`);
          }
        }
        // Asíntotas verticales: mismas posiciones.
        const av = viejo.asintotas.slice().sort((a, b) => a - b);
        const an = nuevo.asintotas
          .filter((a) => a.tipo === "vertical")
          .map((a) => a.valor as number)
          .sort((a, b) => a - b);
        igual(an.length, av.length, "nº de asíntotas");
        for (let i = 0; i < av.length; i++) aprox(an[i], av[i], 1e-9, `asíntota ${i}`);
      });
    }
  }
});

// ════════════════════════════════════════════════
describe("Continuación implícita", () => {
  const descubrir = new DescubrimientoMuestreado();
  const trazar = new TrazadorContinuacion();
  const geomImplicita = (F: CampoEscalar, vp = VP, tol = TOL_FINAL): readonly Rama[] => {
    const { semillas, singularidades } = descubrir.descubrir(F, vp, tol);
    return trazar.trazar(F, "id", semillas, singularidades, vp, tol);
  };
  const residualMax = (F: CampoEscalar, rama: Rama): number => {
    let m = 0;
    for (let k = 0; k < rama.puntos.length; k += 2) {
      m = Math.max(m, Math.abs(F.eval(rama.puntos[k], rama.puntos[k + 1])));
    }
    return m;
  };
  const rangos = (rama: Rama) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < rama.puntos.length; k += 2) {
      minX = Math.min(minX, rama.puntos[k]); maxX = Math.max(maxX, rama.puntos[k]);
      minY = Math.min(minY, rama.puntos[k + 1]); maxY = Math.max(maxY, rama.puntos[k + 1]);
    }
    return { minX, maxX, minY, maxY };
  };

  test("círculo x²+y²=9 → 1 rama cerrada, tangentes verticales, residual pequeño", () => {
    const F = ce((x, y) => x * x + y * y - 9);
    const ramas = geomImplicita(F);
    igual(ramas.length, 1, "nº de ramas");
    assert(ramas[0].cerrada, "la rama debe ser cerrada");
    assert(residualMax(F, ramas[0]) < 1e-4, `residual ${residualMax(F, ramas[0])}`);
    const r = rangos(ramas[0]);
    aprox(r.maxX, 3, 0.05, "x máx (tangente vertical derecha)");
    aprox(r.minX, -3, 0.05, "x mín (tangente vertical izquierda)");
    aprox(r.maxY, 3, 0.05, "y máx"); aprox(r.minY, -3, 0.05, "y mín");
  });

  test("dos circunferencias disjuntas → 2 ramas cerradas separadas", () => {
    const F = ce((x, y) => ((x + 3) ** 2 + y * y - 1) * ((x - 3) ** 2 + y * y - 1));
    const ramas = geomImplicita(F);
    igual(ramas.length, 2, "nº de ramas");
    for (const rama of ramas) assert(rama.cerrada, "cada componente debe cerrar");
    const centros = ramas.map((rama) => {
      const r = rangos(rama);
      return (r.minX + r.maxX) / 2;
    }).sort((a, b) => a - b);
    aprox(centros[0], -3, 0.1, "centro izquierdo");
    aprox(centros[1], 3, 0.1, "centro derecho");
  });

  test("hipérbola x²−y²=1 → 2 ramas abiertas", () => {
    const F = ce((x, y) => x * x - y * y - 1);
    const ramas = geomImplicita(F);
    igual(ramas.length, 2, "nº de ramas");
    for (const rama of ramas) {
      assert(!rama.cerrada, "las ramas de la hipérbola son abiertas");
      assert(residualMax(F, rama) < 1e-4, `residual ${residualMax(F, rama)}`);
    }
  });

  test("recta implícita x−y=0 → 1 rama abierta con residual ~0", () => {
    const F = ce((x, y) => x - y);
    const ramas = geomImplicita(F);
    igual(ramas.length, 1, "nº de ramas");
    assert(!ramas[0].cerrada, "la recta es abierta");
    assert(residualMax(F, ramas[0]) < 1e-6, `residual ${residualMax(F, ramas[0])}`);
  });

  test("sin solución real (x²+y²+1=0) → 0 ramas", () => {
    igual(geomImplicita(ce((x, y) => x * x + y * y + 1)).length, 0, "no debe haber ramas");
  });

  test("las ramas implícitas no exponen parámetro x (no monovaluadas)", () => {
    const ramas = geomImplicita(ce((x, y) => x * x + y * y - 9));
    igual(ramas[0].parametro, undefined, "no debe haber parametro x");
  });

  test("elipse x²/16+y²/4=1 → 1 rama cerrada", () => {
    const ramas = geomImplicita(ce((x, y) => x * x / 16 + y * y / 4 - 1));
    igual(ramas.length, 1, "nº de ramas");
    assert(ramas[0].cerrada, "la elipse cierra");
  });

  test("círculos concéntricos → 2 ramas cerradas", () => {
    const ramas = geomImplicita(ce((x, y) => (x * x + y * y - 4) * (x * x + y * y - 16)));
    igual(ramas.length, 2, "nº de ramas");
    for (const r of ramas) assert(r.cerrada, "ambos círculos cierran");
  });

  test("dos rectas xy=0 (nodo en origen) → 2 ramas, residual 0", () => {
    const F = ce((x, y) => x * y);
    const ramas = geomImplicita(F);
    igual(ramas.length, 2, "nº de ramas");
    assert(residualMax(F, ramas[0]) === 0 && residualMax(F, ramas[1]) === 0, "residual exacto 0");
  });

  test("casos con nodo no se cuelgan y mantienen residual bajo (best-effort)", () => {
    // Lemniscata y folium: la Fase D no los certifica, pero NO deben colgarse ni
    // explotar el residual (el predictor pasa por encima del nodo). Lock de no-regresión.
    const lemniscata = ce((x, y) => (x * x + y * y) ** 2 - 4 * (x * x - y * y));
    const folium = ce((x, y) => x * x * x + y * y * y - 3 * x * y);
    for (const F of [lemniscata, folium]) {
      const ramas = geomImplicita(F);
      assert(ramas.length >= 1, "debe trazar al menos una rama");
      for (const r of ramas) assert(residualMax(F, r) < 1e-3, `residual ${residualMax(F, r)}`);
    }
  });

  test("dos pasadas: la interactiva conserva la topología con menos puntos", () => {
    const F = ce((x, y) => x * x + y * y - 9);
    const fin = geomImplicita(F, VP, TOL_FINAL);
    const sIntDesc = descubrir.descubrir(F, VP, TOL_INT);
    const intRamas = trazar.trazar(F, "id", sIntDesc.semillas, sIntDesc.singularidades, VP, TOL_INT);
    igual(intRamas.length, fin.length, "mismo nº de ramas en ambas pasadas");
    assert(intRamas[0].cerrada, "sigue cerrando en interactiva");
    const ptsInt = intRamas[0].puntos.length, ptsFin = fin[0].puntos.length;
    assert(ptsInt < ptsFin, `interactiva (${ptsInt}) debe tener menos puntos que final (${ptsFin})`);
  });
});

// ════════════════════════════════════════════════
describe("Caché de geometría (ProveedorConCache)", () => {
  test("misma vista → acierto (1 sola llamada interna, misma referencia)", () => {
    let llamadas = 0;
    const g: Geometria = { ramas: [], singularidades: [], puntosNotables: [], asintotas: [] };
    const interno = { objetoId: "x", geometria: () => { llamadas++; return g; } };
    const c = new ProveedorConCache(interno);
    const a = c.geometria(VP, TOL_FINAL);
    const b = c.geometria(VP, TOL_FINAL);
    igual(llamadas, 1, "debe llamar al proveedor una sola vez");
    assert(a === b, "debe devolver la misma referencia");
  });

  test("cambio de pasada y de región → fallo (recomputa)", () => {
    let llamadas = 0;
    const interno = {
      objetoId: "x",
      geometria: (): Geometria => {
        llamadas++;
        return { ramas: [], singularidades: [], puntosNotables: [], asintotas: [] };
      },
    };
    const c = new ProveedorConCache(interno);
    c.geometria(VP, TOL_FINAL);                 // miss → 1
    c.geometria(VP, TOL_INT);                   // miss (pasada) → 2
    const otro = crearViewport([-7.9, 8.1], [-7, 7], 768, 261, 1);
    c.geometria(otro, TOL_INT);                 // miss (región) → 3
    c.geometria(otro, TOL_INT);                 // hit
    igual(llamadas, 3, "debe recomputar exactamente 3 veces");
  });
});

// ════════════════════════════════════════════════
describe("Lectura de geometría (yEnRamas)", () => {
  const rama: Rama = {
    puntos: Float64Array.from([0, 0, 1, 1, 2, 4]), // y = x² muestreado en 0,1,2
    cerrada: false, calidad: "best-effort", objetoId: "id",
    parametro: Float64Array.from([0, 1, 2]),
  };
  test("interpola linealmente dentro del rango", () => {
    aprox(yEnRamas([rama], 0.5)!, 0.5, 1e-12, "punto medio 0–1");
    aprox(yEnRamas([rama], 1.5)!, 2.5, 1e-12, "punto medio 1–2");
  });
  test("fuera del rango → null", () => {
    igual(yEnRamas([rama], -1), null, "antes del inicio");
    igual(yEnRamas([rama], 2.5), null, "después del fin");
  });
  test("rama sin parámetro → se ignora (null)", () => {
    const sinParam: Rama = { ...rama, parametro: undefined };
    igual(yEnRamas([sinParam], 1), null, "sin parametro no se puede leer por x");
  });
});

// ════════════════════════════════════════════════
describe("Puntos notables desde la polilínea", () => {
  test("parábola y=x²−4 → raíces ±2, vértice (0,−4), intersección-y (0,−4)", () => {
    const ramas = new TrazadorExplicitoAdaptativo()
      .trazar(fr((x) => x * x - 4), "id", VP, TOL_FINAL).ramas;
    const pn = analizarPuntosNotables(ramas, "id");
    const raices = pn.filter((p) => p.tipo === "raiz").map((p) => p.punto.x).sort((a, b) => a - b);
    igual(raices.length, 2, "nº de raíces");
    aprox(raices[0], -2, 0.05, "raíz izquierda");
    aprox(raices[1], 2, 0.05, "raíz derecha");
    const vert = pn.find((p) => p.tipo === "vertice");
    assert(!!vert, "debe haber un vértice");
    aprox(vert!.punto.x, 0, 0.05, "x del vértice");
    aprox(vert!.punto.y, -4, 0.05, "y del vértice");
    const iy = pn.find((p) => p.tipo === "interseccion-y");
    assert(!!iy, "debe haber intersección con Y");
    aprox(iy!.punto.y, -4, 0.05, "y de la intersección-y");
  });

  test("funciones con polos NO generan vértices espurios (segmentos sintéticos dx=0)", () => {
    // El emit sin recortar (rail v2) + emitPolo crean un pico no monótono a la misma x
    // junto a cada polo; antes se contaba como vértice (siempre fuera de pantalla) y
    // contaminaba el conteo. Deben ser 0; las reales (parábola, seno) se conservan.
    const tr = new TrazadorExplicitoAdaptativo();
    const verts = (f: (x: number) => number) =>
      analizarPuntosNotables(tr.trazar(fr(f), "id", VP, TOL_FINAL).ramas, "id")
        .filter((p) => p.tipo === "vertice").length;
    igual(verts((x) => 1 / x), 0, "1/x no tiene vértices");
    igual(verts((x) => Math.tan(x)), 0, "tan(x) no tiene vértices");
    igual(verts((x) => 1 / (x - 2)), 0, "1/(x−2) no tiene vértices");
    igual(verts((x) => x * x - 4), 1, "x²−4 conserva su vértice real");
    igual(verts((x) => Math.sin(x)), 6, "sin(x) conserva sus extremos reales");
  });

  test("intersección-Y: TODAS en curvas multivaluadas; una sola en explícitas", () => {
    // Una y=f(x) cruza el eje Y a lo sumo una vez, pero tan(y)=x lo cruza en cada
    // rama (en y=kπ): antes solo se emitía el PRIMER cruce y el resto se perdía.
    const iy = (src: string): number[] =>
      crearProveedor(construirObjeto(src, "id"))
        .geometria(crearViewport([-12, 12], [-7, 7], 900, 390, 1), TOL_FINAL)
        .puntosNotables.filter((p) => p.tipo === "interseccion-y")
        .map((p) => p.punto.y)
        .sort((a, b) => a - b);
    const tanY = iy("tan(y)=x");
    igual(tanY.length, 5, "tan(y)=x: 5 cruces en y∈[−7,7]");
    tanY.forEach((y, i) => aprox(y, (i - 2) * Math.PI, 0.01, `cruce en y=${i - 2}π`));
    igual(iy("y=sin(x)").length, 1, "explícita: un solo cruce (sin regresión)");
    aprox(iy("y=x^2+1")[0], 1, 0.01, "y=x²+1 cruza en (0,1)");
    igual(iy("y=1/x").length, 0, "1/x no cruza el eje Y");
  });

  test("raíces de EXTREMO de rama (dominio parcial): √(x+1) nace en (−1,0); sin falsas", () => {
    // La curva toca y=0 en el borde del dominio SIN cambio de signo: el sampler
    // bisecta el borde hasta subpíxel y el extremo queda a <½px de y=0. Los
    // extremos pegados al borde x de la vista NO cuentan (recorte, no dominio:
    // las colas de 1/x o e^(−x) serían raíces falsas).
    const raices = (src: string, vp = crearViewport([-12, 12], [-7, 7], 900, 390, 1)): number[] =>
      crearProveedor(construirObjeto(src, "id")).geometria(vp, TOL_FINAL)
        .puntosNotables.filter((p) => p.tipo === "raiz")
        .map((p) => p.punto.x);
    const r1 = raices("y=sqrt(x+1)");
    igual(r1.length, 1, "√(x+1): una raíz");
    aprox(r1[0], -1, 0.01, "en x=−1");
    const r2 = raices("tan(y)(x^2+1)=sqrt(x+1)");
    igual(r2.length, 1, "trig periódica: una raíz");
    aprox(r2[0], -1, 0.01, "en x=−1 (la rama k=0 nace en el eje X)");
    igual(raices("y=x^2-4").length, 2, "x²−4 conserva sus 2 raíces (sin duplicados)");
    igual(raices("y=1/x").length, 0, "1/x: sin raíces falsas");
    igual(raices("y=1/x", crearViewport([-1200, 1200], [-700, 700], 900, 390, 1)).length, 0,
      "1/x muy alejado: sin raíces falsas en el borde de la vista");
    igual(raices("y=exp(-x)", crearViewport([-5, 40], [-7, 7], 900, 390, 1)).length, 0,
      "e^(−x): sin raíz falsa aunque la cola sea subpíxel");
  });

  test("resumenPuntosNotables (ⓘ geométrico): listas sin capar + estados infinitas", () => {
    const vp = crearViewport([-12, 12], [-7, 7], 900, 390, 1);
    const resumen = (src: string) => {
      const g = crearProveedor(construirObjeto(src, "id")).geometria(vp, TOL_FINAL);
      return resumenPuntosNotables(g.ramas, "id", vp);
    };
    const r = resumen("tan(y)=x");
    igual(estadoGrupo(r.interseccionesY.length, true), "infinitas", "tan(y)=x: intersecciones-Y infinitas");
    igual(r.raices.length, 1, "tan(y)=x: raíz única (origen)");
    igual(r.vertices.length, 0, "tan(y)=x: sin vértices");
    const rp = resumen("tan(y)(x^2+1)=sqrt(x+1)");
    igual(estadoGrupo(rp.vertices.length, true), "infinitas", "periódica: vértices infinitos");
    aprox(rp.raices[0].punto.x, -1, 0.01, "periódica: raíz (−1,0) en el resumen");
  });

  test("Lissajous (sin 2t, sin 3t): puntos notables FINITOS por período (no 'infinitas')", () => {
    // Una paramétrica se traza sobre UN período [0,2π]: es un conjunto ACOTADO, así
    // que sus cruces con los ejes son FINITOS (la periodicidad en t RE-RECORRE la
    // curva, no añade cruces). El bug histórico: el ⓘ veía `sin(` en la fórmula y
    // aplicaba la heurística "trig ⇒ infinitas" (válida solo para y=f(x)/implícitas
    // sobre x∈ℝ). El host ahora fuerza esTrig=false para paramétricas/polares → se
    // cuentan los eventos de un período, deduplicados por posición (lo hace resumen).
    const vp = crearViewport([-12, 12], [-7, 7], 900, 390, 1);
    const g = crearProveedor(construirObjeto("(sin(2t), sin(3t))", "id")).geometria(vp, TOL_FINAL);
    const r = resumenPuntosNotables(g.ramas, "id", vp);

    // Analíticamente, sobre [0,2π): x=sin(2t)=0 en t=kπ/2 → Y-cruces en y∈{0,−1,1};
    // y=sin(3t)=0 en t=kπ/3 → X-cruces en x∈{0, ±√3/2}. Tras deduplicar: 3 y 3.
    igual(r.interseccionesY.length, 3, "3 intersecciones-Y distintas por período");
    igual(r.raices.length, 3, "3 raíces distintas por período");
    for (const p of r.interseccionesY) assert(Math.abs(p.punto.y) < 1.001, "Y-cruce acotado en [−1,1]");
    assert(r.raices.some((p) => Math.abs(Math.abs(p.punto.x) - Math.sqrt(3) / 2) < 0.02), "raíz en ±√3/2");
    assert(r.raices.some((p) => Math.abs(p.punto.x) < 0.02), "raíz en x=0");

    // Con la clasificación acotada (esTrig=false) NINGUNA categoría es "infinitas":
    // son finitas ("normal") o, si hubiera muchas en la vista, "demasiadas" —nunca
    // el falso "infinitas" que salía al tratar la tupla como una trig de x.
    for (const n of [r.interseccionesY.length, r.raices.length, r.vertices.length])
      assert(estadoGrupo(n, false) !== "infinitas", "paramétrica acotada: jamás 'infinitas'");
    // Y se documenta el bug que se corrige: con esTrig=true SÍ daría el falso positivo.
    igual(estadoGrupo(r.interseccionesY.length, true), "infinitas", "regresión: esTrig=true reproduce el bug");

    // Vértices = extremos GEOMÉTRICOS reales de la curva (no del parámetro), COMPLETOS:
    // 6 en y (tangente horizontal, dy/dt=0 → cimas/valles en y=±1) + 4 en x (tangente
    // vertical, dx/dt=0 → puntos más a izq/der en x=±1). Los 10 lados del "bounding
    // box" de la Lissajous. Cada uno debe ser tangente horizontal O vertical.
    igual(r.vertices.length, 10, "10 extremos geométricos (6 en y + 4 en x)");
    const tieneVert = (vx: number, vy: number) =>
      r.vertices.some((p) => Math.abs(p.punto.x - vx) < 0.02 && Math.abs(p.punto.y - vy) < 0.02);
    assert(tieneVert(1, Math.SQRT1_2) && tieneVert(-1, -Math.SQRT1_2), "extremos en x (tang. vertical) (±1,±0.707)");
    assert(tieneVert(0, 1) && tieneVert(0, -1), "extremos en y (tang. horizontal) (0,±1)");
    // Cada vértice es un extremo REAL de la curva: tangente ~horizontal (dy/dt≈0) o
    // ~vertical (dx/dt≈0). Recupera el t más cercano y comprueba que UNA derivada se
    // anula. Descarta que sean artefactos del muestreo del parámetro.
    const cx = (t: number) => Math.sin(2 * t), cy = (t: number) => Math.sin(3 * t);
    const dcx = (t: number) => 2 * Math.cos(2 * t), dcy = (t: number) => 3 * Math.cos(3 * t);
    for (const p of r.vertices) {
      let bt = 0, bd = Infinity;
      for (let t = 0; t < 2 * Math.PI; t += 5e-4) {
        const d = Math.hypot(cx(t) - p.punto.x, cy(t) - p.punto.y);
        if (d < bd) { bd = d; bt = t; }
      }
      assert(Math.abs(dcy(bt)) < 0.06 || Math.abs(dcx(bt)) < 0.06,
        `vértice (${p.punto.x.toFixed(2)},${p.punto.y.toFixed(2)}) es extremo real (tangente H o V)`);
    }
  });

  test("círculo paramétrico (cos t, sin t): 4 extremos incl. el de la COSTURA (1,0)", () => {
    // Verifica el manejo del cierre: el punto más a la derecha (1,0) cae en t=0, la
    // costura de la rama cerrada. Sin tratar la costura como punto interior se perdería.
    const vp = crearViewport([-2, 2], [-1.6, 1.6], 900, 720, 1);
    const g = crearProveedor(construirObjeto("(cos(t), sin(t))", "id")).geometria(vp, TOL_FINAL);
    const r = resumenPuntosNotables(g.ramas, "id", vp);
    igual(r.vertices.length, 4, "4 extremos: (±1,0) izq/der y (0,±1) arriba/abajo");
    const tiene = (vx: number, vy: number) =>
      r.vertices.some((p) => Math.abs(p.punto.x - vx) < 0.02 && Math.abs(p.punto.y - vy) < 0.02);
    assert(tiene(1, 0), "extremo derecho (1,0) en la costura t=0 (no se pierde)");
    assert(tiene(-1, 0) && tiene(0, 1) && tiene(0, -1), "los otros tres extremos");
  });

  test("INVARIANZA implícita↔explícita: x³+y³=9 da los mismos puntos que y=∛(9−x³)", () => {
    const vp = crearViewport([-12, 12], [-7, 7], 900, 390, 1);
    const firma = (src: string): string =>
      crearProveedor(construirObjeto(src, "id")).geometria(vp, TOL_FINAL).puntosNotables
        .map((p) => `${p.tipo}(${p.punto.x.toFixed(2)},${p.punto.y.toFixed(2)})`).sort().join(" ");
    // La implícita se traza por continuación pero despeja y=f(x) para los puntos notables.
    igual(firma("x^3 + y^3 = 9"), firma("y = cbrt(9 - x^3)"), "cúbica implícita ≡ explícita");
    assert(firma("x^3 + y^3 = 9").includes("raiz(2.08,0.00)"), "tiene la raíz (∛9, 0)");
    assert(firma("x^3 + y^3 = 9").includes("interseccion-y(0.00,2.08)"), "tiene la intersección Y");

    // Círculo: las dos ramas ±√ comparten extremos → DEDUP (sin raíces repetidas).
    const circ = crearProveedor(construirObjeto("x^2+y^2=9", "id")).geometria(vp, TOL_FINAL).puntosNotables;
    const raicesCirc = circ.filter((p) => p.tipo === "raiz");
    igual(raicesCirc.length, 2, "círculo: exactamente 2 raíces (±3), no duplicadas");

    // No despejable (a·yⁿ+c(x) no aplica) → sin puntos (fallback), sin romper.
    const noSep = crearProveedor(construirObjeto("x^2 + y^2 + x*y = 9", "id")).geometria(vp, TOL_FINAL);
    igual(noSep.puntosNotables.length, 0, "implícita no separable → sin puntos (fallback implícito)");
  });
});

// ════════════════════════════════════════════════
// Transformaciones del panel (strings re-parseables → LaTeX): Despejar y / Simplificar.
// Alimentan el toggle [Original][Opciones ▾]. Se comparan por su LaTeX final.
describe("Transformaciones del panel: Despejar y / Simplificar", () => {
  const despLatex = (ec: string) => bloqueALatex(despejarEcuaciones([ec]));
  const simpLatex = (ec: string) => bloqueALatex(simplificarEcuaciones([ec]));

  test("Despejar y: ORDEN CANÓNICO en lo polinómico (variables antes que constantes)", () => {
    // `mx + b`, no `b + mx`: el despeje sale directo en forma canónica (el `- x` con
    // espacio es cosmético de mathjs; KaTeX lo colapsa a `-x`).
    igual(despLatex("2x + y = 6"), "y=-2x+6", "2x+y=6 → y=-2x+6");
    igual(despLatex("x + y = 8"), "y=- x+8", "x+y=8 → y=-x+8");
    igual(despLatex("x + y = 2"), "y=- x+2", "x+y=2 → y=-x+2");
    igual(despLatex("3x - y = 1"), "y=3x-1", "3x−y=1 → y=3x−1");
  });

  test("Despejar y: raíz n-ésima impar; el radicando conserva 'positivos primero'", () => {
    // Dentro de la raíz NO se aplica el orden canónico (se conserva `9 - x³`, como pediste).
    igual(despLatex("x^3+y^3=9"), "y=\\sqrt[3]{9-x^{3}}", "x³+y³=9 → y=∛(9−x³)");
    igual(despLatex("x^{3}+y^{3}=9"), "y=\\sqrt[3]{9-x^{3}}", "entrada LaTeX con llaves: idéntico");
    igual(despLatex("y^5 = 2 - x"), "y=\\sqrt[5]{2- x}", "y⁵=2−x → y=⁵√(2−x)");
    igual(despLatex("2 y^3 = x"), "y=\\sqrt[3]{\\frac{x}{2}}", "coef+potencia → raíz de la fracción");
  });

  test("Despejar y: valor ABSOLUTO de y (incl. recíproco) se aísla hasta y = ±(…)", () => {
    // Antes se quedaba PARCIAL en `1/|y| = 1 − 1/|x|`: el factor con y no era `y`, `yⁿ` ni
    // `ⁿ√y`, así que solo actuaba el despeje multiplicativo. Ahora se invierte el exponente
    // (|y| = |x|/(|x|−1)) y el absoluto abre las DOS ramas con el centinela `pm`.
    igual(despLatex("|x|^{-1}+|y|^{-1}=1"), "y=\\pm \\frac{\\left| x\\right|}{\\left| x\\right|-1}",
      "1/|x|+1/|y|=1 → y=±|x|/(|x|−1)");
    igual(despLatex("2|y| = x"), "y=\\pm \\frac{x}{2}", "coeficiente: 2|y|=x → y=±x/2");
    igual(despLatex("|y|^{2} = x"), "y=\\pm \\sqrt{x}", "|y|²=x → y=±√x (sqrt, sin índice)");
    // El argumento del ± con una SUMA necesita paréntesis: `\pm x-1` se leería `(\pm x)-1`.
    igual(despLatex("|y| = x - 1"), "y=\\pm\\left( x-1\\right)", "|y|=x−1 → y=±(x−1), con paréntesis");
  });

  test("Despejar y: potencia PAR se despeja hasta y = ±√(…) (radicando 'positivos primero')", () => {
    // Antes se detenía en `y²=…`; ahora aísla y como el par ± de raíces, con el radicando
    // normalizado a `16 - x²` (positivos primero, no `-x² + 16`). El ± va con `pm(·)` → `\pm`.
    igual(despLatex("x^2+y^2=16"), "y=\\pm \\sqrt{16-x^{2}}", "círculo r=4 → y=±√(16−x²)");
    igual(despLatex("x^2+y^2=25"), "y=\\pm \\sqrt{25-x^{2}}", "círculo r=5 → y=±√(25−x²)");
    igual(despLatex("y^2 = x"), "y=\\pm \\sqrt{x}", "y²=x → y=±√x");
    igual(despLatex("y^4 = x"), "y=\\pm \\sqrt[4]{x}", "par n≥4 usa nthRoot → y=±⁴√x");
    // Sistema (caso reportado): solo la ecuación par se despeja; la lineal se conserva.
    igual(bloqueALatex(despejarEcuaciones(["x^2+y^2=25", "y=x+1"])),
      "\\begin{cases}\\begin{aligned}y&=\\pm \\sqrt{25-x^{2}}\\\\[1ex]y&=x+1\\end{aligned}\\end{cases}",
      "sistema: y=±√(25−x²) ; y=x+1");
  });

  test("Despejar y: CUADRÁTICA en y² (bicuadrática) por la fórmula reducida", () => {
    // Caso reportado (lemniscata): (x²+y²)²−2(x²−y²)=0 es cuadrática en u=y²; se resuelve
    // por completar cuadrados → y=±√(−(x²+1)+√(4x²+1)). Antes daba el parcial 2x²y²+y⁴+2y²=…
    igual(despLatex("\\left(x^{2}+y^{2}\\right)^{2}-2\\cdot\\left(x^{2}-y^{2}\\right)"),
      "y=\\pm \\sqrt{-\\left(x^{2}+1\\right)+\\sqrt{4x^{2}+1}}",
      "lemniscata → y=±√(−(x²+1)+√(4x²+1))");
    // La rama física se valida numéricamente: y=+√(−(x²+1)+√(4x²+1)) cumple la ecuación
    // donde es real (|x|≤√2), y la rama −√(4x²+1) se descartó (nunca da y real).
    const rama = crearFuncionReal("sqrt(-(x^2+1)+sqrt(4*x^2+1))");
    for (const x of [-1.1, -0.4, 0.7, 1.2]) {
      const y = rama.eval(x) as number;
      const D = Math.pow(x * x + y * y, 2) - 2 * (x * x - y * y);
      aprox(D, 0, 1e-9, `(x²+y²)²−2(x²−y²)=0 en x=${x}`);
    }
    // Bicuadrática con DOS ramas reales → forma compacta anidada `±√(±√disc − p)`, correcta.
    const dos = despejarEcuaciones(["y^4 - 5*y^2 + 4 = 0"])[0];
    assert(/pm\(sqrt\(pm\(/.test(dos), `dos ramas → ± anidado: ${dos}`);
    // Sin solución real → no se fuerza el despeje (queda la forma implícita).
    assert(!/pm|sqrt/.test(despejarEcuaciones(["y^4 + y^2 + 1 = 0"])[0]),
      "y⁴+y²+1=0 (sin raíz real) no se despeja");
    // Cuadrática en y CON término lineal (g=1): ya NO queda fuera de alcance — se resuelve por
    // la fórmula general y=(−B±√(B²−4AC))/2A. y²+xy−x=0 → y=(−x±√(x²+4x))/2.
    const lineal = despejarEcuaciones(["y^2 + x*y - x = 0"])[0];
    assert(/^y = /.test(lineal) && /pm/.test(lineal), `g=1 se despeja del todo: ${lineal}`);
    for (const s of [1, -1]) {
      const rama = crearFuncionReal(`(-x + ${s}*sqrt(x^2 + 4*x))/2`);
      for (const x of [0.35, 0.7, 1.6, 3.2]) {
        const y = rama.eval(x) as number;
        aprox(y * y + x * y - x, 0, 1e-9, `y²+xy−x=0 en x=${x} (rama ${s > 0 ? "+" : "−"})`);
      }
    }
  });

  test("Despejar y: RAÍZ de y se invierte elevando (inverso de la raíz principal)", () => {
    // El caso reportado: la 2ª ecuación de un sistema `x−√y=27` quedaba `-√y=-x+27` en
    // vez de aislar y. Ahora se eleva al cuadrado → parábola completa.
    igual(despLatex("x-\\sqrt{y}=27"), "y={\\left( x-27\\right)}^{2}", "x−√y=27 → y=(x−27)²");
    igual(despLatex("\\sqrt{y}=x-3"), "y={\\left( x-3\\right)}^{2}", "√y=x−3 → y=(x−3)²");
    igual(despLatex("x-\\sqrt[3]{y}=1"), "y={\\left( x-1\\right)}^{3}", "cúbica: x−∛y=1 → y=(x−1)³");
    igual(despLatex("2\\sqrt{y}=x"), "y=\\left({\\frac{x}{2}}\\right)^{2}", "coef: 2√y=x → y=(x/2)²");
    // Encadenado con Simplificar: expande la potencia (lo que también pediste).
    const d = despejarEcuaciones(["x+y=2", "x-\\sqrt{y}=27"]);
    igual(bloqueALatex(simplificarEcuaciones(d)),
      "\\begin{cases}\\begin{aligned}y&=- x+2\\\\[1ex]y&=x^{2}-54x+729\\end{aligned}\\end{cases}",
      "sistema Despejar→Simplificar: y=-x+2 ; y=x²−54x+729");
  });

  test("Despejar y: expresión SUELTA con y libre se despeja como expr=0", () => {
    // Sin `=` pero con y libre: misma convención que construirObjeto (expr=0) — antes
    // `despejar` devolvía null y el menú quedaba deshabilitado (bug reportado).
    igual(despLatex("tan(y)(x^2+1)-sqrt(x+1)"), "\\tan y=\\frac{\\sqrt{x+1}}{x^{2}+1}",
      "tan(y)(x²+1)-√(x+1) → tan(y)=√(x+1)/(x²+1)");
    igual(despLatex("x^3+y^3-9"), "y=\\sqrt[3]{9-x^{3}}", "x³+y³−9 → mismo despeje que con =9");
    // Sin y libre no hay nada que despejar: la expresión suelta queda intacta.
    igual(despejarEcuaciones(["x^2+1"])[0], "x^2+1", "sin y: intacta (sigue siendo f(x))");
  });

  test("Despejar y: trig y multiplicativo conservan 'positivos primero'", () => {
    igual(despLatex("tan(x) + y = 2"), "y=2-\\tan x", "trig: y=2−tan(x) (no −tan(x)+2)");
    igual(despLatex("tan(y)(x^2+1)=sqrt(x+1)"), "\\tan y=\\frac{\\sqrt{x+1}}{x^{2}+1}", "multiplicativo");
    // Sin `=`, sin y → se deja igual (el botón se deshabilitaría).
    igual(despejarEcuaciones(["x+x+x"])[0], "x+x+x", "sin `=` → sin cambio");
    igual(despejarEcuaciones(["y=x^2"])[0].replace(/\s/g, ""), "y=x^2", "ya despejada → sin cambio");
  });

  test("Despejar produce forma CANÓNICA → Simplificar después es un NO-OP", () => {
    // El bug reportado: despejar daba `y=6-2x` y Simplificar lo cambiaba a `y=-2x+6`.
    // Ahora despejar ya sale canónico, así que Simplificar no cambia nada (botón off).
    for (const ec of ["2x + y = 6", "x + y = 8", "x^3+y^3=9", "x^2+y^2=9",
                      "tan(x)+y=2", "tan(y)(x^2+1)=sqrt(x+1)"]) {
      const d = despejarEcuaciones([ec]);
      igual(bloqueALatex(simplificarEcuaciones(d)), bloqueALatex(d), `${ec}: Simplificar(Despejar) = Despejar`);
      igual(bloqueALatex(despejarEcuaciones(d)), bloqueALatex(d), `${ec}: Despejar idempotente`);
    }
  });

  test("Simplificar: reduce/expande en orden canónico; deshabilitado si ya está simple", () => {
    igual(simpLatex("x+x+x"), "f(x)=3x", "x+x+x → 3x");
    igual(simpLatex("(x+1)^2"), "f(x)=x^{2}+2x+1", "(x+1)² expandido (variables antes que 1)");
    igual(simpLatex("y = 2x + 3x - x"), "y=4x", "reduce términos semejantes");
    igual(simpLatex("y = 6 - 2x"), "y=-2x+6", "canónico: 6−2x → -2x+6");
    igual(simpLatex("y = 8 - x"), "y=- x+8", "canónico: 8−x → -x+8");
    igual(simpLatex("sin(x)"), "f(x)=\\sin x", "no simplificable → igual (botón off)");
    igual(simpLatex("x^2+y^2=9"), "x^{2}+y^{2}=9", "ya simple → igual");
  });

  test("Simplificar: FRACCIONES exactas, no decimales (x/2 → x/2, no 0.5x)", () => {
    // El bug reportado: `rationalize` serializaba los racionales como decimales
    // (`x/2`→`0.5x`, `x/3`→`0.333…x`). Ahora se recupera la fracción exacta.
    igual(simpLatex("x/2"), "f(x)=\\frac{x}{2}", "x/2 se queda x/2 (¡no 0.5x!)");
    igual(simpLatex("x/3"), "f(x)=\\frac{x}{3}", "x/3 → x/3 (no 0.333…x)");
    igual(simpLatex("x^2/4"), "f(x)=\\frac{x^{2}}{4}", "x²/4 → x²/4 (no 0.25x²)");
    igual(simpLatex("3x/4"), "f(x)=\\frac{3x}{4}", "3x/4 → 3x/4 (no 0.75x)");
    igual(simpLatex("x/2 + x/3"), "f(x)=\\frac{5x}{6}", "combina fracciones: x/2+x/3 → 5x/6");
    igual(simpLatex("2x/6"), "f(x)=\\frac{x}{3}", "reduce: 2x/6 → x/3");
    igual(simpLatex("100x/25"), "f(x)=4x", "reduce a entero: 100x/25 → 4x");
    igual(simpLatex("-x/3 - x/3"), "f(x)=\\frac{-2x}{3}", "negativo: -x/3-x/3 → -2x/3 (num con signo)");
    igual(simpLatex("(x+2)/2"), "f(x)=\\frac{x}{2}+1", "distribuye: (x+2)/2 → x/2 + 1");
    igual(simpLatex("1/2 + 1/2"), "f(x)=1", "constantes: 1/2+1/2 → 1");
    igual(simpLatex("sin(x)/2"), "f(x)=\\frac{\\sin x}{2}", "función/constante intacta: sin(x)/2");
    // Coeficiente IRRACIONAL: no se fuerza a fracción monstruosa (se deja el decimal).
    igual(simpLatex("sqrt(2)*x"), "f(x)=1.4142135623730951x", "√2·x: irracional, no se racionaliza");
    // La expansión (rationalize) sigue viva y ahora convive con las fracciones.
    igual(simpLatex("(x+1)^2"), "f(x)=x^{2}+2x+1", "expandir sigue funcionando");
  });

  test("Despejar: coeficiente FRACCIONARIO y reducción (y/2=x → y=2x, no y=x2)", () => {
    // El bug reportado: `y/2=x` daba el sinsentido `y=x2` (y/n no se reconocía como
    // lineal). Ahora se invierte la fracción y se reduce/ordena.
    igual(despLatex("y/2 = x"), "y=2x", "y/2=x → y=2x (¡no y=x2!)");
    igual(despLatex("y/3 = x - 1"), "y=3x-3", "y/3=x−1 → y=3x−3 (distribuye)");
    igual(despLatex("-y/2 = x"), "y=-2x", "-y/2=x → y=-2x (menos en la y)");
    igual(despLatex("2y/3 = x"), "y=\\frac{3x}{2}", "2y/3=x → y=3x/2");
    igual(despLatex("4y = 2x"), "y=\\frac{x}{2}", "reduce: 4y=2x → y=x/2 (¡no 2x/4!)");
    igual(despLatex("-2y = x"), "y=\\frac{- x}{2}", "coef negativo: -2y=x → y=-x/2 (no x/-2)");
    igual(despLatex("2y = x"), "y=\\frac{x}{2}", "2y=x → y=x/2");
    igual(despLatex("x*y = 6"), "y=\\frac{6}{x}", "coef simbólico intacto: xy=6 → y=6/x");
    // Coeficiente ±1 (forma canónica directa) SIN cambios de regresión.
    igual(despLatex("2x + y = 6"), "y=-2x+6", "coef 1 sigue canónico y=-2x+6");
    igual(despLatex("3x - y = 1"), "y=3x-1", "coef −1 sigue canónico y=3x−1");
  });

  test("Derivada (obs-derivate): fracción ÚNICA, no anidada (d/dx √x → 1/(2√x))", () => {
    // El bug reportado: `derivative` serializa `d/dx √x` como `(1/2)/√x` → fracción
    // ANIDADA `\frac{\frac{1}{2}}{\sqrt{x}}`. `racionalizarFracciones` la colapsa.
    igual(derivadaLatex(["sqrt(x)"]), "f'\\left(x\\right) = \\frac{1}{2\\sqrt{x}}",
      "d/dx √x → 1/(2√x), no fracción anidada");
    igual(derivadaLatex(["sqrt(x)/2"]), "f'\\left(x\\right) = \\frac{1}{4\\sqrt{x}}",
      "d/dx √x/2 → 1/(4√x)");
    igual(derivadaLatex(["3*sqrt(x)"]), "f'\\left(x\\right) = \\frac{3}{2\\sqrt{x}}",
      "d/dx 3√x → 3/(2√x)");
    // Regresión: derivadas SIN fracción decimal quedan como las da mathjs (menos fuera).
    igual(derivadaLatex(["1/x"]), "f'\\left(x\\right) = -\\frac{1}{x^{2}}",
      "d/dx 1/x → -1/x² (menos FUERA, sin tocar)");
    igual(derivadaLatex(["x^2"]), "f'\\left(x\\right) = 2x", "d/dx x² → 2x (intacta)");
    igual(derivadaLatex(["sin(x)"]), "f'\\left(x\\right) = \\cos x", "d/dx sin x → cos x");
  });

  test("Derivada (obs-derivate): simplificación algebraica posterior (fracción única)", () => {
    // El caso reportado: d/dx arctan(√(x+1)/(x²+1)) salía con CUATRO niveles de fracción
    // (`derivative` no combina). La etapa `simplificarDerivada` (sqrt(u)²→u +
    // `combinarFracciones`: común denominador, cancelación, numerador expandido) la deja
    // en una sola fracción. Solo se adopta si es numéricamente EQUIVALENTE a la cruda
    // (mismos valores y mismo dominio en la muestra) y más corta.
    igual(derivadaLatex(["atan(sqrt(x+1)/(x^2+1))"]),
      "f'\\left(x\\right) = \\frac{-3x^{2}-4x+1}{2\\sqrt{x+1}\\left( x+1+{\\left(x^{2}+1\\right)}^{2}\\right)}",
      "derivada de arctan compuesta → una sola fracción compacta");
    // Cociente: fracción combinada con el denominador al cuadrado (regla del cociente).
    igual(derivadaLatex(["x/(x^2+1)"]),
      "f'\\left(x\\right) = \\frac{1-x^{2}}{{\\left(x^{2}+1\\right)}^{2}}",
      "d/dx x/(x²+1) → (1−x²)/(x²+1)²");
    // Fracción anidada del cociente: (2x − x²/(x+1))/(x+1) → (x²+2x)/(x+1)².
    igual(derivadaLatex(["x^2/(x+1)"]),
      "f'\\left(x\\right) = \\frac{x^{2}+2x}{{\\left( x+1\\right)}^{2}}",
      "d/dx x²/(x+1): fracción anidada colapsada");
    // Las derivadas ya compactas quedan INTACTAS (la candidata no es más corta).
    igual(derivadaLatex(["x^2"]), "f'\\left(x\\right) = 2x", "2x intacta");
    igual(derivadaLatex(["1/x^2"]), "f'\\left(x\\right) = -\\frac{2}{x^{3}}", "-2/x³ intacta");
  });

  test("Derivada (obs-derivate): producto DISTRIBUIDO en vez de fracción de fracciones", () => {
    // d/dx(arccot(x²)·√x): la forma combinada es UNA fracción cuyo numerador vuelve a
    // llevar fracciones —`(arccot(x²)/2 − 2x²/(x⁴+1))/√x`—. La candidata `derivadaDistribuida`
    // aplica la regla del producto por términos y limpia cada uno por separado, dando términos
    // PLANOS (menos anidamiento de fracciones), que `simplificarDerivada` prefiere.
    igual(derivadaLatex(["arccot(x^2)*sqrt(x)"]),
      "f'\\left(x\\right) = \\frac{\\operatorname{arccot}\\left(x^{2}\\right)}{2\\sqrt{x}}-\\frac{2x\\sqrt{x}}{x^{4}+1}",
      "arccot(x²)·√x → términos planos, no fracción de fracciones");
    // La regla del producto también compacta lo que se cancela: d/dx(x·ln x) = ln x + 1.
    igual(derivarExpr("x*log(x)"), "log(x) + 1", "d/dx(x·ln x) = ln x + 1");
    // Un cociente NO se reparte (sería la regla del cociente, que mathjs ya combina bien):
    // se conserva la fracción única del test anterior.
    igual(derivadaLatex(["x/(x^2+1)"]),
      "f'\\left(x\\right) = \\frac{1-x^{2}}{{\\left(x^{2}+1\\right)}^{2}}",
      "cociente: sigue en fracción única (no se distribuye)");
  });

  // La salida LaTeX ordena la suma polinómica de nivel superior en grado DESCENDENTE
  // (x² antes que x antes que la constante), aunque mathjs entregue el string sin ordenar
  // (`2x + x^2`). Es cosmético: el string que grafica el motor NO cambia (ver el `grafica`
  // del trazador), solo la tipografía del panel. Bug reportado: `f'(x)=2x+x²` debía pintarse
  // `x²+2x`.
  test("LaTeX: los términos del polinomio van en grado descendente", () => {
    // Caso reportado: d/dx(x³/3+x²−5) = 2x+x² debe MOSTRARSE como x²+2x.
    igual(derivadaLatex(["\\frac{x^{3}}{3}+x^{2}-5"]), "f'\\left(x\\right) = x^{2}+2x",
      "d/dx(x³/3+x²−5) → x²+2x (no 2x+x²)");
    // Una expresión suelta cualquiera: el orden se aplica en todo el pipeline compartido.
    igual(exprALatex("2*x + x^2"), "x^{2}+2x", "2x+x² → x²+2x");
    // (El espacio en `+ x` es artefacto tipográfico de mathjs ante un símbolo suelto —el
    // mismo que aparece en `\left( x+1`—; KaTeX lo ignora.)
    igual(exprALatex("3 - x^2 + x"), "-x^{2}+ x+3", "reordena con signos: 3−x²+x → -x²+x+3");
    igual(exprALatex("1 + x^3 + x"), "x^{3}+ x+1", "cúbico: 1+x³+x → x³+x+1");
    // Términos NO polinómicos (función de x) → se deja el orden de mathjs INTACTO.
    igual(exprALatex("1 + sin(x)"), "1+\\sin x", "no polinómico: no se reordena");
    // Lo ya descendente queda idéntico (regresión: sin reordenar de más).
    igual(exprALatex("x^2 - 5"), "x^{2}-5", "ya descendente: intacto");
  });

  test("Derivada (obs-derivate): el usuario escribe el OPERADOR y se desenvuelve", () => {
    // Bug reportado: escribir `\frac{d}{dx}(x^2)` en el bloque hacía que `d` se tratara
    // como variable (→ `d·x²/(d·x)`) y el panel pintara un operador anidado. Ahora se
    // reconoce el operador de Leibniz y se deriva su argumento igual que si se escribiera
    // solo `x^2`. Con `(…)` y con `\left(…\right)`, y con espacios.
    igual(derivadaLatex(["\\frac{d}{dx}(x^{2})"]), "f'\\left(x\\right) = 2x",
      "operador con (…) → deriva el interior x²");
    igual(derivadaLatex(["\\frac{d}{dx}\\left(x^{2}\\right)"]), "f'\\left(x\\right) = 2x",
      "operador con \\left(…\\right) → igual");
    igual(derivadaLatex(["  \\frac{d}{ dx }\\left( sin(x) \\right)"]),
      "f'\\left(x\\right) = \\cos x", "tolera espacios en el operador");
    // Operador SIN paréntesis: el prefijo `\frac{d}{dx}` es siempre el operador (en este
    // bloque `d` no es una variable), así que su argumento se deriva igual que agrupado.
    // Antes esto dejaba pasar `d` al parser (`d·x²/(d·x)`) y graficaba basura (→ `1`).
    igual(derivadaLatex(["\\frac{d}{dx} x^2"]), "f'\\left(x\\right) = 2x",
      "operador sin paréntesis → deriva x² igual (antes: basura)");
    // Sin grupo que envuelva TODO, el resto entero es el argumento: ambas grafías coinciden
    // (y ahora dan la derivada correcta de x+1, no una basura que solo casualmente coincidía).
    igual(derivadaLatex(["\\frac{d}{dx}(x)+1"]), derivadaLatex(["\\frac{d}{dx} x + 1"]),
      "sin grupo que envuelva TODO: el resto entero es el argumento");
    igual(derivadaLatex(["\\frac{d}{dx} x + 1"]), "f'\\left(x\\right) = 1",
      "d/dx(x+1) = 1 (correcta, no basura con `d` de variable)");
    // Otra variable de derivación (`\frac{d}{dy}`) o notación `dy/dx`: este bloque solo
    // deriva respecto de x → se RECHAZA en vez de derivar wrt x igual o filtrar `d`.
    igual(derivadaLatex(["\\frac{d}{dy}(x^2)"]), "f'\\left(x\\right) = \\text{[...]}",
      "\\frac{d}{dy} no es derivable por este bloque → sin resultado");
    igual(derivadaLatex(["\\frac{dy}{dx}"]), "f'\\left(x\\right) = \\text{[...]}",
      "dy/dx (Leibniz) → sin resultado (antes: -(y/x²) basura)");
    // Implícita escrita SIN `=` (`y` libre): no es una f(x) → no se deriva como ∂/∂x.
    igual(derivadaLatex(["x^2+y^2-16"]), "f'\\left(x\\right) = \\text{[...]}",
      "y libre → implícita, no f(x) (antes: ∂/∂x silencioso → 2x)");
    igual(derivadaLatex(["x^2+y^2=16"]), "f'\\left(x\\right) = \\text{[...]}",
      "misma implícita con `=` → coherente, tampoco se deriva");
  });
});

// ════════════════════════════════════════════════
// Tipografía LaTeX: símbolo con nombre × variable, y paréntesis escalables (src/latex.ts).
// ════════════════════════════════════════════════
describe("latex.ts: símbolo·variable y paréntesis escalables", () => {
  test("símbolo con nombre × variable NO se pega al comando (evita `\\pix` en rojo)", () => {
    // Bug: `\pi\cdot x` colapsaba a `\pix` (comando inexistente → KaTeX en rojo). Ahora la
    // variable va en llaves: `\pi{x}` (π·x). Vale con coeficiente delante.
    igual(exprALatex("pi*x"), "\\pi{x}", "π·x → \\pi{x}, no \\pix");
    igual(exprALatex("5*pi*x"), "5\\pi{x}", "5·π·x → 5\\pi{x}");
    igual(exprALatex("pi*theta"), "\\pi\\theta", "comando·comando SÍ se pega (válido)");
  });

  test("todos los paréntesis quedan escalables \\left(…\\right)", () => {
    igual(exprALatex("2*(x+1)"), "2\\left( x+1\\right)", "( → \\left(  ) → \\right)");
    // No se duplica lo que ya es escalable ni se rompen comandos con llaves.
    assert(!/(?<!\\left)\(/.test(exprALatex("(x+1)*(x-1)")), "sin paréntesis sin escalar");
    igual(exprALatex("sqrt(x)"), "\\sqrt{x}", "\\sqrt{} intacto (no toca sus llaves)");
  });

  test("constantes con nombre (π, e) DELANTE y términos semejantes combinados", () => {
    const s = (ec: string) => simplificarEcuaciones([ec])[0];
    // π delante de la variable y 5πx−xπ combinado a 4πx (rationalize los dejaba sueltos).
    igual(s("(x^2+5x-x)*pi"), "pi * x ^ 2 + 4 * pi * x", "π delante + combinado");
    igual(exprALatex(s("(x^2+5x-x)*pi")), "\\pi{x}^{2}+4\\pi{x}", "LaTeX: \\pi delante, sin espacio");
    igual(s("5*pi*x - x*pi"), "4 * pi * x", "junta 5πx−xπ → 4πx");
    igual(s("x^2*pi"), "pi * x ^ 2", "x²·π → π·x²");
    igual(s("3*x*e + 2*e*x"), "5 * e * x", "e también va delante y combina");
    // Polinomios SIN constante con nombre: orden canónico intacto (variables antes que constantes).
    igual(s("2*x + 6"), "2 * x + 6", "sin π: canónico intacto");
    igual(s("-2*x + 6"), "-2 * x + 6", "sin π: negativo al frente intacto");
  });

  test("coeficiente NEGATIVO con π: el menos unario de mathjs no rompe el orden", () => {
    const s = (ec: string) => simplificarEcuaciones([ec])[0];
    // `-pi*(2x+4)` distribuye a `pi * -2 * x - 4 * pi` (el −2 es OperatorNode unario,
    // no ConstantNode): sin reconocerlo, el panel mostraba el erróneo `\pi-2x-4\pi`.
    igual(s("-pi*(2*x+4)"), "-2 * pi * x - 4 * pi", "coeficiente al frente con signo");
    igual(exprALatex(s("-pi*(2*x+4)")), "-2\\pi{x}-4\\pi", "LaTeX: -2πx−4π");
    igual(exprALatex(s("pi*(2*x+4)")), "2\\pi{x}+4\\pi", "sin signo: intacto (regresión)");
  });

  test("Simplificar: log(e^u) = u (identidad válida en TODO ℝ)", () => {
    const s = (ec: string) => simplificarEcuaciones([ec])[0];
    igual(s("log(e^(3*x))"), "3 * x", "ln(e^{3x}) → 3x");
    igual(s("sin(x) + log(e^(2*x))"), "sin(x) + 2 * x", "dentro de una suma");
    // La inversa e^(log u)=u NO se aplica (solo vale para u>0: cambiaría el dominio).
    igual(s("e^(log(x))"), "e ^ log(x)", "e^{ln x} intacto (dominio x>0)");
  });

  test("Simplificar: aplana la FRACCIÓN DE FRACCIONES (mismo criterio que la derivada)", () => {
    const s = (ec: string) => simplificarEcuaciones([ec])[0];
    // Con una función, `rationalize` se rinde y `simplify` deja la fracción anidada
    // `(sin x/2 + cos x/3)/x`. `combinarFracciones` la aplana a UNA sola fracción, adoptada
    // por ser menos anidada y numéricamente equivalente (mismo dominio).
    // (El doble paréntesis del numerador es artefacto de `combinarFracciones`; se
    // re-parsea al pintar el LaTeX, que sale limpio: `\frac{3\sin x+2\cos x}{6x}`.)
    igual(s("(sin(x)/2 + cos(x)/3)/x"), "((3 * sin(x) + 2 * cos(x))) / (6 * x)",
      "fracción de fracciones con trig → una sola fracción");
    igual(exprALatex(s("(sin(x)/2 + cos(x)/3)/x")), "\\frac{3\\sin x+2\\cos x}{6x}",
      "LaTeX limpio de la fracción aplanada");
    // Lo YA plano queda intacto (no se toca lo que no está anidado).
    igual(s("x/(x^2+1)"), "x / (x ^ 2 + 1)", "fracción plana: intacta");
    // GUARDIÁN de dominio: aplanar cancelaría √x·√x=x y admitiría x<0 → se RECHAZA y se
    // conserva la forma fiel al dominio (√x sigue presente, indefinida en x<0).
    const dom = s("(sin(x)/sqrt(x))/sqrt(x)");
    assert(/sqrt/.test(dom), `conserva √x (dominio x≥0), no lo cancela: ${dom}`);
  });

  test("Simplificar: NO combina una suma de fracciones legible (función+raíz+impl.+fracción)", () => {
    const s = (ec: string) => simplificarEcuaciones([ec])[0];
    // Bug: `simplify` reescribía `arccot(x²)/(2√x) − 2x√x/(x⁴+1)` a una fracción de
    // fracciones `(arccot(x²)/2 − 2√x²x/(x⁴+1))/√x`, que luego se combinaba en la fea
    // `(arccot(x²)(x⁴+1) − 4√x²x)/(2√x(x⁴+1))`. Ahora, al ser una fracción de fracciones, se
    // recupera la ENTRADA ORIGINAL (más plana y equivalente): la forma legible del usuario.
    const r = s("arccot(x^2)/(2*sqrt(x)) - 2*x*sqrt(x)/(x^4+1)");
    igual(r, "(acot(x ^ 2)) / (2 * sqrt(x)) - 2 * x * sqrt(x) / (x ^ 4 + 1)",
      "suma de fracciones legible: conservada, no combinada");
    igual(exprALatex(r),
      "\\frac{\\operatorname{arccot}\\left(x^{2}\\right)}{2\\sqrt{x}}-\\frac{2x\\sqrt{x}}{x^{4}+1}",
      "LaTeX de la forma legible (arccot + raíz + producto implícito + fracciones)");
    // NO debe aparecer la fracción combinada ni `sqrt(x)^2`.
    assert(!/\\frac\{[^}]*\\operatorname\{arccot\}[^}]*\\left\(x\^\{4\}\+1\\right\)/.test(exprALatex(r)),
      `no combina en una sola fracción: ${exprALatex(r)}`);
  });

  test("LaTeX: variable pegada a función/raíz NO se fusiona en identificador (xsqrt, xsin)", () => {
    // Bug: `ladoALatex` normalizaba SIN insertar el producto implícito, así que `2x\sqrt{x}`
    // → `2xsqrt(x)` y mathjs leía `xsqrt` como FUNCIÓN → `\frac{2\mathrm{xsqrt}(x)}{…}`. Ahora
    // inserta el `*` (como el motor) → `x` y `\sqrt{x}` quedan separados.
    igual(exprALatex(String.raw`2x\sqrt{x}`), "2x\\sqrt{x}", "2x√x no se fusiona en xsqrt");
    igual(exprALatex(String.raw`\frac{2x\sqrt{x}}{x^4+1}`), "\\frac{2x\\sqrt{x}}{x^{4}+1}",
      "fracción con producto implícito y raíz");
    igual(exprALatex("x*sin(x)"), "x\\sin x", "x·sin(x) explícito intacto");
    igual(exprALatex("3xy"), "3xy", "producto implícito puro: intacto");
    // Regresión: NO debe aparecer \mathrm{xsqrt}/\mathrm{xsin} en ninguno.
    assert(!/mathrm\{x(sqrt|sin)/.test(exprALatex(String.raw`2x\sqrt{x}`)), "sin \\mathrm{xsqrt}");
  });
});

// ════════════════════════════════════════════════
// Herramienta de desarrollo: trazador de transformaciones (src/herramientas/). No pinta
// nada; reproduce paso a paso lo que ENTREGA (string mathjs) y RENDERIZA (LaTeX) cada
// bloque, reutilizando el MISMO pipeline que el panel. Protege el contrato de esa salida.
// ════════════════════════════════════════════════
describe("Herramienta: trazador de transformaciones", () => {
  test("parsearEntrada: [a/b] separa por / DENTRO de corchetes; x/2 sin corchetes es división", () => {
    igual(parsearEntrada("[x^2/x^3]").join("|"), "x^2|x^3", "corchetes → dos ecuaciones");
    igual(parsearEntrada("x/2").join("|"), "x/2", "sin corchetes: / es división, una ecuación");
    igual(parsearEntrada("[ a / b / c ]").join("|"), "a|b|c", "recorta espacios; 3 ecuaciones");
  });

  test("normalizarTipo: acepta nombres de bloque, cortos y sinónimos en español", () => {
    igual(normalizarTipo("obs-system"), "system", "obs-system → system");
    igual(normalizarTipo("sistema"), "system", "sinónimo español");
    igual(normalizarTipo("obs-derivate"), "derivate", "obs-derivate → derivate");
    igual(normalizarTipo("derivada"), "derivate", "sinónimo español");
    igual(normalizarTipo("cualquier-cosa"), "graph", "desconocido → graph por defecto");
  });

  test("trazar graph: Original → Simplificado → Despejar y, con mathjs y LaTeX", () => {
    const t = trazar("x^3+y^3=9", "graph");
    igual(t.bloques.length, 1, "una curva");
    const p = t.bloques[0].pasos;
    igual(p.map((s) => s.etiqueta).join(" | "),
      "Original (escrito) | Simplificado | Despejar y", "los tres pasos en orden");
    igual(p[2].mathjs[0], "y = nthRoot((9 - x ^ 3), 3)", "Despejar entrega el string graficable");
    igual(p[2].latex, "y=\\sqrt[3]{9-x^{3}}", "Despejar renderiza la raíz cúbica");
    igual(t.bloques[0].diagnostico[0].tipo, "implicita", "diagnóstico: tipo implícita");
  });

  test("trazar graph con [a/b]: dos curvas INDEPENDIENTES", () => {
    const t = trazar("[x^2/x^3]", "graph");
    igual(t.bloques.length, 2, "dos bloques independientes");
    igual(t.bloques[0].pasos[0].latex, "f(x)=x^{2}", "curva 1");
    igual(t.bloques[1].pasos[0].latex, "f(x)=x^{3}", "curva 2");
  });

  test("trazar derivate: operador (f simplificada) y derivada evaluada = lo graficado", () => {
    const t = trazar("\\frac{d}{dx}(x^2)", "derivate");
    const p = t.bloques[0].pasos;
    igual(p[0].latex, "\\frac{d}{dx}\\left(x^{2}\\right)", "operador desenvuelto y simplificado");
    igual(p[1].mathjs[0], "2 * x", "la derivada evaluada es el string que grafica el plano");
    igual(p[1].latex, "f'\\left(x\\right) = 2x", "LaTeX de la derivada");
  });

  test("trazar system: trata TODAS las ecuaciones como UN sistema (cases)", () => {
    const t = trazar("[x-y=1/x+y=3]", "system");
    igual(t.bloques.length, 1, "un solo bloque (el sistema entero)");
    igual(t.bloques[0].pasos[2].mathjs.join(" ; "), "y = x - 1 ; y = -x + 3", "despeja ambas");
    assert(t.bloques[0].pasos[0].latex.startsWith("\\begin{cases}"), "LaTeX en cases");
  });

  test("normalizarTipo: obs-integral y sinónimos → integral", () => {
    igual(normalizarTipo("obs-integral"), "integral", "obs-integral → integral");
    igual(normalizarTipo("integrar"), "integral", "sinónimo español");
  });

  test("trazar integral: EXTRAE límites/integrando ANTES del parser (no i*n*t)", () => {
    // Regresión: obs-integral caía a graph y el parser algebraico corrompía `\int`→i*n*t,
    // `dx`→d*x. Ahora se detecta la integral y SOLO el integrando pasa al parser.
    const t = trazar("\\int_{1/2}^{2}\\frac{\\arccot\\left(x^{2}\\right)}{2\\sqrt{x}}\\,dx", "integral");
    igual(t.tipo, "integral", "tipo integral (cabecera obs-integral)");
    const d = t.bloques[0].diagnostico[0];
    igual(d.tipo, "explicita", "el INTEGRANDO se clasifica como explícita");
    igual(d.normalizada, "(acot(x^(2)))/(2*sqrt(x))", "el parser recibe SOLO el integrando");
    assert(!/i\s*\*\s*n\s*\*\s*t/.test(d.normalizada), "no aparece i*n*t");
    assert(/inferior=1\/2/.test(d.extra ?? "") && /superior=2/.test(d.extra ?? "") && /variable=x/.test(d.extra ?? ""),
      `límites y variable extraídos: ${d.extra}`);
    // El plano grafica el integrando; sin primitiva elemental → valor numérico.
    igual(t.bloques[0].pasos[0].mathjs[0], "(acot(x^(2)))/(2*sqrt(x))", "grafica el integrando");
    assert(/\\approx 0\.507/.test(t.bloques[0].pasos[1].latex), "valor numérico ≈ 0.5074");
  });

  test("trazar integral: con primitiva elemental muestra la regla de Barrow", () => {
    const t = trazar("\\int_{0}^{2}x^2\\,dx", "integral");
    igual(t.bloques[0].pasos[1].etiqueta, "Primitiva evaluada (Barrow)", "paso de Barrow");
    igual(t.bloques[0].pasos[1].latex, "\\left[\\frac{x^{3}}{3}\\right]_{0}^{2} = \\frac{8}{3}", "[x³/3]₀²=8/3");
  });

  test("trazar integral: entrada que no es integral se avisa (no va al parser)", () => {
    const t = trazar("x^2+1", "integral");
    assert(/no es una integral/.test(t.bloques[0].diagnostico[0].tipo), "diagnóstico claro");
    igual(t.bloques[0].pasos.length, 0, "sin pasos (nada que trazar)");
  });
});

// ════════════════════════════════════════════════
// Carril SOBRE la curva en tramos casi verticales. Bug (2 iteraciones): en x³+y³=9
// la tangente vertical en (∛9, 0) hace que, a mucho zoom, el tramo trazado sea una
// ASTILLA de x más estrecha que un paso de A/D. (1º) railX la rebasaba, yEnCurva
// daba null y railY quedaba null PARA SIEMPRE (punto invisible, cámara perdida);
// (2º) conservar la última y dejaba el punto FLOTANDO fuera de la línea. Ahora el
// avance es por LONGITUD DE ARCO sobre la polilínea (avanzarPorArco): el punto se pega
// al borde del tramo y baja CABALGANDO la vertical, siempre sobre la curva.
// Se simula el bucle REAL de Navegacion+Camara con stubs de rAF/canvas/window.
describe("Carril: tangente vertical de x³+y³=9 (siempre sobre la curva)", () => {
  test("viajar → zoom-in profundo → cabalgar la vertical → zoom-out sigue en la línea", () => {
    const g = globalThis as Record<string, unknown>;
    if (!g.window) g.window = { devicePixelRatio: 1 };
    let pendiente: ((t: number) => void) | null = null;
    g.requestAnimationFrame = (cb: (t: number) => void) => { pendiente = cb; return 1; };
    g.cancelAnimationFrame = () => { pendiente = null; };

    const fakeCanvas = () => {
      const handlers: Record<string, (e: unknown) => void> = {};
      return {
        handlers, tabIndex: 0, style: {} as Record<string, string>,
        focus() {}, addEventListener(tipo: string, fn: (e: unknown) => void) { handlers[tipo] = fn; },
        removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {},
      };
    };
    const cnvCam = fakeCanvas(), cnvNav = fakeCanvas();
    const ctxNulo = null as unknown as CanvasRenderingContext2D;
    const escena = new Escena(construirObjetosEscena("x^3+y^3=9"),
      new Overlay(ctxNulo), new RendererCanvas2D(ctxNulo), new Crosshair(ctxNulo));
    const camara = new Camara(cnvCam as unknown as HTMLCanvasElement, 130,
      { onViewport: () => {}, onCursor: () => {} });
    camara.redimensionar(300);
    const nav = new Navegacion(cnvNav as unknown as HTMLCanvasElement, camara,
      {
        y: (x) => escena.yEnCurva(x),
        avanzarArco: (x, y, dPx, vp, recortar) => escena.avanzarArcoEnCurva(x, y, dPx, vp, recortar),
        hayVecina: (x, y, dir, vp) => escena.hayRamaVecinaCarril(x, y, dir, vp),
        tieneAsintotasVerticales: () => escena.tieneAsintotasVerticales(),
      },
      () => escena.actualizar(camara.viewport(), "interactiva"));

    let t = 0;
    const frame = (): boolean => {
      const cb = pendiente;
      if (!cb) return false;
      pendiente = null;
      t += 50;
      cb(t);
      return true;
    };
    const tecla = (k: string, abajo: boolean, shift = false) =>
      cnvNav.handlers[abajo ? "keydown" : "keyup"]({
        key: k, shiftKey: shift, preventDefault() {}, stopPropagation() {},
      });
    const semiY = () => (camara.viewport().domY[1] - camara.viewport().domY[0]) / 2;
    const yExacta = (x: number) => Math.cbrt(9 - x * x * x);

    nav.alternarCarril(); // punto en (0, ∛9), vista por defecto
    aprox(nav.railY ?? NaN, Math.cbrt(9), 0.05, "arranque: punto sobre la curva en x=0");

    // 1) A/D con Shift (precisión) hasta cerca de la tangente vertical, SIN
    //    pasarla (a velocidad normal un frame salta ~0.9 de mundo y la rebasaría).
    tecla("d", true, true);
    for (let i = 0; i < 500 && nav.railX < 2.0; i++) if (!frame()) break;
    tecla("d", false, true); frame();
    assert(nav.railX >= 2.0 && nav.railX < 2.08,
      `viajó hasta x=${nav.railX.toFixed(3)} (antes de la tangente en ∛9≈2.0801)`);

    // 2) Zoom-in profundo (W): la cámara sigue el punto; el tramo se vuelve astilla.
    tecla("w", true);
    for (let i = 0; i < 500 && semiY() > 0.06; i++) if (!frame()) break;
    tecla("w", false); frame();
    assert(semiY() <= 0.06, `zoom-in a semiY=${semiY().toFixed(3)}`);

    // 3) D de nuevo, hasta MUY pasada la tangente (x=2.5, donde la curva está en
    //    y≈−1.7, lejísimos de la vista de semiY=0.06): un paso de A/D excede la
    //    astilla, así que el punto debe PEGARSE al borde del tramo y CABALGAR la
    //    vertical frame a frame (cámara siguiéndolo), nunca flotar fuera de ella.
    tecla("d", true);
    for (let i = 0; i < 500 && nav.railX < 2.5; i++) if (!frame()) break;
    tecla("d", false); frame();
    assert(nav.railX >= 2.5, `cabalgó la vertical hasta railX=${nav.railX.toFixed(4)}`);
    assert(nav.railY !== null, "railY nunca se anula");
    aprox(nav.railY!, yExacta(nav.railX), 0.1,
      `el punto sigue SOBRE la curva: y=${nav.railY!.toFixed(4)} vs exacta ${yExacta(nav.railX).toFixed(4)}`);

    // 4) Zoom-out (S): sigue sobre la línea y dentro de la vista.
    tecla("s", true);
    for (let i = 0; i < 500 && semiY() < 3.5; i++) if (!frame()) break;
    tecla("s", false); frame();
    assert(nav.railY !== null && Number.isFinite(nav.railY), "railY finita tras el zoom-out");
    aprox(nav.railY!, yExacta(nav.railX), 0.05,
      `sobre la curva tras zoom-out: y=${nav.railY!.toFixed(4)} vs exacta ${yExacta(nav.railX).toFixed(4)}`);
    const vp = camara.viewport();
    assert(nav.railX >= vp.domX[0] && nav.railX <= vp.domX[1] &&
      nav.railY! >= vp.domY[0] && nav.railY! <= vp.domY[1],
      "el punto queda DENTRO de la vista (la cámara lo siguió)");

    nav.destruir();
    camara.destruir();
  });
});

// ════════════════════════════════════════════════
// El carril recorre por LONGITUD DE ARCO EN PANTALLA sobre la polilínea (no por x): así en
// una sección casi vertical avanza en y a ritmo uniforme y el punto NUNCA se sale de la línea
// (está siempre sobre un segmento trazado). `avanzarPorArco` es el primitivo puro.
describe("Carril: avance por longitud de arco (avanzarPorArco)", () => {
  // Viewport isótropo 10 px/unidad: aPantallaX(x)=x·10, aPantallaY(y)=100−y·10.
  const vp = { domX: [0, 10] as [number, number], domY: [0, 10] as [number, number], anchoPx: 100, altoPx: 100, dpr: 1 };
  const rama = (pts: number[]): Rama =>
    ({ puntos: Float64Array.from(pts), cerrada: false, calidad: "best-effort", objetoId: "id" });
  // Distancia EN PANTALLA entre dos puntos de mundo (para comprobar la velocidad uniforme).
  const distPx = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot((a.x - b.x) * 10, (a.y - b.y) * 10);

  test("recorre ~deltaPx EN PANTALLA sea cual sea la pendiente, siempre sobre la línea", () => {
    // Diagonal y=x: 10 px de arco desde (0,0) → un punto sobre la recta a 10 px en pantalla.
    const diag = avanzarPorArco([rama([0, 0, 10, 10])], 0, 0, 10, vp)!;
    aprox(distPx(diag, { x: 0, y: 0 }), 10, 1e-6, "diagonal: 10 px de arco en pantalla");
    aprox(diag.y, diag.x, 1e-9, "sigue sobre la recta y=x");
    // CASI VERTICAL (x va de 5 a 5.01, y de 0 a 10): 10 px de arco mueven ~1 en y y casi
    // nada en x — lo que el paso-por-x NO lograba (se disparaba). Punto sobre la línea.
    const vert = avanzarPorArco([rama([5, 0, 5.01, 10])], 5, 0, 10, vp)!;
    aprox(distPx(vert, { x: 5, y: 0 }), 10, 1e-6, "vertical: 10 px de arco en pantalla");
    aprox(vert.y, 1, 1e-3, "avanza en y (~1), no se dispara");
    assert(Math.abs(vert.x - 5) < 0.01, `x apenas cambia: ${vert.x}`);
  });

  test("re-proyecta sobre la curva (arco 0) y respeta la dirección del signo", () => {
    // deltaPx=0 desde un punto FUERA de la recta → el pie de perpendicular en pantalla (que
    // en y=x es el punto medio): re-proyección sobre la polilínea re-trazada.
    const proy = avanzarPorArco([rama([0, 0, 10, 10])], 3, 3.5, 0, vp)!;
    aprox(proy.x, 3.25, 1e-6, "re-proyección x");
    aprox(proy.y, 3.25, 1e-6, "re-proyección y");
    // Signo: −10 px retrocede (hacia −x en una rama x-creciente).
    const atras = avanzarPorArco([rama([0, 0, 10, 10])], 5, 5, -10, vp)!;
    assert(atras.x < 5 && atras.y < 5, `dirección − retrocede: (${atras.x}, ${atras.y})`);
  });

  test("se PEGA al borde al agotar la rama y SALTA el hueco a la rama vecina", () => {
    // Clamp: un avance enorme se queda en el extremo del tramo (la cámara lo seguiría).
    const borde = avanzarPorArco([rama([0, 0, 10, 10])], 0, 0, 1e6, vp)!;
    aprox(borde.x, 10, 1e-9, "clamp x en el borde");
    aprox(borde.y, 10, 1e-9, "clamp y en el borde");
    // Salto de hueco: dos ramas horizontales separadas (x∈[0,1] y x∈[3,4]). Desde (0.5,0),
    // 8 px de arco: 5 px agotan la 1ª rama (hasta x=1), el hueco se TELETRANSPORTA (no
    // consume arco) hasta x=3, y quedan 3 px → x=3.3. Como √(x²−1).
    const salto = avanzarPorArco([rama([0, 0, 1, 0]), rama([3, 0, 4, 0])], 0.5, 0, 8, vp)!;
    aprox(salto.x, 3.3, 1e-6, "saltó el hueco y avanzó el resto en la rama vecina");
    aprox(salto.y, 0, 1e-9, "sobre la rama vecina");
  });

  // Cruce de asíntota vertical (tan, sec, 1/x): al llegar al borde de la vista, el carril
  // debe SALTAR a la rama vecina por su EXTREMO OPUESTO (borde inferior), no re-trazarse sin
  // fin. Fixture: rama A casi vertical que ASCIENDE hasta el borde superior (y=10) en una
  // franja de x; rama B en franja de x DISJUNTA que NACE en el borde inferior (y=-10). Un
  // deltaPx grande hacia +x agota A, teletransporta el hueco y aterriza cerca del pie de B.
  test("cruza al borde opuesto de la rama vecina (salto de rama en asíntota vertical)", () => {
    const ramaA = rama([0, 0, 0.01, 10]);   // asciende: index 0 abajo, extremo superior en el borde
    const ramaB = rama([5, -10, 5.01, 0]);  // franja de x disjunta: index 0 (entrada +x) EN EL PIE
    // ~100px agotan A (llega al borde superior), el hueco no consume arco, 1px entra en B.
    const cruce = avanzarPorArco([ramaA, ramaB], 0, 0, 101, vp)!;
    assert(cruce.x > 4.9 && cruce.x < 5.1, `aterriza en la franja de B: x=${cruce.x}`);
    assert(cruce.y < -9, `aterriza en el EXTREMO INFERIOR de B (borde opuesto): y=${cruce.y}`);
  });

  test("SALTA los segmentos de longitud 0 (vértices duplicados) en vez de clavarse", () => {
    // Rama con un vértice DUPLICADO a mitad (como los que emite el trazador en las costuras
    // del refinado). Antes avanzarPorArco retornaba en ese segmento (L===0) → carril clavado.
    const conDuplicado = rama([0, 0, 5, 5, 5, 5, 10, 10]); // (5,5) repetido
    const r = avanzarPorArco([conDuplicado], 0, 0, 1e6, vp)!; // arco enorme → clamp al final
    aprox(r.x, 10, 1e-6, "atraviesa el duplicado y llega al final (no se clava en (5,5))");
    aprox(r.y, 10, 1e-6, "sobre la recta y=x");
  });
});

// ════════════════════════════════════════════════
// Recorte de ramas por PENDIENTE en pantalla (carril en asíntotas verticales). Sustituye al recorte
// por franja de vista: el criterio es GEOMÉTRICO y no depende del encuadre. Sin ningún recorte el
// carril camina el chorro del polo (la rama de tan(x) sube a y≈2·10⁷: arco ~1.6·10⁹ px, días de
// recorrido) y NUNCA alcanza el extremo para saltar a la vecina.
describe("Carril: recorte por pendiente (recortarRamasPorPendiente)", () => {
  const rama = (pts: number[]): Rama =>
    ({ puntos: Float64Array.from(pts), cerrada: false, calidad: "best-effort", objetoId: "id" });
  // Celdas 1:1 (px/unidad iguales en ambos ejes) → pendiente de pantalla = pendiente de mundo.
  const vpCuadrado = crearViewport([-10, 10], [-10, 10], 200, 200, 1);

  test("descarta los tramos casi verticales y conserva los recorribles", () => {
    // Sube suave (pend 1), se dispara (pend ~10⁶) y vuelve a bajar suave: solo quedan los extremos.
    const conChorro = rama([0, 0, 1, 1, 1.001, 1001, 1.002, 1, 2, 0]);
    const rec = recortarRamasPorPendiente([conChorro], vpCuadrado, PENDIENTE_CORTE_CARRIL);
    igual(rec.length, 2, "el chorro parte la rama en dos tramos recorribles");
    aprox(rec[0].puntos[rec[0].puntos.length - 1], 1, 1e-9, "el 1er tramo acaba donde empieza el chorro");
    aprox(rec[1].puntos[1], 1, 1e-9, "el 2º tramo arranca donde el chorro termina");
  });

  test("una rama enteramente suave queda intacta: el umbral es la PENDIENTE, no la y", () => {
    // y=x hasta y=100: pendiente 1 en todas partes, muy fuera de la vista. No se corta nada.
    const suave = rama([0, 0, 50, 50, 100, 100]);
    const rec = recortarRamasPorPendiente([suave], vpCuadrado, PENDIENTE_CORTE_CARRIL);
    igual(rec.length, 1, "no se corta por salirse de la vista, solo por empinarse");
    igual(rec[0].puntos.length, 6, "conserva todos los vértices");
  });

  test("un segmento VERTICAL puro (dx=0) se descarta sin dividir por cero", () => {
    const vertical = rama([0, 0, 0, 500, 1, 500]);
    const rec = recortarRamasPorPendiente([vertical], vpCuadrado, PENDIENTE_CORTE_CARRIL);
    igual(rec.length, 1, "solo sobrevive el tramo horizontal");
    aprox(rec[0].puntos[1], 500, 1e-9, "arranca donde acabó la vertical");
  });

  // El trazador cierra las ramas que topan con un polo en `yTop = domY[1] + alto` (3 semi-alturas:
  // ±21 con la vista por defecto). Es un vértice de RENDER. Caminándolo, el carril rebasaba la punta
  // real de la rama, BAJABA por ese segmento sintético y se clavaba en y=21.
  test("podarVerticesDePolo quita los vértices sintéticos de cierre, no los reales", () => {
    const vp = crearViewport([-8, 8], [-7, 7], 768, 261, 1); // yTop = 21, yBot = −21
    const conPolo = rama([-1.5, -21, -1.5, -2e7, 0, 0, 1.5, 2e7, 1.5, 21]);
    const pod = podarVerticesDePolo([conPolo], vp);
    const p = pod[0].puntos, n = p.length >> 1;
    igual(n, 3, "quedan la punta, el centro y la otra punta");
    aprox(p[1], -2e7, 1e-9, "el primer vértice pasa a ser la punta real");
    aprox(p[2 * n - 1], 2e7, 1e-9, "y el último, la otra punta");
    const limpia = rama([0, 0, 1, 1, 2, 4]);
    igual(podarVerticesDePolo([limpia], vp)[0].puntos.length, 6, "una rama sin vértices de polo no se toca");
  });
});

// ════════════════════════════════════════════════
// Rampa de velocidad del carril de INERCIA por VERTICALIDAD local (pendiente en pantalla): ×1
// donde el tramo es suave (el centro de la rama, tan'(0)=1) → ×MAX donde es casi vertical (junto
// a la asíntota). Geométrica, no mira la fórmula → vale igual para tan(x) y para arccot(x²)/(2√x).
describe("Carril: rampa de velocidad por verticalidad (factorRampaVerticalidad)", () => {
  test("×1 en el tramo suave, ×MAX en casi-vertical, monótona en medio", () => {
    aprox(factorRampaVerticalidad(0), 1, 1e-9, "horizontal: ×1");
    aprox(factorRampaVerticalidad(1), 1, 1e-9, "pendiente 1 (tan'(0)): ×1");
    aprox(factorRampaVerticalidad(5), 5, 1e-9, "pendiente 5: ×5");
    aprox(factorRampaVerticalidad(10), 10, 1e-9, "pendiente 10: ×MAX");
    aprox(factorRampaVerticalidad(1e6), 10, 1e-9, "casi-vertical: saturada en ×MAX");
    aprox(factorRampaVerticalidad(Infinity), 10, 1e-9, "vertical exacta (Δx=0): ×MAX");
    const f2 = factorRampaVerticalidad(2), f5 = factorRampaVerticalidad(5), f8 = factorRampaVerticalidad(8);
    assert(f2 < f5 && f5 < f8, `monótona: ${f2} < ${f5} < ${f8}`);
  });
});

// ════════════════════════════════════════════════
// Detección Caso A / Caso B del carril de asíntotas EN TIEMPO REAL: ¿hay una rama vecina real a la
// que saltar en la dirección de avance? Sobre la geometría (no el tipo de función).
describe("Carril: detección de rama vecina (existeRamaVecina)", () => {
  const vp = { domX: [0, 10] as [number, number], domY: [0, 10] as [number, number], anchoPx: 100, altoPx: 100, dpr: 1 };
  const rama = (pts: number[]): Rama =>
    ({ puntos: Float64Array.from(pts), cerrada: false, calidad: "best-effort", objetoId: "id" });

  test("Caso A: con rama vecina en la dirección de avance → true", () => {
    // Dos franjas de x disjuntas (como dos períodos de tan): desde la 1ª, avanzando +x, hay vecina.
    const ramas = [rama([0, 0, 1, 5]), rama([3, -5, 4, 0])];
    assert(existeRamaVecina(ramas, 0.5, 2.5, 1, vp), "+x: hay vecina (Caso A)");
    assert(!existeRamaVecina(ramas, 0.5, 2.5, -1, vp), "−x desde la 1ª: no hay vecina");
  });

  test("Caso B: rama única, sin continuación al otro lado → false", () => {
    const ramas = [rama([1, 0, 2, 5])];
    assert(!existeRamaVecina(ramas, 1.5, 2.5, -1, vp), "−x (hacia la asíntota): sin vecina (Caso B)");
    assert(!existeRamaVecina(ramas, 1.5, 2.5, 1, vp), "+x: tampoco");
  });
});

// ════════════════════════════════════════════════
// INTEGRACIÓN: carril de INERCIA en asíntotas verticales. Reproduce el bucle real Navegacion+Camara
// con stubs de rAF/canvas/window; registra railX/railY/centro de cámara por frame. Dos casos,
// elegidos EN TIEMPO REAL por si hay rama vecina alcanzable (`hayVecina`), no por el tipo de función:
//   • CASO A (tan x, sec x, x⁻²): la cámara PERSIGUE al punto en X y en Y con el muelle de inercia,
//     sin tope de viewport; el punto sube hasta donde la curva deja de ser recorrible (pendiente en
//     pantalla > 50, criterio geométrico) y SALTA a la vecina. Como railY pasa poco tiempo en los
//     extremos rápidos, la cámara se asienta de por sí cerca de la línea base.
//   • CASO B (arccot(x²)/(2√x)): sin vecina (convergencia real), la cámara deja de perseguir al punto
//     en Y y se anima a y=0 con la curva ×10→×1; el punto escapa por la asíntota fuera de la vista.
const arnesCarril = (fuente: string) => {
  const g = globalThis as Record<string, unknown>;
  if (!g.window) g.window = { devicePixelRatio: 1 };
  let pendiente: ((t: number) => void) | null = null;
  g.requestAnimationFrame = (cb: (t: number) => void) => { pendiente = cb; return 1; };
  g.cancelAnimationFrame = () => { pendiente = null; };
  const fakeCanvas = () => {
    const handlers: Record<string, (e: unknown) => void> = {};
    return { handlers, tabIndex: 0, style: {} as Record<string, string>,
      focus() {}, addEventListener(tipo: string, fn: (e: unknown) => void) { handlers[tipo] = fn; },
      removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {} };
  };
  const cnvCam = fakeCanvas(), cnvNav = fakeCanvas();
  const ctxNulo = null as unknown as CanvasRenderingContext2D;
  const escena = new Escena(construirObjetosEscena(fuente),
    new Overlay(ctxNulo), new RendererCanvas2D(ctxNulo), new Crosshair(ctxNulo));
  const camara = new Camara(cnvCam as unknown as HTMLCanvasElement, 130,
    { onViewport: () => {}, onCursor: () => {} });
  camara.redimensionar(300);
  const nav = new Navegacion(cnvNav as unknown as HTMLCanvasElement, camara,
    { y: (x) => escena.yEnCurva(x),
      avanzarArco: (x, y, dPx, vp, recortar) => escena.avanzarArcoEnCurva(x, y, dPx, vp, recortar),
      hayVecina: (x, y, dir, vp) => escena.hayRamaVecinaCarril(x, y, dir, vp),
      tieneAsintotasVerticales: () => escena.tieneAsintotasVerticales() },
    () => escena.actualizar(camara.viewport(), "interactiva"));
  let t = 0;
  const frame = (): boolean => { const cb = pendiente; if (!cb) return false; pendiente = null; t += 50; cb(t); return true; };
  const tecla = (k: string, abajo: boolean) => cnvNav.handlers[abajo ? "keydown" : "keyup"]({ key: k, shiftKey: false, preventDefault() {}, stopPropagation() {} });
  const camCy = () => (camara.viewport().domY[0] + camara.viewport().domY[1]) / 2;
  const semi = () => (camara.viewport().domY[1] - camara.viewport().domY[0]) / 2;
  nav.alternarCarril();
  escena.actualizar(camara.viewport(), "final"); // settle que puebla el flag de asíntotas
  return { nav, camara, frame, tecla, camCy, semi, escena, destruir: () => { nav.destruir(); camara.destruir(); } };
};

describe("Carril: CASO A · cruce de asíntotas persiguiendo al punto en X e Y (integración)", () => {
  test("mantener D salta rama tras rama; el punto queda EN PANTALLA y la cámara no se dispara", () => {
    const a = arnesCarril("tan(x)");
    assert(a.escena.tieneAsintotasVerticales(), "tan(x) tiene asíntotas verticales tras la pasada final");
    const semiIni = a.semi();
    a.tecla("d", true);
    let maxRezago = 0, maxAbsCamCy = 0, algunSalto = false;
    let xPrev = a.nav.railX;
    for (let i = 0; i < 120; i++) {
      if (!a.frame()) break;
      if (a.nav.railY !== null) maxRezago = Math.max(maxRezago, Math.abs(a.nav.railY - a.camCy()));
      maxAbsCamCy = Math.max(maxAbsCamCy, Math.abs(a.camCy()));
      if (a.nav.railX - xPrev > 1.5) algunSalto = true; // dio un brinco de rama (cruzó un polo)
      xPrev = a.nav.railX;
    }
    a.tecla("d", false); a.frame();
    // (1) Cruzó MUCHAS asíntotas.
    assert(a.nav.railX > 30, `cruzó varias asíntotas: railX=${a.nav.railX.toFixed(1)}`);
    assert(algunSalto, "hubo saltos de rama (brincos de railX al cruzar los polos)");
    // (2) El punto quedó SIEMPRE cerca del centro de cámara (dentro de ~1 vista → en pantalla),
    //     no disparado a y de miles: la persecución en Y no degenera.
    assert(maxRezago <= 1.2 * semiIni, `punto en pantalla: max|railY−camCy|=${maxRezago.toFixed(2)} ≤ ${(1.2 * semiIni).toFixed(2)}`);
    // (3) La cámara no se fue tras el polo: railY pasa poco tiempo en los extremos rápidos, así que
    //     el muelle se asienta cerca de la línea base sin necesidad de congelarlo.
    assert(maxAbsCamCy < 3, `cámara cerca de la línea base: max|camCy|=${maxAbsCamCy.toFixed(2)} < 3`);
    // (4) No hubo zoom (solo D): la semi-altura no cambió.
    aprox(a.semi(), semiIni, 1e-9, "sin zoom, semi-altura estable");
    a.destruir();
  });

  // El corte de la curva es por PENDIENTE (geométrico), no por el borde de la vista: el cruce debe
  // ocurrir igual con zoom-in y con zoom-out. Antes, con el recorte ligado al `domY`, el carril se
  // estancaba porque no encontraba rama vecina dentro del encuadre.
  for (const [nombre, tecla, objetivo, frames] of [
    ["zoom-in (semiY≈0.5)", "w", 0.5, 400] as const,
    ["zoom-out (semiY≈100)", "s", 100, 60] as const,
  ]) {
    test(`tan(x) cruza ramas también con ${nombre}, sin depender del encuadre`, () => {
      const a = arnesCarril("tan(x)");
      a.tecla(tecla, true);
      for (let i = 0; i < 2000; i++) {
        if (!a.frame()) break;
        if (tecla === "w" ? a.semi() <= objetivo : a.semi() >= objetivo) break;
      }
      a.tecla(tecla, false); a.frame();
      a.escena.actualizar(a.camara.viewport(), "final"); // el host hace la final al asentarse
      assert(a.escena.tieneAsintotasVerticales(), "el latch de asíntotas formales sobrevive al zoom");
      const xIni = a.nav.railX;
      a.tecla("d", true);
      for (let i = 0; i < frames; i++) if (!a.frame()) break;
      a.tecla("d", false); a.frame();
      // Cruzó al menos un polo: avanzó más allá de π/2, donde la rama de partida termina.
      assert(a.nav.railX > Math.PI / 2, `cruzó el polo pese al ${nombre}: railX=${a.nav.railX.toFixed(3)} (partió de ${xIni.toFixed(3)})`);
      assert(Number.isFinite(a.nav.railY!) && Math.abs(a.nav.railY!) < 1e3,
        `el punto no se disparó a y enormes: railY=${a.nav.railY!.toExponential(2)}`);
      a.destruir();
    });
  }
});

// CASO B: convergencia REAL sin rama vecina. La cámara deja de perseguir al punto en Y y se anima a
// un destino FIJO, y=0, con la curva ×10→×1; en X lo sigue con normalidad. El punto sigue subiendo
// por la asíntota más allá de lo visible (honesto: la función diverge de verdad).
describe("Carril: CASO B · convergencia real — la cámara se centra en y=0 y sigue el punto en X", () => {
  const camCx = (a: ReturnType<typeof arnesCarril>) => {
    const vp = a.camara.viewport();
    return (vp.domX[0] + vp.domX[1]) / 2;
  };
  for (const fuente of ["arccot(x^2)/(2 sqrt(x))", "arccot(x^2)/(2 sqrt(x)) - 2x sqrt(x)/(x^4+1)"]) {
    test(`${fuente}: mantener A ancla la cámara en y=0 y el punto escapa por la asíntota`, () => {
      const a = arnesCarril(fuente);
      assert(a.escena.tieneAsintotasVerticales(), "blow-up de borde de dominio detectado");
      const semiIni = a.semi();
      a.tecla("a", true);
      // Fase de acercamiento: la cámara va FIJA en el punto y SUBE con él hasta que este escapa de la
      // zona recorrible. Se detecta el pico: a partir de ahí empieza el viaje a y=0.
      let cyMax = 0;
      for (let i = 0; i < 30; i++) {
        if (!a.frame()) break;
        const d = Math.abs(a.camCy());
        if (d < cyMax) break; // ya ancló y está bajando
        cyMax = d;
      }
      // El viaje debe ser VISIBLE: al menos ~1/7 de la semi-altura. Con el muelle suave la cámara se
      // quedaba en cy≈0.2 mientras el punto ya iba por y≈8, y la animación no se percibía.
      assert(cyMax > semiIni / 7, `la cámara subió con el punto antes de anclar: max|camCy|=${cyMax.toFixed(3)} > ${(semiIni / 7).toFixed(3)}`);
      // Fase de anclaje: |camCy| decae MONÓTONAMENTE hasta y=0 exacto (no se para donde sea).
      let anterior = Math.abs(a.camCy());
      for (let i = 0; i < 60; i++) {
        if (!a.frame()) break;
        const d = Math.abs(a.camCy());
        assert(d <= anterior + 1e-12, `el anclaje solo acerca la cámara a y=0: ${d} ≤ ${anterior}`);
        anterior = d;
      }
      igual(a.camCy(), 0, "la cámara se asienta EXACTAMENTE en y=0 (eje X a media altura)");
      // El punto, mientras tanto, sigue subiendo por la asíntota y ha salido de la vista.
      assert(a.nav.railY! > semiIni, `el punto escapó por la asíntota: railY=${a.nav.railY!.toFixed(1)} > ${semiIni}`);
      assert(a.nav.railX > 0 && a.nav.railX < 0.05, `y quedó pegado a la asíntota x=0: railX=${a.nav.railX.toExponential(2)}`);
      // La X sigue persiguiendo al punto con normalidad (solo el eje Y queda anclado).
      aprox(camCx(a), a.nav.railX, 1e-9, "la cámara sigue al punto en X");
      a.tecla("a", false); a.frame();
      a.destruir();
    });
  }

  // Modo ESCAPE. Bug (reportado): el punto subía hasta la punta de la polilínea (y≈330) y luego
  // BAJABA —329, 328…— hasta clavarse en y=21, que es `domY[1] + alto`: el vértice sintético con que
  // el trazador cierra la rama en el polo. Ahora ese vértice se poda y, una vez fugado, la `y` se
  // INTEGRA: sube sin límite. Invertir con D deshace el camino y devuelve el punto a la curva.
  test("fugado, el punto sube SIN LÍMITE (nada de clavarse en 3·semiY) y D deshace el camino", () => {
    const a = arnesCarril("arccot(x^2)/(2 sqrt(x)) - 2x sqrt(x)/(x^4+1)");
    const semiIni = a.semi();
    const clampTrazador = 3 * semiIni; // el y=21 del bug
    a.tecla("a", true);
    let yPrev = a.nav.railY!, subidaMonotona = true;
    for (let i = 0; i < 200; i++) {
      if (!a.frame()) break;
      if (a.nav.railY! < yPrev - 1e-9) subidaMonotona = false;
      yPrev = a.nav.railY!;
    }
    const yPico = a.nav.railY!;
    assert(subidaMonotona, "manteniendo A el punto NUNCA baja (antes se daba la vuelta en la punta)");
    assert(yPico > 20 * clampTrazador, `sube sin límite: y=${yPico.toFixed(0)} ≫ 3·semiY=${clampTrazador}`);
    igual(a.camCy(), 0, "y la cámara ya está asentada en y=0");
    // Proceso inverso: D deshace la fuga y devuelve el punto a la curva, bajando en todo momento.
    a.tecla("a", false); a.tecla("d", true);
    let bajadaMonotona = true;
    yPrev = a.nav.railY!;
    for (let i = 0; i < 400; i++) {
      if (!a.frame()) break;
      if (a.nav.railY! > yPrev + 1e-9) bajadaMonotona = false;
      yPrev = a.nav.railY!;
      if (a.nav.railY! < semiIni) break;
    }
    a.tecla("d", false); a.frame();
    assert(bajadaMonotona, "manteniendo D el punto NUNCA vuelve a subir (antes se re-fugaba al descender)");
    assert(a.nav.railY! < semiIni, `el punto regresó a la vista: y=${a.nav.railY!.toFixed(2)}`);
    // Y regresó SOBRE la curva, no a un punto inventado.
    const yCurva = a.escena.yEnCurva(a.nav.railX);
    assert(yCurva !== null && Math.abs(yCurva - a.nav.railY!) < 0.2,
      `de vuelta sobre la curva: railY=${a.nav.railY!.toFixed(3)} vs f(railX)=${yCurva?.toFixed(3)}`);
    a.destruir();
  });
});

// INTEGRACIÓN: REENGANCHE de cámara tras el salto de Caso A. Bug (reportado): la cámara seguía a
// railX SIEMPRE, así que en el salto el punto quedaba clavado en el centro y eran los ejes, la
// rejilla y la curva los que brincaban el hueco → teletransporte (visible en x⁻², de hueco angosto).
// Ahora la cámara absorbe el corte como desfase y lo reabsorbe con el MISMO muelle exponencial que el
// reenganche de Caso B; el movimiento CONTINUO se sigue exacto (un muelle sobre railX rezagaría todo
// el recorrido → lag). Se recorre el bucle real frame a frame hasta el primer salto.
describe("Carril: CASO A · la cámara REENGANCHA tras el salto en vez de teletransportarse", () => {
  const hastaElSalto = (fuente: string, tecla: string, maxFrames: number) => {
    const a = arnesCarril(fuente);
    const camCx = () => { const vp = a.camara.viewport(); return (vp.domX[0] + vp.domX[1]) / 2; };
    a.tecla(tecla, true);
    a.frame(); // 1er frame: dt=0, la cámara aún no ha enfocado
    let xPrev = a.nav.railX, cxPrev = camCx(), dPrev = Math.abs(a.nav.railX - camCx());
    let salto: { dRail: number; dCam: number } | null = null;
    let maxDesfaseSuave = 0;
    for (let i = 0; i < maxFrames && salto === null; i++) {
      if (!a.frame()) break;
      const d = Math.abs(a.nav.railX - camCx());
      // El desfase cámara–punto SOLO crece en el frame de un salto (fuera de él la cámara sigue al
      // punto exacto y el muelle lo decae). Sirve de marcador agnóstico: en x⁻² las dos ramas salen
      // por ARRIBA, así que un |Δy| grande no distingue el salto (sí en tan, que reaparece abajo).
      if (d > dPrev + 1e-9) salto = { dRail: a.nav.railX - xPrev, dCam: camCx() - cxPrev };
      else maxDesfaseSuave = Math.max(maxDesfaseSuave, d);
      xPrev = a.nav.railX; cxPrev = camCx(); dPrev = d;
    }
    a.tecla(tecla, false);
    return { a, salto, maxDesfaseSuave, camCx };
  };

  for (const [fuente, tecla] of [["tan(x)", "d"], ["x^(-2)", "a"]] as const) {
    test(`${fuente}: el corte no lo da la cámara, y el desfase se reabsorbe con el muelle`, () => {
      const { a, salto, maxDesfaseSuave, camCx } = hastaElSalto(fuente, tecla, 60);
      assert(salto !== null, `${fuente}: el punto saltó de rama`);
      // (1) Fuera del salto la cámara sigue al punto EXACTO: nada de rezago en el tramo continuo.
      assert(maxDesfaseSuave < 1e-9, `sin lag en el recorrido continuo: max|railX−camX|=${maxDesfaseSuave}`);
      // (2) En el frame del salto la cámara se mueve MENOS que el punto, justo el HUECO que este
      //     brincó (el resto del desplazamiento —arco recorrido— sí lo acompaña, sin lag).
      const rezagoDelFrame = Math.abs(salto!.dRail - salto!.dCam);
      assert(Math.abs(salto!.dCam) < Math.abs(salto!.dRail),
        `la cámara se movió menos que el punto: ΔcamX=${salto!.dCam.toFixed(3)} vs ΔrailX=${salto!.dRail.toFixed(3)}`);
      assert(rezagoDelFrame > 0.15, `la cámara NO acompañó el corte: se quedó atrás ${rezagoDelFrame.toFixed(3)} de mundo`);
      // (3) La cámara quedó rezagada respecto del punto (el hueco recién saltado).
      const desfaseTrasSalto = Math.abs(a.nav.railX - camCx());
      assert(desfaseTrasSalto > 0.1, `cámara rezagada tras el salto: |railX−camX|=${desfaseTrasSalto.toFixed(3)}`);
      // (4) Soltada la tecla, el bucle SIGUE vivo hasta reenganchar: el desfase decae de forma
      //     monótona hasta cero. Ni instantáneo (sería el corte de antes) ni eterno (sería lag).
      let anterior = desfaseTrasSalto, frames = 0;
      while (a.frame() && frames < 300) {
        const d = Math.abs(a.nav.railX - camCx());
        assert(d <= anterior + 1e-9, `el reenganche solo acerca la cámara: ${d} ≤ ${anterior}`);
        anterior = d; frames++;
      }
      assert(frames >= 4 && frames <= 200, `reenganche progresivo (${frames} frames), no instantáneo ni interminable`);
      aprox(a.nav.railX, camCx(), 1e-6, "al llegar, la cámara se fija centrada en el punto");
      a.destruir();
    });
  }
});

// ════════════════════════════════════════════════
// INTEGRACIÓN: el carril arranca donde x=0 NO está en la curva. Bug (reportado): en 1/x
// (asíntota en x=0) y arccot(x²)/(2√x) (dominio x>0) el punto NUNCA aparecía y A/D no hacía
// nada, porque el carril exigía arrancar en x=0 → railY=null → crosshair invisible e inerte.
// Con el fix (ySemilla + enganche por arco 0 al punto más cercano) el punto aparece de
// inmediato sobre la curva y A/D lo recorre. Simula el bucle real Navegacion+Camara.
describe("Carril: arranque cuando x=0 no está en la curva (1/x, dominio x>0)", () => {
  const correr = (fuente: string) => {
    const g = globalThis as Record<string, unknown>;
    if (!g.window) g.window = { devicePixelRatio: 1 };
    let pendiente: ((t: number) => void) | null = null;
    g.requestAnimationFrame = (cb: (t: number) => void) => { pendiente = cb; return 1; };
    g.cancelAnimationFrame = () => { pendiente = null; };
    const fakeCanvas = () => {
      const handlers: Record<string, (e: unknown) => void> = {};
      return { handlers, tabIndex: 0, style: {} as Record<string, string>,
        focus() {}, addEventListener(tipo: string, fn: (e: unknown) => void) { handlers[tipo] = fn; },
        removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {} };
    };
    const cnvCam = fakeCanvas(), cnvNav = fakeCanvas();
    const ctxNulo = null as unknown as CanvasRenderingContext2D;
    const escena = new Escena(construirObjetosEscena(fuente),
      new Overlay(ctxNulo), new RendererCanvas2D(ctxNulo), new Crosshair(ctxNulo));
    const camara = new Camara(cnvCam as unknown as HTMLCanvasElement, 130, { onViewport: () => {}, onCursor: () => {} });
    camara.redimensionar(300);
    const nav = new Navegacion(cnvNav as unknown as HTMLCanvasElement, camara,
      { y: (x) => escena.yEnCurva(x), avanzarArco: (x, y, dPx, vp, recortar) => escena.avanzarArcoEnCurva(x, y, dPx, vp, recortar),
        hayVecina: (x, y, dir, vp) => escena.hayRamaVecinaCarril(x, y, dir, vp),
        tieneAsintotasVerticales: () => escena.tieneAsintotasVerticales() },
      () => escena.actualizar(camara.viewport(), "interactiva"));
    let t = 0;
    const frame = (): boolean => { const cb = pendiente; if (!cb) return false; pendiente = null; t += 50; cb(t); return true; };
    const tecla = (k: string, abajo: boolean) => cnvNav.handlers[abajo ? "keydown" : "keyup"]({ key: k, shiftKey: false, preventDefault() {}, stopPropagation() {} });
    nav.alternarCarril();
    escena.actualizar(camara.viewport(), "final");
    const yArranque = nav.railY;
    const xArranque = nav.railX;
    tecla("d", true);
    for (let i = 0; i < 40; i++) if (!frame()) break;
    tecla("d", false); frame();
    const res = { yArranque, xArranque, xFinal: nav.railX, yFinal: nav.railY };
    nav.destruir(); camara.destruir();
    return res;
  };

  test("1/x: el punto APARECE al activar el carril (railY no es null) y A/D lo recorre", () => {
    const r = correr("1/x");
    assert(r.yArranque !== null && Number.isFinite(r.yArranque), `punto sobre la curva al arrancar: railY=${r.yArranque}`);
    assert(r.yFinal !== null && Number.isFinite(r.yFinal), "sigue teniendo punto tras A/D");
    assert(Math.abs(r.xFinal - r.xArranque) > 1, `A/D recorre la curva: Δx=${(r.xFinal - r.xArranque).toFixed(2)}`);
  });

  test("arccot(x²)/(2√x) (dominio x>0): el punto APARECE y A/D lo recorre", () => {
    const r = correr("arccot(x^2)/(2 sqrt(x)) - 2 x sqrt(x)/(x^4+1)");
    assert(r.yArranque !== null && Number.isFinite(r.yArranque), `punto sobre la curva al arrancar: railY=${r.yArranque}`);
    assert(r.xArranque > 0, `arranca dentro del dominio x>0: x=${r.xArranque.toFixed(3)}`);
    assert(Math.abs(r.xFinal - r.xArranque) > 1, `A/D recorre la curva: Δx=${(r.xFinal - r.xArranque).toFixed(2)}`);
  });
});

// ════════════════════════════════════════════════
describe("Continuación en singularidades (cúspides, nodos, tacnodos)", () => {
  const descubrir = new DescubrimientoMuestreado();
  const trazar = new TrazadorContinuacion();
  const geom = (F: CampoEscalar, vp = VP, tol = TOL_FINAL): readonly Rama[] => {
    const { semillas, singularidades } = descubrir.descubrir(F, vp, tol);
    return trazar.trazar(F, "id", semillas, singularidades, vp, tol);
  };
  // Reversiones: giros > 120° entre segmentos consecutivos = oscilación (bug clásico
  // del predictor-corrector cerca de cúspides). Debe ser 0 con el paso adaptativo.
  const reversiones = (ramas: readonly Rama[]): number => {
    let rev = 0;
    for (const r of ramas) {
      const p = r.puntos;
      for (let k = 4; k < p.length; k += 2) {
        const ax = p[k - 2] - p[k - 4], ay = p[k - 1] - p[k - 3];
        const bx = p[k] - p[k - 2], by = p[k + 1] - p[k - 1];
        const na = Math.hypot(ax, ay), nb = Math.hypot(bx, by);
        if (na > 1e-12 && nb > 1e-12 && (ax * bx + ay * by) / (na * nb) < -0.5) rev++;
      }
    }
    return rev;
  };
  // Cobertura visual contra ground-truth (% de puntos gt a < d de algún vértice).
  const cobertura = (gt: [number, number][], ramas: readonly Rama[], d: number): number => {
    const d2 = d * d; let cub = 0, tot = 0;
    for (const [gx, gy] of gt) {
      if (gx < -16 || gx > 16 || gy < -14 || gy > 14) continue;
      tot++;
      let ok = false;
      for (const r of ramas) {
        const p = r.puntos;
        for (let k = 0; k < p.length; k += 2) {
          const dx = p[k] - gx, dy = p[k + 1] - gy;
          if (dx * dx + dy * dy < d2) { ok = true; break; }
        }
        if (ok) break;
      }
      if (ok) cub++;
    }
    return tot ? 100 * cub / tot : 100;
  };
  const ramasY = (ramas: readonly Rama[]) => {
    let pos = 0, neg = 0;
    for (const r of ramas) for (let k = 1; k < r.puntos.length; k += 2) {
      if (r.puntos[k] > 0.05) pos++; else if (r.puntos[k] < -0.05) neg++;
    }
    return { pos, neg };
  };

  test("cúspide y²=x³ NO oscila (0 reversiones) y traza ambas ramas", () => {
    const F = ce((x, y) => y * y - x * x * x);
    const ramas = geom(F);
    igual(reversiones(ramas), 0, "no debe oscilar en la cúspide");
    const { pos, neg } = ramasY(ramas);
    assert(pos > 50 && neg > 50, `ambas ramas (y+:${pos}, y-:${neg})`);
  });

  test("cardioide con cúspide NO oscila (0 reversiones)", () => {
    const F = ce((x, y) => (x * x + y * y - x) ** 2 - (x * x + y * y));
    igual(reversiones(geom(F)), 0, "no debe oscilar en la cúspide de la cardioide");
  });

  test("folium x³+y³=3xy: cobertura completa y sin oscilación, estable al trasladar", () => {
    const F = ce((x, y) => x * x * x + y * y * y - 3 * x * y);
    const gt: [number, number][] = [];
    for (let i = 0; i <= 4000; i++) {
      const t = -50 + i * 0.025, d = 1 + t * t * t;
      if (Math.abs(d) > 1e-6) gt.push([3 * t / d, 3 * t * t / d]);
    }
    for (const off of [0, 0.137, 0.274]) {
      const vp = crearViewport([-8 + off, 8 + off], [-7 + off * 0.5, 7 + off * 0.5], 768, 261, 1);
      const ramas = geom(F, vp);
      assert(cobertura(gt, ramas, 0.15) > 99, `cobertura ${cobertura(gt, ramas, 0.15).toFixed(1)}% (off=${off})`);
      igual(reversiones(ramas), 0, `sin oscilación (off=${off})`);
    }
  });

  test("lemniscata: sin oscilación y cuerda acotada (sin saltos grandes)", () => {
    const F = ce((x, y) => (x * x + y * y) ** 2 - 4 * (x * x - y * y));
    const ramas = geom(F);
    igual(reversiones(ramas), 0, "sin oscilación");
    const paso = ((VP.domX[1] - VP.domX[0]) / VP.anchoPx) * 2.5;
    let maxChord = 0;
    for (const r of ramas) for (let k = 2; k < r.puntos.length; k += 2) {
      maxChord = Math.max(maxChord, Math.hypot(r.puntos[k] - r.puntos[k - 2], r.puntos[k + 1] - r.puntos[k - 1]));
    }
    assert(maxChord < paso * 3, `cuerda máx ${(maxChord / paso).toFixed(1)}×paso (sin saltos)`);
  });

  test("tacnodo y²=x⁴: dedup evita el re-trazado (cuenta de ramas acotada) sin oscilar", () => {
    const F = ce((x, y) => y * y - x * x * x * x);
    for (const off of [0, 0.137, 0.274, 0.411]) {
      const vp = crearViewport([-8 + off, 8 + off], [-7 + off * 0.5, 7 + off * 0.5], 768, 261, 1);
      const ramas = geom(F, vp);
      assert(ramas.length >= 2 && ramas.length <= 3, `ramas=${ramas.length} (off=${off}) acotado`);
      igual(reversiones(ramas), 0, `sin oscilación (off=${off})`);
    }
  });

  test("curvas suaves no se fragmentan: círculo=1, hipérbola=2, no hay duplicados", () => {
    igual(geom(ce((x, y) => x * x + y * y - 9)).length, 1, "círculo sigue siendo 1 rama");
    igual(geom(ce((x, y) => x * x - y * y - 1)).length, 2, "hipérbola sigue siendo 2 ramas");
  });
});

// ════════════════════════════════════════════════
describe("Robustez y casos límite (auditoría / break)", () => {
  const descubrir = new DescubrimientoMuestreado();
  const trazar = new TrazadorContinuacion();

  test("descubrimiento NO siembra en un polo (salto ±∞), sí en un cero real", () => {
    const vp = crearViewport([0, 1], [-1, 1], 768, 261, 1);
    // 1/(x−0.5): polo en x=0.5, sin ceros → ninguna semilla (salto, no cruce).
    igual(descubrir.descubrir(ce((x) => 1 / (x - 0.5)), vp, TOL_FINAL).semillas.length, 0,
      "un polo no debe generar semillas espurias");
    // x−0.5: cero real en x=0.5 → sí hay semillas.
    assert(descubrir.descubrir(ce((x) => x - 0.5), vp, TOL_FINAL).semillas.length > 0,
      "un cero real sí genera semillas");
  });

  test("implícito patológico sin(x·y)=0 con zoom-out: finito y acotado por presupuesto", () => {
    const F = ce((x, y) => Math.sin(x * y));
    const vp = crearViewport([-5e5, 5e5], [-3e5, 3e5], 768, 261, 1);
    const { semillas, singularidades } = descubrir.descubrir(F, vp, TOL_FINAL);
    const ramas = trazar.trazar(F, "id", semillas, singularidades, vp, TOL_FINAL);
    let pts = 0, noFin = 0;
    for (const r of ramas) {
      pts += r.puntos.length / 2;
      for (let k = 0; k < r.puntos.length; k++) if (!Number.isFinite(r.puntos[k])) noFin++;
    }
    igual(noFin, 0, "sin coordenadas no finitas");
    assert(pts < 40000, `puntos acotados por el presupuesto (${pts})`);
  });

  test("continuación es determinista (misma entrada/vista → misma geometría)", () => {
    const F = ce((x, y) => x * x + y * y - 9);
    const tr = (s = descubrir.descubrir(F, VP, TOL_FINAL).semillas) =>
      trazar.trazar(F, "id", s, [], VP, TOL_FINAL);
    const a = tr(), b = tr();
    igual(a.length, b.length, "mismo nº de ramas");
    igual(a[0].puntos.length, b[0].puntos.length, "mismo nº de puntos");
    for (let k = 0; k < a[0].puntos.length; k++) igual(a[0].puntos[k], b[0].puntos[k], `punto ${k}`);
  });

  test("explícito: ramas sin coordenadas no finitas en funciones extremas", () => {
    const fns: Array<(x: number) => number> = [
      (x) => Math.exp(x), (x) => 1 / x, (x) => Math.tan(x), (x) => x ** 1000, (x) => Math.log(x),
    ];
    for (const f of fns) {
      const { ramas } = new TrazadorExplicitoAdaptativo().trazar(fr(f), "id", VP, TOL_FINAL);
      for (const r of ramas) for (let k = 0; k < r.puntos.length; k++) {
        assert(Number.isFinite(r.puntos[k]), "toda coordenada de rama debe ser finita");
      }
    }
  });

  test("entradas degeneradas/ inválidas no rompen (parser → sin puntos, sin throw)", () => {
    // Estas clasifican como explícitas y compilan a f→NaN, o implícitas sin solución.
    for (const src of ["y=", "y=*/", "sin(x", "y=z"]) {
      const o = construirObjeto(src, "id");
      igual(o.tipo, "explicita", `${src} → explícita`);
      const { ramas } = new TrazadorExplicitoAdaptativo()
        .trazar((o as ObjetoExplicito).f, "id", VP, TOL_FINAL);
      assert(Array.isArray(ramas), "devuelve ramas (posiblemente vacías) sin lanzar");
    }
  });
});

// ════════════════════════════════════════════════
// Consolidación implícita (Etapa 5): familias de curvas + límites de muestreo.
// Locks de NO-REGRESIÓN de comportamientos verificados con harness desechable
// (líneas, hipérbolas, parábola/seno implícitos, esquinas, nodos, traslación,
// completitud). Auditoría: 0 bugs de corrección; estos tests fijan lo bueno.
describe("Consolidación implícita (Etapa 5): familias y límites de muestreo", () => {
  const descubrir = new DescubrimientoMuestreado();
  const trazar = new TrazadorContinuacion();
  const geom = (F: CampoEscalar, vp = VP, tol = TOL_FINAL): readonly Rama[] => {
    const { semillas, singularidades } = descubrir.descubrir(F, vp, tol);
    return trazar.trazar(F, "id", semillas, singularidades, vp, tol);
  };
  const residualMax = (F: CampoEscalar, ramas: readonly Rama[]): number => {
    let m = 0;
    for (const r of ramas)
      for (let k = 0; k < r.puntos.length; k += 2)
        m = Math.max(m, Math.abs(F.eval(r.puntos[k], r.puntos[k + 1])));
    return m;
  };
  const noFinitos = (ramas: readonly Rama[]): number => {
    let n = 0;
    for (const r of ramas) for (let k = 0; k < r.puntos.length; k++) if (!Number.isFinite(r.puntos[k])) n++;
    return n;
  };
  const reversiones = (ramas: readonly Rama[]): number => {
    let rev = 0;
    for (const r of ramas) {
      const p = r.puntos;
      for (let k = 4; k < p.length; k += 2) {
        const ax = p[k - 2] - p[k - 4], ay = p[k - 1] - p[k - 3];
        const bx = p[k] - p[k - 2], by = p[k + 1] - p[k - 1];
        const na = Math.hypot(ax, ay), nb = Math.hypot(bx, by);
        if (na > 1e-12 && nb > 1e-12 && (ax * bx + ay * by) / (na * nb) < -0.5) rev++;
      }
    }
    return rev;
  };
  // Distancia del punto de rama más cercano a (cx,cy).
  const distMin = (ramas: readonly Rama[], cx: number, cy: number): number => {
    let m = Infinity;
    for (const r of ramas)
      for (let k = 0; k < r.puntos.length; k += 2)
        m = Math.min(m, Math.hypot(r.puntos[k] - cx, r.puntos[k + 1] - cy));
    return m;
  };

  test("familia de verticales x²=4 → 2 ramas abiertas en x=±2, residual ~0", () => {
    const F = ce((x, y) => x * x - 4);
    const ramas = geom(F);
    igual(ramas.length, 2, "dos rectas verticales");
    for (const r of ramas) assert(!r.cerrada, "verticales son abiertas");
    assert(residualMax(F, ramas) < 1e-6, `residual ${residualMax(F, ramas)}`);
    // Cada rama debe ser ~vertical: x casi constante (±2).
    for (const r of ramas) {
      let minX = Infinity, maxX = -Infinity;
      for (let k = 0; k < r.puntos.length; k += 2) { minX = Math.min(minX, r.puntos[k]); maxX = Math.max(maxX, r.puntos[k]); }
      assert(maxX - minX < 0.05, `rama casi vertical (Δx=${(maxX - minX).toFixed(3)})`);
      assert(Math.abs(Math.abs((minX + maxX) / 2) - 2) < 0.05, "x≈±2");
    }
  });

  test("hipérbola rectangular xy=1 → 2 ramas abiertas, residual bajo, finitas", () => {
    const F = ce((x, y) => x * y - 1);
    const ramas = geom(F);
    igual(ramas.length, 2, "dos ramas en cuadrantes opuestos");
    igual(noFinitos(ramas), 0, "sin coordenadas no finitas");
    assert(residualMax(F, ramas) < 1e-5, `residual ${residualMax(F, ramas)}`);
  });

  test("parábola implícita y−x²=0 → 1 rama abierta (igual que la explícita), residual bajo", () => {
    const F = ce((x, y) => y - x * x);
    const ramas = geom(F);
    igual(ramas.length, 1, "una rama abierta");
    assert(!ramas[0].cerrada, "la parábola es abierta");
    igual(reversiones(ramas), 0, "sin oscilación");
    assert(residualMax(F, ramas) < 1e-5, `residual ${residualMax(F, ramas)}`);
  });

  test("seno implícito y−sin(3x)=0 → 1 rama abierta conexa, sin oscilación", () => {
    const F = ce((x, y) => y - Math.sin(3 * x));
    const ramas = geom(F);
    igual(ramas.length, 1, "una rama conexa");
    igual(reversiones(ramas), 0, "sin oscilación");
    igual(noFinitos(ramas), 0, "finita");
  });

  test("diamante |x|+|y|=1: esquinas son endpoints EXACTOS (sin huecos), cobertura total, sin oscilar", () => {
    // Las 4 esquinas (90°, ∇F discontinuo) fragmentan la curva en segmentos abiertos
    // (conectividad best-effort), PERO no deben dejar HUECOS: cada esquina verdadera
    // debe coincidir con un punto de rama. Lock del "sin huecos" + cobertura + no oscilar.
    const F = ce((x, y) => Math.abs(x) + Math.abs(y) - 1);
    const ramas = geom(F);
    for (const [cx, cy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as [number, number][])
      assert(distMin(ramas, cx, cy) < 1e-6, `esquina (${cx},${cy}) cubierta sin hueco`);
    igual(reversiones(ramas), 0, "sin oscilación en las esquinas");
    assert(residualMax(F, ramas) < 1e-9, `residual exacto (piecewise lineal): ${residualMax(F, ramas)}`);
    // Cobertura del perímetro: proyectando puntos del círculo unidad sobre el rombo
    // (x,y)→(x,y)/(|x|+|y|) se recorre todo |x|+|y|=1; cada uno debe estar a < 1 paso.
    let cubiertos = 0, total = 0;
    for (let i = 0; i < 400; i++) {
      const ang = (i / 400) * 2 * Math.PI;
      const px = Math.cos(ang), py = Math.sin(ang);
      const n = Math.abs(px) + Math.abs(py);
      total++;
      if (distMin(ramas, px / n, py / n) < 0.06) cubiertos++;
    }
    assert(cubiertos / total > 0.99, `cobertura del perímetro ${(100 * cubiertos / total).toFixed(1)}%`);
  });

  test("nodo y²=x² (dos rectas y=±x cruzándose) → 2 ramas, residual 0", () => {
    const F = ce((x, y) => y * y - x * x);
    const ramas = geom(F);
    igual(ramas.length, 2, "dos rectas");
    assert(residualMax(F, ramas) < 1e-9, "residual ~0 (rectas exactas)");
  });

  test("tan implícito y−tan(x)=0 → 7 ramas (paridad con el explícito), todas finitas", () => {
    // El trazado implícito (continuación) reproduce el nº de ramas del sampler explícito
    // de tan en [-8,8] (6 polos → 7 intervalos), por un algoritmo totalmente distinto.
    const F = ce((x, y) => y - Math.tan(x));
    const ramas = geom(F);
    igual(ramas.length, 7, "siete ramas entre polos");
    igual(noFinitos(ramas), 0, "sin coordenadas no finitas cerca de los polos");
  });

  test("seno de gran amplitud y−10sin(x)=0 → conexo (1 rama) y acotado", () => {
    // La curva sale del viewport por arriba/abajo y vuelve; debe trazarse como UNA rama
    // conexa (no fragmentarse) mientras quepa en el margen, sin coords no finitas.
    const F = ce((x, y) => y - 10 * Math.sin(x));
    const ramas = geom(F);
    igual(ramas.length, 1, "una rama conexa");
    igual(noFinitos(ramas), 0, "finita");
  });

  test("óvalos de Cassini (a=1, c=1.1) → 2 componentes cerradas", () => {
    const F = ce((x, y) => (x * x + y * y) ** 2 - 2 * 1.21 * (x * x - y * y) + 1.21 * 1.21 - 1);
    const ramas = geom(F);
    igual(ramas.length, 2, "dos óvalos separados");
    for (const r of ramas) assert(r.cerrada, "cada óvalo cierra");
  });

  test("precisión lejos del origen: círculo centrado en (50,30) → 1 cerrada, residual bajo", () => {
    const vp = crearViewport([42, 58], [23, 37], 768, 261, 1);
    const F = ce((x, y) => (x - 50) ** 2 + (y - 30) ** 2 - 9);
    const ramas = geom(F, vp);
    igual(ramas.length, 1, "una componente");
    assert(ramas[0].cerrada, "cierra");
    assert(residualMax(F, ramas) < 1e-4, `residual ${residualMax(F, ramas)}`);
  });

  test("completitud del muestreo: componentes de radio ≳ una celda se hallan (límite documentado)", () => {
    // El descubrimiento por rejilla halla una componente solo si algún NODO de la rejilla
    // cae dentro (cambio de signo en una arista). Para VP=[-8,8]×[-7,7] (celda ~0.29×0.42)
    // un círculo se halla con holgura para r≥0.4; por debajo de ~0.25 puede perderse (no es
    // un bug: es el límite del muestreo; el descubridor por intervalos es la mejora futura).
    for (const r of [1, 0.6, 0.4]) {
      const F = ce((x, y) => x * x + y * y - r * r);
      igual(geom(F).length, 1, `círculo r=${r} hallado`);
    }
  });
});

// ════════════════════════════════════════════════
// NUEVA CAPACIDAD (Etapa 6): curvas paramétricas y polares.
// Cubre clasificación (sin romper explícita/implícita), trazado (círculo/elipse/
// parábola/Lissajous, polar r=cte/cardioide/rosa), cierre, residual, robustez
// (polos → ramas acotadas, hueco de dominio, dominio vacío), dos pasadas y la
// omisión deliberada de `parametro` en ramas paramétricas.
describe("Paramétricas y polares (Etapa 6)", () => {
  const trz = new TrazadorParametricoAdaptativo();
  // Construye desde texto y traza (pasa por el clasificador real).
  const geomDe = (src: string, vp = VP, tol = TOL_FINAL): { tipo: string; ramas: readonly Rama[] } => {
    const o = construirObjeto(src, "id");
    if (o.tipo !== "parametrica" && o.tipo !== "polar") return { tipo: o.tipo, ramas: [] };
    return { tipo: o.tipo, ramas: trz.trazar((o as ObjetoParametrico | ObjetoPolar).p, "id", vp, tol) };
  };
  const residual = (ramas: readonly Rama[], g: (x: number, y: number) => number): number => {
    let m = 0;
    for (const r of ramas)
      for (let k = 0; k < r.puntos.length; k += 2) m = Math.max(m, Math.abs(g(r.puntos[k], r.puntos[k + 1])));
    return m;
  };
  const noFinitos = (ramas: readonly Rama[]): number => {
    let n = 0;
    for (const r of ramas) for (let k = 0; k < r.puntos.length; k++) if (!Number.isFinite(r.puntos[k])) n++;
    return n;
  };
  const totalPts = (ramas: readonly Rama[]): number => {
    let n = 0; for (const r of ramas) n += r.puntos.length / 2; return n;
  };

  test("clasificación: tupla → paramétrica, r=… → polar; explícita/implícita SIN regresión", () => {
    igual(construirObjeto("(cos(t), sin(t))", "id").tipo, "parametrica", "tupla → paramétrica");
    igual(construirObjeto("(t, t^2)", "id").tipo, "parametrica", "tupla polinómica → paramétrica");
    igual(construirObjeto("r=1+cos(theta)", "id").tipo, "polar", "r=… → polar");
    igual(construirObjeto("r=2", "id").tipo, "polar", "r=cte → polar");
    // Regresión: lo anterior debe seguir clasificando igual.
    igual(construirObjeto("y=sin(x)", "id").tipo, "explicita", "y=f(x) → explícita");
    igual(construirObjeto("sin(x)", "id").tipo, "explicita", "un lado → explícita");
    igual(construirObjeto("x^2+y^2=9", "id").tipo, "implicita", "F(x,y)=0 → implícita");
    igual(construirObjeto("(x+1)*(x-1)", "id").tipo, "explicita", "paréntesis sin coma top → explícita");
  });

  test("círculo paramétrico (cos t, sin t) → 1 rama cerrada sobre x²+y²=1", () => {
    const { tipo, ramas } = geomDe("(cos(t), sin(t))");
    igual(tipo, "parametrica", "tipo");
    igual(ramas.length, 1, "una rama");
    assert(ramas[0].cerrada, "la circunferencia cierra");
    igual(noFinitos(ramas), 0, "finita");
    assert(residual(ramas, (x, y) => x * x + y * y - 1) < 1e-4, "residual sobre el círculo");
    // Tangentes verticales alcanzadas (x=±1) sin artefacto.
    let minX = Infinity, maxX = -Infinity;
    for (let k = 0; k < ramas[0].puntos.length; k += 2) { minX = Math.min(minX, ramas[0].puntos[k]); maxX = Math.max(maxX, ramas[0].puntos[k]); }
    aprox(maxX, 1, 0.02, "x máx ≈ 1"); aprox(minX, -1, 0.02, "x mín ≈ -1");
  });

  test("elipse paramétrica (3cos t, 2sin t) → 1 rama cerrada sobre x²/9+y²/4=1", () => {
    const { ramas } = geomDe("(3*cos(t), 2*sin(t))");
    igual(ramas.length, 1, "una rama"); assert(ramas[0].cerrada, "cierra");
    assert(residual(ramas, (x, y) => x * x / 9 + y * y / 4 - 1) < 1e-4, "residual sobre la elipse");
  });

  test("parábola paramétrica (t, t²) → 1 rama abierta sobre y=x², acotada al margen", () => {
    const { ramas } = geomDe("(t, t^2)");
    igual(ramas.length, 1, "una rama");
    assert(!ramas[0].cerrada, "abierta");
    igual(noFinitos(ramas), 0, "finita");
    assert(residual(ramas, (x, y) => y - x * x) < 1e-6, "los puntos cumplen y=x²");
  });

  test("polar r=2 → circunferencia cerrada sobre x²+y²=4", () => {
    const { tipo, ramas } = geomDe("r=2");
    igual(tipo, "polar", "tipo"); igual(ramas.length, 1, "una rama");
    assert(ramas[0].cerrada, "cierra");
    assert(residual(ramas, (x, y) => x * x + y * y - 4) < 1e-4, "residual sobre r=2");
  });

  test("polar cardioide r=1+cos(theta) → 1 rama cerrada finita", () => {
    const { ramas } = geomDe("r=1+cos(theta)");
    igual(ramas.length, 1, "una rama"); assert(ramas[0].cerrada, "cierra");
    igual(noFinitos(ramas), 0, "finita");
  });

  test("polar rosa r=sin(2theta) → cerrada y finita (4 pétalos en un lazo)", () => {
    const { ramas } = geomDe("r=sin(2theta)");
    assert(ramas.length >= 1, "al menos una rama"); igual(noFinitos(ramas), 0, "finita");
    assert(ramas.some((r) => r.cerrada), "el recorrido cierra");
  });

  test("periodo polar: r=sin(θ/10) traza los 10 lazos (dominio 20π), no un arquito", () => {
    // Bug reportado: con dominio fijo [0,2π] solo se veía 1/10 de la curva (r≤0.59, un
    // arquito junto al origen). El periodo real es 20π; ahí r llega a 1 (en θ=5π).
    const o = construirObjeto("r=sin(theta/10)", "id");
    igual(o.tipo, "polar", "polar");
    aprox((o as ObjetoPolar).p.dominio[1], 20 * Math.PI, 1e-6, "θ ∈ [0, 20π] (periodo real)");
    const { ramas } = geomDe("r=sin(theta/10)");
    igual(noFinitos(ramas), 0, "finita");
    let maxR = 0;
    for (const r of ramas) for (let k = 0; k < r.puntos.length; k += 2)
      maxR = Math.max(maxR, Math.hypot(r.puntos[k], r.puntos[k + 1]));
    aprox(maxR, 1, 0.03, `radio máx ≈ 1 (alcanza θ=5π), fue ${maxR.toFixed(3)}`);
  });

  test("robustez: polar con polos r=1/sin(theta) (recta y=1) → ramas ACOTADAS, no miles", () => {
    // Cerca de θ=0,π el radio → ∞; el trazador deja de seguir lo que sale del margen
    // (no fragmenta en miles de micro-ramas). La y debe ser ≈1 en todo punto.
    const { ramas } = geomDe("r=1/sin(theta)");
    assert(ramas.length <= 8, `ramas acotadas (${ramas.length})`);
    igual(noFinitos(ramas), 0, "sin coordenadas no finitas");
    assert(totalPts(ramas) < 5000, `puntos acotados (${totalPts(ramas)})`);
    let maxDy = 0;
    for (const r of ramas) for (let k = 1; k < r.puntos.length; k += 2) maxDy = Math.max(maxDy, Math.abs(r.puntos[k] - 1));
    assert(maxDy < 1e-6, `y≈1 en toda la recta (máx |y-1|=${maxDy})`);
  });

  test("hueco de dominio: (sqrt(t-3), t) solo existe para t≥3 → finito, x≥~0", () => {
    const { ramas } = geomDe("(sqrt(t-3), t)");
    assert(ramas.length >= 1, "traza la parte definida"); igual(noFinitos(ramas), 0, "finita");
    let minX = Infinity;
    for (const r of ramas) for (let k = 0; k < r.puntos.length; k += 2) minX = Math.min(minX, r.puntos[k]);
    assert(minX > -0.05, `x mín en el borde del dominio (${minX})`);
  });

  test("dominio sin puntos reales (r=sqrt(-1-theta²)) → 0 ramas, sin lanzar", () => {
    const { ramas } = geomDe("r=sqrt(-1-theta^2)");
    igual(ramas.length, 0, "sin ramas");
  });

  test("dos pasadas: interactiva conserva el cierre con menos puntos", () => {
    const fin = geomDe("(cos(t), sin(t))", VP, TOL_FINAL);
    const int = geomDe("(cos(t), sin(t))", VP, TOL_INT);
    igual(int.ramas.length, fin.ramas.length, "misma topología");
    assert(int.ramas[0].cerrada && fin.ramas[0].cerrada, "ambas cierran");
    assert(totalPts(int.ramas) < totalPts(fin.ramas), "interactiva tiene menos puntos");
  });

  test("las ramas paramétricas NO exponen parámetro x (no monovaluadas en x)", () => {
    const { ramas } = geomDe("(cos(t), sin(t))");
    igual(ramas[0].parametro, undefined, "sin parametro (el lookup por x no aplica)");
  });
});

// ════════════════════════════════════════════════
// Implícitas SEPARABLES con polos (Etapa 7): tan x + y² = 2 y similares.
// Una implícita separable en y (lineal o cuadrática par) CON polos se traza como
// 1–2 ramas explícitas con el sampler 1D (corta limpio los polos a cualquier zoom),
// arreglando el bug de la continuación al alejar el zoom (cruzaba los polos y
// conectaba cálices vecinos en ramas espurias de cientos de unidades en x).
describe("Implícitas separables con polos (Etapa 7)", () => {
  const ce2 = (f: (x: number, y: number) => number): CampoEscalar => ({ eval: f });

  test("despejarRamas: cuadrática par → 2 ramas; lineal → 1; no separable → null", () => {
    const tan = despejarRamas(ce2((x, y) => Math.tan(x) + y * y - 2));
    assert(tan !== null && tan.length === 2, "tan x+y²−2 → 2 ramas");
    // rama+ en x=0.5 debe ser √(2−tan 0.5).
    aprox(tan![0].eval(0.5), Math.sqrt(2 - Math.tan(0.5)), 1e-9, "rama+ correcta");
    aprox(tan![1].eval(0.5), -Math.sqrt(2 - Math.tan(0.5)), 1e-9, "rama− correcta");
    // Donde 2−tan x < 0 → NaN (fuera de dominio).
    assert(Number.isNaN(tan![0].eval(1.4)), "NaN donde no hay solución real");

    const lineal = despejarRamas(ce2((x, y) => y - Math.sin(x)));
    assert(lineal !== null && lineal.length === 1, "y−sin(x) → 1 rama (lineal)");
    aprox(lineal![0].eval(0.5), Math.sin(0.5), 1e-9, "rama lineal = sin(x)");

    assert(despejarRamas(ce2((x, y) => x ** 3 + y ** 3 - 3 * x * y)) === null, "folium (cúbica) → null");
    assert(despejarRamas(ce2((x, y) => Math.cos(y) + x)) === null, "cos(y)+x (par no cuadrática) → null");
  });

  test("tienePolos: tan/sec sí; cónicas no (el gate que preserva los lazos cerrados)", () => {
    assert(tienePolos(ce2((x, y) => Math.tan(x) + y * y - 2)), "tan x+y²−2 tiene polos");
    assert(tienePolos(ce2((x, y) => 1 / Math.cos(x) + y * y - 1)), "sec x+y²−1 tiene polos");
    assert(!tienePolos(ce2((x, y) => x * x + y * y - 9)), "círculo NO tiene polos");
    assert(!tienePolos(ce2((x, y) => x * x / 16 + y * y / 4 - 1)), "elipse NO tiene polos");
    assert(!tienePolos(ce2((x, y) => x * x - y * y - 1)), "hipérbola NO tiene polos");
  });

  test("tan x+y²=2 por ramas explícitas: limpio a TODO zoom (sin ramas espurias)", () => {
    // Lock del bug de zoom-out: la continuación producía ramas de >200 en x al alejar;
    // la ruta separable mantiene cada cálice como rama acotada (extensión x ~ una franja).
    const F = ce2((x, y) => Math.tan(x) + y * y - 2);
    const ramas = despejarRamas(F)!;
    const prov = new ProveedorImplicitoSeparable("id", ramas, new TrazadorExplicitoAdaptativo(), F);
    for (const semi of [8, 96, 300]) {
      const sa = semi * 261 / 768;
      const vp = crearViewport([-semi, semi], [-sa, sa], 768, 261, 1);
      for (const pasada of ["final", "interactiva"] as const) {
        const g = prov.geometria(vp, { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada });
        let maxXext = 0, noFin = 0;
        for (const r of g.ramas) {
          let a = Infinity, b = -Infinity;
          for (let k = 0; k < r.puntos.length; k += 2) {
            a = Math.min(a, r.puntos[k]); b = Math.max(b, r.puntos[k]);
            if (!Number.isFinite(r.puntos[k]) || !Number.isFinite(r.puntos[k + 1])) noFin++;
          }
          maxXext = Math.max(maxXext, b - a);
        }
        igual(noFin, 0, `x±${semi} ${pasada}: sin coords no finitas`);
        assert(maxXext < 5, `x±${semi} ${pasada}: sin ramas espurias (maxXext=${maxXext.toFixed(1)})`);
        assert(g.ramas.length >= 1, `x±${semi} ${pasada}: traza algo`);
      }
    }
  });

  test("despejarRamas generaliza a yⁿ: cúbica → 1 rama (∛), cuártica → 2", () => {
    const cub = despejarRamas(ce2((x, y) => Math.tan(x) + y ** 3 - 2));
    assert(cub !== null && cub.length === 1, "tan x+y³−2 → 1 rama (raíz impar)");
    aprox(cub![0].eval(0.5), Math.cbrt(2 - Math.tan(0.5)), 1e-9, "∛(2−tan x)");
    // ∛ es real también para radicando negativo:
    assert(Number.isFinite(cub![0].eval(1.4)) && cub![0].eval(1.4) < 0, "∛ negativo definido");
    const cuart = despejarRamas(ce2((x, y) => Math.tan(x) + y ** 4 - 2));
    assert(cuart !== null && cuart.length === 2, "tan x+y⁴−2 → 2 ramas (raíz par)");
    // y⁵ (impar alto) → 1 rama; mezcla de potencias → null
    assert(despejarRamas(ce2((x, y) => y ** 5 + x))!.length === 1, "y⁵+x → 1 rama");
    assert(despejarRamas(ce2((x, y) => y ** 2 + y ** 3 + x)) === null, "y²+y³ (mezcla) → null");
  });

  test("tan x+y³=2 (cúbica): limpio a TODO zoom — corte en polos evita conexión espuria", () => {
    // La ∛ comprime el polo; sin el corte en polos el sampler conectaría a través al
    // alejar el zoom (rama de cientos de unidades). Con el corte: cada tramo acotado.
    const F = ce2((x, y) => Math.tan(x) + y ** 3 - 2);
    const prov = new ProveedorImplicitoSeparable("id", despejarRamas(F)!, new TrazadorExplicitoAdaptativo(), F);
    for (const semi of [8, 96, 300]) {
      const sa = semi * 261 / 768;
      const vp = crearViewport([-semi, semi], [-sa, sa], 768, 261, 1);
      for (const pasada of ["final", "interactiva"] as const) {
        const g = prov.geometria(vp, { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada });
        let maxXext = 0;
        for (const r of g.ramas) {
          let a = Infinity, b = -Infinity;
          for (let k = 0; k < r.puntos.length; k += 2) { a = Math.min(a, r.puntos[k]); b = Math.max(b, r.puntos[k]); }
          maxXext = Math.max(maxXext, b - a);
        }
        // Cada rama abarca a lo sumo ~un periodo de tan (π) entre polos consecutivos.
        assert(maxXext < 4, `x±${semi} ${pasada}: ramas acotadas (maxXext=${maxXext.toFixed(1)})`);
      }
    }
  });

  test("cúbica: la pasada interactiva alcanza el borde en los polos (verticales limpias)", () => {
    // Bug de "barras" durante el zoom: la ∛ comprime el polo y la pasada interactiva no
    // refinaba lo bastante (|y| llegaba a ~65 en una vista ±44, verticales inclinadas). El
    // corte en polos EXTIENDE el extremo al borde si no llegó → todas las ramas lo alcanzan.
    const F = ce2((x, y) => Math.tan(x) + y ** 3 - 2);
    const prov = new ProveedorImplicitoSeparable("id", despejarRamas(F)!, new TrazadorExplicitoAdaptativo(), F);
    const vp = crearViewport([-130, 130], [-44, 44], 768, 261, 1);
    for (const pasada of ["interactiva", "final"] as const) {
      const g = prov.geometria(vp, { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada });
      let alcanzan = 0;
      for (const r of g.ramas) {
        let ry = 0;
        for (let k = 1; k < r.puntos.length; k += 2) ry = Math.max(ry, Math.abs(r.puntos[k]));
        if (ry >= 44) alcanzan++;
      }
      assert(alcanzan === g.ramas.length && g.ramas.length > 20,
        `${pasada}: todas (${alcanzan}/${g.ramas.length}) alcanzan el borde`);
    }
  });

  test("las ramas separadas cumplen F≈0 (están sobre la curva)", () => {
    const F = ce2((x, y) => Math.tan(x) + y * y - 2);
    const prov = new ProveedorImplicitoSeparable("id", despejarRamas(F)!, new TrazadorExplicitoAdaptativo(), F);
    const vp = crearViewport([-8, 8], [-7, 7], 768, 261, 1);
    const g = prov.geometria(vp, TOL_FINAL);
    let maxF = 0;
    for (const r of g.ramas) for (let k = 0; k < r.puntos.length; k += 2) {
      const y = r.puntos[k + 1];
      if (y > vp.domY[0] && y < vp.domY[1]) maxF = Math.max(maxF, Math.abs(F.eval(r.puntos[k], y)));
    }
    assert(maxF < 1e-3, `residual sobre la curva (visible) ${maxF}`);
  });
});

// ════════════════════════════════════════════════
// Implícitas afines en un monomio RECÍPROCO/ABSOLUTO de y (1/|x|+1/|y|=1): el
// descubrimiento por rejilla las perdía al alejar el zoom (la curva se pega a su
// asíntota y el cambio de signo cabe en una celda; la fila y=0 es un polo y se
// descarta) → ramas explícitas con el sampler 1D.
describe("Implícitas afines en monomio recíproco/absoluto (1/|x|+1/|y|=1)", () => {
  const ce2 = (f: (x: number, y: number) => number): CampoEscalar => ({ eval: f });

  test("ramasMonomioY: 1/|y| → 2 ramas; 1/y → 1; |y| → 2; polinómica → null", () => {
    // 1/|x|+1/|y|=1 ⇒ |y| = |x|/(|x|−1) ⇒ y = ±|x|/(|x|−1), solo donde |x|>1.
    const rec = ramasMonomioY(ce2((x, y) => 1 / Math.abs(x) + 1 / Math.abs(y) - 1));
    assert(rec !== null && rec.length === 2, "1/|x|+1/|y|−1 → 2 ramas");
    aprox(rec![0].eval(2), 2 / (2 - 1), 1e-9, "rama+ en x=2 → 2");
    aprox(rec![1].eval(2), -2 / (2 - 1), 1e-9, "rama− en x=2 → −2");
    aprox(rec![0].eval(-2), 2 / (2 - 1), 1e-9, "simétrica en x=−2 → 2");
    assert(Number.isNaN(rec![0].eval(0.5)), "|x|<1 → fuera de dominio (NaN)");

    // 1/x+1/y=1 ⇒ y = x/(x−1): monomio IMPAR → UNA rama.
    const imp = ramasMonomioY(ce2((x, y) => 1 / x + 1 / y - 1));
    assert(imp !== null && imp.length === 1, "1/x+1/y−1 → 1 rama");
    aprox(imp![0].eval(2), 2 / (2 - 1), 1e-9, "y(2)=2");
    aprox(imp![0].eval(0.5), 0.5 / (0.5 - 1), 1e-9, "y(0.5)=−1 (rama del cuadrante IV)");

    // |x|+|y|=1 (rombo) ⇒ y = ±(1−|x|).
    const rombo = ramasMonomioY(ce2((x, y) => Math.abs(x) + Math.abs(y) - 1));
    assert(rombo !== null && rombo.length === 2, "|x|+|y|−1 → 2 ramas");
    aprox(rombo![0].eval(0.25), 0.75, 1e-9, "rama+ del rombo");

    // No debe SECUESTRAR lo que ya resuelven bien los otros proveedores.
    assert(ramasMonomioY(ce2((x, y) => x * x + y * y - 16)) === null, "círculo → null (sigue en continuación)");
    assert(ramasMonomioY(ce2((x, y) => Math.tan(x) + y * y - 2)) === null, "tan x+y² → null (ya es separable)");
    assert(ramasMonomioY(ce2((x, y) => (x * x + y * y) ** 2 - 2 * (x * x - y * y))) === null, "lemniscata → null");
  });

  test("1/|x|+1/|y|=1: las 4 ramas SOBREVIVEN al zoom-out (lock del bug)", () => {
    // Bug: más allá de cierto zoom-out desaparecían ramas (en la captura, el cuadrante IV).
    // La rejilla de descubrimiento no ve el cambio de signo cuando la curva se pega a |y|=1.
    const objeto = construirObjeto("|x|^{-1}+|y|^{-1}=1", "mono");
    const cuadrante = (x: number, y: number): number | null => {
      if (Math.abs(x) < 1e-9 || Math.abs(y) < 1e-9) return null;
      return x > 0 ? (y > 0 ? 1 : 4) : (y > 0 ? 2 : 3);
    };
    for (const semi of [5, 20, 100, 200, 500]) {
      const prov = crearProveedor(objeto);          // proveedor fresco: sin caché entre zooms
      const sa = semi * 261 / 768;
      const vp = crearViewport([-semi, semi], [-sa, sa], 768, 261, 1);
      const g = prov.geometria(vp, { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada: "final" });
      const vistos = new Set<number>();
      for (const r of g.ramas)
        for (let i = 0; i + 1 < r.puntos.length; i += 2) {
          const c = cuadrante(r.puntos[i], r.puntos[i + 1]);
          if (c) vistos.add(c);
        }
      for (const c of [1, 2, 3, 4])
        assert(vistos.has(c), `semi=${semi}: falta la rama del cuadrante ${c}`);
    }
  });
});

// ════════════════════════════════════════════════
// Multiplicación implícita (Etapa 8): 3xy → 3*x*y, sin reconocido como función.
// Paso de parsing propio del motor nuevo (no toca el parser compartido). Reconoce
// funciones/constantes como átomos y multiplica el resto.
describe("Multiplicación implícita (Etapa 8)", () => {
  const I = insertarProductoImplicito;

  test("variables pegadas se multiplican; funciones/constantes se preservan", () => {
    igual(I("3xy"), "3*x*y", "3xy");
    igual(I("xy"), "x*y", "xy");
    igual(I("x(x+1)"), "x*(x+1)", "x(x+1)");
    igual(I("(x+1)(x-1)"), "(x+1)*(x-1)", "(x+1)(x-1)");
    igual(I("2sin(x)"), "2*sin(x)", "2sin(x)");
    igual(I("xsin(x)"), "x*sin(x)", "xsin(x): el sin es función, la x variable");
    igual(I("sin(x)"), "sin(x)", "sin(x) intacto");
    igual(I("sqrt(x)"), "sqrt(x)", "sqrt intacto");
    igual(I("nthRoot(x,3)"), "nthRoot(x,3)", "nthRoot intacto");
    igual(I("2theta"), "2*theta", "2theta (constante de varias letras)");
    igual(I("2pi"), "2*pi", "2pi");
    igual(I("pix"), "pi*x", "pix → pi*x");
  });

  test("no rompe la notación científica", () => {
    igual(I("2e5"), "2e5", "2e5");
    igual(I("1.5e-3"), "1.5e-3", "1.5e-3");
    igual(I("2e5+x"), "2e5+x", "2e5+x");
  });

  test("camino completo: x³+y³=3xy clasifica implícita con F correcta", () => {
    const o = construirObjeto("x^3+y^3=3xy", "id");
    igual(o.tipo, "implicita", "tipo");
    // En (0.9,0.9): 0.729+0.729−3·0.81 = −0.972.
    aprox((o as { F: { eval(x: number, y: number): number } }).F.eval(0.9, 0.9), -0.972, 1e-3, "F(0.9,0.9)");
  });

  test("camino completo: y=2x y y=x sin(x) son explícitas correctas", () => {
    const dosx = construirObjeto("y=2x", "id");
    igual(dosx.tipo, "explicita", "y=2x → explícita");
    aprox((dosx as ObjetoExplicito).f.eval(3), 6, 1e-9, "2x en x=3 = 6");
    const xsinx = construirObjeto("y=x sin(x)", "id");
    aprox((xsinx as ObjetoExplicito).f.eval(Math.PI / 2), Math.PI / 2, 1e-9, "x·sin(x) en π/2");
  });
});

// ════════════════════════════════════════════════
// Sistemas (Etapa 9): varias ecuaciones por bloque → N objetos con N colores.
describe("Sistemas: varias ecuaciones (Etapa 9)", () => {
  const TOL: Tolerancia = TOL_FINAL;

  test("dividirEcuaciones: por líneas, por \\\\ (cases), 1 línea, vacío; no parte la coma", () => {
    igual(dividirEcuaciones("y=x\ny=-x").length, 2, "dos líneas → 2");
    igual(dividirEcuaciones("y=x").length, 1, "una línea → 1");
    igual(dividirEcuaciones("   ").length, 0, "vacío → 0");
    igual(dividirEcuaciones("\\begin{cases}y=x\\\\y=2x\\end{cases}").length, 2, "cases → 2");
    // La tupla paramétrica lleva coma pero es UNA ecuación (no se parte por comas).
    const par = dividirEcuaciones("(cos(t), sin(t))");
    igual(par.length, 1, "tupla paramétrica = 1 ecuación");
    igual(par[0], "(cos(t), sin(t))", "tupla intacta");
  });

  test("dividirEcuaciones: cases con aligned anidado, `\\\\[1ex]` y marcadores `&`", () => {
    // Formato EXACTO que emite el panel LaTeX (round-trip: lo mostrado se puede
    // volver a pegar como entrada). El `&` es alineación, no operador; `\\[1ex]` es
    // el salto con argumento de espaciado. Cada `\\` de una cadena JS = 1 backslash;
    // la entrada real tiene 2 backslashes en `\\[1ex]` → aquí `\\\\[1ex]`.
    const eqs = dividirEcuaciones(
      "\\begin{cases}\\begin{aligned}x+y&=2\\\\[1ex]x-y&=0\\end{aligned}\\end{cases}"
    );
    igual(eqs.length, 2, "aligned anidado → 2 ecuaciones");
    igual(eqs[0], "x+y=2", "sin `&`, sin entorno, sin `\\[1ex]`");
    igual(eqs[1], "x-y=0", "segunda ecuación limpia");
    // Con espacios alrededor de `&` y `\\` sin argumento de espaciado.
    const conEspacios = dividirEcuaciones(
      "\\begin{cases}\\begin{aligned}x+y &= 2 \\\\ x-y &= 0\\end{aligned}\\end{cases}"
    );
    igual(conEspacios.length, 2, "con espacios y `\\\\` pelado → 2");
    // array{lcl} con su spec de columnas también se desenvuelve.
    igual(dividirEcuaciones("\\begin{array}{lcl}y=x\\\\y=2x\\end{array}").length, 2, "array{lcl} → 2");
  });

  test("crearProveedor elige el proveedor por tipo de objeto", () => {
    assert(crearProveedor(construirObjeto("y=x^2", "id")) instanceof ProveedorExplicito, "explícita");
    assert(crearProveedor(construirObjeto("x^2+y^2=9", "id")) instanceof ProveedorImplicito, "implícita suave → continuación");
    assert(crearProveedor(construirObjeto("tan(x)+y^2=2", "id")) instanceof ProveedorImplicitoSeparable, "separable con polos");
    assert(crearProveedor(construirObjeto("(cos(t),sin(t))", "id")) instanceof ProveedorParametrico, "paramétrica");
    assert(crearProveedor(construirObjeto("r=1+cos(theta)", "id")) instanceof ProveedorParametrico, "polar");
  });

  test("construirObjetosEscena: un sistema → N objetos con colores distintos, cada uno traza", () => {
    const objs = construirObjetosEscena("y=x\nx^2+y^2=9\n(cos(t),sin(t))");
    igual(objs.length, 3, "tres ecuaciones → tres objetos");
    // Colores distintos (paleta).
    const cols = objs.map((o) => o.estilo.color.join(","));
    igual(new Set(cols).size, 3, "tres colores distintos");
    // Cada proveedor produce geometría (al menos una rama) en una vista estándar.
    for (const o of objs) {
      const g = o.proveedor.geometria(VP, TOL);
      assert(g.ramas.length >= 1, "cada objeto del sistema traza al menos una rama");
    }
  });

  test("sistema lineal {y=x, y=-x}: dos rectas que se cruzan en el origen", () => {
    const objs = construirObjetosEscena("y=x\ny=-x");
    igual(objs.length, 2, "dos rectas");
    const ys = objs.map((o) => {
      const r = o.proveedor.geometria(VP, TOL).ramas[0];
      // y en x=2 leído de la geometría: +2 y −2 respectivamente (en algún orden).
      return yEnRamas([r], 2)!;
    }).sort((a, b) => a - b);
    aprox(ys[0], -2, 0.05, "una recta da y(2)=−2");
    aprox(ys[1], 2, 0.05, "la otra da y(2)=+2");
  });

  test("un solo objeto sigue funcionando (sin regresión de bloque de 1 ecuación)", () => {
    igual(construirObjetosEscena("y=sin(x)").length, 1, "una ecuación → un objeto");
    igual(construirObjetosEscena("").length, 0, "bloque vacío → cero objetos (plano vacío)");
  });
});

// ════════════════════════════════════════════════
describe("Intersecciones del sistema (Etapa 11): derivadas de la geometría", () => {
  const EPS_M = ((VP.domX[1] - VP.domX[0]) / VP.anchoPx) * 3; // 3 px en mundo
  const geoms = (src: string): Geometria[] =>
    construirObjetosEscena(src).map((o) => o.proveedor.geometria(VP, TOL_FINAL));
  // Mismo filtro a la vista que aplica la Escena (la geometría desborda el viewport).
  const enVista = (pts: readonly Punto[]): Punto[] =>
    pts.filter((p) =>
      p.x >= VP.domX[0] && p.x <= VP.domX[1] &&
      p.y >= VP.domY[0] && p.y <= VP.domY[1]);

  test("interseccionSegmentos: cruce, paralelos, colineales, fuera de rango, contacto", () => {
    const p = interseccionSegmentos(-1, -1, 1, 1, -1, 1, 1, -1)!;
    aprox(p.x, 0, 1e-12, "cruce de diagonales: x=0");
    aprox(p.y, 0, 1e-12, "cruce de diagonales: y=0");
    igual(interseccionSegmentos(0, 0, 1, 0, 0, 1, 1, 1), null, "paralelos → null");
    igual(interseccionSegmentos(0, 0, 1, 0, 2, 0, 3, 0), null, "colineales → null (sin punto aislado)");
    igual(interseccionSegmentos(0, 0, 1, 1, 2, 0, 3, -1), null, "se cortarían fuera del rango → null");
    const q = interseccionSegmentos(0, 0, 1, 1, 1, 1, 2, 0)!;
    aprox(q.x, 1, 1e-9, "contacto exacto en el extremo compartido");
  });

  test("dos rectas {y=x, y=−x} → exactamente (0,0)", () => {
    const pts = enVista(interseccionesDeGeometrias(geoms("y=x\ny=-x"), EPS_M));
    igual(pts.length, 1, "una sola intersección");
    aprox(pts[0].x, 0, 1e-6, "x=0");
    aprox(pts[0].y, 0, 1e-6, "y=0");
  });

  test("recta y=x × círculo x²+y²=9 (explícita × continuación) → ±(3/√2, 3/√2)", () => {
    const pts = enVista(interseccionesDeGeometrias(geoms("y=x\nx^2+y^2=9"), EPS_M));
    igual(pts.length, 2, "dos cruces recta-círculo");
    const r = 3 / Math.SQRT2;
    const orden = [...pts].sort((a, b) => a.x - b.x);
    aprox(orden[0].x, -r, 0.02, "cruce inferior x≈−2.1213 (precisión del trazado)");
    aprox(orden[0].y, -r, 0.02, "cruce inferior y");
    aprox(orden[1].x, r, 0.02, "cruce superior x");
    aprox(orden[1].y, r, 0.02, "cruce superior y");
  });

  test("parábola y=x² × recta y=4 → (±2, 4)", () => {
    const pts = enVista(interseccionesDeGeometrias(geoms("y=x^2\ny=4"), EPS_M));
    igual(pts.length, 2, "dos cruces");
    const orden = [...pts].sort((a, b) => a.x - b.x);
    aprox(orden[0].x, -2, 0.01, "x=−2");
    aprox(orden[1].x, 2, 0.01, "x=+2");
    aprox(orden[0].y, 4, 0.01, "y=4");
  });

  test("y=sin(x) × y=0 → los 5 ceros kπ de la vista, con precisión del trazado", () => {
    const pts = enVista(interseccionesDeGeometrias(geoms("y=sin(x)\ny=0"), EPS_M));
    igual(pts.length, 5, "kπ para k=−2..2 en [−8,8]");
    const orden = [...pts].sort((a, b) => a.x - b.x);
    for (let k = -2; k <= 2; k++) {
      aprox(orden[k + 2].x, k * Math.PI, 0.01, `cero en ${k}π`);
    }
  });

  test("sin cruce → 0; curvas SOLAPADAS (misma recta ×2) → 0 puntos aislados, sin colgarse", () => {
    igual(enVista(interseccionesDeGeometrias(geoms("x^2+y^2=9\ny=5"), EPS_M)).length, 0,
      "círculo r=3 y recta y=5 no se tocan");
    igual(enVista(interseccionesDeGeometrias(geoms("y=x\ny=x"), EPS_M)).length, 0,
      "solape colineal: infinitas soluciones → 0 aisladas (límite documentado)");
  });

  test("solape → estado.solapa=true; cruce transversal e inexistente → false (infinitas vs. no)", () => {
    const solapa = (src: string): boolean => {
      const e = { solapa: false };
      interseccionesDeGeometrias(geoms(src), EPS_M, undefined, undefined, e);
      return e.solapa;
    };
    assert(solapa("y=x\ny=x"), "rectas idénticas → coinciden (infinitas)");
    assert(solapa("y=2x+1\ny=2x+1"), "misma recta repetida → coinciden");
    assert(!solapa("y=x\ny=-x"), "cruce transversal aislado → NO solapa");
    assert(!solapa("y=x\ny=x+3"), "paralelas distintas → NO solapa");
    assert(!solapa("y=x^2\ny=4"), "parábola y recta → cruces aislados, NO solapa");
  });

  test("tres objetos {y=x, y=−x, x²+y²=9} → 5 intersecciones (todos los pares)", () => {
    const pts = enVista(interseccionesDeGeometrias(geoms("y=x\ny=-x\nx^2+y^2=9"), EPS_M));
    igual(pts.length, 5, "origen + 4 cruces recta-círculo");
  });

  test("paramétrica (cos t, sin t) × explícita y=x (tipos mixtos, agnóstico)", () => {
    const pts = enVista(interseccionesDeGeometrias(geoms("(cos(t), sin(t))\ny=x"), EPS_M));
    igual(pts.length, 2, "círculo unitario paramétrico corta a y=x en 2 puntos");
    const r = 1 / Math.SQRT2;
    const orden = [...pts].sort((a, b) => a.x - b.x);
    aprox(orden[0].x, -r, 0.02, "−1/√2");
    aprox(orden[1].x, r, 0.02, "+1/√2");
  });

  test("caso denso y=sin(10x) × y=0: cuenta exacta y acotada (dedup + cap deterministas)", () => {
    const pts = enVista(interseccionesDeGeometrias(geoms("y=sin(10x)\ny=0"), EPS_M));
    igual(pts.length, 51, "kπ/10 para k=−25..25 en [−8,8]");
  });

  test("Escena: calcula en pasada final, conserva en interactiva, expone intersecciones()", () => {
    const objs = construirObjetosEscena("y=x\ny=-x");
    const ctxNulo = null as unknown as CanvasRenderingContext2D;
    const escena = new Escena(objs, new Overlay(ctxNulo), new RendererCanvas2D(ctxNulo), new Crosshair(ctxNulo));
    escena.actualizar(VP); // default = "final"
    igual(escena.intersecciones().length, 1, "pasada final calcula el cruce");
    aprox(escena.intersecciones()[0].x, 0, 1e-6, "cruce en el origen");
    // Pasada interactiva (gesto): NO recalcula; conserva los puntos de mundo previos.
    const VP2 = crearViewport([-7, 9], [-7, 7], 768, 261, 1);
    escena.actualizar(VP2, "interactiva");
    igual(escena.intersecciones().length, 1, "interactiva conserva las últimas intersecciones");
  });
});

// ════════════════════════════════════════════════
describe("Separables en X (transpuestas) + saturación de intersecciones (Etapa 12)", () => {
  // Extensión en y de la rama más ancha (en y) de una geometría. Para x=g(y) con
  // polos (tan y+x=5), cada rama legítima vive en un intervalo de π en y; más que
  // eso = cruzó un polo de tan(y) (la rama horizontal espuria del bug reportado).
  const maxYext = (g: Geometria): number => {
    let peor = 0;
    for (const r of g.ramas) {
      let y0 = Infinity, y1 = -Infinity;
      for (let i = 1; i < r.puntos.length; i += 2) {
        const y = r.puntos[i];
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (y1 - y0 > peor) peor = y1 - y0;
    }
    return peor;
  };

  test("gate: tan(y)+x=5 (separable en X) va a la ruta separable; el resto sin cambio", () => {
    assert(crearProveedor(construirObjeto("tan(y)+x=5", "id")) instanceof ProveedorImplicitoSeparable,
      "separable en x con polos → ProveedorImplicitoSeparable (transpuesta)");
    assert(crearProveedor(construirObjeto("tan(x)+y^2=2", "id")) instanceof ProveedorImplicitoSeparable,
      "separable en y sigue igual (sin regresión)");
    assert(crearProveedor(construirObjeto("x^2+y^2=9", "id")) instanceof ProveedorImplicito,
      "cónica suave sigue por continuación (sin regresión)");
  });

  test("campoTranspuesto + despejarRamas: tan(y)+x=5 se despeja como x = 5−tan(y)", () => {
    const F = (construirObjeto("tan(y)+x=5", "id") as ObjetoImplicito).F;
    const ramas = despejarRamas(campoTranspuesto(F));
    assert(ramas !== null && ramas.length === 1, "una rama (lineal en x)");
    aprox(ramas![0].eval(0), 5, 1e-9, "g(0) = 5 − tan(0) = 5");
    aprox(ramas![0].eval(Math.PI / 4), 4, 1e-9, "g(π/4) = 5 − 1 = 4");
  });

  test("tan(y)+x=5: sin ramas espurias a NINGÚN zoom ni pasada (maxYext ≤ π)", () => {
    const prov = crearProveedor(construirObjeto("tan(y)+x=5", "id"));
    for (const s of [8, 96, 250]) {
      const vp = crearViewport([-s, s], [-s * 7 / 8, s * 7 / 8], 768, 261, 1);
      for (const pasada of ["final", "interactiva"] as const) {
        const g = prov.geometria(vp, { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada });
        assert(g.ramas.length >= 3, `x±${s} ${pasada}: hay ramas (${g.ramas.length})`);
        assert(maxYext(g) <= Math.PI + 0.1,
          `x±${s} ${pasada}: maxYext=${maxYext(g).toFixed(1)} ≤ π (no cruza polos de tan y)`);
        for (const r of g.ramas) {
          for (let i = 0; i < r.puntos.length; i++) {
            assert(Number.isFinite(r.puntos[i]), "coordenadas finitas");
          }
        }
      }
    }
  });

  test("tan(y)+x=5: zoom out profundo sin segmentos que crucen la vista (ambas pasadas)", () => {
    // Bug: en zoom out, el cero de c(y)=tan(y)−5 queda a 0.197 del polo — menos que el
    // paso del escaneo de localizarPolos — y ESCONDE el polo (mismo signo a ambos flancos).
    // La pasada interactiva (refinado corto) conectaba entonces a través del polo con dos
    // valores finitos, y al girar la geometría ese segmento cruzaba TODO el lienzo en
    // horizontal (relleno azul). El corte defensivo del trazador (salto > una vista de
    // alto en un intervalo subpíxel) debe eliminarlos en las DOS pasadas.
    const prov = crearProveedor(construirObjeto("tan(y)+x=5", "id"));
    for (const s of [1000, 2500]) {
      const domX: [number, number] = [-s, s];
      const domY: [number, number] = [-s * 7 / 8, s * 7 / 8];
      const vp = crearViewport(domX, domY, 768, 261, 1);
      for (const pasada of ["interactiva", "final"] as const) {
        const g = prov.geometria(vp, { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada });
        let cruces = 0;
        for (const r of g.ramas) {
          const p = r.puntos;
          for (let i = 2; i + 1 < p.length; i += 2) {
            const yVis = Math.abs(p[i - 1]) <= domY[1] || Math.abs(p[i + 1]) <= domY[1];
            const lo = Math.max(Math.min(p[i - 2], p[i]), domX[0]);
            const hi = Math.min(Math.max(p[i - 2], p[i]), domX[1]);
            if (yVis && hi - lo > (domX[1] - domX[0]) * 0.6) cruces++;
          }
        }
        igual(cruces, 0, `x±${s} ${pasada}: sin segmentos que crucen la vista`);
      }
    }
  });

  test("tan(y)+x=5: residual ~0 sobre la curva y `parametro` omitido (como implícitas)", () => {
    const F = (construirObjeto("tan(y)+x=5", "id") as ObjetoImplicito).F;
    const prov = crearProveedor(construirObjeto("tan(y)+x=5", "id"));
    const g = prov.geometria(VP, TOL_FINAL);
    let peor = 0, n = 0;
    for (const r of g.ramas) {
      igual(r.parametro, undefined, "parametro omitido (yEnRamas lo leería como x)");
      for (let i = 0; i + 1 < r.puntos.length; i += 2) {
        const x = r.puntos[i], y = r.puntos[i + 1];
        // Solo puntos interiores a la vista (los de extensión al borde son sintéticos).
        if (Math.abs(x) > 8 || Math.abs(y) > 7) continue;
        const v = Math.abs(F.eval(x, y));
        if (Number.isFinite(v)) { if (v > peor) peor = v; n++; }
      }
    }
    assert(n > 100, `suficientes puntos en vista (${n})`);
    assert(peor < 1e-6, `residual máx ${peor.toExponential(1)} < 1e-6`);
  });

  test("tan(y)+x=5: asíntotas HORIZONTALES en y=(k+½)π (pasada final)", () => {
    const prov = crearProveedor(construirObjeto("tan(y)+x=5", "id"));
    const g = prov.geometria(VP, TOL_FINAL);
    const horiz = g.asintotas.filter((a) => a.tipo === "horizontal");
    assert(horiz.length >= 2, `hay asíntotas horizontales (${horiz.length})`);
    assert(horiz.some((a) => Math.abs((a.valor as number) - Math.PI / 2) < 0.01),
      "una en y ≈ π/2");
    igual(g.asintotas.filter((a) => a.tipo === "vertical").length, 0, "ninguna vertical");
  });

  test("saturación: >200 cruces → cap exacto en analysis; la Escena descarta y avisa", () => {
    // 15 verticales × 15 horizontales sintéticas = 225 cruces > MAX_PUNTOS.
    const linea = (pts: number[]): Rama =>
      ({ puntos: Float64Array.from(pts), cerrada: false, calidad: "exacta", objetoId: "s" });
    const gV: Geometria = {
      ramas: Array.from({ length: 15 }, (_, i) => linea([i - 7, -6.5, i - 7, 6.5])),
      singularidades: [], puntosNotables: [], asintotas: [],
    };
    const gH: Geometria = {
      ramas: Array.from({ length: 15 }, (_, j) => linea([-7.5, j * 0.9 - 6.3, 7.5, j * 0.9 - 6.3])),
      singularidades: [], puntosNotables: [], asintotas: [],
    };
    igual(interseccionesDeGeometrias([gV, gH], 0.01).length, MAX_PUNTOS, "cap determinista");

    const estilo: Estilo = { color: [1, 1, 1, 1], grosorPx: 2 };
    const provFake = (g: Geometria): ProveedorGeometria => ({ objetoId: "f", geometria: () => g });
    const ctxNulo = null as unknown as CanvasRenderingContext2D;
    const escena = new Escena(
      [{ proveedor: provFake(gV), estilo }, { proveedor: provFake(gH), estilo }],
      new Overlay(ctxNulo), new RendererCanvas2D(ctxNulo), new Crosshair(ctxNulo)
    );
    escena.actualizar(VP);
    assert(escena.interseccionesSaturadas(), "saturado detectado");
    igual(escena.intersecciones().length, 0, "no se expone un subconjunto sesgado");
  });

  test("sin saturar (caso normal) el flag queda apagado", () => {
    const objs = construirObjetosEscena("y=x\ny=-x");
    const ctxNulo = null as unknown as CanvasRenderingContext2D;
    const escena = new Escena(objs, new Overlay(ctxNulo), new RendererCanvas2D(ctxNulo), new Crosshair(ctxNulo));
    escena.actualizar(VP);
    assert(!escena.interseccionesSaturadas(), "no saturado");
    igual(escena.intersecciones().length, 1, "el cruce sigue ahí");
  });
});

// ════════════════════════════════════════════════
// Trig periódica en y con coeficiente a(x) — F = a(x)·T(y)+c(x) (Etapa 13). La
// continuación perdía ramas casi horizontales al alejar el zoom (el grid de semillas
// no las ve todas: tan(y)·(x²+1)=√(x+1)); ahora son infinitas ramas explícitas
// y = T⁻¹(g(x)) + k·período con el sampler 1D (misma filosofía que Etapas 7/12).
describe("Trig periódica en y: a(x)·T(y)+c(x)=0 (Etapa 13)", () => {
  const SRC = "tan(y)(x^2+1)=sqrt(x+1)";
  const F = (s: string) => (construirObjeto(s, "id") as ObjetoImplicito).F;

  test("separarTrigY: detecta tan/sec/sin/cos con a(x); rechaza lo que no es afín en T", () => {
    igual(separarTrigY(F(SRC))?.tipo, "tan", "tan con a(x)=x²+1");
    igual(separarTrigY(F("sec(y)(x^2+1)=x"))?.tipo, "sec", "sec con a(x)");
    igual(separarTrigY(F("sin(y)*x=1"))?.tipo, "sin", "sin con a(x)=x");
    igual(separarTrigY(F("x^2+y^2=9")), null, "círculo → null");
    igual(separarTrigY(F("x*y=1")), null, "hipérbola → null");
    igual(separarTrigY(F("tan(y)+y=x")), null, "y fuera de la trig → null");
    igual(separarTrigY(F("tan(y)^2=x")), null, "cuadrática en tan → null");
    // g(x) = √(x+1)/(x²+1): el valor despejado es correcto.
    const g = separarTrigY(F(SRC))!.g;
    aprox(g(0), 1, 1e-9, "g(0)=√1/1=1");
    aprox(g(3), Math.sqrt(4) / 10, 1e-9, "g(3)=2/10");
  });

  test("gate: va a ProveedorImplicitoPeriodico; las rutas previas no cambian", () => {
    assert(crearProveedor(construirObjeto(SRC, "id")) instanceof ProveedorImplicitoPeriodico, "trig en y");
    assert(crearProveedor(construirObjeto("tan(x)(y^2+1)=sqrt(y+1)", "id")) instanceof ProveedorImplicitoPeriodico,
      "caso simétrico en x (transpuesta)");
    assert(crearProveedor(construirObjeto("tan(y)+x=5", "id")) instanceof ProveedorImplicitoSeparable,
      "separable transpuesta sigue por su ruta (Etapa 12)");
    assert(crearProveedor(construirObjeto("tan(x)+y^2=2", "id")) instanceof ProveedorImplicitoSeparable,
      "separable en y sigue igual (Etapa 7)");
    assert(crearProveedor(construirObjeto("x^2+y^2=9", "id")) instanceof ProveedorImplicito,
      "cónica suave sigue por continuación");
  });

  test("expresión SUELTA con y libre → implícita expr=0 (no un falso f(x))", () => {
    // `tan(y)(x²+1)-√(x+1)` sin `=`: antes caía a explícita con y libre → NaN en todo
    // x → plano vacío + falso "Indeterminada". Ahora ≡ tan(y)(x²+1)=√(x+1).
    const obj = construirObjeto("tan(y)(x^2+1)-sqrt(x+1)", "id");
    igual(obj.tipo, "implicita", "clasifica implícita");
    assert(crearProveedor(obj) instanceof ProveedorImplicitoPeriodico, "misma ruta que con =");
    const vp = crearViewport([-7, 7], [-4, 4], 900, 390, 1);
    const g = crearProveedor(obj).geometria(vp, { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada: "final" });
    assert(g.ramas.length > 0, "traza ramas (la curva se dibuja)");
    // Sin y libre, la expresión suelta sigue siendo explícita (regresión).
    igual(construirObjeto("x^2+1", "id").tipo, "explicita", "sin y: explícita como siempre");
    igual(construirObjeto("hypot(x, 2)", "id").tipo, "explicita", "la y de `hypot` NO es variable");
    // El panel la pinta `… = 0`, no `f(x)=…` (miente sobre lo dibujado).
    igual(bloqueALatex(["tan(y)(x^2+1)-sqrt(x+1)"]).endsWith("=0"), true, "panel: expr = 0");
    assert(!bloqueALatex(["tan(y)(x^2+1)-sqrt(x+1)"]).startsWith("f(x)"), "panel: sin prefijo f(x)");
  });

  test(`${SRC}: TODAS las ramas k presentes a cualquier zoom y en ambas pasadas`, () => {
    const prov = crearProveedor(construirObjeto(SRC, "id"));
    for (const s of [4, 40, 320]) {
      const domY: [number, number] = [-s, s];
      const vp = crearViewport([-s * 1.75, s * 1.75], domY, 900, 390, 1);
      for (const pasada of ["final", "interactiva"] as const) {
        const g = prov.geometria(vp, { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada });
        // Cada rama (g≥0) vive en [kπ, kπ+π/2): comprobar que ningún k de la vista falta.
        const ks = new Set<number>();
        for (const r of g.ramas) {
          for (let i = 1; i < r.puntos.length; i += 2) {
            const y = r.puntos[i];
            if (y >= domY[0] && y <= domY[1]) ks.add(Math.floor(y / Math.PI + 1e-9));
          }
        }
        const kMin = Math.ceil(domY[0] / Math.PI), kMax = Math.floor(domY[1] / Math.PI) - 1;
        for (let k = kMin; k <= kMax; k++) {
          assert(ks.has(k), `y±${s} ${pasada}: rama k=${k} presente`);
        }
      }
    }
  });

  test(`${SRC}: residual ~0 (los puntos SÍ están sobre la curva) y sin crosshair (multivaluada)`, () => {
    const campo = F(SRC);
    const prov = crearProveedor(construirObjeto(SRC, "id"));
    const vp = crearViewport([-70, 72], [-38, 38], 900, 390, 1);
    const g = prov.geometria(vp, { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada: "final" });
    let peor = 0, n = 0;
    for (const r of g.ramas) {
      for (let i = 0; i + 1 < r.puntos.length; i += 2) {
        const x = r.puntos[i], y = r.puntos[i + 1];
        if (x < -1 || y < vp.domY[0] || y > vp.domY[1]) continue;
        const v = Math.abs(campo.eval(x, y));
        if (Number.isFinite(v)) { if (v > peor) peor = v; n++; }
      }
    }
    assert(n > 1000, `suficientes puntos (${n})`);
    assert(peor < 1e-6, `residual máx ${peor.toExponential(1)} < 1e-6`);
    // Ramas solapadas en x (multivaluada) → curvaRecorrible=false → sin crosshair/⌖.
    const ctxNulo = null as unknown as CanvasRenderingContext2D;
    const escena = new Escena(construirObjetosEscena(SRC),
      new Overlay(ctxNulo), new RendererCanvas2D(ctxNulo), new Crosshair(ctxNulo));
    escena.actualizar(vp, "final");
    assert(!escena.curvaRecorrible(), "multivaluada → no recorrible");
  });

  test("transpuesta tan(x)(y^2+1)=sqrt(y+1): columnas verticales completas, sin `parametro`", () => {
    const prov = crearProveedor(construirObjeto("tan(x)(y^2+1)=sqrt(y+1)", "id"));
    const domX: [number, number] = [-38, 38];
    const g = prov.geometria(crearViewport(domX, [-20, 20], 900, 390, 1),
      { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada: "final" });
    const ks = new Set<number>();
    for (const r of g.ramas) {
      igual(r.parametro, undefined, "parametro omitido tras el giro");
      for (let i = 0; i < r.puntos.length; i += 2) {
        const x = r.puntos[i];
        if (x >= domX[0] && x <= domX[1]) ks.add(Math.floor(x / Math.PI + 1e-9));
      }
    }
    const kMin = Math.ceil(domX[0] / Math.PI), kMax = Math.floor(domX[1] / Math.PI) - 1;
    for (let k = kMin; k <= kMax; k++) assert(ks.has(k), `columna k=${k} presente`);
  });
});

// ════════════════════════════════════════════════
// Parser: potencia de función vs función compuesta (desambiguación `func^n(x)`).
// `\tan^{2}(x)` = pow(tan(x),2); `\tan(x^2)` = tan(pow(x,2)). NUNCA confundirlos.
// Se verifica SEMÁNTICAMENTE (evaluación numérica), no por el toString (cuyos
// paréntesis del exponente son cosméticos: `^{2}`→`^(2)`, `^2`→`^2`).
describe("Parser: potencia de función func^n(x) → pow(func(x), n)", () => {
  const val = (s: string, x: number) => parse(normalizarEntrada(s)).evaluate({ x });
  const X = 0.5;

  test("`func^n(x)` es POTENCIA de la función: (func(x))^n", () => {
    aprox(val(String.raw`\tan^{2}(x)`, X), Math.tan(X) ** 2, 1e-9, "tan²(x) = (tan x)²");
    aprox(val(String.raw`tan^2(x)`, X), Math.tan(X) ** 2, 1e-9, "sin backslash: idéntico");
    aprox(val(String.raw`\sin^{2}(x)`, X), Math.sin(X) ** 2, 1e-9, "sin²(x)");
    aprox(val(String.raw`\sec^{2}(x)`, X), (1 / Math.cos(X)) ** 2, 1e-9, "sec²(x)");
    aprox(val(String.raw`\log^{2}(x)`, X), Math.log(X) ** 2, 1e-9, "log²(x) = (ln x)²");
    aprox(val(String.raw`\tan^{3}(x)`, X), Math.tan(X) ** 3, 1e-9, "tan³(x)");
  });

  test("`func(x^n)` es función COMPUESTA: func(x^n) — intacto y DISTINTO", () => {
    aprox(val(String.raw`\tan(x^2)`, X), Math.tan(X ** 2), 1e-9, "tan(x²)");
    aprox(val(String.raw`\sin(x^{3})`, X), Math.sin(X ** 3), 1e-9, "sin(x³)");
    aprox(val(String.raw`\sin(x)`, X), Math.sin(X), 1e-9, "sin(x) sin potencia");
    // La distinción es real: los dos patrones dan valores distintos.
    assert(Math.abs(val(String.raw`\tan^{2}(x)`, X) - val(String.raw`\tan(x^2)`, X)) > 0.01,
      "tan²(x) ≠ tan(x²)");
  });

  test("COMBINADO y ANIDADO no se confunden", () => {
    aprox(val(String.raw`\sin^{2}(x^2)`, X), Math.sin(X ** 2) ** 2, 1e-9, "sin²(x²) = (sin(x²))²");
    aprox(val(String.raw`\tan^{2}(\sin(x))`, X), Math.tan(Math.sin(X)) ** 2, 1e-9, "tan²(sin x)");
    aprox(val(String.raw`\sin^{2}(x)+\cos^{2}(x)`, X), 1, 1e-9, "sin²+cos² = 1 (pitágoras)");
  });

  test("no confunde la inversa ^{-1} ni el `tan` dentro de `atan`", () => {
    aprox(val(String.raw`\tan^{-1}(x)`, X), Math.atan(X), 1e-9, "^{-1} = arctan, no potencia −1");
    // `a\tan^{2}(x)` = a·tan²(x): el `\` deja claro que es `tan`, NO parte de `atan`.
    const norm = normalizarEntrada(String.raw`a\tan^{2}(x)`);
    assert(norm.includes("(tan(x))") && !norm.includes("atan"), "a·tan²(x): tan, no atan");
  });
});

// ════════════════════════════════════════════════
// Paramétricas `(X, Y)`: NO son explícitas. Regresión: el host tomaba la tupla como
// f(x) (`exprExplicita`) y `compilarFuncion` lanzaba, abortando el render del plano.
// El gate se apoya en `construirObjeto(...).tipo`; se protege esa clasificación + que
// la geometría de esas curvas sí se produce.
describe("Paramétricas (X,Y): clasificación y geometría (regresión render)", () => {
  const VP = crearViewport([-3, 3], [-3, 3], 400, 400, 1);
  for (const src of ["(sin(2t), sin(3t))", "(t*cos(t), t*sin(t))"]) {
    test(`${src} → parametrica con geometría`, () => {
      const obj = construirObjeto(src, "id");
      igual(obj.tipo, "parametrica", "clasificada como paramétrica (no explícita)");
      // compilarFuncion(tupla, 'x') LANZA: el gate de exprExplicita debe excluirla.
      let compila = true;
      try { compilarFuncion(normalizarEntrada(src), "x"); } catch { compila = false; }
      assert(!compila, "la tupla NO compila como f(x) (por eso hay que excluirla del ⓘ)");
      const g = crearProveedor(obj).geometria(VP, TOL_FINAL);
      assert(g.ramas.length >= 1 && g.ramas[0].puntos.length > 100, "traza geometría (no plano vacío)");
    });
  }

  // Componentes por SEPARADO (`x(t)=…` / `y(t)=…`, como se escriben en un libro o en Desmos).
  // Antes: `x(t)` normalizaba al producto `x*t` → implícita basura con una `t` fantasma (plano
  // vacío, sin explicación). Ahora dividirEcuaciones las FUSIONA en la tupla canónica.
  test("componentes x(t)/y(t) en dos líneas → UNA paramétrica (epitrocoide)", () => {
    const src = String.raw`x(t)=5\cos t-\cos(5t)` + "\n" + String.raw`y(t)=5\sin t-\sin(5t)`;
    const eqs = dividirEcuaciones(src);
    igual(eqs.length, 1, "las dos componentes son UNA ecuación (tupla)");
    const obj = construirObjeto(eqs[0], "id");
    igual(obj.tipo, "parametrica", "clasificada como paramétrica");
    const g = crearProveedor(obj).geometria(crearViewport([-8, 8], [-8, 8], 400, 400, 1), TOL_FINAL);
    assert(g.ramas.length >= 1 && g.ramas[0].puntos.length > 100, "traza la curva (no plano vacío)");
    // Orden libre: primero y(t). La tupla siempre sale (X, Y).
    const alReves = dividirEcuaciones(String.raw`y(t)=\sin t` + "\n" + String.raw`x(t)=\cos t`);
    igual(alReves.length, 1, "orden invertido → sigue siendo una tupla");
    igual(construirObjeto(alReves[0], "id").tipo, "parametrica", "y sigue siendo paramétrica");
    // Sin secuestrar los sistemas: dos ecuaciones normales siguen siendo dos.
    igual(dividirEcuaciones("y=x\ny=-x").length, 2, "un sistema de verdad NO se fusiona");
  });

  // UNA sola componente (o una expresión suelta en `t`) SÍ es graficable: es la función
  // t ↦ expr, o sea la explícita de siempre con la abscisa llamada `t` (se renombra t→x y la
  // traza el ProveedorExplicito). Antes: `x(t)` = producto `x·t` → implícita basura, plano vacío.
  test("una sola componente x(t)=… (o una expresión en t) se grafica como explícita en t", () => {
    const VP1 = crearViewport([-6, 6], [-6, 6], 400, 400, 1);
    for (const src of [
      String.raw`x(t)=5\cos t-\cos(5t)`,
      String.raw`y(t)=5\sin t-\sin(5t)`,
      String.raw`5\cos t-\cos(5t)`, // expresión SUELTA en t: la variable independiente es t
    ]) {
      const obj = construirObjeto(dividirEcuaciones(src)[0], "id");
      igual(obj.tipo, "explicita", `${src}: explícita (variable independiente renombrada t→x)`);
      const g = crearProveedor(obj).geometria(VP1, TOL_FINAL);
      assert(g.ramas.length >= 1 && g.ramas[0].puntos.length > 50, `${src}: traza (no plano vacío)`);
    }
    // El NOMBRE dice en qué eje cae el VALOR: `x(t)` afirma que el punto de parámetro t tiene ESA
    // abscisa → la curva sale TUMBADA (parámetro en el eje vertical); `y(t)`, de pie.
    const tumbada = construirObjeto(String.raw`x(t)=5\cos t-\cos(5t)`, "id");
    igual(tumbada.tipo === "explicita" ? tumbada.salida : null, "x", "x(t): el valor va al eje x");
    const dePie = construirObjeto(String.raw`y(t)=5\sin t-\sin(5t)`, "id");
    igual(dePie.tipo === "explicita" ? dePie.salida ?? "y" : null, "y", "y(t): el valor va al eje y");
    // La geometría tumbada es la de pie con las coordenadas intercambiadas: su recorrido en X
    // llega al rango de la función (±6), no al del parámetro.
    const gT = crearProveedor(tumbada).geometria(VP1, TOL_FINAL);
    let maxX = 0;
    for (const r of gT.ramas) for (let i = 0; i < r.puntos.length; i += 2) maxX = Math.max(maxX, Math.abs(r.puntos[i]));
    assert(maxX > 5, "x(t) tumbada: la abscisa alcanza los valores de la función (|x|>5)");
    // El renombrado es sobre el ÁRBOL: `\cot t` (una función con `t` en el NOMBRE) no se rompe
    // (un reemplazo textual la habría dejado en `cox`/`co x` → nada que graficar).
    const cot = construirObjeto(String.raw`\cot t`, "id");
    igual(cot.tipo, "explicita", "cot t: explícita en t");
    const gcot = crearProveedor(cot).geometria(VP1, TOL_FINAL);
    assert(gcot.ramas.length >= 1, "cot t se traza (el nombre de la función sobrevive al renombrado)");
    // Una f(x) de toda la vida NO se ve afectada (ni una ecuación en t, que no es una f(t)).
    igual(construirObjeto("x^2", "id").tipo, "explicita", "x² sigue siendo explícita en x");
  });

  test("panel de una componente sola: x(t)=… (Simplificar la respeta; no hay y que despejar)", () => {
    igual(bloqueALatex(simplificarEcuaciones([String.raw`x(t)=5\cos t-\cos(5t)`])),
      "x\\left(t\\right)=5\\cos t-\\cos\\left(5t\\right)",
      "Simplificar conserva la declaración (no la lee como el producto t·x)");
    // `y(t)=…`: su `y` es el NOMBRE de la componente, no la incógnita → Despejar no aplica.
    igual(despejarEcuaciones([String.raw`y(t)=\sin t`])[0], String.raw`y(t)=\sin t`,
      "Despejar deja intacta la componente y(t) (no inventa y = sin(t)/t)");
    // Expresión suelta: nada dice que su valor sea la abscisa → gráfica clásica (valor en la
    // ordenada), y el panel la declara y(t)=…, no f(x)=… (no hay ninguna x en la fórmula).
    igual(bloqueALatex([String.raw`5\cos t-\cos(5t)`]),
      "y\\left(t\\right)=5\\cos t-\\cos\\left(5t\\right)",
      "expresión suelta en t → se declara y(t)=…, no f(x)=…");
  });

  test("panel: el par ordenado DECLARA (x(t), y(t)); la componente suelta se pinta x(t)=…", () => {
    const par = bloqueALatex([String.raw`(\cos t, \sin t)`]);
    igual(par, "\\left(x\\left(t\\right),\\ y\\left(t\\right)\\right)=\\left(\\cos t,\\ \\sin t\\right)",
      "tupla → par ordenado declarado (no una tupla desnuda)");
    // La `t` es una VARIABLE: cursiva. mathjs la pinta `\mathrm{t}` (la confunde con la unidad
    // tonelada), lo que la dejaba recta —la única letra recta de la fórmula—.
    assert(!par.includes("\\mathrm"), "la t va en cursiva, no en \\mathrm (fuente de unidad)");
    igual(bloqueALatex([String.raw`x(t)=5\cos t-\cos(5t)`]),
      "x\\left(t\\right)=5\\cos t-\\cos\\left(5t\\right)",
      "componente suelta: x(t)=…, no el producto x·t");
  });

  test("LaTeX del panel: la potencia va SOBRE la función (desambigua de tan(x²))", () => {
    // Bug reportado: `pow(tan(x),2)` se pintaba `{\tan x}^{2}` (visualmente `\tan x^2`,
    // leído como tan(x²)). Debe ir `\tan^{2} x` (exponente sobre la función).
    igual(bloqueALatex([String.raw`tan^2(x)`]), "f(x)=\\tan^{2} x", "tan²(x) → \\tan^{2} x");
    // Argumento agrupado con LLAVES (lo que emite el editor de fórmulas de Obsidian/MathLive):
    // `\sin^{2}{\left(3\theta\right)}`. Sin la rama de llaves en `casarPotenciaFuncion`, el `{`
    // frenaba el casado y la expresión salía cruda (`sin^(2){(3*theta)}`): ni graficaba ni pintaba.
    igual(normalizarEntrada(String.raw`\sin^{2}{\left(3\theta\right)}`), "(sin((3theta)))^(2)",
      "potencia de función con argumento entre llaves → (sin(3θ))² (el `*` lo pone el producto implícito)");
    igual(bloqueALatex([String.raw`\sin^{2}{x}`]), "f(x)=\\sin^{2} x", "llaves: misma tipografía");
    igual(bloqueALatex([String.raw`\tan^{2}(x)`]), "f(x)=\\tan^{2} x", "misma entrada LaTeX");
    igual(bloqueALatex([String.raw`\tan(x^2)`]), "f(x)=\\tan\\left(x^{2}\\right)",
      "tan(x²) DISTINTO: exponente DENTRO del paréntesis");
    igual(bloqueALatex([String.raw`\sin^{2}(x)+\cos^{2}(x)`]), "f(x)=\\sin^{2} x+\\cos^{2} x",
      "identidad pitagórica clara");
    // Mismo render en Original, Simplificar y Despejar (todos pasan por bloqueALatex/toTex).
    igual(bloqueALatex(simplificarEcuaciones([String.raw`tan^2(x)`])), "f(x)=\\tan^{2} x",
      "Simplificar mantiene la notación clara");
    igual(bloqueALatex(despejarEcuaciones([String.raw`\tan^{2}(x)=y`])), "y=\\tan^{2} x",
      "Despejar mantiene la notación clara");
  });
});

// ════════════════════════════════════════════════
// Funciones escalón floor/ceil (piso ⌊⌋ y techo ⌈⌉): soporte transversal.
// Parser (\lfloor…\rfloor, \lceil…\rceil, Unicode), evaluación (nativas de mathjs),
// LaTeX del panel (\left\lfloor…\right\rfloor), simplificación (solo el argumento),
// trazado (saltos CORTADOS: escalones planos, sin "peldaños" verticales ni falsas
// asíntotas), derivada (0 donde existe, conservando el dominio del argumento) y
// sistemas (válidas en cualquier ecuación).
describe("Funciones escalón: floor y ceil (piso ⌊⌋ y techo ⌈⌉)", () => {
  const val = (s: string, x: number) =>
    parse(insertarProductoImplicito(normalizarEntrada(s))).evaluate({ x });

  test("parser: \\lfloor…\\rfloor / \\lceil…\\rceil → floor/ceil (con \\left, anidados, Unicode)", () => {
    igual(val(String.raw`\lfloor x \rfloor`, 2.7), 2, "⌊2.7⌋");
    igual(val(String.raw`\left\lfloor \frac{x}{2} \right\rfloor`, 5), 2, "\\left + \\frac: ⌊5/2⌋");
    igual(val(String.raw`\lceil x \rceil`, 2.1), 3, "⌈2.1⌉");
    igual(val(String.raw`\lceil x^{2} \rceil`, 1.5), 3, "⌈x²⌉ = ⌈2.25⌉");
    igual(val(String.raw`\lfloor x + \lceil x \rceil \rfloor`, 1.2), 3, "techo anidado en piso");
    igual(val(String.raw`\lfloor \lfloor x \rfloor / 2 \rfloor`, 5.9), 2, "piso anidado en piso");
    igual(val("⌊x⌋ + ⌈x⌉", 2.5), 5, "Unicode ⌊⌋ ⌈⌉");
    igual(val("floor(x) + ceil(x)", 2.5), 5, "forma interna directa (mathjs)");
    igual(val("2floor(x)", 2.5), 4, "producto implícito: no parte `floor` en letras");
  });

  test("evaluador: valores en negativos y enteros exactos", () => {
    const f = compilarFuncion(normalizarEntrada(String.raw`\lfloor x \rfloor`), "x");
    igual(f(-1.5), -2, "⌊−1.5⌋ = −2");
    igual(f(3), 3, "⌊3⌋ = 3");
    const g = compilarFuncion(normalizarEntrada(String.raw`\lceil x \rceil`), "x");
    igual(g(-1.5), -1, "⌈−1.5⌉ = −1");
    igual(g(3), 3, "⌈3⌉ = 3");
  });

  test("LaTeX del panel: \\left\\lfloor…\\right\\rfloor (round-trip con la entrada LaTeX)", () => {
    igual(bloqueALatex(["floor(x)"]), "f(x)=\\left\\lfloor x\\right\\rfloor", "interna → piso");
    igual(bloqueALatex([String.raw`\lfloor x \rfloor`]), "f(x)=\\left\\lfloor x\\right\\rfloor",
      "la entrada LaTeX produce el MISMO render (round-trip)");
    igual(bloqueALatex([String.raw`y=\lceil x \rceil`]), "y=\\left\\lceil x\\right\\rceil",
      "techo dentro de una ecuación");
  });

  test("simplificar: preserva el escalón y reduce SOLO su argumento", () => {
    const [s] = simplificarEcuaciones(["floor(x+x) + floor(x) + floor(x)"]);
    assert(s.includes("floor("), `conserva floor: ${s}`);
    // Equivalencia semántica (sin fijar el formato exacto): ⌊2x⌋ + 2⌊x⌋.
    const f = compilarFuncion(s, "x");
    const ref = (x: number) => Math.floor(2 * x) + 2 * Math.floor(x);
    for (const x of [-2.7, -0.3, 0.4, 1.5, 3.9]) igual(f(x), ref(x), `equivale en x=${x}`);
  });

  test("trazado: escalones PLANOS separados; el salto NO es asíntota", () => {
    const vp = crearViewport([-4, 4], [-3, 3], 768, 261, 1);
    for (const pasada of ["final", "interactiva"] as const) {
      const tol: Tolerancia = { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada };
      for (const [nombre, f] of [["floor", Math.floor], ["ceil", Math.ceil]] as const) {
        const res = new TrazadorExplicitoAdaptativo().trazar(fr(f), "id", vp, tol);
        igual(res.ramas.length, 8, `${nombre} [${pasada}]: una rama por peldaño`);
        for (const r of res.ramas) {
          let ymin = Infinity, ymax = -Infinity;
          for (let k = 1; k < r.puntos.length; k += 2) {
            ymin = Math.min(ymin, r.puntos[k]);
            ymax = Math.max(ymax, r.puntos[k]);
          }
          aprox(ymax - ymin, 0, 1e-9, `${nombre} [${pasada}]: cada peldaño es plano`);
        }
        igual(res.asintotas.length, 0, `${nombre} [${pasada}]: un salto finito no es asíntota`);
      }
    }
  });

  test("trazado: el salto también se corta montado sobre una pendiente (x+⌊x⌋)", () => {
    const vp = crearViewport([-1.5, 1.5], [-4, 4], 768, 261, 1);
    const res = new TrazadorExplicitoAdaptativo()
      .trazar(fr((x) => x + Math.floor(x)), "id", vp, TOL_FINAL);
    // Saltos visibles en x=−1, 0 y 1 → cuatro tramos inclinados separados.
    igual(res.ramas.length, 4, "cuatro tramos entre los tres saltos de la vista");
    for (const r of res.ramas) {
      let maxSalto = 0;
      for (let k = 3; k < r.puntos.length; k += 2)
        maxSalto = Math.max(maxSalto, Math.abs(r.puntos[k] - r.puntos[k - 2]));
      assert(maxSalto < 0.5, `sin peldaño interno (maxSalto=${maxSalto.toFixed(3)})`);
    }
  });

  test("guardia del corte: una pendiente continua EXTREMA no se parte como salto", () => {
    // Sigmoide casi vertical pero CONTINUA: el sondeo de mesetas (esSaltoFinito) ve
    // valores intermedios y conecta. Protege contra sobre-cortar verticales reales
    // (p. ej. la ∛ que comprime un polo de tan, test de la Etapa 7).
    const res = new TrazadorExplicitoAdaptativo()
      .trazar(fr((x) => 5 * Math.tanh(1e7 * x)), "id", VP, TOL_FINAL);
    igual(res.ramas.length, 1, "continua → una sola rama (sin corte espurio)");
  });

  test("obs-derivate: derivada de escalones (0 donde existe; conserva el dominio del argumento)", () => {
    igual(derivarExpr("floor(x)"), "0", "⌊x⌋′ = 0 (fuera de los enteros)");
    igual(derivarExpr("ceil(x)"), "0", "⌈x⌉′ = 0");
    igual(derivarExpr(String.raw`\lfloor 2x+1 \rfloor`), "0", "argumento afín: 0 igual");
    igual(derivarExpr("x*floor(x)"), "floor(x)", "regla del producto conserva el escalón");
    igual(derivarExpr("sin(x) + ceil(x^2)"), "cos(x)", "término escalón: aporte 0");
    // El dominio del ARGUMENTO no se pierde: d/dx ⌊√x⌋ existe solo donde √x existe.
    const d = derivarExpr("floor(sqrt(x))")!;
    const f = compilarFuncion(d, "x");
    igual(f(2.3), 0, "vale 0 donde √x es derivable");
    const enNegativo = f(-4);
    assert(!(typeof enNegativo === "number" && Number.isFinite(enNegativo)),
      "en x<0 NO es un real finito (el motor lo trata como hueco)");
    igual(derivadaLatex(["floor(x)"]), "f'\\left(x\\right) = 0", "panel de la derivada evaluada");
  });

  test("rendimiento: las mesetas NO disparan la búsqueda de asíntotas (presupuesto de evals)", () => {
    // Regresión del lag: con maxLocal admitiendo EMPATES (`<=`/`>=`), cada terna de
    // una meseta con |y|>1.5 lanzaba la búsqueda ternaria (60 iteraciones): 82 406
    // evaluaciones por frame frente a ~3 200 de sin(x) → ~1 s/frame con mathjs.
    // Con el máximo estricto, floor debe costar como cualquier función.
    const vp = crearViewport([-30, 30], [-15.6, 15.6], 600, 370, 1);
    const contar = (fn: (x: number) => number): number => {
      let n = 0;
      new TrazadorExplicitoAdaptativo().trazar(fr((x) => { n++; return fn(x); }), "id", vp,
        { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada: "interactiva" });
      return n;
    };
    const evalsFloor = contar(Math.floor), evalsSin = contar(Math.sin);
    assert(evalsFloor < evalsSin * 2.5,
      `floor dentro de presupuesto: ${evalsFloor} evals (sin(x): ${evalsSin})`);
  });

  test("rendimiento: el scope evalúa floor/ceil rápidas SIN perder la corrección epsilon", () => {
    // mathjs floor/ceil pasan por typed-function (~18 µs/eval vs 1.5 µs de sin);
    // FUNCIONES_ESCALON_RAPIDAS las sombrea en el scope. La corrección epsilon se
    // conserva: 0.1·30 = 2.9999999999999996 debe dar piso 3 (como mathjs), no 2.
    const f = compilarFuncion("floor(x)", "x");
    igual(f(2.9999999999999996), 3, "epsilon: casi-entero redondea al entero");
    igual(f(2.7), 2, "no-entero normal");
    igual(f(-1.5), -2, "negativo");
    const g = compilarFuncion("ceil(x)", "x");
    igual(g(2.0000000000000004), 2, "epsilon simétrico en ceil");
    igual(g(2.3), 3, "ceil normal");
  });

  test("ⓘ: las raíces por TRAMOS se detectan como intervalos con apertura/cierre", () => {
    // ⌊x⌋ vale 0 en [0,1): el análisis debe dar UN intervalo cerrado-abierto (no
    // "demasiadas para mostrar" por los 50 puntos muestreados sobre la meseta).
    const a = analizarFuncion(Math.floor);
    igual(a.intervalosRaiz.length, 1, "un tramo de raíces");
    aprox(a.intervalosRaiz[0].a, 0, 1e-6, "empieza en 0");
    aprox(a.intervalosRaiz[0].b, 1, 1e-6, "termina en 1");
    igual(a.intervalosRaiz[0].cerradoA, true, "0 incluido (⌊0⌋=0)");
    igual(a.intervalosRaiz[0].cerradoB, false, "1 excluido (⌊1⌋=1)");
    igual(a.raices.length, 0, "sin raíces puntuales (la meseta no es una lista de puntos)");
    igual(estadoGrupo(a.raices.length + a.intervalosRaiz.length, false), "normal",
      "el tramo cuenta como UN elemento: ya no cae en 'demasiadas'");

    // ⌈x⌉: simétrico, (−1, 0] — abierto a la izquierda, cerrado a la derecha.
    const c = analizarFuncion(Math.ceil);
    igual(c.intervalosRaiz.length, 1, "ceil: un tramo");
    aprox(c.intervalosRaiz[0].a, -1, 1e-6, "ceil: desde −1");
    aprox(c.intervalosRaiz[0].b, 0, 1e-6, "ceil: hasta 0");
    igual(c.intervalosRaiz[0].cerradoA, false, "−1 excluido (⌈−1⌉=−1)");
    igual(c.intervalosRaiz[0].cerradoB, true, "0 incluido (⌈0⌉=0)");

    // Mixto: tramo [0,1) + raíz PUNTUAL en −3 (cruce transversal normal).
    const m = analizarFuncion((x) => Math.floor(x) * (x + 3));
    igual(m.intervalosRaiz.length, 1, "mixto: el tramo se conserva");
    igual(m.raices.length, 1, "mixto: y la raíz puntual también");
    aprox(m.raices[0], -3, 1e-4, "raíz puntual en −3");

    // Sin escalones NADA cambia: puntuales como siempre, cero intervalos.
    const p = analizarFuncion((x) => x * x - 4);
    igual(p.intervalosRaiz.length, 0, "x²−4: sin tramos");
    igual(p.raices.length, 2, "x²−4: dos raíces puntuales");

    // ⌊1/x⌋ vale 0 para todo x>1: el tramo toca el borde del rango (x=10) y sigue en
    // 0 al sondear más lejos → se extiende a +∞ (no se recorta a (1,10]).
    const inf = analizarFuncion((x) => Math.floor(1 / x));
    igual(inf.intervalosRaiz.length, 1, "⌊1/x⌋: un tramo");
    aprox(inf.intervalosRaiz[0].a, 1, 1e-6, "empieza en 1");
    igual(inf.intervalosRaiz[0].b, Infinity, "no termina: se extiende a +∞");
    igual(inf.intervalosRaiz[0].cerradoA, false, "1 excluido (⌊1⌋=1)");
    igual(inf.intervalosRaiz[0].cerradoB, false, "∞ siempre abierto");
  });

  test("ⓘ: LaTeX del conjunto de raíces (solo la parte matemática)", () => {
    igual(raicesALatex([{ a: 0, b: 1, cerradoA: true, cerradoB: false }], []),
      "x\\in [0,1)", "⌊x⌋ → x∈[0,1)");
    igual(raicesALatex([{ a: -1, b: 0, cerradoA: false, cerradoB: true }], []),
      "x\\in (-1,0]", "⌈x⌉ → x∈(−1,0]");
    igual(raicesALatex([{ a: 0, b: 1, cerradoA: true, cerradoB: false }], [-3]),
      "x\\in [0,1)\\cup \\{-3\\}", "tramo ∪ raíces sueltas");
    igual(raicesALatex(
      [{ a: 0, b: 1, cerradoA: true, cerradoB: false }, { a: 2, b: 3, cerradoA: true, cerradoB: false }], []),
      "x\\in [0,1)\\cup [2,3)", "varios tramos unidos con ∪");
    igual(raicesALatex([{ a: -0.00000001, b: 0.5, cerradoA: true, cerradoB: false }], []),
      "x\\in [0,0.5)", "números compactos (−0 → 0, sin ceros de relleno)");
    igual(raicesALatex([{ a: 1, b: Infinity, cerradoA: false, cerradoB: false }], []),
      "x\\in (1,\\infty)", "⌊1/x⌋ → x∈(1,∞) (extremo no acotado)");
    igual(raicesALatex([{ a: -Infinity, b: Infinity, cerradoA: false, cerradoB: false }], []),
      "x\\in (-\\infty,\\infty)", "no acotado por ambos lados");
  });

  test("marcadores del plano: la meseta NO siembra puntos; queda SOLO la intersección Y", () => {
    // Regresión: cada muestra de la meseta [0,1) con y===0 se marcaba como raíz →
    // fila de ~8 puntos naranjas sobre el eje. Ahora la meseta se describe como
    // intervalo en el ⓘ y el plano solo marca la intersección Y (0,0) — que además
    // se PERDÍA (el corte del salto parte las ramas justo en x=0 y ninguna "cruzaba").
    const vp = crearViewport([-12.5, 12.5], [-7, 7], 614, 261, 2);
    for (const [nombre, src] of [["floor", String.raw`\lfloor x \rfloor`], ["ceil", String.raw`\lceil x \rceil`]] as const) {
      const g = crearProveedor(construirObjeto(src, "id")).geometria(vp, TOL_FINAL);
      igual(g.puntosNotables.length, 1, `${nombre}: un único punto notable`);
      igual(g.puntosNotables[0].tipo, "interseccion-y", `${nombre}: es la intersección Y`);
      aprox(g.puntosNotables[0].punto.x, 0, 1e-9, `${nombre}: en x=0`);
      aprox(g.puntosNotables[0].punto.y, 0, 1e-9, `${nombre}: en y=0`);
    }
    // El cero AISLADO (toque tangente) se conserva: x² sigue marcando su raíz en 0.
    const gx2 = crearProveedor(construirObjeto("y=x^2", "id")).geometria(vp, TOL_FINAL);
    assert(gx2.puntosNotables.some((p) => p.tipo === "raiz"), "x²: raíz tangente intacta");
    // Y el extremo de dominio duplicado (…(3,0)(3,0) de √) no pasa por falsa meseta:
    // el círculo conserva SUS DOS raíces (lo canda también el test de INVARIANZA).
    const gc = crearProveedor(construirObjeto("x^2+y^2=9", "id")).geometria(vp, TOL_FINAL);
    igual(gc.puntosNotables.filter((p) => p.tipo === "raiz").length, 2, "círculo: raíces ±3");
  });

  test("obs-system: floor/ceil válidas en ecuaciones del sistema (con soluciones)", () => {
    const objs = construirObjetosEscena("y = floor(x)\ny = x - 0.5");
    igual(objs.length, 2, "dos ecuaciones");
    igual(construirObjeto("y = floor(x)", "id").tipo, "explicita", "y=⌊x⌋ es explícita");
    const EPS_M = ((VP.domX[1] - VP.domX[0]) / VP.anchoPx) * 3;
    const geoms = objs.map((o) => o.proveedor.geometria(VP, TOL_FINAL));
    const pts = interseccionesDeGeometrias(geoms, EPS_M).filter((p) =>
      p.x >= VP.domX[0] && p.x <= VP.domX[1] && p.y >= VP.domY[0] && p.y <= VP.domY[1]);
    // ⌊x⌋ = x−0.5 en cada semientero x=k+0.5 de la vista; y∈[−7,7] acota a ~14–15.
    assert(pts.length >= 10, `soluciones en los semienteros (${pts.length})`);
    for (const p of pts) aprox(p.x - Math.floor(p.x), 0.5, 0.05, "cruce en un semientero");
    // Y en una IMPLÍCITA: ⌊x⌋ − y = 0 también traza (misma curva por otra vía).
    const gImp = crearProveedor(construirObjeto("floor(x) - y = 0", "id")).geometria(VP, TOL_FINAL);
    assert(gImp.ramas.length >= 2, "la forma implícita también produce escalones");
  });
});

// ════════════════════════════════════════════════
// Carril sobre una derivada EXPLOSIVA (obs-derivate e^{x²+1} → 2x·e^{x²+1}): al
// seguir el punto, la vista se centra en valores enormes (~1e16+). Dos defensas
// contra el CONGELAMIENTO del hilo principal que eso provocaba:
//   • generarTicks NO puede entrar en bucle infinito (paso < ULP del centro).
//   • enfocarCarril ACOTA el centro para no degenerar el encuadre en flotante.
describe("Carril: derivada explosiva sin congelar (generarTicks + centro acotado)", () => {
  test("generarTicks: bucle por índice, imposible de colgar en la zona letal", () => {
    // Centros donde el paso (~2) cae bajo el ULP del centro: el bucle viejo
    // `t += paso` no avanzaba → cuelgue. Aquí termina siempre y NO lanza.
    for (const c of [3.16e16, 5e16, 1e16, 1e17, 1e300]) {
      const t0 = Date.now();
      const ticks = generarTicks(c - 7, c + 7);
      assert(Date.now() - t0 < 500, `c=${c}: termina rápido (no cuelga)`);
      assert(ticks.length <= 40, `c=${c}: nº de ticks acotado (${ticks.length})`);
      for (const t of ticks) assert(Number.isFinite(t), `c=${c}: ticks finitos`);
    }
    // Casos degenerados: rango nulo/negativo → sin ticks (sin lanzar).
    igual(generarTicks(1e17, 1e17).length, 0, "rango 0 → sin ticks");
    igual(generarTicks(5, 3).length, 0, "rango negativo → sin ticks");
    // Caso sano intacto: [-8,8] da los ticks pares de siempre.
    const sanos = generarTicks(-8, 8);
    assert(sanos.includes(0) && sanos.includes(-8) && sanos.includes(8), "vista normal intacta");
  });

  test("centroCarrilAcotado: recorta el centro para que el encuadre no degenere", () => {
    // Centro sano (pequeño frente al semirrango·2⁴⁶): pasa intacto.
    igual(centroCarrilAcotado(0, 8), 0, "centro 0 intacto");
    igual(centroCarrilAcotado(1e6, 8), 1e6, "centro moderado intacto");
    // Centro enorme con semirrango pequeño: se recorta al borde numéricamente sano,
    // donde los bordes del encuadre siguen siendo representables DISTINTOS.
    for (const [c, semi] of [[1e17, 8], [1e300, 7], [-1e17, 8]] as const) {
      const cc = centroCarrilAcotado(c, semi);
      assert(Number.isFinite(cc), `acotado finito (c=${c})`);
      assert((cc + semi) > (cc - semi), `bordes distintos tras acotar (c=${c})`);
      assert(Math.abs(cc) <= Math.abs(c), `acotado no crece más que el centro (c=${c})`);
    }
    // Un semirrango grande admite centros grandes sin recortar (span 1e9 en 1e17 va bien).
    igual(centroCarrilAcotado(1e17, 1e9), 1e17, "semirrango grande: centro grande sano");
  });
});

describe("Integral definida: parser de la notación LaTeX (obs-integral)", () => {
  test("forma canónica \\int_{a}^{b} f\\,dx: integrando, límites y variable", () => {
    const it = extraerIntegral("\\int_{0}^{2}x^{2}\\,dx");
    assert(it !== null, "reconocida");
    igual(it!.integrando, "x^{2}", "integrando crudo");
    igual(it!.a, "0", "límite inferior");
    igual(it!.b, "2", "límite superior");
    igual(it!.variable, "x", "variable del diferencial");
  });

  test("límites simbólicos (a, b) y variable literal", () => {
    const it = extraerIntegral("\\int_{a}^{b}x^{2}\\,dx");
    igual(it!.a, "a", "a simbólico");
    igual(it!.b, "b", "b simbólico");
    // Un límite simbólico no evalúa a número (no hay área concreta).
    igual(evaluarLimite(it!.a), null, "a no numérico");
  });

  test("desliz \\in por \\int cuando va seguido de límite", () => {
    const it = extraerIntegral("\\in_{a}^{b}x^{2}\\,dx");
    assert(it !== null, "el ∈ con límites se lee como integral");
    igual(it!.integrando, "x^{2}", "integrando");
  });

  test("límites en orden inverso ^b _a", () => {
    const it = extraerIntegral("\\int^{2}_{0} x^2 \\, dx");
    igual(it!.a, "0", "inferior por _");
    igual(it!.b, "2", "superior por ^");
  });

  test("límites de un solo token sin llaves y diferencial pegado", () => {
    const it = extraerIntegral("\\int_0^1 e^{x}dx");
    igual(it!.a, "0", "a sin llaves");
    igual(it!.b, "1", "b sin llaves");
    igual(it!.integrando, "e^{x}", "diferencial pegado recortado");
  });

  test("número de varias cifras sin llaves se toma entero (indulgente)", () => {
    const it = extraerIntegral("\\int_0^{10} x dx");
    igual(it!.b, "10", "10 completo, no solo el 1");
  });

  test("diferencial ausente → variable por defecto x", () => {
    const it = extraerIntegral("\\int_{-1}^{1} x^2");
    igual(it!.integrando, "x^2", "sin dx, integrando íntegro");
    igual(it!.variable, "x", "variable por defecto");
    igual(it!.a, "-1", "límite negativo con llaves");
  });

  test("variable distinta de x en el diferencial", () => {
    const it = extraerIntegral("\\int_{0}^{1} t^2 \\, dt");
    igual(it!.variable, "t", "dt");
    igual(it!.integrando, "t^2", "integrando en t");
  });

  test("\\displaystyle y \\limits decorativos se toleran", () => {
    const it = extraerIntegral("\\displaystyle\\int\\limits_{0}^{2} x^2 \\, dx");
    igual(it!.a, "0", "límite tras \\limits");
    igual(it!.integrando, "x^2", "integrando limpio");
  });

  test("integral indefinida (sin límites) → null", () => {
    igual(extraerIntegral("\\int x^2 \\, dx"), null, "sin límites no es definida");
  });

  test("límites evaluables a número (incluye \\pi)", () => {
    const it = extraerIntegral("\\int_{0}^{\\pi} \\sin(x) \\, dx");
    igual(evaluarLimite(it!.a), 0, "a = 0");
    aprox(evaluarLimite(it!.b)!, Math.PI, 1e-12, "b = π");
  });

  test("forma por líneas (comodidad secundaria)", () => {
    const it = extraerIntegral("f(x) = x^2\na = 0\nb = 2");
    igual(it!.integrando, "x^2", "integrando de f(x)=…");
    igual(it!.a, "0", "a por línea");
    igual(it!.b, "2", "b por línea");
  });

  test("forma por líneas con y=expr y expresión suelta", () => {
    igual(extraerIntegral("y = 3x\na=0\nb=1")!.integrando, "3x", "lado no-y de y=expr");
    igual(extraerIntegral("2x+1\na=0\nb=1")!.integrando, "2x+1", "expresión suelta");
  });

  test("regresión: los strings exactos del usuario (con y sin espacios/\\,dx)", () => {
    igual(extraerIntegral("\\int_0^2 x^2")!.integrando, "x^2", "a mano, sin dx");
    const conDx = extraerIntegral("\\int_{0}^{2} x^2 \\, dx");
    igual(conDx!.integrando, "x^2", "con espacios y \\, dx");
    igual(conDx!.a, "0", "límite a");
    igual(conDx!.b, "2", "límite b");
  });

  test("robustez: caracteres invisibles (NBSP, espacio de ancho cero) no rompen el parseo", () => {
    //   = espacio no-rompible; ​ = espacio de ancho cero (típicos del copiar-pegar).
    const nbsp = "\\int_{0}^{2} x^2 \\, dx";
    const zwsp = "\\int_{0}^{2} x^2 \\,​ dx";
    igual(extraerIntegral(nbsp)!.integrando, "x^2", "con NBSP");
    igual(extraerIntegral(zwsp)!.integrando, "x^2", "con ancho cero");
  });

  test("bloque vacío o sin datos → null", () => {
    igual(extraerIntegral(""), null, "vacío");
    igual(extraerIntegral("a=0\nb=1"), null, "sin integrando");
    igual(extraerIntegral("f(x)=x^2\na=0"), null, "falta límite b");
  });

  test("operador LaTeX: round-trip tipográfico con \\int y el diferencial", () => {
    const tex = integralOperadorLatex("\\int_{0}^{2}x^{2}\\,dx");
    assert(tex.startsWith("\\int_{0}^{2}"), `límites en el operador: ${tex}`);
    assert(tex.includes("x^{2}"), `integrando renderizado: ${tex}`);
    assert(tex.endsWith("\\,dx"), `diferencial: ${tex}`);
  });

  test("operador de un bloque no reconocido: marcadores, no texto suelto", () => {
    const tex = integralOperadorLatex("");
    assert(tex.includes("\\int") && tex.includes("\\text{[...]}"), `marcador de integral: ${tex}`);
  });

  test("valor LaTeX ensambla el operador con = <valor>", () => {
    const tex = integralValorLatex("\\int_{0}^{2}x^{2}\\,dx", "\\frac{8}{3}");
    assert(tex.includes("=") && tex.trim().endsWith("\\frac{8}{3}"), `= valor: ${tex}`);
  });
});

describe("Integral definida: área con signo y clasificación (areaBajoRama)", () => {
  // Construye la FuncionReal por la MISMA ruta que grafica el motor.
  const fr = (expr: string) => crearFuncionReal(insertarProductoImplicito(normalizarEntrada(expr)));
  const valor = (r: ReturnType<typeof areaDefinida>) => (r.tipo === "valor" ? r.valor : NaN);

  test("polinomio regular: ∫₀² x² dx = 8/3", () => {
    const r = areaDefinida(fr("x^2"), 0, 2);
    igual(r.tipo, "valor", "es un valor");
    aprox(valor(r), 8 / 3, 1e-6, "8/3");
    assert(r.tipo === "valor" && !r.impropia, "no impropia");
  });

  test("área con signo: ∫₀^π sin(x) dx = 2, ∫₀^{2π} sin = 0", () => {
    aprox(valor(areaDefinida(fr("sin(x)"), 0, Math.PI)), 2, 1e-6, "= 2");
    aprox(valor(areaDefinida(fr("sin(x)"), 0, 2 * Math.PI)), 0, 1e-6, "= 0 (se cancela)");
  });

  test("cancelación por signo: ∫₋₁¹ x³ dx = 0 (raíz interior, no polo)", () => {
    const r = areaDefinida(fr("x^3"), -1, 1);
    igual(r.tipo, "valor", "raíz en 0 no confunde con polo");
    aprox(valor(r), 0, 1e-9, "= 0");
  });

  test("intervalo orientado: ∫₂⁰ x² dx = −8/3", () => {
    aprox(valor(areaDefinida(fr("x^2"), 2, 0)), -8 / 3, 1e-6, "signo invertido");
  });

  test("a == b → 0", () => {
    igual(valor(areaDefinida(fr("x^2"), 3, 3)), 0, "intervalo nulo");
  });

  test("polo INTERIOR con cambio de signo: ∫₋₁¹ 1/x → divergente", () => {
    const r = areaDefinida(fr("1/x"), -1, 1);
    igual(r.tipo, "etiqueta", "etiquetada");
    igual((r as any).etiqueta, ETIQUETA_DIVERGENTE.etiqueta, "Integral divergente");
  });

  test("polo interior del MISMO signo (off-grid): ∫₀¹ 1/(x-0.5)^2 → divergente", () => {
    igual(areaDefinida(fr("1/(x-0.5)^2"), 0, 1).tipo, "etiqueta", "pico detectado");
  });

  test("singularidad en extremo DIVERGENTE: ∫₀¹ 1/x^2 y ∫₀¹ 1/x", () => {
    igual((areaDefinida(fr("1/x^2"), 0, 1) as any).etiqueta, ETIQUETA_DIVERGENTE.etiqueta, "1/x² diverge");
    igual((areaDefinida(fr("1/x"), 0, 1) as any).etiqueta, ETIQUETA_DIVERGENTE.etiqueta, "1/x diverge (log)");
  });

  test("impropia CONVERGENTE: ∫₀¹ 1/√x dx = 2 (marcada impropia)", () => {
    const r = areaDefinida(fr("1/sqrt(x)"), 0, 1);
    igual(r.tipo, "valor", "converge");
    aprox(valor(r), 2, 5e-3, "≈ 2 (aproximado)");
    assert(r.tipo === "valor" && r.impropia, "marcada impropia");
  });

  test("intervalo fuera del dominio: ∫₀^4 √(x−1) dx → Fuera de dominio", () => {
    igual((areaDefinida(fr("sqrt(x-1)"), 0, 4) as any).etiqueta, ETIQUETA_FUERA_DOMINIO.etiqueta, "hueco interior");
  });

  test("límites no numéricos → etiqueta", () => {
    igual((areaDefinida(fr("x^2"), NaN, 2) as any).etiqueta, ETIQUETA_LIMITES.etiqueta, "a no finito");
  });

  test("recortarRegion: recorta la polilínea a [a,b] con puntos de corte interpolados", () => {
    // Recta y=x muestreada en x∈[-5,5]; recorte a [0,2].
    const puntos: number[] = [];
    for (let i = -5; i <= 5; i++) puntos.push(i, i);
    const rama = { puntos: Float64Array.from(puntos), cerrada: false, calidad: "exacta" as const, objetoId: "t" };
    const regs = recortarRegion([rama], 0, 2);
    assert(regs.length === 1, `un tramo continuo, obtuve ${regs.length}`);
    const r = regs[0];
    aprox(r[0], 0, 1e-9, "empieza en x=0");
    aprox(r[r.length - 2], 2, 1e-9, "acaba en x=2");
    for (let i = 0; i < r.length; i += 2) assert(r[i] >= -1e-9 && r[i] <= 2 + 1e-9, `x en [0,2]: ${r[i]}`);
  });
});

describe("Integral definida: relleno de la región (dibujarRegion + Escena)", () => {
  // ctx grabador: registra cada relleno y cada trazo (color, punteado y vértices de
  // pantalla). `restore()` apaga el dash como aproximación del stack real de Canvas:
  // el tramado lo activa dentro de su save/restore, los bordes trazan sin dash.
  function ctxGrabador() {
    const rellenos: { color: string; puntos: [number, number][] }[] = [];
    const trazos: { color: string; dash: boolean; puntos: [number, number][] }[] = [];
    let cur: [number, number][] = [];
    let fill = "", stroke = "", dash = false;
    const ctx = {
      save() {}, restore() { dash = false; }, beginPath() { cur = []; }, closePath() {}, clip() {},
      moveTo(x: number, y: number) { cur.push([x, y]); },
      lineTo(x: number, y: number) { cur.push([x, y]); },
      set fillStyle(v: string) { fill = v; }, get fillStyle() { return fill; },
      set strokeStyle(v: string) { stroke = v; }, get strokeStyle() { return stroke; },
      fill() { rellenos.push({ color: fill, puntos: cur.slice() }); },
      stroke() { trazos.push({ color: stroke, dash, puntos: cur.slice() }); },
      arc() {}, set lineWidth(_v: number) {},
      set lineJoin(_v: string) {}, setLineDash(d: number[]) { dash = d.length > 0; },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, rellenos, trazos };
  }

  // Rama y=f(x) muestreada en [x0,x1] (paso fino), como Float64Array intercalado.
  const ramaDe = (f: (x: number) => number, x0: number, x1: number, n = 200) => {
    const p: number[] = [];
    for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; p.push(x, f(x)); }
    return { puntos: Float64Array.from(p), cerrada: false, calidad: "exacta" as const, objetoId: "t" };
  };
  const vp = crearViewport([-5, 5], [-5, 5], 400, 400, 1);

  test("f>0 en todo [a,b]: un solo relleno POSITIVO que baja al eje", () => {
    const { ctx, rellenos } = ctxGrabador();
    const regs = recortarRegion([ramaDe((x) => x * x, -5, 5)], 0, 2);
    new RendererCanvas2D(ctx).dibujarRegion(regs, vp);
    igual(rellenos.length, 1, "un tramo");
    igual(rellenos[0].color, RELLENO_POSITIVO, "tinte positivo");
    const ejeY = 200; // y=0 → centro del lienzo 400px
    aprox(rellenos[0].puntos[0][1], ejeY, 1e-6, "empieza en el eje");
    aprox(rellenos[0].puntos[rellenos[0].puntos.length - 1][1], ejeY, 1e-6, "termina en el eje");
  });

  test("cambio de signo: dos rellenos (negativo y positivo) partidos en y=0", () => {
    const { ctx, rellenos } = ctxGrabador();
    const regs = recortarRegion([ramaDe((x) => x * x * x, -3, 3)], -1, 1);
    new RendererCanvas2D(ctx).dibujarRegion(regs, vp);
    igual(rellenos.length, 2, "dos tramos de signo");
    const colores = rellenos.map((r) => r.color);
    assert(colores.includes(RELLENO_POSITIVO) && colores.includes(RELLENO_NEGATIVO), "ambos tintes");
  });

  test("tramado diagonal sólido anclado al mundo + bordes verticales en a y b", () => {
    const { ctx, rellenos, trazos } = ctxGrabador();
    const regs = recortarRegion([ramaDe((x) => x * x, -5, 5)], 0, 2);
    new RendererCanvas2D(ctx).dibujarRegion(regs, vp);
    igual(rellenos.length, 1, "un relleno");
    const tramas = trazos.filter((t) => t.color === TRAMA_POSITIVA);
    igual(tramas.length, 1, "hay tramado frío (f>0), en un solo stroke");
    assert(!tramas[0].dash, "el tramado es SÓLIDO, no punteado");
    const bordes = trazos.filter((t) => t.color === BORDE_REGION);
    igual(bordes.length, 2, "dos bordes (a y b)");
    // Vista [-5,5]→400px (40 px/unidad, eje en 200): el borde de b=2 es la vertical
    // x=280 del eje (y=200) a la curva (y=4 → 40px). El de a=0 degenera a un punto.
    const b = bordes[1];
    aprox(b.puntos[0][0], 280, 1e-6, "x de pantalla del borde b");
    aprox(b.puntos[0][1], 200, 1e-6, "arranca en el eje");
    aprox(b.puntos[1][1], 40, 1e-6, "termina en la curva (y=4)");
  });

  test("el tramado acompaña al pan: panear la vista TRASLADA las diagonales", () => {
    // Misma región en dos encuadres desplazados 0.1 unidades en x (= 4 px con la vista
    // [-5,5]→400px). Las diagonales xPx+yPx=c van ancladas al MUNDO: su fase debe
    // correrse esos 4 px (c baja 4), no quedarse quieta en pantalla.
    const trama = (vista: ReturnType<typeof crearViewport>) => {
      const { ctx, trazos } = ctxGrabador();
      const regs = recortarRegion([ramaDe((x) => x * x, -5, 5)], 0, 2);
      new RendererCanvas2D(ctx).dibujarRegion(regs, vista);
      return trazos.find((t) => t.color === TRAMA_POSITIVA)!;
    };
    const a = trama(crearViewport([-5, 5], [-5, 5], 400, 400, 1));
    const b = trama(crearViewport([-4.9, 5.1], [-5, 5], 400, 400, 1));
    // Fase de la familia: c = xPx+yPx de cualquier vértice, módulo el paso (12 px).
    const fase = (t: typeof a) => (((t.puntos[0][0] + t.puntos[0][1]) % 12) + 12) % 12;
    const esperado = (fase(a) + 8) % 12; // c se corre −4 px ≡ +8 (mód 12)
    aprox(fase(b), esperado, 1e-6, "la fase del tramado se traslada con el mundo");
  });

  test("Escena.fijarIntegral cachea la región recortada en actualizar", () => {
    const ctxNulo = null as unknown as CanvasRenderingContext2D;
    const escena = new Escena(construirObjetosEscena("x^2"),
      new Overlay(ctxNulo), new RendererCanvas2D(ctxNulo), new Crosshair(ctxNulo));
    escena.fijarIntegral(0, 2);
    escena.actualizar(vp, "final");
    const regs = escena.regionesIntegral();
    assert(regs.length >= 1, "hay región cacheada");
    for (const poly of regs)
      for (let i = 0; i < poly.length; i += 2)
        assert(poly[i] >= -1e-6 && poly[i] <= 2 + 1e-6, `x recortada a [0,2]: ${poly[i]}`);
  });
});

describe("Integral definida: fachada del panel (evaluarArea + cuerpoAreaLatex)", () => {
  test("evaluarArea de la notación LaTeX: ∫₀² x² dx ≈ 8/3", () => {
    const r = evaluarArea("\\int_{0}^{2}x^{2}\\,dx");
    igual(r!.tipo, "valor", "es un valor");
    aprox((r as any).valor, 8 / 3, 1e-6, "8/3");
  });

  test("evaluarArea divergente: ∫₋₁¹ 1/x dx → etiqueta", () => {
    igual(evaluarArea("\\int_{-1}^{1} 1/x \\, dx")!.tipo, "etiqueta", "divergente");
  });

  test("evaluarArea con límites simbólicos → etiqueta (límites no numéricos)", () => {
    igual(evaluarArea("\\int_{a}^{b} x^2 \\, dx")!.tipo, "etiqueta", "a,b simbólicos");
  });

  test("evaluarArea de un bloque sin integral → null", () => {
    igual(evaluarArea("x^2"), null, "sin \\int");
  });

  test("cuerpoAreaLatex: entero exacto usa '=', impropia usa '\\approx'", () => {
    const exacto = cuerpoAreaLatex({ tipo: "valor", valor: 2, impropia: false });
    igual(exacto.conector, "=", "exacto con =");
    igual(exacto.cuerpo, "2", "entero limpio");
    const impropia = cuerpoAreaLatex({ tipo: "valor", valor: 1.9998, impropia: true });
    igual(impropia.conector, "\\approx", "impropia con ≈");
    const etiqueta = cuerpoAreaLatex({ tipo: "etiqueta", etiqueta: "Integral divergente", detalle: "x" });
    assert(etiqueta.cuerpo.includes("\\text{Integral divergente}"), "etiqueta como \\text");
  });

  test("integralValorLatex respeta el conector (= vs \\approx)", () => {
    const tex = integralValorLatex("\\int_{0}^{1} 1/sqrt(x) \\, dx", "2", "\\approx");
    assert(tex.includes("\\approx 2"), `usa ≈: ${tex}`);
  });
});

describe("Integral definida: primitiva simbólica (integrarExpr + Barrow)", () => {
  const integrandoF = (expr: string) => crearFuncionReal(insertarProductoImplicito(normalizarEntrada(expr)));
  const areaNum = (expr: string, a: number, b: number) => {
    const r = areaDefinida(integrandoF(expr), a, b);
    return r.tipo === "valor" ? r.valor : NaN;
  };
  // Teorema fundamental del cálculo: la primitiva hallada F debe cumplir F(b)−F(a) = ∫ₐᵇ f.
  // Se compara contra el área numérica (Simpson adaptativo), un cómputo INDEPENDIENTE: si mi
  // primitiva fuera errónea, no cuadraría. Es el mismo espíritu que la guarda de `integrarExpr`,
  // pero comprobado desde fuera y de punta a punta.
  const barrowNum = (expr: string, a: number, b: number) => {
    const P = integrarExpr(expr);
    assert(P !== null, `hay primitiva de ${expr}`);
    const F = crearFuncionReal(P!); // P ya es un string mathjs limpio
    return (F.eval(b) as number) - (F.eval(a) as number);
  };

  test("TFC: F(b)−F(a) coincide con el área numérica en todo el repertorio cubierto", () => {
    const casos: [string, number, number][] = [
      ["1/x", 1, 3], ["x", 0, 2], ["x^2", 0, 2], ["3x^2+2x", -1, 2],
      ["sin(x)", 0, Math.PI], ["cos(2x)", 0, 1], ["e^x", 0, 1], ["e^{3x}", 0, 0.5],
      ["(2x+1)^5", 0, 1], ["1/(1+x^2)", -1, 1], ["1/(x^2+4)", 0, 2], ["1/x^2", 1, 4],
      ["sqrt(x)", 0, 4], ["1/(3x+1)", 0, 2], ["x^3-2x", -1, 2], ["tan(x)", 0, 1],
      ["2^x", 0, 2],
    ];
    for (const [expr, a, b] of casos)
      aprox(barrowNum(expr, a, b), areaNum(expr, a, b), 1e-5, `∫ ${expr} en [${a},${b}]`);
  });

  test("linealidad y sustitución lineal: sumas y f(ax+b) se integran término a término", () => {
    // La derivada NUMÉRICA de la primitiva reproduce el integrando (guarda de integrarExpr).
    for (const expr of ["sin(x)+cos(x)", "cos(3x-1)", "e^{-x}", "(5-2x)^3"]) {
      const P = integrarExpr(expr);
      assert(P !== null, `hay primitiva de ${expr}`);
      const f = integrandoF(expr), F = crearFuncionReal(P!), h = 1e-6;
      for (const x of [-0.7, 0.4, 1.1]) {
        const dNum = ((F.eval(x + h) as number) - (F.eval(x - h) as number)) / (2 * h);
        aprox(dNum, f.eval(x) as number, 1e-4, `F'(${x}) = ${expr}`);
      }
    }
  });

  test("fuera de alcance del integrador → null (mejor ninguna que una incorrecta)", () => {
    // Sin primitiva ELEMENTAL o fuera del repertorio: se devuelve null y el panel cae al valor.
    for (const expr of ["x*sin(x)", "1/(x^2+x+1)", "ln(x)", "x^x", "sin(x^2)", "e^{x^2}"])
      igual(integrarExpr(expr), null, `sin primitiva: ${expr}`);
  });

  test("Barrow LaTeX del ejemplo del usuario: ∫₂³ (1/x) dx → [ln|x|]₂³", () => {
    const tex = integralPrimitivaLatex("\\int_{2}^{3}\\frac{1}{x}\\,dx");
    assert(tex !== null, "hay primitiva");
    assert(/\\ln/.test(tex!) && /x/.test(tex!) && tex!.includes("|"), `ln y |x|: ${tex}`);
    assert(/\\left\[/.test(tex!) && /\\right\]_\{2\}\^\{3\}/.test(tex!), `corchete con límites 2..3: ${tex}`);
  });

  test("Barrow LaTeX: forma x²/2 y límites; integrando fuera de alcance → null", () => {
    const tex = integralPrimitivaLatex("\\int_{0}^{2}x\\,dx");
    assert(tex !== null && tex.includes("\\frac{x^{2}}{2}"), `primitiva x²/2: ${tex}`);
    igual(integralPrimitivaLatex("\\int_{0}^{1} x \\sin(x) \\, dx"), null, "x·sin(x) sin primitiva → null");
    igual(integralPrimitivaLatex("x^2"), null, "sin integral reconocible → null");
  });

  test("valor EXACTO del área vía Barrow: fracción, ln, π y radical (no decimal)", () => {
    const casos: [string, string, string][] = [
      ["\\int_{0}^{2}x^{2}\\,dx", "=", "\\frac{8}{3}"],
      ["\\int_{1}^{3}\\frac{1}{x}\\,dx", "=", "\\ln 3"],
      ["\\int_{0}^{\\pi}\\sin(x)\\,dx", "=", "2"],
      ["\\int_{-1}^{1}\\frac{1}{1+x^2}\\,dx", "=", "\\frac{\\pi}{2}"],
      ["\\int_{0}^{4}\\sqrt{x}\\,dx", "=", "\\frac{16}{3}"],
    ];
    for (const [s, conector, cuerpo] of casos) {
      const r = cuerpoAreaLatexExacto(s);
      igual(r.conector, conector, `conector de ${s}`);
      igual(r.cuerpo, cuerpo, `cuerpo de ${s}`);
    }
  });

  test("irracional sin forma cerrada → \\approx (∫₀¹ eˣ dx = e−1 ≈ 1.7183)", () => {
    const r = cuerpoAreaLatexExacto("\\int_{0}^{1}e^{x}\\,dx");
    igual(r.conector, "\\approx", "usa ≈");
    assert(r.cuerpo !== null && /1\.718/.test(r.cuerpo), `decimal e−1: ${r.cuerpo}`);
  });

  test("polo interior: Barrow NO se aplica, se respeta la divergencia", () => {
    // El panel no lleva valor NI etiqueta (`cuerpo === null`) — el diagnóstico va al PLANO;
    // lo que importa aquí es que NO se afirme el número que daría Barrow (F(1)−F(−1) = 0).
    const r = cuerpoAreaLatexExacto("\\int_{-1}^{1}\\frac{1}{x}\\,dx");
    igual(r.cuerpo, null, "sin valor en el panel: la integral diverge");
    igual(etiquetaIntegral("\\int_{-1}^{1}\\frac{1}{x}\\,dx")?.etiqueta, "Integral divergente",
      "la etiqueta existe, y es la que el host pinta sobre el plano");
  });

  test("sin primitiva simbólica: valor numérico honesto con \\approx (∫₀¹ x·sin x)", () => {
    const r = cuerpoAreaLatexExacto("\\int_{0}^{1} x \\sin(x) \\, dx");
    igual(r.conector, "\\approx", "sin primitiva ⇒ aproximado");
  });
});

describe("Derivada de exponencial base≠e: \\ln k simbólico, no decimal (regresión 3^x)", () => {
  test("d/dx 3^x = 3^x·ln 3 (grafica y LaTeX), sin decimal que rompa el render", () => {
    const g = derivarExpr("3^x");
    assert(g !== null && /log\(3\)/.test(g), `el string graficado usa log(3): ${g}`);
    assert(!/1\.0986/.test(g!), `sin el decimal de ln 3: ${g}`);
    const tex = derivadaLatex(["3^x"]);
    assert(/3\^\{x\}\\ln 3/.test(tex), `LaTeX = 3^{x}\\ln 3: ${tex}`);
    assert(!/1\.09/.test(tex), `el LaTeX no lleva el decimal roto: ${tex}`);
  });

  test("el valor graficado se conserva EXACTO: (3^x·ln 3) en x=1 = 3·ln 3", () => {
    const F = crearFuncionReal(derivarExpr("3^x")!);
    aprox(F.eval(1) as number, 3 * Math.log(3), 1e-9, "d/dx 3^x en x=1");
  });

  test("un coeficiente numérico normal NO se re-simboliza: d/dx 2·sin x = 2 cos x", () => {
    assert(/2\\cos x/.test(derivadaLatex(["2*sin(x)"])), "2 cos x intacto (2 no es ln k)");
  });
});

// ─────────────────────────────────────────────
// Estrés: ninguna expresión puede colgar el hilo principal de Obsidian
// ─────────────────────────────────────────────
//
// Regresión del cuelgue del CORAZÓN `(x²+y²−1)³=x²y³`: `rationalize` (mathjs) expandía
// la potencia de forma naive y nunca terminaba → Obsidian se congelaba al RENDERIZAR el
// bloque, y volvía a congelarse al reabrir la nota (el bloque se re-renderiza al arrancar)
// → la única salida era borrar el .md. Una fórmula NUNCA debe poder inutilizar una nota.
//
// El banco recorre el pipeline COMPLETO que ejecuta el host al pintar un bloque (dividir →
// despejar → simplificar → geometría en las dos pasadas) y exige de cada curva difícil:
// que TERMINE, dentro de un presupuesto de tiempo, y con la geometría ACOTADA (memoria).
// Cualquier regresión que reintroduzca una expansión exponencial cuelga este test.

const CURVAS_ESTRES: ReadonlyArray<{ nombre: string; fuente: string }> = [
  { nombre: "corazón (x²+y²−1)³=x²y³", fuente: "\\left(x^{2}+y^{2}-1\\right)^{3}=x^{2}y^{3}" },
  { nombre: "recíproco x⁻¹", fuente: "x^{-1}" },
  { nombre: "lemniscata (x²+y²)²=2(x²−y²)", fuente: "(x^{2}+y^{2})^{2}=2(x^{2}-y^{2})" },
  { nombre: "astroide x^{2/3}+y^{2/3}=1", fuente: "x^{2/3}+y^{2/3}=1" },
  { nombre: "potencia alta (x+1)¹²", fuente: "(x+1)^{12}" },
];

// Presupuestos HOLGADOS: no miden rendimiento (sería frágil), sino la diferencia entre
// "termina" y "no termina". Antes del arreglo, el corazón no acababa NUNCA.
const MS_MAX_CURVA = 5000;
const PUNTOS_MAX_CURVA = 250_000;   // cota de memoria: ~4 MB de Float64Array

describe("Estrés: ninguna expresión cuelga el hilo principal", () => {
  for (const { nombre, fuente } of CURVAS_ESTRES) {
    test(`${nombre}: termina, acotada en tiempo y en memoria`, () => {
      const t0 = Date.now();
      const ecs = dividirEcuaciones(fuente);

      // Análisis simbólico (el panel LaTeX): AQUÍ estaba el cuelgue.
      const desp = despejarEcuaciones(ecs);
      const simp = simplificarEcuaciones(ecs);
      assert(desp.length === ecs.length && simp.length === ecs.length, "las transformaciones devuelven una forma por ecuación");

      // Geometría en las DOS pasadas (gesto + reposo), como hace la escena real.
      const prov = crearProveedor(construirObjeto(ecs[0], "estres"));
      let puntos = 0;
      for (const tol of [TOL_INT, TOL_FINAL]) {
        const g = prov.geometria(VP, tol);
        const n = g.ramas.reduce((s, r) => s + r.puntos.length / 2, 0);
        // Resultado VÁLIDO (geometría trazada) o fallo CONTROLADO (sin ramas), nunca basura.
        for (const r of g.ramas) assert(r.puntos.length % 2 === 0 && r.puntos.length >= 4, "polilínea bien formada");
        puntos = Math.max(puntos, n);
      }

      const ms = Date.now() - t0;
      assert(ms < MS_MAX_CURVA, `debe terminar en < ${MS_MAX_CURVA} ms (tardó ${ms} ms)`);
      assert(puntos < PUNTOS_MAX_CURVA, `geometría acotada (${puntos} puntos)`);
    });
  }

  test("el corazón SÍ se grafica (el arreglo no lo degrada a curva vacía)", () => {
    const prov = crearProveedor(construirObjeto("(x^2+y^2-1)^3=x^2*y^3", "corazon"));
    const g = prov.geometria(VP, TOL_FINAL);
    assert(g.ramas.length > 0, "el corazón produce geometría, no un fallo silencioso");
    // Sus puntos cumplen la ecuación: F(x,y)≈0 (la guarda es simbólica, no toca el trazado).
    const F = (construirObjeto("(x^2+y^2-1)^3=x^2*y^3", "c") as ObjetoImplicito).F;
    for (const r of g.ramas)
      for (let k = 0; k < r.puntos.length; k += 2)
        assert(Math.abs(F.eval(r.puntos[k], r.puntos[k + 1])) < 1e-3, "los puntos están sobre la curva");
  });
});

// ─────────────────────────────────────────────
// Despeje por RAÍZ IMPAR + cuadrática general (la familia del corazón)
// ─────────────────────────────────────────────
//
// `(A(x)+y²)^n = B(x)·y^n` con n IMPAR: la potencia impar es invertible en ℝ, así que se saca la
// raíz n-ésima real de los dos lados SIN perder ni añadir soluciones, y la ⁿ√ entra en el producto
// liberando la y (`∛(x²y³)=∛(x²)·y`, porque el exponente de y es múltiplo del índice) → queda una
// CUADRÁTICA en y, que la fórmula general resuelve. Antes el corazón salía "despeje PARCIAL".

/** Ramas reales de un despeje `y = …` con el centinela `pm`: expande el ± en sus dos signos. */
function ramasDelDespeje(despeje: string): string[] {
  const m = despeje.match(/^y\s*=\s*(.*)$/s);
  if (!m) return [];
  const salida: string[] = [];
  const expandir = (s: string): void => {
    const i = s.indexOf("pm(");
    if (i < 0) { salida.push(s); return; }
    let d = 1, j = i + 3;
    while (j < s.length && d > 0) { if (s[j] === "(") d++; if (s[j] === ")") d--; j++; }
    const dentro = s.slice(i + 3, j - 1);
    for (const sg of ["+", "-"]) expandir(`${s.slice(0, i)}(${sg}(${dentro}))${s.slice(j)}`);
  };
  expandir(m[1]);
  return salida;
}

/** Comprueba que TODA rama del despeje satisface la ecuación ORIGINAL donde es real. */
function despejeCorrecto(ecuacion: string, F: (x: number, y: number) => number): void {
  const ramas = ramasDelDespeje(despejarEcuaciones([ecuacion])[0]);
  assert(ramas.length > 0, `${ecuacion}: no quedó aislada en y`);
  let viables = 0;
  for (const rama of ramas) {
    const f = crearFuncionReal(rama);
    for (let x = -3; x <= 3; x += 0.137) {
      const y = f.eval(x) as number;
      if (!Number.isFinite(y)) continue;         // fuera del dominio de la rama
      aprox(F(x, y), 0, 1e-6 * (1 + x ** 4 + y ** 4), `${ecuacion} en x=${x.toFixed(2)}`);
      viables++;
    }
  }
  assert(viables >= 2, `${ecuacion}: la rama nunca es real (no se validó nada)`);
}

describe("Despejar y: raíz impar + cuadrática general (familia del corazón)", () => {
  test("corazón (x²+y²−1)³=x²y³ → y = (∛(x²) ± √(∛(x⁴)+4−4x²))/2, COMPLETO", () => {
    const r = despejarY("\\left(x^{2}+y^{2}-1\\right)^{3}=x^{2}y^{3}");
    assert(r !== null && r.completo, "el despeje del corazón es COMPLETO (antes: parcial)");
    igual(
      r!.latex,
      "y=\\frac{\\sqrt[3]{x^{2}} \\pm \\sqrt{\\sqrt[3]{x^{4}}+4-4x^{2}}}{2}",
      "forma de la fórmula cuadrática con ± en el numerador"
    );
    // Y es CORRECTO: ambas ramas cumplen la ecuación original allí donde son reales.
    despejeCorrecto("(x^2+y^2-1)^3=x^2*y^3", (x, y) => (x * x + y * y - 1) ** 3 - x * x * y ** 3);
  });

  test("la MISMA curva despeja igual con `=` que como expresión suelta (todo a la izquierda)", () => {
    // La reducción por raíz impar miraba solo los LADOS de la ecuación; con la curva escrita
    // en su forma natural (`D=0`, o una expresión suelta) la potencia es un TÉRMINO, no un
    // lado, y el corazón salía "no se puede despejar y" mientras que con `=` sí despejaba.
    const conIgual = despejarY("\\left(x^{2}+y^{2}-1\\right)^{3}=x^{2}y^{3}");
    const suelta = despejarY("\\left(x^{2}+y^{2}-1\\right)^{3}-x^{2}y^{3}");
    const cero = despejarY("\\left(x^{2}+y^{2}-1\\right)^{3}-x^{2}y^{3}=0");
    assert(suelta !== null && suelta.completo, "expresión suelta: despeje COMPLETO");
    igual(suelta!.latex, conIgual!.latex, "misma curva, mismo despeje que con `=`");
    igual(cero!.latex, conIgual!.latex, "y también escrita `…=0`");
    despejeCorrecto("(x^2+y^2-1)^3-x^2*y^3", (x, y) => (x * x + y * y - 1) ** 3 - x * x * y ** 3);
    // El signo del término con la potencia importa: `x²y³ − (x²+y²−1)³ = 0` es la misma curva.
    despejeCorrecto("x^2*y^3-(x^2+y^2-1)^3=0", (x, y) => x * x * y ** 3 - (x * x + y * y - 1) ** 3);
  });

  test("la raíz impar libera la y y reduce el grado (varios n)", () => {
    despejeCorrecto("(x+y^2)^3=8*x^3", (x, y) => (x + y * y) ** 3 - 8 * x ** 3);
    despejeCorrecto("(y^2-x)^5=32*y^5", (x, y) => (y * y - x) ** 5 - 32 * y ** 5);
    despejeCorrecto("(x^2+y^2)^3=y^3", (x, y) => (x * x + y * y) ** 3 - y ** 3);
    // Sin y en el otro lado: (x+y)³=x³ ⇒ x+y=x ⇒ y=0 (la potencia impar es inyectiva).
    igual(despejarEcuaciones(["(x+y)^3=x^3"])[0], "y = 0", "(x+y)³=x³ ⇒ y=0");
    igual(despejarEcuaciones(["(x+y)^5=32*x^5"])[0], "y = x", "(x+y)⁵=32x⁵ ⇒ y=x");
  });

  test("potencia PAR no se reduce (ⁿ√(uⁿ)=|u| exigiría un ±): sin cambio de comportamiento", () => {
    // (x+y)²=x² NO puede reducirse a x+y=x (perdería la rama y=−2x). Debe seguir sin
    // inventarse un despeje incorrecto: o queda parcial, o el despeje que dé ha de ser CORRECTO.
    const s = despejarEcuaciones(["(x+y)^2=x^2"])[0];
    if (/^y = /.test(s)) despejeCorrecto("(x+y)^2=x^2", (x, y) => (x + y) ** 2 - x * x);
  });

  test("cuadrática general en y: los seis casos de manual", () => {
    igual(despejarEcuaciones(["x^2+y^2=2*x*y+4"])[0], "y = x + pm(2)", "x²+y²=2xy+4 ⇒ y=x±2");
    despejeCorrecto("3*y^2+2*x*y+x^2-4=0", (x, y) => 3 * y * y + 2 * x * y + x * x - 4);
    despejeCorrecto("y^2-2*x*y+x^2-9=0", (x, y) => (y - x) ** 2 - 9);
    // A(x) NO constante y dominio ESTRECHO (|x|≤½): la muestra de validación debe alcanzarlo.
    despejeCorrecto("x*y^2+y+x=0", (x, y) => x * y * y + y + x);
    // Lineal en y² con coeficiente en x → y=±√((4−x²)/(x²+1)).
    despejeCorrecto("x^2*y^2+x^2+y^2=4", (x, y) => x * x * y * y + x * x + y * y - 4);
    // Los que ya funcionaban siguen igual (potencia, raíz, absoluto).
    igual(despejarEcuaciones(["x^2+y^4=5"])[0], "y = pm(nthRoot((5 - x ^ 2), 4))", "y⁴ ⇒ ±⁴√");
    igual(despejarEcuaciones(["x+sqrt(y)=4"])[0], "y = ((-x + 4))^2", "√y ⇒ elevar al cuadrado");
    igual(despejarEcuaciones(["x+abs(y)=5"])[0], "y = pm(-x + 5)", "|y| ⇒ ±");
  });

  test("lo NO despejable sigue siendo parcial (no se fuerza nada)", () => {
    assert(!/^y = /.test(despejarEcuaciones(["x^3+y^3=3*x*y"])[0]), "folium: parcial");
    assert(!/^y = /.test(despejarEcuaciones(["y^y=3-x^x"])[0]), "y^y: parcial");
    assert(/^\(tan\(y\)\)/.test(despejarEcuaciones(["tan(y)*(x^2+1)=sqrt(x+1)"])[0]),
      "trascendente: solo el despeje multiplicativo");
  });
});

describe("Guarda de expansión (presupuesto de monomios de rationalize)", () => {
  test("el coste es el nº de monomios de la expansión naive", () => {
    igual(costeExpansion(parse("(x+y)^3")), 8, "(x+y)³ → 2³");
    igual(costeExpansion(parse("(x^2+y^2-1)^3")), 27, "(x²+y²−1)³ → 3³ (el corazón)");
    igual(costeExpansion(parse("(x+1)^12")), 4096, "(x+1)¹² → 2¹²");
    igual(costeExpansion(parse("(x^2+y^2)^2-2*(x^2-y^2)")), 6, "lemniscata: dentro del presupuesto");
  });

  test("un exponente absurdo no cuelga el propio cálculo del coste", () => {
    assert(costeExpansion(parse("(x+1)^1000000")) === Infinity, "se resuelve en O(1), sin iterar");
  });

  test("por encima del límite NO se expande (null); por debajo sí", () => {
    assert(rationalizeSeguro("(x^2+y^2-1)^3-x^2*y^3") === null, "el corazón se rechaza");
    assert(costeExpansion(parse("(x^2+y^2)^2-2*(x^2-y^2)")) <= LIMITE_EXPANSION, "la lemniscata cabe");
    assert(rationalizeSeguro("(x^2+y^2)^2-2*(x^2-y^2)") !== null, "y por tanto sí se expande");
  });

  test("rechazada la expansión, Simplificar degrada a la forma sin desarrollar (no cuelga)", () => {
    const s = simplificarEcuaciones(["(x^2+y^2-1)^3=x^2*y^3"])[0];
    assert(s.includes("^ 3") || s.includes("^3"), `conserva la potencia sin expandir: ${s}`);
  });

  test("la lemniscata conserva su despeje cuadrático completo (la guarda no la toca)", () => {
    const d = despejarEcuaciones(["(x^2+y^2)^2=2*(x^2-y^2)"])[0];
    assert(/^y = pm\(sqrt\(/.test(d), `y = ±√(…): ${d}`);
  });
});

// ─────────────────────────────────────────────
// Símbolos de entrada: doble signo (±, ∓) y comandos LaTeX
// ─────────────────────────────────────────────
//
// Antes, TODO comando LaTeX no reconocido caía en el barrido residual (`\\cmd` → `cmd`) y el
// producto implícito lo partía letra a letra (`\times` → `t*i*m*e*s`): símbolos libres, NaN en
// todo x, plano vacío SIN error. Y `\pm` ni siquiera era evaluable. Estas pruebas fijan las
// tres piezas: los símbolos con equivalente directo se traducen, el ± produce sus DOS ramas
// reales, y lo que no se sabe traducir se DICE (etiqueta) en vez de graficarse como basura.

describe("Símbolos de entrada: ± y comandos LaTeX", () => {
  const norm = (s: string) => insertarProductoImplicito(normalizarEntrada(s));
  const vpSim = crearViewport([-10, 10], [-7, 7], 600, 420, 1);
  const TOL_SIM: Tolerancia = { desviacionMaxPx: 0.5, pasoMaxPx: 2, pasada: "final" };
  const ramasDe = (source: string): number =>
    construirObjetosEscena(source).reduce(
      (n, o) => n + o.proveedor.geometria(vpSim, TOL_SIM).ramas.length, 0);

  test("símbolos con equivalente directo (antes: sopa de letras → plano vacío)", () => {
    igual(norm("2\\times x"), "2* x", "\\times → *");
    igual(norm("x\\div 2"), "x/ 2", "\\div → /");
    igual(norm("2\\ast x"), "2* x", "\\ast → *");
    igual(norm("x/\\infty"), "x/Infinity", "\\infty → Infinity");
    igual(norm("x−1"), "x-1", "menos tipográfico U+2212 (copiar/pegar de Word) → -");
    igual(norm("\\lvert x\\rvert"), "abs( x)", "\\lvert…\\rvert → abs");
    igual(norm("\\operatorname{sech}(x)"), "sech(x)", "\\operatorname desenvuelve el nombre");
    igual(norm("\\mathrm{e}^x"), "e^x", "\\mathrm desenvuelve su contenido");
    igual(norm("x\\text{ (una recta)}"), "x", "\\text{…} es prosa: se borra entera");
    igual(norm("x\\,+\\,1"), "x + 1", "espaciados (\\, \\; \\!) no son matemática");
    igual(norm("\\displaystyle y=x^2"), "y=x^2", "directiva de composición: se borra (sin dejar espacio)");
  });

  test("función con argumento SIN agrupar (\\ln x, \\cos x, \\log_2 x)", () => {
    igual(norm("\\ln x"), "log(x)", "\\ln x (antes: log*x → NaN)");
    igual(norm("\\cos x"), "cos(x)", "\\cos x");
    igual(norm("\\arctan x"), "atan(x)", "\\arctan x");
    igual(norm("\\log_2 x"), "log(x,2)", "\\log_2 x");
    igual(norm("\\sin(x)"), "sin(x)", "la forma con paréntesis no cambia");
  });

  test("argumento sin agrupar CON coeficiente (\\cos 5t, \\sin 3\\theta) y θ Unicode", () => {
    // El número es el COEFICIENTE del argumento, no el argumento entero: antes la regla
    // capturaba solo el número, lo pasaba a GRADOS y dejaba la letra fuera
    // (`\cos 5t` → `cos(5·π/180)·t`) — y `x(t)=5\cos t-\cos 5t` (el ejemplo canónico de
    // las paramétricas por componentes) graficaba otra curva.
    igual(norm("\\cos 5t"), "cos(5*t)", "\\cos 5t es cos(5t), no cos(5°)·t");
    igual(norm("\\cos 2x"), "cos(2*x)", "\\cos 2x");
    igual(norm("\\sin 3\\theta"), "sin(3*theta)", "\\sin 3\\theta (comando griego tras el número)");
    igual(norm("\\sin 2\\pi x"), "sin(2*pi *x)", "corrida número·π·letra entera bajo la función");
    igual(norm("\\sin 3.5\\theta"), "sin(3.5*theta)", "coeficiente decimal");
    // El número PURO sigue siendo grados (comportamiento histórico intacto).
    igual(norm("\\cos 2"), "cos(2*pi/180)", "\\cos 2 sin símbolo detrás sigue en grados");
    // θ Unicode → theta: la polar compila contra `theta`; una θ libre era NaN en todo θ.
    igual(norm("r=sin(3θ)"), "r=sin(3*theta)", "θ Unicode se traduce como π");
  });

  test("grados: 30° y \\degree son 30·π/180", () => {
    aprox(compilarFuncion(norm("\\sin(90°)"), "x")(0) as number, 1, 1e-12, "sin(90°)=1");
    aprox(compilarFuncion(norm("\\sin(90\\degree)"), "x")(0) as number, 1, 1e-12, "sin(90\\degree)=1");
  });

  test("grados: el argumento trig NUMÉRICO puro es grados (\\sin{5}), también como fracción", () => {
    // Convención del plugin: número puro en una trig directa = grados. En TODAS las
    // formas de entrada (llaves, paréntesis, suelto) y también la FRACCIÓN de literales
    // (\frac{45}{2} = 22.5°): expresa el mismo número que su decimal, que ya convertía.
    igual(norm("\\sin{5}"), "sin(5*pi/180)", "\\sin{5} con llaves");
    igual(norm("\\sin(5)"), "sin(5*pi/180)", "\\sin(5) con paréntesis");
    igual(norm("\\sin 5"), "sin(5*pi/180)", "\\sin 5 suelto");
    igual(norm("\\sin(-30)"), "sin(-30*pi/180)", "negativo");
    igual(norm("\\sin(\\frac{45}{2})"), "sin((45)/(2)*pi/180)", "fracción de literales = 22.5°");
    aprox(compilarFuncion(norm("\\sin(\\frac{45}{2})"), "x")(0) as number,
      Math.sin(Math.PI / 8), 1e-12, "45/2 grados = π/8 rad");
    // Lo que NO es número puro NO se toca: símbolos, variable, inversas (su arg es un cociente).
    igual(norm("\\sin(\\frac{\\pi}{2})"), "sin((pi)/(2))", "π/2 son radianes, no grados");
    igual(norm("\\sin(\\frac{x}{2})"), "sin((x)/(2))", "x/2 es variable");
    igual(norm("\\arcsin(0.5)"), "asin(0.5)", "la inversa no convierte (cociente, no ángulo)");
    // El simplificado no pinta el coeficiente -1 pegado a π (`\frac{-1\pi}{6}`):
    // coeficientesAlFrente colapsa el factor de magnitud 1 al signo → `\frac{-\pi}{6}`.
    igual(bloqueALatex(simplificarEcuaciones(["y=\\sin(-30)"])),
      "y=\\sin\\left(\\frac{-\\pi}{6}\\right)", "-30° simplifica a -π/6, sin el -1");
  });

  test("± / ∓ → centinela pm/mp: se normaliza, se evalúa y se pinta como ±", () => {
    igual(norm("y=\\pm\\sqrt{4-x^2}"), "y=pm(sqrt(4-x^2))", "el operando del ± es el término entero");
    igual(norm("y=±x"), "y=pm(x)", "el Unicode ± vale igual que \\pm");
    igual(norm("y=1\\pm x"), "y=1+pm(x)", "tras un término, el ± es una SUMA del centinela");
    igual(norm("y=\\mp x"), "y=mp(x)", "∓ tiene su propio centinela (signos correlacionados)");
    igual(exprALatex("y=\\pm\\sqrt{4-x^2}"), "y=\\pm \\sqrt{4-x^{2}}", "el panel lo repinta como ±");
    const mpSuma = exprALatex("y=1\\mp x"); // `1 + mp(x)` NO debe salir como `1 + \mp x`
    assert(mpSuma.includes("\\mp") && !mpSuma.includes("+"), `a ∓ b sin el + intermedio: ${mpSuma}`);
    // Evaluable (rama principal): sin esto el bloque salía como "Indeterminada".
    aprox(compilarFuncion(norm("pm(x)+mp(1)"), "x")(3) as number, 2, 1e-12, "pm/mp evalúan +u/−u");
  });

  test("± en obs-graph/obs-system: DOS ramas reales, no media curva", () => {
    igual(ramasDe("y=\\pm\\sqrt{4-x^2}"), 2, "y=±√(4−x²) es la circunferencia entera (2 ramas)");
    igual(ramasDe("y=\\pm x"), 2, "y=±x son las dos rectas");
    igual(ramasDe("y=x"), 1, "sin ±, una sola rama (nada cambia)");
    igual(ramasDe("y=\\pm x\ny=1"), 3, "sistema: las 2 ramas del ± + la recta");
    // Las dos ramas son UN objeto (un color, una curva del selector): un solo ObjetoEscena.
    igual(construirObjetosEscena("y=\\pm\\sqrt{4-x^2}").length, 1, "± = UN objeto de escena");
  });

  test("± en obs-derivate: d/dx(±u) = ±u′ (antes: 'no derivable' o derivada falsa)", () => {
    igual(derivadaLatex(["y=\\pm x^2"]), "f'\\left(x\\right) = \\pm 2x", "d/dx(±x²) = ±2x");
    igual(derivadaLatex(["y=\\mp x^3"]), "f'\\left(x\\right) = \\mp 3x^{2}", "d/dx(∓x³) = ∓3x²");
    igual(derivarExpr("\\pm\\sqrt{x}"), "pm(1 / (2 * sqrt(x)))", "el ± sobrevive a la regla de la cadena");
    igual(derivarExpr("1\\pm x^2"), "pm(2 * x)", "la constante desaparece y el ± queda");
  });

  test("± en obs-integral: ∫(±f) = ±∫f", () => {
    const { cuerpo } = cuerpoAreaLatexExacto("\\int_{0}^{2}\\pm x\\,dx");
    igual(cuerpo, "\\pm 2", "el área hereda el doble signo (no un solo valor de la pareja)");
    igual(cuerpoAreaLatexExacto("\\int_{0}^{2}x\\,dx").cuerpo, "2", "sin ±, el valor no lo lleva");
    // Límite con menos tipográfico y con grados: antes daban "Límites no numéricos".
    igual(cuerpoAreaLatexExacto("\\int_{−1}^{1}x^2\\,dx").cuerpo, "\\frac{2}{3}", "límite con U+2212");
    igual(cuerpoAreaLatexExacto("\\int_{0}^{90°}\\sin x\\,dx").cuerpo, "1", "límite en grados");
  });

  test("comando no soportado: se DICE (etiqueta), no se grafica como basura", () => {
    igual(comandosNoSoportados("y=\\alpha x").join(","), "\\alpha", "\\alpha no es traducible");
    igual(comandosNoSoportados("y\\ge x").join(","), "\\ge", "las desigualdades no se grafican");
    igual(comandosNoSoportados("y=\\sum_{k=1}^{3}kx").join(","), "\\sum", "\\sum");
    igual(comandosNoSoportados("y=\\pm\\sqrt{4-x^2}").length, 0, "lo soportado no se marca");
    igual(comandosNoSoportados("y=\\operatorname{sech}(x)").length, 0, "\\operatorname sí se entiende");
    igual(comandosNoSoportados("\\int_{0}^{\\pi}\\sin(x)\\,dx").length, 0, "la integral entera se entiende");
    // El `\\` de `cases` es un SALTO DE LÍNEA: leerlo como comando `\y` velaría todo obs-system.
    igual(comandosNoSoportados("\\begin{cases}y=x\\\\y=2\\end{cases}").length, 0, "el \\\\ de cases no es un comando");
  });
});

// ─────────────────────────────────────────────
// Formas degeneradas: ninguna transformación puede FABRICAR un valor
// ─────────────────────────────────────────────
//
// `simplify`/`derivative` de mathjs son álgebra FORMAL: reducen `0/0` a `0` como si fuera un
// número. El panel de los cuatro bloques se alimenta de ahí, así que `f(x)=0/0` se mostraba
// como `f(x)=0` (sobre un plano velado con "Indeterminada": el panel contradecía al plano),
// `\frac{d}{dx}(0/0)` daba "f'(x) = 0" y graficaba la recta y=0, y `∫₀¹ 0/0 dx` se pintaba
// como `∫₀¹ 0 dx`. La regla: lo que no toma ningún valor real NO se transforma, se ETIQUETA.

describe("Formas degeneradas: nada las convierte en un número", () => {
  test("Simplificar conserva la forma escrita si la reducción cambia el DOMINIO", () => {
    igual(simplificarEcuaciones(["\\frac{0}{0}"])[0], "(0)/(0)", "0/0 NO se reduce a 0");
    igual(simplificarEcuaciones(["\\frac{0}{0}", "y=x"])[1], "y = x", "lo sano se sigue simplificando");
    igual(simplificarEcuaciones(["x^2+2x+1"])[0], "x ^ 2 + 2 * x + 1", "lo equivalente pasa el guardián");
    // El guardián muestrea las VARIABLES libres: el nombre de una función (`log`, `sqrt`) NO lo es
    // —si entra en el scope lo sombrea con un número y toda la expresión da NaN—.
    igual(simplificarEcuaciones(["\\ln(e^{3x})"])[0], "3 * x", "log(e^{3x}) → 3x (log no es una variable)");
  });

  test("obs-derivate: una función sin valores reales no tiene derivada", () => {
    igual(derivarExpr("\\frac{0}{0}"), null, "d/dx(0/0) no es 0: no hay nada que derivar");
    igual(derivadaLatex(["\\frac{0}{0}"]), "f'\\left(x\\right) = \\text{[...]}", "el panel no inventa la derivada");
    assert(derivarExpr("x^2") !== null, "lo derivable sigue derivándose");
  });

  test("obs-integral: el integrando debe ser una FUNCIÓN, y su fallo va al velo", () => {
    // Una ecuación (curva implícita) no se integra: se rechaza en la extracción, ANTES del parser.
    igual(extraerIntegral("\\int_{0}^{1}(x^2+y^2-1)^3=x^2y^3"), null, "integrando con `=` → no es integral");
    igual(extraerIntegral("\\int_{0}^{1}x+y\\,dx"), null, "integrando con `y` libre → tampoco");
    assert(extraerIntegral("\\int_{0}^{1}x^2\\,dx") !== null, "el integrando función sí se acepta");
    // TODA etiqueta va al PLANO (`etiquetaIntegral`), y el panel se queda SIN valor (null) y sin
    // etiqueta: solo la fórmula. Nivel 1 (no hay curva) y Nivel 2 (no hay número) salen por la
    // misma puerta, con el nombre correcto de cada uno.
    igual(etiquetaIntegral("\\int_{0}^{1}\\frac{0}{0}\\,dx")?.etiqueta, "Indeterminada",
      "0/0: no es 'Fuera de dominio' (eso habla del número); no hay curva");
    igual(cuerpoAreaLatexExacto("\\int_{0}^{1}\\frac{0}{0}\\,dx").cuerpo, null, "y el panel no la repite");
    igual(etiquetaIntegral("\\int_{-1}^{1}\\sqrt{x}\\,dx")?.etiqueta, "Fuera de dominio",
      "√x en [−1,1]: la curva existe, el área no");
    igual(cuerpoAreaLatexExacto("\\int_{-1}^{1}\\sqrt{x}\\,dx").cuerpo, null, "el panel se queda con la fórmula");
    igual(etiquetaIntegral("\\int_{-\\infty}^{\\infty}x^2\\,dx")?.etiqueta, "Límites no numéricos",
      "límites infinitos: la impropia no se evalúa, y se dice en el plano");
    igual(etiquetaIntegral("\\int_{0}^{2}x^2\\,dx"), null, "una integral con valor no tiene etiqueta");
  });
});

// ── Autoencuadre: la vista inicial se acerca a la curva ACOTADA, y solo a ella ─────────
describe("Autoencuadre: acercar la vista a la curva pequeña, nunca alejarla", () => {
  const rama = (pts: number[]): Rama => ({
    puntos: new Float64Array(pts), cerrada: false, calidad: "exacta", objetoId: "o",
  });
  // Vista por defecto: domY [-7,7] y domX derivada del aspecto (celdas 1:1).
  const vpDefecto = crearViewport([-12.8, 12.8], [-7, 7], 768, 420, 1);

  test("la mantisa del semirrango se redondea HACIA ARRIBA por la tabla fina", () => {
    igual(cuantizarSemirrango(1.29), 1.5, "1.29 → 1.5 (con la tabla gruesa saltaba a 2)");
    igual(cuantizarSemirrango(2.2), 2.5, "2.2 → 2.5");
    igual(cuantizarSemirrango(0.31), 0.4, "0.31 → 0.4 (misma tabla, otra década)");
    igual(cuantizarSemirrango(1), 1, "un valor ya redondo no se toca");
  });

  test("curva acotada y pequeña (corazón): se encuadra dejando aire", () => {
    // Caja del corazón (x²+y²−1)³=x²y³: ~[-1.2,1.2] × [-1.4,1.2].
    const corazon = [rama([-1.2, 0, 0, 1.2, 1.2, 0, 0, -1.4, -1.2, 0])];
    const semi = semiYAutoencuadre(corazon, vpDefecto);
    igual(semi, 2.5, "1.4 de alto sobre una ocupación del 60% → 2.33, cuantizado a 2.5");
    assert((semi as number) * 0.6 >= 1.4, "la curva no llena el cuadro: le sobra plano alrededor");
  });

  test("la curva que TOCA un borde puede continuar fuera: no se encuadra", () => {
    // Una recta cruza la vista de lado a lado: el trazado llega a los bordes de domX.
    const recta = [rama([-12.8, -12.8, 12.8, 12.8])];
    igual(semiYAutoencuadre(recta, vpDefecto), null, "recta → sin encuadre");
    // Y una curva acotada pero MUY alta: sale por arriba aunque su x sea pequeña.
    const alta = [rama([-1, -7, 0, 0, 1, 7])];
    igual(semiYAutoencuadre(alta, vpDefecto), null, "toca el borde superior → sin encuadre");
  });

  test("si la curva ya llena la vista no sobra espacio: no se encuadra", () => {
    const grande = [rama([-5, -5, 0, 0, 5, 5])];
    igual(semiYAutoencuadre(grande, vpDefecto), null, "ocupa ~el 90% del alto → se deja como está");
  });

  test("una curva ANCHA y plana (lemniscata) la gobierna la X, no la Y", () => {
    // Lemniscata: |x|≤√2, |y|≤~0.35. Con celdas 1:1 el semiY debe cubrir semiX = semiY·ancho/alto.
    const lemniscata = [rama([-1.414, 0, -0.7, 0.35, 0, 0, 0.7, -0.35, 1.414, 0])];
    const semi = semiYAutoencuadre(lemniscata, vpDefecto);
    igual(semi, 1.5, "manda la X: 1.414·(420/768)/0.6 = 1.29 → cuantizado a 1.5");
    // El encuadre no la deja PEGADA a los bordes laterales (era el síntoma: la curva tocaba los
    // dos lados del plano). Con la ocupación máxima del 60%, sobra al menos un tercio a lo ancho.
    const semiX = (semi as number) * (768 / 420);
    assert(1.414 / semiX < 0.7, "la curva ocupa menos del 70% del semiancho: respira");
  });

  test("sin geometría, o degenerada a un punto, no se encuadra", () => {
    igual(semiYAutoencuadre([], vpDefecto), null, "sin ramas");
    igual(semiYAutoencuadre([rama([2, 3, 2, 3])], vpDefecto), null, "un punto no tiene tamaño");
  });
});

resumen();
