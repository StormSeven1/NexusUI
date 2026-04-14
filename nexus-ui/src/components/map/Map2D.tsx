"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useAppStore } from "@/stores/app-store";
import { useTrackStore } from "@/stores/track-store";
import { MOCK_ALERTS, MOCK_ASSETS, MOCK_TRACKS, MOCK_ZONES } from "@/lib/mock-data";
import type { Track } from "@/lib/mock-data";
import { FORCE_COLORS } from "@/lib/colors";
import {
  buildMarkerSymbolDataUrl,
  getAllMarkerSymbolKeys,
  getMarkerSymbolId,
  buildLockOnDataUrl,
  LOCK_ON_IMAGE_ID,
  buildAlertRingDataUrl,
  getAllAlertRingKeys,
  getAlertRingImageId,
  type AlertSeverity,
  buildAssetSymbolDataUrl,
  getAllAssetSymbolKeys,
  getAssetSymbolId,
  buildAssetSelectDataUrl,
  ASSET_SELECT_IMAGE_ID,
  geoCircleCoords,
  geoSectorCoords,
  geoRadarSweepCoords,
} from "@/lib/map-symbols";

/* ─── 常量 ─── */

const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const CENTER: [number, number] = [-2.35, 51.35];
const DEFAULT_ZOOM = 8.5;

/* source ids */
const TRACK_SOURCE = "tracks-source";
const ASSET_SOURCE = "assets-source";
const FOV_SOURCE = "fov-source";
const RADAR_RANGE_SOURCE = "radar-range-source";
const RADAR_SWEEP_SOURCE = "radar-sweep-source";
const ZONE_SOURCE = "zones-source";

/* layer ids — 航迹 */
const TRACK_SYMBOL = "tracks-symbol";
const TRACK_LABEL = "tracks-label";
const HIGHLIGHT_LAYER = "tracks-highlight";
const ALERT_RING = "tracks-alert-ring";
const LOCK_ON = "tracks-lock-on";

/* layer ids — 资产位置 */
const ASSET_SYMBOL = "assets-symbol";
const ASSET_LABEL = "assets-label";
const ASSET_SELECT = "assets-select";

/* layer ids — 传感器覆盖 */
const FOV_FILL = "fov-fill";
const FOV_LINE = "fov-line";
const RADAR_RANGE_FILL = "radar-range-fill";
const RADAR_RANGE_LINE = "radar-range-line";
const RADAR_SWEEP_FILL = "radar-sweep-fill";

/* layer ids — 限制区域 */
const ZONE_FILL = "zones-fill";
const ZONE_LINE = "zones-line";
const ZONE_LABEL = "zones-label";

/* 图层面板 ID → 地图 layer 映射 */
const LAYER_MAPPING: Record<string, string[]> = {
  "lyr-tracks": [TRACK_SYMBOL, TRACK_LABEL, HIGHLIGHT_LAYER, ALERT_RING, LOCK_ON],
  "lyr-assets": [ASSET_SYMBOL, ASSET_LABEL, ASSET_SELECT],
  "lyr-coverage": [FOV_FILL, FOV_LINE, RADAR_RANGE_FILL, RADAR_RANGE_LINE, RADAR_SWEEP_FILL],
  "lyr-zones": [ZONE_FILL, ZONE_LINE, ZONE_LABEL],
};

const ZONE_COLORS: Record<string, { fill: string; line: string }> = {
  "no-fly": { fill: "rgba(239,68,68,0.12)", line: "#ef4444" },
  exercise: { fill: "rgba(59,130,246,0.10)", line: "#3b82f6" },
  warning: { fill: "rgba(251,191,36,0.10)", line: "#fbbf24" },
};

/* ─── helpers ─── */

const ALERT_RANK: Record<AlertSeverity, number> = { info: 1, warning: 2, critical: 3 };

