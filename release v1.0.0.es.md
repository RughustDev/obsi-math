# Obsi Math v1.0.0

Obsi Math grafica funciones, sistemas, derivadas e integrales dentro de bloques de código de Obsidian: a la izquierda la fórmula en LaTeX, a la derecha un plano cartesiano interactivo.

La v0.5.0 terminaba con una promesa: *"el desarrollo continúa en un motor gráfico nuevo, construido desde cero, que busca resolver las limitaciones estructurales descritas arriba"*. **Ese motor ya está aquí, y es lo que ejecuta el plugin.**

> **Qué significa "1.0.0":** no que el proyecto esté terminado ni libre de errores, sino que el **enfoque** es definitivo. La v0.5.0 cerraba una técnica que sabíamos agotada; esta es la primera versión construida sobre una arquitectura en la que el trabajo futuro *suma* en lugar de chocar. **Tiene bugs y quedan casos sin cubrir:** buena parte de lo que hoy funciona se arregló *después* de verlo fallar en un bloque real. Si encuentras un fallo, un issue con el bloque exacto que lo reproduce vale su peso en oro.

---

## ✨ Highlights

- **Motor gráfico nuevo.** Marching squares queda retirado —y con él la deformación, los artefactos y la desaparición de curvas al alejar el zoom—. El motor no muestrea la curva sobre una rejilla ligada a los píxeles: la **descubre** y la **camina** por longitud de arco. Una curva acotada (el corazón `(x²+y²−1)³=x²y³`, la astroide, la lemniscata) se mantiene entera, sin parpadeo, a cualquier escala.
- **Dos bloques nuevos.** El plugin pasa de dos a **cuatro**: se suman ` ```obs-derivate ` (derivada simbólica) y ` ```obs-integral ` (integral definida, con área sombreada y primitiva).
- **`obs-graph` acepta cualquier curva:** explícitas `y=f(x)`, **implícitas** `F(x,y)=0`, **paramétricas** `(x(t), y(t))` y **polares** `r(θ)`. Ya no hace falta inventarse un sistema de dos ecuaciones para dibujar una implícita suelta.
- **El plugin no dibuja basura, y no afirma en el panel lo que no puede sostener en el plano.** Toda transformación pasa por un guardián numérico; todo diagnóstico se muestra sobre el plano, no en la fórmula.
- **Obsidian no se congela.** Todo el trazado y el álgebra van acotados por presupuestos deterministas: un bloque no puede colgar el hilo principal y dejar una nota irrecuperable.

---

## 📈 Graph Engine

### Los cuatro bloques

| Bloque | Qué hace |
|---|---|
| ` ```obs-graph ` | Una función o curva: explícita, implícita, paramétrica o polar. |
| ` ```obs-system ` | Varias ecuaciones (una por línea o `\begin{cases}…\end{cases}`), cada una con su color, más las **soluciones del sistema**. |
| ` ```obs-derivate ` | Deriva `f(x)` simbólicamente y grafica **solo la derivada**. |
| ` ```obs-integral ` | Integral definida `\int_{0}^{2} x^{2}\,dx`: grafica el integrando y **sombrea la región**. |

### Trazado

Cada tipo de curva elige su estrategia, pero todas producen lo mismo —una lista de ramas en coordenadas de mundo— y comparten render, análisis e interacción. El lema: **"no se nota la estrategia"**.

| Estrategia | Para qué |
|---|---|
| **Sampler 1D adaptativo** | `y = f(x)`: densidad ligada a los píxeles, corte limpio en polos y en los saltos finitos de las funciones escalón. |
| **Continuación predictor-corrector** | Implícitas genéricas: camina la curva por longitud de arco; traza tangentes verticales sin artefactos. |
| **Descubrimiento por rejilla + refinado adaptativo (quadtree)** | "¿Dónde está la curva?": semillas por cambio de signo, con subdivisión de las celdas más cercanas a la curva —lo que impide que una figura pequeña se pierda al alejar el zoom—. |
| **Trazador paramétrico en `t`** | Paramétricas y polares, con el **período real** de la curva polar (`sin(θ/10)` traza sus 20π, no un `[0,2π]` a ciegas). |
| **Rutas separables** | Implícitas que *sí* se despejan: separables con polos (`tan x + y² = 2`), trigonométricas periódicas (infinitas ramas en O(1)) y monomios recíprocos/absolutos (`1/|x| + 1/|y| = 1`). |

