/**
 * 与 Qt `CameraControlClient::DealCameraMetaTask` 对齐的光电相机管理 HTTP 客户端。
 *
 * **`owner.entityId`（重要）**  
 * Web 端须与 **entities 接口 / 光电注册表 / 右键当前视频流** 的实体 id 一致（`EoCameraRegistryRow.entityId`、
 * `mergeRegistryStreams` 里流的 `id`），与现有 `postEoPtzMove({ entityId })` 同源。  
 * 流 id 若带后缀（如 `camera_004_zlm`），请用 `resolveOwnerEntityIdForCameraTask` 或先 `parseCameraEntityIdFromStreamId`。
 *
 * Qt 侧用 `m_nCameraIndex` 拼出 `camera_%1` 三位序号；若后端 entities 已返回 `camera_004` 等形式，本处直接使用该字符串即可。
 *
 * 请求体字段： `taskId` / `parentTaskId` / `displayName` / `version` / `specification.@type` / `taskType` /
 * `maxExecutionTimeMs` / `createdBy` / `owner`。
 * POST：`http://{host}:{port}` + **`path`**；未配置 `path` 时与光电视频 BFF 一致为 **`/api/v1/tasks`**；显式 `path: ""`（app-config）为 Qt 根路径 `/`。
 */

import type { CameraManagementConfig } from "@/lib/map-app-config";
import { canonicalEntityId, parseCameraEntityIdFromStreamId } from "@/lib/camera-entity-id";

export type PtzMoveDirection =
  | "UP"
  | "DOWN"
  | "LEFT"
  | "LEFT_UP"
  | "LEFT_DOWN"
  | "RIGHT"
  | "RIGHT_UP"
  | "RIGHT_DOWN"
  | "ZOOM_IN"
  | "ZOOM_OUT"
  | "FOCUS_IN"
  | "FOCUS_OUT"
  | "TURN_ON"
  | "TURN_OFF"
  | "AUTO_FOCUS";

/** C++ `CameraControlClient::GetMaxZ`（按相机序号） */
export function maxZoomForCameraIndex(index: number): number {
  if (index === 0) return 30;
  if (index === 6) return 50;
  if (index === 2 || index === 5 || index === 13) return 5.2;
  return 86;
}

/** Qt 风格：`camera_001`（仅当没有 entities 字符串、只有序号时作回退） */
export function cameraEntityIdFromIndex(cameraIndex: number): string {
  const n = Math.floor(Number(cameraIndex));
  const safe = Number.isFinite(n) && n >= 0 ? n : 0;
  return `camera_${String(safe).padStart(3, "0")}`;
}

/**
 * 解析 `owner.entityId`：与光电右键/entities 对齐。
 * - `camera_004_zlm` → `camera_004`
 * - 其余走 `canonicalEntityId`（含纯数字、非标大小写等）
 */
export function resolveOwnerEntityIdForCameraTask(streamOrEntityId: string): string {
  const t = String(streamOrEntityId ?? "").trim();
  if (!t) return "";
  const fromStream = parseCameraEntityIdFromStreamId(t);
  if (fromStream) return fromStream;
  return canonicalEntityId(t);
}

/** 从 `camera_NNN` 式 id 取序号，供 `GetMaxZ`；无法解析时返回 null */
export function cameraIndexFromOwnerEntityId(ownerEntityId: string): number | null {
  const id = resolveOwnerEntityIdForCameraTask(ownerEntityId);
  const m = id.match(/^camera_(\d+)$/i);
  if (!m) return null;
  return parseInt(m[1], 10);
}

/** 配置默认对海 `owner.entityId` */
export function defaultSeaOwnerEntityId(cfg: CameraManagementConfig): string {
  const raw = cfg.seaOwnerEntityId?.trim();
  if (raw) return resolveOwnerEntityIdForCameraTask(raw);
  return cameraEntityIdFromIndex(cfg.seaCameraIndex);
}

