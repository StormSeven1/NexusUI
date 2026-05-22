import type maplibregl from "maplibre-gl";
import { setMapDrawCursor } from "@/lib/map-draw-cursor";

const P = "trackeval";
export const TRACK_EVAL_REGION_SOURCE = `${P}-region-src`;
export const TRACK_EVAL_REGION_FILL = `${P}-region-fill`;
export const TRACK_EVAL_REGION_LINE = `${P}-region-line`;
export const TRACK_EVAL_REGION_POINTS = `${P}-region-pts`;
export const TRACK_EVAL_REGION_PREVIEW = `${P}-region-preview`;

export type TrackEvalRegionKind = "" | "rect" | "polygon";

export interface TrackEvalBoundingBox {
  min_longitude: number;
  max_longitude: number;
  min_latitude: number;
  max_latitude: number;
}

export interface TrackEvalPolygonQuery {
  points: Array<{ longitude: number; latitude: number }>;
}

export interface TrackEvalRegionResult {
  kind: TrackEvalRegionKind;
  regionInfo: string;
  bounding_box?: TrackEvalBoundingBox;
  polygon?: TrackEvalPolygonQuery;
  /** 地图显示用 ring [lng,lat][] */
  displayRing?: [number, number][];
}

type LngLat = { lng: number; lat: number };

function ringFromRect(a: LngLat, b: LngLat): [number, number][] {
  const minLon = Math.min(a.lng, b.lng);
  const maxLon = Math.max(a.lng, b.lng);
  const minLat = Math.min(a.lat, b.lat);
  const maxLat = Math.max(a.lat, b.lat);
  return [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ];
}

function bboxFromRing(ring: [number, number][]): TrackEvalBoundingBox {
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return {
    min_longitude: Math.min(...lons),
    max_longitude: Math.max(...lons),
    min_latitude: Math.min(...lats),
    max_latitude: Math.max(...lats),
  };
}

function polygonQueryFromRing(ring: [number, number][]): TrackEvalPolygonQuery {
  let pts = ring;
  if (pts.length > 1) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) pts = pts.slice(0, -1);
  }
  return {
    points: pts.map(([longitude, latitude]) => ({ longitude, latitude })),
  };
}

/**
 * 航迹评估区域框选（矩形拖拽 / 多边形点击，右键或双击结束）。
 * 坐标系与 MapLibre 一致（WGS84），直接用于查询 payload。
 */
export class TrackEvalRegionDrawMaplibre {
  private map: maplibregl.Map;
  private activeKind: TrackEvalRegionKind = "";
  private rectStart: LngLat | null = null;
  private polygonPoints: [number, number][] = [];
  private onComplete?: (r: TrackEvalRegionResult) => void;
  private onCancel?: () => void;

  private downH: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private moveH: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private upH: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private clickH: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private dblH: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private ctxH: ((e: maplibregl.MapMouseEvent) => void) | null = null;

  constructor(
    map: maplibregl.Map,
    options?: {
      onComplete?: (r: TrackEvalRegionResult) => void;
      onCancel?: () => void;
    },
  ) {
    this.map = map;
    this.onComplete = options?.onComplete;
    this.onCancel = options?.onCancel;
  }

