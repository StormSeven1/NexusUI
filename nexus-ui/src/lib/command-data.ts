import type { ForceDisposition } from "./colors";

/* ───────────────────────── 地理锚点 ───────────────────────── */

export const KEY_AREA = {
  id: "要地一号",
  name: "要地一号 · 指挥所",
  lng: -2.35,
  lat: 51.35,
};

export const MAP_CENTER: [number, number] = [-2.0, 51.22];
export const MAP_ZOOM = 8.6;

/* ───────────────────────── 威胁群 ───────────────────────── */

export interface ThreatGroup {
  id: string;
  name: string;
  disposition: ForceDisposition;
  /** 群质心 */
  lng: number;
  lat: number;
  /** 凸包（地图安静态显示群轮廓） */
  hull: [number, number][];
  trackCount: number;
  /** 研判威胁度 0..1 */
  threat: number;
  /** 是否为主攻群（高压态从此分叉） */
  primary?: boolean;
  /** 信任状态 */
  trust: "trusted" | "pending" | "barred";
  /** 一行研判摘要 */
  summary: string;
  /** 机器是否判为诱饵 */
  decoy?: boolean;
}

export const THREAT_GROUPS: ThreatGroup[] = [
  {
    id: "群1",
    name: "主攻群",
    disposition: "hostile",
    lng: -1.72,
    lat: 51.18,
    hull: [
      [-1.82, 51.22],
      [-1.62, 51.24],
      [-1.58, 51.14],
      [-1.74, 51.1],
      [-1.86, 51.15],
    ],
    trackCount: 14,
    threat: 0.92,
    primary: true,
    trust: "trusted",
    summary: "14 航迹密集编队，航向 285°，速度 420 节，逼近要地一号。",
  },
  {
    id: "群2",
    name: "北翼群",
    disposition: "hostile",
    lng: -1.48,
    lat: 51.42,
    hull: [
      [-1.56, 51.46],
      [-1.4, 51.46],
      [-1.38, 51.38],
      [-1.54, 51.37],
    ],
    trackCount: 9,
    threat: 0.74,
    trust: "trusted",
    summary: "9 航迹，北侧高度层 5500 米，疑似牵制 / 掩护主攻。",
  },
  {
    id: "群3",
    name: "南翼群",
    disposition: "suspect",
    lng: -1.92,
    lat: 50.96,
    hull: [
      [-2.0, 51.0],
      [-1.84, 51.0],
      [-1.82, 50.91],
      [-1.98, 50.9],
    ],
    trackCount: 11,
    threat: 0.55,
    trust: "pending",
    summary: "11 航迹，射频特征矛盾，机器判为诱饵（置信 0.61，单源）。",
    decoy: true,
  },
  {
    id: "群4",
    name: "不明群",
    disposition: "unknown",
    lng: -1.28,
    lat: 51.04,
    hull: [
      [-1.34, 51.08],
      [-1.2, 51.08],
      [-1.2, 51.0],
      [-1.34, 51.0],
    ],
    trackCount: 8,
    threat: 0.41,
    trust: "pending",
    summary: "8 航迹，低慢小，身份未决，待补证。",
  },
  {
    id: "群5",
    name: "海上接触",
    disposition: "neutral",
    lng: -2.04,
    lat: 50.78,
    hull: [
      [-2.12, 50.82],
      [-1.96, 50.82],
      [-1.96, 50.74],
      [-2.12, 50.74],
    ],
    trackCount: 8,
    threat: 0.2,
    trust: "trusted",
    summary: "8 民用航运航迹，航运通道，威胁低。",
  },
];

/* ───────────────────────── 我方资产 ───────────────────────── */

export interface CmdAsset {
  id: string;
  name: string;
  type: "radar" | "interceptor" | "drone" | "key-area";
  status: "online" | "degraded" | "offline";
  lng: number;
  lat: number;
  rangeKm?: number;
}

export const ASSET_TYPE_LABEL: Record<CmdAsset["type"], string> = {
  radar: "雷达",
  interceptor: "拦截单元",
  drone: "无人机",
  "key-area": "要地",
};

export const ASSET_STATUS_LABEL: Record<CmdAsset["status"], string> = {
  online: "在线",
  degraded: "衰减",
  offline: "离线",
};

