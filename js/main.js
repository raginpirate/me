// The page is a text document. This turns it into the mountain when the browser can draw it, and back.

import { TYPE, FRAMES, CHARS } from './art.js';
import { LAYERS } from './glsl.js';
import { makeWorld } from './world.js';
import { makeGL } from './gl.js';
import { makeScene } from './scene.js';
import { makeLive } from './live.js';
import { makeCards } from './cards.js';
import { makeGlide } from './glide.js';
import './pulse.js';

const html = document.documentElement, button = document.querySelector('.mode'), note = document.querySelector('.mode-note'), query = new URLSearchParams(location.search);
const force = query.get('scene') === 'force', reduced = matchMedia('(prefers-reduced-motion: reduce)').matches, began = performance.now();
const saved = () => { try { return localStorage.mode; } catch { return null; } }, save = (mode) => { try { localStorage.mode = mode; } catch { /* no storage */ } };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
let world = null, lamps = 0, bench = null;

// Why the mountain cannot be drawn here, or null
function cannot() {
  if (force) return null;
  if (matchMedia('(forced-colors: active)').matches) return 'The mountain is drawn in its own colours, and forced colours are on.';
  const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  if (!gl) return document.createElement('canvas').getContext('webgl2') ? 'The mountain needs a graphics card, and this browser is drawing without one.' : 'The mountain needs WebGL 2, and this browser does not have it.';
  const enough = gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 4096 && gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE) >= LAYERS * 48 && gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) >= 256;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return enough ? null : 'The mountain needs more of a graphics card than this one.';
}

function measure(font) {
  const W = innerWidth, probe = document.createElement('div'); probe.style.cssText = 'position:fixed;height:100lvh;visibility:hidden'; document.body.append(probe);
  const H = Math.max(probe.getBoundingClientRect().height, innerHeight); probe.remove();
  // the frame covers the screen: the type is as small as lets it, on whole device pixels a row
  const stack = W / H < FRAMES.turn, f = FRAMES[stack ? 'stack' : 'side'], dpr = Math.min(devicePixelRatio, TYPE.maxDpr), x = document.createElement('canvas').getContext('2d');
  x.font = `100px ${font}`; const em = x.measureText('M').width / 100;
  const cellH = Math.ceil(Math.max(H / f.rows, 1.2 * W / (f.cols * em)) * dpr - 1e-3) / dpr, typeSize = cellH / 1.2, cellW = em * typeSize;
  return { W: f.cols * cellW, H, typeSize, cellW, cellH, stack, cols: f.cols + 1, S: f.rows, stage: f.stage, dpr, screen: [W, innerHeight], ox: Math.max(0, (f.cols * cellW - W) / 2) };
}

