import type { ThirdPartyPosFieldsFromTrack } from "@/lib/map-gis-camera-task";

/** 第三方相机雷达引导：`ThirdPartyCamPosTask`（0x3004 POS）→ `POST …/api/v1/tasks`（单次） */
export async function postThirdPartyPosTask(params: {
  backendBaseUrl: string;
  fields: ThirdPartyPosFieldsFromTrack;
  /** `owner.entityId`；缺省由 BFF 填 `""` */
  ownerEntityId?: string;
  /** `specification.entityId`；缺省由 BFF 填 `""` */
  specEntityId?: string;
}): Promise<Response> {
  const body: Record<string, unknown> = {
    backendBaseUrl: params.backendBaseUrl,
    ownerEntityId: params.ownerEntityId ?? "",
    specEntityId: params.specEntityId ?? "",
    ...params.fields,
  };

  return fetch("/api/camera-task/third-party-pos", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}
