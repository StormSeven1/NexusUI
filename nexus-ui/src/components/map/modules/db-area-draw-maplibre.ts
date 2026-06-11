import type maplibregl from "maplibre-gl";
import type { AreaDrawShape } from "@/lib/area-table-serialize";
import type { LngLat } from "@/lib/area-table-serialize";
import { ringFromAreaRect, ringFromCircle, ringFromAreaPoints } from "@/lib/area-table-geometry";
import {
  buildAreaGeometryPayload,
  serializeAreaRect,
  serializeCircle,
  serializeAreaPoints,
} from "@/lib/area-table-serialize";
import { setMapDrawCursor } from "@/lib/map/draw/map-draw-cursor";

const P = "dbareadraw";
export const DB_AREA_DRAW_SOURCE = `${P}-src`;
export const DB_AREA_DRAW_FILL = `${P}-fill`;
export const DB_AREA_DRAW_LINE = `${P}-line`;
export const DB_AREA_DRAW_POINTS = `${P}-pts`;

export const DB_AREA_DRAW_LAYER_IDS = [DB_AREA_DRAW_FILL, DB_AREA_DRAW_LINE, DB_AREA_DRAW_POINTS] as const;

export type DbAreaDrawCompletePayload = {
  shape: AreaDrawShape;
  points: LngLat[];
  geometry: ReturnType<typeof buildAreaGeometryPayload>;
};

/**
 * 数据库区域标绘：矩形、圆、多边形、航线（折线，≥2 点双击结束）。
 * 激活时十字光标并禁用地图漫游（dragPan）；右键取消当前绘制。
 */
export class DbAreaDrawMaplibre {
  private map: maplibregl.Map;
  private active = false;
  private shape: AreaDrawShape = "polygon";
  private points: LngLat[] = [];
  private preview: LngLat | null = null;
  private onComplete?: (p: DbAreaDrawCompletePayload) => void;
  private onCancel?: () => void;
  private clickH: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private moveH: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private ctxH: ((e: maplibregl.MapMouseEvent) => void) | null = null;

  constructor(map: maplibregl.Map, options?: { onComplete?: (p: DbAreaDrawCompletePayload) => void; onCancel?: () => void }) {
    this.map = map;
    this.onComplete = options?.onComplete;
    this.onCancel = options?.onCancel;
  }

