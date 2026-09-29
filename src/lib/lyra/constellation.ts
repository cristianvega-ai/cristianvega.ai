// The six principal stars of Lyra as flat-chart offsets from Vega in degrees
// (screen x right, y down; RA deltas scaled by cos dec), from J2000 positions.
export type LyraStar = { x: number; y: number; mag: number; name?: string };

export const LYRA: LyraStar[] = [
  { x: 0.0, y: 0.0, mag: 0.03, name: "VEGA · α LYR" },
  { x: -1.44, y: -0.89, mag: 3.9 }, // epsilon — the Double Double
  { x: -1.54, y: 1.18, mag: 4.36 }, // zeta
  { x: -3.43, y: 1.81, mag: 4.22 }, // delta
  { x: -2.57, y: 5.42, mag: 3.52, name: "SHELIAK" }, // beta
  { x: -4.3, y: 6.09, mag: 3.25, name: "SULAFAT" }, // gamma
];

// The classic figure: Vega→epsilon, Vega→zeta, then around the parallelogram.
export const LYRA_LINKS = [
  [0, 1],
  [0, 2],
  [2, 3],
  [3, 5],
  [5, 4],
  [4, 2],
] as const;
