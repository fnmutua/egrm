# 02 — Configuration Model (Per-Client Configurability)

This document defines **what is configurable per tenant, where the configuration lives, and how it is governed**. It is the core of the platform's genericity: onboarding a new client means authoring a tenant profile, not writing code.

## 1. Configuration registry

### 1.1 Storage and structure

- All tenant configuration is stored in the database in a **configuration registry**, organized as named, typed **config domains** (see §2). Environment variables carry only infrastructure secrets (DB credentials, gateway API keys).
- Every config object is **versioned**: changes create a new version with `changed_by`, `changed_at`, change note, and a diff. Administrators can view history and **roll back** (KUSP2 §4.6).
- Config changes are **validated before activation** (schema validation + referential checks + workflow reachability checks, see §3).
- The full tenant profile is **exportable/importable as one signed bundle** (JSON/YAML) for environment promotion and client onboarding from templates.

### 1.2 Scoping and precedence

Configuration resolves in order, most specific wins:

```
platform default  →  tenant  →  jurisdiction unit (optional)  →  category/case-type (optional)
```

Example: the tenant sets resolution SLA = 30 days; the "Corruption/Fraud" category overrides to 45 days; a specific county overrides acknowledgement templates with its own letterhead.

## 2. Configuration domains

### CD-01 Tenant identity & branding
| Item | Notes |
|---|---|
| Tenant name, legal name, programme metadata | Displayed in portal/PDFs |
| Logos, color theme, custom CSS, login background | KUSP2 Theme screens |
| Portal content pages (about, privacy notice, accessibility, offline notice) | CMS-style, multi-language, versioned (privacy notice versions are referenced by consent records) |
| Default + enabled locales | e.g. `en`, `sw`; all complainant-facing text must have a value per enabled locale |
| Timezone & date formats | UTC storage, local display |
| **Free-of-charge & non-retaliation statements** | Mandatory display items (KUSP2 FR-PUB-12/14); text editable, presence enforced |

### CD-02 Administrative hierarchy (jurisdictions)
| Item | Notes |
|---|---|
| **Level definitions**: ordered list, arbitrary depth | e.g. KISIP: `settlement < county < national`; KUSP2: `municipality < county < national`; corporate: `site < region < HQ` |
| **Unit tree**: instances of each level | e.g. 45 counties, 79 municipalities; importable via CSV |
| Per-level flags | `is_intake_default` (where new cases start), `is_confirmation_authority` (which level confirms closures), `can_be_assigned` |
| Geo metadata (optional) | Coordinates/boundaries for map dashboards |

The hierarchy drives: case routing, escalation direction (always to the next-higher level unless a rule overrides), user scoping, and report disaggregation.

### CD-03 Case taxonomy
| Item | Notes |
|---|---|
| **Case types** | e.g. Grievance, Feedback/Suggestion, Information Request, Safety Incident. Each case type binds: an intake form, a workflow, SLA plan defaults, numbering scheme |
| **Categories** (help topics), hierarchical, multi-select | e.g. Environmental, Social, GBV/SEAH, Corruption/Fraud, Project Implementation, Land/Compensation, … Each category can bind: default department/queue, SLA overrides, sensitivity class, routing rules |
| **Sensitivity classes** | Named policies (e.g. `standard`, `gbv_seah`, `corruption`) — each defines visibility restrictions, notification redaction, reporting mode, designated-role routing (spec 07) |
| **Priorities** | Ordered list (e.g. Low/Normal/High/Emergency) with SLA multipliers or per-priority SLA plans |
| **Expected outcomes** | Multi-select list (information, corrective action, compensation, accountability, other) |
| **Closure reason codes** | resolved, referred-out, insufficient information, duplicate/merged, withdrawn, … |
| **Controlled lists** | Arbitrary admin-defined lists usable in custom form fields (KUSP2 Lists) |

### CD-04 Workflow definitions (per case type)
Detailed in spec 04. Configurable elements:

