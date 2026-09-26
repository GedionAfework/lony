package admin

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type memStore struct {
	role   string
	users  map[uuid.UUID]UserDetail
	audits []AuditEntry
}

func (m *memStore) Overview(context.Context) (Overview, error) {
	return Overview{TotalUsers: len(m.users)}, nil
}
func (m *memStore) ListUsers(context.Context, string, string, int, int) ([]UserListItem, int, error) {
	return nil, 0, nil
}
func (m *memStore) GetUser(_ context.Context, id uuid.UUID) (UserDetail, error) {
	u, ok := m.users[id]
	if !ok {
		return UserDetail{}, pgx.ErrNoRows
	}
	return u, nil
}
func (m *memStore) SetUserStatus(_ context.Context, id uuid.UUID, status string) error {
	u := m.users[id]
	u.Status = status
	m.users[id] = u
	return nil
}
func (m *memStore) RevokeUserSessions(context.Context, uuid.UUID) error { return nil }
func (m *memStore) InsertAudit(_ context.Context, actor uuid.UUID, action string, target *uuid.UUID, meta json.RawMessage) error {
	m.audits = append(m.audits, AuditEntry{ActorID: actor, Action: action, TargetUserID: target, Meta: meta})
	return nil
}
func (m *memStore) ListAudit(context.Context, int) ([]AuditEntry, error) { return m.audits, nil }
func (m *memStore) PromoteAdmins(context.Context, []string) (int, error)  { return 0, nil }
func (m *memStore) UserRole(context.Context, uuid.UUID) (string, error)   { return m.role, nil }
func (m *memStore) GetSetting(context.Context, string) (string, error)    { return "false", pgx.ErrNoRows }
func (m *memStore) SetSetting(context.Context, string, string) error      { return nil }
func (m *memStore) ListCatalogTypes(context.Context, string, bool) ([]CatalogType, error) {
	return nil, nil
}
func (m *memStore) CreateCatalogType(context.Context, string, string, string, int) (CatalogType, error) {
	return CatalogType{}, nil
}
func (m *memStore) UpdateCatalogType(context.Context, uuid.UUID, *string, *int, *bool) (CatalogType, error) {
	return CatalogType{}, pgx.ErrNoRows
}
func (m *memStore) ListCatalogInstitutions(context.Context, string, string, bool) ([]CatalogInstitution, error) {
	return nil, nil
}
func (m *memStore) CreateCatalogInstitution(context.Context, string, string, string, string, *string, int) (CatalogInstitution, error) {
	return CatalogInstitution{}, nil
}
func (m *memStore) UpdateCatalogInstitution(context.Context, uuid.UUID, *string, *string, *string, *string, *int, *bool) (CatalogInstitution, error) {
	return CatalogInstitution{}, pgx.ErrNoRows
}

func TestSuspendSelfRejected(t *testing.T) {
	id := uuid.New()
	svc := NewService(&memStore{
		role: RoleAdmin,
		users: map[uuid.UUID]UserDetail{
			id: {UserListItem: UserListItem{ID: id, Status: "active", Role: RoleUser}},
		},
	})
	if _, err := svc.Suspend(context.Background(), id, id); err == nil {
		t.Fatal("expected self-suspend error")
	}
}

func TestSuspendUser(t *testing.T) {
	actor := uuid.New()
	target := uuid.New()
	st := &memStore{
		role: RoleAdmin,
		users: map[uuid.UUID]UserDetail{
			target: {UserListItem: UserListItem{ID: target, Status: "active", Role: RoleUser, Email: "a@b.c"}},
		},
	}
	svc := NewService(st)
	out, err := svc.Suspend(context.Background(), actor, target)
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != "suspended" {
		t.Fatalf("got %s", out.Status)
	}
	if len(st.audits) != 1 || st.audits[0].Action != ActionSuspend {
		t.Fatalf("audit %+v", st.audits)
	}
}

func TestCannotSuspendAdmin(t *testing.T) {
	actor := uuid.New()
	target := uuid.New()
	svc := NewService(&memStore{
		role: RoleAdmin,
		users: map[uuid.UUID]UserDetail{
			target: {UserListItem: UserListItem{ID: target, Status: "active", Role: RoleAdmin}},
		},
	})
	if _, err := svc.Suspend(context.Background(), actor, target); err == nil {
		t.Fatal("expected forbid suspending admin")
	}
}
