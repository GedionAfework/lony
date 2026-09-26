# Lony — Full Financial Tracker Vision Roadmap

**Purpose:** Map the product vision (personal financial tracker + planning + three AI advisors + Lony Score + admin) to what exists today, what is missing, and a sequenced build plan.

**Audience:** Product owner and builders.

**Related docs:** Historical peer-loan plan lives in [`ROADMAP.md`](./ROADMAP.md). This file is the **target state** for Lony as a full financial life app. Where the two conflict, **this vision roadmap wins** for new work unless explicitly frozen otherwise.

**Last updated:** 2026-09-25

---

## 1. Product vision (target state)

Lony should help a person answer, continuously:

1. **What do I have?** — cash, bank balances, interest-bearing accounts, receivables.
2. **What do I owe?** — peer loans, institutional debt, bills, recurring obligations.
3. **What comes in and where does each cent go?** — income, expenses, categories, confirmation of expected money.
4. **What am I aiming for?** — travel, purchases, savings targets, life plans.
5. **How am I doing?** — trends, graphs, gaps, advice, and a **Lony Score** (credit-score-like health signal from behavior, not a bureau score).
6. **Who helps me?** — three specialized AIs (Analyst, Visual Analytics, Coach) plus human peer/loan chat.
7. **Who operates the platform?** — admins see users, health metrics, and basic ops dashboards.

Money still moves **outside** Lony (banks, mobile money, cash). Lony remains a **ledger, planner, and coach** — not a bank, wallet, or payment processor — unless a later phase deliberately adds open banking.

---

### Phase 0 decisions (frozen 2026-09-25)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Payment profiles vs balances | **Separate.** Bank profiles = how to get paid. Accounts = how much you have. |
| 2 | Money model | **Evolve in place** — keep cashflow + loans; add `accounts` beside them. |
| 3 | Balances v1 | **Manual only** — no open banking yet. |
| 4 | Interest on deposits | Optional rate + compounding on accounts; show 12‑month projection. |

---

## 2. Current state snapshot (as of codebase today)

### 2.1 What is already strong

| Area | Status | Notes |
|------|--------|--------|
| Auth & profile | Done | Email/password, Google, Telegram; onboarding (username, country, currency) |
| Peer / institutional loans | Done | Accept flow, installments, alone debt, co-lenders, repayments claim/confirm |
| Friends & social | Done | Friendships, invites, peer profiles |
| Chat | Done | DMs, loan threads, media/voice, read ticks |
| Payment profiles (“banks”) | Done | Encrypted identifiers for *how to get paid*, sharing — **not** live balances |
| Cashflow (income/expense) | In progress / usable | Categories, recurrence, expected→Received, expense share→loan, loan payment from expense |
| Loan dashboard & FX blend | Done | Receivables/payables, due soon, convert to preferred currency |
| Analytics (loan-centric) | Done (Phase 4) — Insights hub: cashflow series, categories, debts, goals |
| Push / workers | Done | Overdue, reminders, cashflow materialize |
| Mobile shell | Done | Home, Loans, Chat tabs; drawer: Expenses, Analytics, Plan, Settings |

### 2.2 What is stubbed or missing

| Area | Status |
|------|--------|
| **Plan** (goals / life plans) | Done (Phase 3) — goals, contribute, ETA |
| **Accounts & balances** (how much is in each bank) | Done (Phase 1) — manual balances + interest projection |
| **Interest-bearing accounts** (accrual projection) | Done (Phase 1) — optional rate + 12‑mo projection |
| **Unified net worth** | Done (Phase 1) — cash + loan nets by currency |
| **Budgets / envelopes** | Done (Phase 2) — monthly category budgets + burn |
| **Bill calendar** (first-class) | Partial via recurring cashflow only |
| **3 AIs** (Analyst, Analytics, Coach) | Missing entirely |
| **Lony Score** | Explicitly out of old v1 scope; not built |
| **Admin console** | Not built (no `internal/admin`, no web app) |
| **Data export** | “Coming soon” in Settings |
| **OpenAPI for cashflow** | API exists; contract lag in `packages/shared` |

### 2.3 Architectural tension to resolve early

Today Lony is still shaped as a **peer loan ledger** that grew an **expenses** module. The vision needs a **unified money model**:

- Accounts (cash, bank, wallet, investment placeholder)
- Transactions (income, expense, transfer between accounts)
- Obligations (loans in / loans out, installments)
- Plans / goals
- Insights / scores / AI artifacts

**Decision needed in Phase 0 of this roadmap:** either (A) evolve cashflow + loans into that model in place, or (B) introduce a new `ledger` domain and migrate. Recommended: **(A) evolve in place** with clear entities and adapters so loans and cashflow remain coherent.

---

## 3. Gap analysis vs your requirements

### 3.1 “Fill in how much they get each month / have in a bank / everything”

| Requirement | Today | Gap |
|-------------|-------|-----|
| Monthly income | Recurring income + Received | Needs **accounts** destination (which bank the salary lands in); projections of next months |
| Bank balances | Payment profile labels only | Need **manual balances** (v1) then optional open-banking later |
| Everything | Loans + some cashflow | Need assets, liabilities, transfers, starting balances, multi-currency net worth |

### 3.2 “Track where each cent goes”

| Requirement | Today | Gap |
|-------------|-------|-----|
| Categorized spend | Expense entries + categories | Transfers between own accounts; merchant/notes search; receipts; budgets vs actual |
| Confirmation | Expected → Received for income | Same discipline for planned expenses (“Paid”) already partial |
| Allocation | Expense share → peer loan | Split across categories/accounts; envelopes |

### 3.3 “Bank account with interest”

| Requirement | Today | Gap |
|-------------|-------|-----|
| Interest on deposits | None | Account interest rate, compounding schedule, projected balance, optional auto journal entries |
| Loan interest | Flat % / installment schedule | Keep; clarify UX vs deposit interest |

### 3.4 “Borrowed or lent — track that”

| Requirement | Today | Gap |
|-------------|-------|-----|
| Peer borrow/lend | Core product | Polish: link to cashflow & accounts when money actually moves |
| Institutional | Alone / long-term loans | Map to liability accounts; payment from Expenses already started |

### 3.5 Planning page (visit / buy / financial goals)

| Requirement | Today | Gap |
|-------------|-------|-----|
| Plan screen | Placeholder | Goals CRUD, target amount/date, linked savings account, progress, milestones, life-plan types |

### 3.6 Three AIs

| AI | Role you described | Today | Gap |
|----|-------------------|-------|-----|
| **AI-1 Analyst** | Trends, patterns, financial analysis | None | Pipelines + LLM/tooling over ledger data |
| **AI-2 Analytics** | Graphs, detailed results | Thin loan charts | Rich charts + narrative + exportable report objects |
| **AI-3 Coach** | Chatbot: what to do, gaps, improvements | None | RAG/chat over user money + safe advice policies |
| **Score** | Credit-score-like from trends | None | Scoring model, history, explainability |

### 3.7 Admin side

| Requirement | Today | Gap |
|-------------|-------|-----|
| User list | None | Admin auth, user CRUD/read, suspend |
| Dashboard analytics | None | Aggregate KPIs (signups, active loans, cashflow volume) |
| Basic admin pages | None | Web admin app or Expo-web admin |

---

## 4. Recommended product architecture (target)

```
┌─────────────────────────────────────────────────────────────┐
│ Mobile (Expo)                                                 │
│  Home · Money · Loans · Plan · Insights · Chat · Settings     │
└────────────────────────────┬────────────────────────────────┘
                             │ REST / OpenAPI
┌────────────────────────────▼────────────────────────────────┐
│ API (Go)                                                      │
│  auth · accounts · ledger · loans · plans · insights · chat   │
│  ai (analyst / analytics / coach) · score · admin             │
└───────┬───────────────────┬───────────────────┬─────────────┘
        │                   │                   │
   PostgreSQL            Redis/Asynq         AI provider
   (system of record)    (jobs, cache)       (LLM + tools)
        │
   Admin Web (Phase 6)
```

### 4.1 Core entities to add or formalize

