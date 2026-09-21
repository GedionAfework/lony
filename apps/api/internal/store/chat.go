package store

import (
	"context"
	"time"

	"equilend/api/internal/chat"

	"github.com/google/uuid"
)

func (s *SQLStore) GetConversationByPair(ctx context.Context, low, high uuid.UUID) (chat.Conversation, error) {
	const q = `SELECT id, user_low_id, user_high_id, loan_id, last_message_at, created_at
		FROM conversations WHERE user_low_id=$1 AND user_high_id=$2 AND loan_id IS NULL`
	var c chat.Conversation
	err := s.pool.QueryRow(ctx, q, low, high).Scan(&c.ID, &c.UserLowID, &c.UserHighID, &c.LoanID, &c.LastMessageAt, &c.CreatedAt)
	return c, err
}

func (s *SQLStore) GetConversationByLoan(ctx context.Context, loanID uuid.UUID) (chat.Conversation, error) {
	const q = `SELECT id, user_low_id, user_high_id, loan_id, last_message_at, created_at
		FROM conversations WHERE loan_id=$1`
	var c chat.Conversation
	err := s.pool.QueryRow(ctx, q, loanID).Scan(&c.ID, &c.UserLowID, &c.UserHighID, &c.LoanID, &c.LastMessageAt, &c.CreatedAt)
	return c, err
}

func (s *SQLStore) GetConversationByID(ctx context.Context, id uuid.UUID) (chat.Conversation, error) {
	const q = `SELECT id, user_low_id, user_high_id, loan_id, last_message_at, created_at FROM conversations WHERE id=$1`
	var c chat.Conversation
	err := s.pool.QueryRow(ctx, q, id).Scan(&c.ID, &c.UserLowID, &c.UserHighID, &c.LoanID, &c.LastMessageAt, &c.CreatedAt)
	return c, err
}

func (s *SQLStore) InsertConversation(ctx context.Context, low, high uuid.UUID, loanID *uuid.UUID) (chat.Conversation, error) {
	const q = `INSERT INTO conversations (user_low_id, user_high_id, loan_id) VALUES ($1,$2,$3)
		RETURNING id, user_low_id, user_high_id, loan_id, last_message_at, created_at`
	var c chat.Conversation
	err := s.pool.QueryRow(ctx, q, low, high, loanID).Scan(&c.ID, &c.UserLowID, &c.UserHighID, &c.LoanID, &c.LastMessageAt, &c.CreatedAt)
	return c, err
}

func (s *SQLStore) InsertMembers(ctx context.Context, conversationID, a, b uuid.UUID) error {
	const q = `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`
	if _, err := s.pool.Exec(ctx, q, conversationID, a); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, q, conversationID, b)
	return err
}

func (s *SQLStore) IsMember(ctx context.Context, conversationID, userID uuid.UUID) (bool, error) {
	const q = `SELECT EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2)`
	var ok bool
	err := s.pool.QueryRow(ctx, q, conversationID, userID).Scan(&ok)
	return ok, err
}

func (s *SQLStore) ListConversations(ctx context.Context, userID uuid.UUID) ([]chat.ConversationListRow, error) {
	const q = `
SELECT
  c.id, c.user_low_id, c.user_high_id, c.loan_id, c.last_message_at, c.created_at,
  m.body, m.attachment_kind, m.sender_id, m.created_at,
  peer_cm.last_read_at,
  (
    SELECT COUNT(*)::int FROM messages msg
    WHERE msg.conversation_id = c.id
      AND msg.deleted_at IS NULL
      AND msg.sender_id <> $1
      AND (cm.last_read_at IS NULL OR msg.created_at > cm.last_read_at)
  ) AS unread_count
FROM conversations c
JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
LEFT JOIN conversation_members peer_cm
  ON peer_cm.conversation_id = c.id
 AND peer_cm.user_id = CASE WHEN c.user_low_id = $1 THEN c.user_high_id ELSE c.user_low_id END
 AND c.user_low_id <> c.user_high_id
LEFT JOIN LATERAL (
  SELECT body, attachment_kind, sender_id, created_at
  FROM messages
  WHERE conversation_id = c.id AND deleted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1
) m ON true
ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`
	rows, err := s.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []chat.ConversationListRow{}
	for rows.Next() {
		var row chat.ConversationListRow
		if err := rows.Scan(
			&row.ID, &row.UserLowID, &row.UserHighID, &row.LoanID, &row.LastMessageAt, &row.CreatedAt,
			&row.LastBody, &row.LastAttachmentKind, &row.LastSenderID, &row.LastCreatedAt,
			&row.PeerLastReadAt, &row.UnreadCount,
		); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *SQLStore) TouchConversation(ctx context.Context, id uuid.UUID, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE conversations SET last_message_at=$2 WHERE id=$1`, id, at)
	return err
}

func (s *SQLStore) MarkConversationRead(ctx context.Context, conversationID, userID uuid.UUID, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE conversation_members SET last_read_at=$3 WHERE conversation_id=$1 AND user_id=$2`, conversationID, userID, at)
	return err
}

