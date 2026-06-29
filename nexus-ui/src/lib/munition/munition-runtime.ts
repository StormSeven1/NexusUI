/**
 * 巡飞弹资产：DDS 更新、摧毁特效；告警「消灭」巡飞弹 DELETE 见 alert-destroy.ts。
 * 摧毁后为一次性：从资产表剔除，且阻止静态/entity_status 重建时复活，直至再次收到正常 DDS。
 */

import type { AssetData } from "@/stores/asset-store";
import { useAssetStore } from "@/stores/asset-store";
import { useAppStore } from "@/stores/app-store";
import { playExplosionAt } from "@/lib/map/explosion-effect";
import { isVirtualFromProperties, normalizeAssetType } from "@/lib/map-entity-model";
import {
  assetStatusFromDeviceState,
  assetStatusFromMunitionState,
  deviceStatePropsFromPayload,
  getMunitionDestroyEffectsConfig,
} from "@/lib/map-app-config";
import { resolveTrackLngLatForTargetId } from "@/lib/asset-target-line";
import { postEngagementFinishCommand } from "@/lib/engagement/engagement-finish";
import { WEAPON_DEVICE_STATE_EXECUTING } from "@/lib/weapon/weapon-power-state";
import { useTaskProgressStore } from "@/stores/task-progress-store";

/** 已摧毁飞弹 id（一次性）；收到 munitionState=0 等正常态 DDS 后清除，允许新一轮入库 */
const destroyedMunitionIds = new Map<string, number>();
const lastMunitionStatusLog = new Map<string, string>();
const lastMunitionTargetMissLog = new Map<string, string>();

interface MunitionFrontendRuntime {
  targetId: string;
  armingUntil: number;
  lastState: number | null;
  detonated: boolean;
}

const munitionFrontendRuntime = new Map<string, MunitionFrontendRuntime>();

function pruneExpiredDestroyedMunitions(now = Date.now()): void {
  for (const [id, expiresAt] of destroyedMunitionIds) {
    if (expiresAt > 0 && expiresAt <= now) destroyedMunitionIds.delete(id);
  }
}

export function isMunitionDestroyed(entityId: string): boolean {
  pruneExpiredDestroyedMunitions();
  return destroyedMunitionIds.has(entityId);
}

/** 合并静态/WS 资产列表时排除已摧毁飞弹，避免 app-config 初始化行复活 */
export function filterOutDestroyedMunitions(assets: AssetData[]): AssetData[] {
  pruneExpiredDestroyedMunitions();
  return assets.filter((a) => {
    if (normalizeAssetType(a.asset_type) !== "missile") return true;
    const props =
      a.properties && typeof a.properties === "object"
        ? (a.properties as Record<string, unknown>)
        : null;
    const ids = [
      a.id,
      stringProp(props, "entityId"),
      stringProp(props, "entity_id"),
      stringProp(props, "deviceSn"),
      stringProp(props, "device_sn"),
    ].filter(Boolean);
    return !ids.some((id) => destroyedMunitionIds.has(id));
  });
}

