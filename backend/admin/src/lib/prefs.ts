import { useEffect, useState } from 'react';

/** Per-browser console preferences, applied as attributes on <html>. */
export type Density = 'comfortable' | 'compact';
export type Motion = 'full' | 'reduced';

const DENSITY_KEY = 'lony_admin_density';
const MOTION_KEY = 'lony_admin_motion';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window: applies for this visit only */
  }
}

export function applyPrefs() {
  const root = document.documentElement;
  root.dataset.density = read(DENSITY_KEY, ['comfortable', 'compact'] as const, 'comfortable');
  root.dataset.motion = read(MOTION_KEY, ['full', 'reduced'] as const, 'full');
}

export function useDensity(): [Density, (d: Density) => void] {
  const [v, setV] = useState<Density>(() => read(DENSITY_KEY, ['comfortable', 'compact'] as const, 'comfortable'));
  useEffect(() => {
    write(DENSITY_KEY, v);
    document.documentElement.dataset.density = v;
  }, [v]);
  return [v, setV];
}

export function useMotion(): [Motion, (m: Motion) => void] {
  const [v, setV] = useState<Motion>(() => read(MOTION_KEY, ['full', 'reduced'] as const, 'full'));
  useEffect(() => {
    write(MOTION_KEY, v);
    document.documentElement.dataset.motion = v;
  }, [v]);
  return [v, setV];
}
