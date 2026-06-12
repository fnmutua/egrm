# 10 — Requirements Catalogue (Traceable)

Priorities: **M**ust (MVP), **S**hould (fast-follow), **C**ould (differentiator). Source mapping: K2 = KUSP2 requirement family, KIS = KISIP lesson, DOC = GRM doctrine. Detail lives in the referenced spec.

## GEN-CFG — Configuration & multi-tenancy (spec 01, 02)

| ID | P | Requirement | Source |
|---|---|---|---|
| GEN-CFG-01 | M | All tenant behavior (hierarchy, taxonomy, workflow, SLAs, forms, templates, roles, channels, branding) defined in a versioned DB configuration registry; no code change for routine variation | K2 NFR-14, KIS |
| GEN-CFG-02 | M | Config versions validated (schema, references, workflow reachability) before activation; activation atomic | — |
| GEN-CFG-03 | M | Config history with diff, author, note; rollback | K2 §4.6 |
| GEN-CFG-04 | M | Tenant profile export/import as signed bundle (env promotion, onboarding templates) | K2 NFR-17 |
| GEN-CFG-05 | M | Row-level tenant isolation in all data access (both deployment models) | — |
| GEN-CFG-06 | M | In-flight cases pinned to their workflow version; explicit logged migration mapping | — |
| GEN-CFG-07 | S | Dry-run/simulation of draft workflows | — |
| GEN-CFG-08 | M | Per-tenant locales; all complainant-facing text localizable; EN+SW shipped | K2 FR-PUB-10/NFR-12 |
| GEN-CFG-09 | M | Feature flags per module (KB, tasks, committees, appeals, satisfaction, USSD, hotline, accounts, public API, transparency page) | — |
| GEN-CFG-10 | M | Arbitrary-depth jurisdiction hierarchy (levels + unit tree, CSV import) | KIS vs K2 hierarchy mismatch |

## GEN-INT — Intake & channels (spec 05)

| ID | P | Requirement | Source |
|---|---|---|---|
| GEN-INT-01 | M | Unified register: all channels → standardized intake dataset, unique reference, channel tag | K2 §4.1 |
| GEN-INT-02 | M | Web portal: configured multi-step form, attachments, CAPTCHA, confirmation with reference | K2 FR-PUB-03/04/05/09 |
| GEN-INT-03 | M | Staff-assisted intake with source channel, scripts, draft save, party lookup-or-create | K2 FR-STAFF-04/05 |
| GEN-INT-04 | M | Anonymous submission (per-tenant policy) with reference-based tracking; never blocks logging or referral | K2 FR-PUB-13, §18.2 |
| GEN-INT-05 | M | Representative/group submissions with consent-of-affected-person | K2 Appendix A |
| GEN-INT-06 | M | Consent capture (versioned privacy notice) whenever PII present | K2 FR-PUB-11, DPA |
| GEN-INT-07 | M | Configurable duplicate detection (warn/link/queue-for-merge); no silent DB-constraint rejections | KIS |
| GEN-INT-08 | M | Concurrency-safe configurable reference numbering | KIS (max()+1 bug class) |
| GEN-INT-09 | M | Public status tracking via reference + verifier / signed link; enumeration-resistant; PII-minimized | K2 FR-PUB-06; KIS (guessable IDs) |
| GEN-INT-10 | S | USSD intake (menu config, minimum fields, `requires_completion` triage) + status enquiry | K2 FR-USSD-01–04 |
| GEN-INT-11 | S | Hotline/IVR assisted intake with call metadata | K2 FR-HOT-01–05 |
| GEN-INT-12 | S | Inbound email processing to triage queue; outbound email Must (see GEN-NOT) | K2 FR-EMAIL-02 |
| GEN-INT-13 | M | Chatbot intake default-off platform-wide; activates only by explicit tenant opt-in (see GEN-AI) | K2 FR-PUB-15 |
| GEN-INT-14 | M | Attachment policy enforcement (size/type/count) + authorized download with audit | K2 FR-ATT-01/02 |
| GEN-INT-15 | S | Malware scanning hook for uploads | K2 FR-ATT-03 |
| GEN-INT-16 | M | Free-of-charge, confidentiality and non-retaliation assurances displayed (content editable, presence enforced) | K2 FR-PUB-12/14, DOC |
| GEN-INT-17 | S | Registered complainant accounts (OTP) with case history | K2 FR-PUB-07 |
| GEN-INT-18 | S | Knowledge base: categories, search, featured, multi-language; canned responses for staff | K2 FR-KB-01–03 |

