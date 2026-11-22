// The sky: the field of stars, and the name laid out as an asterism.

import { mulberry32, smooth } from '../math.js';
import { LAYOUT, LETTERS, NAME } from '../art.js';

// The name's stars and the lines that join them, in page cells. → { stars: [[x, y, anchor, seed]], lines: [[i, j]] }
export function makeName(d, name) {
  const R = mulberry32(7), tight = d.stack, stars = [], lines = [], used = {};
  const advance = (ch) => { const a = NAME.advance[ch] ?? NAME.wide; return tight ? NAME.tight * a / NAME.wide : a; };
  name.toLowerCase().split(' ').forEach((word, wi) => {
    const width = [...word].reduce((s, ch, i) => s + (i === word.length - 1 ? NAME.last : advance(ch)), 0);
    let x = -width / 2 + (wi === 1 ? NAME.indent[tight ? 1 : 0] : 0);
    for (const ch of word) {
      const def = LETTERS[ch];
      if (def) {
        const [pts, joins] = def, n = pts.length, shift = (used[ch] = (used[ch] || 0) + 1, used[ch] - 1) % n, base = stars.length;
        const remap = (i) => (i - shift + n) % n;   // a repeated letter starts from a different star
        const bl = NAME.lines[wi] + (R() - 0.5) * 0.2, rot = (R() - 0.5) * 10 * Math.PI / 180, cx = x + 0.4, cy = bl + 0.3, cos = Math.cos(rot), sin = Math.sin(rot);
        for (let i = 0; i < n; i++) {
          const [px, py] = pts[(i + shift) % n], lx = x + px + (R() - 0.5) * 0.09 - cx, ly = bl + py + (R() - 0.5) * 0.09 - cy;
          stars.push([cx + lx * cos - ly * sin, cy + lx * sin + ly * cos, 0, 0]);
        }
        stars[base + remap(0)][2] = stars[base + remap(n - 1)][2] = 1;
        for (const [i, j] of joins) lines.push([base + remap(i), base + remap(j)]);
      }
      x += advance(ch);
    }
  });
  const xs = stars.map((s) => s[0]), mid = (Math.min(...xs) + Math.max(...xs)) / 2, seed = mulberry32(31);
  const unit = Math.min((tight ? 3.4 : 4.4) * d.cellH / 0.58, (tight ? 0.94 : 0.7) * d.seen / (tight ? 5.9 : 7.3));
  for (const s of stars) { s[0] = d.cols / 2 + (s[0] - mid) * unit / d.cellW; s[1] = LAYOUT.name * d.S - s[1] * unit / d.cellH; s[3] = seed(); }
  return { stars, lines };
}

// The field. covered(x, row): the painted peak is there. → { stars: [[x, y, tier, ch, phase, fade]], firstShot }
export function makeStars(d, covered, name) {
  const R = mulberry32(2026), { cols, S } = d, skyRows = Math.floor(LAYOUT.deck[1] * S), out = [];
  const star = (x, y, dimShare, midShare, fade) => {
    const u = R(), tier = u < dimShare ? 0 : u < midShare ? 1 : 2;
    const ch = tier === 0 ? (R() < 0.2 ? '·' : '.') : tier === 1 ? (R() < 0.15 ? '+' : '*') : '✦';
    out.push([x, y, tier, ch, R() * 6.28, fade]);
  };
  for (let n = Math.floor(cols * skyRows / 58); n > 0; n--) {
    const x = R() * cols, y = R() * skyRows;
    if (covered(x, Math.floor(y))) continue;
    const through = R() < 0.25, ys = y / S;
    const fade = Math.max(1 - smooth(3.98, 4.4, ys), through ? 0.7 * (1 - smooth(4.62, 4.92, ys)) : 0);
    if (fade >= 0.03) star(x, y, 0.7, 0.94, fade);
  }
  // the first screen is a little denser, with more bright ones
  const nameTop = Math.max(6, LAYOUT.name * S - 7 * (d.stack ? 1 : 1.4));
  for (let n = Math.floor(cols * nameTop / 30); n > 0; n--) { const x = R() * cols, y = R() * nameTop; star(x, y, 0.5, 0.85, 1); }
  const firstShot = 1.5 + R() * 2;
  // nothing stands too near the name or its lines (distances in css px between cell centres)
  const [nearStar, nearLine] = NAME.clear.map((v) => v * d.u), px = (s) => [(s[0] + 0.5) * d.cellW, (s[1] + 0.5) * d.cellH], pts = name.stars.map(px);
  const toSegment = ([x, y], [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(x - ax - dx * t, y - ay - dy * t); };
  const clear = (s) => { const p = px(s); return !pts.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < nearStar) && !name.lines.some(([i, j]) => toSegment(p, pts[i], pts[j]) < nearLine); };
  return { stars: out.filter(clear), firstShot };
}
