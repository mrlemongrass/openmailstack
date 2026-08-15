const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { simpleParser } = require('mailparser');

process.env.OMS_DB_PASSWORD ||= 'notes-imap-sync-test';

const sourceDir = path.join(__dirname, '..', 'src');
const syncModulePath = require.resolve(path.join(sourceDir, 'notes-imap-sync.js'));
const imapModulePath = require.resolve(path.join(sourceDir, 'imap.js'));
const dbModulePath = require.resolve(path.join(sourceDir, 'db.js'));
const notesUtilsModulePath = require.resolve(path.join(sourceDir, 'notes-utils.js'));
const { validateNoteFields } = require(notesUtilsModulePath);

function installSyncHarness(t, {
  deleteDuringFirstAppend = false,
  linkedNoteCount = 0,
  duplicateLinkedMessage = false,
  dirtyLinkedNote = false,
  missingLinkedMessage = false,
  editBeforeConditionalDelete = false,
  deletedLinkedNote = false,
  restoreDuringDelete = false,
  replaceDeleteFailures = 0,
  appendAfterAcceptFailures = 0,
  importThenEdit = false,
  imapOnlyNoteCount = 0,
  loadSecondRuntime = false,
  blockPrimaryOwnerSnapshot = false,
  noteOverrides = {},
  acquireFailureAfterLock = false,
  releaseFailure = false,
  customImapSources = [],
} = {}) {
  const originalCacheEntries = new Map(
    [syncModulePath, imapModulePath, dbModulePath, notesUtilsModulePath]
      .map((modulePath) => [modulePath, require.cache[modulePath]]),
  );
  const owner = 'notes-race@example.test';
  const notes = [{
    id: 'note-1',
    owner,
    title: 'Race probe',
    content: '<p>Initial</p>',
    color: '#ffffff',
    is_pinned: 0,
    is_locked: 0,
    folder: 'notes',
    labels_json: '[]',
    sync_token: 1,
    imap_sync_token: 0,
    imap_uid: null,
    imap_msgid: null,
    is_deleted: 0,
    created_at: '2026-08-15T00:00:00.000Z',
    updated_at: '2026-08-15T00:00:00.000Z',
    ...noteOverrides,
  }];
  const mailbox = [];
  let nextUid = 1;
  let snapshotsStarted = 0;
  let appendCount = 0;
  let deleteFailuresRemaining = replaceDeleteFailures;
  let appendFailuresRemaining = appendAfterAcceptFailures;
  let conditionalDeleteEditInjected = false;
  let deleteRestoreInjected = false;
  let acquireFailureRemaining = acquireFailureAfterLock ? 1 : 0;
  let releaseFailureRemaining = releaseFailure ? 1 : 0;
  const connectionStats = { released: 0, destroyed: 0 };
  let releaseConcurrentSnapshot;
  const concurrentSnapshot = new Promise((resolve) => {
    releaseConcurrentSnapshot = resolve;
  });
  let markPrimarySnapshotStarted;
  let releasePrimarySnapshot;
  const primarySnapshotStarted = new Promise((resolve) => {
    markPrimarySnapshotStarted = resolve;
  });
  const primarySnapshotRelease = new Promise((resolve) => {
    releasePrimarySnapshot = resolve;
  });

  if (customImapSources.length > 0) {
    notes.splice(0, notes.length);
    customImapSources.forEach((source, index) => {
      const raw = Buffer.isBuffer(source) ? source : Buffer.from(String(source));
      const messageId = raw.toString('utf8', 0, Math.min(raw.length, 64 * 1024))
        .match(/^Message-ID:\s*(.+)$/mi)?.[1]?.trim() || `<custom-note-${index + 1}@example.test>`;
      mailbox.push({
        uid: index + 1,
        flags: [],
        envelope: { messageId },
        source: raw,
      });
    });
    nextUid = customImapSources.length + 1;
  } else if (linkedNoteCount > 0) {
    notes.splice(0, notes.length);
    for (let index = 1; index <= linkedNoteCount; index += 1) {
      const messageId = `<note-${index}-1@openmailstack.local>`;
      notes.push({
        id: `note-${index}`,
        owner,
        title: `Linked note ${index}`,
        content: `<p>Note ${index}</p>`,
        color: '#ffffff',
        is_pinned: 0,
        is_locked: 0,
        folder: 'notes',
        labels_json: '[]',
        sync_token: 1,
        imap_sync_token: 1,
        imap_uid: index,
        imap_msgid: messageId,
        is_deleted: 0,
        created_at: '2026-08-15T00:00:00.000Z',
        updated_at: '2026-08-15T00:00:00.000Z',
      });
      mailbox.push({
        uid: index,
        flags: [],
        envelope: { messageId },
        source: Buffer.from(`Message-ID: ${messageId}\r\n\r\n<p>Note ${index}</p>`),
      });
    }
    nextUid = linkedNoteCount + 1;
    if (duplicateLinkedMessage) {
      const duplicate = { ...mailbox[0], uid: nextUid };
      mailbox.push(duplicate);
      nextUid += 1;
    }
    if (dirtyLinkedNote) {
      notes[0].content = '<p>Updated linked content</p>';
      notes[0].sync_token = 2;
    }
    if (deletedLinkedNote) {
      notes[0].is_deleted = 1;
      notes[0].sync_token = 2;
      notes[0].imap_sync_token = 1;
    }
    if (missingLinkedMessage) mailbox.splice(0, mailbox.length);
  } else if (importThenEdit || imapOnlyNoteCount > 0) {
    notes.splice(0, notes.length);
    const count = imapOnlyNoteCount || 1;
    for (let index = 1; index <= count; index += 1) {
      const messageId = `<external-note-${index}@example.test>`;
      mailbox.push({
        uid: index,
        flags: [],
        envelope: { messageId },
        source: Buffer.from([
          'From: notes-race@example.test',
          'To: notes-race@example.test',
          `Subject: Imported note ${index}`,
          `Message-ID: ${messageId}`,
          'MIME-Version: 1.0',
          'Content-Type: text/html; charset="utf-8"',
          '',
          `<p>Imported content ${index}</p>`,
        ].join('\r\n')),
      });
    }
    nextUid = count + 1;
  }

  async function captureSnapshot(messages) {
    const snapshot = messages.map((message) => ({ ...message }));
    snapshotsStarted += 1;
    if (snapshotsStarted === 1) {
      await Promise.race([
        concurrentSnapshot,
        new Promise((resolve) => setTimeout(resolve, 30)),
      ]);
    } else if (snapshotsStarted === 2) {
      releaseConcurrentSnapshot();
    }
    return snapshot;
  }

  class FakeImapService {
    constructor(username) {
      this.username = username;
      this.client = { mailboxCreate: async () => {} };
    }

    async connect() {}

    async logout() {}

    async getFolders() {
      return [{ path: 'Notes' }];
    }

    async getMessages() {
      const visibleMessages = linkedNoteCount > 25 ? mailbox.slice(-25) : mailbox;
      return { messages: await captureSnapshot(visibleMessages) };
    }

    async getMessageIdentities() {
      if (this.username !== owner) return [];
      if (blockPrimaryOwnerSnapshot) {
        markPrimarySnapshotStarted();
        await primarySnapshotRelease;
      }
      return captureSnapshot(mailbox);
    }

    async getMessageByUid(_folder, uid, maxSourceBytes) {
      const message = mailbox.find((candidate) => candidate.uid === uid);
      if (!message) return null;
      const size = message.source.length;
      const bounded = Number.isFinite(maxSourceBytes) && maxSourceBytes > 0;
      const source = bounded ? message.source.subarray(0, maxSourceBytes) : message.source;
      return {
        ...message,
        source,
        size,
        sourceComplete: !bounded || source.length >= size,
      };
    }

    async appendMessage(_folder, content) {
      const rawContent = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
      const messageId = rawContent.match(/^Message-ID:\s*(.+)$/mi)?.[1]?.trim() || '';
      mailbox.push({
        uid: nextUid++,
        flags: [],
        envelope: { messageId },
        source: Buffer.from(rawContent),
      });
      appendCount += 1;
      if (deleteDuringFirstAppend && appendCount === 1) {
        notes[0].is_deleted = 1;
        notes[0].sync_token += 1;
      }
      if (appendFailuresRemaining > 0) {
        appendFailuresRemaining -= 1;
        throw new Error('simulated uncertain IMAP append result');
      }
    }

    async messageAction(_folder, uids, action) {
      assert.ok(action === 'delete' || action === 'hardDelete');
      if (action === 'delete' && deleteFailuresRemaining > 0) {
        deleteFailuresRemaining -= 1;
        throw new Error('simulated IMAP delete failure');
      }
      for (const uid of uids) {
        const index = mailbox.findIndex((message) => message.uid === uid);
        if (index >= 0) mailbox.splice(index, 1);
        if (action === 'delete' && restoreDuringDelete && !deleteRestoreInjected) {
          const note = notes.find((candidate) => candidate.imap_uid === uid);
          if (note) {
            deleteRestoreInjected = true;
            note.is_deleted = 0;
            note.sync_token += 1;
            note.content = '<p>Restored during delete</p>';
          }
        }
      }
    }
  }

  const heldLocks = new Set();
  const lockWaiters = new Map();

  async function acquireLock(lockName) {
    if (!heldLocks.has(lockName)) {
      heldLocks.add(lockName);
      return;
    }
    await new Promise((resolve) => {
      const waiters = lockWaiters.get(lockName) || [];
      waiters.push(resolve);
      lockWaiters.set(lockName, waiters);
    });
  }

  function releaseLock(lockName) {
    const waiters = lockWaiters.get(lockName) || [];
    const next = waiters.shift();
    if (waiters.length === 0) lockWaiters.delete(lockName);
    else lockWaiters.set(lockName, waiters);
    if (next) next();
    else heldLocks.delete(lockName);
  }

  const pool = {
    async getConnection() {
      const ownedLocks = new Set();
      return {
        async query(sql, params = []) {
          const statement = String(sql).replace(/\s+/g, ' ').trim();
          if (statement.startsWith('SELECT GET_LOCK')) {
            await acquireLock(params[0]);
            ownedLocks.add(params[0]);
            if (acquireFailureRemaining > 0) {
              acquireFailureRemaining -= 1;
              throw new Error('simulated ambiguous GET_LOCK result');
            }
            return [[{ acquired: 1 }], []];
          }
          if (statement.startsWith('SELECT RELEASE_LOCK')) {
            if (releaseFailureRemaining > 0) {
              releaseFailureRemaining -= 1;
              throw new Error('simulated RELEASE_LOCK transport failure');
            }
            if (ownedLocks.delete(params[0])) releaseLock(params[0]);
            return [[{ released: 1 }], []];
          }
          return pool.query(sql, params);
        },
        release() {
          connectionStats.released += 1;
          for (const lockName of ownedLocks) releaseLock(lockName);
          ownedLocks.clear();
        },
        destroy() {
          connectionStats.destroyed += 1;
          for (const lockName of ownedLocks) releaseLock(lockName);
          ownedLocks.clear();
        },
      };
    },
    async query(sql, params = []) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      if (statement.startsWith('ALTER TABLE notes')) return [{ affectedRows: 0 }, []];
      if (statement.startsWith('UPDATE notes SET imap_uid = ?, imap_sync_token = sync_token')) {
        const note = notes.find((candidate) => candidate.id === params[1] && candidate.owner === params[2]);
        if (note) {
          note.imap_uid = params[0];
          note.imap_sync_token = note.sync_token;
        }
        return [{ affectedRows: note ? 1 : 0 }, []];
      }
      if (statement.startsWith('UPDATE notes SET imap_uid = ? WHERE id = ? AND owner = ?')) {
        const note = notes.find((candidate) => candidate.id === params[1] && candidate.owner === params[2]);
        if (note) note.imap_uid = params[0];
        return [{ affectedRows: note ? 1 : 0 }, []];
      }
      if (statement.startsWith('UPDATE notes SET imap_uid = NULL, imap_sync_token = ?')) {
        const note = notes.find((candidate) => (
          candidate.id === params[1]
          && candidate.owner === params[2]
          && candidate.sync_token === params[3]
          && candidate.is_deleted === 1
        ));
        if (note) {
          note.imap_uid = null;
          note.imap_sync_token = params[0];
        }
        return [{ affectedRows: note ? 1 : 0 }, []];
      }
      if (statement.startsWith('UPDATE notes SET imap_sync_token = sync_token')) {
        const note = notes.find((candidate) => candidate.id === params[0]);
        if (note) note.imap_sync_token = note.sync_token;
        return [{ affectedRows: note ? 1 : 0 }, []];
      }
      if (statement.startsWith('UPDATE notes SET imap_sync_token = ?')) {
        const note = notes.find((candidate) => candidate.id === params[1] && candidate.owner === params[2]);
        if (note) note.imap_sync_token = params[0];
        return [{ affectedRows: note ? 1 : 0 }, []];
      }
      if (statement.startsWith('UPDATE notes SET imap_msgid = ?, imap_uid = NULL, imap_sync_token = sync_token')) {
        const note = notes.find((candidate) => candidate.id === params[1] && candidate.owner === params[2]);
        if (note) {
          note.imap_msgid = params[0];
          note.imap_uid = null;
          note.imap_sync_token = note.sync_token;
        }
        return [{ affectedRows: note ? 1 : 0 }, []];
      }
      if (statement.startsWith('UPDATE notes SET imap_msgid = ?, imap_uid = NULL, imap_sync_token = ?')) {
        const note = notes.find((candidate) => (
          candidate.id === params[2]
          && candidate.owner === params[3]
          && (params.length < 6 || (candidate.sync_token === params[4] && candidate.is_deleted === 0))
        ));
        if (note) {
          note.imap_msgid = params[0];
          note.imap_uid = null;
          note.imap_sync_token = params[1];
        }
        return [{ affectedRows: note ? 1 : 0 }, []];
      }
      if (statement.startsWith('UPDATE notes SET imap_msgid = ? WHERE id = ? AND owner = ?')) {
        const note = notes.find((candidate) => (
          candidate.id === params[1]
          && candidate.owner === params[2]
          && candidate.sync_token === params[3]
          && candidate.is_deleted === 0
        ));
        if (note) note.imap_msgid = params[0];
        return [{ affectedRows: note ? 1 : 0 }, []];
      }
      throw new Error(`Unexpected query: ${statement}`);
    },
  };

  const notesUtils = {
    validateNoteFields,
    async listNotes(requestedOwner) {
      return notes
        .filter((note) => note.owner === requestedOwner)
        .map((note) => ({ ...note }));
    },
    async saveNote(note) {
      if (!importThenEdit && imapOnlyNoteCount === 0 && appendAfterAcceptFailures === 0 && customImapSources.length === 0) {
        throw new Error('This scenario must not import a note.');
      }
      const imported = {
        ...note,
        ...validateNoteFields(note),
        sync_token: 1,
        imap_sync_token: 0,
        is_deleted: 0,
        created_at: '2026-08-15T00:00:00.000Z',
        updated_at: '2026-08-15T00:00:00.000Z',
      };
      notes.push(imported);
      const saved = { ...imported };
      if (importThenEdit) {
        imported.content = '<p>Edited during import</p>';
        imported.sync_token = 2;
      }
      return saved;
    },
    async deleteNoteIfRevisionMatches(id, requestedOwner, expectedSyncToken, expectedImapUid) {
      const note = notes.find((candidate) => candidate.id === id && candidate.owner === requestedOwner);
      if (note && editBeforeConditionalDelete && !conditionalDeleteEditInjected) {
        conditionalDeleteEditInjected = true;
        note.sync_token += 1;
        note.content = '<p>Edited while IMAP deletion was being reconciled</p>';
      }
      if (
        note
        && note.sync_token === expectedSyncToken
        && note.imap_sync_token === expectedSyncToken
        && note.imap_uid === expectedImapUid
        && note.is_deleted === 0
      ) {
        note.is_deleted = 1;
        note.sync_token += 1;
        note.imap_sync_token = note.sync_token;
        note.imap_uid = null;
        return true;
      }
      return false;
    },
  };

  delete require.cache[syncModulePath];
  require.cache[imapModulePath] = {
    id: imapModulePath,
    filename: imapModulePath,
    loaded: true,
    exports: { ImapService: FakeImapService },
  };
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: { pool },
  };
  require.cache[notesUtilsModulePath] = {
    id: notesUtilsModulePath,
    filename: notesUtilsModulePath,
    loaded: true,
    exports: notesUtils,
  };

  t.after(() => {
    releasePrimarySnapshot();
    for (const [modulePath, cacheEntry] of originalCacheEntries) {
      if (cacheEntry) require.cache[modulePath] = cacheEntry;
      else delete require.cache[modulePath];
    }
  });

  const firstRuntime = require(syncModulePath).syncNotesWithImap;
  let secondRuntime = null;
  if (loadSecondRuntime) {
    delete require.cache[syncModulePath];
    secondRuntime = require(syncModulePath).syncNotesWithImap;
  }

  return {
    owner,
    notes,
    mailbox,
    syncNotesWithImap: firstRuntime,
    secondSyncNotesWithImap: secondRuntime,
    primarySnapshotStarted,
    releasePrimarySnapshot,
    connectionStats,
  };
}

