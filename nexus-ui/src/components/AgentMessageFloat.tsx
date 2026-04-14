"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

interface FloatingPosition {
  x: number;
  y: number;
}

// 智能体配置
const AGENT_CONFIG = {
  core: {
    name: "核心智能体",
    icon: "C",
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
    borderColor: "border-blue-400/30"
  },
  data: {
    name: "数据智能体",
    icon: "D",
    color: "text-green-400",
    bgColor: "bg-green-400/10",
    borderColor: "border-green-400/30"
  },
  tactical: {
    name: "战术规划",
    icon: "T",
    color: "text-orange-400",
    bgColor: "bg-orange-400/10",
    borderColor: "border-orange-400/30"
  },
  analysis: {
    name: "评估分析",
    icon: "A",
    color: "text-purple-400",
    bgColor: "bg-purple-400/10",
    borderColor: "border-purple-400/30"
  }
};

export function AgentMessageFloat() {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isHidden, setIsHidden] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const { rightSidebarOpen } = useAppStore();
  const [manualPosition, setManualPosition] = useState<FloatingPosition | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const {
    agentMessages,
    markAgentMessageAsRead,
    addAgentMessage,
    setSelectedAgentMessage,
    rightPanelTab,
    setRightPanelTab
  } = useAppStore();
  const statusBarHeight = 32;
  const rightSidebarWidth = rightSidebarOpen ? 440 : 48;

  // 将 store 的消息转换为适合展示的格式
  const displayMessages = agentMessages.map(msg => ({
    id: msg.id,
    agentType: msg.agentType,
    title: msg.title,
    subtitle: msg.content,
    timestamp: msg.timestamp,
    read: msg.read
  }));

  const unreadCount = displayMessages.filter(m => !m.read).length;

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // 拖动功能
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (headerRef.current && headerRef.current.contains(e.target as Node) && containerRef.current) {
        const { left, top } = containerRef.current.getBoundingClientRect();
        setIsDragging(true);
        setDragOffset({
          x: e.clientX - left,
          y: e.clientY - top
        });
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setManualPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // 发送示例消息
  useEffect(() => {
    // 如果没有消息，发送一些示例消息
    if (agentMessages.length === 0) {
      const sampleMessages = [
        {
          agentType: "core" as const,
          agentName: "核心智能体",
          title: "正在推演态势",
          content: "正在分析目标T-17的运动轨迹，预计15秒后完成推演计算",
          status: "info" as const,
          read: false
        },
        {
          agentType: "tactical" as const,
          agentName: "战术规划",
          title: "正在生成战术方案",
          content: "正在为区域A-03分析地形数据，准备生成3套备选战术方案",
          status: "warning" as const,
          read: false
        },
        {
          agentType: "data" as const,
          agentName: "数据智能体",
          title: "正在同步数据",
          content: "正在处理卫星影像数据，已完成45%，预计2分钟后完成",
          status: "info" as const,
          read: false
        }
      ];

      // 延迟发送消息，模拟实时效果
      sampleMessages.forEach((msg, index) => {
        setTimeout(() => {
          addAgentMessage({
            agentType: msg.agentType,
            agentName: msg.agentName,
            title: msg.title,
            content: msg.content,
            status: msg.status,
            read: msg.read
          });
        }, index * 2000);
      });
    }
  }, [agentMessages.length, addAgentMessage]);

  if (isHidden) {
    return (
      <button
        type="button"
        onClick={() => setIsHidden(false)}
        className="fixed z-50 rounded-md border border-nexus-border bg-nexus-bg-elevated px-3 py-2 text-xs text-nexus-text-secondary hover:text-nexus-text-primary"
        style={
          manualPosition
            ? { left: `${manualPosition.x}px`, top: `${manualPosition.y + 252}px` }
            : { right: `${rightSidebarWidth}px`, bottom: `${statusBarHeight + 252}px` }
        }
      >
        打开智能体行为
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed z-50 flex flex-col transition-all duration-200",
        isDragging ? "shadow-2xl" : ""
      )}
      style={
        manualPosition
          ? {
              left: `${manualPosition.x}px`,
              top: `${manualPosition.y}px`,
              transform: isDragging ? 'scale(1.02)' : 'none'
            }
          : {
              right: `${rightSidebarWidth}px`,
              bottom: `${statusBarHeight}px`,
              transform: isDragging ? 'scale(1.02)' : 'none'
            }
      }
    >
      {/* 标题栏 */}
      <div
        ref={headerRef}
        className={cn(
          "nexus-glass border border-nexus-border p-3 cursor-move hover:bg-nexus-bg-elevated transition-colors",
          isExpanded ? "rounded-t-lg" : "rounded-lg"
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-nexus-text-primary">
              智能体行为
            </h3>
            {unreadCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-nexus-accent text-[10px] font-bold text-nexus-text-inverse">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-6 w-6 rounded-md hover:bg-nexus-bg-elevated transition-colors flex items-center justify-center"
            >
              {isExpanded ? (
                <span className="text-lg">−</span>
              ) : (
                <span className="text-lg">+</span>
              )}
            </button>
            <button
              onClick={() => {
                setManualPosition(null);
                setIsHidden(false);
              }}
              className="h-6 w-6 rounded-md hover:bg-nexus-bg-elevated transition-colors flex items-center justify-center"
            >
              <span className="text-sm">↻</span>
            </button>
            <button
              onClick={() => setIsHidden(true)}
              className="h-6 w-6 rounded-md hover:bg-nexus-bg-elevated transition-colors flex items-center justify-center"
            >
              <span className="text-lg">×</span>
            </button>
          </div>
        </div>
      </div>

      {/* 展开后的消息列表 */}
      {isExpanded && (
        <div className="nexus-glass border border-t-0 border-nexus-border max-h-64 overflow-y-auto">
          {displayMessages.map((message) => {
            const config = AGENT_CONFIG[message.agentType];
            const unread = !message.read;
            const originalMessage = agentMessages.find(m => m.id === message.id);

            return (
              <div
                key={message.id}
                className={cn(
                  "border-b border-nexus-border last:border-b-0 px-2 py-1.5 cursor-pointer transition-all hover:bg-nexus-bg-elevated",
                  unread && "bg-nexus-accent-glow/10"
                )}
                onClick={() => {
                  markAgentMessageAsRead(message.id);
                  if (originalMessage) {
                    setSelectedAgentMessage(originalMessage);
                    // 如果右侧面板未打开或未在AI助手页面，就切换到AI助手面板
                    if (!rightSidebarOpen || rightPanelTab !== "chat") {
                      setRightPanelTab("chat");
                    }
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  {/* 智能体图标 */}
                  <div className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold shrink-0",
                    config.bgColor,
                    config.borderColor,
                    "border"
                  )}>
                    {config.icon}
                  </div>

                  {/* 智能体名称 */}
                  <span className={cn(
                    "text-xs font-medium truncate shrink-0",
                    unread ? "text-nexus-text-primary" : "text-nexus-text-secondary"
                  )}>
                    {config.name}
                  </span>

                  {/* 消息标题 */}
                  <span className={cn(
                    "text-xs truncate flex-1 min-w-0",
                    unread ? "text-nexus-text-primary" : "text-nexus-text-muted"
                  )}>
                    {message.title}
                  </span>

                  {/* 时间 */}
                  <span className="text-[10px] text-nexus-text-muted shrink-0 ml-2">
                    {formatTime(message.timestamp)}
                  </span>

                  {/* 未读标记 */}
                  {unread && (
                    <span className="h-1.5 w-1.5 rounded-full bg-nexus-accent animate-pulse shrink-0" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
