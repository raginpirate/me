// <ascent-scene> — a hand-written WebGL night mountain.
// Camera starts at the summit under the stars and descends to the roots
// as the page scrolls. No libraries.

const VERT_TERRAIN = `
attribute vec3 aPos;
uniform mat4 uProj, uView;
uniform float uTime;
varying float vH;
varying float vDist;
varying vec3 vWorld;
void main() {
  vec4 world = vec4(aPos, 1.0);
  vec4 eye = uView * world;
  vH = aPos.y;
  vDist = -eye.z;
  vWorld = aPos;
  gl_Position = uProj * eye;
}`;

const FRAG_LINES = `
precision mediump float;
uniform vec3 uBg, uLow, uHigh, uEarth;
uniform float uPeak, uFade, uWarm, uTime;
varying float vH;
varying float vDist;
varying vec3 vWorld;
void main() {
  float snow = smoothstep(uPeak * 0.42, uPeak * 0.95, vH);
  vec3 col = mix(uLow, uHigh, snow);
  col = mix(col, uEarth, uWarm);
  float fog = exp(-vDist * 0.03);
  float a = (0.12 + 0.88 * fog) * uFade * 0.72;
  // lines close to the camera are too loud; let them fade in with distance
  a *= smoothstep(0.0, 11.0, vDist);
  gl_FragColor = vec4(col, a);
}`;

const FRAG_FILL = (derivatives) => `
${derivatives ? '#extension GL_OES_standard_derivatives : enable' : ''}
precision mediump float;
uniform vec3 uBg, uFillTop;
uniform float uPeak, uFade;
varying float vH;
varying float vDist;
varying vec3 vWorld;
void main() {
  float snow = smoothstep(uPeak * 0.3, uPeak, vH);
  ${derivatives
    ? `vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
       float lit = max(0.0, dot(n, normalize(vec3(-0.45, 0.75, 0.5))));
       float shade = 0.06 + 0.42 * lit * (0.3 + 0.7 * snow);`
    : `float shade = 0.1 + 0.25 * snow;`}
  vec3 col = mix(uBg, uFillTop, shade);
  float fog = exp(-vDist * 0.028);
  col = mix(uBg, col, fog);
  gl_FragColor = vec4(col, uFade);
}`;

const VERT_STARS = `
attribute vec3 aPos;
attribute vec2 aAttr; // x: magnitude 0..1, y: phase
uniform mat4 uProj, uView;
uniform float uTime, uDpr, uTwinkle;
varying float vMag;
varying float vTw;
void main() {
  vec4 eye = uView * vec4(aPos, 1.0);
  gl_Position = uProj * eye;
  float tw = 0.75 + 0.25 * sin(uTime * (0.6 + aAttr.x) + aAttr.y * 6.2831);
  tw = mix(1.0, tw, uTwinkle);
  vMag = aAttr.x;
  vTw = tw;
  gl_PointSize = (1.0 + aAttr.x * aAttr.x * 3.2) * uDpr * tw;
}`;

const FRAG_STARS = `
precision mediump float;
uniform vec3 uWhite, uWarm;
uniform float uFade;
varying float vMag;
varying float vTw;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.1, d);
  vec3 col = mix(uWhite, uWarm, step(0.985, vMag));
  gl_FragColor = vec4(col, a * (0.35 + 0.65 * vMag) * vTw * uFade);
}`;

const VERT_HALO = `
attribute vec3 aPos;
uniform mat4 uProj, uView;
uniform float uDpr, uSize;
void main() {
  gl_Position = uProj * uView * vec4(aPos, 1.0);
  gl_PointSize = uSize * uDpr;
}`;

const FRAG_HALO = `
precision mediump float;
uniform vec3 uColor;
uniform float uFade;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.18, 0.0, d);
  float glow = pow(max(0.0, 1.0 - d), 2.6) * 0.55;
  gl_FragColor = vec4(uColor, (core + glow) * uFade);
}`;

// ---------- small math ----------
const m4 = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  },
  lookAt(eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
    ]);
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    }
    return o;
  },
  transform(m, v) {
    const x = v[0], y = v[1], z = v[2];
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
      m[3] * x + m[7] * y + m[11] * z + m[15],
    ];
  },
};

