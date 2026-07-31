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
const bodyPrefix = `ActiveSync mail smoke body ${timestamp}`;
const body = `${bodyPrefix} ${'x'.repeat(700)}`;
const deviceId = 'OMSEASMailSmoke';
const inboxCollectionId = Buffer.from('INBOX').toString('base64');
const junkCollectionId = Buffer.from('Junk').toString('base64');
const trashCollectionId = Buffer.from('Trash').toString('base64');
let seededUid = null;
let webmailCookie = '';

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

async function findSeedMessage(folder = 'INBOX') {
  const client = imapClient();
  await client.connect();
  try {
    const mailbox = await client.mailboxOpen(folder);
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

async function waitForSeedMessage(folder = 'INBOX') {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const found = await findSeedMessage(folder);
    if (found) {
      seededUid = found.uid;
      return found;
    }
    await sleep(3000);
  }
  throw new Error(`Timed out waiting for ActiveSync smoke message in ${folder}`);
}

async function cleanupSeedMessage() {
  const client = imapClient();
  await client.connect();
  try {
    for (const folder of ['INBOX', 'Junk', 'Trash']) {
      let mailbox;
      try {
        mailbox = await client.mailboxOpen(folder);
      } catch {
        continue;
      }
      if (!mailbox.exists) {
        await client.mailboxClose();
        continue;
      }
      const start = Math.max(1, mailbox.exists - 79);
      const matches = [];
      for await (const msg of client.fetch(`${start}:*`, { uid: true, source: true })) {
        const parsed = await simpleParser(msg.source);
        if (parsed.subject === subject) matches.push(msg.uid);
      }
      if (matches.length) await client.messageDelete(matches, { uid: true });
      await client.mailboxClose();
    }
  } finally {
    try { await client.mailboxClose(); } catch {}
    await client.logout().catch(() => {});
  }
}

function cookieFrom(setCookie) {
  if (!setCookie) throw new Error('Webmail login did not return a session cookie');
  return setCookie.split(',').map(part => part.trim()).find(part => part.startsWith('oms_session='))?.split(';')[0]
    || setCookie.split(';')[0];
}

async function loginWebmail() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(`Webmail login failed with HTTP ${response.status}`);
  webmailCookie = cookieFrom(response.headers.get('set-cookie'));
}

