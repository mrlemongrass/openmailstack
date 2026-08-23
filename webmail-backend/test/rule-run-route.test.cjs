const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'rule-run-route-test';

const user = 'rules@example.test';
const appliedPlans = [];
const invalidatedSnapshots = [];
const deletedSearchRows = [];
const copyResolutions = [];
let failNextApply = false;
let blockNextApply = false;

const { compileSieve } = require('../src/sieve-compiler.js');
const { RuleMoveApplyError } = require('../src/imap.js');
let activeScript = compileSieve({
  rules: [
    {
      id: 'finance',
      name: 'Finance',
      enabled: true,
      criteria: [{ field: 'subject', operator: 'contains', value: 'statement is available' }],
      actions: [{ type: 'move', folder: 'Finance' }],
    },
    {
      id: 'ads',
      name: 'Ads',
      enabled: true,
      criteria: [{ field: 'from', operator: 'contains', value: 'noreply@chase.com' }],
      actions: [{ type: 'move', folder: 'Ads' }],
    },
    {
      id: 'discard',
      name: 'Discard offers',
      enabled: true,
      criteria: [{ field: 'subject', operator: 'contains', value: 'limited offer' }],
      actions: [{ type: 'discard' }],
    },
    {
      id: 'same-folder',
      name: 'Already home',
      enabled: true,
      criteria: [{ field: 'subject', operator: 'contains', value: 'already home' }],
      actions: [{ type: 'move', folder: 'INBOX' }],
    },
    {
      id: 'header-or-body',
      name: 'Header fallback',
      enabled: true,
      condition: 'any',
      criteria: [
        { field: 'subject', operator: 'contains', value: 'header fallback' },
        { field: 'body', operator: 'contains', value: 'body fallback' },
      ],
      actions: [{ type: 'move', folder: 'Finance' }],
    },
    {
      id: 'body-only',
      name: 'Body only',
      enabled: true,
      criteria: [{ field: 'body', operator: 'contains', value: 'body fallback' }],
      actions: [{ type: 'move', folder: 'Ads' }],
    },
    {
      id: 'disabled-rule',
      name: 'Disabled rule',
      enabled: false,
      criteria: [{ field: 'subject', operator: 'contains', value: 'statement' }],
      actions: [{ type: 'move', folder: 'Ads' }],
    },
    {
      enabled: true,
      criteria: [{ field: 'subject', operator: 'contains', value: 'never matches' }],
      actions: [{ type: 'move', folder: 'Ads' }],
    },
  ],
});

const authPath = require.resolve('../src/auth.js');
const auth = require(authPath);
require.cache[authPath].exports = {
  ...auth,
  requireSession: (req, _res, next) => {
    req.user = { username: user, password: 'test-only', isAdmin: false };
    next();
  },
};

const manageSievePath = require.resolve('../src/managesieve.js');
require.cache[manageSievePath] = {
  id: manageSievePath,
  filename: manageSievePath,
  loaded: true,
  exports: {
    ManageSieveClient: class {
      async connect() {}
      async login() {}
      async getScript() { return activeScript; }
      async logout() {}
    },
  },
  children: [],
  paths: [],
};

