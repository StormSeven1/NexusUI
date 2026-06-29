import type maplibregl from "maplibre-gl";
import { isCameraMapTaskExecuting } from "@/lib/eo-video/formatEoDdsTaskOverlay";
import { normThirdPartyEntityId } from "@/lib/eo-video/thirdPartyEntityId";
import { geoSectorCoords, geoSectorSideLineCoords } from "@/lib/map-icons";
import type { EoCameraDdsStatusRow } from "@/stores/eo-camera-dds-status-store";
import {
  isOptoCameraAllowedOnMap,
  type OptoDeviceVisibilityMap,
} from "@/lib/opto-device-layer-visibility";
import {
  THIRD_PARTY_PTZ_FOV_DEG,
  THIRD_PARTY_PTZ_FOV_FILL_COLOR,
  THIRD_PARTY_PTZ_FOV_LINE_COLOR,
  THIRD_PARTY_PTZ_FOV_RANGE_M,
  type ThirdPartyPtzFovRow,
} from "@/lib/third-party-ptz-fov";

/** v2：与旧版青色图层 id 区分，避免 HMR/缓存后仍显示 #22d3ee */
export const THIRD_PARTY_PTZ_FOV_SOURCE = "third-party-ptz-fov-src-v2";
export const THIRD_PARTY_PTZ_FOV_FILL = "third-party-ptz-fov-fill-v2";
export const THIRD_PARTY_PTZ_FOV_LINE = "third-party-ptz-fov-line-v2";

export const THIRD_PARTY_PTZ_FOV_LAYER_IDS = [
  THIRD_PARTY_PTZ_FOV_FILL,
  THIRD_PARTY_PTZ_FOV_LINE,
] as const;

const LEGACY_LAYER_IDS = ["third-party-ptz-fov-fill", "third-party-ptz-fov-line"] as const;
const LEGACY_SOURCE_ID = "third-party-ptz-fov-source";

/** 删除旧版青色扇形图层（每次刷新都调用，避免与 v2 绿色层叠） */
export function purgeLegacyThirdPartyFovLayers(m: maplibregl.Map) {
  for (const id of LEGACY_LAYER_IDS) {
    if (m.getLayer(id)) m.removeLayer(id);
  }
  if (m.getSource(LEGACY_SOURCE_ID)) m.removeSource(LEGACY_SOURCE_ID);
}

