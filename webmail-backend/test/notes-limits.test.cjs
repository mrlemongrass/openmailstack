const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'notes-limits-test';

const indexPath = path.join(__dirname, '..', 'src', 'index.js');
require.cache[indexPath] = {
  id: indexPath,
  filename: indexPath,
  loaded: true,
  exports: { io: { to: () => ({ emit: () => {} }) } },
};

const { pool } = require('../src/db.js');
const {
  NOTE_CONTENT_MAX_BYTES,
  NOTE_LABELS_MAX_BYTES,
  NOTE_LABELS_MAX_COUNT,
  NOTE_TITLE_MAX_BYTES,
  NoteValidationError,
  ensureNotesSchema,
  saveNote,
} = require('../src/notes-utils.js');

function installNoteStore(t) {
  const originalQuery = pool.query;
  const notes = new Map();
  let writes = 0;
  pool.query = async (sql, params = []) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.startsWith('SELECT * FROM notes WHERE id = ?')) {
      const note = notes.get(`${params[1]}\0${params[0]}`);
      return [note ? [{ ...note }] : [], []];
    }
    if (compact.startsWith('INSERT INTO notes')) {
      const [id, owner, title, content, color, isPinned, isLocked, folder, labelsJson, imapUid, imapMessageId] = params;
      notes.set(`${owner}\0${id}`, {
        id,
        owner,
        title,
        content,
        color,
        is_pinned: isPinned,
        is_locked: isLocked,
        folder,
        labels_json: labelsJson,
        sync_token: 1,
        imap_sync_token: 0,
        imap_uid: imapUid,
        imap_msgid: imapMessageId,
        is_deleted: 0,
        created_at: '2026-08-15T00:00:00.000Z',
        updated_at: '2026-08-15T00:00:00.000Z',
      });
      writes += 1;
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected Notes limit query: ${compact}`);
  };
  t.after(() => { pool.query = originalQuery; });
  return { notes, get writes() { return writes; } };
}

test('Notes accept exact UTF-8 byte boundaries and 100 scalar label IDs', async (t) => {
  assert.equal(NOTE_TITLE_MAX_BYTES, 4 * 1024);
  assert.equal(NOTE_CONTENT_MAX_BYTES, 4 * 1024 * 1024);
  assert.equal(NOTE_LABELS_MAX_BYTES, 32 * 1024);
  assert.equal(NOTE_LABELS_MAX_COUNT, 100);
  const store = installNoteStore(t);
  const title = '🚀'.repeat(NOTE_TITLE_MAX_BYTES / 4);
  const content = 'é'.repeat(NOTE_CONTENT_MAX_BYTES / 2);
  const labelPadding = 'a'.repeat(NOTE_LABELS_MAX_BYTES - 4);
  const labelsJson = JSON.stringify([labelPadding]);
  assert.equal(Buffer.byteLength(labelsJson, 'utf8'), NOTE_LABELS_MAX_BYTES);

  const saved = await saveNote({
    owner: 'limits@example.test',
    title,
    content,
    labels_json: labelsJson,
  });

  assert.equal(Buffer.byteLength(saved.title, 'utf8'), NOTE_TITLE_MAX_BYTES);
  assert.equal(Buffer.byteLength(saved.content, 'utf8'), NOTE_CONTENT_MAX_BYTES);
  assert.equal(saved.labels_json, labelsJson);
  assert.equal(store.writes, 1);

  const oneHundredLabels = JSON.stringify(Array.from({ length: 100 }, (_, index) => index));
  const second = await saveNote({ owner: 'limits@example.test', labels_json: oneHundredLabels });
  assert.equal(JSON.parse(second.labels_json).length, 100);
});

test('Notes reject over-limit Unicode bytes and malformed field types before SQL writes', async (t) => {
  const store = installNoteStore(t);
  const validBase = { owner: 'limits@example.test' };
  const cases = [
    [{ ...validBase, title: `${'🚀'.repeat(NOTE_TITLE_MAX_BYTES / 4)}a` }, 413, 'title'],
    [{ ...validBase, content: `${'é'.repeat(NOTE_CONTENT_MAX_BYTES / 2)}a` }, 413, 'content'],
    [{ ...validBase, labels_json: JSON.stringify(['a'.repeat(NOTE_LABELS_MAX_BYTES - 3)]) }, 413, 'labels_json'],
    [{ ...validBase, labels_json: JSON.stringify(Array.from({ length: 101 }, (_, index) => index)) }, 400, 'labels_json'],
    [{ ...validBase, labels_json: JSON.stringify([{ nested: true }]) }, 400, 'labels_json'],
    [{ ...validBase, labels_json: '{not-json' }, 400, 'labels_json'],
    [{ ...validBase, title: 42 }, 400, 'title'],
    [{ ...validBase, content: Buffer.from('not a string') }, 400, 'content'],
    [{ ...validBase, labels_json: [] }, 400, 'labels_json'],
  ];

  for (const [input, expectedStatus, field] of cases) {
    await assert.rejects(
      saveNote(input),
      (error) => error instanceof NoteValidationError
        && error.statusCode === expectedStatus
        && error.field === field,
    );
  }
  assert.equal(store.writes, 0);
});

test('Notes schema conditionally widens legacy content TEXT to MEDIUMTEXT', async (t) => {
  const originalQuery = pool.query;
  const statements = [];
  const requiredColumns = [
    'id', 'owner', 'title', 'content', 'color', 'is_pinned', 'is_locked', 'folder',
    'labels_json', 'sync_token', 'imap_sync_token', 'imap_uid', 'imap_msgid',
    'is_deleted', 'created_at', 'updated_at',
  ];
  const columnTypes = {
    id: 'varchar(255)', owner: 'varchar(255)', title: 'text', content: 'mediumtext',
    color: 'varchar(50)', is_pinned: 'tinyint(1)', is_locked: 'tinyint(1)',
    folder: 'varchar(100)', labels_json: 'text', sync_token: 'bigint(20)',
    imap_sync_token: 'bigint(20)', imap_uid: 'int(11)', imap_msgid: 'varchar(255)',
    is_deleted: 'tinyint(1)', created_at: 'timestamp', updated_at: 'timestamp',
  };
  let contentType = 'text';
  pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    statements.push(compact);
    if (compact === 'SHOW COLUMNS FROM notes') {
      return [requiredColumns.map(Field => ({
        Field,
        Type: Field === 'content' ? contentType : columnTypes[Field],
        Null: ['is_pinned', 'is_locked', 'folder', 'sync_token', 'imap_sync_token', 'is_deleted'].includes(Field) ? 'NO' : 'YES',
        Default: ({ is_pinned: '0', is_locked: '0', folder: 'notes', sync_token: '1', imap_sync_token: '0', is_deleted: '0' })[Field] ?? null,
      })), []];
    }
    if (compact.startsWith('ALTER TABLE notes MODIFY COLUMN content MEDIUMTEXT')) {
      contentType = 'mediumtext';
      return [{ affectedRows: 1 }, []];
    }
    return [{ affectedRows: 0 }, []];
  };
  t.after(() => { pool.query = originalQuery; });

  await ensureNotesSchema();

  assert.ok(statements.some((statement) => /content MEDIUMTEXT/i.test(statement)));
  assert.ok(statements.some((statement) => statement.startsWith('ALTER TABLE notes MODIFY COLUMN content MEDIUMTEXT')));
});
