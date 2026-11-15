// The instance contract. Everything drawn is one 24-byte instance; pack.js and live.js write them through
// `writer`, and the two shaders below are the only other code that knows what the bytes mean.

export const BYTES = 24;
// attribute: [name, components, type, byte offset]
export const FORMAT = [['aAnchor', 2, 'FLOAT', 0], ['aLocal', 2, 'SHORT', 8], ['aExt', 2, 'UNSIGNED_SHORT', 12], ['aK', 1, 'UNSIGNED_SHORT', 16], ['aG', 4, 'UNSIGNED_BYTE', 18], ['aKP', 2, 'UNSIGNED_BYTE', 22]];
export const KIND = { plain: 0, star: 1, tree: 2, snow: 3, leaf: 4, cloud: 5, route: 6 };
// bits of p. INK: centred on its ink, not set as type · WASH: a solid filled with its lobe's ground · MIST: the ground alone, hiding nothing
// HOT: the bright heart of the lit route · snow and leaves keep their depth in bits 4-5 and their first frame in bits 6-7
// on a plain glyph, BARE: not dimmed by its lobe's tone · FREE: it moves, so it is not set on the pixel. On a solid, DISC: a soft round hollow
export const INK = 1, WASH = 2, MIST = 4, HOT = 8, DISC = 8, BARE = 16, FREE = 32;
export const LAYERS = 40, COLOURS = 40, LADDER = [-8, 5];   // layers in the table; palette entries; the atlas's sizes, in quarter octaves of the type size

// Writes instances into a buffer. anchor: its place on its layer, in cells. local: offset in its own cells.
// ext: a solid's width and height in its own cells, or two parameters. k: its size against its layer's.
export function writer(buffer) {
  const view = new DataView(buffer); let n = 0;
  const put = (ax, ay, lx, ly, ex, ey, k, glyph, colour, alpha, layer, kind = 0, p = 0) => {
    const o = n++ * BYTES;
    view.setFloat32(o, ax, true); view.setFloat32(o + 4, ay, true);
    view.setInt16(o + 8, Math.round(lx * 256), true); view.setInt16(o + 10, Math.round(ly * 256), true);
    view.setUint16(o + 12, ex, true); view.setUint16(o + 14, ey, true); view.setUint16(o + 16, Math.round(k * 1024), true);
    view.setUint8(o + 18, glyph); view.setUint8(o + 19, colour); view.setUint8(o + 20, Math.round(alpha * 255)); view.setUint8(o + 21, layer); view.setUint8(o + 22, kind); view.setUint8(o + 23, p);
  };
  return { put, solid: (ax, ay, lx, ly, w, h, k, colour, alpha, layer, p = 0, kind = 0) => put(ax, ay, lx, ly, Math.round(w * 32), Math.round(h * 32), k, 0, colour, alpha, layer, kind, p), get count() { return n; }, set count(v) { n = v; } };
}

const COMMON = `#version 300 es
precision highp float;
uniform vec2 uRes, uCell;                 // device px: the canvas, a cell at the page's type size
uniform float uType, uTime, uS, uPx;      // type size in device px; seconds; rows to a screen; device px to a css px
uniform vec3 uPalette[${COLOURS}];                // [0] is the sky of the moment
uniform vec4 uLamp;                       // the light you carry: x, y, where its dark begins, where it is full (device px)
uniform float uDark, uLit, uMask, uHeat;         // how dark the dark is; 1 for things drawn after it; 1 when only what hides is wanted
uniform vec4 uWashBox;                    // this lobe's ground texture: its first column and row, its size in cells
`;

