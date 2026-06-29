const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';

const {
  isSettingsNamespace,
  normalizeSettings,
  settingsDefaults
} = require('../src/user-settings.js');

test('isSettingsNamespace only accepts supported settings namespaces', () => {
  assert.equal(isSettingsNamespace('mail'), true);
  assert.equal(isSettingsNamespace('calendar'), true);
  assert.equal(isSettingsNamespace('contacts'), true);
  assert.equal(isSettingsNamespace('appearance'), true);
  assert.equal(isSettingsNamespace('admin'), false);
  assert.equal(isSettingsNamespace('forwarding'), false);
  assert.equal(isSettingsNamespace('__proto__'), false);
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
    reading: { threaded: true, density: 'compact', previewPane: 'bottom', snippets: false, externalImages: 'trusted', markReadDelaySeconds: 3 }
  });

  assert.deepEqual(normalized, {
    signatures: [
      { id: 'work', name: 'Work', content: 'Regards', isDefault: true, defaultForNew: true, defaultForReply: true },
      { id: 'personal', name: 'Signature', content: '', isDefault: false, defaultForNew: false, defaultForReply: false }
    ],
    identity: { defaultFrom: 'sender@example.com', replyTo: 'reply@example.com', alwaysBccSelf: true },
    compose: { defaultMode: 'plain', defaultFont: 'mono', attachmentReminder: false, undoSendSeconds: 30 },
    reading: { threaded: true, density: 'compact', previewPane: 'bottom', snippets: false, externalImages: 'trusted', markReadDelaySeconds: 3 }
  });
});

test('normalizeSettings bounds calendar settings', () => {
  const normalized = normalizeSettings('calendar', {
    defaultCalendarId: 42,
    defaultView: 'agenda',
    defaultEventDurationMinutes: 9999,
    defaultReminderMinutes: 1440,
    weekStartsOn: 6,
    timeZone: 'America/Phoenix'
  });

  assert.equal(normalized.defaultCalendarId, 42);
  assert.equal(normalized.defaultView, 'agenda');
  assert.equal(normalized.defaultEventDurationMinutes, 480);
  assert.equal(normalized.defaultReminderMinutes, 1440);
  assert.equal(normalized.weekStartsOn, 6);
  assert.equal(normalized.timeZone, 'America/Phoenix');
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
