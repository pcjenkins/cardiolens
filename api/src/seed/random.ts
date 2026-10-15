// Deterministic pseudo-random numbers, so every seed produces exactly the same dataset.

export type Rng = {
  next(): number;                                 // [0, 1)
  normal(mean: number, sd: number): number;
  int(min: number, max: number): number;          // inclusive
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  poisson(lambda: number): number;
};

export function createRng(seed: number): Rng {
  // mulberry32: small, fast, good enough for simulation.
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    normal(mean, sd) {
      const u = 1 - next(), v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    poisson(lambda) {
      // Knuth; fine for the small lambdas used here.
      const l = Math.exp(-lambda);
      let k = 0, p = 1;
      do { k++; p *= next(); } while (p > l);
      return k - 1;
    },
  };
  return rng;
}
