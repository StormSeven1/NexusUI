import { access } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";

import { camConfAbsPath, type CalcRecordKind } from "@/lib/eo-calc-record/eoCalcRecordStorage.server";
import {
  formatAimPathForGrpc,
  getAimParamGrpcTarget,
  sendAimParamViaGrpc,
} from "@/server/eo-aim-param-grpc";

export const runtime = "nodejs";

function parseCameraIndex(raw: string): number | null {
  const m = raw.trim().match(/^camera_(\d+)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 对齐 Qt `AimParamController::sendRequest`：gRPC StreamAim 提交 camConf 路径生成对准参数 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { entityId?: string; aimKind?: number };
    const entityId = String(body.entityId ?? "").trim();
    const aimKind = Math.trunc(Number(body.aimKind));
    const cameraIndex = parseCameraIndex(entityId);
    if (cameraIndex == null || (aimKind !== 0 && aimKind !== 1)) {
      return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
    }

    const kind: CalcRecordKind = aimKind === 0 ? "sea" : "sky";
    const localPath = camConfAbsPath(cameraIndex, kind);
    try {
      await access(localPath);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: "camconf_missing",
          detail: `标定文件不存在：${localPath}`,
          localPath,
          hint: "请先完成跟踪采集写入，并确认 NEXUS_EO_CALC_RECORD_CAM_CONF_DIR 指向可写 NFS 目录",
        },
        { status: 404 },
      );
    }

    const aimPath = formatAimPathForGrpc(cameraIndex, kind);
    const result = await sendAimParamViaGrpc({
      cameraIndex,
      aimType: aimKind,
      aimPath,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error ?? "aim_param_failed",
          detail: result.detail,
          target: result.target || getAimParamGrpcTarget(),
          aimPath,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      transport: "grpc",
      target: result.target,
      aimPath,
      cameraIndex: result.response?.cameraIndex,
      aimType: result.response?.aimType,
      seamParamCount: result.response?.seamParam.length ?? 0,
      seamParam: result.response?.seamParam,
      skyParam: result.response?.skyParam,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "aim_param_failed", detail }, { status: 502 });
  }
}
