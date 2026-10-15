package imports

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"equilend/api/internal/auth"
	"equilend/api/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

type importBody struct {
	CSV         string  `json:"csv"`
	SetBalance  *string `json:"set_balance"`
	BalanceNote *string `json:"balance_note"`
}

func (h *Handler) Import(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "MALFORMED_ID", "invalid account id"))
		return
	}
	userID := auth.UserIDFrom(r.Context())

	ct := strings.ToLower(r.Header.Get("Content-Type"))
	var in ImportInput

	if strings.HasPrefix(ct, "multipart/") {
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			httpx.Error(w, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"file": "could not parse multipart form",
			}))
			return
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			httpx.Error(w, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"file": "required (CSV)",
			}))
			return
		}
		defer file.Close()
		raw, err := io.ReadAll(io.LimitReader(file, 4<<20))
		if err != nil {
			httpx.Error(w, err)
			return
		}
		in.CSV = string(raw)
		if bal := strings.TrimSpace(r.FormValue("set_balance")); bal != "" {
			in.SetBalance = &bal
		}
		if note := strings.TrimSpace(r.FormValue("balance_note")); note != "" {
			in.BalanceNote = &note
		}
	} else {
		var body importBody
		if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(&body); err != nil {
			httpx.Error(w, httpx.E(http.StatusBadRequest, "BAD_JSON", "invalid json body"))
			return
		}
		in = ImportInput{CSV: body.CSV, SetBalance: body.SetBalance, BalanceNote: body.BalanceNote}
	}

	out, err := h.svc.ImportCSV(r.Context(), userID, id, in)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"import": out})
}
