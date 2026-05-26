/**
 * 浏览器原生 speechSynthesis 告警播报（队列、去重由调用方按 alarm_id 控制）。
 */

import { buildAlarmSpeechText } from "@/lib/alarm-speech-text";
import type { Track } from "@/lib/map-entity-model";
import type { AlertData } from "@/stores/alert-store";

const spokenAlarmIds = new Set<string>();
let queue: string[] = [];
let speaking = false;
let unlocked = false;

function isSpeechEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const flag = process.env.NEXT_PUBLIC_ALARM_SPEECH_ENABLED;
  if (flag === "false" || flag === "0") return false;
  return typeof window.speechSynthesis !== "undefined";
}

/** 首次用户交互后解锁自动播放策略 */
export function unlockAlarmSpeech(): void {
  if (unlocked || typeof window === "undefined" || !window.speechSynthesis) return;
  unlocked = true;
  try {
    window.speechSynthesis.resume();
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    u.lang = "zh-CN";
    window.speechSynthesis.speak(u);
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

function pumpQueue(): void {
  if (!isSpeechEnabled() || speaking || queue.length === 0) return;
  const text = queue.shift();
  if (!text) return;

  speaking = true;
  const synth = window.speechSynthesis;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "zh-CN";
  utter.rate = 1;
  utter.volume = 1;

  const done = () => {
    speaking = false;
    pumpQueue();
  };
  utter.onend = done;
  utter.onerror = done;

  synth.speak(utter);
}

function enqueueSpeech(text: string): void {
  if (!isSpeechEnabled() || !text.trim()) return;
  queue.push(text.trim());
  pumpQueue();
}

/** 页面加载时已存在的告警 id，避免刷新后重复播报 */
export function seedSpokenAlarmIds(alarmIds: Iterable<string>): void {
  for (const id of alarmIds) {
    const t = id.trim();
    if (t) spokenAlarmIds.add(t);
  }
}

/**
 * 按 alarm_id（AlertData.id）仅播报一次；返回是否已入队。
 */
export function announceAlarmOnce(alert: AlertData, tracks: readonly Track[]): boolean {
  const alarmId = alert.id.trim();
  if (!alarmId || spokenAlarmIds.has(alarmId)) return false;
  spokenAlarmIds.add(alarmId);

  const text = buildAlarmSpeechText(alert, tracks);
  enqueueSpeech(text);
  return true;
}

/** 测试或重置（一般不在业务中调用） */
export function resetAlarmSpeechStateForTests(): void {
  spokenAlarmIds.clear();
  queue = [];
  speaking = false;
  unlocked = false;
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
