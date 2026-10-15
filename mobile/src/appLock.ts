import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const METHOD_KEY = 'lony.app_lock_method';
const SECRET_KEY = 'lony.app_lock_secret';
const UNLOCKED_AT_KEY = 'lony.app_lock_unlocked_at';

export type AppLockMethod = 'none' | 'biometrics' | 'pin' | 'pattern' | 'password';

export const APP_LOCK_GRACE_MS = 60 * 60 * 1000;

async function hashSecret(secret: string): Promise<string> {
  const payload = `lony-lock-v1:${secret}`;
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      const data = new TextEncoder().encode(payload);
      const digest = await subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    /* fall through */
  }
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `f${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export async function getAppLockMethod(): Promise<AppLockMethod> {
  if (Platform.OS === 'web') return 'none';
  try {
    const v = (await SecureStore.getItemAsync(METHOD_KEY)) as AppLockMethod | null;
    if (v === 'biometrics' || v === 'pin' || v === 'pattern' || v === 'password') return v;
    return 'none';
  } catch {
    return 'none';
  }
}

export async function isAppLockEnabled(): Promise<boolean> {
  const m = await getAppLockMethod();
  return m !== 'none';
}

export async function clearAppLock(): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(METHOD_KEY);
  await SecureStore.deleteItemAsync(SECRET_KEY);
  await SecureStore.deleteItemAsync(UNLOCKED_AT_KEY);
}

export async function setAppLockMethod(
  method: Exclude<AppLockMethod, 'none' | 'biometrics'>,
  secret: string,
): Promise<{ ok: boolean; error?: string }> {
  if (Platform.OS === 'web') return { ok: false, error: 'Not available on web' };
  const cleaned = secret.trim();
  if (method === 'pin') {
    if (!/^\d{6}$/.test(cleaned)) return { ok: false, error: 'PIN must be exactly 6 digits' };
  } else if (method === 'pattern') {
    if (cleaned.length < 4) return { ok: false, error: 'Draw a longer pattern (at least 4 dots)' };
  } else if (method === 'password') {
    if (cleaned.length < 6) return { ok: false, error: 'Password must be at least 6 characters' };
  }
  const hashed = await hashSecret(cleaned);
  await SecureStore.setItemAsync(METHOD_KEY, method);
  await SecureStore.setItemAsync(SECRET_KEY, hashed);
  await markAppLockUnlocked();
  return { ok: true };
}

export async function setBiometricsAsLockMethod(): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(METHOD_KEY, 'biometrics');
  await SecureStore.deleteItemAsync(SECRET_KEY);
  await markAppLockUnlocked();
}

export async function verifyAppLockSecret(secret: string): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const stored = await SecureStore.getItemAsync(SECRET_KEY);
  if (!stored) return false;
  const hashed = await hashSecret(secret.trim());
  return hashed === stored;
}

export async function markAppLockUnlocked(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.setItemAsync(UNLOCKED_AT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export async function clearAppLockUnlocked(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(UNLOCKED_AT_KEY);
  } catch {
    /* ignore */
  }
}

export async function isWithinAppLockGrace(graceMs = APP_LOCK_GRACE_MS): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const raw = await SecureStore.getItemAsync(UNLOCKED_AT_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at) || at <= 0) return false;
    return Date.now() - at < graceMs;
  } catch {
    return false;
  }
}

export function patternToSecret(dots: number[]): string {
  return dots.join('-');
}
