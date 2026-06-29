import React, { useEffect, useRef } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.bubble.css';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { QuillBinding } from 'y-quill';

interface LiveNoteEditorProps {
  noteId: string;
  initialContent: string;
  onChange: (content: string) => void;
}

export const LiveNoteEditor: React.FC<LiveNoteEditorProps> = ({ noteId, initialContent, onChange }) => {
  const quillRef = useRef<any>(null);
  const initialized = useRef(false);

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
    
    if (initialContent && ytext.length === 0) {
      editor.clipboard.dangerouslyPasteHTML(initialContent);
    }
    
    editor.on('text-change', () => {
      onChange(editor.root.innerHTML);
    });

    return () => {
      binding.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [noteId]);

  return (
    <ReactQuill 
      ref={quillRef}
      theme="bubble"
      placeholder="Start typing your note here..."
      style={{ height: '100%', display: 'flex', flexDirection: 'column', color: 'var(--text-primary)', fontSize: '1.1rem', lineHeight: '1.6' }}
      modules={{
        toolbar: [
          [{ 'header': [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike', 'blockquote'],
          [{'list': 'ordered'}, {'list': 'bullet'}, {'indent': '-1'}, {'indent': '+1'}],
          ['link', 'image'],
          ['clean']
        ]
      }}
    />
  );
};
