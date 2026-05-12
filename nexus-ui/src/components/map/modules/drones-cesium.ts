/**
 * 三维无人机渲染模块（仅三维，和二维层独立）。
 *
 * ========================= 文件头流程（先看这里） =========================
 * 1) 输入来源：
 *    useDroneStore -> mergedDronePose / latestPayloadForFov
 *    每帧拿到无人机位置(origin) + 相机姿态(yaw/pitch) + 视场(hfov/vfov) + maxRange
 *
 * 2) 先算四个角射线：
 *    corners 顺序固定：tl, tr, br, bl
 *    每条角射线：优先求射线与 WGS84 椭球交点；若未命中则在 maxRange 截断
 *
 * 3) 分支判定（只保留 3 类业务分支）：
 *    - bothGround: 上边和下边都对地
 *    - bottomGroundTopSky: 下边对地、上边对空（核心分支）
 *    - bothSky: 上下都对空
 *
 * 4) bottomGroundTopSky 的构面规则（你确认后的版本）：
 *    - 不创建 B-A 主面
 *    - 保留原有四个射线侧面（origin 与 corners 形成）
 *    - 新增两个闭合四边面：
 *      a) verticalClosure: [B_left, B_right, V_right, V_left]
 *      b) nearGroundClosure: [V_left, V_right, A_right, A_left]
 *    - 左右侧面不再额外加独立三角实体，而是把左右侧面从三角扩成四边形
 *
 * 5) B/A/V 命名对照（重点）：
 *    - B_left  = top-left 角点（corners[0]），上边对空终止线左端
 *    - B_right = top-right 角点（corners[1]），上边对空终止线右端
 *    - A_right = bottom-right 角点（corners[2]），下边对地交线右端
 *    - A_left  = bottom-left 角点（corners[3]），下边对地交线左端
 *    - V_left  = B_left 向椭球面垂投点
 *    - V_right = B_right 向椭球面垂投点
 *
 * 6) sideIndex 语义（frustumSides）：
 *    - 0: tl -> tr（上侧）
 *    - 1: tr -> br（右侧）在 bottomGroundTopSky 时插入 V_right 扩成四边形
 *    - 2: br -> bl（下侧）
 *    - 3: bl -> tl（左侧）在 bottomGroundTopSky 时插入 V_left 扩成四边形
 *
 * ========================= 角度与配置约定 =========================
 * - heading: 度，0=正北，顺时针（模型朝向）
 * - yaw: 度，gimbal_yaw 优先；fallback pose.headingDeg（相机水平角）
 * - pitch: 度，正=抬头，负=俯视；gimbal_pitch -> attitude_pitch -> 默认 -30
 * - 配置来自 `drones.*`：
 *   - horizontalFov（默认 30°）
 *   - maxFovRange（默认 3000m）
 */

