# 1.1.8

## Maintenance

Maintenance release with **no user-facing feature changes**. It clears the
remaining warnings from Obsidian's automated plugin review — the loose
type-safety, logging and CSS items left after 1.1.7 cleared the large `Nodo`
group. No graphing, equation-solving, derivative, integral, or parsing behavior
was changed, and the rendered output is visually identical.

- **Type safety.** Typed the few remaining spots that still produced `any`:
  the sampling arrays in function analysis, the root-conversion callback in the
  parser, and the complex-number check in degenerate-function detection. These
  were isolated leftovers, unrelated to the symbolic AST refactor of 1.1.7.
- **Console logging.** The terminal tracer CLI now writes its output directly to
  stdout instead of going through `console`. The in-app developer console (the
  `lmath.*` global in DevTools, kept in place through 1.1.7) has been removed
  from the plugin; the exact same tracing is still available from the terminal
  via `npm run trazar`.
- **Styles.** Removed the `!important` declarations from `styles.css`, relying on
  more specific selectors instead, and replaced the unknown MathJax type
  selectors (`mjx-container` / `mjx-math`) with their class equivalents. The
  formula panel — size, horizontal scroll and edge fades — renders exactly as
  before.

Existing behavior is unchanged: the full test suite passes exactly as before.
