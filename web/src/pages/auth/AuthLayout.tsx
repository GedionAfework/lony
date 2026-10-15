import type { ReactNode } from 'react';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-brand-panel">
        <img src="/lony-logo.png" alt="Lony" className="auth-brand-logo" width={96} height={96} />
        <div className="auth-brand-copy">
          <h1>Track money with people you trust.</h1>
          <p>
            Shared ledgers, peer loans, and cashflow tracking in one place. Lony helps you see who owes who,
            plan ahead, and keep spending honest — without becoming a bank.
          </p>
        </div>
        <div className="auth-brand-foot">
          Lony is a shared ledger and reminder app, not a bank, wallet, escrow, or payment processor. Money
          moves outside the app. Records are for personal tracking only.
        </div>
      </div>
      <div className="auth-form-panel">
        <div className="auth-form-box">
          <img src="/lony-logo.png" alt="Lony" className="auth-form-logo" width={72} height={72} />
          {children}
        </div>
      </div>
    </div>
  );
}
