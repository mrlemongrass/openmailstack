import { defaultMailSettings, type MailUserSettings } from '../settings/settingsApi';
import type { MailIdentity, UserIdentities } from '../shared/types';

export const EMPTY_USER_IDENTITIES: UserIdentities = {
  name: '',
  address: '',
  aliases: [],
};

function normalizeMailSettings(settings: MailUserSettings | null | undefined): MailUserSettings {
  const loaded = settings && typeof settings === 'object' ? settings : defaultMailSettings;
  return {
    ...defaultMailSettings,
    ...loaded,
    identity: { ...defaultMailSettings.identity, ...loaded.identity },
    compose: { ...defaultMailSettings.compose, ...loaded.compose },
    reading: { ...defaultMailSettings.reading, ...loaded.reading },
    spam: { ...defaultMailSettings.spam, ...loaded.spam },
    folders: { ...defaultMailSettings.folders, ...loaded.folders },
    signatures: Array.isArray(loaded.signatures) ? loaded.signatures : [],
  };
}

export async function loadMailSettingsOrDefault(
  loader: () => Promise<MailUserSettings>,
): Promise<MailUserSettings> {
  return (await loadMailSettingsRuntimeState(loader)).settings;
}

export async function loadMailSettingsRuntimeState(
  loader: () => Promise<MailUserSettings>,
): Promise<{ settings: MailUserSettings; ready: boolean }> {
  try {
    return { settings: normalizeMailSettings(await loader()), ready: true };
  } catch {
    return { settings: defaultMailSettings, ready: false };
  }
}

export async function loadMailIdentitiesOrDefault(
  loader: () => Promise<UserIdentities>,
): Promise<UserIdentities> {
  try {
    const identities = await loader();
    if (!identities || typeof identities !== 'object') return EMPTY_USER_IDENTITIES;
    const aliases = Array.isArray(identities.aliases)
      ? (identities.aliases as unknown[]).flatMap(alias => {
          if (typeof alias === 'string') return alias ? [{ address: alias }] : [];
          if (!alias || typeof alias !== 'object') return [];
          const candidate = alias as { address?: unknown; name?: unknown };
          if (typeof candidate.address !== 'string' || !candidate.address) return [];
          return [{
            address: candidate.address,
            ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
          }];
        })
      : [];
    return {
      name: typeof identities.name === 'string' ? identities.name : '',
      address: typeof identities.address === 'string' ? identities.address : '',
      aliases,
    };
  } catch {
    return EMPTY_USER_IDENTITIES;
  }
}

export function mailIdentities(userIdentities: UserIdentities): MailIdentity[] {
  const candidates: MailIdentity[] = [];
  if (userIdentities?.address) {
    candidates.push({ address: userIdentities.address, name: userIdentities.name || '' });
  }
  for (const alias of userIdentities?.aliases || []) {
    if (alias.address) candidates.push({ address: alias.address, name: alias.name || '' });
  }

  const seen = new Set<string>();
  return candidates.filter(identity => {
    const key = identity.address.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function selectComposeFrom(
  current: string,
  identities: MailIdentity[],
  defaultFrom: string,
): string {
  const matchingIdentity = (address: string) => identities.find(
    identity => identity.address.toLowerCase() === address.trim().toLowerCase(),
  );

  return matchingIdentity(current)?.address
    || matchingIdentity(defaultFrom)?.address
    || identities[0]?.address
    || '';
}
