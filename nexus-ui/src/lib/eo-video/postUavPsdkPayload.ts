"use client";

export type PostUavPsdkPayloadResult = {
  ok: boolean;
  message?: string;
  detail?: string;
  error?: string;
  status?: number;
};

/** 私有云 PSND 载荷指令（`/payload/psdk/commands`），`gateway_sn` 对齐 C++ `m_droneSNAndAirportSNMap[..].back()`（机场网关 SN）。 */
export async function postUavPsdkPayload(args: {
  gatewaySn: string;
  cmd: string;
  data: Record<string, unknown>;
}): Promise<PostUavPsdkPayloadResult> {
  const res = await fetch("/api/uav-live/psdk-payload", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      gatewaySn: args.gatewaySn.trim(),
      cmd: args.cmd.trim(),
      data: args.data,
    }),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: PostUavPsdkPayloadResult | null = null;
  try {
    json = text ? (JSON.parse(text) as PostUavPsdkPayloadResult) : null;
  } catch {
    json = { ok: false, detail: text.slice(0, 400) };
  }
  if (!json) return { ok: false, detail: text.slice(0, 400) };
  return json;
}

export type UploadUavPsdkAudioResult = {
  ok: boolean;
  md5?: string;
  fileId?: string;
  message?: string;
  detail?: string;
  error?: string;
};

/** multipart `file`，BFF 转投 `upload-audio` 并计算 md5。 */
export async function uploadUavPsdkAudio(file: Blob, filename: string): Promise<UploadUavPsdkAudioResult> {
  const fd = new FormData();
  fd.append("file", file, filename);
  const res = await fetch("/api/uav-live/psdk-upload-audio", {
    method: "POST",
    body: fd,
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: UploadUavPsdkAudioResult | null = null;
  try {
    json = text ? (JSON.parse(text) as UploadUavPsdkAudioResult) : null;
  } catch {
    json = { ok: false, detail: text.slice(0, 400) };
  }
  if (!json) return { ok: false, detail: text.slice(0, 400) };
  return json;
}
