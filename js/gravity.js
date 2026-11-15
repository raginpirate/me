// Gliding between the stops.
//
// One glide serves every way of scrolling.
//  - A finger drags the page 1:1. On release the glide keeps its speed.
//  - A wheel or trackpad feeds the same glide, so a desktop scroll runs out
//    smoothly like a swipe instead of stepping. Over a whole gesture the
//    page still travels as far as the wheel asked.
//
// Once a gesture has let go, the glide never passes the first stop ahead of
// it. Out of reach of that stop it slows with ordinary friction; within
// reach it brakes harder, just enough to run out exactly there. It only
// ever takes speed away: nothing pulls the page toward a stop it would not
// have reached, and nothing slows a scroll that is still being held.

import { clamp } from './util.js';
import { D } from './direction.js';

export function attachGravity(scene, { enabled = () => true } = {}) {
  const html = document.documentElement, G = D.glide;
  let points = [];
  scene.addEventListener('built', () => { points = scene.stops.map((p) => p.snap * scene.grid.cellH).sort((a, b) => a - b); });
  const maxScroll = () => html.scrollHeight - innerHeight;

  // ---------- the glide ----------
  let glide = null; // { pos, v, friction, from, target, wheel, last, raf }
  const halt = () => { if (glide) { cancelAnimationFrame(glide.raf); glide = null; } };
  // from: where the gesture began (where the finger went down, or the wheel first turned)
  function start(v, friction, wheel, from = scrollY) {
    halt();
    glide = { pos: scrollY, v, friction, from, target: null, wheel, last: performance.now() };
    glide.raf = requestAnimationFrame(step);
  }

  // The stop this glide may not pass: the first one ahead. If that one is
  // only a step from where the gesture began, it is the stop you were at,
  // and a real fling is going on to the next; a nudge still settles on it.
  function aim(g) {
    const dir = Math.sign(g.v) || 1, near = innerHeight * G.near;
    const going = Math.abs(g.pos - g.from) + Math.abs(g.v) / g.friction; // how far this gesture means to go
    const ahead = points.filter((q) => (q - g.pos) * dir > 0.5).sort((a, b) => (a - b) * dir);
    if (!ahead.length) return null;
    return ahead.length > 1 && Math.abs(ahead[0] - g.from) < near && going > 2 * near ? ahead[1] : ahead[0];
  }

  function step(now) {
    const g = glide;
    // A frame's time can be from before the glide began (it is when the frame started, and the glide may have
    // begun later in it): a step back in time would move the page backwards, against the swipe. Never less than none.
    const dt = clamp((now - g.last) / 1000, 0, 0.04); g.last = Math.max(g.last, now);
    const dir = Math.sign(g.v) || 1, u = Math.abs(g.v), max = maxScroll();
    // a wheel still turning is a hand still on the page: no braking until it
    // lets go. Once it has, the stop ahead is chosen and kept.
    const letGo = !g.wheel || now - wheel.last > G.coast || tailing();
    if (!letGo) g.target = null;
    else if (g.target === null) g.target = aim(g);
    let k = g.friction, landing = 0;
    if (g.target !== null) {
      const dist = (g.target - g.pos) * dir;
      // brake so the glide runs out exactly at the stop: never a push, only less speed
      if (dist < innerHeight * G.reach && u > k * dist) { k = u / Math.max(dist, 1); landing = dist; }
    }
    g.v *= Math.exp(-k * dt);
    // a braked glide was always going to get there; do not let its last few pixels take forever
    if (landing > 1 && Math.abs(g.v) < G.land) g.v = dir * Math.min(G.land, landing * 8);
    g.pos += g.v * dt;
    if (g.target !== null && (g.target - g.pos) * dir < 0) { g.pos = g.target; g.v = 0; } // never past it
    if (g.pos <= 0 || g.pos >= max) { g.pos = clamp(g.pos, 0, max); g.v = 0; }
    scrollTo(0, g.pos);

    const there = g.target !== null && Math.abs(g.target - g.pos) < 1;
    if (there || (Math.abs(g.v) < 6 && (!g.wheel || now - wheel.last > G.coast))) {
      if (there || (g.target !== null && Math.abs(g.target - g.pos) < 3)) {
        scrollTo(0, g.target);
        // what is left of the gesture that brought it here is spent
        if (g.wheel) hold = { dir, floor: wheel.size, rises: 0 };
      }
      glide = null;
      return;
    }
    g.raf = requestAnimationFrame(step);
  }

  // ---------- touch ----------
  let touch = null, moved = false;
  addEventListener('pointerdown', (e) => {
    halt(); // any press takes the page back
    if (e.pointerType !== 'touch' || !enabled()) return;
    touch = { id: e.pointerId, y: e.clientY, scroll: scrollY, samples: [[e.timeStamp, e.clientY]] };
    moved = false;
  }, { passive: true });

  addEventListener('pointermove', (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    const dy = e.clientY - touch.y;
    if (Math.abs(dy) > 6) moved = true;
    scrollTo(0, clamp(touch.scroll - dy, 0, maxScroll()));
    // every movement the finger made, at the time it made it: a slow frame delivers several at once
    for (const p of e.getCoalescedEvents?.() || [e]) touch.samples.push([p.timeStamp, p.clientY]);
    while (touch.samples.length > 24) touch.samples.shift();
  }, { passive: true });

  const release = (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    const s = touch.samples, from = touch.scroll;
    touch = null;
    // The speed the finger left with: a straight line fitted through where it was over its last 100 ms, by
    // the times it was there, in page px/s (finger up = page down). A fit is not thrown by one late or jittery
    // sample, and a finger that wavers back as it lifts does not fling the page the wrong way.
    const tl = s[s.length - 1][0];
    if (e.timeStamp - tl > 120) return; // the finger paused before lifting: no glide
    const pts = s.filter(([t]) => tl - t <= 100);
    if (pts.length < 2) return;
    const mt = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    let num = 0, den = 0; for (const [t, y] of pts) { num += (t - mt) * (y - my); den += (t - mt) ** 2; }
    if (den <= 0) return;
    const v = -num / den * 1000, whole = from - scrollY;
    if (Math.sign(v) !== Math.sign(-whole) && Math.abs(whole) > 20) return;   // against the way the whole drag went: a waver, not a fling
    if (Math.abs(v) > G.fling[0]) start(clamp(v, -G.fling[1], G.fling[1]), G.touch, false, from);
  };
  addEventListener('pointerup', release, { passive: true });
  addEventListener('pointercancel', release, { passive: true });

  // a drag that started on a link should not also click it
  addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);

  // ---------- wheel and trackpad ----------
  // The browser says nothing about fingers lifting, so the gesture is read
  // from the steps themselves: silence, or steps dying away (a trackpad
  // coasting after the fingers lift), means it has let go.
  let wheel = { last: 0, size: 0, peak: 0, falls: 0 };
  const tailing = () => wheel.falls >= 3 && wheel.size < wheel.peak * 0.5;
  let hold = null; // settled on a stop: the rest of the gesture that brought it there is swallowed

  addEventListener('wheel', (e) => {
    if (!enabled() || e.ctrlKey) return; // the text version, and pinch-zoom, are the browser's
    e.preventDefault();
    const d = e.deltaY * (e.deltaMode === 1 ? G.line : e.deltaMode === 2 ? innerHeight : 1);
    if (!d) return;
    const now = performance.now(), size = Math.abs(d), fresh = now - wheel.last > G.gap; // fresh: a new gesture
    wheel = fresh ? { last: now, size, peak: size, falls: 0 } : { last: now, size, peak: Math.max(wheel.peak, size), falls: size <= wheel.size ? wheel.falls + 1 : 0 };
    if (hold) {
      // released by a new gesture, a turn the other way, a mouse wheel's step, or steps that start growing again
      if (fresh || size >= G.notch || Math.sign(d) !== hold.dir) hold = null;
      else if (size > hold.floor * 1.5 + 2) { if (++hold.rises >= 2) hold = null; }
      else { hold.rises = 0; hold.floor = Math.min(hold.floor, size); }
      if (hold) return;
    }
    if (!glide || !glide.wheel) start(0, G.wheel, true);
    if (fresh || (glide.v && Math.sign(d) !== Math.sign(glide.v))) { glide.from = glide.pos; glide.target = null; } // a gesture begins here
    // each step is a push; with this friction the pushes add up to exactly the distance asked
    glide.v += d * G.wheel;
  }, { passive: false });

  // the keyboard scrolls natively: get out of its way
  addEventListener('keydown', (e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) halt(); });

  return { halt };
}