function getTrackMaxSeverity(trackId: string): AlertSeverity | null {
  let max: AlertSeverity | null = null;
  for (const a of MOCK_ALERTS) {
    if (a.trackId !== trackId) continue;
    if (!max || ALERT_RANK[a.severity] > ALERT_RANK[max]) max = a.severity;
  }
  return max;
}

function buildTrackGeoJSON(trackList?: Track[]) {
  const tracks = trackList ?? MOCK_TRACKS;
  return {
    type: "FeatureCollection" as const,
    features: tracks.map((t) => {
      const sev = getTrackMaxSeverity(t.id);
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [t.lng, t.lat] as [number, number] },
        properties: {
          id: t.id, name: t.name, type: t.type, disposition: t.disposition,
          speed: t.speed, heading: t.heading, altitude: t.altitude ?? null,
          color: FORCE_COLORS[t.disposition],
          symbolId: getMarkerSymbolId(t.type, t.disposition),
          alertRingId: sev ? getAlertRingImageId(sev) : "",
          hasAlert: sev ? "yes" : "",
        },
      };
    }),
  } satisfies GeoJSON.FeatureCollection<GeoJSON.Point>;
}

function buildAssetGeoJSON() {
  return {
    type: "FeatureCollection" as const,
    features: MOCK_ASSETS.map((a) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [a.lng, a.lat] as [number, number] },
      properties: {
        id: a.id, name: a.name, type: a.type, status: a.status,
        range: a.range ?? 0,
        symbolId: getAssetSymbolId(a.type, a.status),
      },
    })),
  } satisfies GeoJSON.FeatureCollection<GeoJSON.Point>;
}

/** 非雷达资产的 FOV 扇形 / 全向覆盖 */
function buildFovGeoJSON() {
  const features = MOCK_ASSETS
    .filter((a) => a.range && a.range > 0 && a.type !== "radar")
    .map((a) => {
      const isSector = a.fovAngle !== undefined && a.fovAngle < 360 && a.heading !== undefined;
      const coords = isSector
        ? geoSectorCoords(a.lng, a.lat, a.range!, a.heading!, a.fovAngle!)
        : geoCircleCoords(a.lng, a.lat, a.range!);
      return {
        type: "Feature" as const,
        geometry: { type: "Polygon" as const, coordinates: [coords] },
        properties: { id: a.id, name: a.name, status: a.status, assetType: a.type },
      };
    });
  return { type: "FeatureCollection" as const, features };
}

/** 雷达静态覆盖圆 */
function buildRadarRangeGeoJSON() {
  const features = MOCK_ASSETS
    .filter((a) => a.type === "radar" && a.range && a.range > 0)
    .map((a) => ({
      type: "Feature" as const,
      geometry: { type: "Polygon" as const, coordinates: [geoCircleCoords(a.lng, a.lat, a.range!)] },
      properties: { id: a.id, name: a.name, status: a.status },
    }));
  return { type: "FeatureCollection" as const, features };
}

/** 雷达扫描波束（每帧更新） */
function buildRadarSweepGeoJSON(sweepAngle: number) {
  const radars = MOCK_ASSETS.filter((a) => a.type === "radar" && a.range && a.range > 0 && a.status !== "offline");
  const features = radars.map((a) => ({
    type: "Feature" as const,
    geometry: { type: "Polygon" as const, coordinates: [geoRadarSweepCoords(a.lng, a.lat, a.range!, sweepAngle)] },
    properties: { id: a.id, status: a.status },
  }));
  return { type: "FeatureCollection" as const, features };
}

function buildZoneGeoJSON() {
  return {
    type: "FeatureCollection" as const,
    features: MOCK_ZONES.map((z) => ({
      type: "Feature" as const,
      geometry: { type: "Polygon" as const, coordinates: [z.coordinates] },
      properties: {
        id: z.id, name: z.name, zoneType: z.type,
        fillColor: ZONE_COLORS[z.type]?.fill ?? "rgba(255,255,255,0.05)",
        lineColor: ZONE_COLORS[z.type]?.line ?? "#a1a1aa",
      },
    })),
  };
}

