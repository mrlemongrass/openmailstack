const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');

// Opt-in: creates and removes only its randomly named, disposable database/user.
test('contact groups round-trip through webmail, CardDAV and ActiveSync', {
  skip: process.env.OMS_CONTACT_GROUP_DB_TEST !== '1',
}, async t => {
  const database = `oms_groups_${randomBytes(6).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  const sql = input => execFileSync('mariadb', ['--protocol=socket', '-uroot'], { input, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.match(database, /^oms_groups_[a-f0-9]{12}$/);
  sql(`CREATE DATABASE ${database}; CREATE USER '${database}'@'127.0.0.1' IDENTIFIED BY '${password}'; GRANT ALL ON ${database}.* TO '${database}'@'127.0.0.1';`);
  t.after(() => sql(`DROP DATABASE IF EXISTS ${database}; DROP USER IF EXISTS '${database}'@'127.0.0.1';`));
  Object.assign(process.env, { OMS_DB_HOST: '127.0.0.1', OMS_DB_NAME: database, OMS_DB_USER: database, OMS_DB_PASSWORD: password });
  const { pool } = require('../src/db.js');
  const contacts = require('../src/contact-utils.js');
  await contacts.ensureContactsSchema();
  // Older installations have a general_ci contact owner column alongside unicode_ci groups.
  await pool.query('ALTER TABLE contacts MODIFY username VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL');
  await pool.query('CREATE TABLE calendars (id INT PRIMARY KEY, user_id VARCHAR(255), dav_slug VARCHAR(255))');
  let owner = 'owner@example.test';
  const authPath = require.resolve('../src/auth.js');
  require(authPath);
  require.cache[authPath].exports.requireSession = (req, _res, next) => {
    req.user = { username: owner, password: 'fixture' }; next();
  };
  const davPath = require.resolve('../src/dav-auth.js');
  require(davPath);
  require.cache[davPath].exports.davBasicAuth = () => (req, _res, next) => { req.user = owner; next(); };
  const indexPath = require.resolve('../src/index.js');
  require.cache[indexPath] = { id: indexPath, filename: indexPath, loaded: true, exports: { io: { to: () => ({ emit() {} }) } } };
  const express = require('express');
  const app = express();
  app.use('/carddav', express.raw({ type: '*/*' }), require('../src/carddav.js').default);
  app.use(express.json());
  app.use('/api/apps', require('../src/apps-api.js').appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.end(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(url + '/api/apps' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  const card = (uid, extra = '') => `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${uid}\r\nFN:Test Contact\r\n${extra}END:VCARD\r\n`;
  const first = await contacts.saveContactFromVCard(owner, 'first', card('first'));
  const other = await contacts.saveContactFromVCard('other@example.test', 'other', card('other'));
  const group = await call('/contact-groups', 'POST', { name: 'Friends, Family' });
  assert.equal(group.status, 200);
  const href = `/carddav/addressbooks/${owner}/personal/first.vcf`;
  const before = await fetch(url + href);
  const oldEtag = before.headers.get('etag');
  await before.text();

  await t.test('web membership updates the contact vCard and revision', async () => {
    assert.equal((await call(`/contact-groups/${group.id}/members`, 'POST', { contactIds: [first.contact.id] })).status, 200);
    const response = await fetch(url + href);
    assert.match(await response.text(), /CATEGORIES:Friends\\, Family/);
    assert.notEqual(response.headers.get('etag'), oldEtag);
  });
  await t.test('membership cannot include another owner contact', async () => {
    const result = await call(`/contact-groups/${group.id}/members`, 'POST', { contactIds: [other.contact.id] });
    assert.equal(result.status, 404);
    const [rows] = await pool.query('SELECT * FROM contact_group_members WHERE contact_id = ?', [other.contact.id]);
    assert.equal(rows.length, 0);
  });
  await t.test('deleting another owner group cannot erase its members', async () => {
    owner = 'other@example.test';
    try { assert.equal((await call(`/contact-groups/${group.id}`, 'DELETE')).status, 404); }
    finally { owner = 'owner@example.test'; }
    const result = await call(`/contact-groups/${group.id}/members`);
    assert.deepEqual(result.members.map(row => row.contact_id), [first.contact.id]);
  });
  await t.test('a phone category edit updates the same webmail group', async () => {
    const response = await fetch(url + href, { method: 'PUT', headers: { 'Content-Type': 'text/vcard' }, body: card('first', 'CATEGORIES:Friends\\, Family,Travel\r\n') });
    assert.equal(response.status, 204);
    const result = await call('/contact-groups');
    assert.equal(result.groups.find(row => row.name === 'Friends, Family').id, group.id);
    assert.equal(result.groups.find(row => row.name === 'Travel')?.member_count, 1);
  });
  await t.test('ActiveSync preserves omitted categories and explicitly clears them', async () => {
    const eas = require('../src/eas-contacts.js');
    const current = await contacts.getContactByDavUid(owner, 'first');
    const categories = eas.contactToActiveSyncApplicationData(current).find(node => node.tag === 'Categories');
    assert.deepEqual(categories.children.map(node => node.content), ['Friends, Family', 'Travel']);
    const partial = eas.activeSyncContactApplicationDataToVCard('first', { tag: 'ApplicationData', page: 0, children: [
      { tag: 'FirstName', page: 1, content: 'Changed' },
    ] }, current.vcard_data);
    await contacts.saveContactFromVCard(owner, 'first', partial);
    assert.equal((await call(`/contact-groups/${group.id}/members`)).members.length, 1);
    const cleared = eas.activeSyncContactApplicationDataToVCard('first', { tag: 'ApplicationData', page: 0, children: [] }, partial, new Set(['1:Categories']));
    await contacts.saveContactFromVCard(owner, 'first', cleared);
    assert.equal((await call(`/contact-groups/${group.id}/members`)).members.length, 0);
    const third = eas.activeSyncContactApplicationDataToVCard('first', { tag: 'ApplicationData', page: 0, children: [
      { tag: 'Categories', page: 1, children: [{ tag: 'Category', page: 1, content: 'Friends, Family' }] },
    ] }, cleared);
    await contacts.saveContactFromVCard(owner, 'first', third);
    assert.equal((await call(`/contact-groups/${group.id}/members`)).members.length, 1);
  });
  await t.test('renames and deletions reach CardDAV and invalidate stale writes', async () => {
    const before = await fetch(url + href); const etag = before.headers.get('etag'); await before.text();
    assert.equal((await call(`/contact-groups/${group.id}`, 'PUT', { name: 'Renamed' })).status, 200);
    const after = await fetch(url + href);
    assert.match(await after.text(), /CATEGORIES:Renamed/);
    assert.notEqual(after.headers.get('etag'), etag);
    const stale = await fetch(url + href, { method: 'PUT', headers: { 'Content-Type': 'text/vcard', 'If-Match': etag }, body: card('first') });
    assert.equal(stale.status, 412); await stale.text();
    assert.equal((await call(`/contact-groups/${group.id}`, 'DELETE')).status, 200);
    assert.doesNotMatch(await (await fetch(url + href)).text(), /CATEGORIES:/);
    assert.ok(await contacts.getContactByDavUid(owner, 'first'), 'deleting a group retains its contacts');
  });
  await t.test('unsupported group cards never create fake contacts', async () => {
    for (const kind of ['KIND', 'X-ADDRESSBOOKSERVER-KIND']) {
      const response = await fetch(url + href.replace('first.vcf', 'group.vcf'), { method: 'PUT', headers: { 'Content-Type': 'text/vcard' }, body: card('group', `${kind}:group\r\nMEMBER:urn:uuid:first\r\n`) });
      assert.equal(response.status, 403); await response.text();
      assert.equal(await contacts.getContactByDavUid(owner, 'group'), null);
    }
  });
  await t.test('invalid batches are atomic and duplicate group names are rejected', async () => {
    const created = await call('/contact-groups', 'POST', { name: 'Atomic' });
    assert.equal((await call('/contact-groups', 'POST', { name: 'Atomic' })).status, 409);
    assert.equal((await call(`/contact-groups/${created.id}/members`, 'POST', { contactIds: [first.contact.id, other.contact.id] })).status, 404);
    assert.equal((await call(`/contact-groups/${created.id}/members`)).members.length, 0);
    assert.equal((await call(`/contact-groups/${created.id}`, 'PUT', { name: 'Injection\r\nFN:Bad' })).status, 400);
    const bad = await fetch(url + href, { method: 'PUT', headers: { 'Content-Type': 'text/vcard' }, body: card('first', 'CATEGORIES:Bad\\nName\r\n') });
    assert.equal(bad.status, 400); await bad.text();
    assert.equal((await call(`/contact-groups/${created.id}/members`, 'POST', { contactIds: [first.contact.id, first.contact.id] })).added, 1);
    assert.equal((await call(`/contact-groups/${created.id}/members`, 'POST', { contactIds: [first.contact.id] })).added, 0);
    assert.equal((await call(`/contact-groups/${created.id}/members/${first.contact.id}`, 'DELETE')).status, 200);
    assert.doesNotMatch(await (await fetch(url + href)).text(), /CATEGORIES:/);
  });
  await t.test('a database failure rolls back membership and contact revisions together', async () => {
    const created = await call('/contact-groups', 'POST', { name: 'Rollback' });
    const before = await contacts.getContactByDavUid(owner, 'first');
    await pool.query("CREATE TRIGGER reject_category_update BEFORE UPDATE ON contacts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Injected failure'");
    try { assert.equal((await call(`/contact-groups/${created.id}/members`, 'POST', { contactIds: [first.contact.id] })).status, 500); }
    finally { await pool.query('DROP TRIGGER reject_category_update'); }
    assert.equal((await call(`/contact-groups/${created.id}/members`)).members.length, 0);
    assert.equal((await contacts.getContactByDavUid(owner, 'first')).sync_token, before.sync_token);
  });
  await t.test('legacy reconciliation is previewable, additive and repeatable', async () => {
    const { reconcileContactGroups } = require('../src/contact-groups.js');
    const [legacy] = await pool.query('INSERT INTO contact_groups (username, name) VALUES (?, ?)', [owner, 'Legacy web group']);
    await pool.query('INSERT INTO contact_group_members (group_id, contact_id) VALUES (?, ?)', [legacy.insertId, first.contact.id]);
    await pool.query('UPDATE contacts SET vcard_data = ? WHERE id = ?', [card('first', 'CATEGORIES:Legacy phone category\r\n'), first.contact.id]);
    const before = await contacts.getContactByDavUid(owner, 'first');
    const preview = await reconcileContactGroups(owner);
    assert.equal(preview.contactsToReconcile, 1);
    assert.equal(preview.applied, false);
    assert.equal((await contacts.getContactByDavUid(owner, 'first')).vcard_data, before.vcard_data);
    assert.equal((await call('/contact-groups')).groups.some(row => row.name === 'Legacy phone category'), false);
    assert.equal((await reconcileContactGroups(owner, true)).contactsToReconcile, 1);
    const current = await contacts.getContactByDavUid(owner, 'first');
    assert.match(current.vcard_data, /CATEGORIES:Legacy phone category,Legacy web group/);
    assert.ok(current.sync_token > before.sync_token);
    assert.equal((await reconcileContactGroups(owner, true)).contactsToReconcile, 0);
    assert.equal((await contacts.getContactByDavUid(owner, 'first')).sync_token, current.sync_token);
    assert.equal((await call('/contact-groups')).groups.find(row => row.name === 'Legacy phone category').member_count, 1);
  });
  await t.test('native contact creation with a supplied vCard imports categories', async () => {
    const created = await call('/contacts', 'POST', { name: 'Web vCard', vcard_data: card('web', 'CATEGORIES:Imported\r\n') });
    assert.equal(created.status, 200);
    const group = (await call('/contact-groups')).groups.find(row => row.name === 'Imported');
    assert.equal(group.member_count, 1);
    assert.deepEqual((await call(`/contact-groups/${group.id}/members`)).members.map(row => row.contact_id), [created.id]);
    assert.equal((await call(`/contacts/${created.id}`, 'PUT', { name: 'Edited', vcard_data: card('web') })).status, 200);
    assert.equal((await call(`/contact-groups/${group.id}/members`)).members.length, 0);
    const fake = await call('/contacts', 'POST', { name: 'Fake', vcard_data: card('fake', 'KIND:group\r\n') });
    assert.equal(fake.status, 400);
  });
  await t.test('webmail group filtering covers pagination and remains owner-scoped', async () => {
    const group = (await call('/contact-groups')).groups.find(row => row.name === 'Legacy web group');
    const result = await call(`/contacts?groupId=${group.id}&limit=1`);
    assert.equal(result.status, 200);
    assert.equal(result.total, 1);
    assert.deepEqual(result.contacts.map(row => row.id), [first.contact.id]);
    assert.equal((await call(`/contacts?groupId=${group.id}&offset=1`)).contacts.length, 0);
    owner = 'other@example.test';
    try { assert.equal((await call(`/contacts?groupId=${group.id}`)).total, 0); }
    finally { owner = 'owner@example.test'; }
    assert.equal((await call('/contacts?groupId=bad')).status, 400);
  });
  await t.test('CardDAV responses fold long UTF-8 categories without changing their values', async () => {
    const name = '世界'.repeat(30);
    const group = await call('/contact-groups', 'POST', { name });
    assert.equal(group.status, 200);
    assert.equal((await call(`/contact-groups/${group.id}/members`, 'POST', { contactIds: [first.contact.id] })).status, 200);
    const response = await (await fetch(url + href)).text();
    assert.match(response, /\r\n /);
    for (const line of response.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
    assert.ok(require('../src/contact-groups.js').vCardCategories(response).includes(name));
  });
});
