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

interface BrandingResponse {
  success: boolean;
  settings: BrandingSettings;
  error?: string;
}

export async function fetchBranding(): Promise<BrandingSettings> {
  const response = await fetch('/api/branding');
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
