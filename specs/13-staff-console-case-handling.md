# 13 — Staff Console: Case Detail & Handling

How staff interact with an individual grievance case in the console (`apps/console`). This document covers the **case detail workspace** — tabs, forms, API contracts, and notification behaviour implemented in Phase 1. It extends the workflow engine (spec 04), notification engine (spec 06), and security model (spec 07).

**Status:** Implemented (v0.1) — subject to review before Phase 2 (thread, SLA clocks, bulk actions).

---

## 1. Design principles

| Principle | Rule |
|---|---|
| **Server owns workflow** | The console never computes allowed transitions, levels, or guards. It calls `GET …/available-actions` and renders what the API returns (spec 04 §2). |
| **Atomic actions** | Every staff mutation is one `POST …/actions` (transition or assign). Notifications enqueue inside the same DB transaction as the case event (spec 06 §2). |
| **Jurisdiction-scoped visibility** | Case detail, actions, and assignee lists respect the actor's unit subtree and sensitivity clearance (spec 07 §2.2). Missing access → `404 not_found` (no enumeration). |
| **Complainant PII is explicit** | PII loads only on case read; access is audit-logged (`case.pii_viewed`). Overview keeps complainant in a collapsed section by default. |
| **Configurable alerts** | Staff and complainant notifications on intake and status change are toggled in CD-09 (`intake_alerts`, `status_change_alerts`), not hard-coded. |

---

## 2. Case detail layout

Route: `/cases/{id}`

### 2.1 Header (persistent)

- Case reference (monospace), semantic status badge (`status_tag` → colour), anonymous badge when applicable.
- One-line summary from intake.

### 2.2 Tabs (order)

| Tab | Purpose | Primary permission |
|---|---|---|
| **Overview** | Read-only case metadata, description, expected outcome, complainant | `case:read` |
| **Actions** | Workflow status updates | `case:transition` |
| **Assignment** | Current officer, history, assign/reassign | `case:read` (view); `case:assign` (mutate) |
| **Notifications** | Delivery log for this case | `case:read` |
| **Timeline** | Append-only `case_event` stream | `case:read` |
| **Correspondence** | Case thread: messages, logged contact, internal notes | `thread:read` |
| **Documents** | Attachments list + upload | `case:read` / `attachment:upload` |

Tabs are independent panels — no nested routing. State (e.g. notification list loaded) is per-tab.

---

## 3. Overview tab

Collapsible `<details>` sections minimise vertical space. Only **Case details** is open by default.

| Section | Content | Default |
|---|---|---|
| **Case details** | Categories, channel, level, location (unit), priority, assignee name, sensitivity, occurred/received dates | Open |
| **Description** | Free-text from intake | Collapsed; omitted if empty |
| **Expected outcome** | Complainant expectation | Collapsed; omitted if empty |
| **Complainant** | Name, phone, email, gender — or anonymous notice | Collapsed |

PII footer note: *"PII access is logged in the audit trail."*

---

## 4. Actions tab — status update form

Replaces per-status buttons. Staff complete a **single form** before the engine applies a transition.

### 4.1 Fields

| Field | Required | Maps to API | Stored on `case_event` |
|---|---|---|---|
| **New status** | Yes | `to_status` | `data.to_status` (with `from_status`) |
| **Action taken** | Yes | `action_taken` | `data.action_taken`; also used as effective note when transition requires `note` |
| **What was updated** | Yes | `update_summary` | `data.update_summary` |
| **Workflow extras** | Per CD-04 | `fields.{key}` | `data.fields` (e.g. `resolution_summary` on Resolve) |

### 4.2 API request

```
POST /api/v1/cases/{id}/actions
{
  "action": "transition",
  "to_status": "Investigation",
  "action_taken": "Reviewed intake and opened investigation.",
  "update_summary": "Status → Investigation; field visit scheduled.",
  "fields": { "resolution_summary": "..." }   // when transition.requires.fields
}
```

### 4.3 Validation (server)

Applied in addition to CD-04 transition guards:

- `action_taken_required` — non-empty `action_taken`
- `update_summary_required` — non-empty `update_summary`
- Existing: `transition_not_allowed`, `required_field_missing`, `confirmation_authority_required`, etc.

On success the engine writes:

1. `case_event` `status_changed` (visibility `public`) with `from_status`, `to_status`, `action_taken`, `update_summary`, `fields`, level/unit snapshot.
2. `case_event` `note_internal` when an effective note exists (visibility `internal`).
3. Notification outbox for `case.status_changed`.

### 4.4 Notifications on status change

| Audience | Mechanism | Config |
|---|---|---|
| **Complainant** | Rule `status-change-complainant` (`case.status_changed` → party) | CD-09 rules; can be disabled via `status_change_alerts.notify_complainant` |
| **Jurisdiction staff** | Synthetic rule from `status_change_alerts` | CD-09 → **Status change alerts** |

Staff alert defaults: role `grm_officer`, scope `case_unit`, channels `email` + `in_app`, template `case-status-changed-staff`.

Complainant channels respect party opt-in from intake (`party.notification_channels`) when set.

---

## 5. Assignment tab

### 5.1 Current officer panel

Shows assignee name, email, "Handling case" badge, and current workflow status. If unassigned: queue message referencing case unit/level.

### 5.2 Assignment history

Reverse-chronological list of `case_event` rows where `kind = assigned`, summarised as `Previous → New` officer names (resolved from staff directory + current assignee).

### 5.3 Assign form

Visible only when `available-actions` includes `{ type: "assign" }` (`case:assign`).