function buildGeoJSON(
  rows: ThirdPartyPtzFovRow[],
  rangeKm: number,
  cameraDdsById?: Readonly<Record<string, EoCameraDdsStatusRow | undefined>>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const r of rows) {
    const ring = geoSectorCoords(r.lng, r.lat, rangeKm, r.panVehicleDeg, THIRD_PARTY_PTZ_FOV_DEG, 24);
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        geomKind: "poly",
        id: r.entityId,
      },
    });

    const dds =
      cameraDdsById?.[r.entityId] ??
      cameraDdsById?.[normThirdPartyEntityId(r.entityId)];
    if (!isCameraMapTaskExecuting(dds)) continue;

    for (const line of geoSectorSideLineCoords(
      r.lng,
      r.lat,
      rangeKm,
      r.panVehicleDeg,
      THIRD_PARTY_PTZ_FOV_DEG,
    )) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: line },
        properties: {
          geomKind: "side",
          id: r.entityId,
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export class ThirdPartyPtzFovModule {
  private map: maplibregl.Map;
  private insertBeforeLayerId?: string;
  private rangeKm = THIRD_PARTY_PTZ_FOV_RANGE_M / 1000;
  private lastRows: ThirdPartyPtzFovRow[] = [];
  private cameraDdsByEntityId: Record<string, EoCameraDdsStatusRow | undefined> = {};
  private deviceVisibility: OptoDeviceVisibilityMap = {};
  private panelIds: ReadonlySet<string> | null = null;

  constructor(map: maplibregl.Map, opts?: { insertBeforeLayerId?: string }) {
    this.map = map;
    this.insertBeforeLayerId = opts?.insertBeforeLayerId;
  }

  install() {
    const m = this.map;
    purgeLegacyThirdPartyFovLayers(m);
    if (!m.getSource(THIRD_PARTY_PTZ_FOV_SOURCE)) {
      m.addSource(THIRD_PARTY_PTZ_FOV_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
  }

  setPerDeviceVisibility(vis: OptoDeviceVisibilityMap, panelIds: ReadonlySet<string> | null) {
    this.deviceVisibility = vis;
    this.panelIds = panelIds;
    this.refreshLayers();
  }

  setCameraDdsStatus(byEntityId: Readonly<Record<string, EoCameraDdsStatusRow | undefined>>) {
    this.cameraDdsByEntityId = { ...byEntityId };
    this.refreshLayers();
  }

  setFromRows(rows: ThirdPartyPtzFovRow[]) {
    this.lastRows = rows;
    this.refreshLayers();
  }

  private filterRows(rows: ThirdPartyPtzFovRow[]): ThirdPartyPtzFovRow[] {
    const panelNorm =
      this.panelIds === null
        ? null
        : new Set([...this.panelIds].map((id) => normThirdPartyEntityId(id)));
    return rows.filter((r) => {
      const id = normThirdPartyEntityId(r.entityId);
      if (!isOptoCameraAllowedOnMap(id, panelNorm)) return false;
      const vis = this.deviceVisibility;
      const fovOff = vis[id]?.fov === false || vis[r.entityId]?.fov === false;
      return !fovOff;
    });
  }

  /** 每次刷新都写 paint，避免 HMR 后图层仍保留旧色；有目标时仍保持绿色常态（不标红） */
  private applyPaintStyle() {
    const m = this.map;
    if (!m.getLayer(THIRD_PARTY_PTZ_FOV_FILL)) return;
    try {
      m.setPaintProperty(THIRD_PARTY_PTZ_FOV_FILL, "fill-color", THIRD_PARTY_PTZ_FOV_FILL_COLOR);
      m.setPaintProperty(THIRD_PARTY_PTZ_FOV_FILL, "fill-opacity", 0.22);
      m.setPaintProperty(THIRD_PARTY_PTZ_FOV_LINE, "line-color", THIRD_PARTY_PTZ_FOV_LINE_COLOR);
      m.setPaintProperty(THIRD_PARTY_PTZ_FOV_LINE, "line-opacity", 0.65);
      m.setPaintProperty(THIRD_PARTY_PTZ_FOV_LINE, "line-dasharray", [4, 3]);
    } catch {
      /* style 过渡 */
    }
  }

  private ensureLayers() {
    const m = this.map;
    if (!m.getSource(THIRD_PARTY_PTZ_FOV_SOURCE)) return;

    const before = this.insertBeforeLayerId;
    if (!m.getLayer(THIRD_PARTY_PTZ_FOV_FILL)) {
      m.addLayer(
        {
          id: THIRD_PARTY_PTZ_FOV_FILL,
          type: "fill",
          source: THIRD_PARTY_PTZ_FOV_SOURCE,
          paint: {
            "fill-color": THIRD_PARTY_PTZ_FOV_FILL_COLOR,
            "fill-opacity": 0.22,
          },
        },
        before,
      );
    } else {
      try {
        m.setFilter(THIRD_PARTY_PTZ_FOV_FILL, null);
      } catch {
        /* style 过渡 */
      }
    }
    if (!m.getLayer(THIRD_PARTY_PTZ_FOV_LINE)) {
      m.addLayer(
        {
          id: THIRD_PARTY_PTZ_FOV_LINE,
          type: "line",
          source: THIRD_PARTY_PTZ_FOV_SOURCE,
          filter: ["==", ["get", "geomKind"], "side"],
          paint: {
            "line-color": THIRD_PARTY_PTZ_FOV_LINE_COLOR,
            "line-width": 2,
            "line-opacity": 0.65,
            "line-dasharray": [4, 3],
          },
        },
        before,
      );
    } else {
      try {
        m.setFilter(THIRD_PARTY_PTZ_FOV_LINE, ["==", ["get", "geomKind"], "side"]);
        m.setPaintProperty(THIRD_PARTY_PTZ_FOV_LINE, "line-dasharray", [4, 3]);
      } catch {
        /* style 过渡 */
      }
    }
    this.applyPaintStyle();
  }

  private refreshLayers() {
    const m = this.map;
    purgeLegacyThirdPartyFovLayers(m);
    const src = m.getSource(THIRD_PARTY_PTZ_FOV_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const filtered = this.filterRows(this.lastRows);
    src.setData(buildGeoJSON(filtered, this.rangeKm, this.cameraDdsByEntityId) as GeoJSON.FeatureCollection);
    this.ensureLayers();
  }

  dispose() {
    const m = this.map;
    for (const id of [THIRD_PARTY_PTZ_FOV_LINE, THIRD_PARTY_PTZ_FOV_FILL]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(THIRD_PARTY_PTZ_FOV_SOURCE)) m.removeSource(THIRD_PARTY_PTZ_FOV_SOURCE);
    purgeLegacyThirdPartyFovLayers(m);
  }
}
