import { useEffect, useMemo, useRef } from 'react';
import ReactQuill, { Quill } from 'react-quill-new';
import { safeComposeHtml } from './compose-content';

const modules = { toolbar: [['bold', 'italic', 'underline', 'strike'], [{ list: 'ordered' }, { list: 'bullet' }], ['blockquote', 'link'], ['clean']] };
const labels: Record<string, string> = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', blockquote: 'Quote', link: 'Insert link', clean: 'Clear formatting' };

export default function RichComposeEditor({ value, onChange, onNormalize, disabled }: {
  value: string; onChange: (value: string) => void; disabled: boolean;
  onNormalize: (html: string, normalizeFragment: (fragment: string) => string) => void;
}) {
  const ref = useRef<ReactQuill>(null);
  const safeValue = useMemo(() => safeComposeHtml(value), [value]);
  useEffect(() => {
    const editor = ref.current?.getEditor();
    if (!editor || editor.getSemanticHTML() === value) return;
    // Quill's editing DOM uses ordered-list nodes even for bullets. Store
    // semantic HTML so recipients do not need the editor's CSS to read lists.
    onNormalize(editor.getSemanticHTML(), fragment => {
      const temporary = new Quill(document.createElement('div'), { modules: { toolbar: false } });
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
  return <ReactQuill ref={ref} className="compose-rich-editor" theme="snow" value={safeValue}
    modules={modules} readOnly={disabled} placeholder="Write your message…"
    onChange={(html, _delta, source) => { if (source === 'user') onChange(ref.current?.getEditor().getSemanticHTML() || html); }} />;
}