const fakeImap = {
  async getFolders() {
    return [{ path: 'INBOX' }, { path: 'Finance' }, { path: 'Ads' }];
  },
  async getRuleRunBatch(folder, cursor, maxUid) {
    assert.equal(folder, 'INBOX');
    assert.equal(cursor, 0);
    assert.ok(maxUid === undefined || maxUid === 105);
    return {
      maxUid: 105,
      uidValidity: '9001',
      nextCursor: 105,
      done: true,
      messages: [
        {
          uid: 101,
          envelope: {
            subject: 'Your statement is available',
            from: [{ name: 'Chase', address: 'noreply@chase.com' }],
            to: [{ address: user }],
          },
          size: 500,
          sourceComplete: true,
        },
        {
          uid: 102,
          envelope: {
            subject: 'Limited offer',
            from: [{ address: 'offers@example.test' }],
            to: [{ address: user }],
          },
          size: 500,
          sourceComplete: true,
        },
        {
          uid: 103,
          envelope: {
            subject: 'Already home',
            from: [{ address: 'sender@example.test' }],
            to: [{ address: user }],
          },
          size: 500,
          sourceComplete: true,
        },
        {
          uid: 104,
          envelope: {
            subject: 'Header fallback',
            from: [{ address: 'sender@example.test' }],
            to: [{ address: user }],
          },
          size: 2 * 1024 * 1024,
          sourceComplete: false,
        },
        {
          uid: 105,
          envelope: {
            subject: 'Undecidable body',
            from: [{ address: 'sender@example.test' }],
            to: [{ address: user }],
          },
          size: 2 * 1024 * 1024,
          sourceComplete: false,
        },
      ],
    };
  },
  async applyRuleMoves(folder, plans) {
    appliedPlans.push({ folder, plans });
    if (blockNextApply) {
      blockNextApply = false;
      throw new RuleMoveApplyError({
        affected: 1,
        copied: 0,
        moved: 0,
        movedUids: [],
      }, new Error('simulated uncertain copy'), false, [{
        actionKey: 'a'.repeat(64),
        operationKey: 'b'.repeat(32),
        uid: 101,
        destination: 'Finance',
      }]);
    }
    if (failNextApply) {
      failNextApply = false;
      throw new RuleMoveApplyError({
        affected: 1,
        copied: 1,
        moved: 1,
        movedUids: [101],
      }, new Error('simulated partial failure'));
    }
    return {
      affected: plans.length,
      copied: 0,
      moved: plans.length,
      movedUids: plans.map(plan => plan.uid),
    };
  },
};

const imapPoolPath = require.resolve('../src/imap-pool.js');
require.cache[imapPoolPath] = {
  id: imapPoolPath,
  filename: imapPoolPath,
  loaded: true,
  exports: { getImapConnection: async () => fakeImap },
  children: [],
  paths: [],
};

const ruleRunLedgerPath = require.resolve('../src/rule-run-ledger.js');
require.cache[ruleRunLedgerPath] = {
  id: ruleRunLedgerPath,
  filename: ruleRunLedgerPath,
  loaded: true,
  exports: {
    RuleRunLedger: class {
      async pendingForSourceUids() { return []; }
      async reserve() {
        return {
          token: 'route-test',
          ready: new Set(),
          completed: new Set(),
          blocked: new Set(),
        };
      }
      async complete() {}
      async clear() {}
      async resolvePending(operationKey, actionKeys, resolution) {
        copyResolutions.push({ operationKey, actionKeys, resolution });
        return 1;
      }
    },
  },
  children: [],
  paths: [],
};

const searchWorkerPath = require.resolve('../src/search-worker.js');
const searchWorker = require(searchWorkerPath);
searchWorker.invalidateSearchIndexSnapshot = async username => {
  invalidatedSnapshots.push(username);
};

const searchIndexPath = require.resolve('../src/search-index.js');
const searchIndex = require(searchIndexPath);
searchIndex.deleteMailSearchRows = async (...args) => {
  deletedSearchRows.push(args);
};

const originalSetInterval = global.setInterval;
global.setInterval = () => ({ unref() {} });
const { apiRouter } = require('../src/api.js');
global.setInterval = originalSetInterval;

const requestJson = (port, body) => new Promise((resolve, reject) => {
  const payload = Buffer.from(JSON.stringify(body));
  const req = http.request({
    hostname: '127.0.0.1',
    port,
    path: '/api/rules/run',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
    },
  }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode,
      json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }));
  });
  req.on('error', reject);
  req.end(payload);
});

async function startServer(t) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

