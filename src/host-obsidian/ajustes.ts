// ─────────────────────────────────────────────
// host-obsidian · Ajustes del plugin (pestaña de configuración)
// ─────────────────────────────────────────────
//
// Cuarentena Obsidian: la ÚNICA pieza (con MotorExperimental y fuentes) que toca la API
// de Obsidian para la interfaz de configuración. Define las preferencias persistentes, sus
// valores por defecto y la pestaña oficial (PluginSettingTab) que aparece junto al
// interruptor del plugin en Ajustes → Complementos de la comunidad → Obsi Math.
//
// Las preferencias las carga/guarda el plugin (loadData/saveData); esta pieza solo pinta la
// UI y escribe en el objeto de ajustes. El motor las CONSUME vía un getter (ver
// MotorExperimental): así un cambio en la pestaña se refleja en los bloques que se
// re-rendericen, sin recargar el plugin.

import { App, PluginSettingTab, Setting, type Plugin } from "obsidian";

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
}

/** Valores por defecto (no despejar automáticamente; simplificar SIEMPRE se aplica;
 *  los puntos notables se pintan, que es el comportamiento histórico del plugin). */
export const AJUSTES_POR_DEFECTO: AjustesTransformaciones = {
  despejarAuto: false,
  puntosNotables: true,
  encuadreAuto: true,
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
export class PestanaAjustesObsiMath extends PluginSettingTab {
  constructor(app: App, private readonly plugin: PluginConAjustes) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Transformaciones").setHeading();

    new Setting(containerEl)
      .setName("Despejar automáticamente")
      .setDesc(
        "Al renderizar una ecuación, muestra directamente el resultado despejado " +
        "(y = f(x)) sin pulsar «Despejar». El botón «Despejar» se oculta del panel."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.ajustes.despejarAuto).onChange(async (v) => {
          this.plugin.ajustes.despejarAuto = v;
          await this.plugin.guardarAjustes();
        })
      );

    new Setting(containerEl).setName("Plano").setHeading();

    new Setting(containerEl)
      .setName("Mostrar puntos notables")
      .setDesc(
        "Pinta en el plano los marcadores de raíces, vértices, cortes con Y y las " +
        "soluciones (cruces) de los sistemas. Al desactivarlo el plano queda limpio: " +
        "el resumen ⓘ los sigue listando, y el crosshair y el modo carril no cambian. " +
        "Se aplica al volver a renderizar el bloque."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.ajustes.puntosNotables).onChange(async (v) => {
          this.plugin.ajustes.puntosNotables = v;
          await this.plugin.guardarAjustes();
        })
      );

    new Setting(containerEl)
      .setName("Encuadre automático")
      .setDesc(
        "Acerca la vista inicial cuando la curva es acotada y deja mucho plano vacío " +
        "(corazón, lemniscata, astroide…). Solo acerca, nunca aleja: si la curva llega al " +
        "borde de la vista se deja el encuadre de siempre. La vista queda centrada en el " +
        "origen y es a la que vuelve la tecla de restaurar. Se aplica al volver a renderizar el bloque."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.ajustes.encuadreAuto).onChange(async (v) => {
          this.plugin.ajustes.encuadreAuto = v;
          await this.plugin.guardarAjustes();
        })
      );
  }
}
