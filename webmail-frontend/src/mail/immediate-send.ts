import type { SendMessageResponse } from '../shared/types';

const NON_UNCERTAIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const POST_SCHEDULE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OutboundSendScope {
  mailbox: string;
  draftId?: string;
  replyParent?: string;
}

export interface OutboundSendDelivery {
  kind: 'immediate' | 'undo' | 'scheduled';
  scheduledFor?: string;
}

interface PersistedOutboundSendAttempt {
  recordId: string;
  key: string;
  ownerDigest: string;
  scopeDigest: string;
  contentDigest: string;
  deliveryDigest: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  scheduledFor?: string;
  uncertainAt?: number;
}

export interface OutboundSendAttemptRepository {
  update<T>(mutator: (records: PersistedOutboundSendAttempt[]) => {
    records: PersistedOutboundSendAttempt[];
    value: T;
  }): Promise<T>;
}

export interface PreparedOutboundSendAttempt {
  recordId: string;
  key: string;
  blocked: boolean;
  blockReason?: OutboundSendBlockReason;
  deliveryKind: OutboundSendDelivery['kind'];
  scheduledFor?: string;
}

export type OutboundSendBlockReason = 'delivery_uncertain' | 'delivery_change_pending';

export interface OutboundSendAttemptCoordinator {
  prepare(request: {
    scope: OutboundSendScope;
    fingerprint: string;
    delivery: OutboundSendDelivery;
  }): Promise<PreparedOutboundSendAttempt>;
  markDefinitive(attempt: PreparedOutboundSendAttempt): Promise<void>;
  markUncertain(attempt: PreparedOutboundSendAttempt): Promise<void>;
  reconcileMailbox(
    mailbox: string,
    loadStatus: (idempotencyKey: string) => Promise<SendMessageResponse>,
  ): Promise<OutboundSendReconciliation>;
}

export interface OutboundSendReconciliation {
  checked: number;
  cleared: number;
  accepted: number;
  partial: number;
  failed: number;
  scheduled: number;
  pending: number;
  uncertain: number;
  unavailable: number;
}

export type ProtectedOutboundSendCheckState =
  | 'accepted'
  | 'partial'
  | 'failed'
  | 'scheduled'
  | 'pending'
  | 'uncertain'
  | 'unavailable';

export interface ProtectedOutboundSendCheck {
  state: ProtectedOutboundSendCheckState;
  result?: SendMessageResponse;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(digest);
}

function canonicalScope(scope: OutboundSendScope): string {
  const mailbox = canonicalMailbox(scope.mailbox);
  const logicalId = scope.draftId
    ? `draft:${scope.draftId}`
    : scope.replyParent ? `reply:${scope.replyParent}` : '';
  if (!mailbox || !logicalId) {
    throw new Error('A mailbox and stable Draft ID or reply parent are required before sending');
  }
  return `${mailbox}\u0000${logicalId}`;
}

function canonicalMailbox(mailbox: string): string {
  return mailbox.trim().toLowerCase();
}

function normalizedScheduledFor(delivery: OutboundSendDelivery): string | undefined {
  if (delivery.kind === 'immediate') return undefined;
  const scheduledAt = delivery.scheduledFor ? Date.parse(delivery.scheduledFor) : Number.NaN;
  if (!Number.isFinite(scheduledAt)) {
    throw new Error('A delayed send requires an absolute scheduledFor value');
  }
  return new Date(scheduledAt).toISOString();
}

function canonicalDelivery(delivery: OutboundSendDelivery, scheduledFor?: string): string {
  if (delivery.kind === 'scheduled') return `scheduled:${scheduledFor}`;
  return delivery.kind;
}

function expirationTime(now: number, scheduledFor?: string): number {
  const normalExpiry = now + NON_UNCERTAIN_RETENTION_MS;
  if (!scheduledFor) return normalExpiry;
  const scheduledAt = Date.parse(scheduledFor);
  return Number.isFinite(scheduledAt)
    ? Math.max(normalExpiry, scheduledAt + POST_SCHEDULE_RETENTION_MS)
    : normalExpiry;
}

const SEND_ATTEMPT_DATABASE = 'openmailstack-outbound-send-attempts';
const SEND_ATTEMPT_STORE = 'attempts';

