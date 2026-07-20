// ─────────────────────────────────────────────
// host-obsidian · Ajustes del plugin (pestaña de configuración)
// ─────────────────────────────────────────────
//
// Cuarentena Obsidian: la ÚNICA pieza (con MotorExperimental y fuentes) que toca la API
// de Obsidian para la interfaz de configuración. Define las preferencias persistentes, sus
// valores por defecto y la pestaña oficial (PluginSettingTab) que aparece junto al
// interruptor del plugin en Ajustes → Complementos de la comunidad → LMath.
//
// Las preferencias las carga/guarda el plugin (loadData/saveData); esta pieza solo pinta la
// UI y escribe en el objeto de ajustes. El motor las CONSUME vía un getter (ver
// MotorExperimental): así un cambio en la pestaña se refleja en los bloques que se
// re-rendericen, sin recargar el plugin.

import {
  App,
  PluginSettingTab,
  Setting,
  type Plugin,
  type SettingDefinitionItem,
} from "obsidian";

import { IDIOMA_POR_DEFECTO, fijarIdioma, t, type Idioma } from "../i18n";

/** Preferencias persistentes del plugin. (La simplificación es SIEMPRE automática e
 *  incondicional, no es un ajuste: ver `baseAutomatica` en MotorExperimental.) */
export interface AjustesTransformaciones {
  /** Al renderizar, mostrar directamente el resultado DESPEJADO (y=f(x)); oculta el botón. */
  despejarAuto: boolean;
  /** ¿Pintar los MARCADORES de puntos notables (raíces, vértices, cortes Y) y las
   *  intersecciones del sistema? Preferencia de RENDER: el análisis se sigue haciendo (el ⓘ
   *  los lista igual) y el crosshair/carril —lectura interactiva, no marcadores— no cambian. */
  puntosNotables: boolean;
  /** ¿Acercar la vista inicial a las curvas ACOTADAS que dejan mucho plano vacío? (autoencuadre) */
  encuadreAuto: boolean;
  /** Idioma de la INTERFAZ del plugin ("en"|"es"). No es una transformación; se guarda en
   *  este mismo objeto porque comparte la maquinaria de persistencia (loadData/saveData). El
   *  idioma ACTIVO lo lleva el módulo i18n (`fijarIdioma`); esta clave es su copia persistida. */
  idioma: Idioma;
}

/** Valores por defecto (no despejar automáticamente; simplificar SIEMPRE se aplica;
 *  los puntos notables se pintan, que es el comportamiento histórico del plugin; el idioma
 *  por defecto es inglés, ver i18n.IDIOMA_POR_DEFECTO). */
export const AJUSTES_POR_DEFECTO: AjustesTransformaciones = {
  despejarAuto: false,
  puntosNotables: true,
  encuadreAuto: true,
  idioma: IDIOMA_POR_DEFECTO,
};

/**
 * El plugin visto por la pestaña: un `Plugin` de Obsidian con el objeto de ajustes en
 * memoria y un método para persistirlos. Evita acoplar este módulo a la clase concreta
 * del plugin (main.ts) —solo depende de este contrato—.
 */
export interface PluginConAjustes extends Plugin {
  ajustes: AjustesTransformaciones;
  guardarAjustes(): Promise<void>;
}

/**
 * Pestaña de configuración oficial (API PluginSettingTab). Secciones idioma /
 * transformaciones / plano; cada cambio escribe en `plugin.ajustes` y persiste con
 * `plugin.guardarAjustes()` (loadData/saveData por debajo).
 *
 * Se declara DOS veces la misma pestaña, según la versión de Obsidian:
 *  - `getSettingDefinitions()` (API declarativa, Obsidian ≥1.13): la fuente en 1.13+.
 *    Obsidian pinta la pestaña a partir de estas definiciones e indexa sus ajustes en el
 *    buscador de configuración; lee/escribe vía `getControlValue`/`setControlValue`.
 *  - `display()` (imperativo, deprecado en 1.13 pero necesario como FALLBACK para
 *    Obsidian 1.5.0–1.12.x, que no conoce la API declarativa). En 1.13+ NO se llama
 *    (getSettingDefinitions devuelve una lista no vacía). Mantener ambas mientras
 *    `minAppVersion` sea <1.13.0.
 *
 * Las dos vías deben quedar equivalentes: cualquier ajuste que se añada aquí hay que
 * reflejarlo en las dos.
 */
export class PestanaAjustesLMath extends PluginSettingTab {
  constructor(app: App, private readonly plugin: PluginConAjustes) {
    super(app, plugin);
  }

