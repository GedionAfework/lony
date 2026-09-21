# Lony

Shared peer loan ledger — track personal loans, reminders, repayments, and payment profiles. Money moves outside the app.

Product rules and phases: [ROADMAP.md](ROADMAP.md). Ops notes: [RUNBOOK.md](RUNBOOK.md).

## Stack

- Mobile: Expo / React Native
- API: Go, Chi, sqlc, Goose
- Postgres 16 (system of record + reminder jobs)
- Redis listed in compose but unused until Asynq/FCM (deferred)

## Run locally

### 1. Database

```powershell
docker compose up -d
```

### 2. API

```powershell
cd apps/api
copy .env.example .env
go run ./cmd/api
```

Listens on `http://localhost:8080`. In development, register responses include `verification_code`.

```powershell
curl http://localhost:8080/health
```

### 3. Worker (required for reminders / overdue delivery)

Run in a second terminal. Marks overdue loans, delivers due reminder jobs into the in-app inbox, reconciles missing reminder jobs, and logs balance mismatches.

```powershell
cd apps/api
go run ./cmd/worker
```

Without the worker, loans still work; scheduled due reminders will not land in Activity until jobs are processed.

### 4. Mobile

```powershell
cd apps/mobile
npm start
```

Physical device / Expo Go: set `EXPO_PUBLIC_API_URL` to your PC LAN IP, e.g. `http://192.168.x.x:8080/api/v1`.

## Tests

```powershell
cd apps/api
go test ./...
```

```powershell
cd apps/mobile
npm run typecheck
```