func (s *SQLStore) GetMemberLastRead(ctx context.Context, conversationID, userID uuid.UUID) (*time.Time, error) {
	const q = `SELECT last_read_at FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`
	var at *time.Time
	err := s.pool.QueryRow(ctx, q, conversationID, userID).Scan(&at)
	if err != nil {
		return nil, err
	}
	return at, nil
}

func (s *SQLStore) CanAccessMediaKey(ctx context.Context, userID uuid.UUID, objectKey string) (bool, error) {
	const q = `
SELECT EXISTS (
  SELECT 1 FROM users u WHERE u.id = $1 AND u.avatar_object_key = $2 AND u.deleted_at IS NULL
)
OR EXISTS (
  SELECT 1 FROM messages m
  JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $1
  WHERE m.attachment_object_key = $2 AND m.deleted_at IS NULL
)
OR EXISTS (
  SELECT 1 FROM media_objects mo
  JOIN repayments r ON r.proof_attachment_id = mo.id
  JOIN loans l ON l.id = r.loan_id
  WHERE mo.object_key = $2 AND (l.borrower_id = $1 OR l.lender_id = $1)
)
OR EXISTS (
  SELECT 1 FROM media_objects mo WHERE mo.object_key = $2 AND mo.owner_user_id = $1
)`
	var ok bool
	err := s.pool.QueryRow(ctx, q, userID, objectKey).Scan(&ok)
	return ok, err
}

func (s *SQLStore) InsertMessage(ctx context.Context, msg chat.Message) (chat.Message, error) {
	const q = `INSERT INTO messages (
		conversation_id, sender_id, body, reply_to_message_id,
		attachment_kind, attachment_name, attachment_mime, attachment_size,
		attachment_object_key, voice_duration_ms
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	RETURNING id, conversation_id, sender_id, body, reply_to_message_id,
		attachment_kind, attachment_name, attachment_mime, attachment_size,
		attachment_object_key, voice_duration_ms, created_at`
	var out chat.Message
	err := s.pool.QueryRow(ctx, q,
		msg.ConversationID, msg.SenderID, msg.Body, msg.ReplyToMessageID,
		msg.AttachmentKind, msg.AttachmentName, msg.AttachmentMIME, msg.AttachmentSize,
		msg.AttachmentObjectKey, msg.VoiceDurationMs,
	).Scan(
		&out.ID, &out.ConversationID, &out.SenderID, &out.Body, &out.ReplyToMessageID,
		&out.AttachmentKind, &out.AttachmentName, &out.AttachmentMIME, &out.AttachmentSize,
		&out.AttachmentObjectKey, &out.VoiceDurationMs, &out.CreatedAt,
	)
	return out, err
}

