const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'rule-run-route-test';

const user = 'rules@example.test';
const appliedPlans = [];
const invalidatedSnapshots = [];
const deletedSearchRows = [];
const copyResolutions = [];
const ruleRunBatchCalls = [];
const scopeUidValidity = new Map([
  ['INBOX', '9001'],
  ['INBOX/Projects', '9002'],
  ['INBOX/Projects/2026', '9003'],
  ['Finance', '9100'],
  ['Ads', '9200'],
]);
let failNextApply = false;
let blockNextApply = false;
let ruleRunBatchOverride = null;
let activeScriptError = null;
let folderUidNextOverride = null;

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
      async getScript() {
        if (activeScriptError) throw activeScriptError;
        return activeScript;
      }
      async logout() {}
    },
  },
  children: [],
  paths: [],
};

const fakeImap = {
  async getFolders() {
    return [
      { path: 'INBOX', delimiter: '/' },
      { path: 'INBOX/Projects', delimiter: '/' },
      { path: 'INBOX/Projects/2026', delimiter: '/' },
      { path: 'INBOX/Disabled', delimiter: '/', disabled: true },
      { path: 'Finance', delimiter: '/' },
      { path: 'Ads', delimiter: '/' },
    ];
  },
  async getFolderUidNext(folderPaths) {
    if (folderUidNextOverride) return folderUidNextOverride(folderPaths);
    return {
      uidNextByFolder: new Map(folderPaths.map(folder => [folder, ({
        INBOX: 106,
        'INBOX/Projects': 202,
        'INBOX/Projects/2026': 302,
        Finance: 1,
        Ads: 1,
      })[folder] || 1])),
      uidValidityByFolder: new Map(folderPaths.map(folder => [folder, scopeUidValidity.get(folder) || '1'])),
      failedFolders: [],
    };
  },
  async getRuleRunBatch(folder, cursor, maxUid, _batchSize, _includeBody, readState = 'all') {
    if (ruleRunBatchOverride) {
      return ruleRunBatchOverride({ folder, cursor, maxUid, readState });
    }
    assert.equal(cursor, 0);
    const folderMaxUid = {
      INBOX: 105,
      'INBOX/Projects': 201,
      'INBOX/Projects/2026': 301,
    }[folder];
    assert.ok(maxUid === undefined || maxUid === folderMaxUid);
    ruleRunBatchCalls.push({ folder, readState });
    const messages = {
      'INBOX/Projects': [{
        uid: 201,
        envelope: {
          subject: 'Project statement is available',
          from: [{ address: 'project@example.test' }],
          to: [{ address: user }],
        },
        size: 500,
        sourceComplete: true,
        seen: false,
      }],
      'INBOX/Projects/2026': [{
        uid: 301,
        envelope: {
          subject: 'Archived statement is available',
          from: [{ address: 'archive@example.test' }],
          to: [{ address: user }],
        },
        size: 500,
        sourceComplete: true,
        seen: true,
      }],
      INBOX: [
        {
          uid: 101,
          envelope: {
            subject: 'Your statement is available',
            from: [{ name: 'Chase', address: 'noreply@chase.com' }],
            to: [{ address: user }],
            date: new Date('2026-08-01T16:30:00.000Z'),
          },
          size: 500,
          sourceComplete: true,
          seen: false,
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
          seen: true,
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
          seen: false,
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
          seen: true,
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
          seen: false,
        },
      ],
    }[folder] || [];
    const selectedMessages = messages.filter(message => (
      readState === 'all'
      || (readState === 'read' ? message.seen : !message.seen)
    ));
    return {
      maxUid: folderMaxUid,
      uidValidity: scopeUidValidity.get(folder) || '1',
      nextCursor: folderMaxUid,
      done: true,
      messages: selectedMessages,
    };
  },
  async applyRuleMoves(folder, plans) {
    appliedPlans.push({ folder, plans });
    if (blockNextApply) {
      blockNextApply = false;
      const pendingUid = plans[0]?.uid || 101;
      throw new RuleMoveApplyError({
        affected: 1,
        copied: 0,
        moved: 0,
        movedUids: [],
      }, new Error('simulated uncertain copy'), false, [{
        actionKey: 'a'.repeat(64),
        operationKey: 'b'.repeat(32),
        uid: pendingUid,
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
      constructor(_owner, sourceFolder) {
        this.sourceFolder = sourceFolder;
      }
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
        copyResolutions.push({
          sourceFolder: this.sourceFolder,
          operationKey,
          actionKeys,
          resolution,
        });
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

const requestGetJson = (port, path) => new Promise((resolve, reject) => {
  const req = http.request({
    hostname: '127.0.0.1',
    port,
    path,
    method: 'GET',
  }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode,
      json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }));
  });
  req.on('error', reject);
  req.end();
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

test('saved-rule loading distinguishes an absent script from a ManageSieve read failure', async t => {
  const port = await startServer(t);
  const originalScript = activeScript;
  t.after(() => {
    activeScript = originalScript;
    activeScriptError = null;
  });

  activeScriptError = new Error('GETSCRIPT failed: NO "Script doesn\'t exist"');
  const absent = await requestGetJson(port, '/api/rules');
  assert.equal(absent.status, 200);
  assert.deepEqual(absent.json, { rules: [] });

  activeScriptError = new Error('ManageSieve connection ended before response completed');
  const failed = await requestGetJson(port, '/api/rules');
  assert.equal(failed.status, 500);
  assert.match(failed.json.error, /connection ended/i);

  activeScriptError = null;
  activeScript = 'require ["fileinto"];\nkeep;';
  const unsupported = await requestGetJson(port, '/api/rules');
  assert.equal(unsupported.status, 409);
  assert.match(unsupported.json.error, /malformed/i);
});

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

test('rule-run preview returns auditable matched-message details when requested', async t => {
  const port = await startServer(t);
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['ads'],
    includeMatchDetails: true,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.json.matchDetails, [{
    folder: 'INBOX',
    uid: 101,
    subject: 'Your statement is available',
    from: 'Chase <noreply@chase.com>',
    date: '2026-08-01T16:30:00.000Z',
    rules: [{
      ruleIndex: 1,
      condition: 'all',
      matchedCriterionIndexes: [0],
      totalCriteria: 1,
    }],
    destinations: ['Ads'],
    outcome: 'move',
  }]);
  assert.match(response.json.previewToken, /^[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(response.json.matchRuleCatalog, [{
    ruleIndex: 1,
    name: 'Ads',
    condition: 'all',
    criteria: [{
      criterionIndex: 0,
      field: 'from',
      operator: 'contains',
      value: 'noreply@chase.com',
    }],
  }]);
});

test('rule-run preview evaluates saved wildcard-pattern criteria', async t => {
  const priorScript = activeScript;
  t.after(() => {
    activeScript = priorScript;
    ruleRunBatchOverride = null;
  });
  activeScript = compileSieve({
    rules: [{
      id: 'order-confirmations',
      name: 'Order confirmations',
      enabled: true,
      criteria: [{ field: 'subject', operator: 'matches', value: 'Order * confirmed' }],
      actions: [{ type: 'move', folder: 'Finance' }],
    }],
  });
  ruleRunBatchOverride = ({ cursor, maxUid }) => {
    assert.equal(cursor, 0);
    assert.equal(maxUid, 105);
    return {
      maxUid: 105,
      uidValidity: '9001',
      nextCursor: 105,
      done: true,
      messages: [
        { uid: 1, envelope: { subject: 'Order #37013 confirmed' }, size: 500, sourceComplete: true },
        { uid: 2, envelope: { subject: 'Order #36527 confirmed' }, size: 500, sourceComplete: true },
        { uid: 3, envelope: { subject: 'Order #36527 shipped' }, size: 500, sourceComplete: true },
      ],
    };
  };

  const port = await startServer(t);
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['order-confirmations'],
    includeMatchDetails: true,
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.processed, 3);
  assert.equal(response.json.matchedMessages, 2);
  assert.equal(response.json.affectedMessages, 2);
  assert.deepEqual(response.json.destinations, [{ folder: 'Finance', count: 2 }]);
  assert.deepEqual(
    response.json.matchDetails.map(message => message.subject),
    ['Order #37013 confirmed', 'Order #36527 confirmed'],
  );
  assert.deepEqual(response.json.matchRuleCatalog[0].criteria, [{
    criterionIndex: 0,
    field: 'subject',
    operator: 'matches',
    value: 'Order * confirmed',
  }]);
});

test('rule-run match details report only the decisive ANY criteria', async t => {
  const port = await startServer(t);
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['header-or-body'],
    includeMatchDetails: true,
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.matchDetails.length, 1);
  assert.deepEqual(response.json.matchDetails[0].rules, [{
    ruleIndex: 4,
    condition: 'any',
    matchedCriterionIndexes: [0],
    totalCriteria: 2,
  }]);
});

test('later match-detail pages stay bound to the completed preview token', async t => {
  const port = await startServer(t);
  const preview = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    readState: 'unread',
    ruleIds: ['ads'],
    includeMatchDetails: true,
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.matchDetails[0].uid, 101);

  ruleRunBatchOverride = ({ cursor, maxUid, readState }) => {
    assert.equal(cursor, 100);
    assert.equal(maxUid, 105);
    assert.equal(readState, 'all');
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
            date: new Date('2026-08-01T16:30:00.000Z'),
          },
          size: 500,
          sourceComplete: true,
        },
        {
          uid: 102,
          envelope: {
            subject: 'Newly matching after preview',
            from: [{ address: 'noreply@chase.com' }],
            to: [{ address: user }],
          },
          size: 500,
          sourceComplete: true,
        },
      ],
    };
  };
  t.after(() => { ruleRunBatchOverride = null; });

  const details = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 100,
    scopeIndex: 0,
    scopeSnapshot: preview.json.scopeSnapshot,
    readState: 'unread',
    ruleIds: ['ads'],
    ruleRevision: preview.json.ruleRevision,
    previewToken: preview.json.previewToken,
    includeMatchDetails: true,
  });

  assert.equal(details.status, 200);
  assert.deepEqual(details.json.matchDetails.map(message => message.uid), [101]);
  assert.equal(details.json.matchedMessages, 1);
});

