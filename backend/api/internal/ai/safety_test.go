package ai

import "testing"

func TestSanitizeCoachReplyBlocksBorrowing(t *testing.T) {
	in := "You should borrow more from peers to cover rent this month."
	out := sanitizeCoachReply(in)
	if out == in {
		t.Fatal("expected borrow suggestion to be rewritten")
	}
	lower := toLower(out)
	if indexFold(lower, "won't suggest borrowing") < 0 && indexFold(lower, "wont suggest borrowing") < 0 {
		t.Fatalf("unexpected rewrite: %s", out)
	}
}

func TestSanitizeCoachReplyAllowsSafeAdvice(t *testing.T) {
	in := "Cut dining spend and move surplus into your emergency Plan goal."
	if got := sanitizeCoachReply(in); got != in {
		t.Fatalf("safe advice changed: %s", got)
	}
}

func indexFold(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func toLower(s string) string {
	b := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		b[i] = c
	}
	return string(b)
}
