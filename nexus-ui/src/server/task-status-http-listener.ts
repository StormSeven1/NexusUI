import http from "http";
import type { IncomingHttpHeaders } from "http";
import { processTaskStatusIngest } from "@/lib/task-status-ingest-handler";
import { getTaskStatusBridge } from "@/lib/task-status-bridge";
import type { TaskStatusChatPayload } from "@/lib/task-status-types";

/**
 * 默认端口 7774，与 Qt `m_nTaskHostPort` 对齐。
 * 开发模式通过 .env.development.local 中 TASK_STATUS_HTTP_PORT=7775 覆盖，
 * 使生产（7774）和开发（7775）容器可同时运行互不冲突。
 */
const DEFAULT_PORT = 7774;

/** 与 Custombackend work_mode_dds.MODE_ALIASES 一致 */
const WORK_MODE_ENUM: Record<string, number> = {
  emergency: 0,
  debug: 1,
  normal: 2,
  wartime: 3,
};

const SYSTEM_STATUS_PATH = /^\/api\/system\/status\/?$/;

function backendBaseUrl(): string {
  const u =
    process.env.BACKEND_URL?.trim() ||
    process.env.NEXT_PUBLIC_BACKEND_URL?.trim() ||
    "http://127.0.0.1:27003";
  return u.replace(/\/$/, "");
}

function corsHeaders(): http.OutgoingHttpHeaders {
  const origin = process.env.TASK_STATUS_CORS_ORIGIN?.trim();
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Task-Status-Secret",
  };
}

function verifySecret(headers: IncomingHttpHeaders): boolean {
  const secret = process.env.TASK_STATUS_INGEST_SECRET?.trim();
  if (!secret) return true;
  const h = (typeof headers["x-task-status-secret"] === "string" ? headers["x-task-status-secret"] : "")
    .trim();
  const auth = (typeof headers.authorization === "string" ? headers.authorization : "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return h === secret || bearer === secret;
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      chunks.push(c);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, extraHeaders?: http.OutgoingHttpHeaders) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json, "utf8"),
    Connection: "close",
    ...corsHeaders(),
    ...extraHeaders,
  });
  res.end(json);
}

const globalListener = globalThis as typeof globalThis & {
  __taskStatusHttpServer?: http.Server;
  __taskStatusSseRelayActive?: boolean;
};

/**
 * 当 7774 被另一个 Next 进程（如 prod 容器）占用时，本进程作为 SSE 订阅者从同机
 * 已有服务转发查证事件到本地 bridge，从而让本进程的 /api/task-status-stream 也能推送。
 * 目标端口默认 22411（prod next-start），可通过 TASK_STATUS_RELAY_PORT 覆盖。
 */
function startSseRelayFallback(): void {
  if (globalListener.__taskStatusSseRelayActive) return;

  const relayPort =
    Number(process.env.TASK_STATUS_RELAY_PORT?.trim() || "") || 22411;

  /** 当前进程自己的 HTTP 端口 */
  const selfPort =
    Number(process.env.PORT?.trim() || "") ||
    Number(process.env.FRONTEND_PORT?.trim() || "") ||
    3000;

  if (relayPort === selfPort) {
    console.warn(
      `[task-status-relay] 中继目标端口 ${relayPort} 与本进程相同，跳过中继（防止自环）`,
    );
    return;
  }

  globalListener.__taskStatusSseRelayActive = true;
  const relayUrl = `http://127.0.0.1:${relayPort}/api/task-status-stream`;

  let retryMs = 3000;

  const connect = () => {
    if (!globalListener.__taskStatusSseRelayActive) return;
    const req = http.get(relayUrl, (res) => {
      if (res.statusCode !== 200) {
        res.destroy();
        retryMs = Math.min(30_000, retryMs * 2);
        setTimeout(connect, retryMs);
        return;
      }
      retryMs = 3000;
      console.info(`[task-status-relay] 已连接 ${relayUrl}，转发查证事件`);
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const msg = JSON.parse(raw) as { type: string; payload?: TaskStatusChatPayload };
            if (msg.type === "task_status" && msg.payload) {
              getTaskStatusBridge().emitPayload(msg.payload);
            }
          } catch { /* ignore malformed */ }
        }
      });
      res.on("close", () => {
        if (!globalListener.__taskStatusSseRelayActive) return;
        console.warn(`[task-status-relay] 连接断开，${retryMs}ms 后重连 ${relayUrl}`);
        setTimeout(connect, retryMs);
      });
      res.on("error", () => {
        if (!globalListener.__taskStatusSseRelayActive) return;
        setTimeout(connect, retryMs);
      });
    });
    req.on("error", () => {
      if (!globalListener.__taskStatusSseRelayActive) return;
      retryMs = Math.min(30_000, retryMs * 1.5);
      setTimeout(connect, retryMs);
    });
    req.setTimeout(0);
  };

  console.info(`[task-status-relay] 端口 7774 已被其它进程占用，启动 SSE 中继 ← ${relayUrl}`);
  connect();
}

/**
 * 在独立 TCP 端口（默认 7774）上接收相机管理回调，与 Qt `QTcpServer` 行为一致。
 * 与 Next 主端口无关；路径仍为 `/api/alarms/:alarmId/task-status`。
 */
