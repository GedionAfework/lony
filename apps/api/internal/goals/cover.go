package goals

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"
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
