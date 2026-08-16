const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'scheduled-send-test';

const baseRow = (overrides = {}) => ({
  id: 42,
  username: 'user@example.test',
  send_at: new Date('2026-08-15T12:00:00.000Z'),
  mail_options: JSON.stringify({ from: 'user@example.test', to: 'recipient@example.test', text: 'Hello' }),
  draft_uid: null,
  payload_version: 2,
  status: 'claimed',
  available_at: new Date('2026-08-15T12:00:00.000Z'),
  attempts: 1,
  lease_owner: 'worker-1',
  sender_address: 'user@example.test',
  message_id: '<stable@example.test>',
  envelope_json: JSON.stringify({ from: 'user@example.test', to: ['recipient@example.test'] }),
  raw_message: Buffer.from('Message-ID: <stable@example.test>\r\n\r\nHello'),
  smtp_accepted_at: null,
  ...overrides,
});

const processSmtpFailure = async error => {
  const events = [];
  const store = {
    async beginSmtp() { events.push('begin'); },
    async uncertain(_row, _workerId, code) { events.push(['uncertain', code]); },
    async retry(_row, _workerId, code) { events.push(['retry', code]); },
    async failed(_row, _workerId, code) { events.push(['failed', code]); },
  };
  const { processScheduledEmail } = require('../src/scheduled-send.js');
  const outcome = await processScheduledEmail(baseRow(), 'worker-classification', store, {
    async getCredential() { return ''; },
    createTransport() {
      return {
        async sendMail() { throw error; },
        close() {},
      };
    },
    async createImap() { throw new Error('IMAP must not run'); },
    async authorizeSender() { return { address: 'user@example.test', name: 'User' }; },
  });
  return { events, outcome };
};

test('an SMTP-accepted scheduled message reconciles only its Sent copy by Message-ID', async () => {
  const events = [];
  const store = {
    async complete(_row, workerId) { events.push(['complete', workerId]); },
    async sentCopyPending() { events.push(['pending']); },
  };
  const searches = [];
  const imap = {
    client: {
      async mailboxOpen(folder) { events.push(['open', folder]); },
      async search(query) { searches.push(query); return [991]; },
    },
    async getFolders() { return [{ path: 'Sent' }]; },
    async appendMessage() { throw new Error('existing Message-ID must not be appended twice'); },
    async logout() { events.push(['logout']); },
  };
  const { processScheduledEmail } = require('../src/scheduled-send.js');
  const outcome = await processScheduledEmail(
    baseRow({ status: 'sent_copy_pending', smtp_accepted_at: new Date('2026-08-15T12:00:01.000Z') }),
    'worker-1',
    store,
    {
      async getCredential() { return ''; },
      createTransport() { throw new Error('SMTP must never run after acceptance'); },
      async createImap() { return imap; },
      async authorizeSender() { throw new Error('sender reauthorization must not block an accepted Sent copy'); },
    },
  );

  assert.equal(outcome, 'completed');
  assert.deepEqual(searches, [{ header: { 'message-id': '<stable@example.test>' } }]);
  assert.deepEqual(events, [['open', 'Sent'], ['complete', 'worker-1'], ['logout']]);
});

test('a DATA-phase scheduled SMTP failure is retained as delivery uncertain', async () => {
  const events = [];
  const store = {
    async beginSmtp() { events.push('begin'); },
    async uncertain(_row, _workerId, code) { events.push(['uncertain', code]); },
    async retry() { events.push('retry'); },
    async failed() { events.push('failed'); },
  };
  const { processScheduledEmail } = require('../src/scheduled-send.js');
  const outcome = await processScheduledEmail(baseRow(), 'worker-1', store, {
    async getCredential() { return ''; },
    createTransport() {
      return {
        async sendMail() {
          const error = new Error('connection ended during DATA');
          error.code = 'ETIMEDOUT';
          error.command = 'DATA';
          throw error;
        },
        close() {},
      };
    },
    async createImap() { throw new Error('IMAP must not run'); },
    async authorizeSender() { return { address: 'user@example.test', name: 'User' }; },
  });

  assert.equal(outcome, 'delivery_uncertain');
  assert.deepEqual(events, ['begin', ['uncertain', 'ETIMEDOUT:DATA']]);
});

