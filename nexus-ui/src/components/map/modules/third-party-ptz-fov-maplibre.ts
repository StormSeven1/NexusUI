import type maplibregl from "maplibre-gl";
import { geoSectorCoords } from "@/lib/map-icons";
import {
  isOptoCameraAllowedOnMap,
  isOptoDeviceFovVisible,
  type OptoDeviceVisibilityMap,
} from "@/lib/opto-device-layer-visibility";
import { THIRD_PARTY_PTZ_FOV_DEG, type ThirdPartyPtzFovRow } from "@/lib/third-party-ptz-fov";

export const THIRD_PARTY_PTZ_FOV_SOURCE = "third-party-ptz-fov-source";
export const THIRD_PARTY_PTZ_FOV_FILL = "third-party-ptz-fov-fill";
export const THIRD_PARTY_PTZ_FOV_LINE = "third-party-ptz-fov-line";

export const THIRD_PARTY_PTZ_FOV_LAYER_IDS = [
  THIRD_PARTY_PTZ_FOV_FILL,
  THIRD_PARTY_PTZ_FOV_LINE,
] as const;

const NORMAL_FILL = "#22d3ee";
const NORMAL_LINE = "#06b6d4";
const ALERT_FILL = "#ef4444";
const ALERT_LINE = "#f87171";

function buildGeoJSON(rows: ThirdPartyPtzFovRow[], rangeKm: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const r of rows) {
    const ring = geoSectorCoords(r.lng, r.lat, rangeKm, r.panVehicleDeg, THIRD_PARTY_PTZ_FOV_DEG, 24);
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        id: r.entityId,
        hasTarget: r.hasTarget ? 1 : 0,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export class ThirdPartyPtzFovModule {
  private map: maplibregl.Map;
  private insertBeforeLayerId?: string;
  private rangeKm = 15;
  private lastRows: ThirdPartyPtzFovRow[] = [];
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private blinkOn = true;
  private deviceVisibility: OptoDeviceVisibilityMap = {};
  private panelIds: ReadonlySet<string> | null = null;

  constructor(map: maplibregl.Map, opts?: { insertBeforeLayerId?: string }) {
    this.map = map;
    this.insertBeforeLayerId = opts?.insertBeforeLayerId;
  }

  install() {
    const m = this.map;
    if (!m.getSource(THIRD_PARTY_PTZ_FOV_SOURCE)) {
      m.addSource(THIRD_PARTY_PTZ_FOV_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
  }

  setDefaultRangeM(rangeM: number) {
    const km = rangeM > 0 ? rangeM / 1000 : 15;
    if (Math.abs(km - this.rangeKm) > 1e-6) {
      this.rangeKm = km;
      this.refreshLayers();
    }
  }

  setPerDeviceVisibility(vis: OptoDeviceVisibilityMap, panelIds: ReadonlySet<string> | null) {
    this.deviceVisibility = vis;
    this.panelIds = panelIds;
    this.refreshLayers();
  }

  setFromRows(rows: ThirdPartyPtzFovRow[]) {
    this.lastRows = rows;
    this.refreshLayers();
  }

  private filterRows(rows: ThirdPartyPtzFovRow[]): ThirdPartyPtzFovRow[] {
    return rows.filter((r) => {
      if (!isOptoCameraAllowedOnMap(r.entityId, this.panelIds)) return false;
      return isOptoDeviceFovVisible(r.entityId, this.deviceVisibility);
    });
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
            "fill-color": [
              "case",
              ["==", ["get", "hasTarget"], 1],
              ALERT_FILL,
              NORMAL_FILL,
            ] as maplibregl.ExpressionSpecification,
            "fill-opacity": [
              "case",
              ["==", ["get", "hasTarget"], 1],
              0.55,
              0.18,
            ] as maplibregl.ExpressionSpecification,
          },
        },
        before,
      );
    }
    if (!m.getLayer(THIRD_PARTY_PTZ_FOV_LINE)) {
      m.addLayer(
        {
          id: THIRD_PARTY_PTZ_FOV_LINE,
          type: "line",
          source: THIRD_PARTY_PTZ_FOV_SOURCE,
          paint: {
            "line-color": [
              "case",
              ["==", ["get", "hasTarget"], 1],
              ALERT_LINE,
              NORMAL_LINE,
            ] as maplibregl.ExpressionSpecification,
            "line-width": 2,
            "line-opacity": [
              "case",
              ["==", ["get", "hasTarget"], 1],
              0.95,
              0.55,
            ] as maplibregl.ExpressionSpecification,
          },
        },
        before,
      );
    }
  }

  private refreshLayers() {
    const m = this.map;
    const src = m.getSource(THIRD_PARTY_PTZ_FOV_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const filtered = this.filterRows(this.lastRows);
    src.setData(buildGeoJSON(filtered, this.rangeKm) as GeoJSON.FeatureCollection);
    this.ensureLayers();

    const anyTarget = filtered.some((r) => r.hasTarget);
    if (anyTarget) this.startBlink();
    else this.stopBlink();
  }

  private startBlink() {
    if (this.blinkTimer) return;
    this.blinkOn = true;
    this.blinkTimer = setInterval(() => {
      this.blinkOn = !this.blinkOn;
      const m = this.map;
      if (!m.getLayer(THIRD_PARTY_PTZ_FOV_FILL)) return;
      const op = this.blinkOn ? 0.55 : 0.12;
      try {
        m.setPaintProperty(THIRD_PARTY_PTZ_FOV_FILL, "fill-opacity", [
          "case",
          ["==", ["get", "hasTarget"], 1],
          op,
          0.18,
        ] as maplibregl.ExpressionSpecification);
        m.setPaintProperty(THIRD_PARTY_PTZ_FOV_LINE, "line-opacity", [
          "case",
          ["==", ["get", "hasTarget"], 1],
          this.blinkOn ? 0.95 : 0.35,
          0.55,
        ] as maplibregl.ExpressionSpecification);
      } catch {
        /* style 过渡 */
      }
    }, 450);
  }

  private stopBlink() {
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
    const m = this.map;
    if (!m.getLayer(THIRD_PARTY_PTZ_FOV_FILL)) return;
    try {
      m.setPaintProperty(THIRD_PARTY_PTZ_FOV_FILL, "fill-opacity", [
        "case",
        ["==", ["get", "hasTarget"], 1],
        0.55,
        0.18,
      ] as maplibregl.ExpressionSpecification);
      m.setPaintProperty(THIRD_PARTY_PTZ_FOV_LINE, "line-opacity", [
        "case",
        ["==", ["get", "hasTarget"], 1],
        0.95,
        0.55,
      ] as maplibregl.ExpressionSpecification);
    } catch {
      /* ignore */
    }
  }

  dispose() {
    this.stopBlink();
    const m = this.map;
    for (const id of [THIRD_PARTY_PTZ_FOV_LINE, THIRD_PARTY_PTZ_FOV_FILL]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(THIRD_PARTY_PTZ_FOV_SOURCE)) m.removeSource(THIRD_PARTY_PTZ_FOV_SOURCE);
  }
}
