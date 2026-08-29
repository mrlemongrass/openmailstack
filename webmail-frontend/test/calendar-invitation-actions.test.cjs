const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function load(relativePath, overrides = {}) {
  const sourcePath = path.resolve(__dirname, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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

const event = {
  id: 'meeting-123', calendarId: 7, title: 'Roadmap review',
  start: new Date('2026-09-01T16:00:00.000Z'), end: new Date('2026-09-01T17:00:00.000Z'),
  location: 'Room 4', description: 'Review the next milestone.',
  rawIcal: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:meeting-123\r\nEND:VEVENT\r\nEND:VCALENDAR',
  invitation: {
    role: 'attendee', organizerEmail: 'alice@example.test', organizerName: 'Alice',
    attendeeEmail: 'owner@example.test', response: 'tentative', responseRequested: true,
    attendees: [
      { email: 'owner@example.test', name: 'Owner', response: 'tentative', role: 'required' },
      { email: 'bob@example.test', name: 'Bob', response: 'accepted', role: 'optional' },
    ],
    attendeeCount: 2, attendeesTruncated: false,
    recurring: false, canRespond: true, canCancel: false, canCancelOccurrence: false,
    canProposeNewTime: true, canForward: true, sequence: 2,
  },
};

test('meeting Reply and Reply all create normal Compose recipients without mailing the current attendee', () => {
  const { calendarInvitationComposeDraft } = load('../src/calendar/calendarInvitationActions.ts');

  const reply = calendarInvitationComposeDraft('reply', event);
  assert.equal(reply.from, 'owner@example.test');
  assert.equal(reply.to, 'alice@example.test');
  assert.equal(reply.cc, undefined);
  assert.equal(reply.subject, 'Re: Roadmap review');
  assert.match(reply.body, /Meeting: Roadmap review/);

  const replyAll = calendarInvitationComposeDraft('reply-all', event);
  assert.equal(replyAll.to, 'alice@example.test');
  assert.equal(replyAll.cc, 'bob@example.test');
  assert.doesNotMatch(`${replyAll.to} ${replyAll.cc}`, /owner@example\.test/);
});

test('calendar notification recovery is privacy-safe, visible, and supports exact retry', () => {
  const hook = fs.readFileSync(
    path.resolve(__dirname, '../src/calendar/hooks/useCalendar.ts'),
    'utf8',
  );
  const layout = fs.readFileSync(
    path.resolve(__dirname, '../src/calendar/CalendarLayout.tsx'),
    'utf8',
  );
  const metadata = hook.match(/type CalendarInvitationRecoveryMetadata[\s\S]*?\n};/)?.[0] || '';

  assert.match(metadata, /kind: 'calendar-invitation'/);
  assert.match(metadata, /retryOf\?: string/);
  assert.doesNotMatch(metadata, /^\s*(?:title|mailbox|calendarId|uid|start|end|comment)\??:/m);
  assert.match(hook, /fetchIdentities[\s\S]*reconcileMailbox[\s\S]*fetchOutboundMessageStatusByKey/);
  assert.match(hook, /retryCalendarInvitationNotification/);
  assert.match(hook, /onPrepared:[\s\S]*state: attempt\.blocked \? 'uncertain' : 'prepared'/);
  assert.match(hook, /onSubmitted:/);
  assert.match(hook, /verifiedAbsent = notice\.state === 'uncertain'/);
  assert.match(hook, /RETRY_PAYLOAD_UNAVAILABLE/);
  assert.match(hook, /state: 'terminal'/);
  assert.match(hook, /else if \(!nextAttempt\) upsertInvitationRecovery\(\{ \.\.\.notice, error: message \}\)/);
  assert.match(layout, /aria-live="polite"/);
  assert.match(layout, /I verified it wasn't delivered/);
  assert.match(layout, /canCheck = notice\.state !== 'terminal'/);
  assert.match(layout, /notice\.state === 'terminal'/);
  assert.match(layout, /canDismiss &&/);
  assert.doesNotMatch(layout, /recovery\.title/);
});

test('calendar retry API preserves a definitive structured failure code', async () => {
  const { retryCalendarInvitationNotification, OutboundSendRequestError } = load('../src/shared/api.ts');
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({
      success: false,
      code: 'RETRY_PAYLOAD_UNAVAILABLE',
      error: 'The original meeting notification is no longer available for an exact retry',
    }),
  });
  try {
    await assert.rejects(
      retryCalendarInvitationNotification('original-key', 'successor-key'),
      error => error instanceof OutboundSendRequestError
        && error.definitive === true
        && error.status === 409
        && error.code === 'RETRY_PAYLOAD_UNAVAILABLE',
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('meeting Compose uses source instants when Calendar displays projected wall dates', () => {
  const { calendarInvitationComposeDraft } = load('../src/calendar/calendarInvitationActions.ts');
  const draft = calendarInvitationComposeDraft('reply', {
    ...event,
    start: new Date('2026-09-01T09:00:00.000Z'),
    end: new Date('2026-09-01T10:00:00.000Z'),
    sourceStart: new Date('2026-09-01T13:00:00.000Z'),
    sourceEnd: new Date('2026-09-01T14:00:00.000Z'),
  });

  assert.match(draft.body, /2026-09-01T13:00:00\.000Z – 2026-09-01T14:00:00\.000Z/);
  assert.doesNotMatch(draft.body, /2026-09-01T09:00:00\.000Z/);
});

test('meeting Forward creates an editable Compose draft with the original iCalendar attachment', () => {
  const { calendarInvitationComposeDraft } = load('../src/calendar/calendarInvitationActions.ts');
  const draft = calendarInvitationComposeDraft('forward', event);

  assert.equal(draft.from, 'owner@example.test');
  assert.equal(draft.to, undefined);
  assert.equal(draft.subject, 'Fwd: Roadmap review');
  assert.match(draft.body, /Review the next milestone/);
  assert.deepEqual(draft.attachments, [{
    name: 'Roadmap-review.ics',
    type: 'text/calendar;charset=utf-8',
    content: event.rawIcal,
  }]);
});

test('meeting Forward honors an organizer forwarding restriction', () => {
  const { calendarInvitationComposeDraft } = load('../src/calendar/calendarInvitationActions.ts');
  assert.throws(
    () => calendarInvitationComposeDraft('forward', {
      ...event, invitation: { ...event.invitation, canForward: false },
    }),
    /does not allow forwarding/i,
  );
});

test('organizer Reply all addresses attendees and excludes the organizer identity', () => {
  const { calendarInvitationComposeDraft } = load('../src/calendar/calendarInvitationActions.ts');
  const draft = calendarInvitationComposeDraft('reply-all', {
    ...event,
    invitation: {
      ...event.invitation,
      role: 'organizer', organizerEmail: 'owner@example.test', attendeeEmail: undefined,
    },
  });
  assert.equal(draft.to, 'bob@example.test');
  assert.equal(draft.from, 'owner@example.test');
  assert.equal(draft.cc, undefined);
});

test('Reply all fails closed when the projected attendee roster is incomplete', () => {
  const { calendarInvitationComposeDraft } = load('../src/calendar/calendarInvitationActions.ts');
  assert.throws(
    () => calendarInvitationComposeDraft('reply-all', {
      ...event,
      invitation: {
        ...event.invitation,
        attendeeCount: 75,
        attendeesTruncated: true,
      },
    }),
    /more attendees than can be reviewed safely/i,
  );
});

test('cross-suite Compose handoff is one-shot, bounded, and reconstructs attachments', () => {
  const {
    saveCrossSuiteComposeDraft,
    takeCrossSuiteComposeDraft,
    crossSuiteComposeFiles,
  } = load('../src/shared/crossSuiteCompose.ts');
  const values = new Map();
  const storage = {
    setItem: (key, value) => values.set(key, value),
    getItem: key => values.get(key) || null,
    removeItem: key => values.delete(key),
  };
  const draft = {
    from: 'owner@example.test', to: 'alice@example.test', subject: 'Fwd: Roadmap review', body: 'Meeting details',
    attachments: [{ name: 'invite.ics', type: 'text/calendar', content: event.rawIcal }],
  };

  saveCrossSuiteComposeDraft(storage, draft);
  const restored = takeCrossSuiteComposeDraft(storage);
  assert.deepEqual(restored, draft);
  assert.equal(takeCrossSuiteComposeDraft(storage), null);
  const files = crossSuiteComposeFiles(restored);
  assert.equal(files[0].name, 'invite.ics');
  assert.equal(files[0].type, 'text/calendar');

  assert.throws(
    () => saveCrossSuiteComposeDraft(storage, { body: 'x'.repeat(800_000) }),
    /too large/i,
  );
});

test('cross-suite Calendar Compose preserves its alias until identities authorize it', () => {
  const {
    saveCrossSuiteComposeDraft,
    takeCrossSuiteComposeDraft,
  } = load('../src/shared/crossSuiteCompose.ts');
  const {
    mailIdentities,
    resolveComposeIdentity,
  } = load('../src/mail/mail-runtime-settings.ts', {
    '../settings/settingsApi': { defaultMailSettings: {} },
  });
  const values = new Map();
  const storage = {
    setItem: (key, value) => values.set(key, value),
    getItem: key => values.get(key) || null,
    removeItem: key => values.delete(key),
  };

  saveCrossSuiteComposeDraft(storage, {
    from: 'calendar-alias@example.test',
    to: 'organizer@example.test',
    subject: 'Re: Roadmap review',
    body: 'Meeting details',
  });
  const restored = takeCrossSuiteComposeDraft(storage);

  const loading = resolveComposeIdentity(restored.from, [], 'owner@example.test', false, '');
  assert.equal(loading.address, 'calendar-alias@example.test');
  assert.equal(loading.state, 'loading');
  assert.equal(loading.ready, false);

  const unavailable = resolveComposeIdentity(
    restored.from,
    [],
    'owner@example.test',
    false,
    'Sending identities could not be loaded.',
  );
  assert.equal(unavailable.address, 'calendar-alias@example.test');
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(unavailable.ready, false);

  const authorized = resolveComposeIdentity(
    restored.from,
    mailIdentities({
      name: 'Owner',
      address: 'owner@example.test',
      aliases: [{ name: 'Calendar', address: 'calendar-alias@example.test' }],
    }),
    'owner@example.test',
    true,
    '',
  );
  assert.equal(authorized.address, 'calendar-alias@example.test');
  assert.equal(authorized.state, 'ready');
  assert.equal(authorized.ready, true);
});
