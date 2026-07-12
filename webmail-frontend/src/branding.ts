export interface BrandingSettings {
  appName: string;
  companyName: string;
  loginTitle: string;
  loginSubtitle: string;
  appIconDataUrl: string;
  faviconDataUrl: string;
  loginLogoDataUrl: string;
  loginBackgroundDataUrl: string;
}

export const defaultBranding: BrandingSettings = {
  appName: 'OpenMailStack',
  companyName: '',
  loginTitle: 'OpenMailStack',
  loginSubtitle: 'Sign in to continue',
  appIconDataUrl: '',
  faviconDataUrl: '',
  loginLogoDataUrl: '',
  loginBackgroundDataUrl: '',
};

const brandingCacheKey = 'oms_site_branding';

interface BrandingStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const isBrandingSettings = (value: unknown): value is BrandingSettings => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(defaultBranding).every(key => typeof candidate[key] === 'string');
};

export function readCachedBranding(storage?: BrandingStorage): BrandingSettings | null {
  const target = storage || (typeof localStorage === 'undefined' ? undefined : localStorage);
  if (!target) return null;
  try {
    const parsed: unknown = JSON.parse(target.getItem(brandingCacheKey) || 'null');
    return isBrandingSettings(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function cacheBranding(branding: BrandingSettings, storage?: BrandingStorage): void {
  const target = storage || (typeof localStorage === 'undefined' ? undefined : localStorage);
  if (!target) return;
  try {
    target.setItem(brandingCacheKey, JSON.stringify(branding));
  } catch {
    // Branding still works for this session when browser storage is unavailable.
  }
}

export interface BrandingPresentation {
  appName: string;
  companyName: string;
  loginTitle: string;
  loginSubtitle: string;
  headerLogoDataUrl: string;
  loginLogoDataUrl: string;
  loginBackgroundDataUrl: string;
}

export function resolveBrandingPresentation(branding: BrandingSettings): BrandingPresentation {
  const appName = branding.appName.trim() || defaultBranding.appName;
  const savedLoginTitle = branding.loginTitle.trim();
  const loginTitle = !savedLoginTitle
    || (appName !== defaultBranding.appName && savedLoginTitle === defaultBranding.loginTitle)
    ? appName
    : savedLoginTitle;

  return {
    appName,
    companyName: branding.companyName.trim(),
    loginTitle,
    loginSubtitle: branding.loginSubtitle.trim() || defaultBranding.loginSubtitle,
    headerLogoDataUrl: branding.appIconDataUrl,
    loginLogoDataUrl: branding.loginLogoDataUrl || branding.appIconDataUrl,
    loginBackgroundDataUrl: branding.loginBackgroundDataUrl,
  };
}

interface BrandingResponse {
  success: boolean;
  settings: BrandingSettings;
  error?: string;
}

export async function fetchBranding(signal?: AbortSignal): Promise<BrandingSettings> {
  const response = await fetch('/api/branding', { signal });
  const body = await response.json() as BrandingResponse;
  if (!response.ok || !body.success) {
    throw new Error(body.error || 'Failed to load branding');
  }
  return body.settings;
}

export async function saveAdminBranding(settings: BrandingSettings): Promise<BrandingSettings> {
  const response = await fetch('/api/admin/branding', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
  const body = await response.json() as BrandingResponse;
  if (!response.ok || !body.success) {
    throw new Error(body.error || 'Failed to save branding');
  }
  return body.settings;
}

export function applyBrandingToDocument(branding: BrandingSettings) {
  const appName = branding.appName || defaultBranding.appName;
  document.title = branding.companyName ? `${appName} | ${branding.companyName}` : appName;

  let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    document.head.appendChild(favicon);
  }
  favicon.href = branding.faviconDataUrl || '/favicon.svg';
}
