import type { AssetData } from "@/stores/asset-store";
import { useAssetStore } from "@/stores/asset-store";
import { isVirtualFromProperties } from "@/lib/map-entity-model";
import {
  assetStatusFromDeviceState,
  deviceStatePropsFromPayload,
} from "@/lib/map-app-config";
import { resolveTrackLngLatForTargetId } from "@/lib/asset-target-line";
import { WEAPON_DEVICE_STATE_EXECUTING } from "@/lib/weapon/weapon-power-state";
import { getMunitionDestroyEffectsConfig } from "@/lib/map-app-config";

export type DirectedWeaponKind = "laser" | "tdoa";

const lastWeaponStateLog = new Map<string, string>();
const lastWeaponTargetMissLog = new Map<string, string>();

interface DirectedWeaponRuntime {
  targetId: string | null;
  armingUntil: number;
  lastState: number | null;
}

const directedWeaponRuntime = new Map<string, DirectedWeaponRuntime>();

function weaponStateFromPayload(d: Record<string, unknown>, kind: DirectedWeaponKind): number {
  if (kind === "laser") {
    return Number(d.laserState ?? d.laser_state ?? 0);
  }
  return Number(d.jammerState ?? d.jammer_state ?? d.tdoaState ?? d.tdoa_state ?? 0);
}

function deviceStateFromPayload(d: Record<string, unknown>): number {
  return Number(d.deviceState ?? d.device_state ?? d.devicestate ?? d.DeviceState ?? 0);
}

function runtimeKey(kind: DirectedWeaponKind, entityId: string): string {
  return `${kind}:${String(entityId ?? "").trim().toLowerCase()}`;
}

function weaponStatusPropKey(kind: DirectedWeaponKind): "laser_status" | "tdoa_status" {
  return kind === "laser" ? "laser_status" : "tdoa_status";
}

function weaponStatePropKey(kind: DirectedWeaponKind): "laserState" | "tdoaState" {
  return kind === "laser" ? "laserState" : "tdoaState";
}

