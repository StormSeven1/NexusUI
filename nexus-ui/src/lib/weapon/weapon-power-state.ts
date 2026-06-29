export const WEAPON_DEVICE_STATE_STANDBY = 0;
export const WEAPON_DEVICE_STATE_POWERING = 1;
export const WEAPON_DEVICE_STATE_EXECUTING = 2;

export const WEAPON_POWER_BLINK_MS = 500;

export function weaponBlinkOpacity(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / WEAPON_POWER_BLINK_MS) % 2 === 0 ? 1 : 0.25;
}

export function readNumericState(...values: unknown[]): number | null {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

export function isPoweringState(state: unknown): boolean {
  return Number(state) === WEAPON_DEVICE_STATE_POWERING;
}
