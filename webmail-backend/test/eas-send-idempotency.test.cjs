const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createActiveSyncSendMailHttpHandler } = require('../src/eas-send-http.js');
const { ACTIVE_SYNC_ADVERTISED_COMMANDS } = require('../src/eas-protocol.js');
const { WbxmlParser } = require('../src/wbxml/parser.js');
const { WbxmlWriter } = require('../src/wbxml/writer.js');

const rawMime = Buffer.from([
  'From: sender@example.test',
  'To: recipient@example.net',
  'Subject: retry-safe ActiveSync send',
  'Message-ID: <eas-retry@example.test>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'one delivery only',
].join('\r\n'));

function mbUInt(value) {
  const bytes = [value & 0x7f];
  for (let remaining = value >>> 7; remaining > 0; remaining >>>= 7) {
    bytes.unshift((remaining & 0x7f) | 0x80);
  }
  return Buffer.from(bytes);
}

function inlineElement(token, value) {
  return Buffer.concat([
    Buffer.from([token | 0x40, 0x03]),
    Buffer.from(value, 'utf8'),
    Buffer.from([0x00, 0x01]),
  ]);
}

function opaqueElement(token, value) {
  return Buffer.concat([
    Buffer.from([token | 0x40, 0xc3]),
    mbUInt(value.length),
    value,
    Buffer.from([0x01]),
  ]);
}

function officialSendMailWbxml(clientId = 'device-message-7', {
  mime = rawMime,
  saveInSentItems = true,
  accountId = null,
} = {}) {
  // Independent literal encoding from MS-ASWBXML 2.1.2.1.22. Do not use the
  // repository writer here: sharing its tag table would make this test pass
  // when both reader and writer are wrong in the same way.
  return Buffer.concat([
    Buffer.from([0x03, 0x01, 0x6a, 0x00]), // WBXML 1.3, unknown public id, UTF-8, no string table
    Buffer.from([0x00, 0x15, 0x45]), // ComposeMail page, SendMail with content
    inlineElement(0x11, clientId), // ClientId
    ...(accountId ? [inlineElement(0x13, accountId)] : []), // AccountId
    ...(saveInSentItems ? [Buffer.from([0x08])] : []), // SaveInSentItems (empty element)
    opaqueElement(0x10, mime), // Mime
    Buffer.from([0x01]), // SendMail END
  ]);
}

function officialComposeStatus(status) {
  return Buffer.concat([
    Buffer.from([0x03, 0x01, 0x6a, 0x00, 0x00, 0x15, 0x45, 0x52, 0x03]),
    Buffer.from(status, 'utf8'),
    Buffer.from([0x00, 0x01, 0x01]),
  ]);
}

