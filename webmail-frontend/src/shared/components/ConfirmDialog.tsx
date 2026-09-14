import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { useModalFocus } from '../hooks/useModalFocus';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  extraAction?: { label: string; onClick: () => void; danger?: boolean };
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  extraAction,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus({ dialogRef, open, onClose: () => { if (!busy) onCancel(); } });

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={(e) => { if (!busy && e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={dialogRef}
        className="glass-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        tabIndex={-1}
        style={{
          maxWidth: 420, width: '100%', padding: 28,
          borderRadius: 'var(--radius-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: danger ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <AlertTriangle size={20} style={{ color: danger ? 'var(--danger)' : 'var(--accent-primary)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 id="confirm-dialog-title" style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: 600 }}>
              {title}
            </h3>
            <p id="confirm-dialog-message" style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {message}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 20 }}>
          <button className="btn btn-ghost" disabled={busy} onClick={onCancel} style={{ fontSize: '0.85rem' }}>
            {cancelLabel}
          </button>
          {extraAction && (
            <button className={extraAction.danger ? 'btn btn-danger' : 'btn btn-ghost'}
              disabled={busy} onClick={extraAction.onClick} style={{ fontSize: '0.85rem' }}>
              {extraAction.label}
            </button>
          )}
          <button
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={busy}
            style={{ fontSize: '0.85rem' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