## GEN-AI — Chatbot & AI assistance (spec 05 §7) — all opt-in, default off

| ID | P | Requirement | Source |
|---|---|---|---|
| GEN-AI-01 | C | Chatbot channel adapter (web widget, WhatsApp): slot-filling over the configured form, read-back confirmation, KB-RAG FAQ, status check; transcript on case; automated-agent disclosure enforced | KIS document_ai precedent |
| GEN-AI-02 | C | Mandatory human handoff path; automatic handoff on sensitivity signals | DOC survivor-centred |
| GEN-AI-03 | C | AI triage suggestions: auto-categorization, priority, semantic dedupe — suggestion-only, staff confirm | — |
| GEN-AI-04 | C | AI sensitivity detection: positive flag applies restrictions immediately, pending human confirmation; never auto-dismisses | — |
| GEN-AI-05 | C | AI staff aids: summarization, translation (originals preserved), draft responses (edit/approve before send), KB answer assist with citations | — |
| GEN-AI-06 | M* | AI governance (applies whenever any AI capability is on): human-in-the-loop for all case decisions, PII redaction before external calls, provider profiles with residency/no-training flags, full audit of every suggestion + accept/reject, per-capability kill switches, quality/drift dashboards | DPA 2019 |

\* GEN-AI-06 is Must *conditional on* enabling any GEN-AI capability.

## GEN-WF — Workflow, SLA, escalation, closure (spec 04)

| ID | P | Requirement | Source |
|---|---|---|---|
| GEN-WF-01 | M | Server-side state machine from config: statuses (with semantic tags), transitions, guards | KIS (client-side rules) |
| GEN-WF-02 | M | Single atomic case-action endpoint (status+log+attachments+notifications outbox in one transaction; idempotency keys) | KIS (client rollback) |
| GEN-WF-03 | M | Guards: role, jurisdiction level, required fields/attachments/notes, approvals, case state | K2 §4.2 |
| GEN-WF-04 | M | Screening step with eligibility outcome + out-of-scope referral guidance recorded | DOC, K2 |
| GEN-WF-05 | M | Escalation = level move up the configured tree; return = move down; direction from hierarchy config | KIS/K2 |
| GEN-WF-06 | M | SLA engine: plans (ack/first-response/resolution/stage), working calendars + holidays, server-computed clocks, pause statuses | K2 FR-ADM-06; KIS (ms bug) |
| GEN-WF-07 | M | At-risk + breach detection on fixed scheduler; queue flags; reminders | K2 FR-STAFF-16/FR-NOTIF-03; KIS (random cron) |
| GEN-WF-08 | M | Declarative escalation rules (time/severity/dissatisfaction/manual) with audited firings | K2 FR-WF-01 |
| GEN-WF-09 | M | Closure pipeline: resolution evidence, optional higher-level confirmation, satisfaction capture, appeal window, closure checklist + reason codes | KIS confirm pattern, K2 §4.4, DOC |
| GEN-WF-10 | M | Satisfaction capture (configurable channels; N/A for anonymous); dissatisfaction can trigger appeal | K2 FR-WF-02 |
| GEN-WF-11 | M | Appeal workflow: window, routing, rounds, decision capture; reopen policy with audit | K2 FR-WF-03, DOC |
| GEN-WF-12 | M | External referrals: institution directory, structured handoff, external reference, outcome return | K2 §4.2, DOC |
| GEN-WF-13 | M | Link related cases; merge with preserved threads and dual audit | K2 FR-STAFF-18/19 |
| GEN-WF-14 | M | Legal hold blocks closure-side mutations and retention | K2 §4.4 |
| GEN-WF-15 | S | Tasks module (create/link/assign/due/overdue alerts) | K2 FR-TASK-01–04 |
| GEN-WF-16 | S | Committee module: rosters, decision records bound to transitions | DOC (GRC/SAIC), KIS SEC/GRC |
| GEN-WF-17 | M | Soft delete/archive with restore permission; permanent deletion only via retention jobs | KIS |
| GEN-WF-18 | S | Complainant self-service actions per config (reply, appeal, self-escalate, withdraw) — verified, rate-limited | KIS self-escalate |

