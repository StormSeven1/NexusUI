import { useTrackStore } from "@/stores/track-store";
import { useVerifiedTrackStore } from "@/stores/verified-track-store";

function collectTrackUniqueIds(tracks: readonly { uniqueID?: string; showID?: string }[]): string[] {
  const out = new Set<string>();
  for (const t of tracks) {
    for (const raw of [t.uniqueID, t.showID]) {
      const s = String(raw ?? "").trim();
      if (/^\d+$/.test(s)) out.add(s);
    }
  }
  return [...out];
}

/** 按当前航迹 unique_id 批量查库，恢复刷新后的绿色标绘 */
export async function syncVerifiedTracksFromDbForCurrentTracks(): Promise<void> {
  const uniqueIds = collectTrackUniqueIds(useTrackStore.getState().tracks);
  if (!uniqueIds.length) return;

  const bp = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
  try {
    const res = await fetch(`${bp}/api/tracks/verified-unique-ids`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uniqueIds }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { verified?: string[] };
    const verified = Array.isArray(json.verified) ? json.verified : [];
    if (verified.length) useVerifiedTrackStore.getState().markVerifiedMany(verified);
  } catch {
    /* 无 PG 或网络失败时静默 */
  }
}
