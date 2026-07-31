"use client";

import { generateId } from "ai";
import { defaultSkyOwnerEntityId } from "@/lib/camera-management-client";
import type { KnowledgeBasePendingInterrupt } from "@/lib/knowledge-base-chat-sse";
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

function buildUserContext(): Record<string, unknown> {
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

  return userContext;
}

/** 构建自然语言请求体（`POST /api/knowledge-base-chat` → 知识库上游 `/api/v1/chat/stream`） */
export function buildKnowledgeBaseChatRequestBody(userText: string): Record<string, unknown> {
  return {
    messages: [{ role: "user", content: userText }],
    thread_id: ensureKnowledgeBaseThreadId(),
    user_context: buildUserContext(),
  };
}

/**
 * 构建中断恢复请求体：不带 `messages`，按节点 `interrupt_id` 回传所选 `option.value`。
 * @see 外部平台对话接口请求规范 §4.2
 */
export function buildKnowledgeBaseResumeRequestBody(
  pending: KnowledgeBasePendingInterrupt,
  selectedValues: Record<string, string>,
): Record<string, unknown> {
  const interruptFeedback: Record<string, string> = {};
  for (const node of pending.nodes) {
    const value = selectedValues[node.interrupt_id]?.trim();
    if (!value || !node.options.some((option) => option.value === value)) {
      throw new Error(`缺少或无效的选项：${node.interrupt_id}`);
    }
    interruptFeedback[node.interrupt_id] = value;
  }
  return {
    thread_id: pending.threadId,
    interrupt_id: pending.interruptId,
    interrupt_feedback: interruptFeedback,
  };
}
