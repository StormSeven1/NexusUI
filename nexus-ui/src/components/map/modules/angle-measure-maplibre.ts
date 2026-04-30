import type maplibregl from "maplibre-gl";
import { bearingDeg, destinationByBearingMeters, haversineMeters } from "@/components/map/modules/map-geo-math";
import { geoCircleCoords } from "@/lib/map-icons";

const P = "anglemeasure";
export const ANGLE_SOURCE = `${P}-source`;
export const ANGLE_ORIGIN = `${P}-origin`;
export const ANGLE_MEASURE_LINE = `${P}-measure-line`;
export const ANGLE_NORTH_LINE = `${P}-north-line`;
export const ANGLE_ARC = `${P}-arc`;
export const ANGLE_ANGLE_LABEL = `${P}-angle-lbl`;
export const ANGLE_CIRCLE_LINE = `${P}-circle-line`;
export const ANGLE_DIST_LABEL = `${P}-dist-lbl`;

export const ANGLE_LAYER_IDS = [
  ANGLE_ORIGIN,
  ANGLE_MEASURE_LINE,
  ANGLE_NORTH_LINE,
  ANGLE_ARC,
  ANGLE_ANGLE_LABEL,
  ANGLE_CIRCLE_LINE,
  ANGLE_DIST_LABEL,
] as const;

/**
 * 显隐与颜色（对齐 V2 `AngleMeasureManager.visibility`）：
 * - `originPointVisible` / `measureLineVisible` / `northLineVisible` / `arcVisible` / `angleLabelVisible` / `circleVisible` / `distanceLabelVisible`
 * - 对应图层 `layout.visibility`；颜色字段写 paint。
 */

export type AngleMeasureVisibility = {
  originPointVisible: boolean;
  measureLineVisible: boolean;
  northLineVisible: boolean;
  arcVisible: boolean;
  angleLabelVisible: boolean;
  circleVisible: boolean;
  distanceLabelVisible: boolean;
  originColor: string;
  measureLineColor: string;
  northLineColor: string;
  arcColor: string;
  angleLabelColor: string;
  circleColor: string;
};

const def: AngleMeasureVisibility = {
  originPointVisible: true,
  measureLineVisible: true,
  northLineVisible: true,
  arcVisible: true,
  angleLabelVisible: true,
  circleVisible: true,
  distanceLabelVisible: true,
  originColor: "#00bfff",
  measureLineColor: "#00bfff",
  northLineColor: "#ef4444",
  arcColor: "#f97316",
  angleLabelColor: "#fbbf24",
  circleColor: "#22d3ee",
};

/**
 * 角度与距离量算（对齐 V2 `AngleMeasureManager`）：
 * - **方位角**：从原点指向鼠标点，相对**正北顺时针** 0°–360°（`bearingDeg`）。
 * - **操作**：奇数次左键设原点并进入测量；鼠标移动时实时更新距离圆、正北参考线、测量线、
 *   0°→方位角的弧、角度与距离标签；再点左键结束本次测量；右键清空。
 */

export class AngleMeasureMaplibre {
  private map: maplibregl.Map;
  private vis: AngleMeasureVisibility = { ...def };
  private active = false;
  private origin: [number, number] | null = null;
  private current: [number, number] | null = null;
  private isMeasuring = false;
  private clickCount = 0;
  private handlers: Array<{ ev: keyof maplibregl.MapEventType; fn: (e: maplibregl.MapMouseEvent) => void }> = [];

  constructor(map: maplibregl.Map) {
    this.map = map;
  }

