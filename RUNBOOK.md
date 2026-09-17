# Lony runbook (MVP)

Operational notes for local and staging. Phase 8 ships report-only balance reconciliation and in-memory rate limits; production Redis/Asynq and EAS builds come later.

## Processes

| Process | Command | Role |
|---|---|---|
| API | `cd apps/api && go run ./cmd/api` | HTTP `/api/v1`, migrations on boot |
| Worker | `cd apps/api && go run ./cmd/worker` | Overdue scan, reminder delivery, reminder rebuild, **balance mismatch logs** |
| Postgres | `docker compose up -d` | System of record |
| Mobile | `cd apps/mobile && npx expo start` | Expo client |

## Database

- Backup (local): `pg_dump -Fc "$DATABASE_URL" > backup.dump`
- Restore: `pg_restore -d "$DATABASE_URL" --clean --if-exists backup.dump`
- Migrations apply automatically from `apps/api/db` on API/worker start.
- Never silent-fix money columns. Balance mismatches are **logged only** by the worker.

## Secrets rotation

| Secret | Env | Notes |
|---|---|---|
| JWT signing | `JWT_SECRET` | Rotate by deploying new secret; existing access tokens expire with TTL. Users re-login. |
| Bank field encryption | `BANK_ENCRYPTION_KEY` | 32-byte key. Changing it without re-encrypting profiles makes reveals fail. Rotate offline with a re-encrypt job before cutting over. |
| DB URL | `DATABASE_URL` | Rotate credentials in Postgres then update env and restart API + worker. |

## Rate limits / idempotency

- Auth routes: ~30 req/min/IP (in-memory).
- Authenticated API: ~180 req/min/IP (in-memory).
- Optional `Idempotency-Key` on mutating POSTs; replay returns the stored response. Same key + different body → `409 IDEMPOTENCY_MISMATCH`.

## Push / queue

- Dev push uses `LogPusher` (no FCM/APNs). Device tokens still register.
- Reminder jobs live in Postgres (`notification_jobs`). Worker rebuilds missing keys from open loan due dates.
- Alerts (MVP): watch worker logs for `balance mismatch`, `reminder jobs`, and API `RATE_LIMITED`.

## Health

- `GET /health` — process up + Postgres ping.
- If health fails: check Postgres container, `DATABASE_URL`, then restart API.

## Incident cues

1. **Users cannot register / login** — check rate limit (wait 1m), JWT secret, and verification challenges table.
2. **Loan amounts disagree on dashboard** — run worker; inspect `balance mismatch` lines; do **not** UPDATE outstanding manually without an audited repair path.
3. **Bank reveal fails after deploy** — confirm `BANK_ENCRYPTION_KEY` matches the key used at encrypt time.
4. **Reminders missing** — ensure worker is running; reconcile rebuilds deterministic job keys.
