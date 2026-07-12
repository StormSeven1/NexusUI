/**
 * 三维航迹模型渲染模块。
 *
 * 模型映射：
 *   - air        → MQ-9.glb
 *   - sea        → noManBoat.glb
 *   - underwater → noManBoat.glb
 *
 * 更新策略：diff，仅对新增 / 移除 / 位置变化的航迹执行 entity 操作
 */

import { useTrackStore } from "@/stores/track-store";
import { resolveAliasKey, useTrackAliasStore } from "@/stores/track-alias-store";
import type { Track } from "@/lib/map-entity-model";
import { getTrackTargetStateColor } from "@/lib/map-app-config";

type CesiumModule = typeof import("cesium");
type CesiumViewer = import("cesium").Viewer;
type CesiumEntity = import("cesium").Entity;

/* ── 模型路径 ── */
const TRACK_MODEL_URIS: Record<Track["type"], string> = {
  air: "/3dmodules/MQ-9.glb",
  sea: "/3dmodules/noManBoat.glb",
  underwater: "/3dmodules/noManBoat.glb",
};

const MODEL_SCALE = 8;
const MODEL_MIN_PIXEL_SIZE = 32;
const MODEL_MAX_SCALE = 8000;

/** 单条航迹 entity（model + label） */
interface TrackEntitySet {
  entity: CesiumEntity;
}

/** UAV 航迹由 drones-cesium 独立管理，此处跳过 */
function isUavTrack(t: Track): boolean {
  return t.isUav === true;
}

/** 三维标签文本：优先别名，无别名时回退原名称/ID。 */
function getTrackLabelText(track: Track): string {
  const aliasKey = resolveAliasKey(track);
  if (aliasKey) {
    const alias = useTrackAliasStore.getState().getOrCreate(aliasKey);
    if (alias) return alias;
  }
  return track.name || "";
}

function targetStateCesiumColor(C: CesiumModule, track: Track) {
  const color = getTrackTargetStateColor(track.targetState);
  return color ? C.Color.fromCssColorString(color) : null;
}

function applyTargetStateColor(C: CesiumModule, entity: CesiumEntity, track: Track): void {
  const color = targetStateCesiumColor(C, track);
  if (entity.model) {
    const model = entity.model as unknown as {
      color?: unknown;
      colorBlendMode?: unknown;
      colorBlendAmount?: unknown;
    };
    model.color = color ? new C.ConstantProperty(color) : undefined;
    model.colorBlendMode = color ? new C.ConstantProperty(C.ColorBlendMode.MIX) : undefined;
    model.colorBlendAmount = color ? new C.ConstantProperty(0.72) : undefined;
  }
  if (entity.label) {
    entity.label.fillColor = new C.ConstantProperty(color ?? C.Color.WHITE);
  }
}

/* ── 创建 / 更新 / 移除 ── */