export const VERTEX = COMMON + `
layout(location=0) in vec2 aAnchor; layout(location=1) in vec2 aLocal; layout(location=2) in vec2 aExt;
layout(location=3) in float aK; layout(location=4) in vec4 aG; layout(location=5) in vec2 aKP;
layout(std140) uniform Layers { vec4 A[${LAYERS}]; vec4 B[${LAYERS}]; vec4 C[${LAYERS}]; };   // A: X, s, centreRow, vis · B: tone, ref, growLo, growHi · C: depth, cx, drift, span
uniform sampler2D uMetrics;               // per glyph (row) and size (column pair): its box in the atlas; where its box and its ink's middle sit from its origin
uniform vec4 uQuiet[6];                   // boxes of text the stars keep clear of (device px), and uHush how much
uniform float uHush, uAltStar, uAscent, uCols, uPush;
uniform vec2 uLean, uPointer;             // the sky's lean against the scroll (cells); the pointer (cells), and uPush how hard it pushes
uniform vec4 uFall; uniform vec3 uLeaf;   // rows where snow and leaves begin and end; a leaf's three glyphs
out vec2 vUV, vCell; out vec4 vColour; out float vTone; flat out float vMode;

float smooth01(float a, float b, float x) { float u = clamp((x - a) / (b - a), 0., 1.); return u * u * (3. - 2. * u); }
float twinkle(float phase, float low, float rate) { return low + (1. - low) * (.5 + .5 * sin(uTime * rate + phase)); }

void main() {
  int li = int(aG.w), kind = int(aKP.x), p = int(aKP.y); float glyph = aG.x, alpha = aG.z / 255., k = aK / 1024.;
  vec4 a = A[li], b = B[li], c = C[li]; vec2 anchor = aAnchor, corner = vec2(gl_VertexID & 1, gl_VertexID >> 1), nudge = vec2(0.);
  float s = a.y, vis = a.w, tone = b.x; bool ink = (p & ${INK}) != 0;
  if (kind == ${KIND.cloud}) anchor.x = mod(anchor.x + c.z * uTime, c.w);                                               // a cloud drifts round its layer
  else if (kind == ${KIND.tree}) k = min(2. / s, k * exp(.42 * clamp((clamp(anchor.y, b.z, b.w) - b.y) / uS, -1.6, 1.6)));   // a tree grows as you come down to it
  else if (kind == ${KIND.star}) {
    float phase = aExt.x / 65535. * 6.28, tier = aExt.y; vec2 px = (anchor + .5 - vec2(0., a.z - uRes.y / uCell.y / 2.)) * uCell;
    if (uHush > .01) { float d = 1e9; for (int i = 0; i < 6; i++) { vec4 q = uQuiet[i]; if (q.z > q.x) d = min(d, length(max(max(q.xy - px, px - q.zw), 0.))); } alpha *= 1. - uHush * (1. - smooth01(8., 22., d / (uType / 11.))); }
    if (phase < 2.1) { alpha *= twinkle(7. * phase, .2, 1.4 + phase); if (tier > 1.5 && sin(1.7 * uTime + 5. * phase) < -.2) glyph = uAltStar; }
    else if (tier > 1.5 && sin(1.7 * uTime + phase) < -.3) glyph = uAltStar;
    vec2 square = vec2(uCell.x / uCell.y, 1.), away = (anchor + .5 - uPointer) * square; float far = length(away);
    vec2 moved = uLean + (far < 5. && far > 1e-4 ? away / far * (1. - far / 5.) * 2.5 * smooth01(0., 1.2, far) * uPush / square : vec2(0.));
    anchor += moved; if (moved != vec2(0.)) p |= ${FREE};
  } else if (kind == ${KIND.snow} || kind == ${KIND.leaf}) {                                                            // falling things: where one is follows from the time alone
    bool leaf = kind == ${KIND.leaf}; int depth = (p >> 4) & 3; float phase = aExt.x / 65535. * 6.28, lo = leaf ? uFall.z : uFall.x, hi = leaf ? uFall.w : uFall.y;
    float wind = -6.19 * cos(.21 * uTime) - .746 * cos(.67 * uTime + 1.3);                                             // the wind so far
    float fall = leaf ? vec3(1.3, 1.9, 2.6)[depth] * (.6 * uTime - .1333 * cos(3. * uTime + phase)) : vec3(1.2, 2.3, 3.6)[depth] * uTime;
    float y = anchor.y - lo + fall, turn = floor(y / (hi - lo)); y = lo + y - turn * (hi - lo);
    float dx = leaf ? (-.762 * cos(2.1 * uTime + phase) + .6 * wind) * s : wind * s - .263 * float(depth + 1) * cos(1.9 * uTime + phase);
    nudge.x = (fract(anchor.x + dx / uCols + turn * .618034) * (uRes.x / uPx + 20.) - 10.) * uPx; anchor = vec2(0., y);
    if (leaf) {
      if (aExt.y / 65535. > .12 + .88 * smooth01(lo + .2 * uS, lo + 1.6 * uS, y)) alpha = 0.;                           // thicker the further down
      glyph = uLeaf[int(mod(float((p >> 6) & 3) + floor(3. * uTime + phase), 3.))];
      alpha *= smooth01(lo, lo + 6., y) * (1. - smooth01(hi - 3., hi, y));                                              // it comes to rest on the ground
    } else alpha *= smooth01(lo, lo + .22 * uS, y) * (1. - smooth01(5.5 * uS, hi, y));
  }
  vec2 own = uCell * s * k;                                   // its own cell, device px
  vec2 origin = vec2((a.x - c.y * s) * uCell.x, uRes.y / 2. - a.z * uCell.y * s);   // where its layer's (0, 0) is
  vec2 at = origin + anchor * uCell * s + aLocal / 256. * own + nudge, size;
  vColour = vec4(uPalette[int(aG.y)], alpha * vis); vTone = tone; vMode = 0.;
  if (kind == ${KIND.leaf}) vColour.a *= .2 + .8 * (1. - smooth01(uLamp.z, uLamp.w, distance(at, uLamp.xy)));           // brightest in your light
  if (glyph < .5) {                                           // a solid
    size = aExt / 32. * own; vMode = float(1 + (p & ${WASH | MIST | DISC})); vUV = corner;
    vCell = (at + corner * size - origin) / (uCell * s);
  } else {
    float want = uType * s * k, lv = clamp(ceil(log2(want / uType) * 4. - .001), ${LADDER[0]}., ${LADDER[1]}.), q = uType * exp2(lv / 4.), f = want / q;
    ivec2 m = ivec2(int(lv) - (${LADDER[0]}), int(glyph)) * ivec2(2, 1); vec4 box = texelFetch(uMetrics, m, 0), from = texelFetch(uMetrics, m + ivec2(1, 0), 0);
    bool page = s == 1. && k == 1. && !ink;                   // type at the page's own size sits on the page's baseline, and on the pixel unless it is moving
    if (kind == ${KIND.route}) {                              // the stretch of route in your light
      float r0 = uLamp.z, lit = (1. - smooth01(.55 * r0, 2.1 * r0, distance(ink ? at : at + vec2(.3, .6) * want, uLamp.xy))) * vis;
      vColour.a = alpha * ((p & ${HOT}) != 0 ? .7 * lit * lit : lit);
    } else if (kind != ${KIND.plain} || (p & ${BARE}) == 0) vColour.a *= tone;
    size = box.zw * f; at += ink ? (from.xy - from.zw) * f : vec2(from.x * f, (page ? uAscent : .9 * want) + from.y * f);
    if (page && (p & ${FREE}) == 0) at = floor(at + .5);
    vUV = box.xy + corner * box.zw;
  }
  gl_Position = vec4((at + corner * size) / uRes * vec2(2., -2.) + vec2(-1., 1.), c.x, 1.);
}`;

