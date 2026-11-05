package legal

import "time"

// Version identifies the current Terms of Service document.
const Version = "tos-2026-11-04"

// Disclaimer is the short product notice shown next to acceptance checkboxes.
const Disclaimer = "Lony is a shared ledger and reminder app, not a bank, wallet, escrow, or payment processor. " +
	"Money moves outside the app. Lony never holds funds, never initiates transfers, and does not collect debt. " +
	"Records are for personal tracking only and are not legally binding contracts."

// Text keeps the historical short constant used by older call sites.
const Text = Disclaimer

// Document is the full Terms of Service shown in-app (a small Markdown subset:
// headings, bullets, **bold**, and --- rules).
const Document = DocumentText

// AcceptedAt formats acceptance timestamps for API responses.
func AcceptedAt(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

func RequiredAccepted(ok bool) bool {
	return ok
}
