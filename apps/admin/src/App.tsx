import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './auth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { UsersPage } from './pages/UsersPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { ThemesPage } from './pages/ThemesPage';
import { AuditPage } from './pages/AuditPage';
import { SettingsPage } from './pages/SettingsPage';
import { LocalizationPage } from './pages/LocalizationPage';

function FullScreenLoader() {
  return (
    <div className="fullscreen-loader">
      <Loader2 size={26} strokeWidth={2} className="spin" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { token, me, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!token || !me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { token, me, loading } = useAuth();
  const authenticated = Boolean(token && me);

  return (
    <Routes>
      <Route path="/login" element={authenticated ? <Navigate to="/" replace /> : loading ? <FullScreenLoader /> : <LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="themes" element={<ThemesPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="roles" element={<Navigate to="/users?tab=roles" replace />} />
        <Route path="localization" element={<LocalizationPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
