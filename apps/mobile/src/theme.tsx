import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';

export type ThemeMode = 'light' | 'dark';

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;
  text: string;
  textSecondary: string;
  muted: string;
  border: string;
  borderStrong: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  secondary: string;
  secondarySoft: string;
  tertiary: string;
  tertiarySoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  error: string;
  errorSoft: string;
  nav: string;
  fabBorder: string;
  overlay: string;
};

/** Keys users can edit when creating a custom theme. */
export const THEME_COLOR_FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: 'background', label: 'Background' },
  { key: 'surface', label: 'Cards / surface' },
  { key: 'surfaceMuted', label: 'Muted surface' },
  { key: 'text', label: 'Text' },
  { key: 'muted', label: 'Muted text' },
  { key: 'border', label: 'Border' },
  { key: 'primary', label: 'Primary' },
  { key: 'primarySoft', label: 'Primary soft' },
  { key: 'onPrimary', label: 'On primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'success', label: 'Success' },
  { key: 'warning', label: 'Warning' },
  { key: 'error', label: 'Error' },
  { key: 'nav', label: 'Navigation bar' },
];

export const lightColors: ThemeColors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceMuted: '#F4F6F8',
  text: '#0F172A',
  textSecondary: '#334155',
  muted: '#64748B',
  border: '#E8ECF0',
  borderStrong: '#D0D7DE',
  primary: '#1FA8A8',
  primarySoft: '#E6F7F6',
  onPrimary: '#FFFFFF',
  secondary: '#D97706',
  secondarySoft: '#FFF7ED',
  tertiary: '#0284C7',
  tertiarySoft: '#EFF8FF',
  success: '#0F766E',
  successSoft: '#E6F7F5',
  warning: '#B45309',
  warningSoft: '#FFF7ED',
  error: '#DC2626',
  errorSoft: '#FEF2F2',
  nav: '#FFFFFF',
  fabBorder: '#FFFFFF',
  overlay: 'rgba(15, 23, 42, 0.4)',
};

export const darkColors: ThemeColors = {
  background: '#0B1220',
  surface: '#121A2B',
  surfaceRaised: '#182235',
  surfaceMuted: '#0F1624',
  text: '#F1F5F9',
  textSecondary: '#CBD5E1',
  muted: '#94A3B8',
  border: 'rgba(148, 163, 184, 0.16)',
  borderStrong: 'rgba(148, 163, 184, 0.28)',
  primary: '#2EC4C4',
  primarySoft: 'rgba(46, 196, 196, 0.14)',
  onPrimary: '#042F2E',
  secondary: '#FBBF24',
  secondarySoft: 'rgba(251, 191, 36, 0.12)',
  tertiary: '#7DD3FC',
  tertiarySoft: 'rgba(125, 211, 252, 0.12)',
  success: '#2EC4C4',
  successSoft: 'rgba(46, 196, 196, 0.12)',
  warning: '#FBBF24',
  warningSoft: 'rgba(251, 191, 36, 0.12)',
  error: '#F87171',
  errorSoft: 'rgba(248, 113, 113, 0.12)',
  nav: '#121A2B',
  fabBorder: '#0B1220',
  overlay: 'rgba(0, 0, 0, 0.55)',
};

const oceanColors: ThemeColors = {
  ...lightColors,
  background: '#F0F9FF',
  surface: '#FFFFFF',
  surfaceMuted: '#E0F2FE',
  primary: '#0369A1',
  primarySoft: '#E0F2FE',
  onPrimary: '#FFFFFF',
  secondary: '#0E7490',
  tertiary: '#0284C7',
  nav: '#F0F9FF',
};

const forestColors: ThemeColors = {
  ...lightColors,
  background: '#F3F7F2',
  surface: '#FFFFFF',
  surfaceMuted: '#E7F0E6',
  primary: '#3F6B4D',
  primarySoft: '#E7F0E6',
  onPrimary: '#FFFFFF',
  secondary: '#A16207',
  tertiary: '#4D7C5A',
  success: '#3F6B4D',
  nav: '#F3F7F2',
};

const sunsetColors: ThemeColors = {
  ...lightColors,
  background: '#FFF7ED',
  surface: '#FFFFFF',
  surfaceMuted: '#FFEDD5',
  primary: '#C2410C',
  primarySoft: '#FFEDD5',
  onPrimary: '#FFFFFF',
  secondary: '#B45309',
  tertiary: '#EA580C',
  nav: '#FFF7ED',
};

const midnightColors: ThemeColors = {
  ...darkColors,
  background: '#09090B',
  surface: '#18181B',
  surfaceRaised: '#27272A',
  surfaceMuted: '#09090B',
  primary: '#A78BFA',
  primarySoft: 'rgba(167, 139, 250, 0.16)',
  onPrimary: '#1E1B4B',
  secondary: '#F472B6',
  tertiary: '#67E8F9',
  nav: '#18181B',
  fabBorder: '#09090B',
};

export type ThemePresetId = 'lony-light' | 'lony-dark' | 'ocean' | 'forest' | 'sunset' | 'midnight';

export type ThemePreset = {
  id: ThemePresetId | string;
  name: string;
  kind: 'preset' | 'custom';
  colors: ThemeColors;
};

