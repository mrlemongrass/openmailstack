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
  let pendingQuery: string | null = null;

  const cancelPending = () => {
    if (pendingTimer === null) return;
    cancel(pendingTimer);
    pendingTimer = null;
    pendingQuery = null;
  };

  return {
    update(query: string) {
      onQueryChange(query);
      cancelPending();

      if (!query.trim()) {
        onSearch('');
        return;
      }

      pendingQuery = query;
      pendingTimer = schedule(() => {
        const queryToSearch = pendingQuery;
        pendingTimer = null;
        pendingQuery = null;
        if (queryToSearch !== null) onSearch(queryToSearch);
      }, delayMs);
    },
    flush() {
      if (pendingQuery === null) return false;
      const queryToSearch = pendingQuery;
      if (pendingTimer !== null) cancel(pendingTimer);
      pendingTimer = null;
      pendingQuery = null;
      onSearch(queryToSearch);
      return true;
    },
    cancel: cancelPending,
  };
}
