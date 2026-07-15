# Obsi Math

🇬🇧 [English](./README.en.md)

Obsi Math es un plugin de [Obsidian](https://obsidian.md) para graficar funciones, sistemas de ecuaciones, derivadas e integrales directamente en tus notas: cada bloque muestra a la izquierda la fórmula renderizada en LaTeX (KaTeX) y a la derecha un plano cartesiano interactivo (pan, zoom, crosshair, modo carril).

---

## Contenido

- [Bloques disponibles](#bloques-disponibles)
- [Características](#características)
- [Portada](#portada)
- [Galería](#galería)
- [Instalación](#instalación)
- [Uso](#uso)
- [Sintaxis de entrada](#sintaxis-de-entrada)
- [Ajustes](#ajustes)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Desarrollo](#desarrollo)
- [Licencia](#licencia)

---

## Bloques disponibles

| Bloque | Qué grafica |
|---|---|
| ` ```obs-graph ` | Una función o curva: explícita `y=f(x)`, implícita `F(x,y)=0`, paramétrica `(x(t), y(t))` o polar `r(θ)`. |
| ` ```obs-system ` | Varias ecuaciones (una por línea, o LaTeX `\begin{cases}…\end{cases}`), cada una con su color, más las **soluciones del sistema** (cruces entre curvas). |
| ` ```obs-derivate ` | Deriva `f(x)` simbólicamente y grafica **solo la derivada** `f'(x)`. |
| ` ```obs-integral ` | Integral definida `\int_a^b f\,dx`: grafica el integrando, **sombrea la región** entre `a` y `b` y muestra el área con signo (y la primitiva, cuando el integrador propio la cubre). |

## Características

- Motor gráfico propio: descubre y traza la curva por longitud de arco (no muestrea sobre una rejilla ligada a los píxeles), por lo que curvas acotadas (corazón, astroide, lemniscata) no se deforman ni desaparecen al alejar el zoom.
- Renderizado LaTeX de la expresión ingresada, incluyendo exponentes anidados, raíces de cualquier índice y paramétricas/polares con su propia notación.
- Zoom y pan interactivos con el mouse y el teclado.
- Crosshair interactivo: sigue el cursor y muestra `x` y `f(x)` en tiempo real, con marcador sobre la curva.
- Modo carril (⌖): recorre la curva con el teclado por longitud de arco en pantalla; en asíntotas verticales salta a la rama vecina en vez de descarrilarse.
- Detección automática de raíces, vértices e intersección Y, visualizados como marcadores sobre el plano; funciones con infinitos puntos notables (periódicas) muestran un resumen mediante el botón ⓘ.
- Asíntotas verticales detectadas y dibujadas como líneas punteadas.
- Clasificación de bloques no graficables (*No definida en ℝ*, *Indefinida*, *Indeterminada*, *Símbolo no soportado*, etc.) con overlay informativo sobre el plano; el panel LaTeX nunca muestra un veredicto, solo la fórmula.
- Entrada en LaTeX, Unicode (`π`, `√`, `×`, `÷`, `²`, `³`, `θ`, `∞`) y notación matemática estándar.
- Soporte para valor absoluto (`|x|`, `\left|…\right|`, `abs(x)`), las seis funciones trigonométricas inversas y funciones escalón (`⌊x⌋`, `⌈x⌉`).
- Simplificación automática de toda expresión mostrada, y despeje de `y` manual u opcionalmente automático (ver [Ajustes](#ajustes)).

---

## Portada

<figure>
	<img src="assets/images/demo-heart.png" alt="Obsi Math trazando una curva implícita con forma de corazón sobre un plano cartesiano">
	<figcaption><strong>Portada.</strong> Curva implícita con forma de corazón trazada sobre un plano cartesiano, con la fórmula renderizada en el panel lateral.</figcaption>
</figure>

---

## Galería

### Graficación básica

<figure>
	<img src="assets/images/demo-explicit.png" alt="Obsi Math graficando una función explícita con la fórmula renderizada y la curva en el plano">
	<figcaption><strong>Función explícita.</strong> Función explícita renderizada en el panel y trazada en el plano con ejes y marcadores interactivos.</figcaption>
</figure>

### Sistemas

<figure>
	<img src="assets/images/demo-system.png" alt="Obsi Math resolviendo un sistema de ecuaciones y mostrando sus curvas y cruces en el plano">
	<figcaption><strong>Sistemas de ecuaciones.</strong> Sistema de ecuaciones trazado con curvas de colores distintos y cruces resaltados en el plano.</figcaption>
</figure>

### Derivadas

<figure>
	<img src="assets/images/demo-derivative.png" alt="Obsi Math mostrando la derivada simbólica y su gráfica lineal en vista dividida">
	<figcaption><strong>Derivadas.</strong> Derivada simbólica mostrada en vista dividida, con el operador y el resultado trazados por separado.</figcaption>
</figure>

### Integrales

<figure>
	<img src="assets/images/demo-integral.png" alt="Obsi Math mostrando una integral definida con región sombreada y primitiva evaluada">
	<figcaption><strong>Integrales definidas.</strong> Integral definida con región sombreada, primitiva evaluada y lectura del área en el panel.</figcaption>
</figure>

### Curvas especiales

<figure>
	<img src="assets/images/demo-parametric.png" alt="Obsi Math graficando una curva paramétrica con su ecuación por componentes">
	<figcaption><strong>Paramétricas.</strong> Curva paramétrica trazada a partir de sus componentes, con la notación correspondiente en el panel.</figcaption>
</figure>

<figure>
	<img src="assets/images/demo-polar.png" alt="Obsi Math graficando una curva polar con la notación r de theta en el panel">
	<figcaption><strong>Polares.</strong> Curva polar trazada con la notación <code>r(θ)</code> en el panel y su geometría correspondiente en el plano.</figcaption>
</figure>

---

## Instalación

### Manual

1. Descarga `main.js`, `manifest.json` y `styles.css` desde la última release.
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

Copia el `main.js` generado (junto con `manifest.json` y `styles.css`) a la carpeta de plugins de tu vault.

---

## Uso

### obs-graph

Escribe una función; el plugin toma el lado derecho automáticamente si escribes la igualdad completa.

````markdown
```obs-graph
f(x) = sin(x) * 2
```
````

Implícita, paramétrica y polar:

````markdown
```obs-graph
x^3 + y^3 = 9
```
````

````markdown
```obs-graph
x(t) = 5*cos(t) - cos(5*t)
y(t) = 5*sin(t) - sin(5*t)
```
````

````markdown
```obs-graph
r = sin(3*theta)
```
````

### obs-system

Una ecuación por línea; cada una toma su propio color, y se marcan las soluciones (cruces) entre ellas.

````markdown
```obs-system
y = x + 1
y = -x^2 + 3
```
````

### obs-derivate

Se escribe solo `f(x)`; el bloque deriva y grafica `f'(x)`.

````markdown
```obs-derivate
x^3 - 2*x
```
````

### obs-integral

Entrada en LaTeX con los límites de integración.

````markdown
```obs-integral
\int_{0}^{2} x^2 \, dx
```
````

### Más ejemplos de entrada (obs-graph, obs-derivate, obs-integral)

Asíntota vertical:

````markdown
```obs-graph
1/(x-2)
```
````

Valor absoluto:

````markdown
```obs-graph
|x^2 - 4|
```
````

Función trigonométrica inversa:

````markdown
```obs-graph
arctan(x)
```
````

Raíz de índice arbitrario:

````markdown
```obs-graph
\sqrt[3]{x}
```
````

Exponente anidado (se renderiza y evalúa como `x⁹`):

````markdown
```obs-graph
x^{3^{2}}
```
````

### Interacción con la gráfica

| Acción | Efecto |
|---|---|
| Mover el cursor | Muestra crosshair con `x` y `f(x)` en tiempo real |
| Acercar el cursor a un punto notable | Muestra etiqueta de coordenadas `(x, y)` |
| Arrastrar | Desplaza la vista (pan) |
| Rueda del mouse | Zoom in/out centrado en el cursor |
| Botón ⌖ (modo carril, cuando la curva es recorrible) | Recorre la curva con el teclado, saltando de rama en las asíntotas |
| En `obs-system`, botón de color por ecuación | Elige qué curva sigue el crosshair/carril |

### Funciones con muchos puntos notables

En funciones periódicas como `sin(x)` o `tan(x)`, las raíces y vértices son infinitos y no se dibujan individualmente. En su lugar aparece un botón **ⓘ** en la esquina de la gráfica que muestra un resumen al pulsarlo.

### Funciones no graficables

Si la función no produce ningún valor real (por ejemplo `sqrt(-1)` o `log(x)/log(1)`), el plano aparece oscurecido con una etiqueta que indica la causa: *No definida en ℝ*, *Indefinida*, *Indeterminada*, entre otras. El zoom y pan siguen activos.

Un bloque vacío muestra el mensaje *Sin función* en lugar de un error.

---

## Sintaxis de entrada

El plugin normaliza distintos formatos antes de evaluarlos con [mathjs](https://mathjs.org/). Vale para los cuatro bloques, que comparten parser.

| Tipo | Ejemplos |
|---|---|
| Unicode | `π`, `√`, `∛`, `∜`, `×`, `÷`, `²`, `³`, `θ`, `∞`, `⌊x⌋`, `⌈x⌉` |
| LaTeX | `\frac{1}{2}`, `x^{2}`, `\sqrt{x}`, `\sqrt[3]{x}`, `\sin{x}`, `\log_{2}{x}`, `\left|x\right|`, `\int_a^b f\,dx` |
| Estándar | `sin(x)`, `cos(x)`, `log(x, 2)`, `sqrt(x)`, `abs(x)` |
| Inversas | `arcsin(x)`, `sin⁻¹(x)`, `asin(x)` (y análogas para cos, tan, csc, sec, cot) |

> ⚠️ **Trigonometría (grados vs. radianes):** si el argumento es un número literal (ej. `sin(30)`), se interpreta en **grados**; si el argumento contiene una variable (ej. `sin(x)`), se evalúa en **radianes**.

**Raíces de cualquier índice:** se soporta la notación `\sqrt[n]{x}` para raíces cúbicas, cuárticas, quintas, etc. Las raíces de índice impar con radicando negativo devuelven el valor real (ej. `\sqrt[3]{-8} = -2`).

**Valor absoluto:** se aceptan `|x|`, `\left|x\right|` y `abs(x)`.

**Funciones trigonométricas inversas:** `arccsc`, `arcsec` y `arccot` no son nativas de mathjs; el plugin las implementa como wrappers de dominio real.

**Paramétricas por componentes:** `x(t)=…` y `y(t)=…` en líneas separadas se funden en una sola curva; una componente sola también grafica, respetando el eje que declara (`y(t)=…` da la gráfica clásica, `x(t)=…` sale tumbada).

**Símbolo no reconocido:** un comando LaTeX desconocido (`\alpha`, `\sum`, …) no se degrada en silencio a una variable libre: el bloque muestra **"Símbolo no soportado"**.

**Números complejos:** no hay soporte. Si la función produce un resultado imaginario, el plano mostrará el overlay de función no graficable.

---

## Ajustes

El plugin agrega una pestaña de configuración (**Configuración → Obsi Math**):

- **Despejar automáticamente** — al renderizar, muestra directamente el resultado despejado (`y = f(x)`) sin pulsar el botón «Despejar».
- **Mostrar puntos notables** — pinta en el plano los marcadores de raíces, vértices, cortes con Y y las soluciones de los sistemas. Al desactivarlo el plano queda limpio; el resumen ⓘ los sigue listando, y el crosshair y el modo carril no cambian.
- **Encuadre automático** — ajusta la vista inicial para que la curva acotada entre completa en el plano cuando la nota arranca vacía.

---

## Limitaciones conocidas

> Esta versión ya está en una etapa madura, pero todavía puede contener errores. Si encuentras uno, repórtalo en un issue con el bloque exacto que lo reproduce.

- `obs-system` exige dos ecuaciones o más; para una curva suelta (incluida una implícita) está `obs-graph`.
- No se grafican regiones ni inecuaciones (`y ≥ x`): se detectan y se etiquetan como no soportadas.
- El integrador simbólico tiene alcance de libro de texto: cuando no encuentra primitiva, el panel cae al valor numérico. Las integrales impropias (límites en `±∞`) se etiquetan, no se evalúan.
- El crosshair y el modo carril siguen una sola curva a la vez y requieren que sea recorrible como `y=f(x)`.
- El comportamiento visual de funciones con asíntotas densas (como `sec(10x)`) al hacer zoom out extremo es inherente a la naturaleza periódica de esas funciones.

---

## Desarrollo

Requisitos: Node.js, npm, TypeScript.

```bash
npm run build       # compila main.ts → main.js (esbuild)
npm run test        # suite rápida de pruebas de lógica pura
npm run test:zoom   # suite de barrido de zoom (más lenta, aislada aparte)
```

Flujo recomendado: editar el código → `npm run build` → copiar `main.js` a un vault de pruebas → verificar → respaldar si funciona, restaurar si falla.

> **Importante:** tanto `manifest.json` como los archivos `.ts` deben guardarse en **UTF-8 sin BOM**. Un BOM al inicio de cualquiera de estos archivos puede romper el parseo en Obsidian o producir errores silenciosos en la compilación.

---

## Licencia

MIT — ver [LICENSE](./LICENSE).

## Repositorio

[github.com/RughustDev/obsi-math](https://github.com/RughustDev/obsi-math)
