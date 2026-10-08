import type { Point } from "../motion/easing.ts";
import { LYRA, LYRA_LINKS } from "../lyra/constellation.ts";

export interface GlobeNode extends Point {
  radius: number;
  alpha: number;
  layer: number;
  hot: boolean;
  vega: boolean;
  /** Share of the entrance that passes before the neuron appears. */
  start: number;
}

export interface GlobeEdge {
  a: GlobeNode;
  b: GlobeNode;
  hot: boolean;
  layer: number;
  alpha: number;
  /** Share of the entrance that passes before the edge starts to draw. */
  start: number;
  /** The end the edge grows from. It is the far end of the sphere, or the end far from Vega. */
  from: GlobeNode;
}

/**
 * One signal of the entrance. A comet follows a chain of edges from a neuron
 * on the near face and ends on Vega. The chain is a real path in the graph.
 */
export interface GlobeRoute {
  /** The chain of nodes, from the start to Vega. */
  points: Point[];
  /** Running length at each point, so a frame finds its place without a search. */
  lengths: number[];
  length: number;
  /** Share of the entrance that passes before the comet starts. */
  start: number;
  /** Share of the entrance that the comet takes to reach Vega. */
  span: number;
}

/**
 * A label sits at an anchor on the globe grid. The offset is in CSS pixels,
 * so the text keeps its size and its distance from the anchor at any scale.
 */
export interface GlobeLabel extends Point {
  text: string;
  alpha: number;
  align: "left" | "center";
  dx: number;
  dy: number;
}

export interface GlobeRing extends Point {
  rx: number;
  ry: number;
  rotate: number;
  alpha: number;
}

export interface Globe {
  width: number;
  height: number;
  nodes: GlobeNode[];
  edges: GlobeEdge[];
  hotNodes: GlobeNode[];
  hotEdges: GlobeEdge[];
  /** The entrance comets, in the order they start. */
  routes: GlobeRoute[];
  labels: GlobeLabel[];
  rings: GlobeRing[];
  stars: (Point & { radius: number; alpha: number })[];
  /** Radians. The entrance settles the whole figure from this turn to zero. */
  rotation: number;
}

/** The size of the globe grid. The SVG and the canvas both draw on it and scale it to their box. */
export const GLOBE_WIDTH = 600;
export const GLOBE_HEIGHT = 500;

const NODE_COUNT = 70;
const GOLDEN_ANGLE = 2.399963;
const EDGE_REACH = 0.53;
// A comet runs only along the brighter edges of the near face and the hot edges.
const ROUTE_MINIMUM_ALPHA = 0.12;
const ROUTE_COUNT = 12;
// A comet starts no closer to Vega than this, so every route is a real journey.
const ROUTE_MINIMUM_REACH = 170;
// Grid units per share of the entrance. The comets share one speed.
const ROUTE_SPEED = 1150;
// The first arrival and the last arrival, as shares of the entrance.
const ARRIVAL_FIRST = 0.64;
const ARRIVAL_LAST = 0.9;

/** Shares of the entrance that one edge takes to draw, and that one neuron takes to appear. */
export const EDGE_SPAN = 0.22;
export const NODE_SPAN = 0.14;
// The mesh draws from the far side to the near side. The figure draws after it, toward Vega.
const MESH_START = 0;
const MESH_REACH = 0.28;
const FIGURE_START = 0.36;
const FIGURE_REACH = 0.28;
const VEGA_START = 0.7;
// Vega sits this far right of the sphere centre, in sphere radii. From 1100px the box runs past the
// screen edge, so Vega stays near the centre and the crop never reaches the star or its name.
const VEGA_OFFSET_X = 0.12;