test('an explicit permanent DATA rejection fails once without retry or uncertainty', async () => {
  const events = [];
  const store = {
    async beginSmtp() { events.push('begin'); },
    async uncertain(_row, _workerId, code) { events.push(['uncertain', code]); },
    async retry(_row, _workerId, code) { events.push(['retry', code]); },
    async failed(_row, _workerId, code) { events.push(['failed', code]); },
  };
  const { processScheduledEmail } = require('../src/scheduled-send.js');
  const outcome = await processScheduledEmail(baseRow(), 'worker-data-5xx', store, {
    async getCredential() { return ''; },
    createTransport() {
      return {
        async sendMail() {
          const error = new Error('554 rejected for private-recipient@example.test');
          error.code = 'EMESSAGE';
          error.command = 'DATA';
          error.responseCode = 554;
          throw error;
        },
        close() {},
      };
    },
    async createImap() { throw new Error('IMAP must not run'); },
    async authorizeSender() { return { address: 'user@example.test', name: 'User' }; },
  });

  assert.equal(outcome, 'failed');
  assert.deepEqual(events, ['begin', ['failed', 'EMESSAGE:DATA:554']]);
  assert.doesNotMatch(JSON.stringify(events), /private-recipient/i);
});

for (const scenario of [
  { name: 'all-recipient RCPT 550 rejection', code: 'EENVELOPE', command: 'RCPT', responseCode: 550 },
  { name: 'AUTH 535 rejection', code: 'EAUTH', command: 'AUTH', responseCode: '535' },
]) {
  test(`${scenario.name} is terminal on its first attempt`, async () => {
    const error = new Error(`server rejected private-recipient@example.test during ${scenario.command}`);
    Object.assign(error, scenario);
    const { events, outcome } = await processSmtpFailure(error);

    assert.equal(outcome, 'failed');
    assert.deepEqual(events, [
      'begin',
      ['failed', `${scenario.code}:${scenario.command}:${scenario.responseCode}`],
    ]);
    assert.doesNotMatch(JSON.stringify(events), /private-recipient/i);
  });
}

for (const scenario of [
  { name: 'temporary RCPT rejection', code: 'EENVELOPE', command: 'RCPT', responseCode: 450 },
  { name: 'temporary DATA rejection', code: 'EMESSAGE', command: 'DATA', responseCode: 451 },
  { name: 'pre-DATA connection failure', code: 'ECONNECTION', command: 'CONN' },
]) {
  test(`${scenario.name} remains safe to retry`, async () => {
    const error = new Error(`temporary server detail for private-recipient@example.test`);
    Object.assign(error, scenario);
    const { events, outcome } = await processSmtpFailure(error);
    const expectedCode = [scenario.code, scenario.command, scenario.responseCode]
      .filter(value => value !== undefined)
      .join(':');

    assert.equal(outcome, 'retry_wait');
    assert.deepEqual(events, ['begin', ['retry', expectedCode]]);
    assert.doesNotMatch(JSON.stringify(events), /private-recipient/i);
  });
}

test('a connection loss during DATA without a server response stays delivery uncertain', async () => {
  const error = new Error('connection lost after private-recipient@example.test DATA');
  error.code = 'ECONNRESET';
  error.command = 'DATA';
  const { events, outcome } = await processSmtpFailure(error);

  assert.equal(outcome, 'delivery_uncertain');
  assert.deepEqual(events, ['begin', ['uncertain', 'ECONNRESET:DATA']]);
  assert.doesNotMatch(JSON.stringify(events), /private-recipient/i);
});

test('partial scheduled SMTP acceptance becomes terminal without retrying accepted recipients', async () => {
  const events = [];
  let smtpCalls = 0;
  const row = baseRow({
    envelope_json: JSON.stringify({
      from: 'user@example.test',
      to: ['recipient@example.test', 'rejected@example.test'],
    }),
  });
  const store = {
    async beginSmtp() { events.push(['begin']); },
    async accepted(current) {
      events.push(['accepted', JSON.parse(current.rejected_recipients_json)]);
    },
    async renewSentCopyLease() { events.push(['renew']); },
    async complete() { events.push(['complete']); },
    async retry() { events.push(['retry']); },
  };
  const imap = {
    client: {
      async mailboxOpen() {},
      async search() { return []; },
    },
    async getFolders() { return [{ path: 'Sent' }]; },
    async appendMessage() {},
    async logout() {},
  };
  const { processScheduledEmail } = require('../src/scheduled-send.js');
  const outcome = await processScheduledEmail(row, 'worker-partial', store, {
    async getCredential() { return ''; },
    createTransport() {
      return {
        async sendMail() {
          smtpCalls += 1;
          return {
            accepted: ['recipient@example.test'],
            rejected: ['rejected@example.test'],
          };
        },
        close() {},
      };
    },
    async createImap() { return imap; },
    async authorizeSender() { return { address: 'user@example.test', name: 'User' }; },
  });

  assert.equal(outcome, 'partial_delivery');
  assert.equal(smtpCalls, 1);
  assert.deepEqual(events, [
    ['begin'],
    ['accepted', ['rejected@example.test']],
    ['renew'],
    ['complete'],
  ]);
});

