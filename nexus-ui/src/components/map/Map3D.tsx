"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useMapPointerStore } from "@/stores/map-pointer-store";
import { useTrackStore } from "@/stores/track-store";
import { LYR_DB_AREAS, type Track } from "@/lib/map-entity-model";
import { useAssetStore } from "@/stores/asset-store";
import { useAppConfigStore } from "@/stores/app-config-store";
import { getTrackRenderingConfig } from "@/lib/map-app-config";
import { installDronesCesium } from "@/components/map/modules/drones-cesium";
import { installTracksCesium } from "@/components/map/modules/tracks-cesium";
import { installAssetsCesium } from "@/components/map/modules/assets-cesium";
import type { AssetDispositionIconAccent } from "@/lib/map-icons";
import { trackMapDrawHistoryTrails } from "@/components/map/modules/tracks-maplibre";
import {
  geoCircleCoords,
  geoSectorCoords,
  geoRadarSweepCoords,
  resolveTrackMarkerFill,
} from "@/lib/map-icons";
import { adaptAssetsForMap } from "@/lib/map-asset-adapter";
import { AlertTriangle } from "lucide-react";
import { TargetPlacard, type PlacardKind } from "@/components/map/TargetPlacard";
import { createCesiumBaseImageryProvider, getMap3DInitialViewFromEnv } from "@/lib/map-3d-config";
import { registerExplosionViewer3D, unregisterExplosionViewer3D } from "@/lib/map/explosion-effect";
import { buildDbAreasFeatureCollection } from "@/lib/build-db-areas-geojson";
import { dbAreaVisibilityKey, type AreaTableRow } from "@/lib/area-table-geometry";
import { useDbAreaStore } from "@/stores/db-area-store";

type CesiumModule = typeof import("cesium");
type CesiumViewer = import("cesium").Viewer;
type CesiumEntity = import("cesium").Entity;
type PositionedEvent = import("cesium").ScreenSpaceEventHandler.PositionedEvent;
type MotionEvent = import("cesium").ScreenSpaceEventHandler.MotionEvent;

/**
 * RGBA 元组 [r,g,b,a]，用于 Cesium.Color，分量范围 0–1
 */
type RGBA = [number, number, number, number];

const COVERAGE_STYLES: Record<string, { fill: RGBA; line: RGBA }> = {
  camera: { fill: [0.58, 0.2, 0.92, 0.12], line: [0.58, 0.2, 0.92, 0.4] },
  radar: { fill: [0.2, 0.83, 0.6, 0.06], line: [0.2, 0.83, 0.6, 0.25] },
  tower: { fill: [0.2, 0.83, 0.6, 0.08], line: [0.2, 0.83, 0.6, 0.3] },
  airport: { fill: [0.58, 0.64, 0.72, 0.1], line: [0.58, 0.64, 0.72, 0.35] },
  drone: { fill: [0.22, 0.74, 0.97, 0.1], line: [0.22, 0.74, 0.97, 0.35] },
  laser: { fill: [0.98, 0.55, 0.16, 0.1], line: [0.98, 0.55, 0.16, 0.38] },
  tdoa: { fill: [0.08, 0.72, 0.82, 0.1], line: [0.08, 0.72, 0.82, 0.38] },
};

const STATUS_RGBA: Record<string, RGBA> = {
  online:   [0.20, 0.83, 0.60, 0.22],
  degraded: [0.98, 0.75, 0.14, 0.18],
  offline:  [0.97, 0.44, 0.44, 0.12],
};

type GroupKey =
  | "tracks"
  | "trackTrails"
  | "assets"
  | "radarCoverage"
  | "optoFov"
  | "airportFov"
  | "droneFov"
  | "dbAreas";

/**
 * 说明：
 * 资产 `AssetData -> Asset` 统一适配已迁移到 `src/lib/map-asset-adapter.ts`（`adaptAssetsForMap`）。
 * 本文件是 3D 编排层，负责：
 * - Cesium 生命周期
 * - 3D 资产/航迹/区域实体同步
 * - 3D 交互与层显隐
 */

