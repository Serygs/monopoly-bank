ALTER TABLE games ADD COLUMN recent_amounts TEXT
  CHECK (recent_amounts IS NULL OR (json_valid(recent_amounts) AND json_type(recent_amounts) = 'array'));
