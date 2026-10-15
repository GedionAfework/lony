package llm

import "testing"

func TestAvailable(t *testing.T) {
	if New(Config{}).Available() {
		t.Fatal("empty key should be unavailable")
	}
	if !New(Config{APIKey: "sk-test"}).Available() {
		t.Fatal("key should be available")
	}
}

func TestDefaultModel(t *testing.T) {
	c := New(Config{APIKey: "x"})
	if c.Model() != "gpt-4o-mini" {
		t.Fatalf("got %q", c.Model())
	}
}
