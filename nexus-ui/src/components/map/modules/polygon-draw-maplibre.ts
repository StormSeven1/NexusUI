import type maplibregl from "maplibre-gl";
import { polygonAreaMetersApprox, lineLengthMeters } from "@/components/map/modules/map-geo-math";

const P = "polydraw2";
/** 标绘进行中草稿几何（fill/line/pts/lbl）；`initDraft` 时 `addSource` */
export const POLY_DRAW_SOURCE = `${P}-source`;
export const POLY_DRAW_FILL = `${P}-fill`;
export const POLY_DRAW_LINE = `${P}-line`;
export const POLY_DRAW_POINTS = `${P}-pts`;
export const POLY_DRAW_LABEL = `${P}-lbl`;

export const POLY_DRAW_LAYER_IDS = [POLY_DRAW_FILL, POLY_DRAW_LINE, POLY_DRAW_POINTS, POLY_DRAW_LABEL] as const;

export type PolygonDrawVisibility = {
  fillVisible: boolean;
  lineVisible: boolean;
  pointsVisible: boolean;
  labelVisible: boolean;
  fillColor: string;
  lineColor: string;
  lineWidth: number;
  pointColor: string;
  pointStroke: string;
};

const def: PolygonDrawVisibility = {
  fillVisible: true,
  lineVisible: true,
  pointsVisible: true,
  labelVisible: true,
  fillColor: "rgba(59,130,246,0.22)",
  lineColor: "#3b82f6",
  lineWidth: 2,
  pointColor: "#fff",
  pointStroke: "#3b82f6",
};

export type PolygonDrawCompletePayload = {
  ring: [number, number][];
  areaM2: number;
  perimeterM: number;
};

/** 多边形量算标绘：左键加点，双击闭合；右键取消当前。 */
export class PolygonDrawMaplibre {
  private map: maplibregl.Map;
  private vis: PolygonDrawVisibility = { ...def };
  private active = false;
  private ring: [number, number][] = [];
  private preview: [number, number] | null = null;
  private onComplete?: (p: PolygonDrawCompletePayload) => void;
  private clickH: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private moveH: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private ctxH: ((e: maplibregl.MapMouseEvent) => void) | null = null;

  constructor(map: maplibregl.Map, options?: { onComplete?: (p: PolygonDrawCompletePayload) => void }) {
    this.map = map;
    this.onComplete = options?.onComplete;
  }

