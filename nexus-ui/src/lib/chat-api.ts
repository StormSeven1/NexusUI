/**
 * 会话管理 API 客户端
 * 通过 Next.js rewrites 代理到 FastAPI /api/conversations/*
 */

const BASE = "/api/backend/conversations";

export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
  system_prompt: string;
}

export async function listConversations(limit = 50, offset = 0): Promise<ConversationSummary[]> {
  const res = await fetch(`${BASE}?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error("获取会话列表失败");
  return res.json();
}

export async function createConversation(title = "新对话"): Promise<ConversationSummary> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("创建会话失败");
  return res.json();
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const res = await fetch(`${BASE}/${id}`);
  if (!res.ok) throw new Error("获取会话详情失败");
  return res.json();
}

export async function updateConversation(id: string, data: { title?: string }): Promise<ConversationSummary> {
  const res = await fetch(`${BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("更新会话失败");
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("删除会话失败");
}

export async function clearMessages(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}/messages`, { method: "DELETE" });
  if (!res.ok) throw new Error("清空消息失败");
}
