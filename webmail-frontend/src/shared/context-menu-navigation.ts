export interface ContextMenuPoint {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

export function clampContextMenuPosition(
  point: ContextMenuPoint,
  menu: Size,
  viewport: Size,
  padding = 8,
) {
  return {
    left: Math.max(padding, Math.min(point.x, viewport.width - menu.width - padding)),
    top: Math.max(padding, Math.min(point.y, viewport.height - menu.height - padding)),
  };
}

export function nextEnabledMenuIndex(
  disabled: boolean[],
  currentIndex: number,
  direction: 1 | -1,
) {
  if (disabled.length === 0) return -1;
  for (let offset = 1; offset <= disabled.length; offset += 1) {
    const index = (currentIndex + direction * offset + disabled.length) % disabled.length;
    if (!disabled[index]) return index;
  }
  return -1;
}

export function contextMenuOwnsScrollTarget(
  menu: { contains: (target: Node) => boolean } | null,
  target: EventTarget | null,
) {
  return Boolean(menu && target && menu.contains(target as Node));
}
