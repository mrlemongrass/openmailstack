/** One browser window owns a saved draft at a time. Locks release automatically when a window exits. */
export function createDraftOwnership(locks: LockManager | undefined) {
  let key = '';
  let release: (() => void) | undefined;
  let pending: Promise<boolean> | undefined;
  let generation = 0;
  return {
    async acquire(id: string): Promise<boolean> {
      if (!locks || key === id) return true;
      if (pending) return pending.then(() => key === id);
      const request = generation;
      pending = new Promise<boolean>(resolve => {
        void locks.request(`oms-draft:${id}`, { ifAvailable: true }, async lock => {
          if (!lock || request !== generation) { resolve(false); return; }
          release?.(); key = id;
          await new Promise<void>(done => { release = done; resolve(true); });
        }).catch(() => resolve(false));
      });
      try { return await pending; } finally { pending = undefined; }
    },
    release() { generation++; release?.(); release = undefined; key = ''; },
  };
}
