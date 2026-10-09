// The product slots of the Products graphic. This module has no DOM, no canvas, and no imports,
// so the build can read the slot count without the browser scene module.

/** The angle of each slot from the direction away from the figure, in degrees. */
export const SLOT_OFFSET = [0, 52, -52, -112, 112, 172, -165, 30] as const;
/** The orbit that each slot sits on, as an index into RINGS in products.ts. */
export const SLOT_RING = [1, 2, 0, 2, 0, 2, 1, 2] as const;
/** The picture never shows more slots than this. */
export const MAXIMUM_SLOTS = SLOT_OFFSET.length;

/**
 * Reject a published product count that the picture cannot show.
 * Product routes call this guard before they return build paths.
 * A build with too many published products fails before it can show an incomplete graphic.
 */
export function assertProductCapacity(count: number): void {
  if (count > MAXIMUM_SLOTS) {
    throw new Error(
      `The site publishes ${count} products, but the products graphic has ${MAXIMUM_SLOTS} slots. ` +
        "Set draft: true on a product, or add a slot to SLOT_OFFSET and SLOT_RING in src/shared/page-graphics/scenes/product-slots.ts.",
    );
  }
}