export function createIndexedDbOutboundSendAttemptRepository(
  indexedDb: IDBFactory | null | undefined = globalThis.indexedDB,
): OutboundSendAttemptRepository {
  let databasePromise: Promise<IDBDatabase> | null = null;

  const openDatabase = () => {
    if (!indexedDb) {
      return Promise.reject(new Error(
        'Safe send recovery storage is unavailable. No message was submitted; retry after browser storage is available.',
      ));
    }
    if (databasePromise) return databasePromise;
    const opening: Promise<IDBDatabase> = new Promise((resolve, reject) => {
      const request = indexedDb.open(SEND_ATTEMPT_DATABASE, 1);
      const resetOpening = () => {
        if (databasePromise === opening) databasePromise = null;
      };
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(SEND_ATTEMPT_STORE)) {
          request.result.createObjectStore(SEND_ATTEMPT_STORE, { keyPath: 'recordId' });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          resetOpening();
        };
        resolve(database);
      };
      request.onerror = () => {
        resetOpening();
        reject(new Error(
          'Safe send recovery storage could not be opened. No message was submitted.',
          { cause: request.error },
        ));
      };
      request.onblocked = () => {
        resetOpening();
        reject(new Error(
          'Safe send recovery storage is blocked by another tab. No message was submitted.',
        ));
      };
    });
    databasePromise = opening;
    return opening;
  };

  return {
    async update<T>(mutator: (records: PersistedOutboundSendAttempt[]) => {
      records: PersistedOutboundSendAttempt[];
      value: T;
    }): Promise<T> {
      const database = await openDatabase();
      return new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(SEND_ATTEMPT_STORE, 'readwrite');
        const store = transaction.objectStore(SEND_ATTEMPT_STORE);
        const request = store.getAll();
        let result: T;
        let mutationError: unknown;
        request.onsuccess = () => {
          try {
            const update = mutator(request.result as PersistedOutboundSendAttempt[]);
            result = update.value;
            store.clear();
            update.records.forEach(record => store.put(record));
          } catch (error) {
            mutationError = error;
            transaction.abort();
          }
        };
        request.onerror = () => {
          mutationError = request.error;
          transaction.abort();
        };
        transaction.oncomplete = () => resolve(result!);
        transaction.onerror = () => reject(new Error(
          'Safe send recovery storage failed. No untracked message was submitted.',
          { cause: transaction.error || mutationError },
        ));
        transaction.onabort = () => reject(new Error(
          'Safe send recovery storage failed. No untracked message was submitted.',
          { cause: transaction.error || mutationError },
        ));
      });
    },
  };
}

