"use client";



import type { UIMessage } from "ai";

import { create } from "zustand";

import { createJSONStorage, persist } from "zustand/middleware";

import { normalizeVerifyEntityId } from "@/lib/task-status-verify-entity-ref";

import type { WorkflowDeviceCard } from "@/lib/langgraph-workflow-context";
import { formatWorkflowSessionTitle } from "@/lib/langgraph-workflow-context";


/** 固定 Tab：值班助手 / AI助手；用户新建 `user`；任务工作流自动建 `workflow` */

export type AssistantChatTabKind = "duty" | "ai" | "user" | "workflow";



export const DUTY_CHAT_TAB_ID = "duty-assistant";

export const AI_CHAT_TAB_ID = "ai-assistant";



const ASSISTANT_CHAT_TABS_STORAGE_KEY = "nexus-assistant-chat-tabs-v1";



export type AssistantChatTab = {

  id: string;

  title: string;

  kind: AssistantChatTabKind;

  messages: UIMessage[];

  langGraphThreadId: string;

  /**
   * 业务工作流 ID（chat_notification.details.thread_id），
   * 用于 terminate / stop-capture；与 LangGraph 对话 thread_id 不同。
   */
  businessWorkflowThreadId: string;

  /** 工作流显示/内部名称（用于匹配如「探鸟雷达」） */
  workflowName: string;

  /** 会话顶部设备卡片（相机 / 无人机等，SSE 下发后累积） */
  workflowDevices: WorkflowDeviceCard[];

  /** 工作流会话登记的业务 taskId（查证 SSE 路由） */

  taskIds: string[];

  /** interrupt 确认登记的查证实体（uav-* / camera_*；无人机常不带 taskID） */

  verifyEntityIds: string[];

  /**
   * 发起该工作流时的对话入口：knowledge-base → DbQa 主机 terminate；
   * assistant → 任务管理。缺省按当前 UI 模式。
   */
  workflowApiSource: "assistant" | "knowledge-base" | "";

};



type MessagesUpdater = UIMessage[] | ((prev: UIMessage[]) => UIMessage[]);



function emptyTab(

  id: string,

  title: string,

  kind: AssistantChatTabKind,

): AssistantChatTab {

  return {
    id,
    title,
    kind,
    messages: [],
    langGraphThreadId: "",
    businessWorkflowThreadId: "",
    workflowName: "",
    workflowDevices: [],
    taskIds: [],
    verifyEntityIds: [],
    workflowApiSource: "",
  };

}



type State = {

  tabs: AssistantChatTab[];

  activeTabId: string;

  workflowCounter: number;

  userSessionCounter: number;

  /** 非持久化：LangGraph 工作流 SSE 进行中时，查证无 taskID 仅回落到此 Tab */
  activeWorkflowVerifyTabId: string | null;

  patchTabMessages: (tabId: string, updater: MessagesUpdater) => void;

  setActiveTabId: (tabId: string) => void;

  setTabLangGraphThreadId: (tabId: string, threadId: string) => void;

  setTabBusinessWorkflowThreadId: (tabId: string, threadId: string) => void;

  setTabWorkflowApiSource: (
    tabId: string,
    source: "assistant" | "knowledge-base",
  ) => void;

  setTabWorkflowName: (tabId: string, name: string) => void;

  /** 用 extracted_topic 替换「会话N」标题，并写入 workflowName */
  applyWorkflowTopicToTab: (tabId: string, topic: string) => void;

  /** 合并会话顶部设备卡片（同 id 更新 status） */
  upsertWorkflowDevicesForTab: (tabId: string, devices: WorkflowDeviceCard[]) => void;

  registerTaskIdsForTab: (tabId: string, taskIds: string[]) => void;

  registerVerifyEntityIdsForTab: (tabId: string, entityIds: string[]) => void;

  createWorkflowTab: () => string;

  createUserChatTab: () => string;

  /** 保留 Tab，仅清空消息与 thread/task 登记 */

  clearTabContent: (tabId: string) => void;

  /** 删除可关闭 Tab（user / workflow）；固定 Tab 不处理 */

  deleteTab: (tabId: string) => boolean;

  clearTab: (tabId: string) => void;

  clearAllTabs: () => void;

  getTabById: (tabId: string) => AssistantChatTab | undefined;

  resolveTabIdForTaskId: (taskId: string) => string | null;

  /** 助手工作流查证：按 taskId 找 Tab，未登记则新建「会话N」并登记 */
  resolveOrCreateWorkflowTabForTaskId: (taskId: string) => string;

  resolveTabIdForVerifyEntityId: (entityId: string) => string | null;

  setActiveWorkflowVerifyTabId: (tabId: string | null) => void;

  resolveActiveWorkflowVerifyTab: () => string | null;

  /** 工作流 SSE 结束：取消 active（保留 taskIds/实体登记供查证尾包路由） */
  finishWorkflowVerifyRouting: (tabId: string) => void;

  /** 最新工作流「会话N」Tab */
  resolveLatestWorkflowVerifyTab: () => string | null;

};



