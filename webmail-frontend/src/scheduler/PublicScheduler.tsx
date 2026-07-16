import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, CalendarCheck, CalendarClock, Check, Clock3, Download, Globe2, MapPin } from 'lucide-react';
import { ErrorBanner } from '../shared/components/ErrorBanner';
import { useBranding } from '../branding-context';
import { applyBookingAction, createPublicBooking, getBookingAction, getPublicEvent, getPublicProfile, getPublicSlots, getPublicPoll, joinPublicWaitlist, requestPublicVerification, requestPublicPollVerification, votePublicPoll, type SchedulerAttendee, type SchedulerEntitlement, type SchedulerEventType, type SchedulerBookingActionPolicy } from './api';
import './scheduler.css';

interface Slot {
  start: string;
  end: string;
  remainingSeats: number;
}
interface ActionBooking {
  event: SchedulerEventType;
  handle: string;
  status: string;
  start: string;
  end: string;
}

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const timeZones = (() => {
  try {
    return (
      (
        Intl as typeof Intl & {
          supportedValuesOf?: (key: 'timeZone') => string[];
        }
      ).supportedValuesOf?.('timeZone') || ['UTC']
    );
  } catch {
    return ['UTC'];
  }
})();
const dateLabel = (value: string, timeZone: string, locale?: string) =>
  new Intl.DateTimeFormat(locale || [], {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
const timeLabel = (value: string, timeZone: string, locale?: string) =>
  new Intl.DateTimeFormat(locale || [], {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
const consumePrivateAccessToken = (handle: string, slug: string) => {
  const storageKey = `oms-scheduler-private:${handle}:${slug}`;
  const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get('access') || '';
  if (fragmentToken) {
    sessionStorage.setItem(storageKey, fragmentToken);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    return fragmentToken;
  }
  return sessionStorage.getItem(storageKey) || '';
};
const calendarDownload = (profile: SchedulerEntitlement, event: SchedulerEventType, slot: Slot) => {
  const compact = (value: string) =>
    new Date(value)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
  const escape = (value: string) =>
    value
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/[,;]/g, (character) => `\\${character}`);
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Scheduler//EN', 'BEGIN:VEVENT', `UID:scheduler-${event.id}-${Date.parse(slot.start)}@openmailstack`, `DTSTAMP:${compact(new Date().toISOString())}`, `DTSTART:${compact(slot.start)}`, `DTEND:${compact(slot.end)}`, `SUMMARY:${escape(event.title)}`, `DESCRIPTION:${escape(`Scheduled with ${profile.displayName || profile.username}`)}`, 'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
};

function PublicHeader() {
  const { branding } = useBranding();
  return (
    <header className="public-scheduler-header">
      <div>
        <CalendarClock size={21} />
        <strong>Scheduler</strong>
      </div>
      <span>{branding.appName}</span>
    </header>
  );
}

function EventDirectory({ profile, events }: { profile: SchedulerEntitlement; events: SchedulerEventType[] }) {
  return (
    <div className="public-scheduler-page">
      <PublicHeader />
      <main className="public-profile">
        <section className="public-profile-intro">
          <div className="public-avatar">{(profile.displayName || profile.handle).slice(0, 1).toUpperCase()}</div>
          <h1>{profile.displayName || profile.handle}</h1>
          {profile.welcomeMessage && <p>{profile.welcomeMessage}</p>}
        </section>
        {events.length === 0 ? (
          <section className="public-empty-schedule">
            <CalendarClock size={30} />
            <h2>No meetings available right now</h2>
            <p>This scheduling page is active, but no booking types are currently published. Please check back soon.</p>
          </section>
        ) : (
          <section className="public-event-directory">
            {events.map((event) => (
              <Link key={event.id} to={`/scheduler/${profile.handle}/${event.slug}`}>
                <div>
                  <h2>{event.title}</h2>
                  <p>{event.description || event.locationLabel}</p>
                  <span>
                    <Clock3 size={14} /> {event.durationMinutes} min
                  </span>
                </div>
                <CalendarClock size={20} />
              </Link>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

function BookingEvent({ profile, event, rootDefault = false, accessToken = '' }: { profile: SchedulerEntitlement; event: SchedulerEventType; rootDefault?: boolean; accessToken?: string }) {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const [timeZone, setTimeZone] = useState(event.lockedTimeZone || browserTimeZone());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [form, setForm] = useState({
    bookerName: query.get('name')?.slice(0, 160) || '',
    bookerEmail: query.get('email')?.slice(0, 255) || '',
    bookerNotes: query.get('notes')?.slice(0, 4000) || '',
  });
  const [communicationPhone, setCommunicationPhone] = useState('');
  const [communicationChannels, setCommunicationChannels] = useState<Array<'sms' | 'whatsapp' | 'voice'>>([]);
  const [seats, setSeats] = useState(1);
  const [attendees, setAttendees] = useState<SchedulerAttendee[]>([]);
  const [recurrenceCount, setRecurrenceCount] = useState(1);
  const [verification, setVerification] = useState({
    challengeId: '',
    code: '',
    sentTo: '',
    sending: false,
    message: '',
  });
  const [bookingAnswers, setBookingAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{
    slot: Slot;
    status: string;
    seats: number;
    attendees: SchedulerAttendee[];
  } | null>(null);
  const bookingAttemptKeyRef = useRef(crypto.randomUUID());
  const loadSlots = useCallback(async () => {
    const start = new Date();
    const end = new Date(start.getTime() + 62 * 24 * 60 * 60 * 1000);
    setLoading(true);
    try {
      const available = await getPublicSlots(profile.handle, event.slug, start, end, accessToken, event.waitlistEnabled);
      setSlots(available);
      setSelected((current) => {
        if (current) return available.find((slot) => slot.start === current.start) || null;
        const requested = query.get('slot');
        return requested ? available.find((slot) => slot.start === requested) || null : null;
      });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load times');
    } finally {
      setLoading(false);
    }
  }, [accessToken, event.slug, event.waitlistEnabled, profile.handle, query]);
  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadSlots();
    }, 0);
    const refreshVisibleSlots = () => {
      if (document.visibilityState === 'visible') void loadSlots();
    };
    window.addEventListener('focus', refreshVisibleSlots);
    document.addEventListener('visibilitychange', refreshVisibleSlots);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener('focus', refreshVisibleSlots);
      document.removeEventListener('visibilitychange', refreshVisibleSlots);
    };
  }, [loadSlots]);
  const grouped = useMemo(() => {
    const groups = new Map<string, Slot[]>();
    slots.forEach((slot) => {
      const key = dateLabel(slot.start, timeZone, event.locale);
      groups.set(key, [...(groups.get(key) || []), slot]);
    });
    return Array.from(groups.entries()).slice(0, 14);
  }, [event.locale, slots, timeZone]);
  const minimumSeats = attendees.length + 1;
  const seatLimit = selected ? (selected.remainingSeats > 0 ? selected.remainingSeats : event.capacity) : 1;
  const attendeeLimit = selected ? Math.min(event.maxAdditionalGuests, Math.max(seatLimit - 1, 0)) : 0;
  const sendVerification = async () => {
    if (!form.bookerEmail.trim()) {
      setError('Enter your email before requesting a verification code');
      return;
    }
    setError('');
    setVerification((current) => ({ ...current, sending: true, message: '' }));
    try {
      const challenge = await requestPublicVerification(profile.handle, event.slug, form.bookerEmail, accessToken);
      setVerification({
        challengeId: challenge.challengeId,
        code: '',
        sentTo: form.bookerEmail.trim().toLowerCase(),
        sending: false,
        message: 'Code sent. It expires in 15 minutes.',
      });
    } catch (err) {
      setVerification((current) => ({ ...current, sending: false }));
      setError(err instanceof Error ? err.message : 'Unable to send verification code');
    }
  };
  const submit = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        eventTypeId: event.id,
        start: selected.start,
        bookerTimeZone: timeZone,
        ...form,
        communicationConsents: {
          phone: communicationPhone,
          channels: communicationChannels,
        },
        seats,
        attendees,
        verificationChallengeId: verification.challengeId,
        verificationCode: verification.code,
        recurrenceCount,
        attribution: Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].flatMap((key) => (query.get(key) ? [[key, query.get(key)]] : []))),
        bookingAnswers: (event.questions || []).map((question) => ({
          questionId: question.id,
          value: bookingAnswers[question.id] || '',
        })),
      };
      if (selected.remainingSeats < seats) {
        await joinPublicWaitlist(profile.handle, event.slug, payload, accessToken, bookingAttemptKeyRef.current);
        setConfirmation({
          slot: selected,
          status: 'waitlisted',
          seats,
          attendees,
        });
        return;
      }
      const booking = await createPublicBooking(profile.handle, event.slug, payload, accessToken, bookingAttemptKeyRef.current);
      setSlots((current) => current.flatMap((slot) => (slot.start !== selected.start ? [slot] : slot.remainingSeats > seats ? [{ ...slot, remainingSeats: slot.remainingSeats - seats }] : [])));
      setConfirmation({
        slot: selected,
        status: booking.status,
        seats,
        attendees,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to book this time');
      await loadSlots();
    } finally {
      setSubmitting(false);
    }
  };
  useEffect(() => {
    if (confirmation && window.parent !== window)
      window.parent.postMessage(
        {
          type: 'oms.scheduler.booking.confirmed',
          status: confirmation.status,
        },
        '*',
      );
  }, [confirmation]);
  if (confirmation) {
    const requested = confirmation.status === 'requested';
    const waitlisted = confirmation.status === 'waitlisted';
    return (
      <div
        className="public-scheduler-page"
        style={
          {
            '--scheduler-accent': event.publicAccentColor,
          } as React.CSSProperties
        }
      >
        {query.get('embed') !== 'inline' && <PublicHeader />}
        <main className="booking-confirmation">
          <div className="confirmation-mark">
            <Check size={28} />
          </div>
          <h1>{waitlisted ? 'You’re on the waitlist' : requested ? 'Request sent' : "You're booked"}</h1>
          <p>
            {event.title} with {profile.displayName || profile.username}
          </p>
          <dl>
            <div>
              <dt>Date</dt>
              <dd>{dateLabel(confirmation.slot.start, timeZone, event.locale)}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>
                {timeLabel(confirmation.slot.start, timeZone, event.locale)} · {event.durationMinutes} min
              </dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>{timeZone}</dd>
            </div>
            {recurrenceCount > 1 && (
              <div>
                <dt>Series</dt>
                <dd>{recurrenceCount} weekly meetings</dd>
              </div>
            )}
            {event.capacity > 1 && (
              <div>
                <dt>Seats</dt>
                <dd>{confirmation.seats}</dd>
              </div>
            )}
            {confirmation.attendees.map((attendee) => (
              <div key={attendee.email}>
                <dt>Guest</dt>
                <dd>
                  {attendee.name || attendee.email}
                  {attendee.name && ` · ${attendee.email}`}
                </dd>
              </div>
            ))}
            {(event.questions || [])
              .filter((question) => bookingAnswers[question.id])
              .map((question) => (
                <div key={question.id}>
                  <dt>{question.label}</dt>
                  <dd>{bookingAnswers[question.id]}</dd>
                </div>
              ))}
          </dl>
          {!requested && !waitlisted && recurrenceCount === 1 && (
            <a className="btn btn-secondary confirmation-download" href={calendarDownload(profile, event, confirmation.slot)} download={`${event.slug || 'booking'}.ics`}>
              <Download size={16} /> Download calendar file
            </a>
          )}
          <p className="confirmation-email">{waitlisted ? `We will automatically promote your party and email ${form.bookerEmail} if enough seats open.` : requested ? `The time is reserved while ${profile.displayName || profile.username} reviews your request. We will email you with the decision.` : `Calendar invitations and management links are on their way to ${form.bookerEmail}.`}</p>
        </main>
      </div>
    );
  }
  return (
    <div className="public-scheduler-page" lang={event.locale} style={{ '--scheduler-accent': event.publicAccentColor } as React.CSSProperties}>
      {query.get('embed') !== 'inline' && <PublicHeader />}
      <main className="public-booking-layout">
        <section className="public-event-summary">
          {!rootDefault && (
            <Link to={`/scheduler/${profile.handle}`}>
              <ArrowLeft size={16} /> {profile.displayName || profile.handle}
            </Link>
          )}
          <h1>{event.title}</h1>
          {event.publicIntro && <p className="public-event-intro">{event.publicIntro}</p>}
          {event.description && <p>{event.description}</p>}
          <ul>
            <li>
              <Clock3 size={16} /> {event.durationMinutes} minutes
            </li>
            {event.locationLabel && (
              <li>
                <MapPin size={16} /> {event.locationLabel}
              </li>
            )}
            <li>
              <Globe2 size={16} /> {timeZone}
            </li>
          </ul>
          {(event.privacyUrl || event.termsUrl) && (
            <footer>
              {event.privacyUrl && (
                <a href={event.privacyUrl} target="_blank" rel="noreferrer">
                  Privacy
                </a>
              )}
              {event.termsUrl && (
                <a href={event.termsUrl} target="_blank" rel="noreferrer">
                  Terms
                </a>
              )}
            </footer>
          )}
        </section>
        <section className="public-slot-picker">
          <div className="public-picker-heading">
            <h2>Select a time</h2>
            <label>
              <Globe2 size={15} />
              <select aria-label="Booking time zone" disabled={Boolean(event.lockedTimeZone)} value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                {!timeZones.includes(timeZone) && <option value={timeZone}>{timeZone}</option>}
                {timeZones.map((zone) => (
                  <option value={zone} key={zone}>
                    {zone.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <ErrorBanner error={error} />}
          {loading ? (
            <p className="public-muted">Loading available times...</p>
          ) : grouped.length === 0 ? (
            <p className="public-muted">No available times in the next 62 days.</p>
          ) : (
            <div className="public-slot-days">
              {grouped.map(([day, daySlots]) => (
                <div key={day}>
                  <h3>{day}</h3>
                  <div>
                    {daySlots.map((slot) => (
                      <button
                        className={`${selected?.start === slot.start ? 'selected' : ''} ${slot.remainingSeats === 0 ? 'full' : ''}`}
                        onClick={() => {
                          if (selected?.start !== slot.start) {
                            bookingAttemptKeyRef.current = crypto.randomUUID();
                            setSeats(1);
                            setAttendees([]);
                          }
                          setSelected(slot);
                        }}
                        key={slot.start}
                      >
                        <span>{timeLabel(slot.start, timeZone, event.locale)}</span>
                        {slot.remainingSeats === 0 ? (
                          <small>Waitlist</small>
                        ) : (
                          event.capacity > 1 && (
                            <small>
                              {slot.remainingSeats} {slot.remainingSeats === 1 ? 'seat' : 'seats'} left
                            </small>
                          )
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        {selected && (
          <form className="public-booking-form" onSubmit={submit}>
            <h2>{selected.remainingSeats === 0 ? 'Join the waitlist' : 'Your details'}</h2>
            <p>
              {dateLabel(selected.start, timeZone, event.locale)} at {timeLabel(selected.start, timeZone, event.locale)}
            </p>
            <label>
              Name
              <input required autoComplete="name" value={form.bookerName} onChange={(e) => setForm({ ...form, bookerName: e.target.value })} />
            </label>
            <label>
              Email
              <input
                required
                type="email"
                autoComplete="email"
                value={form.bookerEmail}
                onChange={(e) => {
                  setForm({ ...form, bookerEmail: e.target.value });
                  setVerification({
                    challengeId: '',
                    code: '',
                    sentTo: '',
                    sending: false,
                    message: '',
                  });
                }}
              />
            </label>
            {Boolean(event.communicationChannels?.length) && (
              <fieldset className="public-communication-consent">
                <legend>Optional booking updates</legend>
                <p>Choose any channels you want this host to use. Standard messaging or call rates may apply.</p>
                <label>
                  International phone number
                  <input type="tel" autoComplete="tel" placeholder="+16025550123" value={communicationPhone} onChange={(changeEvent) => setCommunicationPhone(changeEvent.target.value)} />
                </label>
                <div>
                  {event.communicationChannels?.map((channel) => (
                    <label key={channel}>
                      <input type="checkbox" checked={communicationChannels.includes(channel)} onChange={(changeEvent) => setCommunicationChannels((current) => (changeEvent.target.checked ? [...current, channel] : current.filter((item) => item !== channel)))} />
                      <span>I agree to receive {channel === 'sms' ? 'SMS' : channel === 'whatsapp' ? 'WhatsApp messages' : 'voice calls'} about this booking. I can unsubscribe at any time.</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {event.requireEmailVerification && (
              <div className="public-verification">
                <button type="button" className="btn btn-secondary" disabled={verification.sending || !form.bookerEmail.trim()} onClick={() => void sendVerification()}>
                  {verification.sending ? 'Sending...' : verification.challengeId ? 'Send a new code' : 'Send verification code'}
                </button>
                {verification.challengeId && (
                  <label>
                    Verification code
                    <input
                      required
                      autoComplete="one-time-code"
                      inputMode="text"
                      maxLength={10}
                      value={verification.code}
                      onChange={(e) =>
                        setVerification({
                          ...verification,
                          code: e.target.value,
                        })
                      }
                    />
                  </label>
                )}
                {verification.message && <small>{verification.message}</small>}
              </div>
            )}
            {event.capacity > 1 && (
              <label>
                Seats
                <select value={Math.max(seats, minimumSeats)} onChange={(e) => setSeats(Number(e.target.value))}>
                  {Array.from({ length: seatLimit - minimumSeats + 1 }, (_, index) => index + minimumSeats).map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {event.maxRecurrenceOccurrences > 1 && selected.remainingSeats > 0 && (
              <label>
                Weekly meetings
                <select value={recurrenceCount} onChange={(e) => setRecurrenceCount(Number(e.target.value))}>
                  {Array.from({ length: event.maxRecurrenceOccurrences }, (_, index) => index + 1).map((count) => (
                    <option value={count} key={count}>
                      {count === 1 ? 'One meeting' : `${count} weekly meetings`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {event.maxAdditionalGuests > 0 && (
              <fieldset className="public-attendees">
                <legend>
                  Additional guests <small>Optional · up to {attendeeLimit} for this time</small>
                </legend>
                {attendees.map((attendee, index) => (
                  <div className="public-attendee-row" key={index}>
                    <input aria-label={`Additional guest ${index + 1} name`} placeholder="Name" maxLength={160} value={attendee.name} onChange={(e) => setAttendees((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, name: e.target.value } : item)))} />
                    <input aria-label={`Additional guest ${index + 1} email`} required type="email" placeholder="Email" value={attendee.email} onChange={(e) => setAttendees((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, email: e.target.value } : item)))} />
                    <button type="button" onClick={() => setAttendees((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove additional guest ${index + 1}`}>
                      Remove
                    </button>
                  </div>
                ))}
                {attendees.length < attendeeLimit && (
                  <button
                    type="button"
                    className="public-add-attendee"
                    onClick={() => {
                      const nextCount = attendees.length + 2;
                      setAttendees((current) => [...current, { name: '', email: '' }]);
                      setSeats((current) => Math.max(current, nextCount));
                    }}
                  >
                    Add guest
                  </button>
                )}
              </fieldset>
            )}
            {(event.questions || []).map((question) => (
              <label key={question.id}>
                {question.label}
                {question.required && <span className="public-required">Required</span>}
                {question.type === 'long_text' ? (
                  <textarea
                    required={question.required}
                    maxLength={2000}
                    rows={3}
                    value={bookingAnswers[question.id] || ''}
                    onChange={(e) =>
                      setBookingAnswers({
                        ...bookingAnswers,
                        [question.id]: e.target.value,
                      })
                    }
                  />
                ) : question.type === 'select' ? (
                  <select
                    required={question.required}
                    value={bookingAnswers[question.id] || ''}
                    onChange={(e) =>
                      setBookingAnswers({
                        ...bookingAnswers,
                        [question.id]: e.target.value,
                      })
                    }
                  >
                    <option value="">Choose an option</option>
                    {question.options.map((option) => (
                      <option value={option} key={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required={question.required}
                    maxLength={255}
                    value={bookingAnswers[question.id] || ''}
                    onChange={(e) =>
                      setBookingAnswers({
                        ...bookingAnswers,
                        [question.id]: e.target.value,
                      })
                    }
                  />
                )}
              </label>
            ))}
            <label>
              Notes
              <textarea rows={3} maxLength={4000} value={form.bookerNotes} onChange={(e) => setForm({ ...form, bookerNotes: e.target.value })} />
            </label>
            <button className="btn btn-primary" disabled={submitting || (event.requireEmailVerification && (!verification.challengeId || !verification.code.trim() || verification.sentTo !== form.bookerEmail.trim().toLowerCase()))}>
              {submitting ? 'Saving…' : selected.remainingSeats === 0 ? 'Join waitlist' : event.requiresConfirmation ? 'Request booking' : recurrenceCount > 1 ? 'Book series' : 'Confirm booking'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}

export function PublicSchedulerPage() {
  const { handle = '', slug } = useParams();
  const [data, setData] = useState<{
    profile: SchedulerEntitlement;
    events?: SchedulerEventType[];
    event?: SchedulerEventType;
    defaultEvent?: SchedulerEventType | null;
    accessToken?: string;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const token = slug ? consumePrivateAccessToken(handle, slug) : '';
    const load = slug ? getPublicEvent(handle, slug, token) : getPublicProfile(handle);
    load.then((result) => setData({ ...result, accessToken: token })).catch((err) => setError(err instanceof Error ? err.message : 'This scheduling page is unavailable'));
  }, [handle, slug]);
  if (error)
    return (
      <div className="public-scheduler-page">
        <PublicHeader />
        <main className="public-not-found">
          <CalendarClock size={32} />
          <h1>Scheduling page unavailable</h1>
          <p>The link may be incorrect or no longer published.</p>
        </main>
      </div>
    );
  if (!data)
    return (
      <div className="public-scheduler-page">
        <PublicHeader />
        <main className="public-not-found">Loading...</main>
      </div>
    );
  if (data.event) return <BookingEvent profile={data.profile} event={data.event} accessToken={data.accessToken} />;
  if (data.defaultEvent && (data.events?.length || 0) === 0) return <BookingEvent profile={data.profile} event={data.defaultEvent} rootDefault />;
  return <EventDirectory profile={data.profile} events={data.events || []} />;
}

export function PublicSchedulerPollPage() {
  const { token = '' } = useParams();
  const [poll, setPoll] = useState<Awaited<ReturnType<typeof getPublicPoll>>['poll'] | null>(null);
  const [form, setForm] = useState({
    voterName: '',
    voterEmail: '',
    optionIds: [] as string[],
    verificationChallengeId: '',
    verificationCode: '',
  });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    getPublicPoll(token)
      .then((result) => setPoll(result.poll))
      .catch((err) => setError(err instanceof Error ? err.message : 'Poll unavailable'));
  }, [token]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await votePublicPoll(token, form);
      setStatus('Your availability has been saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save vote');
    }
  };
  return (
    <div className="public-scheduler-page">
      <PublicHeader />
      <main className="public-poll-page">
        {error && <ErrorBanner error={error} />}
        {!poll ? (
          !error && <p>Loading poll…</p>
        ) : (
          <>
            <CalendarCheck size={30} />
            <h1>{poll.title}</h1>
            <p>
              {poll.eventTitle} with {poll.hostName}
            </p>
            {poll.status !== 'open' ? (
              <div className="scheduler-action-closed">
                <strong>This poll is {poll.status}.</strong>
                <span>Voting is no longer available.</span>
              </div>
            ) : (
              <form onSubmit={submit}>
                <label>
                  Name
                  <input required value={form.voterName} onChange={(event) => setForm({ ...form, voterName: event.target.value })} />
                </label>
                <label>
                  Email
                  <input
                    required
                    type="email"
                    value={form.voterEmail}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        voterEmail: event.target.value,
                        verificationChallengeId: '',
                        verificationCode: '',
                      })
                    }
                  />
                </label>
                {poll.requireEmailVerification && (
                  <div className="public-verification">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!form.voterEmail}
                      onClick={async () => {
                        try {
                          const challenge = await requestPublicPollVerification(token, form.voterEmail);
                          setForm({
                            ...form,
                            verificationChallengeId: challenge.challengeId,
                            verificationCode: '',
                          });
                          setStatus('Verification code sent.');
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Unable to send code');
                        }
                      }}
                    >
                      Send verification code
                    </button>
                    {form.verificationChallengeId && (
                      <label>
                        Verification code
                        <input
                          required
                          maxLength={10}
                          autoComplete="one-time-code"
                          value={form.verificationCode}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              verificationCode: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                )}
                <fieldset>
                  <legend>Choose every time that works</legend>
                  {poll.options.map((option) => (
                    <label key={option.id}>
                      <input
                        type="checkbox"
                        checked={form.optionIds.includes(option.id)}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            optionIds: event.target.checked ? [...form.optionIds, option.id] : form.optionIds.filter((id) => id !== option.id),
                          })
                        }
                      />
                      <span>
                        {new Date(option.start).toLocaleString()} · {option.votes} {option.votes === 1 ? 'vote' : 'votes'}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <button className="btn btn-primary">Save availability</button>
                {status && <p>{status}</p>}
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export function SchedulerActionPage() {
  const { scope: rawScope, token = '' } = useParams();
  const scope = rawScope === 'reschedule' ? 'reschedule' : 'cancel';
  const [data, setData] = useState<{
    booking: ActionBooking;
    policy: SchedulerBookingActionPolicy;
  } | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const timeZone = browserTimeZone();
  useEffect(() => {
    getBookingAction(scope, token)
      .then((result) => {
        const booking = result.booking as unknown as ActionBooking;
        setData({ booking, policy: result.policy });
        if (scope === 'reschedule' && result.policy.allowed) {
          const start = new Date();
          const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
          setSlotsLoading(true);
          void getPublicSlots(booking.handle, booking.event.slug, start, end, token)
            .then(setSlots)
            .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load alternative times'))
            .finally(() => setSlotsLoading(false));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'This management link is unavailable'));
  }, [scope, token]);
  const apply = async () => {
    if (data?.policy.reasonRequired && !reason.trim()) {
      setError(`A ${scope === 'cancel' ? 'cancellation' : 'reschedule'} reason is required`);
      return;
    }
    setError('');
    setStatus(scope === 'cancel' ? 'Cancelling...' : 'Rescheduling...');
    try {
      await applyBookingAction(scope, token, selected?.start, reason);
      setStatus(scope === 'cancel' ? 'Booking cancelled' : 'Booking rescheduled');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update booking');
      setStatus('');
    }
  };
  return (
    <div className="public-scheduler-page">
      <PublicHeader />
      <main className="scheduler-action-page">
        {!data ? (
          error ? (
            <ErrorBanner error={error} />
          ) : (
            <p>Loading...</p>
          )
        ) : (
          <>
            <CalendarCheck size={30} />
            <h1>{scope === 'cancel' ? 'Cancel booking' : 'Choose a new time'}</h1>
            <p>{data.booking.event.title}</p>
            {!data.policy.allowed && (
              <div className="scheduler-action-closed">
                <strong>This change window has closed.</strong>
                <span>The host no longer allows guests to {scope} this booking.</span>
              </div>
            )}
            {error && <ErrorBanner error={error} />}
            {scope === 'reschedule' &&
              data.policy.allowed &&
              (slotsLoading ? (
                <p className="public-muted">Loading available times...</p>
              ) : slots.length === 0 ? (
                <p className="public-muted">No alternative times are currently available.</p>
              ) : (
                <div className="action-slots">
                  {slots.slice(0, 24).map((slot) => (
                    <button className={selected?.start === slot.start ? 'selected' : ''} onClick={() => setSelected(slot)} key={slot.start}>
                      {dateLabel(slot.start, timeZone)} · {timeLabel(slot.start, timeZone)}
                    </button>
                  ))}
                </div>
              ))}
            {data.policy.allowed && (
              <label className="scheduler-action-reason">
                Reason {data.policy.reasonRequired ? <span>Required</span> : <small>Optional</small>}
                <textarea
                  maxLength={1000}
                  required={data.policy.reasonRequired}
                  rows={4}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    if (error) setError('');
                  }}
                  placeholder={`Tell the host why you need to ${scope}`}
                />
              </label>
            )}
            {data.policy.allowed && (
              <button className={`btn ${scope === 'cancel' ? 'btn-danger' : 'btn-primary'}`} disabled={Boolean(status) || (scope === 'reschedule' && !selected)} onClick={apply}>
                {status || (scope === 'cancel' ? 'Cancel booking' : 'Confirm new time')}
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
