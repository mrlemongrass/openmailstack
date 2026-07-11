const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';

const { canDemoteGlobalAdmin, hasGlobalAdminAccess } = require('../src/auth.js');

test('hasGlobalAdminAccess only accepts explicit superadmin rows', () => {
  assert.equal(hasGlobalAdminAccess({ superadmin: 1 }), true);
  assert.equal(hasGlobalAdminAccess({ superadmin: '1' }), true);
  assert.equal(hasGlobalAdminAccess({ superadmin: 0 }), false);
  assert.equal(hasGlobalAdminAccess({ superadmin: null }), false);
  assert.equal(hasGlobalAdminAccess(null), false);
  assert.equal(hasGlobalAdminAccess(undefined), false);
});

test('canDemoteGlobalAdmin protects current and last superadmin', () => {
  assert.deepEqual(canDemoteGlobalAdmin('a@example.com', 'a@example.com', 2), {
    allowed: false,
    reason: 'You cannot remove your own superadmin role.',
  });
  assert.deepEqual(canDemoteGlobalAdmin('a@example.com', 'b@example.com', 1), {
    allowed: false,
    reason: 'At least one active superadmin is required.',
  });
  assert.deepEqual(canDemoteGlobalAdmin('a@example.com', 'b@example.com', 2), {
    allowed: true,
    reason: '',
  });
});
