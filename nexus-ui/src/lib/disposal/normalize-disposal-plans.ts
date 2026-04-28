/**
 * normalize-disposal-plans — 后端处置方案响应归一化
 *
 * 【作用】将后端 HTTP/WS 返回的原始 JSON 解析为前端统一的 NormalizedDisposalPlans 结构，
 *   供 disposalPlanStore.appendFromNormalized 消费。
 *
 * 【数据流】
 *   后端响应 JSON → normalizeDisposalPlansFromHttpJson / normalizeDisposalPlansFromWsJson
 *   → NormalizedDisposalPlans → disposalPlanStore → DisposalPlanFeed UI
 *
 * 【三种解析入口】
 *   1. normalizeDisposalPlansFromHttpJson: HTTP 200 响应解析
 *   2. normalizeDisposalPlansFromWsJson: WebSocket 消息解析
 *   3. buildNormalizedDisposalPlansFromHttp500Detail: HTTP 500 业务说明（如「未生成有效方案」）
 *
 * 【与 V2 对齐】autoDisposalMode.js 的解析逻辑
 *
 * 【关键步骤】
 *   - extractTargetIdFromDisposalSchemes: 从方案 tasks 中提取目标 ID
 *   - mapDisposalScheme: 单个方案映射（后端 → MappedDisposalScheme）
 *   - mapDisposalTask: 单个任务映射（后端 → MappedDisposalTask）
 *   - buildGrpcDisposalExecuteBody: 构建执行请求体
 */

import { useAssetStore } from "@/stores/asset-store";
import { useDroneStore } from "@/stores/drone-store";
import type {
  DisposalInputParams,
  MappedDisposalScheme,
  MappedDisposalTask,
  NormalizedDisposalItem,
  NormalizedDisposalPlans,
} from "./disposal-types";

/**
 * 从方案 tasks 列表中提取第一个有效目标 ID。
 * 遍历所有方案的所有 task，返回第一个非空、非 "unknown" 的 targetId。
 * 用作 fallback：当 target_info.targetId 缺失时的兜底。
 */
function extractTargetIdFromDisposalSchemes(schemes: unknown[]): string {
  if (!Array.isArray(schemes)) return "";
  for (const s of schemes) {
    const tasks = Array.isArray((s as { tasks?: unknown[] })?.tasks) ? (s as { tasks: unknown[] }).tasks : [];
    for (const t of tasks) {
      const id = (t as { targetId?: unknown })?.targetId;
      if (id == null || id === "") continue;
      const str = String(id).trim();
      if (!str || str.toLowerCase() === "unknown") continue;
      return str;
    }
  }
  return "";
}

export function formatTargetKindPhraseFromTargetInfo(targetInfo: Record<string, unknown> = {}): string {
  const raw = targetInfo?.targetType;
  if (raw === 1 || raw === "1") return "空中目标";
  if (raw === 0 || raw === "0") return "海上目标";
  const n = Number(raw);
  if (raw != null && raw !== "" && Number.isFinite(n)) {
    if (n === 1) return "空中目标";
    if (n === 0) return "海上目标";
  }
  const t = String(raw || "")
    .trim()
    .toLowerCase();
  if (t === "uav" || t === "drone" || t === "air" || t === "aircraft") return "空中目标";
  if (t === "ship" || t === "boat" || t === "sea") return "海上目标";
  return "";
}

export function formatTargetIdForUi(targetId: string | number | null | undefined, targetType: string | number | null | undefined): string {
  if (targetId == null || targetId === "") return "";
  const raw = String(targetId).trim();
  const n = Number(targetType);
  const isSea =
    targetType === 0 ||
    targetType === "0" ||
    (targetType != null && targetType !== "" && Number.isFinite(n) && n === 0);
  if (!isSea) return raw;
  return raw.length > 4 ? raw.slice(-4) : raw;
}

export function buildDisposalCardUserQuery(targetId: string, inputParams: DisposalInputParams = {} as DisposalInputParams): string {
  const kindPhrase = formatTargetKindPhraseFromTargetInfo(inputParams as unknown as Record<string, unknown>);
  const kindPart = kindPhrase ? `（${kindPhrase}）` : "";
  const displayId = formatTargetIdForUi(String(targetId), inputParams?.targetType);
  return `目标 ${displayId}${kindPart} 处置方案`;
}

