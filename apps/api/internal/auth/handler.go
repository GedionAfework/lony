package auth

import (
	"net/http"
	"strings"

	"equilend/api/internal/httpx"
	"equilend/api/internal/legal"
	"equilend/api/internal/media"
)

type Handler struct {
	svc       *Service
	disk      *media.DiskStore
	mediaRepo MediaRepo
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
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
	httpx.JSON(w, http.StatusOK, map[string]any{"user": user})
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
