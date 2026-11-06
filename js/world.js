// The tall ASCII painting: a sky, a snow-topped peak in front of a fogged
// far ridge, ridges running downhill, a treeline, the base. Built once per
// resize into a row/column buffer of [glyph, colour].

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const S = 256, perm = new Uint8Array(S * 2), grid = new Float32Array(S);
  for (let i = 0; i < S; i++) { perm[i] = i; grid[i] = rnd(); }
  for (let i = S - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < S; i++) perm[S + i] = perm[i];
  const fade = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const a = grid[perm[X + perm[Y]]], b = grid[perm[X + 1 + perm[Y]]], c = grid[perm[X + perm[Y + 1]]], d = grid[perm[X + 1 + perm[Y + 1]]];
    const u = fade(xf), v = fade(yf);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  const fbm = (x, y, oct = 4) => {
    let s = 0, amp = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f); n += amp; amp *= 0.5; f *= 2.03; }
    return s / n;
  };
  const ridged = (x, y, oct = 3) => {
    let s = 0, amp = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += amp * (1 - Math.abs(2 * noise(x * f, y * f) - 1)); n += amp; amp *= 0.5; f *= 2.1; }
    return s / n;
  };
  return { noise, fbm, ridged };
}

export function buildWorld(cols, rows, screenRows, D) {
  const { noise, fbm, ridged } = makeNoise(20181105);
  const rnd = mulberry32(42);
  const P = D.palette, G = D.glyphs, L = D.layout;
  const cells = new Array(rows);
  for (let r = 0; r < rows; r++) cells[r] = new Array(cols).fill(null);

  const summitRow = L.summit * screenRows;
  const baseRow = L.base * screenRows;
  const groundRow = Math.round(L.groundFrom * screenRows);
  const treelineRow = L.treeline * screenRows;
  const snowBottom = L.snowBottom * screenRows;
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

  // a far ridge behind, fogged
  const far = new Float32Array(cols);
  for (let c = 0; c < cols; c++) {
    const x = c / cols;
    let h = hump(x, 0.14, 0.14, 0.5) + hump(x, 0.9, 0.16, 0.46) + hump(x, 0.5, 0.5, 0.3) + (ridged(x * 6 + 9, 3.1, 2) - 0.5) * 0.08;
    far[c] = baseRow - Math.max(0, h) * H;
  }

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
    const pk = peak[c], fr = far[c];
    const lit = slopeS[c] < 0 ? 1 : slopeS[c] > 0 ? 0 : 0.5;  // left faces (rising to the right) are lit
    for (let r = 0; r < rows; r++) {
      // ground band
      if (r >= groundRow) {
        const bottom = rows - r <= 6;
        const g = bottom ? ['_', '.', ' ', ' '] : G.ground;
        const n = noise(c * 0.37 + 1, r * 0.61 + 2);
        const edge = Math.min(c, cols - 1 - c) / cols; // trunks crowd the edges
        if (edge < 0.12 && noise(c * 1.3, 0.5) > 0.74 && r < rows - 8) { cells[r][c] = ['|', P.pineDark]; continue; }
        // leaves piled at the foot of the slope: dense on the ground line, thinning below
        const foot = Math.max(0, 0.6 - (r - groundRow) * 0.085);
        if (rnd() < foot) { cells[r][c] = [[',', "'", '~'][Math.floor(rnd() * 3)], rnd() < 0.55 ? P.leaf : P.leafOlive]; continue; }
        const ch = n < 0.5 ? ' ' : g[(r + c) % g.length];
        if (ch !== ' ') cells[r][c] = [ch, bottom ? P.groundDark : (n > 0.78 ? P.ground : P.groundDark)];
        // the slope's last rows blend into the ground
        continue;
      }
      if (r < pk) {
        // sky, maybe the fogged far ridge
        if (r >= fr) {
          const n = noise(c * 0.15, r * 0.2);
          if (n > 0.42) cells[r][c] = [n > 0.75 ? '-' : '.', P.far];
        }
        continue;
      }
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
        if (ch !== ' ') cells[r][c] = [ch, light > 0.45 || isEdge ? P.snow : P.snowShade];
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
        // rock gives way to ground texture near the base
        const toGround = smooth(groundRow - 12, groundRow, r);
        if (toGround > 0 && rnd() < toGround) { ch = G.ground[(r + c) % G.ground.length]; color = P.ground; }
        // shadows are airy: the darker the cell, the more often it is left blank
        else if (rnd() < 0.22 + (1 - light) * 0.4) ch = ' ';
      }
      if (ch !== ' ') cells[r][c] = [ch, color];
    }
  }

  // trees: stand on the slope where it is gentle enough, below the treeline
  const shapes = G.trees;
  const trees = [];
  let lastShape = -1;
  for (let c = 1; c < cols - 8;) {
    const pk = peak[c];
    const gentle = Math.abs(slopeS[c]) * 0.5 < 0.7;
    const below = pk > treelineRow;
    if (!(gentle && below) || pk >= groundRow - 1) { c++; continue; }
    const density = smooth(treelineRow, treelineRow + screenRows * 1.6, pk);
    if (rnd() > 0.35 + 0.5 * density) { c += 2; continue; }
    let si = Math.floor(rnd() * shapes.length);
    if (si === lastShape) si = (si + 1) % shapes.length;
    lastShape = si;
    const shape = shapes[si];
    const h = shape.length, w = Math.max(...shape.map((s) => s.length));
    const baseR = Math.round(pk) + Math.floor(rnd() * 2);
    const shadow = slopeS[c + Math.floor(w / 2)] > 0;
    let k = 0;
    for (let i = 0; i < h; i++) {
      const line = shape[i];
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (ch === ' ') continue;
        const rr = baseR - (h - 1 - i), cc = c + j;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        const trunk = ch === '|' && i === h - 1;
        const edge = j === 0 || j === line.length - 1;
        const dark = trunk || (shadow && edge) || (k++ % 4 === 3);
        cells[rr][cc] = [ch, dark ? P.pineDark : P.pine];
      }
    }
    trees.push([c + Math.floor(w / 2), baseR]);
    c += w - 1 + 3 + Math.floor(rnd() * 4);
  }

  // a forest across the lower face: clusters of 3–6 pines with small gaps,
  // standing on rock, thickening toward the base
  const stamp = (c, r, shape, shadow) => {
    const h = shape.length;
    for (let i = 0; i < h; i++) for (let j = 0; j < shape[i].length; j++) {
      const cell = cells[r - (h - 1 - i)]?.[c + j];
      if (cell && (cell[1] === P.pine || cell[1] === P.pineDark)) return false;
    }
    let k = 0;
    for (let i = 0; i < h; i++) for (let j = 0; j < shape[i].length; j++) {
      const ch = shape[i][j];
      if (ch === ' ') continue;
      const rr = r - (h - 1 - i), cc = c + j;
      if (rr < 0 || rr >= rows || cc >= cols) continue;
      const trunk = ch === '|' && i === h - 1;
      cells[rr][cc] = [ch, trunk || (shadow && (j === 0 || j === shape[i].length - 1)) || k++ % 4 === 3 ? P.pineDark : P.pine];
    }
    return true;
  };
  const clusters = Math.floor(cols * 0.9);
  for (let n = 0; n < clusters; n++) {
    const c0 = Math.floor(rnd() * (cols - 24));
    const r0 = Math.floor(treelineRow + Math.pow(rnd(), 0.7) * (groundRow - treelineRow - 2));
    if (r0 < peak[c0 + 6] + 3) continue;
    const size = 3 + Math.floor(rnd() * 4);
    let c = c0;
    for (let i = 0; i < size; i++) {
      const shape = rnd() < 0.3 ? [' ^ ', '/|\\'] : shapes[Math.floor(rnd() * shapes.length)];
      const w = Math.max(...shape.map((x) => x.length));
      const r = r0 + Math.floor((rnd() - 0.5) * 3);
      if (r < peak[Math.min(cols - 1, c + 2)] + 2 || r >= groundRow - 1 || r >= rows) { c += w; continue; }
      // the bottom row must sit on something
      const below = cells[r + 1]?.[c + Math.floor(w / 2)];
      if (!below && r + 1 < groundRow) { c += w; continue; }
      stamp(c, r, shape, c > topCol);
      c += w + 1 + Math.floor(rnd() * 2);
    }
  }

  return { cols, rows, cells, peak, far, snowline, summitRow, baseRow, groundRow, treelineRow, topCol, trees };
}
