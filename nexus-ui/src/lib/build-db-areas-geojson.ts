import type { AreaTableRow } from "@/lib/area-table-geometry";
import {
  areaRowToPolygonRing,
  circleLabelLngLatNorth,
  dbAreaFeatureId,
  lineFromAreaRoute,
  parseAreaLineColor,
} from "@/lib/area-table-geometry";
import { mapAreaFallbackLabel } from "@/lib/area-table-serialize";
import {
  DEFAULT_AREA_LAYER_LINE_COLOR,
  DEFAULT_AREA_LAYER_LINE_WIDTH,
  type SituationAreaLayerStyle,
} from "@/lib/distance-ring-settings";
import { getDroneMapRenderingConfig } from "@/lib/map-app-config";

/** @deprecated 请用态势显示中的区域图层配色；保留常量供旧引用 */
export const DB_AREA_MAP_UI_COLOR = DEFAULT_AREA_LAYER_LINE_COLOR;

/** 库内航线（area_type=4）与无人机任务航线一致的虚线周期 */
export const DB_AREA_ROUTE_LINE_DASH: [number, number] = [4, 2];

/** 北朝上时包络框「右下」≈ 最大经度、最小纬度；再略向东南外偏一点，避免字压线 */
export function ringSouthEastLabelLngLat(ring: [number, number][]): [number, number] {
  const open =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  let maxLng = -Infinity;
  let minLat = Infinity;
  for (const [lng, lat] of open) {
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
  }
  if (!Number.isFinite(maxLng) || !Number.isFinite(minLat)) return open[0] ?? [0, 0];
  const padLng = 0.00012;
  const padLat = -0.00008;
  return [maxLng + padLng, minLat + padLat];
}

export type BuildDbAreasOptions = {
  /**
   * 为 true 时航线也套用 `style`（告警闪烁用）。
   * 默认 false：航线固定用无人机任务航线（`drones.plannedRouteLine*`），不随「区域图层」样式变。
   */
  applyStyleToRoutes?: boolean;
};

/**
 * 数据库区域 → MapLibre GeoJSON（Polygon + Point 标签；航线另含折点序号）。
 * @param includeRow 总开关与子项显隐过滤后仍为 true 才入图。
 * @param style 态势显示 · 区域图层边线/标注样式（覆盖固定浅色；默认不作用于航线）
 */
export function buildDbAreasFeatureCollection(
  rows: AreaTableRow[],
  includeRow: (row: AreaTableRow) => boolean = () => true,
  style?: SituationAreaLayerStyle,
  options?: BuildDbAreasOptions,
): GeoJSON.FeatureCollection {
  const lineColor =
    style?.lineColor?.trim() ||
    DEFAULT_AREA_LAYER_LINE_COLOR;
  const lineOpacity = style?.lineOpacity ?? 1;
  const labelOpacity = style?.labelOpacity ?? 0.95;
  const features: GeoJSON.Feature[] = [];
  const applyStyleToRoutes = options?.applyStyleToRoutes === true;
  const droneRoute = getDroneMapRenderingConfig();

  for (const row of rows) {
    if (!includeRow(row)) continue;

    const name =
      (row.area_name && String(row.area_name).trim()) ||
      mapAreaFallbackLabel(row.group_id, row.area_id, row.area_type);
    const id = dbAreaFeatureId(row);
    const lineWidth = style?.lineWidth ?? DEFAULT_AREA_LAYER_LINE_WIDTH;
    const lineStyle = style?.lineStyle ?? "solid";
    const rowLineColor = parseAreaLineColor(row.line_color, lineColor);
    const featureLineColor = style?.lineColor?.trim() ? lineColor : rowLineColor;

    if (row.area_type === 4) {
      const line = lineFromAreaRoute(row);
      if (!line || line.length < 2) continue;
      const [lx, ly] = line[line.length - 1]!;
      const prev = line[line.length - 2]!;
      /** 名称标在终点外侧，避免压住终点序号 */
      const dx = lx - prev[0];
      const dy = ly - prev[1];
      const len = Math.hypot(dx, dy) || 1;
      const pad = 0.00018;
      const nameLng = lx + (dx / len) * pad;
      const nameLat = ly + (dy / len) * pad;
      const routeColor = applyStyleToRoutes ? featureLineColor : droneRoute.plannedRouteLineColor;
      const routeOpacity = applyStyleToRoutes ? lineOpacity : droneRoute.plannedRouteLineOpacity;
      const routeWidth = applyStyleToRoutes ? lineWidth : droneRoute.plannedRouteLineWidth;
      const routeLabelOpacity = applyStyleToRoutes ? labelOpacity : Math.min(1, droneRoute.plannedRouteLineOpacity + 0.2);
      features.push({
        type: "Feature",
        id,
        geometry: { type: "LineString", coordinates: line },
        properties: {
          _kind: "route",
          id,
          name,
          lineColor: routeColor,
          lineOpacity: routeOpacity,
          lineWidth: routeWidth,
          lineStyle: "drone-route",
          groupId: row.group_id,
          areaId: row.area_id,
          areaType: row.area_type,
        },
      });
      for (let i = 0; i < line.length; i++) {
        const [wx, wy] = line[i]!;
        const wpIndex = i + 1;
        features.push({
          type: "Feature",
          id: `${id}-wp-${wpIndex}`,
          geometry: { type: "Point", coordinates: [wx, wy] },
          properties: {
            _kind: "route-wp",
            id: `${id}-wp-${wpIndex}`,
            name,
            wpIndex,
            labelText: String(wpIndex),
            lineColor: routeColor,
            labelOpacity: routeLabelOpacity,
            groupId: row.group_id,
            areaId: row.area_id,
            areaType: row.area_type,
          },
        });
      }
      features.push({
        type: "Feature",
        id: `${id}-lbl`,
        geometry: { type: "Point", coordinates: [nameLng, nameLat] },
        properties: {
          _kind: "lbl",
          labelText: name,
          lineColor: routeColor,
          labelOpacity: routeLabelOpacity,
          groupId: row.group_id,
          areaId: row.area_id,
          areaType: row.area_type,
        },
      });
      continue;
    }

    const ring = areaRowToPolygonRing(row);
    if (!ring || ring.length < 4) continue;
    const northLbl =
      row.area_type === 2 ? circleLabelLngLatNorth(row.start_point, row.end_point) : null;
    const [lx, ly] = northLbl ?? ringSouthEastLabelLngLat(ring);

    features.push({
      type: "Feature",
      id,
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        _kind: "poly",
        id,
        name,
        lineColor: featureLineColor,
        lineOpacity,
        lineWidth,
        lineStyle,
        groupId: row.group_id,
        areaId: row.area_id,
        areaType: row.area_type,
      },
    });

    features.push({
      type: "Feature",
      id: `${id}-lbl`,
      geometry: { type: "Point", coordinates: [lx, ly] },
      properties: {
        _kind: "lbl",
        labelText: name,
        lineColor: featureLineColor,
        labelOpacity,
        labelAnchor: row.area_type === 2 ? "north" : "se",
        groupId: row.group_id,
        areaId: row.area_id,
        areaType: row.area_type,
      },
    });
  }

  return { type: "FeatureCollection", features };
}
