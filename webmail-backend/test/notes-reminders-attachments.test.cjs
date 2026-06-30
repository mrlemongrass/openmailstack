const { test } = require('node:test');
const assert = require('node:assert');

test('note reminders and attachments schemas defined', async () => {
    // Set required env var to avoid db config load failure
    process.env.OMS_DB_PASSWORD = process.env.OMS_DB_PASSWORD || 'test-password';

    // This test validates that the module exports exist and are callable
    // It doesn't require a database connection — just validates structure
    const mod = require('../src/notes-utils');
    assert.strictEqual(typeof mod.ensureRemindersSchema, 'function');
    assert.strictEqual(typeof mod.ensureAttachmentsSchema, 'function');
    assert.strictEqual(typeof mod.getNoteReminder, 'function');
    assert.strictEqual(typeof mod.saveNoteReminder, 'function');
    assert.strictEqual(typeof mod.deleteNoteReminder, 'function');
    assert.strictEqual(typeof mod.listNoteAttachments, 'function');
    assert.strictEqual(typeof mod.saveNoteAttachment, 'function');
    assert.strictEqual(typeof mod.deleteNoteAttachment, 'function');
    assert.strictEqual(typeof mod.listNotesWithReminders, 'function');
});