/** 配置默认对空 `owner.entityId` */
export function defaultSkyOwnerEntityId(cfg: CameraManagementConfig): string {
  const raw = cfg.skyOwnerEntityId?.trim();
  if (raw) return resolveOwnerEntityIdForCameraTask(raw);
  return cameraEntityIdFromIndex(cfg.skyCameraIndex);
}

export type PtzSpeed = { pan: number; tilt: number; zoom?: number };

export type CameraManagementPublishResult = {
  ok: boolean;
  status: number;
  executionState?: string;
  permissionState?: string;
  errorMessage?: string;
  rawText: string;
  /** 无 HTTP 响应时（连接被拒、断网、超时、`res.text()` 失败等） */
  networkError?: string;
};

function taskTimeId(): string {
  const d = new Date();
  const pad = (x: number, w: number) => String(x).padStart(w, "0");
  return (
    pad(d.getHours(), 2) +
    pad(d.getMinutes(), 2) +
    pad(d.getSeconds(), 2) +
    pad(d.getMilliseconds(), 3)
  );
}

/** Qt `QDateTime::toString("yyyyMMdd_hhmmss_zzz")`，供 `alarmTime` 与 C++ 对齐 */
export function formatAlarmTimeQtLike(d: Date = new Date()): string {
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1, 2);
  const da = pad(d.getDate(), 2);
  const h = pad(d.getHours(), 2);
  const mi = pad(d.getMinutes(), 2);
  const s = pad(d.getSeconds(), 2);
  const zzz = pad(d.getMilliseconds(), 3);
  return `${y}${mo}${da}_${h}${mi}${s}_${zzz}`;
}

/** Qt 注释「查找几次 2-5」；mainwindow 远程分支未显式赋值时栈值不定，此处与注释块一致 */
const DEFAULT_IM_TARGET_CHECK_TIME = 2;

function normalizeImportantTargetCollection(t: ImportantTrackTargetCollection): Record<string, unknown> {
  const lat = Number.isFinite(t.latitude) ? Number(t.latitude) : 0;
  const lng = Number.isFinite(t.longitude) ? Number(t.longitude) : 0;
  const checkTime = Number.isFinite(t.checkTime) ? Number(t.checkTime) : DEFAULT_IM_TARGET_CHECK_TIME;
  const alarmID = t.alarmID != null ? String(t.alarmID) : "";
  const alarmTime =
    t.alarmTime != null && String(t.alarmTime).length > 0 ? String(t.alarmTime) : formatAlarmTimeQtLike();
  const trackTime = Number.isFinite(t.trackTime) ? Number(t.trackTime) : 25;
  const action = Number.isFinite(t.action) ? Number(t.action) : 1;
  return {
    latitude: lat,
    longitude: lng,
    type: t.type,
    checkTime,
    trackID: t.trackID,
    alarmID,
    alarmTime,
    trackTime,
    action,
    shipType: t.shipType,
  };
}

function baseVersion() {
  return { definitionVersion: 1, statusVersion: 1 };
}

function buildEnvelope(
  cfg: CameraManagementConfig,
  ownerEntityId: string,
  partial: {
    taskId: string;
    parentTaskId: string;
    displayName: string;
    specification: Record<string, unknown>;
    startCollection?: boolean;
    syncTask?: boolean;
  },
): Record<string, unknown> {
  const createdBy = {
    user: { userId: cfg.userId, priority: cfg.userPriority },
  };
  const owner = { entityId: resolveOwnerEntityIdForCameraTask(ownerEntityId) };
  const o: Record<string, unknown> = {
    taskId: partial.taskId,
    parentTaskId: partial.parentTaskId,
    displayName: partial.displayName,
    specification: partial.specification,
    version: baseVersion(),
    taskType: "MANUAL",
    maxExecutionTimeMs: 30000,
    createdBy,
    owner,
  };
  if (partial.startCollection !== undefined) o.startCollection = partial.startCollection;
  if (partial.syncTask !== undefined) o.syncTask = partial.syncTask;
  return o;
}

/** Qt `CameraFocusOnPos` 远程：`CAMERA_LOOK_AT_CHILD`，`trackID=0`、`shipType=3`；`checkTime` 与重点关注任务默认一致 */
export const DEFAULT_LOOK_AT_CHECK_TIME = 2;

