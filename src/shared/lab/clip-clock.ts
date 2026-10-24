// The shared clock of the Lab clips. Every clip of a group follows the same
// camera path, so all clips on a page show the same moment of it: each one
// starts at the clock time, wrapped to its own length.

/** The playback position for a clock reading, in seconds. */
export function clipClockTime(elapsedSeconds: number, clipDuration: number): number {
  if (!Number.isFinite(clipDuration) || clipDuration <= 0) return 0;
  return ((elapsedSeconds % clipDuration) + clipDuration) % clipDuration;
}