| Control | Behaviour |
|---|---|
| Officer dropdown | `GET /api/v1/cases/{id}/assignees` — active tenant users |
| **Assign case** / **Reassign case** | `POST …/actions { action: "assign", assignee_id }` |
| Disabled when | No selection, or selection equals current assignee |

On success: `case_event` `assigned`, `case.assigned` notifications to assignee, audit `case.assigned`.

---

## 6. Notifications tab

Table of `notification_log` rows for the case (loaded on first visit, refresh button).

Columns: sent time, event kind, recipient kind, channel, template id, delivery status (with attempt count / provider id), rendered preview.

Statuses include `queued`, `sent`, `sent:*`, `suppressed:*`, `failed:*` — see spec 06 §3.

---

## 7. Timeline tab

Full `case_event` list (oldest first in API; display order is presentation choice).

**Summary rendering:**

| Event kind | Summary pattern |
|---|---|
| `status_changed` | `{from} → {to} · Action: … · Updated: …` |
| `assigned` | `{from officer} → {to officer}` or `Assigned to …` / `Assignee cleared` |
| `note_internal` | Note body |
| Other | Kind label only |

Badges: `actorType` (staff / complainant / system), `internal` when `visibility = internal`.

---

## 8. CD-09 alert configuration (admin)

Two first-class toggles in **Notifications →** config editor (in addition to declarative rules).

### 8.1 Intake alerts (`intake_alerts`)

Fires on `case.created` — **staff only** (complainant ack remains rule `ack-on-create`).

```yaml
intake_alerts:
  enabled: true
  role: grm_officer
  scope: case_unit          # case_unit | unit_and_above | level | tenant
  channels: [email, in_app]
  template: case-intake-alert
```

Officers must have **role × unit assignment** under Admin → Users for selector resolution (spec 06 §1.2).

### 8.2 Status change alerts (`status_change_alerts`)

Fires on `case.status_changed` — **staff** via synthetic rule; **complainant** via existing rule unless `notify_complainant: false`.

```yaml
status_change_alerts:
  enabled: true
  role: grm_officer
  scope: case_unit
  channels: [email, in_app]
  template: case-status-changed-staff
  notify_complainant: true
  complainant_exclude_statuses: [Rejected]
```

Bundled templates (`case-intake-alert`, `case-status-changed-staff`) are auto-merged when referenced but missing from a tenant's saved config.

---

## 9. API surface (case detail)

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/api/v1/cases/{id}` | `case:read` | Case, complainant (PII), events |
| `GET` | `/api/v1/cases/{id}/available-actions` | `case:read` | Transitions + assign flag |
| `GET` | `/api/v1/cases/{id}/assignees` | `case:assign` | Staff picker list |
| `POST` | `/api/v1/cases/{id}/actions` | `case:transition` or `case:assign` | Atomic workflow ops |
| `GET` | `/api/v1/cases/{id}/notifications` | `case:read` | Notification log |

Administrators with `case:*` or `admin:*` may execute any transition allowed by CD-04 from the current status, regardless of transition `roles` (elevated workflow access).

---

## 10. Requirements traceability

| ID | Status | This document |
|---|---|---|
| GEN-CASE-03 | **Partial** | Timeline, available actions, notifications log — thread/tasks/SLA clocks deferred |
| GEN-CASE-05 | **Partial** | Assignment tab with history; transfer reason / collaborators deferred |
| GEN-NOT-01 | **Partial** | Declarative rules + `intake_alerts` / `status_change_alerts` toggles |
| GEN-WF-01 | **Partial** | Server-side transitions via action API (spec 04) |

---

## 11. Phase 2 — not yet implemented

Discuss before build:

| Item | Notes |
|---|---|
| **Thread** | External vs internal replies on case detail (GEN-CASE-03) — [spec 15](15-complainant-correspondence.md) |
| **Attachments / Documents** | Implemented — [spec 14](14-case-attachments-and-documents.md) |
| **SLA clocks** | At-risk/breach display on detail header or dedicated panel |
| **Transfer with reason** | Distinct from assign; may need new action type |
| **Field edit UI** | Audited before/after (GEN-CASE-04) |
| **Bulk status/assign** | Queue actions with per-case guard evaluation (GEN-CASE-06) |
| **Idempotency keys** | Safe retry on `POST …/actions` (spec 04 §2) |
| **Optimistic locking** | `version` / `updated_at` guard on concurrent edits |
| **Assignment notification to jurisdiction** | Notify previous unit officers on transfer? |
| **Template variables** | ~~`action_taken` / `update_summary` in complainant templates~~ — implemented (§12) |
| **In-app notification inbox** | Staff `in_app` channel delivery UI |

---

## 12. Decisions (implemented)

1. **Complainant templates include narrative** — `case.action_taken` and `case.update_summary` added to `TEMPLATE_VARIABLES`; `status-update` templates include `update_summary` (privacy-safe variant omits narrative).
2. **Intake alert scope** — default `unit_and_above` (KISIP-style broader ack); status-change staff alerts remain `case_unit`.
3. **Assignee list** — `GET …/assignees` returns only users with role assignments at the case unit or an ancestor; tenant-wide (`unit_id` null) included; suggests first officer at exact case unit when unassigned.
4. **Overview shortcuts** — Status and assignee link to Actions and Assignment tabs.
5. **Complainant exclusions** — `status_change_alerts.complainant_exclude_statuses` (default `['Rejected']`) suppresses complainant notifications for those transition targets.

---

*Cross-references: [04-workflow-engine.md](04-workflow-engine.md) · [06-notifications.md](06-notifications.md) · [07-security-access-control.md](07-security-access-control.md) · [10-requirements-catalogue.md](10-requirements-catalogue.md) · [14-case-attachments-and-documents.md](14-case-attachments-and-documents.md)*
