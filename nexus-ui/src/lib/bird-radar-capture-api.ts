import { getHttpConfig } from "@/lib/map-app-config";

export type BirdRadarCaptureCheckResult =
  | { ok: true; qualifyingCount: number; pihaos: number[]; message: string }
  | { ok: false; message: string; qualifyingCount?: number };

export type BirdRadarCaptureStartResult =
  | { ok: true; sessionId: string; filename: string; pihaos: number[] }
  | { ok: false; message: string };

export type BirdRadarCaptureStopResult =
  | {
      ok: true;
      sessionId: string;
      filename: string;
      rowCount: number;
      path: string;
      stopReason?: string;
    }
  | { ok: false; message: string };

export type BirdRadarCaptureStatus = {
  recording: boolean;
  active?: {
    sessionId: string;
    rowCount: number;
    filename: string;
    autoStopInSec: number;
    pihaos: number[];
  } | null;
  autoStopped?: BirdRadarCaptureStopResult | null;
};

function backendBase(): string {
  return getHttpConfig().backendUrl.replace(/\/$/, "");
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function checkBirdRadarCaptureBackend(): Promise<BirdRadarCaptureCheckResult> {
  const res = await fetch(`${backendBase()}/api/bird-radar-capture/check`);
  const data = await parseJson(res);
  if (data.ok === true) {
    return {
      ok: true,
      qualifyingCount: Number(data.qualifying_count ?? 0),
      pihaos: Array.isArray(data.pihaos) ? data.pihaos.map((x) => Number(x)) : [],
      message: String(data.message ?? "可以开始采集"),
    };
  }
  return {
    ok: false,
    message: String(data.message ?? "后端未满足采集条件"),
    qualifyingCount: Number(data.qualifying_count ?? 0),
  };
}

export async function startBirdRadarCapture(reason = "ui"): Promise<BirdRadarCaptureStartResult> {
  const res = await fetch(`${backendBase()}/api/bird-radar-capture/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  const data = await parseJson(res);
  if (data.ok === true) {
    return {
      ok: true,
      sessionId: String(data.session_id ?? ""),
      filename: String(data.filename ?? ""),
      pihaos: Array.isArray(data.pihaos) ? data.pihaos.map((x) => Number(x)) : [],
    };
  }
  return { ok: false, message: String(data.message ?? "启动采集失败") };
}

export async function stopBirdRadarCapture(reason = "ui"): Promise<BirdRadarCaptureStopResult> {
  const res = await fetch(`${backendBase()}/api/bird-radar-capture/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  const data = await parseJson(res);
  if (data.ok === true) {
    return {
      ok: true,
      sessionId: String(data.session_id ?? ""),
      filename: String(data.filename ?? ""),
      rowCount: Number(data.row_count ?? 0),
      path: String(data.path ?? ""),
      stopReason: typeof data.stop_reason === "string" ? data.stop_reason : undefined,
    };
  }
  return { ok: false, message: String(data.message ?? "停止采集失败") };
}

export async function fetchBirdRadarCaptureStatus(): Promise<BirdRadarCaptureStatus> {
  const res = await fetch(`${backendBase()}/api/bird-radar-capture/status`);
  const data = await parseJson(res);
  const activeRaw = data.active as Record<string, unknown> | null | undefined;
  const autoRaw = data.auto_stopped as Record<string, unknown> | null | undefined;
  return {
    recording: Boolean(data.recording),
    active: activeRaw
      ? {
          sessionId: String(activeRaw.session_id ?? ""),
          rowCount: Number(activeRaw.row_count ?? 0),
          filename: String(activeRaw.filename ?? ""),
          autoStopInSec: Number(activeRaw.auto_stop_in_sec ?? 0),
          pihaos: Array.isArray(activeRaw.pihaos) ? activeRaw.pihaos.map((x) => Number(x)) : [],
        }
      : null,
    autoStopped:
      autoRaw && autoRaw.ok === true
        ? {
            ok: true,
            sessionId: String(autoRaw.session_id ?? ""),
            filename: String(autoRaw.filename ?? ""),
            rowCount: Number(autoRaw.row_count ?? 0),
            path: String(autoRaw.path ?? ""),
            stopReason: typeof autoRaw.stop_reason === "string" ? autoRaw.stop_reason : undefined,
          }
        : null,
  };
}

export async function downloadBirdRadarCaptureCsv(filename: string): Promise<Blob> {
  const res = await fetch(
    `${backendBase()}/api/bird-radar-capture/file?${new URLSearchParams({ name: filename })}`,
  );
  if (!res.ok) {
    throw new Error(`下载 CSV 失败 HTTP ${res.status}`);
  }
  return res.blob();
}
