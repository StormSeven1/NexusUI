"use client";

import { useEffect } from "react";
import { isTrackEvalGrpcEnabled } from "@/lib/system-eval-track-api";
import {
  TRACK_EVAL_AUTO_QUERY_INTERVAL_MS,
  useTrackEvaluationStore,
} from "@/stores/track-evaluation-store";

/** 页面启动后连接航迹评估 WS；勾选「开启自动分析」时每 3 分钟自动查询 */
export function useTrackEvalAutoQuery() {
  const connectWs = useTrackEvaluationStore((s) => s.connectWs);
  const connectionState = useTrackEvaluationStore((s) => s.connectionState);
  const autoAnalysisEnabled = useTrackEvaluationStore((s) => s.autoAnalysisEnabled);
  const runScheduledQuery = useTrackEvaluationStore((s) => s.runScheduledQuery);

  useEffect(() => {
    // gRPC 模式不依赖 C++ :12600；避免 HTTPS 页反复报 wss-track-eval 502 干扰主 WS 排查
    if (isTrackEvalGrpcEnabled()) return;
    connectWs();
  }, [connectWs]);

  useEffect(() => {
    if (!autoAnalysisEnabled) return;
    const grpcReady = isTrackEvalGrpcEnabled();
    if (!grpcReady && connectionState !== "open") return;

    runScheduledQuery();
    const timerId = window.setInterval(() => {
      runScheduledQuery();
    }, TRACK_EVAL_AUTO_QUERY_INTERVAL_MS);

    return () => window.clearInterval(timerId);
  }, [connectionState, autoAnalysisEnabled, runScheduledQuery]);
}