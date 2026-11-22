// The frame: where the page is → where every layer stands → the list of things to draw, back to front.

import { clamp, smooth, mix } from './math.js';
import { LAYOUT, MASSIF, FRAME } from './art.js';
import { LAYERS, COLOURS as ROOM } from './glsl.js';
import { COLOURS, rgb, LAYER, packSky, packPeak, packLobe, packGround, packClouds, packSnow, packLeaves, cloudSpan } from './pack.js';
import { CLOUDS, SNOW, LEAVES } from './world/air.js';
import { CARD } from './art.js';

const FAR = 0.9, nearness = (i) => 0.6 - 0.02 * i;   // depths: everything not a lobe is behind them all; a later lobe is nearer
const PLAIN = {}, TEST = { test: true }, LIT = { lit: true }, LIT_TEST = { lit: true, test: true }, MASK = { mask: true };
const ALIVE = new Map([PLAIN, TEST, LIT, LIT_TEST].map((o) => [o, { ...o, live: true }]));   // the same, from what is alive this frame

export function makeScene(gl, model, view, flags = {}) {
  const d = model.dims, { lobes, turn, air, ground } = model, { layers: T, set, glyph } = gl, { S, cellW, cellH, cols, groundRow: G } = d;
  const palette = new Float32Array(ROOM * 3), R = {}, skyTop = rgb('sky'), skyBase = rgb('skyBase'), sky = [0, 0, 0];
  COLOURS.forEach((n, i) => palette.set(rgb(n).map((v) => v / 255), i * 3));
  const tones = new Float32Array(['rockDark', 'pineDark', 'dim'].flatMap((n) => rgb(n).map((v) => v / 255)));   // the ground under a skyline, bare and wooded, and the mist over one
  const add = (name, bytes) => { R[name] = [gl.append(bytes), bytes.byteLength / 24]; };
  const [peak, rope] = packPeak(model, glyph);
  add('stars', packSky(model, glyph)); add('peak', peak); add('rope', rope); add('ground', packGround(model, glyph));
  CLOUDS.forEach((_, n) => add('clouds' + n, packClouds(model, n, glyph)));
  add('snow0', packSnow(model, [0], glyph)); add('snow12', packSnow(model, [1, 2], glyph)); add('leaves', packLeaves(model, glyph));

  // each lobe as it is made: its instances, its ground, where it stands this frame
  const pose = lobes.map(() => ({ X: 0, s: 1, vis: 0, tone: 1, ref: 0, on: false })), made = lobes.map(() => null);
  function addLobe(i) {
    const p = packLobe(lobes[i], i, d, glyph), first = gl.append(p.bytes);
    gl.wash(i, p.wash.w, p.wash.h, p.wash.rgba); gl.form(i, p.form);
    made[i] = { first, total: p.route[0], cover: p.cover, solids: p.solids, last: p.last, route: p.route[1] && [first + p.route[0], p.route[1]], draw: { test: true, wash: [i, 0, p.wash.y0, p.wash.w, p.wash.h] } };
  }
  lobes.forEach((l, i) => { if (l.cover) addLobe(i); });

  const layer = (i, X, s, centreRow, vis = 1, tone = 1, ref = 0, lo = 0, hi = 0, z = FAR, cx = 0, drift = 0, span = 0) => {
    let o = i * 4; T[o] = X; T[o + 1] = s; T[o + 2] = centreRow; T[o + 3] = vis;
    o += LAYERS * 4; T[o] = tone; T[o + 1] = ref; T[o + 2] = lo; T[o + 3] = hi;
    o += LAYERS * 4; T[o] = z; T[o + 1] = cx; T[o + 2] = drift; T[o + 3] = span;
  };

  // Is the screen point (css px) behind lobe i's body, as it stands? And: behind any lobe nearer than `from` that is at least `solid`?
  const state = { lift: 0, top: 0, centreRow: 0, centre: 0, time: 0, lampX: view.w / 2, lampY: 0, r0: 0, r1: 0, dark: 0, pose, sky };
  const behind = (i, x, y) => { const l = lobes[i], p = pose[i], c = Math.floor((x / cellW - p.X) / p.s + l.cx + 0.5), r = state.centreRow + (y - view.h / 2) / (cellH * p.s); return c >= 0 && c < l.W && r >= l.cover[c]; };
  const hidden = (from, x, y, solid = 0.5) => { for (let i = from + 1; i < lobes.length; i++) if (made[i] && pose[i].vis >= solid && behind(i, x, y)) return true; return false; };
  const place = (i, c, r, out) => { const p = pose[i]; out[0] = (p.X + (c - lobes[i].cx - 0.5) * p.s) * cellW; out[1] = view.h / 2 + (r - state.centreRow) * cellH * p.s; return out; };

  // the light you carry is on the route, at the height a stop's waypoint rests at
  const point = [0, 0], routeLobes = lobes.map((l, i) => i).filter((i) => lobes[i].path.length);
  function findLamp(planks) {
    const { h, w } = view, m = Math.min(w, h), r0 = state.r0 = MASSIF.lamp.core * m, y0 = state.lampY = h / 2 - (CARD.rest.side * S + state.lift) * cellH, reach = 2.2 * r0;
    state.r1 = MASSIF.lamp.reach * m;
    let sum = 0, weight = 0;
    const take = (x, y, k) => { const u = (y - y0) / (2 * cellH), g = Math.exp(-u * u) * k; sum += x * g; weight += g; };
    for (const i of routeLobes) {
      const p = pose[i], path = lobes[i].path; if (!made[i] || p.vis < 0.2) continue;
      const lo = state.centreRow + (y0 - reach - h / 2) / (cellH * p.s) - 0.5, hi = state.centreRow + (y0 + reach - h / 2) / (cellH * p.s) - 0.5;
      let a = 0, b = path.length; while (a < b) { const mid = (a + b) >> 1; if (path[mid][1] < lo) a = mid + 1; else b = mid; }   // the path only goes down
      for (; a < path.length && path[a][1] <= hi; a++) { place(i, path[a][0] + 0.5, path[a][1] + 0.5, point); if (!hidden(i, point[0], point[1])) take(point[0], point[1], p.vis); }
    }
    for (const [col, row] of model.peak.rope) { const y = (row + 0.5 - state.top) * cellH; if (Math.abs(y - y0) <= reach) take((col + 0.5) * cellW, y, 1); }
    if (planks) for (let k = 0; k < planks.length; k += 3) if (Math.abs(planks[k + 1] - y0) <= reach) take(planks[k], planks[k + 1], planks[k + 2]);
    if (weight > 0) state.lampX = sum / weight;
  }

  // The window on the frame. Across, it stays in the middle unless the way down would come too near its edge, and then it
  // goes with it. Where a card sits under its light, the view is lifted so the light stands clear above the card.
  const way = [[S / 2, cols / 2], ...model.stops.filter((s) => s.at).map((s) => [s.y, s.mark === 'hut' ? ground.window[0] * ground.k : s.x])];
  const wayAt = (row) => { let k = 1; while (k < way.length - 1 && way[k][0] < row) k++; const [r0, c0] = way[k - 1], [r1, c1] = way[k]; return c0 + (c1 - c0) * smooth(r0, r1, row); };
  let pan = -1, panTop = 0;
  function frame(time, live) {
    const { w, h, dpr, seen } = view, lift = state.lift = d.stack ? FRAME.lift * S * smooth(0.2 * S, 0.9 * S, scrollY / cellH) : 0, top = state.top = clamp(scrollY / cellH + lift, 0, d.end), centreRow = state.centreRow = top + S / 2, centre = state.centre = centreRow / S, yaw = turn.yawAt(centre);
    // from the summit down the way is where the light you carry is; above, and at the hut, it is the line from light to light
    const mid = (w - seen) / 2, on = mix((wayAt(centreRow) + 0.5) * cellW, state.lampX, 0.5 * smooth(3.7, 4.3, centre) * (1 - smooth(8.9, 9.4, centre))), want = clamp(clamp(mid, on - (1 - FRAME.keep) * seen, on - FRAME.keep * seen), 0, w - seen);
    pan = pan < 0 || Math.abs(top - panTop) > S / 3 ? want : pan + (want - pan) * Math.min(1, 5 * clamp(time - state.time, 0, 0.05)); panTop = top; view.ox = Math.round(pan * dpr) / dpr; gl.pan(view.ox * dpr); state.time = time;
    const shift = smooth(8.3, 9.7, centre); for (let i = 0; i < 3; i++) palette[i] = sky[i] = (skyTop[i] + (skyBase[i] - skyTop[i]) * shift) / 255;

    // where every layer stands
    layer(LAYER.page, 0, 1, centreRow);
    lobes.forEach((l, i) => {
      const p = turn.pose(l, yaw, centreRow, pose[i]), ridge = l.span != null;
      p.on = !!made[i] && p.vis >= 0.02 && h / 2 + (l.apex - 24 - centreRow) * cellH * p.s < h && p.X - (l.cx + 1) * p.s < cols && p.X + (l.W - l.cx) * p.s > 0;   // made, to be seen, and on the screen
      layer(LAYER.lobe + i, p.X, p.s, centreRow, p.vis, p.tone, p.ref, ridge ? l.apex : -1e9, ridge ? l.apex + l.span : 1e9, nearness(i), l.cx + 0.5);
    });
    layer(LAYER.ground, 0, ground.k, centreRow);
    CLOUDS.forEach((c, n) => layer(LAYER.cloud + n, 0, c.k, centreRow, 1, 1, 0, 0, 0, FAR, 40, c.drift, cloudSpan(cols, n)));
    SNOW.tiers.forEach((tier, n) => layer(LAYER.snow + n, 0, tier[0], centreRow));
    LEAVES.depths.forEach((depth, n) => layer(LAYER.leaf + n, 0, depth[0], centreRow));

    const count = live ? live.step(time, state) : 0;
    findLamp(live?.planks);
    state.dark = MASSIF.lamp.dark * smooth(3.82, 4.87, centre);
    set.v2('uRes', w * dpr, h * dpr); set.f('uLeft', view.ox * dpr); set.v2('uCell', cellW * dpr, cellH * dpr); set.f('uType', d.typeSize * dpr); set.f('uAscent', Math.round(0.9 * d.typeSize) * dpr);
    set.f('uTime', time); set.f('uS', S); set.f('uPx', dpr); set.f('uCols', cols); set.fv3('uPalette', palette);
    set.v4('uLamp', state.lampX * dpr, state.lampY * dpr, state.r0 * dpr, state.r1 * dpr); set.f('uDark', state.dark);
    set.v4('uFall', SNOW.z[0] * S, SNOW.z[1] * S, LEAVES.from * S, G); set.v3('uLeaf', glyph(','), glyph("'"), glyph('~')); set.fv3('uGround', tones); set.v2('uWood', 5.55, LAYOUT.forest); set.f('uAltStar', glyph('*'));
    if (live) live.uniforms(set); else { set.f('uHush', 0); set.v2('uLean', 0, 0); }

    // draw, back to front
    gl.begin(sky, live?.bytes, count);
    const snowing = centre > SNOW.z[0] - 0.8 && centre < SNOW.z[1] + 0.8, L = live?.ranges, drawLive = (name, o) => { if (L && L[name][1]) gl.draw(L[name][0], L[name][1], ALIVE.get(o)); };
    if (flags.prepass !== false) for (let i = lobes.length - 1; i >= 0; i--) if (pose[i].on && pose[i].vis >= 0.995) gl.draw(made[i].first, made[i].cover, MASK);
    if (top < LAYOUT.deck[1] * S) gl.draw(...R.stars, TEST);
    drawLive('sky', TEST);
    if (top + S > 2.9 * S) {
      if (snowing) gl.draw(...R.snow0, TEST); drawLive('flock', TEST);
      if (Math.abs(air.deckRow - centreRow) * CLOUDS[0].k < 1.5 * S) gl.draw(...R.clouds0, TEST);
    }
    for (let i = 0; i < lobes.length; i++) if (pose[i].on && flags.try !== 'nolobes') gl.draw(made[i].first, flags.try === 'cover' ? made[i].cover : flags.try !== 'solids' && (made[i].last + 3 - centreRow) * pose[i].s > -S / 2 ? made[i].total : made[i].solids, made[i].draw);   // above the screen it is only a dark body
    if ((G - 7 - centreRow) * ground.k < S / 2) gl.draw(...R.ground, PLAIN);
    if (top < d.seamRow + 4) gl.draw(...R.peak, PLAIN);
    drawLive('smoke', PLAIN); if (snowing) gl.draw(...R.snow12, PLAIN); drawLive('owl', PLAIN); drawLive('squirrels', PLAIN);
    drawLive('bridges', LIT);
    for (const i of routeLobes) if (pose[i].on && made[i].route) gl.draw(...made[i].route, LIT_TEST);
    if (top < d.bodyTop) gl.draw(...R.rope, LIT);
    drawLive('litBridges', LIT);
    if (centre > LEAVES.from - 0.75) gl.draw(...R.leaves, LIT);
    drawLive('flag', LIT); drawLive('lamps', LIT_TEST); drawLive('waypoints', LIT);
    for (const n of [1, 2]) if (Math.abs(air.deckRow - centreRow) * CLOUDS[n].k < 1.5 * S) gl.draw(...R['clouds' + n], LIT);
    drawLive('tethers', LIT);
  }
  return { frame, addLobe, state, hidden, behind, place, made, ranges: R };
}
