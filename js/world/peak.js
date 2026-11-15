// The painted peak: a snow-topped summit lit from the left, from the apex down to the seam inside the clouds.

import { clamp, hash, makeNoise, mulberry32 } from '../math.js';
import { LAYOUT } from '../art.js';

const FOOT = { base: 8.6, ground: 8.3, snow: 4.4 };   // the larger mountain its silhouette is cut from, in screens
const HUMPS = [[0.52, 0.12, 0.62], [0.30, 0.13, 0.52], [0.78, 0.14, 0.44], [0.52, 0.5, 0.55]];
const ARETES = [[0, 0], [0, 1], [0.30, 0], [0.30, 1], [0.78, 1], [0.78, 0], [0.44, 0]];   // [start: 0 = the apex, else a share of the width; which noise]

export function makePeak(d) {
  const N = makeNoise(20181105), R = mulberry32(42), { cols, S, summitRow, seamRow, bodyTop } = d, baseRow = FOOT.base * S, Hm = baseRow - summitRow;
  // silhouette
  const crest = new Float64Array(cols);
  for (let c = 0; c < cols; c++) {
    const x = c / cols; let h = (N.ridged(9 * x + 2.3, 0.7, 2) - 0.5) * 0.08 + (N.noise(40 * x + 5, 1.1) - 0.5) * 0.02;
    for (const [at, w, tall] of HUMPS) h += tall * Math.exp(-((x - at) ** 2) / (2 * w * w));
    crest[c] = baseRow - Math.max(0, h) * Hm;
  }
  let topCol = 0; for (let c = 1; c < cols; c++) if (crest[c] < crest[topCol]) topCol = c;
  const lift = crest[topCol] - summitRow; for (let c = 0; c < cols; c++) crest[c] -= lift;
  const slope = Array.from(crest, (_, c) => c > 0 && c < cols - 1 ? (crest[c + 1] - crest[c - 1]) / 2 : 0);
  const slopeS = slope.map((_, c) => (slope[Math.max(0, c - 1)] + slope[c] + slope[Math.min(cols - 1, c + 1)]) / 3);

  // arêtes wander down from the apex and the shoulders
  const arete = new Map(), stopRow = Math.round(FOOT.ground * S) - 2;
  for (const [start, dir] of ARETES) {
    let c = start ? Math.round(start * cols) : topCol, r = crest[c] + 1;
    for (let step = 0; step < 1.6 * Hm && r < stopRow; step++) {
      const n = N.noise(0.11 * c + 0.03 * step, 0.05 * r + 7 * dir), dc = (n < 0.42 ? -1 : n > 0.58 ? 1 : 0) * (R() < 0.7 ? 1 : 0);
      const nr = r + 1, nc = clamp(c + dc, 0, cols - 1);
      if (nr < crest[nc] + 1) break;
      arete.set(Math.round(nr) * cols + nc, dc < 0 ? '/' : dc > 0 ? '\\' : '|'); r = nr; c = nc;
    }
  }

  // what the peak covers on each row: the run of columns round the apex
  const span = [];
  for (let row = 0; row <= seamRow + 3; row++) {
    if (crest[topCol] > row) { span.push(null); continue; }
    let a = topCol, b = topCol; while (a > 0 && crest[a - 1] <= row) a--; while (b < cols - 1 && crest[b + 1] <= row) b++;
    span.push([a, b + 1]);
  }
  const [sa, sb] = span[seamRow], ax = (sa + sb) / 2, seamHalf = (sb - sa) / 2;

  // cells, column by column
  const cells = [], limit = seamRow + 4;
  for (let c = 0; c < cols; c++) {
    const snowline = FOOT.snow * S + (N.fbm(0.09 * c + 3, 2.2, 3) - 0.5) * 16, lit = slopeS[c] < 0 ? 1 : slopeS[c] > 0 ? 0 : 0.5, across = clamp(Math.abs(c - topCol) / (0.5 * cols), 0, 1);
    for (let r = Math.max(0, Math.ceil(crest[c])); r < limit; r++) {
      const depth = r - crest[c], facet = (N.fbm(0.17 * c + 4.2, 0.11 * r + 1.1, 3) - 0.5) * 0.75, grain = (N.noise(0.9 * c, 0.9 * r) - 0.5) * 0.2;
      const light = clamp(0.08 + 0.36 * lit + 0.18 * (1 - across) + 1.3 * facet + grain - 0.0015 * depth, 0, 1), A = arete.get(r * cols + c), line = snowline + (A ? 11 : 0);
      let cell = null;
      if (r < line) {
        const isEdge = r === Math.round(line) - 1 || depth < 1, s = light + 0.25;
        const ch = isEdge ? (lit >= 0.5 ? '@' : '%') : A || (s > 0.85 ? '#' : s > 0.65 ? '%' : s > 0.45 ? ':' : s > 0.3 ? '.' : null);
        if (ch) cell = [r, c, ch, 'snow', light > 0.45 || isEdge ? 1 : 0.55];
      } else if (A) cell = [r, c, A, lit >= 0.5 ? 'rockLight' : 'rockDark', 1];
      else {
        const i = clamp(Math.floor((1 - light) * 8), 0, 7);
        if (!(R() < 0.22 + 0.4 * (1 - light))) cell = [r, c, '%#*+=:-.'[i], i <= 2 ? 'rockLight' : i <= 5 ? 'rock' : 'rockDark', 1];
      }
      // kept: inside the span, and thinning out through the seam where the massif's core fills in
      const sp = span[r];
      if (cell && sp && c >= sp[0] && c < sp[1] && (r < bodyTop || hash(r, c, 5) > (r - bodyTop) / 6)) cells.push(cell);
    }
  }

  // the rope: the route on the peak
  const rope = [], first = Math.ceil(summitRow) + 2;
  for (let row = first; row < bodyTop; row++) {
    const n = row - first, tt = n / (bodyTop - summitRow), [a, b] = span[row];
    rope.push([clamp(Math.round(topCol + 1 + (Math.floor(ax + 0.5) - topCol - 1) * tt), a + 1, b - 2), row, n % 4 === 0 ? '+' : ':']);
  }
  return { crest, span, cells, rope, topCol, ax, seamHalf };
}

// The cells as they are finally shown: the rope laid in, and the cells the route crosses at the seam taken out.
export function finishPeak(peak, cols, routeClear) {
  const at = new Map(peak.cells.map((c) => [c[0] * cols + c[1], c]));
  for (const [col, row, ch] of peak.rope) at.set(row * cols + col, [row, col, ch, 'muted', ch === '+' ? 0.8 : 0.5]);
  for (const key of routeClear) at.delete(key);
  peak.cells = [...at.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  return peak;
}
