// Art direction: the glyph vocabulary, the vertical composition, the stops,
// and how things move. A night-mountain woodcut done in type: cold and
// sparse at the top, dense and warm at the bottom, ember for anything you
// can read. Colours are not here: the palette is the page's, in styles.css.

export const D = {
  glyphs: {
    shootHead: '✦', shootTail: ['*', '=', '-', '-', '.', '.'],
    leaves: [',', "'", '~'],
    rock: ['%', '#', '*', '+', '=', ':', '-', '.'],   // light → dark
    hut: ['      ,     ', '   ___|]__  ', '  /       \\ ', ' /_________\\', ' |  []  _  |', ' |_____|_|_|'],
  },

  // type size of the painting, in pixels. most: the largest that type is ever set, in that size:
  // what stands nearer than that is drawn with more characters, not larger ones
  type: { stack: 11, mid: 13, wide: 14, wideFrom: 1100, most: 1.2 },

  // vertical composition, in screen heights from the top of the page
  layout: {
    screens: 10.5,
    name: 0.34,
    shooting: [0.35, 3.95],
    summit: 3.72, apexX: 0.52,
    seam: 4.42,            // the painted peak ends here, inside the clouds
    deck: [4.1, 4.92],     // the cloud deck
    snow: [4.62, 6.55],    // snow falls from the cloud base and thins out among the first trees
    ice: 5.25,             // the route is a fixed rope down to here, a path after
    treeline: 5.5,         // first trees
    forest: 6.3,           // closed forest
    ground: 10,            // about where the ground is; the scene puts the line exactly half a screen from its end
  },
  // The camera. from: screens down the page where it starts to back away (the cloud line in the middle of the screen).
  // above: how far above the light you carry the horizon is, in screens. back: how far it has backed away by the end,
  // in the page's own distances. ease: screens it takes to get going. top: where the summit stands at the end, in
  // screens from the top. slant: how far it slides sideways for a screen of scroll, in screen widths, and the tangents
  // that is kept within. ramp: screens the slant takes to come in, to the first bridge. rise: how much more it is on
  // the last row, as a share of itself.
  camera: { from: 4.55, above: 0.17, back: 6.5, ease: 0.45, top: 0.07, slant: 0.12, within: [0.075, 0.2], ramp: 0.9, rise: 0.15 },
  // The mountain and the terraces below it. sweep: how far either side of the middle the path goes on each terrace,
  // and jump: how far across the screen a bridge takes it, as shares of the screen's width [wide, narrow]. cross: screens
  // of scroll a bridge takes to cross. slice: screens of scroll on one terrace. apart: a bridge at least this often, in
  // screens. near: how far off the terrace you step onto is, in the page's distances. cliff: rows a column a cliff falls.
  // fade: the distances over which a terrace goes into the mist. tall: how tall each kind of tree stands, in rows.
  // ribs: the mountain's ribs under the peak, each [where across, as a share of its half-width either side of its middle;
  // screens under the seam that it starts]. spread: how much wider they stand for each screen down. cast: how wide a rib's
  // shadow is on the lit flank, and how wide its lit face on the dark one, as shares of the half-width.
  // lamp: the light you carry: how much of everything out of its reach is put out, and where it is full and where it
  // ends, as shares of the screen's shorter side.
  massif: { sweep: [0.17, 0.26], jump: [0.15, 0.3], cross: 0.08, slice: 0.24, apart: 1.15, near: 0.85, cliff: 1.8, fade: [1.9, 3.4], tall: { pine: 4.6, leafy: 3.8, birch: 5.5 }, ribs: [[-0.78, 0.5], [-0.55, 0.05], [-0.27, 0.8], [0, 0], [0.2, 0.6], [0.45, 0.05], [0.74, 0.95]], spread: 1.8, cast: [0.09, 0.13], lamp: { dark: 0.62, core: 0.18, reach: 0.78 } },

  // The stops, top to bottom. Each id is a card in index.html. `at` is the
  // stop's light in the painting: [screens from the top, fraction across the
  // stage]. The stage is the screen, up to the width set in the stylesheet.
  // Card timing, card side, the glide's resting places and the tap targets
  // all come from this one list.
  stops: [
    { id: 'sky', until: 0.72 },               // the name; open from the top until here
    { id: 'ucp', at: [1.37, 0.68] },
    { id: 'w3c', at: [2.02, 0.26] },
    { id: 'fido', at: [2.67, 0.74] },
    { id: 'shopify', at: [3.32, 0.36] },
    { id: 'summit', rest: 3.84 },             // somewhere to rest, nothing to read: the flag
    { id: 'climb', at: [4.69, 0.62], mark: 'axe' },         // on the mountain a stop is a waypoint: a lantern on what stands there
    { id: 'subscriptions', at: [5.84, 0.30], mark: 'cairn' },
    { id: 'fera', at: [6.54, 0.70], mark: 'post' },
    { id: 'first', at: [7.24, 0.34], mark: 'post' },
    { id: 'base', at: [9.7, 0.66], mark: 'hut' },   // the last stop stays open to the end; its waypoint is the hut's window
  ],
  // when a stop's card is open: the viewport centre, in screens from its light.
  // stack: the card sits under the scene, so it opens once the light is above it.
  // side: the card sits beside the light.
  band: { stack: [-0.04, 0.44], side: [-0.27, 0.28] },
  rest: { stack: 0.16, side: 0.005 },         // where a glide settles, same measure
  fade: 0.19,                                 // screens a card takes to come and go

  // a stop's light. Sizes in pixels at the stack type size; [resting, lit]
  light: { star: [15, 17], bloom: [25, 31], bloomAlpha: [0.15, 0.22], pitch: 11, ring: 0.45, clear: 27 },

  // the name's thread: straight, a dot every half cell, alternating bright and dim
  thread: { perCell: 2, bright: 0.95, dim: 0.6 },
  // a card's tether: a string of the same dots, strung by hand and never the same twice.
  // Pixels at the stack type size. step: gap between stars at the stop's resting place.
  // jitter: how unevenly they sit. miss: share left out. wander: two waves off the
  // straight path, each [how far, fewest, most waves along the string].
  // slack: how much wavier it may get when short, how much straighter when long.
  // lag: the most of the page's speed, rows a second, that its middle is left behind by.
  tether: { step: [6, 9], jitter: 0.9, miss: 0.08, alpha: [0.45, 0.95], wander: [[4.5, 1.1, 2.4], [2, 3, 5.5]], slack: [0.55, 1.7], lag: 14 },

  // twinkles: [darkest, rate]
  twinkle: { field: [0.2, 1.4], name: [0.25, 1.3], thread: [0.24, 2.6], light: [0.6, 2.4], lamp: [0.4, 3.1] },

  // springs: [stiffness, damping, furthest, push radius, push strength, scroll shove]
  // A light only leans from a pointer (a small push), so it can be pointed at and tapped.
  // A tether's stars use the sky's spring with more room, so the string bows instead of flattening.
  spring: { star: [7, 0.5, 3, 5, 2.5, 1], light: [12, 0.6, 1.2, 5, 0.5, 0.6], tether: [7, 0.5, 5, 5, 2.5, 1] },
  // the scroll's shove: [how hard per row a second of scroll, the most it ever pushes].
  // The most keeps a star's lean (most / stiffness squared = 2.5 rows) inside its furthest.
  shove: [0.9, 122],
  // core: rows around the pointer where its push fades to nothing, so a thing
  // right under it rests instead of snapping from one side to the other
  push: { core: 1.2 },
  // room kept clear of field stars, in pixels at the stack type size.
  // name: around each of the name's stars, and along its threads.
  // text: around the lines under the name; gone inside the first, back to full by the second.
  clear: { name: [20, 15], text: [8, 22] },
  // the glide between stops. touch, wheel: friction per second. reach: screens out
  // from a stop where braking starts. near: a stop this close ahead is the one you
  // are at, and a real fling goes past it. line: pixels for a wheel that counts in lines.
  // notch: a wheel step at least this big is a mouse wheel, not a trackpad's tail.
  // gap: ms of silence that ends a wheel gesture. coast: ms of silence before it brakes.
  // land: the slowest a braked glide finishes at, px a second. fling: slowest and fastest release that glides.
  glide: { touch: 1.7, wheel: 4, reach: 0.6, near: 0.15, land: 30, line: 33, notch: 40, gap: 120, coast: 70, fling: [80, 7000] },
  // shooting stars. speed: screen widths a second, averaged over the crossing
  // (slowest, fastest). peak: the fastest any one may move at its nearest.
  // depth: how many times further its far end is than its near end.
  // near: its near end, in focal lengths. toward: share that fly toward you.
  // top: share that come in over the top edge when the sky above is open.
  // cross: the longest crossing, in screen widths.
  shoot: { speed: [0.28, 0.54], peak: 1.15, depth: [1.4, 3.2], near: [0.5, 1.0], toward: 0.6, top: 0.5, cross: 1.25 },
  // how often things appear
  spawn: { shoot: [3.5, 2.5] },   // [seconds, spread]
};
