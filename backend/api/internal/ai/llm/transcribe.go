package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
)

func (c *Client) transcribeModel() string {
	if c == nil {
		return "whisper-1"
	}
	if strings.Contains(strings.ToLower(c.cfg.BaseURL), "groq.com") {
		return "whisper-large-v3"
	}
	return "whisper-1"
}

func audioFileName(mime string) string {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "audio/webm", "video/webm":
		return "audio.webm"
	case "audio/wav", "audio/x-wav", "audio/wave":
		return "audio.wav"
	case "audio/mpeg", "audio/mp3":
		return "audio.mp3"
	case "audio/ogg", "audio/opus":
		return "audio.ogg"
	default:
		return "audio.m4a"
	}
}

func (c *Client) Transcribe(ctx context.Context, mime string, data []byte) (string, error) {
	if !c.Available() {
		return "", fmt.Errorf("llm unavailable: missing API key")
	}
	if len(data) == 0 {
		return "", fmt.Errorf("empty audio")
	}
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", audioFileName(mime))
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := w.WriteField("model", c.transcribeModel()); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+"/audio/transcriptions", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	res, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("transcribe http %d: %s", res.StatusCode, strings.TrimSpace(string(payload)))
	}
	var parsed struct {
		Text  string `json:"text"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return "", fmt.Errorf("transcribe decode: %w", err)
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return "", fmt.Errorf("transcribe: %s", parsed.Error.Message)
	}
	text := strings.TrimSpace(parsed.Text)
	if text == "" {
		return "", fmt.Errorf("transcribe: empty text")
	}
	return text, nil
}
