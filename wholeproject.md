# Lony — Whole Project Specification

**Document purpose:** One place that describes what Lony is, what it does, what it looks like, and how every major surface and operation works.

**Codebase:** Monorepo at `lony/` with three product folders ready to become three repos:

| Folder | Role |
|--------|------|
| `backend/` | Go API, Asynq worker, admin Vite app, OpenAPI, shared i18n, Docker Compose |
| `web/` | User website (Vite + React) |
| `mobile/` | User mobile app (Expo + React Native) |

**Related docs:** `README.md`, `ROADMAP.md` (peer-loan SRS plan), `FINANCIAL_TRACKER_ROADMAP.md` (full money app vision), `AI_PERSONAS_ROADMAP.md`, `RUNBOOK.md`, `mobile/DESIGN.md`.

**Last written from the live codebase layout** (backend / web / mobile).

---

## 1. What Lony is

Lony is a **hosted multi-tenant personal-finance SaaS** that combines:

1. **Peer loan ledger** — two people (or a person and an institution) record a loan, accept shared terms, track repayment claims and confirmations, and get reminders. Money moves **outside** the app (bank transfer, telebirr, cash, etc.).
2. **Personal money tracker** — wallets/accounts and net worth, income and expenses, budgets and payday pacing, bills/subscriptions, trip budgets, spending calendar, goals/plans, and Insights.
3. **Premium LLM advisors** — Analyst, Visualizer, and Coach (OpenAI-compatible HTTP; e.g. Groq). Deterministic **Lony Trust (A–E)** for lenders is separate from the LLM.
4. **Operator admin console** — KPIs, users, plan tiers, RBAC, catalogs, themes, localization, AI kill switch.

### Hard product rules

- Lony is **not** a bank, wallet, escrow, or payment processor.
- Lony **never holds funds**, never initiates transfers, does not score bureau credit, and does not collect debt.
- Product copy: **“shared ledger and reminders.”** Never “legally binding,” never “official credit score.”
- Payment **profiles** (how to get paid) are separate from **accounts** (how much you have).

### SaaS / multi-tenant model

- Every user belongs to the shared multi-tenant API with their own data scoped by JWT / user ID.
- `plan_tier` is `free` or `premium` (admin-managed today; Stripe later).
- New accounts typically default to **free**; Premium unlocks LLM Insights Analysis / Reports / Coach.
- Admins (`ADMIN_EMAILS` or elevated role) can use admin surfaces and effectively get Premium AI access.
- CORS on the API may be open (`*`) in current deploy; production should lock origins to the web app / domain.

---

## 2. What Lony does (capabilities map)

### 2.1 Identity and security

- Email + password register → verify → sign in
- Forgot / reset password (email code; needs mailer in production)
- Change password while signed in
- Google OAuth (`id_token`)
- Telegram Login Widget (deep link on mobile)
- WhatsApp sign-in: **not supported** (API 501)
- Profile / onboarding: name, username, country, default currency, locale, calendar, timezone
- Terms of Service acceptance
- Device **app lock**: PIN, pattern, password, or biometrics (client-side; SecureStore)
- Privacy: export my data, delete account
- Session-bound JWTs; logout and password reset revoke sessions

### 2.2 Social and peer loans

- Search users, friend requests, accept/reject, peers list, block/remove
- Phone lookup / invite contacts (mobile)
- Create peer loans (lend or borrow), alone/long-term institutional debt, installments
- Propose / accept / reject / cancel terms
- Flat interest % (not APR)
- Borrower claims repayment; lender confirms or rejects (optional proof attachment)
- Share encrypted bank/payment profile for a specific loan; re-auth to reveal full numbers
- Due reminders (7d / 3d / 1d / due / overdue) via worker + push / in-app inbox
- Deterministic **Lony Trust** grade A–E for lenders

### 2.3 Personal finance tracker

