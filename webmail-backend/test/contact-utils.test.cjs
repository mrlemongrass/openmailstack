const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD = process.env.OMS_DB_PASSWORD || 'dummy';

const { pool } = require('../src/db.js');
const {
  contactEtag,
  contactSyncTokenVersion,
  contactTombstoneDavUids,
  normalizeContactBirthday,
  patchVCardData,
  stampVCardRevision,
} = require('../src/contact-utils.js');

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

test('contact ETags are stable mutation versions and advance with the sync token', () => {
  const base = { id: 7, dav_uid: 'etag-contact', sync_token: 11 };
  assert.equal(contactEtag(base), contactEtag({ ...base, name: 'not needed for the version' }));
  assert.notEqual(contactEtag(base), contactEtag({ ...base, sync_token: 12 }));
});

test('contact birthdays normalize to one canonical full-date representation', () => {
  assert.equal(normalizeContactBirthday('19900203'), '1990-02-03');
  assert.equal(normalizeContactBirthday('2000-02-29'), '2000-02-29');
  assert.equal(normalizeContactBirthday(''), null);
  assert.equal(normalizeContactBirthday(null), null);
  assert.throws(() => normalizeContactBirthday('1900-02-29'), /invalid birthday/i);
  assert.throws(() => normalizeContactBirthday('not-a-date'), /invalid birthday/i);
});

test('yearless RFC vCard birthdays normalize without inventing a year', () => {
  assert.equal(normalizeContactBirthday('--02-29'), '02-29');
  assert.equal(normalizeContactBirthday('--0229'), '02-29');
  assert.equal(normalizeContactBirthday('02-29'), '02-29');
  assert.throws(() => normalizeContactBirthday('--02-30'), /invalid birthday/i);
  assert.throws(() => normalizeContactBirthday('--00-10'), /invalid birthday/i);
});

test('patchVCardData preserves, replaces, and explicitly removes BDAY', () => {
  const source = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'UID:birthday-patch',
    'FN:Birthday Patch',
    'N:Patch;Birthday;;;',
    'item1.BDAY;VALUE=date:19900203',
    'EMAIL:birthday@example.test',
    'END:VCARD',
    '',
  ].join('\r\n');
  const fields = {
    name: 'Birthday Patch',
    first_name: 'Birthday',
    last_name: 'Patch',
    email: 'birthday@example.test',
  };

  const preserved = patchVCardData(source, 'birthday-patch', fields);
  assert.match(preserved, /^item1\.BDAY;VALUE=date:19900203$/m);

  const replaced = patchVCardData(source, 'birthday-patch', {
    ...fields,
    birthday: '2000-02-29',
  });
  assert.match(replaced, /^BDAY:2000-02-29$/m);
  assert.equal((replaced.match(/^(?:[^.:\r\n]+\.)?BDAY(?:;[^:]*)?:/gim) || []).length, 1);

  const removed = patchVCardData(source, 'birthday-patch', {
    ...fields,
    birthday: '',
  });
  assert.doesNotMatch(removed, /^(?:[^.:\r\n]+\.)?BDAY(?:;[^:]*)?:/mi);
});