test('accepted no-Sent-copy submissions complete without opening IMAP', async () => {
  const events = [];
  const store = {
    async beginSmtp() { events.push('begin'); },
    async accepted() { events.push('accepted'); },
    async renewSentCopyLease() { events.push('renew'); },
    async complete() { events.push('complete'); },
  };
  const { processScheduledEmail } = require('../src/scheduled-send.js');
  const outcome = await processScheduledEmail(
    baseRow({ save_in_sent_items: 0 }),
    'worker-no-sent-copy',
    store,
    {
      async getCredential() { events.push('credential'); return 'request-secret'; },
      createTransport() {
        return {
          async sendMail() { events.push('smtp'); return { accepted: ['recipient@example.test'], rejected: [] }; },
          close() {},
        };
      },
      async createImap() { throw new Error('IMAP must not open when SaveInSentItems is false'); },
      async authorizeSender() { events.push('authorize'); return { address: 'user@example.test', name: 'User' }; },
      async onAccepted(_row, recipients) { events.push(['side-effect', recipients]); },
    },
  );

  assert.equal(outcome, 'completed');
  assert.deepEqual(events, [
    'authorize',
    'credential',
    'begin',
    'smtp',
    'accepted',
    ['side-effect', ['recipient@example.test']],
    'renew',
    'complete',
  ]);
});

test('no-Sent-copy crash recovery completes without credentials, SMTP, or IMAP', async () => {
  const events = [];
  const store = {
    async renewSentCopyLease() { events.push('renew'); },
    async complete() { events.push('complete'); },
  };
  const { processScheduledEmail } = require('../src/scheduled-send.js');
  const outcome = await processScheduledEmail(
    baseRow({
      status: 'sent_copy_pending',
      smtp_accepted_at: new Date('2026-08-15T12:00:01.000Z'),
      save_in_sent_items: 0,
    }),
    'worker-no-sent-recovery',
    store,
    {
      async getCredential() { throw new Error('credentials must not load after acceptance'); },
      createTransport() { throw new Error('SMTP must never rerun after acceptance'); },
      async createImap() { throw new Error('IMAP must not open when SaveInSentItems is false'); },
      async authorizeSender() { throw new Error('sender authorization must not rerun'); },
    },
  );

  assert.equal(outcome, 'completed');
  assert.deepEqual(events, ['renew', 'complete']);
});

test('a legacy scheduled row is authorized from its stored From and materialized once before SMTP', async () => {
  const smtpPayloads = [];
  const appended = [];
  let authorizedFrom = '';
  const row = baseRow({
    payload_version: 1,
    sender_address: 'user@example.test',
    message_id: null,
    envelope_json: null,
    raw_message: null,
    mail_options: JSON.stringify({
      from: 'User Name <alias@example.test>',
      to: 'recipient@example.test',
      subject: 'Legacy payload',
      body: 'Legacy body',
      inReplyTo: '<parent@example.test>',
      references: ['<root@example.test>'],
    }),
  });
  const events = [];
  const store = {
    async materialize(materialized) {
      events.push('materialize');
      assert.ok(Buffer.isBuffer(materialized.raw_message));
      assert.equal(materialized.sender_address, 'alias@example.test');
    },
    async beginSmtp() { events.push('begin'); },
    async accepted() { events.push('accepted'); },
    async complete() { events.push('complete'); },
  };
  const imap = {
    client: {
      async mailboxOpen() {},
      async search() { return []; },
    },
    async getFolders() { return [{ path: 'Sent' }]; },
    async appendMessage(_folder, raw) { appended.push(Buffer.from(raw)); },
    async logout() {},
  };
  const { processScheduledEmail } = require('../src/scheduled-send.js');
  const outcome = await processScheduledEmail(row, 'worker-1', store, {
    async getCredential() { return ''; },
    createTransport() {
      return {
        async sendMail(payload) { smtpPayloads.push(payload); },
        close() {},
      };
    },
    async createImap() { return imap; },
    async authorizeSender(_username, sender) {
      authorizedFrom = sender;
      return { address: 'alias@example.test', name: 'User Name' };
    },
  });

  assert.equal(outcome, 'completed');
  assert.equal(authorizedFrom, 'alias@example.test');
  assert.deepEqual(events, ['materialize', 'begin', 'accepted', 'complete']);
  assert.equal(smtpPayloads.length, 1);
  assert.equal(appended.length, 1);
  assert.deepEqual(smtpPayloads[0].raw, appended[0]);
});

