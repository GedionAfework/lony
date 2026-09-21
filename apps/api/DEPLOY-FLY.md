# Host Lony on Fly.io — step by step

You will host the **API** on Fly. Friends use **Expo Go** on their phones. Postgres is free on **Neon**. Redis/worker can wait.

---

## Step 1 — Install Fly CLI and log in

1. Install: https://fly.io/docs/hands-on/install-flyctl/
2. Open PowerShell:

```powershell
fly auth login
```

Browser opens → sign in / create a Fly account.

---

## Step 2 — Create a free Postgres database (Neon)

1. Go to https://neon.tech → sign up
2. Create a project (any name, e.g. `lony`)
3. Open **Connection details** → copy the URI  
   It should look like:

```
postgres://neondb_owner:xxxx@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

Keep this secret. You will paste it into Fly in Step 4.

---

## Step 3 — Create the Fly app + media volume

```powershell
cd C:\Users\Gedion\Documents\lony\apps\api
```

If the name `lony-api` is free:

```powershell
fly apps create lony-api
fly volumes create lony_media --region fra --size 1
```

If the name is taken:

1. Edit `fly.toml` → change `app = "lony-api"` to something unique, e.g. `lony-api-gedion`
2. Run:

```powershell
fly apps create lony-api-gedion
fly volumes create lony_media --region fra --size 1
```

Remember your app name — the URL will be `https://YOUR-APP-NAME.fly.dev`.

---

## Step 4 — Generate secrets and set them on Fly

In PowerShell (same `apps\api` folder):

```powershell
# JWT (long random string)
$jwt = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })

# Bank encryption key (64 hex chars = 32 bytes)
$bank = -join ((0..63) | ForEach-Object { "{0:x}" -f (Get-Random -Max 16) })

Write-Host "JWT_SECRET=$jwt"
Write-Host "BANK_ENCRYPTION_KEY=$bank"
```

Then set secrets (replace the Neon URL and use the values printed above):

```powershell
fly secrets set `
  DATABASE_URL="PASTE_NEON_URI_HERE" `
  JWT_SECRET="PASTE_JWT_HERE" `
  BANK_ENCRYPTION_KEY="PASTE_BANK_KEY_HERE" `
  REDIS_URL="redis://127.0.0.1:6379"
```

Do **not** commit these. Do **not** paste them into chat.

---

## Step 5 — Deploy

```powershell
cd C:\Users\Gedion\Documents\lony\apps\api
fly deploy
```

First build can take a few minutes. When it finishes:

```powershell
fly status
curl https://YOUR-APP-NAME.fly.dev/health
```

You want: `{"status":"ok"}` (or similar). If health fails, check logs:

```powershell
fly logs
```

---

## Step 6 — Point the mobile app at Fly

Create or edit `apps\mobile\.env`:

```
EXPO_PUBLIC_API_URL=https://YOUR-APP-NAME.fly.dev/api/v1
```

Restart Expo with a clean cache:

```powershell
cd C:\Users\Gedion\Documents\lony\apps\mobile
npx expo start -c
```

Open Expo Go on your phone → scan the QR. Register an account. In **development** mode, the API returns `verification_code` in the register response (and in logs) until you add real email.

---

## Step 7 — Share with friends

1. They install **Expo Go**
2. You either:
   - Start Expo and share the **tunnel** QR (`npx expo start --tunnel`), or
   - Later: build a preview APK with EAS that has the Fly URL baked in

Everyone hits the **same** Fly API, so accounts/friends/loans are shared.

---

## Step 8 (optional) — Fewer cold starts while testing

Edit `apps/api/fly.toml`:

```toml
auto_stop_machines = false
min_machines_running = 1
```

```powershell
fly deploy
```

This keeps one machine awake (uses free allowance faster). When idle for days, set them back to sleep and redeploy.

---

## Step 9 (optional later) — Real email

1. Resend.com → API key + from address  
2. On Fly:

```powershell
fly secrets set RESEND_API_KEY="re_..." MAIL_FROM="Lony <you@yourdomain.com>"
fly secrets set APP_ENV=production
```

Or set `APP_ENV=production` in `fly.toml` and `fly deploy`.

---

## Checklist

- [ ] `fly auth login`
- [ ] Neon database created
- [ ] `fly apps create` + volume
- [ ] `fly secrets set` (DATABASE_URL, JWT, BANK key)
- [ ] `fly deploy` → `/health` OK
- [ ] Mobile `.env` → Fly URL
- [ ] `npx expo start -c` → register works

## Later: VPS

Same `Dockerfile`. Run with Docker Compose on the VPS, put TLS in front, change `EXPO_PUBLIC_API_URL` once.
