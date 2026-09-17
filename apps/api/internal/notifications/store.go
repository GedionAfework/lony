package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	TypeFriendRequest        = "friend_request"
	TypeFriendAccepted       = "friend_accepted"
	TypeLoanRequest          = "loan_request"
	TypeLoanAccepted         = "loan_accepted"
	TypeLoanRejected         = "loan_rejected"
	TypeBankProfileShared    = "bank_profile_shared"
	TypeDueSoon              = "due_soon"
	TypeDueToday             = "due_today"
	TypeOverdue              = "overdue"
	TypeRepaymentSubmitted   = "repayment_submitted"
	TypeRepaymentConfirmed   = "repayment_confirmed"
	TypeRepaymentRejected    = "repayment_rejected"

	KindDueSoon7d = "due_soon_7d"
	KindDueSoon3d = "due_soon_3d"
	KindDueSoon1d = "due_soon_1d"
	KindDueToday  = "due_today"
	KindOverdue   = "overdue"

	PushPending = "pending"
	PushSent    = "sent"
	PushSkipped = "skipped"
	PushFailed  = "failed"

	JobPending   = "pending"
	JobCompleted = "completed"
	JobCancelled = "cancelled"
	JobFailed    = "failed"
)

type Notification struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	Type       string
	LoanID     *uuid.UUID
	Title      string
	Body       string
	Payload    json.RawMessage
	PushStatus string
	PushError  *string
	ReadAt     *time.Time
	CreatedAt  time.Time
}

type DeviceToken struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	Platform   string
	Token      string
	Enabled    bool
	LastSeenAt time.Time
	CreatedAt  time.Time
}

type Job struct {
	ID          uuid.UUID
	JobKey      string
	UserID      uuid.UUID
	LoanID      uuid.UUID
	Kind        string
	RunAt       time.Time
	Status      string
	Attempts    int32
	LastError   *string
	CompletedAt *time.Time
	CreatedAt   time.Time
}

type OpenLoan struct {
	ID            uuid.UUID
	ReferenceCode string
	BorrowerID    uuid.UUID
	LenderID      uuid.UUID
	Status        string
	DueAt         time.Time
	CurrencyCode  *string
}

type DTO struct {
	ID         uuid.UUID       `json:"id"`
	Type       string          `json:"type"`
	LoanID     *uuid.UUID      `json:"loan_id,omitempty"`
	Title      string          `json:"title"`
	Body       string          `json:"body"`
	Payload    json.RawMessage `json:"payload"`
	PushStatus string          `json:"push_status"`
	ReadAt     *time.Time      `json:"read_at,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
}

type DeviceTokenDTO struct {
	ID         uuid.UUID `json:"id"`
	Platform   string    `json:"platform"`
	Token      string    `json:"token"`
	Enabled    bool      `json:"enabled"`
	LastSeenAt time.Time `json:"last_seen_at"`
	CreatedAt  time.Time `json:"created_at"`
}

type PushMessage struct {
	Title string
	Body  string
	Data  map[string]string
}

type PushResult struct {
	Status string // sent | skipped | failed
	Error  string
}

type Pusher interface {
	Send(ctx context.Context, tokens []DeviceToken, msg PushMessage) PushResult
}

type Store interface {
	InsertNotification(ctx context.Context, n Notification) (Notification, error)
	ListNotifications(ctx context.Context, userID uuid.UUID, unreadOnly bool, limit int32) ([]Notification, error)
	GetNotification(ctx context.Context, id uuid.UUID) (Notification, error)
	MarkRead(ctx context.Context, userID, id uuid.UUID) (Notification, error)
	MarkAllRead(ctx context.Context, userID uuid.UUID) error
	CountUnread(ctx context.Context, userID uuid.UUID) (int32, error)
	UpsertDeviceToken(ctx context.Context, userID uuid.UUID, platform, token string) (DeviceToken, error)
	ListEnabledTokens(ctx context.Context, userID uuid.UUID) ([]DeviceToken, error)
	DisableDeviceToken(ctx context.Context, userID uuid.UUID, token string) (DeviceToken, error)
	InsertJob(ctx context.Context, job Job) (Job, bool, error)
	GetJobByKey(ctx context.Context, key string) (Job, error)
	ClaimDueJobs(ctx context.Context, now time.Time, limit int32) ([]Job, error)
	CompleteJob(ctx context.Context, id uuid.UUID) error
	FailJob(ctx context.Context, id uuid.UUID, errMsg string) error
	CancelPendingJobsForLoan(ctx context.Context, loanID uuid.UUID) error
	ListOpenLoansForReminders(ctx context.Context) ([]OpenLoan, error)
	GetLoanRef(ctx context.Context, loanID uuid.UUID) (OpenLoan, error)
}

func JobKey(loanID, userID uuid.UUID, milestone string) string {
	return fmt.Sprintf("loan:%s:%s:%s", loanID.String(), milestone, userID.String())
}

func toDTO(n Notification) DTO {
	return DTO{
		ID:         n.ID,
		Type:       n.Type,
		LoanID:     n.LoanID,
		Title:      n.Title,
		Body:       n.Body,
		Payload:    n.Payload,
		PushStatus: n.PushStatus,
		ReadAt:     n.ReadAt,
		CreatedAt:  n.CreatedAt,
	}
}
