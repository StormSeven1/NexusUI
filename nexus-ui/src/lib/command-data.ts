import type { ForceDisposition } from "./colors";

/* ───────────────────────── 地理锚点 ───────────────────────── */

export const KEY_AREA = {
  id: "K-1",
  name: "要地 K-1 · 指挥所",
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
    id: "G-A",
    name: "G-A 主攻群",
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
    summary: "14 航迹密集编队，航向 285°，速度 420kn，逼近 K-1。",
  },
  {
    id: "G-B",
    name: "G-B 北翼群",
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
    summary: "9 航迹，北侧高度层 5500m，疑似牵制/掩护主攻。",
  },
  {
    id: "G-C",
    name: "G-C 南翼群",
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
    summary: "11 航迹，RF 特征矛盾，机器判为诱饵（置信 0.61，单源）。",
    decoy: true,
  },
  {
    id: "G-D",
    name: "G-D 不明群",
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
    id: "G-E",
    name: "G-E 海上接触",
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
    summary: "8 民用 AIS 航迹，航运通道，威胁低。",
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

export const CMD_ASSETS: CmdAsset[] = [
  { id: "AST-K1", name: "要地 K-1", type: "key-area", status: "online", lng: KEY_AREA.lng, lat: KEY_AREA.lat },
  { id: "AST-RA", name: "雷达 Alpha", type: "radar", status: "online", lng: -2.42, lat: 51.5, rangeKm: 90 },
  { id: "AST-RB", name: "雷达 Bravo", type: "radar", status: "online", lng: -2.1, lat: 51.05, rangeKm: 80 },
  { id: "AST-RC", name: "雷达 Charlie", type: "radar", status: "degraded", lng: -1.9, lat: 51.6, rangeKm: 55 },
  { id: "AST-I1", name: "拦截单元 I-1", type: "interceptor", status: "online", lng: -2.28, lat: 51.28 },
  { id: "AST-I2", name: "拦截单元 I-2", type: "interceptor", status: "online", lng: -2.18, lat: 51.4 },
  { id: "AST-D1", name: "侦察无人机 D-1", type: "drone", status: "online", lng: -1.95, lat: 51.15, rangeKm: 25 },
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
    id: "ZONE-RESP",
    name: "责任区 AOR-7",
    kind: "responsibility",
    polygon: [
      [-2.7, 51.65],
      [-1.1, 51.65],
      [-1.1, 50.7],
      [-2.7, 50.7],
    ],
  },
  {
    id: "ZONE-NOFIRE",
    name: "禁射区 NF-2（民用空域）",
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
  /** 时间分数 0..1（对应 T+0 → T+180s） */
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

export interface COA {
  id: string;
  label: string;
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
  card: FutureCard;
}

/* 主攻群分叉点 */
export const FORK_POINT: [number, number] = [-1.72, 51.18];

export const COAS: COA[] = [
  {
    id: "COA-A",
    label: "A · 快",
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
    card: {
      outcome: "T+90s 于 I-1 正前方拦截，主攻群被挡在 K-1 外 18km。",
      keyFigure: "拦截窗 90s · 突防风险 8%",
      scores: { fast: 0.95, stable: 0.6, stealth: 0.35 },
      counterfactual: "不选 A：错过 90s 窗口，G-A 在 T+150s 进入 K-1 末端防御圈。",
      failure: "若拦截失败，G-A 由西线突防至 K-1 4km。",
      evidenceGap: "G-A 速度估计依赖单雷达，缺第二源测速将推翻拦截时序。",
    },
  },
  {
    id: "COA-B",
    label: "B · 稳",
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
    card: {
      outcome: "T+115s 经 I-2 北线双层拦截，纵深更大、容错更高。",
      keyFigure: "拦截窗 115s · 突防风险 5%",
      scores: { fast: 0.55, stable: 0.95, stealth: 0.5 },
      counterfactual: "不选 B：放弃北线纵深冗余，单层拦截一旦漏失无补位。",
      failure: "若拦截失败，G-A 偏北绕行，延后 60s 到达但暴露 Bravo。",
      evidenceGap: "G-B 是否牵制未证实，若 G-B 转入将稀释 I-2 兵力。",
    },
  },
  {
    id: "COA-C",
    label: "C · 隐",
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
    card: {
      outcome: "T+105s 南线静默拦截，最迟暴露主处置、保留隐蔽。",
      keyFigure: "拦截窗 105s · 暴露最低",
      scores: { fast: 0.6, stable: 0.55, stealth: 0.95 },
      counterfactual: "不选 C：提前暴露拦截阵位，敌可重规划绕行。",
      failure: "若南线低空丢失跟踪，G-A 借地形遮蔽突防至 K-1 6km。",
      evidenceGap: "南线低空雷达覆盖弱（Charlie 衰减），跟踪连续性存疑。",
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
  "G-A": [
    {
      stage: "observation",
      title: "观测 · 雷达 Alpha + EO-2",
      detail: "雷达 Alpha 主跟踪 14 回波，EO-2 二次确认 6 目标外形。原始回波不可改写。",
      provenance: "Radar-Alpha v4.2 / EO-2 v2.1",
      confidence: 0.88,
      time: "14:02:31",
      replayable: true,
    },
    {
      stage: "fusion",
      title: "融合 · 编队关联",
      detail: "按速度/航向/间距聚为单一编队 G-A，关联判据：航向偏差 <3°、间距 <2km。",
      provenance: "FusionSvc v3.4 / model track-assoc-11",
      confidence: 0.84,
      time: "14:02:33",
      replayable: true,
    },
    {
      stage: "trust",
      title: "信任 · trusted",
      detail: "双源覆盖（雷达 + EO），无衰减、无噪声告警，可作授权依据。",
      provenance: "TrustState v2.0",
      confidence: 0.86,
      time: "14:02:34",
      replayable: true,
    },
    {
      stage: "hypothesis",
      title: "假设 · 对 K-1 实施饱和突击",
      detail: "支持：航向直指 K-1、编队密集。反证：暂无。证伪测试：观察是否在 T+60s 散开。",
      provenance: "HypoEngine v1.6 / rule-set saturate-3",
      confidence: 0.79,
      time: "14:02:36",
      replayable: true,
    },
  ],
  "G-C": [
    {
      stage: "observation",
      title: "观测 · 仅 RF-1 单源",
      detail: "RF-1 截获辐射特征，无雷达硬回波佐证，原始信噪比偏低。",
      provenance: "RF-1 v1.9",
      confidence: 0.52,
      time: "14:02:18",
      replayable: true,
    },
    {
      stage: "fusion",
      title: "融合 · 弱关联",
      detail: "RF 特征与已知诱饵库匹配度 0.61，关联强度弱。",
      provenance: "FusionSvc v3.4 / decoy-lib v7",
      confidence: 0.58,
      time: "14:02:20",
      replayable: true,
    },
    {
      stage: "trust",
      title: "信任 · 待补证（禁入授权依据）",
      detail: "单源、信噪比不足，不可作授权依据。建议调 EO-2 / RF 二次确认。",
      provenance: "TrustState v2.0",
      confidence: 0.55,
      time: "14:02:21",
      replayable: true,
    },
    {
      stage: "hypothesis",
      title: "假设 · 诱饵牵制",
      detail: "支持：RF 特征像诱饵、无硬回波。反证：可能为低 RCS 真目标。证据缺口：缺 EO 外形确认。",
      provenance: "HypoEngine v1.6",
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
    id: "TSK-01",
    authorizationId: "AUTH-2291",
    name: "G-D 身份补证",
    targetId: "G-D",
    envelope: {
      scope: "EO-2 / RF-1 传感器二次确认 · AOR-7 内 · 仅观测",
      ttlSec: 420,
      ttlTotalSec: 600,
      budgetUsed: 12,
      budgetTotal: 30,
      failClosed: "越出 AOR-7 或调用处置能力即停",
    },
    confidenceCurve: [0.41, 0.48, 0.55, 0.62, 0.71, 0.78],
    corroborationCount: 12,
    effect: "climbing",
    actions: [
      { time: "14:01:40", actor: "EO-2", result: "外形确认：低慢小，识别 0.62" },
      { time: "14:01:50", actor: "RF-1", result: "无武器辐射特征，识别 0.71" },
      { time: "14:02:00", actor: "EO-2", result: "持续跟踪，识别 0.78" },
    ],
  },
  {
    id: "TSK-02",
    authorizationId: "AUTH-2287",
    name: "G-C 诱饵证伪",
    targetId: "G-C",
    envelope: {
      scope: "EO-2 二次确认 · NF-2 外 · 仅观测",
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
      { time: "14:00:30", actor: "EO-2", result: "外形不清，疑似诱饵 0.58" },
      { time: "14:01:10", actor: "EO-2", result: "RCS 异常低，维持诱饵假设 0.61" },
    ],
  },
  {
    id: "TSK-03",
    authorizationId: "AUTH-2280",
    name: "G-A 持续跟踪",
    targetId: "G-A",
    envelope: {
      scope: "雷达 Alpha + EO-2 融合跟踪 · AOR-7 内",
      ttlSec: 60,
      ttlTotalSec: 600,
      budgetUsed: 48,
      budgetTotal: 60,
      failClosed: "TTL 耗尽，需续签",
    },
    confidenceCurve: [0.8, 0.82, 0.85, 0.86, 0.88, 0.88],
    corroborationCount: 48,
    effect: "breach",
    actions: [
      { time: "14:02:20", actor: "Fusion", result: "融合跟踪稳定 0.88" },
      { time: "14:02:35", actor: "系统", result: "TTL 余 60s — 越界预警，需续签" },
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
  { id: "DP-07", title: "G-A 主攻群裁决", status: "active", time: "14:02:36" },
  { id: "DP-06", title: "G-D 身份补证授权", status: "committed", time: "14:01:38", coa: "补证 EO/RF" },
  { id: "DP-05", title: "G-C 诱饵证伪", status: "committed", time: "14:00:28", coa: "补证 EO-2" },
  { id: "DP-04", title: "Bravo 扇区移交", status: "closed", time: "13:58:02", coa: "COA-2" },
  { id: "DP-03", title: "海上接触 G-E 放行", status: "closed", time: "13:54:11", coa: "放行" },
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
    text: "G-C 为什么判诱饵？",
    time: "14:01:55",
  },
  {
    id: "m2",
    role: "copilot",
    text: "G-C 仅 RF-1 单源，匹配诱饵库 0.61，无雷达硬回波与 EO 外形佐证，信任为「待补证」，不可作授权依据。已在地图定位 G-C，证据链见 placard。",
    artifact: "answer",
    time: "14:01:56",
  },
];
