# 1.2.4

## Features

Minor release that widens **solving for `y`** past the "one occurrence of `y`"
frontier of 1.2.3, and gives **obs-integral** the quotient rule it was missing.
The new solver paths are general rewrites over the AST — clear the denominators,
collect the linear coefficient, square away the radicals — not per-equation
cases. Every transformation that is not an equivalence now states its condition
or is rejected: a solved form still never claims a point the curve doesn't have.
And the conditions that survive are now **solved as a system** instead of listed,
so a domain reads `x ≥ \sqrt3` rather than as two raw inequalities. The full test
suite (334 tests), the zoom suite (12) and the graduated battery (220 generated
towers) pass.

- **`y` no longer has to occur once — it has to be *grouped*.** The structural
  inverter peels the outermost layer and recurses into the child holding `y`,
  which never needed `y` to be unique: the whole layer is inverted at once, so it
  is enough that a single child contains it. When the tower gets stuck — `y`
  split across both branches of an operator — what has been peeled so far is an
  equivalent, simpler equation, and it is re-solved from scratch:
  `\ln\frac{y-1}{y+2}=x → y=\frac{2e^x+1}{1-e^x}`,
  `e^{\frac{y-1}{y+2}}=x → y=\frac{2\ln x+1}{1-\ln x}`,
  `\ln(y^2+y)=x → y=\frac{-1±\sqrt{4e^x+1}}{2}`.

- **`y` in a denominator is cleared and the equation re-solved.** No additive
  strategy could reach a `y` sitting in a factor of exponent −1 unless the
  numerator was free of `y`. Multiplying through by the denominators — the first
  step of any textbook solution — leaves a polynomial equation the existing
  machinery finishes: `\frac{y-1}{y+2}=x → y=\frac{2x+1}{-x+1}`.

- **Equations affine in `y` whose coefficient needs expanding.** A sum of terms
  each carrying a bare `y` (`y\ln x+y=3`) already worked; what fell through was
  `y` inside a *group* that has to be distributed first, when the coefficient is
  not polynomial — the linear strategy reads the coefficient off the *structure*
  of the term, so `y` has to be a bare factor, and the quadratic path needs
  `rationalize` to expand, which only works on polynomials. Since an affine
  function is fixed by two values, `A` and `B` are now recovered by
  *substituting* two values of `y` — substitution works with any coefficient, no
  expansion needed — and the affinity itself is what gets checked numerically:
  `y-(y+2)e^x-1=0 → y=\frac{2e^x+1}{1-e^x}` (this is the shape the cleared
  Möbius above lands on, and it is what makes that case finish).

- **Scattered square roots are rationalized by successive squaring, carrying the
  domain condition of every step.** One isolated root was already invertible, but
  two roots — or a root plus `y` outside it — leave `y` ungrouped and no layer
  peelable. Isolating one root and squaring, repeated, produces a polynomial the
  solver finishes. Squaring is **not** an equivalence (`A=B ⟺ A²=B²` *and*
  `B≥0`), so each step records its guard and all of them travel to the result as
  domain conditions, written in `x` by substituting back what the later steps
  determined: `\sqrt{y+1}+\sqrt{y-2}=x → y=\frac{x^4+2x^2+9}{4x^2}` with
  `x ≥ \sqrt3` (the two raw guards, resolved into one by the condition
  simplifier below). Verified point by point: the solved form draws nothing for
  `x<\sqrt3` and has no gap above it.

