# Obsi Math v1.0.0

🇪🇸 [Release en español](./release%20v1.0.0.es.md)

Obsi Math graphs functions, systems, derivatives, and integrals inside Obsidian code blocks: the LaTeX formula on the left, an interactive Cartesian plane on the right.

v0.5.0 ended with a promise: *"development continues on a new graphics engine, built from scratch, aiming to solve the structural limitations described above."* **That engine is here now, and it's what powers the plugin.**

> **What "1.0.0" means:** not that the project is finished or bug-free, but that the **approach** is final. v0.5.0 closed out a technique we knew was exhausted; this is the first version built on an architecture where future work *adds* instead of *colliding*. **It has bugs, and there are still uncovered cases:** a good chunk of what works today was fixed *after* watching it fail on a real block. If you find a bug, an issue with the exact block that reproduces it is worth its weight in gold.

---

## ✨ Highlights

- **New graphics engine.** Marching squares is retired — and with it, the deformation, the artifacts, and curves vanishing on zoom-out. The engine doesn't sample the curve on a pixel-bound grid: it **discovers** it and **walks** it by arc length. A bounded curve (the heart `(x²+y²−1)³=x²y³`, the astroid, the lemniscate) stays whole, flicker-free, at any scale.
- **Two new blocks.** The plugin goes from two to **four**: adding ` ```obs-derivate ` (symbolic derivative) and ` ```obs-integral ` (definite integral, with shaded area and antiderivative).
- **`obs-graph` now accepts any curve:** explicit `y=f(x)`, **implicit** `F(x,y)=0`, **parametric** `(x(t), y(t))`, and **polar** `r(θ)`. No more need to invent a two-equation system just to draw a standalone implicit curve.
- **The plugin doesn't draw garbage, and won't claim in the panel what it can't back up on the plane.** Every transformation passes through a numerical guardian; every diagnostic is shown on the plane, not in the formula.
- **Obsidian doesn't freeze.** All plotting and algebra are bounded by deterministic budgets: a block can't hang the main thread and leave a note unrecoverable.

---

## 📈 Graph Engine

### The four blocks

| Block | What it does |
|---|---|
| ` ```obs-graph ` | A function or curve: explicit, implicit, parametric, or polar. |
| ` ```obs-system ` | Multiple equations (one per line or `\begin{cases}…\end{cases}`), each with its own color, plus the **system's solutions**. |
| ` ```obs-derivate ` | Symbolically derives `f(x)` and graphs **only the derivative**. |
| ` ```obs-integral ` | Definite integral `\int_{0}^{2} x^{2}\,dx`: graphs the integrand and **shades the region**. |

### Plotting

Each curve type picks its own strategy, but they all produce the same thing — a list of branches in world coordinates — and share rendering, analysis, and interaction. The motto: **"you can't tell which strategy it is."**

| Strategy | Used for |
|---|---|
| **Adaptive 1D sampler** | `y = f(x)`: density tied to pixels, clean cuts at poles and at the finite jumps of step functions. |
| **Predictor-corrector continuation** | Generic implicit curves: walks the curve by arc length; traces vertical tangents without artifacts. |
| **Grid discovery + adaptive refinement (quadtree)** | "Where is the curve?": seeds by sign change, with subdivision of the cells closest to the curve — which keeps a small figure from getting lost on zoom-out. |
| **Parametric tracer in `t`** | Parametric and polar curves, using the polar curve's **actual period** (`sin(θ/10)` traces its full 20π, not a blind `[0,2π]`). |
| **Separable paths** | Implicit curves that *can* actually be isolated: separable with poles (`tan x + y² = 2`), periodic trigonometric curves (infinite branches in O(1)), and reciprocal/absolute-value monomials (`1/|x| + 1/|y| = 1`). |

### Systems

**Solutions** are computed geometrically between the plotted branches (spatial grid), not via Newton seeding: every solution in view shows up. It also detects collinear overlap (infinite solutions) and caps it with an honest limit instead of lying.

### Definite integral

The plane graphs the integrand and shades the region between the limits: **signed fill** (cool above the axis, warm below), **diagonal hatching anchored to the world** (it moves with the shape instead of sliding over the region), and **vertical edges** at `a` and `b`.

### Interaction

