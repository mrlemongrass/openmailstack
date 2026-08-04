import React, { useEffect, useRef } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.bubble.css';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { QuillBinding } from 'y-quill';
import DOMPurify from 'dompurify';
import { ChecklistBlot } from './notes/editor/checklist-blot';
import { CodeBlockBlot } from './notes/editor/code-block-blot';
import {
  clipboardHasTextContent,
  clipboardImageFiles,
  noteImageValidationError,
  uploadAndInsertNoteImages,
} from './notes/editor/image-paste';
import { uploadNoteImage } from './shared/api';

interface QuillRange {
  index: number;
  length: number;
}

interface QuillLine {
  domNode: HTMLElement;
}

interface QuillEditor {
  root: HTMLElement;
  clipboard: {
    dangerouslyPasteHTML(html: string): void;
    dangerouslyPasteHTML(index: number, html: string): void;
  };
  history?: {
    undo(): void;
    redo(): void;
  };
  getSelection(focus?: boolean): QuillRange | null;
  insertEmbed(index: number, type: string, value: string): void;
  setSelection(index: number): void;
  formatText(index: number, length: number, name: string, value: unknown): void;
  format(name: string, value: unknown): void;
  getLine(index: number): [QuillLine];
  on(eventName: 'text-change', handler: () => void): void;
  off(eventName: 'text-change', handler: () => void): void;
}

interface QuillListConfig {
  DEFAULTS?: Record<string, unknown>;
}

function getQuillEditor(ref: React.RefObject<ReactQuill | null>): QuillEditor | null {
  return (ref.current?.getEditor() as unknown as QuillEditor | undefined) ?? null;
}

// Register custom blots
const Quill = ReactQuill.Quill as unknown as {
  register(blot: unknown): void;
  import(path: string): unknown;
};
Quill.register(ChecklistBlot);
Quill.register(CodeBlockBlot);

// Add custom list type for checklist
const ListConfig = Quill.import('formats/list') as QuillListConfig | null;
if (ListConfig) {
  ListConfig.DEFAULTS = {
    ...ListConfig.DEFAULTS,
    checklist: {
      depth: 0,
      type: 'checklist',
    },
  };
}

interface LiveNoteEditorProps {
  noteId: string;
  initialContent: string;
  onChange: (content: string) => void;
}

interface ImageStatus {
  kind: 'uploading' | 'success' | 'error';
  message: string;
}

