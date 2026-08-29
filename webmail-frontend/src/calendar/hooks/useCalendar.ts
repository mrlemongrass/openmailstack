import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { io as createSocket } from 'socket.io-client';
import type { Calendar, CalendarEvent, CalendarSubscriptionRefreshResponse } from '../../shared/types';
import type { ContextMenuPoint } from '../../shared/context-menu-navigation';
import * as api from '../../shared/api';
import {
  createBrowserOutboundSendAttemptCoordinator,
  sendOutboundMessage,
  type OutboundSendRecovery,
  type OutboundSendRecoveryMetadata,
  type PreparedOutboundSendAttempt,
} from '../../mail/immediate-send';
import { useCalendarSettings } from '../../shared/hooks/useCalendarSettings';
import { useCalendarTimeZone } from '../../shared/hooks/useCalendarTimeZone';
import {
  addWallDays,
  buildCalendarEventIcal,
  calendarEventDraftForEdit,
  eventTimeKind,
  projectInstantToWallDate,
  wallDateToInstant,
} from '../calendarTime';
import {
  buildFreeBusyRequestUrl,
  createUnavailableFreeBusyLookup,
  normalizeFreeBusyResponse,
  type FreeBusyLookup,
} from '../freeBusy';
import {
  calendarIsVisible,
  canEditCalendarEvents,
  duplicateCalendarEventDraft,
  type CalendarVisibilityOverride,
  writableCalendarForEvent,
} from '../calendarContextActions';

export type CalendarContextMenuState =
  | { kind: 'slot'; point: ContextMenuPoint; start: Date; isAllDay: boolean }
  | { kind: 'event'; point: ContextMenuPoint; event: CalendarEvent };

type CalendarInvitationRecoveryMetadata = OutboundSendRecoveryMetadata & {
  kind: 'calendar-invitation';
  version: 1;
  action: 'respond' | 'cancel' | 'propose-time';
  retryOf?: string;
  verifiedAbsent?: boolean;
};

