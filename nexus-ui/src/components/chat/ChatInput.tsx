/**
 * ============================================================================
 * ChatInput.tsx — 新手向说明（本文件只做「输入与发送 UI」，不直接发 HTTP）
 * ============================================================================
 *
 * 【这个组件在 React 树里的位置】
 * 父组件：src/components/panels/ChatPanel.tsx
 * 父组件这样用你：
 *   <ChatInput onSend={handleSend} onStop={stop} isLoading={isLoading} />
 * 也就是说：下面三个「从哪儿来」全是 ChatPanel 传进来的 props（类似 Vue 的父传子 props）。
 *
 * 【点「发送」之后请求真正怎么走？（和本文件的关系）】
 * 1) 你在本组件里调用 onSend(文字, 附件) —— 只是调用「父组件给的函数」。
 * 2) ChatPanel 里的 handleSend 会调用 AI SDK 的 sendMessage(...)。
 * 3) sendMessage 通过 DefaultChatTransport 向「同源的」地址 POST：/api/chat
 *    （浏览器地址栏是 localhost:3000 时，就是 http://localhost:3000/api/chat）。
 * 4) Next.js 在服务端执行 src/app/api/chat/route.ts 里的 POST：
 *    里面再用 fetch(process.env.BACKEND_URL ?? 'http://localhost:8001/api/chat') 转发到 FastAPI。
 * 所以：**聊天并不是在 next.config.ts 的 rewrites 里配的**；那是另一条线（/api/backend → 8001，给会话列表等用）。
 *
 * 【和 Vue 里 vue.config.js / vite.config.js 的 devServer.proxy 对比】
 * - Vue 常见写法：把 /api 代理到 http://localhost:8001，浏览器以为请求还在「前端开发服务器」上。
 * - 本仓库聊天：浏览器请求的是 **Next 自己的路由** `/api/chat`，由 **一段 TS 代码（route.ts）** 在 Node 里转发。
 *   效果上都是「前端端口收请求，再转到后端」，但 Next 这边是 **文件约定 + 手写 fetch**，不是 devServer 里那一行 proxy 配置。
 *
 * 【改 Next 聊天路由路径时（与 ChatPanel 里 `api: "..."` 同步）】
 * - 若把目录 `src/app/api/chat/` 改名为 `src/app/api/XXX/`，对外路径变为 `/api/XXX`，
 *   则 **ChatPanel.tsx 里 DefaultChatTransport 的 `api` 必须改成 `/api/XXX`**（本文件不写该字符串，改父组件即可）。
 * - 全文搜索 `/api/chat`，检查 README、测试、其它引用。
 * - 浏览器访问 Next 的 path（`/api/chat` 或 `/api/XXX`）与 `route.ts` 里 `fetch(BACKEND_URL + ...)` 打 Python 的路径
 *   **可以不同**；只改前端文件夹时，`route.ts` 里仍可继续请求 `.../api/chat` 除非你也改 FastAPI 路由。
 *
 * 【React 和 Vue 的快速对照（读本文件时）】
 * - useState：类似 ref 包一层 + 变了会触发重渲染（不要和 Vue 的 reactive 对象完全等同，但可先这样理解）。
 * - useRef：保存「不触发重渲染」的可变盒子；这里用来拿真实 DOM（textarea / file input）。
 * - useCallback：缓存函数引用；依赖数组里的值变了，才得到新的函数引用（常用于子组件 memo 或作为其他 hook 依赖）。
 * - props：父传子只读；要「往上传事件」在 React 里习惯用「父传一个函数下来子组件调用」，等价于 Vue 的 emit 回调。
 */

"use client";
// ↑ Next.js 专用：声明此文件在「客户端」运行，才能用浏览器 API、useState、点击事件等。
//   没有这一行时，部分代码只能跑在服务器，会报错。

import Image from "next/image";
// Next 的图片组件；下面附件预览用 data URL 时加了 unoptimized。

import { useState, useRef, useCallback } from "react";
// useState：组件内会变的局部状态。
// useRef：跨渲染保存同一个对象（常用：DOM 引用、定时器 id）。
// useCallback：返回「记忆化」的函数，避免每次渲染都新建函数（见 handleSend 注释）。

import { cn } from "@/lib/utils";
// 小工具：把多个 class 名安全拼在一起（类似 clsx + tailwind-merge）。

import { Send, Paperclip, X, Image as ImageIcon, Square } from "lucide-react";
// 图标库；Image 和 next/image 重名，所以起别名 ImageIcon。

import { NxIconButton } from "@/components/nexus";
import type { FileUIPart } from "ai";
// AI SDK（Vercel ai）约定的「消息里的一块：文件」结构，供父组件塞进 sendMessage 的 parts。

/** 父组件 ChatPanel 传入的约定；本组件不负责实现「发到哪儿」，只负责调用这三个入参。 */
interface ChatInputProps {
  /** 来自 ChatPanel.handleSend：内部会调 useChat 的 sendMessage，最终 POST /api/chat */
  onSend: (text: string, files?: FileUIPart[]) => void;
  /** 来自 ChatPanel 里 useChat() 返回的 stop：中断流式生成 */
  onStop: () => void;
  /** 来自 ChatPanel：status 为 submitted/streaming 时为 true，用来切换「停止」按钮与禁用 Enter 发送 */
  isLoading: boolean;
}