- **Accounts:** cash, bank, mobile money, wallet, credit card, other — manual balances, interest projection, transfers, reconcile, CSV / Plaid import
- **Wealth / net worth:** cash on hand + receivables − payables (and account balances)
- **Cashflow:** income and expenses, categories, accounts, dates, notes, recurrence / templates
- **Bills & subscriptions:** record, skip, postpone, pause, resume; reminders before due
- **Payday budgets** + category budgets with pace bars and 80%/100% alerts
- **Trip / event budgets**
- **Spending calendar / heatmap**
- **Split one payment** across accounts/categories; **share expense with friends** → peer loan shares
- **Voice add** (“lunch 250 birr”) → transcript → amount / category / account draft
- **Receipt scan** (camera / photo → OCR draft)
- **SMS bank ingest** (Android): parse money SMS into transfers / balances
- **Quick add** and offline drafts (mobile)
- **Goals / Plan:** savings targets, contributions, projections, covers, market price helpers
- **Insights:** overview, cashflow series, categories, debts, goals + Premium AI tabs

### 2.4 Chat

- DMs with friends / peers
- Text, emoji, reply, reactions, file attachments
- Voice notes (native mobile)
- Search conversations
- Loan-related peer context from chat / profile

### 2.5 Admin / ops

- Overview KPIs
- Users: suspend, set plan tier, roles
- RBAC permissions
- System categories and institution catalogs
- Publish themes
- Localization packs and calendars
- Audit log
- Global AI disable

---

## 3. What it looks like (design system)

Source of truth: `mobile/DESIGN.md` and shared theme files (`mobile/src/theme.tsx`, `web/src/lib/theme.tsx`).

### Visual direction

- Soft slate canvas, white cards, **teal primary**, amber secondary, sky tertiary
- Fintech ledger feel that evolved toward a **wallet-first** Home (wallets strip, fat budget bars, compact colored transaction rows, capture FAB)
- **Manrope** for UI; **JetBrains Mono** for money amounts
- Hairline borders, soft elevation, status pills, segmented controls
- Floating **glass pill** bottom navigation on mobile

### Color tokens (light)

| Token | Value | Use |
|-------|-------|-----|
| Background | `#F7F9FB` | Page canvas |
| Surface | `#FFFFFF` | Cards |
| Surface muted | `#EEF2F6` | Nested / muted blocks |
| Text | `#0F172A` | Primary text |
| Muted | `#64748B` | Secondary text |
| Border | `#E2E8F0` | Hairlines |
| Primary | `#1FA8A8` | CTAs, active nav |
| Primary soft | `#E6F7F6` | Soft fills |
| Secondary | `#D97706` | Amber accents / warnings |
| Tertiary | `#0284C7` | Info / bank tones |
| Success | `#0F766E` | Income / positive |
| Error | `#DC2626` | Destructive / errors |

### Dark mode

- Background `#0B1220`, surface `#121A2B`, primary `#2EC4C4`
- Toggle persists (SecureStore on mobile; theme provider on web)

### Typography & rounding

- Brand ~22 Bold, headlines ~20 SemiBold, body ~15 Regular, mono amounts ~13 Medium
- Radii: sm 10, md 14, lg 20, full pill
- Spacing base 4px

### Theme presets

Built-ins include `lony-light`, `lony-dark`, `ocean`, `forest`, `sunset`, `midnight`. Admins can publish system themes that merge into client theme pickers.

### Navigation chrome

**Mobile bottom tabs:** Home · Loans · Chats  

**Mobile drawer:** Expenses (maps to Home cashflow), Accounts, Loans, Insights (Analytics), Plan, Settings  

**Home FAB cluster (wallet UI):** camera (receipt) · mic (voice add) · plus (quick add)  

**Web shell:** sidebar (Home, Accounts, Cashflow, Loans, Chats, Insights, Plan, Banks, Settings) + mobile bottom tabs (Home, Loans, Chats, Insights, You)

---

## 4. Architecture and stack

```
┌────────────┐  ┌────────────┐  ┌────────────┐
│  Mobile    │  │  User Web  │  │   Admin    │
│  Expo RN   │  │  Vite SPA  │  │  Vite SPA  │
└─────┬──────┘  └─────┬──────┘  └─────┬──────┘
      │               │               │
      └───────────────┼───────────────┘
                      ▼
              ┌───────────────┐
              │  lony-api     │  Go + Chi  /api/v1
              │  JWT + RBAC   │
              └───────┬───────┘
         ┌────────────┼────────────┐
         ▼            ▼            ▼
    PostgreSQL     Redis/Asynq    Media disk
    (Neon/local)   worker jobs    /data/media
```

