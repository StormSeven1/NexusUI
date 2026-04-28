/**
 * ══════════════════════════════════════════════════════════════════════
 *  激光武器渲染模块 —— 扇区 + 扫描亮带 + 脉冲动画 + 中心图标 + 名称
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 激光渲染全链路 ──
 *
 *   1. 接收: WS entity_status → msg.entities[] → mapEntitiesPayload() → mapOneEntityRow()
 *      ├─ specificType="LASER"/"激光"/"激光武器" → asset_type="laser"
 *      └─ 静态配置: app-config.json laserWeapons.devices[] → laserBundleToStaticAssets()
 *
 *   2. 入资产:
 *      ├─ 静态: laserBundleToStaticAssets() → configAssetBase（含 scan/pulse 参数）
 *      ├─ 动态: applyAssetListFromWs() → mergeDynamicAndStaticAssets() → asset-store
 *      └─ 专题层: adaptAssetToLaserDevice() → LaserMaplibre.upsert()
 *          scan/脉冲是否开启由处置激活或配置写入；WS 只带站址时应在 Map2D 合并层写好再 upsert
 *
 *   3. 渲染: LaserMaplibre.flush() → 遍历 devices 生成 GeoJSON
 *      ├─ 扇区填充 (t="sec"): 基础扇区多边形，脉冲暗相时不画
 *      ├─ 扫描亮带 (t="scan"): geoSectorRingCoords 环形，按 tickMs 动画移动
 *      ├─ 扇区边线 (t="ln"): 扇区外轮廓线
 *      ├─ 中心图标 (t="ctr"): 激光 SVG 图标，敌我配色
 *      └─ 名称标签 (t="lbl"): 雷达/激光名称
 *
 *   4. 脉冲动画: activationEnabled=true 时
 *      ├─ ensureLaserPulse() → setTimeout 循环切换 pulseVisibleById
 *      ├─ 亮相 (pulseOnMs，默认 10000ms): 扇区填充 + 扫描亮带均可见
 *      ├─ 暗相 (pulseOffMs，默认 3000ms): 扇区填充不画，扫描亮带不画
 *      └─ WS 更新不改变激活态；脉动参数随处置/配置写入的 LaserDevice 为准
 *
 *   5. 扫描动画: activationEnabled=true 时
 *      ├─ syncScanTimer() → setInterval(tickMs) 定时调用 flush()
 *      ├─ flush() 中按 Date.now() % scan.cycleMs 计算扫描进度
 *      └─ 生成 bandCount 个环形亮带，从内向外移动
 *
 *   6. 更新: entity_status 周期推送 → adaptAssetToLaserDevice() → upsert()
 *      └─ upsert 仅合并 WS 未带的可选展示字段（如 color），不根据 prev 推断 scan/脉冲
 *
 *   7. 超时: 无独立超时机制
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

const P = "nexus-laser";

/** V2 LaserSectorOverlayTool：默认脉冲高亮「亮相」时长（ms） */
const DEFAULT_LASER_PULSE_ON_MS = 10_000;
/** V2：默认 scan 扇区暗相间隔（ms） */
const DEFAULT_LASER_PULSE_OFF_MS = 3000;

export const LASER_SOURCE = `${P}-src`;
export const LASER_FILL = `${P}-fill`;
export const LASER_SCAN = `${P}-scan`;
export const LASER_LINE = `${P}-line`;
export const LASER_CENTER = `${P}-center`;
export const LASER_LABEL = `${P}-label`;

export const LASER_LAYER_IDS = [
  LASER_FILL,
  LASER_SCAN,
  LASER_LINE,
  LASER_CENTER,
  LASER_LABEL,
] as const;

export type LaserMaplibreLayerVisibility = {
  fillVisible: boolean;
  scanFillVisible: boolean;
  lineVisible: boolean;
  centerVisible: boolean;
  labelVisible: boolean;
};

const laserLayerVisDefault: LaserMaplibreLayerVisibility = {
  fillVisible: true,
  scanFillVisible: true,
  lineVisible: true,
  centerVisible: true,
  labelVisible: true,
};

/**
 * 扇区扫描亮带动画参数（**bandCount** / **bandWidthMeters** / **cycleMs** / **tickMs**）。
 * 是否绘制扇区由设备上 **`activationEnabled`**（与 app-config 中 devices[].activationEnabled 同源语义）控制。
 */
export type LaserScanParams = {
  cycleMs: number;
  tickMs: number;
  bandCount: number;
  bandWidthMeters: number;
};