1. **`accounts`** — type (`cash`, `bank`, `mobile_money`, `wallet`, `liability_mirror`), currency, current_balance, interest_rate_apr (nullable), compounding (`none`/`monthly`/`daily`), institution_label, optional link to `bank_profiles`.
2. **`ledger_transactions`** — unify or sit beside `cashflow_entries`: amount, direction, account_id, category_id, occurred_at, status (`expected`/`confirmed`), counterparty, linked_loan_id.
3. **`transfers`** — move between own accounts (no P&L).
4. **`goals` / `plans`** — type (`travel`, `purchase`, `savings`, `debt_payoff`, `custom`), target_amount, target_date, linked_account_id, progress.
5. **`ai_runs` / `ai_messages`** — store analysis outputs, chat threads per AI persona.
6. **`lony_scores`** — score, components, computed_at, explanation JSON.
7. **`admin_users` / roles** — or `users.role` (`user`/`admin`).

### 4.2 Non-goals (unless you reopen them)

- Holding customer funds / initiating transfers
- Official credit bureau reporting
- Guaranteeing investment returns
- Replacing a bank app’s statement download (until open banking is a deliberate phase)

---

## 5. Roadmap overview (phases)

| Phase | Name | Outcome | Est. effort* |
|-------|------|---------|--------------|
| **0** | Vision freeze & money model | Written decisions; schema sketch; IA for mobile | 1–2 weeks |
| **1** | Accounts & net worth | Manual balances, interest fields, net worth on Home | 3–5 weeks |
| **2** | Cent-level tracking upgrade | Transfers, account-linked cashflow, budgets vs actual | 4–6 weeks |
| **3** | Plan / goals | Full Plan product | 3–4 weeks |
| **4** | Insights foundation | Rich analytics graphs (non-AI) + data warehouse views | 3–4 weeks |
| **5** | Three AIs + Lony Score | Analyst, Analytics AI, Coach, score | 6–10 weeks |
| **6** | Admin console | Users, KPIs, moderation basics | 3–5 weeks |
| **7** | Hardening & polish | Export, privacy, evals, OpenAPI, performance | Ongoing |

\*Calendar time for a small team (1–2 eng + design). Parallelize 3∥4 where possible; 5 depends on 1–4 data quality.

---

## 6. Phase 0 — Vision freeze & money model

### Goals

- Agree product copy: “Full financial tracker & coach” while keeping legal safe language (not a bank).
- Freeze account types, currency rules, interest display rules.
- Decide navigation IA (keep drawer vs add Money / Insights tabs).
- Update [`ROADMAP.md`](./ROADMAP.md) “will not include” list (credit-like score and installments are no longer forbidden).

### Deliverables

1. **ADR: Unified ledger** — how `cashflow_entries` relate to `accounts` and loans.
2. **ADR: AI boundaries** — advice disclaimers, no investment guarantees, PII redaction.
3. **Screen map** — Figma/Stitch: Accounts, Net Worth, Plan, Insights (3 AI entry points), Score.
4. **Migration plan** — no big-bang rewrite of loans.

### Steps (checklist)

- [ ] Workshop: list every money object a user must enter in week 1 of using Lony
- [ ] Write user journeys: “First salary”, “Rent + shared dinner”, “Savings with 8% interest”, “Lent to friend”, “Trip to Bali goal”
- [ ] Choose: manual balances only for v1 accounts (recommended)
- [ ] Choose AI provider (OpenAI / Anthropic / Azure) + cost caps
- [ ] Choose admin surface: Expo web vs Next.js vs Retool-like (recommended: small Next.js admin)

### Exit criteria

Signed-off entity diagram + navigation wireframes + ADRs merged.

---

## 7. Phase 1 — Accounts, balances, interest, net worth

### Goals

Users can record **what they have** and see **net worth** = assets − liabilities (including loan payables/receivables).

### Backend steps

1. Migration `accounts` (+ optional `account_balance_snapshots` for history).
2. CRUD API: create/list/update/archive account; `POST /accounts/{id}/balances` to set balance at a date.
3. Interest fields: `interest_rate_percent`, `compounding`, `interest_credited_at`; job to **project** next interest (and optionally create expected income entries).
4. Net worth endpoint: `GET /wealth/summary` aggregating accounts + open loan nets (by currency + FX to preferred).
5. Link optional `bank_profile_id` for “how to pay” vs “how much I have” separation in UI copy.

### Mobile steps

1. **Accounts** screen (list + add bank/cash/wallet).
2. Balance edit with comma/2-decimal money inputs (reuse `amountFormat`).
3. Interest form + “projected in 12 months” helper text.
4. Home / Expenses dashboard: show **Net worth** and **Cash on hand**, not only cashflow period net.
5. Onboarding: optional “Add your main account & starting balance”.

