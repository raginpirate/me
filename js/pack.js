// The model, turned into what the renderer draws: runs of instances and ground textures. Nothing here moves.

import { BYTES, KIND, INK, WASH, HOT, EDGE, HIDE, writer } from './glsl.js';
import { PALETTE, MIXES, TREES, LEAF_ROW } from './art.js';
import { HUT } from './world/ground.js';
import { pathMark } from './world/lobe.js';
import { CLOUDS, SNOW, LEAVES, cloudColumns } from './world/air.js';

// colours by number: 0 is the sky of the moment, then the palette, then its mixes
export const COLOURS = ['sky', ...Object.keys(PALETTE).filter((n) => n !== 'sky'), ...Object.keys(MIXES)];
const NUMBER = Object.fromEntries(COLOURS.map((n, i) => [n, i]));
export const colour = (name) => NUMBER[name] ?? (() => { throw new Error(`no colour ${name}`); })();
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const rgb = (name) => MIXES[name] ? (([a, b, t]) => hex(PALETTE[a]).map((v, i) => Math.round(v + (hex(PALETTE[b])[i] - v) * t)))(MIXES[name]) : hex(PALETTE[name]);

// the layers: the page itself, each lobe, the ground, and each depth of what is in the air
export const LAYER = { page: 0, lobe: 1, ground: 20, cloud: 23, snow: 27, leaf: 30, air: 34, front: 35 };   // air: the page again, but in front of every ridge. front: the ground again, in front of the hut
const SKY = 0, TONES = ['pineDark', 'rockDark', 'dim'];

// a run of instances: build(w) writes at most `count` of them
const run = (count, build) => { const buf = new ArrayBuffer(count * BYTES), w = writer(buf); build(w); return buf.slice(0, w.count * BYTES); };
const phase16 = (phase) => Math.round(phase / 6.28 * 65535) & 65535;

export function packSky({ sky }, glyph) {
  const tiers = ['dim', 'star', 'starBright'].map(colour);
  return run(sky.stars.length, (w) => { for (const [x, y, tier, ch, phase, fade] of sky.stars) w.put(x, y, 0, 0, phase16(phase), tier, 1, glyph(ch), tiers[tier], fade, LAYER.page, KIND.star); });
}

// The painted peak: what hides the stars behind it, then its cells. The second run is its rope, to be lit; then how many of the first only hide.
export function packPeak({ peak, dims }, glyph) {
  let hides = 0;
  return [run(peak.span.length + peak.cells.length, (w) => {
    peak.span.forEach((s, row) => { if (s && row < dims.bodyTop) w.solid(s[0], row, 0, 0, s[1] - s[0], 1, 1, 1, 1, LAYER.page, HIDE); }); hides = w.count;
    for (const [row, col, ch, name, alpha] of peak.cells) w.put(col, row, 0, 0, 0, 0, 1, glyph(ch), colour(name), alpha, LAYER.page);
  }), run(2 * peak.rope.length, (w) => { for (const [col, row, ch] of peak.rope) lit(w, col, row, glyph(ch), LAYER.page); }), hides];
}
const lit = (w, col, row, g, layer) => { w.put(col, row, 0, 0, 0, 0, 1, g, colour('ember'), 1, layer, KIND.route); w.put(col, row, 0, 0, 0, 0, 1, g, colour('emberHot'), 1, layer, KIND.route, HOT); };

