// A character grid on a canvas.
//
// Every glyph on the page is drawn the same way: one sprite per glyph,
// colour and size, cached, and stamped with a brightness. Brightness is a
// number at draw time, never part of the colour, so a star that twinkles
// is one sprite, not a hundred.
//
// There are two placements. put() sets a glyph in a cell the way type sits
// on a line. ink() centres a glyph on its own ink at a pixel, whichever
// font supplied it; things that are objects rather than text use that.

export class Grid {
  constructor(canvas, { font, size = 14 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.font = font;
    this.size = size;
    this.resize();
  }

  // size to an explicit box; the scene passes the large viewport so a
  // collapsing mobile URL bar never changes the painting
  resize(w = innerWidth, h = innerHeight) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = w; this.h = h; this.vw = w; this.vh = h;   // the screen, and what is being drawn on now: the screen or a tile
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${this.size}px ${this.font}`;
    this.cellW = ctx.measureText('M').width;
    this.cellH = Math.round(this.size * 1.2);
    this.ascent = Math.round(this.size * 0.9);
    this.cols = Math.ceil(w / this.cellW) + 1;
    this.rows = Math.ceil(h / this.cellH) + 1;
    this.atlas = new Map(); this.sprites = 0;
    this.alpha = 1;
  }

  // The sprite for a glyph: a canvas just big enough for its ink, with the
  // text origin on a whole device pixel. bx, by: sprite corner → origin.
  // ix, iy: origin → centre of the ink (iy is upward from the baseline).
  sprite(ch, color, size) {
    let bySize = this.atlas.get(size); if (!bySize) this.atlas.set(size, bySize = new Map());
    let byColor = bySize.get(color); if (!byColor) bySize.set(color, byColor = new Map());
    let s = byColor.get(ch);
    if (s) return s;
    const dpr = this.dpr, font = `${size}px ${this.font}`;
    this.ctx.font = font;
    const t = this.ctx.measureText(ch);
    const L = Math.ceil(Math.max(0, t.actualBoundingBoxLeft) * dpr) + 1, R = Math.ceil(Math.max(0, t.actualBoundingBoxRight) * dpr) + 1;
    const A = Math.ceil(Math.max(0, t.actualBoundingBoxAscent) * dpr) + 1, B = Math.ceil(Math.max(0, t.actualBoundingBoxDescent) * dpr) + 1;
    const c = document.createElement('canvas');
    c.width = L + R; c.height = A + B;
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    x.font = font; x.textBaseline = 'alphabetic'; x.fillStyle = color;
    x.fillText(ch, L / dpr, A / dpr);
    s = {
      canvas: c, w: c.width / dpr, h: c.height / dpr, bx: L / dpr, by: A / dpr,
      ix: (t.actualBoundingBoxRight - t.actualBoundingBoxLeft) / 2, iy: (t.actualBoundingBoxAscent - t.actualBoundingBoxDescent) / 2,
    };
    byColor.set(ch, s); this.sprites++;
    return s;
  }

  stamp(s, x, y, alpha) {
    if (alpha !== this.alpha) this.ctx.globalAlpha = this.alpha = alpha;
    this.ctx.drawImage(s.canvas, x, y, s.w, s.h);
  }

  // a glyph set in a cell (col, row may be fractional), like type on a line
  put(ch, color, col, row, alpha = 1) {
    if (!ch || ch === ' ' || alpha < 0.01) return;
    const x = col * this.cellW, y = row * this.cellH;
    if (x < -this.cellW || y < -this.cellH || x > this.w || y > this.h) return;
    const s = this.sprite(ch, color, this.size);
    this.stamp(s, x - s.bx, y + this.ascent - s.by, alpha);
  }

  // a glyph at any size, centred on its own ink at a pixel
  ink(ch, color, px, py, size = this.size, alpha = 1) {
    if (alpha < 0.01) return;
    // a few sizes, not every size: half pixels when small, coarser as it grows
    const q = size <= 20 ? Math.max(4, Math.round(size * 2) / 2) : size <= 40 ? Math.round(size) : Math.round(size / 2) * 2;
    if (px < -q || py < -q || px > this.w + q || py > this.h + q) return;
    const s = this.sprite(ch, color, q);
    this.stamp(s, px - s.ix - s.bx, py + s.iy - s.by, alpha);
  }

  // a glyph set in a cell of any size, at any pixel: (x, y) is the top left
  // of its cell. This is how a thing nearer or further than the page is drawn.
  set(ch, color, x, y, size, alpha = 1) {
    if (!ch || ch === ' ' || alpha < 0.01) return;
    if (x < -size || y < -size * 1.3 || x > this.vw || y > this.vh) return;
    // one sprite for each whole size, stretched to the exact size asked for:
    // a thing that grows as it comes nearer grows smoothly, not in steps
    const q = Math.max(4, Math.round(size)), s = this.sprite(ch, color, q), k = size / q, c = this.ctx, d = this.dpr;
    if (alpha !== this.alpha) c.globalAlpha = this.alpha = alpha;
    this.drawn++;
    // on whole device pixels, so type that is not on the page's grid is as sharp as type that is (a place exactly
    // between two pixels always goes the same way, whichever tile it is drawn on)
    c.drawImage(s.canvas, Math.round((x - s.bx * k) * d + 0.02) / d, Math.round((y + (q * 0.9 - s.by) * k) * d + 0.02) / d, s.w * k, s.h * k);
  }

  // a filled box, for hiding what is behind something
  box(x, y, w, h, color, alpha = 1) {
    const c = this.ctx;
    if (alpha !== this.alpha) c.globalAlpha = this.alpha = alpha;
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
    this.drawn++;
  }

  // draw onto another canvas, w by h, for a while; returns how much was drawn
  into(ctx, w, h, draw) {
    const keep = [this.ctx, this.vw, this.vh];
    this.ctx = ctx; this.vw = w; this.vh = h; this.alpha = NaN; this.drawn = 0;
    draw();
    [this.ctx, this.vw, this.vh] = keep; this.alpha = NaN;
    return this.drawn;
  }

  clear(color) {
    const c = this.ctx;
    if (this.alpha !== 1) c.globalAlpha = this.alpha = 1;
    c.fillStyle = color;
    c.fillRect(0, 0, this.w, this.h);
  }

  // a whole pre-painted canvas, at full strength, its corner at a pixel
  blit(canvas, x, y) {
    const c = this.ctx, d = this.dpr;
    if (this.alpha !== 1) c.globalAlpha = this.alpha = 1;
    c.drawImage(canvas, x, y, canvas.width / d, canvas.height / d);
  }
}