| Item | Notes |
|---|---|
| **Status set** | Names, localized labels, semantic tag (`open`, `in_progress`, `resolved`, `closed`, `rejected`, `on_hold`, `appeal`) — semantic tags let reports work across tenants with different status names |
| **Transitions** | from→to pairs; each with: allowed roles, allowed jurisdiction levels, required fields, required attachment kinds (e.g. signed resolution form), required note, side effects (set assignee, move level, start/stop SLA clock) |
| **Initial status rules** | e.g. default `Received`; category- or flag-driven overrides (KISIP: in-court cases start as `In Court`; GBV starts at national level) |
| **Closure policy** | closure checklist fields, supervisory-approval threshold (priority/sensitivity/escalated), confirmation step (which level confirms which levels' resolutions), complainant-satisfaction capture on/off |
| **Appeal policy** | appeal window (days after resolution notice), who may appeal (complainant/representative), where the appeal routes (next level / committee), max appeal rounds |
| **Reopen policy** | who, until when, resulting status |

### CD-05 SLA plans & calendars
| Item | Notes |
|---|---|
| **SLA plans**: named sets of targets | `acknowledge_within`, `first_response_within`, `resolve_within`, optional per-status stage durations; units in working or calendar time |
| **Calendars**: working hours, weekends, holiday lists | per tenant, optionally per jurisdiction unit |
| **Reminder ladder** | e.g. notify assignee at T-2 days, daily after breach |
| **Escalation rules** | trigger (SLA breach, status age, priority, dissatisfaction, manual), action (move level, reassign, notify role X, raise priority) |
| Binding | SLA plan per case type, overridable per category and per priority |

### CD-06 Intake forms & data standards (per case type / channel)
| Item | Notes |
|---|---|
| Base standardized intake dataset (spec 05 §3) | Field-by-field: enabled, required/optional/conditional, label per locale, help text |
| **Custom fields** | Typed (text, number, date, select-from-list, multi-select, attachment), with conditions (show if X) |
| **Channel minimums** | Per channel, the minimal field subset (e.g. USSD: location + summary), with `requires_completion` flag for staff follow-up |
| Anonymity policy | allowed / not allowed per case type; behavior of follow-up when anonymous |
| Representative submission | enabled + consent-of-affected-person requirement |
| Attachment policy | max size, count, allowed types, malware-scan toggle |
| Duplicate detection rule | fields considered + match strategy + behavior (warn / link / block) |
| **Consent configuration** | consent text (versioned), required checkboxes |
| CAPTCHA / abuse controls | on/off, provider, thresholds |

### CD-07 Reference numbering
| Item | Notes |
|---|---|
| Pattern per case type | e.g. `GRM-{YYYY}-{seq:4}` (KISIP), `{unit_code}-{seq:6}`; tokens: year, tenant code, unit code, sequence with scope (global/yearly/per-unit) |
| Public verifier | whether status lookup needs reference + phone/email verifier (recommended default: yes) |

### CD-08 Channels
Per channel: enabled flag + channel-specific settings (spec 05). Web portal modules (knowledge base, status check, registered accounts), USSD menu tree + gateway, hotline scripts + call-center metadata fields, email mailboxes (in/out), SMS gateway provider profile, partner API keys.

### CD-09 Notification rules & templates
Detailed in spec 06. Per tenant: event subscriptions, recipient selectors, templates per locale and channel, per-module kill switches (with audit), quiet hours, sender identities (SMS shortcode, from-addresses).

### CD-10 Org structure, roles & access
| Item | Notes |
|---|---|
| Departments & teams | routing containers with access lists |
| **Roles**: named permission sets | built from the fixed platform permission catalogue (spec 07 §2); tenants can define any number of roles |
| Jurisdiction scoping rules | role assignment = role × jurisdiction unit(s) × optional department |
| Sensitive-case designations | which roles handle which sensitivity classes |
| Authentication policy | password policy, MFA required for which roles, SSO (OIDC/SAML) config, session timeout, IP allowlists |

### CD-11 Committees (optional module)
| Item | Notes |
|---|---|
| Committee definitions per jurisdiction level | e.g. Settlement GRC, County GMC, National committee |
| Membership rosters with terms | links to user accounts where members are staff |
| Workflow bindings | transitions that require a committee decision record (minutes, decision, date, attendees) |

### CD-12 External referral directory
| Item | Notes |
|---|---|
| Institutions (e.g. EACC, NEMA, Ombudsman/CAJ, GBV service providers) | name, type, contact, jurisdictions covered |
| Referral policy per category | e.g. criminal matters → police; out-of-scope routing guidance text |

### CD-13 Reporting & retention
| Item | Notes |
|---|---|
| KPI targets | target values per standard KPI (e.g. resolution ≤30 days) |
| Public transparency page | on/off; which aggregate stats are published |
| Scheduled report definitions | recipients, cadence, format |
| **Retention policies** | per case type/sensitivity: retention period, then anonymize/archive/delete; legal-hold flag support |
| Export field policies | which roles may export which fields (PII excluded by default) |

### CD-15 Dashboards & analytics (admin-built dashboards)
Modeled on the proven `plus-admin` dynamic-dashboard system (dashboard → section → card/chart rows resolved at runtime), hardened with a semantic layer (spec 08 §2–3):

| Item | Notes |
|---|---|
| **Dashboard definitions** | title, icon, audience (roles/levels), `is_main`, `is_public` (transparency page), layout |
| **Sections** | titled, icon/color groups of widgets within a dashboard |
| **Widgets** | KPI cards and charts; each declares: dataset (from the curated semantic layer), measure + aggregation, group-by dimensions, filters, chart kind, time dimension, drill-down target, caption/source note |
| **Chart kinds** | named catalogue (kpi_card, bar, stacked_bar, line, multi_line, pie/donut, treemap, map, table, pyramid) — extensible renderer registry |
| **Targets/thresholds** | per widget: target value, warning bands, conditional coloring |
| Audience & scoping | widgets render only for permitted roles; data auto-filtered to the viewer's jurisdiction scope and sensitivity clearance |

### CD-16 Chatbot & AI assistance (opt-in)
Detailed in spec 05 §7. Default-off; each capability independently switchable:

| Item | Notes |
|---|---|
| **AI provider profiles** | OpenAI / Azure OpenAI / xAI / self-hosted model; keys in vault; data-residency + no-training flags declared per profile (KISIP precedent: `document_ai` service with OpenAI/xAI keys) |
| **Chatbot channel** | surfaces (web widget, WhatsApp), persona/tone text, locales, allowed intents (intake, status check, KB FAQ), escalation-to-human rules, automated-agent disclosure text (presence enforced) |
| **Staff/triage capabilities** | per-capability flags + model choice: auto-categorization, sensitivity detection, semantic dedupe, summarization, translation, draft responses, KB answer assist |
| **Safety policy** | PII redaction before external calls, sensitive-class processing policy, confidence thresholds, per-capability kill switches (audited) |

Platform-level AI governance rules (human-in-the-loop, audit of every suggestion, sensitive fail-safe) are **not** configurable — see spec 05 §7.3.

### CD-14 Feature flags (module activation)
Coarse switches for whole modules so light tenants stay simple: knowledge base, tasks, committees, appeals, satisfaction survey, public transparency page, registered complainant accounts, organizations directory, USSD, hotline, public API, custom dashboards, chatbot intake, AI assistance.

## 3. Configuration governance

| Rule | Specification |
|---|---|
| **Validation** | A config version cannot activate unless: schema-valid; all references resolve (statuses in transitions exist, roles exist, templates exist for all enabled locales of all subscribed events); the workflow graph has a path from every initial status to a `closed`-tagged status; every SLA plan referenced exists |
| **Dry-run / simulation** | Admin can run a synthetic case through a draft workflow (state machine walk) before activation |
| **Staged activation** | New config versions activate atomically; in-flight cases either continue on the version they started with (default) or are migrated by an explicit, logged mapping (old status → new status) chosen by the admin |
| **Audit** | Every config change is an audit event (actor, domain, diff, version) |
| **Permissions** | Config administration is a separate permission family from case handling (separation of duties; KUSP2 FR-ADM-01) |
| **Templates library** | The platform ships tenant templates ("World Bank programme GRM", "Corporate external GRM", "Internal HR grievance") as starting profiles |

## 4. Worked example — one config domain (workflow excerpt, YAML)

```yaml
tenant: kisip
case_type: grievance
workflow:
  statuses:
    - {name: Received,       tag: open}
    - {name: Sorting,        tag: open}
    - {name: Investigation,  tag: in_progress}
    - {name: Escalated,      tag: in_progress}
    - {name: Referred,       tag: in_progress}
    - {name: Returned,       tag: in_progress}
    - {name: Resolved,       tag: resolved}
    - {name: Closed,         tag: closed}
    - {name: Rejected,       tag: rejected}
    - {name: In Court,       tag: on_hold}
  initial:
    default: Sorting
    rules:
      - {if: {flag: in_court}, then: In Court}
  transitions:
    - from: [Sorting, Investigation, Returned]
      to: Escalated
      roles: [grm_officer]
      effects: [{move_level: up}, {restart_sla: stage}]
    - from: [Investigation]
      to: Resolved
      roles: [grm_officer]
      requires: {fields: [resolution_summary], attachments: [signed_resolution_form]}
    - from: [Resolved]
      to: Closed
      roles: [grm_officer_national]
      guard: confirmation        # see closure policy
  closure:
    confirmation:
      required_when: {resolved_at_level_below: national}
      authority_level: national
      capture: [confirmation_notes]
    satisfaction: {enabled: true, channels: [sms, portal]}
  appeal:
    enabled: true
    window_days: 30
    routes_to: next_level
sla:
  plan: standard
  stage_durations: {Sorting: 7d, Investigation: 14d, Escalated: 14d, Resolved: 21d}
  calendar: kenya_public_holidays
```

The same schema expresses KUSP2's flow (statuses `Open/Pending`, `Under Investigation`, `Resolved`, `Referred`, `Escalated`, `Closed`; 14-day response / 30-day resolution SLA plan; satisfaction + appeal mandatory). See spec 11 for both full profiles.
