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

// ─── Branding ────────────────────────────────────────────────────────────────

export async function fetchAdminBranding(): Promise<BrandingSettings> {
  const response = await fetch('/api/admin/branding', { credentials: 'include' });
  const body = await response.json() as { success: boolean; settings: BrandingSettings; error?: string };
  if (!response.ok || !body.success) throw new Error(body.error || 'Failed to load branding');
  return body.settings;
}

export async function saveAdminBranding(settings: BrandingSettings): Promise<BrandingSettings> {
  const response = await fetch('/api/admin/branding', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
  const body = await response.json() as { success: boolean; settings: BrandingSettings; error?: string };
  if (!response.ok || !body.success) throw new Error(body.error || 'Failed to save branding');
  return body.settings;
}

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

// ─── Domains ─────────────────────────────────────────────────────────────────

export interface DomainInfo {
  domain: string;
  description: string;
  aliases: number;
  mailboxes: number;
  maxquota: number;
  quota: number;
  transport: string;
  backupmx: boolean;
  created: string;
  modified: string;
  active: boolean;
  verify_token: string;
}

export interface DnsRecord {
  type: string;
  host: string;
  value: string;
  priority?: number;
  ttl: number;
}

export async function getDomains(): Promise<DomainInfo[]> {
  const r = await fetch('/api/admin/domains', { credentials: 'include' });
  const b = await r.json() as { success: boolean; data: DomainInfo[]; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to load domains');
  return b.data;
}

export async function createDomain(data: { domain: string; maxquota: string; quota: string }): Promise<void> {
  const r = await fetch('/api/admin/domains', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to create domain');
}

export async function deleteDomain(domain: string): Promise<void> {
  const r = await fetch(`/api/admin/domains/${encodeURIComponent(domain)}`, {
    method: 'DELETE', credentials: 'include',
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to delete domain');
}

export async function getDomainDns(domain: string): Promise<DnsRecord[]> {
  const r = await fetch(`/api/admin/domains/${encodeURIComponent(domain)}/dns`, { credentials: 'include' });
  const b = await r.json() as { success: boolean; data: DnsRecord[]; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to load DNS records');
  return b.data;
}

// ─── Mailboxes ───────────────────────────────────────────────────────────────

export interface MailboxInfo {
  username: string;
  name: string;
  maildir: string;
  quota: number;
  local_part: string;
  domain: string;
  created: string;
  modified: string;
  active: boolean;
  phone: string;
  email_other: string;
  token: string;
  token_validity: string;
  company?: string;
  job_title?: string;
  street_address?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  notes?: string;
  show_in_directory?: boolean;
}

export async function getMailboxes(): Promise<MailboxInfo[]> {
  const r = await fetch('/api/admin/mailboxes', { credentials: 'include' });
  const b = await r.json() as { success: boolean; data: MailboxInfo[]; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to load mailboxes');
  return b.data;
}

export async function createMailbox(data: Record<string, string>): Promise<void> {
  const r = await fetch('/api/admin/mailboxes', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to create mailbox');
}

export async function updateMailbox(username: string, data: Record<string, any>): Promise<void> {
  const r = await fetch(`/api/admin/mailboxes/${encodeURIComponent(username)}`, {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to update mailbox');
}

export async function deleteMailbox(username: string): Promise<void> {
  const r = await fetch(`/api/admin/mailboxes/${encodeURIComponent(username)}`, {
    method: 'DELETE', credentials: 'include',
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to delete mailbox');
}

export async function changeMailboxPassword(username: string, password: string): Promise<void> {
  const r = await fetch(`/api/admin/mailboxes/${encodeURIComponent(username)}/password`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to change password');
}

// ─── Aliases ─────────────────────────────────────────────────────────────────

export interface AliasInfo {
  address: string;
  goto: string;
  domain: string;
  created: string;
  modified: string;
  active: boolean;
}

export async function getAliases(): Promise<AliasInfo[]> {
  const r = await fetch('/api/admin/aliases', { credentials: 'include' });
  const b = await r.json() as { success: boolean; data: AliasInfo[]; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to load aliases');
  return b.data;
}

export async function createAlias(data: { address: string; domain: string; goto: string }): Promise<void> {
  const r = await fetch('/api/admin/aliases', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to create alias');
}

export async function updateAlias(address: string, data: { address?: string; domain?: string; goto?: string }): Promise<void> {
  const r = await fetch(`/api/admin/aliases/${encodeURIComponent(address)}`, {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to update alias');
}

export async function deleteAlias(address: string): Promise<void> {
  const r = await fetch(`/api/admin/aliases/${encodeURIComponent(address)}`, {
    method: 'DELETE', credentials: 'include',
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to delete alias');
}

// ─── Routing ─────────────────────────────────────────────────────────────────

export interface RoutingInfo {
  alias_domain: string;
  target_domain: string;
  created: string;
  modified: string;
  active: boolean;
}

export async function getRouting(): Promise<RoutingInfo[]> {
  const r = await fetch('/api/admin/routing', { credentials: 'include' });
  const b = await r.json() as { success: boolean; data: RoutingInfo[]; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to load routing');
  return b.data;
}

export async function createRouting(aliasDomain: string): Promise<void> {
  const r = await fetch('/api/admin/routing', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias_domain: aliasDomain, target_domain: '' }),
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to create routing');
}

export async function deleteRouting(aliasDomain: string): Promise<void> {
  const r = await fetch(`/api/admin/routing/${encodeURIComponent(aliasDomain)}`, {
    method: 'DELETE', credentials: 'include',
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to delete routing');
}

// ─── Admins ──────────────────────────────────────────────────────────────────

export interface AdminUserInfo {
  username: string;
  created: string;
  modified: string;
  active: boolean;
  superadmin: boolean;
}

export async function getAdminUsers(): Promise<AdminUserInfo[]> {
  const r = await fetch('/api/admin/admins', { credentials: 'include' });
  const b = await r.json() as { success: boolean; data: AdminUserInfo[]; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to load admins');
  return b.data;
}

export async function promoteAdmin(username: string): Promise<void> {
  const r = await fetch('/api/admin/admins', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to promote admin');
}

export async function demoteAdmin(username: string): Promise<void> {
  const r = await fetch(`/api/admin/admins/${encodeURIComponent(username)}`, {
    method: 'DELETE', credentials: 'include',
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to demote admin');
}

// ─── API Keys ────────────────────────────────────────────────────────────────

export interface ApiKeyInfo {
  id: number;
  description: string;
  created_at: string;
  last_used: string | null;
}

export async function getApiKeys(): Promise<ApiKeyInfo[]> {
  const r = await fetch('/api/admin/apikeys', { credentials: 'include' });
  const b = await r.json() as { success: boolean; data: ApiKeyInfo[]; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to load API keys');
  return b.data;
}

export async function createApiKey(description: string): Promise<string> {
  const r = await fetch('/api/admin/apikeys', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  const b = await r.json() as { success: boolean; raw_key: string; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to create API key');
  return b.raw_key;
}

export async function deleteApiKey(id: number): Promise<void> {
  const r = await fetch(`/api/admin/apikeys/${id}`, {
    method: 'DELETE', credentials: 'include',
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to delete API key');
}

// ─── Updates ─────────────────────────────────────────────────────────────────

export interface UpdatesInfo {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  components: { name: string; version: string }[];
}

export async function getUpdates(): Promise<UpdatesInfo> {
  const r = await fetch('/api/admin/updates', { credentials: 'include' });
  const b = await r.json() as { success: boolean; current_version: string; latest_version: string; has_update: boolean; components: { name: string; version: string }[]; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to check updates');
  return { current_version: b.current_version, latest_version: b.latest_version, has_update: b.has_update, components: b.components };
}

// ─── Spam Policies ───────────────────────────────────────────────────────────

export async function getSpamPolicies(): Promise<Record<string, any> | null> {
  const r = await fetch('/api/admin/spam_policies', { credentials: 'include' });
  const b = await r.json() as { success: boolean; rules: Record<string, any> | null; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to load spam policies');
  return b.rules;
}

export async function saveSpamPolicies(rules: Record<string, any>): Promise<void> {
  const r = await fetch('/api/admin/spam_policies', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules }),
  });
  const b = await r.json() as { success: boolean; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to save spam policies');
}

// ─── Audit Logs ──────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  username: string;
  domain: string;
  action: string;
  data: string;
}

export async function getAuditLogs(): Promise<AuditLogEntry[]> {
  const r = await fetch('/api/admin/logs', { credentials: 'include' });
  const b = await r.json() as { success: boolean; data: AuditLogEntry[]; error?: string };
  if (!r.ok || !b.success) throw new Error(b.error || 'Failed to load audit logs');
  return b.data;
}
