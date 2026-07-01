import { useEffect, useState, useCallback } from 'react';

interface UndoBarProps {
  mailUndo: { message: string } | null;
  onUndo: () => void;
  onDismiss: () => void;
}

export function UndoBar({ mailUndo, onUndo, onDismiss }: UndoBarProps) {
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  // Show bar when mailUndo is set
  useEffect(() => {
    if (mailUndo) {
      setVisible(true);
      setDismissing(false);
    } else {
      setVisible(false);
    }
  }, [mailUndo]);

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    if (!mailUndo) return;
    const timer = setTimeout(() => {
      setDismissing(true);
      setTimeout(() => {
        onDismiss();
        setVisible(false);
      }, 300);
    }, 5000);
    return () => clearTimeout(timer);
  }, [mailUndo, onDismiss]);

  const handleUndo = useCallback(() => {
    setDismissing(true);
    setTimeout(() => {
      onUndo();
      setVisible(false);
    }, 300);
  }, [onUndo]);

  const handleClose = useCallback(() => {
    setDismissing(true);
    setTimeout(() => {
      onDismiss();
      setVisible(false);
    }, 300);
  }, [onDismiss]);

  if (!visible || !mailUndo) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        padding: '0 16px 16px',
        opacity: dismissing ? 0 : 1,
        transition: 'opacity 0.3s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: '#2a2a2a',
          color: '#e0e0e0',
          padding: '12px 20px',
          borderRadius: 10,
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          fontSize: 14,
          pointerEvents: 'auto',
          maxWidth: 500,
        }}
      >
        <span style={{ flex: 1 }}>{mailUndo.message}</span>

        <button
          onClick={handleUndo}
          style={{
            background: 'transparent',
            border: '1px solid #5b9aff',
            color: '#5b9aff',
            padding: '6px 16px',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Undo
        </button>

        <button
          onClick={handleClose}
          aria-label="Dismiss"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            padding: '0 4px',
          }}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
