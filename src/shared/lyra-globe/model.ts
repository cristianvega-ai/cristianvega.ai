import { LYRA, LYRA_LINKS } from "../lyra/constellation.ts";
import { makeRoute, type Route } from "../canvas/comets.ts";
import type { Point } from "../canvas/geometry.ts";
import { unit } from "../canvas/random.ts";
import type { FieldStar } from "../canvas/star-field.ts";

interface GlobeNode extends Point {
  radius: number;
  alpha: number;
  hot: boolean;
  vega: boolean;
  /** Share of the entrance that passes before the neuron appears. */
  start: number;
}

interface GlobeEdge {
  first: GlobeNode;
  second: GlobeNode;
  hot: boolean;
  alpha: number;
  /** Share of the entrance that passes before the edge starts to draw. */
  start: number;
  /** The end the edge grows from. It is the far end of the sphere, or the end far from Vega. */
  from: GlobeNode;
}

/**
 * One signal of the entrance. A comet follows a chain of edges from a neuron
 * on the near face and ends on Vega. The chain is a real path in the graph,
 * and its points run from the start to Vega.
 */
interface GlobeRoute extends Route {
  /** Share of the entrance that passes before the comet starts. */
  start: number;
  /** Share of the entrance that the comet takes to reach Vega. */
  span: number;
}

/**
 * A label sits at an anchor on the globe grid. The offset is in CSS pixels,
 * so the text keeps its size and its distance from the anchor at any scale.
 */
interface GlobeLabel extends Point {
  text: string;
  alpha: number;
  align: "left" | "center";
  offsetX: number;
  offsetY: number;
}

interface GlobeRing extends Point {
  radiusX: number;
  radiusY: number;
  rotation: number;
  alpha: number;
}

