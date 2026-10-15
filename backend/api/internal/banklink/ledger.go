package banklink

import (
	"context"

	"equilend/api/internal/accounts"
	"equilend/api/internal/expenses"

	"github.com/google/uuid"
)

type AccountsBridge struct {
	Svc *accounts.Service
}

func (b AccountsBridge) Create(ctx context.Context, userID uuid.UUID, in AccountCreateInput) (AccountRef, error) {
	dto, err := b.Svc.Create(ctx, userID, accounts.CreateInput{
		Name:             in.Name,
		AccountType:      in.AccountType,
		CurrencyCode:     in.CurrencyCode,
		Balance:          in.Balance,
		InstitutionLabel: in.InstitutionLabel,
	})
	if err != nil {
		return AccountRef{}, err
	}
	return AccountRef{ID: dto.ID, CurrencyCode: dto.CurrencyCode}, nil
}

func (b AccountsBridge) FindByInstitution(ctx context.Context, userID uuid.UUID, institution, currency string) (*AccountRef, error) {
	dto, err := b.Svc.FindByInstitution(ctx, userID, institution, currency)
	if err != nil || dto == nil {
		return nil, err
	}
	return &AccountRef{ID: dto.ID, CurrencyCode: dto.CurrencyCode}, nil
}

type CashflowBridge struct {
	Svc   *expenses.Service
	Notes NoteChecker
}

type NoteChecker interface {
	CashflowNoteExists(ctx context.Context, userID, accountID uuid.UUID, note string) (bool, error)
}

func (b CashflowBridge) Create(ctx context.Context, userID uuid.UUID, in CashflowCreateInput) error {
	_, err := b.Svc.Create(ctx, userID, expenses.CreateInput{
		Kind:         in.Kind,
		Title:        in.Title,
		Amount:       in.Amount,
		CurrencyCode: in.CurrencyCode,
		Category:     in.Category,
		AccountID:    in.AccountID,
		Note:         in.Note,
		OccurredAt:   in.OccurredAt,
	})
	return err
}

func (b CashflowBridge) NoteExists(ctx context.Context, userID uuid.UUID, accountID uuid.UUID, notePrefix string) (bool, error) {
	if b.Notes == nil {
		return false, nil
	}
	return b.Notes.CashflowNoteExists(ctx, userID, accountID, notePrefix)
}
