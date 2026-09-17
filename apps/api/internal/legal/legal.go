package legal

// Version identifies the current product disclaimer text.
const Version = "v1"

const Text = "Lony is a shared ledger and reminder app, not a bank, wallet, escrow, or payment processor. " +
	"Money moves outside the app. Lony never holds funds, never initiates transfers, and does not collect debt. " +
	"Records are for personal tracking only and are not legally binding contracts."

func RequiredAccepted(ok bool) bool {
	return ok
}
