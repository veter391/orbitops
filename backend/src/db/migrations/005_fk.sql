-- Referential integrity: every tenant-scoped row must belong to a real customer.
-- The customer_id columns were added + backfilled in 003; add the foreign keys
-- now (ON DELETE CASCADE so removing a customer cleanly removes its data).
ALTER TABLE proposals
  ADD CONSTRAINT proposals_customer_fk
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE telemetry
  ADD CONSTRAINT telemetry_customer_fk
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_customer_fk
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
