# 12 — Development Plan (Nuxt UI + Node.js)

How to build the platform specified in docs 01–11. Stack: **Nuxt 4 + Nuxt UI v4** on the frontend, **Node.js (TypeScript)** services on the backend, **PostgreSQL** as the system of record. Scope baseline = all **Must (M)** rows in the requirements catalogue (doc 10); Should/Could rows are scheduled as fast-follows.

## 1. Stack decisions


| Layer              | Choice                                                                      | Rationale                                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend framework | **Nuxt 4** (Vue 3, TypeScript)                                              | Team continuity with the Vue-based KISIP codebase; SSR for the public portal (SEO, low-bandwidth, WCAG); SPA-mode app shell for consoles                                                                              |
| UI kit             | **Nuxt UI v4** (free, MIT — includes all former Pro components)             | Production-ready dashboard/page/form components (DashboardLayout, Tables, CommandPalette, Forms, PageSections) cover ~80% of console & portal chrome; Tailwind-based theming maps directly onto CD-01 tenant branding |
| State / data       | Pinia + Nuxt `useFetch`/typed SDK                                           | Generated OpenAPI client keeps consoles honest API clients (GEN-API-01)                                                                                                                                               |
| i18n               | `@nuxtjs/i18n`                                                              | EN+SW shipped; per-tenant locales (GEN-CFG-08)                                                                                                                                                                        |
| Charts             | Apex/ECharts wrappers                                                       | Reuse the proven KISIP chart-kind catalogue for the dashboard renderer registry (GEN-REP-11)                                                                                                                          |
| API service        | **Node.js 22 + Fastify + TypeScript**                                       | Lightweight, fast, first-class JSON-schema validation (pairs with config-registry schema validation), OpenAPI generation via `fastify-swagger`                                                                        |
| ORM / DB           | **Drizzle ORM + PostgreSQL 16**                                             | Typed schema-as-code migrations; row-level tenant isolation (GEN-CFG-05); `pgcrypto`-free app-layer PII encryption (GEN-SEC-05)                                                                                       |
| Jobs / outbox      | **BullMQ + Redis**                                                          | Notification outbox dispatch, SLA scheduler ticks, retention jobs, report generation (GEN-NOT-03, GEN-WF-07)                                                                                                          |
| Auth               | OIDC (Keycloak or Auth.js + node-oidc-provider), JWT access + refresh       | SSO per tenant, MFA, session policy (GEN-SEC-06)                                                                                                                                                                      |
| Files              | S3-compatible object store (MinIO on-prem)                                  | Attachment policy + scanning hook (GEN-INT-14/15)                                                                                                                                                                     |
| AI (opt-in)        | Provider-adapter package (OpenAI/Azure/xAI/local via Ollama)                | CD-16 provider profiles; PII redaction middleware before egress                                                                                                                                                       |
| Infra              | **Local-first dev**: native PostgreSQL 16 + plain Node processes (Redis/Memurai when the worker goes live); containerization (Docker/K8s) deferred to the deployment phase; GitHub Actions CI | Gov-hosted dedicated or SaaS multi-tenant (GEN-NFR-04)                                                                                                                                                                |


**Architecture shape** (from doc 01): the Nuxt apps are pure API clients of one versioned REST surface. Nuxt's Nitro server is used only for SSR/edge caching of the public portal — no business logic in the frontend tier. The workflow engine, SLA clocks and notification rules live exclusively in the API/worker services (platform invariant: *the server owns the rules*).

## 2. Monorepo layout

```
egrm/
├── apps/
│   ├── portal/        # Nuxt 4 + Nuxt UI — public portal (SSR): submit, track, KB, transparency page
│   ├── console/       # Nuxt 4 + Nuxt UI — staff console + admin console (SPA mode, route-split)
│   ├── api/           # Fastify — REST API, workflow engine, config registry, semantic layer
│   └── worker/        # BullMQ consumers — outbox dispatch, SLA scheduler, retention, reports, AI calls
├── packages/
│   ├── config-schemas/  # zod/JSON-schema for all CD-01…CD-16 config domains (shared validation)
│   ├── sdk/             # OpenAPI-generated typed client (used by both Nuxt apps)
│   ├── ui/              # shared Nuxt UI theme extensions, tenant theming, chart renderers
│   └── core/            # shared domain types, semantic status tags, permission catalogue constants
├── infra/               # docker-compose, k8s manifests, CI workflows
└── specs/               # these documents (source of truth)
```