- **Mathematical crosshair** that follows the curve, with coordinate labels.
- **Rail mode (⌖)**: travels the curve with the keyboard, reparametrized by **on-screen arc length**, not by `x`. Moves at a uniform pace through near-vertical stretches, never derails, skips domain gaps, and rides vertical tangents.
- **Inertia rail on asymptotes**: on reaching a vertical asymptote, the rail **crosses to the neighboring branch** (`tan x`, `sec x`, `1/x²`) with a camera re-hook that avoids any sense of teleporting. When there's no neighboring branch because the domain ends (`arccot(x²)/(2√x)`), the point **escapes** up the asymptote while the camera anchors its trip: going and coming back are exact inverses.
- **ⓘ button**: function analysis (roots — including ones that are **intervals**: `⌊x⌋` gives `x∈[0,1)`, not fifty loose roots —, vertices, Y-intercept) or a geometric summary of the view for non-explicit curves.
- **Grid with square cells** and isotropic scale; pan, wheel zoom, and keyboard.

---

## 🧮 Algebra Engine

### Input

All four blocks share a parser. It understands mathematical notation **as it's written**:

- **Symbols**: `±` and `∓` (with their **two real branches**: `y = ±√(4−x²)` is the full circle), `\times`, `\div`, `\cdot`, `\infty`, degrees (`30°`; and in the six direct trig functions a **pure numeric** argument is read in degrees: `\sin{5}` is `\sin(\frac{5\pi}{180})`, also as a fraction `\sin(\frac{45}{2})` = 22.5°), `\lvert…\rvert`, `\operatorname{}`, `\mathrm{}`, `\text{}`, spacing, and the **typographic minus `−` (U+2212)** that sneaks in when copying from Word or Wikipedia.
- **Unicode**: `√ ∛ ∜`, full superscripts (`x⁴`, `x⁻¹`), vulgar fractions (`½`), `π`, `θ` (`r=sin(3θ)`), `∞`, `⌊x⌋`, `⌈x⌉`.
- **Functions**: trigonometric and inverse (including `arccot`, `arcsec`, `arccsc`), hyperbolic, logarithms in any base, **step functions** (floor and ceiling), function powers (`\tan^2(x)` ≠ `\tan(x^2)`), and functions with an ungrouped argument (`\ln x`, `\cos x`, `\log_2 x`), also with a numeric coefficient (`\cos 5t`, `\sin 3\theta`, `\sin 2\pi x`).
- **Parametric by component**: `x(t)=5\cos t-\cos 5t` and `y(t)=5\sin t-\sin 5t` on **separate lines** — as they're written in a textbook or in Desmos — are **one single curve** (the classic ordered pair `(X, Y)` also still works). And a **lone** component is also graphed, respecting what it declares: `y(t)=…` gives the classic graph (parameter on the horizontal axis), and `x(t)=…` comes out **on its side** — its value is the abscissa, so the parameter runs up the vertical axis. A bare expression in `t` is graphed the same way, declared as `y(t)=…`; the panel never labels a formula with no `x` as `f(x)=…`.
- **And what isn't understood, gets SAID.** An unknown command (`\alpha`, `\ge`, `\sum`) no longer degrades into free symbols that evaluate to `NaN` and leave the plane blank with no explanation: the block shows **"Unsupported symbol: `\alpha`"**.

### Simplify

Automatic and unconditional across all blocks. The output is sorted in **descending degree**, puts named constants in front (`x²π` → `πx²`), combines like terms, recovers exact fractions from decimal coefficients (`0.5x` → `x/2`), and flattens nested fractions choosing the form with the **lowest lexical cost**. It also reduces `ln(e^u) → u`.

The numeric coefficient always goes **in front of the letter, at any depth in the tree** — even inside a function's argument: `r=\sin(3.5θ)` is shown as `\sin\left(\frac{7\theta}{2}\right)`, not `\frac{\theta7}{2}` (which reads like a subscript).

### Solve for `y`

Textbook-level scope, optional or from the menu: additive, multiplicative, powers (even → **both** branches with `±`), roots, absolute value, linear coefficient, **odd root** (which frees the `y` trapped under a power: the heart) and **general and biquadratic quadratic** in `y`, via completing the square or the textbook formula.

Odd-root reduction doesn't depend on **how the equation is written**: the power is also searched for as a *term* within a sum, so the heart isolates the same way whether written `(x²+y²−1)³=x²y³`, `(x²+y²−1)³−x²y³=0`, or as a standalone expression. Same curve, same result.

Each isolated branch is **numerically validated by substituting it back into the user's original equation**: if it doesn't satisfy it, it's discarded. The solve step can't lie by construction.

### Derive

