/**
 * 航迹渲染性能插桩（轻量、默认低噪声）。
 *
 * 用途：定位「打开某图层后所有航迹闪烁」这类主线程长任务卡顿。
 * - 各热路径调用 `markTrackPhase(name, ...)` 记录「当前正在做什么」；
 * - `installTrackJankObserver()` 用 PerformanceObserver('longtask') 捕获 >阈值 的长任务，
 *   打印发生时最近的相位标记，直接把「卡顿」归因到具体代码段。
 *
 * 生产可留存：仅在超过 `JANK_THRESHOLD_MS` 时打印，正常运行几乎无输出、无额外开销。
 */

const JANK_THRESHOLD_MS = 80;

type TrackPhase = { name: string; info: string; at: number };

const g = globalThis as unknown as {
  __tkPhase?: TrackPhase;
  __tkJankInstalled?: boolean;
  /** 控制台可运行时下调阈值：`globalThis.__tkJankMs = 50`（longtask 规范下限 50ms） */
  __tkJankMs?: number;
};

/** 标记当前热路径（供 longtask 归因）。info 建议带上处理条数等关键量。 */
export function markTrackPhase(name: string, info: string = ""): void {
  g.__tkPhase = { name, info, at: performance.now() };
}

/** 注册长任务观测；重复调用安全（仅装一次）。仅浏览器环境生效。 */
export function installTrackJankObserver(): void {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
  if (g.__tkJankInstalled) return;
  g.__tkJankInstalled = true;
  try {
    const obs = new PerformanceObserver((list) => {
      const threshold = g.__tkJankMs ?? JANK_THRESHOLD_MS;
      for (const entry of list.getEntries()) {
        if (entry.duration < threshold) continue;
        const ph = g.__tkPhase;
        const near = ph && performance.now() - ph.at < 1000 ? `${ph.name}(${ph.info})` : "?";
        // eslint-disable-next-line no-console
        console.warn(
          `[jank] ${entry.duration.toFixed(0)}ms 长任务 · 最近相位=${near}`,
        );
      }
    });
    obs.observe({ entryTypes: ["longtask"] });
  } catch {
    /* 某些浏览器不支持 longtask，忽略 */
  }
}
