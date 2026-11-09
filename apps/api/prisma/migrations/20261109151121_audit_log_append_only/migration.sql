-- The audit log is append-only: rows can be added but never changed or removed.
-- A transaction can switch the guard off with
--   SELECT set_config('stockpilot.audit_maintenance', 'on', true);
-- which only the test reset helper does. Application code never does.
CREATE OR REPLACE FUNCTION audit_logs_block_changes() RETURNS trigger AS $$
BEGIN
  IF current_setting('stockpilot.audit_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only (% is not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_changes();