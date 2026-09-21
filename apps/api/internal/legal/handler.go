package legal

import (
	"net/http"

	"equilend/api/internal/httpx"
)

type Handler struct{}

func NewHandler() *Handler { return &Handler{} }

func (h *Handler) GetTOS(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"version":    Version,
		"disclaimer": Disclaimer,
		"document":   Document,
	})
}
