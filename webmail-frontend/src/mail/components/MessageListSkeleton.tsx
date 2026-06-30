import { Skeleton } from '../../shared/components/Skeleton';
import { DENSITY_HEIGHTS } from '../MessageRow';

export function MessageListSkeleton({
  count = 10, density = 'cozy',
}: { count?: number; density?: 'compact' | 'cozy' | 'comfortable' }) {
  const padding = density === 'compact' ? '4px 8px' : density === 'cozy' ? '8px 12px' : '12px 16px';
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding, height: DENSITY_HEIGHTS[density],
          borderBottom: '1px solid var(--border-glass)',
        }}>
          <Skeleton variant="rect" width={16} height={16} />
          <Skeleton variant="circle" width={16} height={16} />
          <Skeleton variant="circle" width={28} height={28} />
          <div style={{ flex: 1 }}>
            <Skeleton width="30%" height={13} />
            <Skeleton width="70%" height={13} style={{ marginTop: 4 }} />
            {density !== 'compact' && <Skeleton width="50%" height={11} style={{ marginTop: 4 }} />}
          </div>
          <Skeleton width={36} height={11} />
        </div>
      ))}
    </div>
  );
}
