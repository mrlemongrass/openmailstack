export type ExternalImagesPolicy = 'ask' | 'trusted' | 'always';

export interface FilteredEmailContent {
  html: string;
  blockedRemoteContent: boolean;
}

function decodeCodePoint(value: string, radix: number): string {
  const codePoint = parseInt(value, radix);
  return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : '\ufffd';
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) => decodeCodePoint(hex, 16))
    .replace(/&#([0-9]+);?/g, (_match, decimal: string) => decodeCodePoint(decimal, 10))
    .replace(/&(colon|sol|tab|newline);/gi, (_match, entity: string) => {
      const replacements: Record<string, string> = {
        colon: ':',
        sol: '/',
        tab: '\t',
        newline: '\n',
      };
      return replacements[entity.toLowerCase()];
    });
}

function decodeCssEscapes(value: string): string {
  return value
    .replace(/\\(?:\r\n|[\n\r\f])/g, '')
    .replace(/\\([0-9a-f]{1,6})(?:\s)?/gi, (_match, hex: string) => decodeCodePoint(hex, 16))
    .replace(/\\([^\r\n])/g, '$1');
}

function isRemoteFetchUrl(value: string): boolean {
  const withoutControls = [...decodeHtmlEntities(value).trim()]
    .filter(character => {
      const codePoint = character.codePointAt(0) || 0;
      return codePoint > 32 && codePoint !== 127;
    })
    .join('');
  const normalized = withoutControls.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();

  if (!lower || lower.startsWith('#') || lower.startsWith('?')) return false;
  if (lower.startsWith('data:') || lower.startsWith('cid:') || lower.startsWith('blob:')) return false;
  if (lower.startsWith('//')) return true;
  if (lower.startsWith('/') || lower.startsWith('./') || lower.startsWith('../')) return false;

  return /^[a-z][a-z0-9+.-]*:/i.test(lower);
}

function srcSetContainsRemoteUrl(value: string): boolean {
  return decodeHtmlEntities(value)
    .split(',')
    .some(candidate => isRemoteFetchUrl(candidate.trim().split(/\s+/)[0] || ''));
}

function styleContainsRemoteUrl(value: string): boolean {
  const decoded = decodeCssEscapes(decodeHtmlEntities(value)).replace(/\/\*[\s\S]*?\*\//g, '');
  const urlPattern = /url\s*\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/gi;
  let foundUrlSyntax = false;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(decoded)) !== null) {
    foundUrlSyntax = true;
    if (isRemoteFetchUrl(match[2] ?? match[3] ?? '')) return true;
  }

  // If CSS asks for a URL but cannot be parsed safely, discard the style.
  return !foundUrlSyntax && /url\s*\(/i.test(decoded);
}

function removeMatchingAttribute(
  tag: string,
  attribute: string,
  shouldRemove: (value: string) => boolean,
): { tag: string; removed: boolean } {
  let removed = false;
  const attributePattern = new RegExp(
    `\\s+${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'gi',
  );
  const filteredTag = tag.replace(attributePattern, (full, doubleQuoted: string, singleQuoted: string, unquoted: string) => {
    const value = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
    if (!shouldRemove(value)) return full;
    removed = true;
    return '';
  });
  return { tag: filteredTag, removed };
}

/**
 * Removes network-backed images from already-sanitized email markup while
 * retaining embedded (data/cid/blob) and same-origin/relative content.
 */
export function filterEmailRemoteContent(html: string, allowRemoteContent: boolean): FilteredEmailContent {
  if (allowRemoteContent) return { html, blockedRemoteContent: false };

  let blockedRemoteContent = false;
  let filtered = html.replace(/<img\b[^>]*>/gi, imageTag => {
    const src = removeMatchingAttribute(imageTag, 'src', isRemoteFetchUrl);
    const srcSet = removeMatchingAttribute(src.tag, 'srcset', srcSetContainsRemoteUrl);
    blockedRemoteContent ||= src.removed || srcSet.removed;
    return srcSet.tag;
  });

  filtered = filtered.replace(/<[^>]+>/g, tag => {
    const style = removeMatchingAttribute(tag, 'style', styleContainsRemoteUrl);
    blockedRemoteContent ||= style.removed;
    return style.tag;
  });

  return { html: filtered, blockedRemoteContent };
}

function normalizeExactMailbox(value: string): string | null {
  const trimmed = value.trim();
  const bareMailbox = /^[^\s<>,@]+@[^\s<>,@]+$/;
  if (bareMailbox.test(trimmed)) return trimmed.toLowerCase();

  const namedMailbox = trimmed.match(/^(?:"(?:[^"\\]|\\.)*"|[^<>,]*)<\s*([^\s<>,@]+@[^\s<>,@]+)\s*>$/);
  return namedMailbox ? namedMailbox[1].toLowerCase() : null;
}

export function shouldLoadExternalContent(
  policy: ExternalImagesPolicy,
  sender: string,
  safeSenders: string[],
  explicitlyLoaded: boolean,
): boolean {
  if (explicitlyLoaded || policy === 'always') return true;
  if (policy !== 'trusted') return false;

  const senderMailbox = normalizeExactMailbox(sender);
  if (!senderMailbox) return false;
  return safeSenders.some(entry => normalizeExactMailbox(entry) === senderMailbox);
}
