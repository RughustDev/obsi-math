# 1.2.7

## No generated code: the expression compiler no longer uses `new Function`

A maintenance release with a single change. 1.2.6 introduced a native
expression compiler that made tracing 2.3× to 18× faster by generating
JavaScript source at runtime and compiling it with the `Function`
constructor. That is dynamic code execution: it requires `unsafe-eval` in the
Content Security Policy, and it means the plugin's behavior cannot be
determined by reading the plugin's code, since part of what runs is a string
assembled while it runs. This release removes it without giving up the speed.

- **Expressions are now compiled to a tree of closures instead of to source
  code.** The compiler walks the same mathjs AST as before, but each node
  becomes a nested JavaScript function that has already resolved — closed over
  — which operation it performs and what its operands are. Evaluating means
  descending that tree calling ordinary functions; there is no typed-function
  dispatch, no scope object and no name lookup left in the sampling loop, which
  is where the original speedup came from. This is closure compilation: the
  work that depends only on the *expression* is done once, and only the work
  that depends on the *point* remains per sample. No string is ever turned into
  a program, so `eval` and the `Function` constructor are both gone from the
  plugin, and `unsafe-eval` is no longer needed.

  Compiled closures take a fixed two-argument signature even when the
  expression has one variable. That is deliberate: it avoids allocating an
  argument array on every evaluation and keeps the call sites inside the tree
  monomorphic, which is most of the difference between a closure tree that is
  fast and one that is not.

  Closures are somewhat slower than generated source on large expressions, and
  measuring that honestly matters more than the headline. Against the 1.2.6
  implementation, over 300,000 evaluations per expression: `sin x` 12.7 ms →
  11.8, `x³−3x+1/x` 14.0 → 15.1, `(x²+y²−1)³−x²y³` 19.1 → 17.9,
  `sin(1/x)·e^(−x²)+ln(|x|+1)` 16.2 → 39.0, `sin(xy)+cos x/(1+y²)` 29.3 →
  63.1. So the worst case measured gives up a factor of 2.4 against generated
  code — while still evaluating 8.4× to 26.8× faster than mathjs, which is the
  comparison that decides frame time, since mathjs takes 222 ms to 530 ms on
  those same runs. The tracing speedup of 1.2.6 therefore stands.

  The three safeguards are unchanged and still apply: a whitelist that refuses
  anything whose semantics have not been verified against mathjs, a
  differential validation of the compiled function against mathjs over ~40
  probe points before it is used, and a fallback to the mathjs path whenever
  either fails.

No behavior changes: both suites pass unmodified — 345 tests in the main suite
and 12 in the zoom suite — which between them cover the tracing geometry the
compiler feeds.
