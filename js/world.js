// The painted peak: a snow-topped summit with its arêtes, lit from the
// left. Built once per resize into a row/column buffer of [glyph, colour]
// or [glyph, colour, strength], down to row `limit`; everything below that
// is the massif's, which paints its rock with face(), the same hand.
// P is the page's palette.
//
// Its outline and its arêtes are still worked out for the whole mountain
// this peak once topped (FOOT), so the peak is cell for cell what it was.

import { clamp, mulberry32, makeNoise, edge } from './util.js';

const FOOT = { base: 8.6, ground: 8.3, snow: 4.4 };   // screens: where that mountain's slopes ended, and its snowline

export function buildWorld(cols, rows, screenRows, D, P, limit) {
  const { noise, fbm, ridged } = makeNoise(20181105);
  const rnd = mulberry32(42);
  const G = D.glyphs, L = D.layout;
  const cells = new Array(rows);
  for (let r = 0; r < rows; r++) cells[r] = new Array(cols).fill(null);

  const summitRow = L.summit * screenRows;
  const baseRow = FOOT.base * screenRows;
  const groundRow = Math.round(FOOT.ground * screenRows);
  const snowBottom = FOOT.snow * screenRows;
  const apex = L.apexX * cols;
  const H = baseRow - summitRow; // the mountain's height in rows

  // the silhouette: a summit and two shoulders, ridged noise, down to the base
  const hump = (x, c, w, h) => h * Math.exp(-((x - c) ** 2) / (2 * w * w));
  const peak = new Float32Array(cols);
  for (let c = 0; c < cols; c++) {
    const x = c / cols;
    let h = hump(x, L.apexX, 0.12, 0.62) + hump(x, 0.30, 0.13, 0.52) + hump(x, 0.78, 0.14, 0.44) + hump(x, L.apexX, 0.5, 0.55);
    h += (ridged(x * 9 + 2.3, 0.7, 2) - 0.5) * 0.08 + (noise(x * 40 + 5, 1.1) - 0.5) * 0.02;
    h = Math.max(0, h);
    peak[c] = baseRow - h * H;
  }
  // make the apex a true apex: the summit column is the highest point
  const apexCol = Math.round(apex);
  let top = Infinity, topCol = apexCol;
  for (let c = 0; c < cols; c++) if (peak[c] < top) { top = peak[c]; topCol = c; }
  const lift = top - summitRow;
  for (let c = 0; c < cols; c++) peak[c] -= lift;

  // slope, smoothed over 3 cells; negative means the surface rises to the right
  const slope = new Float32Array(cols);
  for (let c = 1; c < cols - 1; c++) slope[c] = (peak[c + 1] - peak[c - 1]) / 2;
  const slopeS = new Float32Array(cols);
  for (let c = 0; c < cols; c++) slopeS[c] = (slope[Math.max(0, c - 1)] + slope[c] + slope[Math.min(cols - 1, c + 1)]) / 3;

  // ridges: downhill walks from the summit and shoulders
  const ridgeCell = new Map(); // key r*cols+c → glyph
  const walks = [[topCol, 0], [topCol, 1], [Math.round(0.30 * cols), 0], [Math.round(0.30 * cols), 1], [Math.round(0.78 * cols), 1], [Math.round(0.78 * cols), 0], [Math.round(0.44 * cols), 0]];
  for (const [startC, dir] of walks) {
    let c = startC, r = peak[startC] + 1;
    let drift = dir ? 1 : -1;
    for (let step = 0; step < H * 1.6 && r < groundRow - 2; step++) {
      const n = noise(c * 0.11 + step * 0.03, r * 0.05 + dir * 7);
      if (n < 0.42) drift = -1; else if (n > 0.58) drift = 1; else drift = 0;
      const dc = drift * (rnd() < 0.7 ? 1 : 0);
      const glyph = dc < 0 ? '/' : dc > 0 ? '\\' : '|';
      const nr = r + 1, nc = clamp(c + dc, 0, cols - 1);
      if (nr < peak[nc] + 1) break; // off the mountain
      ridgeCell.set(Math.round(nr) * cols + nc, glyph);
      r = nr; c = nc;
    }
  }

  // snowline: ragged, clings to ridges
  const snowline = new Float32Array(cols);
  for (let c = 0; c < cols; c++) snowline[c] = snowBottom + (fbm(c * 0.09 + 3, 2.2, 3) - 0.5) * 16;

  const ramp = G.rock;
  for (let c = 0; c < cols; c++) {
    const pk = peak[c];
    const lit = slopeS[c] < 0 ? 1 : slopeS[c] > 0 ? 0 : 0.5;  // left faces (rising to the right) are lit
    for (let r = Math.max(0, Math.ceil(pk)); r < limit; r++) {
      const depth = r - pk;
      // lighting: which side of the ridge, how far from the crest, facets 4–7 cells wide
      const across = clamp(Math.abs(c - topCol) / (cols * 0.5), 0, 1);
      const facet = (fbm(c * 0.17 + 4.2, r * 0.11 + 1.1, 3) - 0.5) * 0.75;
      const grain = (noise(c * 0.9, r * 0.9) - 0.5) * 0.2;
      let light = clamp(0.08 + 0.36 * lit + 0.18 * (1 - across) + facet * 1.3 + grain - depth * 0.0015, 0, 1);
      const onRidge = ridgeCell.get(r * cols + c);
      const inSnow = r < snowline[c] + (onRidge ? 11 : 0);
      const edgeRow = Math.round(snowline[c] + (onRidge ? 11 : 0));
      if (inSnow) {
        // snow: bright on lit faces, thin in shadow; the edge is the brightest line
        const isEdge = r === edgeRow - 1 || (depth < 1);
        let ch;
        if (isEdge) ch = lit >= 0.5 ? '@' : '%';
        else if (onRidge) ch = onRidge;
        else {
          const s = light + 0.25;
          ch = s > 0.85 ? '#' : s > 0.65 ? '%' : s > 0.45 ? ':' : s > 0.3 ? '.' : ' ';
        }
        if (ch !== ' ') cells[r][c] = light > 0.45 || isEdge ? [ch, P.snow] : [ch, P.snow, 0.55];
        continue;
      }
      // rock
      let ch, color;
      if (onRidge) {
        ch = onRidge;
        color = lit >= 0.5 ? P.rockLight : P.rockDark;
      } else {
        const i = clamp(Math.floor((1 - light) * ramp.length), 0, ramp.length - 1);
        ch = ramp[i];
        color = i <= 2 ? P.rockLight : i <= 5 ? P.rock : P.rockDark;
        // shadows are airy: the darker the cell, the more often it is left blank
        if (rnd() < 0.22 + (1 - light) * 0.4) ch = ' ';
      }
      if (ch !== ' ') cells[r][c] = [ch, color];
    }
  }

  return { cells, peak, topCol };
}

