export type ThemeMode = 'system' | 'dark' | 'light' | 'contrast';
export type DensityMode = 'comfortable' | 'cozy' | 'compact';
export type FontScale = 'small' | 'normal' | 'large';
export type RadiusMode = 'sharp' | 'soft' | 'round';
export type AccentColor = 'blue' | 'cyan' | 'green' | 'amber' | 'rose' | 'violet';

export interface AppearancePreferences {
  themeMode: ThemeMode;
  density: DensityMode;
  fontScale: FontScale;
  radius: RadiusMode;
  accentColor: AccentColor;
  reduceMotion: boolean;
}

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  themeMode: 'dark',
  density: 'cozy',
  fontScale: 'normal',
  radius: 'soft',
  accentColor: 'blue',
  reduceMotion: false,
};

const STORAGE_KEY = 'oms_appearance';

const ACCENTS: Record<AccentColor, { primary: string; glow: string; purple: string }> = {
  blue: { primary: '#3B82F6', glow: 'rgba(59, 130, 246, 0.4)', purple: '#8B5CF6' },
  cyan: { primary: '#06B6D4', glow: 'rgba(6, 182, 212, 0.38)', purple: '#3B82F6' },
  green: { primary: '#10B981', glow: 'rgba(16, 185, 129, 0.36)', purple: '#22C55E' },
  amber: { primary: '#F59E0B', glow: 'rgba(245, 158, 11, 0.34)', purple: '#EAB308' },
  rose: { primary: '#F43F5E', glow: 'rgba(244, 63, 94, 0.35)', purple: '#EC4899' },
  violet: { primary: '#8B5CF6', glow: 'rgba(139, 92, 246, 0.38)', purple: '#A855F7' },
};

const THEMES: Record<Exclude<ThemeMode, 'system'>, Record<string, string>> = {
  dark: {
    '--bg-main': '#0B0F19',
    '--bg-glass': 'rgba(20, 25, 40, 0.6)',
    '--bg-glass-hover': 'rgba(30, 35, 55, 0.8)',
    '--border-glass': 'rgba(255, 255, 255, 0.08)',
    '--text-primary': '#ffffff',
    '--text-secondary': '#94A3B8',
    '--surface-color': '#111827',
  },
  light: {
    '--bg-main': '#F6F8FB',
    '--bg-glass': 'rgba(255, 255, 255, 0.84)',
    '--bg-glass-hover': 'rgba(231, 236, 246, 0.92)',
    '--border-glass': 'rgba(15, 23, 42, 0.12)',
    '--text-primary': '#0F172A',
    '--text-secondary': '#475569',
    '--surface-color': '#ffffff',
  },
  contrast: {
    '--bg-main': '#000000',
    '--bg-glass': 'rgba(5, 5, 5, 0.94)',
    '--bg-glass-hover': 'rgba(31, 31, 31, 0.98)',
    '--border-glass': 'rgba(255, 255, 255, 0.34)',
    '--text-primary': '#ffffff',
    '--text-secondary': '#d4d4d8',
    '--surface-color': '#050505',
  },
};

const FONT_SIZES: Record<FontScale, string> = {
  small: '14px',
  normal: '15px',
  large: '16px',
};

const RADII: Record<RadiusMode, { lg: string; md: string; sm: string }> = {
  sharp: { lg: '8px', md: '6px', sm: '4px' },
  soft: { lg: '16px', md: '10px', sm: '6px' },
  round: { lg: '22px', md: '14px', sm: '8px' },
};

export function loadAppearancePreferences(): AppearancePreferences {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(saved) as Partial<AppearancePreferences>;
    return { ...DEFAULT_APPEARANCE, ...parsed };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearancePreferences(preferences: AppearancePreferences) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export function applyAppearancePreferences(preferences: AppearancePreferences) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const systemPrefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const themeName = preferences.themeMode === 'system'
    ? (systemPrefersLight ? 'light' : 'dark')
    : preferences.themeMode;

  Object.entries(THEMES[themeName]).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });

  const accent = ACCENTS[preferences.accentColor];
  root.style.setProperty('--accent-primary', accent.primary);
  root.style.setProperty('--accent-glow', accent.glow);
  root.style.setProperty('--accent-purple', accent.purple);

  const radius = RADII[preferences.radius];
  root.style.setProperty('--radius-lg', radius.lg);
  root.style.setProperty('--radius-md', radius.md);
  root.style.setProperty('--radius-sm', radius.sm);
  root.style.setProperty('--app-font-size', FONT_SIZES[preferences.fontScale]);

  root.dataset.theme = themeName;
  root.dataset.density = preferences.density;
  root.dataset.motion = preferences.reduceMotion ? 'reduced' : 'default';
}
