"use client";

import { generateId } from "ai";
import {
  defaultSkyOwnerEntityId,
  resolveOwnerEntityIdForCameraTask,
} from "@/lib/camera-management-client";
import { EO_ACTIVE_MAIN_STREAM_STORAGE_PREFIX } from "@/lib/eo-video/eoStreamSelectionKeys";
import type { KnowledgeBasePendingInterrupt } from "@/lib/knowledge-base-chat-sse";
import { useAppConfigStore } from "@/stores/app-config-store";
import { useAssistantPanelSessionStore, getKnowledgeBaseThreadId } from "@/stores/assistant-panel-session-store";
import { useEoVideoPanelFocusStore } from "@/stores/eo-video-panel-focus-store";
import { useEoVideoStreamSelectionSyncStore } from "@/stores/eo-video-stream-selection-sync-store";
import { getTargetProfileImageDownloadUrls } from "@/stores/target-profile-store";
import { useAssetStore } from "@/stores/asset-store";
import { useMapGisCameraMenuStore } from "@/stores/map-gis-camera-menu-store";
import { canonicalEntityId } from "@/lib/camera-entity-id";

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

/** 当前选中光电主画面实体 id；无则回退配置默认对空相机 */
function resolveSelectedCameraId(): string | undefined {
  if (typeof window !== "undefined") {
    const focusedPanel = useEoVideoPanelFocusStore.getState().focusedDockPanelId.trim();
    const syncKey = focusedPanel || "electro-optical-1";
    let streamId =
      useEoVideoStreamSelectionSyncStore.getState().mainBySyncKey[syncKey]?.trim() || "";
    if (!streamId) {
      try {
        streamId =
          window.localStorage.getItem(EO_ACTIVE_MAIN_STREAM_STORAGE_PREFIX + syncKey)?.trim() ||
          "";
      } catch {
        /* ignore */
      }
    }
    if (streamId) {
      const fromEo = resolveOwnerEntityIdForCameraTask(streamId);
      if (fromEo) return fromEo;
    }
  }

  const cm = useAppConfigStore.getState().config?.cameraManagement;
  if (!cm) return undefined;
  return defaultSkyOwnerEntityId(cm);
}

function resolveSelectedCameraName(cameraId: string | undefined): string | undefined {
  const id = cameraId ? canonicalEntityId(cameraId) : "";
  if (!id) return undefined;
  const fromMenu = useMapGisCameraMenuStore
    .getState()
    .rows.find((r) => canonicalEntityId(r.entityId) === id)
    ?.label?.trim();
  if (fromMenu) return fromMenu;
  const fromAsset = useAssetStore
    .getState()
    .assets.find((a) => canonicalEntityId(a.id) === id)
    ?.name?.trim();
  return fromAsset || undefined;
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
  const cameraName = resolveSelectedCameraName(cameraId);
  if (cameraName) userContext.selected_camera_name = cameraName;

  // 目标档案当前展示图的下载地址；无图则不带该字段（船只识别路由才使用）
  const imageUrls = getTargetProfileImageDownloadUrls(8);
  if (imageUrls.length > 0) {
    userContext.image_urls = imageUrls;
  }

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
