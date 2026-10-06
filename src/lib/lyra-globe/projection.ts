import { createHash } from "node:crypto";
import { buildGlobe, type Globe } from "./model.ts";

/** Generate model measurements for the external globe stylesheet. */
export function globeProjectionCss(globe: Globe): string {
  const ring = globe.rings.reduce((outer, candidate) => candidate.rx * candidate.ry > outer.rx * outer.ry ? candidate : outer);
  const vega = globe.nodes.find((node) => node.vega)!;
  const measurements = {
    "center-x": ring.x / globe.width,
    "center-y": ring.y / globe.height,
    "ring-left": (ring.x - ring.rx) / globe.width,
    "vega-y": vega.y / globe.width,
    "aspect": globe.height / globe.width,
  };
  return `.hero__globe{${Object.entries(measurements).map(([name, value]) => `--globe-model-${name}:${value};`).join("")}}`;
}

export const globeProjectionStyles = globeProjectionCss(buildGlobe());
// A model change gets a new URL, so cached measurements stay with their build.
export const globeProjectionVersion = createHash("sha256").update(globeProjectionStyles).digest("hex").slice(0, 16);
export const globeProjectionHref = `/globe-projection/${globeProjectionVersion}.css`;