### Sistemas

Las **soluciones** se calculan geométricamente entre las ramas trazadas (rejilla espacial), no por siembra de Newton: aparecen todas las que hay en la vista. Detecta además el solape colineal (infinitas soluciones) y satura con un tope honesto en vez de mentir.

### Integral definida

El plano grafica el integrando y sombrea la región entre los límites: **relleno con signo** (frío sobre el eje, cálido bajo), **tramado diagonal anclado al mundo** (acompaña al pan en vez de deslizarse sobre la región) y **bordes verticales** en `a` y `b`.

### Interacción

- **Crosshair matemático** que sigue la curva, con etiquetas de coordenadas.
- **Modo carril (⌖)**: recorre la curva con el teclado, reparametrizado por **longitud de arco en pantalla**, no por `x`. Avanza a ritmo uniforme en tramos casi verticales, nunca se descarrila, salta los huecos del dominio y cabalga las tangentes verticales.
- **Carril de inercia en asíntotas**: al llegar a una asíntota vertical, el carril **cruza a la rama vecina** (`tan x`, `sec x`, `1/x²`) con un reenganche de cámara que evita la sensación de teletransporte. Cuando no hay rama vecina porque el dominio termina (`arccot(x²)/(2√x)`), el punto **escapa** subiendo por la asíntota mientras la cámara ancla su viaje: ir y volver son inversos exactos.
- **Botón ⓘ**: análisis de la función (raíces —incluidas las que son **intervalos**: `⌊x⌋` da `x∈[0,1)`, no cincuenta raíces sueltas—, vértices, corte con Y) o resumen geométrico de la vista para curvas no explícitas.
- **Rejilla con celdas cuadradas** y escala isótropa; pan, zoom con rueda y teclado.

---

## 🧮 Algebra Engine

### Entrada

Los cuatro bloques comparten parser. Se entiende la notación matemática **tal como se escribe**:

- **Símbolos**: `±` y `∓` (con sus **dos ramas reales**: `y = ±√(4−x²)` es la circunferencia entera), `\times`, `\div`, `\cdot`, `\infty`, grados (`30°`; y en las seis trig directas el argumento **numérico puro** se lee en grados: `\sin{5}` es `\sin(\frac{5\pi}{180})`, también como fracción `\sin(\frac{45}{2})` = 22.5°), `\lvert…\rvert`, `\operatorname{}`, `\mathrm{}`, `\text{}`, espaciados y el **menos tipográfico `−` (U+2212)** que se cuela al copiar de Word o Wikipedia.
- **Unicode**: `√ ∛ ∜`, superíndices completos (`x⁴`, `x⁻¹`), fracciones vulgares (`½`), `π`, `θ` (`r=sin(3θ)`), `∞`, `⌊x⌋`, `⌈x⌉`.
- **Funciones**: trigonométricas e inversas (incluidas `arccot`, `arcsec`, `arccsc`), hiperbólicas, logaritmos en cualquier base, **escalón** (piso y techo), potencias de función (`\tan^2(x)` ≠ `\tan(x^2)`) y función con argumento sin agrupar (`\ln x`, `\cos x`, `\log_2 x`), también con coeficiente numérico (`\cos 5t`, `\sin 3\theta`, `\sin 2\pi x`).
- **Paramétricas por componentes**: `x(t)=5\cos t-\cos 5t` y `y(t)=5\sin t-\sin 5t` en **líneas separadas** —como se escriben en un libro o en Desmos— son **una sola curva** (también vale el par ordenado `(X, Y)` de siempre). Y una componente **sola** también se grafica, respetando lo que declara: `y(t)=…` da la gráfica clásica (parámetro en el eje horizontal) y `x(t)=…` sale **tumbada** —su valor es la abscisa, así que el parámetro sube por el eje vertical—. Una expresión suelta en `t` se grafica igualmente, declarada `y(t)=…`; el panel nunca dice `f(x)=…` de una fórmula sin `x`.
- **Y lo que no se entiende, se DICE.** Un comando desconocido (`\alpha`, `\ge`, `\sum`) ya no se degrada a símbolos libres que evalúan `NaN` y dejan el plano vacío sin explicación: el bloque muestra **"Símbolo no soportado: `\alpha`"**.

### Simplificar

