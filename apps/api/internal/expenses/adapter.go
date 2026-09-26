package expenses

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type SQLStoreAdapter struct {
	Inner interface {
		InsertCashflow(ctx context.Context, rec Entry) (Entry, error)
		GetCashflow(ctx context.Context, userID, id uuid.UUID) (Entry, error)
		ListCashflow(ctx context.Context, userID uuid.UUID, q ListQuery) ([]Entry, error)
		UpdateCashflow(ctx context.Context, rec Entry) (Entry, error)
		DeleteCashflow(ctx context.Context, userID, id uuid.UUID) error
		CashflowSummary(ctx context.Context, userID uuid.UUID, from, to *time.Time) ([]SummarySlice, error)
		CashflowCategoryBreakdown(ctx context.Context, userID uuid.UUID, kind string, from, to *time.Time) ([]CategorySpend, error)
		ListCashflowCategories(ctx context.Context, userID uuid.UUID, kind string) ([]Category, error)
		InsertCashflowCategory(ctx context.Context, cat Category) (Category, error)
		ListDueCashflowTemplates(ctx context.Context, before time.Time, limit int) ([]Entry, error)
		LinkCashflowLoan(ctx context.Context, userID, entryID, loanID uuid.UUID) error
		UpsertBudget(ctx context.Context, rec Budget) (Budget, error)
		ListBudgets(ctx context.Context, userID uuid.UUID, period time.Time) ([]Budget, error)
		DeleteBudget(ctx context.Context, userID, id uuid.UUID) error
	}
}

func (a SQLStoreAdapter) Insert(ctx context.Context, rec Entry) (Entry, error) {
	return a.Inner.InsertCashflow(ctx, rec)
}
func (a SQLStoreAdapter) Get(ctx context.Context, userID, id uuid.UUID) (Entry, error) {
	return a.Inner.GetCashflow(ctx, userID, id)
}
func (a SQLStoreAdapter) List(ctx context.Context, userID uuid.UUID, q ListQuery) ([]Entry, error) {
	return a.Inner.ListCashflow(ctx, userID, q)
}
func (a SQLStoreAdapter) Update(ctx context.Context, rec Entry) (Entry, error) {
	return a.Inner.UpdateCashflow(ctx, rec)
}
func (a SQLStoreAdapter) Delete(ctx context.Context, userID, id uuid.UUID) error {
	return a.Inner.DeleteCashflow(ctx, userID, id)
}
func (a SQLStoreAdapter) Summary(ctx context.Context, userID uuid.UUID, from, to *time.Time) ([]SummarySlice, error) {
	return a.Inner.CashflowSummary(ctx, userID, from, to)
}
func (a SQLStoreAdapter) CategoryBreakdown(ctx context.Context, userID uuid.UUID, kind string, from, to *time.Time) ([]CategorySpend, error) {
	return a.Inner.CashflowCategoryBreakdown(ctx, userID, kind, from, to)
}
func (a SQLStoreAdapter) ListCategories(ctx context.Context, userID uuid.UUID, kind string) ([]Category, error) {
	return a.Inner.ListCashflowCategories(ctx, userID, kind)
}
func (a SQLStoreAdapter) InsertCategory(ctx context.Context, cat Category) (Category, error) {
	return a.Inner.InsertCashflowCategory(ctx, cat)
}
func (a SQLStoreAdapter) ListDueTemplates(ctx context.Context, before time.Time, limit int) ([]Entry, error) {
	return a.Inner.ListDueCashflowTemplates(ctx, before, limit)
}
func (a SQLStoreAdapter) LinkLoan(ctx context.Context, userID, entryID, loanID uuid.UUID) error {
	return a.Inner.LinkCashflowLoan(ctx, userID, entryID, loanID)
}
func (a SQLStoreAdapter) UpsertBudget(ctx context.Context, rec Budget) (Budget, error) {
	return a.Inner.UpsertBudget(ctx, rec)
}
func (a SQLStoreAdapter) ListBudgets(ctx context.Context, userID uuid.UUID, period time.Time) ([]Budget, error) {
	return a.Inner.ListBudgets(ctx, userID, period)
}
func (a SQLStoreAdapter) DeleteBudget(ctx context.Context, userID, id uuid.UUID) error {
	return a.Inner.DeleteBudget(ctx, userID, id)
}
