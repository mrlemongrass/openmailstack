import type { Message, UndoActionResponse } from '../shared/types';

export interface ScheduledUndoDraftResult {
  draftFolder?: string;
  draftUid?: number;
  reopened: boolean;
}

interface ScheduledUndoDraftDependencies {
  isComposerOpen: () => boolean;
  fetchDraft: (folder: string, uid: number) => Promise<Message | undefined>;
  resumeDraft: (message: Message, folder: string) => Promise<{ opened: boolean }>;
}

export async function reopenRestoredScheduledDraft(
  undo: UndoActionResponse,
  dependencies: ScheduledUndoDraftDependencies,
): Promise<ScheduledUndoDraftResult> {
  const draftFolder = typeof undo.draftFolder === 'string' ? undo.draftFolder.trim() : '';
  const draftUid = Number(undo.draftUid);
  if (!draftFolder || !Number.isSafeInteger(draftUid) || draftUid < 1) {
    return { reopened: false };
  }
  const result = { draftFolder, draftUid, reopened: false };
  if (dependencies.isComposerOpen()) return result;

  const message = await dependencies.fetchDraft(draftFolder, draftUid);
  if (!message) return result;
  const resumed = await dependencies.resumeDraft(message, draftFolder);
  return { ...result, reopened: resumed.opened };
}
