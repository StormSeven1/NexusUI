/**
 * 三维无人机渲染模块（与二维 `drones-maplibre.ts` 同源、对称）。
 *
 * 数据流（与二维一致）：
 *   useDroneStore → mergedDronePose / latestPayloadForFov → 每架 drone 一组 entity
 *
 * 视觉构成（每架 drone）：
 *   - GLB 模型（MQ-9.glb）：随 pose 实时更新位置/朝向
 *   - 视棱锥底面 polygon：4 角射线对 WGS84 椭球求交（perPositionHeight）
 *   - 视棱锥侧面 polygon × 4：origin→corner[i]→corner[(i+1)%4] 填充三角形
 *
 * 视棱锥几何：
 *   - 对地（射线下俯且 t < maxRange）→ 取交点（地面投影梯形/扇形）
 *   - 对空（仰视或超出最大距离）→ 沿射线截断到 maxRangeM（四棱台远端）
 *
 * 角度约定（与二维一致）：
 *   - heading: 度，0=正北，顺时针
 *   - pitch: 度，正=抬头，负=俯视（gimbal_pitch 优先；fallback attitude_pitch；再 fallback −30°）
 *   - yaw: 度，gimbal_yaw 优先；fallback pose.headingDeg
 *
 * 配置（`drones.*`）：
 *   - horizontalFov（默认 30°）；垂直 = 水平 × 0.75（4:3 sensor 典型比例）
 *   - maxFovRange（默认 3000m）
 */

import { useDroneStore } from "@/stores/drone-store";
import { useAppStore } from "@/stores/app-store";
import { getDroneMapRenderingConfig } from "@/lib/map-app-config";
import {
  mergedDronePose,
  latestPayloadForFov,
} from "@/components/map/modules/drones-maplibre";

type CesiumModule = typeof import("cesium");
type CesiumViewer = import("cesium").Viewer;
type CesiumEntity = import("cesium").Entity;
type Cartesian3 = import("cesium").Cartesian3;

/** 模型本体路径（标准 PBR，无 glTF 扩展） */
const DRONE_MODEL_URI = "/3dmodules/MQ-9.glb";
/** 没有遥测高度时的兜底飞行高度（米） */
const DRONE_FALLBACK_ALT_M = 10;
/** 模型外部缩放：原始 2m × 8 = 16m */
const DRONE_MODEL_SCALE = 8;
/** 屏幕最小像素，远视角下保底可见 */
const DRONE_MODEL_MIN_PIXEL_SIZE = 56;
/** 贴近视角时的最大世界尺寸（米），防止占满屏 */
const DRONE_MODEL_MAXIMUM_SCALE = 4000;
/** 视棱锥色（与二维 fovFillColor / fovLineColor 风格一致） */
const DRONE_FRUSTUM_FILL_RGBA: [number, number, number, number] = [0.22, 0.74, 0.97, 0.18];
/* 边线颜色已移除——四边改为填充面 */
/** 视场角默认值（载荷未携带 fov 字段时使用），水平/垂直均 10° */
const DRONE_DEFAULT_HFOV_DEG = 10;
const DRONE_DEFAULT_VFOV_DEG = 10;
/** 默认俯仰（无任何 pitch 字段时） */
const DRONE_DEFAULT_PITCH_DEG = -30;
/** 关联的图层 key（与二维 LayerPanel 一致） */
const DRONE_LAYER_KEY = "lyr-drones";

/** 闭包可变状态——CallbackProperty 每帧读取 */
interface FrustumState {
  origin: Cartesian3;
  corners: Cartesian3[];
}

/** 一架无人机的全部 3D entity 集合 */
interface DroneEntitySet {
  model: CesiumEntity;
  frustumGround: CesiumEntity;
  /** 4 个侧面填充三角形（origin→corner[i]→corner[(i+1)%4]） */
  frustumSides: CesiumEntity[];
  /** CallbackProperty 共享的可变状态 */
  state: FrustumState;
}

