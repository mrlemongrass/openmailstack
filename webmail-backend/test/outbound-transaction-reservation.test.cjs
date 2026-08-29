const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'outbound-transaction-reservation-test';

const {
  OutboundIdempotencyConflictError,
  OutboundSubmissionUnavailableError,
  reserveOutboundInTransaction,
} = require('../src/scheduled-send.js');

function message() {
  return {
    username: 'owner@example.test',
    sendAt: new Date('2026-08-29T18:30:00Z'),
    senderAddress: 'owner@example.test',
    messageId: '<calendar-action@example.test>',
    envelope: { from: 'owner@example.test', to: ['organizer@example.net'] },
    raw: Buffer.from('Message-ID: <calendar-action@example.test>\r\n\r\nreply'),
    sentRaw: Buffer.from('Message-ID: <calendar-action@example.test>\r\n\r\nreply'),
    metadata: {
      from: 'owner@example.test', to: 'organizer@example.net', cc: '', bcc: '',
      replyTo: '', subject: 'Accepted: Planning', text: 'Accepted', html: '',
      inReplyTo: '', references: [],
    },
    saveSentCopy: true,
  };
}

function transactionConnection() {
  const state = { registry: null, scheduledInserts: 0, registryInserts: 0, transactionCalls: [] };
  return {
    state,
    beginTransaction: async () => state.transactionCalls.push('begin'),
    commit: async () => state.transactionCalls.push('commit'),
    rollback: async () => state.transactionCalls.push('rollback'),
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('SELECT submission_id')) {
        return [state.registry ? [state.registry] : [], []];
      }
      if (compact.startsWith('INSERT INTO scheduled_emails')) {
        state.scheduledInserts += 1;
        return [{ insertId: 42, affectedRows: 1 }, []];
      }
      if (compact.startsWith('INSERT INTO outbound_submission_registry')) {
        state.registryInserts += 1;
        state.registry = {
          submission_id: Number(params[3]),
          request_fingerprint: params[2],
          submission_origin: params[4],
          submission_kind: params[5],
        };
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected transaction reservation query: ${compact}`);
    },
  };
}

test('reserves invitation mail inside the caller transaction and replays the same semantic request', async () => {
  const connection = transactionConnection();
  const input = {
    submissionKind: 'immediate',
    idempotencyKey: 'calendar-response-request-1',
    fingerprintSource: {
      action: 'respond', calendarId: 7, uid: 'meeting-123', response: 'accepted',
    },
    message: message(),
  };

  assert.deepEqual(await reserveOutboundInTransaction(connection, input), { id: 42, replayed: false });
  assert.deepEqual(await reserveOutboundInTransaction(connection, input), { id: 42, replayed: true });
  assert.equal(connection.state.scheduledInserts, 1);
  assert.equal(connection.state.registryInserts, 1);
  assert.deepEqual(connection.state.transactionCalls, [], 'the caller owns begin, commit, and rollback');
});

test('rejects reuse of an invitation idempotency key for different semantics', async () => {
  const connection = transactionConnection();
  const base = {
    submissionKind: 'immediate',
    idempotencyKey: 'calendar-response-request-2',
    fingerprintSource: { action: 'respond', response: 'accepted' },
    message: message(),
  };
  await reserveOutboundInTransaction(connection, base);

  await assert.rejects(
    reserveOutboundInTransaction(connection, {
      ...base,
      fingerprintSource: { action: 'respond', response: 'declined' },
    }),
    error => error instanceof OutboundIdempotencyConflictError,
  );
  assert.equal(connection.state.scheduledInserts, 1);
});

test('wraps transaction database failures without exposing invitation payload details', async () => {
  const sensitive = 'ATTENDEE:mailto:private-recipient@example.test';
  const connection = {
    query: async () => {
      throw new Error(`driver failed while binding ${sensitive}`);
    },
  };

  await assert.rejects(
    reserveOutboundInTransaction(connection, {
      submissionKind: 'immediate',
      idempotencyKey: 'calendar-response-request-3',
      fingerprintSource: { action: 'respond', response: 'accepted' },
      message: message(),
    }),
    error => {
      assert.ok(error instanceof OutboundSubmissionUnavailableError);
      assert.doesNotMatch(error.message, /private-recipient|ATTENDEE/i);
      return true;
    },
  );
});