/** 组装 `LookAtChildTask` POST 体（与 {@link CameraManagementClient.lookAtChild} 一致） */
export function buildLookAtChildTaskBody(
  cfg: CameraManagementConfig,
  ownerEntityId: string,
  lookAt: {
    latitude: number;
    longitude: number;
    trackID: number;
    shipType: number;
    checkTime: number;
  },
  opts?: { taskIdSuffix?: string },
): Record<string, unknown> {
  const tid = taskTimeId();
  const suf = opts?.taskIdSuffix
    ? `_${String(opts.taskIdSuffix).replace(/[^a-zA-Z0-9_]/g, "")}`
    : "";
  const taskKey = `camera_look_at_${tid}${suf}`;
  const specification: Record<string, unknown> = {
    "@type": "type.casia.tasks.v1.LookAtChildTask",
    lookAt,
  };
  return buildEnvelope(cfg, ownerEntityId, {
    taskId: taskKey,
    parentTaskId: taskKey,
    displayName: "光电对准",
    specification,
  });
}

/** `TargetCollectionIMChildTask` 的 `targetcollection`（重点关注采集） */
export type ImportantTrackTargetCollection = {
  /**
   * 远程光电控制下 Qt 常为 0（`mainwindow` `alarmLatitude`/`alarmLongitude`）；未传则按 0 组包。
   */
  latitude?: number;
  longitude?: number;
  /** 海面 0 / 对空 1（与 Qt 一致） */
  type: number;
  checkTime?: number;
  /** 航迹 `uniqueID`（与 Qt `alarmTrackID` / 后端字段一致） */
  trackID: number;
  /** Qt `QString`，JSON 为字符串，常 `""` */
  alarmID?: string;
  /** Qt `yyyyMMdd_hhmmss_zzz` */
  alarmTime?: string;
  trackTime?: number;
  action?: number;
  /** 对海融合航迹等为 3 */
  shipType: number;
};

export type AlarmTargetCollection = Omit<ImportantTrackTargetCollection, "shipType"> & {
  shipType?: number;
};

/** 组装 `TargetCollectionIMChildTask` 完整 POST 体（与 {@link CameraManagementClient.importantTrack} 一致），便于调试与打印 */
export function buildImportantTrackTaskBody(
  cfg: CameraManagementConfig,
  ownerEntityId: string,
  target: ImportantTrackTargetCollection,
  opts?: { taskIdSuffix?: string },
): Record<string, unknown> {
  const tid = taskTimeId();
  const suf = opts?.taskIdSuffix
    ? `_${String(opts.taskIdSuffix).replace(/[^a-zA-Z0-9_]/g, "")}`
    : "";
  const taskKey = `alarm_im_collectoin_${tid}${suf}`;
  const imUserId = cfg.imTaskUserId?.trim() || "operator";
  const imPriority =
    cfg.imTaskUserPriority !== undefined &&
    cfg.imTaskUserPriority !== null &&
    Number.isFinite(Number(cfg.imTaskUserPriority))
      ? Number(cfg.imTaskUserPriority)
      : 0;
  const specification: Record<string, unknown> = {
    "@type": "type.casia.tasks.v1.TargetCollectionIMChildTask",
    targetcollection: normalizeImportantTargetCollection(target),
  };
  return {
    taskId: taskKey,
    parentTaskId: taskKey,
    displayName: "重点关注目标采集",
    specification,
    version: baseVersion(),
    taskType: "MANUAL",
    maxExecutionTimeMs: 30000,
    createdBy: { user: { userId: imUserId, priority: imPriority } },
    owner: { entityId: resolveOwnerEntityIdForCameraTask(ownerEntityId) },
  };
}

async function fetchWithTimeout(
  url: string,
  body: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      signal: ctrl.signal,
      ...init,
    });
  } finally {
    window.clearTimeout(t);
  }
}

