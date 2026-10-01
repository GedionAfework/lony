# Lony

Peer lending ledger **and** personal financial tracker: accounts & net worth, cashflow, budgets, goals, Insights, deterministic **Lony Trust (A–E)** grades for lenders, LLM-backed Analyst / Visualizer / Coach (Premium; OpenAI-compatible providers such as Groq), and an operator admin console.

Money still moves **outside** Lony (not a bank, wallet, or payment processor).

- Product rules (legacy peer-loan): [ROADMAP.md](ROADMAP.md)
- Tracker vision & phase status: [FINANCIAL_TRACKER_ROADMAP.md](FINANCIAL_TRACKER_ROADMAP.md)
- Ops: [RUNBOOK.md](RUNBOOK.md)

## Stack

- Mobile: Expo / React Native (EAS-ready)
- User website: Vite React app (`apps/web`)
- API: Go, Chi, sqlc
- Admin: Vite React app (`apps/admin`)
- Postgres 16 (system of record + reminder job rows)
- Redis 7 + Asynq (worker scheduling)
- Push: Expo Push API (FCM/APNs under the hood via Expo)

## Auth

- Email + password + verification (+ resend)
- Forgot / reset password (email code)
- Change password (signed-in)
- Google (`POST /auth/oauth` with `id_token`; mobile uses `expo-auth-session`)
- Telegram Login Widget (mobile opens `/auth/telegram/widget` → deep link `lony://oauth/telegram`)
- **WhatsApp:** not available — Meta does not provide consumer Sign-In OAuth (API returns 501)
- Admins: set `ADMIN_EMAILS` (comma-separated) so matching accounts get `role=admin` on API boot
- Access JWTs are bound to sessions; logout / password reset revoke the session immediately

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

### 5. User website

```powershell
cd apps/web
npm install
npm run dev
```

Open http://localhost:8082 (proxies `/api` to the local API). This is the product web app — not Expo web.

### 6. Admin console

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

### 6. EAS builds (store readiness — you do this)

Product code is ready for device builds; Apple/Google distribution still needs your accounts:

```powershell
cd apps/mobile
npx eas-cli login
npx eas init
# set EXPO_PUBLIC_EAS_PROJECT_ID in apps/mobile/.env and app.json extra.eas.projectId
npx eas build --profile preview --platform android
```

Also run the API worker (`go run ./cmd/worker`) with Redis for reminders/overdue jobs in production.

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
