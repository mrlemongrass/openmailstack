import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

export interface ToastData {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
  duration: number;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

interface ToastContextValue {
  showToast: (opts: {
    type: ToastData['type'];
    message: string;
    duration?: number;
    actionLabel?: string;
    onAction?: () => void | Promise<void>;
  }) => void;
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
  const [pendingActions, setPendingActions] = useState<Set<number>>(new Set());
  const toastTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: number) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) clearTimeout(timer);
    toastTimersRef.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
    setPendingActions((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => () => {
    toastTimersRef.current.forEach((timer) => clearTimeout(timer));
    toastTimersRef.current.clear();
  }, []);

  const showToast = useCallback(({ type, message, duration = 3500, actionLabel, onAction }: {
    type: ToastData['type']; message: string; duration?: number;
    actionLabel?: string; onAction?: () => void | Promise<void>;
  }) => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, type, message, duration, actionLabel, onAction }]);
    toastTimersRef.current.set(id, setTimeout(() => removeToast(id), duration));
  }, [removeToast]);

  const runToastAction = useCallback(async (toast: ToastData) => {
    if (!toast.onAction) return;
    const timer = toastTimersRef.current.get(toast.id);
    if (timer) clearTimeout(timer);
    toastTimersRef.current.delete(toast.id);
    setPendingActions((prev) => new Set(prev).add(toast.id));
    try {
      await toast.onAction();
      removeToast(toast.id);
    } catch {
      toastTimersRef.current.set(
        toast.id,
        setTimeout(() => removeToast(toast.id), toast.duration),
      );
      setPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(toast.id);
        return next;
      });
    }
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
          const actionPending = pendingActions.has(toast.id);
          return (
            <div
              key={toast.id}
              className="glass-panel"
              role={toast.type === 'error' ? 'alert' : 'status'}
              aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
              aria-atomic="true"
              aria-busy={actionPending}
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
              {toast.actionLabel && toast.onAction && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={actionPending}
                  style={{ padding: '3px 7px', flexShrink: 0, color }}
                  onClick={() => { void runToastAction(toast); }}
                >
                  {actionPending ? 'Working...' : toast.actionLabel}
                </button>
              )}
              <button
                type="button"
                aria-label="Dismiss notification"
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
