const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'rule-analysis-route-test';

let manageSieveConstructions = 0;

const authPath = require.resolve('../src/auth.js');
const auth = require(authPath);
require.cache[authPath].exports = {
  ...auth,
  requireSession: (req, _res, next) => {
    req.user = { username: 'rules@example.test', password: 'test-only', isAdmin: false };
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
      constructor() {
        manageSieveConstructions += 1;
        throw new Error('Rule analysis must not access ManageSieve');
      }
    },
  },
  children: [],
  paths: [],
};

const originalSetInterval = global.setInterval;
global.setInterval = () => ({ unref() {} });
const { apiRouter } = require('../src/api.js');
global.setInterval = originalSetInterval;

const requestAnalysis = (port, body) => new Promise((resolve, reject) => {
  const payload = Buffer.from(JSON.stringify(body));
  const req = http.request({
    hostname: '127.0.0.1',
    port,
    path: '/api/rules/analyze',
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
  app.use(express.json({ limit: '25mb' }));
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

test('authenticated rule analysis reports draft duplicates without touching ManageSieve', async t => {
  const port = await startServer(t);
  const response = await requestAnalysis(port, {
    rules: [{
      id: 'ads',
      name: 'Ads',
      criteria: [
        { id: 'one', field: 'from', operator: 'contains', value: 'ads@example.test' },
        { id: 'two', field: 'from', operator: 'contains', value: 'ADS@example.test' },
      ],
      actions: [{ id: 'move', type: 'move', folder: 'INBOX.ADs' }],
    }],
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.success, true);
  assert.equal(response.json.analysis.summary.removableItems, 1);
  assert.deepEqual(response.json.analysis.removals, [
    { ruleIndex: 0, itemType: 'criterion', itemIndex: 1 },
  ]);
  assert.equal(manageSieveConstructions, 0);
});

test('rule analysis rejects malformed and unbounded drafts before analysis', async t => {
  const port = await startServer(t);
  const malformed = await requestAnalysis(port, { rules: 'not-an-array' });
  const oversized = await requestAnalysis(port, {
    rules: Array.from({ length: 1001 }, (_value, index) => ({
      id: `rule-${index}`,
      criteria: [],
      actions: [],
    })),
  });
  const oversizedString = await requestAnalysis(port, {
    rules: [{
      name: 'Long legacy rule',
      criteria: [{ field: 'subject', operator: 'contains', value: 'x'.repeat(4097) }],
      actions: [],
    }],
  });
  const oversizedTotal = await requestAnalysis(port, {
    rules: Array.from({ length: 300 }, (_value, index) => ({
      name: `Rule ${index}`,
      criteria: [{ field: 'subject', operator: 'contains', value: 'x'.repeat(3500) }],
      actions: [],
    })),
  });

  assert.equal(malformed.status, 400);
  assert.equal(malformed.json.code, 'INVALID_RULE_ANALYSIS_DOCUMENT');
  assert.equal(oversized.status, 413);
  assert.equal(oversized.json.code, 'RULE_ANALYSIS_LIMIT');
  assert.equal(oversizedString.status, 413);
  assert.equal(oversizedString.json.code, 'RULE_ANALYSIS_LIMIT');
  assert.equal(oversizedTotal.status, 413);
  assert.equal(oversizedTotal.json.code, 'RULE_ANALYSIS_LIMIT');
  assert.equal(manageSieveConstructions, 0);
});
