const test = require('node:test');
const assert = require('node:assert/strict');
process.env.OMS_DB_PASSWORD ||= 'import-test';
const { parseMailImport } = require('../src/mail-import.js');
test('EML and mboxrd imports preserve raw attachments, dates and escaped From lines', async () => {
 const raw = Buffer.from('From: sender@example.test\r\nSubject: Example\r\nDate: Mon, 14 Sep 2026 10:00:00 +0000\r\nContent-Type: text/plain\r\n\r\nFrom body\r\n>From quoted\r\n');
 const eml = await parseMailImport(raw, 'mail.eml'); assert.equal(eml.length, 1); assert.deepEqual(eml[0].source, raw); assert.equal(eml[0].date, '2026-09-14T10:00:00.000Z');
 const mbox = Buffer.from('From sender@example.test Mon Sep 14 10:00:00 2026\r\n' + raw.toString().replace(/^(>*From )/gm, '>$1'));
 assert.deepEqual((await parseMailImport(mbox, 'mail.mbox'))[0].source, raw);
 assert.equal((await parseMailImport(mbox, 'mail.mbox'))[0].hash, eml[0].hash);
 await assert.rejects(parseMailImport(Buffer.from('garbage'), 'mail.mbox'), /supported/);
 await assert.rejects(parseMailImport(raw, 'mail.zip'), /Choose/);
 await assert.rejects(parseMailImport(Buffer.alloc(0), 'mail.eml'), /1 byte/);
});
