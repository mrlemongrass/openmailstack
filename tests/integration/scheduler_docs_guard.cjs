const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const registryPath = path.join(projectRoot, 'docs/product/scheduler-capabilities.json');
const planPath = path.join(projectRoot, 'docs/product/scheduler.md');
const threatPath = path.join(projectRoot, 'docs/product/scheduler-threat-model.md');

const fail = (message) => {
  console.error(`[fail] Scheduler documentation guard: ${message}`);
  process.exit(1);
};

const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const plan = fs.readFileSync(planPath, 'utf8');
const threatModel = fs.readFileSync(threatPath, 'utf8');
const capabilities = registry.capabilities;

if (registry.schemaVersion !== 1) fail('unsupported registry schemaVersion');
if (!/^\d{4}-\d{2}-\d{2}$/.test(registry.lastReviewed)) fail('invalid lastReviewed date');
if (!Array.isArray(capabilities) || capabilities.length < 40) fail('expected at least 40 tracked capabilities');

const requiredCategories = [
  'individual',
  'public',
  'team',
  'routing',
  'workflow',
  'payment',
  'integration',
  'analytics',
  'admin',
  'developer',
];
const allowedStatuses = new Set(['planned', 'in_progress', 'implemented', 'provider_dependent']);
const allowedSourceHosts = new Set(['calendly.com', 'help.calendly.com', 'developer.calendly.com', 'cal.com']);
const ids = new Set();
const categories = new Set();

for (const capability of capabilities) {
  for (const field of ['id', 'category', 'name', 'source', 'observedAt', 'status', 'phase']) {
    if (!capability[field]) fail(`${capability.id || '<unknown>'} is missing ${field}`);
  }
  if (ids.has(capability.id)) fail(`duplicate capability id ${capability.id}`);
  ids.add(capability.id);
  categories.add(capability.category);
  if (!allowedStatuses.has(capability.status)) fail(`${capability.id} has invalid status ${capability.status}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(capability.observedAt)) fail(`${capability.id} has invalid observedAt`);
  let source;
  try {
    source = new URL(capability.source);
  } catch {
    fail(`${capability.id} has invalid source URL`);
  }
  if (source.protocol !== 'https:' || !allowedSourceHosts.has(source.hostname)) {
    fail(`${capability.id} source must be an approved official HTTPS host`);
  }
  if (capability.status === 'implemented') {
    if (!capability.test) fail(`${capability.id} is implemented without a test path`);
    if (!fs.existsSync(path.join(projectRoot, capability.test))) fail(`${capability.id} test path does not exist`);
  }
}

for (const category of requiredCategories) {
  if (!categories.has(category)) fail(`missing capability category ${category}`);
}

for (const heading of [
  '### 3.1 Individual scheduling',
  '### 3.2 Public booking experience',
  '### 3.3 Team scheduling',
  '### 3.4 Routing and qualification',
  '### 3.5 Workflows and communications',
  '### 3.6 Payments',
  '### 3.7 Integrations',
  '### 3.8 Analytics and operations',
  '### 3.9 Administration, security, and compliance features',
  '### 3.10 Developer platform and agents',
]) {
  if (!plan.includes(heading)) fail(`product plan is missing ${heading}`);
}

for (const reference of [
  'scheduler-capabilities.json',
  'scheduler-threat-model.md',
  'webmail-backend/src/scheduler/availability.ts',
  'webmail-backend/src/scheduler/authorization.ts',
  'webmail-backend/src/scheduler/contracts.ts',
  'webmail-backend/src/scheduler/outbox.ts',
  'webmail-backend/src/scheduler/slot-holds.ts',
]) {
  if (!plan.includes(reference)) fail(`product plan is missing Phase 0 reference ${reference}`);
}

for (const boundary of [
  '/api/public/scheduler/v1/*',
  '/api/scheduler/v1/*',
  '/api/admin/scheduler/v1/*',
  '## 4. Tenant And Authorization Threats',
  '## 6. Public Abuse, Spam, And Enumeration',
  '## 7. OAuth And Provider Secrets',
  '## 8. Payments',
  '## 9. Webhooks, Routing, And SSRF',
  '## 10. Outbox, Jobs, And Audit',
]) {
  if (!threatModel.includes(boundary)) fail(`threat model is missing ${boundary}`);
}

console.log(`[pass] Scheduler documentation guard (${capabilities.length} capabilities across ${categories.size} categories)`);

