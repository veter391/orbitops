# Security

## Threat model

We take a "what could an attacker do" approach. Below are the threats we design
against, and how we defend.

### Threat 1: Customer telemetry leaks to another customer

**Severity**: Critical — could end contracts, trigger regulatory action

**Defense**:
- Single-tenant Postgres database per customer
- Row-level security (RLS) at the database level, not just application level
- TimescaleDB hypertables also RLS-isolated
- All backups encrypted with customer-specific keys
- No shared read replicas

### Threat 2: AI agent acts on customer telemetry in unintended way

**Severity**: Critical — could cause satellite to manoeuvre unsafely

**Defense**:
- The agent **proposes** — it does not execute
- Every proposal must be approved by a human with appropriate role
- All proposals carry an HMAC signature
- Audit log is append-only, hash-chained
- Anomaly detection does not affect satellite state — only surfaces alerts
- The agent runs in a sandbox with no outbound network to customer systems

### Threat 3: Compromised credentials allow attacker to approve bad manoeuvre

**Severity**: Critical

**Defense**:
- Multi-factor authentication required for all operator accounts
- Approval requires fresh re-authentication for high-severity actions
- Hardware key support (FIDO2/WebAuthn) preferred
- Time-based one-time passwords (TOTP) as fallback
- No SMS-based 2FA (SIM swap attacks)
- Session timeout: 15 minutes idle, 4 hours absolute
- IP allowlist option for high-security customers

### Threat 4: Man-in-the-middle on telemetry ingestion

**Severity**: High — false telemetry could trigger false manoeuvres

**Defense**:
- TLS 1.3 only, no fallback
- Certificate pinning on customer edge
- Mutual TLS (mTLS) for customer ground station connections
- AWS PrivateLink or GCP Private Service Connect for cloud connectivity
- Reject any unsigned or invalid telemetry at ingest

### Threat 5: Insider threat (employee reads customer data)

**Severity**: High — privacy and competitive concerns

**Defense**:
- Customer data encrypted at rest with customer-held keys (BYOK)
- Employees cannot decrypt customer data without explicit customer approval
- All employee access is logged and auditable
- Background checks for all engineers with data access
- No-print policy for sensitive data
- "Four eyes" for any administrative action on customer data

### Threat 6: Denial of service on our API

**Severity**: Medium — would prevent operator from receiving alerts

**Defense**:
- Multi-region deployment with automatic failover
- Rate limiting at edge
- CDN with DDoS protection (Cloudflare or equivalent)
- Queue-based architecture so ingest can absorb spikes
- Customer-impacting incidents paged 24/7
- SLA: 99.9% uptime on managed tier

### Threat 7: Supply chain attack on dependencies

**Severity**: Medium — could affect many customers at once

**Defense**:
- Software bill of materials (SBOM) generated for every release
- All dependencies pinned to specific versions
- Renovate bot keeps dependencies current
- Critical dependencies audited manually before upgrade
- We contribute security fixes upstream where possible
- SLSA Level 3 build provenance

### Threat 8: AI training on customer data without consent

**Severity**: Critical — would violate customer trust and possibly law

**Defense**:
- Customer telemetry is never used to train models without explicit opt-in
- Opt-in is per-data-category, not blanket
- Customers can revoke consent and we delete all derived models within 7 days
- This is contractually enforced

---

## What we will publish

- Annual SOC 2 Type II report (under NDA)
- Public security.txt at `/security.txt`
- Status page at `status.orbitops.io`
- Incident post-mortems (after the affected customers are notified)
- This security policy, updated as the threat model evolves

---

## What we will not publish

- Customer-specific telemetry or operations
- Customer audit log contents (customers export their own)
- Internal penetration test reports (we commission them but do not publish)
- Specific security tooling or stack (defence in depth, not security through
  obscurity)

---

## Responsible disclosure

We welcome security researchers. If you find a vulnerability:

1. Email `security@orbitops.io` with "SECURITY" in the subject
2. Encrypt with our PGP key (published at `/security.txt`)
3. Include reproduction steps, impact assessment, and suggested fix
4. We will acknowledge within 24 hours
5. We will triage within 72 hours
6. We will pay bounties for confirmed criticals (see `/security/bounty`)

We commit to:
- Not pursuing legal action against good-faith research
- Public credit after the fix is shipped, if you want it
- Coordinated disclosure timeline you agree with

---

## Compliance roadmap

| Standard | Target date | Status |
|---|---|---|
| SOC 2 Type I | Q3 2025 | Planned |
| SOC 2 Type II | Q1 2026 | Planned |
| ISO 27001 | Q3 2026 | Planned |
| GDPR | Day 1 | In force |
| CCPA | Day 1 | In force |
| ITAR | Year 2 if we enter defense | TBD |
| FedRAMP Moderate | Year 3 if we enter US gov | TBD |

---

## Reporting an incident

If you suspect a security incident:

- **Customers**: `security@orbitops.io` and your dedicated customer success
  manager
- **Researchers**: see responsible disclosure above
- **Press**: `press@orbitops.io`
- **Regulators**: we handle directly, you do not need to report us

We commit to:
- Notify affected customers within 24 hours of confirmed incident
- Notify regulators per their jurisdictional requirements
- Publish a post-mortem within 30 days
- Offer credit per SLA if our actions caused the incident