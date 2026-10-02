# Host Lony Web on Fly.io (beta)

Friends open the **website** in a browser. The web app talks to your Fly API (`lony-api`).

Prerequisites: API already deployed (see `apps/api/DEPLOY-FLY.md`) at `https://lony-api.fly.dev` (or your app name).

---

## 1 — Install Fly CLI and log in

```powershell
fly auth login
```

---

## 2 — Create the web app

```powershell
cd C:\Users\Gedion\Documents\lony\apps\web
fly apps create lony-web
```

If the name is taken, edit `fly.toml` → `app = "lony-web-yourname"` and create that name instead.

---

## 3 — Point the build at your API

Edit `fly.toml` `[build.args]`:

```toml
VITE_API_BASE = "https://lony-api.fly.dev/api/v1"
```

Use your real API hostname **including** `/api/v1` (no trailing slash). The SPA bakes this in at **build** time.

Also allow the web origin on the API (CORS). In Fly API secrets / env, ensure your API accepts browser requests from `https://lony-web.fly.dev` if you restrict origins.

---

## 4 — Deploy

```powershell
cd C:\Users\Gedion\Documents\lony\apps\web
fly deploy
```

URL will be: `https://lony-web.fly.dev`

---

## 5 — Mobile beta (Expo)

Point mobile `.env` / `EXPO_PUBLIC_API_BASE` at the same API:

```
EXPO_PUBLIC_API_BASE=https://lony-api.fly.dev
```

Share Expo Go + the project, or a development build. Web beta testers only need the Fly URL.

---

## Redeploy after API URL change

Because `VITE_API_BASE` is compile-time, change `fly.toml` and run `fly deploy` again.
