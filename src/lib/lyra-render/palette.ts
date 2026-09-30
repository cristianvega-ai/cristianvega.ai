export interface Palette {
  sky: string;
  meta: string;
  text: string;
  ink: string;
  grid: string;
  /** Sky as "r, g, b", for the glow gradient stops. */
  skyChannels: string;
}

const GLOW_SIZE = 96;

/** Read the site colours from the design tokens, so the canvas follows the CSS. */
export function readPalette(element: HTMLElement = document.documentElement): Palette {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const sky = read("--sky", "#38BDF8");
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(sky.slice(i, i + 2), 16));
  return {
    sky,
    meta: read("--mast-meta", "#98A1B0"),
    text: read("--mast-text", "#EAEDF2"),
    ink: read("--ink", "#14181F"),
    grid: read("--grid-line", "rgba(255,255,255,0.048)"),
    skyChannels: `${r}, ${g}, ${b}`,
  };
}

const glows = new Map<string, HTMLCanvasElement>();

/** A cached glow sprite: sky at 45% in the centre, clear at the edge. Draw it scaled. Null when canvas is missing. */
export function getGlow(palette: Palette, size = GLOW_SIZE): HTMLCanvasElement | null {
  const key = `${palette.skyChannels}/${size}`;
  const cached = glows.get(key);
  if (cached) return cached;
  const glow = document.createElement("canvas");
  glow.width = glow.height = size;
  const ctx = glow.getContext("2d");
  if (!ctx) return null;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, `rgba(${palette.skyChannels}, 0.45)`);
  gradient.addColorStop(1, `rgba(${palette.skyChannels}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  glows.set(key, glow);
  return glow;
}
