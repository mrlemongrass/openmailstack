interface ReadDelayScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(id: unknown): void;
}

/** Schedule a read-state update and return the navigation/unmount cancellation. */
export function scheduleDelayedMarkRead(
  delaySeconds: number,
  markRead: () => void,
  scheduler: ReadDelayScheduler = {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: id => window.clearTimeout(id as number),
  },
): () => void {
  const delayMs = Math.max(0, Number.isFinite(delaySeconds) ? delaySeconds * 1000 : 0);
  let active = true;

  if (delayMs === 0) {
    markRead();
    return () => { active = false; };
  }

  const timer = scheduler.setTimeout(() => {
    if (!active) return;
    active = false;
    markRead();
  }, delayMs);

  return () => {
    if (!active) return;
    active = false;
    scheduler.clearTimeout(timer);
  };
}
