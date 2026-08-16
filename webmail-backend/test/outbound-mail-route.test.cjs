const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'outbound-route-test';

const username = 'owner@example.test';
const smtpPayloads = [];
const imapPayloads = [];
const draftEvents = [];
const outboundSubmissions = [];
const outboundStatusLookups = [];
const cancellations = [];
const removals = [];
const aborts = [];
const scheduledQueries = [];
let scheduledRows = [];
let smtpResult = { messageId: '<accepted@example.test>' };
let draftDeleteError = null;
let submitOutboundError = null;
let submitOutboundResult = null;
let outboundStatusResult = null;

const db = require('../src/db.js');
db.pool.query = async (sql, params = []) => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  if (compact.includes('FROM mailbox')) return [[{ name: 'Owner Name' }], []];
  if (compact.includes('FROM alias')) {
    return [[{ address: 'alias@example.test', goto: username, active: 1 }], []];
  }
  if (compact.includes('FROM scheduled_emails')) {
    scheduledQueries.push({ sql: compact, params });
    if (compact.startsWith('SELECT COUNT(*)')) return [[{ total: scheduledRows.length }], []];
    if (compact.startsWith('SELECT *') || compact.startsWith('SELECT scheduled_emails.*')) {
      const id = Number(params[0]);
      return [[...scheduledRows.filter(row => row.id === id)], []];
    }
    return [[...scheduledRows], []];
  }
  throw new Error(`Unexpected outbound route query: ${compact}`);
};

const authPath = require.resolve('../src/auth.js');
const auth = require(authPath);
require.cache[authPath].exports = {
  ...auth,
  requireSession: (req, _res, next) => {
    req.user = { username, password: 'test-only', isAdmin: false };
    next();
  },
};

const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  async sendMail(payload) { smtpPayloads.push(payload); return smtpResult; },
  close() {},
});

const imapPool = require('../src/imap-pool.js');
imapPool.getImapConnection = async () => ({
  client: {
    async mailboxCreate() {},
    async mailboxOpen(folder) { draftEvents.push(['open', folder]); },
    async search(query) {
      draftEvents.push(['search', query]);
      return query?.header?.['message-id'] ? [] : [10, 20, 21];
    },
    async append(folder, raw) { draftEvents.push(['append', folder, Buffer.from(raw)]); return { uid: 20 }; },
  },
  async getFolders() { return [{ path: 'Sent' }, { path: 'Drafts' }]; },
  async appendMessage(_folder, raw) {
    imapPayloads.push(Buffer.from(raw));
    throw new Error('IMAP unavailable after SMTP acceptance');
  },
  async messageAction(_folder, uids) {
    draftEvents.push(['delete', uids]);
    if (draftDeleteError) throw draftDeleteError;
  },
});

const userSettings = require('../src/user-settings.js');
userSettings.getUserSettings = async () => ({ autoCreateFromSent: false });

const scheduled = require('../src/scheduled-send.js');
scheduled.submitOutbound = async (_pool, input, runtime) => {
  outboundSubmissions.push({ input, runtime });
  if (submitOutboundError) throw submitOutboundError;
  if (submitOutboundResult) return submitOutboundResult;
  return input.submissionKind === 'scheduled'
    ? {
      id: 88,
      submissionKind: 'scheduled',
      status: 'scheduled',
      messageId: input.message.messageId,
      sendAt: input.message.sendAt,
      smtpAccepted: false,
      saveSentCopy: true,
      rejectedRecipients: [],
      lastErrorCode: null,
      replayed: false,
    }
    : {
      id: 77,
      submissionKind: 'immediate',
      status: 'completed',
      messageId: input.message.messageId,
      sendAt: input.message.sendAt,
      smtpAccepted: true,
      saveSentCopy: true,
      rejectedRecipients: [],
      lastErrorCode: null,
      replayed: false,
    };
};
scheduled.getOutboundSubmission = async (_pool, owner, lookup) => {
  outboundStatusLookups.push({ owner, lookup });
  return outboundStatusResult;
};
scheduled.abortScheduledEmailBeforeDelivery = async (_pool, id, owner) => {
  aborts.push({ id, owner });
  return true;
};
scheduled.ensureScheduledEmailsSchema = async () => {};
scheduled.claimScheduledCancellation = async (_pool, id, owner, workerId) => {
  cancellations.push({ phase: 'claim', id, owner, workerId });
  if (id === 78) {
    return {
      outcome: 'ready',
      row: {
        id,
        username: owner,
        raw_message: Buffer.from('Message-ID: <undo@example.test>\r\n\r\nUndo body'),
        sent_raw_message: Buffer.from(
          'Message-ID: <undo@example.test>\r\nBcc: restored-private@example.net\r\n\r\nUndo body',
        ),
        message_id: '<undo@example.test>',
        draft_uid: null,
      },
    };
  }
  return { outcome: id === 77 ? 'conflict' : 'not_found' };
};
scheduled.completeScheduledCancellation = async (_pool, id, owner, workerId, draftUid) => {
  cancellations.push({ phase: 'complete', id, owner, workerId, draftUid });
};
scheduled.releaseScheduledCancellation = async (_pool, id, owner, workerId, code) => {
  cancellations.push({ phase: 'release', id, owner, workerId, code });
};
scheduled.removeTerminalScheduledEmail = async (_pool, id, owner) => {
  removals.push({ id, owner });
  return id === 79 ? 'removed' : id === 77 ? 'conflict' : 'not_found';
};

