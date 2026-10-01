package auth

import (
	"context"
	"net/http"
	"strings"

	"equilend/api/internal/httpx"
	"equilend/api/internal/legal"
	"equilend/api/internal/media"

	"github.com/google/uuid"
)

type Handler struct {
	svc       *Service
	disk      *media.DiskStore
	mediaRepo MediaRepo
	// AdminEnrich optionally returns permission codes + role name for admin users.
	AdminEnrich func(ctx context.Context, userID uuid.UUID) (perms []string, roleName string, err error)
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) WithAdminEnrich(fn func(ctx context.Context, userID uuid.UUID) (perms []string, roleName string, err error)) *Handler {
	h.AdminEnrich = fn
	return h
}

type registerBody struct {
	Email              string `json:"email"`
	Password           string `json:"password"`
	DisplayName        string `json:"display_name"`
	AcceptedDisclaimer bool   `json:"accepted_disclaimer"`
}

type verifyBody struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

type loginBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshBody struct {
	RefreshToken string `json:"refresh_token"`
}

type patchMeBody struct {
	DisplayName           *string `json:"display_name"`
	Username              *string `json:"username"`
	FirstName             *string `json:"first_name"`
	MiddleName            *string `json:"middle_name"`
	LastName              *string `json:"last_name"`
	PhoneE164             *string `json:"phone_e164"`
	CountryCode           *string `json:"country_code"`
	PreferredAuthProvider *string `json:"preferred_auth_provider"`
	Timezone              *string `json:"timezone"`
	Locale                *string `json:"locale"`
	CalendarID            *string `json:"calendar_id"`
	HourCycle             *string `json:"hour_cycle"`
	LoanRequireApproval   *bool   `json:"loan_require_approval"`
	DefaultCurrencyCode   *string `json:"default_currency_code"`
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var body registerBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Register(r.Context(), RegisterInput(body))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, out)
}

func (h *Handler) Verify(w http.ResponseWriter, r *http.Request) {
	var body verifyBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	user, err := h.svc.VerifyEmail(r.Context(), body.Email, body.Code)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": user})
}

type emailOnlyBody struct {
	Email string `json:"email"`
}

func (h *Handler) ResendVerification(w http.ResponseWriter, r *http.Request) {
	var body emailOnlyBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.ResendVerification(r.Context(), body.Email)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var body emailOnlyBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.ForgotPassword(r.Context(), body.Email)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

type resetPasswordBody struct {
	Email       string `json:"email"`
	Code        string `json:"code"`
	NewPassword string `json:"new_password"`
}

func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var body resetPasswordBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	if err := h.svc.ResetPassword(r.Context(), body.Email, body.Code, body.NewPassword); err != nil {
		httpx.Error(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type changePasswordBody struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	var body changePasswordBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	if err := h.svc.ChangePassword(r.Context(), UserIDFrom(r.Context()), body.CurrentPassword, body.NewPassword); err != nil {
		httpx.Error(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var body loginBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	device := deviceLabel(r)
	out, err := h.svc.Login(r.Context(), LoginInput(body), device)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	var body refreshBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Refresh(r.Context(), body.RefreshToken)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Logout(r.Context(), SessionIDFrom(r.Context())); err != nil {
		httpx.Error(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	user, err := h.svc.Me(r.Context(), UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	resp := map[string]any{"user": user}
	if h.AdminEnrich != nil && user.Role == "admin" {
		perms, roleName, err := h.AdminEnrich(r.Context(), user.ID)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		if perms == nil {
			perms = []string{}
		}
		resp["admin_permissions"] = perms
		if roleName != "" {
			resp["admin_role"] = roleName
		}
	}
	httpx.JSON(w, http.StatusOK, resp)
}

func (h *Handler) PatchMe(w http.ResponseWriter, r *http.Request) {
	var body patchMeBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	user, err := h.svc.UpdateAccount(r.Context(), UserIDFrom(r.Context()), AccountUpdate{
		DisplayName:           body.DisplayName,
		Username:              body.Username,
		FirstName:             body.FirstName,
		MiddleName:            body.MiddleName,
		LastName:              body.LastName,
		PhoneE164:             body.PhoneE164,
		CountryCode:           body.CountryCode,
		PreferredAuthProvider: body.PreferredAuthProvider,
		Timezone:              body.Timezone,
		Locale:                body.Locale,
		CalendarID:            body.CalendarID,
		HourCycle:             body.HourCycle,
		LoanRequireApproval:   body.LoanRequireApproval,
		Currency:              body.DefaultCurrencyCode,
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": user})
}

func (h *Handler) AcceptTOS(w http.ResponseWriter, r *http.Request) {
	user, err := h.svc.AcceptTOS(r.Context(), UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": user, "tos_version": legal.Version})
}

type oauthBody struct {
	Provider           string            `json:"provider"`
	IDToken            string            `json:"id_token"`
	Telegram           map[string]string `json:"telegram"`
	AcceptedDisclaimer bool              `json:"accepted_disclaimer"`
}

func (h *Handler) OAuth(w http.ResponseWriter, r *http.Request) {
	var body oauthBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.OAuthLogin(r.Context(), OAuthInput{
		Provider:           body.Provider,
		IDToken:            body.IDToken,
		TelegramAuth:       body.Telegram,
		AcceptedDisclaimer: body.AcceptedDisclaimer,
		DeviceLabel:        deviceLabel(r),
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

type avatarBody struct {
	Filename         string `json:"filename"`
	Mime             string `json:"mime"`
	AttachmentBase64 string `json:"attachment_base64"`
}

func deviceLabel(r *http.Request) *string {
	v := strings.TrimSpace(r.Header.Get("X-Device-Label"))
	if v == "" {
		return nil
	}
	if len(v) > 120 {
		v = v[:120]
	}
	return &v
}
