import { NextResponse } from "next/server";

import {
  canonicalizeTargetType,
  updateTargetTypeViaGrpc,
} from "@/server/target-type-grpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/target-type
 * body: { targetId: string|number, targetType: "ship"|"buoy"|"other" }
 * → TrackManager TargetTypeService.UpdateTargetType（对齐 AlarmSys）
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "invalid json" }, { status: 400 });
  }

  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const targetId = rec.targetId ?? rec.targetID ?? rec.target_id ?? rec.uniqueId ?? rec.uniqueID;
  const targetTypeRaw = rec.targetType ?? rec.target_type;
  const canonical = typeof targetTypeRaw === "string" ? canonicalizeTargetType(targetTypeRaw) : null;

  if (targetId == null || String(targetId).trim() === "") {
    return NextResponse.json({ ok: false, message: "missing targetId" }, { status: 400 });
  }
  if (!canonical) {
    return NextResponse.json(
      { ok: false, message: "targetType must be ship | buoy | other" },
      { status: 400 },
    );
  }

  const result = await updateTargetTypeViaGrpc(String(targetId).trim(), canonical);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: result.error ?? result.reason ?? "UpdateTargetType failed",
        target: result.target,
        targetId: result.targetId,
        targetType: result.targetType,
        reason: result.reason,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: result.reason || "ok",
    target: result.target,
    targetId: result.targetId,
    targetType: result.targetType,
    accepted: result.accepted,
  });
}
