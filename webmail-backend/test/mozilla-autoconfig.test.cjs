const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const { createMozillaAutoconfigRouter } = require('../src/mail-autoconfig.js');

async function startServer(t) {
  const app = express();
  app.use(createMozillaAutoconfigRouter({
    domain: 'example.test',
    mailHostname: 'mail.example.test',
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test('Mozilla provider discovery returns secure IMAP and submission settings', async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(
    `${baseUrl}/mail/config-v1.1.xml?emailaddress=alice%40example.test`,
  );
  const xml = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^application\/xml\b/);
  assert.match(xml, /<emailProvider id="example\.test">/);
  assert.match(xml, /<domain>example\.test<\/domain>/);
  assert.match(xml, /<incomingServer type="imap">[\s\S]*<hostname>mail\.example\.test<\/hostname>[\s\S]*<port>993<\/port>[\s\S]*<socketType>SSL<\/socketType>[\s\S]*<username>%EMAILADDRESS%<\/username>[\s\S]*<authentication>password-cleartext<\/authentication>[\s\S]*<\/incomingServer>/);
  assert.match(xml, /<outgoingServer type="smtp">[\s\S]*<hostname>mail\.example\.test<\/hostname>[\s\S]*<port>587<\/port>[\s\S]*<socketType>STARTTLS<\/socketType>[\s\S]*<username>%EMAILADDRESS%<\/username>[\s\S]*<authentication>password-cleartext<\/authentication>[\s\S]*<\/outgoingServer>/);
  assert.doesNotMatch(xml, /alice@example\.test/);
});

test('Mozilla well-known fallback returns the same provider configuration', async (t) => {
  const baseUrl = await startServer(t);
  const providerResponse = await fetch(`${baseUrl}/mail/config-v1.1.xml`);
  const fallbackResponse = await fetch(
    `${baseUrl}/.well-known/autoconfig/mail/config-v1.1.xml`,
  );

  assert.equal(fallbackResponse.status, 200);
  assert.equal(await fallbackResponse.text(), await providerResponse.text());
});