import { useDroneStore } from "@/stores/drone-store";
import { useAssetStore } from "@/stores/asset-store";
import type { AssetData } from "@/stores/asset-store";
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
const DRONE_MODEL_URI = "/3dmodules/drone.glb";
/** 没有遥测高度时的兜底飞行高度（米） */
const DRONE_FALLBACK_ALT_M = 0.1;
/** 模型外部缩放 */
const DRONE_MODEL_SCALE = 4;
/** 屏幕最小像素，远视角下保底可见 */
const DRONE_MODEL_MIN_PIXEL_SIZE = 24;
/** 贴近视角时的最大世界尺寸（米），防止占满屏 */
const DRONE_MODEL_MAXIMUM_SCALE = 8000;
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
  /**
   * 远端封口面（四边形）：
   * - bothGround: 四个角射线都打到地面（或满足全对地逻辑）时，直接使用 corners 封口
   * - bothSky: 四个角射线都未打到地面时，使用 maxRange 截断后的 corners 封口
   * - fallback: 非法/混合状态的兜底封口，避免出现开口
   * - bottomGroundTopSky: 本分支刻意不使用该封口（保持为空），
   *   因为你要求此时不创建 B-A 主面，改由“原有四射线面 + 闭合带”构体。
   */
  groundCap: Cartesian3[];
  /**
   * 垂直闭合面（四边形）：
   * 点序固定为 [B_left, B_right, V_right, V_left]
   * - B_left/B_right: 上边（对空）两端点，来自 top-left / top-right 角射线
   * - V_left/V_right: B 两端向椭球面垂投得到的落地点
   */
  verticalClosure: Cartesian3[];
  /**
   * 近地连接面（四边形）：
   * 点序固定为 [V_left, V_right, A_right, A_left]
   * - A_left/A_right: 下边（对地）交线两端点，来自 bottom-left / bottom-right 角射线
   */
  nearGroundClosure: Cartesian3[];
  /**
   * 侧面扩展点：与 frustumSides 的索引一一对应。
   * - null  => 该侧面按原始三角面绘制 [origin, corner[i], corner[i+1]]
   * - 非空 => 该侧面扩展为四边形 [origin, corner[i], extra, corner[i+1]]
   *
   * 当前仅在 bottomGroundTopSky 场景设置：
   * - sideIndex=1（右侧面）extra=V_right
   * - sideIndex=3（左侧面）extra=V_left
   * 其余侧面保持 null，不改变原有拓扑。
   */
  sideExtraPointByIndex: Array<Cartesian3 | null>;
}

/** 一架无人机的全部 3D entity 集合 */
interface DroneEntitySet {
  model: CesiumEntity;
  frustumGroundCap: CesiumEntity;
  frustumVerticalClosure: CesiumEntity;
  frustumNearGroundClosure: CesiumEntity;
  /** 4 个侧面填充三角形（origin→corner[i]→corner[(i+1)%4]） */
  frustumSides: CesiumEntity[];
  /** CallbackProperty 共享的可变状态 */
  state: FrustumState;
}

interface FrustumRayDebug {
  corner: "tl" | "tr" | "br" | "bl";
  yawDeg: number;
  pitchDeg: number;
  hitGround: boolean;
  hitDistanceM: number | null;
  usedDistanceM: number;
  distanceSource: "hit" | "centerFallback" | "maxRange";
}

interface FrustumComputeResult {
  corners: Cartesian3[];
  centerHitDistanceM: number | null;
  rays: FrustumRayDebug[];
  /**
   * 几何分支标签（便于日志和调试）：
   * - bothGround: 顶边命中地面 + 底边命中地面
   * - bottomGroundTopSky: 底边命中地面 + 顶边未命中地面（你定义的关键分支）
   * - bothSky: 顶/底均未命中地面
   * - fallback: 其余混合形态（例如只命中一个角）；用保守封口避免破面
   */
  caseName: "bothGround" | "bottomGroundTopSky" | "bothSky" | "fallback";
  groundCap: Cartesian3[];
  verticalClosure: Cartesian3[];
  nearGroundClosure: Cartesian3[];
  sideExtraPointByIndex: Array<Cartesian3 | null>;
}

