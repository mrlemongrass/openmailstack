const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';

const {
  brandingDefaults,
  normalizeBrandingSettings
} = require('../src/branding.js');

const tinyPng = 'data:image/png;base64,iVBORw0KGgo=';
const svgPayload = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=';

test('normalizeBrandingSettings trims text and preserves valid image data urls', () => {
  const normalized = normalizeBrandingSettings({
    appName: ' House Mail ',
    companyName: ' Housevo ',
    loginTitle: ' Welcome ',
    loginSubtitle: ' Sign in with your mailbox ',
    appIconDataUrl: tinyPng,
    faviconDataUrl: tinyPng,
    loginLogoDataUrl: tinyPng,
    loginBackgroundDataUrl: tinyPng
  });

  assert.equal(normalized.appName, 'House Mail');
  assert.equal(normalized.companyName, 'Housevo');
  assert.equal(normalized.loginTitle, 'Welcome');
  assert.equal(normalized.loginSubtitle, 'Sign in with your mailbox');
  assert.equal(normalized.appIconDataUrl, tinyPng);
  assert.equal(normalized.faviconDataUrl, tinyPng);
  assert.equal(normalized.loginLogoDataUrl, tinyPng);
  assert.equal(normalized.loginBackgroundDataUrl, tinyPng);
});

test('normalizeBrandingSettings rejects svg and invalid image payloads', () => {
  const normalized = normalizeBrandingSettings({
    appIconDataUrl: svgPayload,
    faviconDataUrl: 'https://example.com/favicon.png',
    loginLogoDataUrl: 'data:text/html;base64,PGgxPk5vPC9oMT4=',
    loginBackgroundDataUrl: 'not-an-image'
  });

  assert.equal(normalized.appIconDataUrl, '');
  assert.equal(normalized.faviconDataUrl, '');
  assert.equal(normalized.loginLogoDataUrl, '');
  assert.equal(normalized.loginBackgroundDataUrl, '');
});

test('normalizeBrandingSettings falls back when required text is blank', () => {
  const normalized = normalizeBrandingSettings({
    appName: '   ',
    loginTitle: '',
    loginSubtitle: null
  });

  assert.equal(normalized.appName, brandingDefaults.appName);
  assert.equal(normalized.loginTitle, brandingDefaults.loginTitle);
  assert.equal(normalized.loginSubtitle, brandingDefaults.loginSubtitle);
});