test('rule-run bounds detail pages while preserving every matched rule and criterion index', async t => {
  const priorScript = activeScript;
  t.after(() => {
    activeScript = priorScript;
    ruleRunBatchOverride = null;
  });
  const indexes = Array.from({ length: 25 }, (_value, index) => index);
  activeScript = compileSieve({
    rules: indexes.map(ruleIndex => ({
      id: `wide-${ruleIndex}`,
      name: `Wide ${ruleIndex}`,
      enabled: true,
      stopProcessing: ruleIndex === indexes.length - 1,
      condition: 'all',
      criteria: indexes.map(criterionIndex => ({
        field: 'subject',
        operator: 'contains',
        value: `match-${criterionIndex}`,
      })),
      actions: [{ type: 'move', folder: 'Ads' }],
    })),
  });
  ruleRunBatchOverride = ({ cursor, maxUid }) => {
    assert.equal(cursor, 0);
    assert.equal(maxUid, 105);
    return {
      maxUid: 105,
      uidValidity: '9001',
      nextCursor: 105,
      done: true,
      messages: Array.from({ length: 25 }, (_value, index) => ({
        uid: index + 1,
        envelope: {
          subject: indexes.map(criterionIndex => `match-${criterionIndex}`).join(' '),
          from: [{ address: 'sender@example.test' }],
          to: [{ address: user }],
        },
        size: 500,
        sourceComplete: true,
      })),
    };
  };

  const port = await startServer(t);
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    includeMatchDetails: true,
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.processed, 20);
  assert.equal(response.json.matchDetails.length, 20);
  assert.equal(response.json.cursor, 20);
  assert.equal(response.json.done, false);
  assert.equal(response.json.matchDetails[0].rules.length, 25);
  assert.equal(response.json.matchRuleCatalog.length, 25);
  assert.equal(response.json.matchRuleCatalog[0].criteria.length, 25);
  assert.deepEqual(response.json.matchDetails[0].rules[0], {
    ruleIndex: 0,
    condition: 'all',
    matchedCriterionIndexes: indexes,
    totalCriteria: 25,
  });
  assert.equal('matchedCriteria' in response.json.matchDetails[0].rules[0], false);
  assert.equal('additionalRuleCount' in response.json.matchDetails[0], false);
});

