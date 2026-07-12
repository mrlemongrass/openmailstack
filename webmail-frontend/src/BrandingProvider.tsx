import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyBrandingToDocument,
  cacheBranding,
  defaultBranding,
  fetchBranding,
  readCachedBranding,
  type BrandingSettings,
} from './branding';
import { BrandingContext } from './branding-context';

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [initialBranding] = useState<BrandingSettings | null>(() => readCachedBranding());
  const [branding, setBrandingState] = useState<BrandingSettings>(() => initialBranding || defaultBranding);
  const [isBrandingLoading, setIsBrandingLoading] = useState(initialBranding === null);

  const setBranding = useCallback((settings: BrandingSettings) => {
    setBrandingState(settings);
    cacheBranding(settings);
  }, []);

  useEffect(() => {
    applyBrandingToDocument(branding);
  }, [branding]);

  useEffect(() => {
    let cancelled = false;
    let retryTimeout: number | undefined;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    const refreshWhenAvailable = () => {
      void fetchBranding()
        .then(settings => {
          if (!cancelled) setBranding(settings);
        })
        .catch(() => undefined);
    };
    fetchBranding(controller.signal)
      .then(settings => {
        if (!cancelled) setBranding(settings);
      })
      .catch(() => {
        if (!cancelled) retryTimeout = window.setTimeout(refreshWhenAvailable, 5000);
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setIsBrandingLoading(false);
      });
    window.addEventListener('focus', refreshWhenAvailable);
    window.addEventListener('online', refreshWhenAvailable);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      if (retryTimeout) window.clearTimeout(retryTimeout);
      controller.abort();
      window.removeEventListener('focus', refreshWhenAvailable);
      window.removeEventListener('online', refreshWhenAvailable);
    };
  }, [setBranding]);

  const value = useMemo(() => ({
    branding,
    isBrandingLoading,
    setBranding,
  }), [branding, isBrandingLoading, setBranding]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}
