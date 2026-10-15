# Lony backend

API, worker, admin console, OpenAPI spec, and local Postgres/Redis. This folder can become its own repo later.

| Path | Role |
|---|---|
| `api/` | Go API + Asynq worker |
| `admin/` | Operator Vite app (https://lony-admin.fly.dev) |
| `shared/` | OpenAPI spec and generated types |
| `docker-compose.yml` | Postgres 16 + Redis 7 |

## Run

```powershell
cd backend
docker compose up -d

cd api
copy .env.example .env
go run ./cmd/api

# other terminal
go run ./cmd/worker

# other terminal
cd ..\admin
npm install
npm run dev
```

API: http://127.0.0.1:8080  
Admin: http://localhost:5174
