import { NextResponse } from "next/server";
import { queryActiveAlarmSchemeId } from "@/lib/alarm-master-scheme-db.server";
import { resolvePostgresConnectionString } from "@/lib/postgres-connection.server";

/**
 * BFF：直连 Postgres `alarm_master_schemes`，取 `enabled=true` 的 scheme_id。
 * 对齐 Qt `DataAccessLayer::getActiveSchemeId()`；不经过告警服务 HTTP。
 */
export async function GET() {
  if (!resolvePostgresConnectionString()) {
    return NextResponse.json(
      { success: false, message: "数据库未配置（NEXUS_POSTGRES_URL）" },
      { status: 503 },
    );
  }

  const schemeId = await queryActiveAlarmSchemeId();
  return NextResponse.json({
    success: true,
    scheme_id: schemeId,
    message: schemeId ? undefined : "alarm_master_schemes 中无 enabled=true 的记录",
  });
}
