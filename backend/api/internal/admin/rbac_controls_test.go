package admin

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

type permStore struct {
	Store
	perms    []Permission
	userPerm map[uuid.UUID][]string
	userRole map[uuid.UUID]string
}

func (p *permStore) ListPermissions(context.Context) ([]Permission, error) { return p.perms, nil }
func (p *permStore) UserPermissions(_ context.Context, id uuid.UUID) ([]string, string, error) {
	return p.userPerm[id], p.userRole[id], nil
}

func catalog() []Permission {
	codes := []string{
		PermOverviewRead, PermSystemRead, PermSystemJobs, PermSettingsAI, PermSettingsPlatform,
		PermUsersRead, PermUsersSuspend, PermUsersPlan, PermUsersSessions,
		PermRolesRead, PermRolesAssign, PermRolesManage, PermAuditRead, PermAuditExport,
	}
	out := make([]Permission, len(codes))
	for i, c := range codes {
		out[i] = Permission{Code: c, SortOrder: i}
	}
	return out
}

func TestNormalizePermsAddsDependencies(t *testing.T) {
	svc := NewService(&permStore{perms: catalog()})
	got, err := svc.normalizePerms(context.Background(), []string{PermUsersSuspend, PermRolesAssign, "bogus.perm", PermUsersSuspend})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{PermUsersRead: true, PermUsersSuspend: true, PermRolesRead: true, PermRolesAssign: true}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for _, c := range got {
		if !want[c] {
			t.Fatalf("unexpected %s in %v", c, got)
		}
	}
}

func TestCheckGrantBlocksEscalation(t *testing.T) {
	actor := uuid.New()
	st := &permStore{
		perms:    catalog(),
		userPerm: map[uuid.UUID][]string{actor: {PermUsersRead, PermRolesRead, PermRolesAssign}},
		userRole: map[uuid.UUID]string{actor: "Team lead"},
	}
	svc := NewService(st)
	ctx := context.Background()
	if err := svc.checkGrant(ctx, actor, "Support", []string{PermUsersRead}); err != nil {
		t.Fatalf("subset grant should pass: %v", err)
	}
	if err := svc.checkGrant(ctx, actor, "Ops", []string{PermSettingsPlatform}); err == nil {
		t.Fatal("granting a permission the actor lacks must fail")
	}
	if err := svc.checkGrant(ctx, actor, SuperAdminRole, nil); err == nil {
		t.Fatal("non-super admins must not grant Super Admin")
	}
	st.userRole[actor] = SuperAdminRole
	if err := svc.checkGrant(ctx, actor, "Ops", []string{PermSettingsPlatform}); err != nil {
		t.Fatalf("super admin may grant anything: %v", err)
	}
}

func TestPausedFeatureMatching(t *testing.T) {
	vals := map[string]string{"pause.loans": "true", "pause.imports": "true"}
	cases := map[string]bool{
		"/loans":                    true,
		"/loans/abc/accept":         true,
		"/loans-summary":            false,
		"/repayments/1/confirm":     true,
		"/accounts/123/import":      true,
		"/cashflow/receipt-scan":    true,
		"/cashflow":                 false,
		"/conversations/1/messages": false,
		"/goals/1/refresh-price":    false,
	}
	for path, want := range cases {
		if _, got := pausedFeature(vals, path); got != want {
			t.Errorf("%s: paused=%v want %v", path, got, want)
		}
	}
}
