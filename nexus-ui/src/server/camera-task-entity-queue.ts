const entityChains = new Map<string, Promise<void>>();

/** 同一 entity 的 PTZ move/stop 在 BFF 侧严格串行，避免并发 fetch 乱序 */
export function withCameraTaskEntityLock<T>(entityId: string, fn: () => Promise<T>): Promise<T> {
  const key = entityId.trim().toLowerCase();
  const prev = entityChains.get(key) ?? Promise.resolve();
  const run = prev.then(() => fn(), () => fn());
  entityChains.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
