import { useState, useEffect } from 'react';
import { ChevronUp } from 'lucide-react';

interface ScrollToTopProps {
  scrollRef: React.RefObject<HTMLElement | null>;
}

export function ScrollToTop({ scrollRef }: ScrollToTopProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => setVisible(el.scrollTop > 400);
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, [scrollRef]);

  if (!visible) return null;

  return (
    <button
      onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
      style={{
        position: 'fixed', bottom: 80, right: 16, zIndex: 40,
        width: 40, height: 40, borderRadius: '50%',
        background: 'var(--bg-glass)', backdropFilter: 'blur(8px)',
        border: '1px solid var(--border-glass)',
        color: 'var(--text-secondary)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
      }}
      title="Scroll to top"
    >
      <ChevronUp size={18} />
    </button>
  );
}