function stringProp(props: Record<string, unknown> | null | undefined, key: string): string {
  const value = props?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function recordProp(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function finiteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function munitionDeviceStateFromPayload(d: Record<string, unknown>): number {
  const base =
    recordProp(d.baseDeviceStatus) ??
    recordProp(d.base_device_status) ??
    recordProp(d.baseStatus) ??
    recordProp(d.base_status) ??
    recordProp(d.base);
  return finiteNumber(
    d.deviceState,
    d.device_state,
    d.devicestate,
    d.DeviceState,
    base?.deviceState,
    base?.device_state,
    base?.devicestate,
    base?.DeviceState,
  ) ?? 0;
}

function munitionPositionFromPayload(d: Record<string, unknown>): { lat: number | null; lng: number | null } {
  const position =
    recordProp(d.position) ??
    recordProp(d.geoPosition) ??
    recordProp(d.geo_position) ??
    recordProp(d.location);
  return {
    lat: finiteNumber(d.latitude, d.lat, position?.latitude, position?.lat),
    lng: finiteNumber(d.longitude, d.lng, d.lon, position?.longitude, position?.lng, position?.lon),
  };
}

function munitionAliasIds(entityId: string): string[] {
  const raw = String(entityId ?? "").trim();
  if (!raw) return [];
  const aliases = new Set<string>([raw]);
  const low = raw.toLowerCase();
  for (const asset of useAssetStore.getState().assets) {
    if (normalizeAssetType(asset.asset_type) !== "missile") continue;
    const props =
      asset.properties && typeof asset.properties === "object"
        ? (asset.properties as Record<string, unknown>)
        : null;
    const assetAliases = [
      asset.id,
      stringProp(props, "entityId"),
      stringProp(props, "entity_id"),
      stringProp(props, "deviceSn"),
      stringProp(props, "device_sn"),
    ].filter(Boolean);
    if (assetAliases.some((id) => id.toLowerCase() === low)) {
      for (const id of assetAliases) aliases.add(id);
    }
  }
  return [...aliases];
}

function resolveMunitionEntityId(entityId: string): string {
  const raw = String(entityId ?? "").trim();
  if (!raw) return "";
  const low = raw.toLowerCase();
  for (const asset of useAssetStore.getState().assets) {
    if (normalizeAssetType(asset.asset_type) !== "missile") continue;
    const props =
      asset.properties && typeof asset.properties === "object"
        ? (asset.properties as Record<string, unknown>)
        : null;
    const assetAliases = [
      asset.id,
      stringProp(props, "entityId"),
      stringProp(props, "entity_id"),
      stringProp(props, "deviceSn"),
      stringProp(props, "device_sn"),
    ].filter(Boolean);
    if (!assetAliases.some((id) => id.toLowerCase() === low)) continue;
    return stringProp(props, "entityId") || stringProp(props, "entity_id") || asset.id;
  }
  return raw;
}

function resolveMunitionAssetId(entityId: string): string {
  const raw = String(entityId ?? "").trim();
  if (!raw) return "";
  const low = raw.toLowerCase();
  for (const asset of useAssetStore.getState().assets) {
    if (normalizeAssetType(asset.asset_type) !== "missile") continue;
    const props =
      asset.properties && typeof asset.properties === "object"
        ? (asset.properties as Record<string, unknown>)
        : null;
    const assetAliases = [
      asset.id,
      stringProp(props, "entityId"),
      stringProp(props, "entity_id"),
      stringProp(props, "deviceSn"),
      stringProp(props, "device_sn"),
    ].filter(Boolean);
    if (assetAliases.some((id) => id.toLowerCase() === low)) return asset.id;
  }
  return raw;
}

function deleteMunitionEntity(entityId: string): void {
  const id = String(entityId ?? "").trim();
  const cfg = getMunitionDestroyEffectsConfig();
  const template = cfg.munitionDeleteEntityUrlTemplate.trim();
  if (!id || !template) return;

  const url = template.includes("{id}")
    ? template.replaceAll("{id}", encodeURIComponent(id))
    : `${template.replace(/\/$/, "")}/${encodeURIComponent(id)}`;
  const timeoutMs = cfg.munitionDeleteEntityTimeoutMs;
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer =
    controller && timeoutMs > 0
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : null;

  void fetch(url, { method: "DELETE", signal: controller?.signal })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("[munition] delete entity failed:", url, res.status, text);
      }
    })
    .catch((error) => {
      console.error("[munition] delete entity error:", url, error);
    })
    .finally(() => {
      if (timer != null) window.clearTimeout(timer);
    });
}