test('rule-run preview respects order and reports delivery-only matches without mutation', async t => {
  const port = await startServer(t);
  const response = await requestJson(port, { folder: 'INBOX', mode: 'preview', cursor: 0 });

  assert.equal(response.status, 200);
  assert.equal(response.json.processed, 5);
  assert.equal(response.json.affectedMessages, 2);
  assert.deepEqual(response.json.destinations, [{ folder: 'Finance', count: 2 }]);
  assert.deepEqual(response.json.ruleMatches, [
    { id: 'finance', name: 'Finance', count: 1 },
    { id: 'discard', name: 'Discard offers', count: 1 },
    { id: 'same-folder', name: 'Already home', count: 1 },
    { id: 'header-or-body', name: 'Header fallback', count: 1 },
  ]);
  assert.equal(response.json.deliveryOnlyMatches, 1);
  assert.equal(response.json.bodySkippedMessages, 1);
  assert.match(response.json.ruleRevision, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(appliedPlans, []);
});

test('rule-run preview evaluates only the selected saved rules', async t => {
  const port = await startServer(t);
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['ads'],
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.processed, 5);
  assert.equal(response.json.matchedMessages, 1);
  assert.equal(response.json.affectedMessages, 1);
  assert.deepEqual(response.json.destinations, [{ folder: 'Ads', count: 1 }]);
  assert.deepEqual(response.json.ruleMatches, [{ id: 'ads', name: 'Ads', count: 1 }]);
  assert.equal(response.json.deliveryOnlyMatches, 0);
  assert.equal(response.json.bodySkippedMessages, 0);
});

test('rule-run accepts the stable fallback identity of a legacy saved rule', async t => {
  const port = await startServer(t);
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['rule-8'],
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.processed, 5);
  assert.equal(response.json.matchedMessages, 0);
  assert.deepEqual(response.json.ruleMatches, []);
});

test('rule-run disambiguates colliding legacy rule names', async t => {
  const priorScript = activeScript;
  t.after(() => { activeScript = priorScript; });
  activeScript = compileSieve({
    rules: [
      {
        name: 'Same legacy name',
        enabled: true,
        criteria: [{ field: 'subject', operator: 'contains', value: 'statement is available' }],
        actions: [{ type: 'move', folder: 'Finance' }],
      },
      {
        name: 'Same legacy name',
        enabled: true,
        criteria: [{ field: 'from', operator: 'contains', value: 'noreply@chase.com' }],
        actions: [{ type: 'move', folder: 'Ads' }],
      },
    ],
  });
  const port = await startServer(t);
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['rule-2'],
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.json.ruleMatches, [
    { id: 'rule-2', name: 'Same legacy name', count: 1 },
  ]);
  assert.deepEqual(response.json.destinations, [{ folder: 'Ads', count: 1 }]);
});

test('rule-run accepts every selected saved rule without an arbitrary count mismatch', async t => {
  const priorScript = activeScript;
  t.after(() => { activeScript = priorScript; });
  const rules = Array.from({ length: 201 }, (_, index) => ({
    id: `many-${index + 1}`,
    name: `Many ${index + 1}`,
    enabled: true,
    criteria: [{ field: 'subject', operator: 'contains', value: `never-${index + 1}` }],
    actions: [{ type: 'move', folder: 'Finance' }],
  }));
  activeScript = compileSieve({ rules });
  const port = await startServer(t);
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: rules.map(rule => rule.id),
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.processed, 5);
  assert.equal(response.json.matchedMessages, 0);
});

test('rule-run validates an explicit saved-rule selection', async t => {
  const port = await startServer(t);

  const empty = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: [],
  });
  assert.equal(empty.status, 400);

  const duplicate = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['ads', 'ads'],
  });
  assert.equal(duplicate.status, 400);

  const unknown = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['missing-rule'],
  });
  assert.equal(unknown.status, 409);
  assert.equal(unknown.json.error, 'Selected rules changed or are disabled. Choose saved enabled rules and preview again.');

  const disabled = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['disabled-rule'],
  });
  assert.equal(disabled.status, 409);
  assert.equal(disabled.json.error, 'Selected rules changed or are disabled. Choose saved enabled rules and preview again.');
});

