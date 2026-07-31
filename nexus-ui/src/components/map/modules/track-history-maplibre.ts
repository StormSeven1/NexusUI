/**
 * 历史航迹点位图层：用「×」符号绘制，不连折线。
 */
import type maplibregl from "maplibre-gl";
import type { TrackHistoryEntry, TrackHistoryPoint } from "@/stores/track-history-store";

export const TRACK_HISTORY_SOURCE = "track-history-pts";
export const TRACK_HISTORY_LAYER = "track-history-cross";

/** 设计稿青绿强调色 */
const CROSS_COLOR = "#7ee8c8";

function emptyFc(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function buildFeatureCollection(
  entries: Iterable<TrackHistoryEntry>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const e of entries) {
    if (!e.points.length) continue;
    for (let i = 0; i < e.points.length; i++) {
      const p = e.points[i] as TrackHistoryPoint;
      if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) continue;
      features.push({
        type: "Feature",
        properties: {
          uniqueId: e.uniqueId,
          domain: e.domain,
          i,
        },
        geometry: {
          type: "Point",
          coordinates: [p.lng, p.lat],
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export class TrackHistoryMaplibre {
  private map: maplibregl.Map;
  private insertBeforeLayerId: string | undefined;
  private installed = false;

  constructor(map: maplibregl.Map, opts?: { insertBeforeLayerId?: string }) {
    this.map = map;
    this.insertBeforeLayerId = opts?.insertBeforeLayerId;
  }

  install(): void {
    if (this.installed) return;
    const m = this.map;
    if (!m.getSource(TRACK_HISTORY_SOURCE)) {
      m.addSource(TRACK_HISTORY_SOURCE, { type: "geojson", data: emptyFc() });
    }
    if (!m.getLayer(TRACK_HISTORY_LAYER)) {
      const layer = {
        id: TRACK_HISTORY_LAYER,
        type: "symbol" as const,
        source: TRACK_HISTORY_SOURCE,
        layout: {
          "text-field": "×",
          "text-size": 13,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-pitch-alignment": "viewport" as const,
          "text-rotation-alignment": "viewport" as const,
        },
        paint: {
          "text-color": CROSS_COLOR,
          "text-halo-color": "rgba(0,0,0,0.75)",
          "text-halo-width": 1.2,
          "text-opacity": 0.92,
        },
      };
      const before =
        this.insertBeforeLayerId && m.getLayer(this.insertBeforeLayerId)
          ? this.insertBeforeLayerId
          : undefined;
      if (before) m.addLayer(layer, before);
      else m.addLayer(layer);
    }
    this.installed = true;
  }

  setFromEntries(entries: Iterable<TrackHistoryEntry>): void {
    if (!this.installed) this.install();
    const src = this.map.getSource(TRACK_HISTORY_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildFeatureCollection(entries));
  }

  clear(): void {
    this.setFromEntries([]);
  }

  destroy(): void {
    const m = this.map;
    try {
      if (m.getLayer(TRACK_HISTORY_LAYER)) m.removeLayer(TRACK_HISTORY_LAYER);
      if (m.getSource(TRACK_HISTORY_SOURCE)) m.removeSource(TRACK_HISTORY_SOURCE);
    } catch {
      /* style 重建时可能已不存在 */
    }
    this.installed = false;
  }
}
