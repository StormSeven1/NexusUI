"use client";

/**
 * QuickWorkflowModal — 快捷工作流弹窗
 *
 * 【触发】WorkspaceDetails 任务→规划 按钮点击
 *
 * 【数据流】
 *   1. 8 个快捷工作流配置（QUICK_WORKFLOWS 数组）
 *   2. 用户点击卡片 → POST quickWorkflowUrl
 *      body: { thread_id, workflow_id, parameters }
 *      - thread_id: 唯一标识（`qw_{timestamp}_{random}`）
 *      - workflow_id: 对应卡片配置的 id 字段
 *      - parameters: 从 default_parameters 取非空值合并
 *   3. 后端返回工作流执行结果
 *
 * 【POST 请求体示例（蓝军进攻）】
 *   {
 *     "thread_id": "qw_m5x7k_ab12cd",
 *     "workflow_id": "blue_attack_workflow-quick-1",
 *     "parameters": { "uav_id_list": "uav-007,uav-005" }
 *   }
 */

import { useState, useEffect } from "react";
import { AlertTriangle, Shield, Target, Radar, X, Loader2, Play, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { getHttpChatConfig } from "@/lib/map-app-config";
import { toast } from "sonner";
import { useWorkflowStatusStore } from "@/stores/workflow-status-store";
import { WorkflowStatusWsClient } from "@/lib/workflow/workflow-status-ws-client";

/** 快捷工作流配置项 */
export interface QuickWorkflowItem {
  /** 工作流唯一 ID（作为 POST body 的 workflow_id） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 描述文字 */
  description: string;
  /** 后端工作流名称 */
  workflow_name: string;
  /** 默认参数（作为 POST body 的 parameters 基础） */
  default_parameters: Record<string, unknown>;
  /** 必选参数名列表 */
  required_parameters: string[];
  /** 可选参数名列表 */
  optional_parameters?: string[];
  /** 图标 key（映射到 ICON_MAP） */
  icon: string;
  /** 排序序号 */
  order: number;
  /** 是否启用 */
  enabled: boolean;
}

/** 8 个快捷工作流配置（对齐 app-config.json quickWorkflows 结构） */
const QUICK_WORKFLOWS: QuickWorkflowItem[] = [
  { id: "alert_workflow_quick_1", name: "告警处理", description: "处理告警事件，进行目标查证", workflow_name: "alert_workflow", default_parameters: { alert_area: "港外航道" }, required_parameters: [], icon: "alert", order: 1, enabled: true },
  { id: "area_track_vertification_workflow-quick-1", name: "区域航迹查证", description: "根据目标特征对区域内的航迹进行查证", workflow_name: "area_track_vertification_workflow", default_parameters: { alert_area: "港外航道监控区", target_feature: "一个浮标", camera_cnt: 2, uav_cnt: 1 }, required_parameters: ["alert_area", "target_feature", "camera_cnt", "uav_cnt"], icon: "duty", order: 2, enabled: true },
  { id: "area_search_workflow_quick_1", name: "无人机区域搜索", description: "使用无人机搜索区域", workflow_name: "area_search_workflow", default_parameters: { alert_area_list: "搜索区1,搜索区2" }, required_parameters: ["alert_area_list"], icon: "target", order: 3, enabled: true },
  { id: "radar_acquisition_quick_1", name: "对空雷达自动采集", description: "对空雷达采集空中目标数据自动化流程", workflow_name: "radar_acquisition_workflow", default_parameters: { area_name: "数据采集远stt3", flight_type: "multi_point", input_uav_id_list: "uav-005,uav-007,uav-011", input_radar_list: "" }, required_parameters: ["area_name", "flight_type", "input_uav_id_list"], optional_parameters: ["input_radar_list"], icon: "radar", order: 4, enabled: true },
  { id: "area_search_vertification_workflow-quick-1", name: "区域搜索查证", description: "根据目标特征对区域进行查证", workflow_name: "area_search_vertification_workflow", default_parameters: { alert_area: "搜索区5", target_feature: "一个浮标", camera_cnt: 2, uav_cnt: 2 }, required_parameters: ["alert_area", "target_feature", "camera_cnt", "uav_cnt"], optional_parameters: [], icon: "duty", order: 5, enabled: true },
  { id: "auto_duty_workflow-quick-1", name: "自主值班", description: "24小时自主值班查证", workflow_name: "auto_duty_workflow", default_parameters: { schema_id: "SCHEME_3B065AE6" }, required_parameters: ["schema_id"], icon: "duty", order: 6, enabled: true },
  { id: "multi_uav_confrontation_workflow-quick-1", name: "多机对抗", description: "使用相机、无人机联动拦截空中目标", workflow_name: "multi_uav_confrontation_workflow", default_parameters: { alert_area: "搜索区2" }, required_parameters: ["alert_area"], optional_parameters: [], icon: "alert", order: 7, enabled: true },
  { id: "blue_attack_workflow-quick-1", name: "蓝军进攻", description: "派遣蓝方按照指定进攻路线进行攻击", workflow_name: "blue_attack_workflow", default_parameters: { uav_id_list: "uav-007,uav-005" }, required_parameters: ["uav_id_list"], optional_parameters: [], icon: "alert", order: 8, enabled: true },
];

/** 图标映射：icon key → Lucide 组件 */
const ICON_MAP: Record<string, React.ElementType> = { alert: AlertTriangle, duty: Shield, target: Target, radar: Radar };
/** 图标背景色映射 */
const ICON_BG: Record<string, string> = { alert: "bg-red-500/10 text-red-400 border-red-500/20", duty: "bg-sky-500/10 text-sky-400 border-sky-500/20", target: "bg-amber-500/10 text-amber-400 border-amber-500/20", radar: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };

interface Props { open: boolean; onClose: () => void; }

/** 第一步：工作流选择卡片（图标 + 名称 + 描述，点击进入参数配置） */
function WorkflowSelectCard({ wf, onSelect }: {
  wf: QuickWorkflowItem;
  onSelect: (wf: QuickWorkflowItem) => void;
}) {
  const Ic = ICON_MAP[wf.icon] || AlertTriangle;
  return (
    <button
      type="button"
      onClick={() => onSelect(wf)}
      className="flex items-start gap-4 rounded-lg border border-white/[0.06] p-5 text-left transition-all hover:border-white/[0.12] hover:bg-white/[0.02]"
    >
      <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border", ICON_BG[wf.icon] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/20")}>
        <Ic size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold text-nexus-text-primary">{wf.name}</div>
        <div className="mt-1 text-sm leading-relaxed text-nexus-text-muted">{wf.description}</div>
      </div>
    </button>
  );
}