- **Domain conditions are now solved as a *system*, not listed one by one.** Each
  restricted-range layer and each squaring step contributes its own guard, and
  the panel used to print all of them — correct but unreadable, because they are
  inequalities over the same `x` and nobody was looking at the system as a whole.
  A new module resolves each condition by its **sign table** (the zeros of
  numerator and denominator split the line into constant-sign runs) and
  intersects the results, which is where redundant conditions vanish on their
  own, adjacent runs merge, and contradictions surface as an empty intersection.
  So `\frac{x^2+3}{2x}≥0,\ \frac{x^2-3}{2x}≥0` is displayed as what it says:
  `x ≥ \sqrt3`. Critical points are computed **symbolically** precisely because
  they are what gets displayed — the root of `x^2-3` has to read `\sqrt3`, not
  `1.7320508` — so `-x^2+2 ≥ 0` becomes `-\sqrt2 ≤ x ≤ \sqrt2` and `x-27 ≥ 0`
  becomes `x ≥ 27`. Its declared reach is closed-form roots: degree 1, degree 2
  by the general formula (with the square factor pulled out of the radical,
  `\sqrt{12}=2\sqrt3`), and higher degrees only where integer roots deflate them.
  Anything else — a guard with `\tan x`, `|x|`, `\sqrt x`, or a solution set made
  of disjoint pieces — leaves the conditions displayed exactly as before: the
  module's failure mode is "I don't simplify", never "I simplify wrongly". It is
  presentation only; the engine keeps evaluating the original guards, so what is
  drawn does not change.

- **Contradictory guards are detected across the whole system.** Each guard can
  be satisfiable on its own while the system is not, and the per-guard check
  could not see that. An empty intersection now means there is no real curve and
  the equation is left in its reduced form instead of carrying a formula that
  never applies.

- **obs-integral: the logarithmic derivative `∫\frac{c·q'}{q}=c\ln|q|`.** A
  quotient with `x` in *both* numerator and denominator always returned "no
  antiderivative". The ratio `p/q'` is measured by finite differences rather than
  by symbolic differentiation, so it does not depend on mathjs being able to
  differentiate `\csc` or `\abs`. This covers `∫\frac{2x}{x^2+1}`,
  `∫\frac{3x^2+2}{x^3+2x-5}`, `∫\cot`, `∫\frac{f'}{f}` in general.

- **obs-integral: trigonometric canonicalisation as a retry.** Expressions
  written "by identity" reduce to something the structural rules recognise once
  `\csc/\sec/\cot/\tan` are rewritten in `\sin`/`\cos` and the double angle is
  opened: `∫\frac{1}{\csc 2x-\cot 2x}` collapses to `∫\cot x = \ln|\sin x|`. The
  original form is always integrated first, so `∫\sin 2x` still gives
  `-\frac{\cos 2x}{2}` and not the expanded version. Also adds the missing
  `\cot`, `\sec` and `\csc` table entries (with linear substitution:
  `∫\cot 3x = \frac{\ln|\sin 3x|}{3}`).

## Bug fixes

- **Clearing a denominator no longer invents branches.** Multiplying by `q` only
  preserves the curve where `q≠0`, and the cleared equation *is* defined there —
  so it can carry solutions that do not exist. `\frac{y^2-1}{y-1}=x` clears to
  `y^2-1=x(y-1)`, whose roots are `y=x-1` **and** `y=1`, and the second is not
  curve at all (the original is `0/0` at `y=1`). Since a `≠` condition cannot be
  written with the existing `≥0` domain sentinel, the candidate is instead
  validated branch by branch against the equation *before* multiplying — the only
  one that knows about its own holes — and the whole solution is dropped if any
  branch contradicts it.

- **Removable holes are no longer silently filled.** `\frac{y^2-4}{y+2}=x` is
  affine in `y` throughout its domain and solves to `y=x+2`, but the curve does
  not contain `y=-2`, i.e. the solved form is missing its hole at `x=-4` and is
  laxer than the curve. Same validation, same outcome: the equation is left in
  its reduced form rather than stated more loosely than it is true.

- **A singular sampling point no longer leaks into the formula.** Recovering the
  affine coefficients by substituting `y=0,1` hits `0/0` on an equation like
  `\frac{y^2-1}{y-1}`, and the resulting `Infinity` travelled all the way into
  the displayed solution (`y = ∞x + ∞`). Several sampling pairs are tried until
  one is clean, and a non-finite coefficient rejects the pair.

- **Both branches of a `±` are now validated, not just the principal one.** The
  numeric check evaluated the `±` sentinel at its principal value, so the second
  branch entered the result unchecked. Validation now runs over the expanded
  branches — exactly what the engine will draw. A branch that its own domain
  guard empties is not a failure (that is precisely the fate of the extraneous
  branch introduced by squaring); a branch that *contradicts* the equation is.
