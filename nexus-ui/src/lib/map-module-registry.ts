/**
 * 轻量注册表：Map2D 初始化后写入各专题模块实例，
 * 供 laser-activation / tdoa-activation / asset-target-line 等在组件外访问。
 */
import type { LaserMaplibre } from "@/components/map/modules/laser-maplibre";
import type { TdoaMaplibre } from "@/components/map/modules/tdoa-maplibre";
import type { DronesMaplibre } from "@/components/map/modules/drones-maplibre";
import type maplibregl from "maplibre-gl";

export interface MapModuleRefs {
  laser: LaserMaplibre;
  tdoa: TdoaMaplibre;
  drones: DronesMaplibre;
  map: maplibregl.Map;
}

let refs: MapModuleRefs | null = null;

export function registerMapModules(r: MapModuleRefs): void {
  refs = r;
}

export function unregisterMapModules(): void {
  refs = null;
}

export function getMapModules(): MapModuleRefs | null {
  return refs;
}
