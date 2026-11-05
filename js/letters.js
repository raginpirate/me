// A stroke alphabet for drawing names in stars. Each letter is a list of
// polylines in a 0.62 × 1 box, y up. Stars sit at the vertices, so the
// shapes are kept to the few points a constellation would use.

export const LETTERS = {
  A: [[[0, 0], [0.31, 1], [0.62, 0]], [[0.12, 0.36], [0.5, 0.36]]],
  C: [[[0.62, 0.82], [0.42, 1], [0.18, 1], [0, 0.75], [0, 0.25], [0.18, 0], [0.42, 0], [0.62, 0.18]]],
  D: [[[0, 0], [0, 1], [0.3, 1], [0.55, 0.85], [0.62, 0.5], [0.55, 0.15], [0.3, 0], [0, 0]]],
  E: [[[0.6, 0], [0, 0], [0, 1], [0.6, 1]], [[0, 0.5], [0.45, 0.5]]],
  F: [[[0, 0], [0, 1], [0.6, 1]], [[0, 0.5], [0.45, 0.5]]],
  I: [[[0.31, 0], [0.31, 1]]],
  K: [[[0, 0], [0, 1]], [[0.6, 1], [0, 0.42]], [[0.22, 0.55], [0.62, 0]]],
  L: [[[0, 1], [0, 0], [0.6, 0]]],
  N: [[[0, 0], [0, 1], [0.62, 0], [0.62, 1]]],
  O: [[[0.31, 0], [0.08, 0.2], [0, 0.5], [0.08, 0.8], [0.31, 1], [0.54, 0.8], [0.62, 0.5], [0.54, 0.2], [0.31, 0]]],
  W: [[[0, 1], [0.16, 0], [0.31, 0.6], [0.46, 0], [0.62, 1]]],
  Y: [[[0, 1], [0.31, 0.5], [0.62, 1]], [[0.31, 0.5], [0.31, 0]]],
};

const ADVANCE = 0.86;
const SPACE = 0.5;

// Lay out lines of text, centred on the origin, y up.
// Returns points [[x, y, anchor]], segments [[i, j, letter]] in drawing order,
// width, height and letter count.
export function layout(lines, lineGap = 0.55) {
  const points = [], segments = [];
  const widths = lines.map((line) => [...line].reduce((w, ch) => w + (ch === ' ' ? SPACE : ADVANCE), 0) - (ADVANCE - 0.62));
  const height = lines.length + (lines.length - 1) * lineGap;
  let letter = 0;
  lines.forEach((line, li) => {
    let x = -widths[li] / 2;
    const y = height / 2 - 1 - li * (1 + lineGap);
    for (const ch of line) {
      if (ch === ' ') { x += SPACE; continue; }
      const strokes = LETTERS[ch.toUpperCase()];
      if (strokes) {
        for (const poly of strokes) {
          const idx = poly.map(([px, py], k) => { points.push([x + px, y + py, k === 0 || k === poly.length - 1 ? 1 : 0]); return points.length - 1; });
          for (let i = 1; i < idx.length; i++) segments.push([idx[i - 1], idx[i], letter]);
        }
        letter++;
      }
      x += ADVANCE;
    }
  });
  return { points, segments, width: Math.max(...widths), height, letters: letter };
}
