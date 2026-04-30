import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

import { buildCameraRegistryFile, mapEntitiesPayloadToCameras } from "@/lib/eo-video/mapEntitiesToCameraDevices";
import {
  buildDroneDevicesFile,
  extractEntityRecords,
  mapEntitiesPayloadToDevices,
} from "@/lib/eo-video/mapEntitiesToDroneDevices";

const DEFAULT_LIST_URL = "http://192.168.18.141:8090/api/v1/entities?page=1&size=100";

/**
 * POST：拉取注册设备列表并写入 public/config/eo-video.drone-devices.json 与 eo-video.camera-registry.json（本地开发机有效）。
 * GET：仅拉取并返回解析结果，不写文件（便于调试）。
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const listUrl =
    typeof body.listUrl === "string" && body.listUrl.trim()
      ? body.listUrl.trim()
      : (process.env.NEXUS_ENTITIES_LIST_URL ?? DEFAULT_LIST_URL).trim();

  try {
    const res = await fetch(listUrl, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json(
        { ok: false, error: "注册接口返回非 JSON", status: res.status, snippet: text.slice(0, 200) },
        { status: 502 },
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `注册接口 HTTP ${res.status}`, snippet: text.slice(0, 400) },
        { status: 502 },
      );
    }

    const droneFile = buildDroneDevicesFile(listUrl, json);
    const cameraFile = buildCameraRegistryFile(listUrl, json);
    const dir = path.join(process.cwd(), "public", "config");
    await mkdir(dir, { recursive: true });
    const dronePath = path.join(dir, "eo-video.drone-devices.json");
    const cameraPath = path.join(dir, "eo-video.camera-registry.json");
    await writeFile(dronePath, `${JSON.stringify(droneFile, null, 2)}\n`, "utf-8");
    await writeFile(cameraPath, `${JSON.stringify(cameraFile, null, 2)}\n`, "utf-8");

    return NextResponse.json(
      {
        ok: true,
        dronePath,
        cameraPath,
        droneCount: droneFile.devices.length,
        cameraCount: cameraFile.cameras.length,
        syncedAt: droneFile.syncedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const listUrl = (searchParams.get("url") ?? process.env.NEXUS_ENTITIES_LIST_URL ?? DEFAULT_LIST_URL).trim();
  const diagnose = searchParams.get("diagnose") === "1" || searchParams.get("diagnose") === "true";

  try {
    const res = await fetch(listUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown;
    let jsonError: string | null = null;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
      jsonError = "响应不是合法 JSON";
    }

    if (diagnose) {
      const records = json != null ? extractEntityRecords(json) : [];
      const devices = json != null ? mapEntitiesPayloadToDevices(json) : [];
      const cameras = json != null ? mapEntitiesPayloadToCameras(json) : [];
      const first = records[0];
      const firstKeys =
        first && typeof first === "object" && first !== null && !Array.isArray(first)
          ? Object.keys(first as Record<string, unknown>).slice(0, 60)
          : [];
      const firstRecordSample =
        first && typeof first === "object"
          ? JSON.stringify(first).slice(0, 1200)
          : typeof first === "string"
            ? String(first).slice(0, 200)
            : null;

      return NextResponse.json(
        {
          listUrl,
          upstreamHttpStatus: res.status,
          upstreamOk: res.ok,
          responseBytes: text.length,
          jsonParseOk: jsonError == null,
          jsonParseError: jsonError,
          extractedRecordCount: records.length,
          mappedDroneDeviceCount: devices.length,
          mappedCameraDeviceCount: cameras.length,
          mappedCamerasPreview: cameras.slice(0, 8),
          firstRecordKeys: firstKeys,
          firstRecordSample,
          mappedDevicesPreview: devices.slice(0, 8),
          hint:
            devices.length === 0 && records.length > 0
              ? "已解析到列表项但字段未匹配：请对照 firstRecordKeys / firstRecordSample 扩展 mapEntitiesToDroneDevices.mapOne"
              : devices.length === 0 && records.length === 0
                ? "未找到对象数组：请对照原始 JSON 扩展 extractEntityRecords"
                : null,
        },
        { headers: { "Cache-Control": "no-store" }, status: 200 },
      );
    }

    if (jsonError || json == null) {
      return NextResponse.json(
        { error: jsonError ?? "invalid json", devices: [] },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const file = buildDroneDevicesFile(listUrl, json);
    return NextResponse.json(file, { headers: { "Cache-Control": "no-store" }, status: res.ok ? 200 : 502 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (diagnose) {
      return NextResponse.json(
        { listUrl, error: msg, extractedRecordCount: 0, mappedDroneDeviceCount: 0 },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json({ error: msg, devices: [] }, { status: 500 });
  }
}
