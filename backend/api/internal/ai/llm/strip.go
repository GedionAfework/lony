package llm

import (
	"regexp"
	"strings"
)

// Matches <think>...</think> (and common variants) from reasoning models.
var thinkingBlock = regexp.MustCompile(`(?is)<\s*think\b[^>]*>[\s\S]*?<\s*/\s*think\s*>`)

// StripThinking removes model chain-of-thought wrappers that break JSON parsing.
func StripThinking(s string) string {
	s = thinkingBlock.ReplaceAllString(strings.TrimSpace(s), "")
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "{"); i > 0 {
		s = s[i:]
	}
	return strings.TrimSpace(s)
}
