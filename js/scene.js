// <ascent-scene> — a hand-written WebGL night mountain.
//
// The camera starts in the sky above the summit and descends straight down:
// past the face, across the ground, and under the mountain to its roots.
// The name is already in the stars; on load a line is traced between them,
// letter by letter. Four stars stay bright to carry the current work, and
// merged commits are headlamps on the climbing route. No libraries.

import { layout } from './letters.js';

// ---------- shaders ----------
const V_SKY = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const F_SKY = `
precision mediump float;
uniform vec3 uTop, uHorizon, uEarth;
uniform float uUnder, uHorizonY;
varying vec2 vUv;
void main() {
  float h = clamp((vUv.y - uHorizonY) / max(1.0 - uHorizonY, 0.001), 0.0, 1.0);
  float below = clamp((uHorizonY - vUv.y) / max(uHorizonY, 0.001), 0.0, 1.0);
  vec3 sky = mix(uHorizon, uTop, pow(h, 0.65));
  sky = mix(sky, uHorizon * 0.8, below);
  gl_FragColor = vec4(mix(sky, uEarth, uUnder), 1.0);
}`;

const V_TERRAIN = `
attribute vec3 aPos;
uniform mat4 uPV;
varying vec3 vW;
void main() { vW = aPos; gl_Position = uPV * vec4(aPos, 1.0); }`;

const F_TERRAIN = `
#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec3 uEye, uSky, uRockLow, uRockHigh, uSnow, uLight, uContourColor;
uniform float uSnowLine, uFade, uContour, uWarm;
varying vec3 vW;
void main() {
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  if (n.y < 0.0) n = -n;
  float lambert = max(0.0, dot(n, uLight));
  float skyLight = 0.5 + 0.5 * n.y;
  float snow = smoothstep(uSnowLine - 3.0, uSnowLine + 3.0, vW.y + 9.0 * (n.y - 0.72));
  float hf = clamp((vW.y + 4.0) / 28.0, 0.0, 1.0);
  vec3 rock = mix(uRockLow, uRockHigh, hf);
  rock = mix(rock, vec3(0.3, 0.23, 0.18), uWarm * (1.0 - hf));
  vec3 alb = mix(rock, uSnow, snow);
  vec3 col = alb * (0.22 * skyLight + 1.0 * lambert);
  float cy = vW.y * 0.5;
  float fw = fwidth(cy);
  float c = fract(cy);
  float line = 1.0 - smoothstep(0.0, fw * 1.6, min(c, 1.0 - c));
  col += uContour * line * uContourColor * (0.35 + 0.65 * lambert) * (1.0 - 0.6 * snow);
  float d = distance(vW, uEye);
  float fog = 1.0 - exp(-d * d * 0.00009);
  fog = max(fog, smoothstep(105.0, 136.0, d));
  col = mix(col, uSky, fog);
  gl_FragColor = vec4(col, uFade);
}`;

const V_STARS = `
attribute vec3 aPos;
attribute vec2 aAttr; // magnitude, phase
uniform mat4 uPV;
uniform float uTime, uDpr, uTwinkle, uSize;
varying float vMag, vTw;
void main() {
  gl_Position = uPV * vec4(aPos, 1.0);
  float tw = 0.72 + 0.28 * sin(uTime * (0.5 + aAttr.x * 1.3) + aAttr.y * 6.2831);
  tw = mix(1.0, tw, uTwinkle);
  vMag = aAttr.x; vTw = tw;
  gl_PointSize = (1.2 + aAttr.x * aAttr.x * uSize) * uDpr * tw;
}`;

const F_STARS = `
precision mediump float;
uniform vec3 uColor;
uniform float uFade;
varying float vMag, vTw;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d);
  gl_FragColor = vec4(uColor, a * (0.3 + 0.7 * vMag) * vTw * uFade);
}`;

