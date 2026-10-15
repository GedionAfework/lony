package chat

import (
	"encoding/base64"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"equilend/api/internal/auth"
	"equilend/api/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handler struct {
	svc   *Service
	media *DiskMedia
}

func NewHandler(svc *Service, media *DiskMedia) *Handler {
	return &Handler{svc: svc, media: media}
}

type openBody struct {
	PeerID *uuid.UUID `json:"peer_id"`
	LoanID *uuid.UUID `json:"loan_id"`
}

type sendBody struct {
	Body               *string    `json:"body"`
	ReplyToMessageID   *uuid.UUID `json:"reply_to_message_id"`
	AttachmentKind     string     `json:"attachment_kind"`
	AttachmentName     string     `json:"attachment_name"`
	AttachmentMIME     string     `json:"attachment_mime"`
	AttachmentBase64   string     `json:"attachment_base64"`
	VoiceDurationMs    *int32     `json:"voice_duration_ms"`
}

type reactBody struct {
	Emoji  string `json:"emoji"`
	Remove bool   `json:"remove"`
}

func (h *Handler) ListConversations(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.List(r.Context(), auth.UserIDFrom(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"conversations": out})
}

func (h *Handler) Open(w http.ResponseWriter, r *http.Request) {
	var body openBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	actor := auth.UserIDFrom(r.Context())
	var out any
	var err error
	switch {
	case body.LoanID != nil && *body.LoanID != uuid.Nil:
		out, err = h.svc.OpenForLoan(r.Context(), actor, *body.LoanID)
	case body.PeerID != nil && *body.PeerID != uuid.Nil:
		out, err = h.svc.OpenOrCreate(r.Context(), actor, *body.PeerID)
	default:
		httpx.Error(w, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"peer_id": "provide peer_id or loan_id",
		}))
		return
	}
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"conversation": out})
}

func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "INVALID_ID", "invalid conversation id"))
		return
	}
	var after *time.Time
	if raw := strings.TrimSpace(r.URL.Query().Get("after")); raw != "" {
		t, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			t, err = time.Parse(time.RFC3339, raw)
		}
		if err != nil {
			httpx.Error(w, httpx.E(http.StatusBadRequest, "INVALID_AFTER", "after must be RFC3339"))
			return
		}
		after = &t
	}
	limit := int32(50)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, _ := strconv.Atoi(raw)
		if n > 0 {
			limit = int32(n)
		}
	}
	out, err := h.svc.ListMessages(r.Context(), auth.UserIDFrom(r.Context()), id, after, limit)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"messages": out})
}

func (h *Handler) Send(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "INVALID_ID", "invalid conversation id"))
		return
	}
	ct := r.Header.Get("Content-Type")
	var in SendInput
	if strings.HasPrefix(ct, "multipart/form-data") {
		if err := r.ParseMultipartForm(16 << 20); err != nil {
			httpx.Error(w, httpx.E(http.StatusBadRequest, "MALFORMED_BODY", "could not parse multipart form"))
			return
		}
		if body := strings.TrimSpace(r.FormValue("body")); body != "" {
			in.Body = &body
		}
		if reply := strings.TrimSpace(r.FormValue("reply_to_message_id")); reply != "" {
			rid, err := uuid.Parse(reply)
			if err == nil {
				in.ReplyToMessageID = &rid
			}
		}
		in.AttachmentKind = strings.TrimSpace(r.FormValue("attachment_kind"))
		if raw := strings.TrimSpace(r.FormValue("voice_duration_ms")); raw != "" {
			n, _ := strconv.Atoi(raw)
			v := int32(n)
			in.VoiceDurationMs = &v
		}
		file, header, err := r.FormFile("file")
		if err == nil {
			defer file.Close()
			data, err := io.ReadAll(io.LimitReader(file, 15<<20+1))
			if err != nil {
				httpx.Error(w, err)
				return
			}
			in.AttachmentBytes = data
			in.AttachmentName = header.Filename
			in.AttachmentMIME = header.Header.Get("Content-Type")
			if in.AttachmentKind == "" {
				in.AttachmentKind = KindFile
			}
		}
	} else {
		var body sendBody
		if err := httpx.Decode(r, &body); err != nil {
			httpx.Error(w, err)
			return
		}
		in = SendInput{
			Body:             body.Body,
			ReplyToMessageID: body.ReplyToMessageID,
			AttachmentKind:   body.AttachmentKind,
			AttachmentName:   body.AttachmentName,
			AttachmentMIME:   body.AttachmentMIME,
			VoiceDurationMs:  body.VoiceDurationMs,
		}
		if body.AttachmentBase64 != "" {
			raw, err := base64.StdEncoding.DecodeString(body.AttachmentBase64)
			if err != nil {
				httpx.Error(w, httpx.E(http.StatusBadRequest, "MALFORMED_BODY", "invalid attachment_base64"))
				return
			}
			in.AttachmentBytes = raw
		}
	}
	out, err := h.svc.Send(r.Context(), auth.UserIDFrom(r.Context()), id, in)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"message": out})
}

func (h *Handler) React(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "INVALID_ID", "invalid message id"))
		return
	}
	var body reactBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.React(r.Context(), auth.UserIDFrom(r.Context()), id, body.Emoji, body.Remove)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"message": out})
}

func (h *Handler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusBadRequest, "INVALID_ID", "invalid message id"))
		return
	}
	if err := h.svc.Delete(r.Context(), auth.UserIDFrom(r.Context()), id); err != nil {
		httpx.Error(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Media(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	ok, err := h.svc.CanAccessMedia(r.Context(), auth.UserIDFrom(r.Context()), key)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if !ok {
		httpx.Error(w, httpx.E(http.StatusNotFound, "NOT_FOUND", "media not found"))
		return
	}
	path, err := h.media.Path(key)
	if err != nil {
		httpx.Error(w, httpx.E(http.StatusNotFound, "NOT_FOUND", "media not found"))
		return
	}
	http.ServeFile(w, r, path)
}
