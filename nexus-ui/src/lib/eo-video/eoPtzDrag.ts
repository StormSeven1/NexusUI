/** 与 EoVideoPlayStage / camera-task 共用的拖拽 PTZ 方向（含 8 向） */
export type EoPtzDragDirection =
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "LEFT_UP"
  | "LEFT_DOWN"
  | "RIGHT_UP"
  | "RIGHT_DOWN";

export type EoPtzMoveSpeed = {
  pan: number;
  tilt: number;
};

export const PTZ_DRAG_TRIGGER_PX = 14;
/** 快甩方向判定略低，避免极短箭头无 move */
const PTZ_FLICK_TRIGGER_PX = 10;

/** 按住未超过该时长松手 → 快甩（仅松手发 pulse）；超过 → 长按缓升 */
export const PTZ_SLOW_DRAG_ENTER_MS = 3000;

/** Pelco-D 速度字节上限 63，camServer 计算 int(64*speed) */
export const PTZ_QUICK_SPEED = 63 / 64;
/** 快甩速度/脉冲随箭头长度变化（幅度 ∝ 长度，整体偏小） */
export const PTZ_FLICK_SPEED_MIN = 0.18;
export const PTZ_FLICK_SPEED_MAX = 0.44;
/** 箭头长度达到该像素视为「满幅度」参考 */
export const PTZ_QUICK_FLICK_DIST_REF_PX = 120;
export const PTZ_FLICK_PULSE_GAP_MS = 100;

/** 长按：超过 ENTER 后按按住时长缓升 */
export const PTZ_HOLD_RAMP_MS = 4000;
export const PTZ_HOLD_SPEED_MIN = 0.15;
export const PTZ_HOLD_SPEED_MAX = 0.55;

/** 箭头长度 → [0,1]，14px 起算 */
export function flickDistRatio(dist: number): number {
  const span = Math.max(PTZ_QUICK_FLICK_DIST_REF_PX - PTZ_DRAG_TRIGGER_PX, 1);
  return clamp((dist - PTZ_DRAG_TRIGGER_PX) / span, 0, 1);
}

/** 快甩标量速度：短箭头更慢，长箭头渐快（sqrt 使短距更细腻） */
export function flickSpeedFromDist(dist: number): number {
  const t = Math.sqrt(flickDistRatio(dist));
  return clamp(
    PTZ_FLICK_SPEED_MIN + t * (PTZ_FLICK_SPEED_MAX - PTZ_FLICK_SPEED_MIN),
    PTZ_FLICK_SPEED_MIN,
    PTZ_FLICK_SPEED_MAX,
  );
}

/** 松手总时长 <3s 且箭头有效 → 快甩 */
export function isQuickFlickGesture(gestureMs: number, dist: number): boolean {
  if (gestureMs <= 0 || dist < PTZ_FLICK_TRIGGER_PX) return false;
  return gestureMs < PTZ_SLOW_DRAG_ENTER_MS;
}

/** 快甩松手：短距离时放大至触发阈值 */
export function resolvePtzFlickRelease(
  dx: number,
  dy: number,
  gestureMs: number,
): { direction: EoPtzDragDirection | null; speed: EoPtzMoveSpeed } {
  const dist = Math.hypot(dx, dy);
  if (dist < PTZ_FLICK_TRIGGER_PX) {
    return { direction: null, speed: { pan: PTZ_HOLD_SPEED_MIN, tilt: PTZ_HOLD_SPEED_MIN } };
  }
  if (dist < PTZ_DRAG_TRIGGER_PX) {
    const scale = PTZ_DRAG_TRIGGER_PX / dist;
    return resolvePtzDragFromDelta(dx * scale, dy * scale, gestureMs, { flick: true });
  }
  return resolvePtzDragFromDelta(dx, dy, gestureMs, { flick: true });
}

export function quickFlickPulseBudget(dist: number): {
  burstCount: number;
  pulseGapMs: number;
  holdMs: number;
} {
  const t = flickDistRatio(dist);
  const eased = Math.sqrt(t);
  return {
    burstCount: t < 0.5 ? 1 : 2,
    pulseGapMs: PTZ_FLICK_PULSE_GAP_MS,
    holdMs: Math.round(40 + eased * 100),
  };
}