function captureExpectedSyncErrors(t) {
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.map(String).join(' '));
  t.after(() => { console.error = originalError; });
  return errors;
}

function captureExpectedSyncWarnings(t) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  t.after(() => { console.warn = originalWarn; });
  return warnings;
}

test('concurrent sync requests export one IMAP message for one note revision', async (t) => {
  const harness = installSyncHarness(t);

  await Promise.all([
    harness.syncNotesWithImap(harness.owner, 'unused'),
    harness.syncNotesWithImap(harness.owner, 'unused'),
  ]);

  assert.equal(harness.mailbox.length, 1);
  assert.equal(harness.notes[0].imap_sync_token, 1);
});

test('independent Notes runtimes share a database owner lock before exporting', async (t) => {
  const harness = installSyncHarness(t, { loadSecondRuntime: true });

  await Promise.all([
    harness.syncNotesWithImap(harness.owner, 'unused'),
    harness.secondSyncNotesWithImap(harness.owner, 'unused'),
  ]);

  assert.equal(harness.mailbox.length, 1);
  assert.equal(harness.notes[0].imap_sync_token, 1);
});

test('an ambiguous Notes lock acquisition destroys rather than pools the connection', async (t) => {
  const errors = captureExpectedSyncErrors(t);
  const harness = installSyncHarness(t, { acquireFailureAfterLock: true });

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.connectionStats.destroyed, 1);
  assert.equal(harness.connectionStats.released, 0);
  assert.ok(errors.some((error) => error.includes('simulated ambiguous GET_LOCK result')));

  await harness.syncNotesWithImap(harness.owner, 'unused');
  assert.equal(harness.mailbox.length, 1, 'destroying the ambiguous lease must release the server lock');
});

