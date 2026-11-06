// The name as an asterism. Lowercase, a few stars per letter, sparse
// crooked lines, a different hand per letter. The rule of the Big Dipper:
// you draw the handle and the bowl, not the ladle.
// Coordinates in a 0..1 box, y up. lines are index pairs into stars.

export const LETTERS = {
  d: { stars: [[0.72, 0.98], [0.66, 0.42], [0.74, 0.03], [0.30, 0.52], [0.06, 0.18], [0.36, 0.04]], lines: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 2]] },
  a: { stars: [[0.58, 0.55], [0.14, 0.44], [0.10, 0.08], [0.56, 0.12], [0.68, 0.00]], lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4]] },
  n: { stars: [[0.08, 0.60], [0.12, 0.02], [0.30, 0.56], [0.62, 0.52], [0.70, 0.04]], lines: [[0, 1], [0, 2], [2, 3], [3, 4]] },
  i: { stars: [[0.46, 0.86], [0.44, 0.56], [0.40, 0.04]], lines: [[1, 2]] },
  e: { stars: [[0.08, 0.34], [0.62, 0.38], [0.54, 0.58], [0.32, 0.68], [0.10, 0.52], [0.12, 0.10], [0.58, 0.04]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 5], [5, 6]] },
  l: { stars: [[0.44, 1.00], [0.38, 0.50], [0.48, 0.02], [0.66, 0.06]], lines: [[0, 1], [1, 2], [2, 3]] },
  w: { stars: [[0.02, 0.58], [0.22, 0.02], [0.44, 0.44], [0.66, 0.00], [0.88, 0.60]], lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  y: { stars: [[0.08, 0.58], [0.34, 0.04], [0.64, 0.60], [0.22, -0.34]], lines: [[0, 1], [2, 1], [1, 3]] },
  c: { stars: [[0.62, 0.50], [0.20, 0.54], [0.06, 0.26], [0.22, 0.02], [0.60, 0.08]], lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  k: { stars: [[0.14, 1.00], [0.10, 0.04], [0.56, 0.52], [0.16, 0.30], [0.62, 0.00]], lines: [[0, 1], [2, 3], [3, 4]] },
  o: { stars: [[0.34, 0.60], [0.06, 0.34], [0.26, 0.02], [0.64, 0.16], [0.60, 0.50]], lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  f: { stars: [[0.62, 0.96], [0.34, 0.76], [0.28, 0.04], [0.08, 0.50], [0.54, 0.48]], lines: [[0, 1], [1, 2], [3, 4]] },
};

const ADVANCE = { default: 1.12, i: 0.72, l: 0.84 };
const SPACE = 0.9;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Lay out words. Returns stars [[x, y, anchor, letter]] and lines [[i, j, letter]]
// in letter units, y up, with the per-letter jitter, rotation and baseline
// shifts the direction asks for. `lines` of text: each word on its own line
// when `stacked`, else one line with "wyckoff" sitting a little lower.
export function layoutName(text, { stacked = false, seed = 7, tight = false } = {}) {
  const adv = (ch) => (tight ? 0.84 * (ADVANCE[ch] || ADVANCE.default) / ADVANCE.default : (ADVANCE[ch] || ADVANCE.default));
  const rnd = mulberry32(seed);
  const words = text.toLowerCase().split(' ');
  const stars = [], lines = [];
  const seen = {};
  let letter = 0;
  const widths = words.map((w) => [...w].reduce((s, ch, i) => s + (i === w.length - 1 ? 0.75 : adv(ch)), 0));
  let penX = 0;
  words.forEach((word, wi) => {
    let x = stacked ? -widths[wi] / 2 + (wi === 1 ? (tight ? 0.4 : 1.0) : 0) : penX;
    const baseY = stacked ? (wi === 0 ? 0.62 : -0.78) : (wi === 1 ? -0.18 : 0);
    for (const ch of word) {
      const def = LETTERS[ch];
      if (!def) { x += adv(ch); continue; }
      const use = (seen[ch] = (seen[ch] || 0) + 1);
      // repeated letters: start the point list from a different star
      const shift = (use - 1) % def.stars.length;
      const pts = def.stars.map((_, i) => def.stars[(i + shift) % def.stars.length]);
      const remap = (i) => (i - shift + def.stars.length) % def.stars.length;
      const bl = baseY + (rnd() - 0.5) * 0.2;
      const rot = (rnd() - 0.5) * (10 * Math.PI / 180);
      const cx = x + 0.4, cy = bl + 0.3;
      const base = stars.length;
      pts.forEach(([px, py], i) => {
        const jx = (rnd() - 0.5) * 0.09, jy = (rnd() - 0.5) * 0.09;
        const lx = x + px + jx - cx, ly = bl + py + jy - cy;
        const rx = cx + lx * Math.cos(rot) - ly * Math.sin(rot), ry = cy + lx * Math.sin(rot) + ly * Math.cos(rot);
        stars.push([rx, ry, 0, letter]);
      });
      // anchors: first and last star of the original definition
      stars[base + remap(0)][2] = 1;
      stars[base + remap(def.stars.length - 1)][2] = 1;
      for (const [i, j] of def.lines) lines.push([base + remap(i), base + remap(j), letter]);
      letter++;
      x += adv(ch);
    }
    penX = x - (ADVANCE.default - 1) + SPACE;
  });
  // centre horizontally
  const xs = stars.map((s) => s[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const off = (minX + maxX) / 2;
  for (const s of stars) s[0] -= off;
  return { stars, lines, letters: letter, width: maxX - minX };
}
