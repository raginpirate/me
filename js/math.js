// Small pure maths: nothing here knows about the page.

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
export const mix = (a, b, u) => a + (b - a) * u;
export const twinkle = (time, phase, floor, rate) => floor + (1 - floor) * (0.5 + 0.5 * Math.sin(time * rate + phase));

// a seeded stream of numbers in [0, 1)
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a stateless number in [0, 1) for three integers
export function hash(i, j = 0, k = 0) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// value noise on a 256 lattice, with its fractal and ridged sums
export function makeNoise(seed) {
  const rnd = mulberry32(seed), perm = new Uint8Array(512), grid = new Float64Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; grid[i] = rnd(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const a = grid[perm[X + perm[Y]]], b = grid[perm[X + 1 + perm[Y]]], c = grid[perm[X + perm[Y + 1]]], d = grid[perm[X + 1 + perm[Y + 1]]];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
  const sum = (shape, gain) => (x, y, oct) => { let s = 0, n = 0, amp = 0.5, f = 1; for (let o = 0; o < oct; o++) { s += amp * shape(noise(x * f, y * f)); n += amp; amp /= 2; f *= gain; } return s / n; };
  const fbm = sum((v) => v, 2.03), ridged = sum((v) => 1 - Math.abs(2 * v - 1), 2.1);
  return { noise, fbm: (x, y, oct = 4) => fbm(x, y, oct), ridged: (x, y, oct = 3) => ridged(x, y, oct) };
}

// the glyph for an outline passing through a cell. f: how far down the cell; slope: rows per column, positive falls to the right
export const edge = (f, slope) => slope < -0.8 ? '/' : slope > 0.8 ? '\\' : f < 0.3 ? "'" : f < 0.66 ? '-' : '_';
