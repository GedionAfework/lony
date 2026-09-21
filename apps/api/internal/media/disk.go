package media

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

// DiskStore saves blobs under a local root (dev / single-node).
type DiskStore struct {
	Root string
}

func NewDiskStore(root string) (*DiskStore, error) {
	if root == "" {
		root = filepath.Join(os.TempDir(), "lony-media")
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	return &DiskStore{Root: root}, nil
}

func (d *DiskStore) Save(_ context.Context, filename, mime string, data []byte) (string, int, error) {
	ext := filepath.Ext(filename)
	if ext == "" {
		ext = ExtFromMIME(mime)
	}
	var b [16]byte
	_, _ = rand.Read(b[:])
	key := hex.EncodeToString(b[:]) + sanitizeExt(ext)
	path := filepath.Join(d.Root, key)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", 0, err
	}
	return key, len(data), nil
}

func (d *DiskStore) Path(objectKey string) (string, error) {
	if objectKey == "" || strings.Contains(objectKey, "..") || strings.ContainsAny(objectKey, `/\`) {
		return "", fmt.Errorf("invalid object key")
	}
	path := filepath.Join(d.Root, objectKey)
	if _, err := os.Stat(path); err != nil {
		return "", err
	}
	return path, nil
}

func sanitizeExt(ext string) string {
	ext = strings.ToLower(ext)
	out := make([]rune, 0, len(ext))
	for _, r := range ext {
		if r == '.' || unicode.IsLetter(r) || unicode.IsDigit(r) {
			out = append(out, r)
		}
	}
	if len(out) == 0 {
		return ".bin"
	}
	return string(out)
}

func ExtFromMIME(mime string) string {
	switch strings.ToLower(mime) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "audio/m4a", "audio/mp4", "audio/x-m4a":
		return ".m4a"
	case "audio/mpeg":
		return ".mp3"
	case "audio/wav", "audio/x-wav":
		return ".wav"
	case "application/pdf":
		return ".pdf"
	default:
		return ".bin"
	}
}
