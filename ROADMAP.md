# Lony — Build Roadmap

Personal Loan Ledger mobile application: shared loan tracking, reminders, repayment confirmation, dashboard analytics, and bank-profile sharing.

This file is the working plan for building the product. Behavior comes from the product PDFs. Look and layout come from the Stitch Lony screens.

| Source | Role |
|---|---|
| `Loan_App_SRS.pdf` | What the product must do |
| `Loan_App_SDS.pdf` | How to implement it |
| `Loan_App_Architectural_Design.pdf` | System boundaries and ADRs |
| `Loan_App_Database_Design.pdf` | PostgreSQL schema and invariants |
| `stitch_peer_loan_ledger_app.zip` | Lony visual system and screens |

**Where they conflict, specs win for behavior; Stitch wins for look.**

---

## Product in one paragraph

Lony is a **shared ledger and reminder app**, not a bank, wallet, or payment processor. Two users record a personal loan, both accept the terms, money moves **outside** the app (CBE, telebirr, bank transfer, etc.), the borrower claims repayment, and the lender confirms. The platform never holds funds, never initiates transfers, does not score credit, and does not collect debt.

A user may be borrower on one loan and lender on another.

---

## Frozen decisions (Phase 0)

Confirm these before writing application code. Product rules match the SDS. The backend language is **Go**, not NestJS.

| # | Decision | Default |
|---|---|---|
| 1 | Mobile client | Expo + React Native + TypeScript |
| 2 | Backend | Go modular monolith (`net/http` + Chi) |
| 3 | Database | PostgreSQL + SQL migrations + sqlc |
| 4 | Jobs | Asynq + Redis |
| 5 | API contract | OpenAPI 3; generate the TypeScript client for mobile |
| 6 | Money | `shopspring/decimal` in Go; `NUMERIC(20,4)` in Postgres |
| 7 | Repo layout | Monorepo: `apps/mobile`, `apps/api`, `packages/shared` |
| 8 | Auth for MVP | Email + password + verification (phone later) |
| 9 | Interest | Flat per-loan % only (not APR) |
| 10 | Repayment UI | Full repayment only; schema already supports partials |
| 11 | Proof attachments | Schema + private storage; optional in v1 UI |
| 12 | Spec vs design | Specs over Stitch for behavior |
| 13 | Product copy | “Shared ledger and reminders.” Never bank, escrow, or legally binding |

The SDS recommended NestJS. We are replacing that layer only: same modules, same Postgres model, same REST contract, implemented in Go.

---

## What v1 will not include

- In-app transfers, KYC, or payment-processor integration
- Credit scoring, trust/reputation scores
- APR, compounding, or installment schedules in the UI
- Cross-currency grand totals or FX conversion
- Auto-pay / linked-wallet execution
- Blockchain or “cryptographic chain” as a real subsystem
- Web dashboard
- Debt collection or legal enforcement

The database may reserve fields for later (partial repayments, attachments, future interest methods). Do not ship those as product features in v1 unless this file is updated.

---

## Design vs spec (apply while building)

Follow Lony screens for dark fintech UI (teal primary, amber pending, blue for bank/security, Manrope + JetBrains Mono, bottom nav).

Do **not** implement these mockup extras as MVP behavior:

| Mockup | Spec rule |
|---|---|
| Trust Score 98% | Out of scope (high-risk future feature) |
| “Legally binding” | Record-keeping tool only |
| SHA-256 / isolated cryptographic chains | Append-only `loan_events` + TLS + field encryption |
| Lender-only “Lend Money” as instant activation | Two-party acceptance required before `ACTIVE` |
| “I Have Received Repayment” with no borrower claim | Borrower submits, then lender confirms |
| Copy full account number immediately | Re-auth required to reveal full identifiers |
| EUR on new-loan screen | MVP currencies: ETB and USD unless product owner adds more |
| Telebirr auto-pay | Informational profile only |
| Receipt attachments as required | Optional; SRS lists as future |

Lender-led drafting may exist in the UI, but the server still requires explicit acceptance before the loan is active.

---

## Target architecture

```
React Native (Expo)
        |
        | HTTPS /api/v1  (short-lived access token)
        v
Go modular monolith  (cmd/api + cmd/worker)
  Auth | Users | Friendships | Loans | Repayments
  BankProfiles | Dashboard | Notifications | Jobs | Audit | Admin
        |
        +-- PostgreSQL (system of record, sqlc)
        +-- Redis / Asynq (reminders, push retries)
        +-- S3-compatible storage (avatars; optional proofs)
        +-- FCM / APNs (push)
```

