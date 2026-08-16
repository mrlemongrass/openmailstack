const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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

function officialSendMailWbxml(clientId = 'device-message-7') {
  // Independent literal encoding from MS-ASWBXML 2.1.2.1.22. Do not use the
  // repository writer here: sharing its tag table would make this test pass
  // when both reader and writer are wrong in the same way.
  return Buffer.concat([
    Buffer.from([0x03, 0x01, 0x6a, 0x00]), // WBXML 1.3, unknown public id, UTF-8, no string table
    Buffer.from([0x00, 0x15, 0x45]), // ComposeMail page, SendMail with content
    inlineElement(0x11, clientId), // ClientId
    Buffer.from([0x08]), // SaveInSentItems (empty element)
    opaqueElement(0x10, rawMime), // Mime
    Buffer.from([0x01]), // SendMail END
  ]);
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

test('ActiveSync compose submission delegates through the durable outbox instead of owning SMTP', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  const start = source.indexOf("if (cmd === 'SendMail')");
  const end = source.indexOf("if (cmd === 'MoveItems')", start);
  assert.ok(start >= 0 && end > start, 'ActiveSync compose route must remain inspectable');
  const branch = source.slice(start, end);

  assert.match(branch, /validateActiveSyncDeviceId\(req\.query\.DeviceId\)/);
  assert.match(branch, /if \(parsedRequest\.accountId\) return sendComposeStatus\('166'\)/);
  assert.match(branch, /await submitOutbound\(/);
  assert.match(branch, /authorizeOutboundSender\(pool, creds\.user, prepared\.envelope\.from\)/);
  assert.match(branch, /senderAddress: sender\.address/);
  assert.match(branch, /envelope: \{ \.\.\.prepared\.envelope, from: sender\.address \}/);
  assert.match(branch, /saveSentCopy: parsedRequest\.saveInSentItems/);
  assert.match(branch, /raw: prepared\.raw/);
  assert.match(branch, /sentRaw: prepared\.sentRaw/);
  assert.match(branch, /requestCredential: creds\.pass/);
  assert.doesNotMatch(branch, /nodemailer|createTransport|transporter\.sendMail/);
});
