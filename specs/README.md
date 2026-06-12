# Generic eGRM Platform — Specification Set

A multi-client, configuration-driven electronic Grievance Redress Mechanism platform. One codebase; each client (tenant) gets its own administrative hierarchy, taxonomy, workflow, SLAs, channels, languages, branding and reporting — all as configuration.

Derived from:
- **KISIP eGRM** (`plus-admin`) — production reference implementation (patterns to keep, defects to fix)
- **KUSP2 eGRM procurement set** (BRD, ToR/SRS, wireframes, technical specs, RFQ) — requirements baseline (136 IDs)
- **GRM doctrine** (World Bank ESS10, NAVCDP, TAP, Cassava, PSCK, IFC/CAO) — process best practice

## Documents

| # | File | Contents |
|---|---|---|
| 01 | [01-overview.md](01-overview.md) | Vision, what "generic" means, platform invariants, tenancy & deployment models, architecture, principles |
| 02 | [02-configuration-model.md](02-configuration-model.md) | The configuration registry: 16 config domains (CD-01…CD-16), governance, worked YAML example |
| 03 | [03-domain-model.md](03-domain-model.md) | Entities & data model: case, party/PII, events, SLA clocks, workflow versions, audit |
| 04 | [04-workflow-engine.md](04-workflow-engine.md) | Server-side state machine, atomic action API, guards, SLA engine, escalation rules, closure pipeline, appeals |
| 05 | [05-intake-and-channels.md](05-intake-and-channels.md) | Channel matrix, intake pipeline, standardized intake dataset, public portal, adapters, chatbot & AI assistance (opt-in) |
| 06 | [06-notifications.md](06-notifications.md) | Event catalogue, declarative rules, templates, delivery, logging |
| 07 | [07-security-access-control.md](07-security-access-control.md) | AuthN/SSO/MFA, permission catalogue, 3-axis scoping, sensitivity classes, PII encryption, audit |
| 08 | [08-reporting-kpis.md](08-reporting-kpis.md) | Standard KPI set, admin-configurable dashboards (semantic layer + widget builder), exports, transparency page |
| 09 | [09-api-integrations.md](09-api-integrations.md) | REST surface, webhooks, gateway adapters, export/anti-lock-in |
| 10 | [10-requirements-catalogue.md](10-requirements-catalogue.md) | Traceable GEN-* requirements with priorities and source mapping |
| 11 | [11-tenant-profiles.md](11-tenant-profiles.md) | KISIP and KUSP2 expressed as configuration — proof of genericity |

## Reading guide

- **Product/business view:** 01 → 02 → 11 → 10
- **Engineering view:** 03 → 04 → 05 → 06 → 07 → 09
- **Procurement/compliance view:** 10 (maps ~1:1 onto the KUSP2 compliance matrix) → 07 → 08

## Status

Specification draft v0.1 — derived analysis complete; pending decisions before build:
1. Build vs adapt (custom build per these specs vs heavy customization of a helpdesk platform like osTicket, which the KUSP2 wireframes imply)
2. Tech stack selection (specs are stack-neutral; data model assumes a relational store)
3. MVP cut: GEN-* "Must" rows in doc 10 define the candidate MVP scope

Source reference materials are in [`../reference/`](../reference/).
