package rails

import (
	"net/http"
	"strings"

	"equilend/api/internal/httpx"
)

type Handler struct{}

func NewHandler() *Handler { return &Handler{} }

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	country := strings.TrimSpace(r.URL.Query().Get("country"))
	scope := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope")))
	// Default: full global catalog. Optional country filter only when scope=country.
	rails := Catalog
	if scope == "country" && country != "" {
		rails = ForCountry(country)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"rails":   rails,
		"country": normalizeCountry(country),
		"scope":   scope,
	})
}
