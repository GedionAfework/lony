-- Optional display label when goal_type = custom ("Other")
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS type_label text;