Automático e incondicional en todos los bloques. La salida se ordena en **grado descendente**, pone las constantes con nombre delante (`x²π` → `πx²`), combina semejantes, recupera fracciones exactas de los coeficientes decimales (`0.5x` → `x/2`) y aplana las fracciones anidadas eligiendo la forma de **menor coste léxico**. Reduce además `ln(e^u) → u`.

El coeficiente numérico va **siempre delante de la letra, a cualquier profundidad del árbol** —también dentro del argumento de una función—: `r=\sin(3.5θ)` se muestra `\sin\left(\frac{7\theta}{2}\right)`, no `\frac{\theta7}{2}` (que se lee como un subíndice).

### Despejar `y`

Alcance de manual, opcional o desde el menú: aditivo, multiplicativo, potencias (par → las **dos** ramas con `±`), raíces, valor absoluto, coeficiente lineal, **raíz impar** (que libera la `y` atrapada bajo una potencia: el corazón) y **cuadrática general y bicuadrática** en `y`, por completar cuadrados o por la fórmula del libro.

La reducción por raíz impar no depende de **cómo esté escrita** la ecuación: la potencia se busca también como *término* de una suma, así que el corazón despeja igual escrito `(x²+y²−1)³=x²y³`, `(x²+y²−1)³−x²y³=0` o como expresión suelta. La misma curva, el mismo resultado.

Cada rama despejada se **valida numéricamente sustituyéndola en la ecuación original del usuario**: si no la cumple, se descarta. El despeje no puede mentir por construcción.

### Derivar

Deriva con mathjs y **simplifica de verdad**: entre varias formas equivalentes se adopta la de menor coste (menos fracciones anidadas, luego más corta), y siempre bajo un guardián numérico que exige mismos valores **y mismo dominio**. Deriva también funciones escalón (`⌊x⌋`, `⌈x⌉`), que mathjs no soporta, con la política "derivada donde existe", y a través del doble signo (`d/dx(±u) = ±u′`). Las constantes irracionales se conservan simbólicas: `d/dx 3^x` es `3^x·\ln 3`, no `1.0986·3^x`.

### Integrar

mathjs no integra: solo deriva. La primitiva la calcula un **integrador simbólico propio** que cubre el repertorio de un libro de cálculo —linealidad, potencia, `1/x`, exponenciales, trigonométricas, arcotangente y **sustitución lineal** `∫f(ax+b)dx`— y se muestra en forma de Barrow `\left[F(x)\right]_a^b = valor`.

Toda primitiva candidata se **deriva numéricamente y debe reproducir el integrando**: una primitiva incorrecta es peor que ninguna. El **valor exacto** se reconoce de `F(b)−F(a)` por fracciones continuas (`\frac{8}{3}`, `\frac{\pi}{2}`, `\ln 3`, `\sqrt 2`); si es irracional sin forma cerrada, `\approx` honesto. Fuera del alcance del integrador, el panel cae a la cuadratura de Simpson adaptativa.

### Nada puede fabricar un valor

`simplify` y `derivative` de mathjs son álgebra formal: reducen `0/0` a `0`. Un **guardián de fidelidad** —mismos valores y misma no-finitud sobre una muestra— rechaza cualquier forma que no coincida con lo escrito. Si la función no toma ningún valor real, el panel **no la transforma: la etiqueta**.

Y cuando **no hay número que dar** —integral divergente (`∫₋₁¹ dx/x`), límites no numéricos (`∫₋∞^∞`), hueco del dominio dentro de `[a,b]` (`∫₋₁¹ √x dx`)— nunca se inventa uno: el `0` que daría Barrow aplicado a ciegas sobre `1/x` no aparece en ninguna parte.

---

## 🎨 Interfaz

