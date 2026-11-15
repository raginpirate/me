// The model, turned into what the renderer draws: instances, ground textures, and named ranges of both.

import { BYTES, KIND, writer } from './glsl.js';
import { PALETTE, MIXES } from './art.js';

// colours by number: 0 is the sky of the moment, then the palette, then its mixes
export const COLOURS = ['sky', ...Object.keys(PALETTE).filter((n) => n !== 'sky'), ...Object.keys(MIXES)];
export const colour = (name) => { const i = COLOURS.indexOf(name); if (i < 0) throw new Error(`no colour ${name}`); return i; };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const rgb = (name) => MIXES[name] ? (([a, b, t]) => hex(PALETTE[a]).map((v, i) => Math.round(v + (hex(PALETTE[b])[i] - v) * t)))(MIXES[name]) : hex(PALETTE[name]);

export const PAGE = 0;   // the layer that is the page itself

// a run of instances: build(w) writes them; → ArrayBuffer
export function run(count, build) { const buf = new ArrayBuffer(count * BYTES), w = writer(buf); build(w); return buf.slice(0, w.count * BYTES); }

export function packSky(model, glyph) {
  const tiers = ['dim', 'star', 'starBright'].map(colour), { stars } = model.sky;
  return run(stars.length, (w) => { for (const [x, y, tier, ch, phase, fade] of stars) w.put(x, y, 0, 0, Math.round(phase / 6.28 * 65535), tier, 1, glyph(ch), tiers[tier], fade, PAGE, KIND.star); });
}

export function packPeak(model, glyph) {
  const { span, cells } = model.peak, { bodyTop } = model.dims;
  return run(span.length + cells.length, (w) => {
    span.forEach((s, row) => { if (s && row < bodyTop) w.solid(s[0], row, 0, 0, s[1] - s[0], 1, 1, 0, 1, PAGE); });   // it hides the stars behind it
    for (const [row, col, ch, name, alpha] of cells) w.put(col, row, 0, 0, 0, 0, 1, glyph(ch), colour(name), alpha, PAGE);
  });
}
