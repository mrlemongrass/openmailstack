export interface ComposePreparationCoordinator {
  begin(): number;
  isCurrent(intent: number): boolean;
  claim(intent: number): boolean;
  invalidate(): void;
}

export function createComposePreparationCoordinator(): ComposePreparationCoordinator {
  let currentIntent = 0;
  return {
    begin() {
      currentIntent += 1;
      return currentIntent;
    },
    isCurrent(intent) {
      return intent === currentIntent;
    },
    claim(intent) {
      if (intent !== currentIntent) return false;
      currentIntent += 1;
      return true;
    },
    invalidate() {
      currentIntent += 1;
    },
  };
}
