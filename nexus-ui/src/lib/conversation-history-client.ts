const BASE = "/api/backend/conversations";
export const DISPOSAL_PLAN_HISTORY_TYPE = "disposal_plan_block_v1";
const DISPOSAL_PLAN_HISTORY_TITLE = "\u5904\u7f6e\u65b9\u6848\u8bb0\u5f55";

const activeConversationIds = new Map<string, string>();
const pendingConversationIds = new Map<string, Promise<string | null>>();
let disposalPlanHistorySession = 0;

function getDisposalPlanHistoryReuseKey(): string {
  return `plans:current:${disposalPlanHistorySession}`;
}

export function resetDisposalPlanHistorySession(): void {
  disposalPlanHistorySession += 1;
}

async function ensureConversation(
  title: string,
  category: "chat" | "plans" = "chat",
  reuseKey: string = category,
): Promise<string | null> {
  const existing = activeConversationIds.get(reuseKey);
  if (existing) return existing;
  const pending = pendingConversationIds.get(reuseKey);
  if (pending) return pending;

  const createPromise = (async () => {
    try {
      const res = await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const id = String(data?.id ?? "").trim();
      if (!id) return null;
      activeConversationIds.set(reuseKey, id);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("conversation-history-updated", { detail: { category } }));
      }
      return id;
    } catch {
      return null;
    } finally {
      pendingConversationIds.delete(reuseKey);
    }
  })();

  pendingConversationIds.set(reuseKey, createPromise);
  return createPromise;
}

export async function saveConversationHistoryMessage(
  role: "user" | "assistant",
  content: string,
  title = "Conversation history",
  category: "chat" | "plans" = "chat",
  reuseKey?: string,
): Promise<void> {
  const text = String(content ?? "").trim();
  if (!text) return;
  const key = reuseKey ?? category;
  const convId = await ensureConversation(title, category, key);
  if (!convId) return;
  try {
    const res = await fetch(`${BASE}/${convId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content: text }),
    });
    if (!res.ok) {
      activeConversationIds.delete(key);
      console.error("[conversation-history] save failed", { status: res.status, convId, role, text });
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("conversation-history-updated", { detail: { category } }));
    }
  } catch (error) {
    console.error("[conversation-history] save error", error);
  }
}

export async function saveDisposalPlanHistoryBlock(block: unknown): Promise<void> {
  const cleanBlock =
    block && typeof block === "object"
      ? (() => {
          const { historyRestored, ...rest } = block as Record<string, unknown>;
          void historyRestored;
          return rest;
        })()
      : block;

  await saveConversationHistoryMessage(
    "assistant",
    JSON.stringify({
      type: DISPOSAL_PLAN_HISTORY_TYPE,
      block: cleanBlock,
    }),
    DISPOSAL_PLAN_HISTORY_TITLE,
    "plans",
    getDisposalPlanHistoryReuseKey(),
  );
}
