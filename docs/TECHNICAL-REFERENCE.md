# LMath — Internal Technical Reference

Reverse-engineered from the source tree as of v1.0.0. Every statement in this document is
backed by code; file paths are given per section. Where something cannot be confirmed from
the code, it is stated explicitly. This is a reference manual for the internals, not
onboarding material.

Naming note: the codebase is written with Spanish identifiers and comments. This document
uses the actual identifiers (`Escena`, `ProveedorGeometria`, `despejar`…) so that text and
code can be cross-referenced directly.

---

## 1. System overview

The plugin registers four Markdown code-block languages in Obsidian — `obs-graph`,
`obs-system`, `obs-derivate`, `obs-integral` — and renders each block as a two-pane widget:
a KaTeX formula panel on the left and an interactive Canvas-2D plot on the right.

Internally the code is organized in **rings** (the term appears in
`src/motor/contracts/index.ts`), enforced purely by import discipline:

| Ring | Content | mathjs? | Obsidian/DOM? |
|---|---|---|---|
| 0 | `src/motor/contracts/*` — types only, zero logic, zero deps | no | no |
| 1 | Numeric geometry: `src/motor/{tracing,discovery,analysis,scene,rendering,interaction}` | no | Canvas 2D only (rendering/interaction) |
| 2 | Symbolic/parsing layer: `src/parser.ts`, `src/evaluador.ts`, `src/motor/parsing/*`, `src/motor/fields/*`, `src/{latex,simplificar,despejar,derivar,integral,integrar,formatoExpr,analisis,degeneradas,constantes}.ts` | yes (quarantined) | no |
| 3 | Host: `main.ts`, `src/host-obsidian/*`, `src/engines/obs-graph/GraphEngine.ts` | indirectly | yes |

Two hard quarantines follow from this:

- **mathjs quarantine** — the geometry engine never touches mathjs. Expressions are compiled
  into numeric *oracles* (`FuncionReal`, `CampoEscalar`, `Parametrizacion`) in
  `src/motor/fields/*`, and everything below consumes only those interfaces
  (`src/motor/contracts/oraculos.ts`).
- **Obsidian quarantine** — only `main.ts`, `src/host-obsidian/*` and the legacy
  `GraphEngine` import the `obsidian` package. The engine is framework-agnostic and fully
  testable in Node (`tests/motor.test.ts`, `tests/zoom.test.ts` run with esbuild + node,
  no DOM).

There are **two rendering engines** for `obs-graph`:

- The **new engine** (`src/motor/` + host adapter `src/host-obsidian/MotorExperimental.ts`),
  active for all four blocks.
- The **legacy `GraphEngine`** (`src/engines/obs-graph/GraphEngine.ts`, WebGL-based), kept
  intact as a fallback behind the compile-time flag `MOTOR_EXPERIMENTAL = true` in
  `main.ts:23`. Only `obs-graph` can fall back; the comment in `main.ts` records that the
  old `SystemEngine` (marching-squares) was removed with no way back.

---

## 2. Entry point and block registration — `main.ts`

`LMathPlugin.onload()` performs, in order:

1. `cargarAjustes()` — loads persisted preferences via `loadData()`, copying **only** keys
   that exist in `AJUSTES_POR_DEFECTO` and with matching types. This whitelist-merge exists
   because a retired setting (`simplificarAuto`) persisted forever under a naive spread
   merge; fossil keys found on disk trigger an immediate re-save with the filtered object
   (`main.ts:109-123`). It also calls `fijarIdioma()` before any UI text is produced, so the
   load notice and settings tab already appear in the stored language.
2. Registers the settings tab (`PestanaAjustesLMath`, §13.2).
3. `registrarFuenteLora(this)` without `await` — non-blocking font registration (§13.4).
4. Creates one `MotorExperimental` per block type and registers the four
   `registerMarkdownCodeBlockProcessor` callbacks. The constructor flags select the mode:

   | Block | Construction | Meaning |
   |---|---|---|
   | `obs-graph` | `new MotorExperimental(this, false, false, ajustes)` | one curve |
   | `obs-system` | `new MotorExperimental(this, true, false, ajustes)` | N equations, N colors |
   | `obs-derivate` | `new MotorExperimental(this, false, true, ajustes)` | plot f′(x) |
   | `obs-integral` | `new MotorExperimental(this, false, false, ajustes, true)` | plot integrand + shade ∫ₐᵇ |

   `ajustes` is a **live getter** (`() => this.ajustes`), not a snapshot: a settings change
   affects any block that re-renders, without reloading the plugin.
5. Installs the dev console global `window.lmath` (§14.2) and removes it in `onunload`.

---

## 3. Per-block execution pipeline

`MotorExperimental.process(source, el, ctx)`
(`src/host-obsidian/MotorExperimental.ts:71`) is the orchestration point. The complete flow
for a block render:

```
source (raw block text)
  │
  ├─ dividirEcuaciones(source)                 structural split (§4.1)
  │     └─ visibles = all (system) | first (others)
  │
  ├─ mode-specific extraction
  │     obs-derivate : extraerFuncion → clasificarDegenerada → derivarEcuacion (§11)
  │     obs-integral : extraerIntegral → integrand/limits (§12)
  │     otherwise    : graficadas = visibles
  │
  ├─ LEFT PANEL  montarPanelLatex / montarPanelDerivada / montarPanelIntegral (§13.1)
  │     └─ transformation pipeline → bloqueALatex → MarkdownRenderer.render ($$…$$, KaTeX)
  │
  └─ RIGHT PANE (canvas)
        crearMotor / crearMotorSistema (composition root, §7)
        ├─ classification veil (clasificarBloque → localizarVelo) (§4.4, §13.3)
        ├─ Camara + Navegacion wiring (§10)
        ├─ two-pass render scheduler (below)
        ├─ auto-framing (encuadreAutomatico, once) (§9.4)
        └─ UI chrome: ⚙ badge, 🏠/+/− buttons, ⌖ rail toggle,
           per-curve color selectors, ⓘ popovers
```

### 3.1 Two-pass rendering scheduler

The host implements a progressive strategy (ported from `GraphEngine`,
`MotorExperimental.ts:227-288`):

- **Interactive pass** — during any gesture (pan/zoom/rail). Coalesced through
  `requestAnimationFrame`: `programarRedibujo()` sets `pendienteRecomputar` and schedules at
  most one frame; the frame runs `escena.actualizar(vp, "interactiva")` then `pintar()`.
  Cursor-only movement calls `programarPintado()` — repaint without recompute.
- **Final pass** — `programarFinal()` (re)arms a 150 ms `setTimeout`; when the camera stops
  moving it runs `escena.actualizar(vp, "final")`, repaints, and notifies
  `alRecalcularFinal` (so an open ⓘ popover refreshes its intersection/notable lists).

The `pasada` value travels down as `Tolerancia.pasada` and every stage adapts to it:
sampler density and refinement depth, continuation step size and evaluation budgets,
discovery grid resolution, and whether "extras" (notable points, asymptotes,
intersections) are computed at all — providers only compute them on `"final"`.

### 3.2 Canvas metrics

`redimensionar()` (`MotorExperimental.ts:321-336`) measures the canvas CSS box with
`getBoundingClientRect()` on every relevant event instead of trusting the initial height
(261 px) and dpr: app-level zoom (Ctrl+wheel) changes `devicePixelRatio` and themes that
express note width in `rem` reflow the block. Both a `ResizeObserver` on the wrapper and a
window `resize` listener call it (the latter covers dpr-only changes the observer cannot
see). It sets the physical buffer (`ancho·dpr × alto·dpr`), applies `setTransform(dpr,…)`,
and re-renders.

All listeners/observers/rAF handles are released through a `MarkdownRenderChild` registered
with `ctx.addChild` — Obsidian re-renders blocks freely, and every subsystem registers its
cleanup there (`limpieza.register(...)` calls throughout `process`).

---

## 4. Structural extraction and classification

A design principle repeated in `derivar.ts`, `integral.ts`, and `dividirEcuaciones.ts`:
**block structure is classified and extracted before anything reaches the algebraic
parser**. Structural tokens (`d`, `dx`, `\int`, the `y` of an implicit relation, the
`x(t)=` header of a parametric component) would otherwise be normalized into garbage
symbols (`d*x`, `i*n*t`) that evaluate to NaN silently, or worse, get differentiated.

### 4.1 Block → equations: `src/motor/parsing/dividirEcuaciones.ts`

- Unwraps LaTeX environments generically (`\begin{cases}`, nested `\begin{aligned}`,
  `array` with column specs) from the outside in — precisely the format the plugin's own
  panel emits, so displayed output round-trips as input.
