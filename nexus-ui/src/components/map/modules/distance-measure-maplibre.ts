import type maplibregl from "maplibre-gl";
import { lineLengthMeters } from "@/components/map/modules/map-geo-math";

const P = "distmeasure";
export const DIST_MEASURE_SOURCE = `${P}-source`;
export const DIST_MEASURE_LINE = `${P}-line`;
export const DIST_MEASURE_POINTS = `${P}-points`;
export const DIST_MEASURE_LABEL = `${P}-label`;

export const DIST_MEASURE_LAYER_IDS = [DIST_MEASURE_LINE, DIST_MEASURE_POINTS, DIST_MEASURE_LABEL] as const;

/**
 * 显隐与样式（对齐 V2 DistanceMeasureManager.visibility）：
 * - `lineVisible` / `pointsVisible` / `labelVisible`：为 false 时对应图层 `layout.visibility = none`。
 * - `lineColor` / `pointColor` / `pointStrokeColor` / `labelColor`：折线、折点、总距标签颜色。
 */
export type DistanceMeasureVisibility = {
  lineVisible: boolean;
  pointsVisible: boolean;
  labelVisible: boolean;
  lineColor: string;
  pointColor: string;
  pointStrokeColor: string;
  labelColor: string;
};

const defaultVis: DistanceMeasureVisibility = {
  lineVisible: true,
  pointsVisible: true,
  labelVisible: true,
  lineColor: "#22d3ee",
  pointColor: "#ffffff",
  pointStrokeColor: "#22d3ee",
  labelColor: "#22d3ee",
};

/**
 * 距离测量（逻辑参考 V2 DistanceMeasureManager）：左键加点、右键清空、双击结束当前段并保留结果。
 */
export class DistanceMeasureMaplibre {
  private map: maplibregl.Map;
  private vis: DistanceMeasureVisibility = { ...defaultVis };
  private active = false;
  private points: [number, number][] = [];
  private preview: [number, number] | null = null;
  private finished = false;
  private clickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private moveHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private ctxHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private dblHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;

  constructor(map: maplibregl.Map) {
    this.map = map;
  }

