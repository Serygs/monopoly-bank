PRAGMA foreign_keys = ON;

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

INSERT INTO games (id, name) VALUES ('restore-rehearsal-game', 'Restore rehearsal fixture');