Go stack notes:

- One module, internal packages per bounded context — same modular-monolith idea as the SDS.
- sqlc keeps SQL explicit and typed; do not use a heavy ORM for money writes.
- Chi for routing, middleware, and `/api/v1`.
- OpenAPI is the shared contract. Mobile does not import Go types.
- `cmd/api` is stateless HTTP. `cmd/worker` consumes Asynq jobs.

Rules that never change:

- Financial truth lives on the server, not the device.
- Monetary values use decimal types, never floats.
- Dashboard totals are grouped by currency. No FX blend in v1.
- Bank account identifiers are encrypted at rest, masked in UI, shared only via an explicit share row.
- Loan events are append-only.
- State-changing mobile actions are online-first and idempotent.

---

## Repo shape to create in Phase 1

```
lony/
  apps/
    api/                 Go module
      cmd/api/           HTTP server
      cmd/worker/        Asynq worker
      internal/          auth, users, friendships, loans, ...
      db/migrations/     Versioned SQL
      db/schema.sql      Current schema (sqlc + migrate)
      db/queries/        sqlc SQL
    mobile/              Expo React Native
  packages/
    shared/              OpenAPI spec + generated TS types / enums
  ROADMAP.md             This file
```

Feature folders on mobile (from SDS):

- `src/features/auth`
- `src/features/profile`
- `src/features/friends`
- `src/features/loans`
- `src/features/repayments`
- `src/features/bankProfiles`
- `src/features/dashboard`
- `src/features/notifications`

---

## Loan lifecycle (implement exactly)

| State | Meaning | Allowed next |
|---|---|---|
| `REQUESTED` | Borrower submitted; lender has not accepted | `REJECTED`, `CANCELLED`, `TERMS_PROPOSED`, `ACTIVE` |
| `TERMS_PROPOSED` | Lender changed terms; borrower ack if enabled | `ACTIVE`, `CANCELLED`, `REJECTED` |
| `ACTIVE` | Accepted, outstanding | `REPAYMENT_PENDING`, `OVERDUE`, `CANCELLED_BY_AGREEMENT` |
| `OVERDUE` | Due date passed, balance > 0 | `REPAYMENT_PENDING`, `COMPLETED`, `DISPUTED` |
| `REPAYMENT_PENDING` | Borrower claimed payment | `COMPLETED`, `ACTIVE`, `OVERDUE`, `DISPUTED` |
| `COMPLETED` | Lender confirmed; no remaining balance | Terminal (admin annotation only) |
| `REJECTED` | Lender rejected request | Terminal |
| `CANCELLED` | Pending or mutually cancelled | Terminal |
| `DISPUTED` | Disagreement / support | `ACTIVE`, `OVERDUE`, `COMPLETED`, `CLOSED_DISPUTE` |

Interest (MVP): flat percentage applied once to principal. Example: 5% on 10,000 ETB = 500 ETB interest, 10,500 ETB expected total. UI label: **Flat loan interest %**.

---

## Implementation phases

Do these in order. Do not start a later phase until the previous **Definition of done** is true.

### Phase 1 — Foundation

Stand up the empty repo so everything else has a home.

- Monorepo: Go API + Expo app + shared OpenAPI package
- Go: `gofmt`, `golangci-lint`, tests; mobile: TypeScript strict, ESLint
- CI: Go test/lint, mobile typecheck/lint, OpenAPI validate
- Chi `/api/v1`, OpenAPI, consistent errors, idempotency keys
- SQL migrations + sqlc: first schema for `users`, sessions, verification, idempotency
- Password hashing with argon2id; short-lived JWT or opaque access tokens + hashed refresh sessions
- `POST /auth/register`, `POST /auth/verify`, `POST /auth/login`, `POST /auth/refresh`, `GET /me`, `PATCH /me`
- Expo app: splash, sign-in / register / verify, secure token storage; TS client generated from OpenAPI
- Local and staging env files; no secrets in git

**Definition of done:** A user can register, verify, sign in, and the API rejects unauthenticated calls.

### Phase 2 — Social graph

