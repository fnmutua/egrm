# 05 — Intake & Channels

All channels normalize into one **standardized intake dataset** and one unified case register (KUSP2 §4.1). Channels are per-tenant modules (CD-08); the baseline every tenant gets is **web portal + staff-assisted intake**; telecom channels activate when the client's arrangements allow.

## 1. Channel matrix

| Channel | Mode | Tenant config | Minimum capture |
|---|---|---|---|
| **Web portal** | Self-service | Theme, locales, form per case type, CAPTCHA, knowledge base on/off, registered accounts on/off | Full configured form |
| **Assisted intake** | Staff on behalf (walk-in, phone, letter, community meeting, complaint box) | Source-channel list, intake scripts (read-back confirmation), draft save | Full form, `submitted_by_user_id` recorded, source channel mandatory |
| **USSD** | Self-service, feature phones | Gateway provider, shortcode, menu tree per locale | Location + summary + category (configurable minimum); case flagged `requires_completion` for staff follow-up |
| **SMS** | Notifications always; optional structured intake | Provider profile, sender ID, opt-in rules | If intake enabled: free-text → `requires_completion` triage queue |
| **Hotline / IVR** | Operator-assisted | Telephony metadata fields (call id, operator), scripts, callback policy | As assisted intake |
| **Email (inbound)** | Semi-structured | Monitored mailboxes, parsing rules, auto-ack | Subject/body → summary/description; `requires_completion` |
| **Chatbot** (opt-in) | Conversational self-service (web widget, WhatsApp) | AI provider profile, persona/tone, languages, scope of questions, escalation-to-human rules | Guided slot-filling to the same channel minimum as USSD; transcript attached; `requires_completion` if incomplete |
| **Partner API** | System-to-system | API keys, field mapping, allowed case types | Full dataset per API contract |

Chatbot intake is **default-off platform-wide** and activates only by explicit tenant opt-in (KUSP2 prohibits it via FR-PUB-15 — its tenant profile keeps the flag off; other tenants may enable it).

## 2. Intake pipeline (all channels)

```
capture → validate (form def) → consent (if PII) → dedupe check → create case
  → reference number → initial status & level (workflow rules) → routing
  → acknowledgement (notification engine) → [requires_completion triage if minimal channel]
```

| Step | Specification |
|---|---|
| **Validate** | Against the case type's form definition (CD-06): required/conditional fields, types, list values. Channel minimums override (USSD/hotline/email) |
| **Consent** | If any PII captured: consent checkboxes per config, stored on `consent_record` with privacy-notice version. Anonymous path skips PII and consent |
| **Dedupe** | Configured rule (e.g. same phone + similar description within N days). Outcomes per config: warn submitter, auto-link as related, or queue for staff merge decision. Never a silent DB error (KISIP's unique-constraint approach) |
| **Reference** | Per numbering pattern (CD-07). Sequence allocation is concurrency-safe (DB sequence per scope), not max()+1 string parsing (KISIP) |
| **Initial status/level** | From workflow initial rules: default status; flag/category overrides (e.g. sensitive class starts at designated level — generalizes KISIP's GBV→national) |
| **Routing** | Category → department/team defaults; routing rules (filters) may set assignee, priority, SLA plan, add internal note |
| **Acknowledgement** | Immediate, via the submitter's channel + configured extras: reference number, what happens next, tracking instructions. Satisfies the `acknowledge` SLA clock |

## 3. Standardized intake dataset (base form)

Superset of KUSP2 Appendix A and the KISIP form; every field is per-tenant configurable (enabled/required/label/help):

**Section A — Complainant (all optional to permit anonymity, unless tenant requires)**
- Name; phone; email; postal/physical address; preferred contact method; preferred language
- Gender; age band; vulnerable-group tags (tenant-defined list)
- National ID (encrypted; tenants enable only if justified)
- Representative: name, relationship/organization, contact, consent-of-affected-person
- **Consent to personal data use** (required whenever PII present)

**Section B — Grievance**
- Submission channel (system-set); date of occurrence; date of submission (system)
- Jurisdiction unit (cascading selector over the tenant hierarchy); location/site free text; optional geo-point
- Category (multi-select per taxonomy); case type; sensitivity auto-derived
- Summary; description; evidence attachments
- Reported elsewhere? (where/reference)
- Tenant custom fields (CD-06)

**Section C — Expected outcome** (multi-select + free text)

**Section D — Official use (assisted intake / triage)**
- Received by, received at, source channel detail; initial assignment; internal notes

## 4. Public portal — functional spec

| Feature | Spec |
|---|---|
| **Home** | Process overview (configurable stages content), free-of-charge + non-retaliation + confidentiality assurances (presence enforced), CTAs: submit / track / knowledge base |
| **Submit** | Multi-step configured form; anonymous toggle (if allowed); attachment upload; CAPTCHA; confirmation page with reference + verifier guidance; print/download acknowledgement |
| **Track status** | Reference + verifier (phone/email used at submission, or PIN issued at intake for anonymous cases). Shows: status (public label), stage timeline, public thread entries, documents marked public. PII minimized; sensitive cases show stripped view per sensitivity policy. Generic errors prevent enumeration; rate-limited |
| **Complainant actions** | Reply/add info; appeal/dissatisfaction (when window open); withdraw — per workflow config (spec 04 §7) |
| **Registered accounts** (optional) | Email/phone OTP signup; case history; notification preferences |
| **Knowledge base** (optional) | Categories, search, featured articles, multi-language |
| **Accessibility & reach** | WCAG 2.1 AA; low-bandwidth pages (no heavy assets on critical paths); responsive; all enabled locales |

Anti-abuse: per-IP and per-identity rate limits on submission and lookup; attachment scanning (if enabled); honeypot fields; audit of rejected attempts.

## 5. Staff console — intake-related spec

- **Assisted intake form** = full form + Section D; party lookup-or-create (by phone/email hash) to link complainant history; read-back confirmation step per script config; draft save.
- **Completion queue**: cases flagged `requires_completion` (USSD/SMS/email) listed for enrichment; completing them is a guarded action.
- **Merge/link**: duplicate handling UI — link related cases or merge (merged case closes with reason `duplicate/merged`, thread preserved, audit event both sides).

**Case detail handling** (status updates, assignment, notifications log, timeline) is specified in [13-staff-console-case-handling.md](13-staff-console-case-handling.md).

## 6. Channel adapter contract

Each channel adapter implements:

```
normalize(raw) -> IntakeSubmission     # standardized dataset subset + channel metadata
verify(raw)    -> abuse/validity signals
ack(case)      -> channel-appropriate acknowledgement payload
```

Adapters are stateless against the intake pipeline; new channels (e.g. WhatsApp later) are added by implementing the contract + a config block, with no core changes.

## 7. Chatbot & AI assistance

Opt-in modules configured in **CD-16** and activated via **CD-14** feature flags (`chatbot_intake`, `ai_assistance`). Both default off.

The chatbot is a **channel adapter** (§6) feeding the standard intake pipeline. Staff AI capabilities are suggestion-only with mandatory human acceptance.

**Full specification:** [16-ai-integration.md](16-ai-integration.md) — capabilities, governance, data model (`ai_interaction`, `chatbot_session`), APIs, PII redaction, UI, and implementation plan.
