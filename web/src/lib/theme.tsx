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

type ThemeMode = 'light' | 'dark';

type ThemeContextValue = {
  mode: ThemeMode;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_KEY = 'lony_web_theme_mode';

function applyCssVars(colors: ThemeColors) {
  const root = document.documentElement;
  root.style.setProperty('--bg', colors.background);
  root.style.setProperty('--surface', colors.surface);
  root.style.setProperty('--surface-raised', colors.surfaceRaised);
  root.style.setProperty('--surface-muted', colors.surfaceMuted);
  root.style.setProperty('--text', colors.text);
  root.style.setProperty('--text-secondary', colors.textSecondary);
  root.style.setProperty('--muted', colors.muted);
  root.style.setProperty('--border', colors.border);
  root.style.setProperty('--border-strong', colors.borderStrong);
  root.style.setProperty('--primary', colors.primary);
  root.style.setProperty('--primary-soft', colors.primarySoft);
  root.style.setProperty('--on-primary', colors.onPrimary);
  root.style.setProperty('--secondary', colors.secondary);
  root.style.setProperty('--secondary-soft', colors.secondarySoft);
  root.style.setProperty('--tertiary', colors.tertiary);
  root.style.setProperty('--tertiary-soft', colors.tertiarySoft);
  root.style.setProperty('--success', colors.success);
  root.style.setProperty('--success-soft', colors.successSoft);
  root.style.setProperty('--warning', colors.warning);
  root.style.setProperty('--warning-soft', colors.warningSoft);
  root.style.setProperty('--error', colors.error);
  root.style.setProperty('--error-soft', colors.errorSoft);
  root.style.setProperty('--nav', colors.nav);
  root.style.setProperty('--overlay', colors.overlay);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  });

  const colors = mode === 'dark' ? darkColors : lightColors;

  useEffect(() => {
    applyCssVars(colors);
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.background = colors.background;
    document.documentElement.style.colorScheme = mode;
  }, [colors, mode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('lony_web_token');
        if (!token) return;
        const res = await fetch(`${apiBaseUrl}/themes/system`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        // Prefetch only — extended system theme picker lives on Settings.
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    localStorage.setItem(THEME_KEY, next);
  }, []);

  const value = useMemo(
    () => ({
      mode,
      colors,
      setMode,
      toggle: () => setMode(mode === 'dark' ? 'light' : 'dark'),
    }),
    [mode, colors, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
