export type CameraTaskResultBody = {
  ok?: boolean;
  taskId?: string;
  task_id?: string;
  executionState?: string;
  permissionState?: string;
  error?: { message?: string };
  message?: string;
};

export function parseCameraTaskResultBody(raw: string): CameraTaskResultBody {
  let parsed: CameraTaskResultBody = {};
  try {
    parsed = JSON.parse(raw) as CameraTaskResultBody;
  } catch {
    return { message: raw };
  }

  if (typeof parsed.message === "string") {
    const msg = parsed.message.trim();
    if (msg.startsWith("{")) {
      try {
        const nested = JSON.parse(msg) as CameraTaskResultBody;
        const merged = { ...parsed, ...nested };
        delete merged.message;
        return merged;
      } catch {
        /* keep parsed */
      }
    }
  }
  return parsed;
}

export function isCameraTaskExecuted(body: CameraTaskResultBody): boolean {
  if (body.executionState === "FAILED") return false;
  if (body.permissionState === "EXECUTING_PRIORITY") return false;
  return body.executionState === "COMPLETED" || body.executionState === "EXECUTING";
}

export function formatCameraTaskResultDetail(body: CameraTaskResultBody): string {
  const errMsg = body.error?.message?.trim();
  if (errMsg) return errMsg;
  if (!isCameraTaskExecuted(body) && body.executionState && body.permissionState) {
    return `${body.executionState}/${body.permissionState}`;
  }
  return body.message?.trim() ?? "";
}

export function normalizeCameraTaskResponseBody(raw: string): string {
  const body = parseCameraTaskResultBody(raw);
  const executed = isCameraTaskExecuted(body);
  const detail = formatCameraTaskResultDetail(body);
  return JSON.stringify({
    ok: executed,
    taskId: body.taskId ?? body.task_id ?? "",
    executionState: body.executionState ?? (executed ? "COMPLETED" : "FAILED"),
    permissionState: body.permissionState ?? "",
    error: { message: executed ? "" : detail },
  });
}

export async function readEoPtzTaskResponse(res: Response): Promise<{
  httpOk: boolean;
  executed: boolean;
  detail: string;
}> {
  const text = await res.text();
  const body = parseCameraTaskResultBody(text);
  const executed = res.ok && isCameraTaskExecuted(body);
  return {
    httpOk: res.ok,
    executed,
    detail: formatCameraTaskResultDetail(body),
  };
}