test('a Notes lock release failure destroys rather than pools the connection', async (t) => {
  const errors = captureExpectedSyncErrors(t);
  const harness = installSyncHarness(t, { releaseFailure: true });

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.connectionStats.destroyed, 1);
  assert.equal(harness.connectionStats.released, 0);
  assert.equal(harness.mailbox.length, 1);
  assert.ok(errors.some((error) => error.includes('Failed to release Notes synchronization lock')));
});

test('Notes export safely round-trips long Unicode headers and one deterministic OMS Message-ID', async (t) => {
  const title = '計画🚀'.repeat(300);
  const content = '<p>Résumé — 东京 — 🚀</p>';
  const harness = installSyncHarness(t, { noteOverrides: { title, content } });

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.mailbox.length, 1);
  const raw = harness.mailbox[0].source.toString('utf8');
  const messageIdHeaders = raw.match(/^Message-ID:/gmi) || [];
  assert.equal(messageIdHeaders.length, 1);
  assert.match(harness.notes[0].imap_msgid, /^<oms-note-[0-9a-f]{48}@openmailstack\.local>$/);
  assert.equal(harness.mailbox[0].envelope.messageId, harness.notes[0].imap_msgid);
  const parsed = await simpleParser(harness.mailbox[0].source);
  assert.equal(parsed.subject, title);
  assert.match(String(parsed.html), /Résumé — 东京 — 🚀/);
});

