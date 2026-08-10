import { NextRequest, NextResponse } from "next/server";
import { nexusDeleteEntityUrl } from "@/lib/nexus-entity-api.server";
import { nexusEntitiesAuthHeaders, invalidateNexusEntitiesAccessToken } from "@/lib/server/nexus-entities-fetch";

type Ctx = { params: Promise<{ entityId: string }> };

/** 代理 `DELETE {host}/api/v1/entities/<entityId>`（8090 开鉴权时带 Bearer） */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { entityId } = await ctx.params;
  const id = decodeURIComponent(entityId ?? "").trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "缺少 entityId" }, { status: 400 });
  }

  const url = nexusDeleteEntityUrl(id);
  try {
    const doFetch = async () => {
      const headers = await nexusEntitiesAuthHeaders({ Accept: "application/json" });
      return fetch(url, {
        method: "DELETE",
        headers,
        cache: "no-store",
      });
    };

    let res = await doFetch();
    if (res.status === 401) {
      invalidateNexusEntitiesAccessToken();
      res = await doFetch();
    }
    const text = await res.text();
    let upstream: unknown = null;
    try {
      upstream = text ? JSON.parse(text) : null;
    } catch {
      upstream = { raw: text.slice(0, 300) };
    }
    if (res.status === 404) {
      return NextResponse.json({ ok: true, skipped: true, url, upstream });
    }
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `上游 HTTP ${res.status}`, url, upstream },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, url, upstream });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, url }, { status: 500 });
  }
}
