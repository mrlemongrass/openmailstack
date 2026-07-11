#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${OMS_SMOKE_BASE_URL:-https://mail.housevo.us}
SMOKE_USER=${OMS_SMOKE_USER:-}
SMOKE_PASSWORD=${OMS_SMOKE_PASSWORD:-}
SMTP_HOST=${OMS_SMOKE_SMTP_HOST:-127.0.0.1}
SMTP_PORT=${OMS_SMOKE_SMTP_PORT:-587}
IMAP_HOST=${OMS_SMOKE_IMAP_HOST:-127.0.0.1}
IMAP_PORT=${OMS_SMOKE_IMAP_PORT:-143}

if [[ -z "${SMOKE_USER}" || -z "${SMOKE_PASSWORD}" ]]; then
  echo "SKIP: set OMS_SMOKE_USER and OMS_SMOKE_PASSWORD to run authenticated ActiveSync mail smoke checks"
  exit 0
fi

export BASE_URL SMOKE_USER SMOKE_PASSWORD SMTP_HOST SMTP_PORT IMAP_HOST IMAP_PORT

node <<'NODE'
const nodemailer = require('./webmail-backend/node_modules/nodemailer');
const { ImapFlow } = require('./webmail-backend/node_modules/imapflow');
const { simpleParser } = require('./webmail-backend/node_modules/mailparser');
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');

const baseUrl = process.env.BASE_URL.replace(/\/$/, '');
const user = process.env.SMOKE_USER;
const pass = process.env.SMOKE_PASSWORD;
const smtpHost = process.env.SMTP_HOST || '127.0.0.1';
const smtpPort = Number(process.env.SMTP_PORT || 587);
const imapHost = process.env.IMAP_HOST || '127.0.0.1';
const imapPort = Number(process.env.IMAP_PORT || 143);
const timestamp = Date.now();
const subject = `OMS ActiveSync mail smoke ${timestamp}`;
const body = `ActiveSync mail smoke body ${timestamp}`;
const deviceId = `OMSEASMailSmoke${timestamp}`;
const inboxCollectionId = Buffer.from('INBOX').toString('base64');
let seededUid = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function imapClient() {
  return new ImapFlow({
    host: imapHost,
    port: imapPort,
    secure: false,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false,
      checkServerIdentity: () => undefined,
    },
    logger: false,
  });
}

function writeWbxml(node) {
  const writer = new WbxmlWriter();
  writer.writeNode(node);
  return writer.getBuffer();
}

function parseWbxml(buffer) {
  return new WbxmlParser(Buffer.from(buffer)).parse();
}

function walk(node, visitor) {
  if (!node) return;
  visitor(node);
  for (const child of node.children || []) walk(child, visitor);
}

function child(node, tag) {
  return (node.children || []).find(item => item.tag === tag);
}

function text(node, tag) {
  const value = child(node, tag)?.content;
  return value === undefined ? '' : value.toString();
}

function descendants(node, tag) {
  const nodes = [];
  walk(node, current => {
    if (current.tag === tag) nodes.push(current);
  });
  return nodes;
}

async function sendSeedMessage() {
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: false,
    requireTLS: smtpPort === 587,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });

  await transporter.sendMail({
    from: user,
    to: user,
    subject,
    text: body,
  });
}

async function findSeedMessage() {
  const client = imapClient();
  await client.connect();
  try {
    const mailbox = await client.mailboxOpen('INBOX');
    if (!mailbox.exists) return null;
    const start = Math.max(1, mailbox.exists - 79);
    const matches = [];
    for await (const msg of client.fetch(`${start}:*`, { uid: true, flags: true, source: true })) {
      const parsed = await simpleParser(msg.source);
      if (parsed.subject === subject) {
        matches.push({ uid: msg.uid, flags: Array.from(msg.flags || []) });
      }
    }
    matches.sort((a, b) => b.uid - a.uid);
    return matches[0] || null;
  } finally {
    try { await client.mailboxClose(); } catch {}
    await client.logout();
  }
}

async function waitForSeedMessage() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const found = await findSeedMessage();
    if (found) {
      seededUid = found.uid;
      return found;
    }
    await sleep(3000);
  }
  throw new Error('Timed out waiting for ActiveSync smoke message in INBOX');
}

async function cleanupSeedMessage() {
  if (!seededUid) return;
  const client = imapClient();
  await client.connect();
  try {
    await client.mailboxOpen('INBOX');
    await client.messageDelete(String(seededUid), { uid: true });
  } finally {
    try { await client.mailboxClose(); } catch {}
    await client.logout().catch(() => {});
  }
}

async function easRequest(cmd, bodyBuffer) {
  const url = `${baseUrl}/Microsoft-Server-ActiveSync?Cmd=${encodeURIComponent(cmd)}&User=${encodeURIComponent(user)}&DeviceId=${deviceId}&DeviceType=CodexSmoke`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
    'Content-Type': 'application/vnd.ms-sync.wbxml',
  };
  const response = await fetch(url, { method: 'POST', headers, body: bodyBuffer });
  const body = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`ActiveSync ${cmd} returned HTTP ${response.status}`);
  }
  return parseWbxml(body);
}