| Layer | Technology |
|-------|------------|
| Mobile | Expo ~57, React Native 0.86, React 19, SecureStore, AuthSession, local auth, Android SMS |
| User web | Vite, React 19, React Router, Recharts, Lucide |
| Admin | Vite, React 19, React Router, Lucide |
| API | Go 1.26, Chi, pgx, sqlc, shopspring/decimal, argon2id, JWT |
| Worker | `cmd/worker` + Redis 7 + Asynq |
| DB | PostgreSQL 16 |
| Push | Expo Push (FCM/APNs via Expo); log fallback without token |
| Bank link | Optional Plaid; CSV import without Plaid |
| AI | OpenAI-compatible HTTP (`OPENAI_BASE_URL`, e.g. Groq) |
| Deploy | Fly.io: `lony-api`, `lony-web`, `lony-admin` (region `fra` typical) |

### Repo layout (detail)

```
backend/
  api/           cmd/api, cmd/worker, internal/*, db/migrations, queries, fly.toml
  admin/         Operator SPA + fly.toml
  shared/        openapi.yaml, generated clients, i18n masters
  docker-compose.yml
web/             User SPA + Dockerfile + fly.toml
mobile/          Expo app + DESIGN.md + android/ + eas.json
```

### Backend packages (`backend/api/internal`)

| Package | Responsibility |
|---------|----------------|
| `auth` | Register, verify, login, refresh, OAuth, password, `/me`, TOS, avatar |
| `users` | User DTO shapes |
| `friends` | Search, requests, peers, block, phone invite |
| `loans` | Loan lifecycle, terms, installments |
| `repayments` | Claim / confirm / reject |
| `banks` | Encrypted payment profiles + shares |
| `accounts` | Balances, wealth, transfers, credit cards, reconcile |
| `expenses` | Cashflow, budgets, payday, trips, bills, calendar, SMS, receipt, voice, split/share |
| `goals` | Plan goals, contributions, projections, market helpers |
| `insights` | Deterministic analytics series |
| `score` | Lony Trust A–E |
| `ai` / `ai/llm` | Personas, coach stream, receipt/voice/account extract |
| `chat` | Conversations, messages, media |
| `dashboard` | Loan dashboard aggregates |
| `notifications` | Inbox + device tokens |
| `admin` | Ops KPIs, users, catalogs, themes, RBAC, AI settings |
| `localization` | Locales + calendars |
| `privacy` | Export / delete |
| `banklink` | Plaid link/sync |
| `imports` | Statement CSV |
| `fx` | FX rates |
| `rails` | Payment rails catalog |
| `legal` | TOS |
| `jobs` | Asynq handlers |
| `reconcile` | Balance mismatch **report only** (never silent-fix) |
| `mailer` | Resend / SMTP / dev log codes |
| `media` | Private file storage |
| `server` | HTTP wiring under `/api/v1` |

### Worker jobs (when Redis is running)

- Loan due reminders and overdue transitions
- Reminder rebuild / reconciliation
- Balance mismatch logging
- Cashflow materialize (expected recurring → due items)
- Goal / tracked price ticks (where configured)

---

## 5. Auth and account operations (end-to-end)

### Register

1. User enters email, password, optional name/phone.
2. `POST /auth/register` (idempotency key supported).
3. Verification code emailed (or returned in API response in development without mailer).
4. App goes to **Verify** screen.

### Verify email

1. User enters code → `POST /auth/verify`.
2. Can resend via `POST /auth/resend-verification`.
3. On success → login tokens / continue to onboarding if profile incomplete.

### Login

1. Email + password → `POST /auth/login`.
2. Returns access JWT + refresh token; session recorded; optional `X-Device-Label`.
3. Clients store tokens securely (SecureStore / web storage patterns).

### Refresh / logout

- `POST /auth/refresh` rotates access using refresh.
- `POST /auth/logout` revokes session immediately.

### Google OAuth

- Mobile: `expo-auth-session` obtains `id_token`.
- `POST /auth/oauth` with provider Google + token.
- Creates or links user; returns session like login.

### Telegram OAuth

- Mobile opens API HTML widget `/auth/telegram/widget`.
- Callback → deep link `lony://oauth/telegram` → exchange into session.

