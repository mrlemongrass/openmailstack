import { Loader } from 'lucide-react';

interface SpinnerProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/** A spinning loader icon for inline loading states. Use alongside text or inside buttons. */
export function Spinner({ size = 16, style }: SpinnerProps) {
  return (
    <Loader
      size={size}
      style={{
        animation: 'spin 1s linear infinite',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
