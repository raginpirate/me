import './ascii.js';
import './gh-activity.js';

const html = document.documentElement;
const scene = document.querySelector('ascii-scene');
const cards = [...document.querySelectorAll('.card')];
const hits = [...document.querySelectorAll('.hits button')];
const rail = [...document.querySelectorAll('.rail a')];
const mode = document.querySelector('.mode');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function bandFor(card) {
  const B = scene.bands;
  if (!B) return [0, 0];
  const i = Number(card.dataset.index || 0);
  switch (card.dataset.kind) {
    case 'name': return B.name;
    case 'star': return B.stars[i];
    case 'climb': return B.climb;
    case 'slope': return B.slopes[i];
    case 'roots': return B.roots;
  }
  return [0, 0];
}
const railBand = (name) => {
  const B = scene.bands;
  return { name: B.name, stars: B.stars[0], climb: B.climb, slopes: B.slopes[0], roots: B.roots }[name];
};

// ---------- text mode ----------
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

// ---------- jumping ----------
function scrollToBand([a]) {
  const max = html.scrollHeight - innerHeight;
  scrollTo({ top: (a + 0.008) * max, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
for (const a of rail) a.addEventListener('click', (e) => { if (plain || !scene.bands) return; e.preventDefault(); scrollToBand(railBand(a.dataset.band)); });
hits.forEach((b) => b.addEventListener('click', () => scene.bands && scrollToBand(scene.bands.stars[Number(b.dataset.star)])));

// ---------- per frame ----------
function visibility([a, b], t) {
  const w = Math.min(0.02, (b - a) / 3);
  const fadeIn = a <= 0 ? 1 : smooth(a, a + w, t);
  const fadeOut = b >= 1 ? 1 : 1 - smooth(b - w, b, t);
  return fadeIn * fadeOut;
}

scene.addEventListener('frame', (e) => {
  if (plain) return;
  const t = e.detail.t;
  let starCard = null, starV = 0;
  for (const c of cards) {
    const v = visibility(bandFor(c), t);
    c.style.opacity = v.toFixed(3);
    c.style.visibility = v > 0.01 ? 'visible' : 'hidden';
    c.style.pointerEvents = v > 0.5 ? 'auto' : 'none';
    if (c.dataset.kind === 'star' && v > starV) { starV = v; starCard = c; }
  }

  // rail
  const B = scene.bands;
  let here = 'name';
  if (t >= B.roots[0] - 0.01) here = 'roots';
  else if (t >= B.slopes[0][0] - 0.02) here = 'slopes';
  else if (t >= B.climb[0] - 0.03) here = 'climb';
  else if (t >= B.stars[0][0] - 0.03) here = 'stars';
  rail.forEach((a) => a.classList.toggle('is-here', a.dataset.band === here));

  // clickable stars
  hits.forEach((b, i) => {
    const p = scene.starScreen(i);
    if (p.y < -40 || p.y > innerHeight + 40) { b.style.display = 'none'; return; }
    b.style.display = '';
    b.style.transform = `translate(${(p.x + scene.grid.cellW / 2).toFixed(1)}px, ${(p.y + scene.grid.cellH / 2).toFixed(1)}px)`;
  });

  // a dotted thread from the lit star to its card
  if (starCard && starV > 0.02) {
    const i = Number(starCard.dataset.index);
    const r = starCard.getBoundingClientRect();
    const portrait = innerHeight > innerWidth;
    const ax = portrait ? r.left + r.width * 0.5 : (starCard.dataset.side === 'left' ? r.right + 4 : r.left - 4);
    const ay = portrait ? r.top - 4 : r.top + Math.min(r.height * 0.3, 40);
    scene.drawTether(i, ax, ay, Math.min(1, 1.1 * starV));
  }
});
