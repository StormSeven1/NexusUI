/** 停止系统评估侧全部可取消任务（链路采集 + 航迹质量评估） */

export type StopAllEvalTasksResult = {
  ok: boolean;
  message: string;
  trackLinkCancelled?: boolean;
  trackQualityCancelledCount?: number;
};

type StopAllEvalTasksApiJson = {
  code?: number;
  message?: string;
  data?: {
    track_link?: { cancelled?: boolean; message?: string };
    track_quality?: { cancelled_count?: number; message?: string };
  };
};

export async function stopAllEvalTasks(): Promise<StopAllEvalTasksResult> {
  try {
    const res = await fetch("/api/system-eval/tasks/stop-all", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
      cache: "no-store",
    });
    const raw = await res.text();
    let json: StopAllEvalTasksApiJson | null = null;
    try {
      json = raw.trim() ? (JSON.parse(raw) as StopAllEvalTasksApiJson) : null;
    } catch {
      return { ok: false, message: raw.slice(0, 200) || `HTTP ${res.status}` };
    }
    const link = json?.data?.track_link;
    const quality = json?.data?.track_quality;
    return {
      ok: res.ok && (json?.code === 200 || json?.code == null),
      message: json?.message || (res.ok ? "已请求停止" : `HTTP ${res.status}`),
      trackLinkCancelled: Boolean(link?.cancelled),
      trackQualityCancelledCount: Number(quality?.cancelled_count ?? 0),
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