Derives with mathjs and **truly simplifies**: among several equivalent forms, it adopts the one with lowest cost (fewer nested fractions, then shortest), always under a numerical guardian that requires matching values **and matching domain**. It also derives step functions (`⌊x⌋`, `⌈x⌉`), which mathjs doesn't support, under a "derivative where it exists" policy, and handles the double sign (`d/dx(±u) = ±u′`). Irrational constants are kept symbolic: `d/dx 3^x` is `3^x·\ln 3`, not `1.0986·3^x`.

### Integrate

mathjs doesn't integrate — it only derives. The antiderivative is computed by a **custom symbolic integrator** covering a calculus-textbook repertoire — linearity, power rule, `1/x`, exponentials, trigonometric functions, arctangent, and **linear substitution** `∫f(ax+b)dx` — and is shown in Barrow's-rule form: `\left[F(x)\right]_a^b = value`.

Every candidate antiderivative is **numerically differentiated and must reproduce the integrand**: a wrong antiderivative is worse than none. The **exact value** is recognized from `F(b)−F(a)` via continued fractions (`\frac{8}{3}`, `\frac{\pi}{2}`, `\ln 3`, `\sqrt 2`); if it's irrational with no closed form, an honest `\approx`. Outside the integrator's scope, the panel falls back to adaptive Simpson quadrature.

### Nothing can fabricate a value

mathjs's `simplify` and `derivative` are formal algebra: they reduce `0/0` to `0`. A **fidelity guardian** — matching values and matching non-finiteness over a sample — rejects any form that doesn't match what was written. If the function takes no real value at all, the panel **doesn't transform it: it labels it.**

And when **there's no number to give** — a divergent integral (`∫₋₁¹ dx/x`), non-numeric limits (`∫₋∞^∞`), a domain gap inside `[a,b]` (`∫₋₁¹ √x dx`) — it never invents one: the `0` that a blind application of Barrow's rule to `1/x` would give never shows up anywhere.

---

## 🎨 Interface

- **Unified panel: "one expression = one card."** Each formula lives in its own framed box, with independent scroll and fades; a single one stays centered on the panel's axis, and double views split the height.
- **Double views** in `obs-derivate` (operator · derivative · **both**) and `obs-integral` (operator · antiderivative · **both**), with the upper formula scrollable without moving the lower one.
- **Buttons with math glyphs** rendered in KaTeX (`f(x)`, `\frac{d}{dx}(f(x))`, `[F(x)]ₐᵇ`), never plain text; the word-form name stays as an accessible `title`. An option disables itself automatically if it wouldn't change what's shown.
- **Each family declares its dependency in the panel**: `f(x)=…` for explicit curves, **`(x(t), y(t)) = (…, …)`** for parametric ones, and **`r(θ)=…`** for polar ones — no longer shown with a bare `r`, indistinguishable from an implicit curve in a variable named `r`.
- **Settings tab**, with preferences applied live:
  - *Transformations* → **auto-solve for `y`** (shows the solved result on render and hides the button).
  - *Plane* → **show notable points**: global toggle for **markers** (roots, vertices, Y-intercepts, and system solutions). Turned off, the plane stays clean for notes where only the curve's shape matters. It's a **rendering** preference: the analysis still runs — the ⓘ still lists them — and neither the crosshair nor rail mode are affected.
  - *Plane* → **auto-fit**: zooms the initial view in on the bounded curve when the block starts empty, so the figure fits entirely without manually touching the camera.