export const BUILTIN_THEMES: ThemePreset[] = [
  { id: 'lony-light', name: 'Lony Light', kind: 'preset', colors: lightColors },
  { id: 'lony-dark', name: 'Lony Dark', kind: 'preset', colors: darkColors },
  { id: 'ocean', name: 'Ocean', kind: 'preset', colors: oceanColors },
  { id: 'forest', name: 'Forest', kind: 'preset', colors: forestColors },
  { id: 'sunset', name: 'Sunset', kind: 'preset', colors: sunsetColors },
  { id: 'midnight', name: 'Midnight', kind: 'preset', colors: midnightColors },
];

/** @deprecated Prefer useTheme().colors — kept for gradual migration */
export const colors = lightColors;

export const fonts = {
  ui: 'Manrope_400Regular',
  uiMedium: 'Manrope_500Medium',
  uiSemi: 'Manrope_600SemiBold',
  uiBold: 'Manrope_700Bold',
  mono: 'JetBrainsMono_500Medium',
  monoSemi: 'JetBrainsMono_600SemiBold',
};

export const radii = {
  sm: 8,
  md: 14,
  lg: 18,
  xl: 24,
  full: 9999,
};

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080/api/v1';

const THEME_KEY = 'lony.theme_mode';
const THEME_ID_KEY = 'lony.theme_id';
const CUSTOM_THEMES_KEY = 'lony.custom_themes';

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  colors: ThemeColors;
  themeId: string;
  presets: ThemePreset[];
  customThemes: ThemePreset[];
  setMode: (mode: ThemeMode) => void;
  setThemeId: (id: string) => void;
  saveCustomTheme: (theme: ThemePreset) => Promise<void>;
  deleteCustomTheme: (id: string) => Promise<void>;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isDarkPalette(c: ThemeColors): boolean {
  const hex = c.background.replace('#', '');
  if (hex.length < 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return false;
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');
  const [themeId, setThemeIdState] = useState<string>('lony-light');
  const [customThemes, setCustomThemes] = useState<ThemePreset[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [savedMode, savedId, rawCustom] = await Promise.all([
          SecureStore.getItemAsync(THEME_KEY),
          SecureStore.getItemAsync(THEME_ID_KEY),
          SecureStore.getItemAsync(CUSTOM_THEMES_KEY),
        ]);
        if (savedMode === 'light' || savedMode === 'dark') {
          setModeState(savedMode);
        }
        if (savedId) {
          setThemeIdState(savedId);
        } else if (savedMode === 'dark') {
          setThemeIdState('lony-dark');
        }
        if (rawCustom) {
          const parsed = JSON.parse(rawCustom) as ThemePreset[];
          if (Array.isArray(parsed)) {
            setCustomThemes(parsed.filter((t) => t?.id && t?.colors));
          }
        }
      } catch {
        /* keep defaults */
      }
    })();
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    SecureStore.setItemAsync(THEME_KEY, next).catch(() => undefined);
    const fallback = next === 'dark' ? 'lony-dark' : 'lony-light';
    setThemeIdState(fallback);
    SecureStore.setItemAsync(THEME_ID_KEY, fallback).catch(() => undefined);
  };

  const setThemeId = (id: string) => {
    setThemeIdState(id);
    SecureStore.setItemAsync(THEME_ID_KEY, id).catch(() => undefined);
    const all = [...BUILTIN_THEMES, ...customThemes];
    const hit = all.find((t) => t.id === id);
    if (hit) {
      const nextMode: ThemeMode = isDarkPalette(hit.colors) ? 'dark' : 'light';
      setModeState(nextMode);
      SecureStore.setItemAsync(THEME_KEY, nextMode).catch(() => undefined);
    }
  };

  const saveCustomTheme = async (theme: ThemePreset) => {
    const next = [...customThemes.filter((t) => t.id !== theme.id), { ...theme, kind: 'custom' as const }];
    setCustomThemes(next);
    await SecureStore.setItemAsync(CUSTOM_THEMES_KEY, JSON.stringify(next));
    setThemeId(theme.id);
  };

  const deleteCustomTheme = async (id: string) => {
    const next = customThemes.filter((t) => t.id !== id);
    setCustomThemes(next);
    await SecureStore.setItemAsync(CUSTOM_THEMES_KEY, JSON.stringify(next));
    if (themeId === id) {
      setThemeId('lony-light');
    }
  };

  const resolved: 'light' | 'dark' = mode;
  const activeColors = useMemo(() => {
    const all = [...BUILTIN_THEMES, ...customThemes];
    const hit = all.find((t) => t.id === themeId);
    if (hit) return hit.colors;
    return resolved === 'dark' ? darkColors : lightColors;
  }, [themeId, customThemes, resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved,
      colors: activeColors,
      themeId,
      presets: BUILTIN_THEMES,
      customThemes,
      setMode,
      setThemeId,
      saveCustomTheme,
      deleteCustomTheme,
      toggle: () => setMode(resolved === 'dark' ? 'light' : 'dark'),
    }),
    [mode, resolved, activeColors, themeId, customThemes],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

export function mediaURL(path: string | null | undefined, token?: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const base = apiBaseUrl.replace(/\/api\/v1$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