/** 批量创建/刷新 3D 区域实体（先清旧再建新） */
function syncCesiumDbAreas(
  viewer: CesiumViewer,
  C: CesiumModule,
  groups: { dbAreas: CesiumEntity[] },
  rows: AreaTableRow[],
  areaVisibility: Record<string, boolean>,
) {
  for (const entity of groups.dbAreas) viewer.entities.remove(entity);
  groups.dbAreas.length = 0;

  const data = buildDbAreasFeatureCollection(
    rows,
    (row) => areaVisibility[dbAreaVisibilityKey(row.group_id, row.area_id)] !== false,
  );

  for (const feature of data.features) {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const lineColorCss = String(props.lineColor ?? "#93c5fd");
    const baseColor = C.Color.fromCssColorString(lineColorCss);
    const lineOpacity = Number.isFinite(Number(props.lineOpacity)) ? Number(props.lineOpacity) : 1;
    const labelOpacity = Number.isFinite(Number(props.labelOpacity)) ? Number(props.labelOpacity) : 0.95;
    const lineWidth = Number.isFinite(Number(props.lineWidth)) ? Number(props.lineWidth) : 2;
    const lineStyle = String(props.lineStyle ?? "solid");
    const solidColor = baseColor.withAlpha(lineOpacity);
    const lineMaterial =
      lineStyle === "solid"
        ? solidColor
        : new C.PolylineDashMaterialProperty({
            color: solidColor,
            dashLength: lineStyle === "dotted" ? 4 : 16,
          });

    if (feature.geometry.type === "Polygon") {
      const ring = feature.geometry.coordinates[0] ?? [];
      if (ring.length < 2) continue;
      const positions = ring.map(([lng, lat]) => C.Cartesian3.fromDegrees(lng, lat));
      groups.dbAreas.push(
        viewer.entities.add({
          polyline: {
            positions,
            width: lineWidth,
            clampToGround: true,
            material: lineMaterial,
          },
          properties: {
            dbAreaId: props.id,
            groupId: props.groupId,
            areaId: props.areaId,
          },
        }),
      );
      continue;
    }

    if (feature.geometry.type === "LineString") {
      const coords = feature.geometry.coordinates;
      if (coords.length < 2) continue;
      const positions = coords.map(([lng, lat]) => C.Cartesian3.fromDegrees(lng, lat));
      groups.dbAreas.push(
        viewer.entities.add({
          polyline: {
            positions,
            width: lineWidth,
            clampToGround: true,
            material: lineMaterial,
          },
          properties: {
            dbAreaId: props.id,
            groupId: props.groupId,
            areaId: props.areaId,
          },
        }),
      );
      continue;
    }

    if (feature.geometry.type === "Point") {
      const [lng, lat] = feature.geometry.coordinates;
      const text = String(props.labelText ?? "").trim();
      if (!text) continue;
      groups.dbAreas.push(
        viewer.entities.add({
          position: C.Cartesian3.fromDegrees(lng, lat, 100),
          label: {
            text,
            font: '12px Roboto, "Noto Sans SC", sans-serif',
            fillColor: baseColor.withAlpha(labelOpacity),
            outlineColor: C.Color.fromCssColorString("#09090b"),
            outlineWidth: 2,
            style: C.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: C.VerticalOrigin.CENTER,
            scaleByDistance: new C.NearFarScalar(1e4, 1, 5e5, 0.4),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: {
            dbAreaId: props.id,
            groupId: props.groupId,
            areaId: props.areaId,
          },
        }),
      );
    }
  }
}

/** UAV/无人机 track 由 `drones-cesium.ts` 用 GLB 模型 + 视棱锥独立渲染 */
function isUavTrack(t: Track): boolean {
  return t.isUav === true;
}

/**
 * 三维航迹同步：
 * - **不画 billboard / label 二维图标**（所有 track 的本体最终都将由独立 3D 模型模块渲染，
 *   目前仅 UAV 在 drones-cesium 实现，其余 type 暂无模型）
 * - 仅维护历史轨迹折线（polyline，地理几何不算图标），由 `trackMapDrawHistoryTrails` 控制
 * - 旧的 billboard entity（如有遗留）会被清理
 */
async function syncCesiumTrackBillboards(
  viewer: CesiumViewer,
  Cesium: CesiumModule,
  groups: { tracks: CesiumEntity[]; trackTrails: CesiumEntity[] },
  allTracks: Track[],
  accent: AssetDispositionIconAccent,
) {
  /* 清理可能遗留的旧 billboard entity */
  for (const ent of groups.tracks) viewer.entities.remove(ent);
  groups.tracks = [];

  /* trail 始终全清重建 */
  for (const ent of groups.trackTrails) viewer.entities.remove(ent);
  groups.trackTrails = [];

  const drawableTracks = allTracks.filter((t) => !isUavTrack(t));
  const drawTrails = trackMapDrawHistoryTrails(drawableTracks);
  if (!drawTrails) return;

  const trCfg = getTrackRenderingConfig();
  const alt = (z: number | undefined) => (Number.isFinite(z) ? (z as number) : 0);
  for (const t of drawableTracks) {
    const trail = t.historyTrail;
    if (!trail || trail.length < 1) continue;
    const ts2 = trCfg.trackTypeStyles[t.type] ?? trCfg.trackTypeStyles.sea;
    const friendlyFill2 = t.disposition === "friendly" ? ts2.idColor : undefined;
    const positions = [...trail, [t.lng, t.lat] as [number, number]].map(([lng, lat]) =>
      Cesium.Cartesian3.fromDegrees(lng, lat, alt(t.altitude)),
    );
    const lineEnt = viewer.entities.add({
      polyline: {
        positions,
        width: 2,
        material: Cesium.Color.fromCssColorString(
          resolveTrackMarkerFill(t.disposition, accent, friendlyFill2),
        ).withAlpha(0.48),
        clampToGround: true,
      },
      properties: { trackTrailFor: t.id },
    });
    groups.trackTrails.push(lineEnt);
  }
}

export function Map3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const placardEntityRef = useRef<CesiumEntity | null>(null);
  const placardPostRenderCleanupRef = useRef<(() => void) | null>(null);
  const selectedGlowEntityRef = useRef<CesiumEntity | null>(null);
  const lastFlySeqRef = useRef<number>(-1);
  const highlightEntitiesRef = useRef<CesiumEntity[]>([]);
  const entityGroupsRef = useRef<Record<GroupKey, CesiumEntity[]>>({
    tracks: [],
    trackTrails: [],
    assets: [],
    radarCoverage: [],
    optoFov: [],
    airportFov: [],
    droneFov: [],
    dbAreas: [],
  });
  /** 供 `syncCesiumTrackBillboards` 与订阅 flush 使用（`loadResolvedAppConfig` 的 `assetDispositionIconAccent`） */
  const cesiumTrackAccentRef = useRef<AssetDispositionIconAccent>({});
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
  const { selectTrack, selectAsset } = useAppStore();

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

        const appCfg = await useAppConfigStore.getState().ensureLoaded();
        const assetIconAccent: AssetDispositionIconAccent = appCfg.assetDispositionIconAccent ?? {};

        const baseImagery = createCesiumBaseImageryProvider(Cesium);

        viewer = new Cesium.Viewer(containerRef.current, {
          baseLayerPicker: false, geocoder: false, homeButton: false,
          sceneModePicker: false, selectionIndicator: false, infoBox: false,
          timeline: false, animation: false, navigationHelpButton: false,
          fullscreenButton: false,
          creditContainer: document.createElement("div"),
          baseLayer: new Cesium.ImageryLayer(baseImagery),
          terrainProvider: undefined,
          requestRenderMode: false,
        });

        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#09090b");
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#111113");
        viewer.scene.globe.showGroundAtmosphere = false;
        viewer.scene.fog.enabled = false;
        viewer.scene.globe.enableLighting = false;
        viewer.scene.highDynamicRange = false;

        const { center, zoom } = getMap3DInitialViewFromEnv();
        viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(center[0], center[1], 0), 0),
          {
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), zoomToAltitude(zoom)),
            duration: 0,
          },
        );

        const v = viewer;
        const groups = entityGroupsRef.current;

        /* 1) 限制区 */
        const rgba = (c: RGBA) => new Cesium.Color(c[0], c[1], c[2], c[3]);
        const dbAreaState = useDbAreaStore.getState();
        syncCesiumDbAreas(v, Cesium, groups, dbAreaState.rows, dbAreaState.areaVisibility);

        /* 2) 雷达覆盖（圆/扫描）与光电 FOV（扇形/圆）分开展示，与 2D 图层面板两项一致 */
        const _assets = adaptAssetsForMap(useAssetStore.getState().assets);
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
                outline: false,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: { assetId: asset.id, _coverage: true },
            });
            groups.radarCoverage.push(rangeEnt);

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
              groups.radarCoverage.push(sweepEnt);
              radarSweepRef.current.push(sweepEnt);
            }
          } else {
            /* camera 的 3D 视场由 assets-cesium 统一绘制（视锥体）；
             * 这里跳过旧的贴地扇区，避免同一相机出现两套视场。
             * laser/tdoa 同样只保留 assets-cesium 的 3D 视锥渲染。 */
            if (asset.type === "camera" || asset.type === "laser" || asset.type === "tdoa") continue;
            const isSector = asset.fovAngle !== undefined && asset.fovAngle < 360 && asset.heading !== undefined;
            const coords = isSector
              ? geoSectorCoords(asset.lng, asset.lat, asset.range, asset.heading!, asset.fovAngle!)
              : geoCircleCoords(asset.lng, asset.lat, asset.range);
            const positions = coords.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat));
            const ent = v.entities.add({
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: rgba(covStyle.fill),
                outline: false,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: { assetId: asset.id, _coverage: true },
            });
            if (asset.type === "airport") groups.airportFov.push(ent);
            else if (asset.type === "drone") groups.droneFov.push(ent);
            else groups.optoFov.push(ent);
          }
        }

        /* 3) 航迹：store 全量；`historyTrail` 条数由 `maxHistoryPointsPerTrack` 裁剪；折线是否绘制受 `maxViewportPoints` 预算（与 Map2D 一致） */
        cesiumTrackAccentRef.current = assetIconAccent;
        await syncCesiumTrackBillboards(v, Cesium, groups, useTrackStore.getState().tracks, assetIconAccent);

        /* 4) 资产 billboard 已彻底取消：
         *    所有资产最终都由独立 3D 模型模块渲染（drone → drones-cesium；其余 type 待补充）。
         *    雷达圆/光电扇形等 coverage 几何在第 2 步已绘制，不属于"二维图标"故保留。 */

        /* 点击拾取航迹/资产；未命中则关标牌并清空 store 选中与高亮 */
        const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
        const clearMapSelection = () => {
          placardEntityRef.current = null;
          setPlacard(null);
          selectTrack(null);
          selectAsset(null);
          useAppStore.getState().setHighlightedTrackIds([]);
        };
        handler.setInputAction((movement: PositionedEvent) => {
          const picked = v.scene.pick(movement.position);
          if (Cesium.defined(picked) && picked.id?.properties) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const props = picked.id.properties as any;
            const trackSelectionId = props.id?.getValue?.() ?? null;
            const assetId = props.assetId?.getValue?.() ?? null;
            const droneSn = props.droneSn?.getValue?.() ?? null;
            const isCoverage = !!(props._coverage?.getValue?.() || props._radarSweep?.getValue?.());

            // 只允许点“目标本体”：航迹模型 / 资产模型 / 无人机模型。
            // 覆盖面（雷达圈、FOV、扫描扇）不触发属性卡。
            if (isCoverage) {
              clearMapSelection();
              return;
            }
            if (trackSelectionId) {
              selectAsset(null);
              selectTrack(trackSelectionId);
              placardEntityRef.current = picked.id as CesiumEntity;
              setPlacard((prev) => (prev && prev.kind === "track" && prev.id === trackSelectionId ? prev : { kind: "track", id: trackSelectionId, x: movement.position.x, y: movement.position.y }));
            } else if (assetId) {
              selectTrack(null);
              selectAsset(assetId);
              placardEntityRef.current = picked.id as CesiumEntity;
              setPlacard((prev) => (prev && prev.kind === "asset" && prev.id === assetId ? prev : { kind: "asset", id: assetId, x: movement.position.x, y: movement.position.y }));
            } else if (droneSn) {
              // 无人机模型来自 drones-cesium（properties.droneSn）：
              // 优先走 asset 卡片；若无同 id 资产，则回退到 track 卡片。
              const hasAsset = useAssetStore.getState().assets.some((a) => a.id === droneSn);
              const hasTrack = useTrackStore.getState().tracks.some((t) => t.id === droneSn);
              if (hasAsset) {
                selectTrack(null);
                selectAsset(droneSn);
                placardEntityRef.current = picked.id as CesiumEntity;
                setPlacard((prev) => (prev && prev.kind === "asset" && prev.id === droneSn ? prev : { kind: "asset", id: droneSn, x: movement.position.x, y: movement.position.y }));
              } else if (hasTrack) {
                selectAsset(null);
                selectTrack(droneSn);
                placardEntityRef.current = picked.id as CesiumEntity;
                setPlacard((prev) => (prev && prev.kind === "track" && prev.id === droneSn ? prev : { kind: "track", id: droneSn, x: movement.position.x, y: movement.position.y }));
              } else {
                clearMapSelection();
              }
            } else {
              clearMapSelection();
            }
          } else {
            clearMapSelection();
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        handler.setInputAction((movement: MotionEvent) => {
          const cartesian = v.camera.pickEllipsoid(movement.endPosition, v.scene.globe.ellipsoid);
          if (cartesian) {
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            useMapPointerStore.getState().setMouseCoords({
              lat: Cesium.Math.toDegrees(carto.latitude),
              lng: Cesium.Math.toDegrees(carto.longitude),
            });
          }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        viewerRef.current = v;
        registerExplosionViewer3D(v);

        /* 按 layerVisibility 设置各组 entity 显隐（资产 billboard 按 `assetType` 分键，与 Map2D 一致） */
        const layerVis = useAppStore.getState().layerVisibility;
        const layerOn = (k: string) => layerVis[k] !== false;
        for (const ent of groups.tracks) ent.show = layerOn("lyr-tracks");
        for (const ent of groups.trackTrails) ent.show = layerOn("lyr-tracks");
        for (const ent of groups.radarCoverage) ent.show = layerOn("lyr-radar-coverage");
        for (const ent of groups.optoFov) ent.show = layerOn("lyr-opto-fov");
        for (const ent of groups.airportFov) ent.show = layerOn("lyr-airport");
        for (const ent of groups.droneFov) ent.show = layerOn("lyr-drones");
        for (const ent of groups.dbAreas) ent.show = layerOn(LYR_DB_AREAS);
        for (const ent of groups.assets) {
          const at = ent.properties?.assetType?.getValue() as string | undefined;
          const layerKey =
            at === "radar"
              ? "lyr-radar-coverage"
              : at === "laser"
                ? "lyr-laser"
                : at === "tdoa"
                  ? "lyr-tdoa"
                  : at === "airport"
                    ? "lyr-airport"
                    : at === "drone"
                      ? "lyr-drones"
                      : "lyr-opto-fov";
          ent.show = layerOn(layerKey);
        }

        /* 雷达扫描扇动画 */
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
      if (selectedGlowEntityRef.current && viewer && !viewer.isDestroyed()) {
        viewer.entities.remove(selectedGlowEntityRef.current);
      }
      selectedGlowEntityRef.current = null;
      unregisterExplosionViewer3D();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
      cesiumRef.current = null;
      radarSweepRef.current = [];
      entityGroupsRef.current = {
        tracks: [],
        trackTrails: [],
        assets: [],
        radarCoverage: [],
        optoFov: [],
        airportFov: [],
        droneFov: [],
        dbAreas: [],
      };
    };
  }, [selectTrack, selectAsset]);

  /**
   * 将选中 entity 的世界坐标投影到屏幕，驱动标牌 DOM 位置
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
      let win: { x: number; y: number } | undefined;
      try {
        // 兼容不同 Cesium 版本：优先尝试 SceneTransforms，再回退 scene API。
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const st = (C as any).SceneTransforms;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sceneAny = v.scene as any;
        if (st && typeof st.wgs84ToWindowCoordinates === "function") {
          win = st.wgs84ToWindowCoordinates(v.scene, pos) ?? undefined;
        } else if (st && typeof st.worldToWindowCoordinates === "function") {
          win = st.worldToWindowCoordinates(v.scene, pos) ?? undefined;
        } else if (sceneAny && typeof sceneAny.cartesianToCanvasCoordinates === "function") {
          win = sceneAny.cartesianToCanvasCoordinates(pos) ?? undefined;
        } else {
          return;
        }
      } catch {
        // 投影失败时仅跳过本帧，避免抛错导致 Cesium 停止渲染。
        return;
      }
      if (!win) return;
      setPlacard((p) => (p ? { ...p, x: win.x, y: win.y } : p));
    };

    if (!v.scene) return;
    v.scene.postRender.addEventListener(onPostRender);
    placardPostRenderCleanupRef.current = () => {
      if (!v || v.isDestroyed() || !v.scene) return;
      v.scene.postRender.removeEventListener(onPostRender);
    };

    return () => {
      if (placardPostRenderCleanupRef.current) placardPostRenderCleanupRef.current();
      placardPostRenderCleanupRef.current = null;
    };
  }, [placard]);

  /**
   * 选中目标高亮：用发光球包裹目标（随实体位置实时跟随）。
   */
  useEffect(() => {
    const v = viewerRef.current;
    const C = cesiumRef.current;
    if (!v || !C || v.isDestroyed()) return;

    if (selectedGlowEntityRef.current) {
      v.entities.remove(selectedGlowEntityRef.current);
      selectedGlowEntityRef.current = null;
    }
    if (!placard || !placardEntityRef.current) return;

    const targetEntity = placardEntityRef.current;
    const fillColor = placard.kind === "track"
      ? C.Color.fromCssColorString("#ffd43b").withAlpha(0.18)
      : C.Color.fromCssColorString("#67e8f9").withAlpha(0.18);
    const edgeColor = placard.kind === "track"
      ? C.Color.fromCssColorString("#ffe66d").withAlpha(0.9)
      : C.Color.fromCssColorString("#a5f3fc").withAlpha(0.9);

    selectedGlowEntityRef.current = v.entities.add({
      position: new C.CallbackPositionProperty(() => {
        const p = targetEntity.position;
        if (!p) return undefined;
        return p.getValue(v.clock.currentTime);
      }, false),
      ellipsoid: {
        radii: new C.ConstantProperty(new C.Cartesian3(20, 20, 20)),
        material: fillColor,
        outline: true,
        outlineColor: edgeColor,
        outlineWidth: 2,
      },
      properties: { _selectedGlow: true },
    });

    return () => {
      if (!v || v.isDestroyed()) return;
      if (selectedGlowEntityRef.current) {
        v.entities.remove(selectedGlowEntityRef.current);
        selectedGlowEntityRef.current = null;
      }
    };
  }, [placard]);

  /* flyTo：flyToBoundingSphere 与 zoom→高度 */
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

  /* 高亮：highlightedTrackIds */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;

      for (const ent of highlightEntitiesRef.current) v.entities.remove(ent);
      highlightEntitiesRef.current = [];

      const ids = new Set(state.highlightedTrackIds);
      if (ids.size === 0) return;
      // 点击选中单目标时，app-store 会把 highlightedTrackIds 设为 [selectedTrackId]。
      // 这里不再为“仅选中”画范围圆，避免用户误以为是目标附加覆盖范围。
      if (state.selectedTrackId && ids.size === 1 && ids.has(state.selectedTrackId)) return;

      const trackList = useTrackStore.getState().tracks;
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

  /* 订阅 layerVisibility（与 Map2D `ALL_DATA_LAYER_IDS` 一致；资产 billboard 按 `assetType` 分键） */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const layerVis = state.layerVisibility;
      const layerOn = (k: string) => layerVis[k] !== false;
      const g = entityGroupsRef.current;
      for (const ent of g.tracks) ent.show = layerOn("lyr-tracks");
      for (const ent of g.trackTrails) ent.show = layerOn("lyr-tracks");
      for (const ent of g.radarCoverage) ent.show = layerOn("lyr-radar-coverage");
      for (const ent of g.optoFov) ent.show = layerOn("lyr-opto-fov");
      for (const ent of g.airportFov) ent.show = layerOn("lyr-airport");
      for (const ent of g.droneFov) ent.show = layerOn("lyr-drones");
      for (const ent of g.dbAreas) ent.show = layerOn(LYR_DB_AREAS);
      for (const ent of g.assets) {
        const at = ent.properties?.assetType?.getValue() as string | undefined;
        const layerKey =
          at === "radar"
            ? "lyr-radar-coverage"
            : at === "laser"
              ? "lyr-laser"
              : at === "tdoa"
                ? "lyr-tdoa"
                : at === "airport"
                  ? "lyr-airport"
                  : at === "drone"
                    ? "lyr-drones"
                    : "lyr-opto-fov";
        ent.show = layerOn(layerKey);
      }
    });
    return unsub;
  }, []);

  /* 选中放大：selectedAssetId */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const id = state.selectedAssetId;
      for (const ent of entityGroupsRef.current.assets) {
        const aid = ent.properties?.assetId?.getValue();
        if (ent.billboard) {
          ent.billboard.scale = new (cesiumRef.current!.ConstantProperty)(aid === id ? 1.05 : 0.82);
        }
      }
    });
    return unsub;
  }, []);

  /* 选中放大：selectedTrackId */
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const id = state.selectedTrackId;
      for (const ent of entityGroupsRef.current.tracks) {
        const tid = ent.properties?.id?.getValue();
        if (ent.billboard) {
          ent.billboard.scale = new (cesiumRef.current!.ConstantProperty)(tid === id ? 1.12 : 0.90);
        }
      }
    });
    return unsub;
  }, []);

  /* 区域：响应式同步（WS 推送新区域时自动刷新） */
  useEffect(() => {
    const flush = () => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;
      const { rows, areaVisibility } = useDbAreaStore.getState();
      syncCesiumDbAreas(v, C, entityGroupsRef.current, rows, areaVisibility);
      const layerOn = useAppStore.getState().layerVisibility[LYR_DB_AREAS] !== false;
      for (const ent of entityGroupsRef.current.dbAreas) ent.show = layerOn;
    };

    flush();
    return useDbAreaStore.subscribe(flush);
  }, []);

  /* 航迹：store 全量 → billboard；折线按 `trackMapDrawHistoryTrails`（异步 flush） */
  useEffect(() => {
    let cancelled = false;
    let flushRunning = false;
    let flushAgain = false;

    const flush = async () => {
      const v = viewerRef.current;
      const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed() || cancelled) return;
      if (flushRunning) {
        flushAgain = true;
        return;
      }
      flushRunning = true;
      try {
        do {
          flushAgain = false;
          const snap = useTrackStore.getState().tracks;
          await syncCesiumTrackBillboards(v, C, entityGroupsRef.current, snap, cesiumTrackAccentRef.current);
        } while (flushAgain && !cancelled);
      } finally {
        flushRunning = false;
      }
      if (flushAgain && !cancelled) void flush();
    };

    const unsub = useTrackStore.subscribe(() => {
      void flush();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  /** 实时机队（与 2D `drones-maplibre.ts` 同源）：模型 + 视棱锥，封装在 `drones-cesium.ts` */
  useEffect(
    () =>
      installDronesCesium({
        getViewer: () => viewerRef.current,
        getCesium: () => cesiumRef.current,
      }),
    [],
  );

  /** 航迹 3D 模型：air→warningPlane.glb, sea→noManBoat.glb，封装在 `tracks-cesium.ts` */
  useEffect(
    () =>
      installTracksCesium({
        getViewer: () => viewerRef.current,
        getCesium: () => cesiumRef.current,
      }),
    [],
  );

  /** 资产 3D 模型：radar/camera/tower/tdoa/airport，封装在 `assets-cesium.ts` */
  useEffect(
    () =>
      installAssetsCesium({
        getViewer: () => viewerRef.current,
        getCesium: () => cesiumRef.current,
      }),
    [],
  );

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-nexus-bg-base">
        <AlertTriangle size={24} className="text-amber-400" />
        <p className="text-sm text-nexus-text-secondary">3D 视图初始化失败，请刷新重试</p>
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
          <span className="mt-3 text-xs text-nexus-text-muted">正在加载三维场景…</span>
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

