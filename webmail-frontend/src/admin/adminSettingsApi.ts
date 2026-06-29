export type AdminSettingsNamespace = 'organization' | 'publicUrls' | 'security' | 'mailPolicy' | 'system' | 'webhooks';

export interface OrganizationAdminSettings {
  organizationName: string;
  supportEmail: string;
  supportUrl: string;
  defaultLocale: string;
  defaultTimeZone: string;
}

export interface PublicUrlsAdminSettings {
  webmailUrl: string;
  autodiscoverHost: string;
  mailHost: string;
  caldavUrl: string;
  carddavUrl: string;
}

export interface SecurityAdminSettings {
  sessionLifetimeHours: 8 | 12 | 24 | 72 | 168;
  requireSecureCookies: boolean;
  allowUserPasswordChange: boolean;
  showLastLoginNotice: boolean;
}

export interface MailPolicyAdminSettings {
  maxAttachmentMb: number;
  defaultQuotaMb: number;
  spamPolicyMode: 'standard' | 'strict' | 'permissive';
  allowExternalForwarding: boolean;
}

export interface SystemAdminSettings {
  updateChannel: 'stable' | 'preview';
  maintenanceWindow: string;
  telemetryMode: 'off' | 'basic';
  adminNotice: string;
}

export interface WebhooksAdminSettings {
  endpoints: string[];
  events: string[];
}

export interface AdminSettingsMap {
  organization: OrganizationAdminSettings;
  publicUrls: PublicUrlsAdminSettings;
  security: SecurityAdminSettings;
  mailPolicy: MailPolicyAdminSettings;
  system: SystemAdminSettings;
  webhooks: WebhooksAdminSettings;
}

export const defaultAdminSettings: AdminSettingsMap = {
  organization: {
    organizationName: '',
    supportEmail: '',
    supportUrl: '',
    defaultLocale: 'en-US',
    defaultTimeZone: 'UTC',
  },
  publicUrls: {
    webmailUrl: '',
    autodiscoverHost: '',
    mailHost: '',
    caldavUrl: '',
    carddavUrl: '',
  },
  security: {
    sessionLifetimeHours: 8,
    requireSecureCookies: true,
    allowUserPasswordChange: false,
    showLastLoginNotice: true,
  },
  mailPolicy: {
    maxAttachmentMb: 25,
    defaultQuotaMb: 1024,
    spamPolicyMode: 'standard',
    allowExternalForwarding: true,
  },
  system: {
    updateChannel: 'stable',
    maintenanceWindow: 'Sunday 02:00',
    telemetryMode: 'off',
    adminNotice: '',
  },
  webhooks: {
    endpoints: [],
    events: [],
  }
};


interface AdminSettingsResponse<T extends AdminSettingsNamespace> {
  success: boolean;
  namespace: T;
  settings: AdminSettingsMap[T];
  error?: string;
}

export async function getAdminSettings<T extends AdminSettingsNamespace>(namespace: T): Promise<AdminSettingsMap[T]> {
  const response = await fetch(`/api/admin/settings/${namespace}`, {
    credentials: 'include',
  });
  const body = await response.json() as AdminSettingsResponse<T>;
  if (!response.ok || !body.success) {
    throw new Error(body.error || `Failed to load ${namespace} settings`);
  }
  return body.settings;
}

export async function saveAdminSettings<T extends AdminSettingsNamespace>(namespace: T, settings: AdminSettingsMap[T]): Promise<AdminSettingsMap[T]> {
  const response = await fetch(`/api/admin/settings/${namespace}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
  const body = await response.json() as AdminSettingsResponse<T>;
  if (!response.ok || !body.success) {
    throw new Error(body.error || `Failed to save ${namespace} settings`);
  }
  return body.settings;
}
