import { createContext, useContext } from 'react';
import type { BrandingSettings } from './branding';

export interface BrandingContextValue {
  branding: BrandingSettings;
  isBrandingLoading: boolean;
  setBranding: (branding: BrandingSettings) => void;
}

export const BrandingContext = createContext<BrandingContextValue | null>(null);

export function useBranding(): BrandingContextValue {
  const context = useContext(BrandingContext);
  if (!context) throw new Error('useBranding must be used within BrandingProvider');
  return context;
}
