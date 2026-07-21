interface MailSearchInputControllerOptions {
  delayMs?: number;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (timer: unknown) => void;
}

export function createMailSearchInputController({
  delayMs = 300,
  onQueryChange,
  onSearch,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
}: MailSearchInputControllerOptions) {
  let pendingTimer: unknown = null;

  const cancelPending = () => {
    if (pendingTimer === null) return;
    cancel(pendingTimer);
    pendingTimer = null;
  };

  return {
    update(query: string) {
      onQueryChange(query);
      cancelPending();

      if (!query.trim()) {
        onSearch('');
        return;
      }

      pendingTimer = schedule(() => {
        pendingTimer = null;
        onSearch(query);
      }, delayMs);
    },
    cancel: cancelPending,
  };
}
