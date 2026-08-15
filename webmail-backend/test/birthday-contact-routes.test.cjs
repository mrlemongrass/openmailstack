const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'birthday-contact-routes-test';

const sourceDir = path.join(__dirname, '..', 'src');
const owner = 'birthday-routes@example.test';
const db = require(path.join(sourceDir, 'db.js'));
const originalPoolQuery = db.pool.query;
const originalGetConnection = db.pool.getConnection;

const authPath = require.resolve(path.join(sourceDir, 'auth.js'));
const auth = require(authPath);
require.cache[authPath].exports = {
  ...auth,
  requireSession: (req, _res, next) => {
    req.user = { username: owner, password: 'test-only', isAdmin: false };
    next();
  },
};

const indexPath = require.resolve(path.join(sourceDir, 'index.js'));
require.cache[indexPath] = {
  id: indexPath,
  filename: indexPath,
  loaded: true,
  exports: { io: { to: () => ({ emit: () => {} }) } },
};

const notesSyncPath = require.resolve(path.join(sourceDir, 'notes-imap-sync.js'));
require.cache[notesSyncPath] = {
  id: notesSyncPath,
  filename: notesSyncPath,
  loaded: true,
  exports: { syncNotesWithImap: async () => {} },
};

const { appsApiRouter } = require(path.join(sourceDir, 'apps-api.js'));

