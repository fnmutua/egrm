# 09 — API & Integrations

## 1. API principles

- Single documented **REST API** (OpenAPI spec published per deployment) — the consoles are themselves API clients (no privileged backdoors).
- JSON; cursor pagination; consistent error envelope with typed error codes; idempotency keys on mutations; optimistic-concurrency via `If-Match`/version.
- Versioned (`/api/v1`); additive changes preferred; deprecation policy documented.
- All endpoints tenant-scoped by auth context; rate limits per principal.

## 2. Surface overview

### 2.1 Public (unauthenticated, rate-limited, abuse-protected)

| Endpoint | Purpose |
|---|---|
| `POST /public/cases` | Submit (web form / channel adapters); CAPTCHA token; returns reference + verifier guidance |
| `GET /public/cases/track` | Reference + verifier (or signed token) → public status view |
| `POST /public/cases/{ref}/reply` | Complainant adds info (verified) |
| `POST /public/cases/{ref}/appeal` | Appeal/dissatisfaction (verified, window-checked) |
| `POST /public/satisfaction/{token}` | Satisfaction response via signed link |
| `GET /public/kb/*` | Knowledge base |
| `GET /public/stats` | Transparency aggregates (if enabled) |

### 2.2 Staff (authenticated)

| Group | Endpoints (representative) |
|---|---|
| Cases | `GET /cases` (saved-view query language), `GET /cases/{id}`, `POST /cases` (assisted), `POST /cases/{id}/actions` (the single action endpoint — spec 04 §2), `GET /cases/{id}/events`, `GET /cases/{id}/available-actions` (drives UI) |
| Thread | `GET/POST /cases/{id}/thread` (reply vs internal note by permission) |
| Tasks, attachments, referrals, appeals | CRUD per permission; attachment upload via signed URLs |
| Parties | `GET /parties?phone_hash=…`, history |
| Reports | `GET /reports/kpis`, `GET /dashboards/...`, `POST /exports` (async job + signed download) |

### 2.3 Admin

Config registry CRUD per domain (`/admin/config/{domain}`), versions, validate, dry-run, activate, export/import bundle; users/roles; notification rules/templates + test-send; audit search.

### 2.4 Webhooks (outbound)

Tenant-configurable subscriptions to the event catalogue (spec 06 §1.1): signed payloads (HMAC), retries with backoff, dead-letter queue visible in admin, PII-minimized payloads by default. Use cases: ministry M&E systems, national data warehouses, partner case handoff.

### 2.5 Inbound integrations

| Integration | Contract |
|---|---|
| SMS gateway | Provider adapters (send + delivery callbacks + inbound webhook) |
| USSD gateway | Session webhook (menu state machine driven by channel config) |
| Email | SMTP out per tenant identity; IMAP/webhook in for monitored mailboxes |
| Telephony/call center | Assisted-intake API with call metadata fields |
| SSO | OIDC/SAML per tenant |
| Partner systems | Scoped API keys; field-mapped case creation; external-reference linking on referrals |

## 3. Embedding & portability

- Public portal embeddable via allowlisted iframes or linked directly from programme websites (KUSP2 INT-05/16.1).
- **Full export** (NFR-17): tenant data (all entities, open formats) + configuration bundle + attachments manifest, runnable by tenant admins; documented data dictionary.
- Migration tooling: CSV importers for jurisdiction units, users, legacy cases (KISIP-style bulk import becomes an authenticated, validated, logged admin job — not an open `/upsert` endpoint).