- Search / invite by username or email
- Friend request: pending → accepted / rejected
- Block and remove (does **not** delete loans)
- Canonical pair uniqueness (`user_low_id` + `user_high_id`)
- `GET /friends`, `POST /friend-requests`, accept / reject / block

**Definition of done:** Two accounts can become friends. Blocked users cannot start new loans. Duplicate accepted friendships are impossible.

### Phase 3 — Loans (core product)

- Create request, propose/set terms, accept, reject, cancel pending
- Server-side flat-interest and expected-total calculation
- Versioned `loan_terms`; append-only `loan_events`
- Human-friendly `reference_code` plus UUID
- Loan list, filters, details, timeline
- Background job: `ACTIVE` → `OVERDUE` when `due_at` passed and outstanding > 0
- Endpoints: `POST /loans`, `GET /loans`, `GET /loans/{id}`, terms, accept, reject

**Definition of done:** After accept, both users see identical principal, currency, interest basis, expected total, and due date. Accepted terms cannot be silently edited. Invalid transitions return `409`.

### Phase 4 — Dashboard

- `GET /dashboard` grouped by currency
- Net position = receivables − payables **within the same currency only**
- Cards: others owe me, I owe others, due soon, pending requests, pending confirmations
- ETB / USD switcher (no blended total)
- Tap-through filtered loan lists
- Per-friend balance strip (SRS FRI-006)

**Definition of done:** Dashboard numbers reconcile with open loans. No cross-currency grand total is shown.

### Phase 5 — Bank / payment profiles

- Create, edit, archive, set preferred (at most one preferred per user)
- Types: bank account, mobile wallet, other
- Encrypt `account_identifier`; store `last4` for lists
- Share scoped to recipient and optional loan; revoke
- Reveal / copy only for owner or active share; require recent auth
- `GET /loans/{id}/payment-profile` for authorized borrower
- Never put full account numbers in logs, analytics, or push bodies

**Definition of done:** Unauthorized users cannot read account numbers. Revoke cuts access immediately. Share and reveal are audited.

### Phase 6 — Repayment

- Borrower submits claim; default amount = outstanding expected balance
- Lender confirms → `COMPLETED` if remaining balance is zero
- Lender rejects with reason → `ACTIVE` or `OVERDUE`
- Borrower cannot confirm their own claim
- No concurrent claims that would exceed outstanding
- Optional proof attachment if Phase 0 kept it
- `POST /loans/{id}/repayments`, `POST /repayments/{id}/confirm`, `POST /repayments/{id}/reject`

**Definition of done:** A loan cannot become completed without lender confirmation (or an audited admin path). Duplicate taps do not create two completions.

### Phase 7 — Notifications

- In-app inbox for every notification type
- Push via FCM/APNs provider abstraction
- Schedule at accept: due soon (7d / 3d / 1d), due today, overdue cadence
- Deterministic job keys so duplicates are ignored
- Reschedule if due date is amended
- Reconciliation job rebuilds missing reminders from loan due dates
- Push copy never includes bank identifiers or excess financial detail

**Definition of done:** Reminders are queued at acceptance, delivery outcome is logged, in-app history exists even without a push token, and lost queue data can be reconstructed.

### Phase 8 — Hardening and store readiness

- IDOR tests, rate limits, concurrency, idempotency
- Balance reconciliation job (report mismatches; do not silent-fix)
- Accessibility: not color-only status, 44pt targets, locale money/dates
- Backups, alerts, runbooks (DB, queue, push, secret rotation)
- Legal disclaimer in onboarding and loan accept
- Pixel pass against Lony screens (tokens, type, spacing)
- EAS / signed iOS and Android builds

**Definition of done:** SRS section 25 acceptance list is true, and the app is ready for TestFlight / Play internal testing.

---

## SRS v1 acceptance checklist

Use this as the release gate (from SRS §25).

- [ ] New user can register, verify, sign in, create a profile, and add a friend
- [ ] Borrower can request a loan; lender can define terms and accept
- [ ] Both users see identical accepted principal, currency, interest basis, total expected repayment, and due date
- [ ] Dashboard values reconcile with active/overdue loans by currency and role
- [ ] Lender can share a preferred bank profile with the borrower for a specific loan
- [ ] Due reminders are scheduled and recorded for both parties
- [ ] Borrower can submit repayment; lender can confirm; completed loan appears in history
- [ ] Unauthorized users cannot retrieve another user’s loan or bank details
- [ ] All material financial state changes generate auditable events
- [ ] Core flows covered by API/integration tests and critical React Native UI tests