function installContactStore(t) {
  const state = {
    contacts: new Map(),
    tombstones: new Map(),
    calendar: null,
    events: new Map(),
    resourceNames: new Map(),
    calendarTombstones: new Map(),
    nextContactId: 1,
    failBirthdayDelete: false,
    commits: 0,
    rollbacks: 0,
  };

  function replaceState(snapshot) {
    state.contacts = snapshot.contacts;
    state.tombstones = snapshot.tombstones;
    state.calendar = snapshot.calendar;
    state.events = snapshot.events;
    state.resourceNames = snapshot.resourceNames;
    state.calendarTombstones = snapshot.calendarTombstones;
    state.nextContactId = snapshot.nextContactId;
  }

  function connection() {
    let snapshot;
    return {
      async query(sql, params = []) {
        const compact = String(sql).replace(/\s+/g, ' ').trim();
        if (compact.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }], []];
        if (compact.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }], []];
        if (compact.includes('AS next_sync_token')) {
          const tokens = [
            ...[...state.contacts.values()].map(contact => Number(contact.sync_token || 0)),
            ...[...state.tombstones.values()].map(row => Number(row.sync_token || 0)),
          ];
          return [[{ next_sync_token: Math.max(0, ...tokens) + 1 }], []];
        }
        if (compact.startsWith('SELECT id, dav_uid, vcard_data FROM contacts WHERE username = ?')) {
          return [[...state.contacts.values()]
            .filter(contact => contact.username === params[0])
            .sort((left, right) => left.id - right.id)
            .slice(0, 3)
            .map(contact => ({ id: contact.id, dav_uid: contact.dav_uid, vcard_data: contact.vcard_data })), []];
        }
        if (compact.includes('deleted_at IS NULL AS is_active') && compact.includes('WHERE username = ? AND dav_uid = ?')) {
          const contact = [...state.contacts.values()]
            .filter(row => row.username === params[0] && row.dav_uid === params[1])
            .sort((left, right) => Number(left.deleted_at === null) - Number(right.deleted_at === null) || left.id - right.id)
            .reverse()[0];
          return [contact ? [{
            id: contact.id,
            dav_uid: contact.dav_uid,
            sync_token: contact.sync_token,
            name: contact.name,
            email: contact.email,
            birthday: contact.birthday,
            is_active: contact.deleted_at === null ? 1 : 0,
          }] : [], []];
        }
        if (compact.startsWith('INSERT INTO contacts (username, name, email, phone, vcard_data, dav_uid, sync_token,')) {
          const id = state.nextContactId++;
          state.contacts.set(id, {
            id,
            username: params[0],
            name: params[1],
            email: params[2],
            phone: params[3],
            vcard_data: params[4],
            dav_uid: params[5],
            sync_token: Number(params[6]),
            emails_json: params[7],
            phones_json: params[8],
            addresses_json: params[9],
            job_title: params[10],
            organization: params[11],
            notes: params[12],
            first_name: params[13],
            last_name: params[14],
            middle_name: params[15],
            prefix: params[16],
            suffix: params[17],
            nickname: params[18],
            department: params[19],
            birthday: params[20],
            website_url: params[21],
            deleted_at: null,
          });
          return [{ insertId: id, affectedRows: 1 }, []];
        }
        if (compact.startsWith('INSERT INTO contacts (username, name, email, phone, job_title, organization, notes,')) {
          const id = state.nextContactId++;
          state.contacts.set(id, {
            id,
            username: params[0],
            name: params[1],
            email: params[2],
            phone: params[3],
            job_title: params[4],
            organization: params[5],
            notes: params[6],
            emails_json: params[7],
            phones_json: params[8],
            vcard_data: params[9],
            prefix: params[10],
            first_name: params[11],
            middle_name: params[12],
            last_name: params[13],
            suffix: params[14],
            dav_uid: params[15],
            sync_token: Number(params[16]),
            birthday: null,
            deleted_at: null,
          });
          return [{ insertId: id, affectedRows: 1 }, []];
        }
        if (compact.startsWith('INSERT INTO contacts')) {
          const id = state.nextContactId++;
          state.contacts.set(id, {
            id,
            username: params[0],
            name: params[1],
            email: params[2],
            phone: params[3],
            vcard_data: params[4],
            dav_uid: params[5],
            emails_json: params[6],
            phones_json: params[7],
            addresses_json: params[8],
            job_title: params[9],
            organization: params[10],
            notes: params[11],
            labels_json: params[12],
            photo_url: params[13],
            sync_token: Number(params[14]),
            prefix: params[15],
            first_name: params[16],
            middle_name: params[17],
            last_name: params[18],
            suffix: params[19],
            nickname: params[20],
            department: params[21],
            birthday: params[22],
            website_url: params[23],
            deleted_at: null,
          });
          return [{ insertId: id, affectedRows: 1 }, []];
        }
        if (compact === 'SELECT * FROM contacts WHERE id=? AND username=? AND deleted_at IS NULL') {
          const contact = state.contacts.get(Number(params[0]));
          return [contact && contact.username === params[1] && contact.deleted_at === null ? [{ ...contact }] : [], []];
        }
        if (compact.startsWith('UPDATE contacts SET name=?')) {
          const id = Number(params[params.length - 2]);
          const user = params[params.length - 1];
          const contact = state.contacts.get(id);
          if (!contact || contact.username !== user || contact.deleted_at !== null) return [{ affectedRows: 0 }, []];
          Object.assign(contact, {
            name: params[0],
            email: params[1],
            phone: params[2],
            vcard_data: params[3],
            emails_json: params[4],
            phones_json: params[5],
            addresses_json: params[6],
            job_title: params[7],
            organization: params[8],
            notes: params[9],
            labels_json: params[10],
            first_name: params[11],
            last_name: params[12],
            middle_name: params[13],
            prefix: params[14],
            suffix: params[15],
            nickname: params[16],
            department: params[17],
            birthday: params[18],
            website_url: params[19],
            sync_token: Number(params[20]),
          });
          return [{ affectedRows: 1 }, []];
        }
        if (compact.startsWith('UPDATE contacts SET name = ?, email = ?, phone = ?, vcard_data = ?,')) {
          const id = Number(params[20]);
          const user = params[21];
          const contact = state.contacts.get(id);
          if (!contact || contact.username !== user) return [{ affectedRows: 0 }, []];
          Object.assign(contact, {
            name: params[0],
            email: params[1],
            phone: params[2],
            vcard_data: params[3],
            emails_json: params[4],
            phones_json: params[5],
            addresses_json: params[6],
            job_title: params[7],
            organization: params[8],
            notes: params[9],
            first_name: params[10],
            last_name: params[11],
            middle_name: params[12],
            prefix: params[13],
            suffix: params[14],
            nickname: params[15],
            department: params[16],
            birthday: params[17],
            website_url: params[18],
            sync_token: Number(params[19]),
            deleted_at: null,
          });
          return [{ affectedRows: 1 }, []];
        }
        if (compact.startsWith('SELECT id, name, email, dav_uid, birthday FROM contacts WHERE id = ?')) {
          const contact = state.contacts.get(Number(params[0]));
          const wantsDeleted = compact.includes('deleted_at IS NOT NULL');
          const matches = contact
            && contact.username === params[1]
            && (wantsDeleted ? contact.deleted_at !== null : contact.deleted_at === null);
          return [matches ? [{ ...contact }] : [], []];
        }
        if (compact.startsWith('SELECT id, name, email, dav_uid, birthday FROM contacts WHERE id IN')) {
          const user = params[params.length - 1];
          const ids = params.slice(0, -1).map(Number);
          return [[...state.contacts.values()]
            .filter(contact => ids.includes(contact.id) && contact.username === user && contact.deleted_at === null)
            .map(contact => ({ ...contact })), []];
        }
        if (compact.startsWith('SELECT id, name, email, dav_uid FROM contacts WHERE id=?')) {
          const contact = state.contacts.get(Number(params[0]));
          return [contact && contact.username === params[1] && contact.deleted_at !== null ? [{ ...contact }] : [], []];
        }
        if (compact.startsWith('UPDATE contacts SET dav_uid = ?, deleted_at = NOW()')) {
          const contact = state.contacts.get(Number(params[2]));
          if (!contact || contact.username !== params[3] || contact.deleted_at !== null) return [{ affectedRows: 0 }, []];
          contact.dav_uid = params[0];
          contact.sync_token = Number(params[1]);
          contact.deleted_at = '2026-08-15 00:00:00';
          return [{ affectedRows: 1 }, []];
        }
        if (compact.startsWith('UPDATE contacts SET deleted_at = NOW(), sync_token = ? WHERE id IN')) {
          const user = params[params.length - 1];
          const ids = params.slice(1, -1).map(Number);
          let affectedRows = 0;
          for (const id of ids) {
            const contact = state.contacts.get(id);
            if (contact && contact.username === user && contact.deleted_at === null) {
              contact.deleted_at = '2026-08-15 00:00:00';
              contact.sync_token = Number(params[0]);
              affectedRows += 1;
            }
          }
          return [{ affectedRows }, []];
        }
        if (compact.startsWith('UPDATE contacts SET dav_uid = ?, deleted_at = NULL')) {
          const contact = state.contacts.get(Number(params[2]));
          if (!contact || contact.username !== params[3] || contact.deleted_at === null) return [{ affectedRows: 0 }, []];
          contact.dav_uid = params[0];
          contact.sync_token = Number(params[1]);
          contact.deleted_at = null;
          return [{ affectedRows: 1 }, []];
        }
        if (compact.startsWith('INSERT INTO contact_tombstones')) {
          state.tombstones.set(params[1], { username: params[0], dav_uid: params[1], sync_token: Number(params[2]) });
          return [{ affectedRows: 1 }, []];
        }
        if (compact.startsWith('DELETE FROM contact_tombstones WHERE username = ?')) {
          return [{ affectedRows: state.tombstones.delete(params[1]) ? 1 : 0 }, []];
        }
        if (compact.startsWith('DELETE FROM contact_group_members WHERE contact_id = ?')) {
          return [{ affectedRows: 0 }, []];
        }
        if (compact.startsWith('DELETE FROM contacts WHERE id=?')) {
          const contact = state.contacts.get(Number(params[0]));
          if (!contact || contact.username !== params[1] || contact.deleted_at === null) return [{ affectedRows: 0 }, []];
          state.contacts.delete(contact.id);
          return [{ affectedRows: 1 }, []];
        }
        if (compact.startsWith('SELECT id FROM calendars')) {
          return [state.calendar ? [{ id: state.calendar.id, sync_token: state.calendar.sync_token }] : [], []];
        }
        if (compact.startsWith('INSERT INTO calendars')) {
          state.calendar = { id: 9, sync_token: 0 };
          return [{ insertId: 9, affectedRows: 1 }, []];
        }
        if (compact.startsWith('SELECT uid, resource_name, ical_data FROM events')) {
          const requested = new Set(params.slice(1));
          return [[...state.events]
            .filter(([uid]) => requested.has(uid))
            .map(([uid, ical_data]) => ({
              uid,
              resource_name: state.resourceNames.get(uid) || uid,
              ical_data,
            })), []];
        }
        if (compact.startsWith('SELECT sync_token FROM calendars')) {
          return [[{ sync_token: state.calendar.sync_token }], []];
        }
        if (compact.startsWith('DELETE FROM events WHERE calendar_id=? AND uid IN')) {
          if (state.failBirthdayDelete) throw new Error('injected birthday delete failure');
          let affectedRows = 0;
          for (const uid of params.slice(1)) {
            if (state.events.delete(uid)) affectedRows += 1;
            state.resourceNames.delete(uid);
          }
          return [{ affectedRows }, []];
        }
        if (compact.startsWith('INSERT INTO events')) {
          const [calendarId, uid, resourceName, ical] = params;
          assert.equal(calendarId, state.calendar.id);
          const previous = state.events.get(uid);
          state.resourceNames.set(uid, resourceName);
          state.events.set(uid, ical);
          return [{ affectedRows: previous === undefined ? 1 : previous === ical ? 0 : 2 }, []];
        }
        if (compact.startsWith('INSERT INTO calendar_tombstones')) {
          state.calendarTombstones.set(params[2], Number(params[3]));
          return [{ affectedRows: 1 }, []];
        }
        if (compact.startsWith('DELETE FROM calendar_tombstones')) {
          return [{ affectedRows: state.calendarTombstones.delete(params[1]) ? 1 : 0 }, []];
        }
        if (compact.startsWith('UPDATE calendars SET sync_token = ?')) {
          if (state.calendar.sync_token !== Number(params[2])) return [{ affectedRows: 0 }, []];
          state.calendar.sync_token = Number(params[0]);
          return [{ affectedRows: 1 }, []];
        }
        if (compact.startsWith('UPDATE calendars SET sync_token=sync_token+1')) {
          state.calendar.sync_token += 1;
          return [{ affectedRows: 1 }, []];
        }
        throw new Error(`Unexpected birthday route query: ${compact}`);
      },
      async beginTransaction() { snapshot = structuredClone(state); },
      async commit() { state.commits += 1; },
      async rollback() {
        state.rollbacks += 1;
        replaceState(snapshot);
      },
      release() {},
      destroy() {},
    };
  }

  const schemaColumns = [
    'phone', 'vcard_data', 'dav_uid', 'sync_token', 'created_at', 'updated_at',
    'emails_json', 'phones_json', 'addresses_json', 'job_title', 'organization',
    'notes', 'labels_json', 'photo_url', 'is_favorite', 'prefix', 'first_name',
    'middle_name', 'last_name', 'suffix', 'nickname', 'department', 'birthday',
    'website_url', 'deleted_at',
  ];
  db.pool.query = async sql => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.startsWith('CREATE TABLE IF NOT EXISTS')) return [{ affectedRows: 0 }, []];
    if (compact === 'SHOW COLUMNS FROM contacts') return [schemaColumns.map(Field => ({ Field })), []];
    if (compact.startsWith('SHOW INDEX FROM contacts')) return [[{ Key_name: 'idx_contacts_user_dav_uid' }], []];
    if (compact.startsWith('UPDATE contacts SET dav_uid')) return [{ affectedRows: 0 }, []];
    throw new Error(`Unexpected non-transaction birthday query: ${compact}`);
  };
  db.pool.getConnection = async () => connection();
  t.after(() => {
    db.pool.query = originalPoolQuery;
    db.pool.getConnection = originalGetConnection;
  });
  return state;
}

