/** 与 EoVideoPlayStage / camera-task 共用的拖拽 PTZ 方向（含 8 向；滚轮变倍仍用） */
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

/** 按下后超过该像素才发绝对定位（过滤点击） */
export const PTZ_ABS_DRAG_MIN_PX = 6;

export const PTZ_DRAG_TRIGGER_PX = 14;
const PTZ_FLICK_TRIGGER_PX = 10;

/** @deprecated 长按已移除 */
export const PTZ_SLOW_DRAG_ENTER_MS = 3000;

export const PTZ_QUICK_SPEED = 63 / 64;
export const PTZ_FLICK_SPEED_MIN = 0.18;
export const PTZ_FLICK_SPEED_MAX = 0.44;
export const PTZ_QUICK_FLICK_DIST_REF_PX = 120;
export const PTZ_FLICK_PULSE_GAP_MS = 100;
export const PTZ_HOLD_RAMP_MS = 4000;
export const PTZ_HOLD_SPEED_MIN = 0.15;
export const PTZ_HOLD_SPEED_MAX = 0.55;

const PTZ_DRAG_DIAGONAL_MIN_AXIS_PX = 7;
const PTZ_DRAG_DIAGONAL_MIN_RATIO = 0.35;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function normalizePanDeg360(panDeg: number): number {
  let p = panDeg % 360;
  if (p < 0) p += 360;
  return p;
}

/**
 * DDS `ptz.tilt`（= `m_calcT`）→ 几何俯仰角 °。
 * 对齐 `PtzMainWidget::ShowPTZ` 非 11hw：`originT * 90`。
 * 例：GPL 水平时常 calcT≈±180 → 几何约 0°；勿把 calcT 当 AbsolutePosition 的 tilt。
 */
export function calcTToGeometricTiltDeg(calcT: number): number {
  const originT = calcT <= 0 ? -calcT / 180 - 1 : 1 - calcT / 180;
  return originT * 90;
}

/** 合理当前视场（°）；拒绝 0 / NaN / 把 90 俯仰量程误当 FOV */
export function isPlausibleFovDeg(deg: number): boolean {
  return Number.isFinite(deg) && deg > 0.05 && deg <= 90;
}

/**
 * 对齐 `PtzMainWidget::mouseReleaseEvent` 非 11hw：
 * 把按下点画面内容挪到松手点。
 *
 * `x_offset = (press - release) / size * FOV`（归一化后即 `(pressNorm - releaseNorm) * FOV`）；
 * `index==0` 时水平 FOV 乘 2。
 * 返回 HTTP `PTZAbsolutePositionTask` 用的物理量：pan 0–360°、tilt 几何 °。
 */
export function resolvePtzAbsoluteFromDrag(params: {
  /** 按下点在视频内容区内的归一化坐标 [0,1] */
  pressNormX: number;
  pressNormY: number;
  releaseNormX: number;
  releaseNormY: number;
  /** DDS / 实体 `ptz.pan` = m_calcP，度 0–360 */
  panDeg: number;
  /** DDS / 实体 `ptz.tilt` = m_calcT（编码角，非几何） */
  tiltCalc: number;
  /** 当前水平视场 °（`ptz.hs` / `fov.hs`） */
  hsDeg: number;
  /** 当前垂直视场 °（`ptz.vs` / `fov.vs`） */
  vsDeg: number;
  /** 相机序号：`camera_000`→0，仅 0 号水平 FOV×2 */
  cameraIndex: number;
}): { panDeg: number; tiltDeg: number; xOffsetDeg: number; yOffsetDeg: number } | null {
  const {
    pressNormX,
    pressNormY,
    releaseNormX,
    releaseNormY,
    panDeg,
    tiltCalc,
    hsDeg,
    vsDeg,
    cameraIndex,
  } = params;

  if (!isPlausibleFovDeg(hsDeg) || !isPlausibleFovDeg(vsDeg)) return null;
  if (
    ![pressNormX, pressNormY, releaseNormX, releaseNormY, panDeg, tiltCalc].every((n) =>
      Number.isFinite(n),
    )
  ) {
    return null;
  }
  if (
    pressNormX < 0 ||
    pressNormX > 1 ||
    pressNormY < 0 ||
    pressNormY > 1 ||
    releaseNormX < 0 ||
    releaseNormX > 1 ||
    releaseNormY < 0 ||
    releaseNormY > 1
  ) {
    return null;
  }

  let xOffset = (pressNormX - releaseNormX) * hsDeg;
  const yOffset = (pressNormY - releaseNormY) * vsDeg;
  if (cameraIndex === 0) xOffset *= 2;
  if (xOffset === 0 && yOffset === 0) return null;

  /** 与 Qt 一致：偏移幅度不应远超一帧视场（防归一化/FOV 错读飞镜） */
  if (Math.abs(xOffset) > hsDeg * 1.05 + 1e-6 || Math.abs(yOffset) > vsDeg * 1.05 + 1e-6) {
    return null;
  }

  const pan = normalizePanDeg360(normalizePanDeg360(panDeg) + xOffset);
  const tilt = clamp(calcTToGeometricTiltDeg(tiltCalc) - yOffset, -90, 90);
  return { panDeg: pan, tiltDeg: tilt, xOffsetDeg: xOffset, yOffsetDeg: yOffset };
}

/** 滚轮等方向控制仍用 */
export function flickDistRatio(dist: number): number {
  const span = Math.max(PTZ_QUICK_FLICK_DIST_REF_PX - PTZ_DRAG_TRIGGER_PX, 1);
  return clamp((dist - PTZ_DRAG_TRIGGER_PX) / span, 0, 1);
}

export function flickSpeedFromDist(dist: number): number {
  const t = Math.sqrt(flickDistRatio(dist));
  return clamp(
    PTZ_FLICK_SPEED_MIN + t * (PTZ_FLICK_SPEED_MAX - PTZ_FLICK_SPEED_MIN),
    PTZ_FLICK_SPEED_MIN,
    PTZ_FLICK_SPEED_MAX,
  );
}

/** @deprecated */
export function isQuickFlickGesture(_gestureMs: number, dist: number): boolean {
  return dist >= PTZ_FLICK_TRIGGER_PX;
}

/** @deprecated */
export function resolvePtzFlickRelease(
  dx: number,
  dy: number,
  gestureMs: number,
): { direction: EoPtzDragDirection | null; speed: EoPtzMoveSpeed } {
  return resolvePtzDragFromDelta(dx, dy, gestureMs, { flick: true });
}

/** @deprecated */
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

/** @deprecated */
export function ptzDragMagnitudeFromGesture(_gestureMs: number): number {
  return PTZ_HOLD_SPEED_MIN;
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
  _gestureMs: number,
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
  const mag = flickSpeedFromDist(dist);
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