- **Labels live on the plane, not in the panel.** Every diagnostic — *Indeterminate*, *Undefined*, *Not defined in ℝ*, *Unsupported symbol*, *No function*, *Incomplete system*, *Invalid integrand*, *Divergent integral*, *Non-numeric limits*, *Out of domain* — is shown on the Cartesian plane. The LaTeX panel is the **formula**, never the verdict.
- **Custom typeface: Lora** ([SIL Open Font License 1.1](https://openfontlicense.org)), bundled by the plugin and used in the panel's text (labels, buttons, the ⓘ summary) alongside the LaTeX rendered by KaTeX.

---

## ⚡ Performance

- **No formula can hang the main thread.** All plotting is budget-bounded (evaluations, steps, components, memory), and every cap is **deterministic** — none depend on the clock — so the geometry is reproducible and the cache stable. When a budget runs out, it degrades gracefully: fewer branches, never a freeze.
- **Quarantine around `rationalize`**, the only operation capable of hanging Obsidian: the cost of the expansion is estimated *before* running it, and above budget, it isn't expanded. The formula is shown unexpanded and the curve is plotted just as well.
- **Seeds projected onto the curve** before plotting. A seed comes from linearly interpolating `F` over an edge, and where `F` is highly non-linear it lands far from the actual curve: it wasn't recognized as "already plotted" and its whole branch got re-traced. Measured on `y=tan(x)`: from **108 components down to 17**, and from **600k evaluations down to 102k**.
- **Spatial grids** in `marcarVisitadas` (mark-visited) and `eliminarDuplicados` (remove-duplicates), previously O(seeds × points) — a single pass once took 245 s.
- **Discovery refinement only runs when needed**: with the curve already well-resolved by the base grid, refining was burning ~6000 evaluations per frame for nothing.
- **Faster floor/ceil** in the evaluator's scope (12–16× cheaper per call), and asymptote detection with a strict maximum: their plateaus were firing 82k evaluations per frame (~1 s of lag).
- **Two-pass progressive rendering**: a cheap interactive pass during the gesture, and a final precise one on release.

Zoom-sweep results (7 curves × 149 zoom levels × 3 canvases × 2 passes):

| | Before | After |
|---|---|---|
| `F` evaluations per pass (median) | 14,457 | **7,186** |
| ms per pass (median / p99) | 21 / 92 | **8 / 35** |
| Zooms with an incomplete curve | 0 | **0** |

---

## 🧪 Testing

- **296 automated tests** of pure logic (no DOM or Canvas), split into **two suites by cost**: `npm run test` (288, ~14 s) is the per-change validation, and `npm run test:zoom` (8, ~70 s) isolates the scale sweep, which alone used to eat 80% of the clock. The short cycle is what makes validation actually get run.
- The runner **times each group** and prints its duration if it goes over 0.5 s: that number decides which suite a new block lives in.
- **Permanent stress bank** (heart, `x⁻¹`, lemniscate, astroid, `(x+1)^12`): runs the full host pipeline and demands it finishes, with bounded geometry. Every new hard-curve family gets added there.
- **Zoom-sweep methodology**, learned the hard way by letting the bug slip through: the metric is **traced length**, not branch count (the same curve can come out split into 2 or 4 polylines with identical drawing), and the sweep is **continuous**, because the failures live in narrow zoom bands that a coarse sampling would skip right over.
- **Development tool**: a pipeline tracer (`node herramientas/.trazar.cjs obs-integral "\int_0^2 x^2\,dx"`) that shows, step by step, what gets parsed, what gets transformed, what LaTeX gets rendered, and what string the engine actually plots. Also available as a console global inside Obsidian.

---

## 🛠 Internal Improvements

The engine is built in **rings** (Clean Architecture), with dependencies always pointing inward:

- **Ring 0 — contracts.** Pure types, zero logic: `Rama` (Branch), `Viewport`, `Tolerancia` (Tolerance), `ObjetoMatematico` (MathObject), and the universal seam:

  ```ts
  interface ProveedorGeometria {
    geometria(viewport: Viewport, tolerancia: Tolerancia): Geometria;
  }
  ```

- **Ring 1 — algorithms.** Scene, providers, discovery, tracers, analysis. They only know contracts.
- **Ring 2 — adapters.** Parsing and evaluation (the sole mathjs quarantine), rendering (the sole Canvas quarantine), interaction (DOM).
- **Ring 3 — drivers.** The Obsidian host (the sole quarantine for its API) and the *composition root*: the only file that knows concrete implementations.

Practical consequence: **adding a new type of math object, or changing a plotting algorithm, means editing one file and registering it in one place.** The "same old GraphEngine" is nothing more than a `ProveedorExplicito` (explicit provider), one provider among peers. That's what made it possible for `obs-derivate` and `obs-integral` to be new blocks rather than rewrites.

Other cross-cutting pieces:

- **A single typesetting pipeline** for every formula shown, the same one the engine plots from. Solve and Simplify produce re-parseable, **chainable** strings: each transformation applies on top of the previous result.
- **Interaction and analysis read from the `Rama` (Branch), not from the formula** (crosshair, rail, notable points, intersections): they're agnostic to the strategy used.

---

## 🐛 Bug Fixes

- **Bounded curves got mutilated and flickered on zoom-out.** Three chained causes in discovery refinement (single-path descent, priority-queue starvation, and "cell already covered" marking). Up to 49% of the astroid was lost, and the lemniscate at 0%.
- **The heart `(x²+y²−1)³=x²y³` froze Obsidian** and left the note unrecoverable: `rationalize` expanded 27 monomials and never finished.
- **Freeze with the rail over an explosive derivative** (`e^{x²+1}`): with the view centered around ~1e16, the tick step fell below the ULP and the accumulated loop never advanced.
- **~1 s of lag per frame** when graphing `floor`/`ceil`, and noticeable zoom lag from re-tracing the same branch.
- **Degenerate forms turned into a number**: `f(x)=0/0` showed `f(x) = 0` in the panel while the plane came out veiled with "Indeterminate," and `obs-derivate` would even plot the line `y=0` with no warning at all.
- **False "Indeterminate" when typing the `\frac{d}{dx}` operator by hand**, and with implicit multiplication before parentheses (`\pi(2x+4)`).
- **`√x` was parsed as `sqrt*x`**; Unicode superscripts (`x⁴`, `x⁻¹`) and vulgar fractions weren't recognized.
- **`\pi·x` got glued into `\pix`** (nonexistent command → red KaTeX error), and `\ln 3` stuck to the following number when deriving exponentials.
- **The rail didn't show up if `x=0` wasn't on the curve** (`1/x`, domain `x>0`), and it would get stuck on the synthetic vertices the tracer uses to close a branch at a pole.
- **The ⓘ panel clipped piecewise roots** to the analysis range (`⌊1/x⌋` gave `x∈(1,10]` instead of `x∈(1,∞)`) and seeded a row of markers along `⌊x⌋`'s plateau.
- **`obs-integral` broke in the tracer** and choked on invisible copy-paste characters (zero-width, exotic spaces).
- **Simplify made readable fractions worse**, and the LaTeX merged `x` with the following function (`x\sin x` → `\mathrm{xsin}(x)`).
- **The same curve behaved differently depending on how it was written**: the heart solved for `y` with `=` but not as a standalone expression (`(x²+y²−1)³−x²y³`), where the odd power is a term in a sum rather than one side of the equation.
- **The coefficient came out behind the letter** when simplifying inside a function: `r=\sin(3.5θ)` gave `\frac{\theta7}{2}`, which reads as `θ₇`.
- **`\cos 5t` was read as `cos(5°)·t`**: the coefficient of an ungrouped argument got grabbed as the entire argument and converted to degrees — the parametric `x(t)=5\cos t-\cos 5t` drew a different curve, and `r=\sin 3\theta` (a 3-petal rose) came out as a straight line. And **Unicode** `θ` wasn't translated (`r=sin(3θ)` → blank plane, no explanation).

---

## ⚠️ Known Limitations

> **This version has bugs.** The surface area is large (four blocks, a parser that accepts LaTeX and Unicode, symbolic algebra, a geometry engine, and camera-based interaction), and much of it was hardened *reactively*, in response to failures seen in real blocks, not anticipated in advance. The honest diagnostics (the labels) exist precisely so a failure gets noticed instead of disguised.

- **`obs-system` still requires 2 or more equations** (a single one → "Incomplete system"). For a single standalone curve — including an implicit one — use `obs-graph`.
- **Regions and inequalities aren't graphed** (`y ≥ x`): they're detected and labeled as unsupported.
- **The symbolic integrator has a textbook-level scope**: a product of two `x`-dependent factors, a non-affine argument, or an integral with no elementary antiderivative won't produce an `F`; the panel falls back to the numeric value. **Improper** integrals (limits at `±∞`) aren't evaluated: they're labeled instead.
- **Implicit curves with no explicit path** are plotted on a *certified best-effort* basis: when the budget runs out, the engine would rather draw too little than invent something.
- **The 288 fast tests are not a guarantee**: they cover pure logic (parser, algebra, geometry, analysis), not DOM or Canvas. Everything visual — panels, buttons, camera, shading — is validated by hand, so that's where a regression is most likely to slip through.
- The **old engine** (WebGL, marching squares) remains in the codebase as a safety net behind a flag (`MOTOR_EXPERIMENTAL` in `main.ts`), disabled. It will be removed.

---

## 📦 Technical Notes

- **Stack**: TypeScript, no framework, `mathjs` (evaluation and differentiation), **Canvas 2D**, built with `esbuild`.
- **Structure**: `src/motor/**` (contracts, scene, providers, discovery, tracers, analysis, rendering, interaction, composition root) + `src/host-obsidian/` (Obsidian adapter) + reused root `src/` (parser, evaluator, LaTeX, solve, simplify, derive, integrate, analysis, degenerate-case handling).
- The new engine **doesn't rewrite the parser or the evaluator**: it reuses them, so it recognizes exactly the same functions and the same notation as the previous engine.
- All the code, identifiers, comments, and documentation are **in Spanish**.

---

**v0.5.0 closed out an approach. v1.0.0 opens one: four blocks on an architecture where every new math object is just another provider, and where what the panel claims can't contradict what the plane draws. There's still a lot to polish — and to fix — but now it sits on foundations that can bear the weight.**