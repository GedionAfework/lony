package auth

import (
	"net/http"
	"strings"

	"equilend/api/internal/httpx"
)

type Handler struct {
	svc *Service
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
	DisplayName         *string `json:"display_name"`
	Timezone            *string `json:"timezone"`
	Locale              *string `json:"locale"`
	DefaultCurrencyCode *string `json:"default_currency_code"`
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
	user, err := h.svc.UpdateMe(r.Context(), UserIDFrom(r.Context()), body.DisplayName, body.Timezone, body.Locale, body.DefaultCurrencyCode)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": user})
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
