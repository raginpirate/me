import './scene.js';
import './gh-activity.js';

// Highlight the rail entry for the band currently in view.
const rail = [...document.querySelectorAll('.rail a')];
const byId = Object.fromEntries(rail.map((a) => [a.getAttribute('href').slice(1), a]));
const bands = Object.keys(byId).map((id) => document.getElementById(id)).filter(Boolean);

if ('IntersectionObserver' in window && bands.length) {
  const visible = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
    let best = null, ratio = 0;
    for (const [id, r] of visible) if (r > ratio) { ratio = r; best = id; }
    rail.forEach((a) => a.classList.toggle('is-here', best !== null && a === byId[best]));
  }, { threshold: [0, 0.15, 0.3, 0.5, 0.7, 1], rootMargin: '-10% 0px -30% 0px' });
  bands.forEach((b) => io.observe(b));
}
