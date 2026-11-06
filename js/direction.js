// Art direction: palette, glyph vocabulary, vertical composition.
// A night-mountain woodcut done in type. Cold and sparse at the top, dense
// and warm at the bottom. Only ember is warm above the treeline.

export const D = {
  palette: {
    sky: '#070a14', skyBase: '#0b0907',
    starDim: '#5a6a86', star: '#c9d8ee', starBright: '#f2f6ff',
    ember: '#f3c86b', nameLine: '#7f93b4',
    rockLight: '#8c9bb8', rock: '#4f5e7c', rockDark: '#2f3a56', far: 'rgba(42,52,80,0.6)',
    snow: '#eef3fb', snowShade: 'rgba(238,243,251,0.55)',
    bird: '#b8c6da',
    pine: '#3f7a55', pineDark: '#24513a',
    leaf: '#d08a3a', leafOlive: '#9aa84a',
    ground: '#6b5236', groundDark: '#3d2e21',
  },
  glyphs: {
    starTiers: [['.', '·'], ['*', '+'], ['✦']],   // dim → bright
    shootHead: '✦', shootTail: ['*', '=', '-', '-', '.', '.'],
    bird: ['~v~', ' v ', '^v^', ' v '],
    birdFar: ['v', '-'],
    flakes: ['*', '.', '+'], flakeWeights: [0.5, 0.35, 0.15],
    leaves: [',', "'", '~'],
    rock: ['%', '#', '*', '+', '=', ':', '-', '.'],   // light → dark
    trees: [
      ['  ^  ', ' /^\\ ', '/^^^\\', '  |  '],
      ['  ^  ', ' /|\\ ', ' /|\\ ', '/|||\\'],
      ['   ^   ', '  / \\  ', ' /^^^\\ ', '/^^^^^\\', '  /|\\  '],
    ],
    ground: ['.', ',', ':', "'", '.', ','],
  },
  // vertical composition in screen heights from the top of the page
  layout: {
    screens: 10.5,
    name: 0.34, subtitle: 0.52, hint: 0.70,
    shooting: [0.35, 3.95],
    stars: [[1.37, 0.68], [2.02, 0.26], [2.67, 0.74], [3.32, 0.36]], // [screen, x fraction]
    birds: [3.3, 4.4],
    summit: 3.72, apexX: 0.52,
    snowBottom: 4.4,
    flakesFrom: 4.1,
    climb: 4.9, route: [4.6, 6.2],
    treeline: 5.4,
    leavesFrom: 5.6,
    history: [6.1, 6.8, 7.5],
    groundFrom: 8.3, base: 8.6,
    final: 9.6,
  },
};
