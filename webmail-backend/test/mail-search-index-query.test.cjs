const assert = require('node:assert/strict');
const test = require('node:test');

const executed = [];
const dbPath = require.resolve('../src/db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    pool: {
      async query(sql, params = []) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        executed.push({ text, params });
        if (text.startsWith('SHOW COLUMNS')) return [[{ Field: 'present' }], []];
        return [[], []];
      },
    },
  },
  children: [],
  paths: [],
};

const { markMailSearchFolderRead, searchMailIndex } = require('../src/search-index.js');

const searchSelect = () => executed.find(call => (
  call.text.startsWith('SELECT folder, uid,') && call.text.includes('FROM mail_search_index')
));

test('ordinary all-field search filters with FULLTEXT instead of scanning message bodies with LIKE', async () => {
  executed.length = 0;

  await searchMailIndex('search@example.test', {
    query: 'quarterly roadmap',
    field: 'all',
    scope: 'all',
    folder: 'INBOX',
    limit: 50,
  });

  const call = searchSelect();
  assert.ok(call, 'search SELECT should execute');
  assert.match(call.text, /MATCH\(subject, sender, recipients, body_text, attachment_names\) AGAINST \(\? IN BOOLEAN MODE\)/);
  assert.doesNotMatch(call.text, /IN NATURAL LANGUAGE MODE/);
  assert.doesNotMatch(call.text, /body_text LIKE/);
  assert.ok(call.params.includes('+quarterly* +roadmap*'));
});

test('short all-field terms keep the bounded LIKE fallback', async () => {
  executed.length = 0;

  await searchMailIndex('search@example.test', {
    query: 'q2',
    field: 'all',
    scope: 'folder',
    folder: 'INBOX',
    limit: 50,
  });

  const call = searchSelect();
  assert.ok(call, 'search SELECT should execute');
  assert.match(call.text, /body_text LIKE/);
  assert.doesNotMatch(call.text, /IN BOOLEAN MODE/);
  assert.ok(call.params.includes('%q2%'));
});

test('quoted phrases keep exact LIKE semantics instead of broadening into word matches', async () => {
  executed.length = 0;

  await searchMailIndex('search@example.test', {
    query: '"quarterly roadmap"',
    field: 'all',
    scope: 'all',
    folder: 'INBOX',
    limit: 50,
  });

  const call = searchSelect();
  assert.ok(call, 'search SELECT should execute');
  assert.match(call.text, /body_text LIKE/);
  assert.doesNotMatch(call.text, /IN BOOLEAN MODE/);
  assert.ok(call.params.includes('%quarterly roadmap%'));
});

test('InnoDB stopwords use LIKE so accepted searches are not silently empty', async () => {
  executed.length = 0;

  await searchMailIndex('search@example.test', {
    query: 'the',
    field: 'all',
    scope: 'all',
    folder: 'INBOX',
    limit: 50,
  });

  const call = searchSelect();
  assert.ok(call, 'search SELECT should execute');
  assert.match(call.text, /body_text LIKE/);
  assert.doesNotMatch(call.text, /IN BOOLEAN MODE/);
  assert.ok(call.params.includes('%the%'));
});

test('folder-wide mark as read updates only the exact unread UIDs captured before concurrent flag changes', async () => {
  executed.length = 0;

  await markMailSearchFolderRead('search@example.test', 'INBOX/Receipts', [11, 207, 501]);

  const update = executed.find(call => call.text.startsWith('UPDATE mail_search_index'));
  assert.ok(update, 'search index flags should be updated');
  assert.match(update.text, /SET is_read = 1/);
  assert.match(update.text, /username = \? AND folder = \? AND uid IN \(\?\)/);
  assert.deepEqual(update.params, ['search@example.test', 'INBOX/Receipts', [11, 207, 501]]);
  assert.ok(!update.params[2].includes(5), 'an older message marked unread after SEARCH is not projected as read');
});

test('exact folder-wide read index updates stay inside bounded UID batches', async () => {
  executed.length = 0;
  const uids = Array.from({ length: 501 }, (_, index) => index + 1);

  await markMailSearchFolderRead('search@example.test', 'Bulk', uids);

  const updates = executed.filter(call => call.text.startsWith('UPDATE mail_search_index'));
  assert.equal(updates.length, 2);
  assert.equal(updates[0].params[2].length, 500);
  assert.deepEqual(updates[1].params[2], [501]);
});
