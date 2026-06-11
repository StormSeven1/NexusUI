import {
  TRACK_LAYER_KEYS_ORDERED,
  type TrackLayerKey,
} from "@/lib/map-entity-model";
import {
  aggregatePanelVisibility,
  type PanelTreeVisibilityState,
} from "@/lib/panel-tree-visibility";
import type {
  AirFusionSubtypeVisibility,
  TrackSubtypeVisibility,
} from "@/lib/track-layer-visibility";

/** 目标图层各叶子项有效显隐（总开关关时视为全关） */
export function collectTargetLayerLeafFlags(
  tracksMasterOn: boolean,
  subtypeVisible: TrackSubtypeVisibility,
  airSubtypeVisible: AirFusionSubtypeVisibility,
): boolean[] {
  const flags: boolean[] = [];
  for (const k of TRACK_LAYER_KEYS_ORDERED) {
    const subOn = tracksMasterOn && subtypeVisible[k] !== false;
    flags.push(subOn);
    if (k === "fuse_air") {
      flags.push(subOn && airSubtypeVisible.uav !== false);
      flags.push(subOn && airSubtypeVisible.bird !== false);
    }
  }
  return flags;
}

export function targetLayerMasterVisibility(
  tracksMasterOn: boolean,
  subtypeVisible: TrackSubtypeVisibility,
  airSubtypeVisible: AirFusionSubtypeVisibility,
): PanelTreeVisibilityState {
  if (!tracksMasterOn) return "none";
  return aggregatePanelVisibility(collectTargetLayerLeafFlags(true, subtypeVisible, airSubtypeVisible));
}

export function fuseAirSubtypeVisibility(
  tracksMasterOn: boolean,
  subtypeVisible: TrackSubtypeVisibility,
  airSubtypeVisible: AirFusionSubtypeVisibility,
): PanelTreeVisibilityState {
  if (!tracksMasterOn || subtypeVisible.fuse_air === false) return "none";
  return aggregatePanelVisibility([
    airSubtypeVisible.uav !== false,
    airSubtypeVisible.bird !== false,
  ]);
}

export function trackSubtypeVisibilityState(
  tracksMasterOn: boolean,
  key: TrackLayerKey,
  subtypeVisible: TrackSubtypeVisibility,
): PanelTreeVisibilityState {
  if (!tracksMasterOn) return "none";
  return subtypeVisible[key] !== false ? "all" : "none";
}