test('Sent-copy IMAP work times out below the lease and closes the stale client before retry', { timeout: 500 }, async () => {
  const events = [];
  const store = {
    async sentCopyPending(_row, _workerId, code) { events.push(['pending', code]); },
  };
  const imap = {
    client: {
      async mailboxOpen() {},
      async search() { return new Promise(() => {}); },
      close() { events.push(['close']); },
    },
    async getFolders() { return [{ path: 'Sent' }]; },
    async appendMessage() { events.push(['append']); },
    async logout() {},
  };
  const { processScheduledEmail } = require('../src/scheduled-send.js');
  const outcome = await processScheduledEmail(
    baseRow({ status: 'sent_copy_pending', smtp_accepted_at: new Date() }),
    'worker-timeout',
    store,
    {
      operationTimeoutMs: 20,
      async getCredential() { return ''; },
      createTransport() { throw new Error('SMTP must not run'); },
      async createImap() { return imap; },
      async authorizeSender() { throw new Error('authorization must not rerun'); },
    },
  );

  assert.equal(outcome, 'sent_copy_pending');
  assert.deepEqual(events, [['close'], ['pending', 'ETIMEDOUT']]);
});

test('Sent-copy credential lookup is bounded and cannot outlive its lease', { timeout: 500 }, async () => {
  const events = [];
  const store = {
    async sentCopyPending(_row, _workerId, code) { events.push(['pending', code]); },
    async renewSentCopyLease() { events.push(['renew']); },
  };
  const { processScheduledEmail } = require('../src/scheduled-send.js');
  const outcome = await processScheduledEmail(
    baseRow({ status: 'sent_copy_pending', smtp_accepted_at: new Date() }),
    'worker-credential-timeout',
    store,
    {
      operationTimeoutMs: 20,
      async getCredential() { return new Promise(() => {}); },
      createTransport() { throw new Error('SMTP must not run'); },
      async createImap() { throw new Error('IMAP must not run'); },
      async authorizeSender() { throw new Error('authorization must not rerun'); },
    },
  );

  assert.equal(outcome, 'sent_copy_pending');
  assert.deepEqual(events, [['pending', 'ETIMEDOUT']]);
});

test('Sent-copy ownership is revalidated and its lease renewed immediately before IMAP', async () => {
  const events = [];
  const store = {
    async renewSentCopyLease(_row, workerId) { events.push(['renew', workerId]); },
    async complete() { events.push(['complete']); },
  };
  const imap = {
    client: {
      async mailboxOpen() { events.push(['open']); },
      async search() { return [81]; },
    },
    async getFolders() { return [{ path: 'Sent' }]; },
    async appendMessage() { throw new Error('existing Message-ID must not be appended'); },
    async logout() {},
  };
  const { processScheduledEmail } = require('../src/scheduled-send.js');
  const outcome = await processScheduledEmail(
    baseRow({ status: 'sent_copy_pending', smtp_accepted_at: new Date() }),
    'worker-renew',
    store,
    {
      async getCredential() { events.push(['credential']); return ''; },
      createTransport() { throw new Error('SMTP must not run'); },
      async createImap() { events.push(['imap']); return imap; },
      async authorizeSender() { throw new Error('authorization must not rerun'); },
    },
  );

  assert.equal(outcome, 'completed');
  assert.deepEqual(events, [
    ['credential'],
    ['renew', 'worker-renew'],
    ['imap'],
    ['open'],
    ['complete'],
  ]);
});

test('transient sender-authorization storage errors retry without SMTP', async () => {
  const events = [];
  const store = {
    async retry(_row, _workerId, code) { events.push(['retry', code]); },
    async failed() { events.push(['failed']); },
  };
  const { processScheduledEmail } = require('../src/scheduled-send.js');
  const outcome = await processScheduledEmail(baseRow(), 'worker-auth-retry', store, {
    async getCredential() { throw new Error('credentials must not load'); },
    createTransport() { throw new Error('SMTP must not run'); },
    async createImap() { throw new Error('IMAP must not run'); },
    async authorizeSender() {
      const error = new Error('database lock wait timed out');
      error.code = 'ER_LOCK_WAIT_TIMEOUT';
      throw error;
    },
  });

  assert.equal(outcome, 'retry_wait');
  assert.deepEqual(events, [['retry', 'ER_LOCK_WAIT_TIMEOUT']]);
});

test('a malformed stored envelope fails before the SMTP-inflight boundary', async () => {
  const events = [];
  const store = {
    async beginSmtp() { events.push('begin'); },
    async failed(_row, _workerId, code) { events.push(['failed', code]); },
    async uncertain() { events.push('uncertain'); },
  };
  const { processScheduledEmail } = require('../src/scheduled-send.js');
  const outcome = await processScheduledEmail(
    baseRow({ envelope_json: '{"from":"user@example.test","to":[]}' }),
    'worker-invalid-envelope',
    store,
    {
      async getCredential() { return ''; },
      createTransport() { throw new Error('transport must not be constructed'); },
      async createImap() { throw new Error('IMAP must not run'); },
      async authorizeSender() { return { address: 'user@example.test', name: 'User' }; },
    },
  );

  assert.equal(outcome, 'failed');
  assert.deepEqual(events, [['failed', 'invalid_payload']]);
});
