interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  variant?: 'text' | 'circle' | 'rect';
  count?: number;
  style?: React.CSSProperties;
}

export function Skeleton({
  width = '100%',
  height = 14,
  variant = 'text',
  count = 1,
  style,
}: SkeletonProps) {
  const baseStyle: React.CSSProperties = {
    width,
    height,
    borderRadius: variant === 'circle' ? '50%' : variant === 'rect' ? 'var(--radius-sm)' : 'var(--radius-sm)',
    ...style,
  };

  if (count === 1) {
    return <div className="skeleton" style={baseStyle} />;
  }

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{
            ...baseStyle,
            marginTop: i > 0 ? 6 : 0,
            width: typeof width === 'number' ? width : (i === count - 1 ? '60%' : width),
          }}
        />
      ))}
    </>
  );
}
