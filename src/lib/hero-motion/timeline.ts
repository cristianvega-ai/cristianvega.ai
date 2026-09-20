export const FULL_DURATION = 2450;
export const QUICK_DURATION = 250;
/** Covers a playing run whose clock stalls. Not the CSS pre-hide gate. */
export const FAILSAFE_DURATION = 3000;
/**
 * Head-script CSS hide, and the font wait on a cold load. After this, a
 * module that has not started playing must leave the copy readable.
 */
export const PREHIDE_DEADLINE_MS = 1200;
export const FONT_DEADLINE_MS = PREHIDE_DEADLINE_MS;
export const PREHIDE_PENDING_ATTR = "data-hero-motion-pending";
export const PREHIDE_EXPIRED_ATTR = "data-hero-motion-expired";
/** Faces the entrance samples: the Geist headline and the Mono 600 eyebrow.
    Do not wait for footer Mono 400 or the italic lede. */
export const HERO_FONT_SPECS = [
  '600 16px "Geist"',
  '600 16px "IBM Plex Mono"',
] as const;
export const SESSION_KEY = "cristianvega:hero-motion:v1";
export const PORTRAIT_DOT_DURATION = 520;
export const TRANSFER_TRAVEL_DURATION = 620;

// Overlapping target windows (ms). The copy targets finish at 1650. The full
// clock runs to 2450, because the star chart settles on the same clock.
export const WINDOWS = {
  transfer: [450, 1450],
  eyebrow: [720, 1320],
  name: [850, 1550],
  highlight: [1000, 1650],
} as const;

export type TargetKind = "eyebrow" | "name" | "highlight";

export type TargetBinding = {
  element: HTMLElement;
  kind: TargetKind;
  window: readonly [number, number];
};

export const TARGET_WINDOWS: Record<TargetKind, readonly [number, number]> = {
  eyebrow: WINDOWS.eyebrow,
  name: WINDOWS.name,
  highlight: WINDOWS.highlight,
};

function hasPlayedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPlayedThisSession(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // sessionStorage is optional; never required for rendering
  }
}

/** Planned entrance duration (full vs quick settle). Used by later motion tasks. */
export function plannedDuration(): number {
  return hasPlayedThisSession() ? QUICK_DURATION : FULL_DURATION;
}
