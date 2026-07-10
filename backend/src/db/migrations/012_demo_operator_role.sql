-- Public-demo hardening (security).
--
-- The public demo auto-connects every visitor's browser with the demo tenant's
-- api key `demo-key` (see src/main.js autoConnectDemoBackend). Migration 011
-- had seeded that tenant's operator as `admin`, which — once the key is shipped
-- to the client — would let ANY visitor read the public product-feedback table
-- (GET /v1/feedback is admin-gated) and see prospects' pricing-brief submissions.
--
-- Downgrade the demo operator to the plain `operator` role so the auto-shipped
-- key cannot reach any owner-facing surface. A real deployment promotes its own
-- owner-operator to `admin` at onboarding, keyed by a private key that is never
-- shipped to a browser.
UPDATE operators SET role = 'operator'
  WHERE customer_id = '00000000-0000-0000-0000-0000000000d0';