// A tree's glyphs: [row, column, glyph, colour, alpha], and per inked row its first and last column
function treeMarks([, , , shape, olive, dark, snowy]) {
  const rows = TREES[shape], leafy = olive != null, wide = rows[0].length, marks = [], spans = [];
  rows.forEach((text, i) => {
    const inked = [...text].map((ch, j) => ch !== ' ' ? j : -1).filter((j) => j >= 0); if (!inked.length) return;
    const f = inked[0], foot = leafy ? !/[&,()`]/.test(text) : i === rows.length - 1;
    spans.push([i, f, inked[inked.length - 1]]);
    for (const j of inked) {
      const right = j > (wide - 1) / 2 + 0.6, stem = leafy ? foot : foot && text[j] === '|';
      marks.push(leafy ? [i, j, text[j], stem ? 'ground' : olive ? 'leafOlive' : 'leaf', !stem && (dark || right) ? 0.6 : 1]
        : [i, j, text[j], !stem && (i < snowy || (i === snowy && snowy > 1 && j === f)) ? 'snow' : stem || dark || right ? 'pineDark' : 'pine', 1]);
    }
  });
  return { marks, spans, tall: rows.length, wide, pitch: leafy ? LEAF_ROW : 1 };
}

// A lobe, in strips of columns so that only the strips on the screen are drawn. Each strip: its body (one solid a column),
// what hides behind its trees, its cells, its trees; and after all the strips the lobe's route, to be lit.
// → { bytes, strips: [{ at, cover, hides, total, c0, c1 }] (counts from `at`: its body; all that hides; everything), route: [first, count], wash }
export const STRIPS = 16;
export function packLobe(l, i, dims, glyph) {
  const li = LAYER.lobe + i, { W, crest, cells, trees, wash, path } = l, bottom = dims.groundRow + 14;
  const rgba = new Uint8Array(W * wash.h * 4), tones = TONES.map(rgb);
  wash.idx.forEach((at, n) => { const a = wash.a[n], t = tones[wash.tone[n]]; rgba.set([t[0] * a / 255, t[1] * a / 255, t[2] * a / 255, a], at * 4); });
  const drawn = trees.map(treeMarks), count = W + cells.length + drawn.reduce((n, t) => n + t.marks.length + t.spans.length, 0) + 2 * path.length;
  // An outline's mark is drawn in the row under the height it stands for, so that is where the layer begins to hide: just
  // above its own marks, the same hair's breadth everywhere, on a level stretch as on a steep one.
  const LINE = 0.85, MIST = 5;   // and how many rows above it mist can rise
  // what it hides: under its skyline, everything. The skyline is a line, not steps: each column's solid has a sloping top,
  // from the height where it meets the column before to the height where it meets the next, and the haze rises off that.
  const meet = Float32Array.from({ length: W + 1 }, (_, b) => { const a = b > 0 ? crest[b - 1] : Infinity, c = b < W ? crest[b] : Infinity; return LINE + (a < Infinity && c < Infinity ? (a + c) / 2 : Math.min(a, c) + 2); });
  for (const [c, r] of path) for (const b of [c, c + 1]) meet[b] = Math.min(meet[b], r - 0.5);   // the route is never left out in front of its own ground
  const form = Float32Array.from(meet, (row) => Math.min(row, 1e6));
  // a tree's rank: the lower its foot, the nearer it stands, and the nearer hides the farther
  const order = trees.map((t, n) => n).sort((a, b) => trees[a][1] - trees[b][1]), rank = new Uint8Array(trees.length); order.forEach((n, at) => { rank[n] = 1 + Math.floor(at * 252 / Math.max(1, trees.length)); });
  const wide = Math.ceil(W / STRIPS), stripOf = (c) => Math.min(STRIPS - 1, Math.max(0, Math.floor(c / wide))), strips = [];
  const cellsBy = Array.from({ length: STRIPS }, () => []), treesBy = Array.from({ length: STRIPS }, () => []);
  for (const cell of cells) cellsBy[stripOf(cell[1])].push(cell);
  trees.forEach((t, n) => treesBy[stripOf(t[0])].push(n));
  let route = 0;
  const bytes = run(count, (w) => {
    for (let s = 0; s < STRIPS; s++) {
      const at = w.count, c0 = s * wide, c1 = Math.min(W, c0 + wide);
      for (let c = c0; c < c1; c++) {
        const left = Math.min(meet[c], bottom), right = Math.min(meet[c + 1], bottom), top = Math.min(left, right) - MIST;
        w.solid(c, top, left - top, right - top, 1, left < bottom || right < bottom ? bottom - top : 0, 1, SKY, 1, li, WASH | EDGE);
      }
      const cover = w.count - at;
      for (const n of treesBy[s]) { const [c, r, k] = trees[n], { spans, tall, wide: across, pitch } = drawn[n];   // a tree keeps the ink behind it from showing through it: to its own outline, row by row
        for (const [row, f, e] of spans) w.solid(c + 0.5, r + 1, f - 0.25 - across / 2, -(tall - row) * pitch, e - f + 1.5, pitch, k, rank[n], 1, li, HIDE, KIND.tree); }
      const hides = w.count - at;
      for (const [row, col, ch, name, alpha] of cellsBy[s]) w.put(col, row, 0, 0, 0, 0, 1, glyph(ch), colour(name), alpha, li);
      for (const n of treesBy[s]) { const [c, r, k] = trees[n], { marks, tall, wide: across, pitch } = drawn[n];
        for (const [row, col, ch, name, alpha] of marks) w.put(c + 0.5, r + 1, col - across / 2, -(tall - row) * pitch, 0, rank[n], k, glyph(ch), colour(name), alpha, li, KIND.tree); }
      strips.push({ at, cover, hides, total: w.count - at, c0, c1 });
    }
    route = w.count;
    path.forEach(([c, r], k) => lit(w, c, r, glyph(pathMark(k, r / dims.S)[0]), li));
  });
  return { bytes, strips, last: Math.max(cells.length ? cells[cells.length - 1][0] : 0, trees.length ? trees[trees.length - 1][1] : 0), route: [route, 2 * path.length], form, wash: { w: W, h: wash.h, y0: wash.y0, rgba } };
}

// The ground: what hides behind the line and the hut, then the earth, turf and soil and roots, and the hut. → [bytes, how many of the first only hide]
export function packGround({ ground, dims }, glyph) {
  const li = LAYER.ground, G = dims.groundRow + 1, { cols, deep, hutLeft, cells } = ground; let hides = 0;
  return [run(2 * cells.length + 6 + 72, (w) => {
    for (const [row, col] of cells) if (row === -1) w.solid(col, G - 1, 0, 0, 1, 1, 1, 1, 1, li, HIDE);
    // the hut hides what is behind it, to its own outline and no further: under the ridge line, between the roof's slopes, between the walls
    for (const [row, from, to, top] of [[1, 3, 10, 0.78], [2, 2.5, 10.5, 0], [3, 1.5, 11.5, 0], [4, 1.5, 11.5, 0], [5, 1.5, 11.5, 0]]) w.solid(hutLeft + from, G + row - 7 + top, 0, 0, to - from, 1 - top, 1, 1, 1, li, HIDE);
    hides = w.count;
    w.solid(0, G, 0, 0, cols, deep + 4, 1, colour('earth'), 1, li);
    for (const [row, col, ch, name, alpha] of cells) w.put(col, G + row, 0, 0, 0, 0, 1, glyph(ch), colour(name), alpha, li);
    HUT.forEach((text, i) => [...text].forEach((ch, j) => { if (ch !== ' ') w.put(hutLeft + j, G + i - 7, 0, 0, 0, 0, 1, glyph(ch), colour('[]'.includes(ch) ? 'ember' : 'timber'), 1, li); }));
  }), () => hides];
}

// How many of its own columns a cloud layer goes round in. The far layer is set small, so the screen is more of its
// columns than the page has: it goes round over its own width, or its clouds would never reach the right edge.
export const cloudSpan = (cols, n) => n === 0 ? cols / CLOUDS[0].k + 80 : cols + 80;

// One depth of cloud: what keeps the ink behind each cloud from showing through it, column by column, then every cloud's
// outline and body. A cloud has no fill: the sky, or the mountain, behind it is what you see in it. → [bytes, how many only hide]
export function packClouds({ air, N, dims }, n, glyph) {
  const { line, body } = CLOUDS[n], round = cloudSpan(dims.cols, n) / (dims.cols + 80),   // the far layer goes round over its own width
    shapes = air.clouds[n].map((c) => cloudColumns(c, N)), count = shapes.reduce((t, cols) => t + cols.reduce((m, col) => m + 1 + col[3].length, 0), 0), li = LAYER.cloud + n, kind = KIND.cloud;
  let hides = 0;
  return [run(count, (w) => {
    air.clouds[n].forEach(([x, y], i) => { const row = air.deckRow + y, at = x * round, rank = 1 + i % 250; for (const [u, rt, rb] of shapes[i]) w.solid(at, row, u, rt + 0.1, 1, rb - rt + 0.8, 1, rank, 1, li, HIDE, kind); });
    hides = w.count;
    air.clouds[n].forEach(([x, y], i) => { const row = air.deckRow + y, at = x * round, rank = 1 + i % 250;
      for (const [u, , , cells] of shapes[i]) for (const [r, ch, inBody, share] of cells) { const [name, alpha] = inBody ? body : line; w.put(at, row, u, r, 0, rank, 1, glyph(ch), colour(name), alpha * share, li, kind); } });
  }), () => hides];
}

// Snow, by depth, and the falling leaves: where each begins. The shader lets them fall.
export function packSnow({ air }, tiers, glyph) {
  return run(air.snow.length, (w) => { for (const [x, y, tier, ch, phase] of air.snow) if (tiers.includes(tier)) { const [k, , size, alpha, , name] = SNOW.tiers[tier]; w.put(x, y, 0, 0, phase16(phase), 0, size / k, glyph(ch), colour(name), alpha, LAYER.snow + tier, KIND.snow, INK | tier << 4); } });
}
export function packLeaves({ air }, glyph) {
  return run(air.leaves.length, (w) => { for (const [x, y, depth, rank, phase, frame, name] of air.leaves) { const [k, size, alpha] = LEAVES.depths[depth]; w.put(x, y, 0, 0, phase16(phase), Math.round(rank * 65535), size / k, glyph(','), colour(name), alpha, LAYER.leaf + depth, KIND.leaf, INK | depth << 4 | frame << 6); } });
}
