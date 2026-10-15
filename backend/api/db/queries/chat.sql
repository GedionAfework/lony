-- name: GetConversationByPair :one
SELECT * FROM conversations
WHERE user_low_id = $1 AND user_high_id = $2;

-- name: GetConversationByID :one
SELECT * FROM conversations WHERE id = $1;

-- name: InsertConversation :one
INSERT INTO conversations (user_low_id, user_high_id)
VALUES ($1, $2)
RETURNING *;

-- name: InsertConversationMember :exec
INSERT INTO conversation_members (conversation_id, user_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: IsConversationMember :one
SELECT EXISTS(
  SELECT 1 FROM conversation_members
  WHERE conversation_id = $1 AND user_id = $2
) AS is_member;

-- name: ListConversationsForUser :many
SELECT
  c.id,
  c.user_low_id,
  c.user_high_id,
  c.last_message_at,
  c.created_at,
  m.body AS last_body,
  m.attachment_kind AS last_attachment_kind,
  m.sender_id AS last_sender_id,
  m.created_at AS last_created_at,
  (
    SELECT COUNT(*)::int FROM messages msg
    WHERE msg.conversation_id = c.id
      AND msg.deleted_at IS NULL
      AND msg.sender_id <> sqlc.arg(user_id)
      AND (cm.last_read_at IS NULL OR msg.created_at > cm.last_read_at)
  ) AS unread_count
FROM conversations c
JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = sqlc.arg(user_id)
LEFT JOIN LATERAL (
  SELECT body, attachment_kind, sender_id, created_at
  FROM messages
  WHERE conversation_id = c.id AND deleted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1
) m ON true
ORDER BY COALESCE(c.last_message_at, c.created_at) DESC;

-- name: TouchConversation :exec
UPDATE conversations
SET last_message_at = $2
WHERE id = $1;

-- name: MarkConversationRead :exec
UPDATE conversation_members
SET last_read_at = $3
WHERE conversation_id = $1 AND user_id = $2;

-- name: InsertMessage :one
INSERT INTO messages (
  conversation_id, sender_id, body, reply_to_message_id,
  attachment_kind, attachment_name, attachment_mime, attachment_size,
  attachment_object_key, voice_duration_ms
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
)
RETURNING *;

-- name: GetMessageByID :one
SELECT * FROM messages WHERE id = $1 AND deleted_at IS NULL;

-- name: ListMessages :many
SELECT * FROM messages
WHERE conversation_id = $1
  AND deleted_at IS NULL
  AND ($2::timestamptz IS NULL OR created_at > $2)
ORDER BY created_at ASC
LIMIT $3;

-- name: SoftDeleteMessage :one
UPDATE messages
SET deleted_at = now()
WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: UpsertReaction :one
INSERT INTO message_reactions (message_id, user_id, emoji)
VALUES ($1, $2, $3)
ON CONFLICT (message_id, user_id, emoji) DO UPDATE SET created_at = now()
RETURNING *;

-- name: DeleteReaction :exec
DELETE FROM message_reactions
WHERE message_id = $1 AND user_id = $2 AND emoji = $3;

-- name: ListReactionsForMessages :many
SELECT message_id, user_id, emoji, created_at
FROM message_reactions
WHERE message_id = ANY($1::uuid[]);
