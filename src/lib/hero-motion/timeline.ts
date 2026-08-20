export const FULL_DURATION = 2450;
export const QUICK_DURATION = 250;
export const FAILSAFE_DURATION = 3000;
export const FONT_DEADLINE_MS = 1200;
export const SESSION_KEY = "cristianvega:hero-motion:v1";
export const PORTRAIT_DOT_DURATION = 520;
export const TRANSFER_TRAVEL_DURATION = 620;

// Overlapping target windows (ms). Full choreography ends at 2450.
export const WINDOWS = {
  transfer: [450, 1450],
  eyebrow: [720, 1320],
  name: [850, 1550],
  highlight: [1000, 1650],
  subhead: [1100, 1950],
  primaryAction: [1250, 2250],
  secondaryAction: [1380, 2450],
} as const;

export type TargetKind =
  | "eyebrow"
  | "name"
  | "highlight"
  | "subhead"
  | "primary-action"
  | "secondary-action";

export type TargetBinding = {
  element: HTMLElement;
  kind: TargetKind;
  window: readonly [number, number];
};

export const TARGET_WINDOWS: Record<TargetKind, readonly [number, number]> = {
  eyebrow: WINDOWS.eyebrow,
  name: WINDOWS.name,
  highlight: WINDOWS.highlight,
  subhead: WINDOWS.subhead,
  "primary-action": WINDOWS.primaryAction,
  "secondary-action": WINDOWS.secondaryAction,
};

export function hasPlayedThisSession(): boolean {
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
