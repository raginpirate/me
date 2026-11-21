// The world, made once from the size of the page: pure data in cells and palette names (the contract is MODEL.md).

import { clamp } from './math.js';
import { LAYOUT, STOPS, CARD, TYPE } from './art.js';
import { makeName, makeStars } from './world/sky.js';
import { MASSIF } from './art.js';
import { makePeak, finishPeak } from './world/peak.js';
import { makeGround, GROUND_K } from './world/ground.js';
import { makeMassif } from './world/massif.js';
import { paintLobe } from './world/lobe.js';
import { makeAir } from './world/air.js';
import { hash } from './math.js';

export function makeDims({ W, H, typeSize, cellW, cellH, stack }) {
  const cols = Math.ceil(W / cellW) + 1, S = H / cellH, rows = Math.ceil(LAYOUT.screens * S) + 2, end = rows - S, seamRow = Math.round(LAYOUT.seam * S);
  return { W, H, typeSize, cellW, cellH, stack, cols, camera: MASSIF.camera * cols / 304, S, rows, end, maxScroll: LAYOUT.measure * S, summitRow: LAYOUT.summit * S,
    seamRow, bodyTop: seamRow - LAYOUT.blend, groundRow: Math.round(end + S / 2), u: typeSize / 11, aspect: cellW / cellH };
}

function makeStops(d) {
  const mode = d.stack ? 'stack' : 'side', stage = Math.min(d.cols, TYPE.stage / d.cellW);
  const toT = (c) => clamp((c - 0.5) / LAYOUT.measure, 0, 1), restRow = (c) => clamp((c - 0.5) * d.S, 0, d.end);
  return STOPS.map((s, i) => {
    const stop = { id: s.id, at: s.at, x: null, y: null, side: null, band: null, snap: 0, mark: s.mark ?? null, lobe: null };
    if (s.at) {
      const [screen, across] = s.at;
      Object.assign(stop, { x: Math.round(d.cols / 2 + (across - 0.5) * stage), y: Math.round(screen * d.S), side: across > 0.5 ? 'left' : 'right',
        band: [toT(screen + CARD.band[mode][0]), toT(screen + CARD.band[mode][1])], snap: restRow(screen + CARD.rest[mode]) });
      if (i === STOPS.length - 1) { stop.band[1] = 1; stop.snap = d.end; }
    } else if (s.open) stop.band = [0, toT(s.open)];
    else stop.snap = restRow(s.rest);
    return stop;
  });
}

export function makeWorld(params, name = 'daniel wyckoff') {
  const d = makeDims(params), stops = makeStops(d), peak = makePeak(d);
  // how fast the peak's two sides are spreading where it meets the clouds (columns a row): the massif carries them on
  const above = peak.span[d.seamRow - 14] ?? peak.span[d.seamRow], at = peak.span[d.seamRow], spread = (v) => Math.min(1.6, Math.max(0.15, v / 14));
  Object.assign(d, { topCol: peak.topCol, ax: peak.ax, seamHalf: peak.seamHalf, seamSpread: [spread(above[0] - at[0]), spread(at[1] - above[1])] });
  const asterism = makeName(d, name), covered = (x, row) => { const s = peak.span[row]; return !!s && x >= s[0] && x < s[1]; };
  const { stars, firstShot } = makeStars(d, covered, asterism);
  // the ground and the hut; the last stop's light is the hut's window, as it stands at the end of the page
  const base = stops[stops.length - 1], ground = makeGround(d, base.x), endRow = d.end + d.S / 2;
  base.x = ground.window[0] * GROUND_K - 0.5; base.y = endRow + (d.groundRow + 1 + ground.window[1] - endRow) * GROUND_K - 0.5;
  const { lobes, turn, N } = makeMassif(d, stops, ground.door, peak);
  for (const l of lobes) l.stop = l.stop?.id ?? null;
  Object.assign(d, { kx: turn.kx, reach: turn.reach, leadRows: turn.leadRows });
  // the painted peak thins out through the seam, and the core fills in exactly where it does not
  const core = lobes.find((l) => l.kind === 'core'), shift = 0, clear = [];
  for (const key of core.kept) { const r = Math.floor(key / core.W); if (r >= d.bodyTop && r <= d.seamRow + 3) clear.push(r * d.cols + Math.round(shift + key % core.W)); }
  const peakShows = (row, col) => row < d.bodyTop || hash(row, col, 5) > (row - d.bodyTop) / 6;
  finishPeak(peak, d.cols, clear);
  const paint = (i) => paintLobe(lobes[i], d, N, turn.kx, peakShows);
  if (!params.lazy) lobes.forEach((_, i) => paint(i));
  return { dims: d, stops, sky: { stars, name: asterism, firstShot }, peak, lobes, air: makeAir(d, N), ground, turn, N, paint };
}
