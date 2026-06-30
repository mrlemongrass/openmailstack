import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Paperclip, X, FileText, Image } from 'lucide-react';
import { fetchNoteAttachments, uploadNoteAttachment, deleteNoteAttachment } from '../../shared/api';
import type { NoteAttachment } from '../../shared/types';

interface AttachmentListProps {
  noteId: string | undefined;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function AttachmentList({ noteId }: AttachmentListProps) {
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const uploading = uploadingCount > 0;
  const [isDragOver, setIsDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortedRef = useRef(false);

  useEffect(() => {
    if (!noteId || noteId === 'new') return;
    abortedRef.current = false;
    fetchNoteAttachments(noteId).then((data) => {
      if (!abortedRef.current) setAttachments(data);
    }).catch((e) => { console.error('Failed to fetch attachments', e); });
    return () => { abortedRef.current = true; };
  }, [noteId]);

  const handleUpload = useCallback(async (file: File) => {
    if (!noteId || noteId === 'new') return;
    setUploadingCount((c) => c + 1);
    try {
      const attachment = await uploadNoteAttachment(noteId, file);
      setAttachments((prev) => [...prev, attachment]);
    } catch (e) {
      console.error('Upload failed', e);
    } finally {
      setUploadingCount((c) => c - 1);
    }
  }, [noteId]);

  const handleDelete = useCallback(async (attachmentId: string) => {
    if (!noteId) return;
    try {
      await deleteNoteAttachment(noteId, attachmentId);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch (e) {
      console.error('Delete failed', e);
    }
  }, [noteId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(handleUpload);
  }, [handleUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  // Don't render for new notes
  if (!noteId || noteId === 'new') {
    return null;
  }

  return (
    <div className="attachment-section">
      <div className="attachment-header">
        <Paperclip size={14} />
        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Attachments</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          {attachments.length > 0 && `(${attachments.length})`}
        </span>
        <button
          className="btn btn-ghost btn-xs"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{ marginLeft: 'auto', fontSize: '0.75rem' }}
        >
          {uploading ? 'Uploading...' : '+ Add'}
        </button>
        <input
          ref={fileRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = '';
          }}
        />
      </div>
      <div
        className={`attachment-dropzone ${isDragOver ? 'drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {attachments.length === 0 && !uploading && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)',
            textAlign: 'center', padding: '8px 0' }}>
            Drop files here or click "+ Add"
          </div>
        )}
        {attachments.map((att) => (
          <div key={att.id} className="attachment-item">
            {isImage(att.mime_type) ? (
              <Image size={16} />
            ) : (
              <FileText size={16} />
            )}
            <a
              href={`/uploads/${att.storage_path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="attachment-name"
              style={{ flex: 1, fontSize: '0.8rem', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: 'var(--text-primary)', textDecoration: 'none' }}
              title={att.filename}
            >
              {att.filename}
            </a>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              {formatSize(att.size_bytes)}
            </span>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => handleDelete(att.id)}
              title="Remove attachment"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