// A fixed pseudo-random sequence, so every draw sows the same field.
function unit(i: number): number {
  const value = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * The shortest chain of edges from every node to Vega, by Dijkstra on the
 * bright edges. Returns the step each node takes toward Vega.
 */
function stepsToVega(globe: Globe, vega: GlobeNode): Map<GlobeNode, GlobeNode> {
  const next = new Map<GlobeNode, GlobeNode>();
  const cost = new Map<GlobeNode, number>([[vega, 0]]);
  const open = new Set<GlobeNode>([vega]);
  const links = globe.edges.filter((edge) => edge.hot || edge.alpha >= ROUTE_MINIMUM_ALPHA);
  while (open.size) {
    let node!: GlobeNode;
    for (const candidate of open) if (!node || cost.get(candidate)! < cost.get(node)!) node = candidate;
    open.delete(node);
    for (const edge of links) {
      const other = edge.a === node ? edge.b : edge.b === node ? edge.a : undefined;
      if (!other) continue;
      const total = cost.get(node)! + Math.hypot(edge.a.x - edge.b.x, edge.a.y - edge.b.y);
      if (total < (cost.get(other) ?? Infinity)) {
        cost.set(other, total);
        next.set(other, node);
        open.add(other);
      }
    }
  }
  return next;
}

/**
 * The comets of the entrance. One neuron per sector around the sphere starts a
 * comet, and each follows the graph to Vega. The routes merge on the way up the
 * figure, so the light reads as one flow toward the star. The comets share one
 * speed and arrive in turn, the longest journey first.
 */
function buildRoutes(globe: Globe, sphere: GlobeNode[], vega: GlobeNode, cx: number, cy: number): GlobeRoute[] {
  const next = stepsToVega(globe, vega);
  const reach = (node: GlobeNode) => Math.hypot(node.x - vega.x, node.y - vega.y);
  const starts: GlobeNode[] = [];
  for (let sector = 0; sector < ROUTE_COUNT; sector++) {
    let best: GlobeNode | undefined;
    for (const node of sphere) {
      const turn = (Math.atan2(node.y - cy, node.x - cx) + Math.PI) / (Math.PI * 2);
      if (Math.floor(turn * ROUTE_COUNT) !== sector || !next.has(node) || node.alpha < 0.3 || reach(node) < ROUTE_MINIMUM_REACH) continue;
      if (!best || reach(node) > reach(best)) best = node;
    }
    if (best) starts.push(best);
  }
  const chains = starts.map((start) => {
    const points: GlobeNode[] = [start];
    while (points[points.length - 1] !== vega) points.push(next.get(points[points.length - 1])!);
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    return { points, lengths, length: lengths[lengths.length - 1] };
  });
  chains.sort((p, q) => q.length - p.length);
  return chains.map((chain, i) => {
    const span = chain.length / ROUTE_SPEED;
    const arrival = ARRIVAL_FIRST + (ARRIVAL_LAST - ARRIVAL_FIRST) * (chains.length > 1 ? i / (chains.length - 1) : 1);
    return {
      points: chain.points.map(({ x, y }) => ({ x, y })),
      lengths: chain.lengths,
      length: chain.length,
      start: Math.max(0, arrival - span),
      span: Math.min(span, arrival),
    };
  });
}

/**
 * When each neuron and edge appears. The mesh draws from the far side of the
 * sphere to the near side. The hot figure draws after it, from the parts far
 * from Vega toward the star, and Vega is the last neuron to appear.
 */
function schedule(globe: Globe, depths: Map<GlobeNode, number>, vega: GlobeNode) {
  const reach = (node: GlobeNode) => Math.hypot(node.x - vega.x, node.y - vega.y);
  const farthest = Math.max(...globe.hotNodes.map(reach), 1);
  // A little jitter in the start times keeps the reveal from stepping in rows.
  const jitter = (i: number) => unit(i * 5 + 1) * 0.05;
  const inward = (distance: number) => 1 - Math.min(1, distance / farthest);
  const before = globe.nodes.length;
  globe.nodes.forEach((node, i) => {
    if (node.vega) node.start = VEGA_START;
    else if (node.hot) node.start = FIGURE_START + FIGURE_REACH * inward(reach(node)) * 0.9;
    else node.start = MESH_START + MESH_REACH * depths.get(node)! + jitter(i);
  });
  globe.edges.forEach((edge, i) => {
    if (edge.hot) {
      edge.from = reach(edge.a) >= reach(edge.b) ? edge.a : edge.b;
      const middle = (reach(edge.a) + reach(edge.b)) / 2;
      edge.start = FIGURE_START + FIGURE_REACH * inward(middle);
    } else {
      edge.from = depths.get(edge.a)! <= depths.get(edge.b)! ? edge.a : edge.b;
      edge.start = MESH_START + MESH_REACH * ((depths.get(edge.a)! + depths.get(edge.b)!) / 2) + jitter(i + before);
    }
  });
}

/**
 * A sphere of 70 neurons with the Lyra figure at its upper centre. One model
 * feeds the build-time SVG and the canvas, so the two cannot drift apart.
 */
export function buildGlobe(width = GLOBE_WIDTH, height = GLOBE_HEIGHT): Globe {
  const globe: Globe = {
    width, height, nodes: [], edges: [], hotNodes: [], hotEdges: [], routes: [], labels: [], rings: [], stars: [], rotation: 0.035,
  };
  const cx = width * 0.51;
  const cy = height * 0.49;
  const radius = Math.min(width, height) * 0.34;

  // Depth runs from 0 on the far side of the sphere to 1 on the near side.
  const depths = new Map<GlobeNode, number>();
  const add = (x: number, y: number, size: number, alpha: number, layer: number, depth: number): GlobeNode => {
    const node = { x, y, radius: size, alpha, layer, hot: false, vega: false, start: 0 };
    depths.set(node, depth);
    globe.nodes.push(node);
    return node;
  };
  const connect = (a: GlobeNode, b: GlobeNode, hot: boolean, layer: number, alpha: number) => {
    globe.edges.push({ a, b, hot, layer, alpha, start: 0, from: a });
    if (hot) a.hot = b.hot = true;
  };

  const sphere = Array.from({ length: NODE_COUNT }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / NODE_COUNT;
    const ring = Math.sqrt(1 - y * y);
    const angle = i * GOLDEN_ANGLE;
    const x = ring * Math.cos(angle);
    const z = ring * Math.sin(angle);
    const perspective = 1 + z * 0.13;
    const node = add(cx + x * radius * perspective, cy + y * radius * perspective, z > 0.2 ? 2 : 1.2, 0.16 + (z + 1) * 0.3, 0, (z + 1) / 2);
    return { node, x, y, z };
  });
  for (let i = 0; i < sphere.length; i++) {
    for (let j = i + 1; j < sphere.length; j++) {
      const a = sphere[i];
      const b = sphere[j];
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < EDGE_REACH) {
        connect(a.node, b.node, false, 0, 0.035 + (a.z + b.z + 2) * 0.045);
      }
    }
  }

  const scale = radius * 0.175;
  const lyra = LYRA.map(({ x, y }, i) => add(cx + radius * VEGA_OFFSET_X + x * scale, cy - radius * 0.55 + y * scale, i === 0 ? 4.1 : 2.3, 0.95, i === 0 ? 3 : 2, 1));
  lyra[0].vega = true;
  for (const [from, to] of LYRA_LINKS) connect(lyra[from], lyra[to], true, 2, 0.3);

  // The hot route: three neurons on the near face, then up into the figure.
  const front = sphere.filter((p) => p.z > 0.2 && p.x < 0).sort((p, q) => p.y - q.y);
  const [a, b, d] = [front[3].node, front[7].node, front[11].node];
  connect(a, b, true, 0, 0.17);
  connect(b, d, true, 1, 0.17);
  connect(d, lyra[5], true, 1, 0.17);
  connect(b, lyra[3], true, 1, 0.17);

  globe.rings.push({ x: cx, y: cy, rx: radius * 1.1, ry: radius * 0.35, rotate: -0.42, alpha: 0.16 });
  globe.rings.push({ x: cx, y: cy, rx: radius * 1.13, ry: radius * 1.13, rotate: 0, alpha: 0.07 });
  globe.labels.push({ text: "VEGA", x: lyra[0].x, y: lyra[0].y, alpha: 0.9, align: "left", dx: 13, dy: -13 });
  globe.labels.push({ text: "LYRA / NEURAL SPHERE", x: cx, y: cy + radius * 1.22, alpha: 0.7, align: "center", dx: 0, dy: 0 });

  for (let i = 0; i < 42; i++) {
    globe.stars.push({ x: unit(i * 17 + 3) * width, y: unit(i * 17 + 7) * height, alpha: 0.1 + unit(i) * 0.2, radius: 0.35 + unit(i + 9) * 0.45 });
  }

  globe.routes = buildRoutes(globe, sphere.map((p) => p.node), lyra[0], cx, cy);

  globe.hotNodes = globe.nodes.filter((node) => node.hot);
  globe.hotEdges = globe.edges.filter((edge) => edge.hot);
  schedule(globe, depths, lyra[0]);
  return globe;
}
