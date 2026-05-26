"use client";

import { useEffect, useRef } from "react";
import {
  TRACK_EVAL_AUTO_QUERY_INTERVAL_MS,
  useTrackEvaluationStore,
} from "@/stores/track-evaluation-store";

/** 页面启动后连接航迹评估 WS，并每 3 分钟自动发送一次查询以刷新质量指标 */
export function useTrackEvalAutoQuery() {
  const connectWs = useTrackEvaluationStore((s) => s.connectWs);
  const connectionState = useTrackEvaluationStore((s) => s.connectionState);
  const runScheduledQuery = useTrackEvaluationStore((s) => s.runScheduledQuery);
  const initialQuerySent = useRef(false);

  useEffect(() => {
    connectWs();
  }, [connectWs]);

  useEffect(() => {
    if (connectionState !== "open") return;

    if (!initialQuerySent.current) {
      initialQuerySent.current = true;
      runScheduledQuery();
    }

    const timerId = window.setInterval(() => {
      runScheduledQuery();
    }, TRACK_EVAL_AUTO_QUERY_INTERVAL_MS);

    return () => window.clearInterval(timerId);
  }, [connectionState, runScheduledQuery]);
}
