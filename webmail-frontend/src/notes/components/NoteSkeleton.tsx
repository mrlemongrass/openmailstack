import { Skeleton } from '../../shared/components/Skeleton';

export function NoteSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, padding: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ height: 4, background: 'var(--border-glass)' }} />
          <div style={{ padding: 16 }}>
            <Skeleton width="60%" height={16} />
            <Skeleton width="90%" height={12} style={{ marginTop: 8 }} />
            <Skeleton width="80%" height={12} style={{ marginTop: 4 }} />
            <Skeleton width="40%" height={12} style={{ marginTop: 4 }} />
          </div>
          <div style={{ padding: '0 16px 12px', display: 'flex', gap: 4 }}>
            <Skeleton width={40} height={16} />
            <Skeleton width={50} height={16} />
          </div>
        </div>
      ))}
    </div>
  );
}
