import type { ContextMenuPoint } from '../shared/context-menu-navigation';

export function calendarKeyboardPoint(element: HTMLElement): ContextMenuPoint {
  const bounds = element.getBoundingClientRect();
  return {
    x: bounds.left + Math.min(bounds.width, 40),
    y: bounds.top + Math.min(bounds.height, 32),
  };
}

export function calendarTimeAtPointer(
  day: Date,
  hour: number,
  clientY: number,
  bounds: Pick<DOMRect, 'top' | 'height'>,
): Date {
  const relativeY = bounds.height > 0
    ? Math.min(Math.max(clientY - bounds.top, 0), Math.max(bounds.height - 1, 0))
    : 0;
  const quarter = bounds.height > 0 ? Math.floor(relativeY / bounds.height * 4) : 0;
  const start = new Date(day);
  start.setHours(hour, Math.min(quarter, 3) * 15, 0, 0);
  return start;
}

export function monthGridTargetIndex(
  key: string,
  index: number,
  itemCount: number,
): number | null {
  let target = index;
  if (key === 'ArrowLeft') target -= 1;
  else if (key === 'ArrowRight') target += 1;
  else if (key === 'ArrowUp') target -= 7;
  else if (key === 'ArrowDown') target += 7;
  else if (key === 'Home') target -= index % 7;
  else if (key === 'End') target += 6 - (index % 7);
  else return null;
  return Math.max(0, Math.min(itemCount - 1, target));
}

export function weekGridTargetIndex(
  key: string,
  index: number,
  dayCount = 7,
  hourCount = 24,
): number | null {
  let day = Math.floor(index / hourCount);
  let hour = index % hourCount;
  if (key === 'ArrowLeft') day -= 1;
  else if (key === 'ArrowRight') day += 1;
  else if (key === 'ArrowUp') hour -= 1;
  else if (key === 'ArrowDown') hour += 1;
  else if (key === 'Home') hour = 0;
  else if (key === 'End') hour = hourCount - 1;
  else return null;
  day = Math.max(0, Math.min(dayCount - 1, day));
  hour = Math.max(0, Math.min(hourCount - 1, hour));
  return day * hourCount + hour;
}

export function dayGridTargetIndex(key: string, hour: number, hourCount = 24): number | null {
  let target = hour;
  if (key === 'ArrowUp') target -= 1;
  else if (key === 'ArrowDown') target += 1;
  else if (key === 'Home') target = 0;
  else if (key === 'End') target = hourCount - 1;
  else return null;
  return Math.max(0, Math.min(hourCount - 1, target));
}
