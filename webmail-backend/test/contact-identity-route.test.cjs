const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'contact-identity-route-test';

const user = 'contact-identity@example.test';
const inserts = [];
let duplicateRows = [];
let carddavContact = null;
let carddavUpdates = 0;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const contactColumns = [
  'phone', 'vcard_data', 'dav_uid', 'sync_token', 'created_at', 'updated_at',
  'emails_json', 'phones_json', 'addresses_json', 'job_title', 'organization',
  'notes', 'labels_json', 'photo_url', 'is_favorite', 'prefix', 'first_name',
  'middle_name', 'last_name', 'suffix', 'nickname', 'department', 'birthday',
  'website_url', 'deleted_at',
];

const db = require('../src/db.js');
db.pool.query = async (sql, params = []) => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();

  if (compact.startsWith('SHOW COLUMNS FROM contacts')) {
    return [contactColumns.map(Field => ({ Field })), []];
  }
  if (compact.startsWith('SHOW INDEX FROM contacts')) {
    return [[{ Key_name: 'idx_contacts_user_dav_uid' }], []];
  }
  if (compact.includes('AS next_sync_token')) {
    return [[{ next_sync_token: inserts.length + 1 }], []];
  }
  if (compact.includes('ORDER BY deleted_at IS NULL DESC, id ASC LIMIT 1')) {
    return [carddavContact ? [carddavContact] : [], []];
  }
  if (compact.includes('dav_uid = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1')) {
    return [carddavContact ? [carddavContact] : [], []];
  }
  if (compact.startsWith('SELECT id FROM calendars')) {
    return [[{ id: 9 }], []];
  }
  if (compact === 'SELECT * FROM contacts WHERE username = ? AND deleted_at IS NULL') {
    return [duplicateRows, []];
  }
  if (compact.startsWith('INSERT INTO contacts')) {
    inserts.push({ sql: compact, params });
    return [{ insertId: inserts.length, affectedRows: 1 }, []];
  }
  if (compact.startsWith('UPDATE contacts SET name = ?')) {
    carddavUpdates++;
    carddavContact = {
      ...carddavContact,
      name: params[0],
      email: params[1],
      phone: params[2],
      vcard_data: params[3],
      sync_token: params[16],
    };
    return [{ affectedRows: 1 }, []];
  }
  if (
    compact.startsWith('CREATE TABLE IF NOT EXISTS')
    || compact.startsWith('UPDATE contacts SET dav_uid')
    || compact.startsWith('DELETE FROM contacts WHERE deleted_at')
    || compact.startsWith('DELETE FROM contact_tombstones')
    || compact.startsWith('DELETE FROM events WHERE calendar_id')
  ) {
    return [{ affectedRows: 0 }, []];
  }

  throw new Error(`Unexpected contact identity query: ${compact}`);
};

const authPath = require.resolve('../src/auth.js');
const auth = require(authPath);
require.cache[authPath].exports = {
  ...auth,
  requireSession: (req, _res, next) => {
    req.user = { username: user, password: 'test-only', isAdmin: false };
    next();
  },
};

const indexPath = require.resolve('../src/index.js');
require.cache[indexPath] = {
  id: indexPath,
  filename: indexPath,
  loaded: true,
  exports: { io: { to: () => ({ emit: () => {} }) } },
};

const { appsApiRouter } = require('../src/apps-api.js');
const { saveContactFromVCard } = require('../src/contact-utils.js');
const originalSetInterval = global.setInterval;
global.setInterval = () => ({ unref() {} });
const { apiRouter } = require('../src/api.js');
global.setInterval = originalSetInterval;