  init(beforeId?: string) {
    const m = this.map;
    if (!m.getSource(ANGLE_SOURCE)) {
      m.addSource(ANGLE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    const circleLayer = (id: string, filterType: string, paint: maplibregl.CircleLayerSpecification["paint"]) => {
      if (!m.getLayer(id)) {
        m.addLayer({ id, type: "circle", source: ANGLE_SOURCE, filter: ["==", ["get", "t"], filterType], paint }, beforeId);
      }
    };
    const lineLayer = (id: string, filterType: string, paint: maplibregl.LineLayerSpecification["paint"], dash?: number[]) => {
      if (!m.getLayer(id)) {
        m.addLayer(
          {
            id,
            type: "line",
            source: ANGLE_SOURCE,
            filter: ["==", ["get", "t"], filterType],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: dash ? { ...paint, "line-dasharray": dash } : paint,
          },
          beforeId
        );
      }
    };
    const symLayer = (id: string, filterType: string, field: string) => {
      if (!m.getLayer(id)) {
        m.addLayer(
          {
            id,
            type: "symbol",
            source: ANGLE_SOURCE,
            filter: ["==", ["get", "t"], filterType],
            layout: {
              "text-field": ["get", field],
              "text-font": ["Open Sans Regular"],
              "text-size": 13,
              "text-offset": [0, -1.4],
              "text-anchor": "center",
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            },
            paint: { "text-halo-color": "#000", "text-halo-width": 1.2 },
          },
          beforeId
        );
      }
    };

    circleLayer(ANGLE_ORIGIN, "origin", {
      "circle-radius": 6,
      "circle-color": this.vis.originColor,
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 2,
    });
    lineLayer(ANGLE_MEASURE_LINE, "measure-line", { "line-color": this.vis.measureLineColor, "line-width": 2 });
    lineLayer(ANGLE_NORTH_LINE, "north-line", { "line-color": this.vis.northLineColor, "line-width": 2, "line-opacity": 0.85 }, [4, 2]);
    lineLayer(ANGLE_ARC, "arc", { "line-color": this.vis.arcColor, "line-width": 2, "line-opacity": 0.9 });
    lineLayer(ANGLE_CIRCLE_LINE, "circle", { "line-color": this.vis.circleColor, "line-width": 2, "line-opacity": 0.75 });
    symLayer(ANGLE_ANGLE_LABEL, "angle-lbl", "txt");
    symLayer(ANGLE_DIST_LABEL, "dist-lbl", "txt");
    if (m.getLayer(ANGLE_ANGLE_LABEL)) {
      m.setPaintProperty(ANGLE_ANGLE_LABEL, "text-color", this.vis.angleLabelColor);
    }
    if (m.getLayer(ANGLE_DIST_LABEL)) {
      m.setPaintProperty(ANGLE_DIST_LABEL, "text-color", this.vis.circleColor);
    }
    this.applyLayerLayoutVisibility();
  }

  destroy() {
    this.deactivate();
    const m = this.map;
    for (const id of [...ANGLE_LAYER_IDS].reverse()) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(ANGLE_SOURCE)) m.removeSource(ANGLE_SOURCE);
  }

  setVisibility(partial: Partial<AngleMeasureVisibility>) {
    this.vis = { ...this.vis, ...partial };
    const m = this.map;
    try {
      if (m.getLayer(ANGLE_ORIGIN)) m.setPaintProperty(ANGLE_ORIGIN, "circle-color", this.vis.originColor);
      if (m.getLayer(ANGLE_MEASURE_LINE)) m.setPaintProperty(ANGLE_MEASURE_LINE, "line-color", this.vis.measureLineColor);
      if (m.getLayer(ANGLE_NORTH_LINE)) m.setPaintProperty(ANGLE_NORTH_LINE, "line-color", this.vis.northLineColor);
      if (m.getLayer(ANGLE_ARC)) m.setPaintProperty(ANGLE_ARC, "line-color", this.vis.arcColor);
      if (m.getLayer(ANGLE_CIRCLE_LINE)) m.setPaintProperty(ANGLE_CIRCLE_LINE, "line-color", this.vis.circleColor);
      if (m.getLayer(ANGLE_ANGLE_LABEL)) m.setPaintProperty(ANGLE_ANGLE_LABEL, "text-color", this.vis.angleLabelColor);
      if (m.getLayer(ANGLE_DIST_LABEL)) m.setPaintProperty(ANGLE_DIST_LABEL, "text-color", this.vis.circleColor);
    } catch {
      /* ignore */
    }
    this.applyLayerLayoutVisibility();
    this.flush();
  }

  private applyLayerLayoutVisibility() {
    const m = this.map;
    const setVis = (id: string, show: boolean) => {
      if (!m.getLayer(id)) return;
      m.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    };
    setVis(ANGLE_ORIGIN, this.vis.originPointVisible);
    setVis(ANGLE_MEASURE_LINE, this.vis.measureLineVisible);
    setVis(ANGLE_NORTH_LINE, this.vis.northLineVisible);
    setVis(ANGLE_ARC, this.vis.arcVisible);
    setVis(ANGLE_ANGLE_LABEL, this.vis.angleLabelVisible);
    setVis(ANGLE_CIRCLE_LINE, this.vis.circleVisible);
    setVis(ANGLE_DIST_LABEL, this.vis.distanceLabelVisible);
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.origin = null;
    this.current = null;
    this.isMeasuring = false;
    this.clickCount = 0;
    this.map.getCanvas().style.cursor = "crosshair";
    this.map.doubleClickZoom?.disable();

    const click = (e: maplibregl.MapMouseEvent) => {
      if (e.originalEvent.button !== 0) return;
      e.preventDefault();
      this.clickCount += 1;
      if (this.clickCount % 2 === 1) {
        this.origin = [e.lngLat.lng, e.lngLat.lat];
        this.current = null;
        this.isMeasuring = true;
        this.flush();
      } else {
        this.current = [e.lngLat.lng, e.lngLat.lat];
        this.isMeasuring = false;
        this.flush();
      }
    };
    const move = (e: maplibregl.MapMouseEvent) => {
      if (!this.origin || !this.isMeasuring) return;
      this.current = [e.lngLat.lng, e.lngLat.lat];
      this.flush();
    };
    const ctx = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      this.origin = null;
      this.current = null;
      this.clickCount = 0;
      this.isMeasuring = false;
      this.flush();
    };
    this.map.on("click", click);
    this.map.on("mousemove", move);
    this.map.on("contextmenu", ctx);
    this.handlers.push({ ev: "click", fn: click }, { ev: "mousemove", fn: move }, { ev: "contextmenu", fn: ctx });
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    for (const { ev, fn } of this.handlers) this.map.off(ev, fn);
    this.handlers = [];
    this.map.getCanvas().style.cursor = "";
    this.map.doubleClickZoom?.disable();
    this.origin = null;
    this.current = null;
    this.isMeasuring = false;
    this.clickCount = 0;
    this.flush();
  }

