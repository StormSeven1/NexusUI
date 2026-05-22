import type maplibregl from "maplibre-gl";

const SRC = "nexus-db-areas-src";
const LINE = "nexus-db-areas-line";
const LBL = "nexus-db-areas-lbl";

export const DB_AREAS_LINE_LAYER = LINE;
export const DB_AREAS_LABEL_LAYER = LBL;
export const DB_AREAS_SOURCE = SRC;
/** 仅线框 + 名称，无填充 */
export const DB_AREAS_LAYER_IDS = [LINE, LBL] as const;

const emptyFc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function installDbAreasLayers(map: maplibregl.Map, beforeId?: string): void {
  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: "geojson", data: emptyFc });
  }
  if (!map.getLayer(LINE)) {
    map.addLayer(
      {
        id: LINE,
        type: "line",
        source: SRC,
        filter: ["in", ["get", "_kind"], ["literal", ["poly", "route"]]],
        paint: {
          "line-color": ["get", "lineColor"],
          "line-width": ["get", "lineWidth"],
          "line-opacity": 1,
        },
      },
      beforeId,
    );
  }
  if (!map.getLayer(LBL)) {
    map.addLayer(
      {
        id: LBL,
        type: "symbol",
        source: SRC,
        filter: ["==", ["get", "_kind"], "lbl"],
        layout: {
          "text-field": ["get", "labelText"],
          "text-font": ["Open Sans Regular"],
          "text-size": 11,
          /** 锚点 Geometries 在外侧东南角：字块朝西北铺开，避免 `right`+`justify` 叠字 */
          "text-anchor": "bottom-right",
          "text-max-width": 24,
          "text-line-height": 1.15,
          "text-allow-overlap": false,
          "text-ignore-placement": false,
          "text-padding": 8,
        },
        paint: {
          "text-color": ["get", "lineColor"],
          "text-halo-color": "#09090b",
          "text-halo-width": 2,
          "text-opacity": 0.95,
        },
      },
      beforeId,
    );
  }
}

export function setDbAreasGeoJSON(map: maplibregl.Map, data: GeoJSON.FeatureCollection): void {
  const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(data);
}

/**
 * 若旧版曾创建过 fill 图层，升级后移除（避免叠半透明填充）。
 */
export function removeLegacyDbAreasFillLayer(map: maplibregl.Map): void {
  const legacy = "nexus-db-areas-fill";
  if (map.getLayer(legacy)) map.removeLayer(legacy);
}
