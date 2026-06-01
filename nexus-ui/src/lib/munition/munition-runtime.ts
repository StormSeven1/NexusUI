/**
 * 巡飞弹资产：DDS 更新、摧毁特效；告警「消灭」巡飞弹 DELETE 见 alert-destroy.ts。
 * 摧毁后为一次性：从资产表剔除，且阻止静态/entity_status 重建时复活，直至再次收到正常 DDS。
 */

import type { AssetData } from "@/stores/asset-store";
import { useAssetStore } from "@/stores/asset-store";
import { useAppStore } from "@/stores/app-store";
import { playExplosionAt } from "@/lib/map/explosion-effect";
import { normalizeAssetType } from "@/lib/map-entity-model";
import { assetStatusFromMunitionState } from "@/lib/map-app-config";

/** 已摧毁飞弹 id（一次性）；收到 munitionState=0 等正常态 DDS 后清除，允许新一轮入库 */
const destroyedMunitionIds = new Set<string>();

export function isMunitionDestroyed(entityId: string): boolean {
  return destroyedMunitionIds.has(entityId);
}

/** 合并静态/WS 资产列表时排除已摧毁飞弹，避免 app-config 初始化行复活 */
export function filterOutDestroyedMunitions(assets: AssetData[]): AssetData[] {
  return assets.filter((a) => {
    if (normalizeAssetType(a.asset_type) !== "missile") return true;
    return !destroyedMunitionIds.has(a.id);
  });
}

/** DDS attitude_head → 地图图标方位角（0=北，顺时针，与航迹/无人机一致） */
function munitionHeadingFromPayload(d: Record<string, unknown>): number | null {
  const h = Number(d.attitude_head ?? d.attitudeHead ?? d.heading);
  return Number.isFinite(h) ? h : null;
}

export function munitionAssetFromWsPayload(d: Record<string, unknown>): AssetData | null {
  const entityId = String(d.entityId ?? "").trim();
  if (!entityId) return null;
  const lat = Number(d.latitude);
  const lng = Number(d.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const munitionState = Number(d.munitionState ?? d.munition_state ?? 0);
  const heading = munitionHeadingFromPayload(d);
  const now = new Date().toISOString();
  const virtualTroop = d.isVirtualWeapon === true;

  /* 首次入库占位名；正式显示名由 entity_status（mapOneEntityRow）提供，DDS 路径不 patch name */
  return {
    id: entityId,
    name: entityId,
    asset_type: "missile",
    status: assetStatusFromMunitionState(munitionState),
    disposition: "friendly",
    lat,
    lng,
    range_km: null,
    heading,
    fov_angle: null,
    properties: {
      config_kind: "missile",
      ws_munition: true,
      munitionState,
      attitude_head: d.attitude_head ?? d.attitudeHead,
      hitPoint: d.hitPoint ?? d.hit_point,
      virtual_troop: virtualTroop,
      is_virtual: virtualTroop,
      munition_status: d,
    },
    mission_status: "monitoring",
    assigned_target_id: d.targetID != null ? String(d.targetID) : null,
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
  destroyedMunitionIds.add(entityId);
  if (!opts?.skipExplosion) playExplosionAt(lng, lat);
  const store = useAssetStore.getState();
  store.removeAsset(entityId);
  store.clearDisplayOverride(entityId);
  const sel = useAppStore.getState().selectedAssetId;
  if (sel === entityId) useAppStore.getState().selectAsset(null);
}

const MUNITION_DESTROYED_STATE = 3;

export function applyMunitionWsPayload(d: Record<string, unknown>): void {
  const entityId = String(d.entityId ?? "").trim();
  if (!entityId) return;

  const munitionState = Number(d.munitionState ?? d.munition_state ?? 0);
  const lat = Number(d.latitude);
  const lng = Number(d.longitude);

  if (munitionState === MUNITION_DESTROYED_STATE && Number.isFinite(lat) && Number.isFinite(lng)) {
    destroyMunitionOnMap(entityId, lat, lng);
    return;
  }

  if (destroyedMunitionIds.has(entityId)) {
    destroyedMunitionIds.delete(entityId);
  }

  const row = munitionAssetFromWsPayload(d);
  if (!row) return;

  const store = useAssetStore.getState();
  const existing = store.assets.find((a) => a.id === entityId);
  if (existing) {
    const prevProps =
      existing.properties && typeof existing.properties === "object"
        ? ({ ...(existing.properties as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const patch: Partial<AssetData> = {
      lat: row.lat,
      lng: row.lng,
      status: row.status,
      assigned_target_id: row.assigned_target_id,
      properties: {
        ...prevProps,
        ...row.properties,
      },
    };
    if (row.heading != null) patch.heading = row.heading;
    store.mergeAssetFields(entityId, patch);
  } else {
    store.upsertAsset(row);
  }
}

