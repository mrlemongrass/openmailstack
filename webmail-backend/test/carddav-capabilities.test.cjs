process.env.OMS_DB_PASSWORD ||= 'carddav-capabilities-test';
process.env.OMS_DEFAULT_DOMAIN ||= 'example.test';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const user = 'mac@example.test';
const contact = {
  id: 1,
  username: user,
  name: 'Capability Contact',
  email: 'capability@example.test',
  phone: '',
  dav_uid: 'capability-contact',
  sync_token: 1,
  updated_at: new Date('2026-07-30T12:00:00Z'),
  vcard_data: [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'UID:capability-contact',
    'FN:Capability Contact',
    'EMAIL:capability@example.test',
    'END:VCARD',
    '',
  ].join('\r\n'),
};
const schemaFields = [
  'phone',
  'vcard_data',
  'dav_uid',
  'sync_token',
  'created_at',
  'updated_at',
  'emails_json',
  'phones_json',
  'addresses_json',
  'job_title',
  'organization',
  'notes',
  'labels_json',
  'photo_url',
  'is_favorite',
  'prefix',
  'first_name',
  'middle_name',
  'last_name',
  'suffix',
  'nickname',
  'department',
  'birthday',
  'website_url',
  'deleted_at',
];

const db = require('../src/db.js');
db.pool.query = async (sql) => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  if (compact.startsWith('CREATE TABLE')) return [[], []];
  if (compact.startsWith('SHOW COLUMNS FROM contacts')) {
    return [schemaFields.map(Field => ({ Field })), []];
  }
  if (compact.startsWith('SHOW INDEX FROM contacts')) {
    return [[{ Key_name: 'idx_contacts_user_dav_uid' }], []];
  }
  if (compact.startsWith('UPDATE contacts SET dav_uid')) return [{ affectedRows: 0 }, []];
  if (compact.startsWith('SELECT (SELECT COUNT(*) FROM contacts')) {
    return [[{ contact_count: 1, max_sync_token: 1, max_updated_at: 1 }], []];
  }
  if (compact.startsWith('SELECT * FROM contacts WHERE username = ? AND deleted_at IS NULL ORDER BY')) {
    return [[contact], []];
  }
  if (compact.startsWith('SELECT * FROM contacts WHERE username = ? AND deleted_at IS NULL AND sync_token > ?')) {
    return [[], []];
  }
  if (compact.startsWith('SELECT contact_tombstones.*')) return [[], []];
  throw new Error(`Unexpected CardDAV test query: ${compact}`);
};

const imap = require('../src/imap.js');
imap.ImapService.prototype.connect = async function connect() {};
imap.ImapService.prototype.logout = async function logout() {};

const carddavRouter = require('../src/carddav.js').default;
const auth = `Basic ${Buffer.from(`${user}:test-password`).toString('base64')}`;
const propfindBody = [
  '<?xml version="1.0" encoding="utf-8" ?>',
  '<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">',
  '<D:prop>',
  '<D:current-user-principal/>',
  '<D:principal-URL/>',
  '<C:addressbook-home-set/>',
  '<D:current-user-privilege-set/>',
  '</D:prop>',
  '</D:propfind>',
].join('');

