package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// LogPusher records delivery without contacting Expo/FCM/APNs.
type LogPusher struct{}

func (LogPusher) Send(_ context.Context, tokens []DeviceToken, msg PushMessage) PushResult {
	if len(tokens) == 0 {
		return PushResult{Status: PushSkipped, Error: "no device tokens"}
	}
	log.Printf("push skipped/dev title=%q body=%q tokens=%d", msg.Title, msg.Body, len(tokens))
	return PushResult{Status: PushSent}
}

// ExpoPusher sends via Expo Push API (works with Expo Go + EAS builds).
// Configure EXPO_ACCESS_TOKEN optionally for higher rate limits.
type ExpoPusher struct {
	AccessToken string
	HTTP        *http.Client
}

func NewPusher(expoAccessToken string) Pusher {
	return ExpoPusher{
		AccessToken: strings.TrimSpace(expoAccessToken),
		HTTP:        &http.Client{Timeout: 15 * time.Second},
	}
}

func (p ExpoPusher) Send(ctx context.Context, tokens []DeviceToken, msg PushMessage) PushResult {
	if len(tokens) == 0 {
		return PushResult{Status: PushSkipped, Error: "no device tokens"}
	}
	messages := make([]map[string]any, 0, len(tokens))
	for _, t := range tokens {
		if !strings.HasPrefix(t.Token, "ExponentPushToken[") && !strings.HasPrefix(t.Token, "ExpoPushToken[") {
			continue
		}
		messages = append(messages, map[string]any{
			"to":    t.Token,
			"title": msg.Title,
			"body":  msg.Body,
			"data":  msg.Data,
			"sound": "default",
		})
	}
	if len(messages) == 0 {
		log.Printf("push: no Expo tokens among %d registered devices; logging only", len(tokens))
		return LogPusher{}.Send(ctx, tokens, msg)
	}
	body, _ := json.Marshal(map[string]any{"messages": messages})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://exp.host/--/api/v2/push/send", bytes.NewReader(body))
	if err != nil {
		return PushResult{Status: PushFailed, Error: err.Error()}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if p.AccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+p.AccessToken)
	}
	client := p.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return PushResult{Status: PushFailed, Error: err.Error()}
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return PushResult{Status: PushFailed, Error: string(raw)}
	}
	return PushResult{Status: PushSent}
}
