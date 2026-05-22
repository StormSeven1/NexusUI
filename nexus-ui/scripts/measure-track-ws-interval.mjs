/**
 * 测量 Custombackend → WebSocket 航迹刷新间隔（= 浏览器收到的 WS 速率，含后端 500ms 批合并）。
 *
 * 用法（在 nexus-ui 目录）:
 *   node scripts/measure-track-ws-interval.mjs [wsUrl] [showId] [durationSec]
 *
 * 示例:
 *   node scripts/measure-track-ws-interval.mjs ws://192.168.18.141:27004/ws
 *   node scripts/measure-track-ws-interval.mjs ws://127.0.0.1:27004/ws "your-unique-id" 60
 *
 * 未指定 showId：前 12s 内按出现次数选「最常被推送」的 uniqueId，再统计到总时长结束。
 */
import WebSocket from "ws";

function showIdFromPayload(inner) {
  if (!inner || typeof inner !== "object") return null;
  const u = inner.uniqueID ?? inner.uniqueId ?? inner.unique_id;
  if (u != null && String(u).trim() !== "") return String(u).trim();
  const id = inner.id;
  if (id != null && String(id).trim() !== "") return String(id).trim();
  return null;
}

function extractTrackInners(msg) {
  const type = String(msg.type ?? "").toLowerCase();
  const out = [];
  if (type === "trackbatch") {
    const arr = msg.data;
    if (!Array.isArray(arr)) return out;
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const inner = item.data !== undefined ? item.data : item;
      if (inner && typeof inner === "object") out.push(inner);
    }
    return out;
  }
  if (type === "track") {
    const inner = msg.data !== undefined ? msg.data : msg;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) out.push(inner);
    return out;
  }
  if (type === "track_update" || type === "track_snapshot") {
    const tracks = msg.tracks;
    if (Array.isArray(tracks)) {
      for (const t of tracks) {
        if (t && typeof t === "object") out.push(t);
      }
    }
    return out;
  }
  return out;
}

function stats(msList) {
  if (msList.length === 0) return null;
  const sorted = [...msList].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p90: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))],
  };
}

const args = process.argv.slice(2);
let wsUrl = process.env.TRACK_WS_URL || "ws://127.0.0.1:27004/ws";
if (args[0] && String(args[0]).startsWith("ws")) wsUrl = args.shift();
let fixedShowId = null;
let runDurationSec = 35;
if (args[0] && !/^\d+$/.test(String(args[0]))) fixedShowId = String(args.shift()).trim();
if (args[0] && /^\d+$/.test(String(args[0]))) runDurationSec = Math.max(5, Number(args.shift()));

const phasePickMs = 12000;

const counts = new Map();
const lastAt = new Map();
const intervals = new Map();
const batchTickIntervals = [];

let chosen = fixedShowId;
let lastBatchTs = null;

function noteSeen(sid, t) {
  const prev = lastAt.get(sid);
  lastAt.set(sid, t);
  counts.set(sid, (counts.get(sid) || 0) + 1);
  if (prev != null) {
    const delta = t - prev;
    if (!intervals.has(sid)) intervals.set(sid, []);
    intervals.get(sid).push(delta);
  }
}

console.log(`[measure-track-ws] 连接 ${wsUrl}`);
console.log(`[measure-track-ws] 总时长 ${runDurationSec}s；未指定 showId 时前 ${phasePickMs / 1000}s 自动选最频繁 uniqueId`);

const ws = new WebSocket(wsUrl);
const t0 = Date.now();

ws.on("open", () => {
  console.log("[measure-track-ws] 已连接，等待航迹消息…");
});

ws.on("message", (buf) => {
  let msg;
  try {
    msg = JSON.parse(buf.toString("utf8"));
  } catch {
    return;
  }
  const now = Date.now();
  const type = String(msg.type ?? "").toLowerCase();

  if (type === "trackbatch") {
    if (lastBatchTs != null) batchTickIntervals.push(now - lastBatchTs);
    lastBatchTs = now;
  }

  const inners = extractTrackInners(msg);
  for (const inner of inners) {
    const sid = showIdFromPayload(inner);
    if (!sid) continue;
    noteSeen(sid, now);
  }

  if (!fixedShowId && !chosen && now - t0 >= phasePickMs) {
    let best = null;
    let bestC = 0;
    for (const [k, c] of counts) {
      if (c > bestC) {
        bestC = c;
        best = k;
      }
    }
    chosen = best;
    console.log(`[measure-track-ws] 自动选择 showID（${phasePickMs}ms 内出现 ${bestC} 次）: ${chosen ?? "(无)"}`);
  }
});

ws.on("error", (e) => {
  console.error("[measure-track-ws] WebSocket 错误:", e.message || e);
});

setTimeout(() => {
  try {
    ws.close();
  } catch {
    /* noop */
  }

  const sid = fixedShowId || chosen;
  console.log("\n========== 结果 ==========");
  if (!sid) {
    console.log("未收到可用航迹或未选出 showID（检查 wsUrl / 后端是否在推 trackBatch）。");
    process.exit(1);
    return;
  }

  const list = intervals.get(sid) || [];
  const st = stats(list);
  console.log(`目标 showID: ${sid}`);
  if (st) {
    console.log(
      `该目标相邻两次出现在 WS 报文中的间隔（ms）: n=${st.n} min=${st.min.toFixed(0)} p50=${st.p50.toFixed(0)} mean=${st.mean.toFixed(0)} p90=${st.p90.toFixed(0)} max=${st.max.toFixed(0)}`,
    );
    console.log(`换算周期: p50 ${(st.p50 / 1000).toFixed(2)}s, mean ${(st.mean / 1000).toFixed(2)}s`);
    console.log(
      "\n解读: 若 p50 接近 500ms 多为后端 WebSocketManager.broadcast_interval；若常为 10～20s+ 多为融合/转发分批或单条 DDS 间隔。",
    );
  } else {
    console.log("该目标仅出现 0～1 次，无法算间隔。");
  }

  const bst = stats(batchTickIntervals);
  if (bst && bst.n > 0) {
    console.log(
      `\ntrackBatch 消息到达间隔（ms）: n=${bst.n} min=${bst.min.toFixed(0)} p50=${bst.p50.toFixed(0)} mean=${bst.mean.toFixed(0)} max=${bst.max.toFixed(0)}`,
    );
  }

  process.exit(st && st.n > 0 ? 0 : 2);
}, runDurationSec * 1000);
