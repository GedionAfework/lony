package config

import (
	"fmt"
	"os"
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
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if len(cfg.JWTSecret) < 32 {
		return Config{}, fmt.Errorf("JWT_SECRET must be at least 32 characters")
	}
	return cfg, nil
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
