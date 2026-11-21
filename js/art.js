// Art direction, as data. No functions: what the picture is made of and where things stand.

export const PALETTE = {
  sky: '#070a14', skyBase: '#0b0907', ink: '#e3e9f3', muted: '#8d9bb4', dim: '#5a6a86', rule: '#7f93b4', star: '#c9d8ee',
  starBright: '#f2f6ff', white: '#ffffff', thread: '#becee8', ember: '#f3c86b', emberHot: '#ffe196', rockLight: '#8c9bb8',
  rock: '#4f5e7c', rockDark: '#2f3a56', far: '#2a3450', snow: '#eef3fb', bird: '#b8c6da', pine: '#3f7a55', pineDark: '#24513a',
  leaf: '#d08a3a', leafOlive: '#9aa84a', ground: '#6b5236', groundDark: '#3d2e21',
};
// colours mixed from two of the palette: [a, b, how much of b]
export const MIXES = { earth: ['skyBase', 'groundDark', 0.3], timber: ['leaf', 'snow', 0.25], wood: ['ground', 'leaf', 0.45], bridge: ['ground', 'rockLight', 0.45], moss: ['pine', 'leafOlive', 0.45] };

// the type size for a viewport width, and the narrow ("stack") layout
export const TYPE = { stackBelow: 600, sizes: [[600, 11], [1099, 13], [Infinity, 14]], maxDpr: 2, stage: 1120 };

// where things are down the page, in screens from the top
export const LAYOUT = {
  screens: 10.5, name: 0.34, shooting: [0.35, 3.95], summit: 3.72, apexX: 0.52, seam: 4.42, deck: [4.1, 4.92], snow: [4.62, 6.55],
  ice: 5.25, treeline: 5.5, forest: 6.3, ground: 10, measure: 9.5, blend: 3,
};

// the stops, in order. at: [screens from the top, fraction across the stage]
export const STOPS = [
  { id: 'sky', open: 0.72 },
  { id: 'ucp', at: [1.37, 0.68] }, { id: 'w3c', at: [2.02, 0.26] }, { id: 'fido', at: [2.67, 0.74] }, { id: 'shopify', at: [3.32, 0.36] },
  { id: 'summit', rest: 3.84 },
  { id: 'climb', at: [4.69, 0.62], mark: 'axe' }, { id: 'subscriptions', at: [5.84, 0.30], mark: 'cairn' },
  { id: 'fera', at: [6.54, 0.70], mark: 'post' }, { id: 'first', at: [7.24, 0.34], mark: 'post' },
  { id: 'base', at: [9.7, 0.66], mark: 'hut' },
];
// when a card is open (viewport centre, screens from its light) and where a glide settles, by layout
export const CARD = { band: { stack: [-0.04, 0.44], side: [-0.27, 0.28] }, rest: { stack: 0.16, side: 0.005 }, fade: 0.19 };

// the name: each letter is a few stars joined by a few lines, in a 0..1 box with y up
export const LETTERS = {
  d: [[[.72, .98], [.66, .42], [.74, .03], [.30, .52], [.06, .18], [.36, .04]], [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 2]]],
  a: [[[.58, .55], [.14, .44], [.10, .08], [.56, .12], [.68, 0]], [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4]]],
  n: [[[.08, .60], [.12, .02], [.30, .56], [.62, .52], [.70, .04]], [[0, 1], [0, 2], [2, 3], [3, 4]]],
  i: [[[.46, .86], [.44, .56], [.40, .04]], [[1, 2]]],
  e: [[[.08, .34], [.62, .38], [.54, .58], [.32, .68], [.10, .52], [.12, .10], [.58, .04]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 5], [5, 6]]],
  l: [[[.44, 1], [.38, .50], [.48, .02], [.66, .06]], [[0, 1], [1, 2], [2, 3]]],
  w: [[[.02, .58], [.22, .02], [.44, .44], [.66, 0], [.88, .60]], [[0, 1], [1, 2], [2, 3], [3, 4]]],
  y: [[[.08, .58], [.34, .04], [.64, .60], [.22, -.34]], [[0, 1], [2, 1], [1, 3]]],
  c: [[[.62, .50], [.20, .54], [.06, .26], [.22, .02], [.60, .08]], [[0, 1], [1, 2], [2, 3], [3, 4]]],
  k: [[[.14, 1], [.10, .04], [.56, .52], [.16, .30], [.62, 0]], [[0, 1], [2, 3], [3, 4]]],
  o: [[[.34, .60], [.06, .34], [.26, .02], [.64, .16], [.60, .50]], [[0, 1], [1, 2], [2, 3], [3, 4]]],
  f: [[[.62, .96], [.34, .76], [.28, .04], [.08, .50], [.54, .48]], [[0, 1], [1, 2], [3, 4]]],
};
export const NAME = { advance: { i: 0.72, l: 0.84 }, wide: 1.12, last: 0.75, tight: 0.84, lines: [0.62, -0.78], indent: [1.0, 0.4], clear: [20, 15] };

// every character the scene sets
export const CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~·✦';

// the massif: cut-outs on a turntable
export const MASSIF = {
  turn: [4.25, 9.6], turns: 0.6, ease: 0.16, depth: 0.42, lead: 0.14, haze: [1.1, 1.65], stride: [0.3, 1.25], sparse: 'fera',
  forms: [[1.0, 1.35, 2, 0.62, 3.1, 0], [1.5, 1.15, 8, 0.6, 4.4, 0], [0.9, 2.5, 3, 0.66, 3.5, -22], [1.25, 1.0, 5, 0.6, 3.8, 0]],   // long ridges: [left, right, level top, widening, width, top off centre]
  lamp: { dark: 0.62, core: 0.18, reach: 0.78 },
};
// trees, rows top to bottom: three pines, three broadleaves
export const TREES = {
  A: ['  ^  ', ' /^\\ ', '/^^^\\', '  |  '],
  B: ['  ^  ', ' /|\\ ', ' /|\\ ', '/|||\\'],
  C: ['   ^   ', '  / \\  ', ' /^^^\\ ', '/^^^^^\\', '  /|\\  '],
  D: ['   ,&&,   ', ' ,&&&&&&, ', '(&&&&&&&&)', '(&&&&&&&&)', '   \\||/   ', '    ||    '],
  E: ['    ,&,    ', '  ,&&&&&,  ', ' (&&&&&&&) ', '(&&&&&&&&&)', '(&&&&&&&&&)', '    \\|/    ', '     |     '],
  F: ['  ,&&,  ', ' (&&&&) ', '(&&&&&&)', '(&&&&&&)', '  \\||/  ', '   ||   '],
};
export const LEAF_ROW = 0.74;   // a broadleaf's rows sit this close, so its crown is one mass of leaves
