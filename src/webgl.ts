// ─────────────────────────────────────────────
// WebGL — utilidades de bajo nivel
// ─────────────────────────────────────────────

function crearShader(gl: WebGLRenderingContext, tipo: number, fuente: string): WebGLShader {
  const shader = gl.createShader(tipo)!;
  gl.shaderSource(shader, fuente);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error("Shader: " + gl.getShaderInfoLog(shader));
  return shader;
}

export function crearPrograma(gl: WebGLRenderingContext): WebGLProgram {
  const vert = crearShader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
  `);
  const frag = crearShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec4 u_color;
    void main() { gl_FragColor = u_color; }
  `);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error("Programa WebGL: " + gl.getProgramInfoLog(prog));
  return prog;
}

// Convierte una lista de puntos en clip space a tira de quads con grosor dado
export function construirQuadStrip(puntos: number[], grosorClip: number): Float32Array {
  const verts: number[] = [];
  const n = puntos.length / 2;
  if (n < 2) return new Float32Array(0);

  for (let i = 0; i < n - 1; i++) {
    const x0 = puntos[i * 2], y0 = puntos[i * 2 + 1];
    const x1 = puntos[(i + 1) * 2], y1 = puntos[(i + 1) * 2 + 1];

    // Vector perpendicular normalizado
    let dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) continue;
    dx /= len; dy /= len;
    const nx = -dy * grosorClip, ny = dx * grosorClip;

    // Dos triángulos formando un quad
    verts.push(
      x0 + nx, y0 + ny,
      x0 - nx, y0 - ny,
      x1 + nx, y1 + ny,
      x1 - nx, y1 - ny,
      x1 + nx, y1 + ny,
      x0 - nx, y0 - ny
    );
  }
  return new Float32Array(verts);
}
