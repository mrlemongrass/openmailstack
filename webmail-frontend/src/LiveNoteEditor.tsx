import React, { useEffect, useRef } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.bubble.css';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { QuillBinding } from 'y-quill';
import DOMPurify from 'dompurify';
import { ChecklistBlot } from './notes/editor/checklist-blot';
import { CodeBlockBlot } from './notes/editor/code-block-blot';
import { uploadNoteImage } from './shared/api';

// Register custom blots
const Quill = ReactQuill.Quill;
Quill.register(ChecklistBlot);
Quill.register(CodeBlockBlot);

// Add custom list type for checklist
const ListConfig = Quill.import('formats/list') as any;
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

export const LiveNoteEditor: React.FC<LiveNoteEditorProps> = ({ noteId, initialContent, onChange }) => {
  const quillRef = useRef<any>(null);
  const initialized = useRef(false);
  const initTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!quillRef.current || initialized.current) return;
    initialized.current = true;

    const editor = quillRef.current.getEditor();

    const ydoc = new Y.Doc();
    const provider = new WebrtcProvider(`oms-note-${noteId}`, ydoc, {
      signaling: ['wss://signaling.yjs.dev', 'wss://y-webrtc-signaling-eu.herokuapp.com']
    });
    const ytext = ydoc.getText('quill');

    const binding = new QuillBinding(ytext, editor, provider.awareness);

    // Short debounce to allow CRDT sync before checking for initial content
    initTimerRef.current = setTimeout(() => {
      if (initialContent && ytext.length === 0) {
        // Sanitize HTML before pasting to prevent stored XSS
        const cleanHtml = DOMPurify.sanitize(initialContent);
        // Use dangerouslyPasteHTML for table support — Quill's native insertText
        // does not handle complex HTML structures like tables.
        editor.clipboard.dangerouslyPasteHTML(cleanHtml);
      }
    }, 200);

    const handleTextChange = () => {
      onChange(editor.root.innerHTML);
    };
    editor.on('text-change', handleTextChange);

    return () => {
      if (initTimerRef.current) clearTimeout(initTimerRef.current);
      editor.off('text-change', handleTextChange);
      binding.destroy();
      provider.destroy();
      ydoc.destroy();
      initialized.current = false;
    };
  }, [noteId]);

  // Image upload handler
  const handleImageUpload = React.useCallback(() => {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const editor = quillRef.current?.getEditor();
        if (!editor) return;
        const range = editor.getSelection(true);
        if (!range) return;
        const { url } = await uploadNoteImage(file);
        editor.insertEmbed(range.index, 'image', url);
        editor.setSelection(range.index + 1);
      } catch (e) {
        console.error('Image upload failed', e);
      }
    };
    input.click();
  }, []);

  // Table insert helper
  const handleInsertTable = React.useCallback(() => {
    const editor = quillRef.current?.getEditor();
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
    const editor = quillRef.current?.getEditor();
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
        'undo': () => quillRef.current?.getEditor()?.history?.undo(),
        'redo': () => quillRef.current?.getEditor()?.history?.redo(),
      },
    },
    keyboard: {
      bindings: {
        handleEnterOnChecklist: {
          key: 'Enter',
          format: { list: 'checklist' },
          handler: (range: any, _context: any) => {
            const editor = quillRef.current?.getEditor();
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
    <ReactQuill
      ref={quillRef}
      theme="bubble"
      placeholder="Start typing your note here..."
      style={{ height: '100%', display: 'flex', flexDirection: 'column', color: 'var(--text-primary)', fontSize: '1.1rem', lineHeight: '1.6' }}
      modules={modules}
    />
  );
};
