const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const sourceDir = path.join(__dirname, '..', 'src');
const syncModulePath = require.resolve(path.join(sourceDir, 'notes-imap-sync.js'));
const imapModulePath = require.resolve(path.join(sourceDir, 'imap.js'));
const dbModulePath = require.resolve(path.join(sourceDir, 'db.js'));
const notesUtilsModulePath = require.resolve(path.join(sourceDir, 'notes-utils.js'));

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
  }];
  const mailbox = [];
  let nextUid = 1;
  let snapshotsStarted = 0;
  let appendCount = 0;
  let deleteFailuresRemaining = replaceDeleteFailures;
  let appendFailuresRemaining = appendAfterAcceptFailures;
  let conditionalDeleteEditInjected = false;
  let deleteRestoreInjected = false;
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

  if (linkedNoteCount > 0) {
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

    async getMessageByUid(_folder, uid) {
      const message = mailbox.find((candidate) => candidate.uid === uid);
      return message ? { ...message } : null;
    }

    async appendMessage(_folder, content) {
      const messageId = content.match(/^Message-ID:\s*(.+)$/mi)?.[1]?.trim() || '';
      mailbox.push({
        uid: nextUid++,
        flags: [],
        envelope: { messageId },
        source: Buffer.from(content),
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
            return [[{ acquired: 1 }], []];
          }
          if (statement.startsWith('SELECT RELEASE_LOCK')) {
            if (ownedLocks.delete(params[0])) releaseLock(params[0]);
            return [[{ released: 1 }], []];
          }
          return pool.query(sql, params);
        },
        release() {
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
    async listNotes(requestedOwner) {
      return notes
        .filter((note) => note.owner === requestedOwner)
        .map((note) => ({ ...note }));
    },
    async saveNote(note) {
      if (!importThenEdit && imapOnlyNoteCount === 0 && appendAfterAcceptFailures === 0) {
        throw new Error('This scenario must not import a note.');
      }
      const imported = {
        ...note,
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
  };
}

function captureExpectedSyncErrors(t) {
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.map(String).join(' '));
  t.after(() => { console.error = originalError; });
  return errors;
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
