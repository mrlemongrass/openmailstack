export interface DraftIdentity {
  draftId: string | null;
  draftUid: string | null;
}

export interface DraftSaveResult {
  draftId?: string;
  draftUid?: string;
}

export interface DraftSaveCoordinator {
  enqueue<T extends DraftSaveResult>(save: (identity: DraftIdentity) => Promise<T>): Promise<T>;
  flush(): Promise<DraftIdentity>;
  reset(identity?: DraftIdentity): void;
}

/**
 * Serializes append-first draft replacements so every save sees the UID and
 * stable draft identity produced by the previous save.
 */
export function createDraftSaveCoordinator(): DraftSaveCoordinator {
  let identity: DraftIdentity = { draftId: null, draftUid: null };
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<T extends DraftSaveResult>(save: (current: DraftIdentity) => Promise<T>): Promise<T> {
      const operation = tail.then(async () => {
        const result = await save({ ...identity });
        identity = {
          draftId: result.draftId || identity.draftId,
          draftUid: result.draftUid || identity.draftUid,
        };
        return result;
      });
      tail = operation.then(() => undefined, () => undefined);
      return operation;
    },

    async flush(): Promise<DraftIdentity> {
      await tail;
      return { ...identity };
    },

    reset(initialIdentity: DraftIdentity = { draftId: null, draftUid: null }): void {
      identity = { ...initialIdentity };
    },
  };
}