export const CMD_ASSETS: CmdAsset[] = [
  { id: "资产-要地", name: "要地一号", type: "key-area", status: "online", lng: KEY_AREA.lng, lat: KEY_AREA.lat },
  { id: "资产-雷达1", name: "1号雷达", type: "radar", status: "online", lng: -2.42, lat: 51.5, rangeKm: 90 },
  { id: "资产-雷达2", name: "2号雷达", type: "radar", status: "online", lng: -2.1, lat: 51.05, rangeKm: 80 },
  { id: "资产-雷达3", name: "3号雷达", type: "radar", status: "degraded", lng: -1.9, lat: 51.6, rangeKm: 55 },
  { id: "资产-拦截1", name: "1号拦截单元", type: "interceptor", status: "online", lng: -2.28, lat: 51.28 },
  { id: "资产-拦截2", name: "2号拦截单元", type: "interceptor", status: "online", lng: -2.18, lat: 51.4 },
  { id: "资产-无人机1", name: "1号侦察无人机", type: "drone", status: "online", lng: -1.95, lat: 51.15, rangeKm: 25 },
];

/* ───────────────────── 地理约束（责任区/禁射区） ───────────────────── */

export interface GeoZone {
  id: string;
  name: string;
  kind: "responsibility" | "no-fire" | "airspace";
  polygon: [number, number][];
}

export const GEO_ZONES: GeoZone[] = [
  {
    id: "区-责任",
    name: "七号责任区",
    kind: "responsibility",
    polygon: [
      [-2.7, 51.65],
      [-1.1, 51.65],
      [-1.1, 50.7],
      [-2.7, 50.7],
    ],
  },
  {
    id: "区-禁射",
    name: "二号禁射区（民用空域）",
    kind: "no-fire",
    polygon: [
      [-2.5, 51.0],
      [-2.2, 51.0],
      [-2.2, 50.82],
      [-2.5, 50.82],
    ],
  },
];

/* ───────────────────────── COA 分叉几何 ───────────────────────── */

export type TradeoffAxis = "fast" | "stable" | "stealth";

export interface BeamPoint {
  lng: number;
  lat: number;
  /** 时间分数 0..1（对应 T+0 → T+180秒） */
  t: number;
}

export interface FutureCard {
  /** 预测结局一句话 */
  outcome: string;
  /** 关键数字 */
  keyFigure: string;
  /** 跨卡共享取舍轴评分 0..1（越高越好） */
  scores: Record<TradeoffAxis, number>;
  /** 反事实：不选它会怎样 */
  counterfactual: string;
  /** 失败后果 */
  failure: string;
  /** 哪个证据缺口会推翻它 */
  evidenceGap: string;
}

/** 我方资产在某方案中的处置动作类型 */
export type CoaActionKind = "intercept" | "illuminate" | "recon" | "reposition";

export const COA_ACTION_LABEL: Record<CoaActionKind, string> = {
  intercept: "拦截处置",
  illuminate: "照射引导",
  recon: "前推确认",
  reposition: "机动补位",
};

/** 方案中调用的一项资产编排：哪件资产、什么角色、走什么路径、何时处置 */
export interface CoaTask {
  /** 关联 CMD_ASSETS.id */
  assetId: string;
  /** 资产显示名（冗余便于渲染） */
  assetName: string;
  /** 角色：主拦截 / 补位冗余 / 静默照射 / 前推侦察… */
  role: string;
  action: CoaActionKind;
  /** 机动路径（资产当前位 → 处置阵位）；静止资产仅 1 个点 */
  path: [number, number][];
  /** 到位 / 处置时间分数 0..1（对应 T+0 → T+180秒） */
  actAtT: number;
  /** 资源消耗说明 */
  cost: string;
  /** 一句话处置说明 */
  note: string;
}

export interface COA {
  id: string;
  /** 卡片/弹层完整标签 */
  label: string;
  /** 地图上短标（1 字） */
  short: string;
  /** 主导取舍维度 */
  axis: TradeoffAxis;
  color: string;
  /** 预测轨迹束（地形上长出的几何） */
  beam: BeamPoint[];
  /** 建议拦截点 */
  intercept: { lng: number; lat: number; t: number; countdownSec: number };
  /** 暴露扇（被暴露的我方阵地与扇形覆盖） */
  exposureFan: { polygon: [number, number][]; sweepAtT: number };
  /** 失败红锥：失败时突防到的要地（多边形顶点） */
  failCone: { polygon: [number, number][]; penetrateAtT: number };
  /** 我方资产编排：选了哪些资产/资源，在什么时间处置 */
  tasks: CoaTask[];
  card: FutureCard;
}

