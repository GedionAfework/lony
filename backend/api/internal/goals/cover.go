package goals

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"equilend/api/internal/auth"
	"equilend/api/internal/httpx"
	"equilend/api/internal/media"

	"github.com/google/uuid"
)

type MediaRepo interface {
	SaveMediaObject(ctx context.Context, owner uuid.UUID, key, kind string, mime, name *string, size int32) error
}

func (h *Handler) WithMedia(disk *media.DiskStore, repo MediaRepo) *Handler {
	h.disk = disk
	h.mediaRepo = repo
	return h
}

type coverBody struct {
	Filename         string `json:"filename"`
	Mime             string `json:"mime"`
	AttachmentBase64 string `json:"attachment_base64"`
	Clear            bool   `json:"clear"`
}

func (h *Handler) UploadCover(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body coverBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	actor := auth.UserIDFrom(r.Context())
	if body.Clear {
		out, err := h.svc.SetCoverImage(r.Context(), actor, id, "")
		if err != nil {
			httpx.Error(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"goal": out})
		return
	}
	if h.disk == nil || h.mediaRepo == nil {
		httpx.Error(w, httpx.E(http.StatusServiceUnavailable, "MEDIA_UNAVAILABLE", "media storage is not configured"))
		return
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(body.AttachmentBase64))
	if err != nil || len(raw) == 0 {
		httpx.Error(w, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"attachment_base64": "must be valid base64",
		}))
		return
	}
	if len(raw) > 5<<20 {
		httpx.Error(w, httpx.E(http.StatusRequestEntityTooLarge, "TOO_LARGE", "cover must be 5MB or less"))
		return
	}
	mime := strings.TrimSpace(body.Mime)
	if mime == "" {
		mime = "image/jpeg"
	}
	if !strings.HasPrefix(mime, "image/") {
		httpx.Error(w, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"mime": "must be an image",
		}))
		return
	}
	name := strings.TrimSpace(body.Filename)
	if name == "" {
		name = "goal-cover.jpg"
	}
	if utf8.RuneCountInString(name) > 200 {
		name = name[:200]
	}
	key, size, err := h.disk.Save(r.Context(), name, mime, raw)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	mimePtr, namePtr := mime, name
	if err := h.mediaRepo.SaveMediaObject(r.Context(), actor, key, "goal_cover", &mimePtr, &namePtr, int32(size)); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.SetCoverImage(r.Context(), actor, id, key)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"goal": out})
}

// CoverFromURL sets a goal's cover from a product picture URL. The server downloads it, so
// it works where a browser is blocked from reading other sites' images.
func (h *Handler) CoverFromURL(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body struct {
		ImageURL string `json:"image_url"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	if h.disk == nil || h.mediaRepo == nil {
		httpx.Error(w, httpx.E(http.StatusServiceUnavailable, "MEDIA_UNAVAILABLE", "media storage is not configured"))
		return
	}
	raw, mime, err := downloadImage(r.Context(), body.ImageURL)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	actor := auth.UserIDFrom(r.Context())
	key, size, err := h.disk.Save(r.Context(), "goal-cover", mime, raw)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	mimePtr, namePtr := mime, "goal-cover"
	if err := h.mediaRepo.SaveMediaObject(r.Context(), actor, key, "goal_cover", &mimePtr, &namePtr, int32(size)); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.SetCoverImage(r.Context(), actor, id, key)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"goal": out})
}

// downloadImage fetches a public image (max 5MB) and returns its bytes and type.
func downloadImage(ctx context.Context, raw string) ([]byte, string, error) {
	bad := func(msg string) error {
		return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{"image_url": msg})
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, "", bad("must be an http(s) image link")
	}
	if isPrivateHost(u.Hostname()) {
		return nil, "", httpx.E(http.StatusBadRequest, "BLOCKED_URL", "url host is not allowed")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "", bad("must be an http(s) image link")
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "image/*")
	client := &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 || isPrivateHost(req.URL.Hostname()) {
			return http.ErrUseLastResponse
		}
		return nil
	}}
	res, err := client.Do(req)
	if err != nil {
		return nil, "", httpx.E(http.StatusBadGateway, "FETCH_FAILED", "could not download the picture")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, "", httpx.E(http.StatusBadGateway, "FETCH_FAILED", "could not download the picture")
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 5<<20+1))
	if err != nil || len(data) == 0 {
		return nil, "", httpx.E(http.StatusBadGateway, "FETCH_FAILED", "could not download the picture")
	}
	if len(data) > 5<<20 {
		return nil, "", httpx.E(http.StatusRequestEntityTooLarge, "TOO_LARGE", "picture must be 5MB or less")
	}
	mime := http.DetectContentType(data)
	if !strings.HasPrefix(mime, "image/") {
		return nil, "", bad("that link is not a picture")
	}
	return data, mime, nil
}
