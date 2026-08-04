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
  THIRD_PARTY_PTZ_FOV_ALERT_FILL_COLOR,
  THIRD_PARTY_PTZ_FOV_ALERT_LINE_COLOR,
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

const FILL_COLOR_BY_ALERT: maplibregl.ExpressionSpecification = [
  "case",
  ["==", ["get", "detectAlert"], 1],
  THIRD_PARTY_PTZ_FOV_ALERT_FILL_COLOR,
  THIRD_PARTY_PTZ_FOV_FILL_COLOR,
];
const LINE_COLOR_BY_ALERT: maplibregl.ExpressionSpecification = [
  "case",
  ["==", ["get", "detectAlert"], 1],
  THIRD_PARTY_PTZ_FOV_ALERT_LINE_COLOR,
  THIRD_PARTY_PTZ_FOV_LINE_COLOR,
];

/** 删除旧版青色扇形图层（每次刷新都调用，避免与 v2 绿色层叠） */
export function purgeLegacyThirdPartyFovLayers(m: maplibregl.Map) {
  for (const id of LEGACY_LAYER_IDS) {
    if (m.getLayer(id)) m.removeLayer(id);
  }
  if (m.getSource(LEGACY_SOURCE_ID)) m.removeSource(LEGACY_SOURCE_ID);
}

function entityInDetectAlertSet(
  entityId: string,
  alertEntityIds: ReadonlySet<string> | null | undefined,
): boolean {
  if (!alertEntityIds || alertEntityIds.size === 0) return false;
  const norm = normThirdPartyEntityId(entityId);
  return alertEntityIds.has(norm) || alertEntityIds.has(entityId.toLowerCase());
}

function isFovLayerOff(
  entityId: string,
  deviceVisibility: OptoDeviceVisibilityMap,
): boolean {
  const id = normThirdPartyEntityId(entityId);
  return deviceVisibility[id]?.fov === false || deviceVisibility[entityId]?.fov === false;
}

function buildGeoJSON(
  rows: ThirdPartyPtzFovRow[],
  rangeKm: number,
  cameraDdsById?: Readonly<Record<string, EoCameraDdsStatusRow | undefined>>,
  detectAlertEntityIds?: ReadonlySet<string> | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const r of rows) {
    const ring = geoSectorCoords(r.lng, r.lat, rangeKm, r.panVehicleDeg, THIRD_PARTY_PTZ_FOV_DEG, 24);
    const detectAlert = entityInDetectAlertSet(r.entityId, detectAlertEntityIds) ? 1 : 0;
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        geomKind: "poly",
        id: r.entityId,
        detectAlert,
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
          detectAlert,
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
  private detectAlertEntityIds: ReadonlySet<string> = new Set();

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

  setDetectAlertEntityIds(ids: ReadonlySet<string>) {
    this.detectAlertEntityIds = ids;
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
      const fovOff = isFovLayerOff(r.entityId, this.deviceVisibility);
      if (!fovOff) return true;
      // 图层关视场：有检测告警（红）仍显示；告警消失后自动隐藏
      return entityInDetectAlertSet(r.entityId, this.detectAlertEntityIds);
    });
  }

  /** 按 feature.detectAlert 数据驱动着色：告警红 / 常态绿 */
  private applyPaintStyle() {
    const m = this.map;
    if (!m.getLayer(THIRD_PARTY_PTZ_FOV_FILL)) return;
    try {
      m.setPaintProperty(THIRD_PARTY_PTZ_FOV_FILL, "fill-color", FILL_COLOR_BY_ALERT);
      m.setPaintProperty(THIRD_PARTY_PTZ_FOV_FILL, "fill-opacity", 0.22);
      m.setPaintProperty(THIRD_PARTY_PTZ_FOV_LINE, "line-color", LINE_COLOR_BY_ALERT);
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
            "fill-color": FILL_COLOR_BY_ALERT,
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
            "line-color": LINE_COLOR_BY_ALERT,
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
    src.setData(
      buildGeoJSON(
        filtered,
        this.rangeKm,
        this.cameraDdsByEntityId,
        this.detectAlertEntityIds,
      ) as GeoJSON.FeatureCollection,
    );
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
