export interface NoteSaveIdentity {
  id: string | null;
  syncToken: number | null;
}

export interface NoteSaveResult {
  id?: string;
  sync_token?: number;
  syncToken?: number;
}

export interface NoteSaveCoordinator {
  enqueue<T extends NoteSaveResult>(save: (identity: NoteSaveIdentity) => Promise<T>): Promise<T>;
  flush(): Promise<NoteSaveIdentity>;
  reset(identity?: NoteSaveIdentity): void;
}

/**
 * Serializes note writes so a new note's generated ID and every subsequent
 * revision token are known before another save starts.
 */
export function createNoteSaveCoordinator(
  initialIdentity: NoteSaveIdentity = { id: null, syncToken: null },
): NoteSaveCoordinator {
  let identity = { ...initialIdentity };
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<T extends NoteSaveResult>(save: (current: NoteSaveIdentity) => Promise<T>): Promise<T> {
      const operation = tail.then(async () => {
        const result = await save({ ...identity });
        identity = {
          id: result.id || identity.id,
          syncToken: result.syncToken ?? result.sync_token ?? identity.syncToken,
        };
        return result;
      });
      tail = operation.then(() => undefined, () => undefined);
      return operation;
    },

    async flush(): Promise<NoteSaveIdentity> {
      await tail;
      return { ...identity };
    },

    reset(nextIdentity: NoteSaveIdentity = { id: null, syncToken: null }): void {
      identity = { ...nextIdentity };
    },
  };
}
