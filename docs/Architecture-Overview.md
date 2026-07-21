# LMath — Architecture Overview

Four Obsidian code blocks, one symbolic layer, one geometry engine. Companion to the
[Technical Reference](https://github.com/LubrieDev/lmath/blob/main/docs/TECHNICAL-REFERENCE.md),
which has the detail.

---

## Pipeline

```
block source
    │
    ├─ split into equations ─→ parse & normalize ─→ ObjetoMatematico
    │                                                    │
    │                                    ┌───────────────┴───────────────┐
    │                                    ▼                               ▼
    │                          LEFT: formula panel              RIGHT: canvas
    │                          simplify · solve for y           oracle → provider
    │                          derivative · integral            → tracer → Rama[]
    │                                    │                               │
    │                                    └──────→ LaTeX          renderer + overlay
```

---

## Rings

Dependencies point inward. Enforced by import discipline.

| Ring | Content | mathjs | DOM |
|---|---|---|---|
| **0** | Contracts — pure types, zero logic, zero deps | no | no |
| **1** | Numeric geometry — tracing, discovery, analysis, scene, rendering | no | canvas only |
| **2** | Symbolic layer — parsing, algebra, LaTeX | yes | no |
| **3** | Host — Obsidian plugin, settings, panels | indirect | yes |

---

## Symbolic layer — Ring 2

| Module | Role |
|---|---|
| `parser.ts` | LaTeX/Unicode → mathjs. The single normalization route every consumer shares. |
| `formatoExpr.ts` | Shared algebra toolkit: terms, factors, canonical order, the `rationalize` expansion guard. |
| `simplificar.ts` | Simplify, gated by a numeric equivalence check including non-finiteness. |
| `despejar.ts`<br>`despejeInverso.ts` | Solve for `y`: layer inversion, denominator clearing, affine-by-evaluation, radical rationalization. Every non-equivalence carries a guard or is rejected. |
| `condiciones.ts` | Resolves the domain guards as one system of inequalities (sign table + intersection), so a domain reads `x ≥ √3`. |
| `derivar.ts` · `integrar.ts`<br>`integral.ts` | Symbolic derivative and antiderivative; definite-integral notation and area. |
| `latex.ts` | The one typographic pipeline. Panel and plot never disagree because both start from the same normalized string. |
| `motor/fields/` | The mathjs boundary: expressions compiled into numeric oracles. Nothing below this imports mathjs. |

---

## Geometry engine — Ring 1

| Module | Role |
|---|---|
| `motor/providers/` | One strategy per curve kind behind a single seam `geometria(viewport, tolerancia)`: explicit, implicit, rasterized, separable, periodic, parametric/polar, plus cache and union decorators. |
| `motor/tracing/` | Oracles → polylines: adaptive sampler, parametric sampler, continuation, marching squares. |
| `motor/discovery/` | Where is the curve? Sign-change seeds on a grid. |
| `motor/analysis/` | Reads the produced geometry: roots, vertices, intersections, rail progression, signed area. |
| `motor/scene/`<br>`motor/rendering/`<br>`motor/interaction/` | Scene orchestration and auto-framing; Canvas-2D renderer and overlay; camera and gestures. |

---

## Host — Ring 3

| Module | Role |
|---|---|
| `main.ts` | Registers the four block languages and the settings tab. |
| `host-obsidian/` | Per-block orchestration, formula panels, settings, i18n, fonts. |
| `engines/obs-graph/` | Legacy WebGL engine, kept behind a compile-time flag as a fallback. |

---

## Invariants

- **One normalization route.** Panel, engine, solver, derivative and tools agree byte for byte
  on what an expression means.
- **Formal algebra never overrides numerics.** Every symbolic rewrite is validated by
  sampling, with domain fidelity, before being shown or plotted.
- **A transformation that is not an equivalence states its condition or is rejected.** Never a
  formula laxer than the curve.
- **Non-finite means no curve.** Every oracle coerces to NaN; every geometric stage reads that
  as a hole.
- **The strategy is invisible.** Nothing above a provider knows which algorithm drew a branch.
- **Determinism over timeouts.** Budgets are counts, never wall-clock, so caches and tests stay
  stable.
- **Fail visibly, fail flat.** A labelled veil instead of a wrong or partial answer.

---

## Tests

| Command | Covers |
|---|---|
| `npm run test` | Engine and symbolic units. Run on every change. |
| `npm run test:zoom` | Zoom-out sweep: the curve must not vanish or flicker. |
| `npm run fuzz` | Differential fuzzer for solver soundness. The `UNSOUND` column must stay at zero. |
| `npm run bateria` | Graduated battery for solver completeness and domain. |
