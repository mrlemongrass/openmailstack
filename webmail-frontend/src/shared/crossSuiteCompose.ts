export interface CrossSuiteComposeAttachment {
  name: string;
  type: string;
  content: string;
}

export interface CrossSuiteComposeDraft {
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
  attachments?: CrossSuiteComposeAttachment[];
}

const STORAGE_KEY = 'oms_cross_suite_compose_v1';
const MAX_HANDOFF_BYTES = 700_000;
const MAX_ATTACHMENTS = 8;

function validatedDraft(value: unknown): CrossSuiteComposeDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The Compose handoff is invalid.');
  }
  const source = value as Record<string, unknown>;
  const draft: CrossSuiteComposeDraft = {};
  for (const field of ['from', 'to', 'cc', 'bcc', 'subject', 'body'] as const) {
    const candidate = source[field];
    if (candidate === undefined) continue;
    if (typeof candidate !== 'string' || /\0/.test(candidate)) {
      throw new Error('The Compose handoff is invalid.');
    }
    draft[field] = candidate;
  }
  if (source.attachments !== undefined) {
    if (!Array.isArray(source.attachments) || source.attachments.length > MAX_ATTACHMENTS) {
      throw new Error('The Compose handoff has too many attachments.');
    }
    draft.attachments = source.attachments.map(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new Error('The Compose handoff attachment is invalid.');
      }
      const attachment = candidate as Record<string, unknown>;
      if (typeof attachment.name !== 'string'
        || typeof attachment.type !== 'string'
        || typeof attachment.content !== 'string'
        || !attachment.name.trim()
        || /[\0\r\n]/.test(attachment.name)
        || /[\0\r\n]/.test(attachment.type)) {
        throw new Error('The Compose handoff attachment is invalid.');
      }
      return {
        name: attachment.name,
        type: attachment.type || 'application/octet-stream',
        content: attachment.content,
      };
    });
  }
  const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
  if (bytes > MAX_HANDOFF_BYTES) throw new Error('The Compose handoff is too large.');
  return draft;
}

export function saveCrossSuiteComposeDraft(storage: Storage, draft: CrossSuiteComposeDraft): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(validatedDraft(draft)));
}

export function takeCrossSuiteComposeDraft(storage: Storage): CrossSuiteComposeDraft | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  storage.removeItem(STORAGE_KEY);
  try {
    return validatedDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function crossSuiteComposeFiles(draft: CrossSuiteComposeDraft | null): File[] {
  return (draft?.attachments || []).map(attachment => new File(
    [attachment.content],
    attachment.name,
    { type: attachment.type },
  ));
}

export function openCrossSuiteCompose(draft: CrossSuiteComposeDraft, target = '/mail/INBOX'): void {
  const validated = validatedDraft(draft);
  saveCrossSuiteComposeDraft(window.sessionStorage, validated);
  window.dispatchEvent(new CustomEvent('oms:compose', { detail: validated }));
  window.location.href = target;
}
