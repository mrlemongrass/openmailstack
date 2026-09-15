import type { MessageAttachment } from '../shared/types';

export type AttachmentPreviewKind = 'pdf' | 'image';
export const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;

export function inlineAttachmentPolicy(attachments: MessageAttachment[]): 'inline' | 'too-large' | 'unknown-size' | 'none' {
  const supported = attachments.filter(attachment => attachmentPreviewKind(attachment));
  if (!supported.length) return 'none';
  if (supported.some(attachment => !Number.isSafeInteger(attachment.size) || attachment.size <= 0)) return 'unknown-size';
  let total = 0;
  for (const attachment of supported) {
    total += attachment.size;
    if (total > MAX_PREVIEW_BYTES) return 'too-large';
  }
  return 'inline';
}

export function attachmentPreviewKind(attachment: MessageAttachment): AttachmentPreviewKind | null {
  const type = attachment.contentType.toLowerCase().split(';')[0].trim();
  if (type === 'application/pdf') return 'pdf';
  if (/^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(type)) return 'image';
  if (!type || type === 'application/octet-stream') {
    if (/\.pdf$/i.test(attachment.filename)) return 'pdf';
    if (/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(attachment.filename)) return 'image';
  }
  return null;
}

function previewContentType(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  if (ascii(4, 8) === 'ftyp' && /^(avif|avis)$/.test(ascii(8, 12))) return 'image/avif';
  return null;
}

export async function loadAttachmentPreview(
  url: string, kind: AttachmentPreviewKind, signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  maxBytes = MAX_PREVIEW_BYTES,
): Promise<Blob> {
  // Inline callers reserve each attachment's declared share of the message
  // budget. Do not let incorrect metadata expand that share while streaming.
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_PREVIEW_BYTES) {
    throw new Error('The attachment size could not be verified. Use Preview or Download.');
  }
  const response = await fetcher(url, { signal, cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('The attachment could not be loaded. Try again or download it.');
  const tooLarge = () => new Error(maxBytes < MAX_PREVIEW_BYTES
    ? 'This attachment is larger than expected. Use Preview or Download.'
    : 'This attachment is too large to preview. Download it to view it.');
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) throw new Error('The attachment is empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  const blob = new Blob(chunks);
  const type = previewContentType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
  if (!type || (kind === 'pdf' ? type !== 'application/pdf' : !type.startsWith('image/'))) {
    throw new Error('This file cannot be previewed. Download it to view it.');
  }
  return new Blob(chunks, { type });
}
