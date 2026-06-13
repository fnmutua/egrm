# 06 — Notification Engine

Declarative, per-tenant notification rules replace inline notification code. Every message — sent, failed, or suppressed — is logged.

## 1. Model

```
event  →  rule(s)  →  recipients  →  template (locale, channel)  →  delivery  →  log
```

### 1.1 Events (emitted by the engines; fixed catalogue, extensible)

`case.created`, `case.acknowledged`, `case.status_changed`, `case.assigned`, `case.level_moved` (escalated/returned), `case.referred_out`, `case.resolved`, `case.confirmation_requested`, `case.confirmed`, `case.closed`, `case.reopened`, `appeal.opened`, `appeal.decided`, `satisfaction.requested`, `sla.at_risk`, `sla.breached`, `thread.reply_external`, `thread.reply_inbound`, `task.assigned`, `task.overdue`, `committee.decision_recorded`, plus admin events (`user.invited`, `config.changed`, …).

### 1.2 Rules (CD-09)

```yaml
- on: case.created
  to: [{party: complainant}, {role: grm_officer, scope: case_unit_and_above}]
  channels: {party: [sms, email], staff: [email, in_app]}
  template: case-registered
  condition: {sensitivity: standard}      # sensitive classes use redacted variants
- on: sla.at_risk
  to: [{user: assignee}]
  channels: [email, in_app]
  template: case-at-risk
- on: case.status_changed
  to: [{party: complainant}]
  channels: [sms]
  template: status-update
  condition: {not_status: [Referred]}     # KISIP rule "don't tell complainant about internal referral", now config
```

**Recipient selectors**: `party:complainant|representative`, `user:assignee|case_creator`, `role:<role> scope:<case_unit|unit_and_above|level|tenant>`, `team:<team>`, explicit address (admin alerts). Selector resolution uses role assignments + jurisdiction scoping — replacing KISIP's hardcoded `roleid: 4` queries.

**Conditions**: category, sensitivity class, priority, level, channel of submission, status (from/to), anonymous flag.

### 1.3 Templates

- Per template: per **locale** and per **channel** variant (SMS short form, email rich form, in-app).
- Variables: case reference, status label (localized), jurisdiction names, dates, tracking link, actor display name, tenant branding tokens, **action taken**, **update summary** (on status change). Unknown variables fail validation at config time.
- **Privacy modes**: each template is marked `standard` or `privacy_safe`; sensitivity classes force `privacy_safe` variants (reference + generic status only — no names, no narrative; KUSP2 FR-NOTIF-02/FR-SENS).
- Tracking links: signed, time-limited URLs to the public status page (no guessable numeric IDs — KISIP lesson).

## 2. Delivery

| Aspect | Specification |
|---|---|
| **Outbox pattern** | Notifications enqueue inside the case-action transaction; a worker delivers asynchronously with retries (exponential backoff, max attempts configurable) |
| **Channel providers** | Pluggable adapters: SMS (e.g. Advanta, Africa's Talking, Twilio), email (SMTP per tenant identity, SPF/DKIM guidance), in-app, USSD push where supported. Provider profiles are tenant config; one interface |
| **Kill switches** | Per tenant × channel × module (e.g. disable SMS for grievance events at county level). Suppressed messages are still logged with `suppressed:<by whom/why>` (KISIP pattern, kept) |
| **Quiet hours** | Optional per tenant (queue until morning) except emergency-priority events |
| **Delivery status** | Provider callbacks update `notification_log.status` (sent → delivered/failed); failures surface in an admin queue (KUSP2 INT-08/09) |
| **Throttling/dedup** | Same event + recipient + template within a window collapses to one message; per-recipient daily caps configurable |

## 3. Logging & audit

`notification_log` (spec 03 §2.9) records every attempt: event, recipient (hashed address), channel, template + locale, redacted preview, status timeline, provider message id, case linkage. Admin console: searchable log, failure dashboard, resend action (guarded).

## 4. Defaults shipped with the platform

A default rule pack implementing the doctrine baseline: complainant ack on creation (with tracking link), status-change notices (excluding internal-only transitions), officer notices on assignment/escalation/return/referral, at-risk and breach reminders, satisfaction request on resolution, closure notice, appeal notices. Tenants edit from there.

### 4.1 Alert toggles (CD-09)

In addition to declarative rules, two admin toggles control high-frequency staff/complainant alerts without editing the full rule list (spec 13 §8):

| Block | Event | Audience |
|---|---|---|
| `intake_alerts` | `case.created` | Jurisdiction officers (role + scope) |
| `status_change_alerts` | `case.status_changed` | Jurisdiction officers; optional complainant via `notify_complainant` |

Bundled templates: `case-intake-alert`, `case-status-changed-staff`. Missing templates are auto-merged on config load/save.
