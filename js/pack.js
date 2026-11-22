// The model, turned into what the renderer draws: runs of instances and ground textures. Nothing here moves.

import { BYTES, KIND, INK, WASH, HOT, EDGE, SOFT_X, SOFT_Y, writer } from './glsl.js';
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
export const LAYER = { page: 0, lobe: 1, ground: 20, cloud: 23, snow: 27, leaf: 30 };
const SKY = 0, TONES = ['pineDark', 'rockDark', 'dim'];

// a run of instances: build(w) writes at most `count` of them
const run = (count, build) => { const buf = new ArrayBuffer(count * BYTES), w = writer(buf); build(w); return buf.slice(0, w.count * BYTES); };
const phase16 = (phase) => Math.round(phase / 6.28 * 65535) & 65535;

export function packSky({ sky }, glyph) {
  const tiers = ['dim', 'star', 'starBright'].map(colour);
  return run(sky.stars.length, (w) => { for (const [x, y, tier, ch, phase, fade] of sky.stars) w.put(x, y, 0, 0, phase16(phase), tier, 1, glyph(ch), tiers[tier], fade, LAYER.page, KIND.star); });
}

// The painted peak: it hides the stars behind it, then its cells. The second run is its rope, to be lit.
export function packPeak({ peak, dims }, glyph) {
  return [run(peak.span.length + peak.cells.length, (w) => {
    peak.span.forEach((s, row) => { if (s && row < dims.bodyTop) w.solid(s[0], row, 0, 0, s[1] - s[0], 1, 1, SKY, 1, LAYER.page); });
    for (const [row, col, ch, name, alpha] of peak.cells) w.put(col, row, 0, 0, 0, 0, 1, glyph(ch), colour(name), alpha, LAYER.page);
  }), run(2 * peak.rope.length, (w) => { for (const [col, row, ch] of peak.rope) lit(w, col, row, glyph(ch), LAYER.page); })];
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

// A lobe: what it hides (one solid a column), its mist, its cells, its trees; then its route, to be lit.
// → { bytes, cover: how many of the first instances are what hides, route: [first, count] within bytes, wash: { w, h, y0, rgba } }
export function packLobe(l, i, dims, glyph) {
  const li = LAYER.lobe + i, { W, cover, crest, cells, trees, wash, path } = l, bottom = dims.groundRow + 14;
  const rgba = new Uint8Array(W * wash.h * 4), tones = TONES.map(rgb);
  wash.idx.forEach((at, n) => { const a = wash.a[n], t = tones[wash.tone[n]], c = at % W; rgba.set([t[0] * a / 255, t[1] * a / 255, t[2] * a / 255, a], at * 4); });
  const drawn = trees.map(treeMarks), count = 2 * W + cells.length + drawn.reduce((n, t) => n + t.marks.length + t.spans.length, 0) + 2 * path.length;
  let route = 0, solids = 0, form = null;
  const bytes = run(count, (w) => {
    // An outline's mark is drawn in the row under the height it stands for, so that is where the layer begins to hide: just
    // above its own marks, the same hair's breadth everywhere, on a level stretch as on a steep one.
    const LINE = 0.85, MIST = 5;   // and how many rows above it mist can rise
    // what it hides: under its skyline, everything. The skyline is a line, not steps: each column's solid has a sloping top,
    // from the height where it meets the column before to the height where it meets the next, and the haze rises off that.
    const meet = Float32Array.from({ length: W + 1 }, (_, b) => { const a = b > 0 ? crest[b - 1] : Infinity, c = b < W ? crest[b] : Infinity; return LINE + (a < Infinity && c < Infinity ? (a + c) / 2 : Math.min(a, c) + 2); });
    for (const [c, r] of path) for (const b of [c, c + 1]) meet[b] = Math.min(meet[b], r - 0.5);
    form = Float32Array.from(meet, (row) => Math.min(row, 1e6));   // the route is never left out in front of its own ground
    for (let c = 0; c < W; c++) {
      const left = Math.min(meet[c], bottom), right = Math.min(meet[c + 1], bottom), top = Math.min(left, right) - MIST;
      w.solid(c, top, left - top, right - top, 1, left < bottom || right < bottom ? bottom - top : 0, 1, SKY, 1, li, WASH | EDGE);
    }
    solids = w.count;
    for (const [row, col, ch, name, alpha] of cells) w.put(col, row, 0, 0, 0, 0, 1, glyph(ch), colour(name), alpha, li);
    trees.forEach(([c, r, k], n) => {
      const { marks, spans, tall, wide, pitch } = drawn[n], x = c + 0.5, y = r + 1;
      for (const [row, f, e] of spans) w.solid(x, y, f - 0.45 - wide / 2, -(tall - row) * pitch, e - f + 1.9, pitch, k, SKY, 1, li, WASH | SOFT_X, KIND.tree);   // a tree hides what is behind it, fading out at its sides
      for (const [row, col, ch, name, alpha] of marks) w.put(x, y, col - wide / 2, -(tall - row) * pitch, 0, 0, k, glyph(ch), colour(name), alpha, li, KIND.tree);
    });
    route = w.count;
    path.forEach(([c, r], k) => lit(w, c, r, glyph(pathMark(k, r / dims.S)[0]), li));
  });
  return { bytes, cover: W, solids, last: Math.max(cells.length ? cells[cells.length - 1][0] : 0, trees.length ? trees[trees.length - 1][1] : 0), route: [route, 2 * path.length], form, wash: { w: W, h: wash.h, y0: wash.y0, rgba } };
}

// The ground: earth under the line, the line hiding what is behind it, turf and soil and roots, and the hut.
export function packGround({ ground, dims }, glyph) {
  const li = LAYER.ground, G = dims.groundRow + 1, { cols, deep, hutLeft, cells } = ground;
  return run(1 + 2 * cells.length + 5 + 72, (w) => {
    w.solid(0, G, 0, 0, cols, deep + 4, 1, colour('earth'), 1, li);
    for (const [row, col] of cells) if (row === -1) w.solid(col, G - 1, 0, 0, 1, 1, 1, SKY, 1, li);
    for (const [row, col, ch, name, alpha] of cells) w.put(col, G + row, 0, 0, 0, 0, 1, glyph(ch), colour(name), alpha, li);
    // the hut hides what is behind it, to its own outline and no further: under the ridge line, between the roof's slopes, between the walls
    for (const [row, from, to, top] of [[1, 3, 10, 0.78], [2, 2.5, 10.5, 0], [3, 1.5, 11.5, 0], [4, 1.5, 11.5, 0], [5, 1.5, 11.5, 0]]) w.solid(hutLeft + from, G + row - 7 + top, 0, 0, to - from, 1 - top, 1, SKY, 1, li);
    HUT.forEach((text, i) => [...text].forEach((ch, j) => { if (ch !== ' ') w.put(hutLeft + j, G + i - 7, 0, 0, 0, 0, 1, glyph(ch), colour('[]'.includes(ch) ? 'ember' : 'timber'), 1, li); }));
  });
}

// How many of its own columns a cloud layer goes round in. The far layer is set small, so the screen is more of its
// columns than the page has: it goes round over its own width, or its clouds would never reach the right edge.
export const cloudSpan = (cols, n) => n === 0 ? cols / CLOUDS[0].k + 80 : cols + 80;

// One depth of cloud. Each cloud hides what is behind it, column by column, then its outline and body.
export function packClouds({ air, N, dims }, n, glyph) {
  const { line, body, k } = CLOUDS[n], round = cloudSpan(dims.cols, n) / (dims.cols + 80),   // the far layer goes round over its own width
    shapes = air.clouds[n].map((c) => cloudColumns(c, N)), count = shapes.reduce((t, cols) => t + cols.reduce((m, col) => m + 1 + col[3].length, 0), 0);
  return run(count, (w) => air.clouds[n].forEach(([x, y], i) => {
    const li = LAYER.cloud + n, kind = KIND.cloud, row = air.deckRow + y, at = x * round;
    for (const [u, rt, rb, cells] of shapes[i]) {
      w.solid(at, row, u, rt - 0.15, 1, rb - rt + 1.3, 1, SKY, 1, li, SOFT_Y, kind);
      for (const [r, ch, inBody, share] of cells) { const [name, alpha] = inBody ? body : line; w.put(at, row, u, r, 0, 0, 1, glyph(ch), colour(name), alpha * share, li, kind); }
    }
  }));
}

// Snow, by depth, and the falling leaves: where each begins. The shader lets them fall.
export function packSnow({ air }, tiers, glyph) {
  return run(air.snow.length, (w) => { for (const [x, y, tier, ch, phase] of air.snow) if (tiers.includes(tier)) { const [k, , size, alpha, , name] = SNOW.tiers[tier]; w.put(x, y, 0, 0, phase16(phase), 0, size / k, glyph(ch), colour(name), alpha, LAYER.snow + tier, KIND.snow, INK | tier << 4); } });
}
export function packLeaves({ air }, glyph) {
  return run(air.leaves.length, (w) => { for (const [x, y, depth, rank, phase, frame, name] of air.leaves) { const [k, size, alpha] = LEAVES.depths[depth]; w.put(x, y, 0, 0, phase16(phase), Math.round(rank * 65535), size / k, glyph(','), colour(name), alpha, LAYER.leaf + depth, KIND.leaf, INK | depth << 4 | frame << 6); } });
}
