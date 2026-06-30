import { AlertCircle } from 'lucide-react';

interface ErrorBannerProps {
  error: string;
  onRetry?: () => void;
}

export function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px', margin: '0 16px 16px',
      borderRadius: 'var(--radius-md)',
      background: 'rgba(239,68,68,0.1)',
      border: '1px solid rgba(239,68,68,0.3)',
      color: 'var(--danger)', fontSize: '0.85rem',
    }}>
      <AlertCircle size={18} />
      <span style={{ flex: 1 }}>{error}</span>
      {onRetry && (
        <button className="btn btn-ghost" onClick={onRetry} style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
          Retry
        </button>
      )}
    </div>
  );
}