function clearMunitionRuntimeOverlay(entityId: string): void {
  const store = useAssetStore.getState();
  const asset = store.assets.find((item) => item.id === entityId);
  if (!asset) return;
  const props =
    asset.properties && typeof asset.properties === "object"
      ? ({ ...(asset.properties as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  for (const key of [
    "ws_munition",
    "munitionState",
    "munition_status",
    "deviceState",
    "deviceStateLabel",
    "schemeActivatedWeapon",
    "attitude_head",
    "hitPoint",
    "simulated",
    "munitionQuantity",
    "munition_quantity",
    "munition_frontend_arming",
    "munition_frontend_active",
  ] as const) {
    delete props[key];
  }
  store.mergeAssetFields(entityId, {
    status: "online",
    assigned_target_id: null,
    target_lat: null,
    target_lng: null,
    properties: props,
  });
}

function distanceMeters(fromLng: number, fromLat: number, toLng: number, toLat: number): number {
  const earthRadiusM = 6371000;
  const phi1 = (fromLat * Math.PI) / 180;
  const phi2 = (toLat * Math.PI) / 180;
  const dPhi = ((toLat - fromLat) * Math.PI) / 180;
  const dLambda = ((toLng - fromLng) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
      Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(fromLng: number, fromLat: number, toLng: number, toLat: number): number {
  const phi1 = (fromLat * Math.PI) / 180;
  const phi2 = (toLat * Math.PI) / 180;
  const deltaLng = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(deltaLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function targetIdFromMunitionPayload(d: Record<string, unknown>): string {
  return String(d.targetID ?? "").trim();
}

function runtimeKey(entityId: string): string {
  return String(entityId ?? "").trim().toLowerCase();
}

function storedMunitionDeviceState(entityId: string): number | null {
  const assetId = resolveMunitionAssetId(entityId);
  const asset = useAssetStore.getState().assets.find((item) => item.id === assetId);
  const props =
    asset?.properties && typeof asset.properties === "object"
      ? (asset.properties as Record<string, unknown>)
      : null;
  const n = Number(props?.deviceState ?? props?.device_state ?? props?.devicestate ?? props?.DeviceState);
  return Number.isFinite(n) ? n : null;
}

function updateFrontendMunitionRuntime(
  entityId: string,
  d: Record<string, unknown>,
  lng: number,
  lat: number,
): { arming: boolean; active: boolean; detonated: boolean } {
  const key = runtimeKey(entityId);
  const deviceState = munitionDeviceStateFromPayload(d);
  const targetId = targetIdFromMunitionPayload(d);
  const now = Date.now();
  let runtime = munitionFrontendRuntime.get(key);
  const previousState = runtime?.lastState ?? storedMunitionDeviceState(entityId);

  if (deviceState !== WEAPON_DEVICE_STATE_EXECUTING || !targetId) {
    munitionFrontendRuntime.set(key, {
      targetId,
      armingUntil: 0,
      lastState: Number.isFinite(deviceState) ? deviceState : previousState,
      detonated: false,
    });
    return { arming: false, active: false, detonated: false };
  }

  const shouldStartArming =
    previousState != null &&
    previousState !== WEAPON_DEVICE_STATE_EXECUTING &&
    deviceState === WEAPON_DEVICE_STATE_EXECUTING &&
    (!runtime || runtime.targetId !== targetId || runtime.armingUntil <= now || runtime.detonated);

  if (!runtime || runtime.targetId !== targetId || runtime.detonated) {
    runtime = {
      targetId,
      armingUntil: shouldStartArming ? now + getMunitionDestroyEffectsConfig().munitionFrontendArmingMs : 0,
      lastState: deviceState,
      detonated: false,
    };
    munitionFrontendRuntime.set(key, runtime);
  } else if (shouldStartArming) {
    const cfg = getMunitionDestroyEffectsConfig();
    runtime.armingUntil = now + cfg.munitionFrontendArmingMs;
    runtime.lastState = deviceState;
  } else {
    runtime.lastState = deviceState;
  }

  const arming = now < runtime.armingUntil;
  if (arming) return { arming: true, active: false, detonated: false };

  const target = resolveTrackLngLatForTargetId(targetId);
  if (target) {
    const cfg = getMunitionDestroyEffectsConfig();
    const distance = distanceMeters(lng, lat, target.lng, target.lat);
    if (distance <= cfg.munitionAutoExplodeDistanceMeters && !runtime.detonated) {
      runtime.detonated = true;
      postEngagementFinishCommand("munition", targetId, entityId);
      useTaskProgressStore.getState().endByTargetDevices(targetId, [entityId]);
      destroyMunitionOnMap(entityId, lat, lng);
      return { arming: false, active: false, detonated: true };
    }
  }

  return { arming: false, active: true, detonated: false };
}

/** DDS attitude_head → 地图图标方位角（0=北，顺时针，与航迹/无人机一致） */
function munitionHeadingFromPayload(d: Record<string, unknown>): number | null {
  const h = Number(d.attitude_head ?? d.attitudeHead ?? d.heading);
  return Number.isFinite(h) ? h : null;
}

export function munitionAssetFromWsPayload(d: Record<string, unknown>): AssetData | null {
  const entityId = String(d.entityId ?? d.entity_id ?? "").trim();
  if (!entityId) return null;
  const { lat, lng } = munitionPositionFromPayload(d);

  const munitionState = Number(d.munitionState ?? d.munition_state ?? 0);
  const deviceState = munitionDeviceStateFromPayload(d);
  const heading = munitionHeadingFromPayload(d);
  const now = new Date().toISOString();
  const virtualTroop = isVirtualFromProperties(d);

  /* 首次入库占位名；正式显示名由 entity_status（mapOneEntityRow）提供，DDS 路径不 patch name */
  return {
    id: entityId,
    name: entityId,
    asset_type: "missile",
    status: Number.isFinite(deviceState) ? assetStatusFromDeviceState(deviceState) : assetStatusFromMunitionState(munitionState),
    disposition: "friendly",
    lat: lat ?? 0,
    lng: lng ?? 0,
    range_km: null,
    heading,
    fov_angle: null,
    properties: {
      config_kind: "missile",
      ws_munition: true,
      munitionState,
      ...(Number.isFinite(deviceState) ? { deviceState } : {}),
      ...deviceStatePropsFromPayload({ ...d, deviceState }),
      attitude_head: d.attitude_head ?? d.attitudeHead,
      hitPoint: d.hitPoint ?? d.hit_point,
      virtual_troop: virtualTroop,
      is_virtual: virtualTroop,
      munition_status: d,
    },
    mission_status: "monitoring",
    assigned_target_id: targetIdFromMunitionPayload(d) || null,
    target_lat: null,
    target_lng: null,
    created_at: now,
    updated_at: now,
  };
}

/** DDS/手动：损毁 → 爆炸；剔除 store 并登记摧毁（静态重建不再带回） */
export function destroyMunitionOnMap(
  entityId: string,
  lat: number,
  lng: number,
  opts?: { skipExplosion?: boolean },
): void {
  const deleteEntityId = resolveMunitionEntityId(entityId);
  const aliases = [...new Set([...munitionAliasIds(entityId), ...munitionAliasIds(deleteEntityId), deleteEntityId])];
  const cfg = getMunitionDestroyEffectsConfig();
  const hideMs = Math.max(0, cfg.munitionDestroyedHideMs);
  const shouldHideOrRemove = cfg.munitionRemoveAssetOnDestroy || cfg.munitionDeleteEntityOnDestroy;
  const hideExpiresAt = shouldHideOrRemove || hideMs === 0 ? 0 : Date.now() + hideMs;
  for (const id of aliases) {
    if (shouldHideOrRemove) destroyedMunitionIds.set(id, hideExpiresAt);
    munitionFrontendRuntime.delete(runtimeKey(id));
  }
  if (!opts?.skipExplosion) playExplosionAt(lng, lat);
  if (cfg.munitionDeleteEntityOnDestroy) {
    deleteMunitionEntity(deleteEntityId);
  }
  const store = useAssetStore.getState();
  for (const id of aliases) {
    if (cfg.munitionRemoveAssetOnDestroy) {
      store.removeAsset(id);
    } else {
      clearMunitionRuntimeOverlay(id);
    }
    store.clearDisplayOverride(id);
  }
  const sel = useAppStore.getState().selectedAssetId;
  if (cfg.munitionRemoveAssetOnDestroy && sel && aliases.includes(sel)) {
    useAppStore.getState().selectAsset(null);
  }
}

const MUNITION_DESTROYED_STATE = 3;

export function applyMunitionWsPayload(d: Record<string, unknown>): void {
  const entityId = String(d.entityId ?? d.entity_id ?? "").trim();
  if (!entityId) return;

  const munitionState = Number(d.munitionState ?? d.munition_state ?? 0);
  const { lat, lng } = munitionPositionFromPayload(d);

  if (munitionState === MUNITION_DESTROYED_STATE && lat != null && lng != null) {
    if (munitionAliasIds(entityId).some((id) => destroyedMunitionIds.has(id))) {
      return;
    }
    destroyMunitionOnMap(entityId, lat, lng);
    return;
  }

  for (const id of munitionAliasIds(entityId)) destroyedMunitionIds.delete(id);

  const row = munitionAssetFromWsPayload(d);
  if (!row) return;
  const assetId = resolveMunitionAssetId(entityId);
  const existing = useAssetStore.getState().assets.find((a) => a.id === assetId);
  const deviceState = munitionDeviceStateFromPayload(d);

  if (deviceState !== WEAPON_DEVICE_STATE_EXECUTING) {
    for (const id of munitionAliasIds(entityId)) destroyedMunitionIds.delete(id);
  }
  const logValue = `${assetId}:${deviceState}:${row.assigned_target_id ?? ""}:${lat ?? ""}:${lng ?? ""}`;
  if (lastMunitionStatusLog.get(entityId) !== logValue) {
    lastMunitionStatusLog.set(entityId, logValue);
  }
  const effectiveLng = lng ?? existing?.lng ?? row.lng;
  const effectiveLat = lat ?? existing?.lat ?? row.lat;
  const runtimeFlags = updateFrontendMunitionRuntime(entityId, d, effectiveLng, effectiveLat);
  if (runtimeFlags.detonated) return;
  const existingProps =
    existing?.properties && typeof existing.properties === "object"
      ? (existing.properties as Record<string, unknown>)
      : null;
  const rowProps = row.properties as Record<string, unknown>;
  const virtualTroop =
    isVirtualFromProperties(rowProps) || isVirtualFromProperties(existingProps);
  rowProps.virtual_troop = virtualTroop;
  rowProps.is_virtual = virtualTroop;

  let nextHeading: number | null = null;
  const target =
    deviceState === WEAPON_DEVICE_STATE_EXECUTING && row.assigned_target_id
      ? resolveTrackLngLatForTargetId(row.assigned_target_id)
      : null;
  if (target && Number.isFinite(effectiveLng) && Number.isFinite(effectiveLat)) {
    nextHeading = bearingDeg(effectiveLng, effectiveLat, target.lng, target.lat);
  } else if (deviceState === WEAPON_DEVICE_STATE_EXECUTING && row.assigned_target_id) {
    const missValue = `${row.assigned_target_id}:${effectiveLng}:${effectiveLat}`;
    if (lastMunitionTargetMissLog.get(entityId) !== missValue) {
      lastMunitionTargetMissLog.set(entityId, missValue);
    }
  } else if (
    row.heading != null &&
    Number.isFinite(row.heading) &&
    (row.heading !== 0 || existing?.heading == null)
  ) {
    nextHeading = row.heading;
  }

  const store = useAssetStore.getState();
  if (existing) {
    const prevProps =
      existing.properties && typeof existing.properties === "object"
        ? ({ ...(existing.properties as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const patch: Partial<AssetData> = {
      status: row.status,
      assigned_target_id: row.assigned_target_id,
      properties: {
        ...prevProps,
        ...rowProps,
        munition_frontend_arming: runtimeFlags.arming,
        munition_frontend_active: runtimeFlags.active,
      },
    };
    if (!runtimeFlags.arming && lat != null) patch.lat = lat;
    if (!runtimeFlags.arming && lng != null) patch.lng = lng;
    if (nextHeading != null) patch.heading = nextHeading;
    store.mergeAssetFields(assetId, patch);
  } else {
    store.upsertAsset({
      ...row,
      ...(nextHeading != null ? { heading: nextHeading } : {}),
      properties: {
        ...rowProps,
        munition_frontend_arming: runtimeFlags.arming,
        munition_frontend_active: runtimeFlags.active,
      },
    });
  }
}