- Splits on newlines and on `\\` (with optional `[1ex]` spacing arg). **Never on commas**:
  the parametric tuple `(x(t), y(t))` contains one.
- Strips `&` alignment markers.
- Desugars named function definitions `f(x) = rhs → rhs` (single-letter names only,
  excluding `x, y, e, i` — see `NO_ES_ETIQUETA`), because otherwise `f(x)` normalizes to
  the implicit product `f*x` and the block is classified as a bogus implicit curve.
- Fuses two separately-written parametric components `x(t)=…` / `y(t)=…` into the canonical
  tuple `(X, Y)` via `fusionarComponentes` (`componentesParametricas.ts`). Only a complete
  pair fuses; a lone component is handled by §4.3.

This is deliberately the single choke point through which the graph, the panel, and the
tracer all pass, so the three views can never disagree about what the block contains.

### 4.2 Equation → `ObjetoMatematico`: `src/motor/parsing/construirObjeto.ts`

Classification order (order matters):

1. **Parametric tuple** `(X, Y)` — detected before the `=` split (a tuple has no `=`):
   enclosing parentheses + exactly one depth-0 comma.
2. **Function of the parameter** — `x(t)=…`, `y(t)=…`, or a bare expression whose free
   symbols include `t` but neither `x` nor `y` (`funcionDelParametro`,
   `componentesParametricas.ts:85`). Treated as an *explicit* object with the variable
   renamed `t → x` on the AST (`renombrarParametroAX` — a tree transform, not a text
   replace, so `\cot t` survives). The declared axis matters: `y(t)` keeps the classic
   orientation; `x(t)` sets `ObjetoExplicito.salida = "x"` and the curve is traced in the
   transposed world and rotated back (§8.1) — the value *is* the abscissa, so the parameter
   climbs the vertical axis.
3. **`lhs = rhs`** —
   - one side normalizes to exactly `y` → **explicit** `y=f(x)`;
   - one side normalizes to exactly `r` → **polar** `r=g(θ)` with the domain computed from
     the curve's real period (§4.5);
   - otherwise → **implicit** with `F(x,y) = (lhs)−(rhs)`.
4. **Bare expression** — implicit `expr = 0` if it contains a free `y`
   (`contieneYLibre`, `parser.ts:816`), else explicit `y = expr`.

The constructors compile the oracles immediately via `src/motor/fields/*` (§6.2). The
contract types `ObjetoRelacion` (inequalities) and `ObjetoSistema` exist in
`contracts/modelo.ts` but **have no producer or provider**: `construirObjeto` never emits
them and `crearProveedor` does not handle them. Systems are realized instead as N
independent scene objects (§7). The same holds for `HechosSimbolicos`,
`CampoEscalar.gradiente`, `Estilo.guiones`, and `Estilo.relleno`: declared in Ring 0,
never populated or consumed — forward-looking contract surface only.

### 4.3 Double sign `±`/`∓`: `parser.ts` + `src/motor/parsing/dobleSigno.ts`

`y = ±√(4−x²)` is a *family* of two functions. The pipeline handles it in three pieces:

1. `normalizarEntrada` rewrites `\pm u`/`±u` into the unary sentinel `pm(u)` (and `∓` into
   `mp(u)`), delimiting the operand by the precedence of `+` (`convertirDobleSigno`,
   `parser.ts:595`). The same sentinels are emitted by the even-power branch of the solver
   (§5.4).
2. The sentinels are **evaluable**: `FUNCIONES_SIGNO` in `constantes.ts` gives them the
   principal branch (`pm(u)=+u`, `mp(u)=−u`), so single-valued consumers (degeneracy
   classification, crosshair, integral value) don't collapse to NaN.
3. The composition root expands them into the two real equations
   (`expandirDobleSigno`; signs are *correlated* per the LaTeX convention: two branches,
   never 2ⁿ) and wraps both providers in `ProveedorUnion` so they remain **one** scene
   object — one color, one selector button, no spurious "intersections" between the two
   halves of the same circle (§8.4).

### 4.4 Degenerate functions and the veil

`clasificarDegenerada` (`src/degeneradas.ts`) samples a compiled f over a wide range
(−1000…1000, 501 samples) plus a fine central strip, counting real / infinite / complex
results. If **no** sample is real, the function is unplottable and classified:
some ±∞ → *Indefinida*; some complex → *No definida en ℝ*; only NaN → *Indeterminada*.

