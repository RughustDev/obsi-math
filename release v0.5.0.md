# Obsi Math v0.5.0 — obs-system: engine for non-linear and implicit equations

`obs-system` evolves from a linear-systems block into an engine capable of solving and plotting non-linear and implicit equations. This is a closed, complete version within this approach (marching squares); it has known limitations, documented below, and it is not intended to be the final renderer for implicit curves.

> **Known limitations of this version:** marching squares, the technique used for implicit curves, can deform the curve or produce artifacts when zooming out (details below). For this and other reasons, work is underway on a new graphics engine, developed in a separate repository — it is not part of this version and is not available yet.

> **Note on this documentation:** this version was the result of an extensive refactor, and part of the documentation was reconstructed from the development history. While care was taken to have this reflect the actual state of the project, some minor details may differ from the final implementation. If you find a discrepancy, please report it via an issue.

---

## Major architecture refactor

- **Before**: a single monolithic `main.ts` (~2818 lines), with both engines (`obs-graph` and `obs-system`) implemented as inline callbacks inside `onload()`.
- **Now**: `src/` structured into modules by responsibility — `constantes.ts`, `parser.ts`, `latex.ts`, `sistemas-latex.ts`, `algebra-lineal.ts`, `analisis.ts`, `degeneradas.ts`, `webgl.ts`, `evaluador.ts` (shared between engines), `solver/` (parsing and solving of general equations), `render/` (marching squares and the shared 1D sampler), and `engines/obs-graph` / `engines/obs-system` (each engine as its own class, with WebGL lifecycle managed via `MarkdownRenderChild`). `main.ts` is now reduced to a pure coordinator (~37 lines).
- Migration verified to introduce no behavior changes at each step (bundle diff before/after, clean `tsc --noEmit`).

## Added

- **First capabilities to solve and visualize non-linear equations**: `obs-system` no longer assumes linear systems only; it now has a path to plot implicit and transcendental equations, reusing the same parser/evaluator as `obs-graph`.
- **Implicit curve renderer** based on adaptive marching squares (quadtree), with vertices projected onto the curve and constant stroke width. **Known limitation**: when zooming out, the curve (implicit or explicit, within `obs-system`) can deform, produce artifacts, or even disappear from the visible domain in certain ranges — this is a structural limitation of marching squares, not a one-off bug, and it's the main motivation behind the new graphics engine (future work, separate repository).
- **Initial handling of asymptotes in implicit curves**: pole cases (e.g. `tan x + y² = 2` inside a system such as `{tan x + y² = 2 ; y = 0}`) are routed to a specific treatment to avoid spurious vertical strokes over the asymptote; this may not cover every discontinuity case.
- **Rail mode**: lets you select an equation and travel along it with the keyboard (A/D to move, W/S to zoom), with the camera following the point. Known limitation: vertical lines or vertical tangents cannot be traversed by x.
- **Own crosshair**: custom cursor inside the plane, with coordinate labels and classification of undefined values/asymptotes via one-sided limits.
- **Numerical intersections**: for systems of exactly two equations in two variables, intersections are estimated via Newton-Raphson and marked on the plane. Finding every root in every case is not guaranteed (it depends on the initial seed).
- Explicit curves (`y = f(x)`) inside `obs-system` now reuse the same 1D sampler as `obs-graph`.

**Known limitation**: `obs-system` still requires a minimum of 2 equations per block (`Error: at least 2 equations are required`); it is not possible to plot a single implicit equation on its own. For that, `obs-graph` is still needed (when the equation is solvable for `y`), or a second equation must be added to the system.

## Improved

- **Unified LaTeX pipeline** between `obs-graph` and `obs-system`: removed `obs-system`'s own regex-based path, which in some cases produced a different rendered LaTeX than `obs-graph` for the same well-formed input expression (e.g. `sin(x^2)` or `\sin{x^{2}}`). **Syntax note**: ambiguous input without parentheses or braces, such as `sin x²` typed literally like that, is not reliably parsed and can produce "Indeterminate"; to plot correctly, use standard notation (`sin(x^2)`) or explicit LaTeX (`\sin{x^2}`, `\sin{x^{2}}`).
- **Improved stability while panning**: the marching squares grid is now anchored to fixed world coordinates, reducing the relative shift of the curve when panning the view sideways. This does not cover zooming out — see the known limitation above.
- **Improved subdivision detection in oscillatory curves**: the quadtree now uses the actual gradient instead of a low-resolution probe, improving detection of regions that need more detail (e.g. `sin(x²)`, `sin(xy)`).
- Curve stroke width in `obs-system` is now constant with zoom, matching `obs-graph`.

## Fixed

- Spurious vertical strokes over asymptotes in implicit curves with poles (e.g. `tan x + y² = 2` as part of a system).
- Implicit curves changing shape while panning, due to the sampling grid's position being dependent on the viewport.
- Implicit curve vertices offset from the real curve in high-curvature regions.
- LaTeX rendering discrepancies between `obs-graph` and `obs-system` for the same input expression.

---

## Technical notes

- New shared module `src/render/muestreoExplicito.ts` (1D sampler ported from `obs-graph`).
- New classifier `despejarRamas` in the `obs-system` solver, routing between the 1D sampler (explicit curves, or curves solvable for `y`) and marching squares (genuinely implicit curves).
- No behavior changes in `obs-graph`.

**This version closes out the development cycle for `obs-system` built on marching squares. Obsi Math's development continues on a new graphics engine, built from scratch in a separate repository, aimed at addressing the structural limitations described above (deformation and artifacts when zooming out, among others). That new engine is not part of this version and is not available yet; it will be announced separately once ready.**