/** 第二步：参数配置面板（必选/可选参数输入 + 执行按钮） */
function WorkflowConfigPanel({ wf, onExecute, isExecuting, onBack }: {
  wf: QuickWorkflowItem;
  onExecute: (wf: QuickWorkflowItem, params: Record<string, unknown>) => void;
  isExecuting: boolean;
  onBack: () => void;
}) {
  const [params, setParams] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const key of wf.required_parameters) {
      const v = wf.default_parameters[key];
      init[key] = v != null ? String(v) : "";
    }
    if (wf.optional_parameters) {
      for (const key of wf.optional_parameters) {
        const v = wf.default_parameters[key];
        init[key] = v != null && v !== "" ? String(v) : "";
      }
    }
    return init;
  });

  const Ic = ICON_MAP[wf.icon] || AlertTriangle;
  const allParamKeys = [...wf.required_parameters, ...(wf.optional_parameters ?? [])];

  const handleExecute = () => {
    const parameters: Record<string, unknown> = {};
    for (const key of wf.required_parameters) {
      const val = params[key]?.trim() ?? "";
      const num = Number(val);
      parameters[key] = !isNaN(num) && val !== "" ? num : val;
    }
    if (wf.optional_parameters) {
      for (const key of wf.optional_parameters) {
        const val = params[key]?.trim() ?? "";
        if (val !== "") { const num = Number(val); parameters[key] = !isNaN(num) ? num : val; }
      }
    }
    onExecute(wf, parameters);
  };

  return (
    <div className="flex-1 flex flex-col p-5 overflow-y-auto">
      {/* 返回 + 标题 */}
      <div className="flex items-center gap-3 mb-5">
        <button type="button" onClick={onBack} disabled={isExecuting}
          className="flex h-10 w-10 items-center justify-center rounded-md text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-primary disabled:opacity-50">
          <ChevronLeft size={22} />
        </button>
        <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border", ICON_BG[wf.icon] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/20")}>
          <Ic size={22} />
        </div>
        <div>
          <div className="text-base font-semibold text-nexus-text-primary">{wf.name}</div>
          <div className="text-sm text-nexus-text-muted">{wf.description}</div>
        </div>
      </div>

      {/* 参数表单 */}
      {allParamKeys.length > 0 && (
        <div className="space-y-4 mb-5">
          {allParamKeys.map(key => {
            const isRequired = wf.required_parameters.includes(key);
            return (
              <div key={key} className="flex items-center gap-4">
                <label className="shrink-0 text-sm font-medium text-nexus-text-secondary w-40 text-right">
                  {key}{isRequired && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <input
                  type="text"
                  value={params[key] ?? ""}
                  onChange={e => setParams(prev => ({ ...prev, [key]: e.target.value }))}
                  disabled={isExecuting}
                  className="flex-1 rounded border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm text-nexus-text-primary placeholder:text-nexus-text-muted/50 focus:border-nexus-accent/40 focus:outline-none disabled:opacity-50"
                  placeholder={key}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* 执行按钮 — 右下角 */}
      <div className="mt-auto flex justify-end pt-4">
        <button onClick={handleExecute} disabled={isExecuting}
          className={cn("flex items-center justify-center gap-2 rounded-md px-6 py-2.5 text-sm font-medium transition-colors bg-nexus-accent/20 text-nexus-accent border border-nexus-accent/30 hover:bg-nexus-accent/30 hover:border-nexus-accent/50", isExecuting && "cursor-wait opacity-50")}>
          {isExecuting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {isExecuting ? "执行中…" : "执行"}
        </button>
      </div>
    </div>
  );
}

export function QuickWorkflowModal({ open, onClose }: Props) {
  const [selectedWf, setSelectedWf] = useState<QuickWorkflowItem | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);

  // 每次打开弹窗时强制回到卡片选择区域
  useEffect(() => { if (open) setSelectedWf(null); }, [open]);

  if (!open) return null;

  const handleExecute = async (wf: QuickWorkflowItem, parameters: Record<string, unknown>) => {
    const url = getHttpChatConfig().quickWorkflowUrl;
    if (!url) { toast.error("未配置快捷工作流 URL"); onClose(); return; }
    setExecutingId(wf.id);
    const threadId = `qw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const body = { thread_id: threadId, workflow_id: wf.id, parameters };
    console.log("[QuickWorkflow] POST:", url, body);
    try {
      const ctrl = new AbortController();
      const timeoutMs = getHttpChatConfig().quickWorkflowTimeoutMs ?? 15000;
      const tid = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) { toast.error(`工作流「${wf.name}」启动失败: HTTP ${res.status}`); }
      else {
        toast.success(`工作流「${wf.name}」已启动`);
        // 启动独立 WS 接收状态推送
        const wsClient = new WorkflowStatusWsClient();
        wsClient.start();
        // 写入状态 store → Overlay 自动出现，wsClient 存入 store 供关闭时断开
        useWorkflowStatusStore.getState().addWorkflow({
          threadId, workflowId: wf.id, name: wf.name, startedAt: Date.now(),
        }, wsClient);
      }
    } catch (e) {
      toast.error(`工作流「${wf.name}」异常: ${e instanceof Error ? e.message : "网络错误"}`);
    } finally {
      setExecutingId(null);
      onClose();
    }
  };

  const handleBack = () => setSelectedWf(null);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-[830px] h-[600px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#1a1a2e]/95 shadow-2xl flex flex-col">
        {/* 第一步：选择工作流 */}
        {!selectedWf && (
          <>
            <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
              <div><h2 className="text-xl font-semibold text-nexus-text-primary">快捷工作流</h2><p className="mt-1 text-sm text-nexus-text-muted">选择工作流快速执行任务方案</p></div>
              <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md text-nexus-text-muted hover:bg-white/10"><X size={20} /></button>
            </div>
            <div className="flex-1 flex items-center justify-center overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-4 w-full max-w-[720px]">
                {QUICK_WORKFLOWS.filter(w => w.enabled).map(wf => (
                  <WorkflowSelectCard key={wf.id} wf={wf} onSelect={setSelectedWf} />
                ))}
              </div>
            </div>
          </>
        )}
        {/* 第二步：参数配置 */}
        {selectedWf && (
          <>
            <div className="flex items-center justify-end border-b border-white/[0.06] px-6 py-4">
              <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md text-nexus-text-muted hover:bg-white/10"><X size={20} /></button>
            </div>
            <WorkflowConfigPanel
              wf={selectedWf}
              onExecute={handleExecute}
              isExecuting={executingId === selectedWf.id}
              onBack={handleBack}
            />
          </>
        )}
      </div>
    </div>
  );
}
