// ─────────────────────────────────────────────
// app · Composition root (el ÚNICO lugar que conoce implementaciones concretas)
// ─────────────────────────────────────────────
//
// Arma el grafo de objetos del motor inyectando las implementaciones concretas en
// las costuras. Divide el bloque en ecuaciones (un SISTEMA = varias), clasifica cada
// una y le asigna su proveedor; todos viven tras la MISMA interfaz `ProveedorGeometria`,
// así que la Escena/render/interacción son idénticos. Cambiar un algoritmo (trazador,
// descubridor, render) o añadir un tipo de objeto es editar SOLO este archivo (OCP).

import type {
  Estilo, ObjetoMatematico, ObjetoExplicito, ObjetoImplicito,
  ObjetoParametrico, ObjetoPolar, ProveedorGeometria,
} from "../contracts";
import { TrazadorExplicitoAdaptativo } from "../tracing/explicit/TrazadorExplicitoAdaptativo";
import { TrazadorContinuacion } from "../tracing/continuation/TrazadorContinuacion";
import { TrazadorParametricoAdaptativo } from "../tracing/parametric/TrazadorParametricoAdaptativo";
import { DescubrimientoMuestreado } from "../discovery/sampled/DescubrimientoMuestreado";
import { construirObjeto } from "../parsing/construirObjeto";
import { dividirEcuaciones } from "../parsing/dividirEcuaciones";
import { tieneDobleSigno, expandirDobleSigno } from "../parsing/dobleSigno";
import { normalizarEntrada } from "../../parser";
import { ProveedorExplicito } from "../providers/ProveedorExplicito";
import { ProveedorImplicito } from "../providers/ProveedorImplicito";
import { ProveedorImplicitoSeparable } from "../providers/ProveedorImplicitoSeparable";
import { ProveedorImplicitoPeriodico } from "../providers/ProveedorImplicitoPeriodico";
import { ProveedorParametrico } from "../providers/ProveedorParametrico";
import { ProveedorConCache } from "../providers/ProveedorConCache";
import { ProveedorSinPuntosEje } from "../providers/ProveedorSinPuntosEje";
import { ProveedorUnion } from "../providers/ProveedorUnion";
import { despejarRamas, tienePolos, campoTranspuesto, separarTrigY, ramasMonomioY } from "../analysis/separarImplicita";
import { RendererCanvas2D } from "../rendering/RendererCanvas2D";
import { Overlay } from "../rendering/overlay/Overlay";
import { Crosshair } from "../rendering/Crosshair";
import { Escena, type ObjetoEscena } from "../scene/Escena";

// Paleta por ecuación del sistema (se recicla si hay más ecuaciones que colores). El
// azul/naranja iniciales coinciden con obs-graph/obs-system. Un color = un `Estilo`.
const PALETA: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.31, 0.62, 1.0, 1.0],   // azul
  [1.0, 0.63, 0.20, 1.0],   // naranja
  [0.40, 0.85, 0.45, 1.0],  // verde
  [0.85, 0.45, 0.90, 1.0],  // morado
  [0.95, 0.40, 0.45, 1.0],  // rojo
  [0.35, 0.80, 0.85, 1.0],  // cian
];

/**
 * Elige y construye el proveedor de geometría para UN objeto matemático (el dispatcher
 * de la arquitectura). Cada tipo → su mejor estrategia, todas tras `ProveedorGeometria`:
 *   • explícita      → sampler 1D adaptativo (calidad obs-graph).
 *   • implícita      → si es separable en y CON polos, ramas explícitas (sampler 1D, corta
 *                       limpio a cualquier zoom); si no, continuación predictor-corrector.
 *   • paramétrica/polar → trazador adaptativo en t (polar = paramétrica cartesiana).
 */