- **Panel unificado: "una expresión = una tarjeta".** Cada fórmula vive en su propia caja enmarcada, con su scroll y sus fades independientes; una sola queda centrada en el eje del panel, y las vistas dobles se reparten la altura.
- **Vistas dobles** en `obs-derivate` (operador · derivada · **ambas**) y en `obs-integral` (operador · primitiva · **ambas**), con la fórmula superior desplazable sin mover la inferior.
- **Botones con glifos matemáticos** renderizados en KaTeX (`f(x)`, `\frac{d}{dx}(f(x))`, `[F(x)]ₐᵇ`), nunca texto; el nombre en palabras queda como `title` accesible. Una opción se deshabilita sola si no cambiaría lo mostrado.
- **Cada familia declara su dependencia en el panel**: `f(x)=…` en las explícitas, **`(x(t), y(t)) = (…, …)`** en las paramétricas y **`r(θ)=…`** en las polares —que ya no se muestran con una `r` suelta, indistinguible de una implícita en una variable llamada `r`—.
- **Pestaña de ajustes**, con las preferencias aplicadas en vivo:
  - *Transformaciones* → **despejar `y` automáticamente** (muestra el resultado despejado al renderizar y oculta el botón).
  - *Plano* → **mostrar puntos notables**: interruptor global de los **marcadores** (raíces, vértices, cortes con Y y las soluciones de los sistemas). Apagado, el plano queda limpio para las notas donde solo importa la forma de la curva. Es una preferencia de **render**: el análisis se sigue haciendo —el ⓘ los lista igual— y ni el crosshair ni el modo carril se ven afectados.
  - *Plano* → **encuadre automático**: acerca la vista inicial a la curva acotada cuando el bloque arranca vacío, para que la figura entre completa sin tocar la cámara a mano.
