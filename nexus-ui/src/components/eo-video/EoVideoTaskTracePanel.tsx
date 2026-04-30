"use client";

import { cn } from "@/lib/utils";

export interface EoVideoTaskTrace {
  request: unknown;
  httpStatus: number | null;
  responseText: string;
  fetchError?: string;
  at: number;
}

function formatBody(raw: string): string {
  const t = raw.trim();
  if (!t) return "(空)";
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return raw.length > 8000 ? `${raw.slice(0, 8000)}\n…(已截断)` : raw;
  }
}

export function EoVideoTaskTracePanel({
  trace,
  clientEcho,
  uavMqttStatus,
  detectionWsLine,
  detectionWsTitle,
  className,
}: {
  trace: EoVideoTaskTrace | null;
  /** 双击与本地校验的实时日志（不依赖是否已发 HTTP） */
  clientEcho?: string;
  /** 当前无人机 MQTT 连接与最近一帧（无报文/无舱字段时写「无」） */
  uavMqttStatus?: string;
  /** 检测 WebSocket 状态一行（如 OPEN / 缓冲数），悬停可看详情 */
  detectionWsLine?: string;
  detectionWsTitle?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "shrink-0 border-t border-white/[0.08] bg-black/75 px-2 py-1.5 text-[10px] leading-snug text-nexus-text-secondary",
        className,
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-nexus-text-primary">目标跟踪 · 调试</span>
        {trace ? (
          <span className="font-mono text-[9px] text-nexus-text-muted">
            {trace.httpStatus != null ? `HTTP ${trace.httpStatus}` : "无 HTTP 状态"}
            {trace.at ? ` · ${new Date(trace.at).toLocaleTimeString()}` : ""}
          </span>
        ) : (
          <span className="text-[9px] text-nexus-text-muted">等待发送</span>
        )}
      </div>
      {detectionWsLine?.trim() ? (
        <pre
          className="mb-1 max-h-16 overflow-auto whitespace-pre-wrap break-all rounded border border-emerald-500/20 bg-black/40 p-1.5 font-mono text-[9px] leading-tight text-emerald-200/90"
          title={detectionWsTitle ?? detectionWsLine}
        >
          {detectionWsLine.trim()}
        </pre>
      ) : null}
      {uavMqttStatus?.trim() ? (
        <pre className="mb-1 max-h-20 overflow-auto whitespace-pre-wrap break-all rounded border border-white/[0.06] bg-black/50 p-1.5 font-mono text-[9px] text-cyan-200/90">
          {uavMqttStatus.trim()}
        </pre>
      ) : null}
      {clientEcho?.trim() ? (
        <pre className="mb-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded border border-white/[0.06] bg-black/50 p-1.5 font-mono text-[9px] text-amber-200/90">
          {clientEcho.trim()}
        </pre>
      ) : null}
      {!trace ? (
        <p className="py-1 text-[9px] text-nexus-text-muted">
          在画面上双击后，上方黄字为本地步骤；发起 HTTP 后下方展示请求体与返回原文。
        </p>
      ) : (
        <>
          {trace.fetchError ? (
            <p className="mb-1 break-all text-red-400/90">网络/代理错误：{trace.fetchError}</p>
          ) : null}
          <div className="grid max-h-[min(28vh,220px)] min-h-[72px] grid-cols-1 gap-1.5 sm:grid-cols-2">
            <div className="flex min-h-0 flex-col rounded border border-white/[0.06] bg-black/40">
              <div className="shrink-0 border-b border-white/[0.06] px-1.5 py-0.5 text-[9px] text-nexus-text-muted">
                发送数据（POST /api/camera-task/single-track）
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-1.5 font-mono text-[9px] text-nexus-text-secondary">
                {JSON.stringify(trace.request, null, 2)}
              </pre>
            </div>
            <div className="flex min-h-0 flex-col rounded border border-white/[0.06] bg-black/40">
              <div className="shrink-0 border-b border-white/[0.06] px-1.5 py-0.5 text-[9px] text-nexus-text-muted">返回内容</div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-1.5 font-mono text-[9px] text-nexus-text-secondary">
                {formatBody(trace.responseText)}
              </pre>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