// deterministic PRNG so the mountain is the same on every visit
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// value noise + fbm
function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const S = 256, perm = new Uint8Array(S * 2), grid = new Float32Array(S);
  for (let i = 0; i < S; i++) { perm[i] = i; grid[i] = rnd(); }
  for (let i = S - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < S; i++) perm[S + i] = perm[i];
  const fade = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const a = grid[perm[X + perm[Y]]], b = grid[perm[X + 1 + perm[Y]]];
    const c = grid[perm[X + perm[Y + 1]]], d = grid[perm[X + 1 + perm[Y + 1]]];
    const u = fade(xf), v = fade(yf);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  return function fbm(x, y, oct = 5) {
    let s = 0, amp = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f); n += amp; amp *= 0.5; f *= 2.05; }
    return s / n;
  };
}

const PEAK = 15;
const EXTENT = 44; // half-size of the terrain in world units
const fbm = makeNoise(20181105);

// the mountain: a tall central peak plus a secondary ridge, with fbm detail
function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  const peak = PEAK * Math.exp(-(r * r) / 170);
  const ridge = 6.5 * Math.exp(-((x + 14) ** 2) / 90 - ((z - 6) ** 2) / 260);
  const ridge2 = 5 * Math.exp(-((x - 17) ** 2) / 120 - ((z + 4) ** 2) / 300);
  const detail = (fbm(x * 0.09 + 3.1, z * 0.09 + 7.7, 5) - 0.5) * 5.2;
  const fine = (fbm(x * 0.35, z * 0.35, 3) - 0.5) * 0.9;
  const falloff = Math.max(0, 1 - Math.pow(r / (EXTENT * 1.05), 3));
  const base = -1.2;
  return base + (peak + ridge + ridge2 + (detail + fine) * (0.35 + 0.65 * Math.min(1, r / 10))) * falloff;
}

function buildTerrain(N) {
  const pos = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -EXTENT + (2 * EXTENT * i) / (N - 1);
    const z = -EXTENT + (2 * EXTENT * j) / (N - 1);
    const k = (j * N + i) * 3;
    pos[k] = x; pos[k + 1] = terrainHeight(x, z); pos[k + 2] = z;
  }
  const lines = [], tris = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * N + i;
    if (i < N - 1) lines.push(a, a + 1);
    if (j < N - 1) lines.push(a, a + N);
    if (i < N - 1 && j < N - 1) {
      // alternate the diagonal so the wire reads as a mesh, not a grid
      if ((i + j) & 1) { lines.push(a, a + N + 1); tris.push(a, a + N, a + N + 1, a, a + N + 1, a + 1); }
      else { lines.push(a + 1, a + N); tris.push(a, a + N, a + 1, a + 1, a + N, a + N + 1); }
    }
  }
  return { pos, lines: new Uint16Array(lines), tris: new Uint16Array(tris) };
}

function buildStars(count, seed) {
  const rnd = mulberry32(seed);
  const pos = new Float32Array(count * 3), attr = new Float32Array(count * 2);
  const R = 420;
  for (let i = 0; i < count; i++) {
    // hemisphere above the horizon, denser toward the zenith
    const u = rnd(), v = rnd();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(1 - v * 0.98); // 0 at zenith
    pos[i * 3] = R * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = R * Math.cos(phi) - 20;
    pos[i * 3 + 2] = R * Math.sin(phi) * Math.sin(theta);
    const m = Math.pow(rnd(), 2.6);
    attr[i * 2] = m; attr[i * 2 + 1] = rnd();
  }
  return { pos, attr };
}

// roots: recursive branching lines growing down from the mountain's heart
function buildRoots(seed) {
  const rnd = mulberry32(seed);
  const out = [];
  function grow(x, y, z, dx, dy, dz, len, depth) {
    const segs = 6;
    let px = x, py = y, pz = z;
    for (let s = 0; s < segs; s++) {
      const t = (s + 1) / segs;
      const wob = 0.55;
      dx += (rnd() - 0.5) * wob; dz += (rnd() - 0.5) * wob; dy -= 0.08;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const nx = px + dx * (len / segs), ny = py + dy * (len / segs), nz = pz + dz * (len / segs);
      out.push(px, py, pz, nx, ny, nz);
      px = nx; py = ny; pz = nz;
      if (depth > 0 && s > 1 && rnd() < 0.55) {
        const a = (rnd() - 0.5) * 1.6;
        grow(px, py, pz, dx * Math.cos(a) - dz * Math.sin(a), dy * 0.6, dx * Math.sin(a) + dz * Math.cos(a), len * 0.62, depth - 1);
      }
    }
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.5;
    grow(Math.cos(a) * 1.5, -0.5, Math.sin(a) * 1.5, Math.cos(a) * 0.8, -1.0, Math.sin(a) * 0.8, 18 + rnd() * 8, 3);
  }
  return new Float32Array(out);
}

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, a = {};
  const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) { const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n); }
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) { const n = gl.getActiveAttrib(p, i).name; a[n] = gl.getAttribLocation(p, n); }
  return { p, u, a };
}

