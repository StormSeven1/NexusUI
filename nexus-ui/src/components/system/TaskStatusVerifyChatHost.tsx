"use client";

import { useEffect } from "react";
import { subscribeTaskStatusChat } from "@/lib/task-status-chat-feed-bus";
import { ingestTaskStatusChatPayload } from "@/lib/task-status-verify-chat-ingest";

/**
 * 常驻订阅查证 SSE 并写入智能助手会话 store，与右侧是否打开 ChatPanel / 是否切到 chat 分区无关。
 */
export function TaskStatusVerifyChatHost() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NEXT_PUBLIC_TASK_STATUS_CHAT_FEED === "false") return;
    return subscribeTaskStatusChat(ingestTaskStatusChatPayload);
  }, []);

  return null;
}
