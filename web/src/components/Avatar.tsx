import { useEffect, useState } from 'react';
import { apiBaseUrl } from '../lib/api';
import { hueFor } from './Visuals';

function resolveMediaUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:') || path.startsWith('data:')) {
    return path;
  }
  if (apiBaseUrl.startsWith('http')) {
    return `${apiBaseUrl.replace(/\/api\/v1$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

// Photos are private, so they are fetched with the sign-in token and kept for the
// whole visit: every avatar of the same person appears at once after the first load.
const loaded = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function loadAvatar(src: string, token?: string | null): Promise<string | null> {
  const hit = loaded.get(src);
  if (hit) return Promise.resolve(hit);
  const busy = pending.get(src);
  if (busy) return busy;
  const url = resolveMediaUrl(src);
  const needsAuth = Boolean(token) && !src.startsWith('blob:') && !src.startsWith('data:');
  const job = (async () => {
    try {
      if (!needsAuth) {
        loaded.set(src, url);
        return url;
      }
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const objectUrl = URL.createObjectURL(await res.blob());
      loaded.set(src, objectUrl);
      return objectUrl;
    } catch {
      return null;
    } finally {
      pending.delete(src);
    }
  })();
  pending.set(src, job);
  return job;
}

/** After an upload, show the picked file right away under the new photo address. */
export function primeAvatar(src: string | null | undefined, file: Blob) {
  if (!src) return;
  loaded.set(src, URL.createObjectURL(file));
}

export function Avatar({
  src,
  token,
  letter = '?',
  size,
  className,
}: {
  src?: string | null;
  token?: string | null;
  /** A name or a letter: the first letter shows until the photo loads. */
  letter?: string;
  size?: number;
  className?: string;
}) {
  const [uri, setUri] = useState<string | null>(() => (src ? loaded.get(src) ?? null : null));

  useEffect(() => {
    if (!src) {
      setUri(null);
      return;
    }
    const hit = loaded.get(src);
    if (hit) {
      setUri(hit);
      return;
    }
    let cancelled = false;
    setUri(null);
    void loadAvatar(src, token).then((u) => {
      if (!cancelled) setUri(u);
    });
    return () => {
      cancelled = true;
    };
  }, [src, token]);

  const color = hueFor(letter || '?');
  const style = {
    ...(size ? { width: size, height: size, fontSize: Math.round(size * 0.38) } : {}),
    ...(uri ? {} : { color, background: `color-mix(in srgb, ${color} 16%, transparent)` }),
  };
  return (
    <div className={['avatar', className].filter(Boolean).join(' ')} style={style}>
      {uri ? <img src={uri} alt="" /> : (letter.trim().slice(0, 1) || '?').toUpperCase()}
    </div>
  );
}

/** Crops a picked photo to a centred square, 512px, JPEG: small and quick to upload. */
export async function prepareAvatar(file: File): Promise<{ blob: Blob; base64: string; mime: string; filename: string }> {
  const fallback = async () => {
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result || '');
        resolve(s.slice(s.indexOf(',') + 1));
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    return { blob: file as Blob, base64, mime: file.type || 'image/jpeg', filename: file.name };
  };
  try {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const out = Math.min(512, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback();
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) return fallback();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    return { blob, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mime: 'image/jpeg', filename: 'avatar.jpg' };
  } catch {
    return fallback();
  }
}