const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class AscentScene extends HTMLElement {
  connectedCallback() {
    if (this._started) return;
    this._started = true;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.appendChild(this.canvas);

    const gl = this.canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) { this.classList.add('is-fallback'); return; }
    this.gl = gl;

    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.palette = {
      bg: hex('#0a1020'), bgDeep: hex('#05070f'), earth: hex('#3a2a1c'),
      lineLow: hex('#466a9c'), lineHigh: hex('#dbe8f6'), fillTop: hex('#9cbfe6'),
      rootLine: hex('#b58a5e'), white: hex('#e9f0fa'), warm: hex('#f3c86b'),
    };

    const derivatives = !!gl.getExtension('OES_standard_derivatives');
    this.progs = {
      lines: compile(gl, VERT_TERRAIN, FRAG_LINES),
      fill: compile(gl, VERT_TERRAIN, FRAG_FILL(derivatives)),
      stars: compile(gl, VERT_STARS, FRAG_STARS),
      halo: compile(gl, VERT_HALO, FRAG_HALO),
    };

    const N = 180;
    const terrain = buildTerrain(N);
    this.terrain = {
      vbo: this.buf(gl.ARRAY_BUFFER, terrain.pos),
      lines: this.buf(gl.ELEMENT_ARRAY_BUFFER, terrain.lines), nLines: terrain.lines.length,
      tris: this.buf(gl.ELEMENT_ARRAY_BUFFER, terrain.tris), nTris: terrain.tris.length,
    };
    const stars = buildStars(2200, 7);
    this.stars = { vbo: this.buf(gl.ARRAY_BUFFER, stars.pos), attr: this.buf(gl.ARRAY_BUFFER, stars.attr), n: 2200 };
    const roots = buildRoots(11);
    this.roots = { vbo: this.buf(gl.ARRAY_BUFFER, roots), n: roots.length / 3 };

    // named stars come from the DOM: elements with data-star="x,y,z"
    this.named = [...document.querySelectorAll('[data-star]')].map((el) => {
      const [x, y, z] = el.dataset.star.split(',').map(Number);
      return { el, pos: [x, y, z] };
    });
    this.haloBuf = this.buf(gl.ARRAY_BUFFER, new Float32Array(this.named.flatMap((s) => s.pos)));

    this.t = 0; this.tTarget = 0;
    this.mx = 0; this.my = 0; this.mxT = 0; this.myT = 0;
    this.start = performance.now();

    this.onScroll = () => { this.tTarget = this.progress(); };
    this.onPointer = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      this.mxT = (e.clientX / innerWidth - 0.5) * 2;
      this.myT = (e.clientY / innerHeight - 0.5) * 2;
    };
    this.onResize = () => this.resize();
    addEventListener('scroll', this.onScroll, { passive: true });
    addEventListener('pointermove', this.onPointer, { passive: true });
    addEventListener('resize', this.onResize);
    this.resize();
    this.onScroll();
    this.t = this.tTarget;
    this.classList.add('is-ready');
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  disconnectedCallback() {
    removeEventListener('scroll', this.onScroll);
    removeEventListener('pointermove', this.onPointer);
    removeEventListener('resize', this.onResize);
    this.stopped = true;
  }

  buf(target, data) {
    const gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  }

  progress() {
    const max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? clamp(scrollY / max, 0, 1) : 0;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    this.dpr = dpr;
    const w = innerWidth, h = innerHeight;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.aspect = w / h;
    this.portrait = h > w;
  }

  // camera path: summit → slope → base → underground
  camera(t) {
    const narrow = this.portrait ? 1 : 0;
    // distance from the peak along +z
    const z = lerp(11, 46, smooth(0, 0.82, t));
    // stand a little left of the ridge line at the summit so the peak sits
    // right of the text; drift back to centre on the way down
    const x = lerp(narrow ? 0 : -7, 0, smooth(0, 0.4, t));
    const ground = terrainHeight(x, z);
    const eyeAbove = lerp(6.5, 3.5, smooth(0, 0.5, t));
    let y = ground + eyeAbove;
    // past the base, sink below the surface
    const under = smooth(0.8, 1, t);
    y = lerp(y, -14, under);
    const eye = [x, y, z];
    // target: at the summit, look up over the peak into the sky; descending,
    // look back at the peak; underground, look at the heart of the mountain
    const skyTarget = [0, PEAK + 24 + narrow * 10, -70];
    const peakTarget = [0, PEAK * 0.9, 0];
    const rootTarget = [0, -9, 0];
    const look = smooth(0.02, 0.45, t);
    let target = [
      lerp(skyTarget[0], peakTarget[0], look),
      lerp(skyTarget[1], peakTarget[1], look),
      lerp(skyTarget[2], peakTarget[2], look),
    ];
    target = [lerp(target[0], rootTarget[0], under), lerp(target[1], rootTarget[1], under), lerp(target[2], rootTarget[2], under)];
    // widen the view in portrait so the peak still fits
    const fov = (this.portrait ? 72 : 55) * Math.PI / 180;
    return { eye, target, fov, under };
  }

  loop(now) {
    if (this.stopped) return;
    const gl = this.gl, P = this.palette;
    const reduced = this.reduced.matches;
    const time = (now - this.start) / 1000;
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;

    // smooth follow, independent of frame rate
    const k = reduced ? 1 : 1 - Math.exp(-dt * 6.5);
    const km = 1 - Math.exp(-dt * 4);
    this.t += (this.tTarget - this.t) * k;
    this.mx += (this.mxT - this.mx) * km;
    this.my += (this.myT - this.my) * km;

    const t = this.t;
    const { eye, target, fov, under } = this.camera(t);
    // pointer parallax: nudge the target, not the eye, so the horizon stays put
    const drift = reduced ? 0 : 1;
    const idle = reduced ? 0 : 0.35;
    const px = (this.mx * 3.2 + Math.sin(time * 0.11) * idle) * drift;
    const py = (-this.my * 1.6 + Math.cos(time * 0.09) * idle * 0.5) * drift;
    const tgt = [target[0] + px, target[1] + py, target[2]];

    const proj = m4.perspective(fov, this.aspect, 0.5, 900);
    const view = m4.lookAt(eye, tgt, [0, 1, 0]);

    // sky darkens as we go underground; warms slightly near the base
    const warm = smooth(0.62, 0.95, t);
    const bg = [
      lerp(lerp(P.bg[0], P.earth[0], warm * 0.55), P.bgDeep[0], under),
      lerp(lerp(P.bg[1], P.earth[1], warm * 0.55), P.bgDeep[1], under),
      lerp(lerp(P.bg[2], P.earth[2], warm * 0.55), P.bgDeep[2], under),
    ];
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const terrainFade = 1 - under;
    const starFade = (1 - smooth(0.55, 0.9, t)) * (1 - under);

    // --- stars (no depth) ---
    if (starFade > 0.001) {
      const s = this.progs.stars;
      gl.useProgram(s.p);
      gl.disable(gl.DEPTH_TEST);
      gl.uniformMatrix4fv(s.u.uProj, false, proj);
      gl.uniformMatrix4fv(s.u.uView, false, view);
      gl.uniform1f(s.u.uTime, time);
      gl.uniform1f(s.u.uDpr, this.dpr);
      gl.uniform1f(s.u.uTwinkle, reduced ? 0 : 1);
      gl.uniform1f(s.u.uFade, starFade);
      gl.uniform3fv(s.u.uWhite, P.white);
      gl.uniform3fv(s.u.uWarm, P.warm);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.stars.vbo);
      gl.enableVertexAttribArray(s.a.aPos); gl.vertexAttribPointer(s.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.stars.attr);
      gl.enableVertexAttribArray(s.a.aAttr); gl.vertexAttribPointer(s.a.aAttr, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, this.stars.n);

      // named stars: warm halos
      if (this.named.length) {
        const h = this.progs.halo;
        gl.useProgram(h.p);
        gl.uniformMatrix4fv(h.u.uProj, false, proj);
        gl.uniformMatrix4fv(h.u.uView, false, view);
        gl.uniform1f(h.u.uDpr, this.dpr);
        gl.uniform1f(h.u.uSize, 54);
        gl.uniform1f(h.u.uFade, starFade);
        gl.uniform3fv(h.u.uColor, P.warm);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.haloBuf);
        gl.enableVertexAttribArray(h.a.aPos); gl.vertexAttribPointer(h.a.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, this.named.length);
      }
    }

    // --- terrain ---
    if (terrainFade > 0.001) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.terrain.vbo);

      const f = this.progs.fill;
      gl.useProgram(f.p);
      gl.uniformMatrix4fv(f.u.uProj, false, proj);
      gl.uniformMatrix4fv(f.u.uView, false, view);
      gl.uniform3fv(f.u.uBg, bg);
      gl.uniform3fv(f.u.uFillTop, P.fillTop);
      gl.uniform1f(f.u.uPeak, PEAK);
      gl.uniform1f(f.u.uFade, terrainFade);
      gl.enableVertexAttribArray(f.a.aPos); gl.vertexAttribPointer(f.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.5, 2.0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.terrain.tris);
      gl.drawElements(gl.TRIANGLES, this.terrain.nTris, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);

      const l = this.progs.lines;
      gl.useProgram(l.p);
      gl.uniformMatrix4fv(l.u.uProj, false, proj);
      gl.uniformMatrix4fv(l.u.uView, false, view);
      gl.uniform3fv(l.u.uBg, bg);
      gl.uniform3fv(l.u.uLow, P.lineLow);
      gl.uniform3fv(l.u.uHigh, P.lineHigh);
      gl.uniform3fv(l.u.uEarth, P.rootLine);
      gl.uniform1f(l.u.uPeak, PEAK);
      gl.uniform1f(l.u.uFade, terrainFade);
      gl.uniform1f(l.u.uWarm, warm * 0.6);
      gl.uniform1f(l.u.uTime, time);
      gl.enableVertexAttribArray(l.a.aPos); gl.vertexAttribPointer(l.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.terrain.lines);
      gl.drawElements(gl.LINES, this.terrain.nLines, gl.UNSIGNED_SHORT, 0);
    }

    // --- roots ---
    const rootFade = smooth(0.74, 0.98, t);
    if (rootFade > 0.001) {
      const l = this.progs.lines;
      gl.useProgram(l.p);
      gl.disable(gl.DEPTH_TEST);
      gl.uniformMatrix4fv(l.u.uProj, false, proj);
      gl.uniformMatrix4fv(l.u.uView, false, view);
      gl.uniform3fv(l.u.uLow, P.rootLine);
      gl.uniform3fv(l.u.uHigh, P.rootLine);
      gl.uniform3fv(l.u.uEarth, P.rootLine);
      gl.uniform1f(l.u.uPeak, PEAK);
      gl.uniform1f(l.u.uFade, rootFade);
      gl.uniform1f(l.u.uWarm, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.roots.vbo);
      gl.enableVertexAttribArray(l.a.aPos); gl.vertexAttribPointer(l.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, this.roots.n);
    }

    // labels leave before the stars do, so they never sit on the text
    this.placeLabels(proj, view, starFade * (1 - smooth(0.03, 0.12, t)));
    requestAnimationFrame(this.loop);
  }

  // project the named stars into the page and move their labels
  placeLabels(proj, view, fade) {
    const pv = m4.mul(proj, view);
    for (const s of this.named) {
      const c = m4.transform(pv, s.pos);
      const visible = c[3] > 0 && fade > 0.05;
      if (!visible) { s.el.style.opacity = '0'; s.el.style.pointerEvents = 'none'; continue; }
      const x = (c[0] / c[3] * 0.5 + 0.5) * innerWidth;
      const y = (-c[1] / c[3] * 0.5 + 0.5) * innerHeight;
      const on = x > -40 && x < innerWidth + 40 && y > -20 && y < innerHeight + 20;
      s.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      s.el.style.opacity = on ? String(fade) : '0';
      s.el.style.pointerEvents = on && fade > 0.4 ? 'auto' : 'none';
    }
  }
}

customElements.define('ascent-scene', AscentScene);
