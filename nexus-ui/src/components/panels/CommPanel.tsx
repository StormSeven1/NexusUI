"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Send,
  Radio,
  Lock,
  Volume2,
  VolumeX,
  ChevronDown,
  Circle,
  ShieldCheck,
  Hash,
} from "lucide-react";
import {
  NxPanelHeader,
  NxIconButton,
  NxBadge,
  NxButton,
  NxInput,
} from "@/components/nexus";

interface Channel {
  id: string;
  name: string;
  type: "command" | "tactical" | "support" | "broadcast";
  encrypted: boolean;
  unread: number;
  online: number;
}

interface Message {
  id: string;
  sender: string;
  callsign: string;
  content: string;
  timestamp: string;
  channel: string;
  priority: "normal" | "urgent" | "flash";
}

const CHANNELS: Channel[] = [
  { id: "ch-cmd", name: "指挥频道", type: "command", encrypted: true, unread: 2, online: 5 },
  { id: "ch-tac1", name: "战术一组", type: "tactical", encrypted: true, unread: 0, online: 8 },
  { id: "ch-tac2", name: "战术二组", type: "tactical", encrypted: true, unread: 1, online: 6 },
  { id: "ch-sup", name: "保障频道", type: "support", encrypted: false, unread: 0, online: 12 },
  { id: "ch-bc", name: "全局广播", type: "broadcast", encrypted: false, unread: 0, online: 31 },
];

const MESSAGES: Message[] = [
  { id: "m1", sender: "指挥中心", callsign: "HQ", content: "所有单位注意，敌方空中目标 TRK-001 已进入限制区域，启动二级响应", timestamp: "14:02:41", channel: "ch-cmd", priority: "urgent" },
  { id: "m2", sender: "雷达站 Alpha", callsign: "RADAR-A", content: "确认探测到 TRK-001，方位 185°，距离 42km，速度 420kn", timestamp: "14:02:39", channel: "ch-cmd", priority: "normal" },
  { id: "m3", sender: "空中巡逻", callsign: "AIR-PATROL-3", content: "收到，正在调整航向前往 TRK-001 预计航路前方拦截点", timestamp: "14:02:35", channel: "ch-cmd", priority: "normal" },
  { id: "m4", sender: "水下监视", callsign: "SONAR-B", content: "TRK-004 持续向东北机动，已接近警戒水域 200m", timestamp: "14:02:33", channel: "ch-tac1", priority: "urgent" },
  { id: "m5", sender: "海岸监视", callsign: "COAST-1", content: "TRK-006 航向偏移已确认，可能受海流影响", timestamp: "14:01:50", channel: "ch-tac2", priority: "normal" },
  { id: "m6", sender: "指挥中心", callsign: "HQ", content: "各站注意：0200Z 起执行新频率跳变计划 DELTA-7", timestamp: "14:01:20", channel: "ch-bc", priority: "flash" },
  { id: "m7", sender: "保障组", callsign: "LOG-3", content: "雷达 Charlie 维修备件已到位，预计 30 分钟完成更换", timestamp: "14:00:45", channel: "ch-sup", priority: "normal" },
  { id: "m8", sender: "空中巡逻", callsign: "AIR-PATROL-1", content: "TRK-005 护航任务完成，返回基地，预计 15 分钟降落", timestamp: "14:00:30", channel: "ch-tac1", priority: "normal" },
];

const CHANNEL_COLORS = {
  command: "border-l-red-400",
  tactical: "border-l-amber-400",
  support: "border-l-emerald-400",
  broadcast: "border-l-zinc-400",
};

const PRIORITY_STYLES = {
  flash: "bg-red-500/10 border-red-500/30",
  urgent: "bg-amber-500/5 border-white/[0.06]",
  normal: "border-white/[0.04]",
};

export function CommPanel() {
  const [activeChannel, setActiveChannel] = useState("ch-cmd");
  const [inputValue, setInputValue] = useState("");
  const [muted, setMuted] = useState(false);
  const [showChannels, setShowChannels] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const filteredMessages = MESSAGES.filter((m) => m.channel === activeChannel);
  const activeChannelData = CHANNELS.find((c) => c.id === activeChannel)!;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChannel]);

  return (
    <div className="flex h-full flex-col">
      <NxPanelHeader
        title="通信中心"
        right={
          <div className="flex items-center gap-1">
            <NxIconButton size="xs" onClick={() => setMuted(!muted)}>
              {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </NxIconButton>
            <NxIconButton size="xs" onClick={() => setShowChannels(!showChannels)}>
              <ChevronDown size={12} className={cn("transition-transform", showChannels && "rotate-180")} />
            </NxIconButton>
          </div>
        }
      />

      {/* 频道列表 */}
      {showChannels && (
        <div className="border-b border-white/[0.06]">
          {CHANNELS.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setActiveChannel(ch.id)}
              className={cn(
                "flex w-full items-center gap-2.5 border-l-2 px-3 py-2 text-left transition-colors",
                CHANNEL_COLORS[ch.type],
                activeChannel === ch.id ? "bg-white/[0.06]" : "hover:bg-white/[0.02]"
              )}
            >
              <Hash size={12} className="shrink-0 text-nexus-text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={cn("truncate text-[11px] font-medium", activeChannel === ch.id ? "text-nexus-text-primary" : "text-nexus-text-secondary")}>
                    {ch.name}
                  </span>
                  {ch.encrypted && <Lock size={9} className="shrink-0 text-nexus-text-muted" />}
                </div>
                <span className="text-[10px] text-nexus-text-muted">{ch.online} 在线</span>
              </div>
              {ch.unread > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {ch.unread}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 当前频道状态 */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
        <Radio size={10} className="text-nexus-text-muted" />
        <span className="text-[10px] font-medium text-nexus-text-secondary">{activeChannelData.name}</span>
        {activeChannelData.encrypted && (
          <NxBadge variant="success"><ShieldCheck size={9} /> 加密</NxBadge>
        )}
        <span className="ml-auto text-[10px] text-nexus-text-muted">{activeChannelData.online} 人在线</span>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto space-y-2 px-3 py-2">
        {filteredMessages.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-nexus-text-muted">暂无消息</div>
        )}
        {filteredMessages.map((msg) => (
          <div key={msg.id} className={cn("rounded-md border p-2.5", PRIORITY_STYLES[msg.priority])}>
            <div className="flex items-center gap-2">
              <span className="flex h-5 items-center rounded bg-white/[0.06] px-1.5 font-mono text-[9px] font-bold text-nexus-text-secondary">
                {msg.callsign}
              </span>
              <span className="text-[10px] text-nexus-text-muted">{msg.sender}</span>
              <span className="ml-auto font-mono text-[10px] text-nexus-text-muted">{msg.timestamp}</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-nexus-text-primary">{msg.content}</p>
            {msg.priority === "flash" && (
              <NxBadge variant="danger" className="mt-1"><Circle size={6} fill="currentColor" /> 紧急通播</NxBadge>
            )}
            {msg.priority === "urgent" && (
              <NxBadge variant="warning" className="mt-1">加急</NxBadge>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-2">
          <NxInput
            sizeVariant="md"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={`发送至 ${activeChannelData.name}...`}
            onKeyDown={(e) => e.key === "Enter" && setInputValue("")}
          />
          <NxButton variant="primary" size="md" icon={<Send size={13} />} onClick={() => setInputValue("")} />
        </div>
      </div>
    </div>
  );
}
