import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiBaseUrl } from './api';

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

/** Keys people can edit when making their own theme (same as mobile). */
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
  background: '#F4F6F9',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceMuted: '#F1F4F7',
  text: '#0E1726',
  textSecondary: '#3A4659',
  muted: '#6B778A',
  border: '#E6EAF0',
  borderStrong: '#D3DAE3',
  primary: '#159E9E',
  primarySoft: '#E2F4F3',
  onPrimary: '#FFFFFF',
  secondary: '#E07B12',
  secondarySoft: '#FFF4E6',
  tertiary: '#2F7DD3',
  tertiarySoft: '#EAF2FC',
  success: '#0E8A6A',
  successSoft: '#E3F6EF',
  warning: '#C46A0B',
  warningSoft: '#FFF4E6',
  error: '#DC3B3B',
  errorSoft: '#FDEDED',
  nav: '#FFFFFF',
  fabBorder: '#FFFFFF',
  overlay: 'rgba(14, 23, 38, 0.45)',
};

export const darkColors: ThemeColors = {
  background: '#0A0F18',
  surface: '#111925',
  surfaceRaised: '#172131',
  surfaceMuted: '#0E1520',
  text: '#EEF2F7',
  textSecondary: '#C3CCD8',
  muted: '#8B97A8',
  border: 'rgba(148, 163, 184, 0.13)',
  borderStrong: 'rgba(148, 163, 184, 0.26)',
  primary: '#2CC2BD',
  primarySoft: 'rgba(44, 194, 189, 0.14)',
  onPrimary: '#04201F',
  secondary: '#F5A524',
  secondarySoft: 'rgba(245, 165, 36, 0.13)',
  tertiary: '#7AB8F5',
  tertiarySoft: 'rgba(122, 184, 245, 0.13)',
  success: '#3DD6A3',
  successSoft: 'rgba(61, 214, 163, 0.13)',
  warning: '#F5A524',
  warningSoft: 'rgba(245, 165, 36, 0.13)',
  error: '#F47474',
  errorSoft: 'rgba(244, 116, 116, 0.13)',
  nav: '#111925',
  fabBorder: '#0A0F18',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

// The same palettes as the mobile app.
const oceanColors: ThemeColors = {
  ...lightColors,
  background: '#F0F9FF',
  surfaceMuted: '#E0F2FE',
  primary: '#0369A1',
  primarySoft: '#E0F2FE',
  secondary: '#0E7490',
  tertiary: '#0284C7',
  nav: '#F0F9FF',
};

const forestColors: ThemeColors = {
  ...lightColors,
  background: '#F3F7F2',
  surfaceMuted: '#E7F0E6',
  primary: '#3F6B4D',
  primarySoft: '#E7F0E6',
  secondary: '#A16207',
  tertiary: '#4D7C5A',
  success: '#3F6B4D',
  nav: '#F3F7F2',
};

const sunsetColors: ThemeColors = {
  ...lightColors,
  background: '#FFF7ED',
  surfaceMuted: '#FFEDD5',
  primary: '#C2410C',
  primarySoft: '#FFEDD5',
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

export type ThemeMode = 'light' | 'dark';

export type ThemePreset = {
  id: string;
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

type ThemeContextValue = {
  mode: ThemeMode;
  colors: ThemeColors;
  themeId: string;
  presets: ThemePreset[];
  customThemes: ThemePreset[];
  setMode: (mode: ThemeMode) => void;
  setThemeId: (id: string) => void;
  saveCustomTheme: (theme: ThemePreset) => void;
  deleteCustomTheme: (id: string) => void;
  refreshSystemThemes: () => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_KEY = 'lony_web_theme_mode';
const THEME_ID_KEY = 'lony_web_theme_id';
const CUSTOM_THEMES_KEY = 'lony_web_custom_themes';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

/** Whether a palette reads as dark, from its background colour. */
export function isDarkPalette(c: ThemeColors): boolean {
  const hex = c.background.replace('#', '');
  if (hex.length < 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function applyCssVars(colors: ThemeColors) {
  const root = document.documentElement;
  const vars: [string, string][] = [
    ['--bg', colors.background],
    ['--surface', colors.surface],
    ['--surface-raised', colors.surfaceRaised],
    ['--surface-muted', colors.surfaceMuted],
    ['--text', colors.text],
    ['--text-secondary', colors.textSecondary],
    ['--muted', colors.muted],
    ['--border', colors.border],
    ['--border-strong', colors.borderStrong],
    ['--primary', colors.primary],
    ['--primary-soft', colors.primarySoft],
    ['--on-primary', colors.onPrimary],
    ['--secondary', colors.secondary],
    ['--secondary-soft', colors.secondarySoft],
    ['--tertiary', colors.tertiary],
    ['--tertiary-soft', colors.tertiarySoft],
    ['--success', colors.success],
    ['--success-soft', colors.successSoft],
    ['--warning', colors.warning],
    ['--warning-soft', colors.warningSoft],
    ['--error', colors.error],
    ['--error-soft', colors.errorSoft],
    ['--nav', colors.nav],
    ['--overlay', colors.overlay],
  ];
  for (const [k, v] of vars) root.style.setProperty(k, v);
}

function readCustom(): ThemePreset[] {
  try {
    const parsed = JSON.parse(read(CUSTOM_THEMES_KEY) || '[]') as ThemePreset[];
    return Array.isArray(parsed)
      ? parsed.filter((t) => t?.id && t?.colors).map((t) => ({ ...t, kind: 'custom' as const, colors: { ...lightColors, ...t.colors } }))
      : [];
  } catch {
    return [];
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<string>(() => {
    const saved = read(THEME_ID_KEY);
    if (saved) return saved;
    return read(THEME_KEY) === 'dark' ? 'lony-dark' : 'lony-light';
  });
  const [customThemes, setCustomThemes] = useState<ThemePreset[]>(readCustom);
  const [systemThemes, setSystemThemes] = useState<ThemePreset[]>([]);

  const refreshSystemThemes = useCallback(async () => {
    const token = read('lony_web_token');
    if (!token) return;
    try {
      const res = await fetch(`${apiBaseUrl}/themes/system`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { themes?: { slug: string; label: string; colors: Partial<ThemeColors> }[] };
      if (!Array.isArray(data.themes)) return;
      setSystemThemes(
        data.themes
          // Lony Light/Dark keep the web's tuned palettes; admins add new looks.
          .filter((t) => t?.slug && t?.colors && t.slug !== 'lony-light' && t.slug !== 'lony-dark')
          .map((t) => {
            const base = { ...lightColors, ...t.colors } as ThemeColors;
            return {
              id: t.slug,
              name: t.label || t.slug,
              kind: 'preset' as const,
              colors: isDarkPalette(base) ? { ...darkColors, ...t.colors } : base,
            };
          }),
      );
    } catch {
      /* keep built-ins */
    }
  }, []);

  useEffect(() => {
    void refreshSystemThemes();
  }, [refreshSystemThemes]);

  const presets = useMemo(() => {
    const byId = new Map<string, ThemePreset>();
    for (const t of BUILTIN_THEMES) byId.set(t.id, t);
    for (const t of systemThemes) byId.set(t.id, t);
    return Array.from(byId.values());
  }, [systemThemes]);

  const active = useMemo(() => {
    const hit = [...presets, ...customThemes].find((t) => t.id === themeId);
    if (hit) return hit;
    return themeId === 'lony-dark' ? BUILTIN_THEMES[1] : BUILTIN_THEMES[0];
  }, [presets, customThemes, themeId]);

  const colors = active.colors;
  const mode: ThemeMode = isDarkPalette(colors) ? 'dark' : 'light';

  useEffect(() => {
    applyCssVars(colors);
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.background = colors.background;
    document.documentElement.style.colorScheme = mode;
    write(THEME_KEY, mode);
  }, [colors, mode]);

  const setThemeId = useCallback((id: string) => {
    setThemeIdState(id);
    write(THEME_ID_KEY, id);
  }, []);

  const setMode = useCallback((next: ThemeMode) => setThemeId(next === 'dark' ? 'lony-dark' : 'lony-light'), [setThemeId]);

  const saveCustomTheme = useCallback(
    (theme: ThemePreset) => {
      setCustomThemes((prev) => {
        const next = [...prev.filter((t) => t.id !== theme.id), { ...theme, kind: 'custom' as const }];
        write(CUSTOM_THEMES_KEY, JSON.stringify(next));
        return next;
      });
      setThemeId(theme.id);
    },
    [setThemeId],
  );

  const deleteCustomTheme = useCallback(
    (id: string) => {
      setCustomThemes((prev) => {
        const next = prev.filter((t) => t.id !== id);
        write(CUSTOM_THEMES_KEY, JSON.stringify(next));
        return next;
      });
      if (themeId === id) setThemeId('lony-light');
    },
    [themeId, setThemeId],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      colors,
      themeId: active.id,
      presets,
      customThemes,
      setMode,
      setThemeId,
      saveCustomTheme,
      deleteCustomTheme,
      refreshSystemThemes: () => void refreshSystemThemes(),
      toggle: () => setMode(mode === 'dark' ? 'light' : 'dark'),
    }),
    [mode, colors, active.id, presets, customThemes, setMode, setThemeId, saveCustomTheme, deleteCustomTheme, refreshSystemThemes],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
