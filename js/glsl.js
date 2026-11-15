// The instance contract. Everything drawn is one 24-byte instance; pack.js and live.js write them through
// `writer`, and the two shaders below are the only other code that knows what the bytes mean.

export const BYTES = 24;
// attribute: [name, components, type, byte offset]
export const FORMAT = [['aAnchor', 2, 'FLOAT', 0], ['aLocal', 2, 'SHORT', 8], ['aExt', 2, 'UNSIGNED_SHORT', 12], ['aK', 1, 'UNSIGNED_SHORT', 16], ['aG', 4, 'UNSIGNED_BYTE', 18], ['aKP', 2, 'UNSIGNED_BYTE', 22]];
export const KIND = { plain: 0, star: 1, tree: 2, snow: 3, leaf: 4, cloud: 5, route: 6 };
export const INK = 1, WASH = 2, MIST = 4;   // bits of p: centred on its ink · a solid filled with its lobe's ground · the ground alone, hiding nothing
export const LAYERS = 40, LADDER = [-8, 9];   // layers in the table; the atlas's sizes, in quarter octaves of the type size

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
uniform float uType, uTime, uS;           // type size in device px; seconds; rows to a screen
uniform vec3 uPalette[40];                // [0] is the sky of the moment
uniform vec4 uLamp;                       // the light you carry: x, y, where its dark begins, where it is full (device px)
uniform float uDark, uLit;                // how dark the dark is; 1 for things drawn after it
uniform vec4 uWashBox;                    // this lobe's ground texture: its first column and row, its size in cells
`;

export const VERTEX = COMMON + `
layout(location=0) in vec2 aAnchor; layout(location=1) in vec2 aLocal; layout(location=2) in vec2 aExt;
layout(location=3) in float aK; layout(location=4) in vec4 aG; layout(location=5) in vec2 aKP;
layout(std140) uniform Layers { vec4 A[${LAYERS}]; vec4 B[${LAYERS}]; vec4 C[${LAYERS}]; };   // A: X, s, centreRow, vis · B: tone, ref, growLo, growHi · C: depth, cx, drift, span
uniform sampler2D uMetrics;               // per glyph (row) and size (column pair): its box in the atlas, where its ink sits from its origin
uniform vec4 uQuiet[6];                   // boxes of text the stars keep clear of (device px), and uHush how much
uniform float uHush, uAltStar;
uniform vec2 uLean, uPointer; uniform float uPush;   // the sky's lean against the scroll; the pointer (cells) and how much it pushes
out vec2 vUV, vCell; out vec4 vColour; flat out float vMode;

float smooth01(float a, float b, float x) { float u = clamp((x - a) / (b - a), 0., 1.); return u * u * (3. - 2. * u); }
float twinkle(float phase, float low, float rate) { return low + (1. - low) * (.5 + .5 * sin(uTime * rate + phase)); }

