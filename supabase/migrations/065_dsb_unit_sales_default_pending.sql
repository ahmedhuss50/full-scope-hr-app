-- 065_dsb_unit_sales_default_pending.sql
-- ----------------------------------------------------------------------------
-- Default new sale rows to delivery_status = 'pending' (غير مُسلَّمة).
--
-- Rationale: importers were writing NULL when the sheet didn't specify a
-- delivery status, and the UI treats NULL as "unknown". The user's mental
-- model is that every new contract starts NOT delivered — the delivered
-- flag is set later by hand when the physical hand-off happens.
--
-- Also backfills any leftover NULL rows to 'pending' so the whole column
-- carries a consistent, non-null default going forward.
-- ----------------------------------------------------------------------------

alter table dsb_unit_sales
  alter column delivery_status set default 'pending';

update dsb_unit_sales
  set delivery_status = 'pending'
  where delivery_status is null;

notify pgrst, 'reload schema';