  /**
   * Definición declarativa de la pestaña (Obsidian ≥1.13). Espeja `display()`: mismas
   * secciones y controles. Los `key` son las propias claves de `AjustesTransformaciones`,
   * que `getControlValue`/`setControlValue` resuelven contra `plugin.ajustes`.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const txt = t();
    return [
      // Idioma PRIMERO: cambiarlo repinta la pestaña (via update()) en el nuevo idioma.
      {
        type: "group",
        heading: txt.ajustes.idioma.seccion,
        items: [
          {
            name: txt.ajustes.idioma.nombre,
            desc: txt.ajustes.idioma.desc,
            control: {
              type: "dropdown",
              key: "idioma",
              options: {
                en: txt.ajustes.idioma.opcionEn,
                es: txt.ajustes.idioma.opcionEs,
              },
            },
          },
        ],
      },
      {
        type: "group",
        heading: txt.ajustes.transformaciones,
        items: [
          {
            name: txt.ajustes.despejarAuto.etiqueta,
            desc: txt.ajustes.despejarAuto.detalle,
            control: { type: "toggle", key: "despejarAuto" },
          },
        ],
      },
      {
        type: "group",
        heading: txt.ajustes.plano,
        items: [
          {
            name: txt.ajustes.puntosNotables.etiqueta,
            desc: txt.ajustes.puntosNotables.detalle,
            control: { type: "toggle", key: "puntosNotables" },
          },
          {
            name: txt.ajustes.encuadreAuto.etiqueta,
            desc: txt.ajustes.encuadreAuto.detalle,
            control: { type: "toggle", key: "encuadreAuto" },
          },
        ],
      },
    ];
  }

  /** Lee el valor actual de un control declarativo desde `plugin.ajustes` (API ≥1.13). */
  getControlValue(key: string): unknown {
    switch (key) {
      case "idioma":
        return this.plugin.ajustes.idioma;
      case "despejarAuto":
        return this.plugin.ajustes.despejarAuto;
      case "puntosNotables":
        return this.plugin.ajustes.puntosNotables;
      case "encuadreAuto":
        return this.plugin.ajustes.encuadreAuto;
      default:
        return undefined;
    }
  }

  /**
   * Persiste el cambio de un control declarativo (API ≥1.13). Espeja los `onChange` de
   * `display()`: escribe en `plugin.ajustes` y guarda. Para el idioma, además fija el
   * idioma activo.
   *
   * (No se repinta la pestaña al vuelo al cambiar de idioma: `update()`/`refreshDomState()`
   * son API de 1.13.0 y `minAppVersion` es 1.12.7, así que referenciarlas sería
   * `no-unsupported-api`. En 1.13+ las etiquetas se muestran en el idioma nuevo al reabrir
   * Ajustes; el motor declarativo controla el ciclo de render. El fallback `display()` sí
   * repinta en el acto, que es donde ocurre en la versión soportada hoy.)
   */
  async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key) {
      case "idioma": {
        const idioma: Idioma = value === "es" ? "es" : "en";
        this.plugin.ajustes.idioma = idioma;
        fijarIdioma(idioma);
        await this.plugin.guardarAjustes();
        return;
      }
      case "despejarAuto":
        this.plugin.ajustes.despejarAuto = value === true;
        break;
      case "puntosNotables":
        this.plugin.ajustes.puntosNotables = value === true;
        break;
      case "encuadreAuto":
        this.plugin.ajustes.encuadreAuto = value === true;
        break;
      default:
        return;
    }
    await this.plugin.guardarAjustes();
  }

  /**
   * Fallback imperativo para Obsidian 1.5.0–1.12.x (deprecado en 1.13; en 1.13+ NO se
   * llama, se usa `getSettingDefinitions()`). Mantener espejado con la vía declarativa.
   */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const txt = t();

    // Idioma PRIMERO: cambiarlo re-renderiza esta misma pestaña en el nuevo idioma.
    new Setting(containerEl).setName(txt.ajustes.idioma.seccion).setHeading();

    new Setting(containerEl)
      .setName(txt.ajustes.idioma.nombre)
      .setDesc(txt.ajustes.idioma.desc)
      .addDropdown((d) =>
        d
          .addOption("en", txt.ajustes.idioma.opcionEn)
          .addOption("es", txt.ajustes.idioma.opcionEs)
          .setValue(this.plugin.ajustes.idioma)
          .onChange(async (v) => {
            this.plugin.ajustes.idioma = v as Idioma;
            fijarIdioma(v);
            await this.plugin.guardarAjustes();
            this.display(); // repinta la pestaña con los textos del nuevo idioma
          })
      );

    new Setting(containerEl).setName(txt.ajustes.transformaciones).setHeading();

    new Setting(containerEl)
      .setName(txt.ajustes.despejarAuto.etiqueta)
      .setDesc(txt.ajustes.despejarAuto.detalle)
      .addToggle((tg) =>
        tg.setValue(this.plugin.ajustes.despejarAuto).onChange(async (v) => {
          this.plugin.ajustes.despejarAuto = v;
          await this.plugin.guardarAjustes();
        })
      );

    new Setting(containerEl).setName(txt.ajustes.plano).setHeading();

    new Setting(containerEl)
      .setName(txt.ajustes.puntosNotables.etiqueta)
      .setDesc(txt.ajustes.puntosNotables.detalle)
      .addToggle((tg) =>
        tg.setValue(this.plugin.ajustes.puntosNotables).onChange(async (v) => {
          this.plugin.ajustes.puntosNotables = v;
          await this.plugin.guardarAjustes();
        })
      );

    new Setting(containerEl)
      .setName(txt.ajustes.encuadreAuto.etiqueta)
      .setDesc(txt.ajustes.encuadreAuto.detalle)
      .addToggle((tg) =>
        tg.setValue(this.plugin.ajustes.encuadreAuto).onChange(async (v) => {
          this.plugin.ajustes.encuadreAuto = v;
          await this.plugin.guardarAjustes();
        })
      );
  }
}
