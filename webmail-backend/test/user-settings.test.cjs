const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';

const {
  isSettingsNamespace,
  normalizeSettings,
  saveMailFavoriteSettings,
  saveUserSettings,
  settingsDefaults
} = require('../src/user-settings.js');

test('isSettingsNamespace only accepts supported settings namespaces', () => {
  assert.equal(isSettingsNamespace('mail'), true);
  assert.equal(isSettingsNamespace('calendar'), true);
  assert.equal(isSettingsNamespace('contacts'), true);
  assert.equal(isSettingsNamespace('appearance'), true);
  assert.equal(isSettingsNamespace('templates'), true);
  assert.equal(isSettingsNamespace('admin'), false);
  assert.equal(isSettingsNamespace('forwarding'), false);
  assert.equal(isSettingsNamespace('__proto__'), false);
});

test('normalizeSettings sanitizes saved message templates', () => {
  const normalized = normalizeSettings('templates', {
    templates: [
      { name: ' Follow up ', content: 'Checking in.' },
      { name: '', content: 'Ignored' },
      { name: 'Invalid content', content: 123 },
      null,
    ],
  });

  assert.deepEqual(normalized, {
    templates: [
      { name: 'Follow up', content: 'Checking in.' },
      { name: 'Invalid content', content: '' },
    ],
  });
});

test('normalizeSettings returns safe mail settings', () => {
  const normalized = normalizeSettings('mail', {
    signatures: [
      { id: 'work', name: ' Work ', content: 'Regards', isDefault: true },
      { id: 'work', name: 'Duplicate', content: 'Ignored' },
      { id: 'personal', name: '', content: 123, isDefault: true }
    ],
    identity: { defaultFrom: ' sender@example.com ', replyTo: ' reply@example.com ', alwaysBccSelf: true },
    compose: { defaultMode: 'plain', defaultFont: 'mono', attachmentReminder: false, undoSendSeconds: 30 },
    reading: { threaded: true, density: 'compact', previewPane: 'bottom', snippets: false, externalImages: 'trusted', markReadDelaySeconds: 3 },
    folders: {
      favorites: [
        'INBOX',
        ' Projects/Travel ',
        'Archive',
        'INBOX',
        'Bad\u0000Path',
        'x'.repeat(1025),
        42,
      ],
      favoriteUidValidities: {
        INBOX: '9001',
        'Projects/Travel': ' 0009002 ',
        Archive: '4294967296',
        Missing: '9003',
      },
    },
  });

  assert.deepEqual(normalized, {
    signatures: [
      { id: 'work', name: 'Work', content: 'Regards', isDefault: true, defaultForNew: true, defaultForReply: true },
      { id: 'personal', name: 'Signature', content: '', isDefault: false, defaultForNew: false, defaultForReply: false }
    ],
    identity: { defaultFrom: 'sender@example.com', replyTo: 'reply@example.com', alwaysBccSelf: true },
    compose: { defaultMode: 'plain', defaultFont: 'mono', attachmentReminder: false, undoSendSeconds: 30 },
    reading: { threaded: true, density: 'compact', previewPane: 'bottom', snippets: false, externalImages: 'trusted', markReadDelaySeconds: 3 },
    spam: { blockedSenders: [], safeSenders: [] },
    folders: {
      favorites: ['INBOX', 'Projects/Travel', 'Archive'],
      favoriteUidValidities: { INBOX: '9001', 'Projects/Travel': '9002' },
    }
  });
});

test('normalizeSettings bounds calendar settings', () => {
  const normalized = normalizeSettings('calendar', {
    defaultCalendarId: 42,
    defaultView: 'agenda',
    defaultEventDurationMinutes: 9999,
    defaultReminderMinutes: 1440,
    weekStartsOn: 6,
    timeZoneMode: 'home',
    timeZone: 'America/Phoenix',
    showHeaderClock: false
  });

  assert.equal(normalized.defaultCalendarId, 42);
  assert.equal(normalized.defaultView, 'agenda');
  assert.equal(normalized.defaultEventDurationMinutes, 480);
  assert.equal(normalized.defaultReminderMinutes, 1440);
  assert.equal(normalized.weekStartsOn, 6);
  assert.equal(normalized.timeZoneMode, 'home');
  assert.equal(normalized.timeZone, 'America/Phoenix');
  assert.equal(normalized.showHeaderClock, false);
});

test('normalizeSettings safely defaults calendar timezone preferences', () => {
  const normalized = normalizeSettings('calendar', {
    timeZoneMode: 'invalid',
    timeZone: 'Not/A_Time_Zone',
    showHeaderClock: 'yes'
  });

  assert.equal(normalized.timeZoneMode, 'system');
  assert.equal(normalized.timeZone, 'UTC');
  assert.equal(normalized.showHeaderClock, true);
});

test('normalizeSettings preserves a legacy saved timezone as the home zone', () => {
  assert.equal(normalizeSettings('calendar', {}).timeZoneMode, 'system');
  const normalized = normalizeSettings('calendar', { timeZone: 'Asia/Baghdad' });
  assert.equal(normalized.timeZoneMode, 'home');
  assert.equal(normalized.timeZone, 'Asia/Baghdad');
});