const originalSetInterval = global.setInterval;
global.setInterval = () => ({ unref() {} });
const { apiRouter } = require('../src/api.js');
global.setInterval = originalSetInterval;

let idempotencySequence = 0;
const postJson = (port, path, body, options = {}) => new Promise((resolve, reject) => {
  const raw = Buffer.from(JSON.stringify(body));
  const headers = { 'Content-Type': 'application/json', 'Content-Length': raw.length, ...options.headers };
  if (path === '/api/messages/send' && options.withIdempotency !== false
      && headers['Idempotency-Key'] === undefined) {
    idempotencySequence += 1;
    headers['Idempotency-Key'] = `outbound-route-test-${idempotencySequence}`;
  }
  const request = http.request({
    hostname: '127.0.0.1', port, path, method: 'POST',
    headers,
  }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode,
      headers: response.headers,
      json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }));
  });
  request.on('error', reject);
  request.end(raw);
});

const getJson = (port, path, options = {}) => new Promise((resolve, reject) => {
  const request = http.request({
    hostname: '127.0.0.1', port, path, headers: options.headers,
  }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode,
      headers: response.headers,
      json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }));
  });
  request.on('error', reject);
  request.end();
});

test('send delegates one durable outbound payload with Bcc only in its Sent copy', async t => {
  smtpPayloads.length = 0;
  outboundSubmissions.length = 0;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await postJson(server.address().port, '/api/messages/send', {
    from: username,
    to: 'recipient@example.net',
    bcc: 'private-scheduled@example.net',
    subject: 'Reply subject',
    body: 'Reply body',
    inReplyTo: '<parent@example.net>',
    references: ['<root@example.net>', '<parent@example.net>'],
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.success, true);
  assert.equal(response.json.deliveryStatus, 'accepted');
  assert.equal(response.json.sentCopyStatus, 'saved');
  assert.equal(response.json.outboundId, 77);
  assert.equal(response.json.scheduledId, undefined);
  assert.equal(smtpPayloads.length, 0, 'the HTTP route must never own SMTP');
  assert.equal(outboundSubmissions.length, 1);
  const submission = outboundSubmissions[0].input;
  assert.equal(submission.submissionKind, 'immediate');
  assert.equal(submission.idempotencyKey, 'outbound-route-test-1');
  assert.equal(submission.requestCredential, 'test-only');
  assert.ok(Buffer.isBuffer(submission.message.raw));
  assert.notDeepEqual(submission.message.raw, submission.message.sentRaw);
  assert.doesNotMatch(submission.message.raw.toString('utf8'), /^Bcc:/mi);
  assert.match(submission.message.sentRaw.toString('utf8'), /^Bcc: private-scheduled@example\.net$/mi);
  assert.deepEqual(submission.message.envelope, {
    from: username,
    to: ['recipient@example.net', 'private-scheduled@example.net'],
  });
  assert.match(submission.message.raw.toString('utf8'), /In-Reply-To: <parent@example.net>/i);
  assert.match(submission.message.raw.toString('utf8'), /Reply body/);
});

test('send returns 503 and performs no SMTP when durable reservation fails', async t => {
  smtpPayloads.length = 0;
  outboundSubmissions.length = 0;
  submitOutboundError = Object.assign(new Error('database unavailable'), {
    code: 'OUTBOUND_SUBMISSION_UNAVAILABLE',
    status: 503,
  });
  t.after(() => { submitOutboundError = null; });
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await postJson(server.address().port, '/api/messages/send', {
    from: username,
    to: 'recipient@example.net',
    subject: 'Accepted without a durable Sent retry',
    body: 'The recipient may still receive this message.',
  });

  assert.equal(response.status, 503);
  assert.equal(response.json.success, false);
  assert.equal(response.json.code, 'OUTBOUND_SUBMISSION_UNAVAILABLE');
  assert.equal(smtpPayloads.length, 0);
  assert.equal(outboundSubmissions.length, 1);
});

test('immediate send requires a bounded visible-ASCII idempotency key', async t => {
  outboundSubmissions.length = 0;
  submitOutboundError = Object.assign(new Error('idempotency key is invalid'), {
    code: 'OUTBOUND_IDEMPOTENCY_KEY_INVALID',
    status: 400,
  });
  t.after(() => { submitOutboundError = null; });
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await postJson(server.address().port, '/api/messages/send', {
    from: username,
    to: 'recipient@example.net',
    subject: 'No replay identity',
    body: 'Must not reach the delivery engine.',
  }, { withIdempotency: false });

  assert.equal(response.status, 400);
  assert.equal(response.json.code, 'OUTBOUND_IDEMPOTENCY_KEY_INVALID');
  assert.equal(outboundSubmissions.length, 1);
  assert.equal(outboundSubmissions[0].input.idempotencyKey, '');
  assert.equal(smtpPayloads.length, 0);
});

test('scheduled send also requires a durable idempotency key', async t => {
  outboundSubmissions.length = 0;
  submitOutboundError = Object.assign(new Error('idempotency key is invalid'), {
    code: 'OUTBOUND_IDEMPOTENCY_KEY_INVALID',
    status: 400,
  });
  t.after(() => { submitOutboundError = null; });
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await postJson(server.address().port, '/api/messages/send', {
    from: username,
    to: 'recipient@example.net',
    subject: 'No scheduled replay identity',
    body: 'Must not enqueue.',
    delaySeconds: '30',
    scheduledFor: new Date(Date.now() + 30_000).toISOString(),
  }, { withIdempotency: false });

  assert.equal(response.status, 400);
  assert.equal(response.json.code, 'OUTBOUND_IDEMPOTENCY_KEY_INVALID');
  assert.equal(outboundSubmissions.length, 1);
  assert.equal(outboundSubmissions[0].input.submissionKind, 'scheduled');
  assert.equal(outboundSubmissions[0].input.idempotencyKey, '');
  assert.equal(smtpPayloads.length, 0);
});

test('idempotency fingerprint conflicts are definitive and never invoke route-owned SMTP', async t => {
  smtpPayloads.length = 0;
  outboundSubmissions.length = 0;
  submitOutboundError = Object.assign(new Error('key was already used for a different message'), {
    code: 'OUTBOUND_IDEMPOTENCY_CONFLICT',
    status: 409,
  });
  t.after(() => { submitOutboundError = null; });
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await postJson(server.address().port, '/api/messages/send', {
    from: username,
    to: 'recipient@example.net',
    subject: 'Changed content under an old key',
    body: 'Reject this request.',
  }, { headers: { 'Idempotency-Key': 'already-used-key' } });

  assert.equal(response.status, 409);
  assert.equal(response.json.code, 'OUTBOUND_IDEMPOTENCY_CONFLICT');
  assert.equal(smtpPayloads.length, 0);
  assert.equal(outboundSubmissions.length, 1);
});

test('send reports exactly which recipients were rejected after partial SMTP acceptance', async t => {
  smtpPayloads.length = 0;
  outboundSubmissions.length = 0;
  submitOutboundResult = {
    id: 78,
    submissionKind: 'immediate',
    status: 'partial_delivery',
    messageId: '<partial@example.test>',
    sendAt: new Date(),
    smtpAccepted: true,
    saveSentCopy: true,
    rejectedRecipients: ['rejected@example.net'],
    lastErrorCode: 'partial_recipient_rejection',
    replayed: false,
  };
  t.after(() => { submitOutboundResult = null; });
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await postJson(server.address().port, '/api/messages/send', {
    from: username,
    to: 'accepted@example.net, rejected@example.net',
    subject: 'Partial delivery truth',
    body: 'Only one recipient accepted this message.',
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.success, true);
  assert.equal(response.json.deliveryStatus, 'partial');
  assert.deepEqual(response.json.rejectedRecipients, ['rejected@example.net']);
  assert.equal(response.json.outboundId, 78);
  assert.equal(smtpPayloads.length, 0, 'the HTTP route must never own SMTP');
  assert.equal(outboundSubmissions.length, 1);
});

test('same immediate-send key preserves one logical request across an ambiguous retry', async t => {
  outboundSubmissions.length = 0;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const requestBody = {
    from: username,
    to: 'recipient@example.net',
    subject: 'Retry the request, not the delivery',
    body: 'Exactly one logical send.',
  };
  const headers = { 'Idempotency-Key': 'same-logical-send-key' };
  const first = await postJson(server.address().port, '/api/messages/send', requestBody, { headers });
  const replay = await postJson(server.address().port, '/api/messages/send', requestBody, { headers });

  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(first.json.outboundId, 77);
  assert.equal(replay.json.outboundId, 77);
  assert.equal(outboundSubmissions.length, 2);
  assert.equal(outboundSubmissions[0].input.idempotencyKey, 'same-logical-send-key');
  assert.equal(outboundSubmissions[1].input.idempotencyKey, 'same-logical-send-key');
  assert.deepEqual(
    outboundSubmissions[0].input.fingerprintSource,
    outboundSubmissions[1].input.fingerprintSource,
    'generated Message-ID and MIME boundaries must not change the logical request fingerprint',
  );
});

test('pending outbound submissions return a stable status URL and owner-scoped polling', async t => {
  outboundSubmissions.length = 0;
  outboundStatusLookups.length = 0;
  submitOutboundResult = {
    id: 91,
    submissionKind: 'immediate',
    status: 'claimed',
    messageId: '<pending@example.test>',
    sendAt: new Date(),
    smtpAccepted: false,
    saveSentCopy: true,
    rejectedRecipients: [],
    lastErrorCode: null,
    replayed: false,
  };
  outboundStatusResult = {
    ...submitOutboundResult,
    status: 'delivery_uncertain',
    lastErrorCode: 'lease_expired_during_smtp',
  };
  t.after(() => {
    submitOutboundResult = null;
    outboundStatusResult = null;
  });
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const submitted = await postJson(server.address().port, '/api/messages/send', {
    from: username,
    to: 'recipient@example.net',
    subject: 'Pending delivery',
    body: 'Poll before deciding what happened.',
  });
  assert.equal(submitted.status, 202);
  assert.equal(submitted.json.deliveryStatus, 'pending');
  assert.equal(submitted.json.outboundId, 91);
  assert.equal(submitted.json.statusUrl, '/api/messages/outbound/91');
  assert.equal(submitted.headers.location, '/api/messages/outbound/91');
  assert.ok(Number(submitted.headers['retry-after']) >= 1);
  assert.equal(submitted.headers['cache-control'], 'no-store');

  const status = await getJson(server.address().port, '/api/messages/outbound/91');
  assert.equal(status.status, 200);
  assert.equal(status.json.deliveryStatus, 'uncertain');
  assert.equal(status.json.outboundId, 91);
  assert.equal(status.json.errorCode, 'lease_expired_during_smtp');
  assert.equal(status.headers['cache-control'], 'no-store');
  assert.deepEqual(outboundStatusLookups, [{ owner: username, lookup: { id: 91 } }]);
});

test('a lost response can be recovered by owner and idempotency key without message content', async t => {
  outboundStatusLookups.length = 0;
  outboundStatusResult = {
    id: 92,
    submissionKind: 'scheduled',
    status: 'scheduled',
    messageId: '<scheduled-recovery@example.test>',
    sendAt: new Date('2026-08-16T18:30:00.000Z'),
    smtpAccepted: false,
    saveSentCopy: true,
    rejectedRecipients: [],
    lastErrorCode: null,
    replayed: true,
  };
  t.after(() => { outboundStatusResult = null; });
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const recovered = await getJson(
    server.address().port,
    '/api/messages/outbound/status',
    { headers: { 'Idempotency-Key': 'lost-response-key' } },
  );

  assert.equal(recovered.status, 200);
  assert.equal(recovered.json.deliveryStatus, 'pending');
  assert.equal(recovered.json.submissionKind, 'scheduled');
  assert.equal(recovered.json.scheduledId, 92);
  assert.equal(recovered.json.statusUrl, undefined);
  assert.equal(recovered.headers['cache-control'], 'no-store');
  assert.deepEqual(outboundStatusLookups, [{
    owner: username,
    lookup: { idempotencyKey: 'lost-response-key' },
  }]);
});

test('send rejects an unowned From address before SMTP', async t => {
  smtpPayloads.length = 0;
  outboundSubmissions.length = 0;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await postJson(server.address().port, '/api/messages/send', {
    from: 'spoof@example.net',
    to: 'recipient@example.net',
    subject: 'Spoof attempt',
    text: 'Must not send',
  });

  assert.equal(response.status, 403);
  assert.equal(response.json.code, 'SENDER_NOT_AUTHORIZED');
  assert.equal(smtpPayloads.length, 0);
  assert.equal(outboundSubmissions.length, 0);
});

test('send and draft reject malformed draft UIDs before SMTP or IMAP mutation', async t => {
  smtpPayloads.length = 0;
  outboundSubmissions.length = 0;
  draftEvents.length = 0;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const sendResponse = await postJson(server.address().port, '/api/messages/send', {
    from: username,
    to: 'recipient@example.net',
    subject: 'Malformed draft reference',
    body: 'Must not send',
    draftUid: '12oops',
  });
  assert.equal(sendResponse.status, 400);
  assert.equal(sendResponse.json.code, 'OUTBOUND_MESSAGE_INVALID');

  const draftResponse = await postJson(server.address().port, '/api/messages/draft', {
    from: username,
    subject: 'Out-of-range draft reference',
    body: 'Must not mutate Drafts',
    draftUid: '4294967296',
  });
  assert.equal(draftResponse.status, 400);
  assert.equal(draftResponse.json.code, 'OUTBOUND_MESSAGE_INVALID');
  assert.equal(smtpPayloads.length, 0);
  assert.equal(outboundSubmissions.length, 0);
  assert.equal(draftEvents.length, 0);
});

test('message and attachment routes reject numeric-prefix UID ambiguity', async t => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const messageResponse = await getJson(
    server.address().port,
    '/api/folders/INBOX/messages/901oops',
  );
  assert.equal(messageResponse.status, 400);
  assert.match(messageResponse.json.error, /UID is invalid/);

  const attachmentResponse = await getJson(
    server.address().port,
    '/api/folders/INBOX/messages/901oops/attachments/0suffix',
  );
  assert.equal(attachmentResponse.status, 400);
  assert.equal(attachmentResponse.json.error, 'Invalid attachment request');
});

test('draft replacement appends first and deletes only older copies', async t => {
  draftEvents.length = 0;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await postJson(server.address().port, '/api/messages/draft', {
    from: username,
    to: '',
    cc: 'copy@example.net',
    bcc: 'private-copy@example.net',
    replyTo: 'replies@example.test',
    subject: 'Safe draft replacement',
    body: 'Do not lose this body',
    draftId: 'draft-client-123',
    draftUid: 9,
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.draftId, 'draft-client-123');
  assert.equal(response.json.draftUid, 20);
  const appendIndex = draftEvents.findIndex(event => event[0] === 'append');
  const deleteIndex = draftEvents.findIndex(event => event[0] === 'delete');
  assert.ok(appendIndex >= 0 && deleteIndex > appendIndex, 'replacement must exist before old drafts are deleted');
  assert.deepEqual(draftEvents[deleteIndex], ['delete', [9, 10]]);
  assert.match(draftEvents[appendIndex][2].toString('utf8'), /X-Draft-ID: draft-client-123/i);
  assert.match(draftEvents[appendIndex][2].toString('utf8'), /^Cc: copy@example\.net$/mi);
  assert.match(draftEvents[appendIndex][2].toString('utf8'), /^Bcc: private-copy@example\.net$/mi);
  assert.match(draftEvents[appendIndex][2].toString('utf8'), /^Reply-To: replies@example\.test$/mi);
  assert.match(draftEvents[appendIndex][2].toString('utf8'), /Do not lose this body/);
});

test('scheduled send persists canonical raw MIME and never starts SMTP at creation', async t => {
  smtpPayloads.length = 0;
  outboundSubmissions.length = 0;
  draftEvents.length = 0;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const scheduledFor = new Date(Date.now() + 30_000).toISOString();
  const response = await postJson(server.address().port, '/api/messages/send', {
    from: username,
    to: 'recipient@example.net',
    bcc: 'private-scheduled@example.net',
    subject: 'Scheduled canonical payload',
    body: 'Scheduled body',
    draftUid: '9',
    scheduledFor,
  }, { headers: { 'Idempotency-Key': 'scheduled-canonical-key' } });

  assert.equal(response.status, 200);
  assert.equal(response.json.scheduledId, 88);
  assert.equal(smtpPayloads.length, 0);
  assert.equal(outboundSubmissions.length, 1);
  const submission = outboundSubmissions[0].input;
  assert.equal(submission.submissionKind, 'scheduled');
  assert.equal(submission.idempotencyKey, 'scheduled-canonical-key');
  assert.equal(submission.message.sendAt.toISOString(), scheduledFor);
  assert.equal(submission.message.senderAddress, username);
  assert.deepEqual(draftEvents.find(event => event[0] === 'delete'), ['delete', [9]]);
  assert.ok(Buffer.isBuffer(submission.message.raw));
  assert.ok(Buffer.isBuffer(submission.message.sentRaw));
  assert.doesNotMatch(submission.message.raw.toString('utf8'), /^Bcc:/mi);
  assert.match(submission.message.sentRaw.toString('utf8'), /^Bcc: private-scheduled@example\.net$/mi);
  assert.match(submission.message.raw.toString('utf8'), new RegExp(
    `Message-ID: ${submission.message.messageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'i',
  ));
  assert.doesNotMatch(JSON.stringify(submission.message.metadata), /encoding.*base64/i);
});

test('scheduled retry replays one row and never repeats successful Draft cleanup', async t => {
  outboundSubmissions.length = 0;
  draftEvents.length = 0;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const scheduledFor = new Date(Date.now() + 60_000).toISOString();
  const body = {
    from: username,
    to: 'recipient@example.net',
    subject: 'One queued row',
    body: 'Do not duplicate this schedule.',
    draftUid: '9',
    scheduledFor,
  };
  const options = { headers: { 'Idempotency-Key': 'scheduled-replay-key' } };
  const first = await postJson(server.address().port, '/api/messages/send', body, options);
  assert.equal(first.status, 200);
  assert.equal(first.json.scheduledId, 88);
  assert.deepEqual(draftEvents.filter(event => event[0] === 'delete'), [['delete', [9]]]);

  draftEvents.length = 0;
  submitOutboundResult = {
    id: 88,
    submissionKind: 'scheduled',
    status: 'scheduled',
    messageId: '<stored-scheduled@example.test>',
    sendAt: new Date(scheduledFor),
    smtpAccepted: false,
    saveSentCopy: true,
    rejectedRecipients: [],
    lastErrorCode: null,
    replayed: true,
  };
  t.after(() => { submitOutboundResult = null; });
  const replay = await postJson(server.address().port, '/api/messages/send', body, options);

  assert.equal(replay.status, 200);
  assert.equal(replay.json.scheduledId, 88);
  assert.equal(replay.json.sendAt, scheduledFor);
  assert.equal(draftEvents.length, 0, 'a replay must not repeat or roll back prior Draft cleanup');
  assert.equal(outboundSubmissions.length, 2);
  assert.deepEqual(
    outboundSubmissions[0].input.fingerprintSource,
    outboundSubmissions[1].input.fingerprintSource,
  );
});

test('a terminal scheduled replay reports its stored outcome and never offers Undo again', async t => {
  outboundSubmissions.length = 0;
  draftEvents.length = 0;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  t.after(() => { submitOutboundResult = null; });

  const scheduledFor = new Date(Date.now() + 60_000).toISOString();
  const body = {
    from: username,
    to: 'recipient@example.net',
    subject: 'Stored terminal schedule outcome',
    body: 'Do not claim this is queued again.',
    draftUid: '9',
    scheduledFor,
  };
  const expectations = [
    ['completed', 'accepted'],
    ['partial_delivery', 'partial'],
    ['sent_copy_pending', 'accepted'],
    ['delivery_uncertain', 'uncertain'],
    ['failed', 'failed'],
    ['cancelled', 'failed'],
    ['cancel_restore_pending', 'failed'],
  ];
  for (const [status, deliveryStatus] of expectations) {
    submitOutboundResult = {
      id: 88,
      submissionKind: 'scheduled',
      status,
      messageId: '<terminal-scheduled@example.test>',
      sendAt: new Date(scheduledFor),
      smtpAccepted: ['completed', 'partial_delivery', 'sent_copy_pending'].includes(status),
      saveSentCopy: true,
      rejectedRecipients: status === 'partial_delivery' ? ['rejected@example.net'] : [],
      lastErrorCode: status,
      replayed: true,
    };
    const replay = await postJson(
      server.address().port,
      '/api/messages/send',
      body,
      { headers: { 'Idempotency-Key': `terminal-scheduled-${status}` } },
    );
    assert.equal(replay.status, 200, status);
    assert.equal(replay.json.deliveryStatus, deliveryStatus, status);
    assert.equal(replay.json.scheduledId, undefined, status);
    assert.notEqual(replay.json.message, 'Message scheduled', status);
  }
  assert.equal(draftEvents.length, 0);
});

test('scheduled send rejects malformed, negative, fractional, and excessive delays before persistence', async t => {
  smtpPayloads.length = 0;
  outboundSubmissions.length = 0;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  for (const delaySeconds of ['-1', '1.5', '30 seconds', '999999999999999999999']) {
    const response = await postJson(server.address().port, '/api/messages/send', {
      from: username,
      to: 'recipient@example.net',
      subject: 'Invalid scheduled delay',
      body: 'Must not be sent or persisted.',
      delaySeconds,
    });
    assert.equal(response.status, 400, delaySeconds);
    assert.equal(response.json.code, 'OUTBOUND_MESSAGE_INVALID', delaySeconds);
  }
  assert.equal(smtpPayloads.length, 0);
  assert.equal(outboundSubmissions.length, 0);
});

test('scheduled send requires one canonical absolute delivery instant', async t => {
  outboundSubmissions.length = 0;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  for (const scheduledFor of [undefined, 'tomorrow', '2026-08-15T12:00:00Z', '9999-01-01T00:00:00.000Z']) {
    const response = await postJson(server.address().port, '/api/messages/send', {
      from: username,
      to: 'recipient@example.net',
      subject: 'Invalid absolute schedule',
      body: 'Must not persist.',
      delaySeconds: '30',
      ...(scheduledFor === undefined ? {} : { scheduledFor }),
    });
    assert.equal(response.status, 400, String(scheduledFor));
    assert.equal(response.json.code, 'OUTBOUND_MESSAGE_INVALID', String(scheduledFor));
  }
  assert.equal(outboundSubmissions.length, 0);
});

test('scheduled send aborts safely when its superseded Draft cannot be removed', async t => {
  outboundSubmissions.length = 0;
  aborts.length = 0;
  draftDeleteError = new Error('IMAP delete failed');
  t.after(() => { draftDeleteError = null; });
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await postJson(server.address().port, '/api/messages/send', {
    from: username,
    to: 'recipient@example.net',
    subject: 'Do not duplicate this scheduled draft',
    body: 'The queue row must be removed if Draft cleanup fails.',
    draftUid: '9',
    scheduledFor: new Date(Date.now() + 30_000).toISOString(),
  });

  assert.equal(response.status, 500);
  assert.equal(outboundSubmissions.length, 1);
  assert.deepEqual(aborts, [{ id: 88, owner: username }]);
});

test('identities route returns typed alias objects from the same ownership policy', async t => {
  const express = require('express');
  const app = express();
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await getJson(server.address().port, '/api/user/identities');
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, {
    success: true,
    name: 'Owner Name',
    address: username,
    aliases: [{ address: 'alias@example.test', name: 'Owner Name' }],
  });
});

test('scheduled folder discovery and messages preserve legacy and keyed UTC date bases', async t => {
  scheduledQueries.length = 0;
  scheduledRows = [{
    id: 42,
    idempotency_key: null,
    send_at: new Date('2037-01-01T12:04:05.000Z'),
    send_at_utc: '2037-01-02T02:04:05.000Z',
    sender_address: 'alias@example.test',
    status: 'partial_delivery',
    last_error_code: 'partial_recipient_rejection',
    rejected_recipients_json: JSON.stringify(['rejected@example.net', 'REJECTED@example.net', 'invalid']),
    mail_options: JSON.stringify({
      subject: 'Render-safe scheduled message',
      to: 'First Person <first@example.net>, second@example.net',
      cc: 'copy@example.net',
      bcc: 'blind@example.net',
      text: 'Scheduled body',
    }),
  }, {
    id: 43,
    idempotency_key: 'keyed-scheduled-row',
    send_at: new Date('2036-12-31T22:04:05.000Z'),
    send_at_utc: '2037-01-01T12:04:05.000Z',
    sender_address: username,
    status: 'scheduled',
    last_error_code: null,
    rejected_recipients_json: null,
    mail_options: JSON.stringify({
      subject: 'Keyed scheduled message',
      to: 'keyed@example.net',
      text: 'Keyed body',
    }),
  }];
  const express = require('express');
  const app = express();
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const folders = await getJson(server.address().port, '/api/folders');
  assert.equal(folders.status, 200);
  assert.deepEqual(folders.json.folders.find(folder => folder.path === 'SCHEDULED'), {
    path: 'SCHEDULED',
    delimiter: '/',
    unseen: 0,
  });

  const list = await getJson(server.address().port, '/api/folders/SCHEDULED/messages');
  assert.equal(list.status, 200);
  assert.equal(list.json.messages[0].from, 'alias@example.test');
  assert.equal(list.json.messages[0].to, 'First Person <first@example.net>, second@example.net');
  assert.equal(typeof list.json.messages[0].from, 'string');
  assert.equal(typeof list.json.messages[0].to, 'string');
  assert.deepEqual(list.json.messages[0].rejectedRecipients, ['rejected@example.net']);
  assert.equal(
    list.json.messages.find(message => message.id === 42).date,
    '2037-01-01T12:04:05.000Z',
    'legacy null-key rows must preserve mysql2 Date decoding of their local-wall DATETIME',
  );
  assert.equal(
    list.json.messages.find(message => message.id === 43).date,
    '2037-01-01T12:04:05.000Z',
    'keyed rows must use the explicit UTC projection',
  );

  const detail = await getJson(server.address().port, '/api/folders/SCHEDULED/messages/100000042');
  assert.equal(detail.status, 200);
  assert.equal(detail.json.message.from, 'alias@example.test');
  assert.equal(detail.json.message.to, 'First Person <first@example.net>, second@example.net');
  assert.equal(detail.json.message.cc, 'copy@example.net');
  assert.equal(detail.json.message.bcc, 'blind@example.net');
  assert.equal(detail.json.message.date, '2037-01-01T12:04:05.000Z');
  assert.deepEqual(detail.json.message.rejectedRecipients, ['rejected@example.net']);
  for (const field of ['from', 'to', 'cc', 'bcc']) {
    assert.equal(typeof detail.json.message[field], 'string');
  }

  const keyedDetail = await getJson(server.address().port, '/api/folders/SCHEDULED/messages/100000043');
  assert.equal(keyedDetail.status, 200);
  assert.equal(keyedDetail.json.message.date, '2037-01-01T12:04:05.000Z');

  assert.ok(scheduledQueries.length >= 3);
  for (const query of scheduledQueries) {
    assert.match(query.sql, /username = \?/);
    assert.match(query.sql, /submission_kind = 'scheduled'/);
    assert.match(query.sql, /removed_at IS NULL/);
    assert.match(query.sql, /status NOT IN \('completed', 'cancelled'\)/);
    assert.ok(query.params.includes(username));
  }

  scheduledRows = [];
  const emptyFolders = await getJson(server.address().port, '/api/folders');
  assert.equal(emptyFolders.status, 200);
  assert.equal(emptyFolders.json.folders.some(folder => folder.path === 'SCHEDULED'), false);
});

test('undo restores the exact queued payload as a Draft before cancellation completes', async t => {
  cancellations.length = 0;
  draftEvents.length = 0;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const cancelled = await postJson(server.address().port, '/api/messages/undo', { scheduledId: 78 });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.draftUid, 20);
  assert.equal(cancelled.json.draftFolder, 'Drafts');
  const restoredAppend = draftEvents.find(event => event[0] === 'append');
  assert.match(restoredAppend[2].toString('utf8'), /^Bcc: restored-private@example\.net$/mi);
  const conflict = await postJson(server.address().port, '/api/messages/undo', { scheduledId: 77 });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.code, 'SCHEDULED_SEND_IN_PROGRESS');
  assert.equal(cancellations[0].phase, 'claim');
  assert.equal(cancellations[0].id, 78);
  assert.equal(cancellations[1].phase, 'complete');
  assert.equal(cancellations[1].draftUid, 20);
  assert.equal(cancellations[2].phase, 'claim');
  assert.equal(cancellations[2].id, 77);
  assert.equal(cancellations.some(event => event.phase === 'release'), false);
});

test('terminal scheduled messages have an owner-scoped removal contract', async t => {
  removals.length = 0;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const removed = await fetch(`http://127.0.0.1:${server.address().port}/api/messages/scheduled/79`, {
    method: 'DELETE',
  });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).success, true);

  const conflict = await fetch(`http://127.0.0.1:${server.address().port}/api/messages/scheduled/77`, {
    method: 'DELETE',
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'SCHEDULED_MESSAGE_NOT_TERMINAL');

  const missing = await fetch(`http://127.0.0.1:${server.address().port}/api/messages/scheduled/80`, {
    method: 'DELETE',
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(removals, [
    { id: 79, owner: username },
    { id: 77, owner: username },
    { id: 80, owner: username },
  ]);
});
