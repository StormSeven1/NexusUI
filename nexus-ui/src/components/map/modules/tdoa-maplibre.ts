import type maplibregl from "maplibre-gl";
import type { ForceDisposition } from "@/lib/theme-colors";
import type { AssetDispositionIconAccent } from "@/lib/map-icons";
import {
  assetMapLabelTextColor,
  geoSectorCoords,
  geoSectorRingCoords,
  MAPLIBRE_ASSET_CENTER_ICON_SIZE,
  sectorCenterMapImageId,
} from "@/lib/map-icons";
import type { LaserLabelStyle, LaserSectorBorderStyle } from "@/components/map/modules/laser-maplibre";

const P = "nexus-tdoa";

export function tdoaCenterMapImageId(disposition: ForceDisposition): string {
  return sectorCenterMapImageId("tdoa", disposition);
}

export const TDOA_CENTER_ICON_IMAGE_EXPR: [
  "match",
  ["get", string],
  string,
  string,
  string,
  string,
  string,
] = [
  "match",
  ["get", "disp"],
  "hostile",
  tdoaCenterMapImageId("hostile"),
  "neutral",
  tdoaCenterMapImageId("neutral"),
  tdoaCenterMapImageId("friendly"),
];

export const TDOA_SOURCE = `${P}-src`;
export const TDOA_FILL = `${P}-fill`;
export const TDOA_SCAN = `${P}-scan`;
export const TDOA_LINE = `${P}-line`;
export const TDOA_CENTER = `${P}-ctr`;
export const TDOA_LABEL = `${P}-lbl`;

export const TDOA_LAYER_IDS = [
  TDOA_FILL,
  TDOA_SCAN,
  TDOA_LINE,
  TDOA_CENTER,
  TDOA_LABEL,
] as const;

export type TdoaMaplibreLayerVisibility = {
  fillVisible: boolean;
  scanFillVisible: boolean;
  lineVisible: boolean;
  centerVisible: boolean;
  labelVisible: boolean;
};

const tdoaLayerVisDefault: TdoaMaplibreLayerVisibility = {
  fillVisible: true,
  scanFillVisible: true,
  lineVisible: true,
  centerVisible: true,
  labelVisible: true,
};

/** V2 `TdoaManager`：径向扫描亮带；默认 tick 100ms、带宽 12m、周期 2000ms 9 条带 */
export type TdoaScanParams = {
  enabled: boolean;
  cycleMs: number;
  tickMs: number;
  bandCount: number;
  bandWidthMeters: number;
};

export type TdoaDevice = {
  id: string;
  lng: number;
  lat: number;
  rangeKm: number;
  headingDeg: number;
  openingDeg: number;
  color?: string;
  fillOpacity?: number;
  virtual?: boolean;
  disposition?: ForceDisposition;
  centerNameVisible?: boolean;
  centerIconVisible?: boolean;
  name?: string;
  scan: TdoaScanParams;
};

export class TdoaMaplibre {
  private map: maplibregl.Map;
  private devices = new Map<string, TdoaDevice>();
  private layerVis: TdoaMaplibreLayerVisibility = { ...tdoaLayerVisDefault };
  private _assetIconAccent: AssetDispositionIconAccent | null = null;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private _border: LaserSectorBorderStyle = {
    emit: false,
    lineWidth: 0,
    lineColorFixed: null,
    lineDash: [],
  };
  private _label: LaserLabelStyle = {
    textColor: "#fdba74",
    haloColor: "#000000",
    haloWidth: 1,
    fontSize: 11,
    textOffset: [0, 1.2],
    textFont: ["Open Sans Regular"],
  };

  constructor(map: maplibregl.Map) {
    this.map = map;
  }

  setSectorBorder(style: LaserSectorBorderStyle) {
    this._border = { ...style };
    this.applyLineLayerPaint();
    this.applyLayerLayoutVisibility();
    this.flush();
  }

  setLabelStyle(style: LaserLabelStyle) {
    this._label = { ...style };
    this.applyLabelLayerPaint();
    this.flush();
  }

  setAssetDispositionAccent(accent: AssetDispositionIconAccent | null) {
    this._assetIconAccent = accent;
    this.flush();
  }

  private applyLineLayerPaint() {
    const m = this.map;
    if (!m.getLayer(TDOA_LINE)) return;
    const dash = this._border.lineDash;
    if (dash.length >= 2) {
      m.setPaintProperty(TDOA_LINE, "line-dasharray", dash as [number, number]);
    } else {
      const rm = (m as maplibregl.Map & { removePaintProperty?: (id: string, prop: string) => void }).removePaintProperty;
      if (typeof rm === "function") {
        try {
          rm.call(m, TDOA_LINE, "line-dasharray");
        } catch {
          /* ignore */
        }
      }
    }
  }

