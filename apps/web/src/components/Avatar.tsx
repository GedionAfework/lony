import { useEffect, useState } from 'react';
import { apiBaseUrl } from '../lib/api';

function resolveMediaUrl(path: string): string {
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('blob:') ||
    path.startsWith('data:')
  ) {
    return path;
  }
  if (apiBaseUrl.startsWith('http')) {
    return `${apiBaseUrl.replace(/\/api\/v1$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

export function Avatar({
  src,
  token,
  letter = '?',
  size,
}: {
  src?: string | null;
  token?: string | null;
  letter?: string;
  size?: number;
}) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUri(null);
    if (!src) return;
    const url = resolveMediaUrl(src);
    const needsAuth = Boolean(token) && !src.startsWith('blob:') && !src.startsWith('data:');

    (async () => {
      try {
        if (!needsAuth) {
          if (!cancelled) setUri(url);
          return;
        }
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUri(objectUrl);
      } catch {
        /* keep letter fallback */
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, token]);

  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : undefined;
  return (
    <div className="avatar" style={style}>
      {uri ? <img src={uri} alt="" /> : letter.slice(0, 1).toUpperCase()}
    </div>
  );
}
