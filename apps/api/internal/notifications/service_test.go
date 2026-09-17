package notifications

import (
	"context"
	"strings"
	"testing"
	"time"

	"equilend/api/internal/loans"

	"github.com/google/uuid"
)

func TestScheduleAndProcessReminders(t *testing.T) {
	store := newMemoryStore()
	svc := NewService(store, LogPusher{})
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }

	borrower := uuid.New()
	lender := uuid.New()
	loanID := uuid.New()
	due := now.Add(3 * 24 * time.Hour)
	loan := loans.Record{
		ID: loanID, ReferenceCode: "LN-TEST01",
		BorrowerID: borrower, LenderID: lender,
		Status: loans.StatusActive, DueAt: &due,
	}
	store.loans[loanID] = OpenLoan{
		ID: loanID, ReferenceCode: "LN-TEST01",
		BorrowerID: borrower, LenderID: lender,
		Status: loans.StatusActive, DueAt: due,
	}

	if err := svc.ScheduleLoanReminders(context.Background(), loan); err != nil {
		t.Fatal(err)
	}
	// 2 users * 5 milestones
	if len(store.jobs) != 10 {
		t.Fatalf("jobs %d", len(store.jobs))
	}
	// deterministic keys / no duplicates
	if err := svc.ScheduleLoanReminders(context.Background(), loan); err != nil {
		t.Fatal(err)
	}
	if len(store.jobs) != 10 {
		t.Fatalf("dup jobs %d", len(store.jobs))
	}

	// advance past due-3d
	svc.now = func() time.Time { return due.Add(-3*24*time.Hour + time.Minute) }
	n, err := svc.ProcessDueJobs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n < 2 {
		t.Fatalf("processed %d", n)
	}
	notes, err := svc.List(context.Background(), borrower, false)
	if err != nil || len(notes) == 0 {
		t.Fatalf("inbox %+v %v", notes, err)
	}
	raw := notes[0].Body + notes[0].Title
	if strings.Contains(raw, "account") || strings.Contains(strings.ToLower(raw), "1000") {
		t.Fatalf("excess detail in copy %q", raw)
	}
	if notes[0].PushStatus != PushSkipped && notes[0].PushStatus != PushSent {
		t.Fatalf("push status %s", notes[0].PushStatus)
	}
}

func TestReconcileRebuildsMissingJobs(t *testing.T) {
	store := newMemoryStore()
	svc := NewService(store, LogPusher{})
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }
	borrower := uuid.New()
	lender := uuid.New()
	loanID := uuid.New()
	due := now.Add(10 * 24 * time.Hour)
	store.loans[loanID] = OpenLoan{
		ID: loanID, ReferenceCode: "LN-REC001",
		BorrowerID: borrower, LenderID: lender,
		Status: loans.StatusActive, DueAt: due,
	}
	n, err := svc.Reconcile(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n != 10 {
		t.Fatalf("created %d", n)
	}
	n2, err := svc.Reconcile(context.Background())
	if err != nil || n2 != 0 {
		t.Fatalf("second reconcile %d %v", n2, err)
	}
}

func TestInboxWithoutDeviceToken(t *testing.T) {
	store := newMemoryStore()
	svc := NewService(store, LogPusher{})
	user := uuid.New()
	if err := svc.Notify(context.Background(), user, TypeFriendRequest, nil, "Friend request", "Someone wants to connect on Lony.", nil); err != nil {
		t.Fatal(err)
	}
	list, err := svc.List(context.Background(), user, true)
	if err != nil || len(list) != 1 {
		t.Fatalf("%+v %v", list, err)
	}
	if list[0].PushStatus != PushSkipped {
		t.Fatalf("expected skipped got %s", list[0].PushStatus)
	}
}