### Data model sketch

```text
accounts
  id, user_id, name, type, currency_code
  balance numeric, balance_as_of timestamptz
  interest_rate_percent numeric null
  compounding varchar null
  institution_label, bank_profile_id null
  archived_at null

account_balance_events  -- audit of balance edits
  id, account_id, balance, noted_at, source ('manual'|'interest_job'|'import')
```

### Exit criteria

User can enter 2 banks + cash, set balances, see net worth including loan positions; interest projection visible for one savings account.

**Progress (2026-09-25):** Migration `00019`, API `/accounts` + `/wealth`, mobile Accounts screen + Home net-worth card shipped. Manual balances + 12‑mo interest projection live.

### Risks

- Users confuse payment profiles with balances → clear labeling (“Payment details” vs “Balance”).
- Multi-currency net worth needs FX (already have `/fx/rates`).

---

## 8. Phase 2 — Where every cent goes (ledger upgrade)

### Goals

Every inflow/outflow ties to an **account** and **category**; transfers don’t inflate income/expense; recurring + confirmation remain first-class.

### Backend steps

1. Add `account_id` (nullable→required after backfill) to cashflow entries.
2. Add `transfer` kind or separate `transfers` table (from_account, to_account, amount).
3. Summary APIs: by category, by account, by merchant/note; period compare (MoM).
4. Budgets: `budgets` (category, period monthly, limit_amount); burn vs limit endpoint.
5. Rules engine (optional): “if category=Rent → account=Checking”.
6. Keep expense→loan share and loan payment flows; when marking loan payment, optionally debit an account.

### Mobile steps

1. Create income/expense: **Account** selector required.
2. New **Transfer** flow.
3. Category analytics on Expenses dashboard (simple bars first).
4. Budget setup under Plan or Expenses.
5. Continue improving confirmation UX (Received / Paid).

### Exit criteria

Month view shows income, expenses, transfers, and budget burn; totals reconcile to account balance changes (within manual-balance caveats).

**Shipped 2026-09-25:** `account_id` on cashflow; `money_transfers`; monthly `budgets` + burn; category breakdown API; mobile account selector, Transfer, category bars, budget setup.

### Steps for “cent-level” discipline

- [x] Starting balance per account (on create)
- [x] Expenses/income can post to accounts
- [x] Optional “reconcile” screen: expected balance vs sum of ledger
- [x] Export CSV of ledger (feeds Phase 7)
- [x] Force account required on every entry

---

## 9. Phase 3 — Plan / life & financial goals

### Goals

Replace Plan placeholder with a real planning product.

### Goal types

| Type | Examples | Progress metric |
|------|----------|-----------------|
| `travel` | Visit Lisbon | Saved / target |
| `purchase` | Buy laptop | Saved / target |
| `savings` | Emergency fund 3 months | Balance / target |
| `debt_payoff` | Clear peer loan | Outstanding ↓ |
| `custom` | Freeform | Manual % or amount |

### Backend steps

1. Tables: `goals`, `goal_contributions` (optional).
2. CRUD + `GET /goals/{id}/projection` (months to target at current save rate).
3. Link goal → savings account or category “contributions”.
4. Notifications: milestone 25/50/75/100%; deadline risk.

### Mobile steps

1. Plan index: cards with progress rings.
2. Create goal wizard (type → target → date → linked account).
3. “Contribute” action logs transfer/expense category Savings.
4. Empty states that teach planning.

**Shipped 2026-09-25:** Goals CRUD, contributions (optional account debit), projection/ETA; Plan screen with progress bars and contribute. Milestone push notifications still optional.

### Goals

Build trustworthy analytics **without** LLM first so AI has clean features later.

### Metrics catalog (minimum)

- Income vs expense (period, MoM, YoY)
- Savings rate = (income − expense) / income
- Category breakdown (treemap/bars)
- Account balance history
- Debt service ratio (loan payments / income)
- Peer net by friend (existing)
- Goal funding rate
- Recurring obligations coverage (do expected incomes cover expected expenses?)

### Backend steps

1. `GET /insights/overview`, `/insights/cashflow-series`, `/insights/categories`, `/insights/debts`.
2. Materialized views or nightly aggregates in worker for speed.
3. Cache in Redis for hot endpoints.

### Mobile steps

