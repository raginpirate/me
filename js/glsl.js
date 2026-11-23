// The instance contract. Everything drawn is one 24-byte instance; pack.js and live.js write them through
// `writer`, and the two shaders below are the only other code that knows what the bytes mean.

export const BYTES = 24;
// attribute: [name, components, type, byte offset]
export const FORMAT = [['aAnchor', 2, 'FLOAT', 0], ['aLocal', 2, 'SHORT', 8], ['aExt', 2, 'UNSIGNED_SHORT', 12], ['aK', 1, 'UNSIGNED_SHORT', 16], ['aG', 4, 'UNSIGNED_BYTE', 18], ['aKP', 2, 'UNSIGNED_BYTE', 22]];
export const KIND = { plain: 0, star: 1, tree: 2, snow: 3, leaf: 4, cloud: 5, route: 6 };
// bits of p. INK: centred on its ink, not set as type · WASH: a solid filled with its lobe's ground · MIST: the ground alone, hiding nothing
// HOT: the bright heart of the lit route · snow and leaves keep their depth in bits 4-5 and their first frame in bits 6-7
// on a plain glyph, BARE: not dimmed by its lobe's tone · FREE: it moves, so it is not set on the pixel
export const INK = 1, WASH = 2, MIST = 4, HOT = 8, BARE = 16, FREE = 32;
// How a solid meets what is behind it. EDGE: its top is a slope (aLocal holds the top at its left and right, in rows) with
// a haze rising off it · SOFT_X, SOFT_Y: its ends, or its top and bottom, are feathered
// HIDE: it has no colour at all. It is drawn into the depth alone, and what it does is keep farther ink from being drawn
// where it is; the surface behind it is left as it was. This is the only way anything hides what is behind it: nothing is
// ever painted in a colour that stands for "what is behind", so there is nothing to mismatch and no edge to see.
// A HIDE solid's colour byte is its rank (1-255): how far in front of its layer it stands, in STEPs. A glyph's second
// parameter is its rank too, and it stands half a step in front of that, so a thing's own ink is never hidden by itself.
export const HIDE = 128, STEP = 0.00007;
export const EDGE = 16, SOFT_X = 32, SOFT_Y = 64, HAZE = [0.45, 0.5];   // the haze is a hairline: how many rows it rises, how much it hides at the edge
export const TRAIL = 32;   // how many moments of the pointer's past the shader is given
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
  const SURFACE = WASH | HIDE;   // a solid is a surface with a colour of its own, a layer's ground (WASH: its colour is the ground rule's), or it only hides
  return { put, solid: (ax, ay, lx, ly, w, h, k, colour, alpha, layer, p = 0, kind = 0) => {
    if (colour === 0 && !(p & SURFACE)) throw new Error('a solid in the sky\'s colour: nothing may be painted to stand for what is behind it (use HIDE)');
    put(ax, ay, lx, ly, Math.round(w * 32), Math.round(h * 32), k, 0, colour, alpha, layer, kind, p); }, get count() { return n; }, set count(v) { n = v; } };
}

const COMMON = `#version 300 es
precision highp float;
uniform vec2 uRes, uCell;                 // device px: the canvas, a cell at the page's type size
uniform float uType, uTime, uS, uPx;      // type size in device px; seconds; rows to a screen; device px to a css px
uniform vec3 uPalette[${COLOURS}];                // [0] is the sky of the moment
uniform vec4 uLamp;                       // the light you carry: x, y, where its dark begins, where it is full (device px)
uniform float uDark, uLit, uMask, uHeat, uLeft;         // how dark the dark is; 1 for things drawn after it; 1 when only what hides is wanted
uniform vec4 uWashBox;                    // this lobe's ground texture: its first column and row, its size in cells
`;

