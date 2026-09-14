import DOMPurify from 'dompurify';

export function plainToHtml(text: string): string {
  return text.split('\n').map(line => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') || '<br>'}</p>`).join('');
}

const composeTags = ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'a', 'ol', 'ul', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'sub', 'sup', 'img', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th'];
export function safeComposeHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: composeTags, ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'data-list', 'data-row', 'src', 'alt', 'width', 'height', 'border', 'cellpadding', 'cellspacing'] });
  const template = document.createElement('template'); template.innerHTML = clean;
  template.content.querySelectorAll('img').forEach(image => {
    // Never fetch tracking images or SVG while editing. Embedded raster images stay local.
    if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(image.getAttribute('src') || '')) {
      image.replaceWith(document.createTextNode(image.getAttribute('alt') || 'External image omitted')); return;
    }
    for (const key of ['width', 'height']) if (image.hasAttribute(key) && !/^[1-9]\d{0,3}$/.test(image.getAttribute(key)!)) image.removeAttribute(key);
  });
  return template.innerHTML;
}
export function unsupportedComposeLayout(html: string): boolean {
  if (typeof document === 'undefined') return /<(?:table|img|video|audio|iframe|object|svg)\b/i.test(html);
  const template = document.createElement('template'); template.innerHTML = html;
  return /<(?:video|audio|iframe|object|svg)\b/i.test(html) || Boolean(template.content.querySelector('table table, [rowspan], [colspan]')) || Array.from(template.content.querySelectorAll('img')).some(image => !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(image.getAttribute('src') || ''));
}
export function simplifyComposeHtml(html: string): string { return plainToHtml(htmlToPlainText(html)); }

export function htmlToPlainText(html: string): string {
  const fragment = document.createElement('template');
  fragment.innerHTML = html;
  fragment.content.querySelectorAll('script, style, template').forEach(node => node.remove());
  fragment.content.querySelectorAll('br').forEach(node => node.replaceWith(document.createTextNode('\n')));
  fragment.content.querySelectorAll('td, th').forEach(node => node.append(document.createTextNode('\t')));
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
