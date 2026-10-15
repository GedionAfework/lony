-- Goal cover images for Plan cards
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS cover_image_key text;
