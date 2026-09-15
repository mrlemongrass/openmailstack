type Color = [number, number, number, number];

function parseColor(value: string): Color | null {
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (!match) return null;
  const parts = match[1].split(/[,\s/]+/).map(Number);
  return parts.length >= 3 && parts.every(Number.isFinite)
    ? [parts[0], parts[1], parts[2], parts[3] ?? 1] : null;
}

function composite(front: Color, back: Color): Color {
  return [
    front[0] * front[3] + back[0] * (1 - front[3]),
    front[1] * front[3] + back[1] * (1 - front[3]),
    front[2] * front[3] + back[2] * (1 - front[3]), 1,
  ];
}

function luminance(color: Color): number {
  const channels = color.slice(0, 3).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(front: Color, back: Color): number {
  const a = luminance(composite(front, back));
  const b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Repair text against its effective solid background, without recoloring artwork.
 * Call on freshly rendered, sanitized markup; returns false for oversized mail.
 * Image/gradient backgrounds cannot be measured this way; readable colors is
 * the explicit fallback for those messages.
 */
export function correctMessageContrast(root: HTMLElement): boolean {
  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')];
  if (elements.length > 5000) return false;
  const view = root.ownerDocument.defaultView;
  if (!view) return false;
  const backgrounds = new Map<Element, Color>();
  const changes: Array<[HTMLElement, string]> = [];
  const black: Color = [0, 0, 0, 1];
  const white: Color = [255, 255, 255, 1];
  for (const element of elements) {
    const style = view.getComputedStyle(element);
    const parentBackground = backgrounds.get(element.parentElement!) || black;
    const background = composite(parseColor(style.backgroundColor) || [0, 0, 0, 0], parentBackground);
    backgrounds.set(element, background);
    const foreground = parseColor(style.color);
    if (!foreground) continue;
    let color = style.color;
    if (contrast(foreground, background) < 4.5) {
      color = contrast(black, background) >= contrast(white, background) ? '#000000' : '#ffffff';
    }
    // Pin inherited colors too: repairing a parent must not break a readable
    // child on a different background. Batch writes after all computed reads.
    changes.push([element, color]);
  }
  for (const [element, color] of changes) element.style.setProperty('color', color, 'important');
  return true;
}
