# Net worth integrity — no money counted twice

Status: implemented (2026-10-30). Owner: backend + web + mobile.

## Rule

Every unit of money appears in net worth **exactly once**:

```
net worth = Σ non-card account balances            (cash on hand)
          + Σ what peers still owe me              (receivables)
          − Σ card balances
          − Σ what I still owe                     (payables)
```

"Still owe" means `loans.outstanding_amount` (after confirmed repayments and paid
installments), never the original `expected_total`. Implemented by
`loans.Record.Remaining()` and used by `/wealth`, `/insights/overview`,
`/insights/debts` and the loan DTO (`outstanding_amount`).

Three situations could still count the same money twice. Each is fixed by
**linking** the records that describe the same money, never by guessing.

---

## Fix 3 (do first) — self-recorded debts could never be marked repaid

**Problem.** For an *alone* loan (bank, MFI, card plan…) the user is both
`lender_id` and `borrower_id`. `repayments.Confirm` forbids confirming your own
claim, so the claim stayed `pending` forever and the payable never dropped,
while the expense had already reduced the account.

**Fix.**
- `Claim` on an institutional loan (`Record.IsInstitutional()`) confirms
  immediately in the **same transaction**: repayment row `confirmed`,
  `outstanding_amount` reduced, status `completed`/`active`/`overdue`, both
  `repayment_claimed` and `repayment_confirmed` events written.
- `Confirm` allows self-confirmation **only** for institutional loans, so claims
  already stuck in `pending` can be confirmed by the user from the loan screen
  (the button already shows). No silent data migration.

## Fix 1 — paying a loan from an account

**Problem.** The client made two separate calls — create expense, then claim
repayment. If the second failed, the expense existed without a claim. And while a
claim waits for the lender, the borrower's account is already down but the
payable is still full.

### Data

Migration `00049_net_worth_links.sql`:

| Column | On | Meaning |
|---|---|---|
| `paid_entry_id uuid NULL → cashflow_entries ON DELETE SET NULL` | `repayments` | the borrower's expense that paid this claim |
| `received_entry_id uuid NULL → cashflow_entries ON DELETE SET NULL` | `repayments` | the lender's income that received it |

Both have a partial unique index: one cashflow entry backs at most one repayment.
`ON DELETE SET NULL` keeps totals self-consistent if the user deletes the entry.

### API

`POST /loans/{id}/repayments` — new optional fields:

| Field | Effect |
|---|---|
| `pay_from_account_id` (+ `title`, `category_id`, `occurred_at`) | In **one DB transaction**: insert the expense (linked to the loan), adjust the account balance, insert the claim with `paid_entry_id`, update the loan, write the event. All or nothing. |
| `paid_entry_id` | Link an expense the borrower already recorded (used to resubmit after a rejection). Must be the borrower's own confirmed expense, same currency, amount ≥ claim, not linked to another live repayment. |

`POST /repayments/{id}/confirm` — new optional fields:

| Field | Effect |
|---|---|
| `received_account_id` | Same transaction: insert the lender's income entry, adjust the balance, set `received_entry_id`. |
| `received_entry_id` | Link income the lender already logged by hand, so it is not added again. |

`POST /repayments/{id}/resolve` `{ "action": "undo_expense" | "keep_expense" }` —
only for a **rejected** claim that still has `paid_entry_id`:
- `undo_expense` deletes the expense **and reverses its account balance change**
  in one transaction.
- `keep_expense` unlinks it; it stays as a normal expense (user's explicit choice,
  e.g. a dispute where the money really left).
- Resubmitting (`POST /loans/{id}/repayments` with `paid_entry_id`) moves the link
  to the new claim.

`RepaymentDTO` gains `paid_entry_id`, `received_entry_id`, `needs_resolution`
(= rejected and still linked to an expense).

### Totals

