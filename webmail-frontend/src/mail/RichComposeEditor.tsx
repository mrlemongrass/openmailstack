import { useEffect, useMemo, useRef, useState } from 'react';
import ReactQuill, { Quill } from 'react-quill-new';
import { safeComposeHtml, unsupportedComposeLayout, htmlToPlainText } from './compose-content';

const modules = { table: true, toolbar: [['bold', 'italic', 'underline', 'strike'], [{ list: 'ordered' }, { list: 'bullet' }], ['blockquote', 'link'], ['clean']] };
const labels: Record<string, string> = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', blockquote: 'Quote', link: 'Insert link', clean: 'Clear formatting' };

export default function RichComposeEditor({ value, onChange, onNormalize, disabled, onBusy }: {
  value: string; onChange: (value: string) => void; disabled: boolean; onBusy?: (busy: boolean) => void;
  onNormalize: (html: string, normalizeFragment: (fragment: string) => string) => void;
}) {
  const ref = useRef<ReactQuill>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageLock = useRef(false);
  const [error, setError] = useState('');
  const [pendingPaste, setPendingPaste] = useState('');
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(3);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const imageIndex = useRef(0);
  const [imageAlt, setImageAlt] = useState('');
  const [imageWidth, setImageWidth] = useState('400');
  const serialize = (editor: ReturnType<ReactQuill['getEditor']>) => {
    const template = document.createElement('template'); template.innerHTML = safeComposeHtml(editor.getSemanticHTML());
    template.content.querySelectorAll('table').forEach(table => { table.setAttribute('border', '1'); table.setAttribute('cellpadding', '6'); table.setAttribute('cellspacing', '0'); });
    return template.innerHTML;
  };
  const insertImage = async (file?: File) => {
    if (!file || imageLock.current || disabled) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > 1024 * 1024) { setError('Use a PNG, JPEG, GIF or WebP up to 1 MiB. Attach larger images as files.'); return; }
    if ((value.match(/<img\b/gi)?.length || 0) >= 20 || value.length + file.size * 1.4 > 5.5 * 1024 * 1024) { setError('Inline images are limited to 20 images and 4 MiB total.'); return; }
    const editor = ref.current!.getEditor(); const range = editor.getSelection(true);
    imageLock.current = true; onBusy?.(true); setError('');
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Image could not be read.')); reader.readAsDataURL(file); });
      const index = Math.min(range?.index || 0, editor.getLength() - 1);
      editor.insertEmbed(index, 'image', data, 'api');
      editor.formatText(index, 1, { alt: file.name, width: '400' }, 'api');
      onChange(serialize(editor));
    } catch (err) { setError((err as Error).message); }
    finally { imageLock.current = false; onBusy?.(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const safeValue = useMemo(() => safeComposeHtml(value), [value]);
  useEffect(() => {
    const editor = ref.current?.getEditor();
    if (!editor || serialize(editor) === value) return;
    // Quill's editing DOM uses ordered-list nodes even for bullets. Store
    // semantic HTML so recipients do not need the editor's CSS to read lists.
    onNormalize(serialize(editor), fragment => {
      const temporary = new Quill(document.createElement('div'), { modules: { toolbar: false, table: true } });
      temporary.setContents(editor.clipboard.convert({ html: safeComposeHtml(fragment) }));
      return temporary.getSemanticHTML();
    });
  }, [value, onNormalize]);
  useEffect(() => {
    const editor = ref.current?.getEditor();
    if (!editor) return;
    editor.root.setAttribute('role', 'textbox');
    editor.root.setAttribute('aria-label', 'Message body');
    editor.root.setAttribute('aria-multiline', 'true');
    const toolbar = editor.getModule('toolbar') as { container: HTMLElement };
    toolbar.container.setAttribute('aria-label', 'Message formatting');
    toolbar.container.querySelectorAll('button').forEach(button => {
      const name = button.className.replace('ql-', '');
      button.setAttribute('aria-label', name === 'list' ? (button.value === 'ordered' ? 'Numbered list' : 'Bulleted list') : labels[name] || name);
      button.disabled = disabled;
    });
    editor.container.querySelector('input[data-link]')?.setAttribute('aria-label', 'Link URL');
    const links = editor.container.querySelectorAll<HTMLElement>('.ql-action, .ql-remove');
    const activate = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); (event.currentTarget as HTMLElement).click(); }
    };
    links.forEach(link => {
      link.tabIndex = disabled ? -1 : 0;
      link.setAttribute('role', 'button');
      link.setAttribute('aria-label', link.classList.contains('ql-remove') ? 'Remove link' : 'Apply link');
      link.addEventListener('keydown', activate);
    });
    return () => links.forEach(link => link.removeEventListener('keydown', activate));
  }, [disabled]);
  useEffect(() => {
    const editor = ref.current?.getEditor(); if (!editor) return;
    const imageClick = (event: MouseEvent) => {
      const image = event.target instanceof HTMLImageElement ? event.target : null;
      setSelectedImage(image);
      if (image) { setError(''); const blot = Quill.find(image); if (blot && 'domNode' in blot) imageIndex.current = editor.getIndex(blot); setImageAlt(image.alt); setImageWidth(image.getAttribute('width') || '400'); }
    };
    const paste = (event: ClipboardEvent) => {
      if (disabled) return;
      const file = Array.from(event.clipboardData?.files || []).find(file => file.type.startsWith('image/'));
      if (file) { event.preventDefault(); event.stopImmediatePropagation(); void insertImage(file); return; }
      const html = event.clipboardData?.getData('text/html');
      if (!html) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (unsupportedComposeLayout(html)) { setPendingPaste(htmlToPlainText(html)); return; }
      const range = editor.getSelection(true);
      if (range?.length) editor.deleteText(range.index, range.length, 'user');
      editor.clipboard.dangerouslyPasteHTML(range?.index || 0, safeComposeHtml(html), 'user');
    };
    editor.root.addEventListener('click', imageClick);
    editor.root.addEventListener('paste', paste, true);
    return () => { editor.root.removeEventListener('click', imageClick); editor.root.removeEventListener('paste', paste, true); };
  });
  const tableAction = (action: string) => {
    const editor = ref.current!.getEditor(); editor.focus();
    const table = editor.getModule('table') as Record<string, (...args: number[]) => void>;
    if (action === 'insertTable') table.insertTable(Math.max(1, Math.min(10, rows)), Math.max(1, Math.min(10, columns)));
    else table[action]();
    onChange(serialize(editor));
  };
  return <>
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={e => void insertImage(e.target.files?.[0])} />
      <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>Insert image</button>
      <label>Rows <input className="glass-input" aria-label="Table rows" type="number" min={1} max={10} value={rows} onChange={e => setRows(Number(e.target.value) || 1)} style={{ width: 60 }} /></label>
      <label>Columns <input className="glass-input" aria-label="Table columns" type="number" min={1} max={10} value={columns} onChange={e => setColumns(Number(e.target.value) || 1)} style={{ width: 60 }} /></label>
      <button className="btn btn-ghost" onMouseDown={e => e.preventDefault()} onClick={() => tableAction('insertTable')}>Insert table</button>
      <button className="btn btn-ghost" onMouseDown={e => e.preventDefault()} onClick={() => tableAction('insertRowBelow')}>Add row</button>
      <button className="btn btn-ghost" onMouseDown={e => e.preventDefault()} onClick={() => tableAction('insertColumnRight')}>Add column</button>
      <button className="btn btn-ghost" onMouseDown={e => e.preventDefault()} onClick={() => tableAction('deleteTable')}>Remove table</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {pendingPaste && <div role="status"><p>This paste contains external images or unsupported layout. Insert its text without changing the existing message?</p><button className="btn btn-secondary" disabled={disabled} onClick={() => { const editor = ref.current!.getEditor(); editor.insertText(editor.getSelection(true)?.index || 0, pendingPaste, 'user'); setPendingPaste(''); }}>Insert as text</button><button className="btn btn-ghost" onClick={() => setPendingPaste('')}>Cancel paste</button></div>}
    {selectedImage && <fieldset disabled={disabled} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', border: 0, padding: 0 }}><label>Image description <input className="glass-input" value={imageAlt} onChange={e => setImageAlt(e.target.value)} /></label><label>Width in pixels <input className="glass-input" type="number" min={1} max={1600} value={imageWidth} onChange={e => setImageWidth(e.target.value)} /></label><button className="btn btn-secondary" onClick={() => {
      const editor = ref.current!.getEditor();
      const image = Array.from(editor.root.querySelectorAll('img')).find(candidate => { const blot = Quill.find(candidate); return candidate.src === selectedImage.src && blot && 'domNode' in blot && editor.getIndex(blot) === imageIndex.current; });
      if (!image) { setSelectedImage(null); setError('The image moved. Select it again to change its size.'); return; }
      { editor.formatText(imageIndex.current, 1, { alt: imageAlt, width: String(Math.max(1, Math.min(1600, Number(imageWidth) || 400))) }, 'user'); onChange(serialize(editor)); }
    }}>Apply image size and description</button></fieldset>}
    <ReactQuill ref={ref} className="compose-rich-editor" theme="snow" value={safeValue}
      modules={modules} readOnly={disabled} placeholder="Write your message…"
      onChange={(html, _delta, source) => { if (source === 'user') onChange(ref.current ? serialize(ref.current.getEditor()) : html); }} />
  </>;
}