/** HTTPS 页面请求 HTTP 相机时走同源 API 代理，避免 Mixed Content */
function shouldProxyCameraPublish(publishUrl: string): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.protocol !== "https:") return false;
  try {
    return new URL(publishUrl).protocol === "http:";
  } catch {
    return false;
  }
}

function parsePublishResult(status: number, text: string): CameraManagementPublishResult {
  let executionState: string | undefined;
  let permissionState: string | undefined;
  let errorMessage: string | undefined;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (typeof j.executionState === "string") executionState = j.executionState;
    if (typeof j.permissionState === "string") permissionState = j.permissionState;
    const err = j.error;
    if (err && typeof err === "object" && err !== null && "message" in err) {
      const m = (err as Record<string, unknown>).message;
      if (typeof m === "string") errorMessage = m;
    }
  } catch {
    /* 非 JSON 响应 */
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    executionState,
    permissionState,
    errorMessage,
    rawText: text,
  };
}

export class CameraManagementClient {
  constructor(private readonly cfg: CameraManagementConfig) {}

  get publishUrl(): string {
    const origin = `http://${this.cfg.host}:${this.cfg.port}`;
    const raw = this.cfg.path;
    const pathname =
      raw === undefined || raw === null
        ? "/api/v1/tasks"
        : raw === ""
          ? "/"
          : raw.startsWith("/")
            ? raw
            : `/${raw}`;
    return new URL(pathname, origin).toString();
  }