export type LaserDevice = {
  id: string;
  lng: number;
  lat: number;
  rangeKm: number;
  headingDeg: number;
  openingDeg: number;
  /** true：绘制扇区/亮带/边线/中心/标签；false：该设备专题要素不渲染 */
  activationEnabled: boolean;
  color?: string;
  fillOpacity?: number;
  virtual?: boolean;
  /** 敌我属性，对应 `laserWeapons.devices[].disposition` */
  disposition?: ForceDisposition;
  /** 友方图标着色（来自 assetFriendlyColor） */
  friendlyMapColor?: string;
  /** 友方名称字色（来自 label.fontColor） */
  labelFontColor?: string;
  /** 中心名称 symbol；默认随 `centerNameVisible` 为 true */
  centerNameVisible?: boolean;
  /** 中心图标 symbol；默认随 `centerIconVisible` 与配置一致 */
  centerIconVisible?: boolean;
  name?: string;
  scan: LaserScanParams;
  /** 亮相时长（ms），默认 10000；activationEnabled=true 时按 pulseOnMs / pulseOffMs 做亮相/暗相循环 */
  pulseOnMs?: number;
  /** 暗相时长（ms），默认 3000 */
  pulseOffMs?: number;
};

/** `laserSectorBorderFromBundle`：`emit === false` 时不画配置边线，用资产类型默认色 */
export type LaserSectorBorderStyle = {
  emit: boolean;
  lineWidth: number;
  /** `null` 表示不按固定色，走 `color` 表达式 */
  lineColorFixed: string | null;
  lineDash: number[];
};

/** `laserLabelStyleFromBundle` 解析结果 */
export type LaserLabelStyle = {
  textColor: string;
  haloColor: string;
  haloWidth: number;
  fontSize: number;
  textOffset: [number, number];
  textFont: string[];
};

