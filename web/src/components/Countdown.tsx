import { useEffect, useState } from 'react';

export type CountdownParts = { d: number; h: number; m: number; s: number };

/** Time left until `to`, ticking every second; calls onDone once it reaches zero. */
export function useCountdownParts(to?: string | null, onDone?: () => void): CountdownParts | null {
  const target = to ? new Date(to).getTime() : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [target]);
  const left = Number.isFinite(target) ? target - now : NaN;
  useEffect(() => {
    if (Number.isFinite(left) && left <= 0) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left <= 0]);
  if (!Number.isFinite(left) || left <= 0) return null;
  const s = Math.floor(left / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** "2d 04:12:33" until `to`. */
export function useCountdown(to?: string | null, onDone?: () => void): string | null {
  const p = useCountdownParts(to, onDone);
  if (!p) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const hms = `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}`;
  return p.d > 0 ? `${p.d}d ${hms}` : hms;
}
