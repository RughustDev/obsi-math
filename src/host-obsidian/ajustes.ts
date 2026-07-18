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

import { App, PluginSettingTab, Setting, type Plugin } from "obsidian";

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
 * Pestaña de configuración oficial (API PluginSettingTab). Sección "Transformaciones"
 * con el interruptor de despeje automático (la simplificación es siempre automática, no
 * se configura); el cambio escribe en `plugin.ajustes` y persiste con
 * `plugin.guardarAjustes()` (loadData/saveData por debajo).
 */
export class PestanaAjustesLMath extends PluginSettingTab {
  constructor(app: App, private readonly plugin: PluginConAjustes) {
    super(app, plugin);
  }

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
