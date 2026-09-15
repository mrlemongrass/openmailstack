import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { AttachmentPreviewKind } from '../attachment-preview';

const PreviewContent = lazy(() => import('./AttachmentPreview').then(module => ({ default: module.PreviewContent })));

export function InlineAttachment({ url, filename, kind, size, onOpen }: {
  url: string; filename: string; kind: AttachmentPreviewKind; size: number; onOpen: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(180);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      const entry = entries[0];
      if (!entry.isIntersecting) setHeight(Math.max(180, container.getBoundingClientRect().height));
      setVisible(entry.isIntersecting);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef} className="inline-attachment" style={{ minHeight: height }}>
    {visible ? <Suspense fallback={<p className="attachment-preview-status" role="status">Loading preview…</p>}>
      <PreviewContent url={url} filename={filename} kind={kind} maxBytes={size} inline onOpen={onOpen} />
    </Suspense> : <p className="attachment-preview-status inline-preview-note">Preview loads when visible</p>}
  </div>;
}
