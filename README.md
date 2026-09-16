# EquiLend

Shared peer loan ledger. Phase 1 is foundation: Go API auth + Expo sign-in shell.

Product rules and later phases live in [ROADMAP.md](ROADMAP.md).

## Stack

- Mobile: Expo / React Native
- API: Go, Chi, sqlc, Goose
- Postgres 16 + Redis (Redis unused until notifications)

## Run locally

### 1. Database

Start Docker Desktop, then:

```powershell
docker compose up -d
```

### 2. API

```powershell
cd apps/api
copy .env.example .env
go run ./cmd/api
```

The API listens on `http://localhost:8080`. In development, `POST /api/v1/auth/register` returns `verification_code` so you can verify without email.

```powershell
curl http://localhost:8080/health
```

### 3. Mobile

```powershell
cd apps/mobile
npm start
```

Set `EXPO_PUBLIC_API_URL` if the device cannot reach `http://localhost:8080/api/v1` (Android emulator: `http://10.0.2.2:8080/api/v1`).

## Tests

```powershell
cd apps/api
go test ./...
```