void main() {
  int li = int(aG.w), kind = int(aKP.x), p = int(aKP.y); float glyph = aG.x, alpha = aG.z / 255., k = aK / 1024.;
  vec4 a = A[li], b = B[li], c = C[li]; vec2 anchor = aAnchor, corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  float s = a.y;
  if (kind == ${KIND.cloud} && c.w > 0.) anchor.x = mod(anchor.x + c.z * uTime, c.w);   // a cloud drifts round its layer
  if (kind == ${KIND.tree}) k = min(2. / s, k * exp(.42 * clamp((clamp(anchor.y, b.z, b.w) - b.y) / uS, -1.6, 1.6)));   // a tree grows as you come down to it
  if (kind == ${KIND.star}) {
    float phase = aExt.x / 65535. * 6.28, tier = aExt.y; vec2 px = (anchor + .5 - vec2(0., a.z - uRes.y / uCell.y / 2.)) * uCell;
    if (uHush > .01) { float d = 1e9; for (int i = 0; i < 6; i++) { vec4 q = uQuiet[i]; if (q.z > q.x) d = min(d, length(max(max(q.xy - px, px - q.zw), 0.))); } alpha *= 1. - uHush * (1. - smooth01(8., 22., d / (uType / 11.))); }
    if (phase < 2.1) { alpha *= twinkle(7. * phase, .2, 1.4 + phase); if (tier > 1.5 && sin(1.7 * uTime + 5. * phase) < -.2) glyph = uAltStar; }
    else if (tier > 1.5 && sin(1.7 * uTime + phase) < -.3) glyph = uAltStar;
    vec2 away = (anchor + .5 - uPointer) * vec2(uCell.x / uCell.y, 1.); float far = length(away);
    anchor += uLean + (far < 5. && far > 1e-4 ? away / far * (1. - far / 5.) * 2.5 * smooth01(0., 1.2, far) * uPush / vec2(uCell.x / uCell.y, 1.) : vec2(0.));
  }
  vec2 own = uCell * s * k;                                   // its own cell, device px
  vec2 at = vec2((a.x + (anchor.x - c.y) * s) * uCell.x, uRes.y / 2. + (anchor.y - a.z) * uCell.y * s) + aLocal / 256. * own, size;
  vColour = vec4(uPalette[int(aG.y)], alpha * a.w); vMode = 0.;
  if (glyph < .5) {                                           // a solid
    size = aExt / 32. * own; vMode = float(1 + (p & ${WASH | MIST}));
    if ((p & ${MIST}) == 0) vColour.a = a.w; else vColour.a = a.w * b.x;
    vColour.rgb = vec3(b.x);                                  // carries the tone to the ground texture
    vCell = (at + corner * size - vec2((a.x - c.y * s) * uCell.x, uRes.y / 2. - a.z * uCell.y * s)) / (uCell * s);
  } else {
    vColour.a *= b.x;
    float want = uType * s * k, lv = clamp(ceil(log2(want / uType) * 4. - .001), ${LADDER[0]}., ${LADDER[1]}.), q = uType * exp2(lv / 4.), f = want / q;
    ivec2 m = ivec2(int(lv) - (${LADDER[0]}), int(glyph)) * ivec2(2, 1); vec4 box = texelFetch(uMetrics, m, 0), ink = texelFetch(uMetrics, m + ivec2(1, 0), 0);
    size = box.zw * f; at += ((p & ${INK}) != 0 ? -box.zw / 2. : vec2(ink.x, .9 * q + ink.y)) * f;
    if (abs(f - 1.) < .004) at = floor(at + .5);              // type at the size it was drawn is set on the pixel
    vUV = box.xy + corner * box.zw;
  }
  vec2 pos = at + corner * size;
  gl_Position = vec4(pos / uRes * vec2(2., -2.) + vec2(-1., 1.), c.x, 1.);
}`;

export const FRAGMENT = COMMON + `
uniform sampler2D uAtlas, uWash;
in vec2 vUV, vCell; in vec4 vColour; flat in float vMode;
out vec4 o;
void main() {
  vec3 sky = uPalette[0]; vec4 c;
  if (vMode < .5) c = vec4(vColour.rgb, 1.) * (vColour.a * texture(uAtlas, vUV / vec2(textureSize(uAtlas, 0))).r);
  else if (vMode < 1.5) c = vec4(sky, 1.) * vColour.a;
  else {
    vec4 w = texture(uWash, (vCell - uWashBox.xy) / uWashBox.zw) * vColour.r;                  // premultiplied ground, at this lobe's tone
    c = vMode > 4.5 ? w * vColour.a : vec4(sky * (1. - w.a) + w.rgb, 1.) * vColour.a;
  }
  if (c.a < .003) discard;
  // the dark: everything drawn before it is put out, away from the light you carry
  if (uLit < .5 && uDark > 0.) { float d = distance(gl_FragCoord.xy * vec2(1., -1.) + vec2(0., uRes.y), uLamp.xy), u = clamp((d - uLamp.z) / (uLamp.w - uLamp.z), 0., 1.); c.rgb = mix(c.rgb, sky * c.a, uDark * (u < .5 ? u * 1.24 : .62 + (u - .5) * .76)); }
  o = c;
}`;
