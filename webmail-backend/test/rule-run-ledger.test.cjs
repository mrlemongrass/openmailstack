const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'rule-run-ledger-test';

const { RuleRunLedger } = require('../src/rule-run-ledger.js');

test('rule-copy ledger distinguishes new, completed, and uncertain actions durably', async () => {
  const rows = new Map();
  const db = {
    async query(sql, values = []) {
      if (sql.includes('CREATE TABLE')) {
        return [{ affectedRows: 0 }, []];
      }
      if (sql.includes('INSERT IGNORE')) {
        for (let index = 0; index < values.length; index += 9) {
          const [actionKey, operationKey, owner, folder, uidValidity, uid, destination, token, pendingSourceKey] =
            values.slice(index, index + 9);
          const pendingSourceExists = [...rows.values()].some(row => (
            row.pending_source_key === pendingSourceKey
          ));
          if (!rows.has(actionKey) && !pendingSourceExists) {
            rows.set(actionKey, {
              action_key: actionKey,
              operation_key: operationKey,
              owner,
              source_folder: folder,
              source_uidvalidity: uidValidity,
              source_uid: uid,
              destination,
              status: 'pending',
              reservation_token: token,
              pending_source_key: pendingSourceKey,
            });
          }
        }
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('source_uid IN')) {
        const sourceUids = new Set(values.slice(3).map(Number));
        return [[...rows.values()].filter(row => (
          sourceUids.has(Number(row.source_uid)) && row.status === 'pending'
        )), []];
      }
      if (sql.includes('SELECT action_key')) {
        return [values.map(key => rows.get(key)).filter(Boolean), []];
      }
      if (sql.includes('UPDATE mail_rule_copy_ledger') && sql.includes('owner=?')) {
        const operationKey = values[3];
        const actionKeys = new Set(values.slice(4));
        let affectedRows = 0;
        rows.forEach(row => {
          if (
            row.operation_key === operationKey
            && row.status === 'pending'
            && actionKeys.has(row.action_key)
          ) {
            row.status = 'completed';
            row.pending_source_key = null;
            affectedRows += 1;
          }
        });
        return [{ affectedRows }, []];
      }
      if (sql.includes('UPDATE mail_rule_copy_ledger')) {
        const [token, ...keys] = values;
        let affectedRows = 0;
        keys.forEach(key => {
          const row = rows.get(key);
          if (row?.reservation_token === token) {
            row.status = 'completed';
            row.pending_source_key = null;
            affectedRows += 1;
          }
        });
        return [{ affectedRows }, []];
      }
      if (sql.includes('DELETE FROM mail_rule_copy_ledger') && sql.includes('owner=?')) {
        const operationKey = values[3];
        const actionKeys = new Set(values.slice(4));
        let affectedRows = 0;
        rows.forEach((row, key) => {
          if (
            row.operation_key === operationKey
            && row.status === 'pending'
            && actionKeys.has(row.action_key)
          ) {
            rows.delete(key);
            affectedRows += 1;
          }
        });
        return [{ affectedRows }, []];
      }
      if (sql.includes('DELETE FROM mail_rule_copy_ledger') && sql.includes('reservation_token=?')) {
        const token = values[0];
        let affectedRows = 0;
        rows.forEach((row, key) => {
          if (row.reservation_token === token && row.status === 'pending') {
            rows.delete(key);
            affectedRows += 1;
          }
        });
        return [{ affectedRows }, []];
      }
      if (sql.includes('DELETE FROM mail_rule_copy_ledger')) {
        values.forEach(key => rows.delete(key));
        return [{ affectedRows: values.length }, []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const action = {
    actionKey: 'a'.repeat(64),
    operationKey: 'b'.repeat(32),
    uid: 42,
    destination: 'Finance',
  };
  const first = new RuleRunLedger('rules@example.test', 'INBOX', '9001', db);
  const firstReservation = await first.reserve([action]);
  assert.deepEqual([...firstReservation.ready], [action.actionKey]);
  assert.deepEqual([...firstReservation.completed], []);

  const concurrent = new RuleRunLedger('rules@example.test', 'INBOX', '9001', db);
  const blockedReservation = await concurrent.reserve([action]);
  assert.deepEqual([...blockedReservation.blocked], [action.actionKey]);

  const changedAction = {
    ...action,
    actionKey: 'c'.repeat(64),
    destination: 'Ads',
  };
  const changedRuleReservation = await concurrent.reserve([changedAction]);
  assert.equal(changedRuleReservation.blocked.has(action.actionKey), true);
  assert.deepEqual(changedRuleReservation.pending, [action]);
  assert.equal(rows.has(changedAction.actionKey), false);

  assert.equal(await concurrent.resolvePending(action.operationKey, [action.actionKey], 'retry'), 1);
  const retriedReservation = await concurrent.reserve([action]);
  assert.deepEqual([...retriedReservation.ready], [action.actionKey]);

  await concurrent.complete([action], retriedReservation.token);
  const replay = await concurrent.reserve([action]);
  assert.deepEqual([...replay.completed], [action.actionKey]);
  assert.deepEqual([...replay.ready], []);

  await concurrent.clear([action]);
  assert.equal(rows.size, 0);
});