async function loadSvgImage(src: string, size: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image(size, size);
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load marker: ${src.slice(0, 48)}`));
    image.src = src;
  });
}

/* ─── 组件 ─── */

export function Map2D() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const lastFlySeqRef = useRef<number>(-1);
  const routeIdsRef = useRef<string[]>([]);
  const areaIdsRef = useRef<string[]>([]);
  const rafRef = useRef<number | null>(null);
  const { setMouseCoords, setZoomLevel, selectTrack, selectAsset } = useAppStore();

  const selectTrackRef = useRef(selectTrack);
  useEffect(() => { selectTrackRef.current = selectTrack; }, [selectTrack]);
  const selectAssetRef = useRef(selectAsset);
  useEffect(() => { selectAssetRef.current = selectAsset; }, [selectAsset]);

  const setVis = useCallback((map: maplibregl.Map, id: string, visible: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }, []);

  /* ─── 初始化地图 ─── */
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: DARK_STYLE,
      center: CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: 0, bearing: 0,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-left");
    map.on("mousemove", (e) => setMouseCoords({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    map.on("zoomend", () => setZoomLevel(Math.round(map.getZoom())));

    map.on("load", () => {
      const init = async () => {
        /* ── 注册所有图标 ── */
        await Promise.all([
          ...getAllMarkerSymbolKeys().map(async ({ id, type, disposition }) => {
            if (!map.hasImage(id)) map.addImage(id, await loadSvgImage(buildMarkerSymbolDataUrl(type, disposition), 64), { pixelRatio: 2 });
          }),
          ...getAllAlertRingKeys().map(async ({ id, severity }) => {
            if (!map.hasImage(id)) map.addImage(id, await loadSvgImage(buildAlertRingDataUrl(severity), 96), { pixelRatio: 2 });
          }),
          ...getAllAssetSymbolKeys().map(async ({ id, type, status }) => {
            if (!map.hasImage(id)) map.addImage(id, await loadSvgImage(buildAssetSymbolDataUrl(type, status), 48), { pixelRatio: 2 });
          }),
          (async () => {
            if (!map.hasImage(LOCK_ON_IMAGE_ID)) map.addImage(LOCK_ON_IMAGE_ID, await loadSvgImage(buildLockOnDataUrl(), 128), { pixelRatio: 2 });
          })(),
          (async () => {
            if (!map.hasImage(ASSET_SELECT_IMAGE_ID)) map.addImage(ASSET_SELECT_IMAGE_ID, await loadSvgImage(buildAssetSelectDataUrl(), 52), { pixelRatio: 2 });
          })(),
        ]);

        /* ════════════════════════════════════════════
         *  1) 限制区域
         * ════════════════════════════════════════════ */
        map.addSource(ZONE_SOURCE, { type: "geojson", data: buildZoneGeoJSON() });
        map.addLayer({ id: ZONE_FILL, type: "fill", source: ZONE_SOURCE, paint: { "fill-color": ["get", "fillColor"] } });
        map.addLayer({ id: ZONE_LINE, type: "line", source: ZONE_SOURCE, paint: { "line-color": ["get", "lineColor"], "line-width": 1.5, "line-dasharray": [4, 3], "line-opacity": 0.7 } });
        map.addLayer({ id: ZONE_LABEL, type: "symbol", source: ZONE_SOURCE, layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Regular"], "text-size": 11 }, paint: { "text-color": ["get", "lineColor"], "text-halo-color": "#09090b", "text-halo-width": 1.5, "text-opacity": 0.8 } });

        /* ════════════════════════════════════════════
         *  2) 雷达覆盖范围（静态圆 + 动态扫描波束）
         * ════════════════════════════════════════════ */
        map.addSource(RADAR_RANGE_SOURCE, { type: "geojson", data: buildRadarRangeGeoJSON() });
        map.addLayer({
          id: RADAR_RANGE_FILL, type: "fill", source: RADAR_RANGE_SOURCE,
          paint: {
            "fill-color": ["match", ["get", "status"], "online", "rgba(52,211,153,0.04)", "degraded", "rgba(251,191,36,0.03)", "rgba(248,113,113,0.02)"],
          },
        });
        map.addLayer({
          id: RADAR_RANGE_LINE, type: "line", source: RADAR_RANGE_SOURCE,
          paint: {
            "line-color": ["match", ["get", "status"], "online", "#34d399", "degraded", "#fbbf24", "#f87171"],
            "line-width": 1, "line-dasharray": [4, 4], "line-opacity": 0.25,
          },
        });

        map.addSource(RADAR_SWEEP_SOURCE, { type: "geojson", data: buildRadarSweepGeoJSON(0) });
        map.addLayer({
          id: RADAR_SWEEP_FILL, type: "fill", source: RADAR_SWEEP_SOURCE,
          paint: {
            "fill-color": ["match", ["get", "status"], "online", "rgba(52,211,153,0.18)", "degraded", "rgba(251,191,36,0.14)", "rgba(248,113,113,0.10)"],
          },
        });

        /* ════════════════════════════════════════════
         *  3) FOV 扇形（camera / drone / tower 非雷达）
         * ════════════════════════════════════════════ */
        map.addSource(FOV_SOURCE, { type: "geojson", data: buildFovGeoJSON() });
        map.addLayer({
          id: FOV_FILL, type: "fill", source: FOV_SOURCE,
          paint: {
            "fill-color": [
              "match", ["get", "assetType"],
              "camera", "rgba(147,51,234,0.10)",
              "drone", "rgba(59,130,246,0.10)",
              "rgba(52,211,153,0.06)",
            ],
          },
        });
        map.addLayer({
          id: FOV_LINE, type: "line", source: FOV_SOURCE,
          paint: {
            "line-color": [
              "match", ["get", "assetType"],
              "camera", "#9333ea",
              "drone", "#3b82f6",
              "#34d399",
            ],
            "line-width": 1.2, "line-dasharray": [3, 3], "line-opacity": 0.4,
          },
        });

        /* ════════════════════════════════════════════
         *  4) 航迹（tracks）— 优先使用实时数据
         * ════════════════════════════════════════════ */
        const liveTracks = useTrackStore.getState().tracks;
        map.addSource(TRACK_SOURCE, { type: "geojson", data: buildTrackGeoJSON(liveTracks.length ? liveTracks : undefined) });

        map.addLayer({ id: HIGHLIGHT_LAYER, type: "circle", source: TRACK_SOURCE, filter: ["in", "id", ""], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 12, 10, 20, 15, 32], "circle-color": "transparent", "circle-stroke-color": "#60a5fa", "circle-stroke-width": 2.5, "circle-stroke-opacity": 0.85 } });

        map.addLayer({ id: ALERT_RING, type: "symbol", source: TRACK_SOURCE, filter: ["==", ["get", "hasAlert"], "yes"], layout: { "icon-image": ["get", "alertRingId"], "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.35, 10, 0.55, 15, 0.8], "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" }, paint: { "icon-opacity": 0.85 } });

        map.addLayer({ id: LOCK_ON, type: "symbol", source: TRACK_SOURCE, filter: ["in", "id", ""], layout: { "icon-image": LOCK_ON_IMAGE_ID, "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 10, 0.65, 15, 0.95], "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" }, paint: { "icon-opacity": 0.9 } });

        map.addLayer({ id: TRACK_SYMBOL, type: "symbol", source: TRACK_SOURCE, layout: { "icon-image": ["get", "symbolId"], "icon-rotate": ["coalesce", ["get", "heading"], 0], "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.38, 10, 0.56, 15, 0.76], "icon-allow-overlap": true, "icon-ignore-placement": true } });

        map.addLayer({ id: TRACK_LABEL, type: "symbol", source: TRACK_SOURCE, layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Regular"], "text-size": 10, "text-offset": [0, 2.2], "text-anchor": "top", "text-max-width": 10 }, paint: { "text-color": "#a1a1aa", "text-halo-color": "#09090b", "text-halo-width": 1.5 } });

        /* ════════════════════════════════════════════
         *  5) 资产图标（assets）
         * ════════════════════════════════════════════ */
        map.addSource(ASSET_SOURCE, { type: "geojson", data: buildAssetGeoJSON() });

        map.addLayer({ id: ASSET_SELECT, type: "symbol", source: ASSET_SOURCE, filter: ["in", "id", ""], layout: { "icon-image": ASSET_SELECT_IMAGE_ID, "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 0.75, 15, 1.0], "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" }, paint: { "icon-opacity": 0.9 } });

        map.addLayer({ id: ASSET_SYMBOL, type: "symbol", source: ASSET_SOURCE, layout: { "icon-image": ["get", "symbolId"], "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.42, 10, 0.62, 15, 0.82], "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" } });

        map.addLayer({ id: ASSET_LABEL, type: "symbol", source: ASSET_SOURCE, layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Regular"], "text-size": 10, "text-offset": [0, 1.8], "text-anchor": "top", "text-max-width": 10 }, paint: { "text-color": "#6ee7b7", "text-halo-color": "#09090b", "text-halo-width": 1.5, "text-opacity": 0.8 } });

        /* ── 交互 ── */
        const showPopup = (coords: [number, number], html: string) => {
          if (popupRef.current) popupRef.current.remove();
          popupRef.current = new maplibregl.Popup({ offset: 12, closeButton: false, className: "nexus-popup" })
            .setLngLat(coords).setHTML(html).addTo(map);
        };
        const clearPopup = () => { if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; } };

        map.on("click", TRACK_SYMBOL, (e) => { if (e.features?.[0]?.properties?.id) selectTrackRef.current(e.features[0].properties.id); });
        map.on("mouseenter", TRACK_SYMBOL, (e) => {
          map.getCanvas().style.cursor = "pointer";
          const f = e.features?.[0]; if (!f) return;
          const c = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
          const p = f.properties!;
          showPopup(c, `<div style="font-family:'Inter',sans-serif;padding:4px 0"><div style="font-size:11px;font-weight:600;color:#d4d4d8">${p.name}</div><div style="font-size:10px;color:#52525b;margin-top:2px">${p.id} · ${p.speed} kn · 航向 ${p.heading}°</div></div>`);
        });
        map.on("mouseleave", TRACK_SYMBOL, () => { map.getCanvas().style.cursor = ""; clearPopup(); });

        map.on("click", ASSET_SYMBOL, (e) => { if (e.features?.[0]?.properties?.id) selectAssetRef.current(e.features[0].properties.id); });
        map.on("mouseenter", ASSET_SYMBOL, (e) => {
          map.getCanvas().style.cursor = "pointer";
          const f = e.features?.[0]; if (!f) return;
          const c = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
          const p = f.properties!;
          showPopup(c, `<div style="font-family:'Inter',sans-serif;padding:4px 0"><div style="font-size:11px;font-weight:600;color:#6ee7b7">${p.name}</div><div style="font-size:10px;color:#52525b;margin-top:2px">${p.id} · ${p.status}${p.range ? ` · 覆盖 ${p.range}km` : ""}</div></div>`);
        });
        map.on("mouseleave", ASSET_SYMBOL, () => { map.getCanvas().style.cursor = ""; clearPopup(); });

        setZoomLevel(Math.round(map.getZoom()));

        /* ── 同步初始图层可见性 ── */
        const vis = useAppStore.getState().layerVisibility;
        for (const [lid, mlIds] of Object.entries(LAYER_MAPPING)) {
          const v = vis[lid] ?? true;
          for (const ml of mlIds) setVis(map, ml, v);
        }

        /* ── 动画循环：告警脉冲 + 雷达扫描 ── */
        let alertPhase = 0;
        let sweepAngle = 0;
        const animate = () => {
          if (!mapRef.current) return;
          const m = mapRef.current;

          // 告警环呼吸
          alertPhase += 0.06;
          if (alertPhase > Math.PI * 2) alertPhase -= Math.PI * 2;
          const opacity = 0.3 + 0.6 * ((Math.sin(alertPhase) + 1) / 2);
          if (m.getLayer(ALERT_RING)) m.setPaintProperty(ALERT_RING, "icon-opacity", opacity);

          // 雷达扫描旋转
          sweepAngle = (sweepAngle + 0.8) % 360;
          const src = m.getSource(RADAR_SWEEP_SOURCE) as maplibregl.GeoJSONSource | undefined;
          if (src) src.setData(buildRadarSweepGeoJSON(sweepAngle) as GeoJSON.FeatureCollection);

          rafRef.current = requestAnimationFrame(animate);
        };
        rafRef.current = requestAnimationFrame(animate);
      };

      init().catch((err: unknown) => console.error("Map init failed:", err));
    });

    mapRef.current = map;
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (popupRef.current) popupRef.current.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [setMouseCoords, setZoomLevel, setVis]);

  /* ── flyTo ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      const req = s.flyToRequest;
      if (!req || req.seq === lastFlySeqRef.current) return;
      lastFlySeqRef.current = req.seq;
      mapRef.current?.flyTo({ center: [req.lng, req.lat], zoom: req.zoom ?? mapRef.current.getZoom(), duration: 1800, essential: true });
    });
    return unsub;
  }, []);

  /* ── highlightedTrackIds ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      const m = mapRef.current;
      if (!m?.getLayer(HIGHLIGHT_LAYER)) return;
      const ids = s.highlightedTrackIds;
      m.setFilter(HIGHLIGHT_LAYER, ids.length ? ["in", "id", ...ids] : ["in", "id", ""]);
    });
    return unsub;
  }, []);

  /* ── selectedTrackId → 锁定框 ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      const m = mapRef.current;
      if (!m?.getLayer(LOCK_ON)) return;
      const id = s.selectedTrackId;
      m.setFilter(LOCK_ON, id ? ["==", ["get", "id"], id] : ["in", "id", ""]);
    });
    return unsub;
  }, []);

  /* ── selectedAssetId → 资产选中框 ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      const m = mapRef.current;
      if (!m?.getLayer(ASSET_SELECT)) return;
      const id = s.selectedAssetId;
      m.setFilter(ASSET_SELECT, id ? ["==", ["get", "id"], id] : ["in", "id", ""]);
    });
    return unsub;
  }, []);

  /* ── layerVisibility → 图层开关 ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      const m = mapRef.current;
      if (!m?.isStyleLoaded()) return;
      const vis = s.layerVisibility;
      for (const [lid, mlIds] of Object.entries(LAYER_MAPPING)) {
        const v = vis[lid] ?? true;
        for (const ml of mlIds) setVis(m, ml, v);
      }
    });
    return unsub;
  }, [setVis]);

  /* ── routeLines ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      const m = mapRef.current;
      if (!m?.isStyleLoaded()) return;
      const current = s.routeLines;
      const currentIds = new Set(current.map((r) => r.id));

      for (const oldId of routeIdsRef.current) {
        if (!currentIds.has(oldId)) {
          if (m.getLayer("route-layer-" + oldId)) m.removeLayer("route-layer-" + oldId);
          if (m.getSource("route-source-" + oldId)) m.removeSource("route-source-" + oldId);
        }
      }
      for (const route of current) {
        const sid = "route-source-" + route.id;
        if (m.getSource(sid)) continue;
        m.addSource(sid, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.points.map((p) => [p.lng, p.lat]) } } });
        m.addLayer({ id: "route-layer-" + route.id, type: "line", source: sid, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": route.color, "line-width": 3, "line-opacity": 0.85, "line-dasharray": [2, 3] } }, HIGHLIGHT_LAYER);
      }
      routeIdsRef.current = [...currentIds];
    });
    return unsub;
  }, []);

  /* ── drawnAreas ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      const m = mapRef.current;
      if (!m?.isStyleLoaded()) return;
      const current = s.drawnAreas;
      const currentIds = new Set(current.map((a) => a.id));

      for (const oldId of areaIdsRef.current) {
        if (!currentIds.has(oldId)) {
          if (m.getLayer("area-fill-" + oldId)) m.removeLayer("area-fill-" + oldId);
          if (m.getLayer("area-line-" + oldId)) m.removeLayer("area-line-" + oldId);
          if (m.getLayer("area-label-" + oldId)) m.removeLayer("area-label-" + oldId);
          if (m.getSource("area-source-" + oldId)) m.removeSource("area-source-" + oldId);
        }
      }
      for (const area of current) {
        const sid = "area-source-" + area.id;
        if (m.getSource(sid)) continue;
        const ring = [...area.points.map((p) => [p.lng, p.lat]), [area.points[0].lng, area.points[0].lat]];
        m.addSource(sid, {
          type: "geojson",
          data: { type: "Feature", properties: { label: area.label ?? "" }, geometry: { type: "Polygon", coordinates: [ring] } },
        });
        m.addLayer({ id: "area-fill-" + area.id, type: "fill", source: sid, paint: { "fill-color": area.fillColor, "fill-opacity": area.fillOpacity } }, HIGHLIGHT_LAYER);
        m.addLayer({ id: "area-line-" + area.id, type: "line", source: sid, paint: { "line-color": area.color, "line-width": 2, "line-opacity": 0.7, "line-dasharray": [4, 3] } }, HIGHLIGHT_LAYER);
        if (area.label) {
          m.addLayer({ id: "area-label-" + area.id, type: "symbol", source: sid, layout: { "text-field": area.label, "text-font": ["Open Sans Regular"], "text-size": 11 }, paint: { "text-color": area.color, "text-halo-color": "#09090b", "text-halo-width": 1.5, "text-opacity": 0.8 } });
        }
      }
      areaIdsRef.current = [...currentIds];
    });
    return unsub;
  }, []);

  /* ── 实时 track 数据更新 ── */
  useEffect(() => {
    const unsub = useTrackStore.subscribe((s) => {
      const m = mapRef.current;
      if (!m?.isStyleLoaded() || !s.tracks.length) return;
      const src = m.getSource(TRACK_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(buildTrackGeoJSON(s.tracks) as GeoJSON.FeatureCollection);
    });
    return unsub;
  }, []);

  return (
    <>
      <div ref={mapContainer} className="h-full w-full" />
      <style jsx global>{`
        .nexus-popup .maplibregl-popup-content {
          background: rgba(17, 17, 19, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          padding: 8px 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
        }
        .nexus-popup .maplibregl-popup-tip {
          border-top-color: rgba(17, 17, 19, 0.95);
        }
        .maplibregl-ctrl-group {
          background: rgba(17, 17, 19, 0.9) !important;
          border: 1px solid rgba(255, 255, 255, 0.06) !important;
          border-radius: 6px !important;
          backdrop-filter: blur(8px);
        }
        .maplibregl-ctrl-group button {
          border-color: rgba(255, 255, 255, 0.06) !important;
        }
        .maplibregl-ctrl-group button + button {
          border-top: 1px solid rgba(255, 255, 255, 0.06) !important;
        }
        .maplibregl-ctrl-group button .maplibregl-ctrl-icon {
          filter: invert(0.5);
        }
        .maplibregl-ctrl-group button:hover .maplibregl-ctrl-icon {
          filter: invert(0.8);
        }
      `}</style>
    </>
  );
}