export const VERTEX = COMMON + `
layout(location=0) in vec2 aAnchor; layout(location=1) in vec2 aLocal; layout(location=2) in vec2 aExt;
layout(location=3) in float aK; layout(location=4) in vec4 aG; layout(location=5) in vec2 aKP;
layout(std140) uniform Layers { vec4 A[${LAYERS}]; vec4 B[${LAYERS}]; vec4 C[${LAYERS}]; };   // A: X, s, centreRow, vis · B: tone, ref, growLo, growHi · C: depth, cx, drift, span
uniform sampler2D uMetrics;               // per glyph (row) and size (column pair): its box in the atlas; where its box and its ink's middle sit from its origin
uniform vec4 uQuiet[6];                   // boxes of text the stars keep clear of (device px), and uHush how much
uniform float uHush, uAltStar, uAscent, uCols;
uniform vec2 uLean;                       // the sky's lean against the scroll (cells)
uniform vec3 uTrail[${TRAIL}];                  // where the pointer has been (device px), and how much each moment still pulls on a spring
uniform vec4 uFall; uniform vec3 uLeaf;   // rows where snow and leaves begin and end; a leaf's three glyphs
out vec2 vUV, vCell; out vec4 vColour; out float vTone; flat out float vMode; flat out vec4 vEdge, vSoft;

float smooth01(float a, float b, float x) { float u = clamp((x - a) / (b - a), 0., 1.); return u * u * (3. - 2. * u); }
float twinkle(float phase, float low, float rate) { return low + (1. - low) * (.5 + .5 * sin(uTime * rate + phase)); }

// The pointer pushes stars, snow and leaves aside, and each is on a spring: it lags, overshoots and settles. A spring's
// place is its past pushes weighed by how a spring answers a knock, so the weights carry the spring and nothing is kept.
vec2 pushed(vec2 px) {
  vec2 sum = vec2(0.);
  for (int i = 0; i < ${TRAIL}; i++) { vec3 t = uTrail[i]; if (t.z == 0.) continue; vec2 away = (px - t.xy) / uCell.y; float far = length(away); if (far < 5. && far > 1e-4) sum += away / far * ((1. - far / 5.) * 2.5 * smooth01(0., 1.2, far) * t.z); }
  return sum * uCell.y;
}

void main() {
  int li = int(aG.w), kind = int(aKP.x), p = int(aKP.y); float glyph = aG.x, alpha = aG.z / 255., k = aK / 1024.;
  vec4 a = A[li], b = B[li], c = C[li]; vec2 anchor = aAnchor, corner = vec2(gl_VertexID & 1, gl_VertexID >> 1), nudge = vec2(0.);
  float s = a.y, vis = a.w, tone = b.x; bool ink = (p & ${INK}) != 0, hides = glyph < .5 && (p & ${HIDE}) != 0;
  // what only hides is drawn into the depth and nowhere else; and into the depth goes only what hides, and a layer's own body
  if (hides ? uMask < .5 : uMask > .5 && !(glyph < .5 && (p & ${EDGE}) != 0)) { gl_Position = vec4(2., 2., 2., 1.); return; }
  float rank = hides ? aG.y : glyph >= .5 && (kind == ${KIND.plain} || kind == ${KIND.tree} || kind == ${KIND.route} || kind == ${KIND.cloud}) && aExt.y > 0. ? aExt.y + .5 : 0.;
  vec2 origin = vec2((a.x - c.y * s) * uCell.x, uRes.y / 2. - a.z * uCell.y * s);   // where its layer's (0, 0) is
  if (kind == ${KIND.cloud}) anchor.x = mod(anchor.x + c.z * uTime, c.w);                                               // a cloud drifts round its layer
  else if (kind == ${KIND.tree}) k = min(2. / s, k * exp(.42 * clamp((clamp(anchor.y, b.z, b.w) - b.y) / uS, -1.6, 1.6)));   // a tree grows as you come down to it
  else if (kind == ${KIND.star}) {
    float phase = aExt.x / 65535. * 6.28, tier = aExt.y; vec2 px = (anchor + .5 - vec2(0., a.z - uRes.y / uCell.y / 2.)) * uCell;
    if (uHush > .01) { float d = 1e9; for (int i = 0; i < 6; i++) { vec4 q = uQuiet[i]; if (q.z > q.x) d = min(d, length(max(max(q.xy - px, px - q.zw), 0.))); } alpha *= 1. - uHush * (1. - smooth01(8., 22., d / (uType / 11.))); }
    if (phase < 2.1) { alpha *= twinkle(7. * phase, .2, 1.4 + phase); if (tier > 1.5 && sin(1.7 * uTime + 5. * phase) < -.2) glyph = uAltStar; }
    else if (tier > 1.5 && sin(1.7 * uTime + phase) < -.3) glyph = uAltStar;
    nudge = pushed(px); anchor += uLean; if (nudge != vec2(0.) || uLean != vec2(0.)) p |= ${FREE};
  } else if (kind == ${KIND.snow} || kind == ${KIND.leaf}) {                                                            // falling things: where one is follows from the time alone
    bool leaf = kind == ${KIND.leaf}; int depth = (p >> 4) & 3; float phase = aExt.x / 65535. * 6.28, lo = leaf ? uFall.z : uFall.x, hi = leaf ? uFall.w : uFall.y;
    float wind = -6.19 * cos(.21 * uTime) - .746 * cos(.67 * uTime + 1.3);                                             // the wind so far
    float fall = leaf ? vec3(1.3, 1.9, 2.6)[depth] * (.6 * uTime - .1333 * cos(3. * uTime + phase)) : vec3(1.2, 2.3, 3.6)[depth] * uTime;
    float y = anchor.y - lo + fall, turn = floor(y / (hi - lo)); y = lo + y - turn * (hi - lo);
    float dx = leaf ? (-.762 * cos(2.1 * uTime + phase) + .6 * wind) * s : wind * s - .263 * float(depth + 1) * cos(1.9 * uTime + phase);
    nudge.x = (fract(anchor.x + dx / uCols + turn * .618034) * (uRes.x / uPx + 20.) - 10.) * uPx; anchor = vec2(0., y);
    nudge += pushed(origin + anchor * uCell * s + nudge);
    if (leaf) {
      if (aExt.y / 65535. > .12 + .88 * smooth01(lo + .2 * uS, lo + 1.6 * uS, y)) alpha = 0.;                           // thicker the further down
      glyph = uLeaf[int(mod(float((p >> 6) & 3) + floor(3. * uTime + phase), 3.))];
      alpha *= smooth01(lo, lo + 6., y) * (1. - smooth01(hi - 3., hi, y));                                              // it comes to rest on the ground
    } else alpha *= smooth01(lo, lo + .22 * uS, y) * (1. - smooth01(5.5 * uS, hi, y));
  }
  vec2 own = uCell * s * k;                                   // its own cell, device px
  bool sloped = glyph < .5 && (p & ${EDGE}) != 0;
  vec2 at = origin + anchor * uCell * s + (sloped ? vec2(0.) : aLocal / 256. * own) + nudge, size;
  vColour = vec4(uPalette[min(int(aG.y), ${COLOURS - 1})], alpha * vis); vTone = tone; vMode = 0.;
  if (kind == ${KIND.leaf}) vColour.a *= .2 + .8 * (1. - smooth01(uLamp.z, uLamp.w, distance(at, uLamp.xy)));           // brightest in your light
  if (glyph < .5) {                                           // a solid
    size = aExt / 32. * own; vMode = float(1 + (p & ${WASH | MIST})); vUV = corner; vEdge = vec4(0.);
    if (sloped) {
      vec2 tops = aLocal / 256.;                              // rows down from the solid's own top to its edge, at the left and at the right
      if (uMask > .5) { float cut = max(tops.x, tops.y); at.y += cut * own.y; size.y -= cut * own.y; tops -= cut; }   // what it hides outright is the part under its edge
      vEdge = vec4(tops, 1., own.y);
    }
    vSoft = vec4(size, (p & ${SOFT_X}) != 0 ? .3 * own.x : 0., (p & ${SOFT_Y}) != 0 ? .25 * own.y : 0.);
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
  gl_Position = vec4((at + corner * size) / uRes * vec2(2., -2.) + vec2(-1., 1.), c.x - rank * ${STEP} + (kind == ${KIND.star} ? .05 : 0.), 1.);   // the stars are behind everything
}`;

