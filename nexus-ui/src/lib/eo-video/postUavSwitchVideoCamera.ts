"use client";

import { uavMainPayloadIndexForDrone } from "@/lib/eo-video/postUavGimbalReset";

export type UavVideoLensType = "wide" | "zoom" | "ir";

export type PostUavSwitchVideoCameraResult = {
  ok: boolean;
  message?: string;
  detail?: string;
  error?: string;
};

/**
 * WatchSys `switchboard::sendSwitchCameraRequest` →
 * `POST /api4third/manage/api/v1/live/streams/switch`
 * body: `{ device_sn, payload_index, video_type }`
 */
export async function postUavSwitchVideoCamera(args: {
  /** 机体 SN（C++ `m_droneSN` / front of map） */
  droneSn: string;
  videoType: UavVideoLensType;
  payloadIndex?: string;
}): Promise<PostUavSwitchVideoCameraResult> {
  const droneSn = args.droneSn.trim();
  if (!droneSn) throw new Error("missing_drone_sn");
  const payloadIndex = (args.payloadIndex ?? uavMainPayloadIndexForDrone(droneSn)).trim();
  const res = await fetch("/api/uav-live/switch-video", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      deviceSn: droneSn,
      payloadIndex,
      videoType: args.videoType,
    }),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: PostUavSwitchVideoCameraResult | null = null;
  try {
    json = text ? (JSON.parse(text) as PostUavSwitchVideoCameraResult) : null;
  } catch {
    json = { ok: false, detail: text.slice(0, 400) };
  }
  if (!json) return { ok: false, detail: text.slice(0, 400) };
  if (!res.ok || !json.ok) {
    throw new Error(json.detail || json.error || text.slice(0, 300) || `HTTP ${res.status}`);
  }
  return json;
}