/**
 * 按 recommendationScore 降序排名，赋值 priority（0=P0 最高，1=P1，2=P2…）
 * 同组内方案按 maxRecommendationScore 降序排列，得分最高者为 P0。
 * 数据流：mapSchemeToCardScheme 产出 priority=0 的临时方案 → 本函数统一排名 → 最终 priority
 */
function rankSchemesByRecommendationScore(schemes: MappedDisposalScheme[]): void {
  const sorted = [...schemes].sort((a, b) => b.maxRecommendationScore - a.maxRecommendationScore);
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].priority = i;
  }
}

function pickHighestPriorityScheme(mappedList: MappedDisposalScheme[]): MappedDisposalScheme | null {
  if (!Array.isArray(mappedList) || mappedList.length === 0) return null;
  /* 按 maxRecommendationScore 降序取最高分方案 */
  return [...mappedList].sort((a, b) => b.maxRecommendationScore - a.maxRecommendationScore)[0];
}

/**
 * 方案分组 key：同一目标的方案归入同一组（同一 DisposalPlanCardRow）。
 * 优先取 mapped.disposalTargetId，回退到 tasks[0].targetId，再回退到 fallbackTargetId。
 */
function groupKeyForMappedScheme(mapped: MappedDisposalScheme, fallbackTargetId: string): string {
  const raw =
    mapped?.disposalTargetId ?? (mapped?.tasks?.[0]?.targetId != null ? String(mapped.tasks[0].targetId) : "");
  const s = String(raw || "").trim();
  if (s && s.toLowerCase() !== "unknown") return s;
  const fb = String(fallbackTargetId ?? "").trim();
  if (fb && fb.toLowerCase() !== "unknown") return fb;
  return "_";
}

/**
 * 通过设备 ID 查找资产 store 中的友好名称（如 "uav-011" → "无人机011"）。
 * 查找路径：
 *   1. asset-store.assets 按 id 精确匹配
 *   2. asset-store.assets 按 properties.entity_id 匹配（处置方案常用 entityId 如 uav-101）
 *   3. drone-store.entityIdToDeviceSn 映射 → 再按 deviceSn 查 asset-store
 * 找不到则回退到 fallbackName 或原始 ID。
 */
function resolveDeviceNameById(deviceId: string, fallbackName: string): string {
  const sid = String(deviceId || "").trim();
  if (!sid) return fallbackName || "";
  const low = sid.toLowerCase();
  const assets = useAssetStore.getState().assets;

  // 1. 按 id 精确匹配（大小写不敏感）
  const byId = assets.find((x) => x.id === sid || x.id.toLowerCase() === low);
  if (byId?.name) return byId.name;

  // 2. 按 properties.entity_id 匹配
  for (const a of assets) {
    const p = a.properties && typeof a.properties === "object" ? (a.properties as Record<string, unknown>) : null;
    if (!p) continue;
    const eid = p.entity_id ?? p.entityId;
    if (typeof eid === "string" && (eid === sid || eid.toLowerCase() === low)) {
      if (a.name) return a.name;
    }
  }

  // 3. 通过 drone-store entityIdToDeviceSn 映射
  const entityMap = useDroneStore.getState().entityIdToDeviceSn as Record<string, string>;
  let sn: string | undefined = entityMap[sid];
  if (!sn) {
    for (const [eid, mappedSn] of Object.entries(entityMap)) {
      if (eid.toLowerCase() === low) {
        sn = mappedSn;
        break;
      }
    }
  }
  if (sn) {
    const bySn = assets.find((x) => x.id === sn);
    if (bySn?.name) return bySn.name;
  }

  return fallbackName || sid;
}

/**
 * 从方案名称中提取红方设备 ID（如 "方案1: uav-011 → 19" → "uav-011"）。
 * 用于 task 缺少 redForceInfo.id 时的回退。
 */
function extractRedIdFromSchemeName(name = ""): string {
  const str = String(name || "");
  const m = str.match(/:\s*([^\s→-][^→]*)\s*→/);
  if (!m || !m[1]) return "";
  return String(m[1]).trim();
}

/**
 * 根据 redForceInfo.unitType 或设备 ID 推断动作名称（如 drone→跟踪拦截，laser→打击）。
 * 仅在 task.actionName 缺失时使用。
 */
function inferActionName(redInfo: Record<string, unknown>, redId: string): string {
  const unitType = String(redInfo?.unitType || "").toLowerCase();
  const id = String(redId || redInfo?.id || "").toLowerCase();
  if (unitType.includes("tdoa") || id.includes("tdoa")) return "驱离";
  if (unitType.includes("drone") || unitType.includes("uav") || id.includes("uav")) return "跟踪拦截";
  if (unitType.includes("laser") || unitType.includes("camera") || id.includes("opto") || id.includes("camera")) return "打击";
  return "打击";
}