export function startTaskStatusHttpListener(): void {
  if (globalListener.__taskStatusHttpServer?.listening) return;

  const rawPort = process.env.TASK_STATUS_HTTP_PORT?.trim();
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.warn(`[task-status] TASK_STATUS_HTTP_PORT 无效，改用 ${DEFAULT_PORT}`);
  }
  const listenPort = Number.isFinite(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;

  const server = http.createServer(async (req, res) => {
    const method = (req.method ?? "GET").toUpperCase();

    if (method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      sendJson(res, 400, { code: 400, message: "Bad Request", data: null });
      return;
    }

    if (SYSTEM_STATUS_PATH.test(pathname)) {
      if (method === "GET") {
        try {
          const r = await fetch(`${backendBaseUrl()}/api/system/work-mode`, {
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
          });
          const raw = (await r.json().catch(() => ({}))) as Record<string, unknown>;
          if (!r.ok) {
            sendJson(res, r.status >= 500 ? 502 : r.status, {
              code: r.status,
              message: typeof raw.detail === "string" ? raw.detail : "无法从业务后端获取系统状态",
              data: null,
            });
            return;
          }
          const last = raw.last_mode;
          const modeStr = typeof last === "string" ? last : null;
          const en = modeStr && WORK_MODE_ENUM[modeStr] !== undefined ? WORK_MODE_ENUM[modeStr] : null;
          sendJson(res, 200, {
            code: 200,
            message: "ok",
            data: {
              work_mode: modeStr,
              work_mode_enum: en,
              dds_work_mode_enabled: raw.enabled === true,
            },
            server_time: new Date().toISOString(),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          sendJson(res, 503, {
            code: 503,
            message: `无法连接业务后端（${backendBaseUrl()}）: ${msg}`,
            data: null,
          });
        }
        return;
      }
      if (method === "PUT" || method === "POST") {
        if (!verifySecret(req.headers)) {
          sendJson(res, 401, { code: 401, message: "unauthorized", data: null });
          return;
        }
        let bodyBuf: Buffer;
        try {
          bodyBuf = await readBody(req);
        } catch {
          sendJson(res, 400, { code: 400, message: "读取请求体失败", data: null });
          return;
        }
        let parsed: Record<string, unknown> = {};
        if (bodyBuf.length > 0) {
          try {
            parsed = JSON.parse(bodyBuf.toString("utf8")) as Record<string, unknown>;
          } catch {
            sendJson(res, 400, { code: 400, message: "JSON格式不正确", data: null });
            return;
          }
        }
        const modeRaw = parsed.work_mode ?? parsed.mode;
        const mode =
          typeof modeRaw === "string"
            ? modeRaw.trim().toLowerCase()
            : "";
        if (!mode || WORK_MODE_ENUM[mode] === undefined) {
          sendJson(res, 400, {
            code: 400,
            message: "请求体需包含 work_mode 或 mode，值为 emergency|debug|normal|wartime",
            data: null,
          });
          return;
        }
        try {
          const r = await fetch(`${backendBaseUrl()}/api/system/work-mode`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode }),
            signal: AbortSignal.timeout(30_000),
          });
          const raw = (await r.json().catch(() => ({}))) as Record<string, unknown>;
          if (!r.ok) {
            const detail =
              typeof raw.detail === "string"
                ? raw.detail
                : typeof raw.message === "string"
                  ? raw.message
                  : `HTTP ${r.status}`;
            sendJson(res, r.status >= 500 ? 502 : r.status, {
              code: r.status,
              message: detail,
              data: null,
            });
            return;
          }
          const m = typeof raw.mode === "string" ? raw.mode : mode;
          sendJson(res, 200, {
            code: 200,
            message: "ok",
            data: {
              work_mode: m,
              work_mode_enum: WORK_MODE_ENUM[m] ?? null,
            },
            server_time: new Date().toISOString(),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          sendJson(res, 503, {
            code: 503,
            message: `无法连接业务后端（${backendBaseUrl()}）: ${msg}`,
            data: null,
          });
        }
        return;
      }
      sendJson(res, 405, { code: 405, message: "Method Not Allowed", data: null });
      return;
    }

    const m = pathname.match(/^\/api\/alarms\/([^/]+)\/task-status\/?$/);
    if (!m) {
      sendJson(res, 404, { code: 404, message: "请求的资源不存在", data: null });
      return;
    }

    if (method !== "PUT" && method !== "POST") {
      sendJson(res, 405, { code: 405, message: "Method Not Allowed", data: null });
      return;
    }

    if (!verifySecret(req.headers)) {
      sendJson(res, 401, { code: 401, message: "unauthorized", data: null });
      return;
    }

    const alarmId = decodeURIComponent(m[1]);

    let bodyBuf: Buffer;
    try {
      bodyBuf = await readBody(req);
    } catch {
      sendJson(res, 400, { code: 400, message: "读取请求体失败", data: null });
      return;
    }

    let parsed: unknown = {};
    if (bodyBuf.length > 0) {
      try {
        parsed = JSON.parse(bodyBuf.toString("utf8"));
      } catch {
        sendJson(res, 400, { code: 400, message: "JSON格式不正确", data: null });
        return;
      }
    }

    const result = await processTaskStatusIngest(alarmId, parsed);
    if (!result.ok) {
      sendJson(res, result.status, result.body);
      return;
    }
    sendJson(res, 200, result.body);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[task-status] 端口 ${listenPort} 已被占用，切换到 SSE 中继模式`);
      startSseRelayFallback();
    } else {
      console.error("[task-status] HTTP 服务器错误:", err.message);
    }
  });

  server.listen(listenPort, "0.0.0.0", () => {
    console.info(
      `[task-status] 查证回调 HTTP 已监听 0.0.0.0:${listenPort}（/api/alarms/:id/task-status；系统状态 GET/PUT /api/system/status → ${backendBaseUrl()}）`,
    );
  });

  globalListener.__taskStatusHttpServer = server;
}
