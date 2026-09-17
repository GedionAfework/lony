package notifications

import (
	"context"
	"log"
)

// LogPusher records delivery without contacting FCM/APNs.
// Used in development and until real credentials are configured.
type LogPusher struct{}

func (LogPusher) Send(_ context.Context, tokens []DeviceToken, msg PushMessage) PushResult {
	if len(tokens) == 0 {
		return PushResult{Status: PushSkipped, Error: "no device tokens"}
	}
	log.Printf("push skipped/dev title=%q body=%q tokens=%d", msg.Title, msg.Body, len(tokens))
	return PushResult{Status: PushSent}
}