### Forgot / reset password

1. `POST /auth/forgot-password` with email → code emailed.
2. `POST /auth/reset-password` with code + new password.
3. Existing sessions revoked.

### Change password

- Signed-in `POST /me/password` with current + new.

### Onboarding

- Until `profile_complete`, user is forced to **Onboarding**: username, country, currency, locale, calendar, timezone via `PATCH /me`.
- Must accept TOS (`POST /me/tos`) when required.

### App lock (mobile only)

- User enables lock method in Settings (PIN / pattern / password / biometrics).
- After background (grace period ~1 hour), `AppLockScreen` blocks UI until unlock.
- Does **not** replace server auth; it only protects the local session UI.

### Privacy

- **Export:** `GET /me/export` → downloadable archive of user data (includes AI transcripts where applicable).
- **Delete:** `POST /me/delete` → soft-delete / wipe paths per privacy service (AI history cleared).

---

## 6. Mobile app — pages and operations

Entry: `mobile/App.tsx` (screen state machine). Screens include:  
`login` | `register` | `verify` | `forgot` | `reset` | `onboarding` | `home` | `loans` | `new-loan` | `loan` | `installment` | `banks` | `chats` | `settings` | `expenses` | `cashflow-new` | `quick-add` | `cashflow-show` | `analytics` | `plan` | `accounts` | `peer-profile` | `chat-search` | `tos`.

### 6.1 Auth screens (`AuthScreens.tsx`)

| Mode | What the user sees / does |
|------|---------------------------|
| Login | Brand, email/password, Google/Telegram, link to register/forgot |
| Register | Create account form |
| Verify | Code entry + resend |
| Forgot | Request reset code |
| Reset | Enter code + new password |

### 6.2 Home (`home` → `ExpensesScreen` dashboard)

Home is the **money-first** surface (not a loan dashboard).

**Tabs inside expenses UI:** Dashboard (Money) · Calendar · Income · Expenses · Bills.

**Dashboard operations:**

1. **Net worth card** — cash, owed to you, you owe; open Accounts.
2. **Wallets strip** — horizontal account chips with balances.
3. **This month** — net, income total, expense total.
4. **This payday / budgets** — fat pace bars; “Edit limits” expands payday day + category budget forms.
5. **Coming up** — bills and loan dues in the next ~45 days.
6. **Spending by category** — colored bars.
7. **Recent transactions** — compact rows with category color dots; tap → cashflow show.
8. **Trips** — active trip pace; create form behind “More”.
9. **Open loans** — quick peek into peer debt.
10. **Offline drafts** — sync when back online.
11. Header actions: refresh SMS ingest; FAB: camera / mic / plus.

**Calendar tab:** Heatmap of daily spend; pick a day → list that day’s income/expense.

**Income / Expenses tabs:** Month lists with new entry via FAB / forms.

**Bills tab:** Each bill shows status (upcoming / overdue / paused). Actions:

- **Record / Received** — materialize as received cashflow
- **Skip** — skip this cycle
- **Postpone 7d** — push due date
- **Pause / Resume** — stop/start subscription cycles

### 6.3 Quick add (`quick-add`)

Short path for logging money:

1. Segmented Expense / Income
2. Amount, title, category, currency, account
3. Voice button (optional auto-start from mic FAB)
4. Save → `POST /cashflow`
5. **More details** → opens full cashflow form with draft prefilled

Offline: saves draft locally and prompts to sync later from Expenses.

### 6.4 Full cashflow form (`cashflow-new` / `CashflowScreens`)

Default shows amount, title, account, category, date. **More details** reveals:

- Loan payment? (link to payable loan + payment mode)
- Currency, note
- Split payment across lines (accounts/categories)
- Trip attachment
- Recurring income/expense period
- Who’s paying? Alone vs with friends → peer search / contacts → split mode equal/%/flat → creates loan shares on save
- Receipt/SMS prefill banners when coming from capture

**Cashflow show:** View entry, mark Received, open linked loan, edit/delete as allowed.

### 6.5 Accounts (`AccountsScreen`)

