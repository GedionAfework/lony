import { useEffect, useState } from 'react';
import { Image, Platform, Text, View, type ImageStyle, type StyleProp } from 'react-native';
import { fonts, mediaURL, useTheme } from './theme';

type Props = {
  path?: string | null;
  /** Local file/data URI shown immediately (e.g. right after picking). */
  localUri?: string | null;
  token?: string | null;
  size?: number;
  fallbackLetter?: string;
  style?: StyleProp<ImageStyle>;
};

/**
 * Loads /api/v1/media/... with Bearer auth.
 * Avoids large data-URI payloads (RN Image often fails on multi-MB base64).
 * Native: FileSystem download → file:// URI. Web: blob: object URL.
 */
export function AuthenticatedAvatar({
  path,
  localUri,
  token,
  size = 96,
  fallbackLetter = '?',
  style,
}: Props) {
  const { colors } = useTheme();
  const [remoteUri, setRemoteUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setRemoteUri(null);
    const url = mediaURL(path);
    if (!url) return;

    (async () => {
      try {
        if (!token) {
          if (!cancelled) setRemoteUri(url);
          return;
        }
        const loaded = await loadAuthenticatedImage(url, token);
        if (cancelled) {
          if (loaded?.objectUrl) URL.revokeObjectURL(loaded.objectUrl);
          return;
        }
        if (loaded?.objectUrl) objectUrl = loaded.objectUrl;
        if (loaded?.uri) setRemoteUri(loaded.uri);
      } catch {
        /* keep fallback / local */
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, token]);

  // Prefer a successfully loaded remote; local covers the gap after picking / while loading.
  const uri = remoteUri || localUri || null;
  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: colors.surfaceMuted,
  };

  if (uri) {
    return <Image source={{ uri }} style={[frame, style]} />;
  }

  return (
    <View style={[frame, { alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: size * 0.3 }}>
        {fallbackLetter.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

type LoadedImage = { uri: string; objectUrl?: string };

async function loadAuthenticatedImage(url: string, token: string): Promise<LoadedImage | null> {
  if (Platform.OS !== 'web') {
    try {
      const FileSystem = await import('expo-file-system/legacy');
      const cacheDir = FileSystem.cacheDirectory;
      if (cacheDir) {
        const key = url.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
        const dest = `${cacheDir}avatar-${key}`;
        const result = await FileSystem.downloadAsync(url, dest, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'image/*' },
        });
        if (result.status === 200 && result.uri) {
          return { uri: result.uri };
        }
      }
    } catch {
      /* fall through */
    }
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'image/*' },
  });
  if (!res.ok) return null;

  const blob = await res.blob();
  if (!blob || blob.size === 0) return null;

  // Prefer blob: URLs (web) — avoids multi-MB data URIs that break RN Image.
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const objectUrl = URL.createObjectURL(blob);
    return { uri: objectUrl, objectUrl };
  }

  // Last resort: small images only as data URI.
  if (blob.size > 1_500_000) return null;
  const dataUri = await blobToDataUri(blob);
  return dataUri ? { uri: dataUri } : null;
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}
