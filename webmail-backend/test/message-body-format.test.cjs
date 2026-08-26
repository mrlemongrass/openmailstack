const assert = require('node:assert/strict');
const test = require('node:test');
const { simpleParser } = require('mailparser');

test('real MIME parsing preserves authoritative HTML versus plain Draft body mode', async () => {
  const { projectParsedMessageBody } = require('../src/message-body-format.js');
  const htmlMessage = await simpleParser([
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Subject: HTML Draft',
    '',
    '<p>Hello <strong>world</strong></p>',
  ].join('\r\n'));

  assert.equal(htmlMessage.text.trim(), 'Hello world');
  assert.deepEqual(projectParsedMessageBody(htmlMessage), {
    bodyMode: 'rich',
    html: '<p>Hello <strong>world</strong></p>',
    text: 'Hello world',
  });

  const plainMessage = await simpleParser([
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Subject: Plain Draft',
    '',
    'Literal <mailbox@example.test>',
  ].join('\r\n'));
  const projectedPlain = projectParsedMessageBody(plainMessage);

  assert.equal(projectedPlain.bodyMode, 'plain');
  assert.equal(projectedPlain.text.trim(), 'Literal <mailbox@example.test>');
  assert.match(projectedPlain.html, /Literal &lt;mailbox@example\.test&gt;/);
});
