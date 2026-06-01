/**
 * ══════════════════════════════════════════════════════════════════════
 *  激光 / TDOA —— DDS 实时状态驱动地图扇区「发射 / 停射」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 【入口】useUnifiedWsFeed 收到 WS：
 *   - type = LaserStatus / laser_status  → applyLaserWsPayload()
 *   - type = TdoaStatus  / tdoa_status   → applyTdoaWsPayload()
 *
 * 【本文件职责】
 *   1. 把 DDS 字段写入 asset-store（站址、deviceState、targetID、laserState/tdoaState）
 *   2. 按 deviceState 决定是否在地图上「发射」（显示扇区 + 扫描）
 *   3. 不负责画扇区几何本身（由 LaserMaplibre / TdoaMaplibre 渲染）
 *
 * 【deviceState 与发射】（与标牌「待机 / 上电 / 执行」一致）
 *   - 0 待机、1 上电 → 不发射（关扇区）
 *   - 2 执行         → 发射（开扇区，朝向 targetID 对应航迹）
 *
 * 【发射 vs 更新朝向 —— 两套机制】
 *
 *   ┌─ 发射开关（开/关扇区、是否进入执行态）────────────────────────────┐
 *   │  syncWeaponEmission()                                              │
 *   │    deviceState===2 → activateLaser / activateTdoa（首次对准）      │
 *   │                   或 register*Follow + enableWeaponSector…（无坐标）│
 *   │    deviceState!==2 → deactivateLaser / deactivateTdoa（停射）       │
 *   │  实现在：laser-activation.ts / tdoa-activation.ts                    │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 *   ┌─ 持续更新朝向（执行态下扇区跟着目标动）────────────────────────────┐
 *   │  activate* 传入 follow 时会 registerLaserFollow / registerTdoaFollow │
 *   │  disposal-weapon-follow.ts：tickFollowHeadings() 每 120ms            │
 *   │    读航迹最新经纬度 → bearingTo → 更新 LaserDevice.headingDeg        │
 *   │  本文件在「有 targetID 但航迹尚未到」时也会先 register*Follow，      │
 *   │  等 tick 补上朝向。                                                  │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * 【资产从哪来】
 *   - entity_status 可创建 laser/tdoa 入库（mapOneEntityRow）
 *   - app-config 静态 devices 也可预置同 id
 *   - 本模块 DDS 路径不新建行：须 store 里已有同 entityId，再 merge + 发射
 *
 * 【与处置方案的关系】
 *   处置执行也会走 activateLaser/activateTdoa + register*Follow（同一套朝向逻辑）。
 *   DDS deviceState 为待机/上电时会 deactivate*，覆盖处置留下的发射态。
 */

import type { AssetData } from "@/stores/asset-store";
import { useAssetStore } from "@/stores/asset-store";
import { isVirtualFromProperties } from "@/lib/map-entity-model";
import {
  assetStatusFromDeviceState,
  deviceStatePropsFromPayload,
} from "@/lib/map-app-config";
import { resolveTrackLngLatForTargetId } from "@/lib/asset-target-line";
import {
  registerLaserFollow,
  registerTdoaFollow,
} from "@/lib/disposal/disposal-weapon-follow";
import { getMapModules } from "@/lib/map-module-registry";
import {
  getDirectedWeaponGeometryDefaults,
  getDirectedWeaponScanDefaults,
  getLaserActivationEnabled,
  getTdoaActivationEnabled,
  setLaserActivationEnabled,
  setTdoaActivationEnabled,
} from "@/lib/map-app-config";
import { activateLaser, deactivateLaser } from "@/lib/laser-activation";
import { activateTdoa, deactivateTdoa } from "@/lib/tdoa-activation";

/** BaseDeviceStatus.deviceState：2 = 执行（地图上要发射） */
const DEVICE_STATE_EXECUTING = 2;

export type DirectedWeaponKind = "laser" | "tdoa";

const suppressedActivationByTarget = new Map<string, Set<string>>();