export function ChatInput({ onSend, onStop, isLoading }: ChatInputProps) {
  // —— 下面两个是「受控输入」状态：UI 显示的值完全由 state 决定，类似 Vue v-model 拆开写 ——

  /** 文本框里的字；初始 ""；用户每敲一个字就会 setInput 更新这里 */
  const [input, setInput] = useState("");

  /** 已选中的待发送附件列表；点发送后会随文字一起交给父组件 */
  const [attachments, setAttachments] = useState<FileUIPart[]>([]);

  // —— ref：存 DOM 节点，修改它们不会自动触发重渲染（和 setState 不同）——

  /** 绑定到下方 <textarea ref={textareaRef}>；用来在发送后把高度重置为 auto */
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** 绑定到隐藏的 <input type="file">；用代码 .click() 代替用户直接点到 file 控件 */
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * 点击发送按钮或 Enter 时执行。
   * useCallback 依赖：[input, attachments, onSend]
   * - 任一变了，会重新创建 handleSend（保证闭包里读到最新 input/attachments）。
   * - 父组件若稳定传入 onSend，可减少无谓重建（一般 ChatPanel 里 useCallback 包了 onSend）。
   */
  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    // 既没有字也没有附件：不发
    if (!trimmed && attachments.length === 0) return;
    // 交给父组件：父组件里才会 sendMessage → /api/chat → route.ts → FastAPI
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    // 本地清空输入区（父组件会自己往消息列表里追加用户消息，不依赖这里再 set 一次 messages）
    setInput("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, attachments, onSend]);

  /**
   * 键盘事件：Enter 发送、Shift+Enter 换行（常见 IM 行为）。
   * 不是 useCallback：每次渲染新建函数也没关系，因为只绑在 textarea 上，开销可忽略。
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault(); // 阻止浏览器默认「换行」
      if (!isLoading) handleSend(); // 生成中不允许用 Enter 再发一条
    }
  };

  /**
   * 用户从文件选择器选完文件后触发（原生 input onChange）。
   * 把每个 File 读成 data URL，组装成 AI SDK 的 FileUIPart，追加到 attachments。
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: FileUIPart[] = [];
    for (const file of Array.from(files)) {
      const dataUrl = await fileToDataUrl(file);
      newAttachments.push({
        type: "file",
        mediaType: file.type,
        filename: file.name,
        url: dataUrl,
      });
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
    // 清空 input 的 value，否则用户连续两次选「同一个文件」时浏览器不触发 change
    e.target.value = "";
  };

  /** 附件预览上的小叉：按索引从 attachments 里删掉一项 */
  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  /**
   * textarea 的 onChange：同步文字到 state + 根据内容高度自动撑高输入框（最多 120px）。
   * 受控组件三件套：value={input} + onChange 里 setInput + 这里读 e.target.value。
   */
  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  };

  return (
    <div className="border-t border-white/[0.06] p-2.5">
      {/* ---------- 附件预览区：有 attachments 才渲染 ---------- */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((att, i) => (
            // key：React 列表diff用；这里用索引 i，仅附件顺序稳定时可接受
            <div key={i} className="group relative">
              {att.mediaType.startsWith("image/") ? (
                <Image
                  src={att.url}
                  alt={att.filename ?? "attachment preview"}
                  width={48}
                  height={48}
                  unoptimized
                  className="h-12 w-12 rounded-md border border-white/[0.06] object-cover"
                />
              ) : (
                <div className="flex h-12 items-center rounded-md border border-white/[0.06] bg-white/[0.03] px-2">
                  <ImageIcon size={12} className="mr-1 text-nexus-text-muted" />
                  <span className="max-w-[80px] truncate text-[10px] text-nexus-text-secondary">
                    {att.filename}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-nexus-bg-elevated text-nexus-text-muted hover:text-nexus-text-primary"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ---------- 主输入行：回形针 | 隐藏 file | textarea | 发送或停止 ---------- */}
      <div className="flex items-end gap-1.5">
        {/* 点击后 programmatically 触发隐藏 file input 的点击 */}
        <NxIconButton
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          title="上传文件"
        >
          <Paperclip size={14} />
        </NxIconButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.txt,.json,.csv"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />

        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleTextareaInput}
          onKeyDown={handleKeyDown}
          placeholder="输入指令..."
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-md border border-white/[0.06] bg-white/[0.03]",
            "px-2.5 py-1.5 text-[11px] leading-relaxed text-nexus-text-primary",
            "placeholder:text-nexus-text-muted",
            "focus:border-white/[0.12] focus:outline-none focus:ring-1 focus:ring-white/[0.08]",
            "transition-colors"
          )}
          style={{ minHeight: 32, maxHeight: 120 }}
        />

        {/* 流式生成中：显示停止按钮，逻辑在父组件的 onStop（即 useChat 的 stop） */}
        {isLoading ? (
          <button
            type="button"
            onClick={onStop}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-red-500/30 bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20"
            title="停止生成"
          >
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() && attachments.length === 0}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
              input.trim() || attachments.length > 0
                ? "border border-sky-500/30 bg-sky-500/15 text-sky-400 hover:bg-sky-500/25"
                : "border border-white/[0.06] bg-white/[0.03] text-nexus-text-muted"
            )}
            title="发送"
          >
            <Send size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 浏览器 API：把用户选的 File 读成 data:...;base64,... 字符串，
 * 便于作为 FileUIPart.url 塞进消息（无需先上传到你们自己的文件服务器）。
 * 纯函数、不依赖 React；放在组件外避免每次渲染重新创建函数定义。
 */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