function defaultTabs(): AssistantChatTab[] {

  return [

    emptyTab(DUTY_CHAT_TAB_ID, "值班助手", "duty"),

    emptyTab(AI_CHAT_TAB_ID, "AI助手", "ai"),

  ];

}



function mergePersistedTabs(

  persisted: AssistantChatTab[] | undefined,

  defaults: AssistantChatTab[],

): AssistantChatTab[] {

  if (!persisted?.length) return defaults;



  const map = new Map<string, AssistantChatTab>();

  for (const d of defaults) {

    map.set(d.id, { ...d });

  }



  for (const t of persisted) {

    const existing = map.get(t.id);

    if (existing && (existing.kind === "duty" || existing.kind === "ai")) {

      map.set(t.id, {

        ...existing,

        messages: Array.isArray(t.messages) ? t.messages : [],

        langGraphThreadId: t.langGraphThreadId ?? "",

        businessWorkflowThreadId: t.businessWorkflowThreadId ?? "",

        workflowName: t.workflowName ?? "",

        workflowDevices: Array.isArray(t.workflowDevices) ? t.workflowDevices : [],

        taskIds: Array.isArray(t.taskIds) ? t.taskIds : [],

        verifyEntityIds: Array.isArray(t.verifyEntityIds) ? t.verifyEntityIds : [],

        workflowApiSource:
          t.workflowApiSource === "knowledge-base" || t.workflowApiSource === "assistant"
            ? t.workflowApiSource
            : "",

      });

    } else if (t.kind === "user" || t.kind === "workflow") {

      map.set(t.id, {

        ...t,

        messages: Array.isArray(t.messages) ? t.messages : [],

        langGraphThreadId: t.langGraphThreadId ?? "",

        businessWorkflowThreadId: t.businessWorkflowThreadId ?? "",

        workflowName: t.workflowName ?? "",

        workflowDevices: Array.isArray(t.workflowDevices) ? t.workflowDevices : [],

        taskIds: Array.isArray(t.taskIds) ? t.taskIds : [],

        verifyEntityIds: Array.isArray(t.verifyEntityIds) ? t.verifyEntityIds : [],

        workflowApiSource:
          t.workflowApiSource === "knowledge-base" || t.workflowApiSource === "assistant"
            ? t.workflowApiSource
            : "",

      });

    }

  }



  const ordered: AssistantChatTab[] = [];

  for (const d of defaults) {

    const tab = map.get(d.id);

    if (tab) ordered.push(tab);

    map.delete(d.id);

  }

  for (const t of persisted) {

    if (map.has(t.id)) {

      ordered.push(map.get(t.id)!);

      map.delete(t.id);

    }

  }

  for (const t of map.values()) {

    ordered.push(t);

  }

  return ordered;

}



