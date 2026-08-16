const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ActiveSyncSendMailRequestError,
  activeSyncSendMailIdempotencyKey,
  activeSyncSendMailResultStatus,
  buildActiveSyncSendMailEnvelope,
  extractActiveSyncSendMailMime,
  parseActiveSyncSendMailRequest,
  prepareActiveSyncSendMailSubmission,
  summarizeActiveSyncNodeForLog
} = require('../src/eas-send.js');
const {
  SenderAuthorizationError,
  authorizeOutboundSender,
} = require('../src/outbound-mail.js');

const rawMime = [
  'From: "Thang" <thang@housevo.us>',
  'To: External Test <recipient@example.net>',
  'Cc: Local Test <localtest@housevo.us>',
  'Subject: ActiveSync send test',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'hello from ios'
].join('\r\n');

test('buildActiveSyncSendMailEnvelope derives SMTP envelope recipients from raw MIME', async () => {
  const envelope = await buildActiveSyncSendMailEnvelope(Buffer.from(rawMime), 'thang@housevo.us');

  assert.equal(envelope.from, 'thang@housevo.us');
  assert.deepEqual(envelope.to, ['recipient@example.net', 'localtest@housevo.us']);
});

test('buildActiveSyncSendMailEnvelope rejects MIME without recipients', async () => {
  const raw = [
    'From: "Thang" <thang@housevo.us>',
    'Subject: Missing recipient',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'no recipient'
  ].join('\r\n');

  await assert.rejects(
    () => buildActiveSyncSendMailEnvelope(raw, 'thang@housevo.us'),
    /no recipients/
  );
});

test('parseActiveSyncSendMailRequest requires one bounded ClientId and official Mime', () => {
  const request = {
    tag: 'SendMail',
    page: 21,
    children: [
      { tag: 'ClientId', page: 21, content: 'message-41' },
      { tag: 'SaveInSentItems', page: 21 },
      { tag: 'Mime', page: 21, content: Buffer.from(rawMime) },
    ],
  };

  assert.deepEqual(parseActiveSyncSendMailRequest(request), {
    clientId: 'message-41',
    mime: Buffer.from(rawMime),
    saveInSentItems: true,
    accountId: null,
  });
  assert.equal(parseActiveSyncSendMailRequest({
    ...request,
    children: request.children.filter(node => node.tag !== 'SaveInSentItems'),
  }).saveInSentItems, false);
  assert.equal(parseActiveSyncSendMailRequest({
    ...request,
    children: [...request.children, { tag: 'AccountId', page: 21, content: 'account-7' }],
  }).accountId, 'account-7');

  for (const malformed of [
    null,
    { ...request, page: 0 },
    { ...request, children: request.children.filter(node => node.tag !== 'ClientId') },
    { ...request, children: [...request.children, { tag: 'ClientId', page: 21, content: 'duplicate' }] },
    { ...request, children: [...request.children, { tag: 'Mime', page: 21, content: Buffer.from(rawMime) }] },
    { ...request, children: [...request.children, { tag: 'SaveInSentItems', page: 21 }] },
    { ...request, children: [...request.children, { tag: 'Source', page: 21 }] },
    { ...request, children: [...request.children, { tag: 'UnknownTag_Page21_0x14', page: 21 }] },
    { ...request, children: request.children.map(node => node.tag === 'ClientId' ? { ...node, content: '' } : node) },
    { ...request, children: request.children.map(node => node.tag === 'ClientId' ? { ...node, content: 'x'.repeat(41) } : node) },
  ]) {
    assert.throws(
      () => parseActiveSyncSendMailRequest(malformed),
      error => error instanceof ActiveSyncSendMailRequestError && error.status === '101',
    );
  }
  assert.throws(
    () => parseActiveSyncSendMailRequest({
      ...request,
      children: request.children.map(node => node.tag === 'Mime' ? { ...node, content: rawMime } : node),
    }),
    error => error instanceof ActiveSyncSendMailRequestError && error.status === '107',
  );
});

