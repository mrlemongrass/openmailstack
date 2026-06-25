const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';

const {
  adminSettingsDefaults,
  isAdminSettingsNamespace,
  normalizeAdminSettings
} = require('../src/admin-settings.js');

test('isAdminSettingsNamespace only accepts supported namespaces', () => {
  assert.equal(isAdminSettingsNamespace('organization'), true);
  assert.equal(isAdminSettingsNamespace('publicUrls'), true);
  assert.equal(isAdminSettingsNamespace('security'), true);
  assert.equal(isAdminSettingsNamespace('mailPolicy'), true);
  assert.equal(isAdminSettingsNamespace('system'), true);
  assert.equal(isAdminSettingsNamespace('branding'), false);
  assert.equal(isAdminSettingsNamespace('__proto__'), false);
});

test('normalizeAdminSettings bounds security settings', () => {
  const normalized = normalizeAdminSettings('security', {
    sessionLifetimeHours: 999,
    requireSecureCookies: false,
    allowUserPasswordChange: true,
    showLastLoginNotice: false
  });

  assert.deepEqual(normalized, {
    sessionLifetimeHours: adminSettingsDefaults.security.sessionLifetimeHours,
    requireSecureCookies: false,
    allowUserPasswordChange: true,
    showLastLoginNotice: false
  });
});

test('normalizeAdminSettings bounds mail policy settings', () => {
  const normalized = normalizeAdminSettings('mailPolicy', {
    maxAttachmentMb: 999,
    defaultQuotaMb: 1,
    spamPolicyMode: 'strict',
    allowExternalForwarding: false
  });

  assert.deepEqual(normalized, {
    maxAttachmentMb: 100,
    defaultQuotaMb: 128,
    spamPolicyMode: 'strict',
    allowExternalForwarding: false
  });
});

test('normalizeAdminSettings cleans organization text', () => {
  const normalized = normalizeAdminSettings('organization', {
    organizationName: ' Housevo ',
    supportEmail: ' support@example.com ',
    supportUrl: ' https://example.com/help ',
    defaultLocale: '',
    defaultTimeZone: ' America/Phoenix '
  });

  assert.equal(normalized.organizationName, 'Housevo');
  assert.equal(normalized.supportEmail, 'support@example.com');
  assert.equal(normalized.supportUrl, 'https://example.com/help');
  assert.equal(normalized.defaultLocale, adminSettingsDefaults.organization.defaultLocale);
  assert.equal(normalized.defaultTimeZone, 'America/Phoenix');
});
