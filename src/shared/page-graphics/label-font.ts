export interface LabelFont {
  canvasFont: string;
  /** The height of one label line in CSS pixels: LABEL_LINE_RATIO times the label size. */
  lineHeightInPixels: number;
  /** Measure and cache the text width in CSS pixels. Call this during layout. */
  widthInPixels: (text: string) => number;
}

const FALLBACK_FAMILY = "ui-monospace, monospace";
/** The size when the --fs-graphic-label token is missing or not in px. The token in global.css is the source. */
const FALLBACK_SIZE = "10px";
/** One label line is this many times the label size. It is a design ratio: a 10px label has a 12px line. */
const LABEL_LINE_RATIO = 1.2;
/** The line of the fallback size. Label placement uses it when the caller gives no line. */
export const FALLBACK_LINE_HEIGHT_IN_PIXELS = parseFloat(FALLBACK_SIZE) * LABEL_LINE_RATIO;

/**
 * Prepare the label font from the CSS tokens: the --font-mono family and the --fs-graphic-label size.
 * Create a new cache after fonts or layout change.
 */
export function makeLabelFont(drawingContext: CanvasRenderingContext2D, family: string, size: string): LabelFont {
  const sizeInPixels = /^\d+(?:\.\d+)?px$/.test(size.trim()) ? size.trim() : FALLBACK_SIZE;
  drawingContext.font = `400 ${sizeInPixels} ${FALLBACK_FAMILY}`;
  // The canvas ignores a family it cannot parse, so the fallback family stays.
  if (family.trim()) drawingContext.font = `400 ${sizeInPixels} ${family.trim()}`;
  const canvasFont = drawingContext.font;
  const widths = new Map<string, number>();
  return {
    canvasFont,
    lineHeightInPixels: parseFloat(sizeInPixels) * LABEL_LINE_RATIO,
    widthInPixels(text) {
      let width = widths.get(text);
      if (width === undefined) {
        drawingContext.font = canvasFont;
        width = drawingContext.measureText(text).width;
        widths.set(text, width);
      }
      return width;
    },
  };
}