/** ENU 局部方向：yaw 从北顺时针，pitch 抬头为正 */
function frustumDirectionEnu(
  C: CesiumModule,
  yawDeg: number,
  pitchDeg: number,
): Cartesian3 {
  const yaw = C.Math.toRadians(yawDeg);
  const pitch = C.Math.toRadians(pitchDeg);
  const cosP = Math.cos(pitch);
  return new C.Cartesian3(Math.sin(yaw) * cosP, Math.cos(yaw) * cosP, Math.sin(pitch));
}

/** ENU 方向 → ECEF（world）方向，单位化 */
function enuDirToEcef(C: CesiumModule, origin: Cartesian3, dirEnu: Cartesian3): Cartesian3 {
  const m = C.Transforms.eastNorthUpToFixedFrame(origin);
  const out = new C.Cartesian3();
  C.Matrix4.multiplyByPointAsVector(m, dirEnu, out);
  return C.Cartesian3.normalize(out, out);
}

/**
 * 视棱锥 4 个底面角（tl-tr-br-bl）：
 * 对地用射线-椭球交点，对空/超出 maxRange 截断。
 */
function computeFrustumCorners(
  C: CesiumModule,
  origin: Cartesian3,
  yawDeg: number,
  pitchDeg: number,
  hfovDeg: number,
  vfovDeg: number,
  maxRangeM: number,
): Cartesian3[] {
  const halfH = hfovDeg / 2;
  const halfV = vfovDeg / 2;
  const dirs: Array<[number, number]> = [
    [-1, +1], [+1, +1], [+1, -1], [-1, -1],
  ];
  const corners: Cartesian3[] = [];
  const ellipsoid = C.Ellipsoid.WGS84;
  for (const [hs, vs] of dirs) {
    const yawI = yawDeg + hs * halfH;
    const pitchI = pitchDeg + vs * halfV;
    const dirEnu = frustumDirectionEnu(C, yawI, pitchI);
    const dirEcef = enuDirToEcef(C, origin, dirEnu);
    const ray = new C.Ray(origin, dirEcef);
    const hit = C.IntersectionTests.rayEllipsoid(ray, ellipsoid);
    const t = hit && hit.start >= 0 && hit.start < maxRangeM ? hit.start : maxRangeM;
    corners.push(C.Ray.getPoint(ray, t));
  }
  return corners;
}

/** 创建一架无人机的 entity 集合 */
function createDroneEntitySet(
  viewer: CesiumViewer,
  C: CesiumModule,
  sn: string,
): DroneEntitySet {
  const fillCol = new C.Color(...DRONE_FRUSTUM_FILL_RGBA);
  const model = viewer.entities.add({
    model: {
      uri: DRONE_MODEL_URI,
      scale: DRONE_MODEL_SCALE,
      minimumPixelSize: DRONE_MODEL_MIN_PIXEL_SIZE,
      maximumScale: DRONE_MODEL_MAXIMUM_SCALE,
      heightReference: C.HeightReference.NONE,
    },
    properties: { droneSn: sn, kind: "model" },
  });
  /* 闭包可变状态——CallbackProperty 每帧读取 */
  const state: FrustumState = { origin: C.Cartesian3.ZERO, corners: [] };

  const frustumGround = viewer.entities.add({
    show: false,
    polygon: {
      hierarchy: new C.CallbackProperty(() => {
        if (!state.corners.length) return new C.PolygonHierarchy([]);
        return new C.PolygonHierarchy([...state.corners]);
      }, false),
      perPositionHeight: true,
      material: fillCol,
      outline: false,
    },
    properties: { droneSn: sn, kind: "frustumPolygon" },
  });
  const frustumSides: CesiumEntity[] = [];
  for (let i = 0; i < 4; i++) {
    frustumSides.push(
      viewer.entities.add({
        show: false,
        polygon: {
          hierarchy: new C.CallbackProperty(() => {
            if (!state.corners.length) return new C.PolygonHierarchy([]);
            return new C.PolygonHierarchy([
              state.origin, state.corners[i], state.corners[(i + 1) % 4],
            ]);
          }, false),
          perPositionHeight: true,
          material: fillCol,
          outline: false,
        },
        properties: { droneSn: sn, kind: "frustumSide", sideIndex: i },
      }),
    );
  }
  return { model, frustumGround, frustumSides, state };
}

