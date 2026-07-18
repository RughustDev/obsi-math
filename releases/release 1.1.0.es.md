# 1.1.0

## Novedades

- Selector de idioma en los ajustes (inglés / español; inglés por defecto).
- La tipografía **Lora** ya viene incluida en el plugin: no hace falta distribuir archivos adicionales.
- Se añadió un **Technical Reference** con documentación completa de la arquitectura y el motor para desarrolladores.

## Despejar y — nuevos casos resueltos

- Ecuaciones trigonométricas con soluciones periódicas, por ejemplo `tan(y)+x=2`,
  ahora se resuelven como la familia completa (`y = arctan(2−x) + kπ, k∈ℤ`).
- Ecuaciones con `cos(y)` repartido en varios términos (`cos(x+y)`, `cos(2y)`...) ahora pueden despejarse.
- `y²` atrapada dentro de una fracción simplificada ahora se aísla completamente.
- Ecuaciones con raíces de potencias de `y` (por ejemplo el astroide `x^(2/3)+y^(2/3)=1`)
  ahora se despejan por completo.
- Valor absoluto de `y` bajo una raíz o con exponente fraccionario
  (`√|y|`, `|y|^(1/2)`) ahora se aísla correctamente elevando (`y = ±(…)²`),
  en lugar de tratar `abs` como una variable suelta.

## Gráficas más robustas

- Las curvas implícitas ya no muestran líneas rectas falsas ni se fragmentan al alejar mucho el zoom.
- Los patrones periódicos densos (redes de lazos repetidas) ahora se dibujan completos en lugar de cortarse.
- La detección de polos (asíntotas) es mucho más consistente en cualquier nivel de zoom.
- Mejor representación de curvas de alta frecuencia y campos periódicos.
- Curvas suaves con oscilaciones de gran amplitud (como `e^x(cos x - sin x)`) ya no se confunden con asíntotas y se renderizan como una única curva continua.

## Correcciones

- El parser ahora acepta expresiones como `tan{x}` (sin backslash) y exponentes vacíos como `x^{}`.
- El panel de derivadas muestra correctamente el operador en expresiones como `cos(x)·e^x`.
- La tarjeta de LaTeX ahora aumenta su altura automáticamente para fórmulas grandes y añade desplazamiento vertical cuando es necesario.
- El cursor (*crosshair*) ya no aparece sobre curvas con varios valores de `y` para un mismo `x` (como círculos o astroides), evitando lecturas ambiguas.

## Interno

- Ampliación de la cobertura de pruebas automatizadas.
- Mejoras de rendimiento y estabilidad en el motor experimental.
- Refactorización y limpieza general del código.

## Nota

Esta versión no está libre de errores ni bugs. Es un proyecto en desarrollo activo:
pueden quedar casos sin resolver o comportamientos inesperados. Si encuentras alguno,
por favor repórtalo.