pnpm workspaces + Turborepo. One deployable image per app; tenant resolution by hostname (SaaS) or build-time env (dedicated instance).

## 3. Delivery phases

Each phase ends with a demoable increment, migration scripts, and tests green in CI. Requirement IDs reference doc 10.

### Phase 0 — Foundations (weeks 1–4)

- Monorepo, CI/CD (lint, typecheck, unit + API contract tests, preview deploys), local dev stack (native PostgreSQL; Redis, object storage and SMTP catcher join in Phase 2 when the worker/outbox land — containerized or native, decided then).
- **Tenancy kernel**: tenant table, row-level isolation middleware, hostname resolution (GEN-CFG-05).
- **Auth**: OIDC login, JWT guards, password policy, session management; user/role tables from the fixed permission catalogue (GEN-SEC-01/02).
- **Config registry v1**: versioned config storage, `config-schemas` package, validation-before-activation, audit events (GEN-CFG-01/02/03).
- Nuxt apps scaffolded with Nuxt UI: authenticated console shell (nav from permissions), portal shell with tenant theming (CD-01).
- *Exit criteria*: log in to an empty console of a seeded tenant whose branding/locales come entirely from config.

### Phase 1 — Domain core & intake (weeks 5–10)

- Domain schema: case, party (PII-encrypted columns + HMAC lookup hashes), case_event stream, attachments, jurisdiction hierarchy (arbitrary depth + CSV import) (GEN-CFG-10, GEN-SEC-05).
- **Intake pipeline**: web portal multi-step form rendered from CD-06 form definitions; assisted intake in console; consent capture; dedupe rule; concurrency-safe reference numbering (GEN-INT-01…08).
- Public **status tracking** (reference + verifier, enumeration-resistant) (GEN-INT-09).
- Case detail page: timeline, thread (external/internal), attachments (GEN-CASE-03), queues + saved views (GEN-CASE-01).
- *Exit criteria*: a grievance submitted on the portal appears in the console queue, trackable publicly; the same build serves a second tenant with a different hierarchy and form.

### Phase 2 — Workflow engine, SLA & notifications (weeks 11–17)

