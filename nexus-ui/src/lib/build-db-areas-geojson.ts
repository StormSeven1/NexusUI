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

/** @deprecated 请用态势显示中的区域图层配色；保留常量供旧引用 */
export const DB_AREA_MAP_UI_COLOR = DEFAULT_AREA_LAYER_LINE_COLOR;

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

/**
 * 数据库区域 → MapLibre GeoJSON（Polygon + Point 标签）。
 * @param includeRow 总开关与子项显隐过滤后仍为 true 才入图。
 * @param style 态势显示 · 区域图层边线/标注样式（覆盖固定浅色）
 */
export function buildDbAreasFeatureCollection(
  rows: AreaTableRow[],
  includeRow: (row: AreaTableRow) => boolean = () => true,
  style?: SituationAreaLayerStyle,
): GeoJSON.FeatureCollection {
  const lineColor =
    style?.lineColor?.trim() ||
    DEFAULT_AREA_LAYER_LINE_COLOR;
  const lineOpacity = style?.lineOpacity ?? 1;
  const labelOpacity = style?.labelOpacity ?? 0.95;
  const features: GeoJSON.Feature[] = [];

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
      features.push({
        type: "Feature",
        id,
        geometry: { type: "LineString", coordinates: line },
        properties: {
          _kind: "route",
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
      },
    });
  }

  return { type: "FeatureCollection", features };
}