- List as **wallet cards** (type color, name, balance)
- Add account (type, institution, currency, starting balance)
- Credit cards: limit, statement day, due day, utilization bar, installments
- Optional interest % + compounding → 12‑month projection
- Update balance, transfer between accounts, reconcile stated vs ledger
- Import statement CSV / upload
- Link bank via Plaid when available
- Accept account for loan repayment sharing (scan statement / holder details)
- Per-account SMS archive (Android)

### 6.6 Loans (`LoansScreen` + `NewLoanScreen` + loan detail)

**List modes:** All loans · Individual (aggregated by peer).

Each row: peer/title, amount signed (positive = owed to you), due pill, status.

**New loan:**

1. Alone vs with friends / party mode
2. Lend vs borrow role
3. Counterparty (search / friends / locked from chat)
4. Title, principal, currency, flat interest, due date, note
5. Optional installment schedule
6. Optional receiving bank profile
7. Send for acceptance

**Loan statuses (API):** `pending`, `active`, `overdue`, `repayment_pending`, `rejected`, `cancelled`, `completed`.

**Detail operations:**

- View shared terms (identical for both parties once accepted)
- Accept / reject terms
- View masked payment profile; reveal with re-auth
- Borrower: submit repayment claim (+ optional proof)
- Lender: confirm or reject claim
- Installment detail when scheduled
- Event timeline

### 6.7 Banks / payment profiles (`banks`)

Separate from balance accounts:

- Add profile (type: bank / mobile money / etc., institution, masked account)
- Set preferred
- Share with a loan / revoke share
- Reveal full identifier requires step-up (re-auth)
- Never shown in push notification copy

### 6.8 Chats (`chats`, `chat-search`, thread)

- Conversation list with unread badge on tab
- Search peers / chats
- Thread: text, emoji, reply, react, attach file, voice (native)
- Open peer profile → loans with that person / start loan

### 6.9 Insights / Analytics (`AnalyticsScreen`)

Tabs typically: Overview · Cashflow · Debts · Goals · Analysis · Reports · Coach  

- Deterministic charts/series for everyone
- **Analysis / Reports / Coach** require Premium (or admin)
- Disclaimers always shown on AI surfaces
- Coach stream: conversational advice; action chips; must not push new peer borrowing to “fix” cashflow
- Clear AI history available

### 6.10 Plan (`PlanScreen`)

- List financial goals (travel, purchase, savings)
- Create goal: title, target amount, currency, dates, cover image
- Contribute toward goal
- Projection / ETA
- Optional URL / market price helpers for tracked purchases
- Plan-chat AI assist where enabled

### 6.11 Settings (`SettingsScreen`)

- Profile fields
- Language, calendar (Gregorian / Ethiopic / Hijri display), hour cycle, timezone
- Theme picker (built-ins + admin themes)
- App lock / biometrics
- Notifications preferences (where wired)
- Legal / TOS
- Privacy export & delete
- Admin entry (if admin) → thin KPI / AI kill UI or deep link to admin console
- Sign out

### 6.12 Other mobile surfaces

- **TOS** full text
- **Season recap** (periodic storytelling surface when enabled)
- **Peer profile**
- **Installment** detail screen
- **Admin screen** for ops toggles on-device

---

## 7. User website — pages and operations

Router: `web/src/App.tsx`. Auth pages under `/login`, `/register`, `/verify`, `/forgot`, `/reset`. Authenticated shell wraps product routes.

| Route | Page | Behavior |
|-------|------|----------|
| `/` | `HomePage` | Same money Home: net worth, wallets, month, category bars, payday, bills coming up, recent entries, trips; Voice / Income / Expense CTAs |
| `/accounts` | `AccountsPage` | Wallet grid, linked banks, create/edit/balance/transfer/reconcile/import/installments |
| `/cashflow` | list / filters | Browse income & expenses |
| `/cashflow/new` | `CashflowNewPage` | Full add form; voice auto-start via `?voice=1`; More details collapses loan/split/recurring |
| `/cashflow/:id` | `CashflowShowPage` | Detail + receive / edit |
| `/loans` | `LoansPage` | Loan list |
| `/loans/new` | `LoanNewPage` | Create loan |
| `/loans/:id` | `LoanDetailPage` | Accept, repay, confirm |
| `/loans/.../installments/:id` | `InstallmentPage` | Installment detail |
| `/chats` | `ChatsPage` | Conversations |
| `/chats/search` | `ChatSearchPage` | Search |
| `/chats/:peerId` | `ChatThreadPage` | Thread |
| `/people/:peerId` | `PeerProfilePage` | Peer |
| `/insights` | `InsightsPage` | Analytics + AI tabs |
| `/plan` | `PlanPage` | Goals |
| `/banks` | `BanksPage` | Payment profiles |
| `/settings` | `SettingsPage` | Account, locale, privacy |
| `/themes` | `ThemesPage` | Theme selection |
| `/admin` | `AdminPage` | Thin admin for admins |
| `/tos`, `/onboarding` | Legal / profile completion | |