test('Notes export cannot turn title CRLF into injected headers or body', async (t) => {
  const harness = installSyncHarness(t, {
    noteOverrides: {
      title: 'Quarterly\r\nBcc: injected@example.test\r\n\r\nINJECTED-BODY',
      content: '<p>Only the real note body</p>',
    },
  });

  await harness.syncNotesWithImap(harness.owner, 'unused');

  const raw = harness.mailbox[0].source.toString('utf8');
  assert.doesNotMatch(raw, /^Bcc:\s*injected@example\.test$/mi);
  assert.equal((raw.match(/^Message-ID:/gmi) || []).length, 1);
  const parsed = await simpleParser(harness.mailbox[0].source);
  assert.equal(parsed.subject, 'Quarterly Bcc: injected@example.test INJECTED-BODY');
  assert.doesNotMatch(String(parsed.html), /INJECTED-BODY/);
  assert.match(String(parsed.html), /Only the real note body/);
});

test('an oversized IMAP note is skipped observably without blocking a valid following import', async (t) => {
  const warnings = captureExpectedSyncWarnings(t);
  const maxMessageBytes = 16 * 1024 * 1024;
  const oversizedHeaders = Buffer.from([
    'From: notes-race@example.test',
    'To: notes-race@example.test',
    'Subject: Oversized import',
    'Message-ID: <oversized-note@example.test>',
    'Content-Type: text/plain; charset="utf-8"',
    '',
  ].join('\r\n'));
  const oversized = Buffer.concat([
    oversizedHeaders,
    Buffer.alloc((maxMessageBytes + 1) - oversizedHeaders.length, 0x61),
  ]);
  const valid = [
    'From: notes-race@example.test',
    'To: notes-race@example.test',
    'Subject: Valid following note',
    'Message-ID: <valid-following-note@example.test>',
    'Content-Type: text/html; charset="utf-8"',
    '',
    '<p>Imported after oversized note</p>',
  ].join('\r\n');
  const harness = installSyncHarness(t, { customImapSources: [oversized, valid] });

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.notes.length, 1);
  assert.equal(harness.notes[0].title, 'Valid following note');
  assert.equal(harness.notes[0].imap_sync_token, 1);
  assert.ok(warnings.some((warning) => warning.includes('IMAP UID 1') && warning.includes('16 MiB')));
});

