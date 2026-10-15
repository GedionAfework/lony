import { Platform } from 'react-native';

type SecureStoreModule = typeof import('expo-secure-store');

let native: SecureStoreModule | null = null;

async function getNative(): Promise<SecureStoreModule | null> {
  if (Platform.OS === 'web') return null;
  if (native) return native;
  try {
    native = await import('expo-secure-store');
    return native;
  } catch {
    return null;
  }
}

/** Cross-platform key/value: SecureStore on native, localStorage on web. */
export async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  const store = await getNative();
  if (!store) return null;
  try {
    return await store.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore quota */
    }
    return;
  }
  const store = await getNative();
  if (!store) return;
  try {
    await store.setItemAsync(key, value);
  } catch {
    /* ignore */
  }
}

export async function storageDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    return;
  }
  const store = await getNative();
  if (!store) return;
  try {
    await store.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}