  init(beforeId?: string) {
    const m = this.map;
    if (!m.getSource(DIST_MEASURE_SOURCE)) {
      m.addSource(DIST_MEASURE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    if (!m.getLayer(DIST_MEASURE_LINE)) {
      m.addLayer(
        {
          id: DIST_MEASURE_LINE,
          type: "line",
          source: DIST_MEASURE_SOURCE,
          filter: ["==", ["get", "featureType"], "line"],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": this.vis.lineColor, "line-width": 2 },
        },
        beforeId
      );
    }
    if (!m.getLayer(DIST_MEASURE_POINTS)) {
      m.addLayer(
        {
          id: DIST_MEASURE_POINTS,
          type: "circle",
          source: DIST_MEASURE_SOURCE,
          filter: ["==", ["get", "featureType"], "point"],
          paint: {
            "circle-radius": 5,
            "circle-color": this.vis.pointColor,
            "circle-stroke-color": this.vis.pointStrokeColor,
            "circle-stroke-width": 2,
          },
        },
        beforeId
      );
    }
    if (!m.getLayer(DIST_MEASURE_LABEL)) {
      m.addLayer(
        {
          id: DIST_MEASURE_LABEL,
          type: "symbol",
          source: DIST_MEASURE_SOURCE,
          filter: ["==", ["get", "featureType"], "label"],
          layout: {
            "text-field": ["get", "text"],
            "text-font": ["Open Sans Regular"],
            "text-size": 12,
            "text-offset": [0, -1.2],
            "text-anchor": "top",
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": this.vis.labelColor,
            "text-halo-color": "#000000",
            "text-halo-width": 1.2,
          },
        },
        beforeId
      );
    }
    this.applyLayerLayoutVisibility();
  }

  private applyLayerLayoutVisibility() {
    const m = this.map;
    const setVis = (id: string, show: boolean) => {
      if (!m.getLayer(id)) return;
      m.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    };
    setVis(DIST_MEASURE_LINE, this.vis.lineVisible);
    setVis(DIST_MEASURE_POINTS, this.vis.pointsVisible);
    setVis(DIST_MEASURE_LABEL, this.vis.labelVisible);
  }

  destroy() {
    this.deactivate();
    const m = this.map;
    for (const id of [DIST_MEASURE_LABEL, DIST_MEASURE_POINTS, DIST_MEASURE_LINE]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(DIST_MEASURE_SOURCE)) m.removeSource(DIST_MEASURE_SOURCE);
  }

  setVisibility(partial: Partial<DistanceMeasureVisibility>) {
    this.vis = { ...this.vis, ...partial };
    const m = this.map;
    try {
      if (m.getLayer(DIST_MEASURE_LINE)) m.setPaintProperty(DIST_MEASURE_LINE, "line-color", this.vis.lineColor);
      if (m.getLayer(DIST_MEASURE_POINTS)) {
        m.setPaintProperty(DIST_MEASURE_POINTS, "circle-color", this.vis.pointColor);
        m.setPaintProperty(DIST_MEASURE_POINTS, "circle-stroke-color", this.vis.pointStrokeColor);
      }
      if (m.getLayer(DIST_MEASURE_LABEL)) m.setPaintProperty(DIST_MEASURE_LABEL, "text-color", this.vis.labelColor);
    } catch {
      /* ignore */
    }
    this.applyLayerLayoutVisibility();
    this.redraw();
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.points = [];
    this.preview = null;
    this.finished = false;
    this.map.getCanvas().style.cursor = "crosshair";
    this.map.doubleClickZoom?.disable();

    this.clickHandler = (e) => {
      if (e.originalEvent.button !== 0) return;
      if (this.finished) this.clear();
      const { lng, lat } = e.lngLat;
      this.points.push([lng, lat]);
      this.finished = false;
      this.redraw();
    };
    this.moveHandler = (e) => {
      if (!this.active || this.points.length === 0 || this.finished) return;
      const { lng, lat } = e.lngLat;
      this.preview = [lng, lat];
      this.redraw();
    };
    this.ctxHandler = (e) => {
      e.preventDefault();
      this.clear();
    };
    this.dblHandler = (e) => {
      e.preventDefault();
      this.preview = null;
      this.finished = true;
      this.redraw(true);
    };

    this.map.on("click", this.clickHandler);
    this.map.on("mousemove", this.moveHandler);
    this.map.on("contextmenu", this.ctxHandler);
    this.map.on("dblclick", this.dblHandler);
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    if (this.clickHandler) this.map.off("click", this.clickHandler);
    if (this.moveHandler) this.map.off("mousemove", this.moveHandler);
    if (this.ctxHandler) this.map.off("contextmenu", this.ctxHandler);
    if (this.dblHandler) this.map.off("dblclick", this.dblHandler);
    this.clickHandler = this.moveHandler = this.ctxHandler = this.dblHandler = null;
    this.map.getCanvas().style.cursor = "";
    this.map.doubleClickZoom?.enable();
    this.clear();
  }

  clear() {
    this.points = [];
    this.preview = null;
    this.finished = false;
    this.pushFeatures([]);
  }

  private redraw(finish = false) {
    const coords: [number, number][] = [...this.points];
    if (this.preview && !finish) coords.push(this.preview);
    const feats: GeoJSON.Feature[] = [];
    if (this.vis.lineVisible && coords.length >= 2) {
      feats.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { featureType: "line" },
      });
    }
    if (this.vis.pointsVisible) {
      coords.forEach((pt) => {
        feats.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: pt },
          properties: { featureType: "point" },
        });
      });
    }
    if (this.vis.labelVisible && coords.length >= 2) {
      const m = lineLengthMeters(coords);
      const t = m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
      feats.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: coords[coords.length - 1]! },
        properties: { featureType: "label", text: `总距离: ${t}` },
      });
    }
    this.pushFeatures(feats);
  }

  private pushFeatures(features: GeoJSON.Feature[]) {
    const src = this.map.getSource(DIST_MEASURE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData({ type: "FeatureCollection", features });
  }
}
