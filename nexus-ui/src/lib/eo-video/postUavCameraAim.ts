"use client";

/** 与 `PtzMainWidget::UavAimAt5` / `uavtabboard::sendCameraAimTargetRequset` 同属 `camera_aim` payload 指令 */

export type PostUavCameraAimParams = {
  deviceSn: string;
  payloadIndex: string;
  /** 归一化目标点坐标，对齐 Qt：`D.x/width`、`D.y/height`（可略超 0–1） */
  x: number;
  y: number;
  /** 默认 `"zoom"`，与 `UavAimAt5` 一致 */
  cameraType?: string;
  locked?: boolean;
};

export type PostUavCameraAimResult = {
  ok: boolean;
  status: number;
  detail?: string;
  rawText?: string;
};

export async function postUavCameraAim(params: PostUavCameraAimParams): Promise<PostUavCameraAimResult> {
  const res = await fetch("/api/uav-live/payload-command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceSn: params.deviceSn.trim(),
      payloadIndex: params.payloadIndex.trim(),
      x: params.x,
      y: params.y,
      cameraType: params.cameraType ?? "zoom",
      locked: params.locked ?? false,
      cmd: "camera_aim",
    }),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: PostUavCameraAimResult | null = null;
  try {
    json = text ? (JSON.parse(text) as PostUavCameraAimResult) : null;
  } catch {
    json = null;
  }
  if (json && typeof json.ok === "boolean") {
    return { ...json, rawText: text };
  }
  return {
    ok: res.ok,
    status: res.status,
    detail: text.slice(0, 400),
    rawText: text,
  };
}
