# Lony

Peer lending ledger **and** personal financial tracker: accounts & net worth, cashflow, budgets, goals, Insights, deterministic **Lony Trust (A–E)** grades for lenders, rule-based Analyst/Coach, and an operator admin console.

Money still moves **outside** Lony (not a bank, wallet, or payment processor).

- Product rules (legacy peer-loan): [ROADMAP.md](ROADMAP.md)
- Tracker vision & phase status: [FINANCIAL_TRACKER_ROADMAP.md](FINANCIAL_TRACKER_ROADMAP.md)
- Ops: [RUNBOOK.md](RUNBOOK.md)

## Stack

- Mobile: Expo / React Native (EAS-ready)
- API: Go, Chi, sqlc
- Admin: Vite React app (`apps/admin`)
- Postgres 16 (system of record + reminder job rows)
- Redis 7 + Asynq (worker scheduling)
- Push: Expo Push API (FCM/APNs under the hood via Expo)

## Auth

- Email + password + verification
- Google (`POST /auth/oauth` with `id_token`; mobile uses `expo-auth-session`)
- Telegram Login Widget (mobile opens `/auth/telegram/widget` → deep link `lony://oauth/telegram`)
- **WhatsApp:** not available — Meta does not provide consumer Sign-In OAuth (API returns 501)
- Admins: set `ADMIN_EMAILS` (comma-separated) so matching accounts get `role=admin` on API boot

## Run locally

### 1. Database + Redis

```powershell
docker compose up -d
```

### 2. API

```powershell
cd apps/api
copy .env.example .env
go run ./cmd/api
```

### 3. Worker (Asynq)

```powershell
cd apps/api
go run ./cmd/worker
```

Requires Redis. Delivers due reminders, overdue scans, reconcile, balance reports.

### 4. Mobile

```powershell
cd apps/mobile
npm start
```

Set `EXPO_PUBLIC_API_URL` to your LAN IP for Expo Go.

### 5. Admin console

```powershell
cd apps/admin
npm install
npm run dev
```

Open http://localhost:5174 (proxies `/api` to the local API). Sign in with an admin account.

Optional env:

- Mobile: `EXPO_PUBLIC_GOOGLE_CLIENT_ID`, `EXPO_PUBLIC_EAS_PROJECT_ID` (after `eas init`)
- API OAuth: `GOOGLE_CLIENT_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`
- API email: `RESEND_API_KEY` **or** `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`, plus `MAIL_FROM` (dev without these logs codes to the API response)
- Other: `EXPO_ACCESS_TOKEN`, `MEDIA_DIR`, `ADMIN_EMAILS`

### 6. EAS builds

```powershell
cd apps/mobile
npx eas-cli login
npx eas init
npx eas build --profile preview --platform android
```

### 7. Live test on Fly.io (free allowance)

See [apps/api/DEPLOY-FLY.md](apps/api/DEPLOY-FLY.md): deploy API to Fly, Postgres on Neon free, point Expo at `https://YOUR-APP.fly.dev/api/v1`. Later move the same image to a VPS.

## Privacy (Phase 7)

- `GET /me/export` — JSON (`?format=json`) or zip of profile, accounts, cashflow, loans, AI, Trust
- `POST /me/delete` — soft-delete + PII redact + session revoke (`confirm: "DELETE"`)
- `POST /ai/insights/clear` — dismiss AI history
- Admin: `POST /admin/settings/ai` — global AI kill switch

## OpenAPI

```powershell
# Spec lives in packages/shared/openapi.yaml
```
