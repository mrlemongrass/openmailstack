import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, version, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;
const assetBase = import.meta.env.DEV ? '/node_modules/pdfjs-dist/' : `${import.meta.env.BASE_URL}pdfjs/${version}/`;

export default function PdfPreview({ blob, inline = false }: { blob: Blob; inline?: boolean }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof getDocument> | undefined;
    void blob.arrayBuffer().then(data => {
      if (cancelled) return;
      task = getDocument({ data: new Uint8Array(data), isEvalSupported: false, enableXfa: false,
        cMapUrl: `${assetBase}cmaps/`, cMapPacked: true,
        standardFontDataUrl: `${assetBase}standard_fonts/`, wasmUrl: `${assetBase}wasm/`,
      });
      return task.promise.then(document => { if (!cancelled) setPdf(document); });
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error && reason.name === 'PasswordException'
        ? 'This PDF needs a password. Download it to open it in your PDF app.'
        : 'This PDF could not be displayed. Download it to view it.');
    });
    return () => { cancelled = true; void task?.destroy(); };
  }, [blob]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(100, entries[0].contentRect.width - 24)));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef} className={inline ? 'pdf-preview pdf-preview-inline' : 'pdf-preview'}>
    {error ? <p role="alert" className="attachment-preview-status">{error}</p> : !pdf ?
      <p role="status" className="attachment-preview-status">Opening PDF…</p> : <>
        {inline ? <p className="inline-preview-note">Page 1 of {pdf.numPages}</p> : <div className="pdf-preview-controls" aria-label="PDF controls">
          <button type="button" className="btn btn-ghost" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button>
          <span role="status">Page {page} of {pdf.numPages}</span>
          <button type="button" className="btn btn-ghost" disabled={page === pdf.numPages} onClick={() => setPage(value => value + 1)}>Next</button>
          <label>Zoom <select value={zoom} onChange={event => setZoom(Number(event.target.value))}>
            <option value={1}>Fit width</option><option value={1.5}>150%</option><option value={2}>200%</option>
          </select></label>
        </div>}
        <PdfPage key={`${page}:${zoom}:${width}`} pdf={pdf} pageNumber={inline ? 1 : page} width={width * zoom} showText={!inline} />
      </>}
  </div>;
}

function PdfPage({ pdf, pageNumber, width, showText }: { pdf: PDFDocumentProxy; pageNumber: number; width: number; showText: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  useEffect(() => {
    let cancelled = false;
    let render: RenderTask | undefined;
    void pdf.getPage(pageNumber).then(async page => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      const cssScale = width / natural.width;
      // Bound bitmap allocation even for oversized pages and high-DPI devices.
      const scale = Math.min(cssScale * Math.min(window.devicePixelRatio || 1, 2),
        Math.sqrt(8_000_000 / (natural.width * natural.height)),
        8192 / natural.width, 8192 / natural.height);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${width * natural.height / natural.width}px`;
      render = page.render({ canvas, viewport });
      await render.promise;
      if (cancelled) return;
      setReady(true);
      if (!showText) return;
      const content = await page.getTextContent();
      if (!cancelled) setText(content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join(''));
    }).catch(() => { if (!cancelled) setError('This page could not be displayed. Download the PDF to view it.'); });
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, pageNumber, width, showText]);
  return <>
    {error ? <p role="alert">{error}</p> : !ready && <p role="status">Rendering page…</p>}
    <div className="pdf-preview-page"><canvas ref={canvasRef} role="img" aria-label={`PDF page ${pageNumber}`} style={{ visibility: ready ? 'visible' : 'hidden' }} /></div>
    {text && <details className="pdf-preview-text"><summary>Page text</summary><p>{text}</p></details>}
  </>;
}