function requestJson(server, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath,
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : {},
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

async function withServer(run) {
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    return await run(server);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function contactPayload(overrides = {}) {
  return {
    name: 'Old, Name; Path\\Line',
    email: 'old@example.test',
    phone: '',
    birthday: '1990-01-02',
    ...overrides,
  };
}

test('contact create, rename, soft delete, and restore keep one immutable birthday event', async (t) => {
  const state = installContactStore(t);
  await withServer(async server => {
    const created = await requestJson(server, 'POST', '/api/apps/contacts', contactPayload());
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const id = created.json.id;
    assert.equal(state.events.size, 1);
    const canonicalUid = [...state.events.keys()][0];
    assert.match(canonicalUid, /^birthday-[0-9a-f]{48}@openmailstack$/);
    assert.match(state.events.get(canonicalUid), /^SUMMARY:Old\\, Name\\; Path\\\\Line's Birthday$/m);

    const oldLegacyUid = `birthday-${Buffer.from('old@example.test').toString('hex').slice(0, 32)}@openmailstack`;
    const newLegacyUid = `birthday-${Buffer.from('new@example.test').toString('hex').slice(0, 32)}@openmailstack`;
    state.events.set(oldLegacyUid, 'legacy old');
    state.events.set(newLegacyUid, 'legacy new');
    const updated = await requestJson(server, 'PUT', `/api/apps/contacts/${id}`, contactPayload({
      name: 'New Name',
      email: 'new@example.test',
    }));
    assert.equal(updated.status, 200);
    assert.deepEqual([...state.events.keys()], [canonicalUid]);
    assert.match(state.events.get(canonicalUid), /^SUMMARY:New Name's Birthday$/m);

    const deleted = await requestJson(server, 'DELETE', `/api/apps/contacts/${id}`);
    assert.equal(deleted.status, 200);
    assert.equal(state.contacts.get(id).deleted_at !== null, true);
    assert.equal(state.events.size, 0);
    assert.equal(state.tombstones.has(state.contacts.get(id).dav_uid), true);

    const restored = await requestJson(server, 'POST', `/api/apps/contacts/${id}/restore`, {});
    assert.equal(restored.status, 200);
    assert.equal(state.contacts.get(id).deleted_at, null);
    assert.deepEqual([...state.events.keys()], [canonicalUid]);
    assert.equal(state.tombstones.size, 0);

    const deletedAgain = await requestJson(server, 'DELETE', `/api/apps/contacts/${id}`);
    assert.equal(deletedAgain.status, 200);
    state.events.set(canonicalUid, 'stale canonical birthday');
    state.events.set(newLegacyUid, 'stale legacy birthday');
    const permanentlyDeleted = await requestJson(server, 'DELETE', `/api/apps/contacts/${id}/permanent`);
    assert.equal(permanentlyDeleted.status, 200, JSON.stringify(permanentlyDeleted.json));
    assert.equal(state.contacts.has(id), false);
    assert.equal(state.events.size, 0);
  });
});

test('contact update that omits birthday preserves both stored birthday and its event', async (t) => {
  const state = installContactStore(t);
  await withServer(async server => {
    const created = await requestJson(server, 'POST', '/api/apps/contacts', contactPayload());
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const id = created.json.id;
    const canonicalUid = [...state.events.keys()][0];
    const updateWithoutBirthday = contactPayload({
      name: 'Renamed Without Birthday Field',
      email: 'renamed@example.test',
    });
    delete updateWithoutBirthday.birthday;

    const updated = await requestJson(
      server,
      'PUT',
      `/api/apps/contacts/${id}`,
      updateWithoutBirthday,
    );

    assert.equal(updated.status, 200, JSON.stringify(updated.json));
    assert.equal(state.contacts.get(id).birthday, '1990-01-02');
    assert.deepEqual([...state.events.keys()], [canonicalUid]);
    assert.match(state.events.get(canonicalUid), /^SUMMARY:Renamed Without Birthday Field's Birthday$/m);
  });
});

test('birthday cleanup failure rolls back a soft-deleted contact and its tombstone', async (t) => {
  const state = installContactStore(t);
  await withServer(async server => {
    const created = await requestJson(server, 'POST', '/api/apps/contacts', contactPayload());
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const id = created.json.id;
    const eventBefore = new Map(state.events);
    state.failBirthdayDelete = true;

    const response = await requestJson(server, 'DELETE', `/api/apps/contacts/${id}`);

    assert.equal(response.status, 500);
    assert.equal(state.contacts.get(id).deleted_at, null);
    assert.deepEqual(state.events, eventBefore);
    assert.equal(state.tombstones.size, 0);
    assert.equal(state.rollbacks, 1);
  });
});

test('bulk contact deletion removes every birthday in the same committed mutation', async (t) => {
  const state = installContactStore(t);
  await withServer(async server => {
    const first = await requestJson(server, 'POST', '/api/apps/contacts', contactPayload());
    const second = await requestJson(server, 'POST', '/api/apps/contacts', contactPayload({
      name: 'Second Contact',
      email: 'second@example.test',
      birthday: '1985-03-04',
    }));
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(state.events.size, 2);

    const response = await requestJson(server, 'POST', '/api/apps/contacts/bulk-delete', {
      ids: [first.json.id, second.json.id],
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.deleted, 2);
    assert.equal(state.events.size, 0);
    assert.equal([...state.contacts.values()].every(contact => contact.deleted_at !== null), true);
    assert.equal(state.tombstones.size, 2);
  });
});

test('web contact create and edit keep one canonical birthday in DB, vCard, and projection', async (t) => {
  const state = installContactStore(t);
  await withServer(async server => {
    const created = await requestJson(server, 'POST', '/api/apps/contacts', contactPayload({
      birthday: '19900203',
    }));
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const contact = state.contacts.get(created.json.id);
    assert.equal(contact.birthday, '1990-02-03');
    assert.match(contact.vcard_data, /^BDAY:1990-02-03$/m);
    assert.equal((contact.vcard_data.match(/^BDAY(?:;[^:]*)?:/gim) || []).length, 1);
    assert.equal(state.events.size, 1);
    const birthdayEventUid = [...state.events.keys()][0];

    const replaced = await requestJson(server, 'PUT', `/api/apps/contacts/${contact.id}`, contactPayload({
      birthday: '2000-02-29',
    }));
    assert.equal(replaced.status, 200, JSON.stringify(replaced.json));
    assert.equal(contact.birthday, '2000-02-29');
    assert.match(contact.vcard_data, /^BDAY:2000-02-29$/m);
    assert.deepEqual([...state.events.keys()], [birthdayEventUid]);
    assert.match(state.events.get(birthdayEventUid), /^DTSTART;VALUE=DATE:20000229$/m);

    const removed = await requestJson(server, 'PUT', `/api/apps/contacts/${contact.id}`, contactPayload({
      birthday: '',
    }));
    assert.equal(removed.status, 200, JSON.stringify(removed.json));
    assert.equal(contact.birthday, null);
    assert.doesNotMatch(contact.vcard_data, /^BDAY(?:;[^:]*)?:/mi);
    assert.equal(state.events.size, 0);
  });
});

test('raw-vCard-only web create resolves one field set for SQL, vCard, and birthday projection', async (t) => {
  const state = installContactStore(t);
  await withServer(async server => {
    const response = await requestJson(server, 'POST', '/api/apps/contacts', {
      vcard_data: [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'UID:raw-vcard-web-create',
        'FN:Dr. Raw Middle Card Jr.',
        'N:Card;Raw;Middle;Dr.;Jr.',
        'EMAIL;TYPE=HOME:raw@example.test',
        'TEL;TYPE=CELL:+1 602 555 0199',
        'ORG:Example Company;Research',
        'TITLE:Principal Engineer',
        'NOTE:Created from raw vCard',
        'NICKNAME:RC',
        'ADR;TYPE=HOME:;;1 Main St;Phoenix;AZ;85001;US',
        'URL:https://example.test/raw',
        'BDAY:19900203',
        'END:VCARD',
        '',
      ].join('\r\n'),
    });

    assert.equal(response.status, 200, JSON.stringify(response.json));
    const contact = state.contacts.get(response.json.id);
    assert.equal(contact.name, 'Dr. Raw Middle Card Jr.');
    assert.equal(contact.email, 'raw@example.test');
    assert.equal(contact.phone, '+1 602 555 0199');
    assert.equal(contact.prefix, 'Dr.');
    assert.equal(contact.first_name, 'Raw');
    assert.equal(contact.middle_name, 'Middle');
    assert.equal(contact.last_name, 'Card');
    assert.equal(contact.suffix, 'Jr.');
    assert.equal(contact.job_title, 'Principal Engineer');
    assert.equal(contact.organization, 'Example Company');
    assert.equal(contact.department, 'Research');
    assert.equal(contact.notes, 'Created from raw vCard');
    assert.equal(contact.nickname, 'RC');
    assert.equal(contact.website_url, 'https://example.test/raw');
    assert.equal(contact.birthday, '1990-02-03');
    assert.match(contact.vcard_data, /^ORG:Example Company;Research$/m);
    assert.match(contact.vcard_data, /^BDAY:1990-02-03$/m);
    assert.equal(state.events.size, 1);
    assert.match([...state.events.values()][0], /^SUMMARY:Dr\. Raw Middle Card Jr\.'s Birthday$/m);
  });
});

test('malformed web birthdays are rejected before any contact or projection write', async (t) => {
  const state = installContactStore(t);
  await withServer(async server => {
    const invalidCreate = await requestJson(server, 'POST', '/api/apps/contacts', contactPayload({
      birthday: '2023-02-29',
    }));
    assert.equal(invalidCreate.status, 400, JSON.stringify(invalidCreate.json));
    assert.equal(state.contacts.size, 0);
    assert.equal(state.events.size, 0);
    assert.equal(state.commits, 0);
    assert.equal(state.rollbacks, 0);

    const created = await requestJson(server, 'POST', '/api/apps/contacts', contactPayload());
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const before = structuredClone({
      contact: state.contacts.get(created.json.id),
      events: state.events,
      commits: state.commits,
      rollbacks: state.rollbacks,
    });

    const invalidUpdate = await requestJson(server, 'PUT', `/api/apps/contacts/${created.json.id}`, contactPayload({
      birthday: 'definitely-not-a-date',
    }));
    assert.equal(invalidUpdate.status, 400, JSON.stringify(invalidUpdate.json));
    assert.deepEqual(state.contacts.get(created.json.id), before.contact);
    assert.deepEqual(state.events, before.events);
    assert.equal(state.commits, before.commits);
    assert.equal(state.rollbacks, before.rollbacks);
  });
});

test('vCard birthday import is atomic and exact UID reimport retains the CardDAV href', async (t) => {
  const state = installContactStore(t);
  const suppliedUid = 'import-birthday-uid';
  await withServer(async server => {
    const first = await requestJson(server, 'POST', '/api/apps/contacts-import', {
      format: 'vcard',
      data: [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `UID:${suppliedUid}`,
        'FN:Imported Birthday',
        'EMAIL:same@example.test',
        'BDAY:19900203',
        'END:VCARD',
        '',
      ].join('\r\n'),
    });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.imported, 1);
    assert.equal(state.contacts.size, 1);
    const initial = [...state.contacts.values()][0];
    const davUid = initial.dav_uid;
    const eventUid = [...state.events.keys()][0];
    assert.equal(initial.birthday, '1990-02-03');
    assert.match(initial.vcard_data, /^UID:import-birthday-uid$/m);
    assert.match(initial.vcard_data, /^BDAY:1990-02-03$/m);
    assert.equal(state.events.size, 1);

    const reimport = await requestJson(server, 'POST', '/api/apps/contacts-import', {
      format: 'vcard',
      data: [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `UID:${suppliedUid}`,
        'FN:Imported Birthday Updated',
        'EMAIL:same@example.test',
        'BDAY:2004-02-29',
        'END:VCARD',
        '',
      ].join('\r\n'),
    });
    assert.equal(reimport.status, 200, JSON.stringify(reimport.json));
    assert.equal(reimport.json.imported, 1);
    assert.equal(state.contacts.size, 1);
    const updated = [...state.contacts.values()][0];
    assert.equal(updated.dav_uid, davUid);
    assert.equal(updated.name, 'Imported Birthday Updated');
    assert.equal(updated.birthday, '2004-02-29');
    assert.deepEqual([...state.events.keys()], [eventUid]);
  });
});

test('different supplied vCard UIDs remain distinct even when email matches', async (t) => {
  const state = installContactStore(t);
  await withServer(async server => {
    for (const uid of ['distinct-import-one', 'distinct-import-two']) {
      const response = await requestJson(server, 'POST', '/api/apps/contacts-import', {
        format: 'vcard',
        data: [
          'BEGIN:VCARD',
          'VERSION:3.0',
          `UID:${uid}`,
          `FN:${uid}`,
          'EMAIL:shared@example.test',
          'END:VCARD',
          '',
        ].join('\r\n'),
      });
      assert.equal(response.status, 200, JSON.stringify(response.json));
      assert.equal(response.json.imported, 1);
    }

    assert.equal(state.contacts.size, 2);
    assert.equal(new Set([...state.contacts.values()].map(contact => contact.dav_uid)).size, 2);
    assert.deepEqual(
      [...state.contacts.values()].map(contact => contact.vcard_data.match(/^UID:(.+)$/m)?.[1].trim()).sort(),
      ['distinct-import-one', 'distinct-import-two'],
    );
  });
});

test('ambiguous exact vCard UID import fails closed and rolls back', async (t) => {
  const state = installContactStore(t);
  const duplicatedUid = 'ambiguous-import-uid';
  for (const [id, davUid] of [[1, 'first-dav-href'], [2, 'second-dav-href']]) {
    state.contacts.set(id, {
      id,
      username: owner,
      name: `Legacy ${id}`,
      email: `legacy-${id}@example.test`,
      phone: '',
      dav_uid: davUid,
      vcard_data: `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${duplicatedUid}\r\nFN:Legacy ${id}\r\nEND:VCARD\r\n`,
      sync_token: id,
      birthday: null,
      deleted_at: null,
    });
  }
  state.nextContactId = 3;
  const before = structuredClone(state.contacts);

  await withServer(async server => {
    const response = await requestJson(server, 'POST', '/api/apps/contacts-import', {
      format: 'vcard',
      data: `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${duplicatedUid}\r\nFN:Rejected Update\r\nEND:VCARD\r\n`,
    });

    assert.equal(response.status, 409, JSON.stringify(response.json));
    assert.deepEqual(state.contacts, before);
    assert.equal(state.events.size, 0);
    assert.equal(state.commits, 0);
    assert.equal(state.rollbacks, 1);
  });
});

test('malformed imported BDAY is rejected without SQL or birthday projection writes', async (t) => {
  const state = installContactStore(t);
  await withServer(async server => {
    const response = await requestJson(server, 'POST', '/api/apps/contacts-import', {
      format: 'vcard',
      data: 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:bad-birthday-import\r\nFN:Bad Birthday\r\nBDAY:2026-13-40\r\nEND:VCARD\r\n',
    });

    assert.equal(response.status, 400, JSON.stringify(response.json));
    assert.equal(state.contacts.size, 0);
    assert.equal(state.events.size, 0);
    assert.equal(state.commits, 0);
    assert.equal(state.rollbacks, 0);
  });
});

test('yearless RFC vCard BDAY remains yearless while projecting a leap-safe recurrence', async (t) => {
  const state = installContactStore(t);
  await withServer(async server => {
    const response = await requestJson(server, 'POST', '/api/apps/contacts-import', {
      format: 'vcard',
      data: 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:yearless-birthday\r\nFN:Yearless Birthday\r\nBDAY:--02-29\r\nEND:VCARD\r\n',
    });

    assert.equal(response.status, 200, JSON.stringify(response.json));
    const contact = [...state.contacts.values()][0];
    assert.equal(contact.birthday, '02-29');
    assert.match(contact.vcard_data, /^BDAY:--02-29$/m);
    assert.equal(state.events.size, 1);
    assert.match([...state.events.values()][0], /^DTSTART;VALUE=DATE:20000229$/m);
  });
});

test('invalid yearless vCard BDAY is rejected before any mutation', async (t) => {
  const state = installContactStore(t);
  await withServer(async server => {
    const response = await requestJson(server, 'POST', '/api/apps/contacts-import', {
      format: 'vcard',
      data: 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:bad-yearless-birthday\r\nFN:Bad Yearless Birthday\r\nBDAY:--02-30\r\nEND:VCARD\r\n',
    });

    assert.equal(response.status, 400, JSON.stringify(response.json));
    assert.equal(state.contacts.size, 0);
    assert.equal(state.events.size, 0);
    assert.equal(state.commits, 0);
    assert.equal(state.rollbacks, 0);
  });
});