export class LaserMaplibre {
  private map: maplibregl.Map;
  private devices = new Map<string, LaserDevice>();
  private layerVis: LaserMaplibreLayerVisibility = { ...laserLayerVisDefault };
  private _assetIconAccent: AssetDispositionIconAccent | null = null;
  private _sectorFillDefaultColor = "#fb7185";
  private _sectorFillDefaultOpacity = 0.35;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  /** 脉动时各设备 scan 几何是否处于「亮相」帧 */
  private pulseVisibleById = new Map<string, boolean>();
  private laserPulseTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private _border: LaserSectorBorderStyle = {
    emit: false,
    lineWidth: 0,
    lineColorFixed: null,
    lineDash: [],
  };
  private _label: LaserLabelStyle = {
    textColor: "#fda4af",
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

  /** 敌我标签强调色，与资产层 `factory.assetIcons` 一致 */
  setAssetDispositionAccent(accent: AssetDispositionIconAccent | null) {
    this._assetIconAccent = accent;
    this.flush();
  }

  /** 根配置 `sectorFillDefaultColor` / `sectorFillDefaultOpacity`：设备未指定 color/opacity 时用于扇区填充 */
  setDefaults(color: string, opacity: number) {
    this._sectorFillDefaultColor = color;
    this._sectorFillDefaultOpacity = opacity;
    this.flush();
  }

  private applyLineLayerPaint() {
    const m = this.map;
    if (!m.getLayer(LASER_LINE)) return;
    const dash = this._border.lineDash;
    if (dash.length >= 2) {
      m.setPaintProperty(LASER_LINE, "line-dasharray", dash as [number, number]);
    } else {
      const rm = (m as maplibregl.Map & { removePaintProperty?: (id: string, prop: string) => void }).removePaintProperty;
      if (typeof rm === "function") {
        try {
          rm.call(m, LASER_LINE, "line-dasharray");
        } catch {
          /* ignore */
        }
      }
    }
  }

  private applyLabelLayerPaint() {
    const m = this.map;
    if (!m.getLayer(LASER_LABEL)) return;
    const L = this._label;
    try {
      m.setPaintProperty(LASER_LABEL, "text-halo-color", L.haloColor);
      m.setPaintProperty(LASER_LABEL, "text-halo-width", L.haloWidth);
      m.setLayoutProperty(LASER_LABEL, "text-size", L.fontSize);
      m.setLayoutProperty(LASER_LABEL, "text-anchor", "top");
      m.setLayoutProperty(LASER_LABEL, "text-offset", L.textOffset);
      m.setLayoutProperty(LASER_LABEL, "text-font", L.textFont);
    } catch {
      /* ignore */
    }
  }

  init(beforeId?: string) {
    const m = this.map;
    if (!m.getSource(LASER_SOURCE)) {
      m.addSource(LASER_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    if (!m.getLayer(LASER_FILL)) {
      m.addLayer(
        {
          id: LASER_FILL,
          type: "fill",
          source: LASER_SOURCE,
          filter: ["==", ["get", "t"], "sec"],
          paint: {
            "fill-color": ["get", "c"],
            "fill-opacity": ["get", "o"],
          },
        },
        beforeId
      );
    }
    if (!m.getLayer(LASER_SCAN)) {
      m.addLayer(
        {
          id: LASER_SCAN,
          type: "fill",
          source: LASER_SOURCE,
          filter: ["==", ["get", "t"], "scan"],
          paint: {
            "fill-color": ["get", "c"],
            "fill-opacity": ["get", "o"],
          },
        },
        beforeId
      );
    }
    if (!m.getLayer(LASER_LINE)) {
      m.addLayer(
        {
          id: LASER_LINE,
          type: "line",
          source: LASER_SOURCE,
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
    if (!m.getLayer(LASER_CENTER)) {
      m.addLayer(
        {
          id: LASER_CENTER,
          type: "symbol",
          source: LASER_SOURCE,
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
    if (!m.getLayer(LASER_LABEL)) {
      const L = this._label;
      m.addLayer(
        {
          id: LASER_LABEL,
          type: "symbol",
          source: LASER_SOURCE,
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
  }

  setLayerVisibility(partial: Partial<LaserMaplibreLayerVisibility>) {
    this.layerVis = { ...this.layerVis, ...partial };
    this.applyLayerLayoutVisibility();
    this.flush();
  }

  private applyLayerLayoutVisibility() {
    const m = this.map;
    const setVis = (id: string, show: boolean) => {
      if (!m.getLayer(id)) return;
      m.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    };
    setVis(LASER_FILL, this.layerVis.fillVisible);
    setVis(LASER_SCAN, this.layerVis.scanFillVisible);
    setVis(LASER_LINE, this.layerVis.lineVisible && this._border.emit);
    setVis(LASER_CENTER, this.layerVis.centerVisible);
    setVis(LASER_LABEL, this.layerVis.labelVisible);
  }

  destroy() {
    this.stopScanTimer();
    for (const t of this.laserPulseTimeouts.values()) clearTimeout(t);
    this.laserPulseTimeouts.clear();
    this.pulseVisibleById.clear();
    const m = this.map;
    for (const id of [LASER_LABEL, LASER_CENTER, LASER_LINE, LASER_SCAN, LASER_FILL]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(LASER_SOURCE)) m.removeSource(LASER_SOURCE);
    this.devices.clear();
  }

  getDevice(id: string): LaserDevice | undefined {
    return this.devices.get(id);
  }

  getDeviceIds(): string[] {
    return [...this.devices.keys()];
  }

  upsert(d: LaserDevice) {
    const prev = this.devices.get(d.id);
    const wasPulse = prev?.activationEnabled === true;

    /* WS 常不带 color/fillOpacity：仅补全可选展示字段，与扇区激活态无关 */
    if (prev) {
      if (d.color == null && prev.color != null) d = { ...d, color: prev.color };
      if (d.fillOpacity == null && prev.fillOpacity != null) d = { ...d, fillOpacity: prev.fillOpacity };
    }

    this.devices.set(d.id, { ...d });

    if (!d.activationEnabled) {
      this.stopLaserPulse(d.id);
    } else if (d.activationEnabled && !wasPulse) {
      this.stopLaserPulse(d.id);
      this.pulseVisibleById.set(d.id, true);
      this.ensureLaserPulse(d.id);
    }

    this.flush();
  }

  /**
   * 批量更新设备：同一批次仅 flush 一次，减少高频 WS/跟随时的重复 setData。
   */
  upsertMany(devices: LaserDevice[]) {
    if (!devices.length) return;
    for (let i = 0; i < devices.length; i += 1) {
      let d = devices[i]!;
      const prev = this.devices.get(d.id);
      const wasPulse = prev?.activationEnabled === true;
      if (prev) {
        if (d.color == null && prev.color != null) d = { ...d, color: prev.color };
        if (d.fillOpacity == null && prev.fillOpacity != null) d = { ...d, fillOpacity: prev.fillOpacity };
      }
      this.devices.set(d.id, { ...d });

      if (!d.activationEnabled) {
        this.stopLaserPulse(d.id);
      } else if (d.activationEnabled && !wasPulse) {
        this.stopLaserPulse(d.id);
        this.pulseVisibleById.set(d.id, true);
        this.ensureLaserPulse(d.id);
      }
    }
    this.flush();
  }

  remove(id: string) {
    this.stopLaserPulse(id);
    this.devices.delete(id);
    this.flush();
  }

  clear() {
    for (const t of this.laserPulseTimeouts.values()) clearTimeout(t);
    this.laserPulseTimeouts.clear();
    this.pulseVisibleById.clear();
    this.devices.clear();
    this.flush();
  }

  getAll(): LaserDevice[] {
    return [...this.devices.values()];
  }

  private minScanTickMs(): number {
    let t = 90;
    for (const d of this.devices.values()) {
      if (d.activationEnabled && Number.isFinite(d.scan.tickMs)) t = Math.min(t, Math.max(16, d.scan.tickMs));
    }
    return t;
  }

  /** 是否绘制 scan 亮带：未激活/图层关/开口过小为 false；脉动开启时仅在亮相帧为 true */
  private sectorScanGeometryVisible(d: LaserDevice): boolean {
    if (!d.activationEnabled || !this.layerVis.scanFillVisible || d.openingDeg <= 0.1) return false;
    if (d.activationEnabled === true) return this.pulseVisibleById.get(d.id) === true;
    return true;
  }

  private wantScan(): boolean {
    for (const d of this.devices.values()) {
      if (this.sectorScanGeometryVisible(d)) return true;
    }
    return false;
  }

  private stopLaserPulse(id: string) {
    const tid = this.laserPulseTimeouts.get(id);
    if (tid) clearTimeout(tid);
    this.laserPulseTimeouts.delete(id);
    this.pulseVisibleById.delete(id);
  }

  /**
   * 按 `pulseOnMs` / `pulseOffMs` 切换 scan 亮相与暗相，行为对齐 V2 脉动逻辑。
   */
  private ensureLaserPulse(id: string) {
    const d0 = this.devices.get(id);
    if (!d0?.activationEnabled || this.laserPulseTimeouts.has(id)) return;
    const onMs = Number.isFinite(Number(d0.pulseOnMs)) ? Math.max(200, Number(d0.pulseOnMs)) : DEFAULT_LASER_PULSE_ON_MS;
    const offMs = Number.isFinite(Number(d0.pulseOffMs)) ? Math.max(200, Number(d0.pulseOffMs)) : DEFAULT_LASER_PULSE_OFF_MS;
    const step = (pulseOn: boolean) => {
      const d = this.devices.get(id);
      if (!d?.activationEnabled) {
        this.laserPulseTimeouts.delete(id);
        return;
      }
      this.pulseVisibleById.set(id, pulseOn);
      this.flush();
      const nextDelay = pulseOn ? onMs : offMs;
      const tid = setTimeout(() => step(!pulseOn), nextDelay);
      this.laserPulseTimeouts.set(id, tid);
    };
    this.pulseVisibleById.set(id, true);
    this.flush();
    this.laserPulseTimeouts.set(id, setTimeout(() => step(false), onMs));
  }

  private syncScanTimer() {
    if (!this.wantScan()) {
      this.stopScanTimer();
      return;
    }
    if (this.scanTimer != null) return;
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

      /* 扇区 / 扫描 / 边线仅 `activationEnabled` 时绘制；中心点与名称仍输出，避免根配置 `activationEnabled: false` 时整层空白且不报错 */
      if (d.activationEnabled) {
        const pulseOn = d.activationEnabled !== true || this.pulseVisibleById.get(d.id) !== false;
        const ring = geoSectorCoords(d.lng, d.lat, d.rangeKm, d.headingDeg, d.openingDeg);

        /* ── 扇区填充：脉冲暗相仍渲染背景（降低透明度） ── */
        if (this.layerVis.fillVisible && d.openingDeg > 0.1) {
          const secOpacity = pulseOn ? Math.max(0.08, baseOp * 0.65) : Math.max(0.04, baseOp * 0.3);
          feats.push({
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [ring] },
            properties: {
              t: "sec",
              id: d.id,
              c,
              o: secOpacity,
            },
          });
        }

        /* 扫描亮带：仅脉冲亮相时渲染 */
        if (pulseOn && this.sectorScanGeometryVisible(d)) {
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

        if (d.openingDeg > 0.1 && pulseOn && this._border.emit && this.layerVis.lineVisible) {
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
            symbolId: getAssetSymbolId("laser", "online", !!d.virtual, disp, fmc),
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
    const src = this.map.getSource(LASER_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData({ type: "FeatureCollection", features: feats });
    if (this.map.triggerRepaint) this.map.triggerRepaint();
    this.syncScanTimer();
  }
}
