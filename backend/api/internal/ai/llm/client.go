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

// VisionPart is an OpenAI-compatible multimodal content part.
type VisionPart struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	ImageURL *struct {
		URL string `json:"url"`
	} `json:"image_url,omitempty"`
}

// VisionMessage allows string or []VisionPart content.
type VisionMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type ChatRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature float64   `json:"temperature,omitempty"`
	MaxTokens   int       `json:"max_tokens,omitempty"`
	Stream      bool      `json:"stream,omitempty"`
}

type visionChatRequest struct {
	Model               string          `json:"model"`
	Messages            []VisionMessage `json:"messages"`
	Temperature         float64         `json:"temperature,omitempty"`
	MaxTokens           int             `json:"max_tokens,omitempty"`
	MaxCompletionTokens int             `json:"max_completion_tokens,omitempty"`
	ResponseFormat      *struct {
		Type string `json:"type"`
	} `json:"response_format,omitempty"`
}

type ChatResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Message Message `json:"message"`
		Delta   struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
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
	return c.doChat(ctx, body)
}

// ChatVision sends a multimodal (image + text) chat completion.
// opts may be nil. Use JSONObject: true for structured extraction.
func (c *Client) ChatVision(ctx context.Context, messages []VisionMessage, maxTokens int) (Result, error) {
	return c.ChatVisionOpts(ctx, messages, maxTokens, nil)
}

type VisionOpts struct {
	JSONObject bool
}

func (c *Client) ChatVisionOpts(ctx context.Context, messages []VisionMessage, maxTokens int, opts *VisionOpts) (Result, error) {
	if !c.Available() {
		return Result{}, fmt.Errorf("llm unavailable: missing API key")
	}
	if maxTokens <= 0 {
		maxTokens = 800
	}
	body := visionChatRequest{
		Model:               c.model,
		Messages:            messages,
		Temperature:         0.1,
		MaxTokens:           maxTokens,
		MaxCompletionTokens: maxTokens,
	}
	if opts != nil && opts.JSONObject {
		body.ResponseFormat = &struct {
			Type string `json:"type"`
		}{Type: "json_object"}
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
	payload, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
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
	content := StripThinking(strings.TrimSpace(parsed.Choices[0].Message.Content))
	return Result{
		Content:          content,
		Model:            model,
		PromptTokens:     parsed.Usage.PromptTokens,
		CompletionTokens: parsed.Usage.CompletionTokens,
	}, nil
}

func (c *Client) doChat(ctx context.Context, body ChatRequest) (Result, error) {
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

// ChatStream calls the OpenAI-compatible streaming chat API and invokes onDelta for each text chunk.
func (c *Client) ChatStream(ctx context.Context, messages []Message, maxTokens int, onDelta func(string) error) (Result, error) {
	if !c.Available() {
		return Result{}, fmt.Errorf("llm unavailable: missing API key")
	}
	if maxTokens <= 0 {
		maxTokens = 600
	}
	body := ChatRequest{
		Model: c.model, Messages: messages, Temperature: 0.4, MaxTokens: maxTokens, Stream: true,
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
	req.Header.Set("Accept", "text/event-stream")

	res, err := c.http.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		return Result{}, fmt.Errorf("llm http %d: %s", res.StatusCode, strings.TrimSpace(string(payload)))
	}

	var (
		content strings.Builder
		model   = c.model
		promptT int
		compT   int
	)
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 1024)
	for {
		n, readErr := res.Body.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
			for {
				idx := bytes.IndexByte(buf, '\n')
				if idx < 0 {
					break
				}
				line := strings.TrimRight(string(buf[:idx]), "\r")
				buf = buf[idx+1:]
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, ":") {
					continue
				}
				if !strings.HasPrefix(line, "data:") {
					continue
				}
				payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
				if payload == "[DONE]" {
					return Result{
						Content: strings.TrimSpace(content.String()), Model: model,
						PromptTokens: promptT, CompletionTokens: compT,
					}, nil
				}
				var chunk ChatResponse
				if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
					continue
				}
				if chunk.Error != nil && chunk.Error.Message != "" {
					return Result{}, fmt.Errorf("llm: %s", chunk.Error.Message)
				}
				if chunk.Model != "" {
					model = chunk.Model
				}
				if chunk.Usage.PromptTokens > 0 {
					promptT = chunk.Usage.PromptTokens
				}
				if chunk.Usage.CompletionTokens > 0 {
					compT = chunk.Usage.CompletionTokens
				}
				if len(chunk.Choices) == 0 {
					continue
				}
				delta := chunk.Choices[0].Delta.Content
				if delta == "" {
					continue
				}
				content.WriteString(delta)
				if onDelta != nil {
					if err := onDelta(delta); err != nil {
						return Result{}, err
					}
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return Result{}, readErr
		}
	}
	return Result{
		Content: strings.TrimSpace(content.String()), Model: model,
		PromptTokens: promptT, CompletionTokens: compT,
	}, nil
}