/* 主攻群分叉点 */
export const FORK_POINT: [number, number] = [-1.72, 51.18];

export const COAS: COA[] = [
  {
    id: "方案一",
    label: "方案一 · 快",
    short: "快",
    axis: "fast",
    color: "#5b9bd5",
    beam: [
      { lng: -1.72, lat: 51.18, t: 0 },
      { lng: -1.92, lat: 51.22, t: 0.3 },
      { lng: -2.08, lat: 51.27, t: 0.55 },
      { lng: -2.24, lat: 51.31, t: 0.8 },
      { lng: -2.35, lat: 51.35, t: 1 },
    ],
    intercept: { lng: -2.06, lat: 51.26, t: 0.52, countdownSec: 90 },
    exposureFan: {
      polygon: [
        [-2.28, 51.28],
        [-2.12, 51.36],
        [-2.0, 51.28],
        [-2.1, 51.2],
      ],
      sweepAtT: 0.5,
    },
    failCone: {
      polygon: [
        [-2.2, 51.3],
        [-2.34, 51.36],
        [-2.34, 51.34],
        [-2.22, 51.28],
      ],
      penetrateAtT: 0.9,
    },
    tasks: [
      {
        assetId: "资产-拦截1",
        assetName: "1号拦截单元",
        role: "主拦截",
        action: "intercept",
        path: [
          [-2.28, 51.28],
          [-2.16, 51.27],
          [-2.06, 51.26],
        ],
        actAtT: 0.52,
        cost: "拦截弹 ×2",
        note: "西线前出至 拦截点，T+90秒 实施拦截。",
      },
      {
        assetId: "资产-雷达1",
        assetName: "1号雷达",
        role: "照射引导",
        action: "illuminate",
        path: [[-2.42, 51.5]],
        actAtT: 0.42,
        cost: "照射波束 ×1",
        note: "持续照射 主攻群，为 1号拦截单元 提供制导。",
      },
      {
        assetId: "资产-无人机1",
        assetName: "1号侦察无人机",
        role: "前推确认",
        action: "recon",
        path: [
          [-1.95, 51.15],
          [-2.0, 51.2],
          [-2.04, 51.24],
        ],
        actAtT: 0.3,
        cost: "续航 -18%",
        note: "前推至束前缘，二次确认编队规模与诱饵。",
      },
    ],
    card: {
      outcome: "T+90秒 于 1号拦截单元 正前方拦截，主攻群被挡在要地一号外 18 公里。",
      keyFigure: "拦截窗 90秒 · 突防风险 8%",
      scores: { fast: 0.95, stable: 0.6, stealth: 0.35 },
      counterfactual: "不选方案一：错过 90秒 窗口，主攻群在 T+150秒 进入要地一号末端防御圈。",
      failure: "若拦截失败，主攻群由西线突防至要地一号 4 公里。",
      evidenceGap: "主攻群速度估计依赖单雷达，缺第二源测速将推翻拦截时序。",
    },
  },
  {
    id: "方案二",
    label: "方案二 · 稳",
    short: "稳",
    axis: "stable",
    color: "#3bb87a",
    beam: [
      { lng: -1.72, lat: 51.18, t: 0 },
      { lng: -1.84, lat: 51.3, t: 0.3 },
      { lng: -1.98, lat: 51.38, t: 0.6 },
      { lng: -2.16, lat: 51.4, t: 0.82 },
      { lng: -2.3, lat: 51.37, t: 1 },
    ],
    intercept: { lng: -2.0, lat: 51.37, t: 0.62, countdownSec: 115 },
    exposureFan: {
      polygon: [
        [-2.18, 51.42],
        [-2.02, 51.48],
        [-1.92, 51.4],
        [-2.04, 51.34],
      ],
      sweepAtT: 0.6,
    },
    failCone: {
      polygon: [
        [-2.18, 51.39],
        [-2.32, 51.37],
        [-2.32, 51.35],
        [-2.2, 51.37],
      ],
      penetrateAtT: 0.95,
    },
    tasks: [
      {
        assetId: "资产-拦截2",
        assetName: "2号拦截单元",
        role: "主拦截（北线）",
        action: "intercept",
        path: [
          [-2.18, 51.4],
          [-2.08, 51.38],
          [-2.0, 51.37],
        ],
        actAtT: 0.62,
        cost: "拦截弹 ×2",
        note: "北线前出，T+115秒 实施首层拦截。",
      },
      {
        assetId: "资产-拦截1",
        assetName: "1号拦截单元",
        role: "补位冗余",
        action: "reposition",
        path: [
          [-2.28, 51.28],
          [-2.2, 51.31],
          [-2.12, 51.34],
        ],
        actAtT: 0.5,
        cost: "拦截弹 ×1（待命）",
        note: "机动至二线，首层漏失即补位拦截。",
      },
      {
        assetId: "资产-无人机1",
        assetName: "1号侦察无人机",
        role: "牵制确认",
        action: "recon",
        path: [
          [-1.95, 51.15],
          [-1.92, 51.26],
          [-1.9, 51.34],
        ],
        actAtT: 0.4,
        cost: "续航 -22%",
        note: "侧翼监视 北翼群 是否转入，防兵力稀释。",
      },
    ],
    card: {
      outcome: "T+115秒 经 2号拦截单元 北线双层拦截，纵深更大、容错更高。",
      keyFigure: "拦截窗 115秒 · 突防风险 5%",
      scores: { fast: 0.55, stable: 0.95, stealth: 0.5 },
      counterfactual: "不选方案二：放弃北线纵深冗余，单层拦截一旦漏失无补位。",
      failure: "若拦截失败，主攻群偏北绕行，延后 60秒 到达但暴露 2号雷达。",
      evidenceGap: "北翼群是否牵制未证实，若北翼群转入将稀释 2号拦截单元 兵力。",
    },
  },
  {
    id: "方案三",
    label: "方案三 · 隐",
    short: "隐",
    axis: "stealth",
    color: "#d4932a",
    beam: [
      { lng: -1.72, lat: 51.18, t: 0 },
      { lng: -1.9, lat: 51.12, t: 0.32 },
      { lng: -2.06, lat: 51.13, t: 0.58 },
      { lng: -2.22, lat: 51.2, t: 0.82 },
      { lng: -2.34, lat: 51.32, t: 1 },
    ],
    intercept: { lng: -2.08, lat: 51.13, t: 0.56, countdownSec: 105 },
    exposureFan: {
      polygon: [
        [-2.22, 51.16],
        [-2.06, 51.1],
        [-1.96, 51.16],
        [-2.08, 51.22],
      ],
      sweepAtT: 0.55,
    },
    failCone: {
      polygon: [
        [-2.22, 51.24],
        [-2.34, 51.31],
        [-2.34, 51.29],
        [-2.24, 51.22],
      ],
      penetrateAtT: 0.92,
    },
    tasks: [
      {
        assetId: "资产-拦截1",
        assetName: "1号拦截单元",
        role: "南线机动拦截",
        action: "intercept",
        path: [
          [-2.28, 51.28],
          [-2.18, 51.2],
          [-2.08, 51.13],
        ],
        actAtT: 0.56,
        cost: "拦截弹 ×2",
        note: "无线电静默南移，T+105秒 最迟暴露处置。",
      },
      {
        assetId: "资产-雷达2",
        assetName: "2号雷达",
        role: "静默照射",
        action: "illuminate",
        path: [[-2.1, 51.05]],
        actAtT: 0.5,
        cost: "低功率波束 ×1",
        note: "南线低功率照射，压低被截获概率。",
      },
      {
        assetId: "资产-无人机1",
        assetName: "1号侦察无人机",
        role: "低空跟踪",
        action: "recon",
        path: [
          [-1.95, 51.15],
          [-2.0, 51.13],
          [-2.06, 51.13],
        ],
        actAtT: 0.45,
        cost: "续航 -25%",
        note: "贴地跟踪，补 3号雷达 衰减形成的低空盲区。",
      },
    ],
    card: {
      outcome: "T+105秒 南线静默拦截，最迟暴露主处置、保留隐蔽。",
      keyFigure: "拦截窗 105秒 · 暴露最低",
      scores: { fast: 0.6, stable: 0.55, stealth: 0.95 },
      counterfactual: "不选方案三：提前暴露拦截阵位，敌可重规划绕行。",
      failure: "若南线低空丢失跟踪，主攻群借地形遮蔽突防至要地一号 6 公里。",
      evidenceGap: "南线低空雷达覆盖弱（3号雷达衰减），跟踪连续性存疑。",
    },
  },
];