test('an IMAP note with a decoded over-limit field is skipped before SQL and later notes continue', async (t) => {
  const warnings = captureExpectedSyncWarnings(t);
  const overLimitTitle = 'x'.repeat((4 * 1024) + 1);
  const overLimit = [
    'From: notes-race@example.test',
    'To: notes-race@example.test',
    `Subject: ${overLimitTitle}`,
    'Message-ID: <over-limit-title@example.test>',
    'Content-Type: text/plain; charset="utf-8"',
    '',
    'This note must not be inserted.',
  ].join('\r\n');
  const valid = [
    'From: notes-race@example.test',
    'To: notes-race@example.test',
    'Subject: Valid after invalid field',
    'Message-ID: <valid-after-invalid@example.test>',
    'Content-Type: text/plain; charset="utf-8"',
    '',
    'This note should be inserted.',
  ].join('\r\n');
  const harness = installSyncHarness(t, { customImapSources: [overLimit, valid] });

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.notes.length, 1);
  assert.equal(harness.notes[0].title, 'Valid after invalid field');
  assert.ok(warnings.some((warning) => warning.includes('IMAP UID 1') && warning.includes('invalid note fields')));
});

test('a blocked owner sync does not block a different owner', async (t) => {
  const harness = installSyncHarness(t, { blockPrimaryOwnerSnapshot: true });
  const primarySync = harness.syncNotesWithImap(harness.owner, 'unused');
  await harness.primarySnapshotStarted;

  await Promise.race([
    harness.syncNotesWithImap('other-owner@example.test', 'unused'),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('different-owner sync was globally blocked')), 250);
    }),
  ]);

  harness.releasePrimarySnapshot();
  await primarySync;
  assert.equal(harness.mailbox.length, 1);
});

