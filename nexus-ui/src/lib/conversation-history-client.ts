const BASE = "/api/backend/conversations";
export const DISPOSAL_PLAN_HISTORY_TYPE = "disposal_plan_block_v1";

const activeConversationIds = new Map<string, string>();
const pendingConversationIds = new Map<string, Promise<string | null>>();

async function ensureConversation(
  title: string,
  category: "chat" | "plans" = "chat",
  reuseKey = category,
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
  const convId = await ensureConversation(title, category, reuseKey ?? category);
  if (!convId) return;
  try {
    const res = await fetch(`${BASE}/${convId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content: text }),
    });
    if (!res.ok) {
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
  const record = cleanBlock && typeof cleanBlock === "object" ? (cleanBlock as Record<string, unknown>) : {};
  const title = String(record.summary ?? record.taskId ?? "处置方案历史").trim() || "处置方案历史";
  const blockId = String(record.blockId ?? record.taskId ?? Date.now()).trim();
  await saveConversationHistoryMessage(
    "assistant",
    JSON.stringify({
      type: DISPOSAL_PLAN_HISTORY_TYPE,
      block: cleanBlock,
    }),
    title,
    "plans",
    `plans:${blockId}`,
  );
}
