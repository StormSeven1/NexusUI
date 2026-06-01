/**
 * 激光武器：地图扇区「首次对准 + 开扇区」与「停射」。
 * 持续改 headingDeg 在 disposal-weapon-follow.tickFollowHeadings。
 */
import { getMapModules } from "./map-module-registry";
import {
  getDirectedWeaponGeometryDefaults,
  getDirectedWeaponScanDefaults,
  setLaserActivationEnabled,
  getLaserActivationEnabled,
} from "./map-app-config";
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

/** 站址 (lng1,lat1) → 目标 (lng2,lat2) 的方位角（度，0=北顺时针） */
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
export function activateLaser(
  deviceId: string,
  targetLng: number,
  targetLat: number,
  follow?: LaserActivateFollow,
): boolean {
  const mods = getMapModules();
  if (!mods) return false;
  const laser = mods.laser;

  // ① 全局激光图层未开则打开（否则 upsert 也看不见）
  if (!getLaserActivationEnabled()) {
    setLaserActivationEnabled(true);
    laser.setLayerVisibility({ fillVisible: true, scanFillVisible: true, lineVisible: true });
  }

  // ② 取专题层里该站设备（须 Map2D 已从 app-config 初始化过）
  const prev = laser.getDevice(deviceId);
  if (!prev) return false;

  // ③ 【本函数内唯一一次算朝向】站址 → 目标经纬度
  const headingDeg = bearingTo(prev.lng, prev.lat, targetLng, targetLat);
  const geometryDefaults = getDirectedWeaponGeometryDefaults("laser");
  const scanDefaults = getDirectedWeaponScanDefaults("laser");
  const openingDeg = prev.openingDeg > 0.1 ? prev.openingDeg : geometryDefaults.openingDeg ?? prev.openingDeg;
  const rangeKm = prev.rangeKm > 0.001 ? prev.rangeKm : geometryDefaults.rangeKm ?? prev.rangeKm;
  const scan = {
    cycleMs: prev.scan?.cycleMs && prev.scan.cycleMs > 0 ? prev.scan.cycleMs : scanDefaults.cycleMs,
    tickMs: prev.scan?.tickMs && prev.scan.tickMs > 0 ? prev.scan.tickMs : scanDefaults.tickMs,
    bandCount: prev.scan?.bandCount && prev.scan.bandCount > 0 ? prev.scan.bandCount : scanDefaults.bandCount,
    bandWidthMeters:
      prev.scan?.bandWidthMeters && prev.scan.bandWidthMeters > 0 ? prev.scan.bandWidthMeters : scanDefaults.bandWidthMeters,
  };

  // ④ 写入 LaserMaplibre：activationEnabled=true 才会画扇区/扫描/脉冲
  const updated: LaserDevice = {
    ...prev,
    headingDeg,
    openingDeg,
    rangeKm,
    activationEnabled: true,
    scan,
  };
  laser.upsert(updated);

  // ⑤ 登记跟瞄 → 启动 120ms tick，后续只改 headingDeg，不再走 activateLaser
  if (follow?.trackTargetId) {
    registerLaserFollow(deviceId, follow.trackTargetId, follow.inputParams);
  }

  return true;
}

function anyLaserSectorActive(devices: LaserDevice[]): boolean {
  return devices.some((d) => d.activationEnabled === true && d.openingDeg > 0.1);
}

/** 【停射】关本设备扇区并卸下跟瞄 */
export function deactivateLaser(deviceId: string): boolean {
  // ① 从跟瞄表移除，无设备跟瞄时 tick 定时器会停
  unregisterLaserFollow(deviceId);

  const mods = getMapModules();
  if (!mods) return false;
  const laser = mods.laser;
  const prev = laser.getDevice(deviceId);
  if (!prev) return false;

  // ② 本设备 activationEnabled=false → 不画扇区/扫描
  const updated: LaserDevice = {
    ...prev,
    activationEnabled: false,
  };
  laser.upsert(updated);

  // ③ 若所有激光站都停了，关整层激光图层
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
    updates.push({ ...d, activationEnabled: false });
  }
  if (updates.length) laser.upsertMany(updates);
  laser.setLayerVisibility({ fillVisible: false, scanFillVisible: false, lineVisible: false });
  setLaserActivationEnabled(false);
}