For the **borrower**, payables = `Remaining()` − the pending claim **if** it has a
`paid_entry_id` (money provably left a tracked account). A claim with no linked
expense is not subtracted, so nothing is under-counted. The loan record carries
`PendingPaid` (loaded with the loan) and `RemainingFor(viewer)` applies the rule.
Lender totals are unchanged until the lender confirms.

| State | Borrower cash | Borrower payable | Counted once? |
|---|---|---|---|
| Paid from account, pending | −X | outstanding − X | ✔ |
| Confirmed | −X | outstanding (already −X) | ✔ |
| Rejected, unresolved | −X | outstanding | flagged "Payment rejected" until resolved |
| Rejected → undo | 0 | outstanding | ✔ |
| Rejected → resubmit | −X | outstanding − X | ✔ |
| Expense deleted by user | (unchanged by delete today, see Known gaps) | outstanding | link cleared |

### UI

- Cashflow form "Loan payment" (web + mobile) sends **one** request with
  `pay_from_account_id`; no client-side two-step.
- Loan detail, lender confirming: optional "Add to account" picker, or "I already
  recorded it" picker of matching income entries.
- Loan detail, borrower with a rejected linked claim: banner *"Payment rejected —
  money left {account}"* with **Resubmit**, **Undo expense**, **Keep as expense**.

## Fix 2 — the same debt as a card and as a loan

**Problem.** A credit card account's balance already includes purchases and
installment plans on that card. If the user also records an alone loan for that
debt, it is subtracted twice.

**Fix — link, don't block.**
- `loans.linked_account_id uuid NULL → money_accounts ON DELETE SET NULL` and
  `loans.account_link_dismissed boolean NOT NULL DEFAULT false`.
- Only alone loans may link, only to the user's own **credit card** account in the
  **same currency**.
- Wealth skips a loan whose linked card is an active (non-archived) account,
  because the card balance already covers it. If the card is archived/deleted,
  the loan counts again.
- `GET /accounts/debt-matches?institution=&currency=` returns the user's credit
  cards whose institution/name matches. New-loan forms call it when an
  institution is chosen and ask: *"Is this part of your {card}? Card debts are
  already counted in the card balance."* → **Yes, link it** / **No, separate debt**.
- `GET /loans/possible-duplicates` lists open, unlinked, non-dismissed alone loans
  that match a card. Shown on Accounts as *"These may be counted twice"* with
  **Link to card** / **Not the same** (`POST /loans/{id}/account-link`
  `{ account_id | dismiss: true }`). Nothing changes until the user answers.

## Known gaps (out of scope, tracked)

- ~~Deleting or editing a cashflow entry did not move the balance.~~ Fixed by
  migration `00050`: `cashflow_entries.balance_applied_at` records when an entry
  moved its account. Applying is idempotent; delete reverses and edit re-applies the
  change in one transaction, **only if** it happened after the account's last
  stated balance (manual set, reconcile, bank SMS), because a stated balance
  already reflects reality. Existing rows were backfilled from `created_at`
  (bill instances: `updated_at`); SMS rows that carried a bank balance stay NULL.
- Pending-claim subtraction needs the claim to be linked; claims submitted from
  older app versions are not subtracted until confirmed.

## Tests

- `accounts`: wealth uses remaining; pending linked claim subtracted for borrower
  only; linked card loan skipped; archived card → loan counts again.
- `repayments`: institutional claim auto-confirms; self-confirm allowed only when
  institutional; claim with expense is atomic (store failure ⇒ no expense);
  paid_entry validation; resolve undo/keep; resubmit moves link; confirm with
  received entry.
- `loans`: link validation (alone only, own card, same currency).
- `dashboard`: pending linked claim lowers the borrower's loan payables only.
- `store` (real Postgres, all migrations): claim + expense rolls back as a whole
  when the repayment insert fails; undo restores the balance; lender receives into
  an account once; a card-linked alone debt is subtracted once. Run with
  `LONY_TEST_DATABASE_URL=postgres://… go test ./internal/store -run NetWorth`
  (skipped when unset). Never point it at production.
