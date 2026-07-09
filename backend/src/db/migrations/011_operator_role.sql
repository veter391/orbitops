-- Minimal RBAC: an operator role. Two roles today — 'operator' (the default: can
-- run the agent, decide proposals, read telemetry/audit for their own tenant) and
-- 'admin' (additionally the owner-facing surfaces, e.g. reading the public product
-- feedback). The role -> permission matrix is intentionally tiny and additive; a
-- richer matrix is a product decision made at onboarding (see docs/INFRA.md §5).
--
-- The demo tenant's operator is the owner account, so it is seeded as admin; every
-- other/new operator defaults to 'operator'. In production, mark each customer's
-- owner-operator admin at onboarding.

ALTER TABLE operators
  ADD COLUMN role TEXT NOT NULL DEFAULT 'operator'
  CHECK (role IN ('operator', 'admin'));

UPDATE operators SET role = 'admin'
  WHERE customer_id = '00000000-0000-0000-0000-0000000000d0';