const V_HALO = `
attribute vec3 aPos;
attribute float aGlow;
uniform mat4 uPV;
uniform float uDpr, uSize;
varying float vGlow;
void main() {
  gl_Position = uPV * vec4(aPos, 1.0);
  vGlow = aGlow;
  gl_PointSize = uSize * (0.55 + 0.9 * aGlow) * uDpr;
}`;

const F_HALO = `
precision mediump float;
uniform vec3 uColor;
uniform float uFade;
varying float vGlow;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.22, 0.0, d);
  float glow = pow(max(0.0, 1.0 - d), 2.2) * (0.35 + 0.65 * vGlow);
  gl_FragColor = vec4(uColor, (core + glow) * uFade);
}`;

const V_LINES = `
attribute vec3 aPos;
uniform mat4 uPV;
void main() { gl_Position = uPV * vec4(aPos, 1.0); }`;

const F_LINES = `
precision mediump float;
uniform vec3 uColor;
uniform float uFade;
void main() { gl_FragColor = vec4(uColor, uFade); }`;

// ---------- math ----------
const m4 = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookAt(eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
    ]);
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
      o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    return o;
  },
  transform(m, v) {
    const [x, y, z] = v;
    return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14], m[3] * x + m[7] * y + m[11] * z + m[15]];
  },
};
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const S = 256, perm = new Uint8Array(S * 2), grid = new Float32Array(S);
  for (let i = 0; i < S; i++) { perm[i] = i; grid[i] = rnd(); }
  for (let i = S - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < S; i++) perm[S + i] = perm[i];
  const fade = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const a = grid[perm[X + perm[Y]]], b = grid[perm[X + 1 + perm[Y]]], c = grid[perm[X + perm[Y + 1]]], d = grid[perm[X + 1 + perm[Y + 1]]];
    const u = fade(xf), v = fade(yf);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  const fbm = (x, y, oct = 5) => {
    let s = 0, amp = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f); n += amp; amp *= 0.5; f *= 2.07; }
    return s / n;
  };
  const ridged = (x, y, oct = 5) => {
    let s = 0, amp = 0.5, f = 1, n = 0, w = 1;
    for (let i = 0; i < oct; i++) {
      let r = 1 - Math.abs(2 * noise(x * f, y * f) - 1); r = r * r * w; w = clamp(r * 1.6, 0, 1);
      s += r * amp; n += amp; amp *= 0.5; f *= 2.1;
    }
    return s / n;
  };
  return { fbm, ridged };
}

// ---------- the mountain ----------
// One massif at the origin, a basin around it, a ring of far ridges fogged
// at the edge. The camera descends at z = CAM_Z, in the basin.
const EXTENT = 140;
const PEAK = 24;
const CAM_Z = 70;
const { fbm, ridged } = makeNoise(20181105);

function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  const summit = PEAK * Math.exp(-(r * r) / 260);
  const massif = 15 * Math.exp(-(r * r) / 1500);
  const alt = clamp((summit + massif) / (PEAK + 6), 0, 1);
  // radiating ridges: crest noise in polar coordinates so they run downhill
  const ang = Math.atan2(z, x);
  const spokes = ridged(ang * 1.6 + 3.3, r * 0.06 + 1.2, 4) * (3 + 9 * alt) * smooth(1, 10, r);
  const crest = ridged(x * 0.07 + 1.3, z * 0.07 + 2.1, 5) * (1.4 + 3.5 * alt);
  // a clearing where the camera stands, so the foot of the mountain stays in view
  const clearing = Math.exp(-(x * x + (z - CAM_Z) ** 2) / 900);
  const basin = 2.2 * ridged(x * 0.05 + 2, z * 0.05 + 4, 4) * smooth(30, 50, r) * (1 - smooth(85, 100, r)) * (1 - clearing);
  const far = 17 * ridged(x * 0.02 + 5, z * 0.02 + 9, 4) * smooth(88, 118, r);
  const fine = (fbm(x * 0.28, z * 0.28, 3) - 0.5) * 0.7 * (1 - clearing);
  const edge = clamp(1 - Math.pow(r / EXTENT, 8), 0, 1);
  return (-2 - 1.5 * clearing + summit + massif + spokes + crest + basin + far + fine) * edge;
}