async function folderSync() {
  const request = writeWbxml({
    tag: 'FolderSync',
    page: 7,
    children: [{ tag: 'SyncKey', page: 7, content: '0' }],
  });
  const ast = await easRequest('FolderSync', request);
  const status = descendants(ast, 'Status').find(node => node.page === 7)?.content?.toString();
  if (status !== '1') throw new Error(`FolderSync returned Status ${status || '(missing)'}`);
  const inbox = descendants(ast, 'Add').find(node => text(node, 'DisplayName') === 'INBOX' && text(node, 'Type') === '2');
  if (!inbox) throw new Error('FolderSync did not advertise INBOX as an Email folder');
  const serverId = text(inbox, 'ServerId');
  if (serverId !== inboxCollectionId) throw new Error(`Unexpected INBOX collection id ${serverId}`);
}

async function syncMail(syncKey) {
  const request = writeWbxml({
    tag: 'Sync',
    page: 0,
    children: [{
      tag: 'Collections',
      page: 0,
      children: [{
        tag: 'Collection',
        page: 0,
        children: [
          { tag: 'Class', page: 0, content: 'Email' },
          { tag: 'SyncKey', page: 0, content: syncKey },
          { tag: 'CollectionId', page: 0, content: inboxCollectionId },
          { tag: 'GetChanges', page: 0 },
          { tag: 'WindowSize', page: 0, content: '50' },
          { tag: 'Options', page: 0, children: [
            { tag: 'MIMESupport', page: 0, content: '0' },
            { tag: 'BodyPreference', page: 17, children: [
              { tag: 'Type', page: 17, content: '1' },
              { tag: 'TruncationSize', page: 17, content: '500' },
            ]},
          ]},
        ],
      }],
    }],
  });
  const ast = await easRequest('Sync', request);
  const status = descendants(ast, 'Status').find(node => node.page === 0)?.content?.toString();
  if (status !== '1') throw new Error(`Mail Sync returned Status ${status || '(missing)'}`);
  const nextKey = descendants(ast, 'SyncKey').find(node => node.page === 0)?.content?.toString();
  if (!nextKey || nextKey === syncKey) throw new Error(`Mail Sync returned invalid SyncKey ${nextKey || '(missing)'}`);
  return { ast, nextKey };
}

function findSmokeAdd(ast) {
  return descendants(ast, 'Add').find(node => {
    const appData = child(node, 'ApplicationData');
    return appData && text(appData, 'Subject') === subject;
  });
}

async function changeReadFlag(serverId, syncKey, readValue) {
  const request = writeWbxml({
    tag: 'Sync',
    page: 0,
    children: [{
      tag: 'Collections',
      page: 0,
      children: [{
        tag: 'Collection',
        page: 0,
        children: [
          { tag: 'SyncKey', page: 0, content: syncKey },
          { tag: 'CollectionId', page: 0, content: inboxCollectionId },
          { tag: 'Commands', page: 0, children: [{
            tag: 'Change',
            page: 0,
            children: [
              { tag: 'ServerId', page: 0, content: serverId },
              { tag: 'ApplicationData', page: 0, children: [
                { tag: 'Read', page: 2, content: readValue },
              ]},
            ],
          }]},
        ],
      }],
    }],
  });
  const ast = await easRequest('Sync', request);
  const responseChange = descendants(ast, 'Change').find(node => text(node, 'ServerId') === serverId && text(node, 'Status') === '1');
  if (!responseChange) throw new Error(`Mail Sync Change did not acknowledge ${serverId}`);
  const status = text(responseChange, 'Status');
  if (status !== '1') throw new Error(`Mail Sync Change returned Status ${status || '(missing)'}`);
  const nextKey = descendants(ast, 'SyncKey').find(node => node.page === 0)?.content?.toString();
  if (!nextKey) throw new Error('Mail Sync Change did not return a SyncKey');
  return nextKey;
}

async function assertSeenState(expectedSeen) {
  const found = await findSeedMessage();
  if (!found) throw new Error('Seed message disappeared before cleanup');
  const seen = found.flags.includes('\\Seen');
  if (seen !== expectedSeen) {
    throw new Error(`Expected IMAP \\Seen=${expectedSeen}, got ${seen}`);
  }
}

(async () => {
  try {
    await sendSeedMessage();
    await waitForSeedMessage();
    await folderSync();
    const initial = await syncMail('0');
    const smokeAdd = findSmokeAdd(initial.ast);
    if (!smokeAdd) throw new Error('Initial mail Sync did not include the seeded smoke message');

    const serverId = text(smokeAdd, 'ServerId');
    const appData = child(smokeAdd, 'ApplicationData');
    if (!serverId) throw new Error('Seeded smoke message had no ServerId in mail Sync response');
    if (text(appData, 'Read') !== '0') throw new Error('Seeded smoke message should start unread in ActiveSync response');
    if (text(appData, 'MessageClass') !== 'IPM.Note') throw new Error('Seeded smoke message did not return IPM.Note');
    const bodyData = descendants(appData, 'Data').map(node => node.content?.toString() || '').join('\n');
    if (!bodyData.includes(body)) throw new Error('Seeded smoke message body was not returned in ActiveSync response');

    const readKey = await changeReadFlag(serverId, initial.nextKey, '1');
    await assertSeenState(true);
    await changeReadFlag(serverId, readKey, '0');
    await assertSeenState(false);

    console.log('PASS: ActiveSync mail smoke completed');
  } finally {
    await cleanupSeedMessage().catch(err => {
      console.error(`WARN: cleanup failed: ${err.message}`);
    });
  }
})().catch(err => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
NODE
