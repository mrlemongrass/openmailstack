export interface DraftIdentity {
  draftId: string | null;
  draftUid: string | null;
  draftFolder?: string;
}

export interface DraftSaveResult {
  draftId?: string;
  draftUid?: string;
  draftFolder?: string;
}

export interface DraftSaveCoordinator {
  enqueue<T extends DraftSaveResult>(save: (identity: DraftIdentity) => Promise<T>): Promise<T>;
  flush(): Promise<DraftIdentity>;
  discard(remove: (identity: DraftIdentity) => Promise<void>): Promise<void>;
  reset(identity?: DraftIdentity): void;
}

/**
 * Serializes append-first draft replacements so every save sees the UID and
 * stable draft identity produced by the previous save.
 */
export function createDraftSaveCoordinator(): DraftSaveCoordinator {
  let identity: DraftIdentity = { draftId: null, draftUid: null };
  let tail: Promise<void> = Promise.resolve();
  let discarding = false;
  let saveFailed = false;

  return {
    enqueue<T extends DraftSaveResult>(save: (current: DraftIdentity) => Promise<T>): Promise<T> {
      if (discarding) return Promise.reject(new Error('Draft discard is in progress.'));
      const operation = tail.then(async () => {
        const result = await save({ ...identity });
        identity = {
          draftId: result.draftId || identity.draftId,
          draftUid: result.draftUid || identity.draftUid,
          ...((result.draftFolder || identity.draftFolder) ? { draftFolder: result.draftFolder || identity.draftFolder } : {}),
        };
        return result;
      });
      tail = operation.then(() => { saveFailed = false; }, () => { saveFailed = true; });
      return operation;
    },

    async flush(): Promise<DraftIdentity> {
      await tail;
      return { ...identity };
    },

    async discard(remove): Promise<void> {
      if (discarding) throw new Error('Draft discard is already in progress.');
      discarding = true;
      try {
        await tail;
        if (saveFailed) throw new Error('The latest draft save was not confirmed. Save the draft successfully before discarding it.');
        await remove({ ...identity });
        identity = { draftId: null, draftUid: null };
        // Keep saves blocked until a new composer explicitly resets the queue.
      } catch (error) {
        discarding = false;
        throw error;
      }
    },

    reset(initialIdentity: DraftIdentity = { draftId: null, draftUid: null }): void {
      identity = { ...initialIdentity };
      discarding = false;
      saveFailed = false;
    },
  };
}