1. Expand **Analytics** into **Insights** hub with tabs: Overview, Cashflow, Debts, Goals.
2. Real charts (Victory Native / Gifted Charts / Skia).
3. Keep loan friend chart; add cashflow series.

### Exit criteria

User sees 6+ months of cashflow chart and category breakdown from real data (seeded demo account for QA).

**Shipped 2026-09-25:** `/insights/overview|cashflow-series|categories|debts|goals`; Insights hub tabs (Overview, Cashflow, Debts, Goals) with month bars + category bars. Redis/materialized views deferred.

---

## 11. Phase 5 — Three AIs + Lony Score

### 11.1 Personas

| ID | Name (product) | Job | Primary UI |
|----|----------------|-----|------------|
| AI-1 | **Analyst** | Detect trends, anomalies, patterns; narrative analysis | Insights → “Analysis” report cards |
| AI-2 | **Visualizer** | Choose charts, explain numbers in detail, generate report packs | Insights → “Reports” with graphs + captions |
| AI-3 | **Coach** | Conversational advice: gaps, priorities, next actions | Chat-like screen (separate from peer chat) |
| Score | **Lony Trust** | A–E peer-lending trust grade | Home badge + Insights + peer profile / lend flow |

### 11.2 Shared AI platform (build once)

1. **Feature store** — JSON snapshot of user money metrics (from Phase 4) computed server-side; **never** send raw bank identifiers to the model.
2. **Tool APIs** — LLM may call: `get_overview`, `get_category_spend`, `get_goals`, `get_debts`, `get_score_components` (server-mediated).
3. **Prompt policies** — disclaimer footer; refuse illegal debt collection / guaranteed returns; local-currency aware.
4. **`ai_conversations`** — persona, messages, citations to metric ids.
5. **Rate limits & cost** — per-user daily caps; admin kill switch.
6. **Eval set** — 20 synthetic users; golden answers for regressions.

### 11.3 AI-1 Analyst — steps

1. Weekly job: compute features → call model → store `ai_insights` rows (`theme`, `severity`, `body`, `evidence`).
2. Mobile: feed of insight cards (“Spending on Food up 32% MoM”).
3. Anomaly rules first (deterministic), LLM narrative second.

### 11.4 AI-2 Visualizer — steps

1. Endpoint: `POST /ai/analytics/report` with period → returns chart specs + captions + tables.
2. Mobile renders charts from **structured JSON** (not model-drawn images) for accuracy.
3. “Explain this chart” deep-link into Coach with context.

### 11.5 AI-3 Coach — steps

1. `POST /ai/coach/messages` streaming optional.
2. System prompt: prioritize emergency fund, high-interest debt, goal deadlines; ask clarifying questions.
3. Action chips: “Create budget”, “Open goal”, “Log expense” → deep links.
4. Safety: store transcripts for user export/delete.

### 11.6 Lony Trust (A–E) — steps

**Important:** Market as **Lony Trust Index** (peer-lending reliability on Lony), not a bureau credit score.

Suggested component weights (v1, tunable):

| Component | Weight | Inputs |
|-----------|--------|--------|
| Repayment | 35% | Confirmed repayments ratio; overdue penalties |
| Debt burden | 25% | Open payables vs income; active borrows; overdue count |
| Consistency | 15% | Expected income Received + logging streak |
| Liquidity | 10% | Cash buffer vs monthly expenses |
| Savings | 10% | Trailing 3-month savings rate |
| Goals | 5% | Active goals on track |

Grades: **A** Strong (≥85) · **B** Good (≥70) · **C** Fair (≥55) · **D** Watch (≥40) · **E** High risk. Thin history caps at B; ≥2 overdue floors at D.

Friends (lenders) see grade via `GET /users/{id}/trust` before lending; full breakdown stays on self Insights.

**Shipped 2026-09-25 (v2 deterministic):** Replaced 300–850 with A–E Trust grade + points; peer trust endpoint; home/Insights/peer/lend UI. LLM personas / streaming deferred until model keys.

### Compliance / trust checklist

- [x] In-app disclaimer on every AI surface
- [x] No bureau data sold/bought in v1
- [x] User can delete AI history
- [x] Admin can disable AI globally

---

## 12. Phase 6 — Admin side

### Goals

Operators can see who uses Lony and platform health.

### Scope (v1 admin)