`MotorExperimental.clasificarBloque` (`MotorExperimental.ts:1348`) layers block-level labels
on top, in priority order: unsupported LaTeX commands first (§5.1 —
`comandosNoSoportados`, checked against the *raw* source), then per-mode labels ("No
integral", "Invalid integrand", "No system", "Incomplete system", "No function"), then the
per-equation degeneracy test. A non-null result renders the **veil**: a dark overlay with a
formal label floating over a still-interactive plot. Core labels are produced in canonical
Spanish and translated at the host boundary (§13.3).

### 4.5 Polar period: `src/motor/parsing/periodoPolar.ts`

The parametric tracer walks the whole parameter domain, so a polar curve is complete only
if the domain covers a full period. For r built from circular trig with θ-affine arguments,
the curve's period is `2π·m` where `m` = lcm of the numerators of `1/|aᵢ|` in reduced form
(continued fractions). The result is verified numerically (`r(θ+P) ≈ r(θ)` at ≥2 points)
and capped at `MULT_MAX = 60`; anything unverifiable falls back to `[0, 2π]`. Example:
`r = sin(θ/10)` gets `[0, 20π]` instead of the historical tenth of a curve.

---

## 5. The symbolic layer (Ring 2)

### 5.1 Input normalization: `src/parser.ts`

`normalizarEntrada(raw)` converts LaTeX/Unicode input to mathjs syntax through an ordered
sequence of passes. The order is load-bearing; the main stages:

1. Unicode: `π→pi`, `θ→theta`, Unicode radicals `√ ∛ ∜` (wrapping the following *factor*,
   including an attached exponent, so `√x²` becomes `sqrt(x^2)` = |x|), `· × ÷`, vulgar
   fractions (`½→(1/2)`), the full superscript range (`x⁴`, `x⁻¹`), `∞`, `⌊⌋ ⌈⌉`.
2. Direct symbol table `SIMBOLOS_DIRECTOS`: `\times`, `\div`, `\infty`, `°→*(pi/180)`,
   typographic minus signs (`− – —`, the pathological copy-paste case), spacing commands.
   Typographic wrappers are unwrapped (`\operatorname`, `\mathrm`…) or deleted with their
   content (`\text`…) — otherwise the residual sweep degrades them to letter soup.
3. Double sign → sentinels (§4.3), while braces are still balanced.
4. `\left/\right` removal; floor/ceil pairs → `floor()/ceil()`; absolute-value bars →
   `abs()` via a stack-based scanner (bars are ambiguous — no regex; a bar *closes* iff
   an `abs(` is open and the previous significant char ends an operand).
5. Inverse trig normalization (`arcsin`, `sin⁻¹`, `sin^{-1}` → `asin`), **before** the
   function-power rule so `^{-1}` isn't read as a power.
6. Function powers `\tan^{2}(x)` → `(tan(x))^{2}` (`convertirPotenciaFuncion`), resolving
   the ambiguity against `tan(x^2)`; argument must be grouped in `()` or `{}` (the latter
   is what KaTeX/MathLive editors emit).
7. Fractions `\frac{..}{..}` → `(..)/(..)` with balanced-brace recursion; fractional
   exponents `x^{m/n}` → `nthRoot(x^m, n)` (real root for negative bases where defined,
   and it renders back as a radical); `^{…}` → `^(…)` recursively.
8. Logarithms (`\log_{b}`, `\ln`, bare `ln` → `log`), trig with LaTeX-style arguments,
   and functions applied to **ungrouped** arguments (`\ln x`, `\cos 5t` — the coefficient
   run rule prevents `cos(5)*t`).
9. `\sqrt[n]{…}` → `nthRoot`, `\cdot → *`, and finally the residual sweep `\cmd → cmd`.
10. Degree heuristic: pure numeric literals inside direct trig calls are converted to
    radians (`\sin(45) → sin(45*pi/180)`), including literal fractions; symbolic arguments
    are untouched (`normalizarTrigonometria`).

Everything the residual sweep would silently destroy is guarded by
`comandosNoSoportados(raw)` (`parser.ts:802`): a **whitelist** (`COMANDOS_SOPORTADOS`) of
commands the pipeline actually resolves. Any other `\cmd` in the raw source makes the host
show the "Unsupported symbol" veil instead of a silently empty plot (and, in
`obs-derivate`, instead of a *false* derivative of letter soup). `\\` is neutralized first
(it is a line separator, not the command `\y`).

### 5.2 Implicit multiplication: `src/motor/parsing/productoImplicito.ts`

`insertarProductoImplicito` runs on the *normalized* string and inserts the `*` users omit
(`3xy → 3*x*y`, `x(x+1) → x*(x+1)`, `xsin(x) → x*sin(x)`), while preserving: known function
names as atoms (longest-first table, including the `pm`/`mp` sentinels), multi-letter
constants (`pi`, `theta`, `tau`, `phi`), and scientific notation (`2e5`). The invariant
used everywhere: the compiled form is always
`insertarProductoImplicito(normalizarEntrada(s))` — panel, solver, derivative, integral and
engine all share the same two-step normalization, which is why they can never disagree
about what an expression means.

### 5.3 Evaluation: `src/evaluador.ts` + `src/constantes.ts`

`compilarExpresion` parses+compiles once and returns a closure that evaluates against a
scope, injecting three shims on every call:

- `FUNCIONES_INVERSAS_EXTRA` — `acsc/asec/acot` (mathjs lacks them). `acot` uses the
  continuous convention `π/2 − atan(x)` (range (0, π)) rather than `atan(1/x)`.
- `FUNCIONES_ESCALON_RAPIDAS` — plain-`Math` floor/ceil, ~12× faster than mathjs's
  typed-function dispatch, preserving the epsilon correction (values within 1e-12 relative
  of an integer round to it).
- `FUNCIONES_SIGNO` — the `pm/mp` principal branch (§4.3).

Any evaluation error returns NaN. This evaluator is shared by both engines and every
symbolic module, so all of them recognize exactly the same function set.

### 5.4 Transformations: simplify / solve-for-y / derivative

These three modules share a common architecture: they transform user text into a
**re-parseable mathjs string** (what the engine plots), derive LaTeX only through the
shared typographic pipeline (§5.6), and guard every algebraic rewrite with a **numeric
equivalence check** so a formal simplification can never change the plotted function.

**`src/formatoExpr.ts`** is the shared algebra toolkit:

- Term/factor flattening (`terminos`, `factores`) with two serialization orders:
  `renderTerminos` (positives first) and `renderCanonico` (variables before constants for
  polynomials; falls back to positives-first when transcendental functions appear). Both
  are format-idempotent, which is what makes "this transformation changed nothing"
  detectable and makes Simplify-after-Solve a no-op.
- **The `rationalize` quarantine**: `rationalize` (mathjs) is the only operation in the
  project capable of freezing Obsidian's main thread — its cost is superexponential in the
  number of monomials produced by naive expansion (measured table in the file header:
  `(x+y)^4` = 1.4 s; `(x²+y²−1)³` never terminates). `costeExpansion` computes that monomial
  count in O(tree), and `rationalizeSeguro` refuses anything above `LIMITE_EXPANSION = 16`.
  It is the *only* call site of `rationalize` in the project. The guard is deterministic
  (not a timeout), so caches and tests are stable.
- Exact-fraction recovery (`racionalizarFracciones`: `0.5·x → x/2` — rationalize
  serializes rational coefficients as floats), like-term combination with named constants
  (`combinarYordenar`: rationalize won't combine `5πx − πx`), a structural fraction
  combiner (`combinarFracciones`: common denominators + identical-factor cancellation,
  explicitly *not* domain-preserving, so callers must validate), a readability metric
  (`profundidadFraccion` — fraction nesting depth), and `resimbolizarConstantes`, which
  recovers `ln k`, `1/ln k`, `π`, `e`, `√k` from the decimals mathjs produces
  (`d/dx 3^x` = `ln 3·3^x`, not `1.0986…·3^x`) and moves log factors to the end of products
  to avoid LaTeX gluing.

**`src/simplificar.ts`** — `simplificarExpr` = `rationalizeSeguro` for polynomials, else
`simplify` with two extra whole-ℝ rules (`log(e^n)→n`, `log(e)→1`; the converse
`e^(log u)→u` is deliberately absent — it holds only for u>0 and would change the apparent
domain). `simplificarLado` then applies the **fidelity guardian** `formasEquivalentes`: the
result must match the original over a "bland" sample (non-integer, both signs, near and far
from 0; each free variable de-correlated by index offsetting), *including non-finiteness* —
this is what stops `0/0 → 0` from ever reaching the panel. If the result is a nested
fraction (depth ≥ 2), flatter candidates (the user's original form, the combined-fraction
form) compete by (depth, length) and only a numerically equivalent winner is adopted.
Parametric component declarations are simplified body-only (`x(t) = <simplified>`).

**`src/despejar.ts`** — solve-for-y. Additive strategy: everything to
`D = lhs − rhs`, terms without `y` move to the other side. Strategies in order for a single
y-term: pure linear (`c·y`), integer power `y^n` (odd → `nthRoot`; even → `pm(√·)`),
n-th root of y (invert by raising to n), `abs(y)^e` (two ± branches; handles `1/|y|` in both
raw and simplified shapes), multiplicative split (incomplete: `tan(y)·(x²+1)=√(x+1)` →
`tan(y) = …`). For multiple y-terms: **odd-root reduction**
(`(x²+y²−1)³ = x²y³ ⇒ x²+y²−1 = ∛(x²)·y`, valid because odd powers are bijections on ℝ;
also applied term-wise when the power is a term rather than a whole side), then the
**quadratic-in-`y^g` solver** (`despejeCuadratico`): g = gcd of y-powers, reduced quadratic
formula for biquadratics, general formula for g=1, coefficient pieces simplified
separately. Physical branches are selected *numerically* (`ramaReal`) and the final result
is validated by substitution into the **original** equation (`DVal`), so an incorrect
reduction cannot survive. Everything returns `{ecuacion, completo}` — `completo=false`
means "solved as far as possible, honestly".

**`src/derivar.ts`** — described in §11.

### 5.5 Numeric analysis of f(x): `src/analisis.ts`

The classic analysis used by the ⓘ summary of explicit curves (host-side) and by the
legacy engine: a fixed-range scan (x ∈ [−10, 10], 1000 steps) producing:

- **Roots** by sign change + bisection, with pole discrimination (a root collapses |f|→0
  under refinement; a pole stays huge or goes non-finite). Runs of ≥3 exact zeros are
  **root intervals** (step functions resting on the axis), with endpoints refined by
  bisection on the predicate `f(m)=0` and open/closed evaluated at the cleaned limit;
  intervals touching the scan border are probed geometrically out to ~1e16 to decide
  whether they extend to ±∞ (`tramoHastaInfinito`). `raicesALatex` renders the interval
  union (`x∈[0,1)∪{−3}`).
- **Vertices** by discrete slope sign change, rejecting asymptote spikes with a
  scale-invariant test (`cruzaPolo`: ternary search of max |f|; divergence ≫ endpoint
  scale ⇒ pole, not extremum), and refined by parabolic fit through the three samples.
- **Group states**: `estadoGrupo(count, isTrig)` → `normal | infinitas | demasiadas`.
  `tieneTrigonometria` is a lexical test for direct trig *calls* (lookbehind excludes
  `asin`/`sinh`; accepts digits before, for implicit products like `2sin(x)`). A trig
  function with ≥3 events oscillates ⇒ "infinitely many"; >20 events ⇒ "too many".
  `construirPuntosNotables` merges coincident markers within a world-space tolerance.

Note the parallel system: the *new* engine computes notable points **from geometry**
(§8.6), not from this module; `analisis.ts` remains the analytic path for explicit
`obs-graph` summaries (`montarBotonInfo`) and the legacy engine.

### 5.6 LaTeX presentation: `src/latex.ts`

One pipeline for everything the panel shows:
`normalizarEntrada → insertarProductoImplicito → parse → ordenarPolinomioDescendente →
toTex(OPCIONES_TEX) → limpiarTex`.

- `OPCIONES_TEX` installs `manejadorFuncionesTex`, an AST-driven typography policy:
  named functions drop parentheses for atomic arguments (`\sin x` vs
  `\sin\left(x+1\right)`); function powers render as `\sin^{n} x` (except negative
  constant exponents, which would read as inverses); the `pm/mp` sentinels render as
  `\pm`/`\mp`, with parentheses only around top-level additive arguments, and
  `a + pm(b)` renders as `a \pm b` (the quadratic-formula shape).
- `ordenarPolinomioDescendente` is purely presentational: stable descending-degree
  reordering of the top-level additive chain, only when *every* term is polynomial in x.
- `limpiarTex` fixes mathjs artifacts: `\mathrm{t}` unwrapping (mathjs typesets symbols
  that collide with unit names in upright font), `\cdot` collapse to juxtaposition (kept
  between two digits), brace protection for `\pi{x}`, stray-brace collapse, and promotion
  of all parentheses to `\left(\right)`.
- `bloqueALatex` renders a block: `cases`+`aligned` for systems; per line it declares the
  dependence the engine actually uses — parametric tuples as
  `\left(x(t),\ y(t)\right)=…`, single components as `x(t)=…`, polars as `r(θ)=…`
  (same detection criterion as `construirObjeto`, so panel and plot always agree), bare
  expressions with free `y` as `expr = 0`, everything else as `f(x)=…`. Empty input
  renders the `\text{[...]}` placeholder (mathjs's `parse("")` yields the node
  `undefined`, which KaTeX would typeset as italic letters).

---

## 6. Oracles — the mathjs boundary

### 6.1 Contracts: `src/motor/contracts/oraculos.ts`

- `FuncionReal.eval(x)` — non-finite return means "outside the real domain".
- `CampoEscalar.eval(x,y)` — same convention; optional `gradiente` is declared but no
  implementation provides it (consumers use finite differences).
- `Parametrizacion.eval(t)` + `dominio` + optional `periodica`.

### 6.2 Implementations: `src/motor/fields/*.ts`

Thin adapters over `compilarFuncion`/`compilarExpresion` that coerce any non-number
(mathjs Complex, errors) to NaN. `crearParametrizacionPolar` performs the polar→Cartesian
conversion `(r cos θ, r sin θ)` — this is why polars need no dedicated provider or tracer.
A non-compilable expression yields a constant-NaN oracle (empty plot) instead of throwing.

---

## 7. Composition root: `src/motor/app/composicion.ts`

The only module that knows concrete implementations. `crearProveedor(objeto)` is the
dispatcher; the implicit branch encodes the engine's strategy ladder:

```
implicita:
  1. tienePolos(F) && despejarRamas(F)          → ProveedorImplicitoSeparable        (y = f(x) branches)
  2. same on the transposed field F(y,x)        → ProveedorImplicitoSeparable(transpuesta)
  3. separarTrigY(F)                            → ProveedorImplicitoPeriodico        (y = T⁻¹(g(x)) + k·P)
  4. same transposed                            → ProveedorImplicitoPeriodico(transpuesta)
  5. ramasMonomioY(F) (1/|y|, 1/y, 1/y², |y|)   → ProveedorImplicitoSeparable
  6. same transposed                            → ProveedorImplicitoSeparable(transpuesta)
    7. fallback                                   → ProveedorImplicitoRasterizado (generic discovery + continuation wrapped with pixel marching squares)
parametrica | polar                             → ProveedorParametrico
explicita                                       → ProveedorExplicito
```

The rationale, recorded in the file and in `analysis/separarImplicita.ts`: whenever an
implicit curve can be *algebraically reduced to explicit branches*, the 1-D adaptive
sampler traces it more robustly than gradient continuation (clean pole cuts at any zoom;
grid discovery loses thin/asymptote-hugging/periodic families when zooming out). Smooth
conics stay on continuation, which handles vertical tangents that ±√ branches cannot.

For very dense implicit fields, the final fallback is now a viewport-aware rasterizer:
`src/motor/providers/ProveedorImplicitoRasterizado.ts` probes the field frequency and,
when the curve is too oscillatory for continuation, produces `Rama`s from pixel-level
marching squares in `src/motor/tracing/raster/marchingSquares.ts`.
`ProveedorConCache( ProveedorSinPuntosEje?( ProveedorUnion?( base ) ) )` — the axis-point
filter only in `obs-system`, the union only for double-sign families.

`crearMotor` (obs-graph: first equation only) and `crearMotorSistema` (all equations,
palette of 6 recycled colors) assemble the `Escena` with the three drawing layers
(`Overlay`, `RendererCanvas2D`, `Crosshair`). `construirObjetosEscena` is exported pure
(no Canvas) for tests.

---

## 8. Geometry production

### 8.1 The provider seam: `contracts/proveedor.ts`

`ProveedorGeometria.geometria(viewport, tolerancia): Geometria` is the universal seam.
The contract imposes **camera invariance**: geometry must be a deterministic function of
(world region, resolution, tolerance) — never of camera framing. That determinism is what
makes `ProveedorConCache` (§8.4) sound and tests reproducible. There is deliberately *no*
fixed discover→trace→render pipeline: discovery and continuation are private collaborators
of the implicit provider only (comment block in `proveedor.ts`).

`Geometria` = `{ramas, singularidades, puntosNotables, asintotas}`
(`contracts/geometria.ts`). A `Rama` is a connected polyline in world coordinates stored as
an interleaved `Float64Array` plus: `cerrada` (closed loop), `calidad` (all current tracers
emit `"best-effort"`; `"exacta"` is reserved for a future certified mode), and optional
`parametro` — intrinsic-parameter samples aligned 1:1 with vertices. **`parametro` is the
key interaction contract**: it is x for explicit-like branches, absent for
parametric/polar/continuation branches, and its presence is what enables the per-x
crosshair and rail (§8.6, §9.2).

`Tolerancia` (`contracts/viewport.ts`) is the quality contract: `desviacionMaxPx` (Fréchet-
style screen deviation), `pasoMaxPx`, and `pasada`. `Escena.actualizar` fixes it at
`{0.5, 2, pasada}`. Only the parametric tracer currently reads `desviacionMaxPx`
numerically; the explicit tracer and continuation encode their thresholds as internal
pixel constants (`SALTO_PX_MAX = 8`, `PASO_PX_FINAL = 2.5`, …).

### 8.2 Tracers: `src/motor/tracing/`

**`TrazadorExplicitoAdaptativo`** (`explicit/`) — the obs-graph sampler *extracted* behind
the contract, behaviorally identical to the shared legacy sampler (§14.4; the test suite
enforces parity). Uniform coarse sampling (1000–8000 samples, density tied to pixels) +
recursive refinement of any interval whose screen jump exceeds 8 px (skipping intervals
entirely off-screen on the same side), with depth 12 (interactive) / 18 (final). Key
mechanisms:

- **Same-branch asymptote pre-scan** (`detectarAsintotasMismaRama`): finds x where |f| has
  a *diverging* local max (1/x², ln|tan x|) via ternary search and a three-scale divergence
  signature (1e-3/1e-7/1e-11) — stable under zoom, independent of whether a sample lands on
  the singularity. Detected poles force refinement and branch cuts. The strict `<`/`>` in
  the local-max test matters: step-function plateaus previously triggered hundreds of
  ternary searches per frame (~1 s/frame).
- **Pole vs overflow**: an Infinity that never returns to finite toward the domain border
  is numeric overflow (x^1000), not a pole (`esOverflowPersistente`).
- **Pole emission**: finite endpoints are emitted *raw* (never clipped — the crosshair and
  rail read true y values; visual clipping belongs to the renderer), then a synthetic
  vertex at `yTop/yBot` = one view-height beyond the border makes the stroke climb the
  asymptote. These synthetic vertices are later recognized and pruned by interaction code
  (`podarVerticesDePolo`, §8.6).
- **Defensive cuts at exhausted refinement**: a sub-pixel interval that still jumps more
  than a view height across the visible band is a masked pole → cut; a sub-pixel jump whose
  interior probes confirm two plateaus (`esSaltoFinito`) is a step discontinuity (floor /
  ceil) → cut, so no vertical "riser" is drawn.
- Output: each polyline becomes a `Rama` with `parametro` = the x array; asymptote x's are
  returned in `ResultadoTrazadoExplicito.asintotas`.

**`TrazadorContinuacion`** (`continuation/`) — predictor–corrector continuation of
F(x,y)=0 from seeds, parametrized by arc length. Newton projection along the
finite-difference gradient (`corregir`, convergence required — no accepting garbage near
∇F≈0); tangent predictor with adaptive halving, accepted only if it converges, progresses
forward (`FWD_MIN`) and turns < ~45° (`COS_GIRO_MAX`); **straight crossing** through
singular regions (extrapolate along the previous direction and reproject; accepted < 60°)
— which continues through transversal nodes and stops cleanly at cusps. Traces forward and
backward from each seed, closes loops, stops at the expanded border.

The file documents at length the central scaling lesson: **step size and proximity
thresholds are two independent magnitudes**. The step is pixel-based (quality/cost) with a
minimum of `PASOS_MINIMOS_CURVA = 24` steps across a tiny curve; the "seed already traced"
/ "duplicate branch" / "loop closure" thresholds are fractions of the *curve size*
(diagonal of the seed cloud — `CURVA_POR_SEMILLA = 60` etc.), because thresholds tied to
the step swallowed neighboring arcs at zoom-out (mutilated, flickering curves — the
measured numbers are in the comments). Additional machinery, each fixing a measured
pathology: seeds are Newton-projected before use (unprojected seeds near tan-poles caused
85 duplicate re-tracings ≈ 470k evaluations of lag); `arranque` searches 8 directions at
scale-relative distances when the seed lands on a cusp or singular point (the astroid
disappeared entirely without this); `marcarVisitadas` and `eliminarDuplicados` measure
distance to *segments* (not vertices) through a spatial hash grid, and duplicate removal
keeps branches unless >60% covered (0.45 was tried and mutilated legitimate branches at
177 zoom levels). Deterministic work budgets (`MAX_EVALS_*`) and a memory cap
(`MAX_PUNTOS_TOTAL = 200k`) bound the worst case without clock dependence. Continuation
branches carry **no** `parametro`; `ProveedorImplicito` retrofits it for strictly
x-monotone branches (§8.3).

**`TrazadorParametricoAdaptativo`** (`parametric/`) — 1-D sampling in t with subdivision
driven by the *perpendicular deviation of the midpoint from the chord in pixels* (the
first real consumer of `Tolerancia.desviacionMaxPx`) plus a chord-length density bound.
"Utility" of a point = finite **and** within a 3×-viewport margin: a finite point running
to infinity (polar r→∞) is treated like a domain hole, so the tracer doesn't chase
infinity nor fragment into micro-branches. Domain-hole borders are bisected (24 steps).
A single un-cut branch whose endpoints coincide on screen is marked `cerrada`. Emits no
`parametro` (t ≠ x would corrupt per-x readers).

### 8.3 Providers: `src/motor/providers/`

- **`ProveedorExplicito`** — direct to the explicit tracer; extras (notable points,
  asymptotes) only on the final pass. `salida:"x"` components are traced in a transposed
  viewport and rotated by `girarGeometria` (shared with the separable provider), covering
  the full *visible* height instead of a fixed parameter range.
- **`ProveedorImplicito`** — discovery → continuation. Post-processing:
  `parametrizarMonotonasEnX` attaches `parametro` to branches whose x is strictly
  monotone (reorienting to increasing x) — the only route by which an implicit
  function-of-x becomes rail-traversable; folded branches (circles) stay non-traversable
  by design. Notable points are computed **by algebraic re-solve**: if `despejarRamas`
  applies, ephemeral explicit branches are sampled and analyzed with the same
  `analizarPuntosNotables` as explicit curves, so `x³+y³=9` reports exactly the points of
  `y=∛(9−x³)`; otherwise none (direct implicit analysis is not implemented — stated in
  the file).
- **`ProveedorImplicitoSeparable`** — traces each despejada branch with the explicit
  sampler, then `partirEnPolos` cuts branches at poles of `c(x)=F(x,0)` located by
  `localizarPolos` (needed because odd roots compress poles: `∛(2−tan x)` never reaches
  |y|→∞ at coarse sampling, and the sampler would connect across), extending cut ends to
  the off-screen border so asymptotes render vertical even in the fast pass. Transposed
  variant swaps the viewport in and rotates the geometry out (asymptotes vertical ↔
  horizontal; `parametro` deliberately dropped after rotation; notable points recomputed
  on the rotated polylines).
- **`ProveedorImplicitoPeriodico`** — for `a(x)·T(y)+c(x)=0` with periodic T: traces the
  base inverse branch(es) **once** in an auxiliary viewport with the same px/world scale,
  then emits up to `MAX_COPIAS = 400` exact vertical translations per base — O(1 tracing)
  for hundreds of visible branches. The `INVERSAS` table defines per-T inverse functions,
  base ranges and periods (sec/csc invert via 1/v; out-of-range values are NaN = domain
  hole, exactly the curve's real domain).
- **`ProveedorConCache`** — one-entry memo keyed by
  `domX|domY|anchoPx|altoPx|pasada|ε|paso` (dpr excluded: sampling is in CSS px). Cursor,
  crosshair and rail never touch these inputs, so they never invalidate. The file states
  the honest scope: same-view repaints hit; every frame of a continuous gesture misses by
  design (scale-band caching is documented as future work, not implemented).
- **`ProveedorSinPuntosEje`** — presentation decorator for `obs-system`: strips roots and
  y-intercepts (system plots keep only vertices and inter-curve crossings).
- **`ProveedorUnion`** — compositor for the ± family (§4.3): concatenates geometries under
  one `objetoId`.

### 8.4 Discovery: `src/motor/discovery/sampled/DescubrimientoMuestreado.ts`

Grid sampling of F over the viewport (coarser grid on the interactive pass), emitting a
seed on every cell edge with a sign change. `cruceReal` filters pole jumps (+∞→−∞ across a
tan asymptote): a genuine zero crossing has |F(mid)| bounded by its endpoints.

Because grid cells are pixel-tied but bounded curves have fixed world size, a curve zoomed
out enough fits inside one cell and vanishes (differently per pass ⇒ flicker). The
**adaptive refinement** fixes this: candidate cells ranked by min |F| at their corners
(distance-to-curve proxy) feed a quadtree descent (SUB=4 per side, depth ≤ 5, ≤ 240
subdivisions, ≤ 96 seeds — deterministic budget). Three recorded anti-lessons, each a
measured bug: exploration is **breadth-first by level** (pure |F| priority starves — a
neighboring cell's fixed small-|F| corner outbids the cell actually containing the curve;
the heart at semiY=27.5 returned zero seeds); cells that already produced a seed are **not
excluded** (the lemniscate seeds only its nodal point where tracing dies; excluding its
cell emptied the curve); and refinement is skipped entirely when the base-grid seed cloud
already spans > 3 cells (refining a well-resolved curve wasted ~6000 evals/frame). The
stated known limitation: a large curve hiding an additional tiny component would not be
found. `deduplicarSemillas` thins near-coincident seeds on a cloud-relative grid
(refinement re-seeds the same curve at every level).

Singularity classification is not implemented — `singularidades` is always `[]`, and the
continuation tracer ignores its `_singularidades` parameter (it detects trouble locally
instead).

### 8.5 Geometry-based analysis: `src/motor/analysis/`

All interaction and reporting in the new engine reads the traced `Rama`, never the
formula ("the analysis reads the geometry" — stated in several headers):

- **`puntosNotablesDeRama.ts`** — roots (sign change interpolation; isolated exact zeros
  vs plateaus, with duplicate-sample echo skipping so the circle's tangent touch at (±3,0)
  isn't mistaken for a plateau), all y-axis crossings (`<=` on both sides catches branches
  born/dying exactly at x=0), local extrema (horizontal-tangent extrema always;
  vertical-tangent extrema only for branches *without* `parametro`, i.e. genuinely
  foldable curves, with symmetric strictness guards against synthetic pole segments;
  closed-loop seam handled explicitly), and **branch-endpoint roots** for partial domains
  (√(x+1) born on the axis) — endpoint within ½ px of y=0, not at the viewport x border
  (which would mark 1/x tails as roots). Per-category dedupe (~3 px). Drawing caps at 30
  per category (a category over the cap is omitted entirely — no misleading subset);
  `resumenPuntosNotables` returns uncapped lists for the ⓘ popover, which *summarizes*
  overflow instead.
- **`lecturaRama.ts`** — the crosshair/rail primitives: `yEnRamas` (binary search over
  `parametro`), `avanzarPorArco` (walk N *screen pixels* along the polyline — the core
  rail primitive; always returns a point on a drawn segment, jumps domain holes to the
  neighboring branch accumulating only the pure discontinuity in `hueco`, reports
  `normal|salto|tope`), `existeRamaVecina` (real-time Case A/B asymptote topology test,
  §10.2), `podarVerticesDePolo` (strip the synthetic clamp vertices — poison for arc
  walking), `recortarRamasPorPendiente` (drop near-vertical runs above screen slope 50 so
  a rail branch *ends* where the curve stops being traversable; slope is a geometric
  property, so the cut lands at the same curve point at any zoom), and
  `curvaConBlowupVertical` (detects edge-of-domain blow-ups the tracer doesn't mark as
  formal asymptotes: branch endpoint at an *interior* x, off-screen |y|, near-vertical
  approach).
- **`interseccionesRamas.ts`** — system solutions derived purely from geometry: segment ×
  segment crossings between branches of *different* objects, spatial-hashed (cell = median
  segment length — the median, because pole verticals of length ~1e15 would destroy a
  mean-sized grid), segments clipped to the view region (Liang–Barsky) first. Colinear
  overlap detection (`solapanColineales`) feeds the "infinitely many solutions (curves
  coincide)" state. Deterministic cap `MAX_PUNTOS = 200`; *reaching* the cap means the
  enumeration is incomplete and biased, so the scene discards the markers entirely and the
  panel says "too many". The header records the accepted trade-offs: trace-level precision,
  undetected tangencies, no isolated points from overlaps. (This replaced the Newton solver
  of the retired SystemEngine, which needed the formulas.)
- **`separarImplicita.ts`** — the numeric (oracle-only, no symbols) separability
  detectors used by the composition root: `despejarRamas` (F = a·yⁿ + c(x), a constant,
  verified over probe points with distinct x *and* y — mixtures like the folium fail the
  constancy test), `separarTrigY` (F = a(x)·T(y) + c(x): solve a,c from two reference y's,
  verify affinity on the rest), `ramasMonomioY` (same structure over the monomial bases
  1/|y|, 1/y, 1/y², |y| — these can't use `despejarRamas` because F(x,0) is infinite or
  the sign test breaks), `campoTranspuesto`, `tienePolos` (sign change with large
  magnitude on both sides along y=0 — the gate between continuation and separable
  routes), and `localizarPolos` (bracket + bisection of each +∞↔−∞ jump).
- **`areaBajoRama.ts`** — §12.2.

---

## 9. Scene and rendering

### 9.1 `Escena` (`src/motor/scene/Escena.ts`)

The orchestrator, built on one separation: **`actualizar` (expensive — ask every provider
for geometry, cache it) vs `pintar` (cheap — draw cached geometry + overlay + crosshair)**.
Mouse movement only repaints; only viewport changes recompute.

State held per scene: cached `ItemDibujo[]` (geometry + style pairs), system intersection
points + saturation/overlap flags (final pass only; world coordinates stay valid during
gestures), the selected-curve index (crosshair/rail target), the integral region polylines,
the notable-markers visibility flag (a render preference — geometry is still computed so
the ⓘ and rail are unaffected), and per-object vertical-asymptote presence. The latter is a
**monotone latch** for formal asymptotes (having poles is a property of the function, not
the framing; without the latch, zooming past the pole disabled the rail's inertia mode)
OR'd with the per-final-pass blow-up heuristic.

Query surface consumed by host and interaction: `intersecciones()`,
`interseccionesSaturadas()`, `solucionesInfinitas()`, `yEnCurva()`, `avanzarArcoEnCurva()`
(pole-vertex pruning always; slope clipping only when requested — falling back to raw
geometry if nothing traversable remains), `hayRamaVecinaCarril()`,
`tieneAsintotasVerticales()`, `resumenNotables()`, `encuadreAutomatico()`, selection
management, and `curvaRecorrible()` — the predicate gating crosshair and rail: branches
must carry `parametro` **and** must not overlap in x (multivalued relations like
`tan(y)·(x²+1)=√(x+1)` trace as x-monotone branches stacked in the same x band; a vertical
crosshair would be ambiguous, so they are not traversable; tan(x)'s disjoint bands are).

### 9.2 Renderer: `src/motor/rendering/RendererCanvas2D.ts`

A pure consumer of `Geometria` — the file states the rule that it never knows which
algorithm produced a branch. Draw order per frame (fixed in `Escena.pintar`): overlay
background → dashed asymptotes → integral region fill → branch strokes → notable-point
markers → intersection markers → math crosshair → cursor cross. Branch coordinates are
clamped to ±1e6 px (Canvas2D chokes on astronomical coordinates near poles; both axes,
because transposed curves blow up in x). The integral region renderer splits each clipped
polyline at y=0 crossings, fills to the axis with sign-coded translucent tints (cool above,
warm below), overlays a 45° hatch **anchored to world coordinates** (so it pans with the
camera) using `clip()`, and draws vertical boundary lines at x=a and x=b.

`Estilo.guiones` and `Estilo.relleno` are declared in the contract but not consumed by
this renderer.

### 9.3 Overlay: `src/motor/rendering/overlay/Overlay.ts`

Background, grid, axes, ticks, labels; knows only the `Viewport`.
`generarTicksCuadrados` uses one "nice" step (1/2/5·10ⁿ) for both axes — the camera keeps
px/unit identical on both axes, so a common world step yields square cells.
`ticksConPaso` iterates by integer index with a hard cap, never by `t += paso`: with the
rail chasing an explosive derivative, domY reaches ~1e17, the step falls below the ULP of
t, and the accumulating loop never advanced — a main-thread freeze of all of Obsidian
(recorded in the comment).

### 9.4 Auto-framing: `src/motor/scene/autoencuadre.ts`

Runs **once** per block, right after the first render, only if the `encuadreAuto` setting
is on (`MotorExperimental.ts:346-353`). `semiYAutoencuadre` computes the bounding box of
all traced branches (after pole-vertex pruning) and proposes a smaller vertical semi-range
iff: the curve is strictly contained (2 px cushion — touching a border means it may
continue outside; only zoom **in**, never out), the needed frame is < 60% of the current
one, occupation is capped at 60% (breathing room, matching GeoGebra/Desmos), the center
stays at the origin (scale only — axes always in frame), and the result is quantized
upward to a fine mantissa table {1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10}×10ᵏ (a coarse table
threw away up to half the computed frame). The chosen semi-range becomes the camera's
**base view** (`fijarEncuadreBase`), which is what 🏠 and the rail-toggle reset return to.

### 9.5 `viewport-utils.ts`

The single home of world↔screen mapping (`aPantallaX/Y`, `aMundoX`, `crearViewport`), so
the engine has exactly one convention. Lives in `scene/` because `contracts/` must stay
logic-free.

---

## 10. Interaction

### 10.1 `Camara` (`src/motor/interaction/Camara.ts`)

Owns the mutable view (`domX/domY`) and cursor state; emits `onViewport` (recompute+paint)
vs `onCursor` (paint only) — the split that makes cursor movement cheap. Default view:
domY = [−7, 7], domX derived from the aspect ratio (square cells; re-derived on every
`redimensionar`). Wheel zoom is anchored at the cursor; one notch = ×1.05 out with the
*exact* inverse in (so a round trip restores the view bit-exactly — a 0.95 factor drifted
0.25% per round trip).

Button animations (+/−/🏠) share one rAF loop, mutually exclusive, cancelled by any manual
gesture. Zoom accumulates in **log space** (multiplicative zoom ⇒ additive logs; repeated
clicks extend the run smoothly) and is consumed with an exponential profile
(`1 − e^(−dt/90ms)` of the remainder per frame, real dt, tail snapped when < 0.01%). The
home animation interpolates the center linearly and the scale geometrically, and lands by
calling `restaurarVista()` exactly.

`enfocarCarril(railX, railY, factor)` re-frames to follow the rail point, with the center
clamped by `centroCarrilAcotado` (|c| ≤ semi·2⁴⁶): beyond that, `[c−semi, c+semi]`
degenerates in floating point (span quantized or zero) — this was the tick-loop freeze
path. `panear`/`enfocarCarril` are *passive* mutators (no callback; `Navegacion` runs its
own loop); button zoom is *active* (emits per frame).

### 10.2 `Navegacion` (`src/motor/interaction/Navegacion.ts`)

Keyboard on the focused canvas. Without rail: WASD/arrows = free pan (pixel-rate,
normalized diagonals). With rail (⌖): A/D travel along the selected curve, W/S zoom
centered on the point, Shift scales all speeds ×0.1 (continuous float movement, so
precision mode can land between pixels). The rail's y comes exclusively from geometry
(`LectorCurva` callbacks bound to `Escena` in `MotorExperimental.ts:300`), never from
evaluating f.

Travel is by **screen arc length** (`avanzarArco`), not by x — in near-vertical stretches
the point advances in y at a uniform rate and never leaves the polyline. Toggling the rail
resets the view to the base framing and hooks the point onto the curve nearest to (0,
seed) by a zero-length arc walk (so curves undefined at x=0, like 1/x, still get a point).

For curves with vertical asymptotes (`tieneAsintotasVerticales`), the rail switches to the
**inertia mode** (`pasoCarrilAsintota`), a substantial state machine. One camera-motion
engine — a framerate-independent exponential spring (`RIGIDEZ_CAMARA`) — aimed at
different targets depending on real-time topology (`hayVecina`, measured on the
slope-clipped geometry, never on function type):

- **Case A** (a neighboring branch exists: tan, sec, x⁻²): the point accelerates up the
  branch with a verticality ramp (×1 → ×10, `factorRampaVerticalidad` — geometric, from
  local screen slope), the slope-clipped branch *ends*, and the arc walk jumps to the
  neighbor's symmetric entry. The camera does **not** follow the jump in x: the pure
  discontinuity (`hueco`) is absorbed into `_dxReenganche` and dissolved by the spring, so
  the frame never teleports; continuous motion is tracked exactly (a spring on the full
  motion would read as lag).
- **Case B** (no neighbor — a genuine domain end like `arccot(x²)/(2√x)` at x=0⁺): the
  camera rides the point rigidly (spring stiffened by the same ramp), and past
  `ALTURA_ESCAPE_SEMIALTURAS = 18` semi-heights (or when the polyline runs out — `tope`)
  the point enters **escape mode**: its y is *integrated* here at constant screen speed
  instead of read from the finite polyline (whose last real vertex would otherwise trap
  it), the exact escape point is stored, and reversing direction descends and re-hooks at
  that same point — do/undo is exact by construction. Meanwhile the camera stops chasing
  and animates to the fixed target y=0 with a ×10→×1 stiffness curve, snapping when < ½ px
  remains. The rAF loop stays alive while any camera animation is unfinished, even with no
  keys held.

---

## 11. The derivative subsystem (`obs-derivate`)

`src/derivar.ts`, orchestrated from `MotorExperimental.process` (lines 85–117) and
`montarPanelDerivada`.

**Extraction** (`extraerFuncion`): accepts a bare explicit form (`x^2`, `y = f(x)`,
`f(x) = y`) or the operator written by the user — `\frac{d}{dx}(f)`, `\frac{d}{dx} f`
(only with denominator exactly `dx`; any other Leibniz fraction `\frac{dy}{dx}`,
`\frac{d}{dy}` is *rejected* rather than mis-differentiated wrt x). A free `y` in the
extracted body means an implicit relation → null (prevents a silent ∂/∂x). The **written**
function is degeneracy-classified *before* differentiating (`degeneradaDeEcuacion` on the
extracted f, host side): mathjs is formal algebra and happily produces `d/dx(0/0) = 0`,
which used to display an invented `f'(x)=0` over the line y=0.

**Differentiation** (`derivarExpr`): mathjs `derivative` with two substitution tricks for
node types it cannot handle —

- floor/ceil (`derivarConEscalones`): each step call is replaced inside-out by an opaque
  symbol (locally constant, which *is* the step's local behavior), differentiated, and
  restored; each substituted step contributes a `0·u′` domain-preserving term so
  `d/dx ⌊√x⌋` is 0 only where √x exists. Jumps (measure zero) are not represented.
- `pm/mp` sentinels (`sustituirSignos`/`restaurarSignos`): the sign is a ±1 constant, so
  `d/dx(±u) = ±u′`; after differentiation the sign symbol must be factorable out of each
  additive term or the whole derivative is declared non-representable (throw → null).

**Post-simplification** (`simplificarDerivada`): candidates — extra `sqrt(u)²→u` rule,
`combinarFracciones`, and for top-level products a term-by-term distributed form
(`derivadaDistribuida`, which yields flat terms like `arccot(x²)/(2√x) − 2x√x/(x⁴+1)`
instead of a fraction-of-fractions). Winner = lowest (fraction depth, length) that is
**numerically equivalent to the raw derivative including non-finiteness**
(`derivadasEquivalentes`); the raw derivative is the floor. Then
`racionalizarFracciones` and `resimbolizarConstantes` (last — a further simplify would
re-decimalize).

**Presentation**: the panel shows the unevaluated operator with the function
pre-simplified (`derivadaOperadorSimplificadoLatex`, falling back to the raw operator) as
the default view, and `f'(x) = …` (`derivadaLatex`) plus a stacked "both" view behind the
options menu. The plot always graphs the derivative string; the panel toggle is display
only.

---

## 12. The definite-integral subsystem (`obs-integral`)

### 12.1 Notation parser and facade: `src/integral.ts`

`extraerIntegral` recognizes the LaTeX form `\int_{a}^{b} f \, dx` (with deliberate
tolerances documented in `parsearLatex`: the `\in` typo before `_`/`^`, `\limits`,
`\displaystyle`, limits in either order, missing differential → variable x, multi-char
un-braced limits like `^10`) and a secondary line form (`a=…` / `b=…` / integrand). Raw
pieces only; each consumer normalizes through the shared route. `normalizarInvisibles`
strips zero-width characters and normalizes exotic Unicode spaces first (pasted
`\, dx` used to break the differential match). `esIntegrandoValido` rejects integrands
containing `=` or free `y` (an implicit curve is graphed, not integrated) — otherwise the
block mis-reported a Level-2 "out of domain" for a Level-1 "not a function".

**Two failure levels**, split consistently across the code (`integral.ts` header,
`areaBajoRama.ts` header, `clasificarBloque`):

- **Level 1** — the integrand takes no real value (0/0, √−1): classified by
  `degeneradas.ts`, veiled on the plot.
- **Level 2** — the curve exists but the number doesn't (interior pole, domain gap in
  [a,b], non-numeric limits): labels produced by `areaBajoRama`, also shown **on the
  plot** via `etiquetaIntegral`. The panel never shows a verdict — it keeps the formula
  only (`cuerpoAreaLatexExacto` returns `cuerpo: null`); the diagnostic lives in exactly
  one place.

**Value rendering** (`cuerpoAreaLatexExacto` → `cuerpoAreaExactoBase`): if a symbolic
antiderivative exists (§12.3) and F(b)−F(a) is consistent with the numeric area within
1e-5 (the consistency check is what detects an interior pole where Barrow does not apply:
∫₋₁¹ 1/x has finite F at both ends), the value is recognized in **closed form** by
high-precision rational approximation (`racionalDe`, continued fractions, denominator ≤
1000, tolerance 1e-9) against rationals and rational multiples of π, e, √k, ln k —
rendering `= \frac{8}{3}`, `= \frac{\pi}{2}`, `= \ln 3` — or `\approx <4-decimals>` when
irrational with no recognizable form. Without a usable antiderivative, the Simpson value
gets `\approx` unless it is a clean integer. A `pm(...)` integrand propagates its ± to the
displayed value (∫±f = ±∫f; magnitude only).

### 12.2 Numeric area: `src/motor/analysis/areaBajoRama.ts`

`areaDefinida(f, a, b)` is viewport-independent (a property of (f, a, b)). Pipeline:
orient the interval; scan the open interior with 512 samples — NaN ⇒ *Fuera de dominio*,
±∞ ⇒ *Divergente*, sign changes bisected to distinguish roots (|f|→0) from poles (blow-up
past 1e10), same-sign spikes (1/(x−c)²) confirmed by a 256-point fine sweep; then either
plain **adaptive Simpson** (Richardson error control, tol 1e-11, depth 50; any interior
non-finite value ⇒ divergent) or, if an endpoint is singular, the **improper** route:
integrate on a geometrically shrinking ε-interval and require the estimates to stabilize
within 1e-4 (converge ⇒ `impropia: true`, rendered with `\approx`; otherwise
*Divergente*). |value| > 1e15 ⇒ divergent.

`recortarRegion(ramas, a, b)` clips the integrand's traced branches to the x-strip [a,b]
(interpolating the boundary points, splitting at holes/discontinuities) — this feeds the
renderer's shading (§9.2) and is recomputed on every `actualizar` (cheap; follows the
re-traced curve). The scene is told the limits by the host (`escena.fijarIntegral(a,b)`)
only when both evaluate numerically (`evaluarLimite`).

### 12.3 Symbolic antiderivative: `src/integrar.ts`

mathjs cannot integrate, so this is a small purpose-built integrator (the header states
the scope honestly: a calculus-textbook repertoire, not a general engine — the general
problem is undecidable). Structural recursion: constants, linearity, products with exactly
one x-dependent factor, `const/q` reciprocals (power of affine base / affine log /
pure-quadratic arctangent `1/(kx²+m)`), constant-base exponentials `b^u`, a function
table (sin, cos, exp, tan, sinh, cosh, sqrt) — all with the **linear substitution**
`∫f(ax+b)dx = F(ax+b)/a` detected by constant derivative of the argument (`coefLineal`),
which is what makes `sin(2x)`, `e^{3x}`, `(2x+1)^5` reachable.

The correctness philosophy: *a wrong antiderivative is worse than none*. Every candidate
must pass `verificaNumerica` — its **finite-difference** derivative (independent of
mathjs's symbolic differentiation, so `abs`, `atan` etc. don't matter) must reproduce the
integrand at ≥3 comparable sample points; otherwise `integrarExpr` returns null and the
panel falls back to the numeric value. No `+C` (irrelevant under Barrow subtraction).

---

## 13. Host presentation layer

### 13.1 Formula panels (`MotorExperimental.ts`)

`crearScrollerLatex` builds the left panel: a fixed 261-px container hosting one
independent horizontal-scroll *card* per formula (unified rule: one expression = one
framed card; card height is derived so a single card is pixel-identical to one slot of the
stacked "both" view). Each card has its own fade overlays (siblings of the scroll area —
an absolute child would scroll with the content), wheel-to-scroll clamped to ±40 px/tick,
sub-pixel overflow tolerance (3 px, KaTeX artifact), and a `ResizeObserver` for the async
KaTeX font load. Formulas render through Obsidian's `MarkdownRenderer.render` with
`$$…$$`, i.e. the vault's KaTeX.

Three panel variants share the same toggle chrome (math-glyph buttons rendered by KaTeX
via `montarEtiquetaMath`, hamburger options menu, enabled-state = "applying this would
change the displayed LaTeX"):

- **`montarPanelLatex`** (graph/system): the displayed base is `baseAutomatica` — the
  optional auto-solve (`despejarAuto` setting) followed by the *always-on, unconditional*
  simplification; failures keep the previous form (never break the render). "Original"
  returns to that base; the only menu item is Solve-for-y (hidden when automatic). State
  is chainable: transformations apply to the current re-parseable strings.
- **`montarPanelDerivada`**: views operator / evaluated derivative / both (§11).
- **`montarPanelIntegral`**: views operator / Barrow bracket + exact value / both (§12).

### 13.2 Settings: `src/host-obsidian/ajustes.ts`

`AjustesTransformaciones` = `{despejarAuto, puntosNotables, encuadreAuto, idioma}` with
defaults `{false, true, true, "en"}`. The tab writes to `plugin.ajustes` and persists via
the `PluginConAjustes` contract (decoupled from the concrete plugin class). Consumption
points: `despejarAuto` in `baseAutomatica`; `puntosNotables` read **live on every
repaint** (`escena.mostrarNotables`, `MotorExperimental.ts:214`); `encuadreAuto` once at
block mount; `idioma` re-fixes the i18n pointer and re-renders the tab immediately.

### 13.3 i18n: `src/i18n/index.ts`

Framework-agnostic string tables (`en` default, `es`) behind `t()`, with a module-level
active-language pointer set by `fijarIdioma`. The core engine does **not** depend on i18n:
it emits its veil labels in canonical Spanish (fixed by tests). `localizarVelo` translates
exactly those labels at the host boundary via an es→en map keyed by canonical text,
passing through anything unmapped. Host-generated labels come out of `t()` already
localized.

### 13.4 Fonts: `src/host-obsidian/fuentes.ts` + `styles.css`

The Lora variable fonts (`assets/fonts/Lora/*.ttf`) are imported as **Data URIs** — the
esbuild flag `--loader:.ttf=dataurl` (package.json `build` script) embeds them in
`main.js`, so the release keeps the standard Obsidian trio (main.js, manifest.json,
styles.css). `registrarFuenteLora` registers the `FontFace`s idempotently and fails
silently per face (CSS fallback `var(--font-interface)`). `styles.css` scopes the family
to `.lmath-grafica` (the plot's DOM overlays) only — KaTeX keeps its own fonts — and
neutralizes Obsidian's own math-block overflow wrappers so the plugin's scroller is the
only scrollbar.

### 13.5 Legacy engine: `src/engines/obs-graph/GraphEngine.ts` (+ `src/render/muestreoExplicito.ts`, `src/webgl.ts`)

The original single-function engine, still compiled and reachable via the flag in
`main.ts`. Differences from the new engine: three stacked canvases (WebGL for the curve —
polylines expanded to triangle quad-strips by `construirQuadStrip` and drawn with a
minimal color shader from `webgl.ts`; a 2D canvas for the overlay; a third for the
crosshair), WebGL context released on unmount via `WEBGL_lose_context`; the analytic
pipeline of §5.5 for notable points (with hover labels and collision-avoiding placement);
its own rail implementation. Its sampler was extracted verbatim into
`src/render/muestreoExplicito.ts` (also formerly shared with the removed SystemEngine);
the new engine's `TrazadorExplicitoAdaptativo` is the same algorithm re-housed behind the
contract, and `tests/motor.test.ts` asserts parity between the two (allowed to differ only
in the finite-value clipping correction). `webgl.ts` and `render/muestreoExplicito.ts`
have no other consumers.

---

## 14. Development tooling and tests

### 14.1 Pipeline tracer: `src/herramientas/trazador.ts` + `formato.ts`

A pure (no DOM/Obsidian) reproduction of what each block computes, calling the *same*
functions as panel and engine (`dividirEcuaciones`, `simplificarEcuaciones`,
`despejarEcuaciones`, `bloqueALatex`, `derivada*`, `extraerIntegral`, `construirObjeto`) —
by construction it cannot diverge from what the user sees. For each step it reports the
re-parseable mathjs string (what is plotted), the LaTeX (what KaTeX renders), and a
diagnosis (object type, normalized form, solve status). Input syntax `[ec1/ec2]` passes
several equations on one terminal line. `formato.ts` renders the structure to plain text
with facet flags.

### 14.2 Consumers

- `src/host-obsidian/consolaDev.ts` — the `window.lmath` global in Obsidian's DevTools
  (`trazar/grafica/latex/diagnostico` + per-block shortcuts + `ayuda()`).
- `herramientas/trazar.ts` — the terminal CLI. Bundled once with `npm run trazar`,
  executed with plain `node` (the header documents why not `npm run … --` on Windows:
  cmd.exe corrupts `^` and parentheses).

### 14.3 Tests

Zero-dependency micro-runner (`tests/runner.ts`; per-`describe` timing decides which suite
a new block belongs to). Two suites:

- `tests/motor.test.ts` (`npm run test`, ~30 s, run on every change): sampler parity vs
  the legacy reference, continuation cases, cache behavior, geometry reading, notable
  points, solve/simplify/derive/integral units, expansion-guard limits, tracer tool.
- `tests/zoom.test.ts` (`npm run test:zoom`, ~80 s): the anti-regression sweep for "the
  curve disappears / flickers when zooming out" — each bounded curve traced across ~150
  viewports × 2 canvas sizes × 2 passes, asserting **traced world length** (branch count
  was tried and let the bug through: the same drawing can come out as 2 or 4 polylines).

`npm run test:todo` chains both. Build is esbuild, bundling `main.ts` → CJS `main.js`
(target es2018, `obsidian` external).

---

## 15. Cross-cutting invariants

A consolidated list of the rules the code depends on (each stated or enforced in the files
cited):

1. **Single normalization route** — every consumer compiles
   `insertarProductoImplicito(normalizarEntrada(s))`; panel, engine, solver, derivative,
   integral, ⓘ and tracer therefore agree byte-for-byte on semantics
   (`construirObjeto.norm`, `ladoALatex`, `despejar.norm`, `derivarExpr`, `integral.ts`).
2. **Non-finite = no curve** — every oracle coerces non-numbers to NaN; every geometric
   stage treats non-finite as a domain hole (`fields/*`, tracers).
3. **Camera invariance of geometry** — providers are deterministic in (region, resolution,
   tolerance); the single-entry cache and the pan stability depend on it
   (`contracts/proveedor.ts`, `ProveedorConCache`).
4. **Renderer/interaction agnosticism** — nothing above a provider knows which algorithm
   made a `Rama` ("no se nota la estrategia": `contracts/geometria.ts`,
   `RendererCanvas2D`, `Crosshair`, `lecturaRama`).
5. **`parametro` gates per-x interaction** — present ⇔ branch is x-monotone; consumers
   (`yEnRamas`, `curvaRecorrible`) rely on it rather than on curve type.
6. **Formal algebra never overrides numerics** — every symbolic rewrite (simplify, solve
   branches, derivative candidates, antiderivatives, odd-root reductions) is validated by
   numeric sampling with domain fidelity before being shown or plotted
   (`formasEquivalentes`, `ramaReal`, `derivadasEquivalentes`, `verificaNumerica`,
   `despejeCuadratico(DVal)`).
7. **Determinism over timeouts** — all budgets are counts (expansion monomials,
   evaluations, subdivisions, points, intersection caps), never wall-clock
   (`formatoExpr.ts`, `TrazadorContinuacion`, `DescubrimientoMuestreado`,
   `interseccionesRamas`).
8. **Fail visibly, fail flat** — unrecognized commands, degenerate functions and absent
   values produce a *labelled* veil or a saturation message; over-cap enumerations are
   dropped entirely rather than shown as a biased subset (`comandosNoSoportados`,
   `clasificarBloque`, `interseccionesSaturadas`).
9. **Ring discipline** — contracts import nothing; Ring 1 never imports mathjs or
   Obsidian; mathjs enters only through `fields/` + Ring 2; Obsidian only through Ring 3.
10. **Diagnostics have one home** — for `obs-integral`, all verdict labels render on the
    plot; the formula panel shows formulas only (`cuerpoAreaLatexExacto`,
    `etiquetaIntegral`, `clasificarBloque`).