function resolveCountersFromTabs(tabs: AssistantChatTab[]) {

  let workflowCounter = 0;

  let userSessionCounter = 0;

  for (const tab of tabs) {

    const wf = tab.id.match(/^workflow-session-(\d+)$/);

    if (wf) workflowCounter = Math.max(workflowCounter, Number(wf[1]));

    const user = tab.id.match(/^user-chat-(\d+)$/);

    if (user) userSessionCounter = Math.max(userSessionCounter, Number(user[1]));

  }

  return { workflowCounter, userSessionCounter };

}



export const useAssistantChatTabsStore = create<State>()(

  persist(

    (set, get) => ({

      tabs: defaultTabs(),

      activeTabId: AI_CHAT_TAB_ID,

      workflowCounter: 0,

      userSessionCounter: 0,

      activeWorkflowVerifyTabId: null,



      patchTabMessages: (tabId, updater) => {

        set((s) => ({

          tabs: s.tabs.map((t) => {

            if (t.id !== tabId) return t;

            const next =

              typeof updater === "function" ? updater(t.messages) : updater;

            return { ...t, messages: next };

          }),

        }));

      },



      setActiveTabId: (tabId) => {

        if (!get().tabs.some((t) => t.id === tabId)) return;

        set({ activeTabId: tabId });

      },



      setTabLangGraphThreadId: (tabId, threadId) => {

        const tid = threadId.trim();

        if (!tid) return;

        set((s) => ({

          tabs: s.tabs.map((t) =>

            t.id === tabId ? { ...t, langGraphThreadId: tid } : t,

          ),

        }));

      },

      setTabBusinessWorkflowThreadId: (tabId, threadId) => {
        const tid = threadId.trim();
        if (!tid) return;
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId ? { ...t, businessWorkflowThreadId: tid } : t,
          ),
        }));
      },

      setTabWorkflowApiSource: (tabId, source) => {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId ? { ...t, workflowApiSource: source } : t,
          ),
        }));
      },

      setTabWorkflowName: (tabId, name) => {
        const n = name.trim();
        if (!n) return;
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId) return t;
            // 已有更具体中文名时不降级覆盖；仍允许补齐
            if (t.workflowName.includes("探鸟雷达") && !n.includes("探鸟雷达")) return t;
            return { ...t, workflowName: n };
          }),
        }));
      },

      applyWorkflowTopicToTab: (tabId, topic) => {
        const raw = topic.trim();
        if (!raw) return;
        const title = formatWorkflowSessionTitle(raw);
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId) return t;
            const nextName =
              t.workflowName.includes("探鸟雷达") && !raw.includes("探鸟雷达")
                ? t.workflowName
                : raw;
            return {
              ...t,
              workflowName: nextName,
              // 工作流 Tab：用 topic 替换「会话N」；已是业务标题则允许更新为更新的 topic
              title: t.kind === "workflow" ? title : t.title,
            };
          }),
        }));
      },

      upsertWorkflowDevicesForTab: (tabId, devices) => {
        if (!devices.length) return;
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId) return t;
            const map = new Map(t.workflowDevices.map((d) => [d.id, d]));
            for (const d of devices) {
              const id = d.id.trim();
              if (!id) continue;
              const prev = map.get(id);
              map.set(id, {
                id,
                kind: d.kind,
                statusLabel: d.statusLabel || prev?.statusLabel || "",
              });
            }
            // 相机在前、无人机在后，稳定顺序
            const merged = [...map.values()].sort((a, b) => {
              if (a.kind === b.kind) return a.id.localeCompare(b.id);
              return a.kind === "camera" ? -1 : 1;
            });
            return { ...t, workflowDevices: merged };
          }),
        }));
      },

      registerTaskIdsForTab: (tabId, taskIds) => {

        const incoming = taskIds.map((x) => x.trim()).filter(Boolean);

        if (incoming.length === 0) return;

        set((s) => ({

          tabs: s.tabs.map((t) => {

            if (t.id !== tabId) return t;

            const merged = new Set([...t.taskIds, ...incoming]);

            return { ...t, taskIds: [...merged] };

          }),

        }));

      },



      registerVerifyEntityIdsForTab: (tabId, entityIds) => {

        const incoming = entityIds.map((x) => normalizeVerifyEntityId(x)).filter(Boolean);

        if (incoming.length === 0) return;

        set((s) => ({

          tabs: s.tabs.map((t) => {

            if (t.id !== tabId) return t;

            const merged = new Set([...t.verifyEntityIds, ...incoming]);

            return { ...t, verifyEntityIds: [...merged] };

          }),

        }));

      },



      createWorkflowTab: () => {

        const next = get().workflowCounter + 1;

        const id = `workflow-session-${next}`;

        const tab = emptyTab(id, `会话${next}`, "workflow");

        set((s) => ({

          workflowCounter: next,

          tabs: [...s.tabs, tab],

          activeTabId: id,

        }));

        return id;

      },



      createUserChatTab: () => {

        const next = get().userSessionCounter + 1;

        const id = `user-chat-${next}`;

        const tab = emptyTab(id, `新会话${next}`, "user");

        set((s) => ({

          userSessionCounter: next,

          tabs: [...s.tabs, tab],

          activeTabId: id,

        }));

        return id;

      },



      clearTabContent: (tabId) => {

        set((s) => ({

          tabs: s.tabs.map((t) =>

            t.id === tabId ? { ...emptyTab(t.id, t.title, t.kind) } : t,

          ),

        }));

      },



      deleteTab: (tabId) => {

        const tab = get().tabs.find((t) => t.id === tabId);

        if (!tab || (tab.kind !== "workflow" && tab.kind !== "user")) return false;

        set((s) => ({

          tabs: s.tabs.filter((t) => t.id !== tabId),

          activeTabId: s.activeTabId === tabId ? AI_CHAT_TAB_ID : s.activeTabId,

        }));

        return true;

      },



      /** @deprecated 使用 clearTabContent / deleteTab */

      clearTab: (tabId) => {

        const tab = get().tabs.find((t) => t.id === tabId);

        if (!tab) return;

        if (tab.kind === "workflow" || tab.kind === "user") {

          get().deleteTab(tabId);

        } else {

          get().clearTabContent(tabId);

        }

      },



      clearAllTabs: () => {

        set({

          tabs: defaultTabs(),

          activeTabId: AI_CHAT_TAB_ID,

          workflowCounter: 0,

          userSessionCounter: 0,

        });

      },



      getTabById: (tabId) => get().tabs.find((t) => t.id === tabId),



      resolveTabIdForTaskId: (taskId) => {

        const tid = taskId.trim();

        if (!tid) return null;

        const tabs = get().tabs;

        for (let i = tabs.length - 1; i >= 0; i--) {

          const tab = tabs[i];

          if (tab.kind !== "workflow") continue;

          if (tab.taskIds.some((x) => x === tid)) return tab.id;

        }

        return null;

      },



      resolveOrCreateWorkflowTabForTaskId: (taskId) => {

        const tid = taskId.trim();

        if (!tid) return DUTY_CHAT_TAB_ID;

        const matched = get().resolveTabIdForTaskId(tid);

        if (matched) return matched;

        const newId = get().createWorkflowTab();

        get().registerTaskIdsForTab(newId, [tid]);

        return newId;

      },



      resolveTabIdForVerifyEntityId: (entityId) => {

        const id = normalizeVerifyEntityId(entityId);

        if (!id) return null;

        const tabs = get().tabs;

        const activeId = get().resolveActiveWorkflowVerifyTab();

        if (activeId) {

          const tab = tabs.find((t) => t.id === activeId);

          if (tab?.kind === "workflow" && tab.verifyEntityIds.some((x) => normalizeVerifyEntityId(x) === id)) {

            return activeId;

          }

        }

        for (let i = tabs.length - 1; i >= 0; i--) {

          const tab = tabs[i];

          if (tab.kind !== "workflow") continue;

          if (tab.verifyEntityIds.some((x) => normalizeVerifyEntityId(x) === id)) return tab.id;

        }

        return null;

      },



      setActiveWorkflowVerifyTabId: (tabId) => {

        if (tabId) {

          const tab = get().tabs.find((t) => t.id === tabId);

          if (!tab || tab.kind !== "workflow") return;

        }

        set({ activeWorkflowVerifyTabId: tabId });

      },



      resolveActiveWorkflowVerifyTab: () => {

        const id = get().activeWorkflowVerifyTabId;

        if (!id) return null;

        const tab = get().tabs.find((t) => t.id === id);

        if (!tab || tab.kind !== "workflow") return null;

        return id;

      },



      finishWorkflowVerifyRouting: (tabId) => {

        set((s) => ({

          activeWorkflowVerifyTabId:

            s.activeWorkflowVerifyTabId === tabId ? null : s.activeWorkflowVerifyTabId,

        }));

      },



      resolveLatestWorkflowVerifyTab: () => {

        const tabs = get().tabs;

        for (let i = tabs.length - 1; i >= 0; i--) {

          if (tabs[i].kind === "workflow") return tabs[i].id;

        }

        return null;

      },

    }),

    {

      name: ASSISTANT_CHAT_TABS_STORAGE_KEY,

      storage: createJSONStorage(() =>

        typeof window === "undefined"

          ? {

              getItem: () => null,

              setItem: () => {},

              removeItem: () => {},

            }

          : window.localStorage,

      ),

      partialize: (state) => ({

        tabs: state.tabs,

        activeTabId: state.activeTabId,

        workflowCounter: state.workflowCounter,

        userSessionCounter: state.userSessionCounter,

      }),

      merge: (persisted, current) => {

        const p = (persisted ?? {}) as Partial<

          Pick<State, "tabs" | "activeTabId" | "workflowCounter" | "userSessionCounter">

        >;

        const mergedTabs = mergePersistedTabs(p.tabs, defaultTabs());

        const counters = resolveCountersFromTabs(mergedTabs);

        const activeTabId =

          p.activeTabId && mergedTabs.some((t) => t.id === p.activeTabId)

            ? p.activeTabId

            : current.activeTabId;

        return {

          ...current,

          tabs: mergedTabs,

          activeTabId,

          workflowCounter: Math.max(p.workflowCounter ?? 0, counters.workflowCounter),

          userSessionCounter: Math.max(p.userSessionCounter ?? 0, counters.userSessionCounter),

        };

      },

    },

  ),

);