export function createOutboundSendAttemptCoordinator({
  repository,
  createKey = () => crypto.randomUUID(),
  now = () => Date.now(),
}: {
  repository: OutboundSendAttemptRepository;
  createKey?: () => string;
  now?: () => number;
}): OutboundSendAttemptCoordinator {
  const updateMatching = async (
    attempt: PreparedOutboundSendAttempt,
    update: (record: PersistedOutboundSendAttempt) => PersistedOutboundSendAttempt | null,
  ) => repository.update(records => ({
    records: records.flatMap(record => {
      if (record.recordId !== attempt.recordId || record.key !== attempt.key) return [record];
      const next = update(record);
      return next ? [next] : [];
    }),
    value: undefined,
  }));

  return {
    async prepare({ scope, fingerprint, delivery }) {
      const scheduledFor = normalizedScheduledFor(delivery);
      const [ownerDigest, scopeDigest, contentDigest, deliveryDigest, undoDeliveryDigest] = await Promise.all([
        sha256(`oms-send-owner-v1\u0000${canonicalMailbox(scope.mailbox)}`),
        sha256(`oms-send-scope-v1\u0000${canonicalScope(scope)}`),
        sha256(`oms-send-content-v1\u0000${fingerprint}`),
        sha256(`oms-send-delivery-v1\u0000${canonicalDelivery(delivery, scheduledFor)}`),
        sha256('oms-send-delivery-v1\u0000undo'),
      ]);
      const recordId = `${scopeDigest}.${contentDigest}.${deliveryDigest}`;
      const preparedAt = now();
      return repository.update(records => {
        const retained = records.filter(record => (
          record.uncertainAt !== undefined || record.expiresAt > preparedAt
        ));
        const exact = retained.find(record => record.recordId === recordId);
        const sameContent = retained
          .filter(record => (
            record.scopeDigest === scopeDigest && record.contentDigest === contentDigest
          ))
          .sort((left, right) => right.updatedAt - left.updatedAt);
        const uncertain = sameContent.find(record => record.uncertainAt !== undefined);
        const recoverable = sameContent[0];
        const existing = uncertain || exact || recoverable;
        if (existing) {
          existing.updatedAt = preparedAt;
          existing.expiresAt = expirationTime(preparedAt, existing.scheduledFor);
          const blockReason: OutboundSendBlockReason | undefined = existing.uncertainAt !== undefined
            ? 'delivery_uncertain'
            : existing.scheduledFor === undefined && scheduledFor !== undefined
              ? 'delivery_change_pending'
              : undefined;
          return {
            records: retained,
            value: {
              recordId: existing.recordId,
              key: existing.key,
              blocked: blockReason !== undefined,
              ...(blockReason ? { blockReason } : {}),
              deliveryKind: existing.scheduledFor
                ? existing.deliveryDigest === undoDeliveryDigest ? 'undo' : 'scheduled'
                : 'immediate',
              ...(existing.scheduledFor ? { scheduledFor: existing.scheduledFor } : {}),
            },
          };
        }
        const key = createKey();
        if (!UUID_PATTERN.test(key)) {
          throw new Error('A valid UUID idempotency key could not be created. No message was submitted.');
        }
        retained.push({
          recordId,
          key,
          ownerDigest,
          scopeDigest,
          contentDigest,
          deliveryDigest,
          createdAt: preparedAt,
          updatedAt: preparedAt,
          expiresAt: expirationTime(preparedAt, scheduledFor),
          ...(scheduledFor ? { scheduledFor } : {}),
        });
        return {
          records: retained,
          value: {
            recordId,
            key,
            blocked: false,
            deliveryKind: delivery.kind,
            ...(scheduledFor ? { scheduledFor } : {}),
          },
        };
      });
    },
    markDefinitive(attempt) {
      return updateMatching(attempt, () => null);
    },
    markUncertain(attempt) {
      const uncertainAt = now();
      return updateMatching(attempt, record => ({
        ...record,
        updatedAt: uncertainAt,
        uncertainAt,
      }));
    },
    async reconcileMailbox(mailbox, loadStatus) {
      const checkedAt = now();
      const ownerDigest = await sha256(`oms-send-owner-v1\u0000${canonicalMailbox(mailbox)}`);
      const owned = await repository.update(records => {
        const retained = records.filter(record => (
          record.uncertainAt !== undefined || record.expiresAt > checkedAt
        ));
        return {
          records: retained,
          value: retained.filter(record => record.ownerDigest === ownerDigest),
        };
      });
      const summary: OutboundSendReconciliation = {
        checked: owned.length,
        cleared: 0,
        accepted: 0,
        partial: 0,
        failed: 0,
        scheduled: 0,
        pending: 0,
        uncertain: 0,
        unavailable: 0,
      };
      await Promise.all(owned.map(async record => {
        const attempt: PreparedOutboundSendAttempt = {
          recordId: record.recordId,
          key: record.key,
          blocked: record.uncertainAt !== undefined,
          deliveryKind: record.scheduledFor ? 'scheduled' : 'immediate',
          ...(record.scheduledFor ? { scheduledFor: record.scheduledFor } : {}),
        };
        try {
          const result = await loadStatus(record.key);
          if (result.submissionKind === 'scheduled' && result.scheduledId) {
            await updateMatching(attempt, () => null);
            summary.cleared += 1;
            summary.scheduled += 1;
          } else if (result.deliveryStatus === 'pending') {
            summary.pending += 1;
          } else if (result.deliveryStatus === 'uncertain') {
            await updateMatching(attempt, current => ({
              ...current,
              updatedAt: checkedAt,
              uncertainAt: current.uncertainAt ?? checkedAt,
            }));
            summary.uncertain += 1;
          } else if (
            result.deliveryStatus === 'accepted'
            || result.deliveryStatus === 'partial'
            || result.deliveryStatus === 'failed'
          ) {
            await updateMatching(attempt, () => null);
            summary.cleared += 1;
            summary[result.deliveryStatus] += 1;
          } else {
            summary.unavailable += 1;
          }
        } catch {
          // A 404 may mean this record belongs to a different authenticated
          // mailbox. Retain all lookup failures rather than destroying a key
          // whose terminal status cannot be proved for the current owner.
          summary.unavailable += 1;
        }
      }));
      return summary;
    },
  };
}

