const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'outbound-mail-test';

test('sender identities contain only the primary mailbox and exact active non-catchall aliases', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (String(sql).includes('FROM mailbox')) return [[{ name: 'Ada Lovelace' }], []];
      if (String(sql).includes('FROM alias')) {
        return [[
          { address: 'Ada.Team@Example.test', goto: 'other@example.test, ADA@example.test', active: 1 },
          { address: '@example.test', goto: 'ada@example.test', active: 1 },
          { address: '*@example.test', goto: 'ada@example.test', active: 1 },
          { address: 'substring@example.test', goto: 'joada@example.test', active: 1 },
          { address: 'disabled@example.test', goto: 'ada@example.test', active: 0 },
          { address: 'duplicate@example.test', goto: 'ada@example.test', active: 1 },
          { address: 'DUPLICATE@example.test', goto: 'ADA@example.test', active: 1 },
        ], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const {
    SenderAuthorizationError,
    authorizeOutboundSender,
    listOwnedSenderIdentities,
  } = require('../src/outbound-mail.js');

  const result = await listOwnedSenderIdentities(db, 'Ada@Example.test');
  assert.equal(result.name, 'Ada Lovelace');
  assert.deepEqual(result.addresses, [
    'ada@example.test',
    'ada.team@example.test',
    'duplicate@example.test',
  ]);
  assert.equal((await authorizeOutboundSender(db, 'Ada@Example.test', 'ADA.TEAM@example.test')).address,
    'ada.team@example.test');
  await assert.rejects(
    authorizeOutboundSender(db, 'Ada@Example.test', 'substring@example.test'),
    error => error instanceof SenderAuthorizationError && error.code === 'SENDER_NOT_AUTHORIZED',
  );
  await assert.rejects(
    authorizeOutboundSender(db, 'Ada@Example.test', '@example.test'),
    error => error instanceof SenderAuthorizationError && error.code === 'SENDER_NOT_AUTHORIZED',
  );
  await assert.rejects(
    authorizeOutboundSender(db, 'Ada@Example.test', '*@example.test'),
    error => error instanceof SenderAuthorizationError && error.code === 'SENDER_NOT_AUTHORIZED',
  );
  assert.ok(queries.some(query => query.sql.includes('active = 1')),
    'inactive aliases must be filtered at the database boundary as well as in memory');
});

test('canonical outbound MIME preserves threading and uses one stable identity for raw bytes and envelope', async () => {
  const { simpleParser } = require('mailparser');
  const { compileOutboundMessage } = require('../src/outbound-mail.js');
  const compiled = await compileOutboundMessage({
    sender: { address: 'ada@example.test', name: 'Ada Lovelace' },
    to: 'Grace Hopper <grace@example.net>',
    cc: 'team@example.net',
    bcc: 'audit@example.net',
    subject: 'Threaded reply',
    body: 'Plain-text compatibility body',
    inReplyTo: 'parent@example.net',
    references: ['root@example.net', '<parent@example.net>'],
    messageId: '<stable-message@example.test>',
    date: new Date('2026-08-15T12:00:00.000Z'),
  });

  assert.equal(compiled.messageId, '<stable-message@example.test>');
  assert.deepEqual(compiled.envelope, {
    from: 'ada@example.test',
    to: ['grace@example.net', 'team@example.net', 'audit@example.net'],
  });
  assert.doesNotMatch(compiled.raw.toString('utf8'), /^Bcc:/mi);

  const parsed = await simpleParser(compiled.raw);
  assert.equal(parsed.messageId, '<stable-message@example.test>');
  assert.equal(parsed.text.trim(), 'Plain-text compatibility body');
  assert.equal(parsed.inReplyTo, '<parent@example.net>');
  assert.deepEqual(parsed.references, ['<root@example.net>', '<parent@example.net>']);
});

test('recipient envelope addresses preserve local-part case while deduplicating case-insensitively', async () => {
  const { compileOutboundMessage } = require('../src/outbound-mail.js');
  const compiled = await compileOutboundMessage({
    sender: { address: 'owner@example.test', name: 'Owner' },
    to: 'CaseSensitive@rare.example, CASESENSITIVE@RARE.EXAMPLE',
    cc: 'OtherRecipient@rare.example',
    subject: 'Preserve recipient identity',
    text: 'Mailbox local parts may be case-sensitive.',
  });

  assert.deepEqual(compiled.envelope, {
    from: 'owner@example.test',
    to: ['CaseSensitive@rare.example', 'OtherRecipient@rare.example'],
  });
});

test('draft MIME can retain Bcc while delivery MIME never exposes it', async () => {
  const { compileOutboundMessage } = require('../src/outbound-mail.js');
  const common = {
    sender: { address: 'owner@example.test', name: 'Owner' },
    to: 'recipient@example.net',
    bcc: 'private-copy@example.net',
    subject: 'Bcc persistence boundary',
    text: 'Drafts must remain editable without leaking Bcc during delivery.',
  };
  const delivery = await compileOutboundMessage(common);
  const draft = await compileOutboundMessage({ ...common, keepBcc: true });

  assert.doesNotMatch(delivery.raw.toString('utf8'), /^Bcc:/mi);
  assert.match(delivery.sentRaw.toString('utf8'), /^Bcc: private-copy@example\.net$/mi);
  assert.match(draft.raw.toString('utf8'), /^Bcc: private-copy@example\.net$/mi);
  assert.deepEqual(draft.sentRaw, draft.raw);
  assert.deepEqual(delivery.envelope, draft.envelope);
});

test('canonical outbound MIME emits iTIP as a text/calendar alternative and .ics attachment', async () => {
  const { simpleParser } = require('mailparser');
  const { compileOutboundMessage } = require('../src/outbound-mail.js');
  const ical = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Test//EN',
    'METHOD:REPLY', 'BEGIN:VEVENT', 'UID:meeting@example.test',
    'DTSTAMP:20260829T183000Z', 'ORGANIZER:mailto:organizer@example.net',
    'ATTENDEE;PARTSTAT=ACCEPTED:mailto:owner@example.test',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const compiled = await compileOutboundMessage({
    sender: { address: 'owner@example.test', name: 'Owner' },
    to: 'organizer@example.net',
    subject: 'Accepted: Planning',
    text: 'Accepted: Planning',
    icalEvent: { method: 'REPLY', filename: 'invite.ics', content: ical },
  });

  const raw = compiled.raw.toString('utf8');
  assert.match(raw, /Content-Type: text\/calendar; charset=utf-8; method=REPLY/i);
  assert.match(raw, /Content-Type: application\/ics/i);
  const parsed = await simpleParser(compiled.raw);
  assert.equal(parsed.attachments.some(attachment => attachment.filename === 'invite.ics'), true);
});

test('SMTP recipient outcomes expose partial rejection without retrying accepted recipients', () => {
  const {
    classifySmtpRecipientOutcome,
    SmtpRecipientsRejectedError,
  } = require('../src/outbound-mail.js');
  const recipients = ['accepted@example.net', 'rejected@example.net'];

  assert.deepEqual(classifySmtpRecipientOutcome({
    accepted: ['accepted@example.net'],
    rejected: ['rejected@example.net'],
  }, recipients), {
    accepted: ['accepted@example.net'],
    rejected: ['rejected@example.net'],
    partial: true,
  });

  assert.throws(
    () => classifySmtpRecipientOutcome({
      accepted: [],
      rejected: recipients,
    }, recipients),
    error => error instanceof SmtpRecipientsRejectedError && error.code === 'EENVELOPE',
  );

  assert.deepEqual(classifySmtpRecipientOutcome({ messageId: '<legacy@example.test>' }, recipients), {
    accepted: recipients,
    rejected: [],
    partial: false,
  });
});


test('inline images and tables survive two MIME draft round trips without duplicate attachments', async () => {
  const { simpleParser } = require('mailparser');
  const { compileOutboundMessage, extractInlineImages } = require('../src/outbound-mail.js');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9L8AAAAASUVORK5CYII=';
  const html = `<p>Hello</p><img src="data:image/png;base64,${png}" alt="Tiny image" width="120"><table border="1"><tr><td>One</td><td>Two</td></tr></table>`;
  const base = { sender: { address: 'owner@example.test' }, to: 'recipient@example.test', subject: 'Rich draft', text: 'Hello' };
  const first = await compileOutboundMessage({ ...base, html });
  const rawParsed = await simpleParser(first.raw, { skipImageLinks: true });
  assert.match(rawParsed.html, /src="cid:/);
  assert.equal(rawParsed.attachments.length, 1);
  assert.equal(rawParsed.attachments[0].contentDisposition, 'inline');
  assert.ok(!rawParsed.attachments[0].filename);
  assert.deepEqual(rawParsed.attachments[0].content, Buffer.from(png, 'base64'));
  const resumed = await simpleParser(first.raw);
  assert.match(resumed.html, /data:image\/png;base64,/);
  const second = await compileOutboundMessage({ ...base, html: resumed.html });
  const again = await simpleParser(second.raw);
  assert.equal(again.attachments.length, 1);
  assert.match(again.html, /<td>Two<\/td>/);
  assert.match(again.html, /alt="Tiny image" width="120"/);
  assert.match(first.metadata.html, /data:image\/png;base64,/);
  assert.throws(() => extractInlineImages('<img src="data:image/svg+xml;base64,PHN2Zz4=">'), /PNG/);
  assert.throws(() => extractInlineImages('<img src="data:image/png;base64,YmFk">'), /valid raster/);
  assert.throws(() => extractInlineImages(Array(21).fill(`<img src="data:image/png;base64,${png}">`).join('')), /20 images/);
});
