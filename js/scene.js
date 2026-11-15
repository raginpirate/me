// The frame: where the page is → where every layer stands → the list of things to draw, back to front.

import { clamp, smooth } from './math.js';
import { LAYOUT } from './art.js';
import { LAYERS } from './glsl.js';
import { COLOURS, rgb, PAGE, packSky, packPeak } from './pack.js';

export function makeScene(gl, model, view) {
  const d = model.dims, { layers, set } = gl, palette = new Float32Array(40 * 3), R = {};
  COLOURS.forEach((n, i) => palette.set(rgb(n).map((v) => v / 255), i * 3));
  const skyTop = rgb('sky'), skyBase = rgb('skyBase'), sky = [0, 0, 0];
  const layer = (i, X, s, centreRow, vis = 1, tone = 1, ref = 0, lo = 0, hi = 0, z = 0, cx = 0, drift = 0, span = 0) => { layers.set([X, s, centreRow, vis], i * 4); layers.set([tone, ref, lo, hi], (LAYERS + i) * 4); layers.set([z, cx, drift, span], (2 * LAYERS + i) * 4); };
  const add = (name, bytes) => { R[name] = [gl.append(bytes), bytes.byteLength / 24]; };
  add('stars', packSky(model, gl.glyph)); add('peak', packPeak(model, gl.glyph));

  function frame(time) {
    const dpr = view.dpr, top = clamp(scrollY / d.cellH, 0, d.end), centreRow = top + d.S / 2, centre = centreRow / d.S;
    const shift = smooth(8.3, 9.7, centre); for (let i = 0; i < 3; i++) palette[i] = sky[i] = (skyTop[i] + (skyBase[i] - skyTop[i]) * shift) / 255;
    layer(PAGE, 0, 1, centreRow);
    set.v2('uRes', view.w * dpr, view.h * dpr); set.v2('uCell', d.cellW * dpr, d.cellH * dpr); set.f('uType', d.typeSize * dpr); set.f('uTime', time); set.f('uS', d.S);
    set.fv3('uPalette', palette); set.f('uAltStar', gl.glyph('*')); set.f('uHush', 0); set.f('uDark', 0); set.v2('uLean', 0, 0); set.f('uPush', 0);
    gl.begin(sky, null, 0);
    if (top < LAYOUT.deck[1] * d.S) gl.draw(...R.stars, { test: true });
    gl.draw(...R.peak, {});
  }
  return { frame };
}
