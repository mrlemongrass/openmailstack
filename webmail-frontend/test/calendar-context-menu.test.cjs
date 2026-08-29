const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const source = relativePath => fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

function loadTypeScriptModule(relativePath) {
  const sourcePath = path.resolve(__dirname, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.paths = module.paths;
  loaded.require = id => {
    if (id === './calendarTime') return loadTypeScriptModule('../src/calendar/calendarTime.ts');
    return Module.prototype.require.call(loaded, id);
  };
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

test('calendar event context actions recognize portable meeting links and make a safe duplicate', () => {
  const {
    duplicateCalendarEventDraft,
    downloadableCalendarEventIcal,
    eventIcsFilename,
    meetingUrlForEvent,
  } = loadTypeScriptModule('../src/calendar/calendarContextActions.ts');

  const event = {
    id: 'opaque-event-uid',
    occurrenceId: '20260829T160000Z',
    calendarId: 42,
    title: 'Roadmap / launch?',
    start: new Date('2026-08-29T16:00:00Z'),
    end: new Date('2026-08-29T16:30:00Z'),
    location: 'Microsoft Teams: https://teams.microsoft.com/l/meetup-join/abc',
    description: 'Backup link: https://example.test/room',
    recurrence: 'FREQ=WEEKLY',
    rawIcal: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR',
    seriesTitle: 'Roadmap series',
  };

  assert.equal(
    meetingUrlForEvent(event),
    'https://teams.microsoft.com/l/meetup-join/abc',
  );
  assert.equal(eventIcsFilename(event), 'Roadmap-launch.ics');

  const duplicate = duplicateCalendarEventDraft(event);
  assert.equal(duplicate.title, 'Roadmap / launch? (copy)');
  assert.equal(duplicate.calendarId, 42);
  const wallAsUtc = value => Date.UTC(
    value.getFullYear(), value.getMonth(), value.getDate(),
    value.getHours(), value.getMinutes(), value.getSeconds(),
  );
  assert.equal(wallAsUtc(duplicate.start), event.start.getTime());
  assert.equal(wallAsUtc(duplicate.end), event.end.getTime());
  assert.equal(duplicate.timeKind, 'utc');
  assert.equal(duplicate.id, undefined);
  assert.equal(duplicate.occurrenceId, undefined);
  assert.equal(duplicate.rawIcal, undefined);
  assert.equal(duplicate.recurrence, undefined);
  assert.equal(duplicate.seriesTitle, undefined);

  const projectedUtcOccurrence = {
    ...event,
    start: new Date(2026, 8, 8, 9, 0),
    end: new Date(2026, 8, 8, 10, 0),
    sourceStart: new Date('2026-09-08T16:00:00Z'),
    sourceEnd: new Date('2026-09-08T17:00:00Z'),
    timeKind: 'utc',
    rawIcal: [
      'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:opaque-event-uid',
      'DTSTART:20260901T160000Z', 'DTEND:20260901T170000Z',
      'RRULE:FREQ=WEEKLY', 'EXDATE:20260915T160000Z', 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'),
  };
  const downloaded = downloadableCalendarEventIcal(
    projectedUtcOccurrence,
    'America/Phoenix',
    () => 'download-uid',
    () => new Date('2026-08-29T12:00:00Z'),
  );
  assert.match(downloaded, /UID:download-uid@openmailstack/);
  assert.match(downloaded, /DTSTART:20260908T160000Z/);
  assert.match(downloaded, /DTEND:20260908T170000Z/);
  assert.doesNotMatch(downloaded, /RRULE|EXDATE|RECURRENCE-ID/);

  const zonedDuplicate = duplicateCalendarEventDraft({
    ...event,
    occurrenceId: undefined,
    start: new Date(2026, 8, 1, 12, 0),
    end: new Date(2026, 8, 1, 13, 0),
    sourceStart: new Date('2026-09-01T16:00:00Z'),
    sourceEnd: new Date('2026-09-01T17:00:00Z'),
    timeKind: 'zoned',
    timeZone: 'America/Los_Angeles',
  }, 'America/New_York');
  assert.equal(zonedDuplicate.start.getHours(), 9);
  assert.equal(zonedDuplicate.end.getHours(), 10);
  assert.equal(zonedDuplicate.timeZone, 'America/Los_Angeles');
});

test('calendar event context actions reject unsafe links', () => {
  const { meetingUrlForEvent } = loadTypeScriptModule('../src/calendar/calendarContextActions.ts');

  assert.equal(meetingUrlForEvent({
    location: 'javascript:alert(1)',
    description: 'data:text/html,not-a-meeting',
  }), null);
  assert.equal(meetingUrlForEvent({
    location: '',
    description: 'Join at https://zoom.us/j/123456789 when ready.',
  }), 'https://zoom.us/j/123456789');
  assert.equal(meetingUrlForEvent({
    location: 'https://example.test/restaurant',
    description: 'Dinner reservation details',
  }), null);
  assert.equal(meetingUrlForEvent({
    location: 'Join meeting: https://video.example.test/room/abc',
    description: '',
  }), 'https://video.example.test/room/abc');
});

test('calendar capability helpers protect managed calendars and distinguish delete from remove', () => {
  const {
    calendarRemovalKind,
    canEditCalendarEvents,
    canDeleteCalendar,
    canManageCalendar,
    isManagedCalendar,
  } = loadTypeScriptModule('../src/calendar/calendarContextActions.ts');

  const personal = { id: 1, name: 'Personal', access_role: 'owner', events: [] };
  const birthdays = { id: 2, name: 'Birthdays', dav_slug: 'birthdays', access_role: 'owner', events: [] };
  const shared = { id: 3, name: 'Team', access_role: 'write', events: [] };
  const secondary = { id: 4, name: 'Projects', access_role: 'owner', events: [] };

  assert.equal(canManageCalendar(personal), true);
  assert.equal(canManageCalendar(birthdays), false);
  assert.equal(canManageCalendar(shared), false);
  assert.equal(isManagedCalendar(birthdays), true);
  assert.equal(canDeleteCalendar(personal, [personal, birthdays, secondary]), false);
  assert.equal(canDeleteCalendar(secondary, [personal, birthdays, secondary]), true);
  assert.equal(canDeleteCalendar(personal, [personal]), false);
  assert.equal(calendarRemovalKind(shared, [personal, shared]), 'remove');
  assert.equal(calendarRemovalKind({ ...secondary, subscribed_url: 'https://example.test/feed.ics' }, [personal, secondary]), 'remove');
  assert.equal(canEditCalendarEvents(personal), true);
  assert.equal(canEditCalendarEvents(shared), true);
  assert.equal(canEditCalendarEvents({ ...shared, access_role: 'read' }), false);
  assert.equal(canEditCalendarEvents({ ...secondary, subscribed_url: 'https://example.test/feed.ics' }), false);
});

test('temporary calendar visibility views preserve the saved selection', () => {
  const { calendarIsVisible } = loadTypeScriptModule('../src/calendar/calendarContextActions.ts');
  const selected = { 1: true, 2: false, 3: true };

  assert.equal(calendarIsVisible(2, selected, { kind: 'all' }), true);
  assert.equal(calendarIsVisible(1, selected, { kind: 'only', calendarId: 3 }), false);
  assert.equal(calendarIsVisible(3, selected, { kind: 'only', calendarId: 3 }), true);
  assert.equal(calendarIsVisible(1, selected, null), true);
  assert.equal(calendarIsVisible(2, selected, null), false);
});

test('calendar grid navigation is bounded and preserves week geometry', () => {
  const {
    calendarTimeAtPointer,
    dayGridTargetIndex,
    monthGridTargetIndex,
    weekGridTargetIndex,
  } = loadTypeScriptModule('../src/calendar/calendarSurfaceNavigation.ts');

  assert.equal(dayGridTargetIndex('ArrowDown', 23), 23);
  assert.equal(dayGridTargetIndex('Home', 16), 0);
  assert.equal(monthGridTargetIndex('ArrowDown', 5, 35), 12);
  assert.equal(monthGridTargetIndex('End', 8, 35), 13);
  assert.equal(weekGridTargetIndex('ArrowRight', 2 * 24 + 9), 3 * 24 + 9);
  assert.equal(weekGridTargetIndex('ArrowUp', 9), 8);
  assert.equal(
    calendarTimeAtPointer(new Date(2026, 7, 29), 11, 142, { top: 100, height: 56 }).getMinutes(),
    45,
  );
});

test('calendar sidebar exposes discoverable management and visibility actions', () => {
  const sidebar = source('src/calendar/CalendarSidebar.tsx');
  const dialogs = source('src/calendar/CalendarManagementDialogs.tsx');

  assert.match(sidebar, /Add calendar/);
  assert.match(sidebar, /Go to my booking page/);
  assert.match(sidebar, /Copy booking page link/);
  assert.match(sidebar, /scheduler-app\?section=profile/);
  assert.match(sidebar, /My calendars/);
  assert.match(sidebar, /Show all/);
  assert.match(sidebar, /Show selected/);
  assert.match(sidebar, /Show this only/);
  assert.match(sidebar, /Rename/);
  assert.match(sidebar, /Sharing and permissions/);
  assert.match(sidebar, /Delete/);
  assert.match(sidebar, /onContextMenu=/);
  assert.match(sidebar, /event\.shiftKey && event\.key === 'F10'/);
  assert.match(sidebar, /event\.key === 'ContextMenu'/);
  assert.match(sidebar, /aria-haspopup="menu"/);
  assert.match(sidebar, /<ContextMenu/);
  assert.match(dialogs, /role="dialog"/);
  assert.match(dialogs, /aria-modal="true"/);
  assert.match(dialogs, /Calendar name/);
  assert.match(dialogs, /Calendar color/);
  assert.match(dialogs, /Subscribe from web/);
  assert.match(dialogs, /Import an \.ics file/);
});

test('unpublished Scheduler links open the Profile section', () => {
  const routes = source('src/scheduler/routes.tsx');
  assert.match(routes, /initialSchedulerTab/);
  assert.match(routes, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(routes, /new Set\(\[initialSchedulerTab\(\)\]\)/);
});

test('month, week, and day surfaces wire empty-slot and event context menus', () => {
  const layout = source('src/calendar/CalendarLayout.tsx');
  const menus = source('src/calendar/CalendarContextMenus.tsx');
  const invitationDialogs = source('src/calendar/CalendarInvitationDialogs.tsx');
  const month = source('src/calendar/views/MonthView.tsx');
  const week = source('src/calendar/views/WeekView.tsx');
  const day = source('src/calendar/views/DayView.tsx');

  assert.doesNotMatch(layout, /cal\.events\.length === 0/);
  assert.match(layout, /<CalendarContextMenus/);
  for (const view of [month, week, day]) {
    assert.match(view, /onContextMenu=/);
    assert.match(view, /openSlotContextMenu/);
    assert.match(view, /openEventContextMenu/);
    assert.match(view, /Shift\+F10/);
  }
  for (const action of [
    'New event',
    'Go to today',
    'Edit event',
    'View event',
    'Join meeting',
    'Copy meeting link',
    'Print',
    'Duplicate event',
    'Download .ics',
    'Delete event',
    'Delete this occurrence',
    'Delete entire series',
    'Accept',
    'Tentative',
    'Decline',
    'Propose new time',
    'Reply',
    'Reply all',
    'Forward',
    'Cancel meeting',
    'Cancel this occurrence',
  ]) {
    assert.match(menus, new RegExp(action.replace('.', '\\.')));
  }
  assert.match(invitationDialogs, /role="dialog"/);
  assert.match(invitationDialogs, /aria-modal="true"/);
  assert.match(invitationDialogs, /Proposed start/);
  assert.match(invitationDialogs, /Proposed end/);
  assert.match(invitationDialogs, /Note to organizer/);
  assert.match(invitationDialogs, /Send proposal/);
});

test('mobile Calendar exposes an opaque focus-managed calendar drawer', () => {
  const layout = source('src/calendar/CalendarLayout.tsx');
  const css = source('src/index.css');

  assert.match(layout, /MobileCalendarDrawer/);
  assert.match(layout, /useModalFocus/);
  assert.match(layout, /aria-label="Calendars"/);
  assert.match(layout, /onNestedDialogChange/);
  assert.match(css, /\.mobile-calendar-drawer\s*\{[^}]*background:\s*var\(--surface-color\)/s);
});

test('calendar API mutations fail visibly instead of treating HTTP errors as success', () => {
  const api = source('src/shared/api.ts');
  const hook = source('src/calendar/hooks/useCalendar.ts');

  assert.match(api, /calendarApiResponse/);
  assert.match(api, /if \(!response\.ok \|\| !body\.success\)/);
  assert.match(hook, /createCalendar/);
  assert.match(hook, /updateCalendar/);
  assert.match(hook, /removeCalendar/);
  assert.match(hook, /duplicateEvent/);
  assert.match(api, /importCalendar/);
  assert.match(hook, /calendarVisibilityOverride/);
  assert.match(source('src/calendar/EventModal.tsx'), /More event actions/);
  assert.doesNotMatch(source('src/calendar/EventModal.tsx'), /cal\.deleteEvent/);
});
