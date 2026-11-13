// The page. It is a text document first; this turns it into the mountain
// and back, and ties each card to its stop in the scene.

import './ascii.js';
import './gh-activity.js';
import { attachGravity } from './gravity.js';

const html = document.documentElement;
const scene = document.querySelector('ascii-scene');
const mode = document.querySelector('.mode');
const cards = new Map([...document.querySelectorAll('.card')].map((c) => [c.id, c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- text or mountain ----------
// The inline script in the head already chose (is-scene on <html>), so the
// first paint is right. If the scene cannot be built, the text stays.
let plain = true;
function show(asText) {
  if (!asText) {
    html.classList.add('is-scene');
    if (!scene.start()) { asText = true; mode.hidden = true; }
  }
  plain = asText;
  html.classList.toggle('is-scene', !asText);
  mode.textContent = asText ? 'mountain' : 'text version';
  if (asText) {
    scene.pause?.();
    for (const c of cards.values()) { c.style.opacity = ''; c.style.pointerEvents = ''; }
    shown.clear();
  } else scene.resume();
}
mode.addEventListener('click', () => {
  show(!plain);
  try { localStorage.setItem('mode', plain ? 'plain' : 'scene'); } catch { /* no storage */ }
});

// ---------- going to a stop ----------
function go(stop, smoothly) {
  scrollTo({ top: stop.snap * scene.grid.cellH, behavior: smoothly && !reduced.matches ? 'smooth' : 'auto' });
}

// ---------- when the scene is laid out ----------
// Each light gets a tap target, and its card takes the side away from it.
const hits = document.createElement('div');
hits.className = 'hits';
scene.after(hits);
const buttons = new Map();

scene.addEventListener('built', () => {
  for (const s of scene.lights) {
    const card = cards.get(s.id);
    card.dataset.side = s.side;
    if (!buttons.has(s.id)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', card.querySelector('h2').textContent);
      b.addEventListener('click', () => go(scene.stops.find((x) => x.id === s.id), true));
      hits.appendChild(b);
      buttons.set(s.id, b);
    }
  }
  measure();
});

// where each thread ends: the top of a stacked card, the near side of a side card
function measure() {
  if (plain || !scene.lights) return;
  for (const s of scene.lights) {
    const r = cards.get(s.id).getBoundingClientRect();
    s.target = scene.stack ? [r.left + r.width / 2, r.top - 4] : [s.side === 'left' ? r.right + 4 : r.left - 4, r.top + Math.min(r.height * 0.3, 40)];
  }
  scene.dirty = true;
}
const watch = new ResizeObserver(measure);
for (const c of cards.values()) watch.observe(c);
addEventListener('resize', measure);
visualViewport?.addEventListener('resize', measure);

// ---------- when the scene moves ----------
// A card is as open as its stop; only what changed is written.
const shown = new Map();
scene.addEventListener('moved', () => {
  for (const s of scene.stops) {
    const card = cards.get(s.id);
    if (!card) continue;
    const v = scene.presence(s).toFixed(3);
    if (shown.get(s.id) === v) continue;
    shown.set(s.id, v);
    card.style.opacity = v;
    card.style.pointerEvents = v > 0.5 ? 'auto' : 'none';
  }
  for (const s of scene.lights) {
    const [x, y] = scene.where(s), b = buttons.get(s.id);
    const off = y < -30 || y > innerHeight + 30;
    b.hidden = off;
    if (!off) b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
});

// Tabbing into a card that is not open goes to its stop, so the keyboard
// walks the mountain too.
for (const [id, card] of cards) {
  card.addEventListener('focusin', () => {
    if (plain) return;
    const stop = scene.stops.find((s) => s.id === id);
    if (stop && scene.presence(stop) < 0.5) go(stop, false);
  });
}

// ---------- touch: brake at the stops ----------
attachGravity(scene, { enabled: () => !plain });

mode.hidden = false;
show(!html.classList.contains('is-scene'));
