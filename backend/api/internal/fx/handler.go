package fx

import (
	"net/http"
	"strings"
	"time"

	"equilend/api/internal/httpx"
)

type Handler struct {
	client *Client
}

func NewHandler(client *Client) *Handler {
	return &Handler{client: client}
}

func (h *Handler) Rates(w http.ResponseWriter, r *http.Request) {
	base := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("base")))
	if base == "" {
		base = "USD"
	}
	rates, asOf, err := h.client.Rates(r.Context(), base)
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadGateway, "FX_UNAVAILABLE", "could not load exchange rates"))
		return
	}
	out := make(map[string]string, len(rates))
	for k, v := range rates {
		out[k] = v.String()
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"base":  base,
		"as_of": asOf.UTC().Format(time.RFC3339),
		"rates": out,
	})
}
