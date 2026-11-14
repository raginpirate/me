// The few helpers everything shares.

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// seeded random numbers, so the page is the same page on every visit
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// the one twinkle: a brightness that swings between `floor` and 1
export const twinkle = (time, phase, floor, rate) => floor + (1 - floor) * (0.5 + 0.5 * Math.sin(time * rate + phase));

// smooth noise from a seed: noise(x, y), fbm and ridged built on it
export function makeNoise(seed) {
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
  const fbm = (x, y, oct = 4) => {
    let s = 0, amp = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f); n += amp; amp *= 0.5; f *= 2.03; }
    return s / n;
  };
  const ridged = (x, y, oct = 3) => {
    let s = 0, amp = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += amp * (1 - Math.abs(2 * noise(x * f, y * f) - 1)); n += amp; amp *= 0.5; f *= 2.1; }
    return s / n;
  };
  return { noise, fbm, ridged };
}

export const mix = ([a, b], t) => a + (b - a) * t;
export const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); return (a < 0 ? a + 2 * Math.PI : a) - Math.PI; };
// a number from 0 to 1 for a whole-number place
export const hash = (i, j = 0, k = 0) => {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(k | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
// The glyph for an outline passing through a cell. f: how far down the cell
// it sits (0 top, 1 bottom). slope: rows per column, positive falls to the right.
export const edge = (f, slope) => slope < -0.8 ? '/' : slope > 0.8 ? '\\' : f < 0.3 ? "'" : f < 0.66 ? '-' : '_';
export const mixHex = (a, b, t) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)), A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
