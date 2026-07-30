const assert = require('node:assert/strict');
const test = require('node:test');
const bcrypt = require('bcryptjs');

const { verifyStoredPassword } = require('../src/password-verification.js');

test('stored-password verification accepts raw and Dovecot-prefixed bcrypt hashes', async () => {
  const hash = await bcrypt.hash('correct horse battery staple', 4);
  const dovecotHash = `{BLF-CRYPT}${hash.replace('$2b$', '$2y$')}`;

  assert.equal(await verifyStoredPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyStoredPassword('correct horse battery staple', dovecotHash), true);
  assert.equal(await verifyStoredPassword('wrong password', dovecotHash), false);
});

test('stored-password verification delegates only a bounded SHA512-CRYPT hash', async () => {
  const hash = `{SHA512-CRYPT}$6$testsalt$${'A'.repeat(86)}`;
  const calls = [];
  const verifier = async (password, storedHash) => {
    calls.push({ password, storedHash });
    return true;
  };

  assert.equal(await verifyStoredPassword('legacy password', hash, verifier), true);
  assert.deepEqual(calls, [{ password: 'legacy password', storedHash: hash }]);
  assert.equal(await verifyStoredPassword('legacy password', '{SHA512-CRYPT}not-a-hash', verifier), false);
  assert.equal(calls.length, 1);
});

test('stored-password verification rejects empty, oversized, and unknown inputs', async () => {
  const verifier = async () => true;
  assert.equal(await verifyStoredPassword('', '$2y$12$invalid', verifier), false);
  assert.equal(await verifyStoredPassword('x'.repeat(129), '$2y$12$invalid', verifier), false);
  assert.equal(await verifyStoredPassword('password', '{PLAIN}password', verifier), false);
});
