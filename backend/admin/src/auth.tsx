import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setAdminTokenRefresher, type PublicUser } from './api';

export const TOKEN_KEY = 'lony_admin_token';
export const REFRESH_KEY = 'lony_admin_refresh';

type AuthContextValue = {
  token: string | null;
  me: PublicUser | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPerm: (code: string) => boolean;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [me, setMe] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setToken(null);
    setMe(null);
  }, []);

  useEffect(() => {
    setAdminTokenRefresher(async () => {
      const refresh = localStorage.getItem(REFRESH_KEY);
      if (!refresh) return null;
      try {
        const res = await api.refresh(refresh);
        localStorage.setItem(TOKEN_KEY, res.access_token);
        localStorage.setItem(REFRESH_KEY, res.refresh_token);
        setToken(res.access_token);
        return res.access_token;
      } catch {
        clearSession();
        return null;
      }
    });
    return () => setAdminTokenRefresher(null);
  }, [clearSession]);

  const loadMe = useCallback(async (tok: string) => {
    const res = await api.me(tok);
    if (res.user.role !== 'admin') {
      throw new Error('This account does not have admin access.');
    }
    setMe({
      ...res.user,
      admin_permissions: res.admin_permissions ?? res.user.admin_permissions,
      admin_role: res.admin_role ?? res.user.admin_role,
    });
  }, []);

  useEffect(() => {
    if (!token) {
      setMe(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadMe(token)
      .catch((e) => {
        if (cancelled) return;
        clearSession();
        setError(e instanceof Error ? e.message : 'Session expired. Please sign in again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, loadMe, clearSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await api.login(email.trim(), password);
        if (res.user.role !== 'admin') {
          throw new Error('Signed in, but this account is not an admin.');
        }
        localStorage.setItem(TOKEN_KEY, res.access_token);
        localStorage.setItem(REFRESH_KEY, res.refresh_token);
        setToken(res.access_token);
        await loadMe(res.access_token);
      } catch (err) {
        clearSession();
        const message = err instanceof Error ? err.message : 'Login failed';
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [loadMe, clearSession],
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

  const hasPerm = useCallback(
    (code: string) => {
      if (!me || me.role !== 'admin') return false;
      if (!me.admin_permissions) return true; // legacy admin without RBAC data: full access
      return me.admin_permissions.includes(code);
    },
    [me],
  );

  const refreshMe = useCallback(async () => {
    if (!token) return;
    await loadMe(token);
  }, [token, loadMe]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      me,
      loading,
      busy,
      error,
      clearError: () => setError(null),
      login,
      logout,
      hasPerm,
      refreshMe,
    }),
    [token, me, loading, busy, error, login, logout, hasPerm, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
