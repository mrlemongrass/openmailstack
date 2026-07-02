import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

export interface ToastData {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastContextValue {
  showToast: (opts: { type: ToastData['type']; message: string; duration?: number }) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const ICONS = {
  success: { icon: CheckCircle, color: '#10b981' },
  error: { icon: AlertCircle, color: 'var(--danger)' },
  info: { icon: Info, color: 'var(--accent-primary)' },
};

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(({ type, message, duration = 3500 }: {
    type: ToastData['type']; message: string; duration?: number;
  }) => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => removeToast(id), duration);
  }, [removeToast]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast container — fixed at bottom-center */}
      <div style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        zIndex: 3000, display: 'flex', flexDirection: 'column', gap: 8,
        alignItems: 'center', pointerEvents: 'none',
      }}>
        {toasts.map((toast) => {
          const { icon: Icon, color } = ICONS[toast.type];
          return (
            <div
              key={toast.id}
              className="glass-panel"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 16px', borderRadius: 'var(--radius-md)',
                minWidth: 280, maxWidth: 420,
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                border: `1px solid ${color}33`,
                pointerEvents: 'auto',
                animation: 'toastSlideUp 0.25s ease-out',
              }}
            >
              <Icon size={18} style={{ color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                {toast.message}
              </span>
              <button
                onClick={() => removeToast(toast.id)}
                className="btn btn-ghost"
                style={{ padding: 2, flexShrink: 0 }}
              >
                <X size={14} style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
