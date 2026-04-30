import { NextResponse } from "next/server";

/**
 * 返回检测框 WebSocket 候选地址（与 z_others public/config.json 一致：HTTP 8088 同机 WS 2088）。
 *
 * - `EO_DETECTION_WS_URL`：完整 ws/wss URL，优先使用
 * - 否则由 `CAMERA_ENTITY_BASE_URL`（默认同 entity 路由）推导 `ws(s)://{host}:2088`
 */
const DEFAULT_ENTITY_BASE = "http://192.168.18.141:8088";

function deriveWsFromEntityHttpBase(httpBase: string): string {
  const u = new URL(httpBase.replace(/\/$/, ""));
  const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${u.hostname}:2088`;
}

export async function GET() {
  const base = (process.env.CAMERA_ENTITY_BASE_URL ?? DEFAULT_ENTITY_BASE).replace(/\/$/, "");
  const explicit = process.env.EO_DETECTION_WS_URL?.trim();
  const derived = deriveWsFromEntityHttpBase(base);
  const urls = explicit ? [explicit, derived] : [derived];
  return NextResponse.json({ urls }, { headers: { "Cache-Control": "no-store" } });
}
