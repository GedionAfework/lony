import { useEffect, useState } from 'react';

/** "2d 04:12:33" until `to`, ticking every second; calls onDone once it reaches zero. */
export function useCountdown(to?: string | null, onDone?: () => void): string | null {
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
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}
