// The renderer. It draws ranges of instances over a table of layers and knows nothing of mountains.

import { BYTES, FORMAT, LAYERS, LADDER, VERTEX, FRAGMENT } from './glsl.js';

export const GLYPH0 = 2;   // glyph ids 0 and 1 are not characters (0 is a solid)

export function makeGL(canvas, { font, chars, force = false, heat = false }) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: !force });
  if (!gl) return null;
  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT)); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const U = {}; for (let i = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) - 1; i >= 0; i--) { const n = gl.getActiveUniform(program, i).name.replace('[0]', ''); U[n] = gl.getUniformLocation(program, n); }
  ['uAtlas', 'uMetrics', 'uWash'].forEach((n, i) => gl.uniform1i(U[n], i));

  // the layer table
  const layers = new Float32Array(LAYERS * 12), ubo = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, ubo); gl.bufferData(gl.UNIFORM_BUFFER, layers.byteLength, gl.DYNAMIC_DRAW);
  gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, 'Layers'), 0); gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);

  // two buffers of instances: the world (appended to as it is made) and what is alive this frame
  const bank = (usage, bytes) => {
    const vao = gl.createVertexArray(), buf = gl.createBuffer(); let room = bytes;
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, room, usage);
    FORMAT.forEach((_, i) => { gl.enableVertexAttribArray(i); gl.vertexAttribDivisor(i, 1); });
    const point = (first) => { gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); FORMAT.forEach(([, n, type, at], i) => gl.vertexAttribPointer(i, n, gl[type], false, BYTES, first * BYTES + at)); };
    return { point, buf, grow(need, refill) { if (need <= room) return; while (room < need) room *= 2; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, room, usage); refill(); } };
  };
  const world = bank(gl.STATIC_DRAW, 1 << 22), live = bank(gl.DYNAMIC_DRAW, 1 << 17), chunks = []; let used = 0;

  // The atlas: every character at a ladder of sizes, set by the browser's own type, so type is the page's type at any size.
  const atlasTex = gl.createTexture(), metricsTex = gl.createTexture(), washTex = []; let typePx = 0;
  function atlas(type) {
    typePx = type;
    const [lo, hi] = LADDER, levels = hi - lo + 1, width = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE)), c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
    const metrics = new Float32Array(levels * 2 * 4 * (chars.length + GLYPH0)), place = []; let px = 0, py = 0, shelf = 0;
    for (let l = 0; l < levels; l++) {
      const q = type * 2 ** ((l + lo) / 4); x.font = `${q}px ${font}`;
      [...chars].forEach((ch, g) => {
        const m = x.measureText(ch), left = Math.ceil(m.actualBoundingBoxLeft) + 1, top = Math.ceil(m.actualBoundingBoxAscent) + 1;
        const w = left + Math.ceil(m.actualBoundingBoxRight) + 1, h = top + Math.ceil(m.actualBoundingBoxDescent) + 1;
        if (px + w > width) { px = 0; py += shelf; shelf = 0; }
        place.push([ch, q, px + left, py + top]);
        metrics.set([px, py, w, h, -left, -top, (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2], ((g + GLYPH0) * levels + l) * 8);
        px += w; shelf = Math.max(shelf, h);
      });
    }
    if (py + shelf > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('the type does not fit a texture');
    c.width = width; c.height = py + shelf; x.fillStyle = '#fff'; x.textBaseline = 'alphabetic';
    for (const [ch, q, gx, gy] of place) { x.font = `${q}px ${font}`; x.fillText(ch, gx, gy); }
    const rgba = x.getImageData(0, 0, c.width, c.height).data, a = new Uint8Array(c.width * c.height);
    for (let i = 0; i < a.length; i++) a[i] = rgba[i * 4 + 3];
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, c.width, c.height, 0, gl.RED, gl.UNSIGNED_BYTE, a);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, metricsTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, levels * 2, chars.length + GLYPH0, 0, gl.RGBA, gl.FLOAT, metrics);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
  }

  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture()); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));   // no ground until a lobe brings one
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, heat ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(U.uHeat, heat ? 1 : 0); gl.depthFunc(gl.LEQUAL);
  const set = { f: (n, v) => gl.uniform1f(U[n], v), v3: (n, a, b, c) => gl.uniform3f(U[n], a, b, c), v2: (n, a, b) => gl.uniform2f(U[n], a, b), v4: (n, a, b, c, d) => gl.uniform4f(U[n], a, b, c, d), fv3: (n, arr) => gl.uniform3fv(U[n], arr), fv4: (n, arr) => gl.uniform4fv(U[n], arr) };
  let lit = -1, test = -1, wash = -1, mask = -1;
  return {
    gl, layers, set, glyph: (ch) => { const i = chars.indexOf(ch); if (i < 0) throw new Error(`no glyph for ${ch}`); return i + GLYPH0; },
    get typePx() { return typePx; }, atlas,
    resize(w, h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); },
    // add instances to the world; returns the index of the first
    append(bytes) { const first = used / BYTES; chunks.push([used, bytes]); used += bytes.byteLength; world.grow(used, () => { for (const [at, b] of chunks.slice(0, -1)) gl.bufferSubData(gl.ARRAY_BUFFER, at, new Uint8Array(b)); }); gl.bindBuffer(gl.ARRAY_BUFFER, world.buf); gl.bufferSubData(gl.ARRAY_BUFFER, first * BYTES, new Uint8Array(bytes)); return first; },
    // a lobe's ground: one texel per cell, premultiplied
    wash(i, w, h, rgba) {
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, washTex[i] = gl.createTexture()); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
      wash = -1;
    },
    // a frame: the sky, the layer table, what is alive
    begin(sky, liveBytes, liveCount) {
      gl.depthMask(true); gl.colorMask(true, true, true, true); gl.clearColor(heat ? 0 : sky[0], heat ? 0 : sky[1], heat ? 0 : sky[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.bindBuffer(gl.UNIFORM_BUFFER, ubo); gl.bufferSubData(gl.UNIFORM_BUFFER, 0, layers);
      if (liveCount) { gl.bindBuffer(gl.ARRAY_BUFFER, live.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, liveBytes, 0, liveCount * BYTES); }
      lit = test = mask = -1;
    },
    // draw a range. o.live: from the live buffer · o.test: hidden behind nearer opaque lobes · o.lit: after the dark · o.wash: [texture, x, y, w, h] · o.mask: depth only
    draw(first, count, o) {
      if (count <= 0) return;
      (o.live ? live : world).point(first);
      const m = o.mask ? 1 : 0, t = o.test || m ? 1 : 0, l = o.lit ? 1 : 0;
      if (m !== mask) { gl.colorMask(!m, !m, !m, !m); gl.depthMask(!!m); gl.uniform1f(U.uMask, m); mask = m; }
      if (t !== test) { t ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST); test = t; }
      if (l !== lit) { gl.uniform1f(U.uLit, l); lit = l; }
      if (o.wash && o.wash[0] !== wash) { wash = o.wash[0]; gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, washTex[wash]); gl.uniform4f(U.uWashBox, o.wash[1], o.wash[2], o.wash[3], o.wash[4]); }
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    },
  };
}
