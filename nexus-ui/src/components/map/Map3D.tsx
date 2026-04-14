"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useTrackStore } from "@/stores/track-store";
import { MOCK_TRACKS } from "@/lib/mock-data";
import type { Asset, RestrictedZone, Track } from "@/lib/mock-data";
import { useZoneStore } from "@/stores/zone-store";
import { useAssetStore } from "@/stores/asset-store";
import type { ZoneData } from "@/stores/zone-store";
import type { AssetData } from "@/stores/asset-store";
import { FORCE_COLORS } from "@/lib/colors";
import {
  buildMarkerSymbolDataUrl,
  buildAssetSymbolDataUrl,
  geoCircleCoords,
  geoSectorCoords,
  geoRadarSweepCoords,
} from "@/lib/map-symbols";
import { AlertTriangle } from "lucide-react";
import { TargetPlacard, type PlacardKind } from "@/components/map/TargetPlacard";

type CesiumModule = typeof import("cesium");
type CesiumViewer = import("cesium").Viewer;
type CesiumEntity = import("cesium").Entity;
type PositionedEvent = import("cesium").ScreenSpaceEventHandler.PositionedEvent;
type MotionEvent = import("cesium").ScreenSpaceEventHandler.MotionEvent;

/**
 * 颜色配置使用 [r, g, b, a] 元组，兼容 Cesium Color 构造函数（0-1 范围）。
 */
type RGBA = [number, number, number, number];

const ZONE_STYLES: Record<string, { fill: RGBA; line: RGBA }> = {
  "no-fly":  { fill: [0.94, 0.27, 0.27, 0.18], line: [0.94, 0.27, 0.27, 0.7] },
  exercise:  { fill: [0.23, 0.51, 0.96, 0.15], line: [0.23, 0.51, 0.96, 0.7] },
  warning:   { fill: [0.98, 0.75, 0.14, 0.15], line: [0.98, 0.75, 0.14, 0.7] },
};

const COVERAGE_STYLES: Record<string, { fill: RGBA; line: RGBA }> = {
  camera:    { fill: [0.58, 0.20, 0.92, 0.12], line: [0.58, 0.20, 0.92, 0.4] },
  drone:     { fill: [0.23, 0.51, 0.96, 0.12], line: [0.23, 0.51, 0.96, 0.4] },
  radar:     { fill: [0.20, 0.83, 0.60, 0.06], line: [0.20, 0.83, 0.60, 0.25] },
  tower:     { fill: [0.20, 0.83, 0.60, 0.08], line: [0.20, 0.83, 0.60, 0.3] },
  satellite: { fill: [0.20, 0.83, 0.60, 0.08], line: [0.20, 0.83, 0.60, 0.3] },
};

const STATUS_RGBA: Record<string, RGBA> = {
  online:   [0.20, 0.83, 0.60, 0.22],
  degraded: [0.98, 0.75, 0.14, 0.18],
  offline:  [0.97, 0.44, 0.44, 0.12],
};

/**
 * 图层 → 对应的 entity group key。
 * 和 Map2D 中的 LAYER_MAPPING 保持对应。
 */
const LAYER_GROUPS = {
  "lyr-tracks": "tracks",
  "lyr-assets": "assets",
  "lyr-coverage": "coverage",
  "lyr-zones": "zones",
} as const;

type GroupKey = (typeof LAYER_GROUPS)[keyof typeof LAYER_GROUPS];

function adaptZones(zones: ZoneData[]): RestrictedZone[] {
  return zones.map((z) => ({
    id: z.id,
    name: z.name,
    type: z.zone_type as RestrictedZone["type"],
    coordinates: z.coordinates,
  }));
}

function adaptAssets(assets: AssetData[]): Asset[] {
  return assets.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.asset_type as Asset["type"],
    status: a.status as Asset["status"],
    lat: a.lat,
    lng: a.lng,
    range: a.range_km ?? undefined,
    heading: a.heading ?? undefined,
    fovAngle: a.fov_angle ?? undefined,
  }));
}

