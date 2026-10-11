/** A fixed pseudo-random value in [0, 1) for an index, so every layout sows the same picture. */
export function unit(index: number): number {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}