// The same hand, for the mountain under the peak and for bare rock anywhere
// on it. Any outline will do: peak[c] is the crest row of column c, and x0
// is the page column of column 0. It is lit from the left as the peak is:
// lit(c, r) says how much of the light a place has, 1 on a face that looks
// left, 0 on one that looks right. Its snow comes down to the peak's own
// snowline; below that it is rock, with a line round its outline, and its
// arêtes keep their snow down to row `ice`. arete(r, c): the glyph of an
// arête passing through a cell. Returns rows r0 to r1 as cells,
// [glyph, colour] or [glyph, colour, strength].
const N = makeNoise(20181105);
export function face({ W, x0, r0, r1, peak, axis, half, lit, arete, ice = 0, lift = 0, seed, S, P }) {
  const { noise, fbm } = N, rnd = mulberry32(seed);
  const cells = Array.from({ length: r1 - r0 }, () => new Array(W).fill(null));
  for (let c = 0; c < W; c++) {
    const pk = peak[c]; if (!(pk < r1)) continue;
    const x = x0 + c, across = clamp(Math.abs(x - axis) / half, 0, 1);
    const line = FOOT.snow * S + (fbm(x * 0.09 + 3, 2.2, 3) - 0.5) * 16;   // the peak's own snowline, carried on
    for (let r = Math.max(r0, Math.ceil(pk)); r < r1; r++) {
      const sun = lit(c, r);
      const facet = (fbm(x * 0.17 + 4.2, r * 0.11 + 1.1, 3) - 0.5) * 0.75, grain = (noise(x * 0.9, r * 0.9) - 0.5) * 0.2;
      const light = clamp(0.08 + 0.36 * sun + 0.18 * (1 - across) + facet * 1.3 + grain, 0, 1);
      const on = arete(r, c), edgeRow = Math.round(line + (on ? 11 : 0));
      // its outline: the top of a column, or a cell with sky beside it
      const rim = r - pk < 1 ? edge(pk - Math.floor(pk), (peak[c + 1] - peak[c - 1]) / 2 || 0) : !(peak[c - 1] <= r) ? '/' : !(peak[c + 1] <= r) ? '\\' : null;
      let cell = null;
      if (r < line + (on ? 11 : 0)) {
        // snow: bright on lit faces, thin in shadow; the edge is the brightest line
        const isEdge = r === edgeRow - 1 || r - pk < 1, s = light + 0.25;
        const ch = isEdge ? (sun >= 0.5 ? '@' : '%') : on || (s > 0.85 ? '#' : s > 0.65 ? '%' : s > 0.45 ? ':' : s > 0.3 ? '.' : ' ');
        if (ch !== ' ') cell = light > 0.45 || isEdge ? [ch, P.snow] : [ch, P.snow, 0.55];
      } else if (on) cell = [on, r < ice ? P.snow : sun >= 0.5 ? P.rockLight : P.rock];           // on the ice an arête keeps its snow
      else if (rim) cell = [rim, P.rockLight, sun >= 0.5 ? 1 : 0.7];
      else {
        // rock, in the marks the snow is made of, so the mountain is one texture from top to bottom: dense and pale where
        // the light falls, thinner and darker in shadow, but there: a face in shadow is still a face
        const s = clamp(light + lift * sun, 0, 1) + 0.3;
        if (rnd() >= 0.1 + (1 - s) * 0.35) cell = s > 0.75 ? [s > 0.95 ? '#' : '%', P.rockLight] : s > 0.52 ? [':', P.rock] : [s > 0.4 ? '%' : '#', P.rockDark];
      }
      cells[r - r0][c] = cell;
    }
  }
  return cells;
}
