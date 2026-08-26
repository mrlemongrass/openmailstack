const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'imap-attachment-download-test';

const { ImapService } = require('../src/imap.js');

function attachmentService(content = Buffer.from('pdf contents')) {
  const calls = [];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen(folder) { calls.push(['open', folder]); },
    async fetchOne(range, query, options) {
      calls.push(['structure', range, query, options]);
      return {
        uid: Number(range),
        size: 900 * 1024 * 1024,
        bodyStructure: {
          type: 'multipart/mixed',
          childNodes: [
            { part: '1', type: 'text/plain' },
            {
              part: '2',
              type: 'multipart/related',
              childNodes: [
                { part: '2.1', type: 'text/html' },
                { part: '2.2', type: 'image/png', disposition: 'inline', id: '<inline-image>' },
              ],
            },
            {
              part: '3',
              type: 'application/pdf',
              disposition: 'attachment',
              dispositionParameters: { filename: 'plan.pdf' },
            },
            {
              part: '4',
              type: 'text/csv',
              parameters: { name: 'forecast.csv' },
            },
          ],
        },
      };
    },
    async download(range, part, options) {
      calls.push(['download', range, part, options]);
      return {
        meta: { filename: 'plan.pdf', contentType: 'application/pdf' },
        content: Readable.from([content]),
      };
    },
    async mailboxClose() { calls.push(['close']); },
  };
  return { service, calls };
}

test('attachment download selects one visible body part without fetching the MIME source', async () => {
  const { service, calls } = attachmentService();

  const result = await ImapService.prototype.getAttachmentByUid.call(
    service,
    'Large/Drafts',
    42,
    0,
    25 * 1024 * 1024,
  );

  assert.equal(result.messageFound, true);
  assert.equal(result.attachment.filename, 'plan.pdf');
  assert.equal(result.attachment.contentType, 'application/pdf');
  assert.equal(result.attachment.content.toString('utf8'), 'pdf contents');
  assert.equal(result.attachment.tooLarge, false);
  assert.deepEqual(calls[0], ['open', 'Large/Drafts']);
  assert.deepEqual(calls[1], [
    'structure',
    '42',
    { bodyStructure: true, uid: true },
    { uid: true },
  ]);
  assert.deepEqual(calls[2], [
    'download',
    '42',
    '3',
    { uid: true, maxBytes: (25 * 1024 * 1024) + 1 },
  ]);
  assert.deepEqual(calls[3], ['close']);
  assert.equal(calls.some(call => call[0] === 'source'), false);
});

test('attachment download enforces its decoded part limit and closes the mailbox', async () => {
  const { service, calls } = attachmentService(Buffer.from('12345'));

  const result = await ImapService.prototype.getAttachmentByUid.call(
    service,
    'INBOX',
    99,
    0,
    4,
  );

  assert.equal(result.messageFound, true);
  assert.equal(result.attachment.tooLarge, true);
  assert.equal(result.attachment.content.length, 0);
  assert.deepEqual(calls.at(-1), ['close']);
});

test('attachment download distinguishes a missing message from an unknown visible part', async () => {
  const missingMessage = attachmentService();
  missingMessage.service.client.fetchOne = async () => false;
  const messageResult = await ImapService.prototype.getAttachmentByUid.call(
    missingMessage.service,
    'INBOX',
    7,
    0,
    1024,
  );
  assert.deepEqual(messageResult, { messageFound: false });
  assert.deepEqual(missingMessage.calls.at(-1), ['close']);

  const missingPart = attachmentService();
  const partResult = await ImapService.prototype.getAttachmentByUid.call(
    missingPart.service,
    'INBOX',
    7,
    99,
    1024,
  );
  assert.deepEqual(partResult, { messageFound: true });
  assert.deepEqual(missingPart.calls.at(-1), ['close']);
});

test('attachment IDs follow Mailparser ordering for AMP HTML and delivery-status parts', async () => {
  const structure = {
    type: 'multipart/report',
    childNodes: [
      { part: '1', type: 'text/plain' },
      { part: '2', type: 'text/x-amp-html' },
      { part: '3', type: 'message/delivery-status' },
      {
        part: '4',
        type: 'message/rfc822',
        disposition: 'attachment',
        dispositionParameters: { filename: 'original.eml' },
      },
    ],
  };

  for (const [attachmentId, expectedPart] of [[0, '2'], [1, '4']]) {
    const { service, calls } = attachmentService();
    service.client.fetchOne = async () => ({ uid: 42, bodyStructure: structure });

    const result = await ImapService.prototype.getAttachmentByUid.call(
      service,
      'INBOX',
      42,
      attachmentId,
      1024,
    );

    assert.equal(result.messageFound, true);
    assert.equal(calls.find(call => call[0] === 'download')[2], expectedPart);
    assert.deepEqual(calls.at(-1), ['close']);
  }
});

test('single-part root attachments download through the complete IMAP TEXT section', async () => {
  for (const type of ['application/pdf', 'message/rfc822']) {
    const { service, calls } = attachmentService();
    service.client.fetchOne = async () => ({
      uid: 42,
      bodyStructure: {
        type,
        disposition: 'attachment',
        dispositionParameters: { filename: type === 'application/pdf' ? 'plan.pdf' : 'original.eml' },
        ...(type === 'message/rfc822' ? {
          childNodes: [{
            type: 'multipart/mixed',
            childNodes: [
              { part: '1', type: 'text/plain' },
              {
                part: '2',
                type: 'application/pdf',
                disposition: 'attachment',
                dispositionParameters: { filename: 'nested.pdf' },
              },
            ],
          }],
        } : {}),
      },
    });

    const result = await ImapService.prototype.getAttachmentByUid.call(
      service,
      'Drafts',
      42,
      0,
      1024,
    );

    assert.equal(result.messageFound, true);
    assert.equal(calls.find(call => call[0] === 'download')[2], 'TEXT');
    assert.deepEqual(calls.at(-1), ['close']);
  }
});