test('ActiveSync From identity accepts the primary mailbox and owned aliases but rejects unowned senders', async () => {
  const db = {
    async query(sql) {
      if (String(sql).includes('FROM mailbox')) return [[{ name: 'Owner' }], []];
      if (String(sql).includes('FROM alias')) {
        return [[{ address: 'team@example.test', goto: 'owner@example.test', active: 1 }], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const rawFor = from => Buffer.from([
    `From: ${from}`,
    'To: recipient@example.net',
    'Subject: Authorized identity',
    'Content-Type: text/plain',
    '',
    'body',
  ].join('\r\n'));

  for (const address of ['owner@example.test', 'team@example.test']) {
    const prepared = await prepareActiveSyncSendMailSubmission(
      rawFor(address), 'owner@example.test', 'iPhoneABC', `message-${address}`,
    );
    const sender = await authorizeOutboundSender(db, 'owner@example.test', prepared.envelope.from);
    assert.equal(sender.address, address);
    assert.equal(prepared.envelope.from, address);
  }

  const unowned = await prepareActiveSyncSendMailSubmission(
    rawFor('attacker@example.test'), 'owner@example.test', 'iPhoneABC', 'message-attacker',
  );
  await assert.rejects(
    authorizeOutboundSender(db, 'owner@example.test', unowned.envelope.from),
    error => error instanceof SenderAuthorizationError && error.code === 'SENDER_NOT_AUTHORIZED',
  );
});

test('ActiveSync MIME preparation rejects missing, multiple, or duplicate From identities', async () => {
  for (const fromHeader of [
    '',
    'From: one@example.test, two@example.test\r\n',
    'From: one@example.test\r\nFrom: two@example.test\r\n',
  ]) {
    const raw = Buffer.from([
      fromHeader + 'To: recipient@example.net',
      'Subject: Invalid identity',
      'Content-Type: text/plain',
      '',
      'body',
    ].join('\r\n'));
    await assert.rejects(
      prepareActiveSyncSendMailSubmission(raw, 'owner@example.test', 'iPhoneABC', 'invalid-from'),
      error => error instanceof ActiveSyncSendMailRequestError && error.status === '107',
    );
  }
});

test('ActiveSync idempotency keys are stable and scoped by owner, device, and ClientId', () => {
  const first = activeSyncSendMailIdempotencyKey('Owner@Example.Test', 'iPhoneABC', 'message-41');
  assert.match(first, /^eas:[0-9a-f]{64}$/);
  assert.equal(first, activeSyncSendMailIdempotencyKey('owner@example.test', 'iPhoneABC', 'message-41'));
  assert.notEqual(first, activeSyncSendMailIdempotencyKey('other@example.test', 'iPhoneABC', 'message-41'));
  assert.notEqual(first, activeSyncSendMailIdempotencyKey('owner@example.test', 'iPhoneXYZ', 'message-41'));
  assert.notEqual(first, activeSyncSendMailIdempotencyKey('owner@example.test', 'iPhoneABC', 'message-42'));
});

test('ActiveSync MIME preparation removes folded Bcc and Resent-Bcc only from delivery headers', async () => {
  const originalBody = Buffer.from('Bcc: this is body text, not a header\r\n\x00body bytes', 'latin1');
  const original = Buffer.concat([Buffer.from([
    'From: Owner <owner@example.test>',
    'To: visible@example.net',
    'Bcc: hidden-one@example.net,',
    '\thidden-two@example.net',
    'Resent-Bcc: resent-hidden-one@example.net,',
    ' resent-hidden-two@example.net',
    'Subject: Header privacy',
    'Message-ID: <privacy@example.test>',
    'Content-Type: application/octet-stream',
    '',
    '',
  ].join('\r\n'), 'latin1'), originalBody]);

  const prepared = await prepareActiveSyncSendMailSubmission(
    original, 'owner@example.test', 'iPhoneABC', 'message-41',
  );
  const expectedDelivery = Buffer.concat([Buffer.from([
    'From: Owner <owner@example.test>',
    'To: visible@example.net',
    'Subject: Header privacy',
    'Message-ID: <privacy@example.test>',
    'Content-Type: application/octet-stream',
    '',
    '',
  ].join('\r\n'), 'latin1'), originalBody]);
  const deliveryBoundary = prepared.raw.indexOf(Buffer.from('\r\n\r\n'));
  const originalBoundary = original.indexOf(Buffer.from('\r\n\r\n'));

  assert.ok(deliveryBoundary > 0);
  assert.deepEqual(prepared.raw, expectedDelivery);
  assert.doesNotMatch(prepared.raw.subarray(0, deliveryBoundary).toString('latin1'), /(?:^|\r\n)(?:Bcc|Resent-Bcc):/i);
  assert.deepEqual(prepared.raw.subarray(deliveryBoundary + 4), original.subarray(originalBoundary + 4));
  assert.deepEqual(prepared.sentRaw, original);
  assert.deepEqual(prepared.envelope, {
    from: 'owner@example.test',
    to: ['visible@example.net', 'hidden-one@example.net', 'hidden-two@example.net'],
  });
  assert.equal(prepared.messageId, '<privacy@example.test>');
  assert.ok(prepared.fingerprintSource.attachments[0].content.equals(originalBody));
});

test('ActiveSync MIME preparation adds a deterministic Message-ID without changing body bytes', async () => {
  const original = Buffer.from([
    'From: owner@example.test',
    'To: visible@example.net',
    'Subject: Deterministic identity',
    'Content-Type: text/plain',
    '',
    'unchanged body',
  ].join('\n'));
  const first = await prepareActiveSyncSendMailSubmission(
    original, 'owner@example.test', 'iPhoneABC', 'message-41',
  );
  const retry = await prepareActiveSyncSendMailSubmission(
    original, 'owner@example.test', 'iPhoneABC', 'message-41',
  );
  const otherDevice = await prepareActiveSyncSendMailSubmission(
    original, 'owner@example.test', 'iPhoneXYZ', 'message-41',
  );

  assert.equal(first.messageId, retry.messageId);
  assert.notEqual(first.messageId, otherDevice.messageId);
  assert.match(first.messageId, /^<eas-[0-9a-f]{64}@example\.test>$/);
  for (const prepared of [first, retry, otherDevice]) {
    const boundary = prepared.sentRaw.indexOf(Buffer.from('\n\n'));
    assert.ok(boundary > 0);
    assert.deepEqual(prepared.sentRaw.subarray(boundary + 2), Buffer.from('unchanged body'));
    assert.match(prepared.sentRaw.subarray(0, boundary).toString(), /\nMessage-ID: <eas-/);
  }
});

test('ActiveSync SendMail result statuses distinguish success, partial delivery, replay, and uncertainty', () => {
  const base = {
    replayed: false,
    status: 'completed',
    smtpAccepted: true,
    rejectedRecipients: [],
  };
  assert.equal(activeSyncSendMailResultStatus(base), null);
  assert.equal(activeSyncSendMailResultStatus({ ...base, status: 'sent_copy_pending' }), null);
  assert.equal(activeSyncSendMailResultStatus({
    ...base, status: 'partial_delivery', rejectedRecipients: ['rejected@example.net'],
  }), '116');
  for (const status of ['scheduled', 'retry_wait', 'claimed', 'smtp_inflight']) {
    assert.equal(activeSyncSendMailResultStatus({
      ...base, status, smtpAccepted: false,
    }), null, `fresh durable ${status} work is accepted by the server`);
    assert.equal(activeSyncSendMailResultStatus({
      ...base, replayed: true, status, smtpAccepted: false,
    }), '118', `same-ClientId ${status} replay is already submitted`);
  }
  assert.equal(activeSyncSendMailResultStatus({ ...base, replayed: true }), '118');
  assert.equal(activeSyncSendMailResultStatus({
    ...base, replayed: true, status: 'partial_delivery', rejectedRecipients: ['rejected@example.net'],
  }), '118');
  assert.equal(activeSyncSendMailResultStatus({
    ...base, replayed: true, status: 'delivery_uncertain', smtpAccepted: false,
  }), '120');
  assert.equal(activeSyncSendMailResultStatus({
    ...base, status: 'failed', smtpAccepted: false,
  }), '120');
});

test('extractActiveSyncSendMailMime uses regular Mime content when it contains raw MIME', () => {
  const decoded = {
    tag: 'SendMail',
    page: 21,
    children: [
      { tag: 'Mime', page: 21, content: Buffer.from(rawMime) },
      { tag: 'SaveInSentItems', page: 21 }
    ]
  };

  assert.equal(extractActiveSyncSendMailMime(decoded).toString(), rawMime);
});

test('extractActiveSyncSendMailMime skips iOS client id Mime content and finds raw MIME payload', () => {
  const decoded = {
    tag: 'SendMail',
    page: 21,
    children: [
      { tag: 'Mime', page: 21, content: 'DC4E63D9-B593-4F08-8280-3DED4A58E944' },
      { tag: 'SaveInSentItems', page: 21 },
      { tag: 'InstanceId', page: 21, content: Buffer.from(rawMime) }
    ]
  };

  assert.equal(extractActiveSyncSendMailMime(decoded).toString(), rawMime);
});

test('extractActiveSyncSendMailMime returns empty content when no raw MIME is present', () => {
  const decoded = {
    tag: 'SendMail',
    page: 21,
    children: [
      { tag: 'Mime', page: 21, content: 'DC4E63D9-B593-4F08-8280-3DED4A58E944' },
      { tag: 'SaveInSentItems', page: 21 }
    ]
  };

  assert.equal(extractActiveSyncSendMailMime(decoded), '');
});

test('summarizeActiveSyncNodeForLog omits send command content while preserving shape', () => {
  const decoded = {
    tag: 'SendMail',
    page: 21,
    children: [
      { tag: 'Mime', page: 21, content: Buffer.from(rawMime) }
    ]
  };

  const summary = summarizeActiveSyncNodeForLog(decoded);
  const serialized = JSON.stringify(summary);

  assert.equal(summary.tag, 'SendMail');
  assert.deepEqual(summary.children[0], {
    tag: 'Mime',
    page: 21,
    contentType: 'buffer',
    contentBytes: Buffer.byteLength(rawMime)
  });
  assert.equal(serialized.includes('hello from ios'), false);
  assert.equal(serialized.includes('recipient@example.net'), false);
});
