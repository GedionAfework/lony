import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { apiBaseUrl } from './theme';

WebBrowser.maybeCompleteAuthSession();

const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? '';
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || googleClientId;
const googleAndroidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim() || googleClientId;

export function useGoogleIdTokenAuth() {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: googleClientId || 'placeholder.apps.googleusercontent.com',
    iosClientId: googleIosClientId || undefined,
    androidClientId: googleAndroidClientId || undefined,
    webClientId: googleClientId || undefined,
  });

  return {
    configured: Boolean(googleClientId),
    ready: Boolean(googleClientId) && request != null,
    response,
    promptAsync,
  };
}

export function idTokenFromGoogleResponse(
  response: {
    type: string;
    params?: Record<string, string>;
    authentication?: { idToken?: string | null } | null;
  } | null,
): string | null {
  if (!response || response.type !== 'success') {
    return null;
  }
  const fromParams = response.params?.id_token;
  if (typeof fromParams === 'string' && fromParams.length > 0) {
    return fromParams;
  }
  const idToken = response.authentication?.idToken;
  if (typeof idToken === 'string' && idToken.length > 0) {
    return idToken;
  }
  return null;
}

export function telegramWidgetURL(): string {
  const root = apiBaseUrl.replace(/\/api\/v1\/?$/, '');
  const redirect = encodeURIComponent('lony://oauth/telegram');
  return `${root}/auth/telegram/widget?redirect=${redirect}`;
}

export async function openTelegramLogin(): Promise<Record<string, string> | null> {
  const url = telegramWidgetURL();
  const result = await WebBrowser.openAuthSessionAsync(url, 'lony://oauth/telegram');
  if (result.type !== 'success' || !('url' in result) || !result.url) {
    return null;
  }
  return parseTelegramDeepLink(result.url);
}

export function parseTelegramDeepLink(url: string): Record<string, string> | null {
  try {
    const parsed = new URL(url.replace(/^lony:/, 'https:'));
    const fields: Record<string, string> = {};
    parsed.searchParams.forEach((v, k) => {
      if (v) {
        fields[k] = v;
      }
    });
    if (!fields.id || !fields.hash) {
      return null;
    }
    return fields;
  } catch {
    return null;
  }
}

export function googleConfigured(): boolean {
  return Boolean(googleClientId) || Boolean(process.env.EXPO_PUBLIC_GOOGLE_ID_TOKEN?.trim());
}

export function platformHint(): string {
  return Platform.OS;
}
