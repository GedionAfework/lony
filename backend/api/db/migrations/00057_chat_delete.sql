-- Delete for me: a person can hide a message only from their own view.
CREATE TABLE IF NOT EXISTS message_hides (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS message_hides_user_idx ON message_hides (user_id);

-- Delete chat: everything before cleared_at disappears for that member only.
-- The chat comes back on its own when a new message arrives.
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS cleared_at timestamptz;