func (s *SQLStore) GetMessage(ctx context.Context, id uuid.UUID) (chat.Message, error) {
	const q = `SELECT id, conversation_id, sender_id, body, reply_to_message_id,
		attachment_kind, attachment_name, attachment_mime, attachment_size,
		attachment_object_key, voice_duration_ms, created_at
		FROM messages WHERE id=$1 AND deleted_at IS NULL`
	var out chat.Message
	err := s.pool.QueryRow(ctx, q, id).Scan(
		&out.ID, &out.ConversationID, &out.SenderID, &out.Body, &out.ReplyToMessageID,
		&out.AttachmentKind, &out.AttachmentName, &out.AttachmentMIME, &out.AttachmentSize,
		&out.AttachmentObjectKey, &out.VoiceDurationMs, &out.CreatedAt,
	)
	return out, err
}

func (s *SQLStore) ListMessages(ctx context.Context, conversationID uuid.UUID, after *time.Time, limit int32) ([]chat.Message, error) {
	const q = `SELECT id, conversation_id, sender_id, body, reply_to_message_id,
		attachment_kind, attachment_name, attachment_mime, attachment_size,
		attachment_object_key, voice_duration_ms, created_at
		FROM messages
		WHERE conversation_id=$1 AND deleted_at IS NULL AND ($2::timestamptz IS NULL OR created_at > $2)
		ORDER BY created_at ASC LIMIT $3`
	rows, err := s.pool.Query(ctx, q, conversationID, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []chat.Message{}
	for rows.Next() {
		var m chat.Message
		if err := rows.Scan(
			&m.ID, &m.ConversationID, &m.SenderID, &m.Body, &m.ReplyToMessageID,
			&m.AttachmentKind, &m.AttachmentName, &m.AttachmentMIME, &m.AttachmentSize,
			&m.AttachmentObjectKey, &m.VoiceDurationMs, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *SQLStore) SoftDeleteMessage(ctx context.Context, id, senderID uuid.UUID) (chat.Message, error) {
	const q = `UPDATE messages SET deleted_at=now() WHERE id=$1 AND sender_id=$2 AND deleted_at IS NULL
		RETURNING id, conversation_id, sender_id, body, reply_to_message_id,
		attachment_kind, attachment_name, attachment_mime, attachment_size,
		attachment_object_key, voice_duration_ms, created_at`
	var out chat.Message
	err := s.pool.QueryRow(ctx, q, id, senderID).Scan(
		&out.ID, &out.ConversationID, &out.SenderID, &out.Body, &out.ReplyToMessageID,
		&out.AttachmentKind, &out.AttachmentName, &out.AttachmentMIME, &out.AttachmentSize,
		&out.AttachmentObjectKey, &out.VoiceDurationMs, &out.CreatedAt,
	)
	return out, err
}

func (s *SQLStore) UpsertReaction(ctx context.Context, messageID, userID uuid.UUID, emoji string) (chat.Reaction, error) {
	const q = `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)
		ON CONFLICT (message_id, user_id, emoji) DO UPDATE SET created_at=now()
		RETURNING message_id, user_id, emoji, created_at`
	var r chat.Reaction
	err := s.pool.QueryRow(ctx, q, messageID, userID, emoji).Scan(&r.MessageID, &r.UserID, &r.Emoji, &r.CreatedAt)
	return r, err
}

func (s *SQLStore) DeleteReaction(ctx context.Context, messageID, userID uuid.UUID, emoji string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`, messageID, userID, emoji)
	return err
}

func (s *SQLStore) ListReactions(ctx context.Context, messageIDs []uuid.UUID) ([]chat.Reaction, error) {
	if len(messageIDs) == 0 {
		return nil, nil
	}
	const q = `SELECT message_id, user_id, emoji, created_at FROM message_reactions WHERE message_id = ANY($1::uuid[])`
	rows, err := s.pool.Query(ctx, q, messageIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []chat.Reaction{}
	for rows.Next() {
		var r chat.Reaction
		if err := rows.Scan(&r.MessageID, &r.UserID, &r.Emoji, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *SQLStore) GetUserPeer(ctx context.Context, id uuid.UUID) (chat.Peer, error) {
	const q = `SELECT id, display_name FROM users WHERE id=$1 AND deleted_at IS NULL`
	var p chat.Peer
	err := s.pool.QueryRow(ctx, q, id).Scan(&p.ID, &p.DisplayName)
	return p, err
}