function start() {
  const old = document.querySelector('canvas.scene'), canvas = old.cloneNode(); old.replaceWith(canvas);   // a fresh canvas each time: nothing of the last world is left on the card
  const font = getComputedStyle(html).getPropertyValue('--mono').trim(), params = measure(font), model = makeWorld({ ...params, lazy: true }), d = model.dims;
  const dpr = params.dpr, view = { w: params.W, h: params.H, ox: params.ox, dpr };   // the scene's own px are the frame's: `ox` of them are off the screen's left edge
  html.classList.toggle('is-stack', params.stack); html.style.setProperty('--world-height', `${Math.round(d.end * params.cellH + params.H)}px`);
  const gl = makeGL(canvas, { font, chars: CHARS, force, heat: query.get('try') === 'heat' }); if (!gl) throw new Error('no context');
  gl.resize(Math.round((view.w - 2 * view.ox) * dpr), Math.round(view.h * dpr), Math.round(view.ox * dpr), Math.round(view.w * dpr)); gl.atlas(params.typeSize * dpr);
  const scene = makeScene(gl, model, view, { prepass: query.get('prepass') !== '0', try: query.get('try') }), glide = makeGlide(() => model.stops.map((s) => s.snap * params.cellH).sort((a, b) => a - b));
  const cards = makeCards(model, view, (y, smoothly) => glide.go(y, smoothly && !reduced)), live = makeLive(gl, model, view, scene, cards);
  live.setLamps(lamps); glide.on();
  let frame = 0, last = 0;
  const loop = (now) => {
    const time = (now - began) / 1000, t0 = bench && performance.now();
    cards.frame(clamp(scrollY / params.cellH / d.maxScroll, 0, 1), clamp(time - last, 0, 0.05), live.spots); last = time;
    const timed = bench?.open(); scene.frame(time, live); if (timed) bench.close();
    if (bench) bench(performance.now() - t0, now);
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
  // the massif, a lobe at a time between frames, the ones nearest the screen first
  if (model.lobes.length > 19) throw new Error('more lobes than layers');
  const todo = model.lobes.map((_, i) => i), slices = []; let timer = 0;
  const next = () => {
    if (!todo.length) { world.ready = true; return; }
    const row = scrollY / params.cellH + d.S / 2, near = (i) => Math.abs(clamp(row, model.lobes[i].apex, d.groundRow) - row);
    todo.sort((a, b) => near(a) - near(b)); const i = todo.shift(), at = performance.now();
    model.paint(i); scene.addLobe(i); slices.push(performance.now() - at);
    timer = setTimeout(next, 0);
  };
  timer = setTimeout(next, 0);
  let stopping = false; canvas.addEventListener('webglcontextlost', () => { if (!stopping) refuse('The mountain lost its graphics card. Reload to try again.'); });
  world = { model, gl, scene, live, cards, params, slices, ready: false, stop() { stopping = true; cancelAnimationFrame(frame); clearTimeout(timer); glide.off(); cards.stop(); gl.gl.getExtension('WEBGL_lose_context')?.loseContext(); } };
  window.scene = world;
}

function show(mode) {
  world?.stop(); world = null;
  html.classList.toggle('is-scene', mode === 'scene');
  if (mode === 'scene') try { start(); } catch (e) { console.error(e); return refuse('The mountain could not be drawn here.'); }
  button.textContent = mode === 'scene' ? 'text version' : 'mountain';
}
function refuse(why) { world?.stop(); world = null; html.classList.remove('is-scene'); button.textContent = 'mountain'; button.disabled = true; note.textContent = why; }

const why = cannot();
if (why) refuse(why);
else {
  button.disabled = false; note.textContent = reduced ? 'It moves.' : '';
  button.addEventListener('click', () => { const mode = world ? 'plain' : 'scene'; save(mode); show(mode); });
  show(saved() === 'plain' || (reduced && saved() !== 'scene') ? 'plain' : 'scene');
  // the world is laid out again when the width changes, or the height by a fifth (a phone's bars come and go: that is not a new page)
  let pending = 0;
  addEventListener('resize', () => { clearTimeout(pending); pending = setTimeout(() => {
    if (!world) return; const [W, H] = world.params.screen; if (innerWidth === W && Math.abs(innerHeight - H) / H < 0.2) return;
    const at = scrollY / Math.max(1, html.scrollHeight - innerHeight); show('scene'); scrollTo(0, at * (html.scrollHeight - innerHeight));
  }, 150); });
}
addEventListener('gh-pulse', (e) => { lamps = e.detail; world?.live.setLamps(lamps); });

// ?fps: what a frame costs. The script's share, and the graphics card's own time where the browser will tell.
if (query.has('fps')) {
  const out = document.body.appendChild(Object.assign(document.createElement('pre'), { className: 'fps' })), cpu = [], gaps = [], gpu = [], mid = (list, p) => [...list].sort((a, b) => a - b)[Math.floor(p * (list.length - 1))] ?? 0;
  let before = 0, shownAt = 0, timing = null, ext = null, of = null;
  bench = (ms, now) => {
    const gl = world?.gl.gl; if (gl && of !== gl) { of = gl; ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); timing = null; }
    if (ext && timing && gl.getQueryParameter(timing, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(timing, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(timing); timing = null; if (gpu.length > 120) gpu.shift(); }
    cpu.push(ms); if (before) gaps.push(now - before); before = now; if (cpu.length > 240) { cpu.shift(); gaps.shift(); }
    if (now - shownAt < 500) return; shownAt = now;
    const b = window.bench = { cpu50: mid(cpu, 0.5), cpu99: mid(cpu, 0.99), gap50: mid(gaps, 0.5), gap99: mid(gaps, 0.99), gpu50: gpu.length ? mid(gpu, 0.5) : null, gpu99: gpu.length ? mid(gpu, 0.99) : null, slices: world?.slices };
    out.textContent = `script ${b.cpu50.toFixed(2)} ms (99th ${b.cpu99.toFixed(2)})  card ${b.gpu50 == null ? 'not told' : `${b.gpu50.toFixed(2)} ms (99th ${b.gpu99.toFixed(2)})`}  frame ${b.gap50.toFixed(1)} ms  slowest lobe ${Math.max(0, ...(world?.slices ?? [])).toFixed(0)} ms`;
  };
  // the card's time for one frame in four: the query wraps everything the frame asks of it
  bench.open = () => { const gl = world?.gl.gl; if (ext && !timing && gl === of) { timing = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, timing); return true; } return false; };
  bench.close = () => of.endQuery(ext.TIME_ELAPSED_EXT);
}
