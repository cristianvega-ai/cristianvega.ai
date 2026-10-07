import { createHash } from "node:crypto";
import { buildGlobe, type Globe } from "./model.ts";

/** The picture is this many times as wide as the globe box. It is a design choice. */
export const PICTURE_SCALE = 1.3;
/** The box shows this share of the picture height. It is a design choice. */
export const PICTURE_HEIGHT = 1.2019;

/** Round to the precision of the projection: four decimal places. */
const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** Model measurements that home.css reads. Each share has its unit in the comment. */
export interface GlobeProjection {
  /** Picture width per box width. */
  pictureScale: number;
  /** Picture height per picture width. */
  pictureAspect: number;
  /** Picture height per box height. */
  pictureHeight: number;
  /** Box height per box width. */
  boxAspect: number;
  /** Distance from the picture edge to the left of the outer ring, per box width. */
  ringInset: number;
  /** Distance from the left of the outer ring to the sphere centre, per box width. */
  centerReach: number;
  /** Sphere centre per picture width. */
  centerX: number;
  /** Sphere centre per picture height. */
  centerY: number;
  /** Vega per picture width, for the band below 1100px. */
  vegaY: number;
}

/**
 * Measure the globe for its CSS. The desktop values are rounded at build time, so CSS needs no
 * round(). The centre and Vega keep full precision, as the band crop uses them directly.
 */
export function projectGlobe(globe: Globe): GlobeProjection {
  const ring = globe.rings.reduce((outer, candidate) => candidate.rx * candidate.ry > outer.rx * outer.ry ? candidate : outer);
  const vega = globe.nodes.find((node) => node.vega)!;
  const pictureAspect = round(globe.height / globe.width);
  return {
    pictureScale: PICTURE_SCALE,
    pictureAspect,
    pictureHeight: PICTURE_HEIGHT,
    boxAspect: round((pictureAspect * PICTURE_SCALE) / PICTURE_HEIGHT),
    ringInset: round(((ring.x - ring.rx) / globe.width) * PICTURE_SCALE),
    centerReach: round((ring.rx / globe.width) * PICTURE_SCALE),
    centerX: ring.x / globe.width,
    centerY: ring.y / globe.height,
    vegaY: vega.y / globe.width,
  };
}

/** Write the projection as custom properties on the globe host. */
export function globeProjectionCss(globe: Globe): string {
  const projection = projectGlobe(globe);
  const property = (name: string) => `--globe-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
  return `.hero__globe{${Object.entries(projection).map(([name, value]) => `${property(name)}:${value};`).join("")}}`;
}

export const globeProjectionStyles = globeProjectionCss(buildGlobe());
// A model change gets a new URL, so cached measurements stay with their build.
export const globeProjectionVersion = createHash("sha256").update(globeProjectionStyles).digest("hex").slice(0, 16);
export const globeProjectionHref = `/globe-projection/${globeProjectionVersion}.css`;
