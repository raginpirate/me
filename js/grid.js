// A character grid on a canvas: one monospace glyph per cell, each with its
// own colour. Glyphs are cached as sprites so a full screen is a few
// thousand drawImage calls.

export class Grid {
  constructor(canvas, { font = 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace', size = 14 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.font = font;
    this.size = size;
    this.atlas = new Map();
    this.resize();
  }

  // size to an explicit box; the scene passes the large viewport so a
  // collapsing mobile URL bar never changes the painting
  resize(w = innerWidth, h = innerHeight) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${this.size}px ${this.font}`;
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText('M');
    this.cellW = m.width;
    this.cellH = Math.round(this.size * 1.2);
    this.ascent = Math.round(this.size * 0.9);
    this.cols = Math.ceil(w / this.cellW) + 1;
    this.rows = Math.ceil(h / this.cellH) + 1;
    this.atlas.clear();
  }

  sprite(ch, color) {
    const key = ch + '\0' + color;
    let s = this.atlas.get(key);
    if (s) return s;
    const dpr = this.dpr;
    const c = document.createElement('canvas');
    c.width = Math.ceil(this.cellW * dpr) + 2; c.height = Math.ceil(this.cellH * dpr) + 2;
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    x.font = `${this.size}px ${this.font}`;
    x.textBaseline = 'alphabetic';
    x.fillStyle = color;
    x.fillText(ch, 0, this.ascent);
    s = c;
    this.atlas.set(key, s);
    return s;
  }

  clear(color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  // draw a glyph at a fractional cell position (x cols, y rows)
  put(ch, color, x, y) {
    if (!ch || ch === ' ') return;
    const px = x * this.cellW, py = y * this.cellH;
    if (px < -this.cellW || py < -this.cellH || px > this.w || py > this.h) return;
    this.ctx.drawImage(this.sprite(ch, color), px, py, this.cellW + 2 / this.dpr, this.cellH + 2 / this.dpr);
  }

  // a glyph at any size, centred on a pixel position: the 3D elements use
  // this, with size set by distance from the camera
  sizedSprite(ch, color, size) {
    const key = ch + '\0' + color + '\0' + size;
    let s = this.atlas.get(key);
    if (s) return s;
    const dpr = this.dpr;
    const w = Math.ceil(size * 1.3), h = Math.ceil(size * 1.3);
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    x.font = `${size}px ${this.font}`;
    x.textBaseline = 'middle'; x.textAlign = 'center';
    x.fillStyle = color;
    x.fillText(ch, w / 2, h / 2);
    s = { canvas: c, w, h };
    this.atlas.set(key, s);
    return s;
  }
  putSized(ch, color, px, py, size) {
    if (!ch || ch === ' ') return;
    const q = Math.max(4, Math.round(size * 2) / 2); // quantise so the cache stays small
    if (px < -q * 2 || py < -q * 2 || px > this.w + q * 2 || py > this.h + q * 2) return;
    const s = this.sizedSprite(ch, color, q);
    this.ctx.drawImage(s.canvas, px - s.w / 2, py - s.h / 2, s.w, s.h);
  }

  // a run of text starting at a cell
  text(str, color, x, y) {
    for (let i = 0; i < str.length; i++) this.put(str[i], color, x + i, y);
  }
}
