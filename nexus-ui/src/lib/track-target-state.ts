/** DDS TargetFull::TargetState，与 NewTrackRealTimeStatus.idl 一致 */
export const TARGET_STATE_NAMES = ["STABLE", "COASTING", "LOST", "MERGED", "SPLIT"] as const;
export type TargetState = (typeof TARGET_STATE_NAMES)[number];

export function readTargetStateFromRecord(rec: Record<string, unknown>): TargetState | undefined {
  const raw = rec.targetState ?? rec.target_state;
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    const s = raw.trim().toUpperCase();
    if ((TARGET_STATE_NAMES as readonly string[]).includes(s)) return s as TargetState;
    return undefined;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const i = Math.trunc(raw);
    if (i >= 0 && i < TARGET_STATE_NAMES.length) return TARGET_STATE_NAMES[i];
  }
  return undefined;
}

export function isTrackCoasting(track: { targetState?: TargetState } | null | undefined): boolean {
  return track?.targetState === "COASTING";
}
