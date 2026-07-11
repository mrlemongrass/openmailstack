const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD = process.env.OMS_DB_PASSWORD || 'dummy';

const { pool } = require('../src/db.js');
const { contactSyncTokenVersion, contactTombstoneDavUids, stampVCardRevision } = require('../src/contact-utils.js');

test.after(async () => {
  await pool.end();
});

test('stampVCardRevision inserts a deterministic REV before END:VCARD', () => {
  const stamped = stampVCardRevision([
    'BEGIN:VCARD',
    'VERSION:3.0',
    'UID:eas-13623',
    'FN:OMS iPhone Contact Test',
    'END:VCARD',
  ].join('\r\n'), new Date('2026-07-10T20:23:01.000Z'));

  assert.match(stamped, /REV:20260710T202301Z\r\nEND:VCARD\r\n$/);
});

test('stampVCardRevision replaces an existing REV line', () => {
  const stamped = stampVCardRevision([
    'BEGIN:VCARD',
    'VERSION:3.0',
    'UID:eas-13623',
    'REV:20260704T000000Z',
    'FN:OMS iPhone Contact Test',
    'END:VCARD',
  ].join('\r\n'), new Date('2026-07-10T20:23:01.000Z'));

  assert.equal(stamped.includes('REV:20260704T000000Z'), false);
  assert.equal((stamped.match(/^REV:/gm) || []).length, 1);
  assert.match(stamped, /REV:20260710T202301Z\r\nEND:VCARD\r\n$/);
});

test('contactSyncTokenVersion parses CardDAV and ActiveSync token formats', () => {
  assert.equal(contactSyncTokenVersion('431-3-1783737781'), 3);
  assert.equal(contactSyncTokenVersion('http://openmailstack.local/carddav/486-27-1783737781'), 27);
  assert.equal(contactSyncTokenVersion('contacts-486-52-1783737781'), 52);
  assert.equal(contactSyncTokenVersion(''), 0);
  assert.equal(contactSyncTokenVersion(null), 0);
});

test('contactTombstoneDavUids includes current and legacy contact href ids', () => {
  assert.deepEqual(
    contactTombstoneDavUids({ dav_uid: 'eas-13623', contact_id: 1485 }),
    ['eas-13623', 'contact-1485']
  );
  assert.deepEqual(
    contactTombstoneDavUids({ dav_uid: 'contact-1485', contact_id: 1485 }),
    ['contact-1485']
  );
});
