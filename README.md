# Lony

Telegram-style peer lending social app: chat about loans, share payment profiles, track repayments. Money moves outside Lony.

Product rules: [ROADMAP.md](ROADMAP.md). Ops: [RUNBOOK.md](RUNBOOK.md).

## Stack

- Mobile: Expo / React Native (EAS-ready)
- API: Go, Chi, sqlc
- Postgres 16 (system of record + reminder job rows)
- Redis 7 + Asynq (worker scheduling)
- Push: Expo Push API (FCM/APNs under the hood via Expo)

## Auth

- Email + password + verification
- Google (`POST /auth/oauth` with `id_token`; mobile uses `expo-auth-session`)
- Telegram Login Widget (mobile opens `/auth/telegram/widget` → deep link `lony://oauth/telegram`)
- **WhatsApp:** not available — Meta does not provide consumer Sign-In OAuth (API returns 501)

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

Optional env:

- Mobile: `EXPO_PUBLIC_GOOGLE_CLIENT_ID`, `EXPO_PUBLIC_EAS_PROJECT_ID` (after `eas init`)
- API OAuth: `GOOGLE_CLIENT_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`
- API email: `RESEND_API_KEY` **or** `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`, plus `MAIL_FROM` (dev without these logs codes to the API response)
- Other: `EXPO_ACCESS_TOKEN`, `MEDIA_DIR`

### 5. EAS builds

```powershell
cd apps/mobile
npx eas-cli login
npx eas init
npx eas build --profile preview --platform android
```

### 6. Live test on Fly.io (free allowance)

See [apps/api/DEPLOY-FLY.md](apps/api/DEPLOY-FLY.md): deploy API to Fly, Postgres on Neon free, point Expo at `https://YOUR-APP.fly.dev/api/v1`. Later move the same image to a VPS.

## OpenAPI

```powershell
cd packages/shared
npm run openapi:types
```

Generates `packages/shared/generated/api.ts`. Mobile still uses `apps/mobile/src/api.ts` as the runtime client.

## Tests

```powershell
cd apps/api
go test ./...
```