  initLayers(beforeId?: string) {
    const m = this.map;
    if (!m.getSource(TRACK_EVAL_REGION_SOURCE)) {
      m.addSource(TRACK_EVAL_REGION_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
    if (!m.getLayer(TRACK_EVAL_REGION_FILL)) {
      m.addLayer(
        {
          id: TRACK_EVAL_REGION_FILL,
          type: "fill",
          source: TRACK_EVAL_REGION_SOURCE,
          paint: { "fill-color": "#3b82f6", "fill-opacity": 0.18 },
        },
        beforeId,
      );
    }
    if (!m.getLayer(TRACK_EVAL_REGION_LINE)) {
      m.addLayer(
        {
          id: TRACK_EVAL_REGION_LINE,
          type: "line",
          source: TRACK_EVAL_REGION_SOURCE,
          paint: {
            "line-color": "#60a5fa",
            "line-width": 2,
            "line-dasharray": [2, 1],
          },
        },
        beforeId,
      );
    }
    if (!m.getLayer(TRACK_EVAL_REGION_POINTS)) {
      m.addLayer(
        {
          id: TRACK_EVAL_REGION_POINTS,
          type: "circle",
          source: TRACK_EVAL_REGION_SOURCE,
          filter: ["==", ["get", "ft"], "pt"],
          paint: {
            "circle-radius": 4,
            "circle-color": "#fff",
            "circle-stroke-color": "#3b82f6",
            "circle-stroke-width": 2,
          },
        },
        beforeId,
      );
    }
    if (!m.getLayer(TRACK_EVAL_REGION_PREVIEW)) {
      m.addLayer(
        {
          id: TRACK_EVAL_REGION_PREVIEW,
          type: "line",
          source: TRACK_EVAL_REGION_SOURCE,
          filter: ["==", ["get", "ft"], "preview"],
          paint: {
            "line-color": "#93c5fd",
            "line-width": 2,
            "line-dasharray": [2, 2],
          },
        },
        beforeId,
      );
    }
  }

  clearDisplay() {
    this.getSource()?.setData({ type: "FeatureCollection", features: [] });
  }

  deactivate() {
    this.detachHandlers();
    this.activeKind = "";
    this.rectStart = null;
    this.polygonPoints = [];
    setMapDrawCursor(this.map, false);
    this.map.dragPan.enable();
  }

  startRect() {
    this.deactivate();
    this.activeKind = "rect";
    this.rectStart = null;
    this.clearDisplay();
    setMapDrawCursor(this.map, true);
    this.map.dragPan.disable();

    this.downH = (e) => {
      if (this.activeKind !== "rect") return;
      e.preventDefault();
      e.originalEvent?.preventDefault?.();
      e.originalEvent?.stopPropagation?.();
      this.rectStart = e.lngLat;
    };
    this.moveH = (e) => {
      if (this.activeKind !== "rect" || !this.rectStart) return;
      const ring = ringFromRect(this.rectStart, e.lngLat);
      this.setGeoJson([{ ft: "poly", ring }], e.lngLat);
    };
    this.upH = (e) => {
      if (this.activeKind !== "rect" || !this.rectStart) return;
      const ring = ringFromRect(this.rectStart, e.lngLat);
      const bb = bboxFromRing(ring);
      const info = `矩形: [${bb.min_longitude.toFixed(6)}, ${bb.min_latitude.toFixed(6)}] — [${bb.max_longitude.toFixed(6)}, ${bb.max_latitude.toFixed(6)}]`;
      this.setGeoJson([{ ft: "poly", ring }]);
      this.finish({
        kind: "rect",
        regionInfo: info,
        bounding_box: bb,
        displayRing: ring,
      });
    };
    this.ctxH = (e) => {
      e.preventDefault();
      this.cancelDraw();
    };

    this.map.on("mousedown", this.downH);
    this.map.on("mousemove", this.moveH);
    this.map.on("mouseup", this.upH);
    this.map.on("contextmenu", this.ctxH);
  }

  startPolygon() {
    this.deactivate();
    this.activeKind = "polygon";
    this.polygonPoints = [];
    this.clearDisplay();
    setMapDrawCursor(this.map, true);

    this.clickH = (e) => {
      if (this.activeKind !== "polygon") return;
      e.preventDefault();
      e.originalEvent?.stopPropagation?.();
      this.polygonPoints.push([e.lngLat.lng, e.lngLat.lat]);
      this.updatePolygonPreview(e.lngLat);
    };
    this.moveH = (e) => {
      if (this.activeKind !== "polygon") return;
      this.updatePolygonPreview(e.lngLat);
    };
    this.dblH = (e) => {
      if (this.activeKind !== "polygon") return;
      e.preventDefault();
      e.originalEvent?.preventDefault?.();
      e.originalEvent?.stopPropagation?.();
      this.completePolygon();
    };
    this.ctxH = (e) => {
      e.preventDefault();
      if (this.polygonPoints.length >= 3) this.completePolygon();
      else this.cancelDraw();
    };

    this.map.on("click", this.clickH);
    this.map.on("mousemove", this.moveH);
    this.map.on("dblclick", this.dblH);
    this.map.on("contextmenu", this.ctxH);
  }

  private completePolygon() {
    if (this.polygonPoints.length < 3) return;
    const ring = [...this.polygonPoints, this.polygonPoints[0]];
    const bb = bboxFromRing(ring);
    const poly = polygonQueryFromRing(ring);
    const info = `多边形 ${this.polygonPoints.length} 顶点`;
    this.setGeoJson([{ ft: "poly", ring }]);
    this.finish({
      kind: "polygon",
      regionInfo: info,
      bounding_box: bb,
      polygon: poly,
      displayRing: ring,
    });
  }

  private cancelDraw() {
    this.deactivate();
    this.clearDisplay();
    this.onCancel?.();
  }

  private finish(result: TrackEvalRegionResult) {
    this.deactivate();
    this.onComplete?.(result);
  }

  private detachHandlers() {
    if (this.downH) this.map.off("mousedown", this.downH);
    if (this.moveH) this.map.off("mousemove", this.moveH);
    if (this.upH) this.map.off("mouseup", this.upH);
    if (this.clickH) this.map.off("click", this.clickH);
    if (this.dblH) this.map.off("dblclick", this.dblH);
    if (this.ctxH) this.map.off("contextmenu", this.ctxH);
    this.downH = this.moveH = this.upH = this.clickH = this.dblH = this.ctxH = null;
  }

  private getSource(): maplibregl.GeoJSONSource | undefined {
    return this.map.getSource(TRACK_EVAL_REGION_SOURCE) as maplibregl.GeoJSONSource | undefined;
  }

  private setGeoJson(
    parts: Array<{ ft: string; ring?: [number, number][] }>,
    cursor?: LngLat,
  ) {
    const features: GeoJSON.Feature[] = [];
    for (const p of parts) {
      if (p.ring && p.ring.length >= 3) {
        features.push({
          type: "Feature",
          properties: { ft: p.ft },
          geometry: { type: "Polygon", coordinates: [p.ring] },
        });
      }
    }
    if (this.activeKind === "polygon" && this.polygonPoints.length >= 1 && cursor) {
      const line: [number, number][] = [
        ...this.polygonPoints,
        [cursor.lng, cursor.lat],
      ];
      features.push({
        type: "Feature",
        properties: { ft: "preview" },
        geometry: { type: "LineString", coordinates: line },
      });
    }
    for (const pt of this.polygonPoints) {
      features.push({
        type: "Feature",
        properties: { ft: "pt" },
        geometry: { type: "Point", coordinates: pt },
      });
    }
    this.getSource()?.setData({ type: "FeatureCollection", features });
  }

  private updatePolygonPreview(cursor: LngLat) {
    const feats: Array<{ ft: string; ring?: [number, number][] }> = [];
    if (this.polygonPoints.length >= 2) {
      feats.push({
        ft: "poly",
        ring: [...this.polygonPoints, this.polygonPoints[0]],
      });
    }
    this.setGeoJson(feats, cursor);
  }
}