  initDraft(beforeId?: string) {
    const m = this.map;
    if (!m.getSource(POLY_DRAW_SOURCE)) {
      m.addSource(POLY_DRAW_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    if (!m.getLayer(POLY_DRAW_FILL)) {
      m.addLayer(
        {
          id: POLY_DRAW_FILL,
          type: "fill",
          source: POLY_DRAW_SOURCE,
          filter: ["==", ["get", "ft"], "poly"],
          paint: { "fill-color": this.vis.fillColor },
        },
        beforeId,
      );
    }
    if (!m.getLayer(POLY_DRAW_LINE)) {
      m.addLayer(
        {
          id: POLY_DRAW_LINE,
          type: "line",
          source: POLY_DRAW_SOURCE,
          filter: ["==", ["get", "ft"], "ln"],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": this.vis.lineColor,
            "line-width": this.vis.lineWidth,
            "line-dasharray": [2, 1],
          },
        },
        beforeId,
      );
    }
    if (!m.getLayer(POLY_DRAW_POINTS)) {
      m.addLayer(
        {
          id: POLY_DRAW_POINTS,
          type: "circle",
          source: POLY_DRAW_SOURCE,
          filter: ["==", ["get", "ft"], "pt"],
          paint: {
            "circle-radius": 5,
            "circle-color": this.vis.pointColor,
            "circle-stroke-color": this.vis.pointStroke,
            "circle-stroke-width": 2,
          },
        },
        beforeId,
      );
    }
    if (!m.getLayer(POLY_DRAW_LABEL)) {
      m.addLayer(
        {
          id: POLY_DRAW_LABEL,
          type: "symbol",
          source: POLY_DRAW_SOURCE,
          filter: ["==", ["get", "ft"], "lb"],
          layout: {
            "text-field": ["get", "txt"],
            "text-font": ["Open Sans Regular"],
            "text-size": 11,
            "text-offset": [0, -1.2],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: { "text-color": "#e2e8f0", "text-halo-color": "#000", "text-halo-width": 1 },
        },
        beforeId,
      );
    }
    this.applyLayerLayoutVisibility();
  }

  setVisibility(partial: Partial<PolygonDrawVisibility>) {
    this.vis = { ...this.vis, ...partial };
    const m = this.map;
    try {
      if (m.getLayer(POLY_DRAW_FILL)) m.setPaintProperty(POLY_DRAW_FILL, "fill-color", this.vis.fillColor);
      if (m.getLayer(POLY_DRAW_LINE)) {
        m.setPaintProperty(POLY_DRAW_LINE, "line-color", this.vis.lineColor);
        m.setPaintProperty(POLY_DRAW_LINE, "line-width", this.vis.lineWidth);
      }
      if (m.getLayer(POLY_DRAW_POINTS)) {
        m.setPaintProperty(POLY_DRAW_POINTS, "circle-color", this.vis.pointColor);
        m.setPaintProperty(POLY_DRAW_POINTS, "circle-stroke-color", this.vis.pointStroke);
      }
    } catch {
      /* ignore */
    }
    this.applyLayerLayoutVisibility();
    this.redraw();
  }

  private applyLayerLayoutVisibility() {
    const m = this.map;
    const setVis = (id: string, show: boolean) => {
      if (!m.getLayer(id)) return;
      m.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    };
    setVis(POLY_DRAW_FILL, this.vis.fillVisible);
    setVis(POLY_DRAW_LINE, this.vis.lineVisible);
    setVis(POLY_DRAW_POINTS, this.vis.pointsVisible);
    setVis(POLY_DRAW_LABEL, this.vis.labelVisible);
  }

  destroy() {
    this.deactivate();
    const m = this.map;
    for (const id of [POLY_DRAW_LABEL, POLY_DRAW_POINTS, POLY_DRAW_LINE, POLY_DRAW_FILL]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(POLY_DRAW_SOURCE)) m.removeSource(POLY_DRAW_SOURCE);
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.ring = [];
    this.preview = null;
    this.map.getCanvas().style.cursor = "crosshair";
    this.map.doubleClickZoom?.disable();

    this.clickH = (e) => {
      if (e.originalEvent.button !== 0) return;
      const me = e.originalEvent as MouseEvent;
      if (me.detail === 2) {
        e.preventDefault();
        if (this.ring.length >= 3) {
          const closed = [...this.ring, this.ring[0]!];
          const area = polygonAreaMetersApprox(closed);
          const perim = lineLengthMeters(closed);
          this.onComplete?.({ ring: [...this.ring], areaM2: area, perimeterM: perim });
          this.ring = [];
          this.preview = null;
          this.redraw();
        }
        return;
      }
      this.ring.push([e.lngLat.lng, e.lngLat.lat]);
      this.redraw();
    };
    this.moveH = (e) => {
      if (!this.active || this.ring.length === 0) return;
      this.preview = [e.lngLat.lng, e.lngLat.lat];
      this.redraw();
    };
    this.ctxH = (e) => {
      e.preventDefault();
      this.ring = [];
      this.preview = null;
      this.redraw();
    };

    this.map.on("click", this.clickH);
    this.map.on("mousemove", this.moveH);
    this.map.on("contextmenu", this.ctxH);
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    if (this.clickH) this.map.off("click", this.clickH);
    if (this.moveH) this.map.off("mousemove", this.moveH);
    if (this.ctxH) this.map.off("contextmenu", this.ctxH);
    this.clickH = this.moveH = this.ctxH = null;
    this.map.getCanvas().style.cursor = "";
    this.map.doubleClickZoom?.disable();
    this.ring = [];
    this.preview = null;
    this.redraw();
  }

  clear() {
    this.ring = [];
    this.preview = null;
    this.redraw();
  }

  private redraw() {
    const feats: GeoJSON.Feature[] = [];
    const coords: [number, number][] = [...this.ring];
    if (this.preview && coords.length > 0) coords.push(this.preview);
    if (coords.length >= 2 && this.vis.lineVisible) {
      feats.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { ft: "ln" },
      });
    }
    if (coords.length >= 3 && this.vis.fillVisible) {
      const ring = [...coords, coords[0]!];
      feats.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { ft: "poly" },
      });
    }
    if (this.vis.pointsVisible) {
      this.ring.forEach((pt) => {
        feats.push({ type: "Feature", geometry: { type: "Point", coordinates: pt }, properties: { ft: "pt" } });
      });
    }
    const src = this.map.getSource(POLY_DRAW_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData({ type: "FeatureCollection", features: feats });
  }
}
