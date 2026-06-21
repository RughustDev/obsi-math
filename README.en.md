# obsi-math

[Obsidian](https://obsidian.md) plugin for plotting mathematical functions directly in your notes, using `obs-math` code blocks. It renders the expression in LaTeX, draws the graph with a WebGL + Canvas 2D engine (Desmos-style), and automatically calculates roots, vertices, and intercepts.

---

## Features

- 📈 Real-time plotting with a WebGL engine (curves) + Canvas 2D overlay (axes, grid, labels).
- ✏️ LaTeX rendering of the input expression.
- 🔍 Interactive zoom and pan with the mouse.
- 📍 Automatic detection of roots, vertices (maxima/minima), and Y-intercept.
- ⚡ Vertical asymptotes detected and drawn as dashed lines.
- 🎨 Desmos-style aesthetic: subtle grid, discrete axes, crisp special points on any display.
- 🔤 Input support for LaTeX, Unicode (`π`, `√`, `×`, `÷`, `²`, `³`), and standard math notation.

---

## Installation

### Manual

1. Download `main.js` and `manifest.json` from the latest release.
2. Create an `obsi-math` folder inside `<your-vault>/.obsidian/plugins/`.
3. Copy the files there.
4. In Obsidian: **Settings → Community plugins** → enable **Obsi Math**.

### From source

```bash
git clone https://github.com/RughustDev/obsi-math.git
cd obsi-math
npm install
npm run build
```

Copy the generated `main.js` (along with `manifest.json`) into your vault's plugins folder.

---

## Usage

Create a code block with the `obs-math` language and write your function:

````markdown
```obs-math
x^2 - 4
```
````

You can also write the full equation; the plugin automatically takes the right-hand side:

````markdown
```obs-math
f(x) = sin(x) * 2
```
````

The block renders the expression in LaTeX, the interactive graph, and calculated data: Y-intercept, real roots, and vertices.

**More examples:**

````markdown
```obs-math
1/(x-2)
```
````

````markdown
```obs-math
sqrt(x) + 1
```
````

### Graph interaction

| Action | Effect |
|---|---|
| Drag | Pans the view |
| Mouse wheel | Zoom in/out centered on the cursor |

---

## Input syntax

The plugin normalizes different input formats before evaluating them with [mathjs](https://mathjs.org/):

| Type | Examples |
|---|---|
| Unicode | `π`, `√`, `×`, `÷`, `²`, `³`, `∞` |
| LaTeX | `\frac{1}{2}`, `x^{2}`, `\sqrt{x}`, `\sin{x}`, `\log_{2}{x}` |
| Standard | `sin(x)`, `cos(x)`, `log(x, 2)`, `sqrt(x)` |

**Trigonometry:** a literal numeric argument (e.g. `sin(30)`) is interpreted in **degrees**. If it contains a variable (e.g. `sin(x)`), it's evaluated in radians.

---

## Known issues

- **LaTeX rendering of `\sqrt`, `\log`, etc. without braces:** if you write `\sqrt{x}` without the braces (for example, mistyped or miscopied), the LaTeX may render broken on screen (e.g. `\sqrtx`). The graph itself is still calculated and drawn correctly — the issue is purely visual, in the formula rendering. Always make sure to use braces: `\sqrt{x}`, not `\sqrtx`.
- Adaptive curve sampling (for discontinuities like `tan(x)`) was tried but reverted due to visual artifacts; a fixed/dynamic resolution sampling is currently used instead.

---

## obs-sistema (temporarily disabled)

The plugin includes an `obs-sistema` block for solving and graphing linear equation systems, but it's **currently disabled**: using it only shows a notice.

Reason: it's still a very basic feature, with noticeable lag during zoom and pan (dragging the view). Development is currently focused on polishing `obs-math`, so `obs-sistema` will be revisited and improved later on.

To re-enable it during development, in `main.ts`:

```typescript
private readonly OBS_SISTEMA_HABILITADO = false; // → true
```

---

## Development

Requirements: Node.js, npm, TypeScript.

```bash
npm run build
```

Recommended workflow: edit `main.ts` → compile → copy `main.js` to a test vault → verify → back up if it works, restore if it breaks.

> `manifest.json` must be saved as **UTF-8 without BOM**; a BOM at the start breaks its parsing in Obsidian.

---

## Roadmap

- [ ] Re-enable and polish `obs-sistema` (zoom/pan performance).
- [ ] Info panel integrated directly into the graph.
- [ ] Global settings (decimal precision, theme).
- [ ] Trig unit selector (degrees/radians/gradians).
- [ ] Full rich LaTeX input support.

---

## License

MIT — see [LICENSE](./LICENSE).

## Repository

[github.com/RughustDev/obsi-math](https://github.com/RughustDev/obsi-math)