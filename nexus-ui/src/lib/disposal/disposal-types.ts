/**
 * disposal-types — 处置方案数据结构定义
 *
 * 【与 V2 autoDisposalMode / disposalHandler 对齐】
 *
 * 【完整数据流】
 *   1. 触发方式：
 *      a) 一键处置：TargetPlacard「一键处置」按钮 → buildTargetInfoFromTrack → fetchDisposalPlansHttp
 *      b) WS 自动推送：DisposalPlanWsClient 监听后端 disposal_plans_required 消息
 *   2. 归一化：
 *      后端 HTTP/WS 响应 → normalizeDisposalPlansFromHttpJson / normalizeDisposalPlansFromWsJson
 *      → normalizeDisposalPayload → mapSchemeToCardScheme（提取 recommendationScore）
 *      → rankSchemesByRecommendationScore（按 recommendationScore 降序排名赋 P0/P1/P2）
 *      → NormalizedDisposalPlans
 *   3. 存储：
 *      NormalizedDisposalPlans → disposalPlanStore.appendFromNormalized
 *      → DisposalPlanBlock + DisposalPlanCardRow
 *   4. 展示：
 *      DisposalPlanFeed UI（右侧 AI 助手面板）→ SchemeRow 卡片（P0/P1/P2 徽章 + 执行按钮）
 *   5. 执行：
 *      用户点击「执行」→ executeScheme → postDisposalExecute → applySchemeSideEffects
 *      - 激活激光/TDOA 扇区
 *      - 绘制资产→目标连线
 *      - 更新执行状态（executedSchemeIds / executingSchemeIds）
 *
 * 【后端响应结构（disposal_plans_required）】
 *   {
 *     type: "disposal_plans_required",
 *     taskId: string,
 *     data: {
 *       target_info: { targetId, targetType, targetAttribute, distance, longitude, latitude, ... },
 *       disposal_schemes: [{
 *         schemeId, schemeName, description,
 *         tasks: [{ deviceId, deviceName, targetId, actionName, recommendationScore, redForceInfo, blueForceInfo }],
 *         areaType, targetDist
 *       }],
 *       task_id: string
 *     }
 *   }
 *
 * 【优先级体系】
 *   - recommendationScore: 后端原始推荐得分（0~100），数值越大方案越优
 *   - maxRecommendationScore: 方案内所有 task 的最高 recommendationScore
 *   - priority: 排名等级（0=P0 最高，1=P1，2=P2…），由 rankSchemesByRecommendationScore 赋值
 *   - UI 展示：P0=琥珀色、P1=天蓝色、P2+=灰色
 *
 * 关键类型：
 *   - MappedDisposalScheme: 单个方案（含 schemeId、tasks 列表、红蓝方信息、priority、maxRecommendationScore）
 *   - MappedDisposalTask: 方案内单个任务（设备 + 动作 + recommendationScore + 红蓝方信息）
 *   - NormalizedDisposalPlans: 归一化后的完整方案包（含 taskId、target、items）
 *   - DisposalInputParams: 方案输入参数（targetId、类型、坐标、速度等）
 */

/** 方案来源：ws=WebSocket 自动推送，http=一键处置手动触发 */
export type DisposalPlanSource = "ws" | "http";

/** 方案内单个任务：一个设备对一个目标执行一个动作 */
export interface MappedDisposalTask {
  /** 执行设备 ID（如 laser-001, uav-007） */
  deviceId: string;
  /** 目标 ID（通常与 inputParams.targetId 一致） */
  targetId: string;
  /** 设备名称（显示用） */
  deviceName: string;
  /** 动作名称（如「激光打击」「光电查证」「区域搜索」） */
  actionName: string;
  /** 推荐得分（后端 recommendationScore，数值越大优先级越高；用于方案排序和 P0/P1/P2 分级） */
  recommendationScore: number;
  /** 红方信息（执行方/我方设备详情） */
  redForceInfo: Record<string, unknown>;
  /** 蓝方信息（目标方/敌方详情，含坐标） */
  blueForceInfo: Record<string, unknown>;
}

/** 单个处置方案：含方案 ID、名称、优先级、任务列表、红蓝方信息 */
export interface MappedDisposalScheme {
  /** 方案唯一 ID */
  schemeId: string;
  /** 方案名称（显示用） */
  schemeName: string;
  /** 方案描述 */
  description: string;
  /** 优先级等级（0=P0 最高，1=P1，2=P2…；由 recommendationScore 降序排名得出） */
  priority: number;
  /** 方案内所有 task 的最高 recommendationScore（后端原始推荐得分，数值越大越优） */
  maxRecommendationScore: number;
  /** 目标距离（可选，展示用） */
  targetDist?: unknown;
  /** 处置目标 ID */
  disposalTargetId: string;
  /** 方案内任务列表 */
  tasks: MappedDisposalTask[];
  /** 红方整体信息 */
  red_force_info: Record<string, unknown>;
  /** 蓝方整体信息 */
  blue_force_info: Record<string, unknown>;
  /** 原始后端响应数据（保留完整信息供后续解析） */
  _raw: Record<string, unknown>;
}

/** 方案输入参数：触发方案时的目标信息 */
export interface DisposalInputParams {
  /** 目标业务 trackId（告警匹配用） */
  targetId: string;
  /** 目标类型：0=对海, 1=对空, 或字符串如 "uav"/"ship" */
  targetType?: string | number;
  /** 目标属性（如 BLUE_FORCE） */
  targetAttribute?: string;
  /** 目标距离（km） */
  distance?: number;
  /** 目标经度 */
  longitude?: number;
  /** 目标纬度 */
  latitude?: number;
  /** 目标所在区域 */
  area?: unknown;
  /** 指定方案 ID（可选，用于自主值班等场景） */
  schemeId?: string;
  /** 识别依据 */
  identificationBasis?: unknown;
  /** 目标航速（kn） */
  speed?: number;
  /** 目标航向（°） */
  course?: number;
}

/** 归一化后的单个方案项：一组方案 + 输入参数 + 用户查询 */
export interface NormalizedDisposalItem {
  /** 该项目下的所有方案列表 */
  mappedSchemes: MappedDisposalScheme[];
  /** 当前选中的方案（可选） */
  selectedScheme: MappedDisposalScheme | null;
  /** 输入参数 */
  inputParams: DisposalInputParams;
  /** 用户原始查询文本 */
  userQuery: string;
  /** 未生成方案的原因（如「未生成有效方案」） */
  noPlansReason?: string;
}

/** 归一化后的完整方案包：一个任务 ID 下可能有多组方案 */
export interface NormalizedDisposalPlans {
  /** 任务 ID（后端返回） */
  taskId: string;
  /** 目标信息（原始后端数据） */
  target: Record<string, unknown>;
  /** 所有方案的平铺列表（跨 items 合并） */
  mappedSchemes: MappedDisposalScheme[];
  /** 方案项列表（每组包含输入参数 + 方案列表） */
  items: NormalizedDisposalItem[];
}

/** 一键处置请求载荷（buildOneClickDisposalRequestBody 输出） */
export interface OneClickDisposalPayload {
  targetInfo: {
    /** 目标业务 trackId */
    targetId: string;
    /** 目标类型：0=对海, 1=对空 */
    targetType: number;
    /** 目标经度 */
    longitude: number;
    /** 目标纬度 */
    latitude: number;
    /** 目标航速（kn） */
    speed: number;
    /** 目标航向（°） */
    course: number;
  };
}