test('rule-run rejects saved rule documents beyond the bounded evaluation contract', async t => {
  const priorScript = activeScript;
  t.after(() => { activeScript = priorScript; });
  const oversizedDocument = {
    rules: Array.from({ length: 1001 }, (_value, index) => ({
      id: `oversized-${index}`,
      criteria: [{ field: 'subject', operator: 'contains', value: 'statement' }],
      actions: [{ type: 'move', folder: 'Finance' }],
    })),
  };
  activeScript = `/* JSON_DATA_BASE64: ${Buffer.from(JSON.stringify(oversizedDocument)).toString('base64url')} */`;
  const callsBefore = ruleRunBatchCalls.length;
  const port = await startServer(t);
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    includeMatchDetails: true,
  });

  assert.equal(response.status, 409);
  assert.match(response.json.error, /saved rules exceed/i);
  assert.equal(ruleRunBatchCalls.length, callsBefore);
});

test('rule-run rejects malformed saved-rule metadata instead of treating it as no rules', async t => {
  const priorScript = activeScript;
  t.after(() => { activeScript = priorScript; });
  activeScript = '/* JSON_DATA_BASE64: eyJydWxlcyI6W10 */';
  const callsBefore = ruleRunBatchCalls.length;
  const port = await startServer(t);
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    includeMatchDetails: true,
  });

  assert.equal(response.status, 409);
  assert.match(response.json.error, /saved rules are malformed/i);
  assert.equal(ruleRunBatchCalls.length, callsBefore);
});

test('rule-run distinguishes an absent saved script from a ManageSieve read failure', async t => {
  t.after(() => { activeScriptError = null; });
  const port = await startServer(t);
  const callsBefore = ruleRunBatchCalls.length;

  activeScriptError = new Error('GETSCRIPT failed: NO "Script doesn\'t exist"');
  const absent = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    includeMatchDetails: true,
  });
  assert.equal(absent.status, 200);
  assert.equal(absent.json.matchedMessages, 0);
  assert.equal(ruleRunBatchCalls.length, callsBefore + 1);

  activeScriptError = new Error('ManageSieve connection ended before response completed');
  const unavailable = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    includeMatchDetails: true,
  });
  assert.equal(unavailable.status, 500);
  assert.match(unavailable.json.error, /connection ended/i);
  assert.equal(ruleRunBatchCalls.length, callsBefore + 1);
});

