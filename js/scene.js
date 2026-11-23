// The frame: where the page is → where every layer stands → the list of things to draw, back to front.

import { clamp, smooth, mix } from './math.js';
import { LAYOUT, MASSIF, FRAME } from './art.js';
import { LAYERS, COLOURS as ROOM } from './glsl.js';
import { COLOURS, rgb, LAYER, packSky, packPeak, packLobe, packGround, packClouds, packSnow, packLeaves, cloudSpan } from './pack.js';
import { CLOUDS, SNOW, LEAVES } from './world/air.js';
import { CARD } from './art.js';

const FAR = 0.9, nearness = (i) => 0.6 - 0.02 * i;   // depths: everything not a lobe is behind them all; a later lobe is nearer
const PLAIN = {}, TEST = { test: true }, LIT = { lit: true }, LIT_TEST = { lit: true, test: true }, MASK = { mask: true };
const ALIVE = new Map([PLAIN, TEST, LIT, LIT_TEST, MASK].map((o) => [o, { ...o, live: true }]));   // the same, from what is alive this frame

export function makeScene(gl, model, view, flags = {}) {
  const d = model.dims, { lobes, turn, air, ground } = model, { layers: T, set, glyph } = gl, { S, cellW, cellH, cols, groundRow: G } = d;
  const palette = new Float32Array(ROOM * 3), R = {}, skyTop = rgb('sky'), skyBase = rgb('skyBase'), sky = [0, 0, 0];
  COLOURS.forEach((n, i) => palette.set(rgb(n).map((v) => v / 255), i * 3));
  const tones = new Float32Array(['rockDark', 'pineDark', 'dim'].flatMap((n) => rgb(n).map((v) => v / 255)));   // the ground under a skyline, bare and wooded, and the mist over one
  const add = (name, bytes) => { R[name] = [gl.append(bytes), bytes.byteLength / 24]; };
  // a run that begins with what only hides: R[name] is all of it, R[name + 'Hides'] the part that hides
  const addHiding = (name, bytes, hides) => { add(name, bytes); R[name + 'Hides'] = [R[name][0], hides]; };
  const [peak, rope, peakHides] = packPeak(model, glyph), [earth, earthHides] = packGround(model, glyph);
  add('stars', packSky(model, glyph)); addHiding('peak', peak, peakHides); add('rope', rope); addHiding('ground', earth, earthHides());
  CLOUDS.forEach((_, n) => { const [bytes, hides] = packClouds(model, n, glyph); addHiding('clouds' + n, bytes, hides()); });
  add('snow0', packSnow(model, [0], glyph)); add('snow12', packSnow(model, [1, 2], glyph)); add('leaves', packLeaves(model, glyph));

  // each lobe as it is made: its instances, its ground, where it stands this frame
  const pose = lobes.map(() => ({ X: 0, s: 1, vis: 0, tone: 1, ref: 0, on: false })), made = lobes.map(() => null);
  function addLobe(i) {
    const p = packLobe(lobes[i], i, d, glyph), first = gl.append(p.bytes);
    gl.wash(i, p.wash.w, p.wash.h, p.wash.rgba); gl.form(i, p.form);
    made[i] = { strips: p.strips.map((st) => ({ ...st, at: first + st.at })), last: p.last, route: p.route[1] && [first + p.route[0], p.route[1]], draw: { test: true, wash: [i, 0, p.wash.y0, p.wash.w, p.wash.h] } };
  }
  lobes.forEach((l, i) => { if (l.cover) addLobe(i); });

  const layer = (i, X, s, centreRow, vis = 1, tone = 1, ref = 0, lo = 0, hi = 0, z = FAR, cx = 0, drift = 0, span = 0) => {
    let o = i * 4; T[o] = X; T[o + 1] = s; T[o + 2] = centreRow; T[o + 3] = vis;
    o += LAYERS * 4; T[o] = tone; T[o + 1] = ref; T[o + 2] = lo; T[o + 3] = hi;
    o += LAYERS * 4; T[o] = z; T[o + 1] = cx; T[o + 2] = drift; T[o + 3] = span;
  };

  // Is the screen point (css px) behind lobe i's body, as it stands? And: behind any lobe nearer than `from` that is at least `solid`?
  const state = { span: FRAME.span, lift: 0, top: 0, centreRow: 0, centre: 0, time: 0, lampX: view.w / 2, lampY: 0, r0: 0, r1: 0, dark: 0, pose, sky };
  const behind = (i, x, y) => { const l = lobes[i], p = pose[i], c = Math.floor((x / cellW - p.X) / p.s + l.cx + 0.5), r = state.centreRow + (y - view.h / 2) / (cellH * p.s); return c >= 0 && c < l.W && r >= l.cover[c]; };
  const hidden = (from, x, y, solid = 0.5) => { for (let i = from + 1; i < lobes.length; i++) if (made[i] && pose[i].vis >= solid && behind(i, x, y)) return true; return false; };
  const place = (i, c, r, out) => { const p = pose[i]; out[0] = (p.X + (c - lobes[i].cx - 0.5) * p.s) * cellW; out[1] = view.h / 2 + (r - state.centreRow) * cellH * p.s; return out; };

  // the light you carry is on the route, at the height a stop's waypoint rests at
  const point = [0, 0], routeLobes = lobes.map((l, i) => i).filter((i) => lobes[i].path.length);
  function findLamp(planks) {
    const { h } = view, m = Math.min(view.seen, h), under = state.lift / (FRAME.lift * S), reach0 = MASSIF.lamp.core * m;
    // where a card sits under its light, the light you carry hangs between the two and reaches from one to the other
    const r0 = state.r0 = mix(reach0, state.span * h / 3, under), y0 = state.lampY = h * (0.5 - CARD.rest.side) - state.lift * cellH + under * state.span * h / 2, reach = 2.2 * r0;
    state.r1 = MASSIF.lamp.reach * m * r0 / reach0;
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

  function frame(time, live) {
    const { w, h, dpr } = view, lift = state.lift = d.stack ? FRAME.lift * S * smooth(0.1 * S, 0.55 * S, scrollY / cellH) : 0, top = state.top = clamp(scrollY / cellH + lift, 0, d.end), centreRow = state.centreRow = top + S / 2, centre = state.centre = centreRow / S, yaw = turn.yawAt(centre);
    state.time = time;
    const shift = smooth(8.3, 9.7, centre); for (let i = 0; i < 3; i++) palette[i] = sky[i] = (skyTop[i] + (skyBase[i] - skyTop[i]) * shift) / 255;

    // where every layer stands
    layer(LAYER.page, 0, 1, centreRow);
    lobes.forEach((l, i) => {
      const p = turn.pose(l, yaw, centreRow, pose[i]), ridge = l.span != null;
      p.on = !!made[i] && p.vis >= 0.02 && h / 2 + (l.apex - 24 - centreRow) * cellH * p.s < h && p.X - (l.cx + 1) * p.s < cols && p.X + (l.W - l.cx) * p.s > 0;   // made, to be seen, and on the screen
      layer(LAYER.lobe + i, p.X, p.s, centreRow, p.vis, p.tone, p.ref, ridge ? l.apex : -1e9, ridge ? l.apex + l.span : 1e9, nearness(i), l.cx + 0.5);
    });
    // depths: the far clouds are behind every ridge; the ground, the air and the near clouds are in front of them all, in that order
    layer(LAYER.ground, 0, ground.k, centreRow, 1, 1, 0, 0, 0, 0.1); layer(LAYER.air, 0, 1, centreRow, 1, 1, 0, 0, 0, 0.08); layer(LAYER.front, 0, ground.k, centreRow, 1, 1, 0, 0, 0, 0.09);
    CLOUDS.forEach((c, n) => layer(LAYER.cloud + n, 0, c.k, centreRow, 1, 1, 0, 0, 0, n === 0 ? 0.93 : 0.06 - 0.01 * n, 40, c.drift, cloudSpan(cols, n)));
    SNOW.tiers.forEach((tier, n) => layer(LAYER.snow + n, 0, tier[0], centreRow));
    LEAVES.depths.forEach((depth, n) => layer(LAYER.leaf + n, 0, depth[0], centreRow));

    const count = live ? live.step(time, state) : 0;
    findLamp(live?.planks);
    state.dark = MASSIF.lamp.dark * smooth(3.82, 4.87, centre);
    set.v2('uRes', w * dpr, h * dpr); set.f('uLeft', Math.round(view.ox * dpr)); set.v2('uCell', cellW * dpr, cellH * dpr); set.f('uType', d.typeSize * dpr); set.f('uAscent', Math.round(0.9 * d.typeSize) * dpr);
    set.f('uTime', time); set.f('uS', S); set.f('uPx', dpr); set.f('uCols', cols); set.fv3('uPalette', palette);
    set.v4('uLamp', state.lampX * dpr, state.lampY * dpr, state.r0 * dpr, state.r1 * dpr); set.f('uDark', state.dark);
    set.v4('uFall', SNOW.z[0] * S, SNOW.z[1] * S, LEAVES.from * S, G); set.v3('uLeaf', glyph(','), glyph("'"), glyph('~')); set.fv3('uGround', tones); set.v2('uWood', 5.55, LAYOUT.forest); set.f('uAltStar', glyph('*'));
    if (live) live.uniforms(set); else { set.f('uHush', 0); set.v2('uLean', 0, 0); }

    gl.begin(sky, live?.bytes, count);
    const snowing = centre > SNOW.z[0] - 0.8 && centre < SNOW.z[1] + 0.8, L = live?.ranges, drawLive = (name, o) => { if (L && L[name][1]) gl.draw(L[name][0], L[name][1], ALIVE.get(o)); };
    const groundOn = (G - 7 - centreRow) * ground.k < S / 2, peakOn = top < d.seamRow + 4, cloudsOn = CLOUDS.map((c) => Math.abs(air.deckRow - centreRow) * c.k < 1.5 * S);
    // which strips of which lobes are on the screen (a tree may stand a little out of its strip, so a margin)
    const lo = view.ox / cellW - 10, hi = (view.ox + view.seen) / cellW + 10, shown = [];
    for (let i = 0; i < lobes.length; i++) if (pose[i].on) for (const st of made[i].strips) { const p = pose[i], x0 = p.X + (st.c0 - lobes[i].cx - 0.5) * p.s, x1 = p.X + (st.c1 - lobes[i].cx - 0.5) * p.s; if (x1 > lo && x0 < hi) shown.push([i, st]); }

    // How anything hides what is behind it. Nothing is painted to stand for "what is behind": there are surfaces, which have
    // a colour of their own, and ink; and what hides has no colour at all. A lobe's body hides everything behind it (it is in
    // the depth). What stands on a lobe, or in front of it, hides only the INK behind it: farther surfaces are drawn whole,
    // so what shows through a tree, a cloud or a hut is whatever is really behind it.
    const solid = (i) => pose[i].vis >= 0.995, hideOf = live?.hideOf, liveHides = (i, mark) => { const r = hideOf?.[LAYER.lobe + i]; if (r && r[1]) gl.draw(r[0], r[1], ALIVE.get(MASK), mark); };
    // 1. the depth: every solid lobe's body; and what hides the far sky (the peak, the far clouds)
    for (const [i, st] of shown) if (solid(i)) gl.draw(st.at, st.cover, MASK);
    if (peakOn) gl.draw(...R.peakHides, MASK);
    if (cloudsOn[0]) gl.draw(...R.clouds0Hides, MASK);
    // 2. marks: where each thing that hides is, numbered by how near it is. Ink is drawn only where nothing nearer is marked.
    for (const [i, st] of shown) if (solid(i)) gl.draw(st.at + st.cover, st.hides - st.cover, MASK, i + 2);
    for (let i = 0; i < lobes.length; i++) if (pose[i].on && solid(i)) liveHides(i, i + 2);
    if (groundOn) gl.draw(...R.groundHides, MASK, 250);
    for (const n of [1, 2]) if (cloudsOn[n]) gl.draw(...R['clouds' + n + 'Hides'], MASK, 250 + n);
    if (L && L.hidesFront[1]) gl.draw(L.hidesFront[0], L.hidesFront[1], ALIVE.get(MASK), 253);

    // 3. the far sky
    if (top < LAYOUT.deck[1] * S) gl.draw(...R.stars, TEST, 0, 1);
    if (L && L.sky[1]) gl.draw(L.sky[0], L.sky[1], ALIVE.get(TEST), 0, 1);
    if (top + S > 2.9 * S) { if (snowing) gl.draw(...R.snow0, TEST, 0, 1); if (cloudsOn[0]) gl.draw(...R.clouds0, TEST, 0, 1); }
    // 4. each lobe, back to front: its body; then what hides on it goes into the depth, so that its own things hide one another in order; then its ink
    for (let i = 0; i < lobes.length; i++) {
      if (!pose[i].on) continue;
      const inked = (made[i].last + 3 - centreRow) * pose[i].s > -S / 2;   // above the screen it is only a dark body
      for (const [j, st] of shown) if (j === i) gl.draw(st.at, st.cover, made[i].draw);
      if (!inked) continue;
      if (solid(i)) { for (const [j, st] of shown) if (j === i) gl.draw(st.at + st.cover, st.hides - st.cover, MASK); liveHides(i, 0); }
      for (const [j, st] of shown) if (j === i) gl.draw(st.at + st.hides, st.total - st.hides, made[i].draw, 0, i + 2);
    }
    // 5. what hides in front of every lobe goes into the depth too, for what is drawn from here on
    if (groundOn) gl.draw(...R.groundHides, MASK);
    for (const n of [1, 2]) if (cloudsOn[n]) gl.draw(...R['clouds' + n + 'Hides'], MASK);
    if (L && L.hidesFront[1]) gl.draw(L.hidesFront[0], L.hidesFront[1], ALIVE.get(MASK));
    // 6. the rest, back to front
    drawLive('birds', TEST);
    if (groundOn) gl.draw(...R.ground, PLAIN);
    if (peakOn) gl.draw(...R.peak, PLAIN);
    drawLive('smoke', PLAIN); if (snowing) gl.draw(...R.snow12, PLAIN); drawLive('animals', TEST);
    drawLive('bridges', LIT);
    for (const i of routeLobes) if (pose[i].on && made[i].route) gl.draw(...made[i].route, LIT_TEST);
    if (top < d.bodyTop) gl.draw(...R.rope, LIT);
    drawLive('litBridges', LIT);
    if (centre > LEAVES.from - 0.75) gl.draw(...R.leaves, LIT);
    drawLive('flag', LIT); drawLive('lamps', LIT_TEST); drawLive('waypoints', LIT_TEST);
    for (const n of [1, 2]) if (cloudsOn[n]) gl.draw(...R['clouds' + n], LIT_TEST);
    drawLive('tethers', LIT);
  }
  return { frame, addLobe, state, hidden, behind, place, made, ranges: R };
}