/* ───────────────────────── 证据链 ───────────────────────── */

export interface EvidenceNode {
  stage: "observation" | "fusion" | "trust" | "hypothesis";
  title: string;
  detail: string;
  provenance: string;
  confidence: number;
  time: string;
  replayable: boolean;
}

export const EVIDENCE_CHAINS: Record<string, EvidenceNode[]> = {
  群1: [
    {
      stage: "observation",
      title: "观测 · 1号雷达 + 光电2",
      detail: "1号雷达主跟踪 14 回波，光电2 二次��认 6 目标外形。原始回波不可改写。",
      provenance: "1号雷达 v4.2 / 光电2 v2.1",
      confidence: 0.88,
      time: "14:02:31",
      replayable: true,
    },
    {
      stage: "fusion",
      title: "融合 · 编队关联",
      detail: "按速度 / 航向 / 间距聚为单一编队 群1，关联判据：航向差 <3°、间距 <2 公里。",
      provenance: "融合服务 v3.4 / 模型 关联-11",
      confidence: 0.84,
      time: "14:02:33",
      replayable: true,
    },
    {
      stage: "trust",
      title: "信任 · 可信",
      detail: "双源覆盖（雷达 + 光电），无衰减、无噪声告警，可作授权依据。",
      provenance: "信任态 v2.0",
      confidence: 0.86,
      time: "14:02:34",
      replayable: true,
    },
    {
      stage: "hypothesis",
      title: "假设 · 对要地一号实施饱和突击",
      detail: "支持：航向直指要地一号、编队密集。反证：暂无。证伪测试：观察是否在 T+60秒 散开。",
      provenance: "假设引擎 v1.6 / 规则集 饱和-3",
      confidence: 0.79,
      time: "14:02:36",
      replayable: true,
    },
  ],
  群3: [
    {
      stage: "observation",
      title: "观测 · 仅 射频1 单源",
      detail: "射频1 截获辐射特征，无雷达硬回波佐证，原始信噪比偏低。",
      provenance: "射频1 v1.9",
      confidence: 0.52,
      time: "14:02:18",
      replayable: true,
    },
    {
      stage: "fusion",
      title: "融合 · 弱关联",
      detail: "射频特征与已知诱饵库匹配度 0.61，关联强度弱。",
      provenance: "融合服务 v3.4 / 诱饵库 v7",
      confidence: 0.58,
      time: "14:02:20",
      replayable: true,
    },
    {
      stage: "trust",
      title: "信任 · 待补证（禁入授权依据）",
      detail: "单源、信噪比不足，不可作授权依据。建议调 光电2 / 射频 二次确认。",
      provenance: "信任态 v2.0",
      confidence: 0.55,
      time: "14:02:21",
      replayable: true,
    },
    {
      stage: "hypothesis",
      title: "假设 · 诱饵牵制",
      detail: "支持：射频特征像诱饵、无硬回波。反证：可能为低反射真目标。证据缺口：缺光电外形确认。",
      provenance: "假设引擎 v1.6",
      confidence: 0.61,
      time: "14:02:23",
      replayable: true,
    },
  ],
};

