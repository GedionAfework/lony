-- Phase 7: platform settings (AI kill switch) + export/delete support indexes

CREATE TABLE IF NOT EXISTS platform_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (key, value)
VALUES ('ai_disabled', 'false')
ON CONFLICT (key) DO NOTHING;