  clear() {
    this.origin = null;
    this.current = null;
    this.isMeasuring = false;
    this.clickCount = 0;
    this.flush();
  }

  private flush() {
    const feats: GeoJSON.Feature[] = [];
    const O = this.origin;
    const P = this.current;

    if (O && this.vis.originPointVisible) {
      feats.push({ type: "Feature", geometry: { type: "Point", coordinates: O }, properties: { t: "origin" } });
    }
    if (O && P) {
      const distM = haversineMeters(O, P);
      const azimuth = bearingDeg(O, P);

      if (this.vis.circleVisible && distM > 0) {
        const ring = geoCircleCoords(O[0], O[1], distM / 1000);
        feats.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: ring },
          properties: { t: "circle" },
        });
      }

      if (this.vis.northLineVisible && distM > 0) {
        const northPt = destinationByBearingMeters(O, 0, distM);
        feats.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [O, northPt] },
          properties: { t: "north-line" },
        });
      }

      if (this.vis.measureLineVisible) {
        feats.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [O, P] },
          properties: { t: "measure-line" },
        });
      }

      const arcRadiusM = Math.min(distM * 0.3, distM);
      const steps = Math.max(12, Math.min(48, Math.floor(azimuth / 2)));
      if (this.vis.arcVisible && distM > 0 && azimuth > 0) {
        const arcCoords = arcFromNorth(O, azimuth, arcRadiusM, steps);
        if (arcCoords.length >= 2) {
          feats.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: arcCoords },
            properties: { t: "arc" },
          });
        }
      }

      if (this.vis.angleLabelVisible && distM > 0) {
        const labelDist = Math.min(arcRadiusM * 1.2, distM * 0.9);
        const labelPt = destinationByBearingMeters(O, azimuth / 2, labelDist);
        feats.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: labelPt },
          properties: { t: "angle-lbl", txt: `${azimuth.toFixed(2)}\u00b0` },
        });
      }

      if (this.vis.distanceLabelVisible) {
        const mid: [number, number] = [(O[0] + P[0]) / 2, (O[1] + P[1]) / 2];
        const distText =
          distM < 1000 ? `${distM.toFixed(1)} m` : `${(distM / 1000).toFixed(2)} km`;
        const bearText = `${azimuth.toFixed(1)}\u00b0`;
        feats.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: mid },
          properties: { t: "dist-lbl", txt: `${distText}\n方位 ${bearText}` },
        });
      }
    }

    const src = this.map.getSource(ANGLE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData({ type: "FeatureCollection", features: feats });
  }
}

function arcFromNorth(
  origin: [number, number],
  angleDeg: number,
  radiusM: number,
  steps: number
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const b = angleDeg * t;
    out.push(destinationByBearingMeters(origin, b, radiusM));
  }
  return out;
}