function projectToGroundOnEllipsoid(C: CesiumModule, point: Cartesian3): Cartesian3 {
  /* 优先使用 Cesium 的地理法线投影，得到点在 WGS84 椭球上的对应落点。 */
  const onSurface = C.Ellipsoid.WGS84.scaleToGeodeticSurface(point);
  if (onSurface) return onSurface;
  /* 极端情况下退化为“保持经纬度，高度置零”的近似投影，避免返回空导致开口。 */
  const carto = C.Cartographic.fromCartesian(point);
  return C.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
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

/**
 * 规范化俯仰角，避免 `pitch ± vfov/2` 穿过 ±90° 导致部分射线反向（四棱锥形变/拉丝）。
 * 例如：pitch=-90 且 vfov=10 时，下半边会变成 -95°，射线会朝“背向地面”方向，几何会异常。
 */
function normalizePitchForFrustum(pitchDeg: number, vfovDeg: number): number {
  const wrapped = ((((pitchDeg + 180) % 360) + 360) % 360) - 180;
  const halfV = Math.max(0.1, Math.min(vfovDeg, 170)) / 2;
  const minPitch = -89 + halfV;
  const maxPitch = 89 - halfV;
  return Math.max(minPitch, Math.min(maxPitch, wrapped));
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
): FrustumComputeResult {
  const halfH = hfovDeg / 2;
  const halfV = vfovDeg / 2;
  const dirs: Array<[number, number, "tl" | "tr" | "br" | "bl"]> = [
    [-1, +1, "tl"], [+1, +1, "tr"], [+1, -1, "br"], [-1, -1, "bl"],
  ];
  const corners: Cartesian3[] = [];
  const rays: FrustumRayDebug[] = [];
  const ellipsoid = C.Ellipsoid.WGS84;
  const centerDirEnu = frustumDirectionEnu(C, yawDeg, pitchDeg);
  const centerDirEcef = enuDirToEcef(C, origin, centerDirEnu);
  const centerRay = new C.Ray(origin, centerDirEcef);
  const centerHit = C.IntersectionTests.rayEllipsoid(centerRay, ellipsoid);
  const centerT =
    centerHit && centerHit.start >= 0 && centerHit.start < maxRangeM ? centerHit.start : null;
  for (const [hs, vs, corner] of dirs) {
    const yawI = yawDeg + hs * halfH;
    const pitchI = Math.max(-89.5, Math.min(89.5, pitchDeg + vs * halfV));
    const dirEnu = frustumDirectionEnu(C, yawI, pitchI);
    const dirEcef = enuDirToEcef(C, origin, dirEnu);
    const ray = new C.Ray(origin, dirEcef);
    const hit = C.IntersectionTests.rayEllipsoid(ray, ellipsoid);
    const hasHit = !!(hit && hit.start >= 0 && hit.start < maxRangeM);
    const hitT = hasHit ? hit!.start : null;
    const t = hasHit ? hitT! : centerT != null ? centerT : maxRangeM;
    const distanceSource: FrustumRayDebug["distanceSource"] = hasHit
      ? "hit"
      : centerT != null
        ? "centerFallback"
        : "maxRange";
    rays.push({
      corner,
      yawDeg: yawI,
      pitchDeg: pitchI,
      hitGround: hasHit,
      hitDistanceM: hitT,
      usedDistanceM: t,
      distanceSource,
    });
    corners.push(C.Ray.getPoint(ray, t));
  }
  const tlHit = rays[0]?.hitGround === true;
  const trHit = rays[1]?.hitGround === true;
  const brHit = rays[2]?.hitGround === true;
  const blHit = rays[3]?.hitGround === true;
  /**
   * 命中定义约定：
   * - top: tl/tr（上边左右角）
   * - bottom: bl/br（下边左右角）
   * 只要“下边全命中 + 上边全不命中”才进入你要求的 bottomGroundTopSky。
   */
  const topAllHit = tlHit && trHit;
  const topAnyHit = tlHit || trHit;
  const bottomAllHit = brHit && blHit;
  const bottomAnyHit = brHit || blHit;

  let caseName: FrustumComputeResult["caseName"] = "fallback";
  if (bottomAllHit && topAllHit) {
    caseName = "bothGround";
  } else if (bottomAllHit && !topAnyHit) {
    caseName = "bottomGroundTopSky";
  } else if (!bottomAnyHit && !topAnyHit) {
    caseName = "bothSky";
  }

  const groundCap: Cartesian3[] = [];
  const verticalClosure: Cartesian3[] = [];
  const nearGroundClosure: Cartesian3[] = [];
  const sideExtraPointByIndex: Array<Cartesian3 | null> = [null, null, null, null];

  if (caseName === "bothGround" || caseName === "bothSky" || caseName === "fallback") {
    /* 这些分支统一使用 corners 作为远端封口，保持体积闭合。 */
    groundCap.push(...corners);
  } else if (caseName === "bottomGroundTopSky") {
    /**
     * 命名映射（按你的语义）：
     * - B_left/B_right: 上边对空终止线（top-left / top-right）
     * - A_left/A_right: 下边对地交线（bottom-left / bottom-right）
     */
    const bLeft = corners[0];
    const bRight = corners[1];
    const aRight = corners[2];
    const aLeft = corners[3];
    /* B 两端向地表做垂投，得到 V_left/V_right。 */
    const vLeft = projectToGroundOnEllipsoid(C, bLeft);
    const vRight = projectToGroundOnEllipsoid(C, bRight);
    /* 闭合带的两片四边形面（你要求保留）。 */
    verticalClosure.push(bLeft, bRight, vRight, vLeft);
    nearGroundClosure.push(vLeft, vRight, aRight, aLeft);
    /**
     * 关键修正：
     * 不再额外新建左右三角实体，而是把左右射线侧面由三角扩成四边形。
     * - side 1（右侧）：origin -> tr -> V_right -> br
     * - side 3（左侧）：origin -> bl -> V_left -> tl
     * 这样既补齐开口，又保持“面来自原有射线侧面”的构面思路。
     */
    sideExtraPointByIndex[1] = vRight;
    sideExtraPointByIndex[3] = vLeft;
  }

  return {
    corners,
    centerHitDistanceM: centerT,
    rays,
    caseName,
    groundCap,
    verticalClosure,
    nearGroundClosure,
    sideExtraPointByIndex,
  };
}

/** 创建一架无人机的 entity 集合 */
function createDroneEntitySet(
  viewer: CesiumViewer,
  C: CesiumModule,
  sn: string,
  displayName: string,
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
    label: {
      text: displayName || sn,
      font: "12px sans-serif",
      style: C.LabelStyle.FILL_AND_OUTLINE,
      outlineWidth: 2,
      verticalOrigin: C.VerticalOrigin.BOTTOM,
      pixelOffset: new C.Cartesian2(0, -20),
      scaleByDistance: new C.NearFarScalar(1e4, 1, 5e5, 0.4),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: { droneSn: sn, kind: "model" },
  });
  /* 闭包可变状态——CallbackProperty 每帧读取 */
  const state: FrustumState = {
    origin: C.Cartesian3.ZERO,
    corners: [],
    groundCap: [],
    verticalClosure: [],
    nearGroundClosure: [],
    sideExtraPointByIndex: [null, null, null, null],
  };

  const frustumGroundCap = viewer.entities.add({
    show: false,
    polygon: {
      hierarchy: new C.CallbackProperty(() => {
        if (!state.groundCap.length) return new C.PolygonHierarchy([]);
        return new C.PolygonHierarchy([...state.groundCap]);
      }, false),
      perPositionHeight: true,
      material: fillCol,
      outline: false,
    },
    properties: { droneSn: sn, kind: "frustumGroundCap" },
  });
  const frustumVerticalClosure = viewer.entities.add({
    show: false,
    polygon: {
      hierarchy: new C.CallbackProperty(() => {
        if (!state.verticalClosure.length) return new C.PolygonHierarchy([]);
        return new C.PolygonHierarchy([...state.verticalClosure]);
      }, false),
      perPositionHeight: true,
      material: fillCol,
      outline: false,
    },
    properties: { droneSn: sn, kind: "frustumVerticalClosure" },
  });
  const frustumNearGroundClosure = viewer.entities.add({
    show: false,
    polygon: {
      hierarchy: new C.CallbackProperty(() => {
        if (!state.nearGroundClosure.length) return new C.PolygonHierarchy([]);
        return new C.PolygonHierarchy([...state.nearGroundClosure]);
      }, false),
      perPositionHeight: true,
      material: fillCol,
      outline: false,
    },
    properties: { droneSn: sn, kind: "frustumNearGroundClosure" },
  });
  const frustumSides: CesiumEntity[] = [];
  for (let i = 0; i < 4; i++) {
    frustumSides.push(
      viewer.entities.add({
        show: false,
        polygon: {
          hierarchy: new C.CallbackProperty(() => {
            if (!state.corners.length) return new C.PolygonHierarchy([]);
            const extra = state.sideExtraPointByIndex[i];
            if (extra) {
              /* 有扩展点时，将该侧面升级为四边形（用于 bottomGroundTopSky 的左右侧封口）。 */
              return new C.PolygonHierarchy([
                state.origin,
                state.corners[i],
                extra,
                state.corners[(i + 1) % 4],
              ]);
            }
            /* 默认保持历史行为：四个侧面都是三角形。 */
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
  return {
    model,
    frustumGroundCap,
    frustumVerticalClosure,
    frustumNearGroundClosure,
    frustumSides,
    state,
  };
}

/** 移除一架无人机的全部 entity */
function removeDroneEntitySet(viewer: CesiumViewer, set: DroneEntitySet) {
  viewer.entities.remove(set.model);
  viewer.entities.remove(set.frustumGroundCap);
  viewer.entities.remove(set.frustumVerticalClosure);
  viewer.entities.remove(set.frustumNearGroundClosure);
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
): FrustumComputeResult {
  const origin = C.Cartesian3.fromDegrees(args.lng, args.lat, args.altM);
  const hpr = new C.HeadingPitchRoll(C.Math.toRadians(args.headingDeg), 0, 0);
  const orientation = C.Transforms.headingPitchRollQuaternion(origin, hpr);
  set.model.position = new C.ConstantPositionProperty(origin);
  set.model.orientation = new C.ConstantProperty(orientation);

  const frustum = computeFrustumCorners(
    C, origin, args.yawDeg, args.pitchDeg, args.hfovDeg, args.vfovDeg, args.maxRangeM,
  );
  /* 写入闭包状态，CallbackProperty 下一帧自动读取最新值 */
  set.state.origin = origin;
  set.state.corners.length = 0;
  for (const c of frustum.corners) set.state.corners.push(c);
  set.state.groundCap.length = 0;
  for (const p of frustum.groundCap) set.state.groundCap.push(p);
  set.state.verticalClosure.length = 0;
  for (const p of frustum.verticalClosure) set.state.verticalClosure.push(p);
  set.state.nearGroundClosure.length = 0;
  for (const p of frustum.nearGroundClosure) set.state.nearGroundClosure.push(p);
  /* 每帧刷新侧面扩展点；未设置的索引显式回写 null，避免上一帧残留。 */
  for (let i = 0; i < 4; i++) {
    set.state.sideExtraPointByIndex[i] = frustum.sideExtraPointByIndex[i] ?? null;
  }
  return frustum;
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
  private lastFrustumLogAt = new Map<string, number>();
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
    this.lastFrustumLogAt.clear();
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
    const assets: AssetData[] = useAssetStore.getState().assets;
    const cfg = getDroneMapRenderingConfig();
    const visible = this.isLayerOn();
    const seen = new Set<string>();

    for (const sn of Object.keys(drones)) {
      const tele = drones[sn];
      let pose = mergedDronePose(tele);
      /* 无实时遥测时用 asset store 的计划位置兜底（与二维静态层一致） */
      if (!pose) {
        const asset = assets.find((a) => a.id === sn);
        if (asset && Number.isFinite(asset.lat) && Number.isFinite(asset.lng)) {
          pose = { lat: asset.lat, lng: asset.lng, headingDeg: asset.heading ?? 0 };
        }
      }
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
      /* 角度来源优先级：
       * yaw:   gimbal_yaw -> gimbal.yaw -> attitude_head -> pose.headingDeg
       * pitch: gimbal_pitch -> gimbal.pitch -> attitude_pitch -> 默认值 */
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
      const normalizedPitchDeg = normalizePitchForFrustum(pitchDeg, vfovDeg);
      const maxRangeM = cfg.maxFovRange;

      seen.add(sn);
      let set = this.map.get(sn);
      if (!set) {
        set = createDroneEntitySet(v, C, sn, tele.displayName);
        this.map.set(sn, set);
      }
      /* displayName 可能在 entity_status 后才到，每次 flush 同步 */
      if (set.model.label) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (set.model.label as any).text = new C.ConstantProperty(tele.displayName || sn);
      }
      const frustum = updateDroneEntitySet(C, set, {
        lat: pose.lat, lng: pose.lng, altM,
        headingDeg: pose.headingDeg -90, yawDeg, pitchDeg: normalizedPitchDeg,
        hfovDeg, vfovDeg, maxRangeM,
      });
      const nowMs = Date.now();
      if (nowMs - (this.lastFrustumLogAt.get(sn) ?? 0) >= 1000) {
        this.lastFrustumLogAt.set(sn, nowMs);
        const toLla = (p: Cartesian3) => {
          const c = C.Cartographic.fromCartesian(p);
          return {
            经度: C.Math.toDegrees(c.longitude),
            纬度: C.Math.toDegrees(c.latitude),
            高度M: c.height,
          };
        };
        const rawHfovSource = Number.isFinite(rawHfov) && rawHfov > 0 ? "载荷字段" : `默认值${DRONE_DEFAULT_HFOV_DEG}`;
        const rawVfovSource = Number.isFinite(rawVfov) && rawVfov > 0 ? "载荷字段" : `默认值${DRONE_DEFAULT_VFOV_DEG}`;
        const yawSource = Number.isFinite(gimbalYaw)
          ? "gimbal_yaw/gimbal.yaw/attitude_head"
          : "pose.headingDeg";
        const pitchSource = Number.isFinite(gimbalPitch)
          ? "gimbal_pitch/gimbal.pitch"
          : Number.isFinite(attitudePitch)
            ? "attitude_pitch"
            : `默认值${DRONE_DEFAULT_PITCH_DEG}`;
        console.log("[三维无人机四棱锥参数]", {
          无人机SN: sn,
          时间: new Date().toISOString(),
          图层可见: visible,
          位姿来源: raw ? "latestPayloadForFov" : "none",
          模型朝向Deg: pose.headingDeg - 90,
          相机水平角Deg: yawDeg,
          相机水平角来源: yawSource,
          相机俯仰角Deg_原始: pitchDeg,
          相机俯仰角Deg_参与绘制: normalizedPitchDeg,
          相机俯仰角来源: pitchSource,
          水平视场角Deg: hfovDeg,
          水平视场角来源: rawHfovSource,
          垂直视场角Deg: vfovDeg,
          垂直视场角来源: rawVfovSource,
          最大距离M: maxRangeM,
          构面分支: frustum.caseName,
          原点: { 经度: pose.lng, 纬度: pose.lat, 高度M: altM },
          中心射线命中距离M: frustum.centerHitDistanceM,
          角射线: frustum.rays,
          角点坐标: {
            tl: toLla(frustum.corners[0]!),
            tr: toLla(frustum.corners[1]!),
            br: toLla(frustum.corners[2]!),
            bl: toLla(frustum.corners[3]!),
          },
        });
      }
      set.model.show = visible;
      set.frustumGroundCap.show = visible;
      set.frustumVerticalClosure.show = visible;
      set.frustumNearGroundClosure.show = visible;
      for (const e of set.frustumSides) e.show = visible;
    }

    for (const [sn, set] of [...this.map]) {
      if (seen.has(sn)) continue;
      removeDroneEntitySet(v, set);
      this.map.delete(sn);
      this.lastFrustumLogAt.delete(sn);
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
