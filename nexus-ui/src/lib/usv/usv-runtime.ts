/**
 * 无人船资产：DDS usv_status 写入 asset-store，驱动 UsvStaticMaplibre。
 * 静态 unmannedShips.devices 提供初始行；DDS 更新 lat/lng/heading/虚兵/打击状态，不写 name。
 */

import type { AssetData } from "@/stores/asset-store";
import { useAssetStore } from "@/stores/asset-store";
import { isVirtualFromProperties, normalizeAssetType } from "@/lib/map-entity-model";
import { parseForceDisposition, type ForceDisposition } from "@/lib/theme-colors";

const STRIKE_STATE_LABEL: Record<number, string> = {
  0: "空闲",
  1: "初始化中",
  2: "运行中",
  3: "已暂停",
  4: "错误",
};

function dispositionFromPayload(d: Record<string, unknown>): ForceDisposition | undefined {
  return parseForceDisposition(
    d.disposition ??
      d.forceDisposition ??
      d.friend_foe ??
      d.friendFoe ??
      d.friendFoeType ??
      d.dispositionType ??
      d.disposition_type,
  );
}

function usvLatLngFromPayload(d: Record<string, unknown>): { lat: number; lng: number } | null {
  const lat = Number(d.latitude ?? d.usv_lat ?? d.lat);
  const lng = Number(d.longitude ?? d.usv_lon ?? d.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function usvHeadingFromPayload(d: Record<string, unknown>): number | null {
  const h = Number(d.usv_HDG ?? d.usv_COG ?? d.HDG ?? d.COG ?? d.heading);
  return Number.isFinite(h) ? h : null;
}

function assetStatusFromUsvPayload(d: Record<string, unknown>): string {
  if (d.online === false) return "offline";
  const strike = Number(d.strikeState ?? d.strike_state);
  if (strike === 4) return "degraded";
  return "online";
}

export function isUsvDdsAsset(asset?: AssetData | null): boolean {
  if (!asset) return false;
  if (normalizeAssetType(asset.asset_type) !== "usv") return false;
  const p = asset.properties as Record<string, unknown> | null;
  return p?.ws_usv === true;
}

export function usvAssetFromWsPayload(d: Record<string, unknown>): AssetData | null {
  const entityId = String(d.entityId ?? "").trim();
  if (!entityId) return null;
  const pos = usvLatLngFromPayload(d);
  if (!pos) return null;

  const strikeState = Number(d.strikeState ?? d.strike_state ?? 2);
  const heading = usvHeadingFromPayload(d);
  const virtualTroop = isVirtualFromProperties(d);
  const now = new Date().toISOString();

  return {
    id: entityId,
    name: entityId,
    asset_type: "usv",
    status: assetStatusFromUsvPayload(d),
    disposition: dispositionFromPayload(d),
    lat: pos.lat,
    lng: pos.lng,
    range_km: null,
    heading,
    fov_angle: null,
    properties: {
      config_kind: "usv",
      ws_usv: true,
      strikeState,
      strikeStateLabel: STRIKE_STATE_LABEL[strikeState] ?? String(strikeState),
      virtual_troop: virtualTroop,
      is_virtual: virtualTroop,
      isVirtualWeapon: virtualTroop,
      usv_status: d,
      ...(Number.isFinite(Number(d.usv_SOG ?? d.SOG))
        ? { usv_SOG: Number(d.usv_SOG ?? d.SOG) }
        : {}),
    },
    mission_status: "monitoring",
    assigned_target_id: d.targetID != null ? String(d.targetID) : null,
    target_lat: null,
    target_lng: null,
    created_at: now,
    updated_at: now,
  };
}

/** DDS usv_status → 合并或入库 asset-store（同 id 的静态无人船行会被实时几何覆盖） */
export function applyUsvWsPayload(d: Record<string, unknown>): void {
  const row = usvAssetFromWsPayload(d);
  if (!row) return;

  const entityId = row.id;
  const store = useAssetStore.getState();
  const existing = store.assets.find((a) => a.id === entityId);

  if (!existing) return;

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
  if (row.disposition !== undefined) patch.disposition = row.disposition;
  if (row.heading != null) patch.heading = row.heading;
  store.mergeAssetFields(entityId, patch);
}