## GEN-CASE — Case management console (spec 03, 05)

| ID | P | Requirement | Source |
|---|---|---|---|
| GEN-CASE-01 | M | Queues: open/my/team/overdue/closed + saved views (filters, columns, sharing) | K2 FR-STAFF-02, ADM queues |
| GEN-CASE-02 | M | Search: basic + advanced criteria builder, RBAC-scoped; sensitive cases excluded without clearance | K2 FR-STAFF-03; KIS |
| GEN-CASE-03 | M | Case detail: timeline (single event stream), thread (external vs internal), parties, tasks, attachments, SLA clocks, available actions from engine | K2 FR-STAFF-07/08/17 |
| GEN-CASE-04 | M | Field edits audited with before/after; revert as new inverse event | KIS history/revert |
| GEN-CASE-05 | M | Assignment/transfer with reason; collaborator management; claim-on-response option | K2 FR-STAFF-14/15/06 |
| GEN-CASE-06 | M | Bulk actions (assign/transfer/status where guards allow) with per-case guard evaluation + per-case audit | K2 FR-STAFF-21; KIS bulk refer |
| GEN-CASE-07 | M | Case file PDF export (tenant-branded dossier) | KIS pdf endpoints, K2 FR-STAFF-20 |
| GEN-CASE-08 | M | Complainant directory (party history); org directory optional | K2 FR-USER-01, FR-ORG-01 |

## GEN-NOT — Notifications (spec 06)

| ID | P | Requirement | Source |
|---|---|---|---|
| GEN-NOT-01 | M | Declarative event→recipient→template→channel rules; recipient selectors over roles+scopes | KIS (roleid 4 hardcode) |
| GEN-NOT-02 | M | Multi-locale, multi-channel templates with validated variables; privacy-safe variants forced for sensitive classes | K2 FR-NOTIF-01/02 |
| GEN-NOT-03 | M | Transactional outbox; async delivery with retries; provider adapters (SMS/email/in-app) | — |
| GEN-NOT-04 | M | Full notification log incl. suppressed sends with reason; failure dashboard + resend | KIS pattern, K2 INT-08/09 |
| GEN-NOT-05 | M | Per tenant×channel×module kill switches (audited) | KIS module_settings |
| GEN-NOT-06 | S | Delivery callbacks, dedup/throttling, quiet hours | K2 INT-08 |

## GEN-SEC — Security, access, PII (spec 07)

| ID | P | Requirement | Source |
|---|---|---|---|
| GEN-SEC-01 | M | AuthN on all non-public endpoints; public surface rate-limited + abuse-monitored | KIS (open writes) |
| GEN-SEC-02 | M | RBAC: fixed permission catalogue composed into tenant roles; separation of admin vs handling | K2 AC-01, FR-ADM-01 |
| GEN-SEC-03 | M | Jurisdiction-subtree scoping enforced at data layer; record-level rules (assignee/dept) | K2 AC-02 |
| GEN-SEC-04 | M | Sensitivity classes with policy bundles (visibility, routing, masking, notification redaction, aggregate-only reporting, export block) | K2 FR-SENS-01–04; KIS isgbv |
| GEN-SEC-05 | M | App-layer field encryption for PII (per-tenant keys, KMS envelope); HMAC lookup hashes | KIS pgp/AES defects |
| GEN-SEC-06 | M | MFA configurable; mandatory for privileged roles; SSO (OIDC/SAML) per tenant | K2 AC-04/NFR-06/§16.5 |
| GEN-SEC-07 | M | Append-only hash-chained audit incl. sensitive-case views, exports, config changes, denials | K2 NFR-09 |
| GEN-SEC-08 | M | Retention policies (anonymize/archive/delete) per case type/sensitivity; legal hold; DSAR workflows | K2 §4.4, DPA 2019 |
| GEN-SEC-09 | M | Secrets in vault; no secrets in code/client; environment isolation; no prod PII in non-prod | KIS .env files |
| GEN-SEC-10 | S | Break-glass access with justification + DPO alert | K2 §18.2 |
| GEN-SEC-11 | M | Time-bounded role assignments (valid_from/valid_to) | KIS role expiry |
| GEN-SEC-12 | S | IP ACLs for staff/admin consoles; per-key API allowlists | K2 NFR-07 |

## GEN-REP — Reporting (spec 08)