test('rule-run rejects match-detail requests during Apply', async t => {
  const port = await startServer(t);
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply',
    cursor: 0,
    maxUid: 105,
    uidValidity: '9001',
    ruleRevision: 'not-a-real-preview',
    includeMatchDetails: true,
  });

  assert.equal(response.status, 400);
  assert.match(response.json.error, /invalid rule-run request/i);
});

test('rule-run pages through selectable subfolders with one unread scope snapshot', async t => {
  const port = await startServer(t);
  const callsBefore = ruleRunBatchCalls.length;
  const first = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['finance'],
    includeSubfolders: true,
    readState: 'unread',
  });

  assert.equal(first.status, 200);
  assert.equal(first.json.sourceFolder, 'INBOX');
  assert.equal(first.json.processed, 3);
  assert.equal(first.json.affectedMessages, 1);
  assert.equal(first.json.scopeIndex, 1);
  assert.equal(first.json.cursor, 0);
  assert.equal(first.json.done, false);
  assert.deepEqual(first.json.scopeSnapshot, [
    { folder: 'INBOX', maxUid: 105, uidValidity: '9001' },
    { folder: 'INBOX/Projects', maxUid: 201, uidValidity: '9002' },
    { folder: 'INBOX/Projects/2026', maxUid: 301, uidValidity: '9003' },
  ]);

  const second = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: first.json.cursor,
    scopeIndex: first.json.scopeIndex,
    scopeSnapshot: first.json.scopeSnapshot,
    ruleRevision: first.json.ruleRevision,
    ruleIds: ['finance'],
    includeSubfolders: true,
    readState: 'unread',
  });
  assert.equal(second.status, 200);
  assert.equal(second.json.sourceFolder, 'INBOX/Projects');
  assert.equal(second.json.processed, 1);
  assert.equal(second.json.affectedMessages, 1);
  assert.equal(second.json.scopeIndex, 2);
  assert.equal(second.json.cursor, 0);
  assert.equal(second.json.done, false);

  const third = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: second.json.cursor,
    scopeIndex: second.json.scopeIndex,
    scopeSnapshot: second.json.scopeSnapshot,
    ruleRevision: second.json.ruleRevision,
    ruleIds: ['finance'],
    includeSubfolders: true,
    readState: 'unread',
  });
  assert.equal(third.status, 200);
  assert.equal(third.json.sourceFolder, 'INBOX/Projects/2026');
  assert.equal(third.json.processed, 0);
  assert.equal(third.json.done, true);
  assert.deepEqual(ruleRunBatchCalls.slice(callsBefore), [
    { folder: 'INBOX', readState: 'unread' },
    { folder: 'INBOX/Projects', readState: 'unread' },
    { folder: 'INBOX/Projects/2026', readState: 'unread' },
  ]);
});

test('rule-run applies the previewed unread scope in folder order', async t => {
  const port = await startServer(t);
  const plansBefore = appliedPlans.length;
  const previewPages = [];
  let previewRequest = {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['finance', 'ads'],
    includeSubfolders: true,
    readState: 'unread',
  };
  while (true) {
    const page = await requestJson(port, previewRequest);
    assert.equal(page.status, 200);
    previewPages.push(page.json);
    if (page.json.done) break;
    previewRequest = {
      ...previewRequest,
      cursor: page.json.cursor,
      scopeIndex: page.json.scopeIndex,
      scopeSnapshot: page.json.scopeSnapshot,
      ruleRevision: page.json.ruleRevision,
    };
  }

  const snapshot = previewPages[0].scopeSnapshot;
  const revision = previewPages[0].ruleRevision;
  const applyPages = [];
  let applyRequest = {
    folder: 'INBOX',
    mode: 'apply',
    cursor: 0,
    ruleIds: ['finance', 'ads'],
    includeSubfolders: true,
    readState: 'unread',
    scopeIndex: 0,
    scopeSnapshot: snapshot,
    ruleRevision: revision,
  };
  while (true) {
    const page = await requestJson(port, applyRequest);
    assert.equal(page.status, 200);
    applyPages.push(page.json);
    if (page.json.done) break;
    applyRequest = {
      ...applyRequest,
      cursor: page.json.cursor,
      scopeIndex: page.json.scopeIndex,
    };
  }

  assert.deepEqual(applyPages.map(page => ({
    sourceFolder: page.sourceFolder,
    appliedMessages: page.appliedMessages,
  })), [
    { sourceFolder: 'INBOX', appliedMessages: 1 },
    { sourceFolder: 'INBOX/Projects', appliedMessages: 1 },
    { sourceFolder: 'INBOX/Projects/2026', appliedMessages: 0 },
  ]);
  assert.deepEqual(appliedPlans.slice(plansBefore), [
    { folder: 'INBOX', plans: [{ uid: 101, moveFolders: ['Finance'] }] },
    { folder: 'INBOX/Projects', plans: [{ uid: 201, moveFolders: ['Finance'] }] },
    { folder: 'INBOX/Projects/2026', plans: [] },
  ]);
});

