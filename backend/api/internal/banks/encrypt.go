package banks

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

func LoadKey(hexKey, jwtSecret string, dev bool) ([]byte, error) {
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

func Encrypt(key []byte, plaintext string) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

func Decrypt(key, blob []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(blob) < gcm.NonceSize() {
		return "", fmt.Errorf("ciphertext too short")
	}
	nonce, rest := blob[:gcm.NonceSize()], blob[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, rest, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func Last4(identifier string) string {
	var digits strings.Builder
	for _, r := range identifier {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	if d := digits.String(); len(d) >= 4 {
		return d[len(d)-4:]
	}
	compact := strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, identifier)
	n := utf8.RuneCountInString(compact)
	if n >= 4 {
		runes := []rune(compact)
		return string(runes[n-4:])
	}
	return compact
}
