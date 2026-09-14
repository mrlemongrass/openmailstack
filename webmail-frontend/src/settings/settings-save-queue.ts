// Keep the latest edit per namespace until the server acknowledges it. Writes
// are serialized so an older request cannot overwrite a newer preference.
export function createSettingsSaveQueue() {
  const pending = new Map<string, () => Promise<unknown>>();
  let running: Promise<void> | null = null;
  return {
    schedule(key: string, save: () => Promise<unknown>) { pending.set(key, save); },
    get pending() { return pending.size > 0; },
    flush(): Promise<void> {
      if (running) return running;
      running = (async () => {
        while (pending.size) {
          const [key, save] = pending.entries().next().value!;
          await save();
          if (pending.get(key) === save) pending.delete(key);
        }
      })().finally(() => { running = null; });
      return running;
    },
  };
}
