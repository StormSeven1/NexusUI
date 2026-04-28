/**
 * 处置执行后：激光 / TDOA 扇区朝向持续跟踪目标（与仅激活一次不同）。
 * 定时 tick 读航迹最新坐标并重算 headingDeg，驱动 scan 几何随目标移动。
 *
 * 与 Map2D 资产 WS 同步：`adaptAssetToLaserDevice` / `adaptAssetToTdoaDevice` 不含扇区激活态，
 * 处置跟随期间需用 `merge*WhileDisposalFollow` 保留专题层上的朝向与 activationEnabled。
 */

import { getMapModules } from "@/lib/map-module-registry";
import { resolveTrackLngLatForTargetId } from "@/lib/asset-target-line";
import { inferIsAirTrackFromInputParams } from "@/lib/disposal/disposal-execution-utils";
import type { DisposalInputParams } from "@/lib/disposal/disposal-types";
import type { Asset } from "@/lib/map-entity-model";
import type { LaserDevice } from "@/components/map/modules/laser-maplibre";
import type { LaserMaplibre } from "@/components/map/modules/laser-maplibre";
import type { TdoaDevice } from "@/components/map/modules/tdoa-maplibre";
import type { TdoaMaplibre } from "@/components/map/modules/tdoa-maplibre";

type FollowSpec = { targetId: string; inputParams?: DisposalInputParams };

const laserFollow = new Map<string, FollowSpec>();
const tdoaFollow = new Map<string, FollowSpec>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function bearingTo(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const dLng = (lng2 - lng1) * rad;
  const y = Math.sin(dLng) * Math.cos(lat2 * rad);
  const x =
    Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
    Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLng);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

function resolveTargetPos(spec: FollowSpec): { lng: number; lat: number } | null {
  const hint = inferIsAirTrackFromInputParams(spec.inputParams);
  return (
    resolveTrackLngLatForTargetId(spec.targetId, hint) ?? resolveTrackLngLatForTargetId(spec.targetId, undefined)
  );
}

function tickFollowHeadings(): void {
  const mods = getMapModules();
  if (!mods) return;
  const laserBatch: LaserDevice[] = [];
  const tdoaBatch: TdoaDevice[] = [];

  for (const [deviceId, spec] of laserFollow) {
    const pos = resolveTargetPos(spec);
    if (!pos) continue;
    const prev = mods.laser.getDevice(deviceId);
    if (!prev) continue;
    const headingDeg = bearingTo(prev.lng, prev.lat, pos.lng, pos.lat);
    laserBatch.push({
      ...prev,
      headingDeg,
      activationEnabled: true,
    });
  }

  for (const [deviceId, spec] of tdoaFollow) {
    const pos = resolveTargetPos(spec);
    if (!pos) continue;
    const prev = mods.tdoa.getDevice(deviceId);
    if (!prev) continue;
    const headingDeg = bearingTo(prev.lng, prev.lat, pos.lng, pos.lat);
    const openingDeg = prev.openingDeg > 0.1 ? prev.openingDeg : 90;
    const rangeKm = prev.rangeKm > 0.001 ? prev.rangeKm : 50;
    tdoaBatch.push({
      ...prev,
      headingDeg,
      openingDeg,
      rangeKm,
      activationEnabled: true,
      scan: {
        cycleMs: prev.scan?.cycleMs && prev.scan.cycleMs > 0 ? prev.scan.cycleMs : 2000,
        tickMs: prev.scan?.tickMs && prev.scan.tickMs > 0 ? prev.scan.tickMs : 100,
        bandCount: prev.scan?.bandCount && prev.scan.bandCount > 0 ? prev.scan.bandCount : 9,
        bandWidthMeters:
          prev.scan?.bandWidthMeters && prev.scan.bandWidthMeters > 0 ? prev.scan.bandWidthMeters : 12,
      },
    });
  }
  if (laserBatch.length) mods.laser.upsertMany(laserBatch);
  if (tdoaBatch.length) mods.tdoa.upsertMany(tdoaBatch);
}

function syncTickTimer(): void {
  if (laserFollow.size === 0 && tdoaFollow.size === 0) {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    return;
  }
  if (tickTimer != null) return;
  tickTimer = setInterval(() => tickFollowHeadings(), 120);
}

export function registerLaserFollow(deviceId: string, targetId: string, inputParams?: DisposalInputParams): void {
  laserFollow.set(String(deviceId), { targetId: String(targetId), inputParams });
  syncTickTimer();
}

export function unregisterLaserFollow(deviceId: string): void {
  laserFollow.delete(String(deviceId));
  syncTickTimer();
}

export function clearAllLaserFollow(): void {
  laserFollow.clear();
  syncTickTimer();
}

export function registerTdoaFollow(deviceId: string, targetId: string, inputParams?: DisposalInputParams): void {
  tdoaFollow.set(String(deviceId), { targetId: String(targetId), inputParams });
  syncTickTimer();
}

export function unregisterTdoaFollow(deviceId: string): void {
  tdoaFollow.delete(String(deviceId));
  syncTickTimer();
}

export function clearAllTdoaFollow(): void {
  tdoaFollow.clear();
  syncTickTimer();
}

export function isLaserFollowActive(deviceId: string): boolean {
  return laserFollow.has(String(deviceId));
}

export function isTdoaFollowActive(deviceId: string): boolean {
  return tdoaFollow.has(String(deviceId));
}

