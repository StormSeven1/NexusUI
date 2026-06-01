/**
 * TDOA：地图扇区「首次对准 + 开扇区」与「停射」。
 * 持续改 headingDeg 在 disposal-weapon-follow.tickFollowHeadings。
 */
import { getMapModules } from "./map-module-registry";
import {
  getDirectedWeaponGeometryDefaults,
  getDirectedWeaponScanDefaults,
  setTdoaActivationEnabled,
  getTdoaActivationEnabled,
} from "./map-app-config";
import type { TdoaDevice } from "@/components/map/modules/tdoa-maplibre";
import type { DisposalInputParams } from "@/lib/disposal/disposal-types";
import {
  clearAllTdoaFollow,
  registerTdoaFollow,
  unregisterTdoaFollow,
} from "@/lib/disposal/disposal-weapon-follow";

export type TdoaActivateFollow = {
  trackTargetId: string;
  inputParams?: DisposalInputParams;
};

function anyTdoaSectorActive(devices: TdoaDevice[]): boolean {
  return devices.some((d) => d.activationEnabled === true && d.openingDeg > 0.1);
}

function bearingTo(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const dLng = (lng2 - lng1) * rad;
  const y = Math.sin(dLng) * Math.cos(lat2 * rad);
  const x =
    Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
    Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLng);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

/** 【首次发射 / 对准】开扇区 + 算一次 headingDeg；follow 时进入持续跟瞄 */
export function activateTdoa(
  deviceId: string,
  targetLng: number,
  targetLat: number,
  follow?: TdoaActivateFollow,
): boolean {
  const mods = getMapModules();
  if (!mods) return false;
  const tdoa = mods.tdoa;

  // ① 全局 TDOA 图层
  if (!getTdoaActivationEnabled()) {
    setTdoaActivationEnabled(true);
    tdoa.setLayerVisibility({ fillVisible: true, scanFillVisible: true, lineVisible: true });
  }

  // ② 专题层设备
  const prev = tdoa.getDevice(deviceId);
  if (!prev) return false;

  // ③ 【本函数内唯一一次算朝向】
  const headingDeg = bearingTo(prev.lng, prev.lat, targetLng, targetLat);
  const geometryDefaults = getDirectedWeaponGeometryDefaults("tdoa");
  const scanDefaults = getDirectedWeaponScanDefaults("tdoa");
  const openingDeg = prev.openingDeg > 0.1 ? prev.openingDeg : geometryDefaults.openingDeg ?? prev.openingDeg;
  const rangeKm = prev.rangeKm > 0.001 ? prev.rangeKm : geometryDefaults.rangeKm ?? prev.rangeKm;
  const scan = {
    cycleMs: prev.scan?.cycleMs && prev.scan.cycleMs > 0 ? prev.scan.cycleMs : scanDefaults.cycleMs,
    tickMs: prev.scan?.tickMs && prev.scan.tickMs > 0 ? prev.scan.tickMs : scanDefaults.tickMs,
    bandCount: prev.scan?.bandCount && prev.scan.bandCount > 0 ? prev.scan.bandCount : scanDefaults.bandCount,
    bandWidthMeters:
      prev.scan?.bandWidthMeters && prev.scan.bandWidthMeters > 0 ? prev.scan.bandWidthMeters : scanDefaults.bandWidthMeters,
  };

  const updated: TdoaDevice = {
    ...prev,
    headingDeg,
    openingDeg,
    rangeKm,
    activationEnabled: true,
    scan,
  };
  // ④ 开扇区
  tdoa.upsert(updated);

  // ⑤ 登记跟瞄 → tickFollowHeadings 持续改 heading
  if (follow?.trackTargetId) {
    registerTdoaFollow(deviceId, follow.trackTargetId, follow.inputParams);
  }

  return true;
}

export function deactivateTdoa(deviceId: string): boolean {
  unregisterTdoaFollow(deviceId);
  const mods = getMapModules();
  if (!mods) return false;

  const tdoa = mods.tdoa;
  const prev = tdoa.getDevice(deviceId);
  if (!prev) return false;

  // 停射：本设备扇区关
  tdoa.upsert({ ...prev, activationEnabled: false });
  if (!anyTdoaSectorActive(tdoa.getAll())) {
    setTdoaActivationEnabled(false);
    tdoa.setLayerVisibility({ fillVisible: false, scanFillVisible: false, lineVisible: false });
  }
  return true;
}

export function deactivateAllTdoa(): void {
  clearAllTdoaFollow();
  const mods = getMapModules();
  if (!mods) return;

  const tdoa = mods.tdoa;
  const updates: TdoaDevice[] = [];
  for (const d of tdoa.getAll()) {
    updates.push({ ...d, activationEnabled: false });
  }
  if (updates.length) tdoa.upsertMany(updates);
  tdoa.setLayerVisibility({ fillVisible: false, scanFillVisible: false, lineVisible: false });
  setTdoaActivationEnabled(false);
}
