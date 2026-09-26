package store

import (
	"context"
	"encoding/json"
	"time"

	"equilend/api/internal/ai"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *SQLStore) EnsureAIConversation(ctx context.Context, userID uuid.UUID, persona, title string) (ai.Conversation, error) {
	var rec ai.Conversation
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, persona, title, created_at, updated_at
		FROM ai_conversations
		WHERE user_id = $1 AND persona = $2
		ORDER BY updated_at DESC
		LIMIT 1
	`, userID, persona).Scan(&rec.ID, &rec.UserID, &rec.Persona, &rec.Title, &rec.CreatedAt, &rec.UpdatedAt)
	if err == nil {
		return rec, nil
	}
	if err != pgx.ErrNoRows {
		return ai.Conversation{}, err
	}
	var titlePtr *string
	if title != "" {
		titlePtr = &title
	}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO ai_conversations (user_id, persona, title)
		VALUES ($1, $2, $3)
		RETURNING id, user_id, persona, title, created_at, updated_at
	`, userID, persona, titlePtr).Scan(&rec.ID, &rec.UserID, &rec.Persona, &rec.Title, &rec.CreatedAt, &rec.UpdatedAt)
	return rec, err
}

func (s *SQLStore) ListAIMessages(ctx context.Context, conversationID uuid.UUID, limit int) ([]ai.Message, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, conversation_id, role, content, citations, created_at
		FROM ai_messages
		WHERE conversation_id = $1
		ORDER BY created_at ASC
		LIMIT $2
	`, conversationID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ai.Message
	for rows.Next() {
		var m ai.Message
		var cites []byte
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.Role, &m.Content, &cites, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.Citations = json.RawMessage(cites)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *SQLStore) InsertAIMessage(ctx context.Context, m ai.Message) (ai.Message, error) {
	if len(m.Citations) == 0 {
		m.Citations = json.RawMessage(`[]`)
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO ai_messages (conversation_id, role, content, citations)
		VALUES ($1, $2, $3, $4)
		RETURNING id, conversation_id, role, content, citations, created_at
	`, m.ConversationID, m.Role, m.Content, []byte(m.Citations)).Scan(
		&m.ID, &m.ConversationID, &m.Role, &m.Content, &m.Citations, &m.CreatedAt,
	)
	if err != nil {
		return ai.Message{}, err
	}
	_, _ = s.pool.Exec(ctx, `UPDATE ai_conversations SET updated_at = now() WHERE id = $1`, m.ConversationID)
	return m, nil
}

func (s *SQLStore) InsertAIRun(ctx context.Context, r ai.Run) (ai.Run, error) {
	err := s.pool.QueryRow(ctx, `
		INSERT INTO ai_runs (user_id, persona, kind, model, input_summary, output_summary, prompt_tokens, completion_tokens, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id, user_id, persona, kind, model, input_summary, output_summary, prompt_tokens, completion_tokens, status, created_at
	`, r.UserID, r.Persona, r.Kind, r.Model, r.InputSummary, r.OutputSummary, r.PromptTokens, r.CompletionTokens, r.Status).Scan(
		&r.ID, &r.UserID, &r.Persona, &r.Kind, &r.Model, &r.InputSummary, &r.OutputSummary,
		&r.PromptTokens, &r.CompletionTokens, &r.Status, &r.CreatedAt,
	)
	return r, err
}

func (s *SQLStore) IncrementAIUsage(ctx context.Context, userID uuid.UUID, day time.Time, cap int) (int, bool, error) {
	d := time.Date(day.UTC().Year(), day.UTC().Month(), day.UTC().Day(), 0, 0, 0, 0, time.UTC)
	var count int
	err := s.pool.QueryRow(ctx, `
		INSERT INTO ai_usage_daily (user_id, day, request_count)
		VALUES ($1, $2::date, 1)
		ON CONFLICT (user_id, day) DO UPDATE
		SET request_count = ai_usage_daily.request_count + 1
		RETURNING request_count
	`, userID, d).Scan(&count)
	if err != nil {
		return 0, false, err
	}
	if cap > 0 && count > cap {
		return count, false, nil
	}
	return count, true, nil
}

func (s *SQLStore) ListAIConversationsExport(ctx context.Context, userID uuid.UUID) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.persona, c.title, c.created_at, c.updated_at,
		       COALESCE(json_agg(json_build_object(
			       'id', m.id, 'role', m.role, 'content', m.content, 'created_at', m.created_at
		       ) ORDER BY m.created_at) FILTER (WHERE m.id IS NOT NULL), '[]'::json)
		FROM ai_conversations c
		LEFT JOIN ai_messages m ON m.conversation_id = c.id
		WHERE c.user_id = $1
		GROUP BY c.id
		ORDER BY c.updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var persona string
		var title *string
		var created, updated time.Time
		var msgs []byte
		if err := rows.Scan(&id, &persona, &title, &created, &updated, &msgs); err != nil {
			return nil, err
		}
		var messages any
		_ = json.Unmarshal(msgs, &messages)
		out = append(out, map[string]any{
			"id":         id.String(),
			"persona":    persona,
			"title":      title,
			"created_at": created,
			"updated_at": updated,
			"messages":   messages,
		})
	}
	return out, rows.Err()
}

func (s *SQLStore) DeleteAIConversations(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM ai_conversations WHERE user_id = $1`, userID)
	return err
}

func (s *SQLStore) DeleteAIRuns(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM ai_runs WHERE user_id = $1`, userID)
	return err
}

func (s *SQLStore) DeleteAIUsage(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM ai_usage_daily WHERE user_id = $1`, userID)
	return err
}

func (s *SQLStore) ClearAIConversations(ctx context.Context, userID uuid.UUID) error {
	return s.DeleteAIConversations(ctx, userID)
}