function postJson(port, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('new web contacts persist a globally unique vCard identity', async t => {
  inserts.length = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await postJson(server.address().port, '/api/apps/contacts', {
    name: 'Legacy Contact',
    phone: '+1 602 555 1212',
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.success, true);
  assert.equal(inserts.length, 1);

  const inserted = inserts[0];
  const vcard = inserted.params[4];
  const davUid = inserted.params[5];
  assert.match(davUid, uuidPattern);
  assert.match(vcard, new RegExp(`^UID:${davUid}$`, 'm'));
  assert.doesNotMatch(davUid, /^contact-/);
});

test('new web contacts normalize supplied vCard data before storing it', async t => {
  inserts.length = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await postJson(server.address().port, '/api/apps/contacts', {
    name: 'Legacy Contact',
    email: 'legacy@example.test',
    vcard_data: 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Legacy Contact\r\nEMAIL:legacy@example.test\r\nEND:VCARD\r\n',
  });

  assert.equal(response.status, 200);
  assert.equal(inserts.length, 1);

  const vcard = inserts[0].params[4];
  const davUid = inserts[0].params[5];
  assert.match(davUid, uuidPattern);
  assert.match(vcard, new RegExp(`^UID:${davUid}$`, 'm'));
});

test('CSV imports persist UUID-backed CardDAV and vCard identities', async t => {
  inserts.length = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await postJson(server.address().port, '/api/apps/contacts-import', {
    format: 'csv',
    data: 'Name,Email,Phone\nLegacy Contact,legacy@example.test,+1 602 555 1212',
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.imported, 1);
  assert.equal(inserts.length, 1);

  const inserted = inserts[0];
  const vcard = inserted.params[7];
  const davUid = inserted.params[8];

  assert.match(davUid, uuidPattern);
  assert.match(vcard, new RegExp(`^UID:${davUid}$`, 'm'));
  assert.match(vcard, /^EMAIL;TYPE=INTERNET:legacy@example\.test$/m);
});

test('vCard imports persist a generated UID when absent and preserve one when supplied', async t => {
  inserts.length = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const suppliedUid = '6b6f6f4a-18c6-4b7a-a1df-11c87fa45910';
  const response = await postJson(server.address().port, '/api/apps/contacts-import', {
    format: 'vcard',
    data: [
      'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Legacy Contact\r\nEMAIL:legacy@example.test\r\nEND:VCARD\r\n',
      `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${suppliedUid}\r\nFN:Jamie Example\r\nEMAIL:jamie@example.test\r\nEND:VCARD\r\n`,
    ].join(''),
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.imported, 2);
  assert.equal(inserts.length, 2);

  const generatedVcard = inserts[0].params[9];
  const generatedDavUid = inserts[0].params[15];
  assert.match(generatedDavUid, uuidPattern);
  assert.match(generatedVcard, new RegExp(`^UID:${generatedDavUid}$`, 'm'));

  const preservedVcard = inserts[1].params[9];
  const preservedDavUid = inserts[1].params[15];
  assert.match(preservedDavUid, uuidPattern);
  assert.notEqual(preservedDavUid, suppliedUid);
  assert.match(preservedVcard, new RegExp(`^UID:${suppliedUid}$`, 'm'));
});

test('the compatibility contacts API cannot create a contact without persistent identity', async t => {
  inserts.length = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await postJson(server.address().port, '/api/contacts', {
    name: 'Directory Contact',
    email: 'directory@example.test',
    phone: '+1 602 555 0100',
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.success, true);
  assert.equal(inserts.length, 1);

  const inserted = inserts[0];
  const vcard = inserted.params[4];
  const davUid = inserted.params[5];
  assert.match(davUid, uuidPattern);
  assert.match(vcard, new RegExp(`^UID:${davUid}$`, 'm'));
});

test('duplicate repair keeps the UUID-backed CardDAV contact as primary', async t => {
  duplicateRows = [
    {
      id: 41,
      name: 'Legacy Contact',
      email: '',
      phone: '+1 602 555 1212',
      dav_uid: 'contact-41',
    },
    {
      id: 42,
      name: 'Legacy Contact',
      email: 'legacy@example.test',
      phone: '',
      dav_uid: '2e3e026f-7f99-4647-ac51-79aebe5ebb51',
    },
  ];
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await getJson(server.address().port, '/api/apps/contacts-duplicates');

  assert.equal(response.status, 200);
  assert.equal(response.json.duplicates.length, 1);
  assert.equal(response.json.duplicates[0][0].id, 42);
  assert.equal(response.json.duplicates[0][1].id, 41);
});

test('a CardDAV PUT to the same href updates the existing row', async () => {
  inserts.length = 0;
  carddavUpdates = 0;
  const davUid = '2e3e026f-7f99-4647-ac51-79aebe5ebb51';
  carddavContact = {
    id: 42,
    username: user,
    name: 'Legacy Contact',
    email: '',
    phone: '+1 602 555 1212',
    dav_uid: davUid,
    vcard_data: `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${davUid}\r\nFN:Legacy Contact\r\nTEL:+1 602 555 1212\r\nEND:VCARD\r\n`,
    sync_token: 1,
  };

  const result = await saveContactFromVCard(user, davUid, [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `UID:${davUid}`,
    'FN:Legacy Contact',
    'EMAIL:legacy@example.test',
    'TEL:+1 602 555 1212',
    'END:VCARD',
    '',
  ].join('\r\n'));

  assert.equal(result.created, false);
  assert.equal(result.contact.id, 42);
  assert.equal(result.contact.dav_uid, davUid);
  assert.equal(result.contact.email, 'legacy@example.test');
  assert.equal(carddavUpdates, 1);
  assert.equal(inserts.length, 0);
});
