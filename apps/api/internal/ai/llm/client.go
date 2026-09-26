package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Config struct {
	APIKey  string
	BaseURL string
	Model   string
}

type Client struct {
	cfg    Config
	http   *http.Client
	model  string
}

func New(cfg Config) *Client {
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = "gpt-4o-mini"
	}
	return &Client{
		cfg: Config{APIKey: strings.TrimSpace(cfg.APIKey), BaseURL: base, Model: model},
		http: &http.Client{Timeout: 60 * time.Second},
		model: model,
	}
}

func (c *Client) Available() bool {
	return c != nil && c.cfg.APIKey != ""
}

func (c *Client) Model() string {
	if c == nil {
		return ""
	}
	return c.model
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature float64   `json:"temperature,omitempty"`
	MaxTokens   int       `json:"max_tokens,omitempty"`
}

type ChatResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Message Message `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

type Result struct {
	Content          string
	Model            string
	PromptTokens     int
	CompletionTokens int
}

func (c *Client) Chat(ctx context.Context, messages []Message, maxTokens int) (Result, error) {
	if !c.Available() {
		return Result{}, fmt.Errorf("llm unavailable: missing API key")
	}
	if maxTokens <= 0 {
		maxTokens = 600
	}
	body := ChatRequest{
		Model:       c.model,
		Messages:    messages,
		Temperature: 0.4,
		MaxTokens:   maxTokens,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return Result{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)

	res, err := c.http.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil {
		return Result{}, err
	}
	var parsed ChatResponse
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return Result{}, fmt.Errorf("llm decode: %w", err)
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return Result{}, fmt.Errorf("llm: %s", parsed.Error.Message)
	}
	if res.StatusCode >= 300 {
		return Result{}, fmt.Errorf("llm http %d: %s", res.StatusCode, strings.TrimSpace(string(payload)))
	}
	if len(parsed.Choices) == 0 {
		return Result{}, fmt.Errorf("llm: empty choices")
	}
	model := parsed.Model
	if model == "" {
		model = c.model
	}
	return Result{
		Content:          strings.TrimSpace(parsed.Choices[0].Message.Content),
		Model:            model,
		PromptTokens:     parsed.Usage.PromptTokens,
		CompletionTokens: parsed.Usage.CompletionTokens,
	}, nil
}
