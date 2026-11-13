// Art direction: the glyph vocabulary, the vertical composition, the stops,
// and how things move. A night-mountain woodcut done in type: cold and
// sparse at the top, dense and warm at the bottom, ember for anything you
// can read. Colours are not here: the palette is the page's, in styles.css.

export const D = {
  glyphs: {
    shootHead: '✦', shootTail: ['*', '=', '-', '-', '.', '.'],
    bird: ['~v~', ' v ', '^v^', ' v '],
    leaves: [',', "'", '~'],
    rock: ['%', '#', '*', '+', '=', ':', '-', '.'],   // light → dark
    trees: [
      ['  ^  ', ' /^\\ ', '/^^^\\', '  |  '],
      ['  ^  ', ' /|\\ ', ' /|\\ ', '/|||\\'],
      ['   ^   ', '  / \\  ', ' /^^^\\ ', '/^^^^^\\', '  /|\\  '],
    ],
    ground: ['.', ',', ':', "'", '.', ','],
  },

  // type size of the painting, in pixels
  type: { stack: 11, mid: 13, wide: 14, wideFrom: 1100 },

  // vertical composition, in screen heights from the top of the page
  layout: {
    screens: 10.5,
    name: 0.34,
    shooting: [0.35, 3.95],
    birds: [3.3, 4.4],
    summit: 3.72, apexX: 0.52,
    snowBottom: 4.4,
    flakesFrom: 4.1,
    route: [4.6, 6.2],
    treeline: 5.4,
    leavesFrom: 5.6,
    groundFrom: 8.3, base: 8.6,
  },

  // The stops, top to bottom. Each id is a card in index.html. `at` is the
  // stop's light in the painting: [screens from the top, fraction across].
  // Card timing, card side, the glide's resting places and the tap targets
  // all come from this one list.
  stops: [
    { id: 'sky', until: 0.72 },               // the name; open from the top until here
    { id: 'ucp', at: [1.37, 0.68] },
    { id: 'w3c', at: [2.02, 0.26] },
    { id: 'fido', at: [2.67, 0.74] },
    { id: 'shopify', at: [3.32, 0.36] },
    { id: 'summit', rest: 3.84 },             // somewhere to rest, nothing to read
    { id: 'climb', at: [4.69, 0.62] },
    { id: 'subscriptions', at: [5.84, 0.30] },
    { id: 'fera', at: [6.54, 0.70] },
    { id: 'first', at: [7.24, 0.34] },
    { id: 'base', at: [9.7, 0.66] },          // the last stop stays open to the end
  ],
  // when a stop's card is open: the viewport centre, in screens from its light.
  // stack: the card sits under the scene, so it opens once the light is above it.
  // side: the card sits beside the light.
  band: { stack: [-0.04, 0.44], side: [-0.27, 0.28] },
  rest: { stack: 0.16, side: 0.005 },         // where a glide settles, same measure
  fade: 0.19,                                 // screens a card takes to come and go

  // a stop's light. Sizes in pixels at the stack type size; [resting, lit]
  light: { star: [15, 17], bloom: [25, 31], bloomAlpha: [0.15, 0.22], pitch: 11, ring: 0.45, clear: 27, hollow: [32, 44] },

  // the name's thread: straight, a dot every half cell, alternating bright and dim
  thread: { perCell: 2, bright: 0.95, dim: 0.6 },
  // a card's tether: a string of the same dots, strung by hand and never the same twice.
  // Pixels at the stack type size. step: gap between stars at the stop's resting place.
  // jitter: how unevenly they sit. miss: share left out. wander: two waves off the
  // straight path, each [how far, fewest, most waves along the string].
  // slack: how much wavier it may get when short, how much straighter when long.
  tether: { step: [6, 9], jitter: 0.9, miss: 0.08, alpha: [0.45, 0.95], wander: [[4.5, 1.1, 2.4], [2, 3, 5.5]], slack: [0.55, 1.7] },

  // twinkles: [darkest, rate]
  twinkle: { field: [0.2, 1.4], name: [0.25, 1.3], thread: [0.24, 2.6], light: [0.6, 2.4], lamp: [0.4, 3.1] },

  // springs: [stiffness, damping, furthest, push radius, push strength, scroll shove]
  spring: { star: [7, 0.5, 3, 5, 2.5, 1], light: [12, 0.6, 1.2, 5, 1.2, 0.6] },
  // pointer push on things that fall or fly: [radius, strength]
  push: { bird: [4, 3], fall: [5, 2.5] },
  // falling: [rows per second, sway]
  fall: { flake: [2.5, 0.8], leaf: [1.8, 1.5] },
  // how often things appear
  spawn: { shoot: [3.5, 2.5], bird: [4, 6], flake: [9, 90], leaf: [5, 80] },   // [seconds, spread] / [seconds, most] / [per second, most]
};