/* ───────────────────────── 执行监看任务 ───────────────────────── */

export interface ExecTask {
  id: string;
  authorizationId: string;
  name: string;
  targetId: string;
  /** 授权包络 */
  envelope: {
    scope: string;
    ttlSec: number;
    ttlTotalSec: number;
    budgetUsed: number;
    budgetTotal: number;
    failClosed: string;
  };
  /** 置信爬升曲线点 0..1 */
  confidenceCurve: number[];
  corroborationCount: number;
  effect: "ok" | "climbing" | "breach";
  /** 包络内动作流 */
  actions: { time: string; actor: string; result: string }[];
}

export const EXEC_TASKS: ExecTask[] = [
  {
    id: "任务01",
    authorizationId: "授权2291",
    name: "不明群 身份补证",
    targetId: "群4",
    envelope: {
      scope: "光电2 / 射频1 传感器二次确认 · 七号责任区内 · 仅观测",
      ttlSec: 420,
      ttlTotalSec: 600,
      budgetUsed: 12,
      budgetTotal: 30,
      failClosed: "越出 七号责任区 或调用处置能力即停",
    },
    confidenceCurve: [0.41, 0.48, 0.55, 0.62, 0.71, 0.78],
    corroborationCount: 12,
    effect: "climbing",
    actions: [
      { time: "14:01:40", actor: "光电2", result: "外形确认：低慢小，识别 0.62" },
      { time: "14:01:50", actor: "射频1", result: "无武器辐射特征，识别 0.71" },
      { time: "14:02:00", actor: "光电2", result: "持续跟踪，识别 0.78" },
    ],
  },
  {
    id: "任务02",
    authorizationId: "授权2287",
    name: "南翼群 诱饵证伪",
    targetId: "群3",
    envelope: {
      scope: "光电2 二次确认 · 二号禁射区外 · 仅观测",
      ttlSec: 180,
      ttlTotalSec: 300,
      budgetUsed: 22,
      budgetTotal: 25,
      failClosed: "预算耗尽自动关闭",
    },
    confidenceCurve: [0.55, 0.58, 0.6, 0.59, 0.61],
    corroborationCount: 22,
    effect: "ok",
    actions: [
      { time: "14:00:30", actor: "光电2", result: "外形不清，疑似诱饵 0.58" },
      { time: "14:01:10", actor: "光电2", result: "反射异常低，维持诱饵假设 0.61" },
    ],
  },
  {
    id: "任务03",
    authorizationId: "授权2280",
    name: "主攻群 持续跟踪",
    targetId: "群1",
    envelope: {
      scope: "1号雷达 + 光电2 融合跟踪 · 七号责任区内",
      ttlSec: 60,
      ttlTotalSec: 600,
      budgetUsed: 48,
      budgetTotal: 60,
      failClosed: "时限耗尽，需续签",
    },
    confidenceCurve: [0.8, 0.82, 0.85, 0.86, 0.88, 0.88],
    corroborationCount: 48,
    effect: "breach",
    actions: [
      { time: "14:02:20", actor: "融合", result: "融合跟踪稳定 0.88" },
      { time: "14:02:35", actor: "系统", result: "时限余 60秒 — 越界预警，需续签" },
    ],
  },
];