/** 与 `useState<UIMessage[]>` 兼容 */

export function useAssistantChatTabMessages(tabId: string) {

  const messages = useAssistantChatTabsStore(

    (s) => s.tabs.find((t) => t.id === tabId)?.messages ?? [],

  );

  const patchTabMessages = useAssistantChatTabsStore((s) => s.patchTabMessages);

  const setMessages = (updater: MessagesUpdater) =>

    patchTabMessages(tabId, updater);

  return [messages, setMessages] as const;

}



export function getAssistantChatActiveTabId(): string {

  return useAssistantChatTabsStore.getState().activeTabId;

}



export function resolveAssistantChatTabForTaskId(taskId: string): string {

  const matched = useAssistantChatTabsStore

    .getState()

    .resolveTabIdForTaskId(taskId);

  return matched ?? DUTY_CHAT_TAB_ID;

}



export function resolveAssistantChatTabForVerifyEntityId(entityId: string): string | null {

  return useAssistantChatTabsStore.getState().resolveTabIdForVerifyEntityId(entityId);

}



export function getAssistantLangGraphThreadId(): string {

  const { tabs, activeTabId } = useAssistantChatTabsStore.getState();

  const tab = tabs.find((t) => t.id === activeTabId);

  return tab?.langGraphThreadId.trim() ?? "";

}



/** 与 AI助手 相同交互：可发消息、空状态展示快捷问题 */

export function isAssistantChatLikeTab(

  tab: AssistantChatTab | undefined,

): boolean {

  return tab?.kind === "ai" || tab?.kind === "user";

}

