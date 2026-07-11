const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isSyncCollectionReport,
  syncTokenFromReportBody,
} = require('../src/dav-report.js');

test('detects unprefixed sync-collection REPORT bodies', () => {
  const body = [
    '<sync-collection xmlns="DAV:">',
    '<sync-token>http://sabre.io/ns/sync/1362</sync-token>',
    '</sync-collection>',
  ].join('');

  assert.equal(isSyncCollectionReport(body), true);
  assert.equal(syncTokenFromReportBody(body), 'http://sabre.io/ns/sync/1362');
});

test('detects Apple-style namespace-prefixed sync-collection REPORT bodies', () => {
  const body = [
    '<D:sync-collection xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">',
    '<D:sync-token>http://sabre.io/ns/sync/1362</D:sync-token>',
    '<D:sync-level>1</D:sync-level>',
    '<D:prop><D:getetag/><C:calendar-data/></D:prop>',
    '</D:sync-collection>',
  ].join('');

  assert.equal(isSyncCollectionReport(body), true);
  assert.equal(syncTokenFromReportBody(body), 'http://sabre.io/ns/sync/1362');
});

test('detects Apple-style CardDAV sync-collection REPORT bodies', () => {
  const body = [
    '<D:sync-collection xmlns:D="DAV:" xmlns:CARD="urn:ietf:params:xml:ns:carddav">',
    '<D:sync-token>http://openmailstack.local/carddav/431-3-1783737781</D:sync-token>',
    '<D:sync-level>1</D:sync-level>',
    '<D:prop><D:getetag/><CARD:address-data/></D:prop>',
    '</D:sync-collection>',
  ].join('');

  assert.equal(isSyncCollectionReport(body), true);
  assert.equal(syncTokenFromReportBody(body), 'http://openmailstack.local/carddav/431-3-1783737781');
});

test('ignores non-sync CalDAV REPORT bodies', () => {
  const body = [
    '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">',
    '<D:prop><D:getetag/><C:calendar-data/></D:prop>',
    '</C:calendar-query>',
  ].join('');

  assert.equal(isSyncCollectionReport(body), false);
  assert.equal(syncTokenFromReportBody(body), null);
});