export const LiveNoteEditor: React.FC<LiveNoteEditorProps> = ({ noteId, initialContent, onChange }) => {
  const quillRef = useRef<ReactQuill | null>(null);
  const initialized = useRef(false);
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const ytextRef = useRef<Y.Text | null>(null);
  const editorGenerationRef = useRef(0);
  const imageUploadControllersRef = useRef(new Set<AbortController>());
  const initialContentRef = useRef(initialContent);
  const onChangeRef = useRef(onChange);
  const [imageStatus, setImageStatus] = React.useState<ImageStatus | null>(null);

  const reportImageStatus = React.useCallback((status: ImageStatus) => {
    if (imageStatusTimerRef.current) clearTimeout(imageStatusTimerRef.current);
    setImageStatus(status);
    if (status.kind === 'success') {
      imageStatusTimerRef.current = setTimeout(() => setImageStatus(null), 2500);
    }
  }, []);

  const insertNoteImages = React.useCallback(async (
    files: File[],
    startIndex: number,
    action: 'paste' | 'upload',
  ) => {
    const validationError = files
      .map(noteImageValidationError)
      .find((error): error is string => error !== null);
    if (validationError) {
      reportImageStatus({ kind: 'error', message: validationError });
      return;
    }

    const ydoc = ydocRef.current;
    const ytext = ytextRef.current;
    if (!ydoc || !ytext) return;

    reportImageStatus({
      kind: 'uploading',
      message: action === 'paste'
        ? `Pasting ${files.length === 1 ? 'image' : `${files.length} images`}…`
        : 'Uploading image…',
    });

    const anchor = Y.createRelativePositionFromTypeIndex(ytext, startIndex);
    const generation = editorGenerationRef.current;
    const controller = new AbortController();
    imageUploadControllersRef.current.add(controller);

    try {
      const isCurrent = () => (
        !controller.signal.aborted
        && generation === editorGenerationRef.current
        && ydoc === ydocRef.current
        && ytext === ytextRef.current
        && getQuillEditor(quillRef) !== null
      );
      const result = await uploadAndInsertNoteImages(
        files,
        uploadNoteImage,
        {
          isCurrent,
          resolveInsertionIndex: () => {
            if (!isCurrent()) return null;
            const position = Y.createAbsolutePositionFromRelativePosition(anchor, ydoc);
            return position?.type === ytext ? position.index : null;
          },
          selectionIndex: () => getQuillEditor(quillRef)?.getSelection(false)?.index ?? null,
          insertImage: (index, url) => getQuillEditor(quillRef)?.insertEmbed(index, 'image', url),
          setSelection: (index) => getQuillEditor(quillRef)?.setSelection(index),
        },
        controller.signal,
      );

      if (!isCurrent() || result.state === 'aborted') return;
      if (result.state === 'complete') {
        reportImageStatus({
          kind: 'success',
          message: action === 'paste'
            ? `${files.length === 1 ? 'Image' : `${files.length} images`} pasted.`
            : 'Image added.',
        });
      } else {
        reportImageStatus({
          kind: 'error',
          message: result.state === 'partial'
            ? `${result.inserted} of ${result.total} images pasted. The next image could not be uploaded.`
            : 'Image could not be uploaded. Try again.',
        });
      }
    } finally {
      imageUploadControllersRef.current.delete(controller);
    }
  }, [reportImageStatus]);

  useEffect(() => () => {
      editorGenerationRef.current += 1;
      for (const controller of imageUploadControllersRef.current) {
        controller.abort();
      }
      imageUploadControllersRef.current.clear();
      if (imageStatusTimerRef.current) {
        clearTimeout(imageStatusTimerRef.current);
        imageStatusTimerRef.current = null;
      }
  }, []);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!quillRef.current || initialized.current) return;
    initialized.current = true;

    const editor = getQuillEditor(quillRef);
    if (!editor) return;

    const ydoc = new Y.Doc();
    const signalingUrls = String(import.meta.env.VITE_OMS_NOTES_SIGNALING_URLS || '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
    const provider = signalingUrls.length > 0
      ? new WebrtcProvider(`oms-note-${noteId}`, ydoc, { signaling: signalingUrls })
      : null;
    const ytext = ydoc.getText('quill');
    ydocRef.current = ydoc;
    ytextRef.current = ytext;
    editorGenerationRef.current += 1;

    const binding = new QuillBinding(ytext, editor, provider?.awareness);

    // Short debounce to allow CRDT sync before checking for initial content
    initTimerRef.current = setTimeout(() => {
      if (initialContentRef.current && ytext.length === 0) {
        // Sanitize HTML before pasting to prevent stored XSS
        const cleanHtml = DOMPurify.sanitize(initialContentRef.current);
        // Use dangerouslyPasteHTML for table support — Quill's native insertText
        // does not handle complex HTML structures like tables.
        editor.clipboard.dangerouslyPasteHTML(cleanHtml);
      }
    }, 200);

    const handleTextChange = () => {
      onChangeRef.current(editor.root.innerHTML);
    };
    editor.on('text-change', handleTextChange);

    return () => {
      if (initTimerRef.current) clearTimeout(initTimerRef.current);
      editor.off('text-change', handleTextChange);
      binding.destroy();
      provider?.destroy();
      ydocRef.current = null;
      ytextRef.current = null;
      ydoc.destroy();
      editorGenerationRef.current += 1;
      initialized.current = false;
    };
  }, [noteId]);

  useEffect(() => {
    const editor = getQuillEditor(quillRef);
    if (!editor) return;

    const handlePaste = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      const files = clipboardImageFiles(event.clipboardData);
      if (files.length === 0 || clipboardHasTextContent(event.clipboardData)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const range = editor.getSelection(true);
      if (!range) return;
      void insertNoteImages(files, range.index, 'paste');
    };

    editor.root.addEventListener('paste', handlePaste, true);
    return () => editor.root.removeEventListener('paste', handlePaste, true);
  }, [insertNoteImages]);

  // Image upload handler
  const handleImageUpload = React.useCallback(() => {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const editor = getQuillEditor(quillRef);
      if (!editor) return;
      const range = editor.getSelection(true);
      if (!range) return;
      await insertNoteImages([file], range.index, 'upload');
    };
    input.click();
  }, [insertNoteImages]);

  // Table insert helper
  const handleInsertTable = React.useCallback(() => {
    const editor = getQuillEditor(quillRef);
    if (!editor) return;
    const range = editor.getSelection(true);
    if (!range) return;
    const rows = 3, cols = 3;
    let tableHtml = '<table style="width:100%;border-collapse:collapse;border:1px solid var(--border-glass);">';
    for (let i = 0; i < rows; i++) {
      tableHtml += '<tr>';
      for (let j = 0; j < cols; j++) {
        tableHtml += '<td style="border:1px solid var(--border-glass);padding:6px 10px;min-width:80px;">&nbsp;</td>';
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</table>';
    editor.clipboard.dangerouslyPasteHTML(range.index, tableHtml);
  }, []);

  // Code block insert
  const handleCodeBlock = React.useCallback(() => {
    const editor = getQuillEditor(quillRef);
    if (!editor) return;
    const range = editor.getSelection(true);
    if (!range) return;
    editor.formatText(range.index, range.length, 'syntax-code-block', 'plaintext');
  }, []);

  const modules = React.useMemo(() => ({
    toolbar: {
      container: [
        ['undo', 'redo'],
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike', 'blockquote'],
        [{ 'list': 'checklist' }, { 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
        ['syntax-code-block', 'link', 'image'],
        ['table', 'clean']
      ],
      handlers: {
        'image': handleImageUpload,
        'table': handleInsertTable,
        'syntax-code-block': handleCodeBlock,
        'undo': () => getQuillEditor(quillRef)?.history?.undo(),
        'redo': () => getQuillEditor(quillRef)?.history?.redo(),
      },
    },
    keyboard: {
      bindings: {
        handleEnterOnChecklist: {
          key: 'Enter',
          format: { list: 'checklist' },
          handler: (range: QuillRange, _context: unknown) => {
            const editor = getQuillEditor(quillRef);
            if (!editor) return false;
            const [line] = editor.getLine(range.index);
            const text = line.domNode.textContent?.trim();
            if (!text || text === '✓') {
              editor.format('list', false);
              return false;
            }
            editor.format('list', 'checklist');
            return false;
          },
        },
      },
    },
  }), [handleImageUpload, handleInsertTable, handleCodeBlock]);

  return (
    <div className="live-note-editor">
      <ReactQuill
        ref={quillRef}
        className="live-note-quill"
        theme="bubble"
        placeholder="Start typing your note here..."
        style={{ display: 'flex', flexDirection: 'column', color: 'var(--text-primary)', fontSize: '1.1rem', lineHeight: '1.6' }}
        modules={modules}
      />
      {imageStatus && (
        <div
          className={`note-image-upload-status ${imageStatus.kind}`}
          role={imageStatus.kind === 'error' ? 'alert' : 'status'}
          aria-live={imageStatus.kind === 'error' ? undefined : 'polite'}
        >
          {imageStatus.message}
        </div>
      )}
    </div>
  );
};
