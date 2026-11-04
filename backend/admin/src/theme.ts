import { useEffect, useState } from 'react';

/** Light, dark, or follow the computer. Stored per browser. */
export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'lony_admin_theme';

export function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** Sets data-theme on <html>; CSS switches every colour from there. */
export function applyMode(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && systemDark());
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export function useThemeMode(): [ThemeMode, (m: ThemeMode) => void, boolean] {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');

  useEffect(() => {
    applyMode(mode);
    setDark(document.documentElement.dataset.theme === 'dark');
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* private window: still switches for this visit */
    }
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      applyMode('system');
      setDark(mq.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  return [mode, setMode, dark];
}