function normalizedText(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizedDeviceId(v: unknown): string {
  return normalizedText(v).toLowerCase();
}

export function suppressWeaponActivationForTargetDevices(targetId: string, deviceIds: Iterable<string>): void {
  const tid = normalizedText(targetId);
  if (!tid) return;
  let set = suppressedActivationByTarget.get(tid);
  if (!set) {
    set = new Set<string>();
    suppressedActivationByTarget.set(tid, set);
  }
  for (const id of deviceIds) {
    const did = normalizedDeviceId(id);
    if (did) set.add(did);
  }
  if (set.size === 0) suppressedActivationByTarget.delete(tid);
}

export function clearWeaponActivationSuppression(targetId: string, deviceId: string): void {
  const tid = normalizedText(targetId);
  const did = normalizedDeviceId(deviceId);
  if (!tid || !did) return;
  const set = suppressedActivationByTarget.get(tid);
  if (!set) return;
  set.delete(did);
  if (set.size === 0) suppressedActivationByTarget.delete(tid);
}

export function clearAllWeaponActivationSuppressions(): void {
  suppressedActivationByTarget.clear();
}

function isWeaponActivationSuppressed(targetId: string, deviceId: string): boolean {
  const tid = normalizedText(targetId);
  const did = normalizedDeviceId(deviceId);
  if (!tid || !did) return false;
  return suppressedActivationByTarget.get(tid)?.has(did) === true;
}

/** 从 DDS 载荷取武器健康态（0良好 1繁忙 2故障 3损毁），仅写入 properties，不参与发射判断 */
function weaponStateFromPayload(d: Record<string, unknown>, kind: DirectedWeaponKind): number {
  if (kind === "laser") {
    return Number(d.laserState ?? d.laser_state ?? 0);
  }
  return Number(d.tdoaState ?? d.tdoa_state ?? d.laserState ?? d.laser_state ?? 0);
}

/** properties 里保存完整 DDS 快照的键名 */
function weaponStatusPropKey(kind: DirectedWeaponKind): "laser_status" | "tdoa_status" {
  return kind === "laser" ? "laser_status" : "tdoa_status";
}

/** properties 里保存武器健康态数字的键名 */
function weaponStatePropKey(kind: DirectedWeaponKind): "laserState" | "tdoaState" {
  return kind === "laser" ? "laserState" : "tdoaState";
}

/**
 * 执行态但尚解析不到目标经纬度时：先打开扇区图层与 activationEnabled，
 * 朝向由 disposal-weapon-follow 的 tick 在航迹到达后写入。
 * （不负责算方位角，只负责「先亮起来」。）
 */
function enableWeaponSectorWithoutTarget(entityId: string, kind: DirectedWeaponKind): void {
  const mods = getMapModules();
  if (!mods) return;

  if (kind === "laser") {
    // ① 根级激光图层若关着，先打开（填充/扫描/边线）
    if (!getLaserActivationEnabled()) {
      setLaserActivationEnabled(true);
      mods.laser.setLayerVisibility({ fillVisible: true, scanFillVisible: true, lineVisible: true });
    }
    // ② 激光不能只打开 activationEnabled；需要补齐激光自己的 scan 参数，触发 LaserMaplibre 的脉冲渲染。
    const prev = mods.laser.getDevice(entityId);
    if (prev) {
      const geometryDefaults = getDirectedWeaponGeometryDefaults("laser");
      const scanDefaults = getDirectedWeaponScanDefaults("laser");
      mods.laser.upsert({
        ...prev,
        openingDeg: prev.openingDeg > 0.1 ? prev.openingDeg : geometryDefaults.openingDeg ?? prev.openingDeg,
        rangeKm: prev.rangeKm > 0.001 ? prev.rangeKm : geometryDefaults.rangeKm ?? prev.rangeKm,
        activationEnabled: true,
        scan: {
          cycleMs: prev.scan?.cycleMs && prev.scan.cycleMs > 0 ? prev.scan.cycleMs : scanDefaults.cycleMs,
          tickMs: prev.scan?.tickMs && prev.scan.tickMs > 0 ? prev.scan.tickMs : scanDefaults.tickMs,
          bandCount: prev.scan?.bandCount && prev.scan.bandCount > 0 ? prev.scan.bandCount : scanDefaults.bandCount,
          bandWidthMeters:
            prev.scan?.bandWidthMeters && prev.scan.bandWidthMeters > 0 ? prev.scan.bandWidthMeters : scanDefaults.bandWidthMeters,
        },
      });
    }
  } else {
    if (!getTdoaActivationEnabled()) {
      setTdoaActivationEnabled(true);
      mods.tdoa.setLayerVisibility({ fillVisible: true, scanFillVisible: true, lineVisible: true });
    }
    const prev = mods.tdoa.getDevice(entityId);
    if (prev) {
      const geometryDefaults = getDirectedWeaponGeometryDefaults("tdoa");
      mods.tdoa.upsert({
        ...prev,
        openingDeg: prev.openingDeg > 0.1 ? prev.openingDeg : geometryDefaults.openingDeg ?? prev.openingDeg,
        rangeKm: prev.rangeKm > 0.001 ? prev.rangeKm : geometryDefaults.rangeKm ?? prev.rangeKm,
        activationEnabled: true,
      });
    }
  }
}

/**
 * 【发射开关】根据 deviceState 同步地图扇区开/关，并挂上或卸下目标跟随。
 *
 * - 执行(2)：有目标坐标 → activateLaser/activateTdoa（首次 bearing + 开扇区 + register*Follow）
 *           无目标坐标 → register*Follow + enableWeaponSectorWithoutTarget（朝向稍后由 tick 更新）
 * - 待机(0)/上电(1)：deactivate*（关扇区、unregister*Follow）
 *
 * 持续改 headingDeg 不在这里，在 disposal-weapon-follow.tickFollowHeadings。
 */
function syncWeaponEmission(
  entityId: string,
  deviceState: number,
  targetId: string | null,
  kind: DirectedWeaponKind,
): void {
  if (deviceState === DEVICE_STATE_EXECUTING) {
    // ── 分支 A：DDS 报「执行」→ 要发射 ──
    if (!targetId) return; // 无目标 ID 无法对准，直接返回

    // ② 用 targetID 在航迹 store 里查目标当前经纬度
    if (isWeaponActivationSuppressed(targetId, entityId)) return;
    const pos = resolveTrackLngLatForTargetId(targetId);
    const follow = { trackTargetId: targetId };

    if (pos) {
      // ③-A 有坐标：走「首次发射」—— activate* 内算 heading + 开扇区 + register*Follow
      if (kind === "laser") activateLaser(entityId, pos.lng, pos.lat, follow);
      else activateTdoa(entityId, pos.lng, pos.lat, follow);
      // ④-A 之后朝向由 tickFollowHeadings 每 120ms 更新，本函数不再管
      return;
    }

    // ③-B 无坐标：先登记跟瞄列表，扇区先亮，朝向等 tick 补上
    if (kind === "laser") registerLaserFollow(entityId, targetId);
    else registerTdoaFollow(entityId, targetId);
    enableWeaponSectorWithoutTarget(entityId, kind);
    return;
  }

  // ── 分支 B：待机(0) / 上电(1) → 停射 ──
  // ① unregister*Follow ② activationEnabled=false ③ 必要时关整层激光/TDOA 图层
  if (kind === "laser") deactivateLaser(entityId);
  else deactivateTdoa(entityId);
}

/**
 * 【写 store】把 DDS 状态合并进已有设备行，不新建资产。
 * 行须已存在：entity_status 或 app-config 静态配置（entityId 一致）。
 * 合并完成后调用 syncWeaponEmission 驱动地图发射态。
 */
function patchExistingWeaponAsset(
  entityId: string,
  d: Record<string, unknown>,
  kind: DirectedWeaponKind,
): boolean {
  const store = useAssetStore.getState();

  // ① store 里须已有同 id（entity_status / 静态配置）；无则 DDS 本条直接丢弃
  const existing = store.assets.find((a) => a.id === entityId);
  if (!existing) return false;

  // ② 从 DDS 拆字段
  const lat = Number(d.latitude);
  const lng = Number(d.longitude);
  const deviceState = Number(d.deviceState ?? d.device_state ?? 0);
  const weaponState = weaponStateFromPayload(d, kind);
  const targetId =
    d.targetID != null || d.target_id != null
      ? String(d.targetID ?? d.target_id).trim() || null
      : null;

  const prevProps =
    existing.properties && typeof existing.properties === "object"
      ? ({ ...(existing.properties as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  const virtualTroop = isVirtualFromProperties(d);

  // ③ 合并进 asset-store（标牌、列表、专题层中心图标读 virtual_troop / isVirtualWeapon）
  const patch: Partial<AssetData> = {
    status: assetStatusFromDeviceState(deviceState),
    assigned_target_id: targetId,
    properties: {
      ...prevProps,
      ws_weapon_device: true,
      [weaponStatePropKey(kind)]: weaponState,
      [weaponStatusPropKey(kind)]: d,
      ...deviceStatePropsFromPayload(d),
      virtual_troop: virtualTroop,
      is_virtual: virtualTroop,
      virtualTroop: virtualTroop,
      isVirtualWeapon: virtualTroop,
    },
  };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    patch.lat = lat;
    patch.lng = lng;
  }
  store.mergeAssetFields(entityId, patch);

  // ④ 根据 deviceState 同步地图扇区（发射/停射），与 store 写在同一次 WS 里完成
  syncWeaponEmission(entityId, deviceState, targetId, kind);
  return true;
}

/** 激光 / TDOA 通用入口；kind 区分资产类型与 properties 键名 */
export function applyDirectedWeaponWsPayload(
  d: Record<string, unknown>,
  kind: DirectedWeaponKind,
): void {
  // ① 取 entityId  ② patchExistingWeaponAsset（内部：写 store → syncWeaponEmission）
  const entityId = String(d.entityId ?? d.entity_id ?? "").trim();
  if (!entityId) return;
  patchExistingWeaponAsset(entityId, d, kind);
}

/** WS LaserStatus → 本模块（entityId 须与 entity_status 或 app-config laserWeapons.devices[].deviceId 一致） */
export function applyLaserWsPayload(d: Record<string, unknown>): void {
  applyDirectedWeaponWsPayload(d, "laser");
}

/** WS TdoaStatus → 本模块（entityId 须与 entity_status 或 app-config tdoa.devices[].deviceId 一致） */
export function applyTdoaWsPayload(d: Record<string, unknown>): void {
  applyDirectedWeaponWsPayload(d, "tdoa");
}
