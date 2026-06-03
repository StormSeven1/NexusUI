"use client";

import { useEffect } from "react";
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
    connectWs();
  }, [connectWs]);

  useEffect(() => {
    if (connectionState !== "open" || !autoAnalysisEnabled) return;

    runScheduledQuery();
    const timerId = window.setInterval(() => {
      runScheduledQuery();
    }, TRACK_EVAL_AUTO_QUERY_INTERVAL_MS);

    return () => window.clearInterval(timerId);
  }, [connectionState, autoAnalysisEnabled, runScheduledQuery]);
}