"use client";

import { generateId } from "ai";
import { defaultSkyOwnerEntityId } from "@/lib/camera-management-client";
import { useAppConfigStore } from "@/stores/app-config-store";
import { useAssistantPanelSessionStore, getKnowledgeBaseThreadId } from "@/stores/assistant-panel-session-store";

const CLIENT_SESSION_KEY = "nexus-knowledge-base-client-session-id";

function readClientSessionId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = localStorage.getItem(CLIENT_SESSION_KEY)?.trim();
    if (existing) return existing;
    const created = `nexus-kb-${generateId()}`;
    localStorage.setItem(CLIENT_SESSION_KEY, created);
    return created;
  } catch {
    return `nexus-kb-${generateId()}`;
  }
}

export function ensureKnowledgeBaseThreadId(): string {
  const existing = getKnowledgeBaseThreadId();
  if (existing) return existing;
  const created = `nexus-kb-thread-${generateId()}`;
  useAssistantPanelSessionStore.getState().setThreadId(created);
  return created;
}

function resolveSelectedCameraId(): string | undefined {
  const cm = useAppConfigStore.getState().config?.cameraManagement;
  if (!cm) return undefined;
  return defaultSkyOwnerEntityId(cm);
}

function resolveSelectedCameraName(): string | undefined {
  return undefined;
}

/** 构建 `POST /api/knowledge-base-chat` 请求体（融控任务管理协议） */
export function buildKnowledgeBaseChatRequestBody(userText: string): Record<string, unknown> {
  const threadId = ensureKnowledgeBaseThreadId();
  const clientSessionId = readClientSessionId();
  const terminalId =
    typeof window !== "undefined" && window.location?.host?.trim()
      ? window.location.host.trim()
      : "unknown";

  const userContext: Record<string, unknown> = {
    source_platform: "rongkong",
    client_session_id: clientSessionId,
    terminal_id: terminalId,
  };

  const cameraId = resolveSelectedCameraId();
  if (cameraId) userContext.selected_camera_id = cameraId;
  const cameraName = resolveSelectedCameraName();
  if (cameraName) userContext.selected_camera_name = cameraName;

  return {
    messages: [{ role: "user", content: userText }],
    thread_id: threadId,
    user_context: userContext,
    debug: true,
  };
}
