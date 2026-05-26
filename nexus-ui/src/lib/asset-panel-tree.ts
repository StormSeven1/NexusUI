import { canonicalEntityId } from "@/lib/camera-entity-id";
import { formatCameraTowerMapLabel, formatTowerMapLabel } from "@/lib/map-app-config";
import { normalizeAssetType } from "@/lib/map-entity-model";
import type { AssetData } from "@/stores/asset-store";
import type { MapGisEoMenuContext } from "@/lib/map-gis-eo-menu-context";

/** 资产列表侧边栏分组（与 8090 `ontology.specificType` 映射一致） */
export type AssetPanelCategoryId = "home" | "radar" | "camera" | "drone" | "other";

/** 侧边栏顶层分类（HOME 与雷达/相机等并列） */
export const ASSET_PANEL_TOP_CATEGORIES: { id: AssetPanelCategoryId; label: string }[] = [
  { id: "home", label: "HOME" },
  { id: "radar", label: "雷达" },
  { id: "camera", label: "相机" },
  { id: "drone", label: "无人机" },
  { id: "other", label: "其他设备" },
];

/** `app-config` 中 HOME 站点（id 为 home，assetType 常为 radar）归入 HOME 分组 */
export function isHomePanelAsset(asset: AssetData): boolean {
  return asset.id.trim().toLowerCase() === "home";
}

/**
 * 资产列表分组（规则对齐 `wsEntityTypeRaw`；HOME 站点优先于 radar）。
 */
export function classifyAssetPanelCategory(asset: AssetData): AssetPanelCategoryId {
  if (isHomePanelAsset(asset)) return "home";
  const t = normalizeAssetType(asset.asset_type);
  if (t === "radar") return "radar";
  if (t === "camera") return "camera";
  /* 无人机分组：8090 UAV 实体 + WS 机场（dock） */
  if (t === "drone" || t === "airport") return "drone";
  return "other";
}

/** 与地图右键「选择光电…」同源：registry + 第三方相机 + streams 静态 label */
export function resolveAssetPanelDisplayLabel(
  asset: AssetData,
  eoCtx: MapGisEoMenuContext | null,
): string {
  const id = canonicalEntityId(asset.id);
  const t = normalizeAssetType(asset.asset_type);
  const wsName = String(asset.name ?? "").trim();

  if (t === "camera") {
    const fromEo = eoCtx?.cameraLabelByEntityId.get(id)?.trim();
    if (fromEo) return fromEo;
    if (wsName && !/^相机\d+$/i.test(wsName)) return wsName;
    return formatCameraTowerMapLabel(asset.id);
  }

  if (t === "airport") {
    const n = wsName || asset.id;
    return /^机场/.test(n) ? n : `机场 · ${n}`;
  }

  if (t === "drone") {
    if (wsName) return wsName;
    return asset.id;
  }

  if (t === "tower") {
    if (wsName && !/^电侦\d+$/i.test(wsName)) return wsName;
    return formatTowerMapLabel(asset.id);
  }

  return wsName || asset.id;
}