test('owner CardDAV collection advertises only implemented create and delete privileges', async (t) => {
  const app = express();
  app.use(express.raw({ type: () => true }));
  app.use('/carddav', carddavRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/carddav`;
  const encodedUser = encodeURIComponent(user);

  const options = await fetch(`${baseUrl}/principals/${encodedUser}/`, {
    method: 'OPTIONS',
    headers: { Authorization: auth },
  });
  assert.equal(options.status, 200);
  assert.match(options.headers.get('dav') || '', /(?:^|, )addressbook(?:,|$)/);
  assert.doesNotMatch(options.headers.get('dav') || '', /(?:^|, )access-control(?:,|$)/);
  assert.match(options.headers.get('allow') || '', /(?:^|, )PUT(?:,|$)/);
  assert.match(options.headers.get('allow') || '', /(?:^|, )DELETE(?:,|$)/);

  const principal = await fetch(`${baseUrl}/principals/${encodedUser}/`, {
    method: 'PROPFIND',
    headers: {
      Authorization: auth,
      Depth: '0',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: propfindBody,
  });
  assert.equal(principal.status, 207);
  assert.match(await principal.text(), /<D:current-user-privilege-set>/);

  const addressBookHome = await fetch(`${baseUrl}/addressbooks/${encodedUser}/`, {
    method: 'PROPFIND',
    headers: {
      Authorization: auth,
      Depth: '0',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: propfindBody,
  });
  assert.equal(addressBookHome.status, 207);
  assert.match(await addressBookHome.text(), /<D:current-user-privilege-set>/);

  const addressBook = await fetch(`${baseUrl}/addressbooks/${encodedUser}/personal/`, {
    method: 'PROPFIND',
    headers: {
      Authorization: auth,
      Depth: '0',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: propfindBody,
  });
  assert.equal(addressBook.status, 207);
  const addressBookXml = await addressBook.text();
  assert.match(addressBookXml, /<D:current-user-privilege-set>/);
  assert.match(addressBookXml, /<D:privilege><D:read\/><\/D:privilege>/);
  assert.doesNotMatch(addressBookXml, /<D:privilege><D:write\/><\/D:privilege>/);
  assert.match(addressBookXml, /<D:privilege><D:bind\/><\/D:privilege>/);
  assert.match(addressBookXml, /<D:privilege><D:unbind\/><\/D:privilege>/);
  assert.doesNotMatch(addressBookXml, /<D:privilege><D:write-content\/><\/D:privilege>/);
  assert.doesNotMatch(addressBookXml, /<D:privilege><D:write-properties\/><\/D:privilege>/);

  const addressBookWithContact = await fetch(`${baseUrl}/addressbooks/${encodedUser}/personal/`, {
    method: 'PROPFIND',
    headers: {
      Authorization: auth,
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: propfindBody,
  });
  assert.equal(addressBookWithContact.status, 207);
  const addressBookWithContactXml = await addressBookWithContact.text();
  assert.match(addressBookWithContactXml, /capability-contact\.vcf/);
  assert.match(addressBookWithContactXml, /<D:privilege><D:write-content\/><\/D:privilege>/);
  assert.doesNotMatch(addressBookWithContactXml, /<D:privilege><D:write\/><\/D:privilege>/);
  assert.doesNotMatch(addressBookWithContactXml, /<D:privilege><D:write-properties\/><\/D:privilege>/);
});

test('macOS home discovery advertises owner and implemented address book reports', async (t) => {
  const app = express();
  app.use(express.raw({ type: () => true }));
  app.use('/carddav', carddavRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const encodedUser = encodeURIComponent(user);
  const macosHomeDiscoveryBody = [
    '<?xml version="1.0" encoding="utf-8" ?>',
    '<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">',
    '<D:prop>',
    '<D:resourcetype/>',
    '<D:owner/>',
    '<D:current-user-privilege-set/>',
    '<D:supported-report-set/>',
    '<D:sync-token/>',
    '</D:prop>',
    '</D:propfind>',
  ].join('');

  const response = await fetch(
    `http://127.0.0.1:${address.port}/carddav/addressbooks/${encodedUser}/`,
    {
      method: 'PROPFIND',
      headers: {
        Authorization: auth,
        Depth: '1',
        'Content-Type': 'application/xml; charset=utf-8',
        'User-Agent': 'macOS/26.5.2 AddressBookCore/2732.600.11',
      },
      body: macosHomeDiscoveryBody,
    },
  );

  assert.equal(response.status, 207);
  const xml = await response.text();
  assert.match(
    xml,
    /<D:owner><D:href>\/carddav\/principals\/mac@example\.test\/<\/D:href><\/D:owner>/,
  );
  assert.match(xml, /<D:supported-report-set>/);
  assert.match(
    xml,
    /<D:supported-report><D:report><C:addressbook-query\/><\/D:report><\/D:supported-report>/,
  );
  assert.match(
    xml,
    /<D:supported-report><D:report><C:addressbook-multiget\/><\/D:report><\/D:supported-report>/,
  );
  assert.match(
    xml,
    /<D:supported-report><D:report><D:sync-collection\/><\/D:report><\/D:supported-report>/,
  );
  assert.doesNotMatch(xml, /<D:privilege><D:write\/><\/D:privilege>/);
});

test('CardDAV sync-collection rejects malformed and future contact tokens', async (t) => {
  const app = express();
  app.use(express.raw({ type: () => true }));
  app.use('/carddav', carddavRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const encodedUser = encodeURIComponent(user);
  const endpoint = `http://127.0.0.1:${address.port}/carddav/addressbooks/${encodedUser}/personal/`;
  for (const invalidToken of ['not-a-contact-token', '1-2-1']) {
    const body = [
      '<?xml version="1.0" encoding="utf-8" ?>',
      '<D:sync-collection xmlns:D="DAV:">',
      `<D:sync-token>${invalidToken}</D:sync-token>`,
      '<D:sync-level>1</D:sync-level>',
      '<D:prop><D:getetag/></D:prop>',
      '</D:sync-collection>',
    ].join('');
    const response = await fetch(endpoint, {
      method: 'REPORT',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body,
    });

    assert.equal(response.status, 403, invalidToken);
    assert.match(await response.text(), /<D:valid-sync-token\s*\/>/);
  }
});