test('a newer web edit wins over a stale missing-IMAP deletion snapshot', async (t) => {
  const errors = captureExpectedSyncErrors(t);
  const harness = installSyncHarness(t, {
    linkedNoteCount: 1,
    missingLinkedMessage: true,
    editBeforeConditionalDelete: true,
  });

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.deepEqual(errors, []);
  assert.equal(harness.notes[0].is_deleted, 0);
  assert.equal(harness.notes[0].sync_token, 2);
  assert.equal(harness.notes[0].imap_sync_token, 2);
  assert.equal(harness.mailbox.length, 1);
  assert.match(harness.mailbox[0].source.toString(), /Edited while IMAP deletion/);
});

test('a note deleted during export is removed from IMAP on reconciliation', async (t) => {
  const harness = installSyncHarness(t, { deleteDuringFirstAppend: true });

  await harness.syncNotesWithImap(harness.owner, 'unused');
  assert.equal(harness.mailbox.length, 1);
  assert.equal(harness.notes[0].sync_token, 2);

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.mailbox.length, 0);
  assert.equal(harness.notes[0].imap_sync_token, 2);
});

test('a complete Notes mailbox identity snapshot preserves linked notes older than 25 messages', async (t) => {
  const harness = installSyncHarness(t, { linkedNoteCount: 30 });

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.notes.length, 30);
  assert.equal(harness.notes.filter((note) => note.is_deleted).length, 0);
  assert.equal(harness.mailbox.length, 30);
});