Web Home mirrors the wallet UI: fat pace bars, category color dots, compact rows, Voice button next to Income/Expense.

---

## 8. Admin console — pages and operations

App: `backend/admin` (Fly: `lony-admin`). Sign in with an admin user.

| Page | Operations |
|------|------------|
| Overview | KPIs: users, loans, cashflow health, AI status, jobs/FX signals |
| Users | Search, suspend/unsuspend, set `plan_tier` free/premium, assign roles |
| Roles | Manage RBAC permissions |
| Categories | System cashflow categories |
| Catalogs / institutions | Account types and institution lists for forms |
| Themes | Create/publish system themes clients can load |
| Localization | Upload/edit locale message packs; calendars |
| Audit | Admin action log |
| Settings | Global **AI kill switch** and platform settings |

**Permission examples:** `overview.read`, `users.read/write`, `categories.read/write`, `themes.read/write`, `audit.read`, `settings.ai`, `roles.manage`, `localization.manage`.

---

## 9. Domain deep-dives (how money operations work)

### 9.1 Accounts vs bank profiles

| Concept | Means | Used for |
|---------|-------|----------|
| **Account** | Balance you track (cash in hand, CBE, telebirr, credit card) | Net worth, expense “from which wallet”, transfers |
| **Bank / payment profile** | Encrypted destination identifiers | Telling a borrower *how to pay you* |

### 9.2 Cashflow entry lifecycle

1. Create income or expense (immediate or **expected** / template).
2. Expected items appear on bills calendar until **Received/Recorded**, skipped, or postponed.
3. Recurring templates materialize future dues (worker).
4. Entry may link: `account_id`, `category_id`, `trip_id`, `linked_loan_id`.
5. Expense can **split** into multiple account/category lines in one total.
6. Expense can **share with friends** → creates loan requests for their shares (active only after they accept).

### 9.3 Budgets and payday

- **Payday:** day-of-month + optional spend-until-payday limit → cycle start/end, days left, spent %, pace %, ahead flag, alerts.
- **Category budgets:** monthly limit per category; same pace semantics.
- UI shows fat bars with a pace tick; setup forms stay collapsed behind Edit limits.

### 9.4 Voice add

1. Record audio (mobile mic / web MediaRecorder).
2. `POST /cashflow/voice-parse` with base64 audio.
3. Server: transcribe (Whisper-compatible) → LLM JSON extract → fallback regex if needed.
4. Client applies draft: kind, amount, title, currency, category_hint / account_hint matches.
5. Core AI path (receipt/voice) is intended as always-available capture; Premium gates the Insights personas.

### 9.5 Receipt scan

1. Camera / gallery → image to `POST /cashflow/receipt-scan`.
2. OCR / LLM extract → prefill cashflow form (`source: receipt`).

### 9.6 SMS ingest (Android)

1. Permission + watcher / manual refresh.
2. Parse bank/wallet SMS → create transfers or update balances.
3. Dedupes already-saved messages; reports unreadable / unlinked counts.
4. Can auto-create accounts from recognized institutions.

### 9.7 Loan repayment flow

1. Loan is `active` (or `overdue`).
2. Borrower submits repayment → status toward `repayment_pending`.
3. Lender confirms → loan `completed` (or remaining balance updates for partials if used).
4. Lender rejects → claim fails; loan stays open.
5. All material changes append **loan events** for audit.

### 9.8 Wealth / dashboard numbers

