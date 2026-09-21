# Deploy Lony API to Fly.io (free allowance)

Goal: friends can hit a public HTTPS API from Expo Go. Later you move the same Docker image to a VPS.

## 0. Install Fly CLI

https://fly.io/docs/hands-on/install-flyctl/

```powershell
fly auth login
```

## 1. Free Postgres (Neon — recommended)

Fly’s own Postgres is usually paid. For free:

1. Create a project at https://neon.tech
2. Copy the connection string (require SSL)
3. It looks like: `postgres://...@ep-....neon.tech/neondb?sslmode=require`

## 2. Create the Fly app

From `apps/api`:

```powershell
cd apps/api
fly apps create lony-api
fly volumes create lony_media --region fra --size 1
```

If `lony-api` is taken, change `app` in `fly.toml` and recreate.

## 3. Secrets (never commit these)

Generate a long JWT and bank key, then:

```powershell
fly secrets set `
  DATABASE_URL="postgres://USER:PASS@HOST/neondb?sslmode=require" `
  JWT_SECRET="paste-at-least-32-random-chars-here" `
  BANK_ENCRYPTION_KEY="64-hex-chars-32-bytes" `
  REDIS_URL="redis://127.0.0.1:6379"
```

Optional later:

```powershell
fly secrets set RESEND_API_KEY="re_..." MAIL_FROM="Lony <onboarding@resend.dev>"
fly secrets set GOOGLE_CLIENT_ID="..." TELEGRAM_BOT_TOKEN="..." TELEGRAM_BOT_USERNAME="..."
```

Notes:

- `APP_ENV=development` in `fly.toml` so verification codes still appear in the API response until you add Resend/SMTP.
- Redis is unused by the API process; reminders need a worker later. Fine to skip for the friend test.
- After email is configured: set `APP_ENV=production` via `fly secrets set APP_ENV=production` (or change `fly.toml` and redeploy).

## 4. Deploy

```powershell
cd apps/api
fly deploy
```

Check:

```powershell
fly status
fly open
# or
curl https://lony-api.fly.dev/health
```

## 5. Point the mobile app at Fly

In `apps/mobile/.env`:

```
EXPO_PUBLIC_API_URL=https://lony-api.fly.dev/api/v1
```

Restart Expo (`npx expo start -c`). Friends use Expo Go with the same URL baked in (or you distribute a preview build later).

## 6. Friend-test tip (less cold start)

While testing with people, keep one machine awake (uses free allowance faster):

Edit `fly.toml`:

```toml
auto_stop_machines = false
min_machines_running = 1
```

Then `fly deploy`. When idle, set them back to sleep to save credits.

## 7. Later: VPS

Same Dockerfile. On the VPS: Docker Compose with `api` + Postgres (+ Redis/worker). Point DNS + TLS (Caddy/nginx) at the API and change `EXPO_PUBLIC_API_URL`.
