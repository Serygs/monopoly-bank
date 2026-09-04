ALTER TABLE users ADD COLUMN games_lost INTEGER NOT NULL DEFAULT 0 CHECK (games_lost >= 0);

-- Completion rows are unique per game and account. Keeping the counter update in
-- this insert trigger makes the completion marker and the profile change atomic.
CREATE TRIGGER game_completion_updates_profile
AFTER INSERT ON game_completion_participants
BEGIN
  UPDATE users
  SET games_played = games_played + 1,
      games_won = games_won + NEW.won,
      games_lost = games_lost + CASE WHEN NEW.won = 0 THEN 1 ELSE 0 END,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.user_id;
END;
