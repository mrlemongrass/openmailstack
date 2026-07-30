const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';
process.env.OMS_SESSION_SECRET ||= 's'.repeat(64);
process.env.OMS_ACCOUNT_SECURITY_KEY ||= 'a'.repeat(64);

const {
  base32Encode,
  generateAppPassword,
  generateTotp,
  hashAppPassword,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyTotp,
} = require('../src/account-security.js');

test('TOTP matches the RFC 6238 SHA-1 vector and accepts bounded clock skew', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

  assert.equal(generateTotp(secret, 59_000, 8), '94287082');
  const current = generateTotp(secret, 90_000);
  assert.equal(verifyTotp(secret, current, 90_000), true);
  assert.equal(verifyTotp(secret, generateTotp(secret, 60_000), 90_000), true);
  assert.equal(verifyTotp(secret, generateTotp(secret, 30_000), 90_000), false);
  assert.equal(verifyTotp(secret, 'not-a-code', 90_000), false);
});

test('app passwords are high entropy and only their digest needs persistence', () => {
  const first = generateAppPassword();
  const second = generateAppPassword();

  assert.match(first, /^oms-[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/);
  assert.notEqual(first, second);
  assert.equal(hashAppPassword(first).length, 64);
  assert.notEqual(hashAppPassword(first), hashAppPassword(second));
});

test('recovery codes normalize presentation separators before hashing', () => {
  assert.equal(normalizeRecoveryCode(' AB12-CD34 '), 'ab12cd34');
  assert.equal(hashRecoveryCode('AB12-CD34'), hashRecoveryCode('ab12cd34'));
});