| Page | Features |
|------|----------|
| Login | Admin-only (role gate) |
| Users | Search, filter, view profile summary, suspend/unsuspend |
| User detail | Loans count, cashflow volume, last active, score |
| Overview | DAU/WAU, new signups, open loans, AI usage cost |
| Content / trust | Flagged chats (optional), repayment disputes count |
| System | Job failures, FX feed status, feature flags |

### Backend steps

1. `users.role` or `admin_users` table; middleware `RequireAdmin`.
2. Admin routes under `/api/v1/admin/...` (never reuse user JWT without role check).
3. Aggregate SQL for KPIs; paginated user list.
4. Audit log for admin actions.

### Frontend steps

1. Separate **admin web** app (`apps/admin` Next.js recommended) — do not overload mobile.
2. Basic charts (signups, active loans).
3. Link out to support tools later.

### Exit criteria

Admin can list users, open one user, see KPI dashboard, suspend a user; action audited.

**Shipped 2026-09-25 (v1):** `users.role` + `admin_audit_log`; `ADMIN_EMAILS` bootstrap; `/api/v1/admin/overview|users|audit` with `RequireAdmin`; suspend/unsuspend (+ session revoke); `apps/admin` Vite console (overview, users, audit).

**Catalogs (2026-09-26):** `catalog_types` + `catalog_institutions` (global, not country-locked); admin Catalogs tab CRUD; public `GET /catalogs/types|institutions` for mobile; mobile Accounts merges API catalogs with local fallback.

**Bonds (2026-09-26):** No product “friend request.” Accepting a peer loan or expense-split creates/upgrades a bond; repayments increase `interaction_count` → acquaintance / friend / close. `GET /peers` ranks interacted people for expense circles.

---

## 13. Phase 7 — Hardening, privacy, polish

- Data export (GDPR-style zip: profile, ledger, loans, AI chats)
- Account deletion cascade
- OpenAPI complete (cashflow, accounts, goals, AI, admin)
- Performance: indexes, pagination everywhere
- Mobile offline draft for expense entry (nice-to-have)
- Localization expansion
- Security review: field encryption remains for payment identifiers; AI payloads scrubbed
- Update README product paragraph to match vision

**Shipped 2026-09-26 (v1):** `GET /me/export` (json/zip); `POST /me/delete` (soft-delete + redact + revoke sessions); `POST /ai/insights/clear`; `platform_settings.ai_disabled` + admin toggle; Insights/Coach disclaimer always shown; OpenAPI paths for accounts/goals/insights/score/AI/admin/export; README updated. Deferred: offline drafts, full locale pack, reconcile UI, LLM personas.

**Shipped 2026-09-26 (v2 polish):** Ledger CSV (`format=csv|ledger|csvtext`); `account_id` required on cashflow create/update; offline expense drafts + sync; Expenses “Coming up” bill calendar (expected cashflow + loan dues); locale + timezone SearchSelect; OpenAPI cashflow/peers/catalogs/budgets. Deferred: LLM personas only.

---

## 14. Suggested mobile information architecture (target)

| Nav | Contents |
|-----|----------|
| **Home** | Net worth, Lony Score, due soon, AI top insight, quick add |
| **Money** | Accounts, Income, Expenses, Transfers, Budgets |
| **Loans** | Peer + institutional (existing) |
| **Plan** | Goals / life plans |
| **Insights** | Graphs + Analyst + Visualizer reports |
| **Chat** | People chat + entry to **Coach** (AI-3) |
| **Settings** | Profile, banks (payment details), AI prefs, export |

Drawer can collapse into this once tabs stabilize.

---

## 15. Dependency graph (what blocks what)

```text
Phase 0 (model)
    ↓
Phase 1 (accounts / net worth) ──────────────┐
    ↓                                        │
Phase 2 (ledger / budgets) ──→ Phase 4 (insights metrics)
    ↓                              ↓
Phase 3 (goals) ───────────────────┤
                                   ↓
                            Phase 5 (AIs + Score)
Phase 1–4 data quality ──→ Phase 6 (admin KPIs)
Phase 5–6 ──→ Phase 7 (export / compliance)
```

---

## 16. Milestone releases (shipping slices)

