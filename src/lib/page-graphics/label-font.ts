export interface LabelFont {
  canvasFont: string;
  /** The height of one label line in CSS pixels: LABEL_LINE_RATIO times the label size. */
  lineCssPx: number;
  /** Measure and cache the text width in CSS pixels. Call this during layout. */
  widthCssPx: (text: string) => number;
}

const FALLBACK_FAMILY = "ui-monospace, monospace";
/** The size when the --fs-graphic-label token is missing or not in px. The token in global.css is the source. */
const FALLBACK_SIZE = "10px";
/** One label line is this many times the label size. It is a design ratio: a 10px label has a 12px line. */
const LABEL_LINE_RATIO = 1.2;
/** The line of the fallback size. Label placement uses it when the caller gives no line. */
export const FALLBACK_LINE_CSS_PX = parseFloat(FALLBACK_SIZE) * LABEL_LINE_RATIO;

/**
 * Prepare the label font from the CSS tokens: the --font-mono family and the --fs-graphic-label size.
 * Create a new cache after fonts or layout change.
 */
export function makeLabelFont(ctx: CanvasRenderingContext2D, family: string, size: string): LabelFont {
  const sizeCssPx = /^\d+(?:\.\d+)?px$/.test(size.trim()) ? size.trim() : FALLBACK_SIZE;
  ctx.font = `400 ${sizeCssPx} ${FALLBACK_FAMILY}`;
  // The canvas ignores a family it cannot parse, so the fallback family stays.
  if (family.trim()) ctx.font = `400 ${sizeCssPx} ${family.trim()}`;
  const canvasFont = ctx.font;
  const widths = new Map<string, number>();
  return {
    canvasFont,
    lineCssPx: parseFloat(sizeCssPx) * LABEL_LINE_RATIO,
    widthCssPx(text) {
      let width = widths.get(text);
      if (width === undefined) {
        ctx.font = canvasFont;
        width = ctx.measureText(text).width;
        widths.set(text, width);
      }
      return width;
    },
  };
}
