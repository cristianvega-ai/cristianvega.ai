import { clamp, cubicPoint, type Point } from "../motion/easing";
import { LYRA, LYRA_LINKS } from "../lyra/constellation";

export interface Neuron extends Point {
  id: string;
  layer: number;
  slot: number;
  radius: number;
  label: string;
}

export interface Synapse {
  from: Neuron;
  to: Neuron;
  control1: Point;
  control2: Point;
  weight: number;
  curve: Path2D;
}

export interface Signal {
  links: Synapse[];
  nodes: Neuron[];
  values: string[];
}

export interface Network {
  layers: [Neuron[], Neuron[], Neuron[], Neuron[]];
  links: Synapse[];
  signals: Map<string, Signal>;
  figure: Path2D;
}

function unit(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) / 4294967296;
}

export function buildNetwork(ids: string[]): Network {
  const keys = ids.length ? ids : Array.from({ length: 8 }, (_, i) => `signal-${i}`);
  const layers: Network["layers"] = [[], [], [], []];
  const links: Synapse[] = [];

  function node(layer: number, id: string, slot: number, label = ""): Neuron {
    const result = { layer, id, slot, label, x: 0, y: 0, radius: 4 };
    layers[layer].push(result);
    return result;
  }

  keys.forEach((id, i) => node(0, id, (i + .5) / keys.length,
    `${ids.length ? "N°" : "IN "}${String(keys.length - i).padStart(2, "0")}`));
  for (let i = 0; i < 16; i++) node(1, `field-${i}`, (i + .5) / 16);
  LYRA.slice(1).forEach((star, i) => node(2, `lyra-${i}`, (star.y + .89) / 6.98, star.name));
  node(3, "vega", .5, "VEGA · α LYR");

  for (let layer = 0; layer < 3; layer++) {
    for (const from of layers[layer]) {
      const nearest = [...layers[layer + 1]].sort((a, b) => Math.abs(a.slot - from.slot) - Math.abs(b.slot - from.slot));
      for (const to of nearest.slice(0, layer === 0 ? 6 : 2)) {
        links.push({
          from, to, weight: .06 + .94 * unit(`${from.id}:${to.id}`),
          control1: { x: 0, y: 0 }, control2: { x: 0, y: 0 }, curve: new Path2D(),
        });
      }
    }
  }

  const signals = new Map<string, Signal>();
  for (const input of layers[0]) {
    const route: Synapse[] = [];
    const nodes = new Set<Neuron>([input]);
    let sources = [input];
    for (let layer = 0; layer < 3; layer++) {
      const next = new Set<Neuron>();
      for (const source of sources) {
        const best = links.filter((link) => link.from === source).sort((a, b) => b.weight - a.weight);
        for (const link of best.slice(0, layer === 0 ? 2 : 1)) {
          route.push(link);
          next.add(link.to);
          nodes.add(link.to);
        }
      }
      sources = [...next];
    }
    const selected = [...nodes];
    signals.set(input.id, { links: route, nodes: selected, values: selected.map((n) => n === input ? "1.00" : (.72 + unit(n.id) * .27).toFixed(2)) });
  }
  return { layers, links, signals, figure: new Path2D() };
}

// The label sits right of the Vega node, so the node keeps this much room at the right edge.
const VEGA_LABEL_ROOM = 120;

