import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const PREF_KEY = 'lony.biometrics_lock';

export async function getBiometricsLockEnabled(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const v = await SecureStore.getItemAsync(PREF_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

export async function setBiometricsLockEnabled(on: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(PREF_KEY, on ? '1' : '0');
}

type LocalAuthModule = typeof import('expo-local-authentication');

let localAuth: LocalAuthModule | null | undefined;

async function getLocalAuth(): Promise<LocalAuthModule | null> {
  if (Platform.OS === 'web') return null;
  if (localAuth !== undefined) return localAuth;
  try {
    localAuth = await import('expo-local-authentication');
    return localAuth;
  } catch {
    localAuth = null;
    return null;
  }
}

export type BiometricsAvailability = {
  available: boolean;
  enrolled: boolean;
  label: string;
};

export async function getBiometricsAvailability(): Promise<BiometricsAvailability> {
  const mod = await getLocalAuth();
  if (!mod) {
    return { available: false, enrolled: false, label: 'Biometrics' };
  }
  try {
    const hasHardware = await mod.hasHardwareAsync();
    const enrolled = hasHardware ? await mod.isEnrolledAsync() : false;
    const types = hasHardware ? await mod.supportedAuthenticationTypesAsync() : [];
    const hasFace = types.includes(mod.AuthenticationType.FACIAL_RECOGNITION);
    const hasFingerprint = types.includes(mod.AuthenticationType.FINGERPRINT);
    const hasIris = types.includes(mod.AuthenticationType.IRIS);
    let label = 'Biometrics';
    if (hasFace && !hasFingerprint) label = Platform.OS === 'ios' ? 'Face ID' : 'Face unlock';
    else if (hasFingerprint && !hasFace) label = Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint';
    else if (hasIris) label = 'Iris';
    else if (hasFace && hasFingerprint) label = 'Biometrics';
    return { available: hasHardware, enrolled, label };
  } catch {
    return { available: false, enrolled: false, label: 'Biometrics' };
  }
}

export async function authenticateWithBiometrics(promptMessage = 'Unlock Lony'): Promise<boolean> {
  const mod = await getLocalAuth();
  if (!mod) return false;
  try {
    const result = await mod.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
      fallbackLabel: 'Use device passcode',
    });
    return result.success === true;
  } catch {
    return false;
  }
}

/** Enable lock: require a successful biometric prompt first. */
export async function enableBiometricsLock(): Promise<{ ok: boolean; error?: string }> {
  const avail = await getBiometricsAvailability();
  if (!avail.available) {
    return { ok: false, error: 'This device does not support biometrics.' };
  }
  if (!avail.enrolled) {
    return { ok: false, error: `Set up ${avail.label} in your device settings first.` };
  }
  const ok = await authenticateWithBiometrics(`Enable ${avail.label} lock`);
  if (!ok) return { ok: false, error: 'Authentication cancelled.' };
  await setBiometricsLockEnabled(true);
  return { ok: true };
}

export async function disableBiometricsLock(): Promise<{ ok: boolean; error?: string }> {
  const enabled = await getBiometricsLockEnabled();
  if (!enabled) {
    await setBiometricsLockEnabled(false);
    return { ok: true };
  }
  const avail = await getBiometricsAvailability();
  const ok = await authenticateWithBiometrics(`Turn off ${avail.label} lock`);
  if (!ok) return { ok: false, error: 'Authentication cancelled.' };
  await setBiometricsLockEnabled(false);
  return { ok: true };
}