test('rule-run preflights every previewed folder before the first scoped mutation', async t => {
  const port = await startServer(t);
  const preview = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['finance'],
    includeSubfolders: true,
    readState: 'unread',
  });
  assert.equal(preview.status, 200);

  const priorValidity = scopeUidValidity.get('INBOX/Projects');
  t.after(() => scopeUidValidity.set('INBOX/Projects', priorValidity));
  scopeUidValidity.set('INBOX/Projects', '9999');
  const plansBefore = appliedPlans.length;
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply',
    cursor: 0,
    ruleIds: ['finance'],
    includeSubfolders: true,
    readState: 'unread',
    scopeIndex: 0,
    scopeSnapshot: preview.json.scopeSnapshot,
    ruleRevision: preview.json.ruleRevision,
  });

  assert.equal(response.status, 409);
  assert.equal(response.json.error, 'A source folder changed since preview. Preview again before applying.');
  assert.equal(appliedPlans.length, plansBefore);
});

test('rule-run binds read-state selection to the preview revision', async t => {
  const port = await startServer(t);
  const preview = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['finance'],
    readState: 'unread',
  });
  const plansBefore = appliedPlans.length;
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply',
    cursor: 0,
    ruleIds: ['finance'],
    readState: 'read',
    scopeSnapshot: preview.json.scopeSnapshot,
    ruleRevision: preview.json.ruleRevision,
  });

  assert.equal(response.status, 409);
  assert.equal(response.json.error, 'Rules, selection, or message scope changed since preview. Preview again before applying.');
  assert.equal(appliedPlans.length, plansBefore);
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

test('rule-run applies only owner-selected matched messages', async t => {
  const port = await startServer(t);
  const previewSelection = () => requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['finance', 'header-or-body'],
    includeMatchDetails: true,
  });
  let preview = await previewSelection();
  assert.equal(preview.status, 200);
  assert.equal(preview.json.affectedMessages, 2);

  const plansBeforeExclusion = appliedPlans.length;
  const excluded = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    previewToken: preview.json.previewToken,
    ruleIds: ['finance', 'header-or-body'],
    messageSelection: {
      mode: 'allExcept',
      groups: [{ folder: 'INBOX', uids: [101] }],
    },
  });

  assert.equal(excluded.status, 200);
  assert.equal(excluded.json.affectedMessages, 1);
  assert.equal(excluded.json.appliedMessages, 1);
  assert.deepEqual(appliedPlans.slice(plansBeforeExclusion), [{
    folder: 'INBOX',
    plans: [{ uid: 104, moveFolders: ['Finance'] }],
  }]);

  preview = await previewSelection();
  const included = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    previewToken: preview.json.previewToken,
    ruleIds: ['finance', 'header-or-body'],
    messageSelection: {
      mode: 'only',
      groups: [{ folder: 'INBOX', uids: [101] }],
    },
  });

  assert.equal(included.status, 200);
  assert.equal(included.json.appliedMessages, 1);
  assert.deepEqual(appliedPlans.at(-1), {
    folder: 'INBOX',
    plans: [{ uid: 101, moveFolders: ['Finance'] }],
  });

  const singlePreview = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['finance'],
    includeMatchDetails: true,
  });
  const plansBeforeUnseen = appliedPlans.length;
  const unseen = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: 0,
    maxUid: singlePreview.json.maxUid,
    uidValidity: singlePreview.json.uidValidity,
    ruleRevision: singlePreview.json.ruleRevision,
    previewToken: singlePreview.json.previewToken,
    ruleIds: ['finance'],
    messageSelection: {
      mode: 'allExcept',
      groups: [],
    },
  });

  assert.equal(unseen.status, 200);
  assert.deepEqual(appliedPlans.slice(plansBeforeUnseen), [{
    folder: 'INBOX',
    plans: [{ uid: 101, moveFolders: ['Finance'] }],
  }]);
});

