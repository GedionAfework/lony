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
  const url = mediaURL(path);
  // A picture seen before shows on the first frame: no placeholder flash.
  const [remoteUri, setRemoteUri] = useState<string | null>(() => (url ? memory.get(url) ?? null : null));

  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setRemoteUri(null);
      return;
    }
    const known = memory.get(url);
    setRemoteUri(known ?? null);
    if (!token) {
      setRemoteUri(url);
      return;
    }
    void resolveAvatar(url, token).then((uri) => {
      if (!cancelled && uri && uri !== known) setRemoteUri(uri);
    });
    return () => {
      cancelled = true;
    };
  }, [url, token]);

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

/** url → displayable uri, for this app session. */
const memory = new Map<string, string>();
/** One download per url at a time, however many avatars ask for it. */
const inflight = new Map<string, Promise<string | null>>();
/** A saved file is reused at once and refreshed in the background after this long. */
const REFRESH_MS = 6 * 60 * 60 * 1000;
const refreshed = new Set<string>();

function cacheFile(cacheDir: string, url: string): string {
  return `${cacheDir}avatar-${url.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)}`;
}

/**
 * The picture for url: from memory, else the file already on the phone (shown right away,
 * refreshed quietly if old), else downloaded once.
 */
async function resolveAvatar(url: string, token: string): Promise<string | null> {
  const hit = memory.get(url);
  if (hit && refreshed.has(url)) return hit;
  const running = inflight.get(url);
  if (running) return running;
  const job = (async () => {
    if (Platform.OS !== 'web') {
      try {
        const FileSystem = await import('expo-file-system/legacy');
        const cacheDir = FileSystem.cacheDirectory;
        if (cacheDir) {
          const dest = cacheFile(cacheDir, url);
          const info = await FileSystem.getInfoAsync(dest);
          if (info.exists && info.size) {
            memory.set(url, info.uri);
            const ageMs = Date.now() - (info.modificationTime ?? 0) * 1000;
            if (ageMs < REFRESH_MS) {
              refreshed.add(url);
              return info.uri;
            }
          }
        }
      } catch {
        /* download below */
      }
    }
    try {
      const loaded = await loadAuthenticatedImage(url, token);
      if (loaded?.uri) {
        const uri = loaded.uri;
        memory.set(url, uri);
        refreshed.add(url);
        return uri;
      }
    } catch {
      /* keep what we had */
    }
    return memory.get(url) ?? null;
  })();
  inflight.set(url, job);
  try {
    return await job;
  } finally {
    inflight.delete(url);
  }
}

/** Warms the cache so avatars in a list appear without waiting. */
export function prefetchAvatars(paths: (string | null | undefined)[], token?: string | null): void {
  if (!token) return;
  for (const p of paths) {
    const url = mediaURL(p);
    if (url && !memory.has(url)) void resolveAvatar(url, token);
  }
}

async function loadAuthenticatedImage(url: string, token: string): Promise<LoadedImage | null> {
  if (Platform.OS !== 'web') {
    try {
      const FileSystem = await import('expo-file-system/legacy');
      const cacheDir = FileSystem.cacheDirectory;
      if (cacheDir) {
        const dest = cacheFile(cacheDir, url);
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

/**
 * Any picture behind /api/v1/media (chat photos), with the same cache as avatars:
 * shown at once when seen before, downloaded once otherwise.
 */
export function AuthenticatedImage({
  path,
  token,
  width,
  height,
  radius = 14,
}: {
  path?: string | null;
  token?: string | null;
  width: number;
  height: number;
  radius?: number;
}) {
  const { colors } = useTheme();
  const url = mediaURL(path);
  const [uri, setUri] = useState<string | null>(() => (url ? memory.get(url) ?? null : null));
  useEffect(() => {
    let cancelled = false;
    if (!url) return;
    if (!token) {
      setUri(url);
      return;
    }
    void resolveAvatar(url, token).then((u) => {
      if (!cancelled && u) setUri(u);
    });
    return () => {
      cancelled = true;
    };
  }, [url, token]);
  return uri ? (
    <Image source={{ uri }} style={{ width, height, borderRadius: radius, backgroundColor: colors.surfaceMuted }} resizeMode="cover" />
  ) : (
    <View style={{ width, height, borderRadius: radius, backgroundColor: colors.surfaceMuted }} />
  );
}
