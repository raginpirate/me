// What is alive this frame: the name, the lights, shooting stars, bridges, lamps, waypoints, and what lives on the
// way down. Each frame it writes them, in drawing order, into one buffer of instances.

import { clamp, smooth, mix, twinkle, mulberry32 } from './math.js';
import { BYTES, KIND, INK, HOT, DISC, BARE, FREE, TRAIL, SOFT_Y, writer } from './glsl.js';
import { LAYER, colour } from './pack.js';
import { TREES, LEAF_ROW, FRAME, FLAG, CATS } from './art.js';

const SPRING = { star: [7, 0.5, 3, 5, 2.5, 1], light: [12, 0.6, 1.2, 5, 0.5, 0.6], dot: [7, 0.5, 5, 5, 2.5, 1] };   // stiffness, damping, furthest, push radius, push, share of the shove
// What a stop's lantern hangs from: [glyph, dx, dy, size, colour], its colour, and how high the lantern hangs (the stop is at 0).
// A part with no colour of its own is the lamp's: grey until the lantern is lit, then wood in its light.
const POST = [['|', -1.05, 0.55, 1], ['|', -1.05, -0.3, 1], ['|', -1.05, -1.15, 1], [',', -0.95, -1.82, 1], ['-', -0.5, -1.96, 1], ["'", -0.02, -1.8, 1]];
const MARKS = {
  lantern: [POST, 0.85], hut: [POST, 0.85],
  // a snowman in a top hat, its two branches held out level, the lantern hanging from the end of one
  snowman: [[['O', -1.75, 0.3, 1.7, 'snow'], ['o', -1.75, -0.75, 1.2, 'snow'], ['o', -1.75, -1.55, 0.85, 'snow'], ['=', -1.75, -2.02, 0.95, 'rule'], ['n', -1.75, -2.36, 0.85, 'rule'],
    ['-', -2.6, -0.85, 1, 'wood'], ['-', -3.1, -0.85, 1, 'wood'], ['-', -0.95, -0.85, 1, 'wood'], ['-', -0.42, -0.85, 1, 'wood'], ["'", -0.02, -0.72, 1]], -0.02],
};
// The animals. Each drawing here was put, alone and unlabelled, at the size it has in the scene, in front of a reader who
// was told nothing, and kept only once that reader named the animal. They are drawn in small type (z of the page's size,
// below) so that they have a shape at the height they stand: the hut's door is two rows, a deer about that, a sheep a
// little over one, an owl about one. (No squirrel drawn small enough to stand by the hut has yet been named by that reader.) Rows of type, facing right; `walk` and `graze` replace the last rows.
const BEASTS = {
  stag: { tint: 'timber', rows: ['         \\/ \\/', '          \\_/ ', '    ______/#\\_', "  ,########'  ", "  '#/####\\#   ", '   #|    |#   ', "   '|    |'   "], walk: ['   /#    #\\   ', '  /  \\  /  \\  '] },
  doe: { tint: 'timber', rows: ['          ,/, ', '          \\_/ ', '    ______/#\\_', "  ,########'  ", "  '#/####\\#   ", '   #|    |#   ', "   '|    |'   "], walk: ['   /#    #\\   ', '  /  \\  /  \\  '] },
  ewe: { tint: 'snow', rows: ['   .@@@@@@@.    ', '  @@@@@@@@@@,-. ', "  @@@@@@@@@@\\_/'", "  '@@@@@@@@'    ", '    ||  ||      '], walk: ['   /|  |\\       '],
    graze: ['  @@@@@@@@@@.   ', '  @@@@@@@@@@@\\  ', "  '@@@@@@@@' \\-.", '    ||  ||   \\_/'] },
  ram: { tint: 'snow', rows: ['   .@@@@@@@.,-. ', '  @@@@@@@@@(@,-.', "  @@@@@@@@@@\\_/'", "  '@@@@@@@@'    ", '    ||  ||      '], walk: ['   /|  |\\       '] },
  squirrel: { tint: 'leaf', rows: [' ,##,       ', ' ####   ,^^ ', " '###  ,###o", "  '##,####' ", "    '####(  ", '     "  "   '] },
  owl: { tint: 'timber', eyes: 'o', rows: ['  ^ ^ ', ' {o,o}', ' /)_) ', '  " " '] },
};
const TURNED = { '/': '\\', '\\': '/', '(': ')', ')': '(', '<': '>', '>': '<', '{': '}', '}': '{' };
const ORDER = ['sky', 'birds', 'smoke', 'animals', 'bridges', 'litBridges', 'flag', 'lamps', 'waypoints', 'tethers'];

