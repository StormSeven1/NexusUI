import type maplibregl from "maplibre-gl";

const SRC = "nexus-db-areas-src";
const LINE = "nexus-db-areas-line";
const LBL = "nexus-db-areas-lbl";
const FLASH_SRC = "nexus-db-areas-flash-src";
const FLASH_LINE = "nexus-db-areas-flash-line";
const FLASH_LBL = "nexus-db-areas-flash-lbl";

export const DB_AREAS_LINE_LAYER = LINE;
export const DB_AREAS_LABEL_LAYER = LBL;
export const DB_AREAS_SOURCE = SRC;
export const DB_AREAS_FLASH_SOURCE = FLASH_SRC;
export const DB_AREAS_FLASH_LINE_LAYER = FLASH_LINE;
export const DB_AREAS_FLASH_LABEL_LAYER = FLASH_LBL;
/** 仅线框 + 名称，无填充 */
export const DB_AREAS_LAYER_IDS = [LINE, LBL] as const;
export const DB_AREAS_FLASH_LAYER_IDS = [FLASH_LINE, FLASH_LBL] as const;

const emptyFc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function installDbAreasLayers(map: maplibregl.Map, beforeId?: string): void {
  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: "geojson", data: emptyFc });
  }
  if (!map.getSource(FLASH_SRC)) {
    map.addSource(FLASH_SRC, { type: "geojson", data: emptyFc });
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
          "line-opacity": ["coalesce", ["get", "lineOpacity"], 1],
          "line-dasharray": [
            "match",
            ["get", "lineStyle"],
            "dashed",
            ["literal", [8, 4]],
            "dotted",
            ["literal", [1, 3]],
            ["literal", [1, 0]],
          ],
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
          "text-anchor": [
            "match",
            ["get", "labelAnchor"],
            "north",
            "bottom",
            "bottom-right",
          ],
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
          "text-opacity": ["coalesce", ["get", "labelOpacity"], 0.95],
        },
      },
      beforeId,
    );
  }
  if (!map.getLayer(FLASH_LINE)) {
    map.addLayer(
      {
        id: FLASH_LINE,
        type: "line",
        source: FLASH_SRC,
        filter: ["in", ["get", "_kind"], ["literal", ["poly", "route"]]],
        layout: { visibility: "none" },
        paint: {
          "line-color": ["get", "lineColor"],
          "line-width": ["get", "lineWidth"],
          "line-opacity": 1,
          "line-dasharray": [
            "match",
            ["get", "lineStyle"],
            "dashed",
            ["literal", [8, 4]],
            "dotted",
            ["literal", [1, 3]],
            ["literal", [1, 0]],
          ],
        },
      },
      beforeId,
    );
  }
  if (!map.getLayer(FLASH_LBL)) {
    map.addLayer(
      {
        id: FLASH_LBL,
        type: "symbol",
        source: FLASH_SRC,
        filter: ["==", ["get", "_kind"], "lbl"],
        layout: {
          visibility: "none",
          "text-field": ["get", "labelText"],
          "text-font": ["Open Sans Regular"],
          "text-size": 11,
          "text-anchor": [
            "match",
            ["get", "labelAnchor"],
            "north",
            "bottom",
            "bottom-right",
          ],
          "text-max-width": 24,
          "text-line-height": 1.15,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-padding": 8,
        },
        paint: {
          "text-color": ["get", "lineColor"],
          "text-halo-color": "#09090b",
          "text-halo-width": 2,
          "text-opacity": 1,
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

export function setDbAreasFlashGeoJSON(map: maplibregl.Map, data: GeoJSON.FeatureCollection): void {
  const src = map.getSource(FLASH_SRC) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(data);
}

export function setDbAreasFlashLayersVisible(map: maplibregl.Map, visible: boolean): void {
  const vis = visible ? "visible" : "none";
  for (const id of DB_AREAS_FLASH_LAYER_IDS) {
    try {
      if (!map.getLayer(id)) continue;
      map.setLayoutProperty(id, "visibility", vis);
    } catch {
      /* style 过渡 */
    }
  }
}

export function setDbAreasFlashPulseOpacity(map: maplibregl.Map, opacity: number): void {
  for (const id of [FLASH_LINE, FLASH_LBL] as const) {
    try {
      if (!map.getLayer(id)) continue;
      const prop = id === FLASH_LINE ? "line-opacity" : "text-opacity";
      map.setPaintProperty(id, prop, opacity);
    } catch {
      /* style 过渡 */
    }
  }
}

/**
 * 若旧版曾创建过 fill 图层，升级后移除（避免叠半透明填充）。
 */
export function removeLegacyDbAreasFillLayer(map: maplibregl.Map): void {
  const legacy = "nexus-db-areas-fill";
  if (map.getLayer(legacy)) map.removeLayer(legacy);
}
