const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'notes-schema-startup-test';

const revisionDefaults = {
  is_pinned: '0', is_locked: '0', folder: 'notes', sync_token: '1',
  imap_sync_token: '0', is_deleted: '0',
};

function schemaColumn(Field, Type, overrides = {}) {
  const revisionColumn = Object.prototype.hasOwnProperty.call(revisionDefaults, Field);
  return {
    Field,
    Type,
    Null: revisionColumn ? 'NO' : 'YES',
    Default: revisionColumn ? revisionDefaults[Field] : null,
    ...overrides,
  };
}

test('Notes schema initialization propagates a required column migration failure', async (t) => {
  const db = require('../src/db.js');
  const originalQuery = db.pool.query;
  t.after(() => { db.pool.query = originalQuery; });

  db.pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.startsWith('CREATE TABLE IF NOT EXISTS notes')) return [[], []];
    if (compact === 'SHOW COLUMNS FROM notes') {
      return [[
        { Field: 'id', Type: 'varchar(255)' },
        { Field: 'owner', Type: 'varchar(255)' },
        { Field: 'content', Type: 'mediumtext' },
      ], []];
    }
    if (compact.includes('ADD COLUMN imap_sync_token')) {
      throw new Error('notes migration permission denied');
    }
    if (compact.startsWith('ALTER TABLE notes ADD COLUMN')) return [[], []];
    throw new Error(`Unexpected Notes schema query: ${compact}`);
  };

  const notesUtilsPath = require.resolve('../src/notes-utils.js');
  delete require.cache[notesUtilsPath];
  const { ensureNotesSchema } = require(notesUtilsPath);

  await assert.rejects(ensureNotesSchema(), /notes migration permission denied/);
});

test('Notes schema initialization introspects, migrates, verifies, and single-flights required columns', async (t) => {
  const db = require('../src/db.js');
  const originalQuery = db.pool.query;
  t.after(() => { db.pool.query = originalQuery; });
  const columns = new Map([
    ['id', 'varchar(255)'], ['owner', 'varchar(255)'], ['title', 'text'], ['content', 'text'],
    ['color', 'varchar(50)'], ['created_at', 'timestamp'], ['updated_at', 'timestamp'],
  ]);
  const alterations = [];
  let queryCount = 0;
  db.pool.query = async (sql) => {
    queryCount += 1;
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.startsWith('CREATE TABLE IF NOT EXISTS notes')) return [[], []];
    if (compact === 'SHOW COLUMNS FROM notes') {
      return [[...columns].map(([Field, Type]) => schemaColumn(Field, Type)), []];
    }
    const add = compact.match(/^ALTER TABLE notes ADD COLUMN ([a-z_]+) (.+)$/i);
    if (add) {
      alterations.push(add[1]);
      columns.set(add[1], add[2].split(' ')[0].toLowerCase());
      return [[], []];
    }
    if (compact === 'ALTER TABLE notes MODIFY COLUMN content MEDIUMTEXT NULL') {
      columns.set('content', 'mediumtext');
      return [[], []];
    }
    throw new Error(`Unexpected Notes schema query: ${compact}`);
  };

  const notesUtilsPath = require.resolve('../src/notes-utils.js');
  delete require.cache[notesUtilsPath];
  const { ensureNotesSchema } = require(notesUtilsPath);
  await Promise.all([ensureNotesSchema(), ensureNotesSchema()]);
  assert.deepEqual(alterations.sort(), [
    'folder', 'imap_msgid', 'imap_sync_token', 'imap_uid', 'is_deleted',
    'is_locked', 'is_pinned', 'labels_json', 'sync_token',
  ]);
  assert.equal(columns.get('content'), 'mediumtext');
  const completedQueryCount = queryCount;
  await ensureNotesSchema();
  assert.equal(queryCount, completedQueryCount);
});

test('Notes schema initialization retains an existing LONGTEXT content column', async (t) => {
  const db = require('../src/db.js');
  const originalQuery = db.pool.query;
  t.after(() => { db.pool.query = originalQuery; });
  const expectedTypes = {
    id: 'varchar(255)', owner: 'varchar(255)', title: 'text', content: 'longtext',
    color: 'varchar(50)', is_pinned: 'tinyint(1)', is_locked: 'tinyint(1)',
    folder: 'varchar(100)', labels_json: 'text', sync_token: 'bigint(20)',
    imap_sync_token: 'bigint(20)', imap_uid: 'int(11)', imap_msgid: 'varchar(255)',
    is_deleted: 'tinyint(1)', created_at: 'timestamp', updated_at: 'timestamp',
  };
  const statements = [];
  db.pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    statements.push(compact);
    if (compact.startsWith('CREATE TABLE IF NOT EXISTS notes')) return [[], []];
    if (compact === 'SHOW COLUMNS FROM notes') {
      return [Object.entries(expectedTypes).map(([Field, Type]) => schemaColumn(Field, Type)), []];
    }
    throw new Error(`Unexpected Notes schema query: ${compact}`);
  };

  const notesUtilsPath = require.resolve('../src/notes-utils.js');
  delete require.cache[notesUtilsPath];
  const { ensureNotesSchema } = require(notesUtilsPath);
  await ensureNotesSchema();

  assert.equal(
    statements.some(statement => statement === 'ALTER TABLE notes MODIFY COLUMN content MEDIUMTEXT NULL'),
    false,
  );
});

