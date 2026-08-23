import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import {
  clampContextMenuPosition,
  contextMenuOwnsScrollTarget,
  nextEnabledMenuIndex,
  type ContextMenuPoint,
} from '../context-menu-navigation';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  label: string;
  point: ContextMenuPoint;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ label, point, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: point.x, top: point.y });

  useLayoutEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const returnFocus = returnFocusRef.current;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPosition(clampContextMenuPosition(
      point,
      { width: bounds.width, height: bounds.height },
      { width: window.innerWidth, height: window.innerHeight },
    ));
    const firstEnabled = items.findIndex(item => !item.disabled);
    if (firstEnabled >= 0) itemRefs.current[firstEnabled]?.focus();
  }, [items, point]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleViewportChange = () => onClose();
    const handleScroll = (event: Event) => {
      if (!contextMenuOwnsScrollTarget(menuRef.current, event.target)) onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('blur', handleViewportChange);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('blur', handleViewportChange);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  const focusItem = (index: number) => {
    if (index >= 0) itemRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      onClose();
      return;
    }

    const currentIndex = itemRefs.current.findIndex(item => item === document.activeElement);
    const disabled = items.map(item => Boolean(item.disabled));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(nextEnabledMenuIndex(disabled, Math.max(currentIndex, 0), event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(items.findIndex(item => !item.disabled));
    } else if (event.key === 'End') {
      event.preventDefault();
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (!items[index].disabled) {
          focusItem(index);
          break;
        }
      }
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <div key={item.id}>
            {item.separatorBefore && <div className="context-menu-separator" role="separator" />}
            <button
              ref={element => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              className={`context-menu-item${item.danger ? ' context-menu-item--danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              {Icon && <Icon size={16} aria-hidden="true" />}
              <span>{item.label}</span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
