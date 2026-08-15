const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'calendar-slug-invariant-test';

function installSchemaDatabase({ calendars = [], duplicateSlug = null, uniqueSlugIndex = false } = {}) {
  const statements = [];
  const db = require('../src/db.js');
  db.pool.query = async (sql, params = []) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    statements.push(compact);

    if (compact === "SHOW FULL COLUMNS FROM events LIKE 'uid'"
      || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'uid'"
      || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'calendar_id'"
      || compact === "SHOW FULL COLUMNS FROM events LIKE 'resource_name'"
      || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'resource_name'") {
      return [[{ Collation: 'utf8mb4_bin', Null: 'NO' }], []];
    }
    if (compact.startsWith('SHOW COLUMNS')) return [[{ Field: 'present' }], []];
    if (compact.startsWith('SHOW INDEX FROM calendars')) {
      return [[
        { Non_unique: 1, Key_name: 'idx_calendars_user_dav_slug', Seq_in_index: 1, Column_name: 'user_id' },
        { Non_unique: 1, Key_name: 'idx_calendars_user_dav_slug', Seq_in_index: 2, Column_name: 'dav_slug' },
        ...(uniqueSlugIndex ? [
          { Non_unique: 0, Key_name: 'uniq_calendars_user_dav_slug', Seq_in_index: 1, Column_name: 'user_id' },
          { Non_unique: 0, Key_name: 'uniq_calendars_user_dav_slug', Seq_in_index: 2, Column_name: 'dav_slug' },
        ] : []),
      ], []];
    }
    if (compact === 'SHOW INDEX FROM events') {
      return [[
        { Non_unique: 0, Key_name: 'uniq_events_calendar_uid', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 0, Key_name: 'uniq_events_calendar_uid', Seq_in_index: 2, Column_name: 'uid' },
        { Non_unique: 0, Key_name: 'uniq_events_calendar_resource_name', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 0, Key_name: 'uniq_events_calendar_resource_name', Seq_in_index: 2, Column_name: 'resource_name' },
        { Non_unique: 1, Key_name: 'idx_events_calendar_sync', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 1, Key_name: 'idx_events_calendar_sync', Seq_in_index: 2, Column_name: 'sync_token' },
      ], []];
    }
    if (compact === 'SHOW INDEX FROM calendar_tombstones') {
      return [[
        { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 2, Column_name: 'resource_name' },
        { Non_unique: 1, Key_name: 'idx_tombstones_calendar_sync', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 1, Key_name: 'idx_tombstones_calendar_sync', Seq_in_index: 2, Column_name: 'sync_token' },
      ], []];
    }
    if (compact === 'SELECT id, user_id, name, dav_slug FROM calendars ORDER BY user_id ASC, id ASC') {
      return [calendars.map(calendar => ({ ...calendar })), []];
    }
    if (compact.startsWith('SELECT user_id, dav_slug, COUNT(*) AS duplicate_count FROM calendars')) {
      return [duplicateSlug ? [duplicateSlug] : [], []];
    }
    if (compact === "UPDATE calendars SET dav_slug = NULL WHERE dav_slug = ''") {
      for (const calendar of calendars) {
        if (calendar.dav_slug === '') calendar.dav_slug = null;
      }
      return [{ affectedRows: 1 }, []];
    }
    if (compact.startsWith('SELECT id FROM calendars WHERE user_id = ? AND dav_slug = ? AND id <> ?')) {
      const [user, slug, id] = params;
      const row = calendars.find(calendar => (
        calendar.id !== Number(id)
        && calendar.user_id.toLowerCase() === String(user).toLowerCase()
        && String(calendar.dav_slug || '').toLowerCase() === String(slug).toLowerCase()
      ));
      return [row ? [{ id: row.id }] : [], []];
    }
    if (compact.startsWith('UPDATE calendars SET dav_slug = ? WHERE id = ?')) {
      const calendar = calendars.find(row => row.id === Number(params[1]));
      if (!calendar) throw new Error(`Unknown calendar ${params[1]}`);
      if (calendar.dav_slug) return [{ affectedRows: 0 }, []];
      if (calendars.some(row => (
        row.id !== calendar.id
        && row.user_id.toLowerCase() === calendar.user_id.toLowerCase()
        && String(row.dav_slug || '').toLowerCase() === String(params[0]).toLowerCase()
      ))) {
        const error = new Error(`Duplicate calendar slug ${params[0]}`);
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      calendar.dav_slug = params[0];
      return [{ affectedRows: 1 }, []];
    }
    if (compact === 'ALTER TABLE calendars ADD UNIQUE KEY uniq_calendars_user_dav_slug (user_id, dav_slug)') {
      const identities = calendars
        .filter(calendar => calendar.dav_slug !== null)
        .map(calendar => `${calendar.user_id.toLowerCase()}\0${calendar.dav_slug.toLowerCase()}`);
      if (new Set(identities).size !== identities.length) {
        const error = new Error('Duplicate entry while adding unique calendar slug key');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      return [{ affectedRows: 1 }, []];
    }
    return [{ affectedRows: 1 }, []];
  };
  return { calendars, statements };
}

function freshCalendarUtils() {
  const modulePath = require.resolve('../src/calendar-utils.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

function installCreateDatabase({ injectFirstInsertCollision = false, initialCalendars = [] } = {}) {
  const calendars = initialCalendars.map(calendar => ({ ...calendar }));
  installSchemaDatabase({ calendars });
  const db = require('../src/db.js');
  const schemaQuery = db.pool.query;
  let nextId = Math.max(0, ...calendars.map(calendar => Number(calendar.id))) + 1;
  let collisionInjected = false;
  let lockHeld = false;
  const lockWaiters = [];
  let lockRequests = 0;

  const query = async (sql, params = []) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.startsWith('SELECT * FROM calendars WHERE user_id = ?')) {
      const writableOnly = compact.includes("LOWER(TRIM(COALESCE(dav_slug, ''))) <> 'birthdays'");
      const rows = calendars
        .filter(calendar => calendar.user_id === params[0])
        .filter(calendar => !writableOnly || (
          String(calendar.dav_slug || '').trim().toLowerCase() !== 'birthdays'
          && String(calendar.subscribed_url || '').trim() === ''
        ))
        .sort((left, right) => left.id - right.id);
      return [rows.length ? [{ ...rows[0] }] : [], []];
    }
    if (compact.startsWith('SELECT id FROM calendars WHERE user_id = ? AND dav_slug = ?')) {
      const [user, slug] = params;
      const excludedId = compact.includes('AND id <> ?') ? Number(params[2]) : null;
      const row = calendars.find(calendar => (
        calendar.user_id === user && calendar.dav_slug === slug && calendar.id !== excludedId
      ));
      return [row ? [{ id: row.id }] : [], []];
    }
    if (compact.startsWith('INSERT INTO calendars (user_id, name, dav_slug, color, components, subscribed_url, sync_token)')) {
      const [user_id, name, dav_slug, color, components, subscribed_url] = params;
      if (injectFirstInsertCollision && !collisionInjected) {
        collisionInjected = true;
        calendars.push({
          id: nextId++, user_id, name: 'Concurrent writer', dav_slug,
          color: '#000000', components: 'VEVENT', subscribed_url: null, sync_token: 1,
        });
        const error = new Error(`Concurrent writer claimed calendar slug ${dav_slug}`);
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      if (calendars.some(calendar => calendar.user_id === user_id && calendar.dav_slug === dav_slug)) {
        const error = new Error(`Duplicate calendar slug ${dav_slug}`);
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      const row = { id: nextId++, user_id, name, dav_slug, color, components, subscribed_url, sync_token: 1 };
      calendars.push(row);
      return [{ insertId: row.id, affectedRows: 1 }, []];
    }
    if (compact === 'SELECT * FROM calendars WHERE id = ?') {
      const row = calendars.find(calendar => calendar.id === Number(params[0]));
      return [row ? [{ ...row }] : [], []];
    }
    return schemaQuery(sql, params);
  };
  db.pool.query = query;
  db.pool.getConnection = async () => ({
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('SELECT GET_LOCK(')) {
        lockRequests += 1;
        if (lockHeld) await new Promise(resolve => lockWaiters.push(resolve));
        else lockHeld = true;
        return [[{ acquired: 1 }], []];
      }
      if (compact.startsWith('SELECT RELEASE_LOCK(')) {
        const next = lockWaiters.shift();
        if (next) next();
        else lockHeld = false;
        return [[{ released: 1 }], []];
      }
      return query(sql, params);
    },
    release() {},
    destroy() {},
  });

  return { calendars, get lockRequests() { return lockRequests; } };
}

test('calendar schema migration fails closed instead of aliasing duplicate DAV collection slugs', async () => {
  const { statements } = installSchemaDatabase({
    duplicateSlug: { user_id: 'owner@example.test', dav_slug: 'team', duplicate_count: 2 },
  });
  const { ensureCalendarSchema } = freshCalendarUtils();

  await assert.rejects(
    ensureCalendarSchema(),
    /owner@example\.test.*team.*2 rows.*unique.*user_id.*dav_slug/i,
  );
  assert.equal(
    statements.some(sql => sql.includes('ADD UNIQUE KEY uniq_calendars_user_dav_slug')),
    false,
  );
  assert.equal(
    statements.some(sql => sql.startsWith('UPDATE calendars SET dav_slug')),
    false,
  );
});

test('calendar schema migration installs the database DAV slug uniqueness invariant', async () => {
  const { statements } = installSchemaDatabase();
  const { ensureCalendarSchema } = freshCalendarUtils();

  await ensureCalendarSchema();

  assert.ok(statements.includes(
    'ALTER TABLE calendars ADD UNIQUE KEY uniq_calendars_user_dav_slug (user_id, dav_slug)',
  ));
});

test('calendar schema migration backfills legacy empty slugs before installing uniqueness', async () => {
  const { calendars } = installSchemaDatabase({
    calendars: [
      { id: 1, user_id: 'owner@example.test', name: 'Team', dav_slug: 'Team' },
      { id: 2, user_id: 'owner@example.test', name: 'Team', dav_slug: '' },
      { id: 3, user_id: 'owner@example.test', name: 'Team', dav_slug: '' },
      { id: 4, user_id: 'owner@example.test', name: 'Birthdays', dav_slug: '' },
    ],
  });
  const { ensureCalendarSchema } = freshCalendarUtils();

  await ensureCalendarSchema();

  assert.deepEqual(
    calendars.map(calendar => calendar.dav_slug),
    ['Team', 'team-2', 'team-3', 'birthdays-2'],
  );
});

test('concurrent calendar creation serializes per user and returns distinct DAV collection slugs', async () => {
  const database = installCreateDatabase();
  const { createCalendar } = freshCalendarUtils();

  const created = await Promise.all([
    createCalendar('owner@example.test', 'Team'),
    createCalendar('owner@example.test', 'Team'),
  ]);

  assert.deepEqual(created.map(calendar => calendar.dav_slug).sort(), ['team', 'team-2']);
  assert.equal(new Set(database.calendars.map(calendar => calendar.dav_slug)).size, 2);
  assert.equal(database.lockRequests, 2);
});

test('calendar creation retries a database uniqueness race without aliasing the winning collection', async () => {
  const database = installCreateDatabase({ injectFirstInsertCollision: true });
  const { createCalendar } = freshCalendarUtils();

  const created = await createCalendar('owner@example.test', 'Team');

  assert.equal(created.dav_slug, 'team-2');
  assert.deepEqual(database.calendars.map(calendar => calendar.dav_slug), ['team', 'team-2']);
  assert.equal(database.lockRequests, 1);
});

test('public calendar creation rejects the reserved managed Birthdays identity', async () => {
  const database = installCreateDatabase();
  const { createCalendar, isReservedManagedCalendarSlug } = freshCalendarUtils();

  assert.equal(isReservedManagedCalendarSlug('birthdays'), true);
  assert.equal(isReservedManagedCalendarSlug('Birthdays'), true);
  assert.equal(isReservedManagedCalendarSlug('birthdays-2'), false);
  await assert.rejects(
    createCalendar('owner@example.test', 'Birthdays'),
    /birthdays.*reserved.*managed/i,
  );
  await assert.rejects(
    createCalendar('owner@example.test', 'Family Dates', { slug: 'birthdays' }),
    /birthdays.*reserved.*managed/i,
  );
  assert.equal(database.calendars.length, 0);
  assert.equal(database.lockRequests, 0);
});

test('default calendar selection skips managed and subscribed collections', async () => {
  const user = 'owner@example.test';
  installCreateDatabase({
    initialCalendars: [
      { id: 1, user_id: user, name: 'Birthdays', dav_slug: 'birthdays', subscribed_url: null },
      { id: 2, user_id: user, name: 'Feed', dav_slug: 'feed', subscribed_url: 'https://calendar.example.test/feed.ics' },
      { id: 3, user_id: user, name: 'Personal', dav_slug: 'personal', subscribed_url: null },
    ],
  });
  const { ensureDefaultCalendar } = freshCalendarUtils();

  const selected = await ensureDefaultCalendar(user);

  assert.equal(selected.id, 3);
  assert.equal(selected.dav_slug, 'personal');
});

test('default calendar creation adds a writable collection when only managed or subscribed calendars exist', async () => {
  const user = 'owner@example.test';
  const database = installCreateDatabase({
    initialCalendars: [
      { id: 1, user_id: user, name: 'Birthdays', dav_slug: 'birthdays', subscribed_url: null },
      { id: 2, user_id: user, name: 'Feed', dav_slug: 'feed', subscribed_url: 'https://calendar.example.test/feed.ics' },
    ],
  });
  const { ensureDefaultCalendar } = freshCalendarUtils();

  const created = await ensureDefaultCalendar(user);

  assert.equal(created.id, 3);
  assert.equal(created.dav_slug, 'personal');
  assert.equal(created.subscribed_url, null);
  assert.equal(database.calendars.length, 3);
});
