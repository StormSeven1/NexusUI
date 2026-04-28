/**
 * 激光武器激活 / 去激活。
 *
 * 由 chat 方案执行触发；可选 `follow` 时扇区朝向随目标航迹持续更新（见 disposal-weapon-follow）。
 */
import { getMapModules } from "./map-module-registry";
import { setLaserActivationEnabled, getLaserActivationEnabled } from "./map-app-config";
import type { LaserDevice } from "@/components/map/modules/laser-maplibre";
import type { DisposalInputParams } from "@/lib/disposal/disposal-types";
import {
  clearAllLaserFollow,
  registerLaserFollow,
  unregisterLaserFollow,
} from "@/lib/disposal/disposal-weapon-follow";

export type LaserActivateFollow = {
  trackTargetId: string;
  inputParams?: DisposalInputParams;
};

function bearingTo(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const dLng = (lng2 - lng1) * rad;
  const y = Math.sin(dLng) * Math.cos(lat2 * rad);
  const x =
    Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
    Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLng);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

export function activateLaser(
  deviceId: string,
  targetLng: number,
  targetLat: number,
  follow?: LaserActivateFollow,
): boolean {
  const mods = getMapModules();
  if (!mods) return false;

  const laser = mods.laser;

  if (!getLaserActivationEnabled()) {
    setLaserActivationEnabled(true);
    laser.setLayerVisibility({ fillVisible: true, scanFillVisible: true, lineVisible: true });
  }
  const prev = laser.getDevice(deviceId);
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

  const updated: LaserDevice = {
    ...prev,
    headingDeg,
    openingDeg,
    rangeKm,
    activationEnabled: true,
    scan,
  };
  laser.upsert(updated);

  if (follow?.trackTargetId) {
    registerLaserFollow(deviceId, follow.trackTargetId, follow.inputParams);
  }

  return true;
}

function anyLaserSectorActive(devices: LaserDevice[]): boolean {
  return devices.some((d) => d.activationEnabled === true && d.openingDeg > 0.1);
}

export function deactivateLaser(deviceId: string): boolean {
  unregisterLaserFollow(deviceId);
  const mods = getMapModules();
  if (!mods) return false;

  const laser = mods.laser;
  const prev = laser.getDevice(deviceId);
  if (!prev) return false;

  const updated: LaserDevice = {
    ...prev,
    activationEnabled: false,
  };
  laser.upsert(updated);
  if (!anyLaserSectorActive(laser.getAll())) {
    setLaserActivationEnabled(false);
    laser.setLayerVisibility({ fillVisible: false, scanFillVisible: false, lineVisible: false });
  }
  return true;
}

export function deactivateAllLasers(): void {
  clearAllLaserFollow();
  const mods = getMapModules();
  if (!mods) return;

  const laser = mods.laser;
  const updates: LaserDevice[] = [];
  for (const d of laser.getAll()) {
    updates.push({
      ...d,
      activationEnabled: false,
    });
  }
  if (updates.length) laser.upsertMany(updates);
  laser.setLayerVisibility({ fillVisible: false, scanFillVisible: false, lineVisible: false });
  setLaserActivationEnabled(false);
}
