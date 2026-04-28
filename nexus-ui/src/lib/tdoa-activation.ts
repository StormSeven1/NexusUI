/**
 * TDOA 激活 / 去激活。
 *
 * 可选 `follow` 时扇区朝向随目标航迹持续更新（见 disposal-weapon-follow）。
 */
import { getMapModules } from "./map-module-registry";
import { setTdoaActivationEnabled, getTdoaActivationEnabled } from "./map-app-config";
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

/**
 * 激活指定 TDOA 设备：开启扫描动画 + 朝向目标。
 * 同时确保 TDOA `activationEnabled` 为 true。
 */
export function activateTdoa(
  deviceId: string,
  targetLng: number,
  targetLat: number,
  follow?: TdoaActivateFollow,
): boolean {
  const mods = getMapModules();
  if (!mods) return false;

  const tdoa = mods.tdoa;

  if (!getTdoaActivationEnabled()) {
    setTdoaActivationEnabled(true);
    /* 同步更新图层可见性：扇区填充 + 扫描 + 边线均可见 */
    tdoa.setLayerVisibility({ fillVisible: true, scanFillVisible: true, lineVisible: true });
  }
  const prev = tdoa.getDevice(deviceId);
  if (!prev) return false;

  const headingDeg = bearingTo(prev.lng, prev.lat, targetLng, targetLat);
  const openingDeg = prev.openingDeg > 0.1 ? prev.openingDeg : 90;
  const rangeKm = prev.rangeKm > 0.001 ? prev.rangeKm : 50;
  const scan = {
    cycleMs: prev.scan?.cycleMs && prev.scan.cycleMs > 0 ? prev.scan.cycleMs : 2000,
    tickMs: prev.scan?.tickMs && prev.scan.tickMs > 0 ? prev.scan.tickMs : 100,
    bandCount: prev.scan?.bandCount && prev.scan.bandCount > 0 ? prev.scan.bandCount : 9,
    bandWidthMeters:
      prev.scan?.bandWidthMeters && prev.scan.bandWidthMeters > 0 ? prev.scan.bandWidthMeters : 12,
  };

  const updated: TdoaDevice = {
    ...prev,
    headingDeg,
    openingDeg,
    rangeKm,
    activationEnabled: true,
    scan,
  };
  tdoa.upsert(updated);

  if (follow?.trackTargetId) {
    registerTdoaFollow(deviceId, follow.trackTargetId, follow.inputParams);
  }

  return true;
}

/** 去激活指定 TDOA 设备：关闭扫描 */
export function deactivateTdoa(deviceId: string): boolean {
  unregisterTdoaFollow(deviceId);
  const mods = getMapModules();
  if (!mods) return false;

  const tdoa = mods.tdoa;
  const prev = tdoa.getDevice(deviceId);
  if (!prev) return false;

  const updated: TdoaDevice = {
    ...prev,
    activationEnabled: false,
  };
  tdoa.upsert(updated);
  if (!anyTdoaSectorActive(tdoa.getAll())) {
    setTdoaActivationEnabled(false);
    tdoa.setLayerVisibility({ fillVisible: false, scanFillVisible: false, lineVisible: false });
  }
  return true;
}

/** 去激活所有 TDOA 设备 */
export function deactivateAllTdoa(): void {
  clearAllTdoaFollow();
  const mods = getMapModules();
  if (!mods) return;

  const tdoa = mods.tdoa;
  const updates: TdoaDevice[] = [];
  for (const d of tdoa.getAll()) {
    updates.push({
      ...d,
      activationEnabled: false,
    });
  }
  if (updates.length) tdoa.upsertMany(updates);
  tdoa.setLayerVisibility({ fillVisible: false, scanFillVisible: false, lineVisible: false });
  setTdoaActivationEnabled(false);
}