export function Map3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const placardEntityRef = useRef<CesiumEntity | null>(null);
  const placardPostRenderCleanupRef = useRef<(() => void) | null>(null);
  const lastFlySeqRef = useRef<number>(-1);
  const highlightEntitiesRef = useRef<CesiumEntity[]>([]);
  const routeEntitiesRef = useRef<Map<string, CesiumEntity>>(new Map());
  const areaEntitiesRef = useRef<Map<string, CesiumEntity[]>>(new Map());
  const entityGroupsRef = useRef<Record<GroupKey, CesiumEntity[]>>({
    tracks: [], assets: [], coverage: [], zones: [],
  });
  const radarSweepRef = useRef<CesiumEntity[]>([]);
  const rafRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [placard, setPlacard] = useState<{
    kind: PlacardKind;
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const { selectTrack, selectAsset, setMouseCoords } = useAppStore();

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    let viewer: CesiumViewer | null = null;
    let destroyed = false;

    const init = async () => {
      try {
        const Cesium = await import("cesium");
        cesiumRef.current = Cesium;

        if (typeof window !== "undefined") {
          (window as typeof window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = "/cesium/";
        }
        if (destroyed || !containerRef.current) return;

        viewer = new Cesium.Viewer(containerRef.current, {
          baseLayerPicker: false, geocoder: false, homeButton: false,
          sceneModePicker: false, selectionIndicator: false, infoBox: false,
          timeline: false, animation: false, navigationHelpButton: false,
          fullscreenButton: false,
          creditContainer: document.createElement("div"),
          baseLayer: new Cesium.ImageryLayer(
            new Cesium.UrlTemplateImageryProvider({
              url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              credit: "CartoDB", minimumLevel: 0, maximumLevel: 18,
            })
          ),
          terrainProvider: undefined,
          requestRenderMode: false,
        });

        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#09090b");
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#111113");
        viewer.scene.globe.showGroundAtmosphere = false;
        viewer.scene.fog.enabled = false;
        viewer.scene.globe.enableLighting = false;
        viewer.scene.highDynamicRange = false;

        viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(-2.35, 51.35, 0), 0),
          {
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), 500000),
            duration: 0,
          },
        );

        const v = viewer;
        const groups = entityGroupsRef.current;

        /* ═══════════════════════════════════════════
         *  1) 限制区域
         * ═══════════════════════════════════════════ */
        const rgba = (c: RGBA) => new Cesium.Color(c[0], c[1], c[2], c[3]);

        for (const zone of adaptZones(useZoneStore.getState().zones)) {
          const style = ZONE_STYLES[zone.type] ?? ZONE_STYLES["warning"];
          // 去掉闭合点（Cesium 自动闭合）
          const coords = zone.coordinates.slice(0, -1);
          const positions = coords.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat));
          const centerLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
          const centerLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;

          const ent = v.entities.add({
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(positions),
              material: rgba(style.fill),
              outline: true,
              outlineColor: rgba(style.line),
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            label: {
              text: zone.name,
              font: '12px Roboto, "Noto Sans SC", sans-serif',
              fillColor: rgba(style.line),
              outlineColor: Cesium.Color.fromCssColorString("#09090b"),
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 5e5, 0.4),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            position: Cesium.Cartesian3.fromDegrees(centerLng, centerLat, 100),
            properties: { zoneId: zone.id },
          });
          groups.zones.push(ent);
        }

        /* ═══════════════════════════════════════════
         *  2) 传感器覆盖
         * ═══════════════════════════════════════════ */
        const _assets = adaptAssets(useAssetStore.getState().assets);
        for (const asset of _assets) {
          if (!asset.range || asset.range <= 0) continue;
          const sweepColor = STATUS_RGBA[asset.status] ?? STATUS_RGBA["online"];
          const covStyle = COVERAGE_STYLES[asset.type] ?? COVERAGE_STYLES["tower"];

          if (asset.type === "radar") {
            const circleCoords = geoCircleCoords(asset.lng, asset.lat, asset.range);
            const positions = circleCoords.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat));
            const rangeEnt = v.entities.add({
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: rgba(covStyle.fill),
                outline: true,
                outlineColor: rgba(covStyle.line),
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: { assetId: asset.id, _coverage: true },
            });
            groups.coverage.push(rangeEnt);

            if (asset.status !== "offline") {
              const sweepCoords = geoRadarSweepCoords(asset.lng, asset.lat, asset.range, 0);
              const sweepPositions = sweepCoords.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat));
              const sweepEnt = v.entities.add({
                polygon: {
                  hierarchy: new Cesium.PolygonHierarchy(sweepPositions),
                  material: rgba(sweepColor),
                  outline: false,
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
                properties: {
                  assetId: asset.id, _radarSweep: true,
                  _lng: asset.lng, _lat: asset.lat, _range: asset.range,
                  _status: asset.status,
                },
              });
              groups.coverage.push(sweepEnt);
              radarSweepRef.current.push(sweepEnt);
            }
          } else {
            const isSector = asset.fovAngle !== undefined && asset.fovAngle < 360 && asset.heading !== undefined;
            const coords = isSector
              ? geoSectorCoords(asset.lng, asset.lat, asset.range, asset.heading!, asset.fovAngle!)
              : geoCircleCoords(asset.lng, asset.lat, asset.range);
            const positions = coords.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat));
            const ent = v.entities.add({
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: rgba(covStyle.fill),
                outline: true,
                outlineColor: rgba(covStyle.line),
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: { assetId: asset.id, _coverage: true },
            });
            groups.coverage.push(ent);
          }
        }

        /* ═══════════════════════════════════════════
         *  3) 航迹 — 优先使用实时数据
         * ═══════════════════════════════════════════ */
        const liveTracks = useTrackStore.getState().tracks;
        const initialTracks: Track[] = liveTracks.length ? liveTracks : MOCK_TRACKS;
        for (const track of initialTracks) {
          const ent = v.entities.add({
            position: Cesium.Cartesian3.fromDegrees(track.lng, track.lat, track.altitude || 0),
            billboard: {
              image: buildMarkerSymbolDataUrl(track.type, track.disposition),
              scale: 0.68,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              heightReference: Cesium.HeightReference.NONE,
              rotation: -Cesium.Math.toRadians(track.heading ?? 0),
              color: Cesium.Color.WHITE,
            },
            label: {
              text: track.name,
              font: '11px Roboto, "Noto Sans SC", sans-serif',
              fillColor: Cesium.Color.fromCssColorString(FORCE_COLORS[track.disposition]),
              outlineColor: Cesium.Color.fromCssColorString("#09090b"),
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -26),
              scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 5e5, 0.4),
              translucencyByDistance: new Cesium.NearFarScalar(1e4, 1, 8e5, 0.2),
            },
            properties: { trackId: track.id },
          });
          groups.tracks.push(ent);
        }

        /* ═══════════════════════════════════════════
         *  4) 资产图标
         * ═══════════════════════════════════════════ */
        for (const asset of _assets) {
          const ent = v.entities.add({
            position: Cesium.Cartesian3.fromDegrees(asset.lng, asset.lat, 0),
            billboard: {
              image: buildAssetSymbolDataUrl(asset.type, asset.status),
              scale: 0.62,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            label: {
              text: asset.name,
              font: '10px Roboto, "Noto Sans SC", sans-serif',
              fillColor: Cesium.Color.fromCssColorString("#6ee7b7"),
              outlineColor: Cesium.Color.fromCssColorString("#09090b"),
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -22),
              scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 5e5, 0.35),
              translucencyByDistance: new Cesium.NearFarScalar(1e4, 1, 8e5, 0.2),
            },
            properties: { assetId: asset.id },
          });
          groups.assets.push(ent);
        }

        /* ── 交互 ── */
        const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
        handler.setInputAction((movement: PositionedEvent) => {
          const picked = v.scene.pick(movement.position);
          if (Cesium.defined(picked) && picked.id?.properties) {
            const trackId = picked.id.properties.trackId?.getValue();
            const assetId = picked.id.properties.assetId?.getValue();
            if (trackId) {
              selectTrack(trackId);
              placardEntityRef.current = picked.id as CesiumEntity;
              setPlacard((prev) => (prev && prev.kind === "track" && prev.id === trackId ? prev : { kind: "track", id: trackId, x: movement.position.x, y: movement.position.y }));
            } else if (assetId) {
              selectAsset(assetId);
              placardEntityRef.current = picked.id as CesiumEntity;
              setPlacard((prev) => (prev && prev.kind === "asset" && prev.id === assetId ? prev : { kind: "asset", id: assetId, x: movement.position.x, y: movement.position.y }));
            }
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        handler.setInputAction((movement: MotionEvent) => {
          const cartesian = v.camera.pickEllipsoid(movement.endPosition, v.scene.globe.ellipsoid);
          if (cartesian) {
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            setMouseCoords({ lat: Cesium.Math.toDegrees(carto.latitude), lng: Cesium.Math.toDegrees(carto.longitude) });
          }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        viewerRef.current = v;

        /* ── 同步初始图层可见性 ── */
        const vis = useAppStore.getState().layerVisibility;
        for (const [layerId, groupKey] of Object.entries(LAYER_GROUPS)) {
          const visible = vis[layerId] ?? true;
          for (const ent of groups[groupKey]) ent.show = visible;
        }

        /* ── 雷达扫描动画 ── */
        let sweepAngle = 0;
        const animate = () => {
          if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
          const C = cesiumRef.current!;
          sweepAngle = (sweepAngle + 0.8) % 360;
          for (const ent of radarSweepRef.current) {
            if (!ent.show) continue;
            const props = ent.properties!;
            const lng = props._lng?.getValue() as number;
            const lat = props._lat?.getValue() as number;
            const range = props._range?.getValue() as number;
            if (lng == null || lat == null || range == null) continue;
            const coords = geoRadarSweepCoords(lng, lat, range, sweepAngle);
            const positions = coords.map(([ln, la]) => C.Cartesian3.fromDegrees(ln, la));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ent.polygon as any).hierarchy = new C.ConstantProperty(
              new C.PolygonHierarchy(positions)
            );
          }
          rafRef.current = requestAnimationFrame(animate);
        };
        rafRef.current = requestAnimationFrame(animate);

        setLoading(false);
      } catch (err) {
        console.error("CesiumJS initialization failed:", err);
        setError("3D view initialization failed.");
        setLoading(false);
      }
    };

    init();

    return () => {
      destroyed = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (placardPostRenderCleanupRef.current) placardPostRenderCleanupRef.current();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
      cesiumRef.current = null;
      radarSweepRef.current = [];
      entityGroupsRef.current = { tracks: [], assets: [], coverage: [], zones: [] };
    };
  }, [selectTrack, selectAsset, setMouseCoords]);

  /**
   * 标牌跟随：在每帧渲染后把 entity 的世界坐标投影到屏幕坐标，
   * 让 DOM 标牌贴在目标上方。
   */
  useEffect(() => {
    const v = viewerRef.current;
    const C = cesiumRef.current;
    if (!v || !C || v.isDestroyed()) return;

    if (placardPostRenderCleanupRef.current) placardPostRenderCleanupRef.current();
    placardPostRenderCleanupRef.current = null;

    if (!placard || !placardEntityRef.current) return;

    const onPostRender = () => {
      const ent = placardEntityRef.current;
      if (!ent || !placard) return;
      const time = v.clock.currentTime;
      const pos = ent.position?.getValue(time);
      if (!pos) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = (C.SceneTransforms as any).wgs84ToWindowCoordinates(v.scene, pos);
      if (!win) return;
      setPlacard((p) => (p ? { ...p, x: win.x, y: win.y } : p));
    };

    v.scene.postRender.addEventListener(onPostRender);
    placardPostRenderCleanupRef.current = () => {
      v.scene.postRender.removeEventListener(onPostRender);
    };

    return () => {
      if (placardPostRenderCleanupRef.current) placardPostRenderCleanupRef.current();
      placardPostRenderCleanupRef.current = null;
    };
  }, [placard]);

  /* ── flyTo：用 flyToBoundingSphere 让相机正确对准目标点 ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const req = state.flyToRequest;
      if (!req || req.seq === lastFlySeqRef.current) return;
      lastFlySeqRef.current = req.seq;
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;

      const target = C.Cartesian3.fromDegrees(req.lng, req.lat, 0);
      const range = req.zoom ? zoomToAltitude(req.zoom) : 80000;
      v.camera.flyToBoundingSphere(
        new C.BoundingSphere(target, 0),
        {
          offset: new C.HeadingPitchRange(0, C.Math.toRadians(-45), range),
          duration: 1.8,
        },
      );
    });
    return unsub;
  }, []);

  /* ── highlightedTrackIds ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;

      for (const ent of highlightEntitiesRef.current) v.entities.remove(ent);
      highlightEntitiesRef.current = [];

      const ids = new Set(state.highlightedTrackIds);
      if (ids.size === 0) return;

      const trackList = useTrackStore.getState().tracks.length ? useTrackStore.getState().tracks : MOCK_TRACKS;
      for (const track of trackList) {
        if (!ids.has(track.id)) continue;
        const ent = v.entities.add({
          position: C.Cartesian3.fromDegrees(track.lng, track.lat, track.altitude || 0),
          ellipse: {
            semiMajorAxis: 2000, semiMinorAxis: 2000,
            material: C.Color.YELLOW.withAlpha(0.15),
            outline: true, outlineColor: C.Color.YELLOW.withAlpha(0.8), outlineWidth: 2, height: 0,
          },
          properties: { _highlight: true },
        });
        highlightEntitiesRef.current.push(ent);
      }
    });
    return unsub;
  }, []);

  /* ── routeLines ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;
      const currentIds = new Set(state.routeLines.map((r) => r.id));

      for (const [id, ent] of routeEntitiesRef.current) {
        if (!currentIds.has(id)) { v.entities.remove(ent); routeEntitiesRef.current.delete(id); }
      }
      for (const route of state.routeLines) {
        if (routeEntitiesRef.current.has(route.id)) continue;
        const positions = route.points.map((p) => C.Cartesian3.fromDegrees(p.lng, p.lat, 0));
        const ent = v.entities.add({
          polyline: {
            positions, width: 3,
            material: new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString(route.color), dashLength: 16 }),
            clampToGround: true,
          },
          properties: { _routeId: route.id },
        });
        routeEntitiesRef.current.set(route.id, ent);
      }
    });
    return unsub;
  }, []);

  /* ── layerVisibility ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const vis = state.layerVisibility;
      for (const [layerId, groupKey] of Object.entries(LAYER_GROUPS)) {
        const visible = vis[layerId] ?? true;
        for (const ent of entityGroupsRef.current[groupKey as GroupKey]) ent.show = visible;
      }
    });
    return unsub;
  }, []);

  /* ── selectedAssetId ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const id = state.selectedAssetId;
      for (const ent of entityGroupsRef.current.assets) {
        const aid = ent.properties?.assetId?.getValue();
        if (ent.billboard) {
          ent.billboard.scale = new (cesiumRef.current!.ConstantProperty)(aid === id ? 0.85 : 0.62);
        }
      }
    });
    return unsub;
  }, []);

  /* ── selectedTrackId ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const id = state.selectedTrackId;
      for (const ent of entityGroupsRef.current.tracks) {
        const tid = ent.properties?.trackId?.getValue();
        if (ent.billboard) {
          ent.billboard.scale = new (cesiumRef.current!.ConstantProperty)(tid === id ? 0.9 : 0.68);
        }
      }
    });
    return unsub;
  }, []);

  /* ── 实时 track 数据更新 ── */
  useEffect(() => {
    const unsub = useTrackStore.subscribe((state) => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed() || !state.tracks.length) return;

      const groups = entityGroupsRef.current;
      const trackMap = new Map(state.tracks.map((t) => [t.id, t]));

      for (const ent of groups.tracks) {
        const tid = ent.properties?.trackId?.getValue() as string;
        const t = trackMap.get(tid);
        if (!t) continue;
        ent.position = new C.ConstantPositionProperty(
          C.Cartesian3.fromDegrees(t.lng, t.lat, t.altitude || 0)
        );
        if (ent.billboard) {
          ent.billboard.rotation = new C.ConstantProperty(-C.Math.toRadians(t.heading ?? 0));
        }
      }
    });
    return unsub;
  }, []);

  /* ── drawnAreas ── */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;

      const currentIds = new Set(state.drawnAreas.map((a) => a.id));
      for (const [id, ents] of areaEntitiesRef.current) {
        if (!currentIds.has(id)) {
          for (const e of ents) v.entities.remove(e);
          areaEntitiesRef.current.delete(id);
        }
      }
      for (const area of state.drawnAreas) {
        if (areaEntitiesRef.current.has(area.id)) continue;
        const positions = area.points.map((p) => C.Cartesian3.fromDegrees(p.lng, p.lat));
        const ents: CesiumEntity[] = [];
        const polyEnt = v.entities.add({
          polygon: {
            hierarchy: new C.PolygonHierarchy(positions),
            material: C.Color.fromCssColorString(area.fillColor).withAlpha(area.fillOpacity),
            outline: true,
            outlineColor: C.Color.fromCssColorString(area.color).withAlpha(0.7),
            outlineWidth: 2,
            heightReference: C.HeightReference.CLAMP_TO_GROUND,
          },
          properties: { _areaId: area.id },
        });
        ents.push(polyEnt);
        if (area.label) {
          const cLng = area.points.reduce((s, p) => s + p.lng, 0) / area.points.length;
          const cLat = area.points.reduce((s, p) => s + p.lat, 0) / area.points.length;
          const lblEnt = v.entities.add({
            position: C.Cartesian3.fromDegrees(cLng, cLat, 100),
            label: {
              text: area.label,
              font: '12px Roboto, "Noto Sans SC", sans-serif',
              fillColor: C.Color.fromCssColorString(area.color),
              outlineColor: C.Color.fromCssColorString("#09090b"),
              outlineWidth: 2,
              style: C.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: C.VerticalOrigin.CENTER,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
          ents.push(lblEnt);
        }
        areaEntitiesRef.current.set(area.id, ents);
      }
    });
    return unsub;
  }, []);

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-nexus-bg-base">
        <AlertTriangle size={24} className="text-amber-400" />
        <p className="text-sm text-nexus-text-secondary">3D 视图加载失败，请重试</p>
        <button onClick={() => window.location.reload()} className="rounded-md border border-white/[0.10] bg-white/[0.06] px-4 py-1.5 text-xs font-medium text-nexus-text-primary hover:bg-white/[0.10]">
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-nexus-bg-base/90">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-white/40" />
          <span className="mt-3 text-xs text-nexus-text-muted">加载三维地球中...</span>
        </div>
      )}
      {placard && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+14px)]"
          style={{ left: placard.x, top: placard.y }}
        >
          <TargetPlacard
            kind={placard.kind}
            id={placard.id}
            onClose={() => {
              setPlacard(null);
              placardEntityRef.current = null;
            }}
            className="pointer-events-auto"
          />
          <div
            className="pointer-events-none absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[10px] border-t-[12px] border-x-transparent border-t-[#0c0c0e]/95"
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}

function zoomToAltitude(zoom: number): number {
  return Math.max(500, 40_000_000 / Math.pow(2, zoom));
}
