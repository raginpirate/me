// One glide serves every way of scrolling: a finger's release, a wheel, a trackpad. Once a gesture has let go it
// never passes the first stop ahead of it, and it only ever takes speed away.

const TOUCH = 1.7, WHEEL = 4, REACH = 0.6, NEAR = 0.15, LAND = 30, LINE = 33, NOTCH = 40, GAP = 120, COAST = 70, FLING = [80, 7000];
const KEYS = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// stops(): where a glide may come to rest, in px down the page, sorted
export function makeGlide(stops) {
  let g = null, frame = 0, last = 0, wheel = null, wheelAt = -1e9, hold = null, touch = null, swallow = false;
  const max = () => document.documentElement.scrollHeight - innerHeight;
  const halt = () => { g = null; cancelAnimationFrame(frame); frame = 0; };
  const start = (glide) => { g = glide; last = performance.now(); if (!frame) frame = requestAnimationFrame(step); };
  const tailing = () => !!wheel && wheel.falls >= 3 && wheel.size < 0.5 * wheel.peak;   // a trackpad coasting after the fingers lifted

  function aim() {
    const dir = Math.sign(g.v) || 1, near = NEAR * innerHeight, going = Math.abs(g.pos - g.from) + Math.abs(g.v) / g.friction;
    const ahead = stops().filter((s) => (s - g.pos) * dir > 0.5).sort((a, b) => (a - b) * dir);
    return !ahead.length ? null : ahead.length > 1 && Math.abs(ahead[0] - g.from) < near && going > 2 * near ? ahead[1] : ahead[0];   // a real fling leaves the stop you were at
  }

  function step(now) {
    frame = 0; if (!g) return;
    const dt = clamp((now - last) / 1000, 0, 0.04), since = performance.now() - wheelAt, dir = Math.sign(g.v) || 1; last = now;
    if (g.wheel && since <= COAST && !tailing()) g.target = undefined; else if (g.target === undefined) g.target = aim();
    let k = g.friction, landing = 0;
    if (g.target != null) { const dist = (g.target - g.pos) * dir; if (dist < REACH * innerHeight && Math.abs(g.v) > k * dist) { k = Math.abs(g.v) / Math.max(dist, 1); landing = dist; } }
    g.v *= Math.exp(-k * dt);
    if (landing > 1 && Math.abs(g.v) < LAND) g.v = dir * Math.min(LAND, 8 * landing);   // the last few pixels do not take forever
    g.pos += g.v * dt;
    if (g.target != null && (g.target - g.pos) * dir <= 0) { g.pos = g.target; g.v = 0; }
    const end = max(); if (g.pos <= 0 || g.pos >= end) { g.pos = clamp(g.pos, 0, end); g.v = 0; }
    scrollTo(0, g.pos);
    const there = g.target != null && Math.abs(g.target - g.pos) < 1;
    if (there || (Math.abs(g.v) < 6 && (!g.wheel || since > COAST))) {
      if (g.target != null && Math.abs(g.target - g.pos) < 3) { scrollTo(0, g.target); if (g.wheel) hold = { dir, floor: wheel ? wheel.size : 0, rises: 0 }; }
      g = null; return;
    }
    frame = requestAnimationFrame(step);
  }

  function onWheel(e) {
    if (e.ctrlKey) return;   // pinch-zoom is the browser's
    e.preventDefault();
    const d = e.deltaY * (e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? innerHeight : 1), size = Math.abs(d), now = performance.now(), fresh = now - wheelAt > GAP;
    wheel = fresh || !wheel ? { size, peak: size, falls: 0 } : { size, peak: Math.max(wheel.peak, size), falls: size <= wheel.size ? wheel.falls + 1 : 0 }; wheelAt = now;
    if (hold) {   // the rest of the gesture that brought the page to a stop is swallowed
      if (fresh || size >= NOTCH || Math.sign(d) !== hold.dir) hold = null;
      else if (size > 1.5 * hold.floor + 2) { if (++hold.rises >= 2) hold = null; }
      else { hold.rises = 0; hold.floor = Math.min(hold.floor, size); }
      if (hold) return;
    }
    if (!g || !g.wheel) start({ pos: scrollY, v: 0, friction: WHEEL, from: scrollY, target: undefined, wheel: true });
    if (fresh || d * g.v < 0) { g.from = g.pos; g.target = undefined; }
    g.v += d * WHEEL;   // with this friction the pushes add up to exactly the distance asked
  }

  function onDown(e) {
    halt(); swallow = false;
    touch = e.pointerType === 'touch' && !touch ? { id: e.pointerId, y0: e.clientY, from: scrollY, samples: [[e.timeStamp, e.clientY]], drag: false } : null;   // a second finger is a pinch: the browser's
  }
  function onMove(e) {
    if (!touch || e.pointerId !== touch.id) return;
    scrollTo(0, clamp(touch.from - (e.clientY - touch.y0), 0, max()));
    for (const c of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) touch.samples.push([c.timeStamp, c.clientY]);
    if (touch.samples.length > 24) touch.samples.splice(0, touch.samples.length - 24);
    if (Math.abs(e.clientY - touch.y0) > 6) touch.drag = true;
  }
  function onUp(e) {
    if (!touch || e.pointerId !== touch.id) return;
    const { samples, from, y0, drag } = touch, [tLast, yLast] = samples[samples.length - 1]; touch = null; swallow = drag;
    if (e.timeStamp - tLast > GAP) return;   // the finger paused
    const recent = samples.filter(([t]) => tLast - t <= 100); if (recent.length < 2) return;
    let st = 0, sy = 0, stt = 0, sty = 0; for (const [t, y] of recent) { const x = t - tLast; st += x; sy += y; stt += x * x; sty += x * y; }
    const n = recent.length, den = n * stt - st * st; if (!den) return;
    const v = -(n * sty - st * sy) / den * 1000, whole = -(yLast - y0);   // px/s down the page, from a line fitted through the last tenth of a second
    if ((v * whole < 0 && Math.abs(whole) > 20) || Math.abs(v) <= FLING[0]) return;   // a waver, or too slow to mean it
    start({ pos: scrollY, v: clamp(v, -FLING[1], FLING[1]), friction: TOUCH, from, target: undefined, wheel: false });
  }
  const onClick = (e) => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } };   // a drag that began on a link does not open it
  const onKey = (e) => { if (KEYS.includes(e.key)) halt(); };

  const wires = [['wheel', onWheel, { passive: false }], ['pointerdown', onDown, { passive: true }], ['pointermove', onMove, { passive: true }], ['pointerup', onUp, { passive: true }], ['pointercancel', onUp, { passive: true }], ['click', onClick, { capture: true }], ['keydown', onKey, { passive: true }]];
  return {
    on() { for (const [name, fn, opt] of wires) addEventListener(name, fn, opt); },
    off() { halt(); for (const [name, fn, opt] of wires) removeEventListener(name, fn, opt); },
    go(y, smoothly) { halt(); scrollTo({ top: y, behavior: smoothly ? 'smooth' : 'instant' }); },
  };
}