test('Notes schema initialization fails if a required column is still absent after migration', async (t) => {
  const db = require('../src/db.js');
  const originalQuery = db.pool.query;
  t.after(() => { db.pool.query = originalQuery; });
  const coreColumns = [
    'id', 'owner', 'title', 'content', 'color', 'is_pinned', 'is_locked', 'folder',
    'labels_json', 'sync_token', 'imap_sync_token', 'imap_uid', 'imap_msgid',
    'created_at', 'updated_at',
  ];
  db.pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.startsWith('CREATE TABLE IF NOT EXISTS notes')) return [[], []];
    if (compact === 'SHOW COLUMNS FROM notes') {
      return [coreColumns.map(Field => schemaColumn(Field, Field === 'content' ? 'mediumtext' : 'text')), []];
    }
    if (compact.includes('ADD COLUMN is_deleted')) return [[], []];
    throw new Error(`Unexpected Notes schema query: ${compact}`);
  };

  const notesUtilsPath = require.resolve('../src/notes-utils.js');
  delete require.cache[notesUtilsPath];
  const { ensureNotesSchema } = require(notesUtilsPath);
  await assert.rejects(ensureNotesSchema(), /missing required columns: is_deleted/i);
});

test('Notes schema initialization fails closed on incompatible identity or revision column types', async (t) => {
  const db = require('../src/db.js');
  const originalQuery = db.pool.query;
  t.after(() => { db.pool.query = originalQuery; });
  const expectedTypes = {
    id: 'varchar(255)', owner: 'varchar(255)', title: 'text', content: 'mediumtext',
    color: 'varchar(50)', is_pinned: 'tinyint(1)', is_locked: 'tinyint(1)',
    folder: 'varchar(100)', labels_json: 'text', sync_token: 'varchar(32)',
    imap_sync_token: 'bigint(20)', imap_uid: 'int(11)', imap_msgid: 'varchar(255)',
    is_deleted: 'tinyint(1)', created_at: 'timestamp', updated_at: 'timestamp',
  };
  db.pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.startsWith('CREATE TABLE IF NOT EXISTS notes')) return [[], []];
    if (compact === 'SHOW COLUMNS FROM notes') {
      return [Object.entries(expectedTypes).map(([Field, Type]) => schemaColumn(Field, Type)), []];
    }
    throw new Error(`Unexpected Notes schema query: ${compact}`);
  };

  const notesUtilsPath = require.resolve('../src/notes-utils.js');
  delete require.cache[notesUtilsPath];
  const { ensureNotesSchema } = require(notesUtilsPath);
  await assert.rejects(ensureNotesSchema(), /sync_token has incompatible type varchar\(32\)/i);
});

test('Notes schema initialization repairs and verifies nullable revision columns', async (t) => {
  const db = require('../src/db.js');
  const originalQuery = db.pool.query;
  t.after(() => { db.pool.query = originalQuery; });
  const expectedTypes = {
    id: 'varchar(255)', owner: 'varchar(255)', title: 'text', content: 'mediumtext',
    color: 'varchar(50)', is_pinned: 'tinyint(1)', is_locked: 'tinyint(1)',
    folder: 'varchar(100)', labels_json: 'text', sync_token: 'bigint(20)',
    imap_sync_token: 'bigint(20)', imap_uid: 'int(11)', imap_msgid: 'varchar(255)',
    is_deleted: 'tinyint(1)', created_at: 'timestamp', updated_at: 'timestamp',
  };
  let nullableSyncToken = true;
  const statements = [];
  db.pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    statements.push(compact);
    if (compact.startsWith('CREATE TABLE IF NOT EXISTS notes')) return [[], []];
    if (compact === 'SHOW COLUMNS FROM notes') {
      return [Object.entries(expectedTypes).map(([Field, Type]) => schemaColumn(
        Field,
        Type,
        Field === 'sync_token' && nullableSyncToken ? { Null: 'YES', Default: null } : {},
      )), []];
    }
    if (compact === 'UPDATE notes SET sync_token = 1 WHERE sync_token IS NULL') return [{ affectedRows: 0 }, []];
    if (compact === 'ALTER TABLE notes MODIFY COLUMN sync_token BIGINT NOT NULL DEFAULT 1') {
      nullableSyncToken = false;
      return [{ affectedRows: 0 }, []];
    }
    throw new Error(`Unexpected Notes schema query: ${compact}`);
  };

  const notesUtilsPath = require.resolve('../src/notes-utils.js');
  delete require.cache[notesUtilsPath];
  const { ensureNotesSchema } = require(notesUtilsPath);
  await ensureNotesSchema();
  assert.ok(statements.includes('UPDATE notes SET sync_token = 1 WHERE sync_token IS NULL'));
  assert.ok(statements.includes('ALTER TABLE notes MODIFY COLUMN sync_token BIGINT NOT NULL DEFAULT 1'));
});
