import type { AreaTableRow } from "@/lib/area-table-geometry";
import { areaRowToPolygonRing, dbAreaFeatureId, lineFromAreaRoute } from "@/lib/area-table-geometry";
import { mapAreaFallbackLabel } from "@/lib/area-table-serialize";

/**
 * 区域图层线框 + 标签字色（深底图用柔和浅灰蓝，避免纯白刺眼；与 DB `line_color` 解耦以保证可读一致）
 */
export const DB_AREA_MAP_UI_COLOR = "#c8d1dd";

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
 */
export function buildDbAreasFeatureCollection(
  rows: AreaTableRow[],
  includeRow: (row: AreaTableRow) => boolean = () => true,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const row of rows) {
    if (!includeRow(row)) continue;

    const lineColor = DB_AREA_MAP_UI_COLOR;
    const name =
      (row.area_name && String(row.area_name).trim()) ||
      mapAreaFallbackLabel(row.group_id, row.area_id, row.area_type);
    const id = dbAreaFeatureId(row);
    const lineWidth = Math.max(1.5, Math.min(6, Number(row.line_width) || 2));

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
          lineColor,
          lineWidth,
          groupId: row.group_id,
          areaId: row.area_id,
          areaType: row.area_type,
        },
      });
      features.push({
        type: "Feature",
        id: `${id}-lbl`,
        geometry: { type: "Point", coordinates: [lx, ly] },
        properties: { _kind: "lbl", labelText: name, lineColor },
      });
      continue;
    }

    const ring = areaRowToPolygonRing(row);
    if (!ring || ring.length < 4) continue;
    const [lx, ly] = ringSouthEastLabelLngLat(ring);

    features.push({
      type: "Feature",
      id,
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        _kind: "poly",
        id,
        name,
        lineColor,
        lineWidth,
        groupId: row.group_id,
        areaId: row.area_id,
        areaType: row.area_type,
      },
    });

    features.push({
      type: "Feature",
      id: `${id}-lbl`,
      geometry: { type: "Point", coordinates: [lx, ly] },
      properties: { _kind: "lbl", labelText: name, lineColor },
    });
  }

  return { type: "FeatureCollection", features };
}