/** 移除一架无人机的全部 entity */
function removeDroneEntitySet(viewer: CesiumViewer, set: DroneEntitySet) {
  viewer.entities.remove(set.model);
  viewer.entities.remove(set.frustumGround);
  for (const e of set.frustumSides) viewer.entities.remove(e);
}

/** 用最新姿态/视场参数更新一架无人机的全部 entity */
function updateDroneEntitySet(
  C: CesiumModule,
  set: DroneEntitySet,
  args: {
    lat: number;
    lng: number;
    altM: number;
    headingDeg: number;
    yawDeg: number;
    pitchDeg: number;
    hfovDeg: number;
    vfovDeg: number;
    maxRangeM: number;
  },
) {
  const origin = C.Cartesian3.fromDegrees(args.lng, args.lat, args.altM);
  const hpr = new C.HeadingPitchRoll(C.Math.toRadians(args.headingDeg), 0, 0);
  const orientation = C.Transforms.headingPitchRollQuaternion(origin, hpr);
  set.model.position = new C.ConstantPositionProperty(origin);
  set.model.orientation = new C.ConstantProperty(orientation);

  const corners = computeFrustumCorners(
    C, origin, args.yawDeg, args.pitchDeg, args.hfovDeg, args.vfovDeg, args.maxRangeM,
  );
  /* 写入闭包状态，CallbackProperty 下一帧自动读取最新值 */
  set.state.origin = origin;
  set.state.corners.length = 0;
  for (const c of corners) set.state.corners.push(c);
}

/**
 * 三维无人机渲染器。
 *
 * 用法（与二维 `DronesMaplibre` 类风格对齐）：
 * ```ts
 * const drones = new DronesCesium({
 *   getViewer: () => viewerRef.current,
 *   getCesium: () => cesiumRef.current,
 * });
 * drones.install();
 * // ... 卸载
 * drones.uninstall();
 * ```
 *
 * 也提供 `installDronesCesium(opts)` 函数式入口，返回 cleanup，方便在 React useEffect 里使用。
 */
export class DronesCesium {
  private opts: {
    getViewer: () => CesiumViewer | null;
    getCesium: () => CesiumModule | null;
    /** 可选：图层显隐探测；默认读 useAppStore.layerVisibility["lyr-drones"] */
    isLayerOn?: () => boolean;
  };
  private map = new Map<string, DroneEntitySet>();
  private raf: number | null = null;
  private unsubDrone: (() => void) | null = null;
  private unsubLayer: (() => void) | null = null;
  private installed = false;

  constructor(opts: {
    getViewer: () => CesiumViewer | null;
    getCesium: () => CesiumModule | null;
    isLayerOn?: () => boolean;
  }) {
    this.opts = opts;
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.schedule();
    this.unsubDrone = useDroneStore.subscribe(() => this.schedule());
    this.unsubLayer = useAppStore.subscribe(() => this.schedule());
  }

  uninstall(): void {
    if (!this.installed) return;
    this.installed = false;
    this.unsubDrone?.();
    this.unsubDrone = null;
    this.unsubLayer?.();
    this.unsubLayer = null;
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    const v = this.opts.getViewer();
    if (v && !v.isDestroyed()) {
      for (const [, set] of this.map) removeDroneEntitySet(v, set);
    }
    this.map.clear();
  }

