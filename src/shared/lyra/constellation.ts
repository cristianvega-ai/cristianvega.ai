// The six principal stars of Lyra as flat-chart offsets from Vega in degrees
// (screen x right, y down; RA deltas scaled by cos dec), from J2000 positions.
type LyraStar = { x: number; y: number; name?: string };

/** The label of Vega on every picture. */
export const VEGA_NAME = "VEGA · α LYR";

export const LYRA: LyraStar[] = [
  { x: 0.0, y: 0.0, name: VEGA_NAME },
  { x: -1.44, y: -0.89 }, // epsilon — the Double Double
  { x: -1.54, y: 1.18 }, // zeta
  { x: -3.43, y: 1.81 }, // delta
  { x: -2.57, y: 5.42, name: "SHELIAK" }, // beta
  { x: -4.3, y: 6.09, name: "SULAFAT" }, // gamma
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
