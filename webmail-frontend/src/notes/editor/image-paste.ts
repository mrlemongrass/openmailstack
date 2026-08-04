export const NOTE_IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;

const NOTE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export function clipboardImageFiles(
  clipboardData: Pick<DataTransfer, 'items' | 'files'>,
): File[] {
  const itemImages = Array.from(clipboardData.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);

  if (itemImages.length > 0) return itemImages;

  return Array.from(clipboardData.files)
    .filter((file) => file.type.startsWith('image/'));
}

export function clipboardHasTextContent(
  clipboardData: Pick<DataTransfer, 'types' | 'getData'>,
): boolean {
  const types = Array.from(clipboardData.types);
  if (types.includes('text/plain') && clipboardData.getData('text/plain').trim().length > 0) {
    return true;
  }
  if (!types.includes('text/html')) return false;

  const htmlWithoutImages = clipboardData.getData('text/html')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ');
  return htmlWithoutImages.trim().length > 0;
}

export function noteImageValidationError(
  file: Pick<File, 'type' | 'size'>,
): string | null {
  if (!NOTE_IMAGE_TYPES.has(file.type)) {
    return 'Paste a PNG, JPEG, GIF, or WebP image.';
  }
  if (file.size > NOTE_IMAGE_LIMIT_BYTES) {
    return 'Pasted images must be 5 MB or smaller.';
  }
  return null;
}

export interface NoteImageInsertionTarget {
  isCurrent(): boolean;
  resolveInsertionIndex(): number | null;
  selectionIndex(): number | null;
  insertImage(index: number, url: string): void;
  setSelection(index: number): void;
}

export interface NoteImageInsertionResult {
  state: 'complete' | 'partial' | 'error' | 'aborted';
  inserted: number;
  total: number;
}

export async function uploadAndInsertNoteImages(
  files: File[],
  upload: (file: File, signal: AbortSignal) => Promise<{ url: string }>,
  target: NoteImageInsertionTarget,
  signal: AbortSignal,
): Promise<NoteImageInsertionResult> {
  const urls: string[] = [];
  let uploadFailed = false;

  for (const file of files) {
    if (signal.aborted || !target.isCurrent()) {
      return { state: 'aborted', inserted: 0, total: files.length };
    }
    try {
      const { url } = await upload(file, signal);
      urls.push(url);
    } catch {
      if (signal.aborted || !target.isCurrent()) {
        return { state: 'aborted', inserted: 0, total: files.length };
      }
      uploadFailed = true;
      break;
    }
  }

  if (signal.aborted || !target.isCurrent()) {
    return { state: 'aborted', inserted: 0, total: files.length };
  }

  const insertionIndex = target.resolveInsertionIndex();
  if (insertionIndex === null) {
    return { state: 'aborted', inserted: 0, total: files.length };
  }

  const shouldAdvanceSelection = target.selectionIndex() === insertionIndex;
  urls.forEach((url, offset) => target.insertImage(insertionIndex + offset, url));
  if (shouldAdvanceSelection && urls.length > 0) {
    target.setSelection(insertionIndex + urls.length);
  }

  return {
    state: uploadFailed ? (urls.length > 0 ? 'partial' : 'error') : 'complete',
    inserted: urls.length,
    total: files.length,
  };
}
