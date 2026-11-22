// The cards: each opens while the page is in its stop's band, beside the light it belongs to.

import { smooth } from './math.js';
import { CARD, LAYOUT } from './art.js';

export function makeCards(model, view, go) {
  const { stops, dims: d } = model, els = stops.map((s) => s.band ? document.getElementById(s.id) : null), n = stops.length;
  const presence = new Float32Array(n), glow = new Float32Array(n), shown = new Array(n).fill(''), quiet = new Float32Array(24), rects = stops.map(() => null), fade = CARD.fade / LAYOUT.measure;
  let spots = null, over = false;
  els.forEach((el, i) => { if (el && stops[i].side) el.dataset.side = stops[i].side; });

  // the boxes the stars keep clear of (one a line of the tagline, one for "scroll" and its dots), and where each card is
  function measure() {
    quiet.fill(0); let k = 0;
    const sky = els[0], tag = sky?.querySelector('.tag'), hint = sky?.querySelector('.hint'), box = (r, extra = 0) => { if (k < 24 && r.width) { quiet.set([(r.left + view.ox) * view.dpr, r.top * view.dpr, (r.right + view.ox) * view.dpr, (r.bottom + extra) * view.dpr], k); k += 4; } };
    if (tag) { const range = document.createRange(), seen = []; range.selectNodeContents(tag); for (const r of range.getClientRects()) { const line = seen.find((s) => Math.abs(s.top - r.top) < 4); if (line) { line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right); line.width = line.right - line.left; } else seen.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }); } seen.forEach((r) => box(r)); }
    if (hint) { const range = document.createRange(); range.selectNodeContents(hint); const r = range.getBoundingClientRect(); box(r, hint.getBoundingClientRect().bottom - r.bottom); }
    els.forEach((el, i) => { rects[i] = el ? el.getBoundingClientRect() : null; });
  }
  const watch = new ResizeObserver(measure); els.forEach((el) => el && watch.observe(el));
  addEventListener('resize', measure); visualViewport?.addEventListener('resize', measure);

  // where a light's tether meets its card (viewport px)
  const point = [0, 0];
  function anchor(i) {
    const r = rects[i]; if (!r) return null;
    if (d.stack) { point[0] = (r.left + r.right) / 2; point[1] = r.top - 4; } else { point[0] = stops[i].side === 'left' ? r.right + 4 : r.left - 4; point[1] = r.top + Math.min(0.3 * r.height, 40); }
    point[0] += view.ox; return point;   // in the scene's px
  }

  function frame(t, dt, lights) {
    spots = lights;
    stops.forEach((s, i) => {
      if (!s.band) return;
      const [a, b] = s.band, w = Math.min(fade, (b - a) / 3), p = presence[i] = (a <= 0 ? 1 : smooth(a, a + w, t)) * (b >= 1 ? 1 : 1 - smooth(b - w, b, t));
      glow[i] += (p - glow[i]) * Math.min(1, 5 * dt);
      const text = p.toFixed(3); if (text !== shown[i]) { shown[i] = text; els[i].style.opacity = text; els[i].style.pointerEvents = p > 0.5 ? 'auto' : 'none'; }
    });
  }

  // a light is something to press: it takes you to its stop
  const lightAt = (x, y) => { if (!spots) return -1; let best = -1, near = 22; spots.forEach(([sx, sy], i) => { const dist = Math.hypot(sx - x, sy - y); if (dist < near) { near = dist; best = i; } }); return best; };
  const click = (e) => { if (e.target.closest('a, button, .card')) return; const i = lightAt(e.clientX + view.ox, e.clientY); if (i >= 0) go(stops[i].snap * d.cellH, true); };
  const hover = (e) => { const now = e.pointerType === 'mouse' && !e.target.closest('a, button, .card') && lightAt(e.clientX + view.ox, e.clientY) >= 0; if (now !== over) { over = now; document.documentElement.style.cursor = now ? 'pointer' : ''; } };
  const focus = (e) => { const i = els.indexOf(e.target.closest?.('.card')); if (i >= 0 && presence[i] < 0.5) go(stops[i].snap * d.cellH, false); };   // tabbing walks the mountain
  addEventListener('click', click); addEventListener('pointermove', hover, { passive: true }); addEventListener('focusin', focus);

  function stop() {
    watch.disconnect(); removeEventListener('resize', measure); visualViewport?.removeEventListener('resize', measure);
    removeEventListener('click', click); removeEventListener('pointermove', hover); removeEventListener('focusin', focus);
    document.documentElement.style.cursor = ''; els.forEach((el) => { if (el) { el.style.opacity = ''; el.style.pointerEvents = ''; } });
  }
  measure();
  return { presence, glow, quiet, anchor, frame, measure, stop };
}
