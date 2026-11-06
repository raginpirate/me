// Touch scrolling with gravity at the talking points.
//
// While a finger is down the page follows it 1:1. On release the glide
// keeps the finger's speed and ordinary friction, but each talking point
// ahead pulls on it: approach slowly enough and it catches you and settles
// you there, critically damped, no bounce. Approach fast and you sail
// through to the next one. Mouse wheel and trackpad are left native.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function attachGravity(scene, { enabled = () => true } = {}) {
  const html = document.documentElement;
  let points = [];
  let touch = null;       // active drag
  let glide = null;       // rAF momentum
  let moved = false;

  const refresh = () => { points = (scene.snaps || []).map((r) => r * scene.grid.cellH).sort((a, b) => a - b); };
  scene.addEventListener('built', refresh);
  refresh();

  const maxScroll = () => html.scrollHeight - innerHeight;

  function stopGlide() { if (glide) { cancelAnimationFrame(glide.raf); glide = null; } }

  function startGlide(v0) {
    stopGlide();
    const H = innerHeight;
    const R = H * 0.7;           // a well's reach
    const omega = 6;             // how firmly a well holds
    const friction = 1.7;        // per second, the ordinary glide
    const brake = 9;             // extra, inside a well you cannot escape
    let pos = scrollY, v = v0, last = performance.now(), captured = null;

    const step = (now) => {
      const dt = Math.min(0.04, (now - last) / 1000) || 0.016; last = now;
      const max = maxScroll();
      // the point ahead in the direction of travel, or the one that holds us
      let p = captured;
      if (p === null) {
        const ahead = points.filter((q) => v > 0 ? q > pos - 1 : q < pos + 1);
        p = v > 0 ? Math.min(...ahead) : Math.max(...ahead);
        if (!isFinite(p)) p = null;
      }
      const d = p === null ? Infinity : p - pos;  // signed distance to it
      const dist = Math.abs(d);
      const toward = p !== null && Math.sign(d) === Math.sign(v);

      if (captured !== null) {
        // critically damped spring onto the point: no overshoot by construction
        const x = pos - captured;
        v += (-omega * omega * x - 2 * omega * v) * dt;
      } else if (p !== null && dist < R && toward) {
        const u = Math.abs(v);
        const escape = omega * dist * 3 + 400;    // truly flying: sail through
        if (u > escape) v *= Math.exp(-friction * dt);
        else if (u > omega * dist) v *= Math.exp(-(friction + brake) * dt); // gravity bleeds speed
        else captured = p;
      } else {
        v *= Math.exp(-friction * dt);
      }

      pos += v * dt;
      if (pos <= 0 || pos >= max) { pos = clamp(pos, 0, max); v = 0; }
      scrollTo(0, pos);

      const settled = captured !== null ? Math.abs(pos - captured) < 0.5 && Math.abs(v) < 8 : Math.abs(v) < 6;
      if (settled) { if (captured !== null) scrollTo(0, captured); glide = null; return; }
      glide.raf = requestAnimationFrame(step);
    };
    glide = { raf: requestAnimationFrame(step) };
  }

  addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !enabled()) return;
    stopGlide();
    touch = { id: e.pointerId, y: e.clientY, scroll: scrollY, samples: [[performance.now(), e.clientY]] };
    moved = false;
  }, { passive: true });

  addEventListener('pointermove', (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    const dy = e.clientY - touch.y;
    if (Math.abs(dy) > 6) moved = true;
    scrollTo(0, clamp(touch.scroll - dy, 0, maxScroll()));
    touch.samples.push([performance.now(), e.clientY]);
    if (touch.samples.length > 8) touch.samples.shift();
  }, { passive: true });

  const release = (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    const s = touch.samples, now = performance.now();
    touch = null;
    // velocity over the last 40–120 ms of movement, in page px/s (finger up = page down)
    const [tl, yl] = s[s.length - 1];
    if (now - tl > 120) return; // the finger paused before lifting: no glide
    let i = s.length - 2;
    while (i > 0 && tl - s[i][0] < 40) i--;
    if (i >= 0) {
      const [t0, y0] = s[i];
      const dt = (tl - t0) / 1000;
      if (dt > 0) { const v = -(yl - y0) / dt; if (Math.abs(v) > 80) startGlide(clamp(v, -7000, 7000)); }
    }
  };
  addEventListener('pointerup', release, { passive: true });
  addEventListener('pointercancel', release, { passive: true });

  // a drag that started on a link should not also click it
  addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
}
