const test = require('node:test');
const assert = require('node:assert/strict');
process.env.OMS_DB_PASSWORD ||= 'contact-groups-test';
const { isGroupVCard, vCardCategories, setVCardCategories } = require('../src/contact-groups.js');

test('categories preserve escaped separators, Unicode and folded/repeated properties', () => {
  const original = 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:keep\r\nNOTE:Keep me\r\nCATEGORIES:Family\\, Friends,Path\\\\,Semi\\;colon\r\nCATEGORIES:Folded \r\n Name,Family\\, Friends\r\nEND:VCARD\r\n';
  assert.deepEqual(vCardCategories(original), ['Family, Friends', 'Path\\', 'Semi;colon', 'Folded Name']);
  const names = ['Family, Friends', 'Path\\', '世界'.repeat(30)];
  const updated = setVCardCategories(original, names);
  assert.deepEqual(vCardCategories(updated), names);
  assert.match(updated, /UID:keep\r\nNOTE:Keep me/);
  for (const line of updated.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  assert.deepEqual(vCardCategories(setVCardCategories(updated, [])), []);
});

test('group cards are distinguished from ordinary vCards without matching note contents', () => {
  assert.equal(isGroupVCard('BEGIN:VCARD\r\nKIND:group\r\nEND:VCARD'), true);
  assert.equal(isGroupVCard('BEGIN:VCARD\r\nitem1.X-ADDRESSBOOKSERVER-KIND:gr\r\n oup\r\nEND:VCARD'), true);
  assert.equal(isGroupVCard('BEGIN:VCARD\r\nNOTE:KIND:group\r\nEND:VCARD'), false);
});

test('category input rejects control characters and excessive names/counts before writes', () => {
  assert.throws(() => vCardCategories('CATEGORIES:Bad\\nName'), /control/);
  assert.throws(() => vCardCategories('CATEGORIES:' + 'a'.repeat(256)), /255/);
  assert.throws(() => vCardCategories('CATEGORIES:' + Array.from({ length: 129 }, (_, i) => `Group ${i}`).join(',')), /128/);
});
