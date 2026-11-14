// Trees, drawn to any height.
//
// Type has a largest size. A tree that stands nearer than that is not set
// in larger type: it is a larger drawing, of more characters.
//
// tree(kind, h, rnd) → { rows, stem }: h rows of text, all one width, the
// trunk down the middle column; the last `stem` rows are bare trunk.

const centred = (rows) => { const w = Math.max(...rows.map((r) => r.length)); return rows.map((r) => { const a = (w - r.length) >> 1; return ' '.repeat(a) + r + ' '.repeat(w - r.length - a); }); };

// A pine: a tip, then tiers of boughs, each wider than the one above and each ending in a skirt.
function pine(h) {
  const stem = h > 9 ? 2 : 1, body = h - stem, tier = body < 6 ? body : body < 11 ? 3 : 4, rows = ['^'];
  for (let i = 1, w = 0; i < body; i++) {
    const p = (i - 1) % tier, last = i === body - 1;
    w = p === 0 && i > 1 && !last ? w - tier + 2 : w + 1;   // a new tier starts narrower; the lowest row is never one on its own
    let inner = '';
    for (let d = 1 - w; d < w; d++) inner += p === tier - 1 || last ? '^' : d === 0 ? '|' : d % 2 ? ' ' : d < 0 ? '/' : '\\';
    rows.push('/' + inner + '\\');
  }
  for (let i = 0; i < stem; i++) rows.push(h > 13 ? '|||' : '|');
  return { rows: centred(rows), stem };
}

// A broadleaf: a round crown, boughs, a trunk.
function leafy(h, rnd) {
  const stem = Math.max(1, Math.round(h * 0.3)), R = h - stem, rows = [], trunk = h > 12 ? '|||' : '|';
  for (let r = 0; r < R; r++) {
    const t = (r + 0.5) / R * 2 - 1, w = Math.max(1, Math.round((R + 0.6) * Math.sqrt(1 - 0.86 * t * t)));
    let inner = '';
    for (let d = 1 - w; d < w; d++) { const v = rnd(); inner += R > 3 && v < 0.07 ? ' ' : R > 3 && v < 0.15 ? '%' : '&'; }
    rows.push(r === 0 ? (R < 3 ? ' ' + inner + ' ' : ',' + inner + ',') : r === R - 1 && R > 3 ? "'" + inner + "'" : '(' + inner + ')');
  }
  for (let i = 0; i < stem; i++) rows.push(i === 0 && h > 3 ? '\\' + trunk + '/' : trunk);
  return { rows: centred(rows), stem };
}

// A birch: a tall airy crown, and a white trunk that shows up through it.
function birch(h, rnd) {
  const stem = Math.max(1, Math.round(h * 0.34)), R = h - stem, rows = [], leaf = [';', ':', '%', ':', ';', '%', ':'];
  for (let r = 0; r < R; r++) {
    const t = (r + 0.5) / R, w = Math.max(1, Math.round((1.2 + R * 0.4) * Math.sqrt(Math.max(0.1, 1 - ((t - 0.45) / 0.58) ** 2))) - (r === 0 ? 1 : 0));
    let row = '';
    for (let d = -w; d <= w; d++) {
      const end = Math.abs(d) === w;
      row += d === 0 && r > 0 ? '|' : r === 0 ? (end ? (d < 0 ? ',' : '.') : leaf[Math.floor(rnd() * 3)]) : r === R - 1 && end ? "'" : !end && rnd() < 0.14 ? ' ' : leaf[Math.floor(rnd() * leaf.length)];
    }
    rows.push(row);
  }
  for (let i = 0; i < stem; i++) rows.push(i % 2 ? '!' : '|');
  return { rows: centred(rows), stem };
}

export const tree = (kind, h, rnd) => ({ pine, leafy, birch })[kind](Math.max(3, Math.round(h)), rnd);
