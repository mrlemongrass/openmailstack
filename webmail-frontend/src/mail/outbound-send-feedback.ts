import type { SendMessageResponse } from '../shared/types';

export type OutboundSendMode = 'undo' | 'scheduled' | null;

export interface OutboundSendFeedback {
  type: 'success' | 'error' | 'info';
  message: string;
  duration?: number;
  actionLabel?: 'Undo' | 'Cancel';
}

function safeRejectedAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = Array.from(value, character => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint < 32 || codePoint === 127 ? ' ' : character;
  }).join('').trim();
  const angleAddress = /<([^<>]+)>/.exec(text);
  const address = (angleAddress?.[1] || text).trim();
  if (!/^[^\s<>"'`]+@[^\s<>"'`]+$/.test(address)) return null;
  return address.slice(0, 254);
}

function rejectedRecipientMessage(values: string[] | undefined): string {
  const addresses = Array.from(new Set(
    (values || []).map(safeRejectedAddress).filter((value): value is string => Boolean(value)),
  ));
  if (addresses.length === 0) return 'at least one recipient was rejected';
  const visible = addresses.slice(0, 3);
  const remainder = addresses.length - visible.length;
  return `not accepted by ${visible.join(', ')}${remainder > 0 ? `, and ${remainder} more` : ''}`;
}

export function scheduledDateFromLocalInputs(dateValue: string, timeValue: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;

  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const result = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    result.getFullYear() !== year
    || result.getMonth() !== month - 1
    || result.getDate() !== day
    || result.getHours() !== hour
    || result.getMinutes() !== minute
  ) return null;
  return result;
}

export function outboundSendFeedback(
  result: Pick<SendMessageResponse,
    'scheduledId' | 'draftCleanupStatus' | 'deliveryStatus' | 'rejectedRecipients' | 'sentCopyStatus' | 'error'>,
  mode: OutboundSendMode,
  delaySeconds: number,
): OutboundSendFeedback {
  if (result.scheduledId && mode === 'undo') {
    return {
      type: result.draftCleanupStatus === 'failed' ? 'error' : 'success',
      message: result.draftCleanupStatus === 'failed'
        ? 'Message queued, but its old Draft could not be removed'
        : `Message will be sent in ${delaySeconds}s`,
      duration: Math.max(5000, (delaySeconds + 1) * 1000),
      actionLabel: 'Undo',
    };
  }
  if (result.scheduledId && mode === 'scheduled') {
    return {
      type: result.draftCleanupStatus === 'failed' ? 'error' : 'success',
      message: result.draftCleanupStatus === 'failed'
        ? 'Message scheduled, but its old Draft could not be removed'
        : 'Message scheduled',
      duration: 6000,
      actionLabel: 'Cancel',
    };
  }
  if (result.deliveryStatus === 'partial') {
    const sentCopyNote = result.sentCopyStatus === 'pending'
      ? '; saving your Sent copy'
      : result.sentCopyStatus === 'unavailable' ? '; no Sent copy could be saved' : '';
    return {
      type: 'error',
      message: `Message sent to some recipients; ${rejectedRecipientMessage(result.rejectedRecipients)}${sentCopyNote}`,
    };
  }
  if (result.deliveryStatus === 'uncertain') {
    return {
      type: 'error',
      message: 'Delivery status is uncertain. Do not resend until you verify whether the recipient received it.',
    };
  }
  if (result.deliveryStatus === 'failed') {
    return { type: 'error', message: result.error || 'Message was not sent' };
  }
  if (result.deliveryStatus === 'pending') {
    return { type: 'info', message: 'Confirming message delivery' };
  }
  if (result.deliveryStatus === 'accepted' && result.sentCopyStatus === 'pending') {
    return { type: 'info', message: 'Message sent; saving your Sent copy' };
  }
  if (result.deliveryStatus === 'accepted' && result.sentCopyStatus === 'unavailable') {
    return { type: 'error', message: 'Message sent, but no Sent copy could be saved' };
  }
  return { type: 'success', message: 'Message sent' };
}
