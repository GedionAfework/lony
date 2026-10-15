package store

import (
	"context"
	"strings"

	"equilend/api/internal/auth"

	"github.com/google/uuid"
)

func (s *SQLStore) hydrateUser(ctx context.Context, u auth.UserRecord) (auth.UserRecord, error) {
	var netWorth *string
	var netCurr *string
	err := s.pool.QueryRow(ctx, `
SELECT first_name, middle_name, last_name, country_code, preferred_auth_provider, tos_version, tos_accepted_at,
       COALESCE(role, 'user'), COALESCE(plan_tier, 'free'),
       COALESCE(calendar_id, 'gregorian'), COALESCE(hour_cycle, '24h'),
       COALESCE(loan_require_approval, true),
       COALESCE(ask_recurring_received, true),
       CASE WHEN net_worth_override IS NULL THEN NULL ELSE trim_scale(net_worth_override)::text END,
       net_worth_override_currency
FROM users WHERE id=$1`, u.ID).Scan(
		&u.FirstName, &u.MiddleName, &u.LastName, &u.CountryCode, &u.PreferredAuthProvider, &u.TOSVersion, &u.TOSAcceptedAt,
		&u.Role, &u.PlanTier, &u.CalendarID, &u.HourCycle, &u.LoanRequireApproval,
		&u.AskRecurringReceived, &netWorth, &netCurr,
	)
	if err != nil {
		return u, err
	}
	u.NetWorthOverride = netWorth
	u.NetWorthOverrideCurr = netCurr
	if u.Role == "" {
		u.Role = "user"
	}
	if u.PlanTier == "" {
		u.PlanTier = "free"
	}
	if u.CalendarID == "" {
		u.CalendarID = "gregorian"
	}
	if u.HourCycle == "" {
		u.HourCycle = "24h"
	}
	return u, nil
}

func (s *SQLStore) UpdateUserAccount(ctx context.Context, id uuid.UUID, in auth.AccountUpdate) (auth.UserRecord, error) {
	_, err := s.pool.Exec(ctx, `
UPDATE users SET
  first_name = COALESCE($2, first_name),
  middle_name = COALESCE($3, middle_name),
  last_name = COALESCE($4, last_name),
  display_name = COALESCE($5, display_name),
  username = COALESCE($6, username),
  phone_e164 = COALESCE($7, phone_e164),
  country_code = COALESCE($8, country_code),
  preferred_auth_provider = COALESCE($9, preferred_auth_provider),
  timezone = COALESCE($10, timezone),
  locale = COALESCE($11, locale),
  default_currency_code = COALESCE($12, default_currency_code),
  tos_version = COALESCE($13, tos_version),
  tos_accepted_at = COALESCE($14, tos_accepted_at),
  calendar_id = COALESCE($15, calendar_id),
  hour_cycle = COALESCE($16, hour_cycle),
  loan_require_approval = COALESCE($17, loan_require_approval),
  ask_recurring_received = COALESCE($18, ask_recurring_received),
  net_worth_override = CASE
    WHEN $19::boolean IS NULL THEN net_worth_override
    WHEN $19::boolean = false THEN NULL
    ELSE NULLIF(trim($20), '')::numeric
  END,
  net_worth_override_currency = CASE
    WHEN $19::boolean IS NULL THEN net_worth_override_currency
    WHEN $19::boolean = false THEN NULL
    ELSE NULLIF(upper(trim($21)), '')
  END,
  updated_at = now()
WHERE id=$1 AND deleted_at IS NULL`,
		id,
		in.FirstName, in.MiddleName, in.LastName, in.DisplayName, in.Username,
		in.PhoneE164, in.CountryCode, in.PreferredAuthProvider,
		in.Timezone, in.Locale, in.Currency,
		in.TOSVersion, in.TOSAcceptedAt,
		in.CalendarID, in.HourCycle, in.LoanRequireApproval,
		in.AskRecurringReceived,
		netWorthTouch(in.NetWorthOverride),
		derefStr(in.NetWorthOverride),
		derefStr(in.NetWorthOverrideCurr),
	)
	if err != nil {
		return auth.UserRecord{}, err
	}
	return s.GetUserByID(ctx, id)
}

func netWorthTouch(v *string) *bool {
	if v == nil {
		return nil
	}
	t := true
	if strings.TrimSpace(*v) == "" {
		t = false
	}
	return &t
}

func derefStr(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func (s *SQLStore) LoanRequireApproval(ctx context.Context, userID uuid.UUID) (bool, error) {
	var v bool
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(loan_require_approval, true) FROM users WHERE id=$1`, userID).Scan(&v)
	return v, err
}

func (s *SQLStore) AskRecurringReceived(ctx context.Context, userID uuid.UUID) (bool, error) {
	var v bool
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(ask_recurring_received, true) FROM users WHERE id=$1`, userID).Scan(&v)
	return v, err
}

func (s *SQLStore) NetWorthOverride(ctx context.Context, userID uuid.UUID) (amount *string, currency *string, err error) {
	err = s.pool.QueryRow(ctx, `
SELECT CASE WHEN net_worth_override IS NULL THEN NULL ELSE trim_scale(net_worth_override)::text END,
       net_worth_override_currency
FROM users WHERE id=$1`, userID).Scan(&amount, &currency)
	return
}

func (s *SQLStore) AcceptTOS(ctx context.Context, id uuid.UUID, version string) (auth.UserRecord, error) {
	_, err := s.pool.Exec(ctx, `
UPDATE users SET tos_version=$2, tos_accepted_at=now(), updated_at=now()
WHERE id=$1 AND deleted_at IS NULL`, id, version)
	if err != nil {
		return auth.UserRecord{}, err
	}
	return s.GetUserByID(ctx, id)
}