  private applyLabelLayerPaint() {
    const m = this.map;
    if (!m.getLayer(TDOA_LABEL)) return;
    const L = this._label;
    try {
      m.setPaintProperty(TDOA_LABEL, "text-halo-color", L.haloColor);
      m.setPaintProperty(TDOA_LABEL, "text-halo-width", L.haloWidth);
      m.setLayoutProperty(TDOA_LABEL, "text-size", L.fontSize);
      m.setLayoutProperty(TDOA_LABEL, "text-anchor", "top");
      m.setLayoutProperty(TDOA_LABEL, "text-offset", L.textOffset);
      m.setLayoutProperty(TDOA_LABEL, "text-font", L.textFont);
    } catch {
      /* ignore */
    }
  }

  init(beforeId?: string) {
    const m = this.map;
    if (!m.getSource(TDOA_SOURCE)) {
      m.addSource(TDOA_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    if (!m.getLayer(TDOA_FILL)) {
      m.addLayer(
        {
          id: TDOA_FILL,
          type: "fill",
          source: TDOA_SOURCE,
          filter: ["==", ["get", "t"], "sec"],
          paint: {
            "fill-color": ["get", "c"],
            "fill-opacity": ["get", "o"],
          },
        },
        beforeId
      );
    }
    if (!m.getLayer(TDOA_SCAN)) {
      m.addLayer(
        {
          id: TDOA_SCAN,
          type: "fill",
          source: TDOA_SOURCE,
          filter: ["==", ["get", "t"], "scan"],
          paint: {
            "fill-color": ["get", "c"],
            "fill-opacity": ["get", "o"],
          },
        },
        beforeId
      );
    }
    if (!m.getLayer(TDOA_LINE)) {
      m.addLayer(
        {
          id: TDOA_LINE,
          type: "line",
          source: TDOA_SOURCE,
          filter: ["==", ["get", "t"], "ln"],
          layout: { "line-join": "round" },
          paint: {
            "line-color": ["get", "lc"],
            "line-width": ["get", "lw"],
          },
        },
        beforeId
      );
    }
    if (!m.getLayer(TDOA_CENTER)) {
      m.addLayer(
        {
          id: TDOA_CENTER,
          type: "symbol",
          source: TDOA_SOURCE,
          filter: ["==", ["get", "t"], "ctr"],
          layout: {
            "icon-image": TDOA_CENTER_ICON_IMAGE_EXPR,
            "icon-size": MAPLIBRE_ASSET_CENTER_ICON_SIZE,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-rotation-alignment": "viewport",
            "icon-pitch-alignment": "viewport",
          },
          paint: { "icon-opacity": 0.95 },
        },
        beforeId
      );
    }
    if (!m.getLayer(TDOA_LABEL)) {
      const L = this._label;
      m.addLayer(
        {
          id: TDOA_LABEL,
          type: "symbol",
          source: TDOA_SOURCE,
          filter: ["==", ["get", "t"], "lbl"],
          layout: {
            "text-field": ["get", "nm"],
            "text-font": L.textFont,
            "text-size": L.fontSize,
            "text-anchor": "top",
            "text-offset": L.textOffset,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-max-width": 12,
          },
          paint: {
            "text-color": ["coalesce", ["get", "tc"], L.textColor],
            "text-halo-color": L.haloColor,
            "text-halo-width": L.haloWidth,
          },
        },
        beforeId
      );
    }
    this.applyLineLayerPaint();
    this.applyLabelLayerPaint();
    this.applyLayerLayoutVisibility();
    this.flush();
    this.syncScanTimer();
  }

  setLayerVisibility(partial: Partial<TdoaMaplibreLayerVisibility>) {
    this.layerVis = { ...this.layerVis, ...partial };
    this.applyLayerLayoutVisibility();
    this.syncScanTimer();
  }

  private applyLayerLayoutVisibility() {
    const m = this.map;
    const setVis = (id: string, show: boolean) => {
      if (!m.getLayer(id)) return;
      m.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    };
    setVis(TDOA_FILL, this.layerVis.fillVisible);
    setVis(TDOA_SCAN, this.layerVis.scanFillVisible);
    setVis(TDOA_LINE, this.layerVis.lineVisible && this._border.emit);
    setVis(TDOA_CENTER, this.layerVis.centerVisible);
    setVis(TDOA_LABEL, this.layerVis.labelVisible);
  }

  destroy() {
    this.stopScanTimer();
    const m = this.map;
    for (const id of [TDOA_LABEL, TDOA_CENTER, TDOA_LINE, TDOA_SCAN, TDOA_FILL]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(TDOA_SOURCE)) m.removeSource(TDOA_SOURCE);
    this.devices.clear();
  }

  upsert(d: TdoaDevice) {
    this.devices.set(d.id, d);
    this.flush();
    this.syncScanTimer();
  }

  remove(id: string) {
    this.devices.delete(id);
    this.flush();
    this.syncScanTimer();
  }

  clear() {
    this.devices.clear();
    this.flush();
    this.syncScanTimer();
  }

  getAll(): TdoaDevice[] {
    return [...this.devices.values()];
  }

  private minScanTickMs(): number {
    let t = 100;
    for (const d of this.devices.values()) {
      if (d.scan.enabled && Number.isFinite(d.scan.tickMs)) t = Math.min(t, Math.max(16, d.scan.tickMs));
    }
    return t;
  }

  private wantScan(): boolean {
    if (!this.layerVis.scanFillVisible) return false;
    for (const d of this.devices.values()) {
      if (d.scan.enabled && d.openingDeg > 0.1) return true;
    }
    return false;
  }

  private syncScanTimer() {
    this.stopScanTimer();
    if (!this.wantScan()) {
      this.flush();
      return;
    }
    this.scanTimer = setInterval(() => this.flush(), this.minScanTickMs());
  }

  private stopScanTimer() {
    if (this.scanTimer != null) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  private flush() {
    const feats: GeoJSON.Feature[] = [];
    for (const d of this.devices.values()) {
      const c = d.color ?? "#fb923c";
      const baseOp = d.fillOpacity ?? 0.3;
      const ring = geoSectorCoords(d.lng, d.lat, d.rangeKm, d.headingDeg, d.openingDeg);
      feats.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          t: "sec",
          id: d.id,
          c,
          o: Math.max(0.08, baseOp * 0.65),
        },
      });

      if (d.scan.enabled && this.layerVis.scanFillVisible && d.openingDeg > 0.1) {
        const maxRangeM = d.rangeKm * 1000;
        const progress = (Date.now() % d.scan.cycleMs) / d.scan.cycleMs;
        const n = Math.max(1, Math.floor(d.scan.bandCount));
        for (let i = 0; i < n; i++) {
          const p = (progress + i / n) % 1;
          const outerM = maxRangeM * p;
          const innerM = Math.max(0, outerM - d.scan.bandWidthMeters);
          if (outerM <= 0) continue;
          const ringCoords = geoSectorRingCoords(
            d.lng,
            d.lat,
            innerM / 1000,
            Math.min(maxRangeM, outerM) / 1000,
            d.headingDeg,
            d.openingDeg,
            Math.max(12, Math.floor(d.openingDeg / 4)),
          );
          if (ringCoords.length < 4) continue;
          feats.push({
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [ringCoords] },
            properties: {
              t: "scan",
              id: d.id,
              c: "#FFFFFF",
              o: Math.max(0.12, baseOp * 0.9),
            },
          });
        }
      }

      if (this._border.emit && this.layerVis.lineVisible) {
        const lineRing = ring[0] === ring[ring.length - 1] ? ring.slice(0, -1) : ring;
        const lc = this._border.lineColorFixed ?? c;
        feats.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [...lineRing, lineRing[0]!] },
          properties: { t: "ln", id: d.id, c, lc, lw: this._border.lineWidth },
        });
      }
      if (d.centerIconVisible !== false) {
        feats.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [d.lng, d.lat] },
          properties: { t: "ctr", id: d.id, c, disp: d.disposition ?? "friendly" },
        });
      }
      if (d.name && d.centerNameVisible !== false) {
        const disp = d.disposition ?? "friendly";
        const tc =
          disp === "hostile" || disp === "neutral"
            ? assetMapLabelTextColor(disp, "online", this._assetIconAccent)
            : this._label.textColor;
        feats.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [d.lng, d.lat] },
          properties: { t: "lbl", id: d.id, nm: d.name, tc },
        });
      }
    }
    const src = this.map.getSource(TDOA_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData({ type: "FeatureCollection", features: feats });
    if (this.map.triggerRepaint) this.map.triggerRepaint();
  }
}
