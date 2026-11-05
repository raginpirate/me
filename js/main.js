import { BANDS } from './scene.js';
import './gh-activity.js';

const html = document.documentElement;
const scene = document.querySelector('ascent-scene');
const cards = [...document.querySelectorAll('.card')];
const tether = document.querySelector('.tether line');
const hits = [...document.querySelectorAll('.hits button')];
const rail = [...document.querySelectorAll('.rail a')];
const mode = document.querySelector('.mode');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// each card's scroll band
function bandFor(card) {
  const i = Number(card.dataset.index || 0);
  switch (card.dataset.kind) {
    case 'name': return [BANDS.name[0], 0.14];
    case 'star': return BANDS.stars[i];
    case 'climb': return BANDS.climb;
    case 'slope': return BANDS.slopes[i];
    case 'roots': return BANDS.roots;
  }
  return [0, 0];
}
const bands = new Map(cards.map((c) => [c, bandFor(c)]));
const railBands = { name: BANDS.name, stars: BANDS.stars[0], climb: BANDS.climb, slopes: BANDS.slopes[0], roots: BANDS.roots };

// ---------- plain mode: a normal page, no scene ----------
let plain = false;
function setPlain(on) {
  plain = on;
  html.classList.toggle('is-plain', on);
  mode.textContent = on ? mode.dataset.scene : mode.dataset.plain;
  mode.setAttribute('aria-pressed', String(on));
  if (on) scene.pause?.(); else scene.resume?.();
  try { localStorage.setItem('mode', on ? 'plain' : 'scene'); } catch { /* ignore */ }
  for (const c of cards) { c.style.opacity = ''; c.style.transform = ''; c.style.visibility = ''; c.style.pointerEvents = ''; }
}
mode.addEventListener('click', () => setPlain(!plain));
scene.addEventListener('fallback', () => { setPlain(true); mode.hidden = true; });
try { if (localStorage.getItem('mode') === 'plain') setPlain(true); } catch { /* ignore */ }
if (!('customElements' in window)) setPlain(true);

// ---------- scrolling to a band ----------
function scrollToBand([a]) {
  const max = html.scrollHeight - innerHeight;
  scrollTo({ top: (a + 0.012) * max, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
for (const a of rail) a.addEventListener('click', (e) => { if (plain) return; e.preventDefault(); scrollToBand(railBands[a.dataset.band]); });
hits.forEach((b) => b.addEventListener('click', () => scrollToBand(BANDS.stars[Number(b.dataset.star)])));

// ---------- per-frame choreography ----------
function visibility([a, b], t) {
  const w = Math.min(0.025, (b - a) / 3);
  const fadeIn = a <= 0 ? 1 : smooth(a, a + w, t);
  return fadeIn * (1 - smooth(b - w, b, t));
}

scene.addEventListener('frame', (e) => {
  if (plain) return;
  const t = e.detail.t;
  let starCard = null, starV = 0;
  for (const c of cards) {
    const v = visibility(bands.get(c), t);
    c.style.opacity = v.toFixed(3);
    c.style.visibility = v > 0.01 ? 'visible' : 'hidden';
    c.style.pointerEvents = v > 0.5 ? 'auto' : 'none';
    c.style.transform = `translateY(${((1 - v) * 10).toFixed(2)}px)`;
    if (c.dataset.kind === 'star' && v > starV) { starV = v; starCard = c; }
  }

  // rail
  let here = 'name';
  if (t >= BANDS.roots[0] - 0.01) here = 'roots';
  else if (t >= BANDS.slopes[0][0]) here = 'slopes';
  else if (t >= BANDS.climb[0] - 0.03) here = 'climb';
  else if (t >= BANDS.stars[0][0] - 0.03) here = 'stars';
  rail.forEach((a) => a.classList.toggle('is-here', a.dataset.band === here));

  // star hit targets follow their stars while the sky is up
  const skyUp = t < 0.62;
  hits.forEach((b, i) => {
    const p = skyUp ? scene.project(scene.named[i].pos) : null;
    if (!p || p.x < -40 || p.x > innerWidth + 40 || p.y < -40 || p.y > innerHeight + 40) { b.style.display = 'none'; return; }
    b.style.display = '';
    b.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  });

  // a thread from the lit star to its card
  if (starCard && starV > 0.02) {
    const i = Number(starCard.dataset.index);
    const p = scene.project(scene.named[i].pos);
    const r = starCard.getBoundingClientRect();
    const portrait = innerHeight > innerWidth;
    const ax = portrait ? r.left + r.width * 0.5 : r.right - 24;
    const ay = r.top;
    if (p) {
      tether.setAttribute('x1', p.x.toFixed(1)); tether.setAttribute('y1', p.y.toFixed(1));
      tether.setAttribute('x2', ax.toFixed(1)); tether.setAttribute('y2', ay.toFixed(1));
      tether.style.opacity = (starV * 0.7).toFixed(3);
    } else tether.style.opacity = '0';
  } else tether.style.opacity = '0';
});
