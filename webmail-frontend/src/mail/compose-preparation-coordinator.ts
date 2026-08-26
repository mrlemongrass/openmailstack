export interface ComposePreparationCoordinator {
  begin(): number;
  signal(intent: number): AbortSignal;
  isCurrent(intent: number): boolean;
  claim(intent: number): boolean;
  invalidate(): void;
}

export function createComposePreparationCoordinator(): ComposePreparationCoordinator {
  let currentIntent = 0;
  let activePreparation = new AbortController();
  return {
    begin() {
      activePreparation.abort();
      activePreparation = new AbortController();
      currentIntent += 1;
      return currentIntent;
    },
    signal(intent) {
      if (intent === currentIntent) return activePreparation.signal;
      const superseded = new AbortController();
      superseded.abort();
      return superseded.signal;
    },
    isCurrent(intent) {
      return intent === currentIntent;
    },
    claim(intent) {
      if (intent !== currentIntent) return false;
      activePreparation.abort();
      currentIntent += 1;
      return true;
    },
    invalidate() {
      activePreparation.abort();
      activePreparation = new AbortController();
      currentIntent += 1;
    },
  };
}