/**
 * 新处置包到达时：对指定目标，释放「仍在跟随但该目标新方案中已不再按该类型分配」的激光 / TDOA。
 * `keep*` 为设备 id 集合（大小写不敏感比对）。
 */
export function findDisposalFollowDevicesToRelease(
  targetId: string,
  keepLaserIds: ReadonlySet<string>,
  keepTdoaIds: ReadonlySet<string>,
): { laserDeviceIds: string[]; tdoaDeviceIds: string[] } {
  const tid = String(targetId ?? "").trim();
  const keepL = new Set([...keepLaserIds].map((x) => String(x).trim().toLowerCase()));
  const keepT = new Set([...keepTdoaIds].map((x) => String(x).trim().toLowerCase()));
  const laserOut: string[] = [];
  const tdoaOut: string[] = [];
  if (!tid) return { laserDeviceIds: laserOut, tdoaDeviceIds: tdoaOut };

  for (const [deviceId, spec] of laserFollow) {
    if (String(spec.targetId).trim() !== tid) continue;
    const key = String(deviceId).trim().toLowerCase();
    if (!keepL.has(key)) laserOut.push(String(deviceId));
  }
  for (const [deviceId, spec] of tdoaFollow) {
    if (String(spec.targetId).trim() !== tid) continue;
    const key = String(deviceId).trim().toLowerCase();
    if (!keepT.has(key)) tdoaOut.push(String(deviceId));
  }
  return { laserDeviceIds: laserOut, tdoaDeviceIds: tdoaOut };
}

/**
 * 资产 store 高频刷新 → 专题层：
 * - 处置跟随中：保留扇区朝向/扫描/脉动，仅用 WS 更新站址；
 * - 其它：WS 只映射站址与姿态；`activationEnabled` 与脉动以专题层当前态为准（bundle / activate* / deactivate*）。
 */
export function mergeLaserDeviceWithAssetWsWhileDisposalFollow(
  asset: Asset,
  incoming: LaserDevice,
  laser: LaserMaplibre,
): LaserDevice {
  const cur = laser.getDevice(asset.id);
  if (!cur) return incoming;

  if (laserFollow.has(String(asset.id))) {
    const scan =
      cur.activationEnabled === true
        ? { ...cur.scan }
        : {
            cycleMs: cur.scan.cycleMs > 0 ? cur.scan.cycleMs : 4000,
            tickMs: cur.scan.tickMs > 0 ? cur.scan.tickMs : 90,
            bandCount: cur.scan.bandCount > 0 ? cur.scan.bandCount : 9,
            bandWidthMeters: cur.scan.bandWidthMeters > 0 ? cur.scan.bandWidthMeters : 12,
          };
    return {
      ...incoming,
      lng: asset.lng,
      lat: asset.lat,
      headingDeg: cur.headingDeg,
      openingDeg: cur.openingDeg > 0.1 ? cur.openingDeg : incoming.openingDeg,
      rangeKm: cur.rangeKm > 0.001 ? cur.rangeKm : incoming.rangeKm,
      activationEnabled: true,
      scan,
      pulseOnMs: cur.pulseOnMs ?? incoming.pulseOnMs,
      pulseOffMs: cur.pulseOffMs ?? incoming.pulseOffMs,
      color: incoming.color ?? cur.color,
      fillOpacity: incoming.fillOpacity ?? cur.fillOpacity,
    };
  }

  return {
    ...incoming,
    scan: { ...cur.scan },
    activationEnabled: cur.activationEnabled,
    pulseOnMs: cur.pulseOnMs ?? incoming.pulseOnMs,
    pulseOffMs: cur.pulseOffMs ?? incoming.pulseOffMs,
    color: incoming.color ?? cur.color,
    fillOpacity: incoming.fillOpacity ?? cur.fillOpacity,
  };
}

export function mergeTdoaDeviceWithAssetWsWhileDisposalFollow(
  asset: Asset,
  incoming: TdoaDevice,
  tdoa: TdoaMaplibre,
): TdoaDevice {
  const cur = tdoa.getDevice(asset.id);
  if (!cur) return incoming;

  if (tdoaFollow.has(String(asset.id))) {
    const scan =
      cur.activationEnabled === true
        ? { ...cur.scan }
        : {
            cycleMs: cur.scan.cycleMs > 0 ? cur.scan.cycleMs : 2000,
            tickMs: cur.scan.tickMs > 0 ? cur.scan.tickMs : 100,
            bandCount: cur.scan.bandCount > 0 ? cur.scan.bandCount : 9,
            bandWidthMeters: cur.scan.bandWidthMeters > 0 ? cur.scan.bandWidthMeters : 12,
          };
    return {
      ...incoming,
      lng: asset.lng,
      lat: asset.lat,
      headingDeg: cur.headingDeg,
      openingDeg: cur.openingDeg > 0.1 ? cur.openingDeg : incoming.openingDeg,
      rangeKm: cur.rangeKm > 0.001 ? cur.rangeKm : incoming.rangeKm,
      activationEnabled: true,
      scan,
      color: incoming.color ?? cur.color,
      fillOpacity: incoming.fillOpacity ?? cur.fillOpacity,
    };
  }

  return {
    ...incoming,
    scan: { ...cur.scan },
    activationEnabled: cur.activationEnabled,
    color: incoming.color ?? cur.color,
    fillOpacity: incoming.fillOpacity ?? cur.fillOpacity,
  };
}