export const FRAGMENT = COMMON + `
uniform sampler2D uAtlas, uWash;
in vec2 vUV, vCell; in vec4 vColour; in float vTone; flat in float vMode;
out vec4 o;
void main() {
  if (uMask > .5) { o = vec4(0.); return; }
  if (uHeat > .5) { o = vec4(8. / 255.); return; }   // ?try=heat: every fragment shaded adds a step, so the picture is its own cost
  vec3 sky = uPalette[0]; vec4 c;
  if (vMode < .5) c = vec4(vColour.rgb, 1.) * (vColour.a * texture(uAtlas, vUV / vec2(textureSize(uAtlas, 0))).r);
  else if (vMode < 1.5) c = vec4(vColour.rgb, 1.) * vColour.a;
  else if (vMode > 8.5) c = vec4(sky, 1.) * (vColour.a * clamp((1. - length(vUV * 2. - 1.)) / .55, 0., 1.));
  else {
    vec4 w = texture(uWash, (vCell - uWashBox.xy) / uWashBox.zw) * (vTone * step(vCell.y, uWashBox.y + uWashBox.w));   // premultiplied ground, at this lobe's tone
    c = vMode > 4.5 ? w * vColour.a : vec4(sky * (1. - w.a) + w.rgb, 1.) * vColour.a;
  }
  // the dark: everything drawn before it is put out, away from the light you carry
  if (uLit < .5 && uDark > 0.) { float u = clamp((distance(vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y), uLamp.xy) - uLamp.z) / (uLamp.w - uLamp.z), 0., 1.); c.rgb = mix(c.rgb, sky * c.a, uDark * (u < .5 ? u * 1.24 : .62 + (u - .5) * .76)); }
  o = c;
}`;