export function placeNetwork(network: Network, width: number, height: number, copyRight: number, stacked = false): void {
  const [inputs, field, hubs, outputs] = network.layers;
  const vega = outputs[0];
  const left = copyRight + 52;
  const available = width - left - 34;
  // Beside the copy, the header overlaps the scene, so the network starts lower.
  const top = stacked ? 30 : 116;
  const bottom = stacked ? 44 : 90;
  const scale = stacked
    ? Math.max(12, Math.min(available * .47 / 4.3, (height - top - bottom - 24) / 7.3))
    : Math.max(12, Math.min(available * .47 / 4.3, (height - 220) / 6.98));
  vega.x = width - Math.max(38, available * .17, VEGA_LABEL_ROOM);
  vega.y = stacked ? top + 6 : Math.max(112, height * .28);
  for (let i = 0; i < inputs.length; i++) {
    const t = inputs.length === 1 ? .5 : i / (inputs.length - 1);
    inputs[i].x = left + 28 * (2 * t - 1) ** 2;
    inputs[i].y = top + (height - top - bottom) * t;
  }
  for (const node of field) {
    node.x = left + available * .24 + 22 * (2 * node.slot - 1) ** 2 + (unit(node.id) - .5) * 22;
    node.y = top - 16 + (height - top - bottom + 16 - 2) * node.slot;
  }
  hubs.forEach((node, i) => {
    node.x = vega.x + LYRA[i + 1].x * scale;
    node.y = vega.y + LYRA[i + 1].y * scale;
    node.radius = 8;
  });
  vega.radius = 12;

  for (const link of network.links) {
    const { from, to, control1, control2 } = link;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    control1.x = from.x + dx * .5;
    control1.y = from.y;
    control2.x = to.x - dx * .5;
    control2.y = to.y;
    if (from.layer === 2) {
      const index = hubs.indexOf(from);
      if (index < 2) {
        control1.x = from.x + dx / 3;
        control1.y = from.y + dy / 3;
        control2.x = from.x + dx * 2 / 3;
        control2.y = from.y + dy * 2 / 3;
      } else {
        const arcs = [[-2.5, .9, -.9, .25], [-1.2, 4.9, .1, 1.9], [-2.5, 7.3, 1.3, 2.9]];
        const arc = arcs[index - 2];
        control1.x = vega.x + arc[0] * scale;
        control1.y = vega.y + arc[1] * scale;
        control2.x = vega.x + arc[2] * scale;
        control2.y = vega.y + arc[3] * scale;
      }
    }
    link.curve = new Path2D();
    link.curve.moveTo(from.x, from.y);
    link.curve.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, to.x, to.y);
  }

  const stars = [vega, ...hubs];
  network.figure = new Path2D();
  for (const [a, b] of LYRA_LINKS) {
    network.figure.moveTo(stars[a].x, stars[a].y);
    network.figure.lineTo(stars[b].x, stars[b].y);
  }
}

// Draw a label over a halo in the ground colour, so no line crosses a glyph.
function haloText(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, ground: string): void {
  ctx.globalAlpha = 1;
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = ground;
  ctx.strokeText(label, x, y);
  ctx.fillText(label, x, y);
}

export function drawNetwork(ctx: CanvasRenderingContext2D, network: Network, sky: string, text: string, meta: string, ground: string): void {
  ctx.lineWidth = .65;
  ctx.strokeStyle = meta;
  for (const link of network.links) {
    ctx.globalAlpha = .07 + link.weight * .2;
    ctx.stroke(link.curve);
  }
  ctx.globalAlpha = .42;
  ctx.strokeStyle = text;
  ctx.stroke(network.figure);
  ctx.font = '500 9px "IBM Plex Mono", monospace';

  for (const layer of network.layers) {
    for (const n of layer) {
      ctx.globalAlpha = n.layer > 1 ? .7 : .45;
      ctx.strokeStyle = n.layer === 3 ? sky : meta;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = n.layer === 3 ? sky : text;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.layer === 3 ? 4 : n.layer === 2 ? 2.3 : 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Labels come last and sit beside their node, so no node or line covers them.
  ctx.fillStyle = meta;
  for (const layer of network.layers) {
    for (const n of layer) {
      if (!n.label) continue;
      ctx.textAlign = n.layer === 0 ? "right" : "left";
      haloText(ctx, n.label, n.layer === 0 ? n.x - 15 : n.x + n.radius + 8, n.y + 3, ground);
    }
  }
  const vega = network.layers[3][0];
  const glow = ctx.createRadialGradient(vega.x, vega.y, 0, vega.x, vega.y, 28);
  glow.addColorStop(0, sky);
  glow.addColorStop(1, "transparent");
  ctx.globalAlpha = .35;
  ctx.fillStyle = glow;
  ctx.fillRect(vega.x - 28, vega.y - 28, 56, 56);
  ctx.globalAlpha = 1;
}

export function drawSignal(ctx: CanvasRenderingContext2D, signal: Signal, elapsed: number, sky: string, scratch: Point): void {
  ctx.strokeStyle = sky;
  ctx.fillStyle = sky;
  ctx.lineWidth = 1.1;
  for (const link of signal.links) {
    const progress = clamp((elapsed - link.from.layer * 420) / 650);
    ctx.globalAlpha = progress * .85;
    ctx.stroke(link.curve);
    if (progress > 0 && progress < 1) {
      cubicPoint(scratch, progress, link.from, link.control1, link.control2, link.to);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(scratch.x, scratch.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.font = '500 9px "IBM Plex Mono", monospace';
  ctx.textAlign = "center";
  for (let i = 0; i < signal.nodes.length; i++) {
    const n = signal.nodes[i];
    ctx.globalAlpha = clamp((elapsed - n.layer * 420) / 300);
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
    ctx.stroke();
    const previous = signal.nodes[i - 1];
    // Omit a value when nearby labels overlap.
    const crowded = previous?.layer === n.layer && Math.abs(previous.x - n.x) < 28 && Math.abs(previous.y - n.y) < 14;
    if (!crowded) ctx.fillText(signal.values[i], n.x, n.y + n.radius + 14);
  }
  ctx.globalAlpha = 1;
}