- **Wealth:** preferred currency, cash on hand, receivables, payables, net worth, per-currency slices, accounts list.
- **Loan dashboard:** receivables/payables, due soon, pending actions, optional FX blend to preferred currency.
- Home uses wealth + cashflow summary + budgets + bills for the wallet-first composition.

### 9.9 Goals / Plan

1. Create goal with target and optional cover.
2. Contribute amounts over time.
3. Projection estimates ETA from contribution rate.
4. Optional scrape/search helpers for product prices (worker can refresh tracked prices).

### 9.10 Insights and Trust

- Deterministic endpoints under `/insights/*` and `/score`.
- Trust grades A–E from repayment behavior metrics — **not** a bureau score.
- LLM may explain Trust; must not invent a new grade.
- Analyst = insight cards; Visualizer = report packs; Coach = chat/stream.

### 9.11 Notifications

- In-app inbox (`/notifications`)
- Device token registration for Expo Push
- Reminder copy never includes full bank identifiers

---

## 10. API surface (major groups)

Base: `/api/v1`. Health: `/health`. JSON; ISO-8601 UTC; ISO currency codes. State-changing POSTs support idempotency keys.

| Area | Examples |
|------|----------|
| Auth | `/auth/register`, `/verify`, `/login`, `/refresh`, `/logout`, `/oauth`, `/forgot-password`, `/reset-password` |
| Me | `/me`, `/me/password`, `/me/tos`, `/me/export`, `/me/delete` |
| Social | `/users/search`, `/friends`, `/friend-requests`, `/peers` |
| Dashboard / wealth | `/dashboard`, `/wealth` |
| Accounts | `/accounts`, transfers, reconcile, installments |
| Cashflow | `/cashflow`, summary, calendar, breakdown, categories, bills actions, `voice-parse`, `receipt-scan`, `sms-ingest`, share |
| Budgets / trips | `/budgets`, `/budgets/payday`, `/trips` |
| Goals | `/goals`, contributions, projection, market helpers |
| Insights / score | `/insights/*`, `/score`, peer trust |
| AI | `/ai/insights`, coach thread/messages/stream, analytics report, plan-chat |
| Loans | `/loans`, terms, accept/reject, payment-profile |
| Repayments | `/loans/{id}/repayments`, confirm/reject |
| Banks | `/bank-profiles`, shares, reveal events |
| Bank link | `/bank-links/*` |
| Chat | `/conversations`, messages, reactions, media |
| Notifications | `/notifications`, device tokens |
| Catalogs / themes / locales | public lists + admin CRUD |
| Admin | `/admin/*` KPIs, users, roles, settings |

---

## 11. Internationalization and calendars

| Locale code | Language |
|-------------|----------|
| `en` | English (default / fallback) |
| `fr` | French |
| `am-ET` | Amharic |

Packs live in `backend/shared/i18n`, API localization service, and `mobile/src/i18n`. Admins can publish more packs.

**Calendars (display only):** Gregorian, Ethiopic, Hijri. Storage and API dates remain Gregorian ISO. Hour cycle: 24h / 12h / Ethiopian 6-hour style where supported.

---

## 12. Plans, Premium, and AI policy

| Tier | What unlocks |
|------|----------------|
| Free | Core ledger, cashflow, accounts, budgets, bills, Trust, deterministic Insights |
| Premium | LLM Analyst, Visualizer, Coach (and related AI refresh paths) |

**Non-negotiable AI policies:**

1. Never send raw account numbers / full statements to the model — aggregated FeatureSnapshot only.
2. Disclaimer on every AI surface.
3. Coach must not recommend new peer borrowing to paper over cashflow.
4. Refuse illegal collection / guaranteed returns / “official credit score.”
5. Honor admin AI disable and missing keys with rule fallback or clear unavailable errors.
6. Daily per-user LLM cap (`AI_DAILY_USER_CAP`).
7. Transcripts included in export; wiped on delete.

**Env:** `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` (default often `gpt-4o-mini`), cap settings.

Receipt OCR and voice parse are treated as **capture core** (available via `ensureAICoreAvailable` / allowLLM paths), distinct from Premium persona gates.

---

## 13. Deploy, environments, and ops

### Fly apps

| App | Source | URL pattern |
|-----|--------|-------------|
| `lony-api` | `backend/api` | `https://lony-api.fly.dev` |
| `lony-web` | `web` | `https://lony-web.fly.dev` |
| `lony-admin` | `backend/admin` | `https://lony-admin.fly.dev` |