async function postActiveSync(server, body, {
  authorization = `Basic ${Buffer.from('owner@example.test:secret').toString('base64')}`,
  command = 'SendMail',
  deviceId = 'iPhoneABC',
} = {}) {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: address.port,
      path: `/Microsoft-Server-ActiveSync?Cmd=${command}&User=owner%40example.test&DeviceId=${deviceId}&DeviceType=iPhone`,
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/vnd.ms-sync.wbxml',
        'Content-Length': body.length,
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function withSendMailServer(dependencies, run) {
  const handler = createActiveSyncSendMailHttpHandler(dependencies);
  const server = http.createServer(async (request, response) => {
    try {
      if (await handler(request, response)) return;
      response.statusCode = 501;
      response.end();
    } catch (error) {
      response.statusCode = 500;
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    await run(server);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function activeSyncDependencies(overrides = {}) {
  return {
    normalizeUsername: value => String(value).trim().toLowerCase(),
    validateDeviceId: value => /^[A-Za-z0-9]{1,32}$/.test(String(value || '')) ? String(value) : null,
    async authenticate() { return true; },
    async authorizeSender(_username, requestedFrom) {
      return { address: requestedFrom, name: 'Owner' };
    },
    async submit() {
      return {
        replayed: false,
        status: 'completed',
        smtpAccepted: true,
        rejectedRecipients: [],
      };
    },
    ...overrides,
  };
}

test('official ComposeMail page-21 tokens decode ClientId and Mime without aliases', () => {
  const decoded = new WbxmlParser(officialSendMailWbxml()).parse();
  const child = tag => decoded.children.find(node => node.tag === tag);

  assert.equal(decoded.tag, 'SendMail');
  assert.equal(child('ClientId')?.content, 'device-message-7');
  assert.equal(child('SaveInSentItems')?.content, undefined);
  assert.deepEqual(child('Mime')?.content, rawMime);
  assert.equal(child('InstanceId'), undefined);
});

test('ComposeMail failures can encode Message PreviouslySent and MailSubmissionFailed statuses', () => {
  for (const [command, status] of [
    ['SendMail', '118'],
    ['SendMail', '166'],
    ['SmartReply', '120'],
    ['SmartForward', '120'],
  ]) {
    const writer = new WbxmlWriter();
    writer.writeNode({
      tag: command,
      page: 21,
      children: [{ tag: 'Status', page: 21, content: status }],
    });
    const decoded = new WbxmlParser(writer.getBuffer()).parse();
    assert.equal(decoded.tag, command);
    assert.equal(decoded.children[0]?.tag, 'Status');
    assert.equal(decoded.children[0]?.content, status);
  }
});

test('authenticated ActiveSync SendMail accepts one durable submission over HTTP', async () => {
  const authentications = [];
  const submissions = [];
  await withSendMailServer({
    normalizeUsername: value => String(value).trim().toLowerCase(),
    validateDeviceId: value => /^[A-Za-z0-9]{1,32}$/.test(String(value || '')) ? String(value) : null,
    async authenticate(username, password) {
      authentications.push({ username, password });
      return true;
    },
    async authorizeSender(username, requestedFrom) {
      assert.equal(username, 'owner@example.test');
      assert.equal(requestedFrom, 'sender@example.test');
      return { address: requestedFrom, name: 'Owner' };
    },
    async submit(input) {
      submissions.push(input);
      return {
        id: 41,
        submissionKind: 'immediate',
        status: 'completed',
        messageId: '<eas-retry@example.test>',
        sendAt: new Date('2026-08-16T12:00:00.000Z'),
        smtpAccepted: true,
        saveSentCopy: true,
        rejectedRecipients: [],
        lastErrorCode: null,
        replayed: false,
      };
    },
  }, async server => {
    const response = await postActiveSync(server, officialSendMailWbxml());
    assert.equal(response.status, 200);
    assert.equal(response.body.length, 0);
  });

  assert.deepEqual(authentications, [{ username: 'owner@example.test', password: 'secret' }]);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].origin, 'activesync');
  assert.equal(submissions[0].submissionKind, 'immediate');
  assert.equal(submissions[0].message.username, 'owner@example.test');
  assert.equal(submissions[0].message.saveSentCopy, true);
  assert.deepEqual(submissions[0].message.envelope, {
    from: 'sender@example.test',
    to: ['recipient@example.net'],
  });
});

test('a lost SendMail response and changed-MIME retry remain one durable delivery', async () => {
  let durableRow = null;
  let smtpCalls = 0;
  let sentAppendCalls = 0;
  let smtpSawDurableInflight = false;

  await withSendMailServer(activeSyncDependencies({
    async submit(input) {
      const mime = Buffer.from(input.fingerprintSource.mime);
      if (durableRow) {
        if (!durableRow.mime.equals(mime)) {
          const conflict = new Error('changed request for the same ActiveSync ClientId');
          conflict.code = 'OUTBOUND_IDEMPOTENCY_CONFLICT';
          throw conflict;
        }
        return {
          replayed: true,
          status: durableRow.status,
          smtpAccepted: durableRow.smtpAccepted,
          rejectedRecipients: [],
        };
      }

      durableRow = {
        key: input.idempotencyKey,
        mime,
        status: 'smtp_inflight',
        smtpAccepted: false,
      };
      smtpSawDurableInflight = durableRow.status === 'smtp_inflight';
      smtpCalls += 1;
      durableRow.smtpAccepted = true;
      if (input.message.saveSentCopy) sentAppendCalls += 1;
      durableRow.status = 'completed';
      return {
        replayed: false,
        status: durableRow.status,
        smtpAccepted: true,
        rejectedRecipients: [],
      };
    },
  }), async server => {
    const discarded = await postActiveSync(server, officialSendMailWbxml());
    assert.equal(discarded.status, 200);
    assert.equal(discarded.body.length, 0);

    const retry = await postActiveSync(server, officialSendMailWbxml());
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body, officialComposeStatus('118'));

    const changedMime = Buffer.from(rawMime.toString().replace('one delivery only', 'changed body'));
    const conflict = await postActiveSync(server, officialSendMailWbxml('device-message-7', {
      mime: changedMime,
    }));
    assert.equal(conflict.status, 200);
    assert.deepEqual(conflict.body, officialComposeStatus('118'));
  });

  assert.ok(durableRow);
  assert.match(durableRow.key, /^eas:[0-9a-f]{64}$/);
  assert.equal(smtpSawDurableInflight, true);
  assert.equal(smtpCalls, 1);
  assert.equal(sentAppendCalls, 1);
});

test('bad Basic authentication is 401 and does not reach sender or outbox storage', async () => {
  let authenticateCalls = 0;
  let senderDbCalls = 0;
  let outboxDbCalls = 0;
  await withSendMailServer(activeSyncDependencies({
    async authenticate() { authenticateCalls += 1; return true; },
    async authorizeSender() { senderDbCalls += 1; throw new Error('must not run'); },
    async submit() { outboxDbCalls += 1; throw new Error('must not run'); },
  }), async server => {
    const response = await postActiveSync(server, officialSendMailWbxml(), {
      authorization: 'Basic !!!not-base64!!!',
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.length, 0);
  });
  assert.equal(authenticateCalls, 0);
  assert.equal(senderDbCalls, 0);
  assert.equal(outboxDbCalls, 0);
});

test('malformed WBXML returns ComposeMail 102 without durable work', async () => {
  let outboxDbCalls = 0;
  await withSendMailServer(activeSyncDependencies({
    async submit() { outboxDbCalls += 1; throw new Error('must not run'); },
  }), async server => {
    const response = await postActiveSync(server, Buffer.from([0x03, 0x01]));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, officialComposeStatus('102'));
  });
  assert.equal(outboxDbCalls, 0);
});

test('invalid DeviceId returns ComposeMail 108 without sender or outbox DB access', async () => {
  let senderDbCalls = 0;
  let outboxDbCalls = 0;
  await withSendMailServer(activeSyncDependencies({
    async authorizeSender() { senderDbCalls += 1; throw new Error('must not run'); },
    async submit() { outboxDbCalls += 1; throw new Error('must not run'); },
  }), async server => {
    const response = await postActiveSync(server, officialSendMailWbxml(), {
      deviceId: 'bad-device-id!',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, officialComposeStatus('108'));
  });
  assert.equal(senderDbCalls, 0);
  assert.equal(outboxDbCalls, 0);
});

test('AccountId fails closed with ComposeMail 166 before sender or outbox access', async () => {
  let senderDbCalls = 0;
  let outboxDbCalls = 0;
  await withSendMailServer(activeSyncDependencies({
    async authorizeSender() { senderDbCalls += 1; throw new Error('must not run'); },
    async submit() { outboxDbCalls += 1; throw new Error('must not run'); },
  }), async server => {
    const response = await postActiveSync(server, officialSendMailWbxml('device-message-7', {
      accountId: 'unsupported-account',
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, officialComposeStatus('166'));
  });
  assert.equal(senderDbCalls, 0);
  assert.equal(outboxDbCalls, 0);
});

test('omitting SaveInSentItems accepts delivery without a Sent append', async () => {
  let smtpCalls = 0;
  let sentAppendCalls = 0;
  await withSendMailServer(activeSyncDependencies({
    async submit(input) {
      smtpCalls += 1;
      if (input.message.saveSentCopy) sentAppendCalls += 1;
      return {
        replayed: false,
        status: 'completed',
        smtpAccepted: true,
        rejectedRecipients: [],
      };
    },
  }), async server => {
    const response = await postActiveSync(server, officialSendMailWbxml('device-message-no-sent', {
      saveInSentItems: false,
    }));
    assert.equal(response.status, 200);
    assert.equal(response.body.length, 0);
  });
  assert.equal(smtpCalls, 1);
  assert.equal(sentAppendCalls, 0);
});

test('outbound bridge quarantine returns ComposeMail 120 with no outbox DB or delivery', async () => {
  let senderDbCalls = 0;
  let outboxDbCalls = 0;
  let smtpCalls = 0;
  let sentAppendCalls = 0;
  await withSendMailServer(activeSyncDependencies({
    submissionAvailable() { return false; },
    async authorizeSender() {
      senderDbCalls += 1;
      throw new Error('bridge quarantine must precede sender DB access');
    },
    async submit() {
      outboxDbCalls += 1;
      smtpCalls += 1;
      sentAppendCalls += 1;
      throw new Error('bridge quarantine must precede outbox access');
    },
  }), async server => {
    const response = await postActiveSync(server, officialSendMailWbxml());
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, officialComposeStatus('120'));
  });
  assert.equal(senderDbCalls, 0);
  assert.equal(outboxDbCalls, 0);
  assert.equal(smtpCalls, 0);
  assert.equal(sentAppendCalls, 0);
});

test('SmartReply and SmartForward remain unadvertised and fall through as 501', async () => {
  assert.equal(ACTIVE_SYNC_ADVERTISED_COMMANDS.includes('SmartReply'), false);
  assert.equal(ACTIVE_SYNC_ADVERTISED_COMMANDS.includes('SmartForward'), false);
  await withSendMailServer(activeSyncDependencies(), async server => {
    for (const command of ['SmartReply', 'SmartForward']) {
      const response = await postActiveSync(server, officialSendMailWbxml(), { command });
      assert.equal(response.status, 501);
      assert.equal(response.body.length, 0);
    }
  });
});

test('authenticated SendMail persists smtp_inflight before acceptance on disposable MariaDB', {
  skip: process.env.OMS_EAS_HTTP_DB_TEST !== '1',
  timeout: 30_000,
}, async t => {
  const databaseName = String(process.env.OMS_DB_NAME || '');
  assert.match(databaseName, /(^|[_-])(test|ci|tmp|disposable)([_-]|$)/i,
    'OMS_EAS_HTTP_DB_TEST requires OMS_DB_NAME to identify an isolated disposable database');

  const { pool } = require('../src/db.js');
  const { ensureScheduledEmailsSchema, submitOutbound } = require('../src/scheduled-send.js');
  t.after(async () => {
    try {
      await pool.query('DROP TABLE IF EXISTS outbound_submission_registry');
      await pool.query('DROP TABLE IF EXISTS scheduled_emails');
    } finally {
      await pool.end();
    }
  });

  await pool.query('DROP TABLE IF EXISTS outbound_submission_registry');
  await pool.query('DROP TABLE IF EXISTS scheduled_emails');
  await ensureScheduledEmailsSchema(pool);

  let smtpCalls = 0;
  let sentAppendCalls = 0;
  const deliveryDependencies = {
    async getCredential() {
      throw new Error('the authenticated request credential must be used');
    },
    createTransport() {
      return {
        async sendMail() {
          smtpCalls += 1;
          const [rows] = await pool.query(
            `SELECT status, raw_message, sent_raw_message, smtp_accepted_at
             FROM scheduled_emails
             WHERE username = ? AND submission_kind = 'immediate'`,
            ['owner@example.test'],
          );
          assert.equal(rows.length, 1);
          assert.equal(rows[0].status, 'smtp_inflight');
          assert.ok(Buffer.isBuffer(rows[0].raw_message));
          assert.ok(Buffer.isBuffer(rows[0].sent_raw_message));
          assert.equal(rows[0].smtp_accepted_at, null);
          return { accepted: ['recipient@example.net'], rejected: [] };
        },
        close() {},
      };
    },
    async createImap() {
      return {
        async getFolders() { return [{ path: 'Sent' }]; },
        client: {
          async mailboxOpen() {},
          async search() { return []; },
          close() {},
        },
        async appendMessage(_folder, sentRaw) {
          sentAppendCalls += 1;
          assert.ok(Buffer.isBuffer(sentRaw));
          const [[row]] = await pool.query(
            `SELECT status, smtp_accepted_at
             FROM scheduled_emails
             WHERE username = ? AND submission_kind = 'immediate'`,
            ['owner@example.test'],
          );
          assert.equal(row.status, 'sent_copy_pending');
          assert.ok(row.smtp_accepted_at);
        },
        async logout() {},
      };
    },
    async authorizeSender(username, requestedFrom) {
      assert.equal(username, 'owner@example.test');
      return { address: requestedFrom, name: 'Owner' };
    },
  };

  await withSendMailServer(activeSyncDependencies({
    async authenticate(username, password) {
      return username === 'owner@example.test' && password === 'secret';
    },
    async submit(input) {
      return submitOutbound(pool, input, {
        workerId: 'eas-http-disposable-db',
        dependencies: deliveryDependencies,
      });
    },
  }), async server => {
    const first = await postActiveSync(server, officialSendMailWbxml());
    assert.equal(first.status, 200);
    assert.equal(first.body.length, 0);

    const replay = await postActiveSync(server, officialSendMailWbxml());
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, officialComposeStatus('118'));

    const changedMime = Buffer.from(rawMime.toString().replace('one delivery only', 'changed body'));
    const conflict = await postActiveSync(server, officialSendMailWbxml('device-message-7', {
      mime: changedMime,
    }));
    assert.equal(conflict.status, 200);
    assert.deepEqual(conflict.body, officialComposeStatus('118'));
  });

  assert.equal(smtpCalls, 1);
  assert.equal(sentAppendCalls, 1);
  const [rows] = await pool.query(
    `SELECT status, smtp_accepted_at, sent_copy_completed_at, raw_message, sent_raw_message
     FROM scheduled_emails
     WHERE username = ? AND submission_kind = 'immediate'`,
    ['owner@example.test'],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'completed');
  assert.ok(rows[0].smtp_accepted_at);
  assert.ok(rows[0].sent_copy_completed_at);
  assert.equal(rows[0].raw_message, null);
  assert.equal(rows[0].sent_raw_message, null);
  const [registryRows] = await pool.query(
    `SELECT submission_origin, submission_kind, terminal_status, smtp_accepted,
            save_in_sent_items, hot_row_removed_at, replay_expires_at
     FROM outbound_submission_registry
     WHERE username = ?`,
    ['owner@example.test'],
  );
  assert.equal(registryRows.length, 1);
  assert.equal(registryRows[0].submission_origin, 'activesync');
  assert.equal(registryRows[0].submission_kind, 'immediate');
  assert.equal(registryRows[0].terminal_status, null);
  assert.equal(Number(registryRows[0].smtp_accepted), 0);
  assert.equal(Number(registryRows[0].save_in_sent_items), 1);
  assert.equal(registryRows[0].hot_row_removed_at, null);
  assert.equal(registryRows[0].replay_expires_at, null);
});
