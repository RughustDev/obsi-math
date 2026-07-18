# 1.1.0

🇪🇸 [Release en español](./release%201.1.0.es.md)

## New Features

- Added a language selector in **Settings** (English / Español, with English as the default).
- The **Lora** font is now bundled directly with the plugin—no additional files are required.
- Added a comprehensive **Technical Reference** documenting the architecture and rendering engine for developers.

## Solve for y — New Supported Cases

- Trigonometric equations with periodic solutions, such as `tan(y)+x=2`,
  are now solved as complete solution families (`y = arctan(2−x) + kπ, k∈ℤ`).
- Equations where `cos(y)` appears across multiple terms (`cos(x+y)`, `cos(2y)`, ...) can now be solved symbolically.
- `y²` trapped inside simplified fractions can now be isolated correctly.
- Equations involving roots of powers of `y` (such as the astroid `x^(2/3)+y^(2/3)=1`)
  are now solved completely.
- Absolute values of `y` under a radical or with a fractional exponent
  (`√|y|`, `|y|^(1/2)`) are now isolated correctly by squaring both sides
  (`y = ±(…)²`), instead of treating `abs` as an independent variable.

## More Robust Graphing

- Implicit curves no longer produce false straight lines or fragment when zooming far out.
- Dense periodic patterns (repeating loop grids) are now rendered completely instead of being cut off.
- Pole (vertical asymptote) detection is now much more consistent across all zoom levels.
- Improved rendering of high-frequency curves and periodic scalar fields.
- Smooth curves with rapidly growing oscillations (such as `e^x(cos x - sin x)`) are no longer mistaken for asymptotes and are rendered as a single continuous curve.

## Fixes

- The parser now accepts expressions such as `tan{x}` (without a backslash) and empty exponents like `x^{}`.
- The derivative panel now renders operators correctly in expressions such as `cos(x)·e^x`.
- LaTeX cards now expand automatically for tall formulas and provide vertical scrolling when necessary.
- The crosshair is no longer displayed on curves that have multiple `y` values for the same `x` (such as circles or astroids), preventing misleading readings.

## Internal

- Expanded automated test coverage.
- Performance and stability improvements throughout the experimental rendering engine.
- General code cleanup and refactoring.

## Note

This release is not free of bugs. LMath is still under active development, and some edge cases or unexpected behaviors may remain. If you encounter any issues, please report them.