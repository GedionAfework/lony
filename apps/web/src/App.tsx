import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { ToastProvider } from './components/Toast';
import { AppShell } from './layout/AppShell';

import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { VerifyPage } from './pages/auth/VerifyPage';
import { ForgotPage } from './pages/auth/ForgotPage';
import { ResetPage } from './pages/auth/ResetPage';

import { OnboardingPage } from './pages/OnboardingPage';
import { TosPage } from './pages/TosPage';
import { HomePage } from './pages/HomePage';
import { CashflowNewPage } from './pages/CashflowNewPage';
import { CashflowShowPage } from './pages/CashflowShowPage';
import { AccountsPage } from './pages/AccountsPage';
import { LoansPage } from './pages/LoansPage';
import { LoanNewPage } from './pages/LoanNewPage';
import { LoanDetailPage } from './pages/LoanDetailPage';
import { InstallmentPage } from './pages/InstallmentPage';
import { ChatsPage } from './pages/ChatsPage';
import { ChatThreadPage } from './pages/ChatThreadPage';
import { ChatSearchPage } from './pages/ChatSearchPage';
import { PeerProfilePage } from './pages/PeerProfilePage';
import { InsightsPage } from './pages/InsightsPage';
import { PlanPage } from './pages/PlanPage';
import { BanksPage } from './pages/BanksPage';
import { SettingsPage } from './pages/SettingsPage';
import { ThemesPage } from './pages/ThemesPage';
import { AdminPage } from './pages/AdminPage';

function Splash() {
  return (
    <div className="center-page">
      <div className="spinner" />
    </div>
  );
}

/** Gate for routes that require a signed-in, fully onboarded user. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { token, user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!token || !user) return <Navigate to="/login" replace />;
  if (!user.profile_complete) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/** Gate for the onboarding page: must be signed in, but not yet complete. */
function RequireIncompleteProfile({ children }: { children: ReactNode }) {
  const { token, user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!token || !user) return <Navigate to="/login" replace />;
  if (user.profile_complete) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Gate for auth pages: redirect away if already signed in. */
function RequireGuest({ children }: { children: ReactNode }) {
  const { token, user, loading } = useAuth();
  if (loading) return <Splash />;
  if (token && user) return <Navigate to={user.profile_complete ? '/' : '/onboarding'} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<RequireGuest><LoginPage /></RequireGuest>} />
          <Route path="/register" element={<RequireGuest><RegisterPage /></RequireGuest>} />
          <Route path="/verify" element={<RequireGuest><VerifyPage /></RequireGuest>} />
          <Route path="/forgot" element={<RequireGuest><ForgotPage /></RequireGuest>} />
          <Route path="/reset" element={<RequireGuest><ResetPage /></RequireGuest>} />

          <Route path="/tos" element={<TosPage />} />
          <Route
            path="/onboarding"
            element={
              <RequireIncompleteProfile>
                <OnboardingPage />
              </RequireIncompleteProfile>
            }
          />

          <Route
            path="/"
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<HomePage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="cashflow" element={<HomePage />} />
            <Route path="cashflow/new" element={<CashflowNewPage />} />
            <Route path="cashflow/:entryId/edit" element={<CashflowNewPage />} />
            <Route path="cashflow/:entryId" element={<CashflowShowPage />} />
            <Route path="loans" element={<LoansPage />} />
            <Route path="loans/new" element={<LoanNewPage />} />
            <Route path="loans/:loanId" element={<LoanDetailPage />} />
            <Route path="loans/:loanId/installments/:installmentId" element={<InstallmentPage />} />
            <Route path="chats" element={<ChatsPage />} />
            <Route path="chats/search" element={<ChatSearchPage />} />
            <Route path="chats/:peerId" element={<ChatThreadPage />} />
            <Route path="people/:peerId" element={<PeerProfilePage />} />
            <Route path="insights" element={<InsightsPage />} />
            <Route path="plan" element={<PlanPage />} />
            <Route path="banks" element={<BanksPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="themes" element={<ThemesPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
