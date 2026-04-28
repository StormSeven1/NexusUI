/**
 * ══════════════════════════════════════════════════════════════════════
 *  TDOA 渲染模块 —— 扇区 + 扫描亮带 + 中心图标 + 名称
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── TDOA 渲染全链路 ──
 *
 *   1. 接收: WS entity_status → msg.entities[] → mapEntitiesPayload() → mapOneEntityRow()
 *      ├─ specificType="TDOA" → asset_type="tdoa"
 *      └─ 静态配置: app-config.json tdoa.devices[] → tdoaBundleToStaticAssets()
 *
 *   2. 入资产:
 *      ├─ 静态: tdoaBundleToStaticAssets() → configAssetBase（含 scan 参数）
 *      ├─ 动态: applyAssetListFromWs() → mergeDynamicAndStaticAssets() → asset-store
 *      └─ 专题层: adaptAssetToTdoaDevice() → TdoaMaplibre.upsert()
 *          `activationEnabled` 由根/设备 activation 与处置 activate* 写入；WS 只带站址时经 merge 保留专题态
 *
 *   3. 渲染: TdoaMaplibre.flush() → 遍历 devices 生成 GeoJSON
 *      ├─ 扇区填充 (t="sec"): 基础扇区多边形
 *      ├─ 扫描亮带 (t="scan"): geoSectorRingCoords 环形，按 tickMs 动画移动
 *      ├─ 扇区边线 (t="ln"): 扇区外轮廓线
 *      ├─ 中心图标 (t="ctr"): TDOA SVG 图标，敌我配色
 *      └─ 名称标签 (t="lbl"): TDOA 名称
 *
 *   4. 扫描动画: activationEnabled=true 时
 *      ├─ syncScanTimer() → setInterval(tickMs) 定时调用 flush()
 *      └─ flush() 中按 Date.now() % scan.cycleMs 计算扫描进度
 *
 *   5. 更新: entity_status 周期推送 → adaptAssetToTdoaDevice() → upsert()
 *      └─ upsert 仅合并 WS 未带的可选展示字段（如 color），不根据 prev 推断 scan 开关
 *
 *   6. 超时: 无独立超时机制
 */
import type maplibregl from "maplibre-gl";
import { FORCE_COLORS, type ForceDisposition } from "@/lib/theme-colors";
import type { AssetDispositionIconAccent } from "@/lib/map-icons";
import {
  assetMapLabelTextColor,
  geoSectorCoords,
  geoSectorRingCoords,
  getAssetSymbolId,
  MAPLIBRE_ASSET_CENTER_ICON_SIZE,
} from "@/lib/map-icons";
import type { LaserLabelStyle, LaserSectorBorderStyle } from "@/components/map/modules/laser-maplibre";

const P = "nexus-tdoa";

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

/** 扇区扫描亮带动画参数（与是否「激活」无关；激活由 `activationEnabled` 控制） */
export type TdoaScanParams = {
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
  /** true：绘制扇区/亮带/边线/中心/标签并跑扫描动画；false：该设备专题要素不渲染 */
  activationEnabled: boolean;
  color?: string;
  fillOpacity?: number;
  virtual?: boolean;
  disposition?: ForceDisposition;
  /** 友方图标着色（来自 assetFriendlyColor） */
  friendlyMapColor?: string;
  /** 友方名称字色（来自 label.fontColor） */
  labelFontColor?: string;
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
  private _sectorFillDefaultColor = "#fb923c";
  private _sectorFillDefaultOpacity = 0.30;
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

  /** 根配置 `sectorFillDefaultColor` / `sectorFillDefaultOpacity` */
  setDefaults(color: string, opacity: number) {
    this._sectorFillDefaultColor = color;
    this._sectorFillDefaultOpacity = opacity;
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
            "icon-image": ["get", "symbolId"],
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

  getDevice(id: string): TdoaDevice | undefined {
    return this.devices.get(id);
  }

  getDeviceIds(): string[] {
    return [...this.devices.keys()];
  }

  upsert(d: TdoaDevice) {
    const prev = this.devices.get(d.id);
    /* WS 常不带 color/fillOpacity：仅补全可选展示字段，与 scan 激活态无关 */
    if (prev) {
      if (d.color == null && prev.color != null) d = { ...d, color: prev.color };
      if (d.fillOpacity == null && prev.fillOpacity != null) d = { ...d, fillOpacity: prev.fillOpacity };
    }
    this.devices.set(d.id, d);
    this.flush();
    this.syncScanTimer();
  }

  /**
   * 批量更新设备：同一批次仅 flush/sync 一次，降低高频更新抖动。
   */
  upsertMany(devices: TdoaDevice[]) {
    if (!devices.length) return;
    for (let i = 0; i < devices.length; i += 1) {
      let d = devices[i]!;
      const prev = this.devices.get(d.id);
      if (prev) {
        if (d.color == null && prev.color != null) d = { ...d, color: prev.color };
        if (d.fillOpacity == null && prev.fillOpacity != null) d = { ...d, fillOpacity: prev.fillOpacity };
      }
      this.devices.set(d.id, d);
    }
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
      if (d.activationEnabled && Number.isFinite(d.scan.tickMs)) t = Math.min(t, Math.max(16, d.scan.tickMs));
    }
    return t;
  }

  private wantScan(): boolean {
    if (!this.layerVis.scanFillVisible) return false;
    for (const d of this.devices.values()) {
      if (d.activationEnabled && d.openingDeg > 0.1) return true;
    }
    return false;
  }

  private syncScanTimer() {
    this.stopScanTimer();
    if (!this.wantScan()) {
      this.flush();
      return;
    }
    const tick = this.minScanTickMs();
    this.scanTimer = setInterval(() => this.flush(), tick);
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
      const disp = d.disposition ?? "friendly";
      /* 友方用配置色（d.color / 根级 sectorFillDefault*），敌方/中立强制 FORCE_COLORS */
      const c = disp === "hostile" ? FORCE_COLORS.hostile
        : disp === "neutral" ? FORCE_COLORS.neutral
        : (d.color ?? this._sectorFillDefaultColor);
      const baseOp = d.fillOpacity ?? this._sectorFillDefaultOpacity;

      if (d.activationEnabled) {
        const ring = geoSectorCoords(d.lng, d.lat, d.rangeKm, d.headingDeg, d.openingDeg);
        if (this.layerVis.fillVisible && d.openingDeg > 0.1) {
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
        }

        if (this.layerVis.scanFillVisible && d.openingDeg > 0.1) {
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

        if (d.openingDeg > 0.1 && this._border.emit && this.layerVis.lineVisible) {
          const lineRing = ring[0] === ring[ring.length - 1] ? ring.slice(0, -1) : ring;
          const lc = this._border.lineColorFixed ?? c;
          feats.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: [...lineRing, lineRing[0]!] },
            properties: { t: "ln", id: d.id, c, lc, lw: this._border.lineWidth },
          });
        }
      }
      if (d.centerIconVisible !== false) {
        const fmc = disp === "friendly" ? d.friendlyMapColor : undefined;
        feats.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [d.lng, d.lat] },
          properties: {
            t: "ctr",
            id: d.id,
            c,
            disp,
            symbolId: getAssetSymbolId("tdoa", "online", !!d.virtual, disp, fmc),
          },
        });
      }
      if (d.name && d.centerNameVisible !== false) {
        const tc =
          disp === "hostile" || disp === "neutral"
            ? assetMapLabelTextColor(disp, "online", this._assetIconAccent)
            : assetMapLabelTextColor(disp, "online", this._assetIconAccent, d.labelFontColor ?? this._label.textColor);
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
