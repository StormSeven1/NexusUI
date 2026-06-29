"use client";

import { useEffect, useRef } from "react";
import { subscribeTaskStatusChat } from "@/lib/task-status-chat-feed-bus";
import {
  resolveVerifyUniqueId,
  taskStatusPayloadIndicatesVerifyComplete,
} from "@/lib/verified-track-from-task-status";
import { syncVerifiedTracksFromDbForCurrentTracks } from "@/lib/verified-track-client-sync";
import { useTrackStore } from "@/stores/track-store";
import { useVerifiedTrackStore } from "@/stores/verified-track-store";

/**
 * 查证完成标黄：智能助手 SSE 收到图片 → unique_id 标黄；页面刷新后按 minio_multi_metadata 恢复。
 */
export function VerifiedTrackSyncHost() {
  const dbSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NEXT_PUBLIC_TASK_STATUS_CHAT_FEED === "false") return;

    const onPayload = (raw: import("@/lib/task-status-types").TaskStatusChatPayload) => {
      if (!taskStatusPayloadIndicatesVerifyComplete(raw)) return;
      const uid = resolveVerifyUniqueId(raw, useTrackStore.getState().tracks);
      if (uid) useVerifiedTrackStore.getState().markVerified(uid);
    };

    return subscribeTaskStatusChat(onPayload);
  }, []);

  useEffect(() => {
    void syncVerifiedTracksFromDbForCurrentTracks();

    const scheduleDbSync = () => {
      if (dbSyncTimerRef.current != null) clearTimeout(dbSyncTimerRef.current);
      dbSyncTimerRef.current = setTimeout(() => {
        dbSyncTimerRef.current = null;
        void syncVerifiedTracksFromDbForCurrentTracks();
      }, 800);
    };

    const unsub = useTrackStore.subscribe((s, p) => {
      if (s.tracks === p.tracks) return;
      scheduleDbSync();
    });

    return () => {
      unsub();
      if (dbSyncTimerRef.current != null) clearTimeout(dbSyncTimerRef.current);
    };
  }, []);

  return null;
}
