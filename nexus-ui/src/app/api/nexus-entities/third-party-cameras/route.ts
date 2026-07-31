import { NextResponse } from "next/server";

import type { EoCameraRegistryRow } from "@/lib/eo-video/cameraRegistryTypes";
import {
  mapEntitiesPayloadToThirdPartyCameras,
  mapEntitiesPayloadToThirdPartyCamerasSplit,
} from "@/lib/eo-video/mapEntitiesToCameraDevices";
import { normalizeEntityPlaybackJson } from "@/lib/eo-video/normalizeEntityPlayback";
import { getCameraEntityBaseUrl } from "@/lib/entityUpstream";

const DEFAULT_LIST_URL = "http://192.168.18.141:8090/api/v1/entities?page=1&size=100";

/**
 * 使用与 `NEXUS_ENTITIES_LIST_URL`（见 `.env.local`）一致的上游实体列表，
 * 筛出第三方相机实体（8090 列表 `ontology.specificType`）：
 * `ThirdPartyUdpCameraImage`（UDP/YUV）、`ThirdPartyUdpCameraVideo`（WebRTC）；兼容旧 `ThirdPartyCamera`。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const listUrl = (
    searchParams.get("url")?.trim() ||
    process.env.NEXUS_ENTITIES_LIST_URL?.trim() ||
    DEFAULT_LIST_URL
  ).trim();

  try {
    const res = await fetch(listUrl, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const text = await res.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json(
        { ok: false, error: "上游返回非 JSON", status: res.status, snippet: text.slice(0, 200), listUrl },
        { status: 502 },
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `上游 HTTP ${res.status}`, listUrl, snippet: text.slice(0, 400) },
        { status: 502 },
      );
    }
    const split = mapEntitiesPayloadToThirdPartyCamerasSplit(payload);
    const entityBase = getCameraEntityBaseUrl();
    const webrtcWithUrl: Array<EoCameraRegistryRow & { signalingUrl: string; rawVideoUrl: string }> = [];
    for (const row of split.webrtc) {
      try {
        const res = await fetch(`${entityBase}/api/v1/entity/${encodeURIComponent(row.entityId)}`, {
          headers: { Accept: "application/json", "Cache-Control": "no-cache" },
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          webrtcWithUrl.push({ ...row, signalingUrl: "about:blank", rawVideoUrl: "" });
          continue;
        }
        const detail: unknown = await res.json();
        const playback = normalizeEntityPlaybackJson(detail, row.entityId);
        webrtcWithUrl.push({
          ...row,
          signalingUrl: playback.signalingUrl?.trim() || "about:blank",
          rawVideoUrl: playback.rawVideoUrl,
        });
      } catch {
        /* 8088 暂不可达仍保留菜单项，播放时由前端 deferred 拉流 */
        webrtcWithUrl.push({ ...row, signalingUrl: "about:blank", rawVideoUrl: "" });
      }
    }
    const cameras = mapEntitiesPayloadToThirdPartyCameras(payload);
    return NextResponse.json(
      {
        ok: true,
        listUrl,
        fetchedAt: new Date().toISOString(),
        cameras,
        udpCameras: split.udp,
        webrtcCameras: webrtcWithUrl,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, listUrl }, { status: 500 });
  }
}
