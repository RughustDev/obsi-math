# obsi-math

Plugin de [Obsidian](https://obsidian.md) para graficar funciones matemáticas directamente en tus notas, usando bloques de código `obs-math`. Renderiza la expresión en LaTeX, dibuja la gráfica con un motor WebGL + Canvas 2D (estilo Desmos), y calcula automáticamente raíces, vértices e intersecciones.

---

## Características

- 📈 Graficado en tiempo real con motor WebGL (curvas) + Canvas 2D (ejes, grid, etiquetas).
- ✏️ Renderizado LaTeX de la expresión ingresada.
- 🔍 Zoom y pan interactivos con el mouse.
- 📍 Detección automática de raíces, vértices (máximos/mínimos) e intersección Y.
- ⚡ Asíntotas verticales detectadas y dibujadas como líneas punteadas.
- 🎨 Estética tipo Desmos: grid sutil, ejes discretos, puntos especiales nítidos en cualquier pantalla.
- 🔤 Entrada en LaTeX, Unicode (`π`, `√`, `×`, `÷`, `²`, `³`) y notación matemática estándar.

---

## Instalación

### Manual

1. Descarga `main.js` y `manifest.json` desde la última release.
2. Crea la carpeta `obsi-math` dentro de `<tu-vault>/.obsidian/plugins/`.
3. Copia ahí los archivos.
4. En Obsidian: **Configuración → Plugins de la comunidad** → activa **Obsi Math**.

### Desde código fuente

```bash
git clone https://github.com/RughustDev/obsi-math.git
cd obsi-math
npm install
npm run build
```

Copia el `main.js` generado (junto con `manifest.json`) a la carpeta de plugins de tu vault.

---

## Uso

Crea un bloque de código con el lenguaje `obs-math` y escribe tu función:

````markdown
```obs-math
x^2 - 4
```
````

También puedes escribir la igualdad completa; el plugin toma el lado derecho automáticamente:

````markdown
```obs-math
f(x) = sin(x) * 2
```
````

El bloque renderiza la expresión en LaTeX, la gráfica interactiva, y datos calculados: intersección Y, raíces reales y vértices.

**Más ejemplos:**

````markdown
```obs-math
1/(x-2)
```
````

````markdown
```obs-math
sqrt(x) + 1
```
````

### Interacción con la gráfica

| Acción | Efecto |
|---|---|
| Arrastrar | Desplaza la vista (pan) |
| Rueda del mouse | Zoom in/out centrado en el cursor |

---

## Sintaxis de entrada

El plugin normaliza distintos formatos antes de evaluarlos con [mathjs](https://mathjs.org/):

| Tipo | Ejemplos |
|---|---|
| Unicode | `π`, `√`, `×`, `÷`, `²`, `³`, `∞` |
| LaTeX | `\frac{1}{2}`, `x^{2}`, `\sqrt{x}`, `\sin{x}`, `\log_{2}{x}` |
| Estándar | `sin(x)`, `cos(x)`, `log(x, 2)`, `sqrt(x)` |

**Trigonometría:** un argumento numérico literal (ej. `sin(30)`) se interpreta en **grados**. Si contiene una variable (ej. `sin(x)`), se evalúa en radianes.

---

## Problemas conocidos

- **Renderizado LaTeX de `\sqrt`, `\log`, etc. sin llaves:** si escribes `\sqrt{x}` sin las llaves (por ejemplo, mal copiado o mal escrito), el LaTeX puede mostrarse roto en pantalla (ej. `\sqrtx`). La gráfica en sí se calcula y dibuja correctamente — el problema es únicamente visual, en el renderizado de la fórmula. Asegúrate de usar siempre las llaves: `\sqrt{x}`, no `\sqrtx`.
- El muestreo adaptativo de curvas (para discontinuidades como `tan(x)`) fue probado pero revertido por generar artefactos visuales; actualmente se usa muestreo de resolución fija/dinámica.

---

## obs-sistema (deshabilitado temporalmente)

El plugin incluye un bloque `obs-sistema` para resolver y graficar sistemas de ecuaciones lineales, pero **está deshabilitado por ahora**: al usarlo solo se muestra un aviso.

Motivo: es una función muy básica todavía, con lag notable al hacer zoom o pan (arrastrar la vista). El desarrollo está actualmente enfocado en pulir `obs-math`, así que `obs-sistema` se retomará y mejorará más adelante.

Para reactivarlo durante desarrollo, en `main.ts`:

```typescript
private readonly OBS_SISTEMA_HABILITADO = false; // → true
```

---

## Desarrollo

Requisitos: Node.js, npm, TypeScript.

```bash
npm run build
```

Flujo recomendado: editar `main.ts` → compilar → copiar `main.js` a un vault de pruebas → verificar → respaldar si funciona, restaurar si falla.

> `manifest.json` debe guardarse en **UTF-8 sin BOM**; un BOM al inicio rompe su parseo en Obsidian.

---

## Hoja de ruta

- [ ] Reactivar y pulir `obs-sistema` (rendimiento de zoom/pan).
- [ ] Panel de información integrado en la gráfica.
- [ ] Configuración global (precisión decimal, tema).
- [ ] Selector de unidades trigonométricas (grados/radianes/gradianes).
- [ ] Soporte de entrada LaTeX enriquecida.

---

## Licencia

MIT — ver [LICENSE](./LICENSE).

## Repositorio

[github.com/RughustDev/obsi-math](https://github.com/RughustDev/obsi-math)