export function crearProveedor(objeto: ObjetoMatematico): ProveedorGeometria {
  if (objeto.tipo === "implicita") {
    const F = (objeto as ObjetoImplicito).F;
    // Separable en Y con polos (tan x+y²=2) → ramas y=f(x) con el sampler 1D.
    const ramasY = tienePolos(F) ? despejarRamas(F) : null;
    if (ramasY) {
      return new ProveedorImplicitoSeparable(objeto.id, ramasY, new TrazadorExplicitoAdaptativo(), F);
    }
    // Separable en X con polos (tan y+x=5 ⇒ x=5−tan y) → misma ruta, TRANSPUESTA
    // (se despeja Ft(x,y)=F(y,x) y el proveedor gira el resultado). Etapa 12.
    const Ft = campoTranspuesto(F);
    const ramasX = tienePolos(Ft) ? despejarRamas(Ft) : null;
    if (ramasX) {
      return new ProveedorImplicitoSeparable(objeto.id, ramasX, new TrazadorExplicitoAdaptativo(), Ft, true);
    }
    // Trig periódica en y con coeficiente a(x) (tan(y)·(x²+1)=√(x+1)) → infinitas
    // ramas y = T⁻¹(g(x)) + k·período con el sampler 1D (la continuación las pierde
    // al alejar el zoom). También el caso simétrico en x, girando el resultado.
    const trigY = separarTrigY(F);
    if (trigY) {
      return new ProveedorImplicitoPeriodico(objeto.id, trigY, new TrazadorExplicitoAdaptativo());
    }
    const trigX = separarTrigY(Ft);
    if (trigX) {
      return new ProveedorImplicitoPeriodico(objeto.id, trigX, new TrazadorExplicitoAdaptativo(), true);
    }
    // Afín en un monomio RECÍPROCO/ABSOLUTO de y (1/|x|+1/|y|=1, 1/x+1/y=1, |x|+|y|=1)
    // → ramas explícitas y = M⁻¹(g(x)) con el sampler 1D. El descubrimiento por rejilla
    // las PIERDE al alejar el zoom: la curva se pega a su asíntota y el cambio de signo
    // de F cabe dentro de una celda (además la fila y=0 es un polo y se descarta) → sin
    // semillas, las ramas desaparecen. También el caso simétrico en x, girando el resultado.
    const monY = ramasMonomioY(F);
    if (monY) {
      return new ProveedorImplicitoSeparable(objeto.id, monY, new TrazadorExplicitoAdaptativo(), F);
    }
    const monX = ramasMonomioY(Ft);
    if (monX) {
      return new ProveedorImplicitoSeparable(objeto.id, monX, new TrazadorExplicitoAdaptativo(), Ft, true);
    }
    return new ProveedorImplicito(
      objeto as ObjetoImplicito, new DescubrimientoMuestreado(), new TrazadorContinuacion(),
      new TrazadorExplicitoAdaptativo() // para puntos notables por despeje (invariantes)
    );
  }
  if (objeto.tipo === "parametrica" || objeto.tipo === "polar") {
    return new ProveedorParametrico(objeto as ObjetoParametrico | ObjetoPolar, new TrazadorParametricoAdaptativo());
  }
  return new ProveedorExplicito(objeto as ObjetoExplicito, new TrazadorExplicitoAdaptativo());
}

/**
 * Proveedor de UNA ecuación escrita. Casi siempre es `crearProveedor(construirObjeto(ec))`;
 * la excepción es el DOBLE SIGNO (`y = ±√(4−x²)`), que no es una función sino la familia de
 * dos: se expande en sus dos ecuaciones reales (`parsing/dobleSigno`), cada una recorre el
 * pipeline normal y `ProveedorUnion` las devuelve como UN objeto (mismo id → un color, una
 * curva del selector, sin cruces espurios entre las dos mitades). Sin ± no cambia nada:
 * la ecuación llega a `construirObjeto` tal cual se escribió.
 */
function proveedorDeEcuacion(ec: string, id: string): ProveedorGeometria {
  const ramas = tieneDobleSigno(normalizarEntrada(ec)) ? expandirDobleSigno(normalizarEntrada(ec)) : [ec];
  if (ramas.length === 1) return crearProveedor(construirObjeto(ramas[0], id));
  return new ProveedorUnion(id, ramas.map((e) => crearProveedor(construirObjeto(e, id))));
}

/**
 * Envuelve una ecuación escrita en su objeto de escena (proveedor cacheado + color).
 * `ocultarPuntosEje` (bloque obs-system) descarta los puntos notables sobre los ejes
 * —raíces y corte con Y— antes de cachear; los vértices y los cruces entre curvas se
 * conservan. El filtro va DENTRO de la caché para calcularse una sola vez por vista.
 */
function objetoEscena(ec: string, id: string, indiceColor: number, ocultarPuntosEje = false): ObjetoEscena {
  const base = proveedorDeEcuacion(ec, id);
  const proveedor = new ProveedorConCache(ocultarPuntosEje ? new ProveedorSinPuntosEje(base) : base);
  const estilo: Estilo = {
    color: [...PALETA[indiceColor % PALETA.length]] as [number, number, number, number],
    grosorPx: 2,
  };
  return { proveedor, estilo };
}

/**
 * Divide el bloque en ecuaciones y construye un objeto de escena por cada una (un SISTEMA).
 * PURO (sin Canvas) → testeable. Cada proveedor se envuelve en `ProveedorConCache`.
 */
export function construirObjetosEscena(source: string): ObjetoEscena[] {
  return dividirEcuaciones(source).map((ec, i) => objetoEscena(ec, `eq-${i}`, i, true));
}

function montarEscena(ctx2d: CanvasRenderingContext2D, objetos: readonly ObjetoEscena[]): Escena {
  return new Escena(objetos, new Overlay(ctx2d), new RendererCanvas2D(ctx2d), new Crosshair(ctx2d));
}

/**
 * Motor para el bloque `obs-graph`: UNA función/curva (la 1ª ecuación del bloque). Los
 * SISTEMAS de varias ecuaciones van en `obs-system` → `crearMotorSistema`.
 */
export function crearMotor(ctx2d: CanvasRenderingContext2D, source: string): Escena {
  const ec = dividirEcuaciones(source)[0] ?? "";
  return montarEscena(ctx2d, ec ? [objetoEscena(ec, "obs-graph", 0)] : []);
}

/** Motor para el bloque `obs-system`: un SISTEMA (varias ecuaciones, cada una con su color). */
export function crearMotorSistema(ctx2d: CanvasRenderingContext2D, source: string): Escena {
  return montarEscena(ctx2d, construirObjetosEscena(source));
}
