const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildActiveSyncSendMailEnvelope,
  extractActiveSyncSendMailMime,
  summarizeActiveSyncNodeForLog
} = require('../src/eas-send.js');

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