test('normalizeSettings accepts firstName and lastName sortBy for contacts', () => {
  assert.equal(normalizeSettings('contacts', { sortBy: 'firstName' }).sortBy, 'firstName');
  assert.equal(normalizeSettings('contacts', { sortBy: 'lastName' }).sortBy, 'lastName');
  assert.equal(normalizeSettings('contacts', { sortBy: 'email' }).sortBy, 'email');
  assert.equal(normalizeSettings('contacts', { sortBy: 'name' }).sortBy, settingsDefaults.contacts.sortBy);
});

test('normalizeSettings accepts contacts display settings', () => {
  const normalized = normalizeSettings('contacts', {
    nameFormat: 'lastFirst',
    sortBy: 'email',
    listDensity: 'compact',
    autoCreateFromSent: false
  });

  assert.deepEqual(normalized, {
    nameFormat: 'lastFirst',
    sortBy: 'email',
    listDensity: 'compact',
    autoCreateFromSent: false
  });
});

test('normalizeSettings accepts appearance values and drops invalid ones', () => {
  const normalized = normalizeSettings('appearance', {
    themeMode: 'contrast',
    density: 'tiny',
    fontScale: 'large',
    radius: 'sharp',
    accentColor: 'green',
    reduceMotion: true
  });

  assert.deepEqual(normalized, {
    themeMode: 'contrast',
    density: settingsDefaults.appearance.density,
    fontScale: 'large',
    radius: 'sharp',
    accentColor: 'green',
    reduceMotion: true
  });
});

test('saveMailFavoriteSettings atomically replaces only the folders section', async t => {
  const db = require('../src/db.js');
  const originalQuery = db.pool.query;
  const queries = [];
  let stored = {
    ...settingsDefaults.mail,
    signatures: [{
      id: 'concurrent',
      name: 'Saved elsewhere',
      content: 'Do not overwrite',
      isDefault: true,
      defaultForNew: true,
      defaultForReply: true,
    }],
  };
  t.after(() => { db.pool.query = originalQuery; });
  db.pool.query = async (sql, params = []) => {
    const statement = String(sql);
    queries.push({ statement, params });
    if (statement.includes('CREATE TABLE IF NOT EXISTS webmail_user_settings')) return [[], []];
    if (statement.includes('INSERT INTO webmail_user_settings')) {
      const nextFolders = JSON.parse(params[2]);
      stored = { ...stored, folders: nextFolders };
      return [{ affectedRows: 1 }, []];
    }
    if (statement.includes('SELECT settings_json FROM webmail_user_settings')) {
      return [[{ settings_json: stored }], []];
    }
    throw new Error(`Unexpected query: ${statement}`);
  };

  const saved = await saveMailFavoriteSettings('favorite@example.test', {
    favorites: ['Projects'],
    favoriteUidValidities: { Projects: '101' },
  });

  assert.equal(saved.signatures[0].content, 'Do not overwrite');
  assert.deepEqual(saved.folders, {
    favorites: ['Projects'],
    favoriteUidValidities: { Projects: '101' },
  });
  const update = queries.find(query => query.statement.includes('INSERT INTO webmail_user_settings'));
  assert.match(update.statement, /JSON_SET\(settings_json, '\$\.folders'/);
  assert.deepEqual(JSON.parse(update.params[2]), saved.folders);
});

test('generic mail settings writes atomically preserve newer Favorite folders', async t => {
  const db = require('../src/db.js');
  const originalQuery = db.pool.query;
  const queries = [];
  let stored = {
    ...settingsDefaults.mail,
    folders: {
      favorites: ['Renamed'],
      favoriteUidValidities: { Renamed: '202' },
    },
  };
  t.after(() => { db.pool.query = originalQuery; });
  db.pool.query = async (sql, params = []) => {
    const statement = String(sql);
    queries.push({ statement, params });
    if (statement.includes('CREATE TABLE IF NOT EXISTS webmail_user_settings')) return [[], []];
    if (statement.includes('INSERT INTO webmail_user_settings')) {
      const incoming = JSON.parse(params[2]);
      stored = { ...incoming, folders: stored.folders };
      return [{ affectedRows: 1 }, []];
    }
    if (statement.includes('SELECT settings_json FROM webmail_user_settings')) {
      return [[{ settings_json: stored }], []];
    }
    throw new Error(`Unexpected query: ${statement}`);
  };

  const saved = await saveUserSettings('favorite@example.test', 'mail', {
    ...settingsDefaults.mail,
    signatures: [{
      id: 'new-signature',
      name: 'New signature',
      content: 'Saved from Settings',
      isDefault: true,
    }],
    folders: {
      favorites: ['Old'],
      favoriteUidValidities: { Old: '101' },
    },
  });

  assert.equal(saved.signatures[0].content, 'Saved from Settings');
  assert.deepEqual(saved.folders, {
    favorites: ['Renamed'],
    favoriteUidValidities: { Renamed: '202' },
  });
  const update = queries.find(query => query.statement.includes('INSERT INTO webmail_user_settings'));
  assert.match(update.statement, /JSON_EXTRACT\(settings_json, '\$\.folders'\)/);
});
