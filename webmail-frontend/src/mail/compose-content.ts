import DOMPurify from 'dompurify';

export function plainToHtml(text: string): string {
  return text.split('\n').map(line => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') || '<br>'}</p>`).join('');
}

export function safeComposeHtml(html: string): string {
  // Do not load remote images or embedded content while editing a draft.
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'a', 'ol', 'ul', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'sub', 'sup'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'data-list'],
  });
}

export function htmlToPlainText(html: string): string {
  const fragment = document.createElement('template');
  fragment.innerHTML = html;
  fragment.content.querySelectorAll('script, style, template').forEach(node => node.remove());
  fragment.content.querySelectorAll('br').forEach(node => node.replaceWith(document.createTextNode('\n')));
  Array.from(fragment.content.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote'))
    .reverse().forEach(node => {
      if (!node.textContent?.endsWith('\n')) node.append(document.createTextNode('\n'));
    });
  return (fragment.content.textContent || '').replace(/\u00a0/g, ' ').trim();
}

export function mentionsAttachment(subject: string, body: string): boolean {
  // Ignore quoted replies and the conventional signature separator.
  const ownText = body.split(/\n(?:>|--\s*$|On .+wrote:|[- ]*Forwarded message)/m)[0];
  return /\b(?:attach(?:ed|ment|ments)|enclosed)\b/i.test(`${subject}\n${ownText}`);
}
