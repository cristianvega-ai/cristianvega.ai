/** A color as the canvas paints it: sRGB channels from 0 to 255, and an alpha from 0 to 1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Palette {
  /** The --sky token as the canvas draws it. */
  sky: string;
  meta: string;
  text: string;
  ink: string;
  grid: string;
  /** The sky color as channels, for gradients that set their own alpha. */
  skyColor: Rgba;
}

const GLOW_SIZE = 96;
/** The value of each palette token when the canvas cannot parse it. */
const FALLBACKS = {
  "--sky": "#38BDF8",
  "--mast-meta": "#98A1B0",
  "--mast-text": "#EAEDF2",
  "--ink": "#14181F",
  "--grid-line": "rgba(255,255,255,0.048)",
} as const;

/**
 * Resolve a CSS color through a 1x1 canvas. Return null when the canvas cannot parse it.
 * Any color that the browser can parse works, for example hex, rgb(), hsl(), oklch(), or a name.
 */
export function resolveColor(probe: CanvasRenderingContext2D, value: string): Rgba | null {
  // The canvas ignores a color that it cannot parse. Two different starting colors show whether the value took.
  probe.fillStyle = "#000000";
  probe.fillStyle = value;
  const fromBlack = probe.fillStyle;
  probe.fillStyle = "#ffffff";
  probe.fillStyle = value;
  if (fromBlack === "#000000" && probe.fillStyle === "#ffffff") return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, alpha] = probe.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: alpha / 255 };
}

/** The two stops of the glow gradient: 45% of the color alpha at the centre, and clear at the edge. */
export function glowStops(color: Rgba): [string, string] {
  const channels = `${color.r}, ${color.g}, ${color.b}`;
  return [`rgba(${channels}, ${Math.round(0.45 * color.a * 1000) / 1000})`, `rgba(${channels}, 0)`];
}

/**
 * Read the site colors from the design tokens. Trim each token, and let the canvas parse it.
 * A missing token draws with its fallback. A token that the canvas cannot parse is a site defect:
 * report it in the console, and draw with its fallback. Return null when the browser has no 2D canvas.
 */
export function readPalette(element: HTMLElement = document.documentElement): Palette | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const probe = canvas.getContext("2d", { willReadFrequently: true });
  if (!probe) return null;
  const style = getComputedStyle(element);
  const read = (name: keyof typeof FALLBACKS) => {
    const value = style.getPropertyValue(name).trim();
    const color = value ? resolveColor(probe, value) : null;
    if (color) return { value, color };
    if (value) console.warn(`Canvas graphics: ${name} "${value}" is not a CSS color. The canvas draws ${FALLBACKS[name]} instead.`);
    return { value: FALLBACKS[name], color: resolveColor(probe, FALLBACKS[name])! };
  };
  const sky = read("--sky");
  return {
    sky: sky.value,
    meta: read("--mast-meta").value,
    text: read("--mast-text").value,
    ink: read("--ink").value,
    grid: read("--grid-line").value,
    skyColor: sky.color,
  };
}

const glows = new Map<string, HTMLCanvasElement>();

/** Cache a glow sprite with 45% sky at the center and a clear edge. Return null without canvas. */
export function getGlow(palette: Palette, size = GLOW_SIZE): HTMLCanvasElement | null {
  const [center, edge] = glowStops(palette.skyColor);
  const key = `${center}/${size}`;
  const cached = glows.get(key);
  if (cached) return cached;
  const glow = document.createElement("canvas");
  glow.width = glow.height = size;
  const ctx = glow.getContext("2d");
  if (!ctx) return null;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, center);
  gradient.addColorStop(1, edge);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  glows.set(key, glow);
  return glow;
}
