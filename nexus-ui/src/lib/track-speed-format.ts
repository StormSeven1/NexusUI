/** 航迹速度展示：store / DDS 均为 m/s */
export function formatTrackSpeed(speed: unknown, digits = 1): string {
  if (typeof speed !== "number" || !Number.isFinite(speed)) {
    return "—";
  }
  return `${speed.toFixed(digits)} m/s`;
}

/** 航迹速度数值（m/s），非法则 undefined */
export function trackSpeedMps(speed: unknown): number | undefined {
  if (typeof speed !== "number" || !Number.isFinite(speed)) {
    return undefined;
  }
  return speed;
}