/**
 * 单个方案映射：后端原始 scheme → MappedDisposalScheme。
 *
 * 关键步骤：
 *   1. 遍历 tasks，提取 deviceId/targetId/actionName/recommendationScore/redForceInfo/blueForceInfo
 *   2. resolveDeviceNameById 查找友好设备名
 *   3. 计算 maxRecommendationScore（方案内最高推荐得分）
 *   4. priority 暂设 0，后续由 rankSchemesByRecommendationScore 统一赋值
 */
function mapSchemeToCardScheme(
  scheme: Record<string, unknown>,
  index: number,
): MappedDisposalScheme | null {
  const rawTasks = Array.isArray(scheme?.tasks) ? (scheme.tasks as Record<string, unknown>[]) : [];
  if (!rawTasks.length) return null;

  const schemeRed = (scheme.red_force_info || scheme.redForce) as Record<string, unknown> | undefined;
  const schemeBlue = (scheme.blue_force_info || scheme.blueForce) as Record<string, unknown> | undefined;
  const schemeRedSafe = schemeRed && typeof schemeRed === "object" ? schemeRed : {};
  const schemeBlueSafe = schemeBlue && typeof schemeBlue === "object" ? schemeBlue : {};
  const parsedRedId = extractRedIdFromSchemeName(String(scheme?.schemeName ?? ""));

  const mappedTasks: MappedDisposalTask[] = rawTasks.map((t, ti) => {
    const r = (t?.redForceInfo || {}) as Record<string, unknown>;
    const b = (t?.blueForceInfo || {}) as Record<string, unknown>;
    const redId = String((r?.id as string) || t?.deviceId || parsedRedId || `设备${index + 1}_${ti + 1}`);
    const actionName = String(t?.actionName || inferActionName(r, redId));
    const resolvedName = resolveDeviceNameById(redId, String(t?.deviceName || redId));
    /* 提取后端 recommendationScore（推荐得分，数值越大优先级越高） */
    const rawScore = (t as { recommendationScore?: unknown })?.recommendationScore;
    const score = typeof rawScore === "number" && Number.isFinite(rawScore) ? rawScore : 0;
    return {
      deviceId: redId,
      targetId: t?.targetId != null ? String(t.targetId) : "",
      deviceName: resolvedName,
      actionName,
      recommendationScore: score,
      redForceInfo: r,
      blueForceInfo: b,
    };
  });

  const first = rawTasks[0] as Record<string, unknown> | undefined;
  const rFirst = (first?.redForceInfo || {}) as Record<string, unknown>;
  const bFirst = (first?.blueForceInfo || {}) as Record<string, unknown>;
  const red = rFirst && Object.keys(rFirst).length ? rFirst : schemeRedSafe;
  const blue = bFirst && Object.keys(bFirst).length ? bFirst : schemeBlueSafe;
  const tid = first?.targetId;
  const dtid = (tid != null && String(tid).trim() !== "" && String(tid).toLowerCase() !== "unknown"
    ? String(tid)
    : String(mappedTasks[0]?.targetId || ""));

  /* 方案内所有 task 的最高 recommendationScore */
  const maxScore = mappedTasks.reduce((mx, t) => Math.max(mx, t.recommendationScore), 0);

  /* schemeName 中可能包含 entityId（如 "方案3: uav-101 → 40504"），替换为友好名称 */
  const rawSchemeName = String(scheme?.schemeName || `方案${index + 1}`);
  const schemeName = mappedTasks.reduce((name, t) => {
    if (t.deviceId && t.deviceName && t.deviceName !== t.deviceId) {
      return name.replaceAll(t.deviceId, t.deviceName);
    }
    return name;
  }, rawSchemeName);

  return {
    schemeId: String(scheme?.schemeId || scheme?.scheme_id || `scheme_${index + 1}`),
    schemeName,
    description: String(
      scheme?.description || `${(red as { unitType?: string })?.unitType || "unknown"} 处置 ${(blue as { id?: string })?.id || ""}`.trim(),
    ),
    /* priority 初始值暂取 0，后续由 rankSchemesByRecommendationScore 统一按 recommendationScore 降序排名赋值 */
    priority: 0,
    maxRecommendationScore: maxScore,
    targetDist: (scheme as { targetDist?: unknown }).targetDist,
    disposalTargetId: dtid,
    tasks: mappedTasks,
    red_force_info: red,
    blue_force_info: blue,
    _raw: scheme,
  };
}