/* ───────────────────────── 决策脊（决策包） ───────────────────────── */

export interface DecisionPacket {
  id: string;
  title: string;
  status: "queued" | "active" | "committed" | "closed";
  time: string;
  coa?: string;
}

export const DECISION_PACKETS: DecisionPacket[] = [
  { id: "决策07", title: "主攻群裁决", status: "active", time: "14:02:36" },
  { id: "决策06", title: "不明群身份补证授权", status: "committed", time: "14:01:38", coa: "补证 光电/射频" },
  { id: "决策05", title: "南翼群诱饵证伪", status: "committed", time: "14:00:28", coa: "补证 光电2" },
  { id: "决策04", title: "2号雷达扇区移交", status: "closed", time: "13:58:02", coa: "方案二" },
  { id: "决策03", title: "海上接触放行", status: "closed", time: "13:54:11", coa: "放行" },
];

/* ───────────────────────── 相位脊 ───────────────────────── */

export const PHASES = [
  { id: "observe", label: "观" },
  { id: "research", label: "研" },
  { id: "compare", label: "比" },
  { id: "commit", label: "承" },
  { id: "execute", label: "执" },
  { id: "evaluate", label: "评" },
] as const;

/* ───────────────────────── AI 副驾消息 ───────────────────────── */

export interface CopilotMessage {
  id: string;
  role: "commander" | "copilot";
  text: string;
  /** 结构化产物类型 */
  artifact?: "answer" | "intent" | "analysis";
  time: string;
}

export const COPILOT_SEED: CopilotMessage[] = [
  {
    id: "m1",
    role: "commander",
    text: "群3 为什么判诱饵？",
    time: "14:01:55",
  },
  {
    id: "m2",
    role: "copilot",
    text: "群3 仅 射频1 单源，匹配诱饵库 0.61，无雷达硬回波与光电外形佐证，信任为「待补证」，不可作授权依据。已在地图定位 群3，证据链见详情卡。",
    artifact: "answer",
    time: "14:01:56",
  },
];
