-- LLM personas: conversations, messages, runs, daily usage caps

CREATE TABLE IF NOT EXISTS ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona varchar(32) NOT NULL,
  title varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (persona IN ('analyst', 'visualizer', 'coach'))
);

CREATE INDEX IF NOT EXISTS ai_conversations_user_persona_idx
  ON ai_conversations (user_id, persona, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL,
  content text NOT NULL DEFAULT '',
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role IN ('user', 'assistant', 'system', 'tool'))
);

CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx
  ON ai_messages (conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona varchar(32) NOT NULL,
  kind varchar(64) NOT NULL DEFAULT 'chat',
  model text,
  input_summary text,
  output_summary text,
  prompt_tokens int NOT NULL DEFAULT 0,
  completion_tokens int NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL DEFAULT 'ok',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (persona IN ('analyst', 'visualizer', 'coach')),
  CHECK (status IN ('ok', 'error', 'skipped'))
);

CREATE INDEX IF NOT EXISTS ai_runs_user_created_idx
  ON ai_runs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,
  request_count int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
