# Legacy game ownership

Migration `0004_users_and_game_ownership.sql` intentionally leaves pre-existing games with `owner_user_id = NULL`. They are not listed or readable through the authenticated, user-scoped game access layer. This prevents a newly registered account from claiming or discovering historical private games.

After creating the intended user, assign an existing game in one transaction. Replace both IDs with UUIDs from the `users` and `games` tables:

```sql
BEGIN;

UPDATE games
SET owner_user_id = 'USER_ID'
WHERE id = 'GAME_ID'
  AND owner_user_id IS NULL;

INSERT INTO game_members (game_id, user_id, role)
SELECT id, owner_user_id, 'OWNER'
FROM games
WHERE id = 'GAME_ID'
  AND owner_user_id = 'USER_ID'
ON CONFLICT (game_id, user_id) DO UPDATE SET role = 'OWNER';

COMMIT;
```

Check that the `UPDATE` changed exactly one row before committing. Do not assign ownership based on the first registered user, an active session, or a display name.
