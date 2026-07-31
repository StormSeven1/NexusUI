/**
 * GIS 态势快捷预设：能力 / 对海雷达 / 对海融合 / 对空融合。
 * 「能力」与后三者互斥；后三者可并行勾选。
 */

import { canonicalEntityId } from "@/lib/camera-entity-id";
import {
  LYR_DRONES,
  LYR_OPTO_FOV,
  LYR_RADAR_COVERAGE,
  LYR_TRACKS,
  TRACK_LAYER_KEYS_ORDERED,
  type TrackLayerKey,
} from "@/lib/map-entity-model";
import type { AssetData } from "@/stores/asset-store";
import { useAppStore } from "@/stores/app-store";
import { useOptoDeviceLayerStore } from "@/stores/opto-device-layer-store";
import { useRadarDeviceLayerStore } from "@/stores/radar-device-layer-store";
import { useDroneDeviceLayerStore } from "@/stores/drone-device-layer-store";
import { useTrackDisplayStore } from "@/stores/track-display-store";
import { isRadarEligibleForCapabilitySweep } from "@/components/map/modules/radar-range-rings-maplibre";

/** 能力模式下开启光电能力扫描的固定相机 */
const CAPABILITY_CAMERA_IDS = new Set(["camera_001", "camera_004"]);

export type GisTrackQuickFlags = {
  seaRadar: boolean;
  seaFusion: boolean;
  airFusion: boolean;
};

function isCapabilityCamera(entityId: string): boolean {
  const c = canonicalEntityId(entityId);
  return CAPABILITY_CAMERA_IDS.has(c) || CAPABILITY_CAMERA_IDS.has(entityId.trim());
}

/** 关闭雷达/光电能力扫描（离开「能力」模式时） */
export function clearGisCapabilitySweeps(cameraIds: readonly string[], radarIds: readonly string[]): void {
  useRadarDeviceLayerStore.setState((s) => {
    const next = { ...s.deviceVisibility };
    for (const id of radarIds) {
      const prev = next[id] ?? {};
      next[id] = { ...prev, capability: false };
    }
    return { deviceVisibility: next };
  });
  useOptoDeviceLayerStore.setState((s) => {
    const next = { ...s.deviceVisibility };
    const ids = new Set<string>([...cameraIds, ...CAPABILITY_CAMERA_IDS]);
    for (const id of ids) {
      const prev = next[id] ?? {};
      next[id] = { ...prev, capability: false };
    }
    return { deviceVisibility: next };
  });
}

/**
 * 「能力」：隐藏航迹；显示在线实体相关 GIS 图标；
 * 仅在线雷达开图标 + 能力扫描；camera_001 / camera_004 开光电能力。
 * 离线雷达不画图标、不开能力扫描。
 */
export function applyGisCapabilityPreset(options: {
  assets: readonly AssetData[];
  cameraIds: readonly string[];
  droneSns: readonly string[];
}): void {
  const { assets, cameraIds, droneSns } = options;
  const app = useAppStore.getState();
  app.setLayerVisibility(LYR_TRACKS, false);
  app.setLayerVisibility(LYR_RADAR_COVERAGE, true);
  app.setLayerVisibility(LYR_OPTO_FOV, true);
  app.setLayerVisibility(LYR_DRONES, true);

  useTrackDisplayStore.getState().setAllTrackSubtypesVisible(false);

  const radarAssets = assets.filter((a) => a.asset_type === "radar");
  const radarIds = radarAssets.map((a) => a.id);
  const onlineRadar = new Set(
    radarAssets.filter((a) => isRadarEligibleForCapabilitySweep(a)).map((a) => a.id),
  );

  useRadarDeviceLayerStore.setState((s) => {
    const next = { ...s.deviceVisibility };
    for (const id of radarIds) {
      const online = onlineRadar.has(id);
      /** 离线站：图标与能力都关，避免能力模式下仍画出离线雷达 */
      next[id] = { icon: online, capability: online };
    }
    return { deviceVisibility: next };
  });

  useOptoDeviceLayerStore.setState((s) => {
    const next = { ...s.deviceVisibility };
    const ids = new Set<string>([...cameraIds, ...CAPABILITY_CAMERA_IDS]);
    for (const id of ids) {
      const prev = next[id] ?? {};
      next[id] = {
        ...prev,
        icon: true,
        /** 不改动视场显隐，仅开图标与指定相机能力 */
        capability: isCapabilityCamera(id),
      };
    }
    return { deviceVisibility: next };
  });

  if (droneSns.length > 0) {
    useDroneDeviceLayerStore.setState((s) => {
      const next = { ...s.deviceVisibility };
      for (const sn of droneSns) {
        const prev = next[sn] ?? {};
        next[sn] = { ...prev, position: true };
      }
      return { deviceVisibility: next };
    });
  }
}

/** 能力扫描 / 能力快捷：仅真实在线雷达（排除 HOME/虚兵、offline、degraded） */
export function isRadarOnlineForCapability(
  a: Pick<AssetData, "id" | "status" | "properties">,
): boolean {
  return isRadarEligibleForCapabilitySweep(a);
}

/**
 * 航迹快捷：按勾选并集显示对应航迹类型；关闭能力扫描。
 * - 对海雷达 → radar_wharf + radar_jingzi
 * - 对海融合 → fuse_sea
 * - 对空融合 → fuse_air（含子项鸟/无人机）
 */
export function applyGisTrackQuickPresets(
  flags: GisTrackQuickFlags,
  options: { cameraIds: readonly string[]; radarIds: readonly string[] },
): void {
  clearGisCapabilitySweeps(options.cameraIds, options.radarIds);

  const any = flags.seaRadar || flags.seaFusion || flags.airFusion;
  useAppStore.getState().setLayerVisibility(LYR_TRACKS, any);

  const visible = new Set<TrackLayerKey>();
  if (flags.seaRadar) {
    visible.add("radar_wharf");
    visible.add("radar_jingzi");
  }
  if (flags.seaFusion) visible.add("fuse_sea");
  if (flags.airFusion) visible.add("fuse_air");

  const td = useTrackDisplayStore.getState();
  for (const key of TRACK_LAYER_KEYS_ORDERED) {
    td.setTrackSubtypeVisible(key, visible.has(key));
  }
  if (flags.airFusion) {
    td.setAirFusionSubtypesVisible(true);
  }
}