Web build bakes `VITE_API_BASE` (include `/api/v1`) and `VITE_ADMIN_URL`.  
Mobile uses `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_ADMIN_URL`.

### Critical secrets / env

`DATABASE_URL`, `JWT_SECRET`, `BANK_ENCRYPTION_KEY`, `REDIS_URL`, `APP_ENV`, `MEDIA_DIR`, `ADMIN_EMAILS`, mailer (`RESEND_API_KEY` or SMTP), `EXPO_ACCESS_TOKEN`, Google/Telegram OAuth, OpenAI keys, optional `PLAID_*`, `PUBLIC_BASE_URL`.

### Local run (summary)

1. `backend/docker compose up -d` (Postgres + Redis)
2. `go run ./cmd/api` and `go run ./cmd/worker` in `backend/api`
3. `npm start` in `mobile`
4. `npm run dev` in `web` (port 8082)
5. `npm run dev` in `backend/admin` (port 5174)

### Production checklist (not all done by default)

- Set `APP_ENV=production`
- Real email for verify/reset
- Redis + worker always on for reminders
- Tighten CORS
- Neon backups
- Signed Play/App Store builds (EAS)
- Legal URLs for stores
- Smoke-test full flows on a real device

### Balance safety

Worker **reports** account ledger mismatches; it does **not** silent-fix money columns. Any repair must be an audited path.

---

## 14. Design / UX principles in practice

1. **One job per screen** — avoid nested dashboards.
2. **Home = money** — wallets, spend, bills, capture; loans are a peer system, not the first viewport.
3. **Two-tap add** — Quick add for amount + category (+ account); advanced loan/split/recurring behind More.
4. **Capture always reachable** — mic and camera on Home FAB.
5. **Compact ledger rows** — category color dots, less chrome.
6. **Fat budget bars** — pace visible at a glance; setup collapsed.
7. **Honest product language** — ledger and reminders, not banking theater.
8. **Accessibility goals** — not color-only status, large tap targets, locale-aware money/dates (Phase 8 hardening).

---

## 15. What “done” means vs what is still product/ops

### Built as product features (in code)

Peer loans + repayments, friends, chat, payment profiles, accounts/wealth, cashflow, bills, payday/budgets, trips, calendar, split/share, voice, receipt, SMS (Android), goals/plan, Insights + three AI personas, Trust grades, admin console, privacy export/delete, web + mobile + admin clients, Fly deploy paths.

### Typical leftovers for a public production release

- Commit/deploy latest UI if not on production builds yet
- Production `APP_ENV`, mailer, Redis worker
- Store listing + signed Android/iOS builds
- CORS lock, backups, monitoring
- Optional: billing provider, custom domain, home widget restore, split into three Git remotes

---

## 16. Glossary

| Term | Meaning |
|------|---------|
| **Ledger** | Shared record of a loan; not movement of money |
| **Cashflow entry** | Income or expense row (possibly expected/recurring) |
| **Bill** | Due instance of recurring/expected cashflow on the calendar |
| **Payday cycle** | Window from payday to next payday with optional spend limit |
| **Pace** | Whether spend is ahead/behind the linear budget for the cycle |
| **Wealth** | Snapshot of cash + receivables − payables (+ accounts) |
| **Bank profile** | Encrypted “pay me here” destination |
| **Account** | Tracked wallet/balance |
| **Lony Trust** | Deterministic A–E grade for lenders |
| **Premium AI** | Analyst / Visualizer / Coach LLM surfaces |
| **Idempotency key** | Client key so retried POSTs do not double-create money rows |

---

## 17. Mental model (one paragraph)

Lony is a **shared loan ledger plus a personal wallet app** with budgets, bills, goals, and Premium coaches. Three clients (phone, website, admin) talk to one Go API on Postgres, with Redis workers for reminders. Users track what they have and owe, capture spending by tap, voice, receipt, or SMS, and manage peer debts without Lony ever touching the money. The look is teal-on-slate fintech that presents **Home as a wallet ledger**: wallets first, fat budget bars, tight colored rows, and always-on capture.

---

*End of `wholeproject.md`.*
