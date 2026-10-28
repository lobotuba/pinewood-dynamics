// Seeded random numbers for reproducible synthetic studies (PHY-005 determinism).

/** Mulberry32: a small 32-bit generator; uniform in [0, 1). */
export function uniform(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal deviates by Box-Muller. */
export function gaussian(seed: number): () => number {
  const u = uniform(seed);
  return () => {
    const u1 = 1 - u(); // (0, 1]
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u());
  };
}
