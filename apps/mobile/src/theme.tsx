import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type ThemeMode = 'light' | 'dark' | 'system';

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
  primary: '#0D9488',
  primarySoft: '#E6F7F5',
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
  primary: '#2DD4BF',
  primarySoft: 'rgba(45, 212, 191, 0.12)',
  onPrimary: '#042F2E',
  secondary: '#FBBF24',
  secondarySoft: 'rgba(251, 191, 36, 0.12)',
  tertiary: '#7DD3FC',
  tertiarySoft: 'rgba(125, 211, 252, 0.12)',
  success: '#2DD4BF',
  successSoft: 'rgba(45, 212, 191, 0.12)',
  warning: '#FBBF24',
  warningSoft: 'rgba(251, 191, 36, 0.12)',
  error: '#F87171',
  errorSoft: 'rgba(248, 113, 113, 0.12)',
  nav: '#121A2B',
  fabBorder: '#0B1220',
  overlay: 'rgba(0, 0, 0, 0.55)',
};

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

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('light');

  useEffect(() => {
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(THEME_KEY);
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setModeState(saved);
        }
      } catch {
        /* keep default light */
      }
    })();
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    SecureStore.setItemAsync(THEME_KEY, next).catch(() => undefined);
  };

  const resolved: 'light' | 'dark' =
    mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved,
      colors: resolved === 'dark' ? darkColors : lightColors,
      setMode,
      toggle: () => setMode(resolved === 'dark' ? 'light' : 'dark'),
    }),
    [mode, resolved],
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
