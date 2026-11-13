// The few helpers everything shares.

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// seeded random numbers, so the page is the same page on every visit
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// the one twinkle: a brightness that swings between `floor` and 1
export const twinkle = (time, phase, floor, rate) => floor + (1 - floor) * (0.5 + 0.5 * Math.sin(time * rate + phase));
