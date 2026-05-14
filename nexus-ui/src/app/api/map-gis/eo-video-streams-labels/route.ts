import { readFile } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * 地图右键 EO 展示名合并需要 `eo-video.streams.json` 里静态 `label`；
 * 部分部署未把 `public/config` 暴露到站点根 `/config`，故由服务端读仓库内文件，避免浏览器对 `/config/...` 的 404。
 */
export async function GET() {
  const candidates = [
    join(process.cwd(), "public", "config", "eo-video.streams.json"),
    join(process.cwd(), "config", "eo-video.streams.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf8");
      JSON.parse(raw);
      return new NextResponse(raw, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      /* 继续尝试下一路径 */
    }
  }
  return NextResponse.json({ streams: [] as unknown[] }, { status: 200 });
}