export function makeLive(gl, model, view, scene, cards) {
  const d = model.dims, { lobes, stops, ground, turn, air } = model, { S, cellW, cellH, cols, typeSize, aspect, u, groundRow: G } = d, { state, made, place, hidden } = scene;
  const ROOM = 16384, buffer = new ArrayBuffer(ROOM * BYTES), w = writer(buffer), ranges = Object.fromEntries(ORDER.map((n) => [n, [0, 0]])), glyphs = {}, RA = air.random;
  const g = (ch) => glyphs[ch] ??= gl.glyph(ch), pick = (list) => list[Math.floor(RA() * list.length)], PAGE = LAYER.page, SKY = 0;
  let top = 0, time = 0, dt = 0.016, last = -1, lastTop = 0, vel = 0, shove = 0, lean = 0, leanV = 0, lamps = 0;
  const ptr = { x: 0, y: 0, at: -1e9, on: false, c: 0, r: 0 };
  addEventListener('pointermove', (e) => { ptr.x = e.clientX + view.ox; ptr.y = e.clientY; ptr.at = performance.now(); }, { passive: true });

  // The pointer's past, for the springs in the shader. Each star, flake and leaf is a spring pushed by the pointer; where a
  // spring is now is its past pushes weighed by how a spring answers a knock (nothing at once, most a moment later, then
  // back past rest and settling). So the shader is given the last second of the pointer and those weights.
  const KNOCK = { stiff: 12, damp: 0.4, every: 1 / 30 }, past = Array.from({ length: TRAIL }, (_, i) => ({ x: 0, y: 0, t: -1e3 - i, on: 0 })), trail = new Float32Array(TRAIL * 3);
  function remember() {
    const { stiff, damp, every } = KNOCK, ring = stiff * Math.sqrt(1 - damp * damp), dpr = view.dpr;
    if (time - past[0].t >= every) { const oldest = past.pop(); oldest.x = ptr.x; oldest.y = ptr.y + top * cellH; oldest.t = time; oldest.on = ptr.on ? 1 : 0; past.unshift(oldest); }   // kept down the page, so a scroll carries it
    let before = 0, sum = 0;
    for (let i = 0; i < TRAIL; i++) {
      const q = past[i], age = time - q.t, after = i + 1 < TRAIL ? time - past[i + 1].t : age + every, share = age > 1.5 ? 0 : stiff * stiff * Math.exp(-damp * stiff * age) * Math.sin(ring * age) / ring * (Math.min(after, age + 2 * every) - before) / 2;
      trail[i * 3] = q.x * dpr; trail[i * 3 + 1] = (q.y - top * cellH) * dpr; trail[i * 3 + 2] = share * q.on; sum += share; before = age;
    }
    if (sum > 0.5) for (let i = 0; i < TRAIL; i++) trail[i * 3 + 2] /= sum;   // a pointer held still pushes exactly as far as it should
  }

  // placing: an object by its ink, at a screen point (css px); type on the page's lines, at a cell
  const ink = (ch, name, x, y, size, alpha, kind = 0, p = 0) => { if (alpha > 0.004 && w.count < ROOM - 8) w.put(x / cellW, top + y / cellH, 0, 0, 0, 0, size / typeSize, g(ch), colour(name), Math.min(1, alpha), PAGE, kind, INK | p); };
  const put = (ch, name, c, r, alpha) => { if (alpha > 0.004 && w.count < ROOM - 8) w.put(c, r, 0, 0, 0, 0, 1, g(ch), colour(name), Math.min(1, alpha), PAGE, 0, FREE); };
  // on a layer of its own (a lobe, the ground): offsets and sizes in that layer's type
  const on = (li, x, y, ch, name, dx, dy, size, alpha, kind = 0, lx = 0, ly = 0) => { if (alpha > 0.004 && w.count < ROOM - 8) w.put(x, y, (dx * typeSize / cellW + lx) / size, (dy * typeSize / cellH + ly) / size, 0, 0, size, g(ch), colour(name), Math.min(1, alpha), li, kind, INK | BARE); };
  const section = (name, draw) => { const first = w.count; draw(); ranges[name][0] = first; ranges[name][1] = w.count - first; };

  function spring(p, [stiff, zeta, far, reach, most, share], held = 1) {
    let tx = p.hx, ty = p.hy, om = stiff;
    if (ptr.on) { const dx = (p.x + 0.5 - ptr.c) * aspect, dy = p.y + 0.5 - ptr.r, dist = Math.hypot(dx, dy); if (dist < reach && dist > 1e-4) { const f = (1 - dist / reach) * most * smooth(0, 1.2, dist); tx += dx / dist * f / aspect; ty += dy / dist * f; om = 2.2 * stiff; } }
    p.vx += (-om * om * (p.x - tx) - 2 * zeta * om * p.vx) * dt; p.vy += (-om * om * (p.y - ty) - 2 * zeta * om * p.vy + shove * share * held) * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const ex = (p.x - p.hx) * aspect, ey = p.y - p.hy, e = Math.hypot(ex, ey); if (e > far) { p.x = p.hx + ex / e * far / aspect; p.y = p.hy + ey / e * far; p.vx /= 2; p.vy /= 2; }
  }
  const sprung = (x, y) => ({ hx: x, hy: y, x, y, vx: 0, vy: 0 });
  let reveal = 0;
  const flicker = (phase) => { const steady = twinkle(time, phase, 0.24, 2.6), r = reveal; return r >= 1 ? steady : clamp(r * twinkle(time, phase, 0.1, 9) + 0.6 * r * r, 0, 1) * (1 - r) + steady * r; };

  // --- the name ---
  const name = model.sky.name, nameStars = name.stars.map(([x, y, anchor, seed]) => ({ ...sprung(x, y), anchor, seed }));
  function drawName() {
    if (top > 1.2 * S) return;
    const hold = 1 - smooth(0.05, 0.1, clamp(top / d.maxScroll, 0, 1));
    for (const p of nameStars) spring(p, SPRING.star);
    if (hold > 0.001) name.lines.forEach(([i, j], n) => {
      const a = nameStars[i], b = nameStars[j], dx = b.x - a.x, dy = b.y - a.y, steps = Math.max(1, Math.round(2 * Math.max(Math.abs(dx) * aspect * 2, Math.abs(dy))));
      for (let k = 1; k < steps; k++) { const alpha = (k % 2 ? 0.95 : 0.6) * hold * flicker(1.7 * n + 2.3 * k); if (alpha >= 0.02) put('·', 'thread', a.x + dx * k / steps, a.y + dy * k / steps, alpha); }
    });
    for (const p of nameStars) {
      if (hold <= 0.001) put('*', 'star', p.x, p.y, 1);
      else if (p.seed < 0.5) { const ch = p.anchor && reveal > 0.6 ? '✦' : '*'; put(ch, 'star', p.x, p.y, 1); put(ch, 'white', p.x, p.y, reveal); }
      else put(p.anchor ? '✦' : '*', 'white', p.x, p.y, clamp(reveal * ((1 - reveal) * twinkle(time, 40 * p.seed, 0, 8) + reveal * twinkle(time, 50 * p.seed, 0.25, 1.3 + 1.5 * p.seed)), 0, 1));
    }
  }

  // --- sky lights and their tethers ---
  const lights = stops.map((s, n) => s.x != null && !s.mark ? { ...sprung(s.x, s.y), n, sx: 0, sy: 0, string: null } : null), spots = stops.map(() => [0, -1e4]);
  function drawLights() {
    for (const p of lights) {
      if (!p) continue;
      if (p.hy < top - 6 || p.hy > top + S + 6) { spots[p.n][1] = -1e4; continue; }
      spring(p, SPRING.light);
      const x = p.sx = (p.x + 0.5) * cellW, y = p.sy = (p.y + 0.5 - top) * cellH, lit = cards.glow[p.n], live = lit * twinkle(time, p.n, 0.6, 2.4), pitch = 11 * u;
      spots[p.n][0] = x; spots[p.n][1] = y;
      ink('✦', 'ember', x, y, mix(25, 31, lit) * u, mix(0.15, 0.22, live));
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ink('·', 'ember', x + a * pitch, y + b * pitch, typeSize, 0.45 + 0.55 * live);
      if (lit > 0.05) for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) ink('·', 'ember', x + a * pitch, y + b * pitch, typeSize, 0.45 * live);
      ink('✦', 'ember', x, y, mix(15, 17, lit) * u, 1); ink('✦', 'emberHot', x, y, mix(15, 17, lit) * u, lit);
    }
  }
  function drawTethers() {
    for (const p of lights) {
      if (!p) continue;
      const presence = cards.presence[p.n], A = presence >= 0.02 && p.sy > -1e3 ? cards.anchor(p.n) : null;
      if (!A) { p.string = null; continue; }
      const R = Math.random;
      if (!p.string) {   // a new string each time the card opens: no two are alike
        const gap = Math.hypot(A[0] - (p.hx + 0.5) * cellW, A[1] - (p.hy + 0.5 - stops[p.n].snap) * cellH), rest = Math.max(20 * u, gap - 32 * u), n = Math.max(6, Math.round(rest / (mix(6, 9, R()) * u)));
        p.string = { rest, sway: [[4.5, 1.1, 2.4], [2, 3, 5.5]].map(([far, few, most]) => [far * (0.7 + 0.6 * R()), mix(few, most, R()) * 2 * Math.PI, R() * 2 * Math.PI]),
          dots: Array.from({ length: n }, (_, k) => ({ f: (k + 0.5 + (R() - 0.5) * 0.9) / n, a: R() > 0.08 ? mix(0.45, 0.95, R()) : 0, late: R(), tw: R() * 2 * Math.PI, hx: NaN, hy: 0, x: 0, y: 0, vx: 0, vy: 0 })) };
      }
      const { rest, sway: [[r1, w1, s1], [r2, w2, s2]], dots } = p.string, full = Math.hypot(A[0] - p.sx, A[1] - p.sy) || 1, ux = (A[0] - p.sx) / full, uy = (A[1] - p.sy) / full;
      const clear = 29 * u, len = Math.max(0, full - clear - 3 * u), slack = clamp((rest / Math.max(len, 1)) ** 0.8, 0.55, 1.7) * u;
      let fastest = 0;
      for (const q of dots) {
        q.free = Math.sin(Math.PI * q.f); const along = clear + q.f * len, off = (Math.sin(q.f * w1 + s1) * r1 + Math.sin(q.f * w2 + s2) * r2) * q.free * slack;
        q.nx = (p.sx + ux * along - uy * off) / cellW - 0.5; q.ny = top + (p.sy + uy * along + ux * off) / cellH - 0.5;
        if (Number.isNaN(q.hx)) { q.hx = q.x = q.nx; q.hy = q.y = q.ny; }
        fastest = Math.max(fastest, q.free * Math.hypot((q.nx - q.hx) * aspect, q.ny - q.hy) / dt);
      }
      const share = fastest > 0.01 ? 14 * Math.tanh(fastest / 14) / fastest : 1, floor = d.stack ? top + (A[1] + 2) / cellH - 0.5 : Infinity;
      for (const q of dots) {
        const follow = 1 - q.free * share; q.x += (q.nx - q.hx) * follow; q.y += (q.ny - q.hy) * follow; q.hx = q.nx; q.hy = q.ny;   // the ends are held, the middle is left behind a little
        if (!q.a) continue;
        spring(q, SPRING.dot, q.free);
        if (q.y < floor) put('·', 'thread', q.x, q.y, q.a * 0.95 * smooth(0.55 * q.late, 0.55 * q.late + 0.45, presence) * flicker(q.tw));
      }
    }
  }

  // --- shooting stars: points flying straight through space in front of a camera ---
  const shots = [], RS = mulberry32(99), TAIL = '*=--..'; let shotIn = model.sky.firstShot;
  function launch() {
    const W = view.w, H = view.h, r = RS, roof = Math.max(0, 0.35 * S * cellH - top * cellH), out = 2 * typeSize; let ex, ey, heading, len;
    for (let tries = 0; tries < 12; tries++) {
      if (roof === 0 && r() < 0.5) { ex = r() * W; ey = -out; heading = 30 + 35 * r(); if (r() < 0.5) heading = 180 - heading; }
      else { const left = r() < 0.5; ex = left ? -out : W + out; ey = roof + r() * (H - roof) * 0.7; heading = 8 + 37 * r(); if (!left) heading = 180 - heading; }
      const cx = Math.cos(heading * Math.PI / 180), cy = Math.sin(heading * Math.PI / 180);
      len = Math.min(cx > 0 ? (W + out - ex) / cx : cx < 0 ? (-out - ex) / cx : Infinity, (H + out - ey) / cy);
      if (!(len < 0.35 * Math.min(W, H) + 2 * out || len > 1.25 * W)) break;
    }
    const F = W, ratio = mix(1.4, 3.2, r()), near = mix(0.5, 1, r()) * F, toward = r() < 0.6, z0 = toward ? near * ratio : near, z1 = toward ? near : near * ratio;
    const speed = Math.min(mix(0.28, 0.54, (r() + r()) / 2), 1.15 / ratio) * W, T = len / speed, rad = heading * Math.PI / 180;
    const X0 = (ex - W / 2) * z0 / F, Y0 = (ey - H / 2) * z0 / F, X1 = (ex + Math.cos(rad) * len - W / 2) * z1 / F, Y1 = (ey + Math.sin(rad) * len - H / 2) * z1 / F;
    shots.push({ X: X0, Y: Y0, Z: z0, vX: (X1 - X0) / T, vY: (Y1 - Y0) / T, vZ: (z1 - z0) / T, age: 0, life: 1.5 * T + 0.5, oy: top * cellH + H / 2, trail: [] });
  }
  function drawShots() {
    const W = view.w, H = view.h, F = W;
    if (state.centre > 0.35 && state.centre < 3.95 && (shotIn -= dt) <= 0) { launch(); shotIn = 3.5 + RS() * 2.5; }
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i], scale = F / s.Z, x = W / 2 + s.X * scale, y = s.oy + s.Y * scale - top * cellH;
      if (ptr.on) {
        const reach = 6 * Math.max(0.6, scale), dx = (x - ptr.x) / cellH, dy = (y - ptr.y) / cellH, dist = Math.hypot(dx, dy);
        if (dist < reach && dist > 1e-3) { const sp = Math.hypot(s.vX, s.vY), now = Math.atan2(s.vY, s.vX); let diff = Math.atan2(dy, dx) - now; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); const a = now + clamp(diff, -0.7, 0.7) * (1 - dist / reach) * 6 * dt; s.vX = Math.cos(a) * sp; s.vY = Math.sin(a) * sp; }
      }
      s.vY -= shove * cellH * (s.Z / F) * dt; s.X += s.vX * dt; s.Y += s.vY * dt; s.Z += s.vZ * dt; s.age += dt;
      s.trail.unshift(s.X, s.Y, s.Z); s.trail.length = Math.min(s.trail.length, 144);
      const k = F / s.Z, sx = W / 2 + s.X * k, row = (s.oy + s.Y * k) / cellH;
      if (s.age >= s.life || sx < -20 * cellW || sx > W + 20 * cellW || row > Math.min(top + S + 8, 3.72 * S) || s.Z <= 0.28 * F || s.Z >= 4.2 * F) { shots.splice(i, 1); continue; }
      const fade = clamp((s.life - s.age) / 0.3, 0, 1) * (1 - smooth(3.22, 3.67, row / S)), sy = row * cellH - top * cellH;
      ink('✦', 'starBright', sx, sy, typeSize * clamp(k, 0.35, 3.6), clamp(1.15 * k, 0.1, 1) * fade);
      let px = sx, py = sy, run = 0, n = 0;
      for (let j = 3; j < s.trail.length && n < TAIL.length; j += 3) {
        const k0 = F / s.trail[j + 2], qx = W / 2 + s.trail[j] * k0, qy = s.oy + s.trail[j + 1] * k0 - top * cellH; run += Math.hypot(qx - px, qy - py); px = qx; py = qy;
        while (n < TAIL.length && run >= (n + 1) * 0.9 * typeSize * Math.max(0.5, k0)) { ink(TAIL[n], 'star', qx, qy, typeSize * clamp(k0, 0.35, 3.2), (n < 2 ? 0.9 : n < 4 ? 0.55 : 0.35) * clamp(1.15 * k0, 0.1, 1) * fade); n++; }
      }
    }
  }

  // --- the flag on the summit ---
  // The flag is cloth: a rectangle of pixels with a figure on it, a column at a time, each column riding the wind a little
  // behind the one nearer the pole. The wind up here is hard, so it snaps more than it sways.
  const flagAt = stops.findIndex((q) => q.mark === 'flag'), INKS = { w: colour('snow'), '.': colour('snow'), k: SKY, g: colour('lime'), p: colour('mauve') };
  const PAD = 9, banner = FLAG.map((row) => '.'.repeat(PAD) + row + '.'.repeat(PAD));   // cloth either side of the figure: a flag is wider than it is tall
  const cloth = Array.from({ length: banner[0].length }, (_, i) => { const runs = []; for (let j = 0; j < banner.length; j++) { const c = INKS[banner[j][i]], last = runs[runs.length - 1]; if (last && last[2] === c) last[1]++; else runs.push([j, 1, c]); } return runs; });
  const blown = new Float32Array(cloth.length), blowing = new Float32Array(cloth.length);   // how far the pointer has knocked each column, and how fast it is going
  function drawFlag() {
    const px = Math.max(1.5, typeSize / 7), wide = cloth.length * px, tall = banner.length * px, x = (d.topCol + 0.5) * cellW, foot = (Math.ceil(d.summitRow) - top) * cellH, mast = tall + 1.6 * cellH, y0 = foot - mast;
    if (flagAt >= 0) { spots[flagAt][0] = x + wide / 2; spots[flagAt][1] = foot < -cellH || y0 > view.h ? -1e4 : y0 + tall / 2; }
    if (foot < -cellH || y0 > view.h + cellH) return;
    w.solid(x / cellW, top + y0 / cellH, -0.6 * px / cellW, -px / cellH, 1.2 * px / cellW, (mast + px) / cellH, 1, colour('rockLight'), 1, PAGE, 0);   // the mast
    const gust = 0.75 + 0.45 * Math.sin(0.9 * time) * Math.sin(2.3 * time + 1), over = ptr.on && ptr.y > y0 - tall && ptr.y < y0 + 2 * tall;
    cloth.forEach((runs, i) => {
      const far = (i + 1) / cloth.length, phase = 11 * time - 0.36 * i, cx = x + 0.6 * px + i * px;
      // the pointer's passing knocks the cloth: each column is a spring tied to the one nearer the mast, so a knock runs out along it
      const near = over ? Math.max(0, 1 - Math.abs(ptr.x - cx) / (0.35 * wide)) : 0, knock = near * (14 * ptr.vy + 40 * Math.sign(y0 + tall / 2 - ptr.y) * Math.min(1, Math.abs(ptr.vx) / 6)), held = i ? 0.9 * blown[i - 1] : 0;
      blowing[i] += (-90 * (blown[i] - held) - 9 * blowing[i] + 60 * knock * far) * dt; blown[i] = clamp(blown[i] + blowing[i] * dt, -1.2 * tall, 1.2 * tall) * (i ? 1 : 0);
      const ride = gust * far * (1.5 * Math.sin(phase) + 0.6 * Math.sin(2.3 * phase + 1)) * px + 0.7 * far * far * px + blown[i], shade = 0.84 + 0.16 * Math.cos(phase + 0.6);
      for (const [j, n, c] of runs) w.solid(cx / cellW, top + (y0 + j * px + ride) / cellH, 0, 0, 1.04 * px / cellW, (n * px + 0.4) / cellH, 1, c, c === SKY ? 1 : shade, PAGE, 0);
    });
  }

  // --- rope bridges, from each ridge of the route to the next ---
  const route = lobes.map((l, i) => i).filter((i) => lobes[i].path.length), planks = [], A = [0, 0], B = [0, 0]; let plankCount = 0;
  const spans = [];   // this frame's bridges: [x0, y0, x1, y1, size, vis, planks, sag]
  function findBridges() {
    spans.length = 0;
    for (let n = 0; n + 1 < route.length; n++) {
      const ia = route[n], ib = route[n + 1], a = state.pose[ia], b = state.pose[ib], path = lobes[ia].path;
      if (!made[ia] || !made[ib] || a.vis < 0.1 || b.vis < 0.1) continue;
      place(ib, lobes[ib].arrive[0] + 0.5, lobes[ib].arrive[1] + 0.5, B);
      if (B[1] < -view.h || B[1] > 2 * view.h) continue;
      let k = path.length - 1; for (; k >= 0; k--) { place(ia, path[k][0] + 0.5, path[k][1] + 0.5, A); if (!hidden(ia, A[0], A[1])) break; }   // it leaves from the last of the path you can see
      if (k < 0) place(ia, path[0][0] + 0.5, path[0][1] + 0.5, A);
      if ((A[1] < -40 && B[1] < -40) || (A[1] > view.h + 40 && B[1] > view.h + 40)) continue;
      const uB = typeSize * (a.s + b.s) / 2, len = Math.hypot(B[0] - A[0], B[1] - A[1]), vis = Math.min(a.vis, b.vis) * (1 - smooth(11 * uB, 15 * uB, len)); if (vis < 0.05) continue;   // no bridge yet while the next ridge is far round
      spans.push([A[0], A[1], B[0], B[1], uB, vis, Math.max(1, Math.round(len / (0.6 * uB))), Math.min(0.16 * len, 1.3 * uB), len]);
    }
  }
  function drawBridges(litPass) {
    if (!litPass) { findBridges(); plankCount = 0; }
    for (const [x0, y0, x1, y1, uB, vis, count, sag, len] of spans) {
      // a bridge hangs in front of whatever is behind it: clear its own strip of the picture first, so it reads over rock and trees
      if (!litPass) for (let j = 0; j <= count; j++) { const tt = j / count, x = x0 + (x1 - x0) * tt, y = y0 + (y1 - y0) * tt + sag * 4 * tt * (1 - tt); if (w.count < ROOM - 8) w.solid(x / cellW, top + y / cellH, -0.4 * uB / cellW, -1.5 * uB / cellH, 0.8 * uB / cellW, 2.1 * uB / cellH, 1, SKY, 0.9 * vis, PAGE, SOFT_Y); }
      for (let j = 0; j <= count; j++) {
        const tt = j / count, x = x0 + (x1 - x0) * tt, y = y0 + (y1 - y0) * tt + sag * 4 * tt * (1 - tt);
        if (litPass) { ink('=', 'ember', x, y, 0.95 * uB, vis, KIND.route); ink('=', 'emberHot', x, y, 0.95 * uB, vis, KIND.route, HOT); ink('·', 'ember', x, y - 0.95 * uB, uB, 0.8 * vis, KIND.route); ink('·', 'emberHot', x, y - 0.95 * uB, uB, 0.8 * vis, KIND.route, HOT); continue; }
        planks[plankCount++] = x; planks[plankCount++] = y; planks[plankCount++] = vis;
        ink('=', 'bridge', x, y, 0.95 * uB, vis); ink('·', 'muted', x, y - 0.95 * uB, uB, 0.85 * vis);
        if (j % 3 === 1) ink(':', 'muted', x, y - 0.48 * uB, 0.7 * uB, 0.6 * vis);
      }
      if (!litPass && len > 1.3 * uB) { ink('|', 'bridge', x0, y0 - 0.5 * uB, 1.35 * uB, vis); ink('|', 'bridge', x1, y1 - 0.5 * uB, 1.35 * uB, vis); }
    }
    planks.length = plankCount;
  }

  // --- the lamps of those climbing, one for each merged commit, and the waypoints ---
  const candidates = route.flatMap((i) => lobes[i].path.filter(([, r]) => r > 4.6 * S && r < 6.25 * S).map(([c, r]) => [i, c, r]));
  function drawLamps() {
    const n = clamp(lamps, 0, 40), bw = 1.8 * typeSize / cellW, bh = 1.4 * typeSize / cellH;
    for (let j = 0; j < n; j++) {
      const lamp = candidates[Math.floor((j + 0.5) / n * candidates.length)]; if (!lamp) continue;
      const [i, c, r] = lamp; if (!state.pose[i].on || state.pose[i].vis < 0.1) continue;
      w.solid(c + 0.5, r + 0.5, -bw / 2, -bh / 2, bw, bh, 1, SKY, 1, LAYER.lobe + i);
      on(LAYER.lobe + i, c + 0.5, r + 0.5, 'o', 'ember', 0, 0, 1, twinkle(time, 2.4 * j, 0.4, 3.1));
    }
  }
  const P = [0, 0];
  // Every stop on the mountain is a lantern: a small fire in a frame, hung from a post (or a snowman's arm, or by the hut).
  // It burns low until you are at it; then it flares, and its glow is the brightest thing on the screen.
  const FLAME = ['*', '+', '*', "'", '*', '+'];   // one mark, so it is a fire and not a face
  function drawWaypoints() {
    stops.forEach((s, n) => {
      if (!s.mark || s.mark === 'flag') return;
      const hut = s.lobe == null, li = hut ? LAYER.ground : LAYER.lobe + s.lobe, [parts, lift] = MARKS[s.mark], lit = cards.glow[n], live = lit * twinkle(time, n, 0.6, 2.4);
      let x, y;
      if (hut) { x = ground.hutLeft - 1.6; y = G - 0.45; spots[n][0] = x * cellW * ground.k; spots[n][1] = view.h / 2 + (y - state.centreRow) * cellH * ground.k; }
      else { const p = state.pose[s.lobe]; [x, y] = lobes[s.lobe].mark; place(s.lobe, x, y, P); spots[n][0] = P[0]; spots[n][1] = p.on && p.vis >= 0.05 ? P[1] : -1e4; if (spots[n][1] < -1e3) return; }
      if (spots[n][1] < -80 || spots[n][1] > view.h + 80) return;
      if (!hut) { const rx = 2.6 * typeSize / cellW, ry = 3.2 * typeSize / cellH; w.solid(x, y, -rx, -ry - 0.5 * lift * typeSize / cellH, 2 * rx, 2 * ry, 1, SKY, 1, li, DISC); }   // a small hollow, so it reads against rock and trees
      const lamp = (ch, dx, dy, k) => { on(li, x, y, ch, 'dim', dx, dy, k, 1); on(li, x, y, ch, 'wood', dx, dy, k, lit); };
      for (const [ch, dx, dy, k, own] of parts) if (own) on(li, x, y, ch, own, dx, dy, k, 1); else lamp(ch, dx, dy, k);
      // the lantern: a narrow frame under a cap. It is dark until you come to it; then the fire inside is lit, and it glows
      const h = -lift;
      lamp('[', -0.3, h, 0.9); lamp(']', 0.3, h, 0.9); lamp('_', 0, h - 0.7, 0.8);
      if (lit > 0.02) {
        on(li, x, y, 'o', 'leaf', 0, h, 5.2, 0.15 * live); on(li, x, y, 'o', 'leaf', 0, h, 3.1, 0.27 * live); on(li, x, y, 'o', 'ember', 0, h, 1.9, 0.34 * live);
        const flame = FLAME[Math.floor(7 * time + 1.7 * n) % FLAME.length]; on(li, x, y, flame, 'leaf', 0, h + 0.1, 0.8, lit); on(li, x, y, flame, 'emberHot', 0, h + 0.1, 0.8, lit * lit);
        for (const [a, b] of [[1.3, 0], [-1.3, 0], [0, 1.35], [0, -1.35], [0.95, 0.95], [-0.95, 0.95], [0.95, -0.95], [-0.95, -0.95]]) on(li, x, y, '·', 'leaf', a, h + b, 1, 0.8 * live);
      }
      if (hut) { const wx = ground.window[0], wy = G + 1 + ground.window[1]; w.put(wx - 1, wy - 0.5, 0, 0, 0, 0, 1, g('['), colour('emberHot'), live, li); w.put(wx, wy - 0.5, 0, 0, 0, 0, 1, g(']'), colour('emberHot'), live, li); }   // the window lights up too
    });
  }

  // --- smoke from the hut's chimney ---
  function drawSmoke() {
    if ((G - 20 - state.centreRow) * ground.k > S / 2) return;
    for (let i = 0; i < 4; i++) { const tt = (0.22 * time + i / 4) % 1; on(LAYER.ground, ground.chimney[0], G + 1 + ground.chimney[1], tt < 0.3 ? '.' : tt < 0.65 ? 'o' : 'O', 'dim', 0.5 * Math.sin(5 * tt + i) + 1.6 * tt, -3.4 * tt, 0.6 + 0.9 * tt, 0.75 * (1 - tt) ** 1.2); }
  }

  // --- the animals. Each family has its ground: a height it keeps to and a stretch it wanders along. The owl just sits. ---
  // a far flock, now and then: it crosses under the clouds and is gone
  let flock = null, flockIn = 2.5;
  function drawFlock() {
    const L = view.ox, W = L + view.seen, H = view.h, k = 0.3, clouds = H / 2 + (air.deckRow + 0.45 * S - state.centreRow) * cellH + 2 * cellH;   // where the cloud deck ends on the screen: birds keep under it
    flockIn -= dt;
    if (!flock && flockIn <= 0 && state.centre > 4.87 && state.centre < 8.5 && clouds < 0.6 * H) {
      const dir = RA() < 0.5 ? 1 : -1, n = 7 + Math.floor(RA() * 7), far = 0.45 + RA() * 0.3, birds = [[0, 0, RA() * 6.28]], high = Math.max(0.18, clouds / H + 0.06);
      for (let i = 1; i < n; i++) { const j = Math.ceil(i / 2), side = i % 2 ? 1 : -0.8; birds.push([-dir * (2.1 * j + (RA() - 0.5) * 0.9) * far, (side * j * (0.5 + RA() * 0.12) + (RA() - 0.5) * 0.3) * far, RA() * 6.28]); }
      flock = { dir, n, far, birds, x: dir > 0 ? L - 20 : W + 20, y: state.centreRow + ((high + RA() * Math.max(0.1, 0.62 - high)) * H - H / 2) / (cellH * k), v: 0.5 * Math.max(34, view.seen / 20) * (0.5 + far), drift: (RA() - 0.5) * 0.5 };
    }
    if (!flock) return;
    const f = flock, long = (Math.ceil(f.n / 2) * 2.1 + 3) * cellW, at = H / 2 + (f.y - state.centreRow) * cellH * k; f.x += f.dir * f.v * dt; f.y += f.drift * dt;
    if ((f.dir > 0 ? f.x - long > W + 20 : f.x + long < L - 20) || at < -0.3 * H || at > 1.3 * H) { flock = null; flockIn = 1 + 2 * RA(); return; }   // gone across, or left behind by the scroll: the next is not long coming
    for (const [dx, dy, phase] of f.birds) { const y = at + (dy * (1 + 0.08 * Math.sin(0.7 * time + phase)) + 0.3 * Math.sin(1.1 * time + phase)) * cellH; ink(Math.sin(5.5 * time + phase) > 0.1 ? 'v' : '-', 'bird', f.x + dx * cellW, y, typeSize * f.far, (0.3 + 0.45 * f.far) * smooth(clouds, clouds + 40, y)); }
  }

  // a beast with its feet at (x, y) of a layer, in type z of the page's size
  function beast(li, x, y, name, z, left = false, pose = null, shut = false, lx = 0, ly = 0) {
    const b = BEASTS[name], alt = pose && b[pose], rows = alt ? [...b.rows.slice(0, b.rows.length - alt.length), ...alt] : b.rows, n = rows[0].length;
    rows.forEach((text, i) => { for (let j = 0; j < n; j++) {
      let ch = text[left ? n - 1 - j : j]; if (!ch || ch === ' ') continue; if (left) ch = TURNED[ch] ?? ch;
      const eye = ch === b.eyes; on(li, x, y, eye && shut ? '-' : ch, eye ? 'ember' : b.tint, (j - (n - 1) / 2) * 0.6 * z, (i - rows.length + 0.5) * z, z, 1, KIND.tree, lx, ly);   // as a tree is, so it grows as the trees about it do
    } });
  }
  const hollow = (li, x, y, rx, ry, lx = 0, ly = 0) => w.solid(x, y, lx - rx * typeSize / cellW, ly - 1.7 * ry * typeSize / cellH, 2 * rx * typeSize / cellW, 2 * ry * typeSize / cellH, 1, SKY, 1, li, DISC, KIND.tree);
  // one that wanders: it stands a while, picks somewhere within its stretch, walks there
  const roamer = (reach, pace, rest, from = 0) => ({ x: from, to: from, facing: RA() < 0.5 ? 1 : -1, wait: 1 + rest * RA(), reach, pace, rest, from, moving: false });
  function wander(q) {
    q.moving = false;
    if (q.wait > 0) { q.wait -= dt; if (q.wait <= 0) q.to = clamp(q.from + (RA() * 2 - 1) * q.reach, -(q.lim ?? 1e9), q.lim ?? 1e9); return; }
    const gap = q.to - q.x, stride = q.pace * dt; if (Math.abs(gap) <= stride) { q.x = q.to; q.wait = q.rest * (0.5 + RA()); return; }
    q.facing = Math.sign(gap); q.x += q.facing * stride; q.moving = true;
  }
  // where each family's ground is, found once its ridge is made: [lobe, column, row]
  const core = lobes.findIndex((l) => l.kind === 'core'), ridges = lobes.map((l, i) => i).filter((i) => lobes[i].kind === 'route');
  const beside = (i, screens, aside) => { const l = lobes[i], r = Math.round(screens * S), at = l.path.find(([, pr]) => pr >= r); return at ? [i, at[0] + aside, r] : null; };
  const ridgeNear = (screens) => ridges.reduce((best, i) => best < 0 || Math.abs(lobes[i].apex / S - screens) < Math.abs(lobes[best].apex / S - screens) ? i : best, -1);
  const homes = { sheep: null, owl: null, deer: null };
  // a few sheep on the rock, deer in the wood: [roamer, rows off its ground, size, kind]
  const herd = [[roamer(6, 0.5, 12, -8), 0, 0.32, 'ram'], [roamer(5, 0.5, 14, 0), 1, 0.3, 'ewe'], [roamer(5, 0.5, 10, 8), 0, 0.3, 'ewe'], [roamer(4, 0.7, 7, 3), 2, 0.22, 'ewe']];
  const deer = [[roamer(8, 0.8, 12, -4), 0, 0.34, 'stag'], [roamer(7, 0.8, 9, 5), 1, 0.32, 'doe'], [roamer(7, 0.9, 7, 9), 1, 0.24, 'doe']];
  // what it is doing: mid-stride every other step; standing, now and then its head goes down for a while
  const pose = (q, n) => q.moving ? (Math.floor(q.x * 2.2) % 2 ? 'walk' : null) : (0.05 * time + 0.37 * n) % 1 > 0.55 ? 'graze' : null;
  function settle() {
    if (!homes.sheep && made[core]) homes.sheep = beside(core, 5.02, 16);
    const o = ridgeNear(6.4), dr = ridgeNear(8.33);
    if (!homes.owl && o >= 0 && made[o]) {   // the pine nearest a place a little off the path
      const l = lobes[o], want = beside(o, l.apex / S + 0.3, 10); let best = null, near = 1e9;
      if (want) for (const [c, r, k, shape, olive] of l.trees) { const dist = Math.hypot(c - want[1], (r - want[2]) * 2); if (dist < near && olive == null) { near = dist; best = [o, c + 0.5, r + 1, k, TREES[shape].length]; } }
      homes.owl = best ?? [];
    }
    // the deer keep to a clearing: the widest stretch near the path, at their height, that no tree stands in
    if (!homes.deer && dr >= 0 && made[dr]) {
      const l = lobes[dr]; let best = null;
      for (const down of [0.08, 0.12, 0.16, 0.2, 0.25, 0.3]) {
        const at = beside(dr, l.apex / S + down, 0); if (!at) continue;
        const R = at[2] + 1, solid = (c) => l.crest[clamp(Math.round(c), 0, l.W - 1)] < R - 2;
        const blocked = l.trees.filter(([, r, k, shape, olive]) => r + 1 >= R - 3.4 && r + 1 - TREES[shape].length * k * 1.6 * (olive != null ? LEAF_ROW : 1) <= R + 1.4)
          .map(([c, , k, shape]) => { const half = TREES[shape][0].length * k * 1.6 / 2 + 3.4; return [c + 0.5 - half, c + 0.5 + half]; });
        if (l.mark && Math.abs(l.mark[1] - R) < 8) blocked.push([l.mark[0] - 11, l.mark[0] + 11]);   // and of the lantern, and its light
        blocked.sort((p, q) => p[0] - q[0]);
        let lo = at[1] - 28; const hi = at[1] + 28, gaps = [];
        for (const [p, q] of blocked) { if (p > lo) gaps.push([lo, Math.min(p, hi)]); lo = Math.max(lo, q); } if (lo < hi) gaps.push([lo, hi]);
        for (let [p, q] of gaps) { while (p < q && !solid(p)) p++; while (q > p && !solid(q)) q--; if (q - p > (best ? best[3] * 2 : 10)) best = [dr, (p + q) / 2, at[2], (q - p) / 2]; }
        if (best && best[3] > 9) break;
      }
      homes.deer = best ?? [];
      if (best) deer.forEach(([q], i) => { q.lim = best[3] - 1; q.from = (i - 1) * 0.55 * q.lim; q.reach = 0.5 * q.lim; q.x = q.to = q.from; });
    }
  }
  const seen = (i) => state.pose[i].on && state.pose[i].vis >= 0.3;
  // Stroke an animal, the pointer going back and forth over it, and it is pleased: small hearts rise from it. A heart is
  // one more mark on the animal's own layer, at the animal's place, so it stays with it however the page moves.
  const fond = new Map(), hearts = [], at = [0, 0];
  function stroke(key, li, c, r, reach, sx = null, sy = 0) {
    if (sx == null) place(li - LAYER.lobe, c, r, at); else { at[0] = sx; at[1] = sy; } const p = fond.get(key) ?? fond.set(key, { joy: 0, way: 0, last: 0 }).get(key);
    if (ptr.on && Math.hypot(ptr.x - at[0], ptr.y - (at[1] - 0.6 * reach)) < reach && Math.abs(ptr.vx) > 0.4) { const way = Math.sign(ptr.vx); if (p.way && way !== p.way) p.joy = Math.min(3, p.joy + 1); p.way = way; }
    p.joy = Math.max(0, p.joy - 0.6 * dt);
    if (p.joy >= 1 && time - p.last > 0.4) { p.last = time; hearts.push({ li, c, r, born: time, lean: (RA() - 0.5) * 1.2, from: (RA() - 0.5) * 1.6, size: 0.55 + 0.3 * RA() }); }
  }
  function drawHearts() {
    for (let i = hearts.length - 1; i >= 0; i--) { const h = hearts[i], age = time - h.born; if (age > 1.7) { hearts.splice(i, 1); continue; }
      on(h.li, h.c, h.r, '♥', 'heart', h.from + h.lean * age + 0.2 * Math.sin(5 * age + h.lean), -1.6 - 1.9 * age, h.size * Math.min(1, 0.4 + 2 * age), Math.min(1, 3 * age) * (1 - smooth(1, 1.7, age)), KIND.tree); }
  }
  // the clearing an animal stands in, so it reads against rock and trees: as wide and as tall as its drawing
  const clear = (li, x, y, kind, z) => { const rows = BEASTS[kind].rows; hollow(li, x, y, 0.36 * rows[0].length * z, 0.62 * rows.length * z); };
  // --- the cats by the hut: black, in pixels, each with a thin pale edge. One sits awake at the door, one sleeps beside it, one is at the leaves. ---
  const PIXEL = { k: colour('black'), e: colour('lime'), o: colour('dim') };
  const pixels = (grid) => { const h = grid.length, wd = grid[0].length, at = (x, y) => (y >= 0 && y < h && x >= 0 && x < wd ? grid[y][x] : '.'), rows = [];
    for (let y = -1; y <= h; y++) { const runs = []; for (let x = -1; x <= wd; x++) { let c = at(x, y); if (c === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => at(x + a, y + b) !== '.')) c = 'o'; if (c === '.') continue; const last = runs[runs.length - 1]; if (last && last[2] === c && last[0] + last[1] === x) last[1]++; else runs.push([x, 1, c]); } rows.push(runs); }
    return { rows, h: h + 2, w: wd }; };
  const CAT = { sit: pixels(CATS.sit), sleep: pixels(CATS.sleep), play: pixels(CATS.play) };
  // a pixel drawing with its feet at (x, y) of a layer; `shut` closes its eyes, `left` turns it round
  function sprite(li, x, y, art, px, left = false, shut = false, up = 0) {
    const pw = px / cellW, ph = px / cellH;
    art.rows.forEach((runs, j) => { for (const [x0, n, c] of runs) { const from = left ? art.w - x0 - n : x0; w.solid(x, y, (from - art.w / 2) * pw, (j - art.h + 1 - up) * ph, n * pw, 1.05 * ph, 1, PIXEL[c === 'e' && shut ? 'k' : c], 1, li, 0); } });
  }
  function drawCats() {
    if ((G - state.centreRow) * ground.k * cellH > view.h) return;
    const li = LAYER.ground, px = Math.max(1.2, typeSize / 8) / ground.k, sx = (x) => x * cellW * ground.k, sy = view.h / 2 + (G - state.centreRow) * cellH * ground.k, door = ground.hutLeft + 13.2, y = G + 0.02;
    stroke('cat0', li, door, y, 2 * typeSize, sx(door), sy); sprite(li, door, y, CAT.sit, px, false, (0.19 * time + 0.5) % 1 > 0.95);
    stroke('cat1', li, door + 3.4, y, 2 * typeSize, sx(door + 3.4), sy); sprite(li, door + 3.4, y, CAT.sleep, px);
    for (let n = 0; n < 2; n++) { const age = (0.35 * time + 0.5 * n) % 1; on(li, door + 4.6, y, 'z', 'dim', 0.3 + 0.5 * age, -1.1 - 1.1 * age, 0.45 + 0.25 * age, 1 - age); }   // it is asleep
    // the third is at the leaves, a little way off: it crouches, springs, and the leaves fly
    const play = ground.hutLeft - 7.5, beat = (0.9 * time) % 1, spring = beat < 0.3 ? Math.sin(beat / 0.3 * Math.PI) : 0;
    stroke('cat2', li, play, y, 2.2 * typeSize, sx(play), sy); sprite(li, play, y, CAT.play, px, true, false, 2.2 * spring);
    for (let n = 0; n < 4; n++) { const t = (beat + 0.23 * n) % 1, side = n % 2 ? 1 : -1; on(li, play - 1.3, y, n % 2 ? ',' : '~', n % 3 ? 'leaf' : 'leafOlive', side * (0.2 + 1.3 * t), -0.3 - 2.2 * t * (1 - t) * 2, 0.8, 1 - t); }
  }
  // --- squirrels in the pines above the hut: each keeps to one tree, at its foot or up its trunk ---
  const trees3 = homes.squirrels = { found: false, at: [] };
  function drawSquirrels() {
    const last = ridges[ridges.length - 1]; if (last == null || !made[last]) return;
    if (!trees3.found) {   // three pines on the last ridge, low down and near where the way leaves it for the hut
      const l = lobes[last], end = l.path[l.path.length - 1] ?? [l.cx, G], near = l.trees.filter(([c, r, , , olive]) => olive == null && r > G - 0.45 * S && r < G - 5 && Math.abs(c - end[0]) < 34 && Math.abs(c - end[0]) > 4).sort((p, q) => q[1] - p[1]);
      const picked = []; for (const tr of near) { if (picked.every((q) => Math.abs(q[0] - tr[0]) > 9)) picked.push(tr); if (picked.length === 3) break; }
      trees3.at = picked.map(([c, r, k, shape], n) => ({ c: c + 0.5, r: r + 1, k, tall: TREES[shape].length, side: n % 2 ? 1 : -1, n })); trees3.found = true;
    }
    if (!seen(last)) return;
    const li = LAYER.lobe + last;
    for (const q of trees3.at) {
      const turn = (0.06 * time + 0.31 * q.n) % 1, climb = turn > 0.6 ? Math.sin((turn - 0.6) / 0.4 * Math.PI) : 0, lx = q.side * (0.9 - 0.9 * climb) * q.k * 1.6, ly = -climb * 0.6 * q.tall * q.k;   // now and then up the trunk and down again
      stroke('squirrel' + q.n, li, q.c + lx, q.r + ly, 2 * typeSize); beast(li, q.c, q.r, 'squirrel', 0.29, q.side > 0, null, false, lx, ly);
    }
  }
  function drawAnimals() {
    settle();
    drawCats(); drawSquirrels();
    const s = homes.sheep, o = homes.owl, dr = homes.deer;
    if (s && seen(s[0])) { const li = LAYER.lobe + s[0], [, c, r] = s; herd.forEach(([q, dy, z, kind], n) => { wander(q); stroke('sheep' + n, li, c + q.x, r + 1 + dy, 3 * typeSize * z / 0.3); clear(li, c + q.x, r + 1 + dy, kind, z); beast(li, c + q.x, r + 1 + dy, kind, z, q.facing < 0, pose(q, n)); }); }
    if (o?.length && seen(o[0])) { const li = LAYER.lobe + o[0], [, c, r, k, tall] = o, lx = 1.3 * k, ly = -(tall - 2.4) * k; stroke('owl', li, c + lx, r + ly + 0.4, 2.2 * typeSize); hollow(li, c, r, 0.36 * 6 * 0.44, 0.62 * 4 * 0.44, lx, ly); beast(li, c, r, 'owl', 0.44, false, null, (0.31 * time + 0.2) % 1 > 0.95, lx, ly); }   // on a bough of its pine, and it grows as the pine does
    if (dr?.length && seen(dr[0])) { const li = LAYER.lobe + dr[0], [, c, r] = dr; deer.forEach(([q, dy, z, kind], n) => { wander(q); stroke('deer' + n, li, c + q.x, r + 1 + dy, 3.2 * typeSize * z / 0.34); clear(li, c + q.x, r + 1 + dy, kind, z); beast(li, c + q.x, r + 1 + dy, kind, z, q.facing < 0, pose(q, n + 5)); }); }
  }

  // One frame of everything alive. → how many instances were written
  function step(now, st) {
    time = now; dt = last < 0 ? 0.016 : clamp(now - last, 0, 0.05); last = now; top = st.top;
    const raw = dt > 0 ? (top - lastTop) / dt : 0; lastTop = top; vel += (raw - vel) * Math.min(1, 12 * dt); shove = -122 * Math.tanh(0.9 * vel / 122);
    ptr.vx = ptr.x - (ptr.was ?? ptr.x); ptr.was = ptr.x; ptr.vy = ptr.y - (ptr.wasY ?? ptr.y); ptr.wasY = ptr.y;
    ptr.on = performance.now() - ptr.at < 2500; ptr.c = ptr.x / cellW; ptr.r = ptr.y / cellH + top;
    remember();
    leanV += (-49 * lean - 7 * leanV + shove) * dt; lean += leanV * dt; if (Math.abs(lean) > 3) { lean = 3 * Math.sign(lean); leanV /= 2; }   // the field's one spring: stiffness 7, damping 0.5
    reveal = clamp((time - 0.4) / 3, 0, 1);
    if (d.stack) {   // how far the light you carry has to reach: from a light down to the edge of the card open under it
      let open = -1, most = 0.02; cards.presence.forEach((v, n) => { if (n > 0 && v > most) { most = v; open = n; } });
      const A = open >= 0 ? cards.anchor(open) : null, want = A ? clamp((A[1] - (0.495 * view.h - state.lift * cellH)) / view.h, 0.15, 0.55) : FRAME.span;
      state.span += (want - state.span) * Math.min(1, 4 * dt);
    }
    const lower = state.centre > 4.02 && state.centre < 10.6;
    w.count = 0;
    section('sky', () => { drawName(); drawLights(); drawShots(); });
    section('birds', () => { if (lower) drawFlock(); });
    section('smoke', drawSmoke);
    section('animals', () => { if (lower) drawAnimals(); });
    section('bridges', () => drawBridges(false));
    section('litBridges', () => drawBridges(true));
    section('flag', drawFlag);
    section('lamps', drawLamps);
    section('waypoints', drawWaypoints);
    section('tethers', () => { drawTethers(); drawHearts(); });
    return w.count;
  }
  const uniforms = (set) => { set.f('uHush', cards.presence[0]); set.fv4('uQuiet', cards.quiet); set.v2('uLean', 0, lean); set.fv3('uTrail', trail); };
  return { step, uniforms, bytes: new Uint8Array(buffer), ranges, planks, spots, homes, setLamps: (n) => { lamps = n; } };
}