async function webmailMessageAction(folder, uid, action) {
  const response = await fetch(`${baseUrl}/api/messages/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: webmailCookie },
    body: JSON.stringify({ folder, uids: [uid], action }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(`Webmail ${action} action failed with HTTP ${response.status}`);
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

async function syncMail(syncKey, collectionId = inboxCollectionId) {
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
          { tag: 'CollectionId', page: 0, content: collectionId },
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

async function fetchMailBody(syncKey, serverId) {
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
          { tag: 'GetChanges', page: 0, content: '0' },
          { tag: 'Options', page: 0, children: [
            { tag: 'MIMESupport', page: 0, content: '2' },
            { tag: 'BodyPreference', page: 17, children: [
              { tag: 'Type', page: 17, content: '4' },
            ]},
          ]},
          { tag: 'Commands', page: 0, children: [{
            tag: 'Fetch',
            page: 0,
            children: [{ tag: 'ServerId', page: 0, content: serverId }],
          }]},
        ],
      }],
    }],
  });
  const ast = await easRequest('Sync', request);
  const status = descendants(ast, 'Status').find(node => node.page === 0)?.content?.toString();
  if (status !== '1') throw new Error(`Mail body Fetch returned Status ${status || '(missing)'}`);
  const responseFetch = descendants(ast, 'Fetch').find(node => text(node, 'ServerId') === serverId);
  if (!responseFetch || text(responseFetch, 'Status') !== '1') {
    throw new Error(`Mail body Fetch did not return ${serverId}`);
  }
  const appData = child(responseFetch, 'ApplicationData');
  const bodyNode = descendants(appData, 'Body').find(node => node.page === 17);
  if (!bodyNode || text(bodyNode, 'Type') !== '4') throw new Error('Mail body Fetch did not return MIME');
  if (!text(bodyNode, 'Data').includes(bodyPrefix)) throw new Error('Mail body Fetch returned MIME headers without message content');
  if (child(bodyNode, 'Truncated')) throw new Error('Mail body Fetch without TruncationSize was unexpectedly truncated');
  const nextKey = descendants(ast, 'SyncKey').find(node => node.page === 0)?.content?.toString();
  if (!nextKey || nextKey === syncKey) throw new Error(`Mail body Fetch returned invalid SyncKey ${nextKey || '(missing)'}`);
  return nextKey;
}

function findSmokeAdd(ast) {
  return descendants(ast, 'Add').find(node => {
    const appData = child(node, 'ApplicationData');
    return appData && text(appData, 'Subject') === subject;
  });
}

function findServerCommand(ast, commandTag, serverId) {
  return descendants(ast, commandTag).find(node => text(node, 'ServerId') === serverId && !child(node, 'Status'));
}

function assertNoServerCommands(ast) {
  const collection = descendants(ast, 'Collection').find(node => child(node, 'SyncKey') && child(node, 'CollectionId'));
  const commands = collection && child(collection, 'Commands');
  if (commands && (commands.children || []).length) {
    throw new Error(`Expected no-change Sync to return no server commands, got ${(commands.children || []).map(node => node.tag).join(', ')}`);
  }
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
    const found = await findSeedMessage('INBOX');
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
    await loginWebmail();
    const initial = await syncMail('0');
    const smokeAdd = findSmokeAdd(initial.ast);
    if (!smokeAdd) throw new Error('Initial mail Sync did not include the seeded smoke message');

    const serverId = text(smokeAdd, 'ServerId');
    const appData = child(smokeAdd, 'ApplicationData');
    if (!serverId) throw new Error('Seeded smoke message had no ServerId in mail Sync response');
    if (text(appData, 'Read') !== '0') throw new Error('Seeded smoke message should start unread in ActiveSync response');
    if (text(appData, 'MessageClass') !== 'IPM.Note') throw new Error('Seeded smoke message did not return IPM.Note');
    const bodyData = descendants(appData, 'Data').map(node => node.content?.toString() || '').join('\n');
    if (!bodyData.includes(bodyPrefix)) throw new Error('Seeded smoke message body prefix was not returned in ActiveSync response');
    const bodyNode = descendants(appData, 'Body').find(node => node.page === 17);
    if (!bodyNode || text(bodyNode, 'Truncated') !== '1') throw new Error('Mail Sync did not honor body truncation');
    if (Buffer.byteLength(text(bodyNode, 'Data')) > 500) throw new Error('Mail Sync body exceeded requested TruncationSize');

    const fetchKey = await fetchMailBody(initial.nextKey, serverId);
    const readKey = await changeReadFlag(serverId, fetchKey, '1');
    await assertSeenState(true);
    const unreadKey = await changeReadFlag(serverId, readKey, '0');
    await assertSeenState(false);

    const noChange = await syncMail(unreadKey);
    assertNoServerCommands(noChange.ast);

    const inboxMessage = await findSeedMessage('INBOX');
    if (!inboxMessage) throw new Error('Seed message missing from Inbox before web spam action');
    await webmailMessageAction('INBOX', inboxMessage.uid, 'spam');
    await waitForSeedMessage('Junk');
    const inboxAfterJunk = await syncMail(noChange.nextKey);
    if (!findServerCommand(inboxAfterJunk.ast, 'Delete', serverId)) {
      throw new Error('Inbox Sync did not emit Delete after web-style move to Junk');
    }

    const junkInitial = await syncMail('0', junkCollectionId);
    const junkAdd = findSmokeAdd(junkInitial.ast);
    if (!junkAdd) throw new Error('Junk Sync did not emit Add for the moved message');
    const junkServerId = text(junkAdd, 'ServerId');

    const junkMessage = await findSeedMessage('Junk');
    if (!junkMessage) throw new Error('Seed message missing from Junk before web delete action');
    await webmailMessageAction('Junk', junkMessage.uid, 'delete');
    await waitForSeedMessage('Trash');
    const junkAfterTrash = await syncMail(junkInitial.nextKey, junkCollectionId);
    if (!findServerCommand(junkAfterTrash.ast, 'Delete', junkServerId)) {
      throw new Error('Junk Sync did not emit Delete after web-style move to Trash');
    }

    const trashInitial = await syncMail('0', trashCollectionId);
    if (!findSmokeAdd(trashInitial.ast)) throw new Error('Trash Sync did not emit Add for the moved message');

    console.log('PASS: ActiveSync mail smoke completed with full MIME Fetch, Junk/Trash deletes, and efficient no-change Sync');
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
