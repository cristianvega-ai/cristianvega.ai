import { createHash } from "node:crypto";
import { buildGlobe, type Globe } from "./model.ts";

/** The picture is this many times as wide as the globe box. It is a design choice. */
export const PICTURE_SCALE = 1.3;
/**
 * The box crops the picture from a little above the outer ring to a little below the caption anchor.
 * The margins are shares of the outer ring radius, so the crop follows the sphere. They are design choices.
 */
export const CROP_ABOVE_RING = 0.0359;
export const CROP_BELOW_CAPTION = 0.05;

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
  /** Picture top per box height. It is negative, because the box crops the top of the picture. */
  pictureTop: number;
  /** Box height per box width. */
  boxAspect: number;
  /** Distance from the picture edge to the left of the outer ring, per box width. */
  ringInset: number;
  /** Distance from the left of the outer ring to the sphere centre, per box width. The ring starts at the figure inset. */
  centerReach: number;
  /** Sphere centre per box height, for the backdrop behind the sphere. */
  centerTop: number;
  /** Sphere centre per picture width, for the band below 1100px. */
  centerX: number;
  /** Vega per picture width, for the band below 1100px. */
  vegaY: number;
  /** Characters in the caption under the sphere. CSS measures its reach in the label font. */
  captionLength: number;
}

/**
 * Measure the globe for its CSS. The desktop values are rounded at build time, so CSS needs no
 * round(). The centre and Vega keep full precision, as the band crop uses them directly.
 */
export function projectGlobe(globe: Globe): GlobeProjection {
  const ring = globe.rings.reduce((outer, candidate) => candidate.rx * candidate.ry > outer.rx * outer.ry ? candidate : outer);
  const vega = globe.nodes.find((node) => node.vega)!;
  const caption = globe.labels.find((label) => label.align === "center")!;
  // The part of the picture that the box shows, in grid units.
  const cropTop = ring.y - ring.ry * (1 + CROP_ABOVE_RING);
  const cropBottom = caption.y + ring.ry * CROP_BELOW_CAPTION;
  const pictureAspect = round(globe.height / globe.width);
  const pictureHeight = round(globe.height / (cropBottom - cropTop));
  const pictureTop = round(-cropTop / (cropBottom - cropTop));
  return {
    pictureScale: PICTURE_SCALE,
    pictureAspect,
    pictureHeight,
    pictureTop,
    boxAspect: round((pictureAspect * PICTURE_SCALE) / pictureHeight),
    ringInset: round(((ring.x - ring.rx) / globe.width) * PICTURE_SCALE),
    centerReach: round((ring.rx / globe.width) * PICTURE_SCALE),
    // The picture sits at pictureTop, so the sphere centre sits this far down the box.
    centerTop: round(pictureTop + (ring.y / globe.height) * pictureHeight),
    centerX: ring.x / globe.width,
    vegaY: vega.y / globe.width,
    captionLength: caption.text.length,
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