function buildTerrain(N) {
  const pos = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -EXTENT + (2 * EXTENT * i) / (N - 1), z = -EXTENT + (2 * EXTENT * j) / (N - 1);
    const k = (j * N + i) * 3;
    pos[k] = x; pos[k + 1] = terrainHeight(x, z); pos[k + 2] = z;
  }
  const tris = new Uint32Array((N - 1) * (N - 1) * 6);
  let k = 0;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i;
    if ((i + j) & 1) { tris[k++] = a; tris[k++] = a + N; tris[k++] = a + N + 1; tris[k++] = a; tris[k++] = a + N + 1; tris[k++] = a + 1; }
    else { tris[k++] = a; tris[k++] = a + N; tris[k++] = a + 1; tris[k++] = a + 1; tris[k++] = a + N; tris[k++] = a + N + 1; }
  }
  return { pos, tris };
}

let meshN = 0;
function meshHeightAbove(x, z) {
  const c = (2 * EXTENT) / (meshN - 1);
  const i = Math.floor((x + EXTENT) / c), j = Math.floor((z + EXTENT) / c);
  let h = -Infinity;
  for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) h = Math.max(h, terrainHeight(-EXTENT + (i + di) * c, -EXTENT + (j + dj) * c));
  return h;
}

// the climbing route on the face that faces the camera: summit to base
function route(s) {
  const z = 2 + s * 40;
  const x = 4.5 * Math.sin(s * 5.2) + 2 * Math.sin(s * 11.1 + 2);
  return [x, 0, z];
}

function buildDome(count, seed) {
  const rnd = mulberry32(seed);
  const pos = new Float32Array(count * 3), attr = new Float32Array(count * 2);
  const R = 560;
  for (let i = 0; i < count; i++) {
    const theta = rnd() * Math.PI * 2, phi = Math.acos(1 - rnd() * 1.1);
    pos[i * 3] = R * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = R * Math.cos(phi) - 40;
    pos[i * 3 + 2] = R * Math.sin(phi) * Math.sin(theta);
    attr[i * 2] = Math.pow(rnd(), 2.4); attr[i * 2 + 1] = rnd();
  }
  return { pos, attr };
}

function buildRoots(seed, origin) {
  const rnd = mulberry32(seed);
  const out = [];
  function grow(x, y, z, dx, dy, dz, len, depth) {
    const segs = 8;
    let px = x, py = y, pz = z;
    for (let s = 0; s < segs; s++) {
      dx += (rnd() - 0.5) * 0.7; dz += (rnd() - 0.5) * 0.7; dy -= 0.05;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const nx = px + dx * (len / segs), ny = py + dy * (len / segs), nz = pz + dz * (len / segs);
      out.push(px, py, pz, nx, ny, nz);
      px = nx; py = ny; pz = nz;
      if (depth > 0 && s > 0 && rnd() < 0.6) {
        const a = (rnd() - 0.5) * 2.0;
        grow(px, py, pz, dx * Math.cos(a) - dz * Math.sin(a), dy * 0.7, dx * Math.sin(a) + dz * Math.cos(a), len * 0.62, depth - 1);
      }
    }
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.3;
    const spread = 1 + rnd() * 0.6;
    grow(origin[0] + Math.cos(a) * 2, origin[1], origin[2] + Math.sin(a) * 2, Math.cos(a) * spread, -0.7, Math.sin(a) * spread, 26 + rnd() * 12, 4);
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
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, a = {};
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) { const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n); }
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i++) { const n = gl.getActiveAttrib(p, i).name; a[n] = gl.getAttribLocation(p, n); }
  return { p, u, a };
}

// scroll bands, shared with the page choreography
export const BANDS = {
  name: [0, 0.1],
  stars: [[0.2, 0.3], [0.32, 0.42], [0.44, 0.54], [0.56, 0.66]],
  climb: [0.68, 0.77],
  slopes: [[0.78, 0.835], [0.835, 0.89], [0.89, 0.945]],
  roots: [0.955, 1],
};

