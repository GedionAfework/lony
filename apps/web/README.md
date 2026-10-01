# Lony user website

Vite + React product web app. **Mobile-first for MVP** — web covers the same core flows (accounts, cashflow, loans, chats, insights, plan, settings) with desktop layouts. Native-only extras are called out below.

## Run

```bash
npm install
npm run dev
```

Open **http://localhost:8082**. Vite proxies `/api` → `http://127.0.0.1:8080`.

Optional:

```bash
# PowerShell
$env:VITE_API_BASE="/api/v1"
$env:VITE_API_PROXY="http://127.0.0.1:8080"
npm run dev
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev server on port 8082 |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Preview production build |

## Auth

Same email/password API as mobile. Full ops console is separate (`apps/admin` on :5174). The in-app Admin page is a thin KPI + AI kill switch with a link to that console.

## Notes / parity

- Chat voice notes are native-only (omitted on web).
- Offline cashflow drafts are mobile-only for now.
- Bank-link OAuth opens the provider flow in a new tab; use Sync after linking (requires API `PLAID_*`).
- Themes: light/dark in Settings; system themes from the API match mobile.
- Insights AI (Analysis / Reports / Coach) requires Premium; admins always have access.
