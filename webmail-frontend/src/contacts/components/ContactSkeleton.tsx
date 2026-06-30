import { Skeleton } from '../../shared/components/Skeleton';

export function ContactSkeleton({ count = 20 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, padding: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass-panel" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <Skeleton variant="circle" width={40} height={40} />
            <div style={{ flex: 1 }}>
              <Skeleton width="70%" height={14} />
              <Skeleton width="90%" height={12} style={{ marginTop: 6 }} />
              <Skeleton width="50%" height={12} style={{ marginTop: 4 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
