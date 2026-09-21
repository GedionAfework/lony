import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import { api } from './api';

/** Register Expo push token. No-op in Expo Go (remote push throws on Android SDK 53+). */
export async function registerPushToken(access: string): Promise<void> {
  // Must not import expo-notifications in Expo Go — getDevicePushTokenAsync throws on Android.
  if (isRunningInExpoGo()) {
    return;
  }

  try {
    const Notifications = await import('expo-notifications');
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      return;
    }
    const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
    const push = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    if (!push.data.startsWith('ExponentPushToken[') && !push.data.startsWith('ExpoPushToken[')) {
      return;
    }
    await api.registerDeviceToken(access, Platform.OS === 'ios' ? 'ios' : 'android', push.data);
  } catch {
    /* Push unavailable — in-app inbox still works. */
  }
}
