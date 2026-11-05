import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './auth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';

// Each page loads only when opened, so the first screen (login) is small and fast.
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then((m) => ({ default: m.CategoriesPage })));
const ThemesPage = lazy(() => import('./pages/ThemesPage').then((m) => ({ default: m.ThemesPage })));
const AuditPage = lazy(() => import('./pages/AuditPage').then((m) => ({ default: m.AuditPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SystemPage = lazy(() => import('./pages/SystemPage').then((m) => ({ default: m.SystemPage })));
const ControlsPage = lazy(() => import('./pages/ControlsPage').then((m) => ({ default: m.ControlsPage })));
const TeamPage = lazy(() => import('./pages/RolesPage').then((m) => ({ default: m.TeamPage })));
const LocalizationPage = lazy(() => import('./pages/LocalizationPage').then((m) => ({ default: m.LocalizationPage })));

function PageLoader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
      <Loader2 size={22} strokeWidth={2} className="spin" />
    </div>
  );
}

function page(el: ReactNode) {
  return <Suspense fallback={<PageLoader />}>{el}</Suspense>;
}

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
        <Route index element={page(<OverviewPage />)} />
        <Route path="users" element={page(<UsersPage />)} />
        <Route path="categories" element={page(<CategoriesPage />)} />
        <Route path="themes" element={page(<ThemesPage />)} />
        <Route path="audit" element={page(<AuditPage />)} />
        <Route path="settings" element={page(<SettingsPage />)} />
        <Route path="system" element={page(<SystemPage />)} />
        <Route path="controls" element={page(<ControlsPage />)} />
        <Route path="team" element={page(<TeamPage />)} />
        <Route path="roles" element={<Navigate to="/team?tab=roles" replace />} />
        <Route path="localization" element={page(<LocalizationPage />)} />
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
