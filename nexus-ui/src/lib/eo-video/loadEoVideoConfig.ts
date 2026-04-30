import type { EoVideoStreamsConfig, EoVideoStreamEntry } from "./types";
import { signalingUrlFromWebrtcUrl } from "./buildSignalingUrl";
import { rewriteSignalingUrlForBrowser } from "./zlmProxyUrl";

const DEFAULT_CONFIG_PATH = "/config/eo-video.streams.json";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, field: string): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`Invalid ${field}`);
  return v;
}

function asStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    throw new Error(`Invalid ${field}`);
  }
  return v as string[];
}

function asOptionalString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function parseIceServers(raw: unknown): EoVideoStreamsConfig["iceServers"] {
  if (!Array.isArray(raw)) return [{ urls: "stun:stun.l.google.com:19302" }];
  return raw.map((item, i) => {
    if (!isRecord(item)) throw new Error(`iceServers[${i}]`);
    const urls = item.urls;
    if (typeof urls === "string") return { urls, username: item.username as string | undefined, credential: item.credential as string | undefined };
    if (Array.isArray(urls) && urls.every((u) => typeof u === "string")) {
      return { urls: urls as string[], username: item.username as string | undefined, credential: item.credential as string | undefined };
    }
    throw new Error(`iceServers[${i}].urls`);
  });
}

function parseUavMeta(raw: unknown, idx: number): EoVideoStreamEntry["uav"] | undefined {
  if (raw == null) return undefined;
  if (!isRecord(raw)) throw new Error(`streams[${idx}].uav`);
  const entityId = asString(raw.entityId, `streams[${idx}].uav.entityId`);
  const deviceSN = asString(raw.deviceSN, `streams[${idx}].uav.deviceSN`);
  const airportSN = asString(raw.airportSN, `streams[${idx}].uav.airportSN`);
  const vendorRaw = asString(raw.vendor, `streams[${idx}].uav.vendor`).toLowerCase();
  const vendor = vendorRaw === "jouav" ? "jouav" : "dji";
  const dockPlaybackEntityId =
    asOptionalString(raw.dockPlaybackEntityId) ?? asOptionalString(raw.dockEntityId) ?? entityId;
  const airPlaybackEntityId =
    asOptionalString(raw.airPlaybackEntityId) ?? asOptionalString(raw.airEntityId) ?? entityId;
  return {
    entityId,
    deviceSN,
    airportSN,
    vendor,
    dockPlaybackEntityId,
    airPlaybackEntityId,
  };
}

function parseStreams(raw: unknown): EoVideoStreamEntry[] {
  if (!Array.isArray(raw)) throw new Error("streams must be array");
  return raw.map((s, i) => {
    if (!isRecord(s)) throw new Error(`streams[${i}]`);
    const id = asString(s.id, `streams[${i}].id`);
    const label = asString(s.label, `streams[${i}].label`);
    const uav = parseUavMeta(s.uav, i);
    const rsRaw = s.registrySource;
    const registrySource =
      rsRaw === "camera" || rsRaw === "uav" ? (rsRaw as "camera" | "uav") : undefined;
    const sigRaw = s.signalingUrl;
    const webRaw = s.webrtcUrl;
    let signalingUrl: string;
    if (typeof sigRaw === "string" && sigRaw.trim()) {
      signalingUrl = sigRaw.trim();
    } else if (typeof webRaw === "string" && webRaw.trim()) {
      signalingUrl = signalingUrlFromWebrtcUrl(webRaw);
    } else if (uav) {
      signalingUrl = "about:blank";
    } else if (registrySource === "camera") {
      signalingUrl = "about:blank";
    } else {
      throw new Error(`streams[${i}]: need signalingUrl or webrtcUrl`);
    }
    const out: EoVideoStreamEntry = { id, label, signalingUrl };
    if (typeof webRaw === "string" && webRaw.trim()) out.webrtcUrl = webRaw.trim();
    if (uav) out.uav = uav;
    if (registrySource) out.registrySource = registrySource;
    return out;
  });
}

function parseContextMenu(raw: unknown): EoVideoStreamsConfig["contextMenu"] {
  if (!isRecord(raw)) throw new Error("contextMenu");
  const groupsRaw = raw.groups;
  if (!Array.isArray(groupsRaw)) throw new Error("contextMenu.groups");
  const groups = groupsRaw.map((g, i) => {
    if (!isRecord(g)) throw new Error(`contextMenu.groups[${i}]`);
    return {
      label: asString(g.label, `groups[${i}].label`),
      streamIds: asStringArray(g.streamIds, `groups[${i}].streamIds`),
    };
  });
  const menuLayoutRaw = raw.menuLayout;
  const menuLayout =
    menuLayoutRaw === "nested" ? "nested" : menuLayoutRaw === "flat" ? "flat" : undefined;

  return {
    title: typeof raw.title === "string" ? raw.title : undefined,
    menuLayout,
    groups,
  };
}

/** 将未知 JSON 校验为 EoVideoStreamsConfig */
export function parseEoVideoConfig(json: unknown): EoVideoStreamsConfig {
  if (!isRecord(json)) throw new Error("Root must be object");
  const defaultStreamId = asString(json.defaultStreamId, "defaultStreamId");
  const streams = parseStreams(json.streams);
  const ids = new Set(streams.map((s) => s.id));
  if (!ids.has(defaultStreamId)) throw new Error("defaultStreamId must exist in streams");
  const contextMenu = parseContextMenu(json.contextMenu);
  for (const g of contextMenu.groups) {
    for (const sid of g.streamIds) {
      if (!ids.has(sid)) throw new Error(`Unknown streamId in menu: ${sid}`);
    }
  }
  const base: EoVideoStreamsConfig = {
    defaultStreamId,
    iceServers: parseIceServers(json.iceServers),
    streams,
    contextMenu,
  };
  return rewriteStreamsSignalingForBrowser(base);
}

function rewriteStreamsSignalingForBrowser(c: EoVideoStreamsConfig): EoVideoStreamsConfig {
  return {
    ...c,
    streams: c.streams.map((s) => ({
      ...s,
      signalingUrl: rewriteSignalingUrlForBrowser(s.signalingUrl),
    })),
  };
}

/**
 * 默认：运行时 fetch public 下 JSON（便于替换运维配置）。
 * @param configUrl 绝对路径或同源相对路径，默认 `/config/eo-video.streams.json`
 */
export async function loadEoVideoConfig(configUrl: string = DEFAULT_CONFIG_PATH): Promise<EoVideoStreamsConfig> {
  const res = await fetch(configUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load EO video config: ${res.status}`);
  const data: unknown = await res.json();
  return parseEoVideoConfig(data);
}