---

## Core API catalog (implement as phases land)

Base path: `/api/v1`. JSON, ISO-8601 UTC timestamps, ISO currency codes. State-changing POSTs accept an idempotency key.

| Method | Path | Phase |
|---|---|---|
| POST | `/auth/register` | 1 |
| POST | `/auth/verify` | 1 |
| POST | `/auth/login` | 1 |
| POST | `/auth/refresh` | 1 |
| GET | `/me` | 1 |
| PATCH | `/me` | 1 |
| GET | `/friends` | 2 |
| POST | `/friend-requests` | 2 |
| POST | `/friend-requests/{id}/accept` | 2 |
| POST | `/loans` | 3 |
| GET | `/loans` | 3 |
| GET | `/loans/{id}` | 3 |
| POST | `/loans/{id}/terms` | 3 |
| POST | `/loans/{id}/accept` | 3 |
| POST | `/loans/{id}/reject` | 3 |
| GET | `/dashboard` | 4 |
| GET | `/bank-profiles` | 5 |
| POST | `/bank-profiles` | 5 |
| POST | `/bank-profiles/{id}/share` | 5 |
| POST | `/bank-profile-shares/{id}/revoke` | 5 |
| GET | `/loans/{id}/payment-profile` | 5 |
| POST | `/loans/{id}/repayments` | 6 |
| POST | `/repayments/{id}/confirm` | 6 |
| POST | `/repayments/{id}/reject` | 6 |
| GET | `/notifications` | 7 |
| POST | `/notifications/{id}/read` | 7 |

---

## Core data entities

Implement from `Loan_App_Database_Design.pdf`. Do not invent a parallel model.

| Entity | Meaning |
|---|---|
| `users` | Stable identity; soft-delete / pseudonymize, do not cascade-wipe loans |
| `user_sessions` | Refresh-token hashes; device revoke |
| `friendships` | Connection / block; unique canonical pair |
| `loans` | Current shared state and accepted headline amounts |
| `loan_terms` | Versioned proposed/accepted terms |
| `repayments` | Claims and confirmations |
| `bank_profiles` | Encrypted repayment destinations |
| `bank_profile_shares` | Explicit reveal authorization |
| `loan_events` | Append-only timeline |
| `notifications` / `device_tokens` | In-app + push |
| `idempotency_records` | Replay protection |
| `attachments` | Private object-storage references |

Money: `NUMERIC(20,4)`. Currency: `CHAR(3)`. Timestamps: `TIMESTAMPTZ` UTC. IDs: UUID.

---

## Lony screens to implement

Build these Stitch screens as the primary UI, with spec-compliant copy and flows.

1. **Dashboard** — currency switcher, net position, owed / owing, action banners, loan cards, peer balances, bottom nav
2. **New loan** — lend vs borrow, counterparty, amount, flat interest, due date, note, receiving profile, send for acceptance
3. **Loan details** — status, terms, masked bank profile, reminder, event log
4. **Repayment confirmation** — claimed amount, optional proof, confirm or reject, zero-custody notice
5. **Bank profiles** — list, preferred, mask/reveal/copy, share/revoke
6. **Auth / profile / friends / activity** — not in the zip; design to the same tokens in `Lony/DESIGN.md`

Brand tokens (from Stitch): surface `#0b1326`, primary `#6bd8cb` / `#0D9488`, secondary `#ffb95f` / `#F59E0B`, tertiary `#93ccff` / `#0284C7`. Type: Manrope (UI), JetBrains Mono (ledger numbers).

---

## Suggested engineering sequence inside each phase

1. Schema / migration
2. Domain rules and unit tests (money, state guards)
3. API + integration tests
4. Mobile screens against the API
5. Manual happy-path check
6. Only then move to the next phase

Critical end-to-end path (from SDS testing strategy):

**register → connect as friends → request loan → accept terms → due reminder (simulated) → submit repayment → confirm**

---

## Immediate next step

Phase 0 is this document. After the frozen decisions above are accepted:

**Start Phase 1** — scaffold the monorepo, SQL schema for users/sessions, Go auth API, OpenAPI spec, and an Expo shell with Lony splash + sign-in.

Do not skip ahead to loans or dashboard until Phase 1 definition of done is met.
