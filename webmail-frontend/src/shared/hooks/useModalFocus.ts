import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const focusableElements = (dialog: HTMLElement) => Array.from(
  dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
).filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'));

const isolateDialog = (dialog: HTMLElement) => {
  const isolated: Array<{
    sibling: HTMLElement;
    inert: boolean;
    ariaHidden: string | null;
  }> = [];
  let branch: HTMLElement | null = dialog;

  while (branch?.parentElement) {
    const parent: HTMLElement = branch.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
      isolated.push({
        sibling,
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute('aria-hidden'),
      });
      sibling.inert = true;
      sibling.setAttribute('aria-hidden', 'true');
    }
    branch = parent;
    if (parent === document.body) break;
  }

  return () => {
    isolated.reverse().forEach(({ sibling, inert, ariaHidden }) => {
      sibling.inert = inert;
      if (ariaHidden === null) sibling.removeAttribute('aria-hidden');
      else sibling.setAttribute('aria-hidden', ariaHidden);
    });
  };
};

export function useModalFocus<T extends HTMLElement>({
  dialogRef,
  open,
  onClose,
}: {
  dialogRef: RefObject<T | null>;
  open: boolean;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  onCloseRef.current = onClose;
  if (open && !wasOpenRef.current) {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const activeElement = document.activeElement;
    if (!returnFocusRef.current && activeElement instanceof HTMLElement && !dialog.contains(activeElement)) {
      returnFocusRef.current = activeElement;
    }

    const initialFocusable = focusableElements(dialog);
    if (!dialog.contains(document.activeElement)) {
      (initialFocusable[0] || dialog).focus();
    }
    const restoreIsolation = isolateDialog(dialog);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      restoreIsolation();
      const returnFocus = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [dialogRef, open]);
}
