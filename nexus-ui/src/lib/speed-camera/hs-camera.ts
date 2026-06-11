/**
 * 高速相机（camera-hs-001 ~ 004）专用逻辑
 *
 * 与普通光电的区别：
 * - 普通相机：FOV 默认跟随 app-config / 显隐设置
 * - 高速相机：FOV 默认关闭，只有收到检测框时才临时打开
 *
 * 数据来源（后端 UDP → WebSocket）：
 * - SpeedCamera          设备状态（坐标、PTZ、FOV 开角等），走 useUnifiedWsFeed 光电分支
 * - SpeedCameraDetection 检测框列表 boxes[]，走 onHsCameraDetection
 *
 * 渲染链路：
 * 1. 本模块写 properties.fov_sector_visible 或 displayOverrides
 * 2. Map2D 合并 overrides 后 adaptAssetsForMap → showFov
 * 3. OptoelectronicFovModule 画扇形（还需要 lat/lng、heading、fov_angle、range）
 *
 * 测试时常亮 FOV：把 HS_CAMERA_FOV_TEST_ALWAYS_ON 改为 true（测完改回 false）
 */
import { useAssetStore } from "@/stores/asset-store";

/** 测试开关：true = 四个高速相机 FOV 始终显示（不受检测超时影响） */
export const HS_CAMERA_FOV_TEST_ALWAYS_ON = false;

/** 参与高速相机逻辑的设备 ID（与 entity_status / UDP JSON 里的 entityId 一致） */
export const HS_CAMERA_IDS = new Set([
  "camera-hs-001",
  "camera-hs-002",
  "camera-hs-003",
  "camera-hs-004",
]);

/** 高速相机 FOV 扇区最大射程（米）；地图 `range_km` 不超过此值 */
export const HS_CAMERA_FOV_MAX_RANGE_M = 1500;
export const HS_CAMERA_FOV_RANGE_KM = HS_CAMERA_FOV_MAX_RANGE_M / 1000;

/** 高速相机 FOV 填充（仅 camera-hs-*；覆盖 app-config `cameras.sectorFill`） */
export const HS_CAMERA_FOV_FILL_COLOR = "#e6d328";
export const HS_CAMERA_FOV_FILL_OPACITY = 0.42;

/** 解析高速相机 FOV 量程（千米）：默认 1500m，协议值更大时截断 */
export function hsCameraFovRangeKm(wsRangeKm?: number | null): number {
  const cap = HS_CAMERA_FOV_RANGE_KM;
  const n = wsRangeKm != null ? Number(wsRangeKm) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.min(n, cap);
  return cap;
}

/** 超过此时间未收到带 boxes 的检测帧，则关 FOV 并移除告警 */
const DETECTION_STALE_MS = 2000;

/** 每台相机最近一次「有检测框」的时间戳（毫秒） */
const lastDetectionMs: Record<string, number> = {};

export function isHsCamera(id: string) {
  return HS_CAMERA_IDS.has(id.trim());
}

/** 当前是否应显示 FOV：测试常亮 / 或 2s 内有过检测 */
export function hsFovOn(id: string) {
  if (HS_CAMERA_FOV_TEST_ALWAYS_ON && isHsCamera(id)) return true;
  const t = lastDetectionMs[id.trim()];
  return t != null && Date.now() - t <= DETECTION_STALE_MS;
}

/**
 * 写入高速相机的 FOV 显隐标记（仅 HS_CAMERA_IDS 生效，其它 ID 直接 return）
 * 调用方：entity_status 合并、SpeedCamera 实时状态
 */
export function applyHsCameraFovProps(entityId: string, props: Record<string, unknown>) {
  if (!isHsCamera(entityId)) return;
  props.speed_camera = true;
  props.fov_sector_visible = hsFovOn(entityId);
  props.fov_fill_color = HS_CAMERA_FOV_FILL_COLOR;
  props.fov_fill_opacity = HS_CAMERA_FOV_FILL_OPACITY;
}

/** 通过 displayOverride 即时改 FOV；Map2D.flushAssets 时会合并进 properties */
function setFovVisible(entityId: string, visible: boolean, rebuild?: () => void) {
  useAssetStore.getState().setDisplayOverride(entityId, { fov_sector_visible: visible });
  rebuild?.();
}

/**
 * 处理 SpeedCameraDetection WS 消息
 * - boxes 非空：记时间、开 FOV
 * - entityId 不在 HS_CAMERA_IDS：忽略
 */
export function onHsCameraDetection(payload: Record<string, unknown>, rebuild?: () => void) {
  const entityId = String(payload.entityId ?? payload.entity_id ?? "").trim();
  if (!isHsCamera(entityId)) return;

  const boxes = Array.isArray(payload.boxes) ? payload.boxes : [];
  if (boxes.length === 0) return;

  console.info("[HsCamera] 有效检测框", {
    entityId,
    boxCount: boxes.length,
    boxes,
    width: payload.width,
    height: payload.height,
    hasDetection: payload.hasDetection,
  });

  lastDetectionMs[entityId] = Date.now();
  setFovVisible(entityId, true, rebuild);
}

/**
 * 定时清理：2s 内无新检测 → 关 FOV
 * 由 useUnifiedWsFeed 每 500ms 调用一次
 */
export function tickHsCameraDetection(rebuild?: () => void) {
  if (HS_CAMERA_FOV_TEST_ALWAYS_ON) return;

  const now = Date.now();
  for (const [entityId, seenAt] of Object.entries(lastDetectionMs)) {
    if (now - seenAt <= DETECTION_STALE_MS) continue;
    delete lastDetectionMs[entityId];
    setFovVisible(entityId, false, rebuild);
  }
}