| ID | P | Requirement | Source |
|---|---|---|---|
| GEN-REP-01 | M | Standard KPI set on semantic tags + clocks; tenant targets; actual-vs-target dashboards | DOC KPIs, K2 REP-07 |
| GEN-REP-02 | M | Operational + management dashboards with tree drill-down; scope/sensitivity respected | K2 REP-01/02/03/06 |
| GEN-REP-03 | M | Exports (CSV/XLSX/PDF) gated by export field policies; PII excluded by default | K2 NFR-13, INT-10 |
| GEN-REP-04 | M | Aggregate-only sensitive reporting with minimum cell size | K2 FR-SENS-04 |
| GEN-REP-05 | S | Scheduled reports; regulator pack templates | K2 REP-05 |
| GEN-REP-06 | S | Public transparency page (tenant-approved aggregates) | ESS10/ATI |
| GEN-REP-07 | S | Satisfaction & escalation analytics; repeat-complainant view | K2 REP-08 |
| GEN-REP-08 | C | Map dashboard over unit geo data | KIS geo data |
| GEN-REP-09 | M | Admin-built dashboards as config: dashboard → sections → declarative widgets (dataset, measure, aggregation, group-by, filters, chart kind, targets, drill-down) with audience targeting and live-preview builder | KIS dashboard/section/card/chart system |
| GEN-REP-10 | M | Widgets query only curated semantic-layer datasets with server-enforced jurisdiction + sensitivity row-level security, PII exclusion, cardinality/row caps and managed caching | KIS open summary endpoints (defect) |
| GEN-REP-11 | M | Extensible chart-renderer catalogue (kpi card, bar/stacked, line/multi-line, pie/donut, treemap, map, table, pyramid); localized captions/source notes | KIS chart-types |
| GEN-REP-12 | S | Default dashboard pack shipped as tenant-editable config; `is_main` per audience; dashboards portable via config bundle | KIS main_dashboard/public flags |

## GEN-API — API & integrations (spec 09)

| ID | P | Requirement | Source |
|---|---|---|---|
| GEN-API-01 | M | Documented OpenAPI REST surface; consoles are API clients | K2 NFR-16/INT-11 |
| GEN-API-02 | M | Idempotent mutations; optimistic concurrency; consistent errors | — |
| GEN-API-03 | S | Outbound webhooks (signed, retried, PII-minimized) | K2 §16.3 |
| GEN-API-04 | M | Gateway adapters: SMS, USSD, email; provider-pluggable | K2 INT-06/07; KIS Advanta |
| GEN-API-05 | M | Full data + config export in open formats (anti-lock-in) | K2 NFR-17 |
| GEN-API-06 | M | Validated, authenticated, logged bulk import jobs (units, users, legacy cases) | KIS /upsert |

## GEN-NFR — Non-functional

| ID | P | Requirement | Source |
|---|---|---|---|
| GEN-NFR-01 | M | 95% of interactive requests < 3s; search < 5s at expected peak | K2 NFR-01 |
| GEN-NFR-02 | M | ≥99.5% availability; maintenance page; documented scaling | K2 NFR-02/03 |
| GEN-NFR-03 | M | WCAG 2.1 AA; low-bandwidth public pages; responsive | K2 NFR-11 |
| GEN-NFR-04 | M | Deployment-model flexibility: gov-hosted dedicated or SaaS multi-tenant; data residency per contract | K2 24.4.2 |
| GEN-NFR-05 | M | Backups (daily full + incremental), tested restore, DR runbook with agreed RTO/RPO | K2 §5.2, DEL-13/14 |
| GEN-NFR-06 | M | Observability: structured logs, metrics, alerting (queue depth, notification failures, SLA scheduler health) | — |
| GEN-NFR-07 | M | TLS everywhere; security headers; OWASP ASVS L2; CI dependency scanning | K2 NFR-04 |
| GEN-NFR-08 | S | Compliance report exports (filterable audit packs) | K2 NFR-19 |

## Traceability

Every GEN-* requirement maps to: (a) the spec section that details it, (b) its source (KUSP2 ID family / KISIP lesson / doctrine), and (c) — during implementation — test cases in the RTM. The KUSP2 compliance matrix (136 IDs) can be answered from this catalogue almost one-to-one, which doubles as a bid-readiness artifact for similar procurements.
