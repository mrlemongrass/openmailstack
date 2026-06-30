import { type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: 60, textAlign: 'center',
      color: 'var(--text-secondary)',
    }}>
      <Icon size={48} style={{ marginBottom: 16, opacity: 0.4 }} />
      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 8px', color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {description && <p style={{ margin: '0 0 20px', fontSize: '0.9rem' }}>{description}</p>}
      {action && (
        <button className="btn btn-primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
