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
  background: '#F7F9FB',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceMuted: '#EEF2F6',
  text: '#0F172A',
  textSecondary: '#334155',
  muted: '#64748B',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
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
