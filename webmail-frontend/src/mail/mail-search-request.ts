export function createMailSearchRequestCoordinator() {
  let active: AbortController | null = null;

  return {
    begin() {
      active?.abort();
      active = new AbortController();
      return active;
    },
    complete(controller: AbortController) {
      if (active === controller) active = null;
    },
    cancel() {
      active?.abort();
      active = null;
    },
  };
}

export function isMailSearchAbort(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}