test('selected Apply stores overrides once and continues with only the preview token', async t => {
  const port = await startServer(t);
  const preview = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['finance', 'header-or-body'],
    includeMatchDetails: true,
  });
  assert.equal(preview.status, 200);

  ruleRunBatchOverride = ({ cursor }) => ({
    maxUid: 105,
    uidValidity: '9001',
    nextCursor: cursor === 0 ? 101 : 105,
    done: cursor !== 0,
    messages: cursor === 0 ? [{
      uid: 101,
      envelope: {
        subject: 'Your statement is available',
        from: [{ name: 'Chase', address: 'noreply@chase.com' }],
        to: [{ address: user }],
      },
      size: 500,
      sourceComplete: true,
    }] : [{
      uid: 104,
      envelope: {
        subject: 'Header fallback',
        from: [{ address: 'sender@example.test' }],
        to: [{ address: user }],
      },
      size: 2 * 1024 * 1024,
      sourceComplete: false,
    }],
  });
  t.after(() => { ruleRunBatchOverride = null; });

  const first = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    previewToken: preview.json.previewToken,
    ruleIds: ['finance', 'header-or-body'],
    messageSelection: {
      mode: 'allExcept',
      groups: [{ folder: 'INBOX', uids: [101] }],
    },
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.done, false);
  assert.equal(first.json.appliedMessages, 0);

  const plansAfterFirst = appliedPlans.length;
  const replayedFirst = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    previewToken: preview.json.previewToken,
    ruleIds: ['finance', 'header-or-body'],
    messageSelection: {
      mode: 'allExcept',
      groups: [{ folder: 'INBOX', uids: [101] }],
    },
  });
  assert.equal(replayedFirst.status, 200);
  assert.deepEqual(replayedFirst.json, first.json);
  assert.equal(appliedPlans.length, plansAfterFirst);

  const second = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: first.json.cursor,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    previewToken: preview.json.previewToken,
    ruleIds: ['finance', 'header-or-body'],
  });
  assert.equal(second.status, 200);
  assert.equal(second.json.done, true);
  assert.equal(second.json.appliedMessages, 1);
  assert.equal(second.json.previewToken, preview.json.previewToken);
  assert.deepEqual(appliedPlans.at(-1), {
    folder: 'INBOX',
    plans: [{ uid: 104, moveFolders: ['Finance'] }],
  });

  const plansAfterCompletion = appliedPlans.length;
  const replayedSecond = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: first.json.cursor,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    previewToken: preview.json.previewToken,
    ruleIds: ['finance', 'header-or-body'],
  });
  assert.equal(replayedSecond.status, 200);
  assert.deepEqual(replayedSecond.json, second.json);
  assert.equal(appliedPlans.length, plansAfterCompletion);
});

test('concurrent exact selected-Apply retries share one mailbox mutation result', async t => {
  const port = await startServer(t);
  const preview = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['finance'],
    includeMatchDetails: true,
  });
  assert.equal(preview.status, 200);

  const originalApplyRuleMoves = fakeImap.applyRuleMoves;
  const originalGetFolders = fakeImap.getFolders;
  let applyCalls = 0;
  let releaseApply;
  const applyReleased = new Promise(resolve => { releaseApply = resolve; });
  let resolveApplyEntered;
  const applyEntered = new Promise(resolve => { resolveApplyEntered = resolve; });
  fakeImap.applyRuleMoves = async (_folder, plans) => {
    applyCalls += 1;
    resolveApplyEntered();
    await applyReleased;
    return {
      affected: plans.length,
      copied: 0,
      moved: plans.length,
      movedUids: plans.map(plan => plan.uid),
    };
  };
  let releaseDuplicateFolders;
  const duplicateFoldersReleased = new Promise(resolve => { releaseDuplicateFolders = resolve; });
  let resolveDuplicateFoldersEntered;
  const duplicateFoldersEntered = new Promise(resolve => { resolveDuplicateFoldersEntered = resolve; });
  t.after(() => {
    releaseApply();
    releaseDuplicateFolders();
    fakeImap.applyRuleMoves = originalApplyRuleMoves;
    fakeImap.getFolders = originalGetFolders;
  });

  const applyRequest = {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    previewToken: preview.json.previewToken,
    ruleIds: ['finance'],
    messageSelection: { mode: 'allExcept', groups: [] },
  };
  const first = requestJson(port, applyRequest);
  await applyEntered;
  const batchCallsAfterFirstScan = ruleRunBatchCalls.length;
  fakeImap.getFolders = async () => {
    resolveDuplicateFoldersEntered();
    await duplicateFoldersReleased;
    return originalGetFolders.call(fakeImap);
  };
  const duplicate = requestJson(port, applyRequest);
  await duplicateFoldersEntered;

  releaseApply();
  const firstResponse = await first;
  assert.equal(firstResponse.status, 200);
  releaseDuplicateFolders();
  const duplicateResponse = await duplicate;
  assert.deepEqual(duplicateResponse, firstResponse);
  assert.equal(applyCalls, 1);
  assert.equal(ruleRunBatchCalls.length, batchCallsAfterFirstScan);
});

