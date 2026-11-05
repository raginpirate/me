// A stroke alphabet for drawing names in stars. Each letter is a list of
// polylines in a 1 × 1 box, y up. Only the letters this site needs.

export const LETTERS = {
  A: [[[0, 0], [0.5, 1], [1, 0]], [[0.2, 0.4], [0.8, 0.4]]],
  C: [[[1, 0.85], [0.7, 1], [0.3, 1], [0, 0.72], [0, 0.28], [0.3, 0], [0.7, 0], [1, 0.15]]],
  D: [[[0, 0], [0, 1], [0.55, 1], [0.92, 0.78], [1, 0.5], [0.92, 0.22], [0.55, 0], [0, 0]]],
  E: [[[1, 0], [0, 0], [0, 1], [1, 1]], [[0, 0.5], [0.78, 0.5]]],
  F: [[[0, 0], [0, 1], [1, 1]], [[0, 0.5], [0.75, 0.5]]],
  I: [[[0.5, 0], [0.5, 0.5], [0.5, 1]]],
  K: [[[0, 0], [0, 0.5], [0, 1]], [[1, 1], [0, 0.45]], [[0.32, 0.6], [1, 0]]],
  L: [[[0, 1], [0, 0.5], [0, 0], [1, 0]]],
  N: [[[0, 0], [0, 1], [1, 0], [1, 1]]],
  O: [[[0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3], [0.3, 0]]],
  W: [[[0, 1], [0.25, 0], [0.5, 0.62], [0.75, 0], [1, 1]]],
  Y: [[[0, 1], [0.5, 0.5], [1, 1]], [[0.5, 0.5], [0.5, 0]]],
};

const ADVANCE = 1.32;
const SPACE = 0.7;

// Lay out lines of text. Returns { points: [[x,y],...], segments: [[i,j],...], width, height }
// in letter units, centred on the origin, y up, lines stacked top to bottom.
export function layout(lines, lineGap = 0.6) {
  const points = [], segments = [];
  const widths = lines.map((line) => [...line].reduce((w, ch) => w + (ch === ' ' ? SPACE : ADVANCE), 0) - (ADVANCE - 1));
  const height = lines.length + (lines.length - 1) * lineGap;
  lines.forEach((line, li) => {
    let x = -widths[li] / 2;
    const y = height / 2 - 1 - li * (1 + lineGap);
    for (const ch of line) {
      if (ch === ' ') { x += SPACE; continue; }
      const strokes = LETTERS[ch.toUpperCase()];
      if (strokes) {
        for (const poly of strokes) {
          const idx = poly.map(([px, py]) => { points.push([x + px, y + py]); return points.length - 1; });
          for (let i = 1; i < idx.length; i++) segments.push([idx[i - 1], idx[i]]);
        }
      }
      x += ADVANCE;
    }
  });
  return { points, segments, width: Math.max(...widths), height };
}