export const FRAGMENT = COMMON + `
uniform sampler2D uAtlas, uWash, uForm;   // the type; a long ridge's shoulder shading; this layer's skyline, a height at each column's edge
uniform vec3 uGround[3]; uniform vec2 uWood;   // the tone of rock, of wooded ground, of mist; the heights (screens) between which rock gives way to wood
in vec2 vUV, vCell; in vec4 vColour; in float vTone; flat in float vMode; flat in vec4 vEdge, vSoft;
out vec4 o;
void main() {
  if (uMask > .5) { o = vec4(0.); return; }
  if (uHeat > .5) { o = vec4(8. / 255.); return; }   // ?try=heat: every fragment shaded adds a step, so the picture is its own cost
  vec3 sky = uPalette[0]; vec4 c;
  if (vMode < .5) c = vec4(vColour.rgb, 1.) * (vColour.a * texture(uAtlas, vUV / vec2(textureSize(uAtlas, 0))).r);
  else if (vMode < 1.5) c = vec4(vColour.rgb, 1.) * vColour.a;
  else {
    // A layer's ground, at this pixel, from its skyline alone. Under the skyline: the layer hides everything, and its
    // ground is toned, most just under the edge. Above it: nothing but a hairline of haze and, off wooded ground, mist
    // that thins as it rises. One rule, the same for every layer and for everything standing on it.
    float x = clamp(vCell.x - uWashBox.x, 0., uWashBox.z), col = floor(x);
    float edge = mix(texelFetch(uForm, ivec2(int(col), 0), 0).r, texelFetch(uForm, ivec2(int(min(col + 1., uWashBox.z)), 0), 0).r, x - col), under = vCell.y - edge;
    float wooded = smoothstep(uWood.x, uWood.y, vCell.y / uS), tone, rise = clamp(1. + under / 5., 0., 1.), hair = clamp(1. + under / ${HAZE[0]}, 0., 1.);
    vec4 fold = texture(uWash, (vCell - uWashBox.xy) / uWashBox.zw) * step(vCell.y, uWashBox.y + uWashBox.w), ground;   // the shading under a long ridge's shoulders: premultiplied
    if (under >= 0.) { tone = mix(.2, .32, wooded) * exp(-under / 6.5); ground = vec4(mix(uGround[0], uGround[1], wooded) * tone, tone); if (fold.a > tone) ground = fold; }
    else { tone = .11 * rise * rise * smoothstep(uWood.x, uWood.y, edge / uS); ground = vec4(uGround[2] * tone, tone); }
    ground *= vTone;
    float hides = vEdge.z > 0. ? mix(${HAZE[1]} * hair * hair, 1., clamp(under * vEdge.w + .5, 0., 1.)) : 1.;   // the layer's own body; what stands on it hides outright
    c = vec4(sky * hides * (1. - ground.a) + ground.rgb, hides + ground.a * (1. - hides)) * vColour.a;
  }
  if (vMode > .5) {   // feathered ends
    vec2 pos = vUV * vSoft.xy;
    if (vSoft.z > 0.) c *= clamp(min(pos.x, vSoft.x - pos.x) / vSoft.z, 0., 1.);
    if (vSoft.w > 0.) c *= clamp(min(pos.y, vSoft.y - pos.y) / vSoft.w, 0., 1.);
  }
  // the dark: everything drawn before it is put out, away from the light you carry
  if (uLit < .5 && uDark > 0.) { float u = clamp((distance(vec2(gl_FragCoord.x + uLeft, uRes.y - gl_FragCoord.y), uLamp.xy) - uLamp.z) / (uLamp.w - uLamp.z), 0., 1.); c.rgb = mix(c.rgb, sky * c.a, uDark * (u < .5 ? u * 1.24 : .62 + (u - .5) * .76)); }
  o = c;
}`;