test('selected Apply scans all flags and filters through frozen preview membership', async t => {
  const port = await startServer(t);
  const preview = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    readState: 'unread',
    ruleIds: ['finance'],
    includeMatchDetails: true,
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.affectedMessages, 1);

  ruleRunBatchOverride = ({ cursor, maxUid, readState }) => {
    assert.equal(cursor, 0);
    assert.equal(maxUid, 105);
    assert.equal(readState, 'all');
    return {
      maxUid: 105,
      uidValidity: '9001',
      nextCursor: 105,
      done: true,
      messages: [{
        uid: 101,
        envelope: {
          subject: 'Your statement is available',
          from: [{ name: 'Chase', address: 'noreply@chase.com' }],
          to: [{ address: user }],
        },
        size: 500,
        sourceComplete: true,
        seen: true,
      }],
    };
  };
  t.after(() => { ruleRunBatchOverride = null; });
  const plansBefore = appliedPlans.length;
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: 0,
    readState: 'unread',
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    previewToken: preview.json.previewToken,
    ruleIds: ['finance'],
    messageSelection: { mode: 'allExcept', groups: [] },
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.appliedMessages, 1);
  assert.deepEqual(appliedPlans.slice(plansBefore), [{
    folder: 'INBOX',
    plans: [{ uid: 101, moveFolders: ['Finance'] }],
  }]);
});

test('selected Apply accepts an arbitrary grouped subset beyond ten thousand messages', async t => {
  const uids = Array.from({ length: 10001 }, (_value, index) => index + 1);
  folderUidNextOverride = folderPaths => ({
    uidNextByFolder: new Map(folderPaths.map(folder => [folder, 10002])),
    uidValidityByFolder: new Map(folderPaths.map(folder => [folder, '9001'])),
    failedFolders: [],
  });
  ruleRunBatchOverride = ({ cursor, readState }) => ({
    maxUid: 10001,
    uidValidity: '9001',
    nextCursor: 10001,
    done: true,
    messages: uids.filter(uid => uid > cursor).map(uid => ({
      uid,
      envelope: {
        subject: 'Your statement is available',
        from: [{ address: 'noreply@example.test' }],
        to: [{ address: user }],
      },
      size: 500,
      sourceComplete: true,
      seen: readState === 'read',
    })),
  });
  t.after(() => {
    folderUidNextOverride = null;
    ruleRunBatchOverride = null;
  });
  const port = await startServer(t);
  const firstPreviewPage = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['finance'],
    includeMatchDetails: true,
  });
  assert.equal(firstPreviewPage.status, 200);
  assert.equal(firstPreviewPage.json.done, false);
  assert.equal(firstPreviewPage.json.cursor, 20);

  const finalPreviewPage = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: firstPreviewPage.json.cursor,
    scopeSnapshot: firstPreviewPage.json.scopeSnapshot,
    ruleRevision: firstPreviewPage.json.ruleRevision,
    previewToken: firstPreviewPage.json.previewToken,
    ruleIds: ['finance'],
  });
  assert.equal(finalPreviewPage.status, 200);
  assert.equal(finalPreviewPage.json.done, true);

  const plansBefore = appliedPlans.length;
  const response = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: 0,
    scopeSnapshot: firstPreviewPage.json.scopeSnapshot,
    ruleRevision: firstPreviewPage.json.ruleRevision,
    previewToken: firstPreviewPage.json.previewToken,
    ruleIds: ['finance'],
    messageSelection: {
      mode: 'only',
      groups: [{ folder: 'INBOX', uids }],
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.appliedMessages, 10001);
  assert.equal(appliedPlans[plansBefore].plans.length, 10001);
});

test('rule-run validates message selection against the preview scope', async t => {
  const port = await startServer(t);
  const preview = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['finance'],
    includeMatchDetails: true,
  });
  assert.equal(preview.status, 200);

  const selectionDuringPreview = await requestJson(port, {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['finance'],
    messageSelection: { mode: 'only', groups: [] },
  });
  assert.equal(selectionDuringPreview.status, 400);

  const selectionOnLegacyApply = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    ruleIds: ['finance'],
    messageSelection: { mode: 'only', groups: [] },
  });
  assert.equal(selectionOnLegacyApply.status, 400);

  const missingSelection = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    previewToken: preview.json.previewToken,
    ruleIds: ['finance'],
  });
  assert.equal(missingSelection.status, 400);

  const missingPreviewBinding = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    ruleIds: ['finance'],
    messageSelection: { mode: 'only', groups: [] },
  });
  assert.equal(missingPreviewBinding.status, 400);

  const plansBefore = appliedPlans.length;
  const outsideSnapshot = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    previewToken: preview.json.previewToken,
    ruleIds: ['finance'],
    messageSelection: {
      mode: 'only',
      groups: [{ folder: 'INBOX/Projects', uids: [201] }],
    },
  });
  assert.equal(outsideSnapshot.status, 400);
  assert.equal(appliedPlans.length, plansBefore);

  const duplicate = await requestJson(port, {
    folder: 'INBOX',
    mode: 'apply-selected',
    cursor: 0,
    maxUid: preview.json.maxUid,
    uidValidity: preview.json.uidValidity,
    ruleRevision: preview.json.ruleRevision,
    previewToken: preview.json.previewToken,
    ruleIds: ['finance'],
    messageSelection: {
      mode: 'allExcept',
      groups: [{ folder: 'INBOX', uids: [101, 101] }],
    },
  });
  assert.equal(duplicate.status, 400);
  assert.equal(appliedPlans.length, plansBefore);
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
  assert.equal(response.json.error, 'Rules, selection, or message scope changed since preview. Preview again before applying.');
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
  assert.equal(response.json.error, 'Rules or message scope changed since preview. Preview again before applying.');
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

