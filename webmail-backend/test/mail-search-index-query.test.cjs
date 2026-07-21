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

const { searchMailIndex } = require('../src/search-index.js');

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
