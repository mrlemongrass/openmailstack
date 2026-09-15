import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { useModalFocus } from '../../shared/hooks/useModalFocus';
import { loadAttachmentPreview, type AttachmentPreviewKind } from '../attachment-preview';

const PdfPreview = lazy(() => import('./PdfPreview'));

export default function AttachmentPreview({ url, filename, kind, onClose }: {
  url: string; filename: string; kind: AttachmentPreviewKind; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [attempt, setAttempt] = useState(0);
  useModalFocus({ dialogRef, open: true, onClose });
  return createPortal(
    <div className="attachment-preview-backdrop" onClick={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        tabIndex={-1} className="attachment-preview-dialog">
        <header className="attachment-preview-toolbar">
          <h2 id={titleId}>{filename}</h2>
          <a className="btn btn-ghost" href={url} download={filename} aria-label={`Download ${filename}`}>
            <Download size={18} /><span>Download</span>
          </a>
          <button type="button" className="btn btn-ghost" aria-label="Close preview" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="attachment-preview-content">
          <PreviewContent key={`${url}:${attempt}`} url={url} filename={filename} kind={kind}
            onRetry={() => setAttempt(value => value + 1)} />
        </div>
      </div>
    </div>, document.body,
  );
}

function PreviewContent({ url, filename, kind, onRetry }: {
  url: string; filename: string; kind: AttachmentPreviewKind; onRetry: () => void;
}) {
  const [file, setFile] = useState<{ blob: Blob; imageUrl: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let imageUrl = '';
    void loadAttachmentPreview(url, kind, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      if (kind === 'image') imageUrl = URL.createObjectURL(blob);
      setFile({ blob, imageUrl });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Preview could not be loaded.');
    });
    return () => {
      controller.abort();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [url, kind]);
  if (error) return <div className="attachment-preview-status" role="alert">
    <p>{error}</p><button type="button" className="btn btn-ghost" onClick={onRetry}>Try again</button>
  </div>;
  if (!file) return <p className="attachment-preview-status" role="status">Loading preview…</p>;
  if (kind === 'pdf') return <Suspense fallback={<p role="status">Opening PDF…</p>}>
    <PdfPreview blob={file.blob} />
  </Suspense>;
  return <img className="attachment-preview-image" src={file.imageUrl} alt={filename}
    onError={() => setError('This picture could not be displayed. Download it to view it.')} />;
}