export function createBrowserOutboundSendAttemptCoordinator(options: {
  indexedDb?: IDBFactory | null;
  createKey?: () => string;
  now?: () => number;
} = {}): OutboundSendAttemptCoordinator {
  return createOutboundSendAttemptCoordinator({
    repository: createIndexedDbOutboundSendAttemptRepository(options.indexedDb),
    ...(options.createKey ? { createKey: options.createKey } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}

export async function checkProtectedOutboundSendAttempt({
  attempt,
  attempts,
  loadStatus,
}: {
  attempt: PreparedOutboundSendAttempt;
  attempts: OutboundSendAttemptCoordinator;
  loadStatus: (idempotencyKey: string) => Promise<SendMessageResponse>;
}): Promise<ProtectedOutboundSendCheck> {
  try {
    const result = await loadStatus(attempt.key);
    if (result.deliveryStatus === 'failed') {
      await attempts.markDefinitive(attempt);
      return { state: 'failed', result };
    }
    if (result.deliveryStatus === 'accepted') return { state: 'accepted', result };
    if (result.deliveryStatus === 'partial') return { state: 'partial', result };
    if (result.deliveryStatus === 'uncertain') {
      await attempts.markUncertain(attempt);
      return { state: 'uncertain', result };
    }
    if (result.submissionKind === 'scheduled' && result.scheduledId) {
      return { state: 'scheduled', result };
    }
    if (result.deliveryStatus === 'pending') return { state: 'pending', result };
    return { state: 'unavailable', result };
  } catch {
    return { state: 'unavailable' };
  }
}

const NON_CONTENT_FORM_FIELDS = new Set(['draftId', 'draftUid', 'scheduledFor', 'delaySeconds']);

export async function outboundMessageFingerprint(formData: FormData): Promise<string> {
  const entries: Array<unknown> = [];
  for (const [name, value] of formData.entries()) {
    if (NON_CONTENT_FORM_FIELDS.has(name)) continue;
    if (typeof value === 'string') {
      entries.push(['field', name, value]);
      continue;
    }
    entries.push([
      'file',
      name,
      value.name,
      value.type,
      value.size,
      bytesToHex(await crypto.subtle.digest('SHA-256', await value.arrayBuffer())),
    ]);
  }
  return sha256(`oms-send-form-v1\u0000${JSON.stringify(entries)}`);
}

interface SendOutboundMessageOptions {
  scope: OutboundSendScope;
  formData: FormData;
  delivery: OutboundSendDelivery;
  attempts: OutboundSendAttemptCoordinator;
  submit: (formData: FormData, idempotencyKey: string) => Promise<SendMessageResponse>;
  loadStatus?: (statusUrl: string) => Promise<SendMessageResponse>;
  wait?: (milliseconds: number) => Promise<void>;
  onPending?: (result: SendMessageResponse) => void;
  onPrepared?: (attempt: PreparedOutboundSendAttempt) => void;
  maxPolls?: number;
}

export async function sendOutboundMessage({
  scope,
  formData,
  delivery,
  attempts,
  submit,
  loadStatus,
  wait = waitFor,
  onPending,
  onPrepared,
  maxPolls = 60,
}: SendOutboundMessageOptions): Promise<SendMessageResponse> {
  const fingerprint = await outboundMessageFingerprint(formData);
  const prepared = await attempts.prepare({ scope, fingerprint, delivery });
  onPrepared?.(prepared);
  if (prepared.blocked) throw new UncertainSendBlockedError(prepared.blockReason);

  formData.delete('delaySeconds');
  formData.delete('scheduledFor');
  if (prepared.scheduledFor) formData.set('scheduledFor', prepared.scheduledFor);

  let submissionAcknowledged = false;
  try {
    let result = await submit(formData, prepared.key);
    submissionAcknowledged = true;
    let statusUrl = result.statusUrl;
    let polls = 0;
    while (result.deliveryStatus === 'pending' && !result.scheduledId) {
      onPending?.(result);
      if (polls >= Math.max(1, Math.trunc(maxPolls))) {
        throw new Error('Message delivery is still pending. Use “Check delivery” to continue this same send attempt.');
      }
      statusUrl = result.statusUrl || statusUrl;
      if (!statusUrl || !loadStatus) {
        throw new Error('OpenMailStack could not confirm this message delivery. Retry to check the same send attempt.');
      }
      await wait(pendingDelay(result));
      result = await loadStatus(statusUrl);
      polls += 1;
    }

    if (result.deliveryStatus === 'uncertain') {
      await attempts.markUncertain(prepared);
    } else {
      await attempts.markDefinitive(prepared);
    }
    return result;
  } catch (error) {
    if (!submissionAcknowledged && (error as { definitive?: boolean })?.definitive === true) {
      await attempts.markDefinitive(prepared);
    }
    throw error;
  }
}

export class UncertainSendBlockedError extends Error {
  readonly reason: OutboundSendBlockReason;

  constructor(reason: OutboundSendBlockReason = 'delivery_uncertain') {
    super(reason === 'delivery_change_pending'
      ? 'An earlier send of this unchanged message is unresolved. Confirm its delivery before changing the schedule.'
      : 'Delivery status is uncertain. Do not resend until you verify whether the recipient received it.');
    this.name = 'UncertainSendBlockedError';
    this.reason = reason;
  }
}

function pendingDelay(result: SendMessageResponse): number {
  const requested = Number(result.retryAfterMs);
  if (!Number.isFinite(requested)) return 1000;
  return Math.min(5000, Math.max(250, Math.round(requested)));
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}
