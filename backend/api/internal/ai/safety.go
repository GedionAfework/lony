package ai

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// sanitizeCoachReply replaces replies that push new borrowing with a safe redirect.
func sanitizeCoachReply(s string) string {
	lower := strings.ToLower(s)
	bad := []string{
		"borrow more",
		"borrowing more",
		"take out a loan",
		"take a new loan",
		"get a loan",
		"new peer loan",
		"take another loan",
		"borrow from friends to",
		"borrow to cover",
		"loan to cover your",
	}
	for _, p := range bad {
		if strings.Contains(lower, p) {
			return "I won't suggest borrowing more to fix cashflow. Focus on cutting discretionary spend, collecting what's owed to you, paying high-interest or overdue debt first, and funding an emergency buffer or Plan goal."
		}
	}
	return s
}

func writeSSE(w http.ResponseWriter, event string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, raw); err != nil {
		return err
	}
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	return nil
}
