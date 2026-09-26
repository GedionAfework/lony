package ai

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const (
	PersonaAnalyst    = "analyst"
	PersonaVisualizer = "visualizer"
	PersonaCoach      = "coach"
)

type Conversation struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Persona   string
	Title     *string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Message struct {
	ID             uuid.UUID
	ConversationID uuid.UUID
	Role           string
	Content        string
	Citations      json.RawMessage
	CreatedAt      time.Time
}

type MessageDTO struct {
	ID        uuid.UUID       `json:"id"`
	Role      string          `json:"role"`
	Content   string          `json:"content"`
	Citations json.RawMessage `json:"citations,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
}

type ConversationDTO struct {
	ID        uuid.UUID    `json:"id"`
	Persona   string       `json:"persona"`
	Title     *string      `json:"title,omitempty"`
	Messages  []MessageDTO `json:"messages"`
	CreatedAt time.Time    `json:"created_at"`
	UpdatedAt time.Time    `json:"updated_at"`
}

type Run struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	Persona          string
	Kind             string
	Model            *string
	InputSummary     *string
	OutputSummary    *string
	PromptTokens     int
	CompletionTokens int
	Status           string
	CreatedAt        time.Time
}