- **Server-side state machine** interpreting CD-04 workflow config: statuses, semantic tags, transitions with guards; single atomic case-action endpoint with idempotency keys (GEN-WF-01/02/03).
- **SLA engine**: plans, working calendars, server-computed clocks, at-risk/breach scheduler in worker (fixes KISIP's days-vs-ms bug class) (GEN-WF-06/07); declarative escalation rules (GEN-WF-08).
- **Notification engine**: event→recipient→template→channel rules, transactional outbox, provider adapters (SMS: Advanta + pluggable; email: SMTP), full send/suppress log, kill switches (GEN-NOT-01…05).
- Closure pipeline: resolution evidence, confirmation step, satisfaction capture, appeal window (GEN-WF-09/10/11); merge/link, referrals, legal hold (GEN-WF-12/13/14).
- *Exit criteria*: both KISIP and KUSP2 workflow profiles (doc 11) run end-to-end — intake → escalate → resolve → confirm → close → appeal — on one build, with SMS/email firing per rules.

### Phase 3 — Security hardening & sensitive cases (weeks 18–21)

- Sensitivity classes: visibility restriction, designated-role routing, notification redaction, aggregate-only reporting (GEN-SEC-04).
- Jurisdiction-subtree scoping at the data layer; field-edit audit with before/after; append-only hash-chained audit log (GEN-SEC-03/07, GEN-CASE-04).
- MFA, retention jobs (anonymize/archive/delete), DSAR support, secrets vault integration (GEN-SEC-06/08/09).
- External pen test + OWASP ASVS L2 review (GEN-NFR-07).
- *Exit criteria*: GBV-class case invisible to non-designated staff everywhere (queues, search, reports, notifications); audit pack export.

### Phase 4 — Reporting & configurable dashboards (weeks 22–26)

- **Semantic layer**: curated datasets over the event stream with mandatory row-level security, materialized aggregates in worker (GEN-REP-10).
- **Dashboard builder**: dashboard → section → widget config (CD-15), live-preview editor in admin console, chart-renderer registry in `packages/ui` (port of the KISIP chart kinds), default dashboard pack (GEN-REP-09/11/12).
- Standard KPI set + targets; exports with field policies; case-file PDF dossier; transparency page (GEN-REP-01…04, GEN-CASE-07).
- *Exit criteria*: admin builds a new chart from the console with no deploy; KPIs match hand-computed values on seed data.

### Phase 5 — Extended channels & integrations (weeks 27–31)

- USSD adapter (menu tree from config) + status enquiry; hotline intake metadata; inbound email triage queue (GEN-INT-10/11/12).
- Public API + webhooks (signed, retried); bulk import jobs (units, users, legacy KISIP cases); full data/config export (GEN-API-03…06).
- Knowledge base + canned responses; registered complainant accounts (GEN-INT-17/18).
- *Exit criteria*: KISIP legacy data imported into a tenant; webhook consumer demo; USSD sandbox flow.

### Phase 6 — Chatbot & AI assistance, opt-in (weeks 32–36)

- AI provider-adapter package with PII-redaction middleware, `ai_interaction` audit, kill switches, quality dashboard (GEN-AI-06 governance first).
- Staff aids: auto-categorization, semantic dedupe, summarization, draft responses, KB answer assist (GEN-AI-03/05); sensitivity detection with restriction-first behavior (GEN-AI-04).
- Chatbot channel adapter (web widget; WhatsApp behind gateway), slot-filling over form config, human handoff (GEN-AI-01/02).
- *Exit criteria*: AI suggestions visibly improve triage on the pilot tenant with 100% of decisions human-confirmed and audited.

### Phase 7 — Pilot, UAT & production (weeks 35–40, overlaps 6)

- Performance/load testing to NFR targets (95% < 3s at 100k cases), DR drill (backup-restore), observability dashboards (GEN-NFR-01…06).
- Tenant onboarding runbook: author profile → import units/users → train → go live. Pilot with one tenant (KISIP migration or KUSP2 greenfield), 2-week hypercare.
- Documentation set: admin guide, API reference (generated), data dictionary, training materials per role track.

## 4. Team & timeline


| Role                                            | Allocation                |
| ----------------------------------------------- | ------------------------- |
| Tech lead / architect                           | 1 FTE, whole programme    |
| Backend (Node/Fastify)                          | 2 FTE                     |
| Frontend (Nuxt/Nuxt UI)                         | 2 FTE                     |
| QA / test automation                            | 1 FTE from Phase 1        |
| DevOps                                          | 0.5 FTE                   |
| UX (portal accessibility, USSD/chatbot scripts) | 0.5 FTE, Phases 0–2 and 6 |


≈ **40 weeks (~9 months)** to production pilot with this team; MVP demo (end of Phase 2, the full grievance lifecycle) at ~4 months. Compressible to ~30 weeks by running Phase 4 parallel to Phase 3 with a third backend dev.

## 5. Engineering practices

- **Spec traceability**: every PR references GEN-* IDs; the requirements catalogue becomes the test-plan backbone (RTM).
- **Testing pyramid**: unit (engine guards, SLA math, config validation), API contract tests against the OpenAPI schema, Playwright E2E for the four golden paths (submit→close, escalate, sensitive case, appeal), seeded multi-tenant fixtures (both doc-11 profiles run in CI).
- **Config-first development**: features are built against the two reference tenant profiles simultaneously — if a feature needs tenant-specific code, the design is wrong.
- **Migration discipline**: Drizzle migrations forward-only; config versions pinned to in-flight cases (GEN-CFG-06).
- **Definition of done**: code + tests + audit events + i18n keys (EN/SW) + permission checks + docs updated.

## 6. Key risks


| Risk                                       | Mitigation                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow-engine complexity creep           | Engine interprets a constrained schema (doc 02 §4) — no scripting/expression language in v1; escape hatch = new guard types added by platform team |
| SMS/USSD gateway dependencies              | Adapter contracts + sandbox simulators from Phase 2; telecom integration on the critical path only in Phase 5                                      |
| PII encryption vs search/reporting         | HMAC lookup hashes + semantic-layer design settled in Phase 1 schema, load-tested early                                                            |
| UI kit dependency                          | Nuxt UI v4 is free/MIT (Pro merged in, Sep 2025) — no licensing cost; pin minor versions to avoid breaking changes                                 |
| AI governance acceptance (gov tenants)     | AI entirely behind flags; local-model option (Ollama) for data-sovereign deployments                                                               |
| Scope pull from KUSP2 procurement timeline | Must-rows only until Phase 7; doc 10 priorities are the change-control baseline                                                                    |