test('scoped rule-run reaches child-folder copy recovery for both owner resolutions', async t => {
  const port = await startServer(t);
  t.after(() => { blockNextApply = false; });

  let previewRequest = {
    folder: 'INBOX',
    mode: 'preview',
    cursor: 0,
    ruleIds: ['finance'],
    includeSubfolders: true,
  };
  let snapshot;
  let revision;
  while (true) {
    const page = await requestJson(port, previewRequest);
    assert.equal(page.status, 200);
    snapshot ||= page.json.scopeSnapshot;
    revision ||= page.json.ruleRevision;
    if (page.json.done) break;
    previewRequest = {
      ...previewRequest,
      cursor: page.json.cursor,
      scopeIndex: page.json.scopeIndex,
      scopeSnapshot: page.json.scopeSnapshot,
      ruleRevision: page.json.ruleRevision,
    };
  }

  for (const resolution of ['completed', 'retry']) {
    const firstApply = await requestJson(port, {
      folder: 'INBOX',
      mode: 'apply',
      cursor: 0,
      scopeIndex: 0,
      scopeSnapshot: snapshot,
      ruleRevision: revision,
      ruleIds: ['finance'],
      includeSubfolders: true,
    });
    assert.equal(firstApply.status, 200);
    assert.equal(firstApply.json.sourceFolder, 'INBOX');
    assert.equal(firstApply.json.scopeIndex, 1);

    blockNextApply = true;
    const interrupted = await requestJson(port, {
      folder: 'INBOX',
      mode: 'apply',
      cursor: firstApply.json.cursor,
      scopeIndex: firstApply.json.scopeIndex,
      scopeSnapshot: snapshot,
      ruleRevision: revision,
      ruleIds: ['finance'],
      includeSubfolders: true,
    });
    assert.equal(interrupted.status, 500);
    assert.equal(interrupted.json.retrySafe, false);
    assert.deepEqual(interrupted.json.pendingCopies, [{
      actionKey: 'a'.repeat(64),
      uid: 201,
      destination: 'Finance',
    }]);

    const resolutionsBefore = copyResolutions.length;
    const recoveryFolders = [];
    let recoveryRequest = {
      folder: 'INBOX',
      mode: 'apply',
      cursor: 0,
      scopeIndex: 0,
      scopeSnapshot: snapshot,
      ruleRevision: revision,
      ruleIds: ['finance'],
      includeSubfolders: true,
      copyResolution: resolution,
      copyActionKeys: interrupted.json.pendingCopies.map(copy => copy.actionKey),
    };
    while (true) {
      const page = await requestJson(port, recoveryRequest);
      assert.equal(page.status, 200);
      recoveryFolders.push(page.json.sourceFolder);
      if (page.json.done) break;
      recoveryRequest = {
        ...recoveryRequest,
        cursor: page.json.cursor,
        scopeIndex: page.json.scopeIndex,
      };
    }

    assert.deepEqual(recoveryFolders, [
      'INBOX',
      'INBOX/Projects',
      'INBOX/Projects/2026',
    ]);
    assert.deepEqual(
      copyResolutions.slice(resolutionsBefore).map(entry => ({
        sourceFolder: entry.sourceFolder,
        resolution: entry.resolution,
      })),
      [
        { sourceFolder: 'INBOX', resolution },
        { sourceFolder: 'INBOX/Projects', resolution },
        { sourceFolder: 'INBOX/Projects/2026', resolution },
      ],
    );
  }
});

test('rule-run rejects unknown source folders', async t => {
  const port = await startServer(t);
  const response = await requestJson(port, { folder: 'Missing', mode: 'preview' });

  assert.equal(response.status, 400);
  assert.equal(response.json.error, 'Choose an existing source folder.');
});

test('rule-run rejects malformed message-scope fields', async t => {
  const port = await startServer(t);
  const invalidBodies = [
    { folder: 'INBOX', mode: 'preview', includeSubfolders: 'yes' },
    { folder: 'INBOX', mode: 'preview', readState: 'new' },
    {
      folder: 'INBOX',
      mode: 'preview',
      scopeSnapshot: [{ folder: 'INBOX', maxUid: 999, uidValidity: '9001' }],
      ruleRevision: 'forged-client-snapshot',
    },
    {
      folder: 'INBOX',
      mode: 'preview',
      scopeSnapshot: [
        { folder: 'INBOX', maxUid: 105, uidValidity: '9001' },
        { folder: 'INBOX', maxUid: 105, uidValidity: '9001' },
      ],
    },
  ];

  for (const body of invalidBodies) {
    const response = await requestJson(port, body);
    assert.equal(response.status, 400);
    assert.equal(response.json.error, 'Invalid rule-run request.');
  }
});
