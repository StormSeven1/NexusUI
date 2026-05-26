import type maplibregl from "maplibre-gl";
import {
  formatRingLabelNm,
  NM_TO_METERS,
  type DistanceRingSettings,
} from "@/lib/distance-ring-settings";
import { geodesicCircleLngLatRing } from "@/lib/geodesic-circle";
import { pointAtBearingMeters } from "@/components/map/modules/radar-range-rings-maplibre";

export const DISTANCE_RINGS_SOURCE = "distance-rings-src";
export const DISTANCE_RINGS_LINE = "distance-rings-line";
export const DISTANCE_RINGS_LABEL = "distance-rings-label";

/** @deprecated 旧版图层 id */
export const DISTANCE_RINGS_REGION_LINE = "distance-rings-region-line";
export const DISTANCE_RINGS_FILL = "distance-rings-fill";

export const DISTANCE_RINGS_LAYER_IDS = [DISTANCE_RINGS_LINE, DISTANCE_RINGS_LABEL] as const;

function circleLineStringM(lng: number, lat: number, radiusM: number): GeoJSON.Position[] {
  return geodesicCircleLngLatRing(lng, lat, radiusM).map(([x, y]) => [x, y] as GeoJSON.Position);
}

export function buildDistanceRingsGeoJSON(settings: DistanceRingSettings): GeoJSON.FeatureCollection {
  const { ringCount, spacingNm, centerLat, centerLng, ringColor, ringOpacity, labelOpacity } =
    settings;
  const features: GeoJSON.Feature[] = [];
  const spacingM = spacingNm * NM_TO_METERS;

  for (let i = 1; i <= ringCount; i++) {
    const radiusM = i * spacingM;
    features.push({
      type: "Feature",
      properties: {
        kind: "ring-line",
        lineColor: ringColor,
        lineWidth: 1.5,
        lineOpacity: ringOpacity,
      },
      geometry: {
        type: "LineString",
        coordinates: circleLineStringM(centerLng, centerLat, radiusM),
      },
    });

    const labelPt = pointAtBearingMeters(centerLng, centerLat, radiusM, 0);
    features.push({
      type: "Feature",
      properties: {
        kind: "ring-label",
        labelText: formatRingLabelNm(i * spacingNm),
        fontColor: ringColor,
        fontOpacity: labelOpacity,
        haloColor: "#0a0a0f",
        haloWidth: 1.2,
        fontSize: 11,
      },
      geometry: { type: "Point", coordinates: labelPt },
    });
  }

  return { type: "FeatureCollection", features };
}

export class DistanceRingsMaplibre {
  private map: maplibregl.Map;
  private beforeId?: string;

  constructor(map: maplibregl.Map, options?: { insertBeforeLayerId?: string }) {
    this.map = map;
    this.beforeId = options?.insertBeforeLayerId;
  }

  install() {
    const m = this.map;
    const b = this.beforeId;
    for (const legacy of [DISTANCE_RINGS_FILL, DISTANCE_RINGS_REGION_LINE]) {
      if (m.getLayer(legacy)) m.removeLayer(legacy);
    }
    if (!m.getSource(DISTANCE_RINGS_SOURCE)) {
      m.addSource(DISTANCE_RINGS_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
    if (!m.getLayer(DISTANCE_RINGS_LINE)) {
      m.addLayer(
        {
          id: DISTANCE_RINGS_LINE,
          type: "line",
          source: DISTANCE_RINGS_SOURCE,
          filter: ["==", ["get", "kind"], "ring-line"],
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": ["get", "lineColor"],
            "line-width": ["get", "lineWidth"],
            "line-opacity": ["get", "lineOpacity"],
          },
        },
        b,
      );
    }
    if (!m.getLayer(DISTANCE_RINGS_LABEL)) {
      m.addLayer(
        {
          id: DISTANCE_RINGS_LABEL,
          type: "symbol",
          source: DISTANCE_RINGS_SOURCE,
          filter: ["==", ["get", "kind"], "ring-label"],
          layout: {
            "text-field": ["get", "labelText"],
            "text-font": ["Open Sans Regular"],
            "text-size": ["get", "fontSize"],
            "text-anchor": "bottom",
            "text-offset": [0, -0.15],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": ["get", "fontColor"],
            "text-opacity": ["get", "fontOpacity"],
            "text-halo-color": ["get", "haloColor"],
            "text-halo-width": ["get", "haloWidth"],
          },
        },
        b,
      );
    }
  }

  setFromSettings(settings: DistanceRingSettings) {
    const src = this.map.getSource(DISTANCE_RINGS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildDistanceRingsGeoJSON(settings));
  }
}
