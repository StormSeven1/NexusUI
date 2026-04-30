import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { signalingUrlFromWebrtcUrl } from "@/lib/eo-video/buildSignalingUrl";

interface ZOthersConfig {
  uavCameras?: Array<{ name?: string; url?: string }>;
}

interface EntityRow {
  aliases?: { name?: unknown };
  sensorParameters?: { url?: unknown };
}

const DEFAULT_ENTITY_BASE = "http://192.168.18.141:8088";

function cameraIdByIndex(i: number): string {
  return `camera_${String(i).padStart(3, "0")}`;
}

function toSignalingUrl(rawVideoUrl: string): string | null {
  const raw = rawVideoUrl.trim();
  if (!raw) return null;
  if (raw.startsWith("webrtc://")) return signalingUrlFromWebrtcUrl(raw);
  if (raw.includes("/index/api/webrtc")) return raw;
  return null;
}

async function fetchEntityStream(base: string, entityId: string): Promise<{ label: string | null; signalingUrl: string | null }> {
  try {
    const res = await fetch(`${base}/api/v1/entity/${encodeURIComponent(entityId)}`, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
    });
    if (!res.ok) return { label: null, signalingUrl: null };
    const json = (await res.json()) as EntityRow;
    const name = json.aliases?.name;
    const label = typeof name === "string" && name.trim() ? name.trim() : null;
    const rawUrl = typeof json.sensorParameters?.url === "string" ? json.sensorParameters.url.trim() : "";
    return { label, signalingUrl: toSignalingUrl(rawUrl) };
  } catch {
    return { label: null, signalingUrl: null };
  }
}

/**
 * 从 z_others/base-vue-main/public/config.json 提取全部 uavCameras（webrtc://...）。
 * 仅用于本地联调，把旧仓配置接到 Nexus 右键菜单。
 */
export async function GET() {
  const cfgPath = path.join(process.cwd(), "..", "z_others", "base-vue-main", "public", "config.json");
  try {
    const text = await readFile(cfgPath, "utf-8");
    const raw = JSON.parse(text) as ZOthersConfig;
    const list = Array.isArray(raw.uavCameras) ? raw.uavCameras : [];
    const entityBase = (process.env.CAMERA_ENTITY_BASE_URL ?? DEFAULT_ENTITY_BASE).replace(/\/$/, "");
    const entityRows = await Promise.all(list.map((_, i) => fetchEntityStream(entityBase, cameraIdByIndex(i))));
    const streams = list
      .map((item, i) => {
        const entityId = cameraIdByIndex(i);
        const fallback = typeof item.name === "string" && item.name.trim() ? item.name.trim() : `源-${i + 1}`;
        const row = entityRows[i];
        const label = row?.label ?? fallback;
        const webrtcUrl = typeof item.url === "string" ? item.url.trim() : "";
        const signalingUrl = row?.signalingUrl ?? (webrtcUrl.startsWith("webrtc://") ? signalingUrlFromWebrtcUrl(webrtcUrl) : null);
        if (!signalingUrl) return null;
        return {
          id: entityId,
          label,
          webrtcUrl,
          signalingUrl,
        };
      })
      .filter((x): x is { id: string; label: string; webrtcUrl: string; signalingUrl: string } => Boolean(x));

    return NextResponse.json({ streams }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `eo-webrtc-sources: ${msg}`, streams: [] }, { status: 500 });
  }
}
