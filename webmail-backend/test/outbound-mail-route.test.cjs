const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'outbound-route-test';

const username = 'owner@example.test';
const smtpPayloads = [];
const imapPayloads = [];
const retained = [];
const draftEvents = [];
const enqueued = [];
const cancellations = [];
const removals = [];
const aborts = [];
const scheduledQueries = [];
let scheduledRows = [];
let retainAcceptedCopyError = null;
let smtpResult = { messageId: '<accepted@example.test>' };
let draftDeleteError = null;

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
    if (compact.startsWith('SELECT *')) {
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
scheduled.retainAcceptedSentCopy = async (_pool, message) => {
  if (retainAcceptedCopyError) throw retainAcceptedCopyError;
  retained.push(message);
  return 77;
};
scheduled.enqueueScheduledEmail = async (_pool, message) => {
  enqueued.push(message);
  return 88;
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

const postJson = (port, path, body) => new Promise((resolve, reject) => {
  const raw = Buffer.from(JSON.stringify(body));
  const request = http.request({
    hostname: '127.0.0.1', port, path, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': raw.length },
  }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode,
      json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }));
  });
  request.on('error', reject);
  request.end(raw);
});

const getJson = (port, path) => new Promise((resolve, reject) => {
  const request = http.request({ hostname: '127.0.0.1', port, path }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode,
      json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }));
  });
  request.on('error', reject);
  request.end();
});

test('send keeps Bcc in its retained Sent copy but never in SMTP delivery MIME', async t => {
  smtpPayloads.length = 0;
  imapPayloads.length = 0;
  retained.length = 0;
  retainAcceptedCopyError = null;
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
  assert.equal(response.json.sentCopyStatus, 'pending');
  assert.equal(response.json.scheduledId, 77);
  assert.equal(smtpPayloads.length, 1);
  assert.ok(Buffer.isBuffer(smtpPayloads[0].raw));
  assert.deepEqual(smtpPayloads[0].raw, retained[0].raw);
  assert.deepEqual(imapPayloads[0], retained[0].sentRaw);
  assert.notDeepEqual(smtpPayloads[0].raw, imapPayloads[0]);
  assert.doesNotMatch(smtpPayloads[0].raw.toString('utf8'), /^Bcc:/mi);
  assert.match(imapPayloads[0].toString('utf8'), /^Bcc: private-scheduled@example\.net$/mi);
  assert.deepEqual(smtpPayloads[0].envelope, {
    from: username,
    to: ['recipient@example.net', 'private-scheduled@example.net'],
  });
  assert.match(smtpPayloads[0].raw.toString('utf8'), /In-Reply-To: <parent@example.net>/i);
  assert.match(smtpPayloads[0].raw.toString('utf8'), /Reply body/);
});

test('send reports an unavailable Sent copy when accepted mail cannot be retained for retry', async t => {
  smtpPayloads.length = 0;
  retained.length = 0;
  retainAcceptedCopyError = new Error('database unavailable');
  t.after(() => { retainAcceptedCopyError = null; });
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

  assert.equal(response.status, 200);
  assert.equal(response.json.deliveryStatus, 'accepted');
  assert.equal(response.json.sentCopyStatus, 'unavailable');
  assert.equal(response.json.scheduledId, undefined);
  assert.equal(smtpPayloads.length, 1);
  assert.equal(retained.length, 0);
});

test('send reports exactly which recipients were rejected after partial SMTP acceptance', async t => {
  smtpPayloads.length = 0;
  retained.length = 0;
  smtpResult = {
    accepted: ['accepted@example.net'],
    rejected: ['rejected@example.net'],
  };
  t.after(() => { smtpResult = { messageId: '<accepted@example.test>' }; });
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
  assert.equal(smtpPayloads.length, 1, 'accepted recipients must never be retried');
});

test('send rejects an unowned From address before SMTP', async t => {
  smtpPayloads.length = 0;
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
});

test('send and draft reject malformed draft UIDs before SMTP or IMAP mutation', async t => {
  smtpPayloads.length = 0;
  enqueued.length = 0;
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
  assert.equal(enqueued.length, 0);
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
  enqueued.length = 0;
  draftEvents.length = 0;
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
    subject: 'Scheduled canonical payload',
    body: 'Scheduled body',
    draftUid: '9',
    delaySeconds: '30',
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.scheduledId, 88);
  assert.equal(smtpPayloads.length, 0);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].senderAddress, username);
  assert.deepEqual(draftEvents.find(event => event[0] === 'delete'), ['delete', [9]]);
  assert.ok(Buffer.isBuffer(enqueued[0].raw));
  assert.ok(Buffer.isBuffer(enqueued[0].sentRaw));
  assert.doesNotMatch(enqueued[0].raw.toString('utf8'), /^Bcc:/mi);
  assert.match(enqueued[0].sentRaw.toString('utf8'), /^Bcc: private-scheduled@example\.net$/mi);
  assert.match(enqueued[0].raw.toString('utf8'), new RegExp(
    `Message-ID: ${enqueued[0].messageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'i',
  ));
  assert.doesNotMatch(JSON.stringify(enqueued[0].metadata), /encoding.*base64/i);
});

test('scheduled send rejects malformed, negative, fractional, and excessive delays before persistence', async t => {
  smtpPayloads.length = 0;
  enqueued.length = 0;
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
  assert.equal(enqueued.length, 0);
});

test('scheduled send aborts safely when its superseded Draft cannot be removed', async t => {
  enqueued.length = 0;
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
    delaySeconds: '30',
  });

  assert.equal(response.status, 500);
  assert.equal(enqueued.length, 1);
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

test('scheduled folder discovery and messages stay owner-scoped and use regular mail string fields', async t => {
  scheduledQueries.length = 0;
  scheduledRows = [{
    id: 42,
    send_at: '2026-08-15T18:00:00.000Z',
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

  const detail = await getJson(server.address().port, '/api/folders/SCHEDULED/messages/100000042');
  assert.equal(detail.status, 200);
  assert.equal(detail.json.message.from, 'alias@example.test');
  assert.equal(detail.json.message.to, 'First Person <first@example.net>, second@example.net');
  assert.equal(detail.json.message.cc, 'copy@example.net');
  assert.equal(detail.json.message.bcc, 'blind@example.net');
  assert.deepEqual(detail.json.message.rejectedRecipients, ['rejected@example.net']);
  for (const field of ['from', 'to', 'cc', 'bcc']) {
    assert.equal(typeof detail.json.message[field], 'string');
  }

  assert.ok(scheduledQueries.length >= 3);
  for (const query of scheduledQueries) {
    assert.match(query.sql, /username = \?/);
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
