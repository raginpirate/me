// Boot: measure the page's type, make the world, and draw it every frame.

import { TYPE } from './art.js';
import { CHARS } from './art.js';
import { makeWorld } from './world.js';
import { makeGL } from './gl.js';
import { makeScene } from './scene.js';

const canvas = document.querySelector('canvas.scene'), font = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim();

function measure() {
  const W = innerWidth, probe = document.createElement('div'); probe.style.cssText = 'position:fixed;height:100lvh;visibility:hidden'; document.body.append(probe);
  const H = Math.max(probe.offsetHeight, innerHeight); probe.remove();
  const typeSize = TYPE.sizes.find(([below]) => W <= below)[1], x = document.createElement('canvas').getContext('2d'); x.font = `${typeSize}px ${font}`;
  return { W, H, typeSize, cellW: x.measureText('M').width, cellH: Math.round(1.2 * typeSize), stack: W <= TYPE.stackBelow };
}

const params = measure(), model = makeWorld(params), dpr = Math.min(devicePixelRatio, TYPE.maxDpr), view = { w: params.W, h: params.H, dpr };
document.documentElement.style.setProperty('--world-height', `${Math.round(model.dims.rows * params.cellH)}px`);
const gl = makeGL(canvas, { font, chars: CHARS });
gl.resize(Math.round(view.w * dpr), Math.round(view.h * dpr)); gl.atlas(params.typeSize * dpr);
const scene = makeScene(gl, model, view), t0 = performance.now();
const loop = (now) => { scene.frame((now - t0) / 1000); requestAnimationFrame(loop); };
requestAnimationFrame(loop);
window.scene = { model, gl };
