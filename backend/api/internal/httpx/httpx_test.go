package httpx

import (
	"net/http"
	"testing"
)

func TestAPIError(t *testing.T) {
	err := E(http.StatusUnauthorized, "UNAUTHORIZED", "missing token")
	if err.Error() != "UNAUTHORIZED: missing token" {
		t.Fatalf("unexpected error string %q", err.Error())
	}
}
