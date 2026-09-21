package dashboard

import (
	"sort"
	"time"

	"equilend/api/internal/loans"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

const DueSoonWindow = loans.DueSoonWindow

type Summary struct {
	PendingRequests      int             `json:"pending_requests"`
	PendingConfirmations int             `json:"pending_confirmations"`
	ByCurrency           []CurrencySlice `json:"by_currency"`
}

type CurrencySlice struct {
	CurrencyCode    string          `json:"currency_code"`
	Receivables     string          `json:"receivables"`
	Payables        string          `json:"payables"`
	Net             string          `json:"net"`
	DueSoon         string          `json:"due_soon"`
	DueSoonCount    int             `json:"due_soon_count"`
	PendingRequests int             `json:"pending_requests"`
	OpenLoanCount   int             `json:"open_loan_count"`
	Friends         []FriendBalance `json:"friends"`
}

type FriendBalance struct {
	Peer        loans.Party `json:"peer"`
	Receivables string      `json:"receivables"`
	Payables    string      `json:"payables"`
	Net         string      `json:"net"`
}

type bucket struct {
	recv, pay, due decimal.Decimal
	dueCount       int
	pending        int
	open           int
	friends        map[uuid.UUID]*friendAcc
}

type friendAcc struct {
	peer      loans.Party
	recv, pay decimal.Decimal
}

func Build(actor uuid.UUID, now time.Time, rows []loans.Record, parties map[uuid.UUID]loans.Party) Summary {
	now = now.UTC()
	by := map[string]*bucket{}
	pendingAll := 0
	pendingConfirm := 0

	for _, row := range rows {
		if pendingAction(actor, row) {
			pendingAll++
			if code := currencyOf(row); code != "" {
				ensure(by, code).pending++
			}
		}
		if row.Status == loans.StatusRepaymentPending && row.LenderID == actor {
			pendingConfirm++
		}
		if !isOpen(row) {
			continue
		}
		code := currencyOf(row)
		if code == "" {
			continue
		}
		b := ensure(by, code)
		amt := outstanding(row)
		if !amt.GreaterThan(decimal.Zero) {
			continue
		}
		b.open++
		peerID := row.OtherParty(actor)
		fa := b.friends[peerID]
		if fa == nil {
			fa = &friendAcc{peer: parties[peerID]}
			if fa.peer.ID == uuid.Nil {
				fa.peer = loans.Party{ID: peerID}
			}
			b.friends[peerID] = fa
		}
		if row.LenderID == actor {
			b.recv = b.recv.Add(amt)
			fa.recv = fa.recv.Add(amt)
		} else {
			b.pay = b.pay.Add(amt)
			fa.pay = fa.pay.Add(amt)
		}
		if isDueSoon(row, now) {
			b.due = b.due.Add(amt)
			b.dueCount++
		}
	}

	codes := make([]string, 0, len(by))
	for code, b := range by {
		if b.open > 0 || b.pending > 0 {
			codes = append(codes, code)
		}
	}
	sort.Strings(codes)

	out := Summary{
		PendingRequests:      pendingAll,
		PendingConfirmations: pendingConfirm,
		ByCurrency:           make([]CurrencySlice, 0, len(codes)),
	}
	for _, code := range codes {
		b := by[code]
		slice := CurrencySlice{
			CurrencyCode:    code,
			Receivables:     b.recv.StringFixed(loans.Scale),
			Payables:        b.pay.StringFixed(loans.Scale),
			Net:             b.recv.Sub(b.pay).StringFixed(loans.Scale),
			DueSoon:         b.due.StringFixed(loans.Scale),
			DueSoonCount:    b.dueCount,
			PendingRequests: b.pending,
			OpenLoanCount:   b.open,
			Friends:         make([]FriendBalance, 0, len(b.friends)),
		}
		for _, fa := range b.friends {
			slice.Friends = append(slice.Friends, FriendBalance{
				Peer:        fa.peer,
				Receivables: fa.recv.StringFixed(loans.Scale),
				Payables:    fa.pay.StringFixed(loans.Scale),
				Net:         fa.recv.Sub(fa.pay).StringFixed(loans.Scale),
			})
		}
		sort.Slice(slice.Friends, func(i, j int) bool {
			if slice.Friends[i].Peer.DisplayName == slice.Friends[j].Peer.DisplayName {
				return slice.Friends[i].Peer.ID.String() < slice.Friends[j].Peer.ID.String()
			}
			return slice.Friends[i].Peer.DisplayName < slice.Friends[j].Peer.DisplayName
		})
		out.ByCurrency = append(out.ByCurrency, slice)
	}
	return out
}

func newBucket() *bucket {
	return &bucket{friends: map[uuid.UUID]*friendAcc{}}
}

func ensure(by map[string]*bucket, code string) *bucket {
	if b, ok := by[code]; ok {
		return b
	}
	b := newBucket()
	by[code] = b
	return b
}

func currencyOf(row loans.Record) string {
	if row.CurrencyCode == nil {
		return ""
	}
	return *row.CurrencyCode
}

func outstanding(row loans.Record) decimal.Decimal {
	if row.OutstandingAmount != nil {
		return *row.OutstandingAmount
	}
	if row.ExpectedTotal != nil {
		return *row.ExpectedTotal
	}
	return decimal.Zero
}

func isOpen(row loans.Record) bool {
	return row.Status == loans.StatusActive || row.Status == loans.StatusOverdue || row.Status == loans.StatusRepaymentPending
}

func isDueSoon(row loans.Record, now time.Time) bool {
	if row.Status != loans.StatusActive || row.DueAt == nil {
		return false
	}
	due := row.DueAt.UTC()
	return due.After(now) && !due.After(now.Add(DueSoonWindow))
}

func pendingAction(actor uuid.UUID, row loans.Record) bool {
	if row.Status != loans.StatusPending {
		return false
	}
	if awaiting := row.AwaitingUserID(); awaiting != nil && *awaiting == actor {
		return true
	}
	return row.CurrentTermsID == nil && row.InitiatorID != actor
}
