package notifications

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type memoryStore struct {
	mu    sync.Mutex
	notes map[uuid.UUID]Notification
	toks  map[uuid.UUID]DeviceToken
	jobs  map[string]Job
	loans map[uuid.UUID]OpenLoan
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		notes: map[uuid.UUID]Notification{},
		toks:  map[uuid.UUID]DeviceToken{},
		jobs:  map[string]Job{},
		loans: map[uuid.UUID]OpenLoan{},
	}
}

func (m *memoryStore) InsertNotification(_ context.Context, n Notification) (Notification, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n.ID = uuid.New()
	n.CreatedAt = time.Now()
	m.notes[n.ID] = n
	return n, nil
}

func (m *memoryStore) ListNotifications(_ context.Context, userID uuid.UUID, unreadOnly bool, limit int32) ([]Notification, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Notification
	for _, n := range m.notes {
		if n.UserID != userID {
			continue
		}
		if unreadOnly && n.ReadAt != nil {
			continue
		}
		out = append(out, n)
	}
	if int32(len(out)) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *memoryStore) GetNotification(_ context.Context, id uuid.UUID) (Notification, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n, ok := m.notes[id]
	if !ok {
		return Notification{}, pgx.ErrNoRows
	}
	return n, nil
}

func (m *memoryStore) MarkRead(_ context.Context, userID, id uuid.UUID) (Notification, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n, ok := m.notes[id]
	if !ok || n.UserID != userID {
		return Notification{}, pgx.ErrNoRows
	}
	if n.ReadAt == nil {
		now := time.Now()
		n.ReadAt = &now
		m.notes[id] = n
	}
	return n, nil
}

func (m *memoryStore) MarkAllRead(_ context.Context, userID uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for id, n := range m.notes {
		if n.UserID == userID && n.ReadAt == nil {
			n.ReadAt = &now
			m.notes[id] = n
		}
	}
	return nil
}

func (m *memoryStore) CountUnread(_ context.Context, userID uuid.UUID) (int32, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var n int32
	for _, row := range m.notes {
		if row.UserID == userID && row.ReadAt == nil {
			n++
		}
	}
	return n, nil
}

func (m *memoryStore) UpsertDeviceToken(_ context.Context, userID uuid.UUID, platform, token string) (DeviceToken, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, t := range m.toks {
		if t.UserID == userID && t.Token == token {
			t.Platform = platform
			t.Enabled = true
			t.LastSeenAt = time.Now()
			m.toks[id] = t
			return t, nil
		}
	}
	row := DeviceToken{
		ID: uuid.New(), UserID: userID, Platform: platform, Token: token,
		Enabled: true, LastSeenAt: time.Now(), CreatedAt: time.Now(),
	}
	m.toks[row.ID] = row
	return row, nil
}

func (m *memoryStore) ListEnabledTokens(_ context.Context, userID uuid.UUID) ([]DeviceToken, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []DeviceToken
	for _, t := range m.toks {
		if t.UserID == userID && t.Enabled {
			out = append(out, t)
		}
	}
	return out, nil
}

func (m *memoryStore) DisableDeviceToken(_ context.Context, userID uuid.UUID, token string) (DeviceToken, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, t := range m.toks {
		if t.UserID == userID && t.Token == token {
			t.Enabled = false
			m.toks[id] = t
			return t, nil
		}
	}
	return DeviceToken{}, pgx.ErrNoRows
}

func (m *memoryStore) InsertJob(_ context.Context, job Job) (Job, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.jobs[job.JobKey]; ok {
		return m.jobs[job.JobKey], false, nil
	}
	job.ID = uuid.New()
	job.CreatedAt = time.Now()
	m.jobs[job.JobKey] = job
	return job, true, nil
}

func (m *memoryStore) GetJobByKey(_ context.Context, key string) (Job, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	job, ok := m.jobs[key]
	if !ok {
		return Job{}, pgx.ErrNoRows
	}
	return job, nil
}

func (m *memoryStore) ClaimDueJobs(_ context.Context, now time.Time, limit int32) ([]Job, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Job
	for _, job := range m.jobs {
		if job.Status == JobPending && !job.RunAt.After(now) {
			out = append(out, job)
			if int32(len(out)) >= limit {
				break
			}
		}
	}
	return out, nil
}

func (m *memoryStore) CompleteJob(_ context.Context, id uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, job := range m.jobs {
		if job.ID == id {
			now := time.Now()
			job.Status = JobCompleted
			job.CompletedAt = &now
			job.Attempts++
			m.jobs[key] = job
			return nil
		}
	}
	return pgx.ErrNoRows
}

func (m *memoryStore) FailJob(_ context.Context, id uuid.UUID, errMsg string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, job := range m.jobs {
		if job.ID == id {
			now := time.Now()
			job.Status = JobFailed
			job.LastError = &errMsg
			job.CompletedAt = &now
			job.Attempts++
			m.jobs[key] = job
			return nil
		}
	}
	return pgx.ErrNoRows
}

func (m *memoryStore) CancelPendingJobsForLoan(_ context.Context, loanID uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for key, job := range m.jobs {
		if job.LoanID == loanID && job.Status == JobPending {
			job.Status = JobCancelled
			job.CompletedAt = &now
			m.jobs[key] = job
		}
	}
	return nil
}

func (m *memoryStore) ListOpenLoansForReminders(_ context.Context) ([]OpenLoan, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []OpenLoan
	for _, loan := range m.loans {
		out = append(out, loan)
	}
	return out, nil
}

func (m *memoryStore) GetLoanRef(_ context.Context, loanID uuid.UUID) (OpenLoan, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	loan, ok := m.loans[loanID]
	if !ok {
		return OpenLoan{}, pgx.ErrNoRows
	}
	return loan, nil
}
