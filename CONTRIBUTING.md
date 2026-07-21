# Contributing to LMath

Thanks for taking the time. Bug reports, feature requests and pull requests are all welcome.

- **Architecture and internals:** [`docs/TECHNICAL-REFERENCE.md`](https://github.com/LubrieDev/lmath/blob/main/docs/TECHNICAL-REFERENCE.md)
- **One-page map:** [`docs/Architecture-Overview.md`](https://github.com/LubrieDev/lmath/blob/main/docs/Architecture-Overview.md)

---

## Contents

- [Getting set up](#getting-set-up)
- [Development workflow](#development-workflow)
- [Tests](#tests)
- [Debugging without rendering](#debugging-without-rendering)
- [Reporting a bug](#reporting-a-bug)
- [Pull requests](#pull-requests)
- [Code conventions](#code-conventions)
- [The rules that are not negotiable](#the-rules-that-are-not-negotiable)
- [Releases](#releases)

---

## Getting set up

Requirements: **Node.js**, **npm** and an Obsidian vault to test in (the plugin targets
Obsidian `1.12.7` and above). TypeScript and esbuild come from `npm install`.

```bash
git clone https://github.com/LubrieDev/lmath.git
cd lmath
npm install
npm run build
```

`npm run build` bundles `main.ts` into `main.js`. To try it in Obsidian, copy `main.js`,
`manifest.json` and `styles.css` into `<your-vault>/.obsidian/plugins/lmath/` and enable the
plugin under **Settings → Community plugins**.

A practical setup is to clone the repository *directly* into the plugins folder of a scratch
vault, so `npm run build` writes `main.js` where Obsidian already reads it. Reload the plugin
(or the vault) to pick up a new build.

> **UTF-8 without BOM.** `manifest.json` and every `.ts` file must be saved without a byte
> order mark. A BOM at the start of any of them can break parsing inside Obsidian or produce
> silent build errors.

---

## Development workflow

```
edit → npm run build → reload in Obsidian → verify visually → npm run test
```

Keep a known-good `main.js` around while you experiment; restoring it is the fastest way back
if a build misbehaves in the vault.

---

## Tests

The runner is a zero-dependency micro-runner (`tests/runner.ts`), so there is nothing to
install and nothing to configure.

| Command | What it covers | Cost |
|---|---|---|
| `npm run test` | Engine and symbolic units: sampling, continuation, caching, geometry reading, notable points, solve/simplify/derive/integrate, condition systems | seconds — **run on every change** |
| `npm run test:zoom` | Zoom-out sweep: each bounded curve traced across ~150 viewports, asserting traced world length | ~1 min |
| `npm run test:todo` | The two above, chained | |
| `npm run fuzz` | Differential fuzzer for **solver soundness**: generated equations per strategy family; every result marked complete must satisfy its original equation numerically | minutes |
| `npm run bateria` | Graduated battery for **solver completeness**: every real root of the original must be claimed by the solved form | ~1 min |

**Which ones to run.** `npm run test` always. Add `npm run test:zoom` if you touched tracing,
scene or rendering. Add `npm run fuzz` and `npm run bateria` if you touched anything under the
solver (`despejar.ts`, `despejeInverso.ts`, `condiciones.ts`, `simplificar.ts`,
`formatoExpr.ts`).

In the fuzzer output, the only column that must never be non-zero is **`UNSOUND`**. A
`vacuo` count means the checker found no points to compare at, not a failure.

**Changing an expected value in a test is a decision, not a chore.** These suites are the
project's guarantee that a formula shown to the user is true. If your change makes an
assertion fail, work out which of the two is wrong before editing either — and if you do
update an expectation, say so explicitly in the pull request.

---

## Debugging without rendering

The transform tracer shows what each pipeline step produces — the mathjs string, the rendered
LaTeX and diagnostics — without drawing anything:

```bash
npm run trazar                                     # bundles the CLI once
node herramientas/.trazar.cjs obs-graph "x^3+y^3=9"
node herramientas/.trazar.cjs obs-integral "\int_{0}^{2}x^2\,dx"
```

Flags `--grafica`, `--latex` and `--diagnostico` narrow the output to one facet; with none,
you get everything. Run it with plain `node`, **not** `npm run trazar --` — on Windows,
cmd.exe corrupts `^` and parentheses in the argument.

It reuses the same functions as the panel and the engine, so what it prints is what the plugin
would do.

---

## Reporting a bug

Open an issue with:

1. **The block, verbatim** — the language (`obs-graph`, `obs-system`, `obs-derivate`,
   `obs-integral`) and its exact contents. Most bugs live in the input.
2. **What you expected and what you got.** A screenshot helps for anything visual.
3. **Versions** — plugin, Obsidian, and OS.

For a wrong formula or a wrong curve, the tracer output for your input (see above) is worth
more than any description.

---

## Pull requests

- **One concern per PR.** A bug fix and a refactor in the same diff are hard to review and
  harder to revert.
- **Say what you verified**, not just what you changed: which suites you ran, and what you
  checked by hand in the vault. If you did not run something, say that too.
- **Cover new behavior with a test.** New code should also not introduce lint warnings.
- Do not commit build output changes on their own; `main.js` is regenerated by `npm run build`.
- Commit messages: imperative mood, prefixed by kind (`feat:`, `fix:`, `chore:`, `docs:`).

---

## Code conventions

The codebase is written with **Spanish identifiers and comments**. That is deliberate and
consistent — please match it rather than mixing languages. User-facing strings go through
`src/i18n/`.

Comments explain **why**, not what. The reason a guard exists, the measurement that motivated
a budget, or the bug a branch prevents is worth writing down; a paraphrase of the next line is
not. Match the density of the file you are editing.

Prefer finding the one change that removes a whole class of problems over adding a special
case for the input in front of you. If a fix only works for a specific equation, it probably
belongs somewhere else.

---

## The rules that are not negotiable

These hold across the codebase and reviews check them (the full list is §15 of the Technical
Reference):

- **Formal algebra never overrides numerics.** Every symbolic rewrite — simplification, a
  solved branch, a derivative, an antiderivative — is validated by numeric sampling, with
  domain fidelity, before it is shown or plotted.
- **A transformation that is not an equivalence states its condition or is rejected.** Squaring
  both sides, clearing a denominator or inverting an even root can gain or lose points. Either
  the result carries the condition that makes it true, or it is not emitted. A partial answer
  is always better than a formula laxer than the curve.
- **Fail visibly, fail flat.** When something is out of scope, say so — a labelled veil, a
  partial form, a `null`. Never a plausible-looking wrong answer, and never a biased subset of
  an enumeration that overflowed.
- **Determinism over timeouts.** Budgets are counts (monomials, evaluations, subdivisions),
  never wall-clock, so results are reproducible and caches stay valid.
- **Ring discipline.** Contracts import nothing. The geometry engine never imports mathjs or
  Obsidian; mathjs enters only through `motor/fields/` and the symbolic layer, Obsidian only
  through the host. This is what keeps the engine testable in plain Node.

---

## Releases

Maintainer task. Bump the version in `manifest.json`, `package.json` and `versions.json` (the
latter maps the version to its `minAppVersion`), write the notes in `releases/`, run
`npm run build`, and tag. Publishing a GitHub release triggers the workflow in
`.github/workflows/` that attaches and attests `main.js` and `styles.css`.

---

By contributing you agree that your contributions are licensed under the
[MIT License](https://github.com/LubrieDev/lmath/blob/main/LICENSE).
