import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setTokenRefresher, type User } from '../lib/api';
import { applyDocumentDirection, parseLocaleMessages, setActivePack } from '../i18n';

export const TOKEN_KEY = 'lony_web_token';
export const REFRESH_KEY = 'lony_web_refresh';

type AuthContextValue = {
  token: string | null;
  user: User | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  setUser: (user: User | null) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string, accepted: boolean) => Promise<{ verification_code?: string; email: string }>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  persistSession: (access: string, refresh: string, user: User) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function hydrateLocalePack(localeCode: string) {
  const code = localeCode || 'en';
  try {
    const res = await api.listLocales(code);
    if ('locale' in res && res.locale) {
      setActivePack({
        locale: res.locale.code,
        name: res.locale.name,
        dir: res.locale.dir,
        messages: parseLocaleMessages(res.locale.messages),
      });
      applyDocumentDirection(res.locale.code);
      return;
    }
  } catch {
    /* bundled English */
  }
  setActivePack({ locale: code });
  applyDocumentDirection(code);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setUser = useCallback((next: User | null) => {
    setUserState(next);
    if (next?.locale) {
      void hydrateLocalePack(next.locale);
    } else {
      applyDocumentDirection('en');
    }
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setToken(null);
    setUserState(null);
    applyDocumentDirection('en');
  }, []);

  const persistSession = useCallback(
    (access: string, refresh: string, nextUser: User) => {
      localStorage.setItem(TOKEN_KEY, access);
      localStorage.setItem(REFRESH_KEY, refresh);
      setToken(access);
      setUser(nextUser);
    },
    [setUser],
  );

  useEffect(() => {
    setTokenRefresher(async () => {
      const refresh = localStorage.getItem(REFRESH_KEY);
      if (!refresh) return null;
      try {
        const res = await api.refresh(refresh);
        localStorage.setItem(TOKEN_KEY, res.access_token);
        localStorage.setItem(REFRESH_KEY, res.refresh_token);
        setToken(res.access_token);
        setUser(res.user);
        return res.access_token;
      } catch {
        clearSession();
        return null;
      }
    });
    return () => setTokenRefresher(null);
  }, [clearSession, setUser]);

  const refreshMe = useCallback(async () => {
    const tok = localStorage.getItem(TOKEN_KEY);
    if (!tok) {
      setUser(null);
      return;
    }
    const res = await api.me(tok);
    setUser(res.user);
  }, [setUser]);

  useEffect(() => {
    if (!token) {
      setUserState(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .me(token)
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        if (!cancelled) clearSession();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, clearSession, setUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await api.login(email.trim(), password);
        persistSession(res.access_token, res.refresh_token, res.user);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Login failed');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [persistSession],
  );

  const register = useCallback(
    async (email: string, password: string, displayName: string, accepted: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const res = await api.register(email.trim(), password, displayName.trim(), accepted);
        return { verification_code: res.verification_code, email: email.trim() };
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Registration failed');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    const access = localStorage.getItem(TOKEN_KEY);
    if (access) {
      try {
        await api.logout(access);
      } catch {
        /* ignore */
      }
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      busy,
      error,
      clearError: () => setError(null),
      setUser,
      login,
      register,
      logout,
      refreshMe,
      persistSession,
    }),
    [token, user, loading, busy, error, login, register, logout, refreshMe, persistSession, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
