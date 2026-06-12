# 07 — Security, Access Control & Sensitive Cases

## 1. Authentication

| Item | Specification |
|---|---|
| Staff auth | Username/email + password (tenant policy: length, rotation, lockout) ; **MFA configurable per role, mandatory for privileged roles** (admins, sensitive-case roles) |
| SSO | OIDC and SAML 2.0 per tenant; directory-group → role mapping; secure local fallback accounts (KUSP2 §16.5) |
| Complainant auth | Optional registered accounts (email/phone OTP); guest tracking via reference + verifier or signed magic links |
| Sessions | Short-lived access tokens + refresh; absolute and idle timeouts per tenant; concurrent-session policy |
| API | Scoped API keys / OAuth client credentials; IP allowlists per key |
| Perimeter | Optional IP ACLs for staff/admin consoles (KUSP2 NFR-07); CAPTCHA + rate limits on public surface |

**Hard rule:** every endpoint requires authentication except the designated public surface (submit, track, knowledge base, satisfaction/appeal links), each of which is rate-limited, abuse-monitored and audited. (KISIP exposes `/log`, `/upsert`, `/upload`, `/self/escalate` unauthenticated — explicitly forbidden here.)

## 2. Authorization model

### 2.1 Fixed permission catalogue (platform code)

Permissions are fine-grained verbs the platform understands; tenants compose them into roles (CD-10). Families:

```
case:read, case:create_assisted, case:transition, case:assign, case:edit_fields,
case:read_pii, case:export, case:merge, case:delete_soft, case:restore,
case:confirm_resolution, case:override_sla, case:legal_hold,
thread:reply_external, thread:note_internal, attachment:upload, attachment:read_protected,
task:*, appeal:decide, referral:manage, committee:record_decision,
report:view_operational, report:view_aggregate, report:export,
admin:config_*, admin:users, admin:roles, admin:notifications, admin:audit_read,
sensitive:<class>:read, sensitive:<class>:handle      # generated per sensitivity class
```

### 2.2 Three-axis scoping

Every grant = **role (permission set) × jurisdiction scope × sensitivity clearance**:

1. **Permissions** — what verbs.
2. **Jurisdiction scope** — which subtree of the unit tree (assignment to a unit covers that unit and below; tenant-wide = root). Replaces KISIP's county_id/settlement_id role columns.
3. **Sensitivity clearance** — which sensitivity classes the role may see/handle.

Enforcement is at the **data-access layer** (query filters + row-level checks), not UI: list endpoints silently scope; detail/action endpoints return 403/404 consistently (404 for sensitive cases the user can't know exist).

### 2.3 Record-level rules (beyond scope)

- Assignee/collaborators always see their cases (within sensitivity clearance).
- Department/team access lists (KUSP2 department access).
- Contractors/service providers: restricted role template — assigned cases only, no PII fields, no export.

## 3. Sensitive-case policies (sensitivity classes)

Each class (CD-03) defines a policy bundle; `gbv_seah` ships as a strict default:

| Policy knob | `standard` | `gbv_seah` default |
|---|---|---|
| Visibility | jurisdiction scoping only | **only roles with explicit clearance**; others: case invisible (404), excluded from search/keyword/queues |
| Intake routing | normal initial level | starts at **designated level** (e.g. national) and routes to designated focal roles |
| PII display | per `case:read_pii` | masked for everyone except clearance + `read_pii`; full view events audited individually |
| Free text | normal | **minimal-capture form variant** (structured referral fields, restrained narrative) |
| Notifications | standard templates | **privacy-safe templates forced** (no names/narrative in SMS/email) |
| Reporting | full disaggregation | **aggregate-only**, minimum cell size (e.g. suppress counts < 5) |
| Referrals | optional | structured referral to service-provider directory; survivor consent flags; follow-up consent |
| Break-glass | n/a | optional: emergency access with mandatory justification, auto-alert to DPO role, prominent audit |
| Export | per role | blocked except aggregate |

Other classes (e.g. `corruption`) configure their own bundle (e.g. restricted to integrity unit, external referral to EACC tracked).

## 4. PII protection

| Item | Specification |
|---|---|
| Field-level encryption | PII columns encrypted at application layer (AES-GCM), per-tenant data keys, envelope encryption with KMS/HSM where available; key rotation procedure. No SQL-interpolated keys (KISIP defect) |
| Search on PII | Salted keyed hashes (HMAC) for exact lookup (phone/email/national-id); no plaintext indexes |
| At rest / in transit | Disk/db encryption; TLS 1.2+ everywhere; HSTS; secure cookies |
| Redaction | Role-driven field masking applied server-side in serializers (single choke point) |
| Consent & DSAR | Consent records versioned (spec 05); data-subject access/erasure workflows: locate by party, export, anonymize (subject to legal hold + retention) — Kenya DPA 2019 alignment |
| Retention | Per case type/sensitivity policies (CD-13): anonymize (strip party + PII fields, keep stats) or archive or delete; runs logged; legal hold blocks |
| Backups | Encrypted; restore tested before go-live and periodically (KUSP2 DEL-13) |

## 5. Audit

| Item | Specification |
|---|---|
| Coverage | All case events; all config changes (diffs); logins/failures; permission denials; exports (who, what fields, row count); **every view of a sensitive case**; notification sends; retention runs |
| Integrity | Append-only; hash-chained per tenant; no UPDATE/DELETE grants on audit tables |
| Access | `admin:audit_read` role; filterable UI + export (REP-04/NFR-19); auditor read-only role template |
| Retention | Online ≥ 90 days minimum (KUSP2 24.4.5), archive per policy |

## 6. Application & operational security

- OWASP ASVS L2 target; input validation server-side; output encoding; CSRF protection on consoles; security headers (CSP, X-Frame-Options per embedding config).
- File uploads: type/size enforcement, content sniffing, optional malware scanning (FR-ATT-03), storage outside web root, signed download URLs through an authorizing endpoint.
- Secrets in a vault/parameter store; no secrets in code or client bundles. (KISIP ships DB passwords and API keys in committed `.env` files — forbidden.)
- Dependency and image scanning in CI; vulnerability management SLAs; pen test before go-live where contracted (DEL-10).
- Environment isolation: dev/test/staging/prod; no production PII in non-prod without authorization (KUSP2 24.4.4); seeded synthetic data for testing.
- Incident response runbook; security event alerting (auth anomalies, mass export, break-glass use).
