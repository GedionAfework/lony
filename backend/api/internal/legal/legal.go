package legal

import "time"

// Version identifies the current Terms of Service document.
const Version = "tos-2026-09-21"

// Disclaimer is the short product notice shown next to acceptance checkboxes.
const Disclaimer = "Lony is a shared ledger and reminder app, not a bank, wallet, escrow, or payment processor. " +
	"Money moves outside the app. Lony never holds funds, never initiates transfers, and does not collect debt. " +
	"Records are for personal tracking only and are not legally binding contracts."

// Text keeps the historical short constant used by older call sites.
const Text = Disclaimer

// Document is the full Terms of Service shown in-app.
const Document = `# Lony Terms of Service

**Effective date:** 21 September 2026  
**Version:** ` + Version + `

These Terms of Service (“Terms”) govern your access to and use of Lony, including the mobile application, related APIs, and support channels (together, the “Service”). By creating an account, accepting these Terms, or using the Service, you agree to be bound by them.

If you do not agree, do not use Lony.

---

## 1. What Lony is

Lony is a **shared personal loan ledger and reminder tool**. It helps people:

- record informal peer-to-peer loans between accepted contacts;
- chat about those loans;
- store and share payment destination details (for example bank, mobile money, or crypto identifiers);
- claim and confirm that a repayment happened **outside** the app;
- receive reminders about due dates.

Lony is **not**:

- a bank, credit union, money transmitter, payment institution, or e-money issuer;
- a wallet, escrow, custody, or settlement system;
- a lender, borrower, guarantor, collection agency, or credit bureau;
- a marketplace that executes transfers of money for you.

**Money always moves outside Lony** through channels you choose (bank transfer, mobile money, cash, crypto rails, or other third-party services). Lony only stores records and notifications about those off-platform movements.

---

## 2. Eligibility and accounts

You must be at least **18 years old** (or the age of majority where you live, if higher) and able to form a binding contract.

You agree to:

- provide accurate registration and profile information;
- keep your username, contact details, and payment profiles up to date;
- keep login credentials and devices secure;
- use only one account unless we expressly allow otherwise.

We may refuse, suspend, or terminate accounts that appear abusive, fraudulent, underage, or in violation of these Terms.

Signing in with email, Google, or Telegram links an identity to your Lony account. WhatsApp Sign-In is not offered because Meta does not provide a consumer Sign-In product for this use.

---

## 3. Shared ledger records (not legal contracts)

Loan records, chat messages, repayment claims, confirmations, and bank-profile shares in Lony are **tools for personal bookkeeping and communication**.

They are **not** automatically:

- legally binding loan agreements;
- promissory notes;
- debt instruments;
- proof sufficient by themselves for court or regulatory purposes.

You and the other party remain solely responsible for any real-world agreement, local law compliance, tax reporting, and evidence you may need outside Lony.

---

## 4. Friendships, chat, and sharing

You may only message and share payment details with users you have connected with through the Service’s friendship / acceptance flows (or with the other party on a shared loan, where the product allows).

You must not:

- harass, threaten, scam, or impersonate others;
- share another person’s payment identifiers without permission;
- upload illegal, harmful, or infringing content;
- attempt to probe, scrape, or disrupt the Service.

Payment profile sharing reveals masked details by default. Full account numbers require a recent re-authentication window and remain your responsibility to handle carefully.

---

## 5. Payment profiles and third-party rails

You may save payment destinations such as bank accounts, IBAN/SEPA details, mobile money wallets, cards (as labels/identifiers you choose to store), PayPal/Wise-style handles, UPI/Pix identifiers, crypto addresses, and similar rails.

Lony:

- encrypts sensitive identifiers at rest where the product design requires it;
- does **not** verify that an account belongs to you beyond basic validation;
- does **not** initiate or guarantee any transfer.

You are responsible for typing identifiers correctly and for confirming receipt with the counterparty outside the app.

---

## 6. Repayments, proofs, and confirmations

A borrower may claim that a repayment was sent and optionally attach a receipt/proof file. A lender may confirm or reject that claim.

Confirmation in Lony means **the parties recorded agreement in the app**. It does not mean Lony verified bank clearance, blockchain finality, or cash delivery.

Optional proof attachments are stored for the parties’ convenience. Do not upload content you are not allowed to share.

---

## 7. No funds, no credit decisions, no collections

Lony never holds customer funds and never moves money between users.

Lony does not:

- underwrite credit;
- score trust or creditworthiness as a product feature;
- collect debts on anyone’s behalf;
- provide investment, tax, or legal advice.

If a counterparty fails to repay, your remedies are between you and that person under applicable law—not against Lony as a payment intermediary.

---

## 8. Notifications and reminders

Push and in-app notifications are best-effort conveniences. Delivery depends on device settings, network conditions, and third-party push providers. Do not rely on Lony alone as your only calendar or legal reminder system.

---

## 9. Intellectual property

Lony, its branding (including the Lony mark), software, and documentation are owned by the Lony operator or its licensors. You receive a limited, revocable, non-exclusive license to use the Service for personal, lawful purposes.

You retain rights to content you upload, and you grant Lony a worldwide license to host, process, and display that content solely to operate the Service for you and your counterparties.

---

## 10. Privacy

We process account, device, chat, loan, and payment-profile data to provide the Service. Sensitive payment identifiers are protected with encryption at rest where applicable. See the in-app privacy summary and any separate privacy notice we publish for details on retention and requests.

---

## 11. Acceptable use and prohibited activities

You must not use Lony to:

- facilitate money laundering, terrorist financing, sanctions evasion, or fraud;
- run unauthorized commercial debt collection;
- store or distribute malware or exploit other users’ devices;
- reverse engineer the Service except where mandatory law allows;
- bypass rate limits, access controls, or authentication.

We may investigate and cooperate with lawful requests from authorities when required.

---

## 12. Disclaimers

THE SERVICE IS PROVIDED **“AS IS”** AND **“AS AVAILABLE.”** TO THE MAXIMUM EXTENT PERMITTED BY LAW, LONY DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

We do not warrant that records are error-free, that notifications will always arrive, or that third-party payment rails will succeed.

---

## 13. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, LONY AND ITS OPERATORS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, LOST DATA, OR BUSINESS INTERRUPTION, ARISING FROM YOUR USE OF THE SERVICE OR FROM ANY OFF-PLATFORM TRANSFER BETWEEN USERS.

OUR TOTAL LIABILITY FOR CLAIMS RELATING TO THE SERVICE IS LIMITED TO THE GREATER OF (A) THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE THREE MONTHS BEFORE THE CLAIM (IF ANY) OR (B) FIFTY US DOLLARS (USD 50) OR LOCAL EQUIVALENT.

Some jurisdictions do not allow certain limitations; in those places, our liability is limited to the fullest extent allowed.

---

## 14. Indemnity

You agree to defend and indemnify Lony against claims arising from your content, your misuse of the Service, your off-platform transfers, or your violation of these Terms or applicable law.

---

## 15. Suspension and termination

You may stop using Lony at any time. We may suspend or terminate access for violations, risk, prolonged inactivity, or to shut down the Service.

Upon termination, we may retain records as required for security, dispute handling, legal obligations, or backup cycles, then delete or anonymize them according to our retention practices.

---

## 16. Changes

We may update these Terms. Material changes will be reflected by a new version identifier (shown in-app). Continued use after the effective date of a new version constitutes acceptance where permitted by law. If you do not agree, stop using the Service and request account closure.

---

## 17. Governing law

Unless mandatory local consumer law requires otherwise, these Terms are governed by the laws of the jurisdiction where the Lony operator is established, without regard to conflict-of-law rules. Courts in that jurisdiction will have exclusive venue, subject to any non-waivable consumer rights where you live.

---

## 18. Contact

For Terms questions, account issues, or privacy requests, contact support through the in-app help channel or the support email published with the Service.

---

By tapping **Accept** (or creating / continuing an account after being shown these Terms), you acknowledge that you have read and understood this document, including that **Lony does not hold or move money** and that **in-app loan records are not automatic legal contracts**.
`

// AcceptedAt formats acceptance timestamps for API responses.
func AcceptedAt(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

func RequiredAccepted(ok bool) bool {
	return ok
}