function targetIdFromPayload(d: Record<string, unknown>): string | null {
  const raw = d.targetID;
  const targetId = String(raw ?? "").trim();
  return targetId || null;
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

function stringProp(props: Record<string, unknown> | null | undefined, key: string): string {
  const value = props?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function findWeaponAssetId(entityId: string): string | null {
  const raw = String(entityId ?? "").trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  for (const asset of useAssetStore.getState().assets) {
    const props =
      asset.properties && typeof asset.properties === "object"
        ? (asset.properties as Record<string, unknown>)
        : null;
    const ids = [
      asset.id,
      stringProp(props, "entityId"),
      stringProp(props, "entity_id"),
      stringProp(props, "deviceSn"),
      stringProp(props, "device_sn"),
    ].filter(Boolean);
    if (ids.some((id) => id.toLowerCase() === low)) return asset.id;
  }
  return null;
}

function storedWeaponDeviceState(assetId: string): number | null {
  const asset = useAssetStore.getState().assets.find((item) => item.id === assetId);
  const props =
    asset?.properties && typeof asset.properties === "object"
      ? (asset.properties as Record<string, unknown>)
      : null;
  const n = Number(props?.deviceState ?? props?.device_state ?? props?.devicestate ?? props?.DeviceState);
  return Number.isFinite(n) ? n : null;
}

function weaponFrontendArming(
  kind: DirectedWeaponKind,
  entityId: string,
  assetId: string,
  deviceState: number,
  targetId: string | null,
): boolean {
  const key = runtimeKey(kind, entityId);
  const now = Date.now();
  let runtime = directedWeaponRuntime.get(key);
  const previousState = runtime?.lastState ?? storedWeaponDeviceState(assetId);

  if (deviceState !== WEAPON_DEVICE_STATE_EXECUTING) {
    directedWeaponRuntime.set(key, {
      targetId,
      armingUntil: 0,
      lastState: Number.isFinite(deviceState) ? deviceState : previousState,
    });
    return false;
  }

  const shouldStartArming =
    previousState === 1 &&
    deviceState === WEAPON_DEVICE_STATE_EXECUTING &&
    (!runtime || runtime.targetId !== targetId || runtime.armingUntil <= now);

  if (!runtime || runtime.targetId !== targetId) {
    runtime = {
      targetId,
      armingUntil: shouldStartArming ? now + getMunitionDestroyEffectsConfig().munitionFrontendArmingMs : 0,
      lastState: deviceState,
    };
    directedWeaponRuntime.set(key, runtime);
  } else if (shouldStartArming) {
    runtime.armingUntil = now + getMunitionDestroyEffectsConfig().munitionFrontendArmingMs;
    runtime.lastState = deviceState;
  } else {
    runtime.lastState = deviceState;
  }

  return now < runtime.armingUntil;
}

function patchExistingWeaponAsset(
  entityId: string,
  d: Record<string, unknown>,
  kind: DirectedWeaponKind,
): boolean {
  const store = useAssetStore.getState();
  const assetId = findWeaponAssetId(entityId);
  if (!assetId) {
    const logKey = `${kind}:${entityId}:missing`;
    if (lastWeaponStateLog.get(logKey) !== "missing") {
      lastWeaponStateLog.set(logKey, "missing");
      console.warn("[weapon-status] asset not found", { kind, entityId, deviceState: deviceStateFromPayload(d) });
    }
    return false;
  }
  const existing = store.assets.find((a) => a.id === assetId);
  if (!existing) return false;

  const lat = Number(d.latitude);
  const lng = Number(d.longitude);
  const heading = Number(d.azimuth ?? d.azimuthAngle ?? d.heading ?? d.attitude_head);
  const rangeKm = Number(d.rangeKm ?? d.range_km ?? d.range);
  const openingDeg = Number(d.openingDeg ?? d.opening_deg ?? d.fovAngle ?? d.fov_angle);
  const deviceState = deviceStateFromPayload(d);
  const weaponState = weaponStateFromPayload(d, kind);
  const targetId = targetIdFromPayload(d);
  const now = Date.now();

  const prevProps =
    existing.properties && typeof existing.properties === "object"
      ? ({ ...(existing.properties as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const virtualTroop = isVirtualFromProperties(d);

  const patch: Partial<AssetData> = {
    status: assetStatusFromDeviceState(deviceState),
    assigned_target_id: targetId,
    properties: {
      ...prevProps,
      ws_weapon_device: true,
      last_packet_at_ms: now,
      status_received_at_ms: now,
      [weaponStatePropKey(kind)]: weaponState,
      [weaponStatusPropKey(kind)]: d,
      ...deviceStatePropsFromPayload({ ...d, deviceState }),
      weapon_frontend_arming: weaponFrontendArming(kind, entityId, assetId, deviceState, targetId),
      virtual_troop: virtualTroop,
      is_virtual: virtualTroop,
      virtualTroop,
      isVirtualWeapon: virtualTroop,
    },
  };

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    patch.lat = lat;
    patch.lng = lng;
  }
  let nextHeading: number | null = null;
  if (deviceState === WEAPON_DEVICE_STATE_EXECUTING && targetId) {
    const target = resolveTrackLngLatForTargetId(targetId);
    const deviceLng = Number.isFinite(lng) ? lng : existing.lng;
    const deviceLat = Number.isFinite(lat) ? lat : existing.lat;
    if (target && Number.isFinite(deviceLng) && Number.isFinite(deviceLat)) {
      nextHeading = bearingDeg(deviceLng, deviceLat, target.lng, target.lat);
    } else {
      const missKey = `${kind}:${entityId}`;
      const missValue = `${targetId}:${deviceLng}:${deviceLat}`;
      if (lastWeaponTargetMissLog.get(missKey) !== missValue) {
        lastWeaponTargetMissLog.set(missKey, missValue);
        console.warn("[weapon-status] target not resolved for heading", {
          kind,
          entityId,
          targetId,
          deviceLng,
          deviceLat,
        });
      }
    }
  } else if (Number.isFinite(heading)) {
    nextHeading = heading;
  }
  if (nextHeading != null) patch.heading = nextHeading;
  if (Number.isFinite(rangeKm) && rangeKm > 0) patch.range_km = rangeKm;
  if (Number.isFinite(openingDeg) && openingDeg > 0) patch.fov_angle = openingDeg;

  const logValue = `${assetId}:${deviceState}:${targetId ?? ""}`;
  const logKey = `${kind}:${entityId}`;
  if (lastWeaponStateLog.get(logKey) !== logValue) {
    lastWeaponStateLog.set(logKey, logValue);
    // console.info("[weapon-status] applied", { kind, entityId, assetId, deviceState, targetId });
  }

  store.mergeAssetFields(assetId, patch);
  return true;
}

export function applyDirectedWeaponWsPayload(
  d: Record<string, unknown>,
  kind: DirectedWeaponKind,
): void {
  const entityId = String(d.entityId ?? d.entity_id ?? "").trim();
  if (!entityId) return;
  patchExistingWeaponAsset(entityId, d, kind);
}

export function applyLaserWsPayload(d: Record<string, unknown>): void {
  applyDirectedWeaponWsPayload(d, "laser");
}

export function applyTdoaWsPayload(d: Record<string, unknown>): void {
  applyDirectedWeaponWsPayload(d, "tdoa");
}