test('rule-run applies only the selection bound by preview', async t => {
  const port = await startServer(t);
  const preview = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['ads'],
  });
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    ruleIds: ['ads'],
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.appliedMessages, 1);
  assert.deepEqual(appliedPlans.at(-1), {
    folder: 'INBOX',
    plans: [{ uid: 101, moveFolders: ['Ads'] }],
  });
});

test('rule-run apply is bound to the previewed rule selection', async t => {
  const port = await startServer(t);
  const preview = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['ads'],
  });
  const appliedBefore = appliedPlans.length;
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    ruleIds: ['finance'],
  });

  assert.equal(response.status, 409);
  assert.equal(response.json.error, 'Rules or selection changed since preview. Preview again before applying.');
  assert.equal(appliedPlans.length, appliedBefore);
});

test('rule-run apply requires the preview revision, moves planned messages, and invalidates search', async t => {
  const port = await startServer(t);
  const missingPreview = await requestJson(port, { folder: 'INBOX', mode: 'apply', cursor: 0 });
  assert.equal(missingPreview.status, 400);

  const preview = await requestJson(port, { folder: 'INBOX', mode: 'preview', cursor: 0 });
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.appliedMessages, 2);
  assert.deepEqual(appliedPlans.at(-1), {
    folder: 'INBOX',
    plans: [
      { uid: 101, moveFolders: ['Finance'] },
      { uid: 104, moveFolders: ['Finance'] },
    ],
  });
  assert.equal(invalidatedSnapshots.at(-1), user);
});

test('rule-run rejects a stale saved-rule revision before changing mail', async t => {
  const port = await startServer(t);
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply',
    cursor: 0,
    maxUid: 105,
    uidValidity: '9001',
    ruleRevision: 'stale-preview',
  });

  assert.equal(response.status, 409);
  assert.equal(response.json.error, 'Rules changed since preview. Preview again before applying.');
});

test('rule-run reconciles search state after a retry-safe partial mailbox failure', async t => {
  const port = await startServer(t);
  const preview = await requestJson(port, { folder: 'INBOX', mode: 'preview', cursor: 0 });
  failNextApply = true;
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
  });

  assert.equal(response.status, 500);
  assert.match(response.json.error, /Apply again to reconcile safely/);
  assert.equal(response.json.retrySafe, true);
  assert.deepEqual(deletedSearchRows.at(-1), [user, 'INBOX', [101]]);
  assert.equal(invalidatedSnapshots.at(-1), user);
});

test('rule-run marks an uncertain copy as non-retryable to prevent duplication', async t => {
  const port = await startServer(t);
  const preview = await requestJson(port, { folder: 'INBOX', mode: 'preview', cursor: 0 });
  blockNextApply = true;
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
  });

  assert.equal(response.status, 500);
  assert.match(response.json.error, /not repeated to prevent duplicate mail/);
  assert.equal(response.json.retrySafe, false);
  assert.deepEqual(response.json.pendingCopies, [{
    actionKey: 'a'.repeat(64),
    uid: 101,
    destination: 'Finance',
  }]);
  assert.equal(invalidatedSnapshots.at(-1), user);

  const resolved = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    copyResolution: 'completed',
    copyActionKeys: response.json.pendingCopies.map(copy => copy.actionKey),
  });
  assert.equal(resolved.status, 200);
  assert.equal(copyResolutions.at(-1).resolution, 'completed');
  assert.deepEqual(copyResolutions.at(-1).actionKeys, ['a'.repeat(64)]);
  assert.match(copyResolutions.at(-1).operationKey, /^[a-f0-9]{32}$/);
});

test('rule-run rejects unknown source folders', async t => {
  const port = await startServer(t);
  const response = await requestJson(port, { folder: 'Missing', mode: 'preview' });

  assert.equal(response.status, 400);
  assert.equal(response.json.error, 'Choose an existing source folder.');
});
