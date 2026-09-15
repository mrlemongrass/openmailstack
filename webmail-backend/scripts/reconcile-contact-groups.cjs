#!/usr/bin/env node
// Uses the backend's existing environment. Never prints credentials/contact data.
const args = process.argv.slice(2);
const user = args[0];
if (!user || !/^[^\s@]+@[^\s@]+$/.test(user) || args.length > 2 || args[1] && !['--dry-run', '--apply'].includes(args[1])) {
  console.error('Usage: node scripts/reconcile-contact-groups.cjs user@example.com [--dry-run|--apply]');
  process.exit(2);
}
const { pool } = require('../src/db.js');
const { reconcileContactGroups } = require('../src/contact-groups.js');
reconcileContactGroups(user, args[1] === '--apply')
  .then(result => console.log(JSON.stringify(result)))
  .catch(() => { console.error('Contact-group reconciliation failed; no reconciliation changes were committed.'); process.exitCode = 1; })
  .finally(() => pool.end());