/**
 * 从方案和 target_info 构建输入参数 DisposalInputParams。
 * 提取 targetId/targetType/distance/longitude/latitude/area/schemeId/identificationBasis 等。
 * targetType 推断：优先 target_info，回退到 blueForceInfo.unitType（drone→1=对空，boat→0=对海）。
 */
function buildInputParamsForMappedScheme(mappedScheme: MappedDisposalScheme, targetInfo: Record<string, unknown>): DisposalInputParams {
  const rawTid = mappedScheme.disposalTargetId ?? mappedScheme.tasks?.[0]?.targetId;
  const targetId =
    rawTid != null && String(rawTid).trim() !== "" && String(rawTid).toLowerCase() !== "unknown" ? String(rawTid).trim() : "";
  const blue = (mappedScheme.tasks?.[0]?.blueForceInfo || {}) as Record<string, unknown>;
  const vx = Number(blue.velX ?? targetInfo.velocity_x ?? 0);
  const vy = Number(blue.velY ?? targetInfo.velocity_y ?? 0);
  const speed = Math.sqrt(vx * vx + vy * vy);
  const pickFinite = (...vals: unknown[]) => {
    for (const v of vals) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  };
  const resolvedDistance = pickFinite(
    mappedScheme.targetDist,
    (mappedScheme._raw as { targetDist?: unknown })?.targetDist,
    (mappedScheme._raw as { target_dist?: unknown })?.target_dist,
    (mappedScheme._raw as { distance?: unknown })?.distance,
    blue.distance,
    targetInfo.distance,
    targetInfo.range,
    speed,
  );
  let targetType = targetInfo.targetType;
  const u = String(blue.unitType || "").toLowerCase();
  const explicit01 =
    targetType === 0 ||
    targetType === "0" ||
    targetType === 1 ||
    targetType === "1" ||
    (targetType != null &&
      targetType !== "" &&
      Number.isFinite(Number(targetType)) &&
      (Number(targetType) === 0 || Number(targetType) === 1));
  if (!explicit01) {
    if (u.includes("drone") || u.includes("uav") || u.includes("air")) targetType = 1;
    else if (u.includes("ship") || u.includes("boat") || u.includes("sea")) targetType = 0;
  }
  const attr = targetInfo.targetAttribute;
  return {
    targetId,
    targetType: targetType as string | number | undefined,
    targetAttribute: attr === "BLUE" ? "BLUE_FORCE" : String(attr || "BLUE_FORCE"),
    distance: resolvedDistance,
    longitude: (blue.longitude as number) ?? (targetInfo.longitude as number | undefined),
    latitude: (blue.latitude as number) ?? (targetInfo.latitude as number | undefined),
    area: targetInfo.area,
    schemeId: mappedScheme.schemeId,
    identificationBasis: targetInfo.identificationBasis,
  };
}

/**
 * 核心归一化入口：后端原始 payload → NormalizedDisposalPlans。
 *
 * 步骤：
 *   1. 解析两种 WS 消息格式（data 包裹 / 顶层直传）
 *   2. mapSchemeToCardScheme 逐个映射方案（提取 recommendationScore）
 *   3. rankSchemesByRecommendationScore 按 recommendationScore 降序排名赋 P0/P1/P2
 *   4. groupKeyForMappedScheme 按目标 ID 分组
 *   5. pickHighestPriorityScheme 每组选最高分方案作为 selectedScheme
 *   6. buildInputParamsForMappedScheme 构建输入参数
 */