  private schedule(): void {
    if (this.raf != null) return;
    this.raf = requestAnimationFrame(() => this.flush());
  }

  private isLayerOn(): boolean {
    if (this.opts.isLayerOn) return this.opts.isLayerOn();
    return useAppStore.getState().layerVisibility[DRONE_LAYER_KEY] !== false;
  }

  private flush(): void {
    this.raf = null;
    const v = this.opts.getViewer();
    const C = this.opts.getCesium();
    if (!v || !C || v.isDestroyed()) return;

    const drones = useDroneStore.getState().drones;
    const cfg = getDroneMapRenderingConfig();
    const visible = this.isLayerOn();
    const seen = new Set<string>();

    for (const sn of Object.keys(drones)) {
      const tele = drones[sn];
      const pose = mergedDronePose(tele);
      if (!pose) continue;
      const raw = latestPayloadForFov(tele);

      const h = Number(raw?.height ?? raw?.altitude ?? raw?.alt);
      const altM = Number.isFinite(h) && h > 0 ? h : DRONE_FALLBACK_ALT_M;
      const gimbalYaw = Number(
        raw?.gimbal_yaw ?? (raw?.gimbal as Record<string, unknown> | undefined)?.yaw ?? raw?.attitude_head,
      );
      const gimbalPitch = Number(
        raw?.gimbal_pitch ?? (raw?.gimbal as Record<string, unknown> | undefined)?.pitch,
      );
      const attitudePitch = Number(
        raw?.attitude_pitch ?? (raw?.attitude as Record<string, unknown> | undefined)?.pitch,
      );
      const yawDeg = Number.isFinite(gimbalYaw) ? gimbalYaw : pose.headingDeg;
      const pitchDeg = Number.isFinite(gimbalPitch)
        ? gimbalPitch
        : Number.isFinite(attitudePitch)
          ? attitudePitch
          : DRONE_DEFAULT_PITCH_DEG;
      /* 载荷未携带 hfov/vfov 字段时，按用户约定固定 10°（典型相机长焦视场） */
      const rawHfov = Number(raw?.hfov ?? raw?.fov_h ?? raw?.horizontalFov);
      const rawVfov = Number(raw?.vfov ?? raw?.fov_v ?? raw?.verticalFov);
      const hfovDeg = Number.isFinite(rawHfov) && rawHfov > 0 ? rawHfov : DRONE_DEFAULT_HFOV_DEG;
      const vfovDeg = Number.isFinite(rawVfov) && rawVfov > 0 ? rawVfov : DRONE_DEFAULT_VFOV_DEG;
      const maxRangeM = cfg.maxFovRange;

      seen.add(sn);
      let set = this.map.get(sn);
      if (!set) {
        set = createDroneEntitySet(v, C, sn);
        this.map.set(sn, set);
      }
      updateDroneEntitySet(C, set, {
        lat: pose.lat, lng: pose.lng, altM,
        headingDeg: pose.headingDeg -90, yawDeg, pitchDeg,
        hfovDeg, vfovDeg, maxRangeM,
      });
      set.model.show = visible;
      set.frustumGround.show = visible;
      for (const e of set.frustumSides) e.show = visible;
    }

    for (const [sn, set] of [...this.map]) {
      if (seen.has(sn)) continue;
      removeDroneEntitySet(v, set);
      this.map.delete(sn);
    }
  }
}

/**
 * 函数式入口：在 React useEffect 里使用，返回 cleanup。
 *
 * @example
 * useEffect(() => installDronesCesium({
 *   getViewer: () => viewerRef.current,
 *   getCesium: () => cesiumRef.current,
 * }), []);
 */
export function installDronesCesium(opts: {
  getViewer: () => CesiumViewer | null;
  getCesium: () => CesiumModule | null;
  isLayerOn?: () => boolean;
}): () => void {
  const drones = new DronesCesium(opts);
  drones.install();
  return () => drones.uninstall();
}
