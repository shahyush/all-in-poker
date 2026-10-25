-- Permit multiple tables per player; preserve per-table membership uniqueness and all records.
-- Rollback requires checking for multi-table players before restoring the old unique index.
DROP INDEX IF EXISTS public.table_members_one_active_seat_idx;
CREATE INDEX IF NOT EXISTS table_members_active_player_idx ON public.table_members(user_id) WHERE status = 'active';
