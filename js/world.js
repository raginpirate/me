// The world, made once from the size of the page: pure data in cells and palette names (the contract is MODEL.md).

import { clamp } from './math.js';
import { LAYOUT, STOPS, CARD, TYPE } from './art.js';
import { makeName, makeStars } from './world/sky.js';
import { makePeak, finishPeak } from './world/peak.js';

export function makeDims({ W, H, typeSize, cellW, cellH, stack }) {
  const S = H / cellH, rows = Math.ceil(LAYOUT.screens * S) + 2, end = rows - S, seamRow = Math.round(LAYOUT.seam * S);
  return { W, H, typeSize, cellW, cellH, stack, cols: Math.ceil(W / cellW) + 1, S, rows, end, maxScroll: LAYOUT.measure * S, summitRow: LAYOUT.summit * S,
    seamRow, bodyTop: seamRow - LAYOUT.blend, groundRow: Math.round(end + S / 2), u: typeSize / 11, aspect: cellW / cellH };
}

function makeStops(d) {
  const mode = d.stack ? 'stack' : 'side', stage = Math.min(d.cols, TYPE.stage / d.cellW);
  const toT = (c) => clamp((c - 0.5) / LAYOUT.measure, 0, 1), restRow = (c) => clamp((c - 0.5) * d.S, 0, d.end);
  return STOPS.map((s, i) => {
    const stop = { id: s.id, x: null, y: null, side: null, band: null, snap: 0, mark: s.mark ?? null, lobe: null };
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
  Object.assign(d, { topCol: peak.topCol, ax: peak.ax, seamHalf: peak.seamHalf });
  const asterism = makeName(d, name), covered = (x, row) => { const s = peak.span[row]; return !!s && x >= s[0] && x < s[1]; };
  const { stars, firstShot } = makeStars(d, covered, asterism);
  finishPeak(peak, d.cols, []);
  return { dims: d, stops, sky: { stars, name: asterism, firstShot }, peak, lobes: [], air: null, ground: null };
}
