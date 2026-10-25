-- Restored local cleanup migration; deploy only alongside the new inactivity engine.
-- Wake existing waiting rooms so current presence determines their next deadline.
-- No ledger or history is deleted. Operational rollback: restore the prior engine;
-- this wake-up is harmless and does not require reversing any accounts.
update public.tables set due_at = now()
where status = 'waiting' and archived_at is null and due_at is null;
