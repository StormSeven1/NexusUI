import { isVirtualFromProperties, normalizeAssetType, type Asset } from "@/lib/map-entity-model";
import type { AssetData } from "@/stores/asset-store";
import { FORCE_COLORS } from "@/lib/theme-colors";
import {
  dispositionFromAssetData,
  formatCameraTowerMapLabel,
  formatTowerMapLabel,
  getAssetFriendlyColorForAssetType,
  getAssetLabelFontColorForAssetType,
  shouldDisplayAssetId,
} from "@/lib/map-app-config";
import { assetFriendlyColorFromProperties, assetLabelFontColorFromProperties } from "@/lib/map-icons";

/**
 * map-asset-adapter.ts
 * --------------------------------------------------------------------------
 * 【职责】
 * 统一将 `asset-store` 中的 `AssetData[]` 适配为地图渲染层使用的 `Asset[]`。
 *
 * 【为什么单独抽文件】
 * 之前 `Map2D` 与 `Map3D` 各自维护一份几乎同构的 `adaptAssets`，容易出现：
 * - 2D 改了颜色回退，3D 忘改
 * - 新增字段（如 `labelFontColor`）只接了一端
 * 现在两端统一调用本文件，避免逻辑漂移。
 *
 * 【当前适配规则（2D/3D 共用）】
 * 1) 显示过滤：`shouldDisplayAssetId`
 * 2) 类型归一：`normalizeAssetType`
 * 3) 敌我解析：`dispositionFromAssetData`
 * 4) 颜色：
 *    - 图标：`map_friendly_color` -> 根 `assetFriendlyColor` -> `FORCE_COLORS.friendly`
 *    - 名称：`map_label_font_color` -> 根 `label.fontColor`（无则留空给上层默认）
 * 5) 可见性映射：
 *    - `center_icon_visible` -> `centerIconVisible`
 *    - `center_name_visible` -> `nameLabelVisible`
 *    - `fov_sector_visible`  -> `showFov`
 * 6) 名称格式化：camera/tower 使用统一格式化函数
 */
export function adaptAssetsForMap(assets: AssetData[]): Asset[] {
  return assets
    .filter((a) => shouldDisplayAssetId(a.asset_type, a.id, a.name))
    .map((a) => {
      const p = a.properties as Record<string, unknown> | null | undefined;
      const isRadar = String(a.asset_type ?? "").toLowerCase() === "radar";
      let showRings: boolean | undefined;
      if (isRadar) {
        if (p && typeof p.showRings === "boolean") showRings = p.showRings;
        else showRings = true;
      }
      const centerIconVisible = p?.center_icon_visible === false ? false : undefined;
      let nameLabelVisible: boolean | undefined;
      if (!isRadar && p?.center_name_visible === false) nameLabelVisible = false;
      const showFov = p?.fov_sector_visible === false ? false : undefined;
      const t = normalizeAssetType(a.asset_type);
      const disp = dispositionFromAssetData(a);
      let friendlyMapColor: string | undefined;
      let labelFontColor: string | undefined;
      if (disp === "friendly") {
        friendlyMapColor =
          assetFriendlyColorFromProperties(p ?? null) ??
          getAssetFriendlyColorForAssetType(t) ??
          FORCE_COLORS.friendly;
        labelFontColor =
          assetLabelFontColorFromProperties(p ?? null) ??
          getAssetLabelFontColorForAssetType(t);
      }
      let displayName = a.name;
      if (t === "camera") displayName = formatCameraTowerMapLabel(a.id);
      else if (t === "tower") displayName = formatTowerMapLabel(a.id);
      return {
        id: a.id,
        name: displayName,
        type: t,
        status: a.status as Asset["status"],
        disposition: disp,
        lat: a.lat,
        lng: a.lng,
        range: a.range_km ?? undefined,
        heading: a.heading ?? undefined,
        fovAngle: a.fov_angle ?? undefined,
        isVirtual: isVirtualFromProperties(a.properties),
        ...(showRings !== undefined ? { showRings } : {}),
        ...(centerIconVisible === false ? { centerIconVisible: false } : {}),
        ...(nameLabelVisible === false ? { nameLabelVisible: false } : {}),
        ...(showFov === false ? { showFov: false } : {}),
        ...(friendlyMapColor ? { friendlyMapColor } : {}),
        ...(labelFontColor ? { labelFontColor } : {}),
      };
    });
}
