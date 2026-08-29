import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { CalendarClock, X } from 'lucide-react';
import type { CalendarEvent } from '../shared/types';
import { useModalFocus } from '../shared/hooks/useModalFocus';

function parseWallInput(value: string, allDay: boolean): Date {
  if (!allDay) return new Date(value);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0);
}

export function CalendarNewTimeProposalDialog({
  event,
  displayTimeZone,
  pending,
  onClose,
  onSubmit,
}: {
  event: CalendarEvent;
  displayTimeZone: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (proposal: { start: Date; end: Date; comment?: string }) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<Date | null>(event.start);
  const [end, setEnd] = useState<Date | null>(event.end);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  useModalFocus({
    dialogRef,
    open: true,
    onClose: () => { if (!pending) onClose(); },
  });

  const allDay = Boolean(event.isAllDay);
  const inputType = allDay ? 'date' : 'datetime-local';
  const inputFormat = allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm";

  const submit = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      setError('Enter a valid proposed start and end time.');
      return;
    }
    if (end <= start) {
      setError('The proposed end must be after the start.');
      return;
    }
    setError('');
    try {
      await onSubmit({ start, end, ...(comment.trim() ? { comment: comment.trim() } : {}) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The new-time proposal could not be sent.');
    }
  };

  return (
    <div
      className="event-modal-overlay"
      onMouseDown={mouseEvent => {
        if (mouseEvent.target === mouseEvent.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="glass-panel event-dialog calendar-proposal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-proposal-title"
        aria-describedby="calendar-proposal-description"
        aria-busy={pending}
        tabIndex={-1}
      >
        <div className="event-dialog-header">
          <div>
            <div id="calendar-proposal-title" className="calendar-proposal-title">
              <CalendarClock size={18} aria-hidden="true" /> Propose new time
            </div>
            <div id="calendar-proposal-description" className="calendar-proposal-description">
              Suggest a different time for “{event.title || 'Untitled meeting'}”. The organizer can accept or decline it.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="Close new-time proposal"
            disabled={pending}
            onClick={onClose}
            style={{ padding: 4 }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={submit} className="calendar-proposal-form">
          <div className="event-dialog-body">
            <div className="event-time-fields">
              <label className="mail-folder-dialog-field">
                <span>{allDay ? 'Proposed start date' : 'Proposed start'}</span>
                <input
                  className="glass-input"
                  type={inputType}
                  value={start ? format(start, inputFormat) : ''}
                  disabled={pending}
                  required
                  onChange={changeEvent => {
                    setStart(parseWallInput(changeEvent.target.value, allDay));
                    if (error) setError('');
                  }}
                />
              </label>
              <label className="mail-folder-dialog-field">
                <span>{allDay ? 'Proposed end date' : 'Proposed end'}</span>
                <input
                  className="glass-input"
                  type={inputType}
                  value={end ? format(end, inputFormat) : ''}
                  disabled={pending}
                  required
                  onChange={changeEvent => {
                    setEnd(parseWallInput(changeEvent.target.value, allDay));
                    if (error) setError('');
                  }}
                />
              </label>
            </div>
            <label className="mail-folder-dialog-field">
              <span>Note to organizer <small>(optional)</small></span>
              <textarea
                className="glass-input calendar-proposal-note"
                value={comment}
                maxLength={4000}
                disabled={pending}
                placeholder="Add context for your proposed time"
                onChange={changeEvent => {
                  setComment(changeEvent.target.value);
                  if (error) setError('');
                }}
              />
            </label>
            <div className="calendar-read-only-note" role="note">
              Times are shown in {displayTimeZone}.
            </div>
            {error && <div className="mail-folder-dialog-error" role="alert">{error}</div>}
          </div>
          <div className="event-dialog-footer">
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={pending || !start || !end}>
              {pending ? 'Sending…' : 'Send proposal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