function createTrackEntity(
  viewer: CesiumViewer,
  C: CesiumModule,
  track: Track,
): TrackEntitySet {
  const uri = TRACK_MODEL_URIS[track.type] ?? TRACK_MODEL_URIS.sea;
  const alt = Number.isFinite(track.altitude) ? (track.altitude as number) : 0;
  const pos = C.Cartesian3.fromDegrees(track.lng, track.lat, alt);
  const headingDeg = track.type === "air" ? (track.heading ?? 0) - 90 : (track.heading ?? 0);
  const hpr = new C.HeadingPitchRoll(C.Math.toRadians(headingDeg), 0, 0);
  const orientation = C.Transforms.headingPitchRollQuaternion(pos, hpr);
  const stateColor = targetStateCesiumColor(C, track);

  const entity = viewer.entities.add({
    position: new C.ConstantPositionProperty(pos),
    orientation: new C.ConstantProperty(orientation),
    model: {
      uri,
      scale: MODEL_SCALE,
      minimumPixelSize: MODEL_MIN_PIXEL_SIZE,
      maximumScale: MODEL_MAX_SCALE,
      heightReference: C.HeightReference.NONE,
      ...(stateColor
        ? {
            color: stateColor,
            colorBlendMode: C.ColorBlendMode.MIX,
            colorBlendAmount: 0.72,
          }
        : {}),
    },
    label: {
      text: getTrackLabelText(track),
      font: "12px sans-serif",
      fillColor: stateColor ?? C.Color.WHITE,
      style: C.LabelStyle.FILL_AND_OUTLINE,
      outlineWidth: 2,
      verticalOrigin: C.VerticalOrigin.BOTTOM,
      pixelOffset: new C.Cartesian2(0, -20),
      scaleByDistance: new C.NearFarScalar(1e4, 1, 5e5, 0.4),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: {
      id: track.id,
      targetID: track.targetID,
      external_target_id: track.external_target_id ?? null,
      kind: "track",
      targetState: track.targetState ?? null,
    },
  });
  return { entity };
}

function updateTrackEntity(C: CesiumModule, set: TrackEntitySet, track: Track): void {
  const alt = Number.isFinite(track.altitude) ? (track.altitude as number) : 0;
  const pos = C.Cartesian3.fromDegrees(track.lng, track.lat, alt);
  const headingDeg = track.type === "air" ? (track.heading ?? 0) - 90 : (track.heading ?? 0);
  const hpr = new C.HeadingPitchRoll(C.Math.toRadians(headingDeg), 0, 0);
  const orientation = C.Transforms.headingPitchRollQuaternion(pos, hpr);
  set.entity.position = new C.ConstantPositionProperty(pos);
  set.entity.orientation = new C.ConstantProperty(orientation);
  if (set.entity.label) {
    set.entity.label.text = new C.ConstantProperty(getTrackLabelText(track));
  }
  if (set.entity.properties) {
    set.entity.properties.targetState = new C.ConstantProperty(track.targetState ?? null);
  }
  applyTargetStateColor(C, set.entity, track);
}

function removeTrackEntity(viewer: CesiumViewer, set: TrackEntitySet): void {
  viewer.entities.remove(set.entity);
}

/* ── 渲染器类 ── */

export class TracksCesium {
  private map = new Map<string, TrackEntitySet>();
  private opts: { getViewer: () => CesiumViewer | null; getCesium: () => CesiumModule | null };
  private raf: number | null = null;
  private unsubTrack: (() => void) | null = null;
  private unsubAlias: (() => void) | null = null;

  constructor(opts: { getViewer: () => CesiumViewer | null; getCesium: () => CesiumModule | null }) {
    this.opts = opts;
  }

  install(): void {
    this.unsubTrack = useTrackStore.subscribe(() => this.scheduleFlush());
    this.unsubAlias = useTrackAliasStore.subscribe(() => this.scheduleFlush());
    this.scheduleFlush();
  }

  uninstall(): void {
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.unsubTrack?.(); this.unsubTrack = null;
    this.unsubAlias?.(); this.unsubAlias = null;
    const v = this.opts.getViewer();
    if (v && !v.isDestroyed()) {
      for (const s of this.map.values()) removeTrackEntity(v, s);
    }
    this.map.clear();
  }

  private scheduleFlush(): void {
    if (this.raf != null) return;
    this.raf = requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    this.raf = null;
    const v = this.opts.getViewer();
    const C = this.opts.getCesium();
    if (!v || !C || v.isDestroyed()) return;

    const tracks: Track[] = useTrackStore.getState().tracks.filter((t: Track) => !isUavTrack(t));
    const seen = new Set<string>();
    for (const t of tracks) {
      seen.add(t.id);
      const existing = this.map.get(t.id);
      if (existing) {
        updateTrackEntity(C, existing, t);
      } else {
        this.map.set(t.id, createTrackEntity(v, C, t));
      }
    }
    for (const [id, s] of [...this.map]) {
      if (seen.has(id)) continue;
      removeTrackEntity(v, s);
      this.map.delete(id);
    }
  }
}

export function installTracksCesium(opts: {
  getViewer: () => CesiumViewer | null;
  getCesium: () => CesiumModule | null;
}): () => void {
  const tracks = new TracksCesium(opts);
  tracks.install();
  return () => tracks.uninstall();
}

