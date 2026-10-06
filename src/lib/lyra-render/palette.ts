export interface Palette {
  /** A validated #RRGGBB color. */
  sky: string;
  meta: string;
  text: string;
  ink: string;
  grid: string;
  /** Decimal channels from a validated #RRGGBB sky color, as "r, g, b". */
  skyChannels: string;
}

const GLOW_SIZE = 96;
const FALLBACK_SKY = "#38BDF8";
const FALLBACK_CHANNELS = hexChannels(FALLBACK_SKY)!;

/**
 * Convert #RRGGBB into decimal channels for canvas gradients.
 * Accept either letter case. Reject all other formats.
 */
export function hexChannels(color: string): string | null {
  if (color.length !== 7 || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

/**
 * Read the site colors from the design tokens.
 * Trim --sky before conversion. Use #38BDF8 when --sky does not meet the #RRGGBB contract.
 */
export function readPalette(element: HTMLElement = document.documentElement): Palette {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const sky = read("--sky", FALLBACK_SKY);
  const skyChannels = hexChannels(sky);
  return {
    sky: skyChannels === null ? FALLBACK_SKY : sky,
    meta: read("--mast-meta", "#98A1B0"),
    text: read("--mast-text", "#EAEDF2"),
    ink: read("--ink", "#14181F"),
    grid: read("--grid-line", "rgba(255,255,255,0.048)"),
    skyChannels: skyChannels ?? FALLBACK_CHANNELS,
  };
}

const glows = new Map<string, HTMLCanvasElement>();

/** Cache a glow sprite with 45% sky at the center and a clear edge. Return null without canvas. */
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
