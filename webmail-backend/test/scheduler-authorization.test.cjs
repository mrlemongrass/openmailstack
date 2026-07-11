const test = require('node:test');
const assert = require('node:assert/strict');

const {
  authorizeSchedulerAction,
  schedulerTenantKeyFromUsername,
} = require('../src/scheduler/authorization.js');

const published = {
  schedulerInstalled: true,
  tenantKey: 'housevo.us',
  ownerUsername: 'thang@housevo.us',
  bookingId: 'booking-1',
  schedulerEnabled: true,
  published: true,
};

test('derives normalized tenant keys only from full mailbox addresses', () => {
  assert.equal(schedulerTenantKeyFromUsername('Thang@HouseVo.US'), 'housevo.us');
  assert.throws(() => schedulerTenantKeyFromUsername('thang'), /full mailbox/);
});

test('public access is generic when Scheduler or the profile is unavailable', () => {
  assert.deepEqual(authorizeSchedulerAction({ kind: 'anonymous' }, 'profile.public.read', published), { allowed: true });
  assert.deepEqual(
    authorizeSchedulerAction({ kind: 'anonymous' }, 'slots.public.read', { ...published, schedulerEnabled: false }),
    { allowed: false, reason: 'not_found' }
  );
  assert.deepEqual(
    authorizeSchedulerAction({ kind: 'anonymous' }, 'booking.public.create', { ...published, schedulerInstalled: false }),
    { allowed: false, reason: 'not_found' }
  );
});

test('mailbox owners are confined to their tenant and cannot self-enable integrations', () => {
  const owner = { kind: 'user', username: 'thang@housevo.us', tenantKey: 'housevo.us' };
  assert.deepEqual(authorizeSchedulerAction(owner, 'scheduler.owner.write', published), { allowed: true });
  assert.deepEqual(authorizeSchedulerAction(owner, 'scheduler.entitlement.manage', published), { allowed: false, reason: 'forbidden' });
  assert.deepEqual(
    authorizeSchedulerAction(owner, 'scheduler.owner.read', { ...published, tenantKey: 'example.com' }),
    { allowed: false, reason: 'not_found' }
  );
});

test('scoped admins stay within assigned tenants while superadmins cross tenants', () => {
  const domainAdmin = { kind: 'admin', username: 'admin@housevo.us', superAdmin: false, tenantKeys: ['housevo.us'] };
  const superAdmin = { kind: 'admin', username: 'root@example.com', superAdmin: true, tenantKeys: [] };
  assert.deepEqual(authorizeSchedulerAction(domainAdmin, 'scheduler.entitlement.manage', published), { allowed: true });
  assert.deepEqual(
    authorizeSchedulerAction(domainAdmin, 'scheduler.entitlement.manage', { ...published, tenantKey: 'example.com' }),
    { allowed: false, reason: 'not_found' }
  );
  assert.deepEqual(
    authorizeSchedulerAction(superAdmin, 'scheduler.integration.manage', { ...published, tenantKey: 'example.com' }),
    { allowed: true }
  );
});

test('booking capability tokens are booking-bound, scoped, and expiring', () => {
  const token = {
    kind: 'capability',
    tenantKey: 'housevo.us',
    bookingId: 'booking-1',
    scopes: ['read', 'cancel'],
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  };
  const now = new Date('2029-01-01T00:00:00.000Z');
  assert.deepEqual(authorizeSchedulerAction(token, 'booking.capability.cancel', published, now), { allowed: true });
  assert.deepEqual(
    authorizeSchedulerAction(token, 'booking.capability.reschedule', published, now),
    { allowed: false, reason: 'forbidden' }
  );
  assert.deepEqual(
    authorizeSchedulerAction(token, 'booking.capability.read', { ...published, bookingId: 'booking-2' }, now),
    { allowed: false, reason: 'not_found' }
  );
  assert.deepEqual(
    authorizeSchedulerAction(token, 'booking.capability.read', published, new Date('2031-01-01T00:00:00Z')),
    { allowed: false, reason: 'expired' }
  );
  assert.deepEqual(
    authorizeSchedulerAction(token, 'booking.capability.read', { ...published, schedulerInstalled: false }, now),
    { allowed: false, reason: 'not_found' }
  );
});
