# obsi-math

Plugin de [Obsidian](https://obsidian.md) para graficar funciones matemáticas directamente en tus notas, usando bloques de código `obs-graph`. Renderiza la expresión en LaTeX, dibuja la gráfica con un motor WebGL + Canvas 2D (estilo Desmos), y calcula automáticamente raíces, vértices e intersecciones.

![Vista general del plugin: LaTeX + gráfica de 1/(x-2) con asíntota vertical](assets/images/demo-asymptote.png)

---

## Características

- 📈 Graficado en tiempo real con motor WebGL (curvas) + Canvas 2D (ejes, grid, etiquetas).
- ✏️ Renderizado LaTeX de la expresión ingresada, incluyendo exponentes anidados y raíces de cualquier índice.
- 🔍 Zoom y pan interactivos con el mouse, con detección precisa de la posición del cursor.
- 📍 Detección automática de raíces, vértices (máximos/mínimos) e intersección Y.
- ⚡ Asíntotas verticales detectadas y dibujadas como líneas punteadas, con comportamiento correcto al hacer zoom out.
- 🎨 Estética tipo Desmos: grid sutil, ejes discretos, márgenes y centrado correctos, sin deformación al redimensionar.
- 🔤 Entrada en LaTeX, Unicode (`π`, `√`, `×`, `÷`, `²`, `³`) y notación matemática estándar.

---

## Instalación

### Manual

1. Descarga `main.js` y `manifest.json` desde la última release.
2. Crea la carpeta `obsi-math` dentro de `<tu-vault>/.obsidian/plugins/`.
3. Copia ahí los archivos.
4. En Obsidian: **Configuración → Plugins de la comunidad** → activa **Obsi Math**.

### Desde código fuente

````bash
git clone https://github.com/RughustDev/obsi-math.git
cd obsi-math
npm install
npm run build
````

Copia el `main.js` generado (junto con `manifest.json`) a la carpeta de plugins de tu vault.

---

## Uso

Crea un bloque de código con el lenguaje `obs-graph` y escribe tu función:

````markdown
```obs-graph
x^2 - 4
```
````

También puedes escribir la igualdad completa; el plugin toma el lado derecho automáticamente:

````markdown
```obs-graph
f(x) = sin(x) * 2
```
````

El bloque renderiza la expresión en LaTeX, la gráfica interactiva, y datos calculados: intersección Y, raíces reales y vértices.

**Más ejemplos:**

````markdown
```obs-graph
1/(x-2)
```
````

````markdown
```obs-graph
sqrt(x) + 1
```
````

````markdown
```obs-graph
\sqrt[3]{x}
```
````

````markdown
```obs-graph
x^{3^{2}}
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
| LaTeX | `\frac{1}{2}`, `x^{2}`, `\sqrt{x}`, `\sqrt[3]{x}`, `\sin{x}`, `\log_{2}{x}` |
| Estándar | `sin(x)`, `cos(x)`, `log(x, 2)`, `sqrt(x)` |

**Trigonometría:** un argumento numérico literal (ej. `sin(30)`) se interpreta en **grados**. Si contiene una variable (ej. `sin(x)`), se evalúa en radianes.

**Raíces de cualquier índice:** se soporta la notación `\sqrt[n]{x}` para raíces cúbicas, cuárticas, quintas, etc. Las raíces de índice impar con radicando negativo devuelven el valor real (ej. `\sqrt[3]{-8} = -2`).

![Raíz cúbica de x graficada, mostrando la rama negativa](assets/images/demo-cbrt.png)

**Números complejos:** no hay soporte. Si la función produce un resultado imaginario (ej. `sqrt(-1)`), el plano aparecerá vacío.

---

## Problemas conocidos

- ~~**Renderizado LaTeX de `\sqrt`, `\log`, etc. sin llaves**~~ — corregido. El renderizador ya maneja correctamente comandos como `\sqrt{x}` sin producir salidas rotas como `\sqrtx`.
- ~~**Paréntesis extra en exponentes anidados**~~ — corregido. Expresiones como `x^{3^{2}}` ahora se renderizan y evalúan correctamente, sin paréntesis redundantes visibles en el LaTeX.
- ~~**Desfase del cursor al hacer zoom**~~ — corregido. El punto detectado por el zoom ahora corresponde exactamente a la posición del cursor en pantalla.
- ~~**Asíntota falsa en funciones tipo `x^{2^{π}}`**~~ — corregido. Al desplazar el eje X fuera del viewport, el detector de polos interpretaba erróneamente el cruce como una discontinuidad y dibujaba una línea fantasma sobre el eje Y. Ya no ocurre.
- El comportamiento visual de funciones con asíntotas densas (como `sec(10x)`) al hacer zoom out extremo es inherente a la naturaleza periódica de esas funciones; se ha mejorado notablemente pero no desaparece por completo.

![tan(x) con asíntotas verticales correctamente detectadas y dibujadas](assets/images/demo-tan.png)

---

## obs-system (deshabilitado temporalmente)

El plugin incluye un bloque `obs-system` para resolver y graficar sistemas de ecuaciones lineales, pero **está deshabilitado por ahora**: al usarlo solo se muestra un aviso.

Motivo: es una función muy básica todavía, con lag notable al hacer zoom o pan (arrastrar la vista). El desarrollo está actualmente enfocado en pulir `obs-graph`, así que `obs-system` se retomará y mejorará más adelante.

Para reactivarlo durante desarrollo, en `main.ts`:

````typescript
private readonly OBS_SISTEMA_HABILITADO = false; // → true
````

---

## Desarrollo

Requisitos: Node.js, npm, TypeScript.

````bash
npm run build
````

Flujo recomendado: editar `main.ts` → compilar → copiar `main.js` a un vault de pruebas → verificar → respaldar si funciona, restaurar si falla.

> **Importante:** tanto `manifest.json` como `main.ts` deben guardarse en **UTF-8 sin BOM**. Un BOM al inicio de cualquiera de estos archivos puede romper el parseo en Obsidian o producir errores silenciosos en la compilación.

---

## Hoja de ruta

- [ ] Reactivar y pulir `obs-system` (rendimiento de zoom/pan).
- [ ] Panel de información integrado en la gráfica.
- [ ] Configuración global (precisión decimal, tema).
- [ ] Selector de unidades trigonométricas (grados/radianes/gradianes).
- [ ] Soporte de entrada LaTeX enriquecida.

---

## Licencia

MIT — ver [LICENSE](./LICENSE).

## Repositorio

[github.com/RughustDev/obsi-math](https://github.com/RughustDev/obsi-math)