test('a complete Notes mailbox identity snapshot imports IMAP-only notes older than 25 messages', async (t) => {
  const harness = installSyncHarness(t, { imapOnlyNoteCount: 30 });

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.notes.length, 30);
  assert.equal(harness.mailbox.length, 30);
  assert.ok(harness.notes.some((note) => note.imap_uid === 1));
  assert.ok(harness.notes.some((note) => note.imap_uid === 30));
  assert.equal(harness.notes.filter((note) => note.imap_sync_token !== 1).length, 0);
});

test('an edit racing with IMAP import remains dirty and is exported in the same sync', async (t) => {
  const harness = installSyncHarness(t, { importThenEdit: true });

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.notes.length, 1);
  assert.equal(harness.notes[0].sync_token, 2);
  assert.equal(harness.notes[0].imap_sync_token, 2);
  assert.equal(harness.mailbox.length, 1);
  assert.match(harness.mailbox[0].source.toString(), /Edited during import/);
});

test('duplicate OMS Message-IDs converge to one canonical IMAP message and linked UID', async (t) => {
  const harness = installSyncHarness(t, {
    linkedNoteCount: 1,
    duplicateLinkedMessage: true,
  });

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.mailbox.length, 1);
  assert.equal(harness.mailbox[0].uid, 2);
  assert.equal(harness.notes[0].is_deleted, 0);
  assert.equal(harness.notes[0].imap_uid, 2);
});

test('a failed old-message delete never appends a duplicate replacement', async (t) => {
  const errors = captureExpectedSyncErrors(t);
  const harness = installSyncHarness(t, {
    linkedNoteCount: 1,
    dirtyLinkedNote: true,
    replaceDeleteFailures: 1,
  });

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.mailbox.length, 1);
  assert.equal(harness.notes[0].imap_sync_token, 1);
  assert.ok(errors.some((error) => error.includes('simulated IMAP delete failure')));

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.mailbox.length, 1);
  assert.equal(harness.notes[0].imap_sync_token, 2);
  assert.match(harness.mailbox[0].source.toString(), /Updated linked content/);
});

test('restoring a note during IMAP deletion cannot acknowledge the newer revision', async (t) => {
  const errors = captureExpectedSyncErrors(t);
  const harness = installSyncHarness(t, {
    linkedNoteCount: 1,
    deletedLinkedNote: true,
    restoreDuringDelete: true,
  });

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.deepEqual(errors, []);
  assert.equal(harness.mailbox.length, 0);
  assert.equal(harness.notes[0].is_deleted, 0);
  assert.equal(harness.notes[0].sync_token, 3);
  assert.equal(harness.notes[0].imap_sync_token, 1);
  assert.equal(harness.notes[0].imap_uid, 1);

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.mailbox.length, 1);
  assert.equal(harness.notes[0].imap_sync_token, 3);
  assert.match(harness.mailbox[0].source.toString(), /Restored during delete/);
});

test('an uncertain accepted append is reconciled without a second SQL or IMAP note', async (t) => {
  const errors = captureExpectedSyncErrors(t);
  const harness = installSyncHarness(t, { appendAfterAcceptFailures: 1 });

  await harness.syncNotesWithImap(harness.owner, 'unused');
  assert.equal(harness.notes.length, 1);
  assert.equal(harness.mailbox.length, 1);
  assert.ok(errors.some((error) => error.includes('simulated uncertain IMAP append result')));

  await harness.syncNotesWithImap(harness.owner, 'unused');

  assert.equal(harness.notes.length, 1);
  assert.equal(harness.mailbox.length, 1);
  assert.equal(harness.notes[0].imap_sync_token, 1);
});
