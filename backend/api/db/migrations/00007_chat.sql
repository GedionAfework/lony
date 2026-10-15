CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low_id uuid NOT NULL REFERENCES users(id),
  user_high_id uuid NOT NULL REFERENCES users(id),
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_low_id <> user_high_id)
);

CREATE UNIQUE INDEX conversations_pair_key ON conversations (user_low_id, user_high_id);

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  last_read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX conversation_members_user_idx ON conversation_members (user_id);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id),
  body text,
  reply_to_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  attachment_kind varchar(16) NOT NULL DEFAULT 'none',
  attachment_name text,
  attachment_mime text,
  attachment_size integer,
  attachment_object_key text,
  voice_duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (attachment_kind IN ('none', 'image', 'file', 'voice')),
  CHECK (
    (body IS NOT NULL AND length(trim(body)) > 0)
    OR attachment_object_key IS NOT NULL
  )
);

CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE message_reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  emoji varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji),
  CHECK (char_length(emoji) BETWEEN 1 AND 32)
);

CREATE INDEX message_reactions_message_idx ON message_reactions (message_id);
