package llm

import "testing"

func TestStripThinking(t *testing.T) {
	in := "noise <think>reason hard</think> {\"amount\":\"12.00\"}"
	out := StripThinking(in)
	if out != `{"amount":"12.00"}` {
		t.Fatalf("got %q", out)
	}
	if StripThinking(`{"ok":true}`) != `{"ok":true}` {
		t.Fatal("plain json changed")
	}
}
