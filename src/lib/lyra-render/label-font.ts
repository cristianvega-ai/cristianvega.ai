import { LABEL_SIZE } from "./labels.ts";

export interface LabelFont {
  canvasFont: string;
  /** Measure and cache the text width in CSS pixels. Call this during layout. */
  widthCssPx: (text: string) => number;
}

/** Prepare the label font from the CSS family token. Create a new cache after fonts or layout change. */
export function makeLabelFont(ctx: CanvasRenderingContext2D, family: string): LabelFont {
  ctx.font = `400 ${LABEL_SIZE}px ui-monospace, monospace`;
  if (family.trim()) ctx.font = `400 ${LABEL_SIZE}px ${family.trim()}`;
  const canvasFont = ctx.font;
  const widths = new Map<string, number>();
  return {
    canvasFont,
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