export class AscentScene extends HTMLElement {
  connectedCallback() {
    if (this._started) return;
    this._started = true;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.appendChild(this.canvas);

    const gl = this.canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl || !gl.getExtension('OES_standard_derivatives') || !gl.getExtension('OES_element_index_uint')) { this.fail(); return; }
    this.gl = gl;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.P = {
      skyTop: hex('#04060d'), skyHorizon: hex('#141c33'), earth: hex('#080604'),
      rockLow: hex('#171e33'), rockHigh: hex('#4a5878'), snow: hex('#d6e2f0'),
      contour: hex('#8fb4e8'), star: hex('#e9f0fa'), warm: hex('#f3c86b'), root: hex('#b58a5e'), name: hex('#e4eefb'),
    };
    try {
      this.progs = {
        sky: compile(gl, V_SKY, F_SKY),
        terrain: compile(gl, V_TERRAIN, F_TERRAIN),
        stars: compile(gl, V_STARS, F_STARS),
        halo: compile(gl, V_HALO, F_HALO),
        lines: compile(gl, V_LINES, F_LINES),
      };
    } catch (e) { console.warn('scene shaders failed', e); this.fail(); return; }

    const N = 380;
    meshN = N;
    const terrain = buildTerrain(N);
    this.terrain = { vbo: this.buf(gl.ARRAY_BUFFER, terrain.pos), ibo: this.buf(gl.ELEMENT_ARRAY_BUFFER, terrain.tris), n: terrain.tris.length };
    this.quad = this.buf(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]));
    const dome = buildDome(2800, 7);
    this.dome = { vbo: this.buf(gl.ARRAY_BUFFER, dome.pos), attr: this.buf(gl.ARRAY_BUFFER, dome.attr), n: 2800 };

    this.nameText = (this.getAttribute('name') || 'DANIEL WYCKOFF').toUpperCase();
    this.nameVbo = gl.createBuffer(); this.nameAttr = gl.createBuffer(); this.nameLinesVbo = gl.createBuffer();

    this.named = [0, 1, 2, 3].map(() => ({ pos: [0, 0, 0], glow: 0 }));
    this.haloVbo = gl.createBuffer(); this.haloGlow = gl.createBuffer();
    this.lights = { vbo: gl.createBuffer(), glow: gl.createBuffer(), n: 0, pos: [] };
    this.roots = { vbo: this.buf(gl.ARRAY_BUFFER, buildRoots(11, [0, -3, 4])), n: 0 };
    this.roots.n = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) / 12;

    this.t = 0; this.tTarget = 0; this.mx = 0; this.my = 0; this.mxT = 0; this.myT = 0;
    this.start = performance.now();
    this.pv = null;

    this.onScroll = () => { this.tTarget = this.progress(); };
    this.onPointer = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      this.mxT = (e.clientX / innerWidth - 0.5) * 2; this.myT = (e.clientY / innerHeight - 0.5) * 2;
    };
    this.onResize = () => { this.resize(); this.placeSky(); };
    addEventListener('scroll', this.onScroll, { passive: true });
    addEventListener('pointermove', this.onPointer, { passive: true });
    addEventListener('resize', this.onResize);
    this.resize();
    this.placeSky();
    this.onScroll();
    this.t = this.tTarget;
    this.classList.add('is-ready');
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  fail() { this.classList.add('is-fallback'); this.dispatchEvent(new CustomEvent('fallback')); }
  pause() { this.paused = true; }
  resume() { if (!this.paused) return; this.paused = false; this.last = 0; this.onScroll?.(); requestAnimationFrame(this.loop); }

  disconnectedCallback() {
    removeEventListener('scroll', this.onScroll); removeEventListener('pointermove', this.onPointer); removeEventListener('resize', this.onResize);
    this.stopped = true;
  }

  buf(target, data, usage) {
    const gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(target, b); gl.bufferData(target, data, usage || gl.STATIC_DRAW);
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
    this.aspect = w / h; this.portrait = h > w;
    this.fov = (this.portrait ? 66 : 54) * Math.PI / 180;
  }

  // a straight drop: sky above the summit → the face → the ground → beneath
  camera(t) {
    const wide = this.portrait ? 1.35 : 1;
    const dz = CAM_Z * wide;
    // altitude: hold high while the name is up, descend through the stars
    // and the climb, reach the ground on the slopes, sink for the roots
    let y;
    if (t < 0.12) y = lerp(PEAK + 26, PEAK + 23, t / 0.12);
    else if (t < 0.68) y = lerp(PEAK + 23, 10, smooth(0.12, 0.68, t));
    else if (t < 0.78) y = lerp(10, 5.5, smooth(0.68, 0.78, t));
    else if (t < 0.955) y = lerp(5.5, 1.8, smooth(0.78, 0.955, t));
    else y = lerp(1.8, -26, smooth(0.955, 1, t));
    const pitch = (t < 0.68 ? lerp(-12, -3, smooth(0, 0.68, t)) : t < 0.955 ? lerp(-3, 3, smooth(0.68, 0.955, t)) : lerp(3, -10, smooth(0.955, 1, t))) * Math.PI / 180;
    const under = smooth(0.955, 1, t);
    const eye = [0, y, dz];
    const target = [0, y + Math.tan(pitch) * dz, 0];
    return { eye, target, under };
  }

  frame(t) {
    const { eye, target } = this.camera(t);
    const f = v3.norm(v3.sub(target, eye));
    const r = v3.norm(v3.cross(f, [0, 1, 0]));
    const u = v3.cross(r, f);
    return { eye, f, r, u };
  }

  // the name and the four bright stars go where the camera will look
  placeSky() {
    const gl = this.gl;
    const rnd = mulberry32(2026);
    const { eye, f, r, u } = this.frame(0);
    const D = 260;
    const halfH = D * Math.tan(this.fov / 2), halfW = halfH * this.aspect;
    const lines = this.portrait ? this.nameText.split(' ') : [this.nameText];
    const L = layout(lines, 0.5);
    const unit = Math.min((this.portrait ? 0.78 : 0.5) * 2 * halfW / L.width, 0.42 * halfH / L.height);
    const lift = halfH * (this.portrait ? 0.56 : 0.5);
    const centre = v3.add(eye, v3.scale(f, D));
    const n = L.points.length;
    this.namePos = new Float32Array(n * 3);
    const attr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const [x, y, anchor] = L.points[i];
      // a constellation is never on a grid: nudge each star a little
      const jx = (rnd() - 0.5) * 0.07, jy = (rnd() - 0.5) * 0.07;
      const p = v3.add(centre, v3.add(v3.scale(r, (x + jx) * unit), v3.scale(u, (y + jy) * unit + lift)));
      this.namePos.set(p, i * 3);
      attr[i * 2] = anchor ? 0.78 + 0.22 * rnd() : 0.5 + 0.25 * rnd();
      attr[i * 2 + 1] = rnd();
    }
    this.nameN = n;
    this.nameSegments = L.segments;
    this.nameLetters = L.letters;
    this.nameLines = new Float32Array(L.segments.length * 6);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nameVbo); gl.bufferData(gl.ARRAY_BUFFER, this.namePos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nameAttr); gl.bufferData(gl.ARRAY_BUFFER, attr, gl.STATIC_DRAW);

    const spots = this.portrait
      ? [[0.12, 0.62], [-0.34, 0.72], [0.4, 0.68], [-0.08, 0.78]]
      : [[0.3, 0.5], [-0.44, 0.6], [0.52, 0.68], [0.04, 0.62]];
    BANDS.stars.forEach(([a, b], i) => {
      const fr = this.frame((a + b) / 2);
      const DD = 320, hH = DD * Math.tan(this.fov / 2), hW = hH * this.aspect;
      const c = v3.add(fr.eye, v3.scale(fr.f, DD));
      this.named[i].pos = v3.add(c, v3.add(v3.scale(fr.r, spots[i][0] * hW), v3.scale(fr.u, spots[i][1] * hH)));
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.haloVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.named.flatMap((s) => s.pos)), gl.STATIC_DRAW);
  }

  // merged commits become headlamps on the route up the face
  setTrailLights(count) {
    const gl = this.gl;
    const n = clamp(count, 0, 60);
    const pos = new Float32Array(n * 3);
    this.lights.pos = [];
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const p = route(s);
      const x = p[0] + ((i % 2 ? 1 : -1) * 0.6), z = p[2];
      const y = meshHeightAbove(x, z) + 0.5;
      pos.set([x, y, z], i * 3);
      this.lights.pos.push([x, y, z]);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lights.vbo); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lights.glow); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(n), gl.DYNAMIC_DRAW);
    this.lights.n = n;
  }

  project(pos) {
    if (!this.pv) return null;
    const c = m4.transform(this.pv, pos);
    if (c[3] <= 0) return null;
    return { x: (c[0] / c[3] * 0.5 + 0.5) * innerWidth, y: (-c[1] / c[3] * 0.5 + 0.5) * innerHeight };
  }

  loop(now) {
    if (this.stopped || this.paused) return;
    const gl = this.gl, P = this.P, reduced = this.reduced.matches;
    const time = (now - this.start) / 1000;
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000); this.last = now;

    const k = reduced ? 1 : 1 - Math.exp(-dt * 6), km = 1 - Math.exp(-dt * 4);
    this.t += (this.tTarget - this.t) * k;
    this.mx += (this.mxT - this.mx) * km; this.my += (this.myT - this.my) * km;
    const t = this.t;

    const { eye, target, under } = this.camera(t);
    const fr = this.frame(t);
    const drift = reduced ? 0 : 1, idle = reduced ? 0 : 0.25;
    const nudge = v3.add(v3.scale(fr.r, (this.mx * 1.4 + Math.sin(time * 0.1) * idle) * drift), v3.scale(fr.u, (-this.my * 0.8 + Math.cos(time * 0.08) * idle * 0.4) * drift));
    const tgt = v3.add(target, nudge);
    const proj = m4.perspective(this.fov, this.aspect, 0.4, 1400);
    const view = m4.lookAt(eye, tgt, [0, 1, 0]);
    const pv = m4.mul(proj, view);
    this.pv = pv;

    const warm = smooth(0.74, 0.95, t);
    const skyH = P.skyHorizon.map((c, i) => lerp(c, [0.12, 0.09, 0.07][i], warm * 0.5));
    const hz = m4.transform(pv, v3.add(eye, [0, 0, -900]));
    const horizonY = hz[3] > 0 ? clamp(hz[1] / hz[3] * 0.5 + 0.5, 0.02, 0.98) : 0.4;

    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    {
      const s = this.progs.sky;
      gl.useProgram(s.p);
      gl.uniform3fv(s.u.uTop, P.skyTop); gl.uniform3fv(s.u.uHorizon, skyH);
      gl.uniform3fv(s.u.uEarth, P.earth); gl.uniform1f(s.u.uUnder, under); gl.uniform1f(s.u.uHorizonY, horizonY);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(s.a.aPos); gl.vertexAttribPointer(s.a.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const starFade = (1 - smooth(0.66, 0.8, t)) * (1 - under);
    if (starFade > 0.001) {
      const s = this.progs.stars;
      gl.useProgram(s.p);
      gl.uniformMatrix4fv(s.u.uPV, false, pv);
      gl.uniform1f(s.u.uTime, time); gl.uniform1f(s.u.uDpr, this.dpr); gl.uniform1f(s.u.uTwinkle, reduced ? 0 : 1);
      gl.uniform1f(s.u.uSize, 3.0); gl.uniform1f(s.u.uFade, starFade); gl.uniform3fv(s.u.uColor, P.star);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dome.vbo); gl.enableVertexAttribArray(s.a.aPos); gl.vertexAttribPointer(s.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dome.attr); gl.enableVertexAttribArray(s.a.aAttr); gl.vertexAttribPointer(s.a.aAttr, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, this.dome.n);

      // the name: its stars are always there; a line is traced between them
      // on load, letter by letter, and lets go as you scroll
      const traced = reduced ? 1 : clamp((time - 0.6) / 3.4, 0, 1);
      const hold = 1 - smooth(0.09, 0.16, t);
      const lit = (0.35 + 0.65 * smooth(0, 0.25, traced)) * hold + 0.35 * (1 - hold);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nameVbo); gl.enableVertexAttribArray(s.a.aPos); gl.vertexAttribPointer(s.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nameAttr); gl.enableVertexAttribArray(s.a.aAttr); gl.vertexAttribPointer(s.a.aAttr, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(s.u.uSize, 2.6 + 2.2 * lit); gl.uniform1f(s.u.uTwinkle, reduced ? 0 : 0.6);
      gl.uniform1f(s.u.uFade, starFade * (0.6 + 0.4 * lit)); gl.uniform3fv(s.u.uColor, P.name);
      gl.drawArrays(gl.POINTS, 0, this.nameN);

      const lineA = traced > 0 ? hold : 0;
      if (lineA > 0.001) {
        const segs = this.nameSegments, N = segs.length;
        // trace: each letter takes an equal share of the time, strokes in order
        let drawn = 0;
        const perLetter = {};
        for (const sg of segs) perLetter[sg[2]] = (perLetter[sg[2]] || 0) + 1;
        const counters = {};
        for (let i = 0; i < N; i++) {
          const [a, b, letter] = segs[i];
          const k0 = counters[letter] || 0; counters[letter] = k0 + 1;
          const lt = traced * this.nameLetters - letter;          // progress inside this letter, 0..1+
          const p = clamp(lt * perLetter[letter] - k0, 0, 1);      // progress inside this stroke
          if (p <= 0) continue;
          const ax = this.namePos[a * 3], ay = this.namePos[a * 3 + 1], az = this.namePos[a * 3 + 2];
          const bx = this.namePos[b * 3], by = this.namePos[b * 3 + 1], bz = this.namePos[b * 3 + 2];
          this.nameLines.set([ax, ay, az, ax + (bx - ax) * p, ay + (by - ay) * p, az + (bz - az) * p], drawn * 6);
          drawn++;
        }
        if (drawn) {
          const l = this.progs.lines;
          gl.useProgram(l.p);
          gl.uniformMatrix4fv(l.u.uPV, false, pv);
          gl.uniform3fv(l.u.uColor, P.name); gl.uniform1f(l.u.uFade, 0.36 * lineA * starFade);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.nameLinesVbo); gl.bufferData(gl.ARRAY_BUFFER, this.nameLines.subarray(0, drawn * 6), gl.DYNAMIC_DRAW);
          gl.enableVertexAttribArray(l.a.aPos); gl.vertexAttribPointer(l.a.aPos, 3, gl.FLOAT, false, 0, 0);
          gl.drawArrays(gl.LINES, 0, drawn * 2);
        }
      }

      // the four bright stars
      const h = this.progs.halo;
      gl.useProgram(h.p);
      gl.uniformMatrix4fv(h.u.uPV, false, pv);
      gl.uniform1f(h.u.uDpr, this.dpr); gl.uniform1f(h.u.uSize, 70);
      gl.uniform1f(h.u.uFade, starFade * (0.3 + 0.7 * smooth(0.08, 0.18, t))); gl.uniform3fv(h.u.uColor, P.warm);
      const glow = new Float32Array(this.named.map((s, i) => {
        const [a, b] = BANDS.stars[i];
        const on = smooth(a - 0.02, a + 0.02, t) * (1 - smooth(b - 0.02, b + 0.02, t));
        s.glow += (on - s.glow) * km;
        return s.glow * (reduced ? 1 : 0.85 + 0.15 * Math.sin(time * 2.2 + i));
      }));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.haloVbo); gl.enableVertexAttribArray(h.a.aPos); gl.vertexAttribPointer(h.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.haloGlow); gl.bufferData(gl.ARRAY_BUFFER, glow, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(h.a.aGlow); gl.vertexAttribPointer(h.a.aGlow, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, this.named.length);
    }

    const terrainFade = 1 - smooth(0.965, 1, t);
    if (terrainFade > 0.001) {
      const m = this.progs.terrain;
      gl.useProgram(m.p);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.uniformMatrix4fv(m.u.uPV, false, pv);
      gl.uniform3fv(m.u.uEye, eye);
      gl.uniform3fv(m.u.uSky, skyH);
      gl.uniform3fv(m.u.uRockLow, P.rockLow); gl.uniform3fv(m.u.uRockHigh, P.rockHigh); gl.uniform3fv(m.u.uSnow, P.snow);
      gl.uniform3fv(m.u.uLight, v3.norm([-0.5, 0.7, 0.5])); gl.uniform3fv(m.u.uContourColor, P.contour);
      gl.uniform1f(m.u.uSnowLine, 15); gl.uniform1f(m.u.uFade, terrainFade); gl.uniform1f(m.u.uContour, 0.2); gl.uniform1f(m.u.uWarm, warm);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.terrain.vbo); gl.enableVertexAttribArray(m.a.aPos); gl.vertexAttribPointer(m.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.terrain.ibo);
      gl.drawElements(gl.TRIANGLES, this.terrain.n, gl.UNSIGNED_INT, 0);
      gl.disable(gl.DEPTH_TEST);

      // headlamps on the route
      const lightFade = smooth(BANDS.climb[0] - 0.08, BANDS.climb[0] - 0.01, t) * (1 - smooth(0.93, 0.965, t)) * terrainFade;
      if (this.lights.n && lightFade > 0.001) {
        const h = this.progs.halo;
        gl.useProgram(h.p);
        gl.enable(gl.DEPTH_TEST); gl.depthMask(false);
        gl.uniformMatrix4fv(h.u.uPV, false, pv);
        gl.uniform1f(h.u.uDpr, this.dpr); gl.uniform1f(h.u.uSize, 22); gl.uniform1f(h.u.uFade, lightFade); gl.uniform3fv(h.u.uColor, P.warm);
        const g = new Float32Array(this.lights.n);
        // they light up from the summit down as the camera passes
        const sweep = smooth(BANDS.climb[0] - 0.02, BANDS.climb[1] + 0.02, t);
        for (let i = 0; i < this.lights.n; i++) {
          const s = (i + 0.5) / this.lights.n;
          g[i] = smooth(s - 0.08, s + 0.02, sweep * 1.1) * (reduced ? 1 : 0.8 + 0.2 * Math.sin(time * 2.6 + i * 1.7));
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lights.vbo); gl.enableVertexAttribArray(h.a.aPos); gl.vertexAttribPointer(h.a.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lights.glow); gl.bufferData(gl.ARRAY_BUFFER, g, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(h.a.aGlow); gl.vertexAttribPointer(h.a.aGlow, 1, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, this.lights.n);
        gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
      }
    }

    const rootFade = smooth(0.94, 0.985, t);
    if (rootFade > 0.001) {
      const l = this.progs.lines;
      gl.useProgram(l.p);
      gl.uniformMatrix4fv(l.u.uPV, false, pv);
      gl.uniform3fv(l.u.uColor, P.root); gl.uniform1f(l.u.uFade, 0.5 * rootFade);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.roots.vbo); gl.enableVertexAttribArray(l.a.aPos); gl.vertexAttribPointer(l.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, Math.floor(this.roots.n * smooth(0.94, 1, t)));
    }

    this.dispatchEvent(new CustomEvent('frame', { detail: { t } }));
    requestAnimationFrame(this.loop);
  }
}

customElements.define('ascent-scene', AscentScene);
