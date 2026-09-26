# Lony Admin

Operator console for Phase 6. Uses the same email/password auth as the mobile app; the account must have `role=admin`.

## Setup

1. Promote an admin (API env):

```env
ADMIN_EMAILS=you@example.com
```

On API boot, matching users are set to `role=admin`. Or run:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

2. Run the API (`apps/api`).

3. Install and start the admin UI:

```bash
cd apps/admin
npm install
npm run dev
```

Open http://localhost:5174 — Vite proxies `/api` to `http://127.0.0.1:8080`.

Optional: `VITE_API_BASE=https://your-api.example.com` for a remote API (no proxy).

## Features (v1)

- Overview KPIs (users, DAU/WAU, loans, cashflow, AI insights)
- User search / filter / detail (trust grade, loans, cashflow)
- Suspend / unsuspend (revokes sessions; cannot suspend other admins)
- Audit log of admin actions