  init(beforeId?: string) {
    const m = this.map;
    if (!m.getSource(DB_AREA_DRAW_SOURCE)) {
      m.addSource(DB_AREA_DRAW_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    if (!m.getLayer(DB_AREA_DRAW_FILL)) {
      m.addLayer(
        {
          id: DB_AREA_DRAW_FILL,
          type: "fill",
          source: DB_AREA_DRAW_SOURCE,
          filter: ["==", ["get", "ft"], "poly"],
          paint: { "fill-opacity": 0 },
        },
        beforeId,
      );
    }
    if (!m.getLayer(DB_AREA_DRAW_LINE)) {
      m.addLayer(
        {
          id: DB_AREA_DRAW_LINE,
          type: "line",
          source: DB_AREA_DRAW_SOURCE,
          filter: ["==", ["get", "ft"], "ln"],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#3b82f6", "line-width": 2, "line-dasharray": [2, 1] },
        },
        beforeId,
      );
    }
    if (!m.getLayer(DB_AREA_DRAW_POINTS)) {
      m.addLayer(
        {
          id: DB_AREA_DRAW_POINTS,
          type: "circle",
          source: DB_AREA_DRAW_SOURCE,
          filter: ["==", ["get", "ft"], "pt"],
          paint: {
            "circle-radius": 5,
            "circle-color": "#fff",
            "circle-stroke-color": "#3b82f6",
            "circle-stroke-width": 2,
          },
        },
        beforeId,
      );
    }
  }

  destroy() {
    this.deactivate();
    const m = this.map;
    for (const id of [DB_AREA_DRAW_POINTS, DB_AREA_DRAW_LINE, DB_AREA_DRAW_FILL]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(DB_AREA_DRAW_SOURCE)) m.removeSource(DB_AREA_DRAW_SOURCE);
  }

  activate(shape: AreaDrawShape) {
    if (this.active) this.deactivate();
    this.active = true;
    this.shape = shape;
    this.points = [];
    this.preview = null;
    setMapDrawCursor(this.map, true);
    this.map.dragPan.disable();
    this.map.boxZoom.disable();
    this.map.doubleClickZoom?.disable();

    this.clickH = (e) => {
      if (e.originalEvent.button !== 0) return;
      const pt: LngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      const me = e.originalEvent as MouseEvent;

      if ((this.shape === "polygon" || this.shape === "route") && me.detail === 2) {
        e.preventDefault();
        const min = this.shape === "route" ? 2 : 3;
        if (this.points.length >= min) this.finish();
        return;
      }

      this.points.push(pt);

      if (this.shape === "rect" && this.points.length >= 2) {
        this.finish();
        return;
      }
      if (this.shape === "circle" && this.points.length >= 2) {
        this.finish();
        return;
      }
      this.redraw();
    };

    this.moveH = (e) => {
      if (!this.active || this.points.length === 0) return;
      this.preview = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      this.redraw();
    };

    this.ctxH = (e) => {
      e.preventDefault();
      this.cancel();
    };

    this.map.on("click", this.clickH);
    this.map.on("mousemove", this.moveH);
    this.map.on("contextmenu", this.ctxH);
    this.redraw();
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    if (this.clickH) this.map.off("click", this.clickH);
    if (this.moveH) this.map.off("mousemove", this.moveH);
    if (this.ctxH) this.map.off("contextmenu", this.ctxH);
    this.clickH = this.moveH = this.ctxH = null;
    setMapDrawCursor(this.map, false);
    this.map.dragPan.enable();
    this.map.boxZoom.enable();
    this.map.doubleClickZoom?.disable();
    this.points = [];
    this.preview = null;
    this.redraw();
  }

  cancel() {
    this.deactivate();
    this.onCancel?.();
  }

  private finish() {
    const pts = [...this.points];
    const geometry = buildAreaGeometryPayload(this.shape, pts);
    if (!geometry) {
      this.cancel();
      return;
    }
    this.deactivate();
    this.onComplete?.({ shape: this.shape, points: pts, geometry });
  }

  private previewRing(): [number, number][] | null {
    const p = this.preview;
    if (!p) return null;

    if (this.shape === "rect" && this.points.length >= 1) {
      const a = this.points[0]!;
      return ringFromAreaRect(serializeAreaRect(a, p));
    }
    if (this.shape === "circle" && this.points.length >= 1) {
      const c = this.points[0]!;
      const { start_point, end_point } = serializeCircle(c, p);
      return ringFromCircle(start_point, end_point);
    }
    if (this.shape === "route") {
      const coords: LngLat[] = [...this.points];
      if (p) coords.push(p);
      if (coords.length < 2) return null;
      return coords.map((x) => [x.lng, x.lat] as [number, number]);
    }
    if (this.shape === "polygon") {
      const coords: LngLat[] = [...this.points];
      if (p) coords.push(p);
      if (coords.length < 2) return null;
      if (coords.length < 3) {
        return coords.map((x) => [x.lng, x.lat] as [number, number]);
      }
      return ringFromAreaPoints(serializeAreaPoints(coords));
    }
    return null;
  }

  private redraw() {
    const feats: GeoJSON.Feature[] = [];
    const ring = this.previewRing();

    if (
      (this.shape === "polygon" && this.points.length >= 1 && this.preview && this.points.length < 3) ||
      (this.shape === "route" && this.points.length >= 1 && this.preview)
    ) {
      const line: [number, number][] = [
        ...this.points.map((x) => [x.lng, x.lat] as [number, number]),
        [this.preview!.lng, this.preview!.lat],
      ];
      feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { ft: "ln" } });
    } else if (this.shape === "route" && ring && ring.length >= 2) {
      feats.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: ring },
        properties: { ft: "ln" },
      });
    } else if (ring && ring.length >= 4) {
      feats.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { ft: "poly" },
      });
      feats.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: ring },
        properties: { ft: "ln" },
      });
    } else if (ring && ring.length >= 2 && this.shape !== "polygon") {
      feats.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: ring },
        properties: { ft: "ln" },
      });
    }

    for (const pt of this.points) {
      feats.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [pt.lng, pt.lat] },
        properties: { ft: "pt" },
      });
    }

    const src = this.map.getSource(DB_AREA_DRAW_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData({ type: "FeatureCollection", features: feats });
  }
}
