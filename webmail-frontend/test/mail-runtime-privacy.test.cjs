const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScriptModule(relativePath, overrides = {}) {
  const sourcePath = path.resolve(__dirname, relativePath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.paths = module.paths;
  loaded.require = id => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    return Module.prototype.require.call(loaded, id);
  };
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

test('blocked email markup contains no remote image or CSS fetch targets', () => {
  const { filterEmailRemoteContent } = loadTypeScriptModule('../src/mail/message-privacy.ts');
  const source = [
    '<p style="color: red">Hello</p>',
    '<img src="https://tracker.example/pixel.gif" alt="tracker">',
    '<img src="&#x68;ttps://tracker.example/entity.gif" alt="entity tracker">',
    '<img src="//tracker.example/protocol-relative.gif" alt="relative tracker">',
    '<img src="data:image/png;base64,AAAA" alt="embedded">',
    '<img src="/api/attachments/42" alt="local">',
    '<div style="background-image: url(https://tracker.example/background.png)">remote background</div>',
    '<div style="background-image: url(/* comment */https://tracker.example/comment.png)">commented background</div>',
    '<div style="background-image: url(data:image/png;base64,BBBB)">embedded background</div>',
  ].join('');

  const result = filterEmailRemoteContent(source, false);

  assert.equal(result.blockedRemoteContent, true);
  assert.doesNotMatch(result.html, /tracker\.example/i);
  assert.doesNotMatch(result.html, /src\s*=\s*["']?\/\//i);
  assert.match(result.html, /data:image\/png;base64,AAAA/);
  assert.match(result.html, /src="\/api\/attachments\/42"/);
  assert.match(result.html, /background-image: url\(data:image\/png;base64,BBBB\)/);
  assert.match(result.html, /style="color: red"/);

  assert.deepEqual(filterEmailRemoteContent(source, true), {
    html: source,
    blockedRemoteContent: false,
  });
});

test('trusted remote content requires an exact safe sender address', () => {
  const { shouldLoadExternalContent } = loadTypeScriptModule('../src/mail/message-privacy.ts');
  const safeSenders = ['billing@example.com', '*@partner.example'];

  assert.equal(shouldLoadExternalContent('always', 'Unknown <unknown@example.com>', safeSenders, false), true);
  assert.equal(shouldLoadExternalContent('ask', 'Billing <billing@example.com>', safeSenders, false), false);
  assert.equal(shouldLoadExternalContent('ask', 'Billing <billing@example.com>', safeSenders, true), true);
  assert.equal(shouldLoadExternalContent('trusted', 'Billing <BILLING@example.com>', safeSenders, false), true);
  assert.equal(shouldLoadExternalContent('trusted', 'billing@example.com.evil.test', safeSenders, false), false);
  assert.equal(shouldLoadExternalContent('trusted', 'Person <person@partner.example>', safeSenders, false), false);
  assert.equal(shouldLoadExternalContent('trusted', 'Billing <billing@example.com>, attacker@example.net', safeSenders, false), false);
});

test('delayed mark-read work is cancelled when message selection changes', () => {
  const { scheduleDelayedMarkRead } = loadTypeScriptModule('../src/mail/message-reading.ts');
  let scheduled;
  const cleared = [];
  let markedRead = 0;
  const scheduler = {
    setTimeout(callback, delayMs) {
      scheduled = { callback, delayMs, id: 73 };
      return 73;
    },
    clearTimeout(id) {
      cleared.push(id);
    },
  };

  const cancel = scheduleDelayedMarkRead(3, () => { markedRead += 1; }, scheduler);
  assert.equal(scheduled.delayMs, 3000);
  cancel();
  scheduled.callback();
  assert.equal(markedRead, 0);
  assert.deepEqual(cleared, [73]);

  scheduleDelayedMarkRead(1, () => { markedRead += 1; }, scheduler);
  scheduled.callback();
  assert.equal(markedRead, 1);
});

test('mail settings and identities fall back independently', async () => {
  const defaultMailSettings = {
    identity: { defaultFrom: '', replyTo: '', alwaysBccSelf: false },
    compose: { defaultMode: 'rich', defaultFont: 'system', attachmentReminder: true, undoSendSeconds: 10 },
    reading: { threaded: false, density: 'cozy', previewPane: 'right', snippets: true, externalImages: 'ask', markReadDelaySeconds: 1 },
    spam: { blockedSenders: [], safeSenders: [] },
    signatures: [],
  };
  const runtime = loadTypeScriptModule('../src/mail/mail-runtime-settings.ts', {
    '../settings/settingsApi': { defaultMailSettings },
  });
  const loadedSettings = {
    ...defaultMailSettings,
    reading: { ...defaultMailSettings.reading, externalImages: 'always', markReadDelaySeconds: 5 },
  };

  assert.deepEqual(await runtime.loadMailSettingsOrDefault(async () => loadedSettings), loadedSettings);
  assert.deepEqual(await runtime.loadMailSettingsOrDefault(async () => { throw new Error('offline'); }), defaultMailSettings);
  assert.deepEqual(await runtime.loadMailIdentitiesOrDefault(async () => { throw new Error('offline'); }), {
    name: '', address: '', aliases: [],
  });
  assert.deepEqual(await runtime.loadMailIdentitiesOrDefault(async () => ({
    name: 'Owner', address: 'owner@example.com', aliases: [],
  })), {
    name: 'Owner', address: 'owner@example.com', aliases: [],
  });
  assert.deepEqual(await runtime.loadMailIdentitiesOrDefault(async () => ({
    name: 'Owner', address: 'owner@example.com', aliases: ['legacy@example.com'],
  })), {
    name: 'Owner', address: 'owner@example.com', aliases: [{ address: 'legacy@example.com' }],
  });
});

test('compose sender remains valid as identities arrive and are revoked', () => {
  const { mailIdentities, selectComposeFrom } = loadTypeScriptModule('../src/mail/mail-runtime-settings.ts', {
    '../settings/settingsApi': { defaultMailSettings: {} },
  });
  const identities = mailIdentities({
    name: 'Owner',
    address: 'owner@example.com',
    aliases: [
      { name: 'Sales', address: 'sales@example.com' },
      { name: 'Support', address: 'support@example.com' },
    ],
  });

  assert.equal(selectComposeFrom('', identities, 'sales@example.com'), 'sales@example.com');
  assert.equal(selectComposeFrom('support@example.com', identities, 'sales@example.com'), 'support@example.com');
  assert.equal(selectComposeFrom('revoked@example.com', identities, 'sales@example.com'), 'sales@example.com');
  assert.equal(selectComposeFrom('sales@example.com', identities.slice(0, 1), 'sales@example.com'), 'owner@example.com');
});

test('unimplemented mail controls are absent while inline Send and Archive remains', () => {
  const read = relativePath => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
  const compose = read('../src/mail/ComposeModal.tsx');
  const viewer = read('../src/mail/MessageViewer.tsx');
  const hook = read('../src/mail/hooks/useMail.ts');
  const panel = read('../src/settings/SettingsPanel.tsx');
  const navigation = read('../src/settings/settingsNavigation.ts');
  const tabs = read('../src/settings/tabs.ts');
  const settingsRoutes = read('../src/settings/routes.tsx');
  const mailRoutes = read('../src/mail/routes.tsx');

  assert.doesNotMatch(compose, /Send & Archive/);
  assert.doesNotMatch(compose, /handleSendAndArchive/);
  assert.doesNotMatch(viewer, /Mute thread/);
  assert.doesNotMatch(hook, /muteThread/);
  assert.doesNotMatch(panel, /updateReading\(\{ threaded:/);
  assert.doesNotMatch(navigation, /mail_forwarding|mail_vacation|Auto-Responder/);
  assert.doesNotMatch(tabs, /mail_forwarding|mail_vacation/);
  assert.doesNotMatch(settingsRoutes, /forwardingGoto|vacationSettings|handleSaveForwarding|handleSaveVacation/);
  assert.match(viewer, /onSendAndArchive=\{async \(\) =>/);
  assert.match(viewer, /filterEmailRemoteContent\(sanitized, allowRemoteContent\)/);
  assert.match(viewer, /scheduleDelayedMarkRead\(mail\.mailSettings\.reading\.markReadDelaySeconds/);
  assert.match(mailRoutes, /loadMailSettingsOrDefault\(\(\) => getUserSettings\('mail'\)\)/);
  assert.match(mailRoutes, /loadMailIdentitiesOrDefault\(fetchIdentities\)/);
});

test('undo send uses the supported POST contract and draft saves carry stable identity', () => {
  const read = relativePath => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
  const api = read('../src/shared/api.ts');
  const hook = read('../src/mail/hooks/useMail.ts');
  const toast = read('../src/shared/components/Toast.tsx');

  assert.match(api, /fetch\('\/api\/messages\/undo'/);
  assert.match(api, /method:\s*'POST'/);
  assert.doesNotMatch(hook, /messages\/send\?scheduledId/);
  assert.match(hook, /formData\.append\('draftId',\s*currentDraft\.draftId\)/);
  assert.match(hook, /draftSaveCoordinatorRef\.current\.enqueue/);
  assert.match(hook, /const closeComposer = useCallback\([\s\S]*await saveCurrentDraft\(\)[\s\S]*setIsComposing\(false\)/);
  assert.match(hook, /if \(!isComposing \|\| sending\) return/);
  assert.match(toast, /actionLabel/);
  assert.match(toast, /onAction/);
  assert.match(toast, /duration:\s*number/);
  assert.match(toast, /catch[\s\S]*toastTimersRef\.current\.set\(\s*toast\.id,[\s\S]*setTimeout\(\(\) => removeToast\(toast\.id\),\s*toast\.duration\)/);
  assert.match(toast, /role=\{toast\.type === 'error' \? 'alert' : 'status'\}/);
});

test('scheduled delivery states are discoverable, honest, and not wired to IMAP actions', () => {
  const read = relativePath => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
  const list = read('../src/mail/MessageList.tsx');
  const row = read('../src/mail/MessageRow.tsx');
  const viewer = read('../src/mail/MessageViewer.tsx');

  assert.match(list, /decodedFolder\.toUpperCase\(\) === 'SCHEDULED'/);
  assert.match(row, /delivery_uncertain:\s*'Delivery uncertain'/);
  assert.match(row, /partial_delivery:\s*'Partially delivered'/);
  assert.match(row, /!isScheduled && <span className="message-row-actions"/);
  assert.match(viewer, /Do not resend until you verify whether the recipient received it/);
  assert.match(viewer, /partial_delivery:\s*\{ label: 'Partially delivered',[\s\S]*Some recipients accepted this message, but others rejected it/);
  assert.match(viewer, /mail\.cancelScheduledSend\(scheduledId\)/);
  assert.match(viewer, /!isScheduled && !isDraft && <InlineReply/);
  assert.match(list, /if \(!scheduledFolder \|\| isSearchActive\) return/);
  assert.match(list, /window\.setInterval\([\s\S]*fetchMessages\(\)[\s\S]*fetchFolders\(\)/);
  assert.match(viewer, /scheduledMessageWasVisibleRef[\s\S]*has left Scheduled/);
  assert.match(viewer, /scheduledState === 'failed' \|\| scheduledState === 'delivery_uncertain' \|\| scheduledState === 'partial_delivery'/);
  assert.match(viewer, /Remove from Scheduled/);
  assert.match(viewer, /does not cancel delivery and the recipient may already have received the message/);
  assert.match(viewer, /Some recipients already received this message/);
  assert.match(viewer, /mail\.removeScheduledMessage\(scheduledId\)/);
});

test('terminal scheduled removal uses DELETE and preserves conflict details', async () => {
  const { removeScheduledMessage } = loadTypeScriptModule('../src/shared/api.ts');
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: false,
      json: async () => ({
        success: false,
        code: 'SCHEDULED_MESSAGE_NOT_TERMINAL',
        error: 'Only failed or uncertain scheduled messages can be removed',
      }),
    };
  };
  try {
    await assert.rejects(removeScheduledMessage(73), /Only failed or uncertain/);
    assert.deepEqual(requests, [{
      url: '/api/messages/scheduled/73',
      options: { method: 'DELETE' },
    }]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('send API preserves the backend error message', async () => {
  const { sendMessage } = loadTypeScriptModule('../src/shared/api.ts');
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    json: async () => ({ success: false, error: 'The selected From address is no longer authorized' }),
  });
  try {
    await assert.rejects(sendMessage(new FormData()), /selected From address is no longer authorized/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('inline replies honor Undo Send and never offer early archive while undo is configured', () => {
  const read = relativePath => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
  const hook = read('../src/mail/hooks/useMail.ts');
  const viewer = read('../src/mail/MessageViewer.tsx');
  const inlineReply = read('../src/mail/components/InlineReply.tsx');

  assert.match(hook, /sendReply[\s\S]*undoSendSeconds[\s\S]*formData\.append\('delaySeconds'/);
  assert.match(viewer, /showSendAndArchive=\{mail\.mailSettings\.compose\.undoSendSeconds === 0\}/);
  assert.match(viewer, /Reply could not be sent/);
  assert.match(viewer, /result\.deliveryStatus === 'accepted'[\s\S]*messageAction\('archive'[\s\S]*navigate/);
  assert.match(inlineReply, /showSendAndArchive &&/);
});
