"use client";

import {
  LYR_AIRPORT,
  LYR_DB_AREAS,
  LYR_DISTANCE_RINGS,
  LYR_DRONES,
  LYR_LASER,
  LYR_MEASURE,
  LYR_OPTO_FOV,
  LYR_RADAR_COVERAGE,
  LYR_TDOA,
  LYR_TOWER,
  LYR_TRACKS,
  type Track,
} from "@/lib/map-entity-model";
import type { TaskManagerMapCommand } from "@/lib/knowledge-base-chat-sse";
import { useAppStore } from "@/stores/app-store";
import { useTrackStore } from "@/stores/track-store";

export type TaskManagerMapCommandResult = {
  ok: boolean;
  message: string;
  data?: unknown;
};

/** 与任务管理 map-tool-v1 `layer_id` 枚举对齐，映射到 Nexus 内部图层 id */
const LAYER_ID_ALIASES: Record<string, string> = {
  drones: LYR_DRONES,
  drone: LYR_DRONES,
  tracks: LYR_TRACKS,
  track: LYR_TRACKS,
  tracks_air: LYR_TRACKS,
  tracks_sea: LYR_TRACKS,
  radar: LYR_RADAR_COVERAGE,
  opto: LYR_OPTO_FOV,
  camera: LYR_OPTO_FOV,
  tower: LYR_TOWER,
  airport: LYR_AIRPORT,
  laser: LYR_LASER,
  tdoa: LYR_TDOA,
  areas: LYR_DB_AREAS,
  db_areas: LYR_DB_AREAS,
  measure: LYR_MEASURE,
  distance_rings: LYR_DISTANCE_RINGS,
  // 当前地图尚未拆独立图层时，先落到最接近的业务图层
  usv: LYR_TRACKS,
  missile: LYR_TRACKS,
};

function findTrackById(trackId: string): Track | null {
  const id = trackId.trim();
  if (!id) return null;
  const tracks = useTrackStore.getState().tracks;
  for (const t of tracks) {
    if (t.showID === id || t.uniqueID === id || t.trackId === id || t.id === id) return t;
    if (t.trackId != null && String(t.trackId) === id) return t;
  }
  return null;
}

function resolveLayerId(raw: unknown): string | null {
  const id = String(raw ?? "").trim();
  if (!id) return null;
  return LAYER_ID_ALIASES[id.toLowerCase()] ?? id;
}

function getAvailableBasemaps(): Array<{ id: string; name: string; kind: "vector" | "raster" }> {
  const app = useAppStore.getState();
  const out: Array<{ id: string; name: string; kind: "vector" | "raster" }> = [];
  if (app.basemapStyleName?.trim()) {
    out.push({ id: app.basemapStyleName.trim(), name: app.basemapStyleName.trim(), kind: "vector" });
  }
  for (const layer of app.basemapRasterLayers) {
    out.push({ id: layer.id, name: layer.name, kind: "raster" });
  }
  return out;
}

function setBasemapById(basemapId: string): TaskManagerMapCommandResult {
  const id = basemapId.trim();
  if (!id) return { ok: false, message: "未指定底图 id。" };

  const app = useAppStore.getState();
  const raster = app.basemapRasterLayers.find((l) => l.id === id);
  if (raster) {
    for (const layer of app.basemapRasterLayers) {
      app.setBasemapRasterLayerVisible(layer.id, layer.id === id);
    }
    app.setBasemapGroupVisible(true);
    return { ok: true, message: `已切换栅格底图：${raster.name}` };
  }

  if (app.basemapStyleName?.trim() === id) {
    app.setBasemapGroupVisible(true);
    app.setBasemapVectorLayersVisible(true);
    return { ok: true, message: `当前矢量底图已是：${id}` };
  }

  return {
    ok: false,
    message: `未找到底图「${id}」。可用底图：${getAvailableBasemaps()
      .map((b) => b.id)
      .join("、") || "（无）"}`,
  };
}

function formatBasemapListResult(basemaps: ReturnType<typeof getAvailableBasemaps>): string {
  if (basemaps.length === 0) return "当前未配置可用底图。";
  return basemaps.map((b) => `${b.name}（${b.id}，${b.kind}）`).join("\n");
}

export function executeTaskManagerMapCommand(
  command: TaskManagerMapCommand,
): TaskManagerMapCommandResult {
  const tool = command.tool_name.trim();
  const args = command.arguments ?? {};
  const app = useAppStore.getState();

  switch (tool) {
    case "map.list_basemaps": {
      const basemaps = getAvailableBasemaps();
      return {
        ok: true,
        message: formatBasemapListResult(basemaps),
        data: basemaps,
      };
    }

    case "map.get_basemap": {
      const basemaps = getAvailableBasemaps();
      const visibleRaster = app.basemapRasterLayers.find(
        (l) => app.basemapRasterVisibility[l.id] !== false,
      );
      const current =
        visibleRaster != null
          ? { id: visibleRaster.id, name: visibleRaster.name, kind: "raster" as const }
          : app.basemapStyleName?.trim()
            ? {
                id: app.basemapStyleName.trim(),
                name: app.basemapStyleName.trim(),
                kind: "vector" as const,
              }
            : null;
      return {
        ok: true,
        message: current
          ? `当前底图：${current.name}（${current.id}，${current.kind}）`
          : "当前未检测到激活底图。",
        data: { current, available: basemaps },
      };
    }

    case "map.get_view": {
      const center = app.mapCenter;
      const zoom = app.zoomLevel;
      if (!center) {
        return { ok: false, message: "当前地图视角尚未同步到前端状态。" };
      }
      return {
        ok: true,
        message: `当前视角：经度 ${center.lng.toFixed(6)}，纬度 ${center.lat.toFixed(6)}，缩放 ${zoom}`,
        data: { lng: center.lng, lat: center.lat, zoom },
      };
    }

    case "map.set_basemap": {
      const basemap = String(args.basemap ?? args.basemap_id ?? args.id ?? "").trim();
      return setBasemapById(basemap);
    }

    case "map.set_layer_visible": {
      const layerId = resolveLayerId(args.layer_id ?? args.layerId);
      if (!layerId) return { ok: false, message: "map.set_layer_visible 缺少 layer_id。" };
      const visibleRaw = args.visible;
      const visible =
        typeof visibleRaw === "boolean"
          ? visibleRaw
          : String(visibleRaw ?? "true").trim().toLowerCase() !== "false";
      app.setLayerVisibility(layerId, visible);
      return {
        ok: true,
        message: `已${visible ? "显示" : "隐藏"}图层 ${String(args.layer_id ?? layerId)}`,
      };
    }

    case "map.fly_to_track": {
      const trackId = String(args.track_id ?? args.trackId ?? args.id ?? "").trim();
      if (!trackId) return { ok: false, message: "map.fly_to_track 缺少 track_id。" };
      const track = findTrackById(trackId);
      if (!track) {
        return { ok: false, message: `未在当前航迹列表中找到目标 ${trackId}。` };
      }
      app.selectTrack(track.id);
      app.requestFlyTo(track.lat, track.lng, typeof args.zoom === "number" ? args.zoom : 14);
      return { ok: true, message: `地图已飞向目标 ${trackId}` };
    }

    default:
      return {
        ok: false,
        message: `暂未实现的地图指令：${tool}`,
      };
  }
}

export function formatMapCommandFeedback(
  command: TaskManagerMapCommand,
  result: TaskManagerMapCommandResult,
): string {
  const prefix = result.ok ? "✓" : "⚠";
  const expects = command.expects_result ? "（查询结果）" : "";
  return `${prefix} ${command.tool_name}${expects}：${result.message}`;
}
