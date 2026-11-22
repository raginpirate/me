// What is alive this frame: the name, the lights, shooting stars, bridges, lamps, waypoints, and what lives on the
// way down. Each frame it writes them, in drawing order, into one buffer of instances.

import { clamp, smooth, mix, twinkle, mulberry32 } from './math.js';
import { BYTES, KIND, INK, HOT, DISC, BARE, FREE, TRAIL, SOFT_Y, writer } from './glsl.js';
import { LAYER, colour } from './pack.js';
import { TREES, FRAME } from './art.js';

const SPRING = { star: [7, 0.5, 3, 5, 2.5, 1], light: [12, 0.6, 1.2, 5, 0.5, 0.6], dot: [7, 0.5, 5, 5, 2.5, 1] };   // stiffness, damping, furthest, push radius, push, share of the shove
const MARKS = {   // what stands at a waypoint: [glyph, dx, dy, size] and its colour
  axe: [[['|', -0.7, 0.45, 1], ['T', -0.7, -0.4, 1]], 'rockLight'], cairn: [[['O', -0.78, 0.3, 1.1], ['o', -0.82, -0.38, 0.9], ['o', -0.76, -0.95, 0.6]], 'rockLight'],
  post: [[['|', -0.75, 0.5, 1], ['|', -0.75, -0.35, 1], ['-', -0.4, -0.95, 1]], 'wood'], hut: [[], 'wood'],
};
// The animals, drawn at half the type's size so each has twice the detail: rows of type, facing right. `walk` is the
// last rows on the other foot. Each kind has its ground on the mountain and keeps within it.
const BEASTS = {
  stag: { tint: 'timber', rows: ['           \\ |/ /  ', '            \\|//   ', '            ,##.   ', "   .########%##'-  ", "  /##########%'    ", "  '#%%%%%%%##'     ", '   # #     # #     ', "   # '     ' #     "], walk: ['   # #     # #     ', "   ' #     # '     "] },
  doe: { tint: 'timber', rows: ['            ,/     ', '            ##.    ', "   .#######%##'-   ", "  '##########'     ", "   #%%%%%%##'      ", '   # #    # #      ', "   # '    ' #      "], walk: ['   # #    # #      ', "   ' #    # '      "] },
  ram: { tint: 'snow', rows: ['           _.   ', '   ,######(C#>  ', "  (#########'   ", '   %#######%    ', '   # #   # #    ', "   # '   ' #    "], walk: ['   # #   # #    ', "   ' #   # '    "] },
  lamb: { tint: 'snow', rows: ['       ,.  ', '  ,####(#> ', "  '#####'  ", '   # # #   '], walk: ["   ' # '   "] },
  squirrel: { tint: 'leaf', rows: [' .##.     ', '(####  ,o.', " '##\\.###>", "   '#####'", '    "  "  '], walk: ['    /  \\  '] },
  owl: { tint: 'timber', eyes: 'o', rows: ['  ^ ^  ', ' (o,o) ', ' {###} ', ' {###} ', '  " "  '] },
};
const TURNED = { '/': '\\', '\\': '/', '(': ')', ')': '(', '<': '>', '>': '<', '{': '}', '}': '{' }, SOFT = { '%': 0.7, '"': 0.8 };
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
  const on = (li, x, y, ch, name, dx, dy, size, alpha) => { if (alpha > 0.004 && w.count < ROOM - 8) w.put(x, y, dx * typeSize / cellW / size, dy * typeSize / cellH / size, 0, 0, size, g(ch), colour(name), Math.min(1, alpha), li, 0, INK | BARE); };
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
  const flagAt = stops.findIndex((q) => q.mark === 'flag');
  function drawFlag() {
    const x = (d.topCol + 0.5) * cellW, y = (Math.ceil(d.summitRow) - top) * cellH, fu = 1.7 * typeSize, wave = Math.sin(3.2 * time);
    if (flagAt >= 0) { spots[flagAt][0] = x + 0.6 * fu; spots[flagAt][1] = y < -4 * fu || y > view.h + fu ? -1e4 : y - 2.5 * fu; }
    if (y < -4 * fu || y > view.h + fu) return;
    for (const up of [0.45, 1.4, 2.3]) ink('|', 'rockLight', x, y - up * fu, 1.3 * fu, 1);
    ink('o', 'ember', x + 0.6 * fu, y - 2.5 * fu, 2.6 * fu, 0.12); ink(wave > 0.3 ? '}' : '>', 'ember', x + (0.58 + 0.05 * wave) * fu, y - 2.5 * fu, 1.45 * fu, 1);
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
  function drawWaypoints() {
    stops.forEach((s, n) => {
      if (!s.mark || s.mark === 'flag') return;
      const hut = s.lobe == null, li = hut ? LAYER.ground : LAYER.lobe + s.lobe, [parts, tint] = MARKS[s.mark], lit = cards.glow[n], live = lit * twinkle(time, n, 0.6, 2.4);
      let x, y;
      if (hut) { x = ground.window[0]; y = G + 1 + ground.window[1]; spots[n][0] = x * cellW * ground.k; spots[n][1] = view.h / 2 + (y - state.centreRow) * cellH * ground.k; }
      else { const p = state.pose[s.lobe]; [x, y] = lobes[s.lobe].mark; place(s.lobe, x, y, P); spots[n][0] = P[0]; spots[n][1] = p.on && p.vis >= 0.05 ? P[1] : -1e4; if (spots[n][1] < -1e3) return; }
      if (spots[n][1] < -80 || spots[n][1] > view.h + 80) return;
      if (!hut) { const rx = 2.6 * typeSize / cellW, ry = 2.6 * typeSize / cellH; w.solid(x, y, -rx, -ry, 2 * rx, 2 * ry, 1, SKY, 1, li, DISC); }   // a small hollow, so it reads against rock and trees
      for (const [ch, dx, dy, k] of parts) on(li, x, y, ch, tint, dx, dy, k, 1);
      on(li, x, y, 'o', 'ember', 0, 0, 1.9, 0.1 + 0.2 * live);
      if (hut) { w.put(x - 1, y - 0.5, 0, 0, 0, 0, 1, g('['), colour('emberHot'), live, li); w.put(x, y - 0.5, 0, 0, 0, 0, 1, g(']'), colour('emberHot'), live, li); }   // the window lights up
      else { on(li, x, y, 'o', 'ember', 0, 0, 0.85, 1); on(li, x, y, 'o', 'emberHot', 0, 0, 0.85, lit); }
      if (lit > 0.05) for (const [a, b] of [[1.25, 0], [-1.25, 0], [0, 1.25], [0, -1.25]]) on(li, x, y, '·', 'ember', a, b, 1, 0.8 * live);
    });
  }

  // --- smoke from the hut's chimney ---
  function drawSmoke() {
    if ((G - 20 - state.centreRow) * ground.k > S / 2) return;
    for (let i = 0; i < 4; i++) { const tt = (0.22 * time + i / 4) % 1; on(LAYER.ground, ground.chimney[0], G + 1 + ground.chimney[1], tt < 0.3 ? '.' : tt < 0.65 ? 'o' : 'O', 'dim', 0.5 * Math.sin(5 * tt + i) + 1.6 * tt, -3.4 * tt, 0.6 + 0.9 * tt, 0.75 * (1 - tt) ** 1.2); }
  }

  // --- the animals. Each family has its ground: a height it keeps to and a stretch it wanders along. The owl just sits. ---
  // birds work back and forth by the peak's shoulder, where the clouds begin
  const flock = Array.from({ length: 7 }, (_, i) => { const j = Math.ceil(i / 2), side = i % 2 ? 1 : -0.8; return [-(1.5 * j + (RA() - 0.5) * 0.6), side * j * 0.42 + (RA() - 0.5) * 0.2, RA() * 6.28]; });
  const roost = (() => { const r = Math.round(4.3 * S), span = model.peak.span[r] ?? model.peak.span[model.peak.span.length - 1]; return [span[1] + 16, r]; })();
  function drawBirds() {
    const y0 = (roost[1] - top) * cellH; if (y0 < -8 * cellH || y0 > view.h + 8 * cellH) return;
    const sway = Math.sin(0.11 * time), heading = Math.tanh(4 * Math.cos(0.11 * time)), x0 = (roost[0] + 11 * sway) * cellW, rise = (1.6 * Math.sin(0.22 * time + 1) + 0.5 * Math.sin(0.5 * time)) * cellH, size = 0.62 * typeSize;
    for (const [dx, dy, phase] of flock) ink(Math.sin(5.5 * time + phase) > 0.1 ? 'v' : '-', 'bird', x0 + heading * dx * size, y0 + rise + (dy + 0.12 * Math.sin(1.1 * time + phase)) * size * 1.6, size, 0.75);
  }
  // a beast with its feet at (x, y) of a layer, each character half the type's size times k
  function beast(li, x, y, name, k, left = false, stepping = false, shut = false) {
    const b = BEASTS[name], rows = stepping && b.walk ? [...b.rows.slice(0, b.rows.length - b.walk.length), ...b.walk] : b.rows, n = rows[0].length, z = 0.5 * k;
    rows.forEach((text, i) => { for (let j = 0; j < n; j++) {
      let ch = text[left ? n - 1 - j : j]; if (!ch || ch === ' ') continue; if (left) ch = TURNED[ch] ?? ch;
      const eye = ch === b.eyes; on(li, x, y, eye && shut ? '-' : ch, eye ? 'ember' : b.tint, (j - (n - 1) / 2) * 0.6 * z, (i - rows.length + 0.5) * z, z, SOFT[ch] ?? 1);
    } });
  }
  const hollow = (li, x, y, rx, ry) => w.solid(x, y, -rx * typeSize / cellW, -1.7 * ry * typeSize / cellH, 2 * rx * typeSize / cellW, 2 * ry * typeSize / cellH, 1, SKY, 1, li, DISC);
  // one that wanders: it stands a while, picks somewhere within its stretch, walks there
  const roamer = (reach, pace, rest, from = 0) => ({ x: from, to: from, facing: RA() < 0.5 ? 1 : -1, wait: 1 + rest * RA(), reach, pace, rest, from, moving: false });
  function wander(q) {
    q.moving = false;
    if (q.wait > 0) { q.wait -= dt; if (q.wait <= 0) q.to = q.from + (RA() * 2 - 1) * q.reach; return; }
    const gap = q.to - q.x, stride = q.pace * dt; if (Math.abs(gap) <= stride) { q.x = q.to; q.wait = q.rest * (0.5 + RA()); return; }
    q.facing = Math.sign(gap); q.x += q.facing * stride; q.moving = true;
  }
  const follow = (q, lead, back) => { const want = lead.x - lead.facing * back, gap = want - q.x; q.moving = Math.abs(gap) > 0.6; if (q.moving) { q.facing = Math.sign(gap); q.x += q.facing * Math.min(Math.abs(gap), q.pace * dt); } };
  const stepping = (q) => q.moving && Math.floor(q.x * 1.4) % 2 === 0;
  // where each family's ground is, found once its ridge is made: [lobe, column, row]
  const core = lobes.findIndex((l) => l.kind === 'core'), ridges = lobes.map((l, i) => i).filter((i) => lobes[i].kind === 'route');
  const beside = (i, screens, aside) => { const l = lobes[i], r = Math.round(screens * S), at = l.path.find(([, pr]) => pr >= r); return at ? [i, at[0] + aside, r] : null; };
  const ridgeNear = (screens) => ridges.reduce((best, i) => best < 0 || Math.abs(lobes[i].apex / S - screens) < Math.abs(lobes[best].apex / S - screens) ? i : best, -1);
  const homes = { sheep: null, owl: null, deer: null };
  const ram = roamer(7, 0.9, 9), lamb = { x: -5, facing: 1, pace: 1.6, moving: false }, stag = roamer(12, 1.3, 11), doe = roamer(10, 1.3, 8, 7);
  const squirrels = [roamer(6, 7, 3.5, -13), roamer(5, 7, 5, 20), roamer(0, 0, 9, -3.5)];
  function settle() {
    if (!homes.sheep && made[core]) homes.sheep = beside(core, 5.02, 16);
    const o = ridgeNear(6.4), dr = ridgeNear(8.33);
    if (!homes.owl && o >= 0 && made[o]) {   // the pine nearest a place a little off the path
      const l = lobes[o], want = beside(o, l.apex / S + 0.3, 10); let best = null, near = 1e9;
      if (want) for (const [c, r, k, shape, olive] of l.trees) { const dist = Math.hypot(c - want[1], (r - want[2]) * 2); if (dist < near && olive == null) { near = dist; best = [o, c + 0.5, r + 1 - TREES[shape].length * k, k]; } }
      homes.owl = best ?? [];
    }
    if (!homes.deer && dr >= 0 && made[dr]) homes.deer = beside(dr, lobes[dr].apex / S + 0.22, 18) ?? [];
  }
  const seen = (i) => state.pose[i].on && state.pose[i].vis >= 0.3;
  function drawAnimals() {
    settle();
    const s = homes.sheep, o = homes.owl, dr = homes.deer;
    if (s && seen(s[0])) { const li = LAYER.lobe + s[0], [, c, r] = s; wander(ram); follow(lamb, ram, 6);
      hollow(li, c + ram.x, r + 1, 5, 2.4); hollow(li, c + lamb.x, r + 1, 3.2, 1.7);
      beast(li, c + ram.x, r + 1, 'ram', 1.15, ram.facing < 0, stepping(ram)); beast(li, c + lamb.x, r + 1, 'lamb', 1, lamb.facing < 0, stepping(lamb)); }
    if (o?.length && seen(o[0])) { const li = LAYER.lobe + o[0], [, c, r, k] = o; beast(li, c, r + 0.35, 'owl', 1.25 * k, false, false, (0.31 * time + 0.2) % 1 > 0.95); }
    if (dr?.length && seen(dr[0])) { const li = LAYER.lobe + dr[0], [, c, r] = dr; wander(stag); wander(doe);
      hollow(li, c + stag.x, r + 1, 6, 3.2); hollow(li, c + doe.x, r + 1, 6, 2.8);
      beast(li, c + stag.x, r + 1, 'stag', 1.2, stag.facing < 0, stepping(stag)); beast(li, c + doe.x, r + 1, 'doe', 1.1, doe.facing < 0, stepping(doe)); }
    // squirrels about the hut: two that dart about, one that stays by the door
    if ((G - state.centreRow) * ground.k * cellH < view.h) for (const q of squirrels) { wander(q); beast(LAYER.ground, ground.hutLeft + q.x, G + 0.2, 'squirrel', 0.8, q.facing < 0, stepping(q)); }
  }

  // One frame of everything alive. → how many instances were written
  function step(now, st) {
    time = now; dt = last < 0 ? 0.016 : clamp(now - last, 0, 0.05); last = now; top = st.top;
    const raw = dt > 0 ? (top - lastTop) / dt : 0; lastTop = top; vel += (raw - vel) * Math.min(1, 12 * dt); shove = -122 * Math.tanh(0.9 * vel / 122);
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
    section('birds', drawBirds);
    section('smoke', drawSmoke);
    section('animals', () => { if (lower) drawAnimals(); });
    section('bridges', () => drawBridges(false));
    section('litBridges', () => drawBridges(true));
    section('flag', drawFlag);
    section('lamps', drawLamps);
    section('waypoints', drawWaypoints);
    section('tethers', drawTethers);
    return w.count;
  }
  const uniforms = (set) => { set.f('uHush', cards.presence[0]); set.fv4('uQuiet', cards.quiet); set.v2('uLean', 0, lean); set.fv3('uTrail', trail); };
  return { step, uniforms, bytes: new Uint8Array(buffer), ranges, planks, spots, setLamps: (n) => { lamps = n; } };
}