export function normalizeDisposalPayload(payload: Record<string, unknown>): NormalizedDisposalPlans | null {
  const data = (payload?.data as Record<string, unknown>) || {};
  /* 两种 WS 消息格式：
   *   1) { type, data: { target_info, disposal_schemes, task_id } }  — data 包裹
   *   2) { type, target_info, disposal_schemes, task_id }             — 顶层直传
   */
  const target = (data?.target_info || data?.targetInfo || payload?.target_info || payload?.targetInfo || {}) as Record<string, unknown>;
  const rawSchemes = data?.disposal_schemes ?? payload?.disposal_schemes;
  const schemes = Array.isArray(rawSchemes) ? (rawSchemes as Record<string, unknown>[]) : [];
  const taskId = String(
    (data.task_id ?? (payload as { task_id?: string }).task_id) || `auto_${Date.now()}`,
  );

  const mappedSchemes = schemes
    .map((s, i) => mapSchemeToCardScheme(s, i))
    .filter((x): x is MappedDisposalScheme => x != null);

  const fallbackTid = target?.targetId != null && String(target.targetId).trim() !== "" ? String(target.targetId).trim() : "";

  const groups = new Map<string, MappedDisposalScheme[]>();
  for (const mapped of mappedSchemes) {
    const key = groupKeyForMappedScheme(mapped, fallbackTid);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(mapped);
  }

  /* 按目标分组排名：每组内按 recommendationScore 降序赋 P0/P1/P2… */
  for (const list of groups.values()) {
    rankSchemesByRecommendationScore(list);
  }

  const items: NormalizedDisposalItem[] = [];
  for (const list of groups.values()) {
    const best = pickHighestPriorityScheme(list);
    if (!best) continue;
    const targetId =
      best.disposalTargetId ||
      best.tasks?.[0]?.targetId ||
      (fallbackTid && fallbackTid.toLowerCase() !== "unknown" ? fallbackTid : "") ||
      "";
    const inputParams = buildInputParamsForMappedScheme(best, target);
    items.push({
      mappedSchemes: list,
      selectedScheme: best,
      inputParams,
      userQuery: buildDisposalCardUserQuery(targetId, inputParams),
    });
  }

  if (!items.length) {
    const fallbackTargetId =
      extractTargetIdFromDisposalSchemes(schemes) || (fallbackTid && fallbackTid.toLowerCase() !== "unknown" ? fallbackTid : "");
    const fallbackInputParams: DisposalInputParams = {
      targetId: fallbackTargetId,
      targetType: target?.targetType as string | number | undefined,
      targetAttribute: String(target?.targetAttribute || "BLUE_FORCE"),
      distance: 0,
      longitude: target?.longitude as number | undefined,
      latitude: target?.latitude as number | undefined,
      area: target?.area,
      schemeId: "",
      identificationBasis: target?.identificationBasis,
    };
    items.push({
      mappedSchemes: [],
      selectedScheme: null,
      inputParams: fallbackInputParams,
      userQuery: buildDisposalCardUserQuery(fallbackTargetId, fallbackInputParams),
    });
  }

  return {
    taskId,
    target,
    mappedSchemes,
    items,
  };
}

/**
 * 与 V2 `ChatContainer` 监听 `triggerDisposal`：HTTP 500 且响应体含 `detail` 时，
 * 不抛错，拼一条「无方案」卡片（`noPlansReason`），仍写入会话侧栏。
 */
export function buildNormalizedDisposalPlansFromHttp500Detail(
  detail: string,
  disposalData: { targetInfo?: Record<string, unknown> },
): NormalizedDisposalPlans {
  const ti = (disposalData.targetInfo || {}) as Record<string, unknown>;
  const targetId = ti.targetId != null ? String(ti.targetId).trim() : "";
  const inputParams500: DisposalInputParams = {
    targetId,
    targetType: Number(ti.targetType) || 0,
    targetAttribute:
      ti.targetAttribute === "BLUE" ? "BLUE_FORCE" : String(ti.targetAttribute || "BLUE_FORCE"),
    distance: ti.distance != null ? Number(ti.distance) || 0 : 0,
    longitude: ti.longitude as number | undefined,
    latitude: ti.latitude as number | undefined,
    area: ti.area,
    schemeId: String(ti.schemeId ?? ""),
    identificationBasis: ti.identificationBasis,
    speed: ti.speed as number | undefined,
    course: ti.course as number | undefined,
  };
  const normalized: NormalizedDisposalPlans = {
    taskId: `http_500_${Date.now()}`,
    target: {
      targetId,
      targetType: ti.targetType,
      targetAttribute: ti.targetAttribute || "BLUE",
      distance: ti.distance,
      longitude: ti.longitude,
      latitude: ti.latitude,
      area: ti.area,
      schemeId: ti.schemeId,
      identificationBasis: ti.identificationBasis,
    },
    mappedSchemes: [],
    items: [
      {
        mappedSchemes: [],
        selectedScheme: null,
        inputParams: inputParams500,
        userQuery: buildDisposalCardUserQuery(targetId || "未知", inputParams500),
        noPlansReason: detail.trim(),
      },
    ],
  };
  return mergeDisposalInputParamsFromRequest(normalized, disposalData);
}

