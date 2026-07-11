import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window !== 'undefined') return window.matchMedia(query).matches;
    return false;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    const timer = window.setTimeout(() => setMatches(mql.matches), 0);
    return () => {
      window.clearTimeout(timer);
      mql.removeEventListener('change', handler);
    };
  }, [query]);

  return matches;
}
