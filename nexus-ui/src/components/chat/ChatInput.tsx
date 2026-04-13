"use client";

import Image from "next/image";
import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Send, Paperclip, X, Image as ImageIcon, Square } from "lucide-react";
import { NxIconButton } from "@/components/nexus";
import type { FileUIPart } from "ai";

interface ChatInputProps {
  onSend: (text: string, files?: FileUIPart[]) => void;
  onStop: () => void;
  isLoading: boolean;
}

export function ChatInput({ onSend, onStop, isLoading }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileUIPart[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setInput("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, attachments, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading) handleSend();
    }
  };

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
    e.target.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  };

  return (
    <div className="border-t border-white/[0.06] p-2.5">
      {/* 附件预览 */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((att, i) => (
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
                onClick={() => removeAttachment(i)}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-nexus-bg-elevated text-nexus-text-muted hover:text-nexus-text-primary"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 输入区 */}
      <div className="flex items-end gap-1.5">
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

        {isLoading ? (
          <button
            onClick={onStop}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-red-500/30 bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20"
            title="停止生成"
          >
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button
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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