/**
 * 一键处置 HTTP 响应与 WS 相同整包，再 merge 本次请求的 targetInfo
 */
export function mergeDisposalInputParamsFromRequest(
  normalized: NormalizedDisposalPlans,
  disposalData: { targetInfo?: Record<string, unknown>; targetId?: unknown; targetType?: unknown; targetAttribute?: unknown; distance?: unknown } = {},
): NormalizedDisposalPlans {
  const ti = (disposalData.targetInfo || {}) as Record<string, unknown>;
  const targetIdStr = ti.targetId != null ? String(ti.targetId) : String(disposalData.targetId ?? "");
  const multi = (normalized.items?.length || 0) > 1;

  for (const item of normalized.items || []) {
    const ip = item.inputParams || ({} as DisposalInputParams);
    item.inputParams = {
      ...ip,
      targetId: multi ? ip.targetId : (targetIdStr || ip.targetId),
      targetType: ti.targetType !== undefined ? ti.targetType : disposalData.targetType !== undefined ? disposalData.targetType : ip.targetType,
      longitude: (ti.longitude as number | undefined) ?? ip.longitude,
      latitude: (ti.latitude as number | undefined) ?? ip.latitude,
      speed: (ti.speed as number | undefined) ?? ip.speed,
      course: (ti.course as number | undefined) ?? ip.course,
      targetAttribute: (disposalData.targetAttribute as string) || String(ip.targetAttribute || "BLUE_FORCE"),
      distance:
        disposalData.distance != null
          ? Number(disposalData.distance) || 0
          : ti.distance != null
            ? Number(ti.distance) || 0
            : ip.distance,
    } as DisposalInputParams;
  }
  return normalized;
}

export function normalizeDisposalPlansFromHttpJson(
  json: unknown,
  disposalData: { targetInfo?: Record<string, unknown>; targetId?: unknown } = {},
): NormalizedDisposalPlans | null {
  if (!json || typeof json !== "object") return null;

  let payload: Record<string, unknown> = json as Record<string, unknown>;
  const inner = (json as { data?: { type?: string } }).data;
  if (inner && typeof inner === "object" && (inner as { type?: string }).type === "disposal_plans_required") {
    payload = inner as Record<string, unknown>;
  }

  if (payload.type !== "disposal_plans_required" || !payload.data) return null;
  const normalized = normalizeDisposalPayload(payload);
  if (!normalized?.items?.length) return null;
  return mergeDisposalInputParamsFromRequest(normalized, disposalData);
}

/** grpc-disposal/execute 请求体 */
export function buildGrpcDisposalExecuteBody(selectedScheme: MappedDisposalScheme, parentTaskId: string) {
  const raw = (selectedScheme?._raw || {}) as Record<string, unknown>;
  const firstTask = Array.isArray(raw?.tasks) && (raw.tasks as unknown[]).length
    ? ((raw.tasks as Record<string, unknown>[])[0] as Record<string, unknown>)
    : ({} as Record<string, unknown>);
  const firstMapped = Array.isArray(selectedScheme?.tasks) && selectedScheme.tasks.length
    ? (selectedScheme.tasks[0] as unknown as Record<string, unknown>)
    : ({} as Record<string, unknown>);
  const red =
    (selectedScheme as { red_force_info?: unknown }).red_force_info ||
    firstTask?.redForceInfo ||
    (firstMapped as { redForceInfo?: unknown })?.redForceInfo ||
    raw?.red_force_info ||
    (raw as { redForce?: unknown })?.redForce;
  const blue =
    (selectedScheme as { blue_force_info?: unknown }).blue_force_info ||
    firstTask?.blueForceInfo ||
    (firstMapped as { blueForceInfo?: unknown })?.blueForceInfo ||
    raw?.blue_force_info ||
    (raw as { blueForce?: unknown })?.blueForce;
  const normalizedRed = { ...(red && typeof red === "object" ? (red as object) : {}), currentTargetId: "" };
  const normalizedBlue = { ...(blue && typeof blue === "object" ? (blue as object) : {}), isTargeted: false };
  return {
    scheme_id: selectedScheme.schemeId || (raw as { scheme_id?: string }).scheme_id || (raw as { schemeId?: string }).schemeId || "",
    red_force_info: normalizedRed,
    blue_force_info: normalizedBlue,
    parent_task_id: parentTaskId,
  };
}