function calendarInvitationRecovery(
  attempt: PreparedOutboundSendAttempt,
): CalendarInvitationRecoveryMetadata | null {
  const recovery = attempt.recovery;
  if (recovery?.kind !== 'calendar-invitation' || recovery.version !== 1
    || !['respond', 'cancel', 'propose-time'].includes(String(recovery.action))
    || (recovery.retryOf !== undefined && typeof recovery.retryOf !== 'string')
    || (recovery.verifiedAbsent !== undefined && recovery.verifiedAbsent !== true)) {
    return null;
  }
  return recovery as CalendarInvitationRecoveryMetadata;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useCalendar() {
  const {
    settings: calendarSettings,
    isLoading: settingsLoading,
    error: settingsError,
    refresh: refreshCalendarSettings,
  } = useCalendarSettings();
  const displayTimeZone = useCalendarTimeZone(calendarSettings);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [sourceEvents, setSourceEvents] = useState<CalendarEvent[]>([]);
  const [calendarViewOverride, setCalendarView] = useState<'month' | 'week' | 'day' | 'year' | 'agenda' | null>(null);
  const calendarView = calendarViewOverride || calendarSettings.defaultView;
  const [currentDate, setCurrentDate] = useState(() => projectInstantToWallDate(new Date(), 'utc', displayTimeZone));
  const [calendarSearchQuery, setCalendarSearchQuery] = useState('');
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [isAdvancedEventMode, setIsAdvancedEventMode] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Partial<CalendarEvent> | null>(null);
  const [eventError, setEventError] = useState('');
  const [eventSaving, setEventSaving] = useState(false);
  const [invitationActionPending, setInvitationActionPending] = useState<string | null>(null);
  const invitationSendAttempts = useRef(createBrowserOutboundSendAttemptCoordinator());
  const [invitationRecoveryNotices, setInvitationRecoveryNotices] = useState<OutboundSendRecovery[]>([]);
  const [calendarContextMenu, setCalendarContextMenu] = useState<CalendarContextMenuState | null>(null);
  const [calendarVisibility, setCalendarVisibility] = useState<Record<number, boolean>>(() => {
    try {
      const stored = localStorage.getItem('oms_calendar_visibility');
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });
  const [calendarVisibilityOverride, setCalendarVisibilityOverride] = useState<CalendarVisibilityOverride>(null);
  const [quickCreateText, setQuickCreateText] = useState('');
  const [now, setNow] = useState(() => new Date());

  const removeInvitationRecovery = useCallback((attempt: PreparedOutboundSendAttempt) => {
    setInvitationRecoveryNotices(current => current.filter(item => (
      item.attempt.recordId !== attempt.recordId || item.attempt.key !== attempt.key
    )));
  }, []);

  const upsertInvitationRecovery = useCallback((recovery: OutboundSendRecovery) => {
    if (!calendarInvitationRecovery(recovery.attempt)) return;
    setInvitationRecoveryNotices(current => [
      ...current.filter(item => item.attempt.recordId !== recovery.attempt.recordId),
      recovery,
    ]);
  }, []);

  const trackInvitationDelivery = useCallback(async (
    attempt: PreparedOutboundSendAttempt,
    result: Awaited<ReturnType<typeof api.fetchOutboundMessageStatus>>,
  ) => {
    const state = result.deliveryStatus;
    if (state === 'accepted') {
      await invitationSendAttempts.current.markDefinitive(attempt);
      removeInvitationRecovery(attempt);
    } else if (state === 'uncertain') {
      await invitationSendAttempts.current.markUncertain(attempt);
      upsertInvitationRecovery({ attempt, state, result });
    } else if (state === 'failed' || state === 'partial' || state === 'pending') {
      upsertInvitationRecovery({ attempt, state, result });
    }
  }, [removeInvitationRecovery, upsertInvitationRecovery]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const displayNow = useMemo(
    () => projectInstantToWallDate(now, 'utc', displayTimeZone),
    [displayTimeZone, now]
  );
  const previousDisplayTimeZone = useRef(displayTimeZone);

  useEffect(() => {
    const previousToday = projectInstantToWallDate(new Date(), 'utc', previousDisplayTimeZone.current);
    setCurrentDate(current => (
      current.getFullYear() === previousToday.getFullYear()
      && current.getMonth() === previousToday.getMonth()
      && current.getDate() === previousToday.getDate()
        ? projectInstantToWallDate(new Date(), 'utc', displayTimeZone)
        : current
    ));
    previousDisplayTimeZone.current = displayTimeZone;
  }, [displayTimeZone]);

  // New event draft
  const [newEvent, setNewEvent] = useState<Partial<CalendarEvent>>({
    title: '', start: displayNow, end: new Date(displayNow.getTime() + 3600000),
    isAllDay: false, timeKind: 'zoned', timeZone: displayTimeZone,
    location: '', description: '', calendarId: 0,
    notifications: calendarSettings.defaultReminderMinutes > 0
      ? [{ id: 1, type: 'notification', time: calendarSettings.defaultReminderMinutes }]
      : undefined,
  });

  const events = useMemo(() => sourceEvents.map(event => {
    const timeKind = eventTimeKind(event);
    const sourceStart = event.sourceStart || event.start;
    const sourceEnd = event.sourceEnd || event.end;
    return {
      ...event,
      timeKind,
      sourceStart,
      sourceEnd,
      start: projectInstantToWallDate(sourceStart, timeKind, displayTimeZone),
      end: projectInstantToWallDate(sourceEnd, timeKind, displayTimeZone),
    };
  }), [sourceEvents, displayTimeZone]);

  const writableCalendars = useMemo(
    () => calendars.filter(canEditCalendarEvents),
    [calendars],
  );
  const canModifyEditingEvent = useMemo(() => {
    if (!editingEvent) return true;
    const sourceCalendar = calendars.find(calendar => calendar.id === editingEvent.calendarId);
    return Boolean(
      sourceCalendar
      && canEditCalendarEvents(sourceCalendar)
      && !editingEvent.invitation,
    );
  }, [calendars, editingEvent]);

  const refreshCalendars = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await api.fetchCalendars();
      if (data.calendars) {
        const normalized: Calendar[] = data.calendars.map((raw) => ({
          ...raw, events: (raw.events || []).map((e) => ({
            ...e,
            start: new Date(e.start),
            end: new Date(e.end),
            seriesStart: e.seriesStart ? new Date(e.seriesStart) : undefined,
            seriesEnd: e.seriesEnd ? new Date(e.seriesEnd) : undefined,
          })),
        }));
        setCalendarError('');
        setCalendars(normalized);
        setSourceEvents(normalized.flatMap((c) => c.events));
      }
    } catch (e: unknown) { setCalendarError(errorMessage(e, 'Failed to load calendars')); console.error('Failed to fetch calendars', e); }
    setIsRefreshing(false);
  }, []);

  const retryCalendar = useCallback(async () => {
    await Promise.all([refreshCalendarSettings(), refreshCalendars()]);
  }, [refreshCalendarSettings, refreshCalendars]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      refreshCalendars().finally(() => setIsLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshCalendars]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const identities = await api.fetchIdentities();
      const mailboxes = [...new Set([
        identities.address,
        ...identities.aliases.map(alias => alias.address),
      ].map(address => address.trim().toLowerCase()).filter(Boolean))];
      const reconciliations = await Promise.all(mailboxes.map(mailbox => (
        invitationSendAttempts.current.reconcileMailbox(
          mailbox,
          api.fetchOutboundMessageStatusByKey,
        )
      )));
      if (!active) return;
      const recovered = reconciliations.flatMap(result => result.recoveries || []);
      setInvitationRecoveryNotices(current => {
        const byRecord = new Map(current.map(item => [item.attempt.recordId, item]));
        recovered.forEach(item => {
          if (calendarInvitationRecovery(item.attempt)) byRecord.set(item.attempt.recordId, item);
        });
        return [...byRecord.values()];
      });
    })().catch(error => {
      console.error('Failed to reconcile Calendar notification delivery', error);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let isActive = true;
    let socket: ReturnType<typeof createSocket> | null = null;
    let refreshTimer: ReturnType<typeof window.setTimeout> | undefined;

    const scheduleRefresh = () => {
      if (!isActive) return;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void refreshCalendars();
      }, 250);
    };

    const connectCalendarUpdates = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok || !isActive) return;
        const data = await res.json();
        const username = data?.user?.username || data?.email;
        if (!username || !isActive) return;

        socket = createSocket({ withCredentials: true });
        socket.emit('join', username);
        socket.on('connect', () => {
          socket?.emit('join', username);
        });
        socket.on('calendar_updated', scheduleRefresh);
      } catch (e) {
        console.error('Failed to start calendar realtime updates', e);
      }
    };

    void connectCalendarUpdates();

    return () => {
      isActive = false;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      socket?.off('calendar_updated', scheduleRefresh);
      socket?.disconnect();
    };
  }, [refreshCalendars]);

  // Persist calendar visibility to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('oms_calendar_visibility', JSON.stringify(calendarVisibility));
    } catch {}
  }, [calendarVisibility]);

  // Event CRUD
  const saveEvent = useCallback(async () => {
    if (!newEvent.title?.trim()) { setEventError('Title is required'); return false; }
    if (!canModifyEditingEvent) {
      setEventError('You only have permission to view this event.');
      return false;
    }
    const targetCalendar = calendars.find(calendar => calendar.id === newEvent.calendarId);
    if (!targetCalendar || !canEditCalendarEvents(targetCalendar)) {
      setEventError('Choose a calendar you can edit.');
      return false;
    }
    setEventSaving(true); setEventError('');
    try {
      const icalData = buildCalendarEventIcal(newEvent, displayTimeZone, editingEvent?.id);
      await api.saveEvent(icalData, newEvent.calendarId);
      setIsEventModalOpen(false);
      setEditingEvent(null);
      const nextStart = projectInstantToWallDate(new Date(), 'utc', displayTimeZone);
      setNewEvent({
        title: '', start: nextStart, end: new Date(nextStart.getTime() + calendarSettings.defaultEventDurationMinutes * 60000),
        isAllDay: false, timeKind: 'zoned', timeZone: displayTimeZone,
        location: '', description: '', calendarId: 0,
        notifications: calendarSettings.defaultReminderMinutes > 0
          ? [{ id: 1, type: 'notification', time: calendarSettings.defaultReminderMinutes }]
          : undefined,
      });
      await refreshCalendars();
      setEventSaving(false);
      return true;
    } catch (e: unknown) { setEventError(errorMessage(e, 'Failed to save')); setEventSaving(false); return false; }
  }, [newEvent, editingEvent, refreshCalendars, displayTimeZone, calendarSettings.defaultEventDurationMinutes, calendarSettings.defaultReminderMinutes, canModifyEditingEvent, calendars]);

  const deleteEvent = useCallback(async (eventId: string, calendarId: number, excludeDate?: string) => {
    setEventError('');
    try {
      await api.deleteEvent(calendarId, eventId, excludeDate);
      await refreshCalendars();
      return true;
    } catch (e: unknown) {
      setEventError(errorMessage(e, 'The event could not be deleted.'));
      return false;
    }
  }, [refreshCalendars]);

  const respondToInvitation = useCallback(async (
    event: CalendarEvent,
    response: 'accepted' | 'tentative' | 'declined',
  ) => {
    const actionKey = `${event.calendarId}:${event.id}:respond`;
    setInvitationActionPending(actionKey);
    setEventError('');
    let preparedAttempt: PreparedOutboundSendAttempt | null = null;
    let deliveryTracked = false;
    try {
      const mailbox = event.invitation?.attendeeEmail;
      if (!mailbox) throw new Error('The attendee identity for this meeting is unavailable.');
      const fingerprint = new FormData();
      fingerprint.set('action', 'respond');
      fingerprint.set('calendarId', String(event.calendarId));
      fingerprint.set('eventId', event.id);
      fingerprint.set('response', response);
      const recovery: CalendarInvitationRecoveryMetadata = {
        kind: 'calendar-invitation',
        version: 1,
        action: 'respond',
      };
      const result = await sendOutboundMessage({
        scope: { mailbox, replyParent: `calendar:${event.calendarId}:${event.id}:respond` },
        formData: fingerprint,
        delivery: { kind: 'immediate' },
        attempts: invitationSendAttempts.current,
        recovery,
        onPrepared: attempt => {
          preparedAttempt = attempt;
          upsertInvitationRecovery({ attempt, state: attempt.blocked ? 'uncertain' : 'prepared' });
        },
        onSubmitted: (result, attempt) => {
          if (result.deliveryStatus === 'pending') upsertInvitationRecovery({ attempt, state: 'pending', result });
        },
        submit: (_payload, requestKey) => api.respondToCalendarInvitation(
          event.calendarId, event.id, response, requestKey,
        ),
        loadStatus: api.fetchOutboundMessageStatus,
      });
      if (preparedAttempt) {
        await trackInvitationDelivery(preparedAttempt, result);
        deliveryTracked = true;
      }
      if (result.deliveryStatus === 'failed') {
        throw new Error('Your response was saved, but the notification was not sent.');
      }
      if (result.deliveryStatus === 'uncertain') {
        throw new Error('Your response was saved, but delivery is uncertain. Do not resend until you verify it.');
      }
      if (result.deliveryStatus === 'partial') {
        throw new Error('Your response was sent to only some recipients.');
      }
      await refreshCalendars();
      return result;
    } catch (error) {
      if (preparedAttempt && !deliveryTracked) {
        if ((error as { definitive?: boolean })?.definitive) removeInvitationRecovery(preparedAttempt);
        else upsertInvitationRecovery({ attempt: preparedAttempt, state: 'unavailable' });
      }
      setEventError(errorMessage(error, 'Your meeting response could not be sent.'));
      throw error;
    } finally {
      setInvitationActionPending(current => current === actionKey ? null : current);
    }
  }, [refreshCalendars, removeInvitationRecovery, trackInvitationDelivery, upsertInvitationRecovery]);

  const cancelInvitation = useCallback(async (
    event: CalendarEvent,
    scope: 'occurrence' | 'series',
  ) => {
    const actionKey = `${event.calendarId}:${event.id}:cancel`;
    setInvitationActionPending(actionKey);
    setEventError('');
    let preparedAttempt: PreparedOutboundSendAttempt | null = null;
    let deliveryTracked = false;
    try {
      const mailbox = event.invitation?.organizerEmail;
      if (!mailbox) throw new Error('The organizer identity for this meeting is unavailable.');
      const occurrenceId = scope === 'occurrence' ? event.occurrenceId : undefined;
      const fingerprint = new FormData();
      fingerprint.set('action', 'cancel');
      fingerprint.set('calendarId', String(event.calendarId));
      fingerprint.set('eventId', event.id);
      fingerprint.set('scope', scope);
      if (occurrenceId) fingerprint.set('occurrenceId', occurrenceId);
      const recovery: CalendarInvitationRecoveryMetadata = {
        kind: 'calendar-invitation',
        version: 1,
        action: 'cancel',
      };
      const result = await sendOutboundMessage({
        scope: { mailbox, replyParent: `calendar:${event.calendarId}:${event.id}:cancel` },
        formData: fingerprint,
        delivery: { kind: 'immediate' },
        attempts: invitationSendAttempts.current,
        recovery,
        onPrepared: attempt => {
          preparedAttempt = attempt;
          upsertInvitationRecovery({ attempt, state: attempt.blocked ? 'uncertain' : 'prepared' });
        },
        onSubmitted: (result, attempt) => {
          if (result.deliveryStatus === 'pending') upsertInvitationRecovery({ attempt, state: 'pending', result });
        },
        submit: (_payload, requestKey) => api.cancelCalendarInvitation(
          event.calendarId, event.id, scope, occurrenceId, requestKey,
        ),
        loadStatus: api.fetchOutboundMessageStatus,
      });
      if (preparedAttempt) {
        await trackInvitationDelivery(preparedAttempt, result);
        deliveryTracked = true;
      }
      if (result.deliveryStatus === 'failed') {
        throw new Error('The meeting was canceled, but attendees were not notified.');
      }
      if (result.deliveryStatus === 'uncertain') {
        throw new Error('The meeting was canceled, but notification delivery is uncertain. Do not resend yet.');
      }
      if (result.deliveryStatus === 'partial') {
        throw new Error('The meeting was canceled, but only some attendees were notified.');
      }
      await refreshCalendars();
      return result;
    } catch (error) {
      if (preparedAttempt && !deliveryTracked) {
        if ((error as { definitive?: boolean })?.definitive) removeInvitationRecovery(preparedAttempt);
        else upsertInvitationRecovery({ attempt: preparedAttempt, state: 'unavailable' });
      }
      setEventError(errorMessage(error, 'The meeting could not be canceled.'));
      throw error;
    } finally {
      setInvitationActionPending(current => current === actionKey ? null : current);
    }
  }, [refreshCalendars, removeInvitationRecovery, trackInvitationDelivery, upsertInvitationRecovery]);

  const proposeInvitationTime = useCallback(async (
    event: CalendarEvent,
    proposal: { start: Date; end: Date; comment?: string },
  ) => {
    const actionKey = `${event.calendarId}:${event.id}:propose`;
    setInvitationActionPending(actionKey);
    setEventError('');
    let preparedAttempt: PreparedOutboundSendAttempt | null = null;
    let deliveryTracked = false;
    try {
      const mailbox = event.invitation?.attendeeEmail;
      if (!mailbox) throw new Error('The attendee identity for this meeting is unavailable.');
      const fingerprint = new FormData();
      fingerprint.set('action', 'propose-time');
      fingerprint.set('calendarId', String(event.calendarId));
      fingerprint.set('eventId', event.id);
      fingerprint.set('start', proposal.start.toISOString());
      fingerprint.set('end', proposal.end.toISOString());
      fingerprint.set('comment', proposal.comment || '');
      const recovery: CalendarInvitationRecoveryMetadata = {
        kind: 'calendar-invitation',
        version: 1,
        action: 'propose-time',
      };
      const result = await sendOutboundMessage({
        scope: { mailbox, replyParent: `calendar:${event.calendarId}:${event.id}:propose-time` },
        formData: fingerprint,
        delivery: { kind: 'immediate' },
        attempts: invitationSendAttempts.current,
        recovery,
        onPrepared: attempt => {
          preparedAttempt = attempt;
          upsertInvitationRecovery({ attempt, state: attempt.blocked ? 'uncertain' : 'prepared' });
        },
        onSubmitted: (result, attempt) => {
          if (result.deliveryStatus === 'pending') upsertInvitationRecovery({ attempt, state: 'pending', result });
        },
        submit: (_payload, requestKey) => api.proposeCalendarInvitationTime(
          event.calendarId, event.id, proposal, requestKey,
        ),
        loadStatus: api.fetchOutboundMessageStatus,
      });
      if (preparedAttempt) {
        await trackInvitationDelivery(preparedAttempt, result);
        deliveryTracked = true;
      }
      if (result.deliveryStatus === 'failed') throw new Error('The new-time proposal was not sent.');
      if (result.deliveryStatus === 'uncertain') {
        throw new Error('Proposal delivery is uncertain. Do not resend until you verify it.');
      }
      if (result.deliveryStatus === 'partial') throw new Error('The proposal was sent to only some recipients.');
      return result;
    } catch (error) {
      if (preparedAttempt && !deliveryTracked) {
        if ((error as { definitive?: boolean })?.definitive) removeInvitationRecovery(preparedAttempt);
        else upsertInvitationRecovery({ attempt: preparedAttempt, state: 'unavailable' });
      }
      setEventError(errorMessage(error, 'The new-time proposal could not be sent.'));
      throw error;
    } finally {
      setInvitationActionPending(current => current === actionKey ? null : current);
    }
  }, [removeInvitationRecovery, trackInvitationDelivery, upsertInvitationRecovery]);

  const checkInvitationDelivery = useCallback(async (notice: OutboundSendRecovery) => {
    try {
      const result = await api.fetchOutboundMessageStatusByKey(notice.attempt.key);
      await trackInvitationDelivery(notice.attempt, result);
    } catch (error) {
      upsertInvitationRecovery({
        ...notice,
        state: 'unavailable',
        result: undefined,
        error: errorMessage(error, 'Delivery status could not be checked.'),
      });
    }
  }, [trackInvitationDelivery, upsertInvitationRecovery]);

  const retryInvitationDelivery = useCallback(async (notice: OutboundSendRecovery) => {
    const recovery = calendarInvitationRecovery(notice.attempt);
    if (!recovery) return;
    const retryOf = notice.state === 'unavailable' && recovery.retryOf
      ? recovery.retryOf
      : notice.attempt.key;
    const verifiedAbsent = notice.state === 'uncertain' || recovery.verifiedAbsent === true;
    const actionKey = `${notice.attempt.recordId}:retry`;
    setInvitationActionPending(actionKey);
    setEventError('');
    let nextAttempt: PreparedOutboundSendAttempt | null = null;
    try {
      const identities = await api.fetchIdentities();
      const mailbox = identities.address.trim().toLowerCase();
      if (!mailbox) throw new Error('Your sending identity is unavailable.');
      const fingerprint = new FormData();
      fingerprint.set('action', 'retry-calendar-invitation');
      fingerprint.set('retryOf', retryOf);
      const nextRecovery: CalendarInvitationRecoveryMetadata = {
        kind: 'calendar-invitation',
        version: 1,
        action: recovery.action,
        retryOf,
        ...(verifiedAbsent ? { verifiedAbsent: true } : {}),
      };
      const result = await sendOutboundMessage({
        scope: {
          mailbox,
          replyParent: `calendar-invitation-retry:${retryOf}`,
        },
        formData: fingerprint,
        delivery: { kind: 'immediate' },
        attempts: invitationSendAttempts.current,
        recovery: nextRecovery,
        onPrepared: async attempt => {
          nextAttempt = attempt;
          upsertInvitationRecovery({ attempt, state: attempt.blocked ? 'uncertain' : 'prepared' });
        },
        onSubmitted: async (result, attempt) => {
          if (result.deliveryStatus === 'pending') upsertInvitationRecovery({ attempt, state: 'pending', result });
          const predecessor = invitationRecoveryNotices.find(item => (
            item.attempt.key === retryOf && item.attempt.key !== attempt.key
          ));
          if (predecessor) {
            await invitationSendAttempts.current.markDefinitive(predecessor.attempt);
            removeInvitationRecovery(predecessor.attempt);
          }
        },
        submit: (_payload, requestKey) => api.retryCalendarInvitationNotification(
          retryOf,
          requestKey,
          verifiedAbsent,
        ),
        loadStatus: api.fetchOutboundMessageStatus,
      });
      if (nextAttempt) await trackInvitationDelivery(nextAttempt, result);
      if (result.deliveryStatus === 'accepted') await refreshCalendars();
    } catch (error) {
      const definitive = Boolean((error as { definitive?: boolean })?.definitive);
      const terminal = (error as { code?: unknown })?.code === 'RETRY_PAYLOAD_UNAVAILABLE';
      if (nextAttempt && definitive) removeInvitationRecovery(nextAttempt);
      else if (nextAttempt) upsertInvitationRecovery({
        attempt: nextAttempt,
        state: 'unavailable',
        error: errorMessage(error, 'The meeting notification could not be retried.'),
      });
      const message = errorMessage(error, 'The meeting notification could not be retried.');
      if (terminal) {
        await invitationSendAttempts.current.markDefinitive(notice.attempt).catch(storageError => {
          console.error('Failed to clear expired Calendar notification recovery', storageError);
        });
        upsertInvitationRecovery({ ...notice, state: 'terminal', result: undefined, error: message });
      } else if (definitive) upsertInvitationRecovery({ ...notice, error: message });
      else if (!nextAttempt) upsertInvitationRecovery({ ...notice, error: message });
      setEventError(message);
    } finally {
      setInvitationActionPending(current => current === actionKey ? null : current);
    }
  }, [invitationRecoveryNotices, refreshCalendars, removeInvitationRecovery, trackInvitationDelivery, upsertInvitationRecovery]);

  const dismissInvitationRecovery = useCallback(async (notice: OutboundSendRecovery) => {
    if (notice.state !== 'failed' && notice.state !== 'partial' && notice.state !== 'terminal') return;
    await invitationSendAttempts.current.markDefinitive(notice.attempt);
    removeInvitationRecovery(notice.attempt);
  }, [removeInvitationRecovery]);

  const createCalendar = useCallback(async (
    calendar: Pick<Calendar, 'name' | 'color'> & { subscribed_url?: string; ics_data?: string },
  ) => {
    const { ics_data, ...draft } = calendar;
    if (ics_data !== undefined && !ics_data.trim()) {
      throw new Error('The selected .ics file is empty.');
    }
    const calendarId = await api.createCalendar(draft);
    let subscription: CalendarSubscriptionRefreshResponse | undefined;
    try {
      if (ics_data !== undefined) await api.importCalendar(calendarId, ics_data);
    } catch (error) {
      try {
        await api.deleteCalendarApi(calendarId);
      } catch {
        const message = errorMessage(error, 'The calendar file could not be imported.');
        throw new Error(`${message} The empty calendar could not be removed automatically.`);
      }
      throw error;
    }
    if (draft.subscribed_url) {
      try {
        subscription = await api.refreshCalendarSubscription(calendarId);
      } catch (error) {
        subscription = {
          success: false,
          status: 'error',
          last_fetch_error: errorMessage(error, 'The first subscription sync could not be checked.'),
        };
      }
    }
    await refreshCalendars();
    return { calendarId, subscription };
  }, [refreshCalendars]);

  const refreshCalendarSubscription = useCallback(async (calendarId: number) => {
    try {
      return await api.refreshCalendarSubscription(calendarId);
    } finally {
      await refreshCalendars();
    }
  }, [refreshCalendars]);

  const updateCalendar = useCallback(async (
    calendarId: number,
    changes: Pick<Calendar, 'name' | 'color'>,
  ) => {
    await api.updateCalendar(calendarId, changes);
    await refreshCalendars();
  }, [refreshCalendars]);

  const removeCalendar = useCallback(async (calendarId: number) => {
    await api.deleteCalendarApi(calendarId);
    setCalendarVisibility(previous => {
      const next = { ...previous };
      delete next[calendarId];
      return next;
    });
    setCalendarVisibilityOverride(previous => (
      previous?.kind === 'only' && previous.calendarId === calendarId ? null : previous
    ));
    await refreshCalendars();
  }, [refreshCalendars]);

  const openNewEvent = useCallback((start?: Date, isAllDay = false) => {
    setEditingEvent(null);
    setEventError('');
    const eventStart = start || projectInstantToWallDate(new Date(), 'utc', displayTimeZone);
    setNewEvent({
      title: '', start: eventStart, end: isAllDay ? addWallDays(eventStart, 1) : new Date(eventStart.getTime() + calendarSettings.defaultEventDurationMinutes * 60000),
      isAllDay, timeKind: isAllDay ? 'all-day' : 'zoned', timeZone: isAllDay ? null : displayTimeZone,
      location: '', description: '', calendarId: writableCalendarForEvent(
        0,
        calendars,
        calendarSettings.defaultCalendarId,
      )?.id || 0,
      notifications: calendarSettings.defaultReminderMinutes > 0
        ? [{ id: 1, type: 'notification', time: calendarSettings.defaultReminderMinutes }]
        : undefined,
    });
    setIsEventModalOpen(true);
  }, [calendars, calendarSettings.defaultCalendarId, calendarSettings.defaultEventDurationMinutes, calendarSettings.defaultReminderMinutes, displayTimeZone]);

  const editExistingEvent = useCallback((event: CalendarEvent) => {
    setEventError('');
    setEditingEvent(event);
    setNewEvent(calendarEventDraftForEdit(event, displayTimeZone));
    setIsEventModalOpen(true);
  }, [displayTimeZone]);

  const duplicateEvent = useCallback((event: CalendarEvent) => {
    const targetCalendar = writableCalendarForEvent(
      event.calendarId,
      calendars,
      calendarSettings.defaultCalendarId,
    );
    if (!targetCalendar) {
      setEventError('No editable calendar is available for this copy.');
      return false;
    }
    setEventError('');
    setEditingEvent(null);
    setNewEvent({ ...duplicateCalendarEventDraft(event, displayTimeZone), calendarId: targetCalendar.id });
    setIsEventModalOpen(true);
    return true;
  }, [calendars, calendarSettings.defaultCalendarId, displayTimeZone]);

  const openSlotContextMenu = useCallback((
    point: ContextMenuPoint,
    start: Date,
    isAllDay = false,
  ) => {
    setCalendarContextMenu({ kind: 'slot', point, start, isAllDay });
  }, []);

  const openEventContextMenu = useCallback((point: ContextMenuPoint, event: CalendarEvent) => {
    setCalendarContextMenu({ kind: 'event', point, event });
  }, []);

  const closeCalendarContextMenu = useCallback(() => setCalendarContextMenu(null), []);

  const isCalendarVisible = useCallback((calendarId: number) => (
    calendarIsVisible(calendarId, calendarVisibility, calendarVisibilityOverride)
  ), [calendarVisibility, calendarVisibilityOverride]);

  const toggleCalendarVisibility = useCallback((calendarId: number) => {
    setCalendarVisibility(previous => {
      const baseline = calendarVisibilityOverride
        ? Object.fromEntries(calendars.map(calendar => [
          calendar.id,
          calendarIsVisible(calendar.id, previous, calendarVisibilityOverride),
        ]))
        : previous;
      return { ...baseline, [calendarId]: baseline[calendarId] === false };
    });
    setCalendarVisibilityOverride(null);
  }, [calendars, calendarVisibilityOverride]);

  const showOnlyCalendar = useCallback((calendarId: number) => {
    setCalendarVisibilityOverride({ kind: 'only', calendarId });
  }, []);

  const hideAllCalendars = useCallback(() => {
    setCalendarVisibility(Object.fromEntries(calendars.map(calendar => [calendar.id, false])));
    setCalendarVisibilityOverride(null);
  }, [calendars]);

  const showAllCalendars = useCallback(() => setCalendarVisibilityOverride({ kind: 'all' }), []);
  const showSelectedCalendars = useCallback(() => setCalendarVisibilityOverride(null), []);
  const showAllCalendarsOverride = calendarVisibilityOverride?.kind === 'all';
  const hasCalendarVisibilityOverride = calendarVisibilityOverride !== null;

  // Free/busy
  const [freeBusyLookup, setFreeBusyLookup] = useState<FreeBusyLookup>(() => createUnavailableFreeBusyLookup([]));
  const [freeBusyLoading, setFreeBusyLoading] = useState(false);
  const freeBusyRequestId = useRef(0);

  const draftWallDateToInstant = useCallback((date: Date) => {
    const timeKind = newEvent.isAllDay ? 'all-day' : (newEvent.timeKind || 'zoned');
    const timeZone = timeKind === 'zoned' ? (newEvent.timeZone || displayTimeZone) : null;
    return wallDateToInstant(date, timeKind, timeZone);
  }, [newEvent.isAllDay, newEvent.timeKind, newEvent.timeZone, displayTimeZone]);

  const lookupFreeBusy = useCallback(async (emails: string[], start: Date, end: Date) => {
    const requestId = ++freeBusyRequestId.current;
    setFreeBusyLookup(createUnavailableFreeBusyLookup(emails));
    if (emails.length === 0) {
      setFreeBusyLoading(false);
      return;
    }
    setFreeBusyLoading(true);
    try {
      const startInstant = draftWallDateToInstant(start);
      const endInstant = draftWallDateToInstant(end);
      const res = await fetch(buildFreeBusyRequestUrl(emails, startInstant, endInstant));
      if (!res.ok) throw new Error(`Free/busy lookup failed (${res.status})`);
      const data = await res.json();
      if (freeBusyRequestId.current === requestId) {
        setFreeBusyLookup(normalizeFreeBusyResponse(emails, data));
      }
    } catch (e) {
      console.error('Free/busy lookup failed', e);
      if (freeBusyRequestId.current === requestId) {
        setFreeBusyLookup(createUnavailableFreeBusyLookup(emails));
      }
    } finally {
      if (freeBusyRequestId.current === requestId) setFreeBusyLoading(false);
    }
  }, [draftWallDateToInstant]);

  return {
    calendars, events, calendarView, setCalendarView,
    currentDate, setCurrentDate,
    calendarSettings, displayTimeZone, displayNow,
    calendarSearchQuery, setCalendarSearchQuery,
    isEventModalOpen, setIsEventModalOpen,
    isAdvancedEventMode, setIsAdvancedEventMode,
    isLoading: isLoading || settingsLoading, isRefreshing, calendarError: settingsError || calendarError,
    refreshCalendars, retryCalendar,
    newEvent, setNewEvent, editingEvent, eventError, eventSaving,
    writableCalendars, canModifyEditingEvent,
    saveEvent, deleteEvent, openNewEvent, editExistingEvent, duplicateEvent,
    invitationActionPending, respondToInvitation, cancelInvitation, proposeInvitationTime,
    invitationRecoveryNotices, checkInvitationDelivery, retryInvitationDelivery, dismissInvitationRecovery,
    createCalendar, updateCalendar, removeCalendar, refreshCalendarSubscription,
    calendarContextMenu, openSlotContextMenu, openEventContextMenu, closeCalendarContextMenu,
    calendarVisibility, setCalendarVisibility,
    showAllCalendarsOverride, hasCalendarVisibilityOverride, isCalendarVisible, toggleCalendarVisibility,
    showOnlyCalendar, hideAllCalendars, showAllCalendars, showSelectedCalendars,
    quickCreateText, setQuickCreateText,
    freeBusy: freeBusyLookup.busy,
    freeBusyUnavailable: freeBusyLookup.unavailable,
    freeBusyLoading, lookupFreeBusy, draftWallDateToInstant,
  };
}