/** 短轴 ≥ 该值且两轴比例足够时才判斜向 */
const PTZ_DRAG_DIAGONAL_MIN_AXIS_PX = 7;
const PTZ_DRAG_DIAGONAL_MIN_RATIO = 0.35;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** 长按（≥3s）速度：从 MIN 缓升 */
export function ptzDragMagnitudeFromGesture(gestureMs: number): number {
  if (gestureMs < PTZ_SLOW_DRAG_ENTER_MS) {
    return PTZ_HOLD_SPEED_MIN;
  }
  const holdMs = gestureMs - PTZ_SLOW_DRAG_ENTER_MS;
  const t = Math.sqrt(clamp(holdMs / PTZ_HOLD_RAMP_MS, 0, 1));
  return clamp(
    PTZ_HOLD_SPEED_MIN + t * (PTZ_HOLD_SPEED_MAX - PTZ_HOLD_SPEED_MIN),
    PTZ_HOLD_SPEED_MIN,
    PTZ_HOLD_SPEED_MAX,
  );
}

function applyMagnitudeToSpeed(
  mag: number,
  ax: number,
  ay: number,
  isDiagonal: boolean,
  speedCap = PTZ_QUICK_SPEED,
): EoPtzMoveSpeed {
  if (isDiagonal) {
    const sum = ax + ay || 1;
    const panW = ax / sum;
    const tiltW = ay / sum;
    return {
      pan: clamp(mag * panW * 2, PTZ_HOLD_SPEED_MIN, speedCap),
      tilt: clamp(mag * tiltW * 2, PTZ_HOLD_SPEED_MIN, speedCap),
    };
  }
  return { pan: mag, tilt: PTZ_HOLD_SPEED_MIN };
}

export function resolvePtzDragFromDelta(
  dx: number,
  dy: number,
  gestureMs: number,
  opts?: { flick?: boolean },
): { direction: EoPtzDragDirection | null; speed: EoPtzMoveSpeed } {
  const dist = Math.hypot(dx, dy);
  const fallbackSpeed: EoPtzMoveSpeed = { pan: PTZ_HOLD_SPEED_MIN, tilt: PTZ_HOLD_SPEED_MIN };
  if (dist < PTZ_DRAG_TRIGGER_PX) {
    return { direction: null, speed: fallbackSpeed };
  }

  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const flick = opts?.flick === true;
  const mag = flick ? flickSpeedFromDist(dist) : ptzDragMagnitudeFromGesture(gestureMs);
  const speedCap = flick ? mag : PTZ_QUICK_SPEED;
  const maxAxis = Math.max(ax, ay);
  const minAxis = Math.min(ax, ay);
  const isDiagonal =
    minAxis >= PTZ_DRAG_DIAGONAL_MIN_AXIS_PX && maxAxis > 0 && minAxis / maxAxis >= PTZ_DRAG_DIAGONAL_MIN_RATIO;

  if (isDiagonal) {
    const h = dx >= 0 ? "RIGHT" : "LEFT";
    const v = dy >= 0 ? "DOWN" : "UP";
    const direction = `${h}_${v}` as EoPtzDragDirection;
    return { direction, speed: applyMagnitudeToSpeed(mag, ax, ay, true, speedCap) };
  }

  const direction: EoPtzDragDirection =
    ax >= ay ? (dx >= 0 ? "RIGHT" : "LEFT") : dy >= 0 ? "DOWN" : "UP";
  return { direction, speed: applyMagnitudeToSpeed(mag, ax, ay, false, speedCap) };
}

export function ptzSpeedChanged(a: EoPtzMoveSpeed, b: EoPtzMoveSpeed, epsilon = 0.04): boolean {
  return Math.abs(a.pan - b.pan) > epsilon || Math.abs(a.tilt - b.tilt) > epsilon;
}

/** 换向时是否需先 stop（仅 180° 翻转） */
export function ptzDirectionChangeNeedsStop(
  prev: EoPtzDragDirection | null,
  next: EoPtzDragDirection,
): boolean {
  if (!prev || prev === next) return false;
  const pan = (d: EoPtzDragDirection) => {
    if (d.includes("LEFT")) return -1;
    if (d.includes("RIGHT")) return 1;
    return 0;
  };
  const tilt = (d: EoPtzDragDirection) => {
    if (d.includes("UP") && !d.includes("DOWN")) return -1;
    if (d.includes("DOWN")) return 1;
    if (d === "UP") return -1;
    if (d === "DOWN") return 1;
    return 0;
  };
  const pp = pan(prev);
  const pn = pan(next);
  const tp = tilt(prev);
  const tn = tilt(next);
  if (pp !== 0 && pn !== 0 && pp !== pn) return true;
  if (tp !== 0 && tn !== 0 && tp !== tn) return true;
  return false;
}
