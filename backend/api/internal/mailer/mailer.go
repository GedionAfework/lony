package mailer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/smtp"
	"strings"
	"time"
)

// Sender delivers transactional email (verification codes, etc.).
type Sender interface {
	Send(ctx context.Context, to, subject, textBody string) error
	Configured() bool
}

// LogSender writes messages to the process log (dev / tests).
type LogSender struct{}

func (LogSender) Send(_ context.Context, to, subject, textBody string) error {
	log.Printf("mailer[log] to=%s subject=%q body=%q", to, subject, textBody)
	return nil
}

func (LogSender) Configured() bool { return false }

// SMTPSender sends via STARTTLS/plain SMTP.
type SMTPSender struct {
	Host string
	Port string
	User string
	Pass string
	From string
}

func (s SMTPSender) Configured() bool {
	return strings.TrimSpace(s.Host) != "" && strings.TrimSpace(s.From) != ""
}

func (s SMTPSender) Send(_ context.Context, to, subject, textBody string) error {
	addr := s.Host + ":" + s.Port
	msg := []byte(fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n",
		s.From, to, subject, textBody,
	))
	var auth smtp.Auth
	if s.User != "" {
		auth = smtp.PlainAuth("", s.User, s.Pass, s.Host)
	}
	return smtp.SendMail(addr, auth, s.From, []string{to}, msg)
}

// ResendSender uses https://resend.com email API.
type ResendSender struct {
	APIKey string
	From   string
	Client *http.Client
}

func (s ResendSender) Configured() bool {
	return strings.TrimSpace(s.APIKey) != "" && strings.TrimSpace(s.From) != ""
}

func (s ResendSender) Send(ctx context.Context, to, subject, textBody string) error {
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	payload, err := json.Marshal(map[string]any{
		"from":    s.From,
		"to":      []string{to},
		"subject": subject,
		"text":    textBody,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.APIKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("resend: status %d", res.StatusCode)
	}
	return nil
}

// NewFromEnv picks Resend, then SMTP, else LogSender.
func NewFromEnv(resendKey, smtpHost, smtpPort, smtpUser, smtpPass, from string) Sender {
	from = strings.TrimSpace(from)
	if strings.TrimSpace(resendKey) != "" && from != "" {
		return ResendSender{APIKey: strings.TrimSpace(resendKey), From: from}
	}
	host := strings.TrimSpace(smtpHost)
	if host != "" && from != "" {
		port := strings.TrimSpace(smtpPort)
		if port == "" {
			port = "587"
		}
		return SMTPSender{
			Host: host,
			Port: port,
			User: smtpUser,
			Pass: smtpPass,
			From: from,
		}
	}
	return LogSender{}
}