| Release | Ship when… |
|---------|------------|
| **M1 — Wealth base** | Accounts + net worth on Home |
| **M2 — Full tracking** | Account-linked cashflow + transfers + budgets |
| **M3 — Plans live** | Goals CRUD + progress |
| **M4 — Insights** | Rich charts (no LLM yet) |
| **M5 — AI + Score** | Three AIs + Lony Score |
| **M6 — Operate** | Admin console |

Do not wait for M5 to ship M1–M4; each milestone should be usable alone.

---

## 17. Detailed backlog (epics → example tickets)

### Epic A — Accounts

1. DB migration accounts + balance events  
2. API CRUD + set balance  
3. Mobile accounts list/create  
4. Interest fields + projection job  
5. Wealth summary API + Home widgets  
6. Copy/UX separating payment profiles vs balances  

### Epic B — Ledger upgrade

1. `account_id` on cashflow + backfill wizard  
2. Transfers API + UI  
3. Budgets API + UI  
4. Category insights endpoint  
5. Reconcile “expected vs logged” screen  

### Epic C — Goals

1. Schema + API  
2. Plan screens  
3. Contribute flow  
4. Push milestones  

### Epic D — Insights

1. Time-series endpoints  
2. Chart library integration  
3. Insights hub IA  

### Epic E — AI platform

1. Feature snapshot builder  
2. Provider client + secrets  
3. Tool-calling gateway  
4. Analyst weekly job  
5. Visualizer report JSON  
6. Coach chat UI  
7. Disclaimers + delete history  

### Epic F — Lony Score

1. Formula + tests  
2. Persistence + API  
3. UI breakdown  
4. Improvement tips mapped to deep links  

### Epic G — Admin

1. Role model  
2. Admin API  
3. `apps/admin` scaffold  
4. Users + overview pages  
5. Audit log  

---

## 18. Testing & quality bar

| Layer | Requirement |
|-------|-------------|
| Unit | Score formula, interest projection, budget burn |
| API | IDOR tests for accounts/goals/AI (extend existing loan IDOR style) |
| Mobile | Money formatting (commas, 2 decimals) on all amount fields |
| AI | Eval suite; never assert exact prose, assert evidence ids present |
| Admin | Role denial tests for normal users |

---

## 19. Open product decisions (answer before Phase 5)

1. Is Lony Trust shown to **peers**, or private only? (**Decision: friends-only** via `/users/{id}/trust`.)  
2. Can Coach suggest borrowing more? (Recommend **no** — focus on repayment & savings.)  
3. Manual balances forever vs open banking in a later Phase 8?  
4. Admin: internal staff only, or org owners for family accounts later?  
5. Multi-user households / shared budgets — in or out of next 12 months?

---

## 20. Success metrics

| Metric | Target (6 months after M5) |
|--------|----------------------------|
| WAU who logged ≥1 money event | Growing MoM |
| % users with ≥1 account balance | >60% of WAU |
| % users with ≥1 active goal | >25% |
| Coach sessions / WAU | >0.3 |
| Score recompute freshness | <24h |
| Admin time to find a user | <10s search |

---

## 21. Summary — what’s left in one page

**Already have:** social lending, chat, payment-profile sharing, cashflow income/expenses with recurrence and confirmation, accounts/net worth, budgets, goals, insights, A–E Trust, admin + catalogs, export/delete (JSON/zip/CSV), offline drafts, bill calendar, locale/timezone pickers, **bonds via loan/split accept** (no friend-request product surface).

**Still open / deferred:**
- LLM-backed Analyst / Visualizer / Coach personas (rule-based AI exists)
- Optional open banking (Phase 8)

**Operate:** Admin catalogs for institutions/types — shipped; expand KPIs/charts as needed.

**Reconcile (2026-09-26):** `GET /accounts/reconcile` (+ per-account); Accounts screen compare stated vs ledger since last manual set; “Set balance to ledger”.

---

## 22. Immediate next actions (this week)

1. Review and approve Phase 0 decisions in this file (especially accounts vs payment profiles).  
2. Sketch Home with Net worth + Score placeholder.  
3. Start **Epic A** migration + API for `accounts` (Phase 1).  
4. Keep polishing cashflow UX without blocking Phase 1.  
5. Schedule AI provider + legal disclaimer draft before any Phase 5 coding.

---

*This roadmap is living documentation. Update the checklists as epics ship; move completed gaps into a “Shipped” changelog at the bottom of this file.*
