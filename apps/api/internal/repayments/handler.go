package repayments

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"
	"unicode/utf8"

	"equilend/api/internal/auth"
	"equilend/api/internal/httpx"
	"equilend/api/internal/media"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type Handler struct {
	svc  *Service
	disk *media.DiskStore
	meta interface {
		InsertMediaID(ctx context.Context, owner uuid.UUID, key, kind string, mime, name *string, size int32) (uuid.UUID, error)
	}
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) WithMedia(disk *media.DiskStore, meta interface {
	InsertMediaID(ctx context.Context, owner uuid.UUID, key, kind string, mime, name *string, size int32) (uuid.UUID, error)
}) *Handler {
	h.disk = disk
	h.meta = meta
	return h
}

type claimBody struct {
	Amount             *string `json:"amount"`
	Note               *string `json:"note"`
	ProofFilename      string  `json:"proof_filename"`
	ProofMime          string  `json:"proof_mime"`
	ProofAttachmentB64 string  `json:"proof_base64"`
}

type rejectBody struct {
	Reason string `json:"reason"`
}

func (h *Handler) Claim(w http.ResponseWriter, r *http.Request) {
	loanID, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body claimBody
	if r.Body != nil && r.ContentLength != 0 {
		if err := httpx.Decode(r, &body); err != nil {
			httpx.Error(w, err)
			return
		}
	}
	in := ClaimInput{Amount: body.Amount, Note: body.Note}
	if strings.TrimSpace(body.ProofAttachmentB64) != "" {
		if h.disk == nil || h.meta == nil {
			httpx.Error(w, httpx.E(http.StatusServiceUnavailable, "MEDIA_UNAVAILABLE", "media storage is not configured"))
			return
		}
		raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(body.ProofAttachmentB64))
		if err != nil || len(raw) == 0 {
			httpx.Error(w, httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
				"proof_base64": "must be valid base64",
			}))
			return
		}
		if len(raw) > 15<<20 {
			httpx.Error(w, httpx.E(http.StatusRequestEntityTooLarge, "TOO_LARGE", "proof must be 15MB or less"))
			return
		}
		mime := strings.TrimSpace(body.ProofMime)
		if mime == "" {
			mime = "application/octet-stream"
		}
		name := strings.TrimSpace(body.ProofFilename)
		if name == "" {
			name = "proof.bin"
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
		id, err := h.meta.InsertMediaID(r.Context(), auth.UserIDFrom(r.Context()), key, "repayment_proof", &mimePtr, &namePtr, int32(size))
		if err != nil {
			httpx.Error(w, err)
			return
		}
		in.ProofAttachmentID = &id
		in.ProofObjectKey = &key
		in.ProofName = &name
	}
	out, err := h.svc.Claim(r.Context(), auth.UserIDFrom(r.Context()), loanID, in)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"repayment": out})
}

func (h *Handler) ListForLoan(w http.ResponseWriter, r *http.Request) {
	loanID, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.ListForLoan(r.Context(), auth.UserIDFrom(r.Context()), loanID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"repayments": out})
}

func (h *Handler) Confirm(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Confirm(r.Context(), auth.UserIDFrom(r.Context()), id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"repayment": out})
}

func (h *Handler) Reject(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r, "id")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var body rejectBody
	if err := httpx.Decode(r, &body); err != nil {
		httpx.Error(w, err)
		return
	}
	out, err := h.svc.Reject(r.Context(), auth.UserIDFrom(r.Context()), id, RejectInput(body))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"repayment": out})
}

func parseID(r *http.Request, name string) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		return uuid.Nil, httpx.E(http.StatusBadRequest, "BAD_REQUEST", "invalid id")
	}
	return id, nil
}