- **Las etiquetas viven en el plano, no en el panel.** Todo diagnóstico —*Indeterminada*, *Indefinida*, *No definida en ℝ*, *Símbolo no soportado*, *Sin función*, *Sistema incompleto*, *Integrando no válido*, *Integral divergente*, *Límites no numéricos*, *Fuera de dominio*— se muestra sobre el plano cartesiano. El panel LaTeX es la **fórmula**, nunca el veredicto.
- **Tipografía propia: Lora** ([SIL Open Font License 1.1](https://openfontlicense.org)), registrada por el plugin y usada en los textos del panel (etiquetas, botones, resumen ⓘ) junto al LaTeX que renderiza KaTeX.

---

## ⚡ Performance

- **Ninguna fórmula puede colgar el hilo principal.** Todo el trazado va acotado por presupuesto (evaluaciones, pasos, componentes, memoria) y todos los topes son **deterministas** —no dependen del reloj—, así que la geometría es reproducible y la caché estable. Al agotarse un presupuesto se degrada de forma honesta: menos ramas, nunca una congelación.
- **Cuarentena de `rationalize`**, la única operación capaz de colgar Obsidian: se estima el coste de la expansión *antes* de ejecutarla y, por encima del presupuesto, no se expande. La fórmula se muestra sin desarrollar y la curva se grafica igual de bien.
- **Semillas proyectadas sobre la curva** antes de trazar. Una semilla nace de interpolar `F` linealmente sobre una arista, y donde `F` es muy alineal cae lejos de la curva real: no se reconocía como "ya trazada" y se re-trazaba su rama entera. Medido en `y=tan(x)`: de **108 componentes a 17**, y de **600k evaluaciones a 102k**.
- **Rejillas espaciales** en `marcarVisitadas` y `eliminarDuplicados`, antes O(semillas × puntos) — una sola pasada llegó a tardar 245 s.
- **El refinado del descubrimiento solo actúa cuando hace falta**: con la curva ya bien resuelta por la rejilla base, refinar era quemar ~6000 evaluaciones por frame.
- **Floor/ceil rápidas** en el scope del evaluador (12–16× más baratas por llamada) y detección de asíntotas con máximo estricto: sus mesetas disparaban 82k evaluaciones por frame (~1 s de lag).
- **Render progresivo en dos pasadas**: una interactiva y barata durante el gesto, otra final y precisa al soltar.

Resultado del barrido de zoom (7 curvas × 149 zooms × 3 lienzos × 2 pasadas):

| | Antes | Después |
|---|---|---|
| Evaluaciones de `F` por pasada (mediana) | 14 457 | **7 186** |
| ms por pasada (mediana / p99) | 21 / 92 | **8 / 35** |
| Zooms con curva incompleta | 0 | **0** |

---

## 🧪 Testing

- **296 pruebas** automáticas de lógica pura (sin DOM ni Canvas), repartidas en **dos suites por coste**: `npm run test` (288, ~14 s) es la validación de cada cambio, y `npm run test:zoom` (8, ~70 s) aísla el barrido de escalas, que por sí solo se llevaba el 80% del reloj. El ciclo corto es lo que hace que la validación se ejecute de verdad.
- El runner **cronometra cada grupo** e imprime su tiempo si pasa de 0,5 s: ese número decide en qué suite vive un bloque nuevo.
- **Banco de estrés permanente** (corazón, `x⁻¹`, lemniscata, astroide, `(x+1)^12`): recorre el pipeline completo del host y exige que termine, con geometría acotada. Toda familia nueva de curva difícil se añade ahí.
- **Metodología del barrido de zoom**, aprendida a base de dejar pasar el bug: la métrica es la **longitud trazada**, no el número de ramas (la misma curva sale partida en 2 o en 4 polilíneas con dibujo idéntico), y el barrido es **continuo**, porque los fallos viven en bandas de zoom estrechas que un muestreo grueso se salta.
- **Herramienta de desarrollo**: un trazador del pipeline (`node herramientas/.trazar.cjs obs-integral "\int_0^2 x^2\,dx"`) que muestra, paso a paso, qué se parsea, qué se transforma, qué LaTeX se pinta y qué string grafica el motor. También disponible como global de consola dentro de Obsidian.

---

## 🛠 Internal Improvements

El motor está construido en **anillos** (Clean Architecture), con las dependencias apuntando siempre hacia adentro:

- **Ring 0 — contratos.** Tipos puros, cero lógica: `Rama`, `Viewport`, `Tolerancia`, `ObjetoMatematico`, y la costura universal:

  ```ts
  interface ProveedorGeometria {
    geometria(viewport: Viewport, tolerancia: Tolerancia): Geometria;
  }
  ```

- **Ring 1 — algoritmos.** Escena, proveedores, descubrimiento, trazadores, análisis. Solo conocen contratos.
- **Ring 2 — adaptadores.** Parsing y evaluación (única cuarentena de mathjs), render (única cuarentena de Canvas), interacción (DOM).
- **Ring 3 — drivers.** El host de Obsidian (única cuarentena de su API) y el *composition root*: el único archivo que conoce implementaciones concretas.

Consecuencia práctica: **añadir un tipo de objeto matemático, o cambiar un algoritmo de trazado, es editar un archivo y registrarlo en un sitio.** El "GraphEngine de siempre" no es más que un `ProveedorExplicito`, un proveedor entre iguales. Eso es lo que hizo posible que `obs-derivate` y `obs-integral` sean bloques nuevos y no reescrituras.

Otras piezas transversales:

- **Un único pipeline tipográfico** para toda fórmula mostrada, el mismo que grafica el motor. Despejar y Simplificar producen strings re-parseables y **encadenables**: cada transformación se aplica sobre el resultado de la anterior.
- **La interacción y el análisis leen de la `Rama`, no de la fórmula** (crosshair, carril, puntos notables, intersecciones): son agnósticos de la estrategia.

---

## 🐛 Bug Fixes

- **Las curvas acotadas se mutilaban y parpadeaban al alejar el zoom.** Tres causas encadenadas en el refinado del descubrimiento (descenso por un único camino, inanición de la cola de prioridad y el marcado de "celda ya cubierta"). Hasta el 49% de la astroide perdida, y la lemniscata al 0%.
- **El corazón `(x²+y²−1)³=x²y³` congelaba Obsidian** y dejaba la nota irrecuperable: `rationalize` expandía 27 monomios y no terminaba nunca.
- **Congelamiento con el carril sobre una derivada explosiva** (`e^{x²+1}`): con el centro de la vista en ~1e16 el paso de los ticks caía bajo el ULP y el bucle acumulado no avanzaba.
- **Lag de ~1 s por frame** al graficar `floor`/`ceil`, y lag perceptible al hacer zoom por re-trazado de la misma rama.
- **Las formas degeneradas se convertían en un número**: `f(x)=0/0` mostraba `f(x) = 0` en el panel mientras el plano salía velado con "Indeterminada", y `obs-derivate` llegaba a graficar la recta `y=0` sin ningún aviso.
- **Falso "Indeterminada" al escribir el operador `\frac{d}{dx}` a mano**, y al usar producto implícito ante paréntesis (`\pi(2x+4)`).
- **`√x` se parseaba como `sqrt*x`**; los superíndices Unicode (`x⁴`, `x⁻¹`) y las fracciones vulgares no se reconocían.
- **`\pi·x` se pegaba como `\pix`** (comando inexistente → KaTeX en rojo), y `\ln 3` se pegaba al número siguiente al derivar exponenciales.
- **El carril no aparecía si `x=0` no estaba en la curva** (`1/x`, dominio `x>0`), y se clavaba en los vértices sintéticos con que el trazador cierra una rama al topar con un polo.
- **El panel ⓘ recortaba las raíces por tramos** al rango de análisis (`⌊1/x⌋` daba `x∈(1,10]` en vez de `x∈(1,∞)`) y sembraba una fila de marcadores sobre la meseta de `⌊x⌋`.
- **`obs-integral` se corrompía en el trazador** y se rompía con los caracteres invisibles del copiar-pegar (ancho cero, espacios exóticos).
- **Simplificar empeoraba fracciones legibles** y el LaTeX fusionaba `x` con la función siguiente (`x\sin x` → `\mathrm{xsin}(x)`).
- **La misma curva se comportaba distinto según cómo se escribiera**: el corazón despejaba `y` con `=` pero no como expresión suelta (`(x²+y²−1)³−x²y³`), donde la potencia impar es un término de una suma y no un lado de la ecuación.
- **El coeficiente salía detrás de la letra** al simplificar dentro de una función: `r=\sin(3.5θ)` daba `\frac{\theta7}{2}`, que se lee como `θ₇`.
- **`\cos 5t` se leía como `cos(5°)·t`**: el coeficiente de un argumento sin agrupar se arrancaba como argumento entero y se pasaba a grados — la paramétrica `x(t)=5\cos t-\cos 5t` dibujaba otra curva, y `r=\sin 3\theta` (rosa de 3 pétalos) salía como una recta. Y la `θ` **Unicode** no se traducía (`r=sin(3θ)` → plano vacío, sin explicación).

---

## ⚠️ Limitaciones conocidas

> **Esta versión tiene errores.** La superficie es grande (cuatro bloques, un parser que acepta LaTeX y Unicode, álgebra simbólica, un motor geométrico y una interacción con cámara) y buena parte se ha endurecido *reaccionando* a fallos vistos en bloques reales, no anticipándolos. Los diagnósticos honestos (las etiquetas) están precisamente para que un fallo se note en lugar de disfrazarse.

- **`obs-system` sigue exigiendo 2 ecuaciones o más** (una sola → "Sistema incompleto"). Para una curva suelta —incluida una implícita— está `obs-graph`.
- **No se grafican regiones ni inecuaciones** (`y ≥ x`): se detectan y se etiquetan como no soportadas.
- **El integrador simbólico tiene alcance de libro de texto**: un producto con dos factores dependientes de `x`, un argumento no afín o una integral sin primitiva elemental no dan `F`; el panel cae al valor numérico. La integral **impropia** (límites en `±∞`) no se evalúa: se etiqueta.
- **Las curvas implícitas sin ruta explícita** se trazan *best-effort certificado*: con presupuesto agotado, el motor prefiere dibujar de menos a inventar.
- **Las 288 pruebas rápidas no son una garantía**: cubren lógica pura (parser, álgebra, geometría, análisis), no el DOM ni el Canvas. Todo lo visual —paneles, botones, cámara, sombreado— se valida a mano, así que ahí es donde más fácil se cuela una regresión.
- El **motor antiguo** (WebGL, marching squares) sigue en el código como red de seguridad tras un flag (`MOTOR_EXPERIMENTAL` en `main.ts`), desactivado. Se eliminará.

---

## 📦 Notas técnicas

- **Stack**: TypeScript sin framework, `mathjs` (evaluación y derivación), **Canvas 2D**, build con `esbuild`.
- **Estructura**: `src/motor/**` (contratos, escena, proveedores, descubrimiento, trazadores, análisis, render, interacción, composition root) + `src/host-obsidian/` (adaptador de Obsidian) + `src/` raíz reutilizada (parser, evaluador, LaTeX, despejar, simplificar, derivar, integrar, análisis, degeneradas).
- El motor nuevo **no reescribe el parser ni el evaluador**: los reutiliza, para reconocer exactamente las mismas funciones y la misma tipografía que el motor anterior.
- Todo el código, los identificadores, los comentarios y la documentación están **en español**.

---

**La v0.5.0 cerró un enfoque. La v1.0.0 abre uno: cuatro bloques sobre una arquitectura donde cada objeto matemático nuevo es un proveedor más, y donde lo que el panel afirma no puede contradecir lo que el plano dibuja. Queda mucho por pulir —y por arreglar—, pero ya sobre cimientos que aguantan el peso.**