export interface Globe {
  width: number;
  height: number;
  nodes: GlobeNode[];
  edges: GlobeEdge[];
  hotNodes: GlobeNode[];
  /** The entrance comets, in the order they start. */
  routes: GlobeRoute[];
  labels: GlobeLabel[];
  rings: GlobeRing[];
  stars: FieldStar[];
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

/**
 * The shortest chain of edges from every node to Vega, by Dijkstra on the
 * bright edges. Returns the step each node takes toward Vega.
 */
function stepsToVega(globe: Globe, vega: GlobeNode): Map<GlobeNode, GlobeNode> {
  const nextStep = new Map<GlobeNode, GlobeNode>();
  const cost = new Map<GlobeNode, number>([[vega, 0]]);
  const open = new Set<GlobeNode>([vega]);
  const links = globe.edges.filter((edge) => edge.hot || edge.alpha >= ROUTE_MINIMUM_ALPHA);
  while (open.size) {
    let node!: GlobeNode;
    for (const candidate of open) if (!node || cost.get(candidate)! < cost.get(node)!) node = candidate;
    open.delete(node);
    for (const edge of links) {
      const other = edge.first === node ? edge.second : edge.second === node ? edge.first : undefined;
      if (!other) continue;
      const total = cost.get(node)! + Math.hypot(edge.first.x - edge.second.x, edge.first.y - edge.second.y);
      if (total < (cost.get(other) ?? Infinity)) {
        cost.set(other, total);
        nextStep.set(other, node);
        open.add(other);
      }
    }
  }
  return nextStep;
}

/**
 * The comets of the entrance. One neuron per sector around the sphere starts a
 * comet, and each follows the graph to Vega. The routes merge on the way up the
 * figure, so the light reads as one flow toward the star. The comets share one
 * speed and arrive in turn, the longest journey first.
 */
function buildRoutes(globe: Globe, sphere: GlobeNode[], vega: GlobeNode, centerX: number, centerY: number): GlobeRoute[] {
  const nextStep = stepsToVega(globe, vega);
  const reach = (node: GlobeNode) => Math.hypot(node.x - vega.x, node.y - vega.y);
  const starts: GlobeNode[] = [];
  for (let sector = 0; sector < ROUTE_COUNT; sector++) {
    let best: GlobeNode | undefined;
    for (const node of sphere) {
      const turn = (Math.atan2(node.y - centerY, node.x - centerX) + Math.PI) / (Math.PI * 2);
      if (Math.floor(turn * ROUTE_COUNT) !== sector || !nextStep.has(node) || node.alpha < 0.3 || reach(node) < ROUTE_MINIMUM_REACH) continue;
      if (!best || reach(node) > reach(best)) best = node;
    }
    if (best) starts.push(best);
  }
  const chains = starts.map((start) => {
    const points: GlobeNode[] = [start];
    while (points[points.length - 1] !== vega) points.push(nextStep.get(points[points.length - 1])!);
    return makeRoute(points);
  });
  chains.sort((first, second) => second.length - first.length);
  return chains.map((chain, chainIndex) => {
    const span = chain.length / ROUTE_SPEED;
    const arrival = ARRIVAL_FIRST + (ARRIVAL_LAST - ARRIVAL_FIRST) * (chains.length > 1 ? chainIndex / (chains.length - 1) : 1);
    return { ...chain, start: Math.max(0, arrival - span), span: Math.min(span, arrival) };
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
  const jitter = (seed: number) => unit(seed * 5 + 1) * 0.05;
  const inward = (distance: number) => 1 - Math.min(1, distance / farthest);
  const before = globe.nodes.length;
  globe.nodes.forEach((node, nodeIndex) => {
    if (node.vega) node.start = VEGA_START;
    else if (node.hot) node.start = FIGURE_START + FIGURE_REACH * inward(reach(node)) * 0.9;
    else node.start = MESH_START + MESH_REACH * depths.get(node)! + jitter(nodeIndex);
  });
  globe.edges.forEach((edge, edgeIndex) => {
    if (edge.hot) {
      edge.from = reach(edge.first) >= reach(edge.second) ? edge.first : edge.second;
      const middle = (reach(edge.first) + reach(edge.second)) / 2;
      edge.start = FIGURE_START + FIGURE_REACH * inward(middle);
    } else {
      edge.from = depths.get(edge.first)! <= depths.get(edge.second)! ? edge.first : edge.second;
      edge.start = MESH_START + MESH_REACH * ((depths.get(edge.first)! + depths.get(edge.second)!) / 2) + jitter(edgeIndex + before);
    }
  });
}

/**
 * A sphere of 70 neurons with the Lyra figure at its upper centre. One model
 * feeds the build-time SVG and the canvas, so the two cannot drift apart.
 */
export function buildGlobe(width = GLOBE_WIDTH, height = GLOBE_HEIGHT): Globe {
  const globe: Globe = {
    width, height, nodes: [], edges: [], hotNodes: [], routes: [], labels: [], rings: [], stars: [], rotation: 0.035,
  };
  const centerX = width * 0.51;
  const centerY = height * 0.49;
  const radius = Math.min(width, height) * 0.34;

  // Depth runs from 0 on the far side of the sphere to 1 on the near side.
  const depths = new Map<GlobeNode, number>();
  const add = (x: number, y: number, size: number, alpha: number, depth: number): GlobeNode => {
    const node = { x, y, radius: size, alpha, hot: false, vega: false, start: 0 };
    depths.set(node, depth);
    globe.nodes.push(node);
    return node;
  };
  const connect = (first: GlobeNode, second: GlobeNode, hot: boolean, alpha: number) => {
    globe.edges.push({ first, second, hot, alpha, start: 0, from: first });
    if (hot) first.hot = second.hot = true;
  };

  const sphere = Array.from({ length: NODE_COUNT }, (_, nodeIndex) => {
    const y = 1 - (2 * (nodeIndex + 0.5)) / NODE_COUNT;
    const ring = Math.sqrt(1 - y * y);
    const angle = nodeIndex * GOLDEN_ANGLE;
    const x = ring * Math.cos(angle);
    const z = ring * Math.sin(angle);
    const perspective = 1 + z * 0.13;
    const node = add(centerX + x * radius * perspective, centerY + y * radius * perspective, z > 0.2 ? 2 : 1.2, 0.16 + (z + 1) * 0.3, (z + 1) / 2);
    return { node, x, y, z };
  });
  for (let firstIndex = 0; firstIndex < sphere.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < sphere.length; secondIndex++) {
      const first = sphere[firstIndex];
      const second = sphere[secondIndex];
      if (Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z) < EDGE_REACH) {
        connect(first.node, second.node, false, 0.035 + (first.z + second.z + 2) * 0.045);
      }
    }
  }

  const scale = radius * 0.175;
  const lyra = LYRA.map(({ x, y }, starIndex) => add(centerX + radius * VEGA_OFFSET_X + x * scale, centerY - radius * 0.55 + y * scale, starIndex === 0 ? 4.1 : 2.3, 0.95, 1));
  lyra[0].vega = true;
  for (const [from, to] of LYRA_LINKS) connect(lyra[from], lyra[to], true, 0.3);

  // The hot route: three neurons on the near face, then up into the figure.
  const front = sphere
    .filter((point) => point.z > 0.2 && point.x < 0)
    .sort((first, second) => first.y - second.y);
  const [firstRouteNode, secondRouteNode, thirdRouteNode] = [front[3].node, front[7].node, front[11].node];
  connect(firstRouteNode, secondRouteNode, true, 0.17);
  connect(secondRouteNode, thirdRouteNode, true, 0.17);
  connect(thirdRouteNode, lyra[5], true, 0.17);
  connect(secondRouteNode, lyra[3], true, 0.17);

  globe.rings.push({ x: centerX, y: centerY, radiusX: radius * 1.1, radiusY: radius * 0.35, rotation: -0.42, alpha: 0.16 });
  globe.rings.push({ x: centerX, y: centerY, radiusX: radius * 1.13, radiusY: radius * 1.13, rotation: 0, alpha: 0.07 });
  globe.labels.push({ text: "VEGA", x: lyra[0].x, y: lyra[0].y, alpha: 0.9, align: "left", offsetX: 13, offsetY: -13 });
  globe.labels.push({ text: "LYRA / NEURAL SPHERE", x: centerX, y: centerY + radius * 1.22, alpha: 0.7, align: "center", offsetX: 0, offsetY: 0 });

  for (let starIndex = 0; starIndex < 42; starIndex++) {
    globe.stars.push({ x: unit(starIndex * 17 + 3) * width, y: unit(starIndex * 17 + 7) * height, alpha: 0.1 + unit(starIndex) * 0.2, radius: 0.35 + unit(starIndex + 9) * 0.45 });
  }

  globe.routes = buildRoutes(globe, sphere.map((point) => point.node), lyra[0], centerX, centerY);

  globe.hotNodes = globe.nodes.filter((node) => node.hot);
  schedule(globe, depths, lyra[0]);
  return globe;
}