  /** 原始任务 JSON POST（与 Qt 多数任务相同）；网络失败时 `ok: false`、`status: 0`，不抛异常 */
  async publishTask(taskObject: Record<string, unknown>): Promise<CameraManagementPublishResult> {
    const targetUrl = this.publishUrl;
    const bodyDirect = JSON.stringify(taskObject);
    if (typeof console !== "undefined") {
      console.info("[camera-management] 发往相机管理的 JSON:\n", bodyDirect);
      console.info("[camera-management] 目标 URL:", targetUrl);
    }
    const useProxy = shouldProxyCameraPublish(targetUrl);
    if (useProxy) {
      console.info("[camera-management] HTTPS→HTTP，经同源代理 /api/camera-management/publish");
    }
    try {
      const res = useProxy
        ? await fetchWithTimeout(
            "/api/camera-management/publish",
            JSON.stringify({ publishUrl: targetUrl, task: taskObject }),
            this.cfg.requestTimeoutMs,
          )
        : await fetchWithTimeout(targetUrl, bodyDirect, this.cfg.requestTimeoutMs);
      try {
        const text = await res.text();
        return parsePublishResult(res.status, text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          status: res.status,
          rawText: "",
          networkError: msg,
          errorMessage: msg,
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted =
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError");
      const friendly = aborted ? "请求超时或已取消" : msg;
      return {
        ok: false,
        status: 0,
        rawText: "",
        networkError: friendly,
        errorMessage: friendly,
      };
    }
  }

  private defaultSpeed(): PtzSpeed {
    return { pan: 0.5, tilt: 0.5 };
  }

  private async ptzMoveTask(
    ownerEntityId: string,
    direction: PtzMoveDirection,
    displayName: string,
    idPrefix: string,
    speed?: PtzSpeed,
  ): Promise<CameraManagementPublishResult> {
    const tid = taskTimeId();
    const sp = speed ?? this.defaultSpeed();
    const specification: Record<string, unknown> = {
      "@type": "type.casia.tasks.v1.PTZMoveTask",
      direction,
      speed: { pan: sp.pan, tilt: sp.tilt },
    };
    return this.publishTask(
      buildEnvelope(this.cfg, ownerEntityId, {
        taskId: `${idPrefix}_${tid}`,
        parentTaskId: `${idPrefix}_${tid}`,
        displayName,
        specification,
      }),
    );
  }

  ptzUp(ownerEntityId: string, speed?: PtzSpeed) {
    return this.ptzMoveTask(ownerEntityId, "UP", "上移云台", "ptz_up", speed);
  }
  ptzDown(ownerEntityId: string, speed?: PtzSpeed) {
    return this.ptzMoveTask(ownerEntityId, "DOWN", "下移云台", "ptz_down", speed);
  }
  ptzLeft(ownerEntityId: string, speed?: PtzSpeed) {
    return this.ptzMoveTask(ownerEntityId, "LEFT", "左移云台", "ptz_left", speed);
  }
  ptzRight(ownerEntityId: string, speed?: PtzSpeed) {
    return this.ptzMoveTask(ownerEntityId, "RIGHT", "右移云台", "ptz_right", speed);
  }
  ptzLeftUp(ownerEntityId: string, speed?: PtzSpeed) {
    return this.ptzMoveTask(ownerEntityId, "LEFT_UP", "左上移云台", "ptz_leftup", speed);
  }
  ptzLeftDown(ownerEntityId: string, speed?: PtzSpeed) {
    return this.ptzMoveTask(ownerEntityId, "LEFT_DOWN", "左下移云台", "ptz_leftdown", speed);
  }
  ptzRightUp(ownerEntityId: string, speed?: PtzSpeed) {
    return this.ptzMoveTask(ownerEntityId, "RIGHT_UP", "右上移云台", "ptz_rightup", speed);
  }
  ptzRightDown(ownerEntityId: string, speed?: PtzSpeed) {
    return this.ptzMoveTask(ownerEntityId, "RIGHT_DOWN", "右下移云台", "ptz_rightdown", speed);
  }
  zoomIn(ownerEntityId: string, speed?: PtzSpeed) {
    return this.ptzMoveTask(ownerEntityId, "ZOOM_IN", "云台变倍+", "ptz_zoomin", speed);
  }
  zoomOut(ownerEntityId: string, speed?: PtzSpeed) {
    return this.ptzMoveTask(ownerEntityId, "ZOOM_OUT", "云台变倍-", "ptz_zoomout", speed);
  }
  focusIn(ownerEntityId: string, speed?: PtzSpeed) {
    return this.ptzMoveTask(ownerEntityId, "FOCUS_IN", "云台焦距+", "ptz_focusin", speed);
  }
  focusOut(ownerEntityId: string, speed?: PtzSpeed) {
    return this.ptzMoveTask(ownerEntityId, "FOCUS_OUT", "云台焦距-", "ptz_focusout", speed);
  }
  turnOn(ownerEntityId: string) {
    return this.ptzMoveTask(
      ownerEntityId,
      "TURN_ON",
      "光电上电-",
      "ptz_turnon",
      { pan: 0, tilt: 0 },
    );
  }
  turnOff(ownerEntityId: string) {
    return this.ptzMoveTask(
      ownerEntityId,
      "TURN_OFF",
      "光电下电-",
      "ptz_turnoff",
      { pan: 0, tilt: 0 },
    );
  }
  autoFocus(ownerEntityId: string) {
    return this.ptzMoveTask(
      ownerEntityId,
      "AUTO_FOCUS",
      "光电自动对焦-",
      "ptz_autofocus",
      { pan: 0, tilt: 0 },
    );
  }

  /** `PTZAbsolutePositionTask`；变焦上限按 `ownerEntityId` 解析出的相机序号套用 `GetMaxZ` */
  async ptzAbsolutePosition(
    ownerEntityId: string,
    params: {
      setP: number;
      setT: number;
      setZ: number;
      speed?: PtzSpeed & { zoom?: number };
    },
  ): Promise<CameraManagementPublishResult> {
    const tid = taskTimeId();
    const speed = params.speed ?? { pan: 0.5, tilt: 0.5, zoom: 0.5 };
    const pRaw = params.setP;
    const p = pRaw < 0 ? 360 + pRaw * 180 : pRaw * 180;
    const camIdx = cameraIndexFromOwnerEntityId(ownerEntityId) ?? 0;
    const maxZ = maxZoomForCameraIndex(camIdx);
    const specification: Record<string, unknown> = {
      "@type": "type.casia.tasks.v1.PTZAbsolutePositionTask",
      position: {
        pan: p,
        tilt: params.setT * 90.0,
        zoom: params.setZ * maxZ,
      },
      speed: {
        pan: speed.pan,
        tilt: speed.tilt,
        zoom: speed.zoom ?? 0.5,
      },
    };
    return this.publishTask(
      buildEnvelope(this.cfg, ownerEntityId, {
        taskId: `ptz_abs_pos_${tid}`,
        parentTaskId: `ptz_abs_pos_${tid}`,
        displayName: "转向指定位置",
        specification,
      }),
    );
  }

  ptzHome(ownerEntityId: string, speed?: PtzSpeed & { zoom?: number }) {
    const tid = taskTimeId();
    const sp = speed ?? { pan: 0.5, tilt: 0.5, zoom: 0.5 };
    const specification: Record<string, unknown> = {
      "@type": "type.casia.tasks.v1.PTZHomeTask",
      speed: { pan: sp.pan, tilt: sp.tilt, zoom: sp.zoom ?? 0.5 },
    };
    return this.publishTask(
      buildEnvelope(this.cfg, ownerEntityId, {
        taskId: `ptz_home_${tid}`,
        parentTaskId: `ptz_home_${tid}`,
        displayName: "云台复位",
        specification,
      }),
    );
  }

  supplementSearch(ownerEntityId: string) {
    const tid = taskTimeId();
    return this.publishTask(
      buildEnvelope(this.cfg, ownerEntityId, {
        taskId: `ptz_supp_search__${tid}`,
        parentTaskId: `ptz_supp_search__${tid}`,
        displayName: "左右补充搜索",
        specification: { "@type": "type.casia.tasks.v1.PTZSupplementSearchTask" },
      }),
    );
  }

  cancelAllMetaTasks(ownerEntityId: string) {
    const tid = taskTimeId();
    return this.publishTask(
      buildEnvelope(this.cfg, ownerEntityId, {
        taskId: `cancel_all_${tid}`,
        parentTaskId: `cancel_all_${tid}`,
        displayName: "取消所有元任务",
        specification: { "@type": "type.casia.tasks.v1.CancelAllMetaTasksTask" },
      }),
    );
  }

  stopCurrentMove(ownerEntityId: string) {
    const tid = taskTimeId();
    return this.publishTask(
      buildEnvelope(this.cfg, ownerEntityId, {
        taskId: `ptz_control_stop_${tid}`,
        parentTaskId: `ptz_control_stop_${tid}`,
        displayName: "停止当前移动",
        specification: { "@type": "type.casia.tasks.v1.PTZStopControl" },
      }),
    );
  }

  /** `TargetCollectionIMChildTask` — 重点关注目标采集 */
  importantTrack(ownerEntityId: string, target: ImportantTrackTargetCollection) {
    return this.publishTask(buildImportantTrackTaskBody(this.cfg, ownerEntityId, target));
  }

  /** `TargetCollectionChildTask` — 告警采集 */
  alarmCollection(
    ownerEntityId: string,
    target: AlarmTargetCollection,
    opts?: { startCollection?: boolean; syncTask?: boolean },
  ) {
    const tid = taskTimeId();
    const specification: Record<string, unknown> = {
      "@type": "type.casia.tasks.v1.TargetCollectionChildTask",
      targetcollection: { ...target },
    };
    return this.publishTask(
      buildEnvelope(this.cfg, ownerEntityId, {
        taskId: `alarm_collection_${tid}`,
        parentTaskId: `alarm_collection_${tid}`,
        displayName: "告警采集",
        specification,
        startCollection: opts?.startCollection,
        syncTask: opts?.syncTask,
      }),
    );
  }

  lookAtChild(
    ownerEntityId: string,
    lookAt: {
      latitude: number;
      longitude: number;
      trackID: number;
      shipType: number;
      checkTime: number;
    },
    opts?: { taskIdSuffix?: string },
  ) {
    return this.publishTask(buildLookAtChildTaskBody(this.cfg, ownerEntityId, lookAt, opts));
  }

  static fromConfig(cfg: CameraManagementConfig | null | undefined): CameraManagementClient | null {
    if (!cfg) return null;
    return new CameraManagementClient(cfg);
  }
}
