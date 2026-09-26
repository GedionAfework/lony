package config

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	AppEnv              string
	HTTPAddr            string
	DatabaseURL         string
	RedisURL            string
	JWTSecret           string
	AccessTokenTTL      time.Duration
	RefreshTokenTTL     time.Duration
	VerificationCodeTTL time.Duration
	BankKey             []byte
	MediaDir            string
	GoogleClientID      string
	TelegramBotToken    string
	TelegramBotUsername string
	ExpoAccessToken     string
	ResendAPIKey        string
	SMTPHost            string
	SMTPPort            string
	SMTPUser            string
	SMTPPass            string
	MailFrom            string
	AdminEmails         []string
}

func Load() (Config, error) {
	_ = godotenv.Load()
	_ = godotenv.Load(".env")

	cfg := Config{
		AppEnv:              getenv("APP_ENV", "development"),
		HTTPAddr:            getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		RedisURL:            getenv("REDIS_URL", "redis://127.0.0.1:6379"),
		JWTSecret:           os.Getenv("JWT_SECRET"),
		AccessTokenTTL:      durationEnv("ACCESS_TOKEN_TTL", 15*time.Minute),
		RefreshTokenTTL:     durationEnv("REFRESH_TOKEN_TTL", 30*24*time.Hour),
		VerificationCodeTTL: durationEnv("VERIFICATION_CODE_TTL", 10*time.Minute),
		MediaDir:            getenv("MEDIA_DIR", ""),
		GoogleClientID:      os.Getenv("GOOGLE_CLIENT_ID"),
		TelegramBotToken:    os.Getenv("TELEGRAM_BOT_TOKEN"),
		TelegramBotUsername: strings.TrimPrefix(os.Getenv("TELEGRAM_BOT_USERNAME"), "@"),
		ExpoAccessToken:     os.Getenv("EXPO_ACCESS_TOKEN"),
		ResendAPIKey:        os.Getenv("RESEND_API_KEY"),
		SMTPHost:            os.Getenv("SMTP_HOST"),
		SMTPPort:            getenv("SMTP_PORT", "587"),
		SMTPUser:            os.Getenv("SMTP_USER"),
		SMTPPass:            os.Getenv("SMTP_PASS"),
		MailFrom:            getenv("MAIL_FROM", "Lony <noreply@lony.local>"),
		AdminEmails:         splitCSV(os.Getenv("ADMIN_EMAILS")),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if len(cfg.JWTSecret) < 32 {
		return Config{}, fmt.Errorf("JWT_SECRET must be at least 32 characters")
	}
	key, err := loadBankKey(os.Getenv("BANK_ENCRYPTION_KEY"), cfg.JWTSecret, cfg.Dev())
	if err != nil {
		return Config{}, err
	}
	cfg.BankKey = key
	return cfg, nil
}

func loadBankKey(hexKey, jwtSecret string, dev bool) ([]byte, error) {
	hexKey = strings.TrimSpace(hexKey)
	if hexKey != "" {
		key, err := hex.DecodeString(hexKey)
		if err != nil || len(key) != 32 {
			return nil, fmt.Errorf("BANK_ENCRYPTION_KEY must be 64 hex characters")
		}
		return key, nil
	}
	if !dev {
		return nil, fmt.Errorf("BANK_ENCRYPTION_KEY is required")
	}
	sum := sha256.Sum256([]byte("equilend-bank-profiles|" + jwtSecret))
	return sum[:], nil
}

func (c Config) Dev() bool {
	return c.AppEnv == "development" || c.AppEnv == "test"
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return fallback
	}
	return d
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(strings.ToLower(p))
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
