import http from "http";
import type { IncomingHttpHeaders } from "http";
import { processTaskStatusIngest } from "@/lib/task-status-ingest-handler";

/** 默认 7774，与 Qt `m_nTaskHostPort` 场景对齐；仅在同进程内需改端口时设置 TASK_STATUS_HTTP_PORT */
const DEFAULT_PORT = 7774;

function corsHeaders(): http.OutgoingHttpHeaders {
  const origin = process.env.TASK_STATUS_CORS_ORIGIN?.trim();
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "PUT, POST, OPTIONS",
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
};

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
      console.error(`[task-status] 端口 ${listenPort} 已被占用，未启动查证 HTTP 监听`);
    } else {
      console.error("[task-status] HTTP 服务器错误:", err.message);
    }
  });

  server.listen(listenPort, "0.0.0.0", () => {
    console.info(`[task-status] 查证回调 HTTP 已监听 0.0.0.0:${listenPort}（路径 /api/alarms/:id/task-status）`);
  });

  globalListener.__taskStatusHttpServer = server;
}
