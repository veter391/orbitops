# Security

OrbitOps is an open-source, self-hostable project. This policy describes its **real,
verifiable** security posture. Anything not yet built is labelled *planned* — nothing
here is aspirational unless it says so.

## Reporting a vulnerability

Please report privately first:

1. **[GitHub Security Advisories](https://github.com/veter391/orbitops/security/advisories/new)** (preferred), or email `orbitops@shypot.com` with "SECURITY" in the subject.
2. Include reproduction steps, impact, and — if you have one — a suggested fix.

This is a small open-source project, so we respond on a best-effort basis (expect an
acknowledgement within a few days). We won't pursue legal action against good-faith
research, and we'll credit you once a fix ships, if you'd like.

## Security posture that ships today

Every item below is implemented in this repository and exercised by the test suite
(`backend/test/*`); see [docs/SYSTEM-GUIDE.md](../docs/SYSTEM-GUIDE.md) §8 for the details.

**Audit integrity**
- Append-only, hash-chained audit log — each entry is a keyed **HMAC-SHA-256** over the previous hash, so tampering is detectable and forging a valid entry requires the server secret. `verify()` reports exactly where a chain breaks.
- Multi-process-safe: sequence assignment is serialized with a Postgres advisory lock (proven with concurrent appends against a real pooled connection).
- Production refuses to boot if `AUDIT_HMAC_KEY` is the dev default or shorter than 32 characters.

**Tenant isolation (defense in depth)**
- Every query is scoped by `customer_id`; the database also enforces it with foreign keys and **Postgres Row-Level Security** (tested against a non-superuser role).

**Authentication & identity**
- API keys are stored only as SHA-256 hashes, never in plaintext.
- Keys travel only in the `x-api-key` header, never in a URL; WebSockets use a short-lived (60s) HMAC-signed ticket instead of the raw key.
- Ticket and audit-hash comparisons use `timingSafeEqual`.
- The approving operator's identity always comes from the authenticated principal, never from the request body.

**Input & transport hardening**
- `@fastify/helmet`, `@fastify/cors` (explicit allow-list), `@fastify/rate-limit`, a request `bodyLimit`, and a global error handler with a fixed shape (no stack traces or SQL text leak to clients).
- Idempotency keys on creation endpoints; a CSV formula-injection guard on audit export; a trust-boundary validator that rejects malformed/non-physical CDM input.

**AI safety**
- Human-in-the-loop by construction: the agent only ever writes a `pending` proposal — nothing changes state without an authenticated human action, and every decision lands in the audit chain.
- Deterministic math makes every decision; the optional LLM is advisory-only, env-gated and timeout-bound, and can never change or block a proposal.

## Honest limitations (today)

- **Self-host / single-instance focus.** The reference deployment runs one backend instance with an embedded database; multi-instance scale and a managed, hardened hosting environment are a future hosted tier, not shipped here.
- **No MFA / SSO yet.** Authentication is API-key based. MFA, SSO (OIDC) and finer-grained RBAC are planned for the hosted tier.
- **No formal certifications.** The app collects no personal data — no accounts, analytics or tracking. Formal audits (SOC 2, ISO 27001) would belong to a managed offering and are **not** claimed today.
- **The public demo is ephemeral** by design — its data resets on restart.

## Planned (hosted tier — not yet built)

MFA / SSO (OIDC) + expanded RBAC · managed Postgres with encryption-at-rest and backups ·
mTLS for ground-station links · SOC 2 / ISO 27001 process · a coordinated
vulnerability-disclosure program. These are listed so no one mistakes them for controls
that exist today.

## Design principles

1. **The AI proposes; a human disposes.** No path from "the agent decided" to "it happened" without an authenticated human action.
2. **Deterministic math decides; the LLM only advises.**
3. **Every decision is recorded** in a tamper-evident chain.
4. **Honest labelling** — real vs. simulated vs. planned is always explicit.
