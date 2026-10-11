/** A fixed pseudo-random value in [0, 1) for a seed, so every layout sows the same picture. */
export function unit(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}
