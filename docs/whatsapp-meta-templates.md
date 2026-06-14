# WhatsApp Meta message templates (KISIP / eGRM)

Reference for creating and wiring **approved Meta Business Manager templates** to CD-09 notifications.

**Status:** work in progress — check off templates as you submit and approve them in Meta, then configure matching names in Console → Config → Notifications.

---

## Prerequisites

| Item | Where |
|------|--------|
| Meta WhatsApp Business account | [business.facebook.com](https://business.facebook.com) |
| Phone number ID (numeric) | WhatsApp → API Setup |
| Bearer token | CD-09 → Senders → WhatsApp → Authorization header |
| Portal tracking base URL | API env `PUBLIC_PORTAL_BASE_URL` (not `localhost` in production) |

**Category for all templates below:** Utility (transactional updates).

**Language:** `en_US` unless you add Swahili variants (`sw` / `sw_KE`).

### Meta rules (avoid rejection)

- Use enough **fixed text** per variable (Meta rejects “too many variables for length”).
- Do **not** start or end the body on a variable — add trailing text like `Thank you.`
- Template **names** in Meta must match CD-09 **exactly** (lowercase, underscores).
- Do **not** use `hello_world` in production (sandbox only).

---

## CD-09 configuration (Console)

**Path:** Console → Config → `cd09_notifications`

### Sender (WhatsApp)

| Field | Value |
|-------|--------|
| Provider | Meta Cloud API |
| Phone number ID | Numeric ID from Meta API Setup |
| Default Meta template | `kisip_case_registered` (fallback) |
| Default template language | `en_US` |
| Default body parameters | `party.name, case.reference, tenant.name, tracking.url` |

### Per notification template (WhatsApp channel)

For each row in [Template mapping](#template-mapping), set on the **WhatsApp** variant:

- **Meta template** — template name from Meta
- **Template language** — `en_US`
- **Body parameters** — comma-separated keys (order = Meta `{{1}}`, `{{2}}`, …)

The **body** text in CD-09 is for preview/logs; Meta delivery uses the approved template + parameters.

### Variable reference

| CD-09 key | Typical value |
|-----------|----------------|
| `party.name` | Complainant name (falls back to `Complainant`) |
| `case.reference` | e.g. `GRM-2026-001234` |
| `tenant.name` | e.g. `KISIP GRM` |
| `tenant.short_name` | e.g. `KISIP` |
| `case.status_label` | e.g. `Under review` |
| `tracking.url` | Full portal track link |

---

## Template mapping

| CD-09 template ID | Notification rule / event | Meta template name | Body parameters |
|-------------------|---------------------------|--------------------|-----------------|
| `case-registered` | Ack on `case.created` | `kisip_case_registered` | `party.name, case.reference, tenant.name, tracking.url` |
| `case-registered-privacy` | Privacy ack on create | `kisip_case_registered` | same |
| `status-update` | Status change to complainant | `kisip_status_update` | `party.name, case.reference, tenant.name, case.status_label` |
| `status-update-privacy` | Privacy status update | `kisip_status_update_privacy` | `party.name, case.reference` |
| `case-closed` | `case.closed` | `kisip_case_closed` | `party.name, case.reference, tenant.name` |
| `satisfaction-request` | `case.resolved` | `kisip_satisfaction_request` | `party.name, case.reference, tenant.name, tracking.url` |
| `more-info-request` | *(template ready; rule TBD)* | `kisip_more_info_needed` | `party.name, case.reference, tenant.name, tracking.url` |
| `thread-message-outbound` | Staff thread message | `kisip_new_message` | `party.name, case.reference, tenant.name, tracking.url` |

### Not required for WhatsApp today (email / in-app only)

- `case-assigned`, `case-at-risk`, `sla-breached`, `case-escalated`, `appeal-opened`, `thread-message-inbound`
- Intake alerts and status-change staff alerts

---

## Meta template bodies (copy-paste)

Submit each block in Meta → WhatsApp → Message templates. Use the sample values when Meta asks for examples.

---

### 1. `kisip_case_registered` — intake acknowledgement

**Priority:** Required first.

**Body:**
```
Hello {{1}}, 
Your grievance reference {{2}} has been registered with {{3}}. You may track progress and view status updates at any time using this link: {{4}} Thank you.
```

**Sample values:**

| Var | Sample |
|-----|--------|
| {{1}} | Jane |
| {{2}} | GRM-2026-001234 |
| {{3}} | KISIP GRM |
| {{4}} | https://grm.kisip.go.ke/track?ref=GRM-2026-001234 |

- [ ] Submitted to Meta
- [ ] Approved
- [ ] Configured in CD-09

---

### 2. `kisip_status_update` — status change (standard)

**Body:**
```
Hello {{1}}, 
We have an update on your grievance reference {{2}} with {{3}}. The current status is now: {{4}}. Please log in to the portal for full details. Thank you.
```

**Sample values:**

| Var | Sample |
|-----|--------|
| {{1}} | Jane |
| {{2}} | GRM-2026-001234 |
| {{3}} | KISIP GRM |
| {{4}} | Under review |

- [ ] Submitted to Meta
- [ ] Approved
- [ ] Configured in CD-09 (`status-update`)

---

### 3. `kisip_status_update_privacy` — status change (privacy-safe)

**Body:**
```
Hello {{1}}, 
There has been a status update on your grievance reference {{2}}. Please check the KISIP GRM portal for details. Thank you.
```

**Sample values:**

| Var | Sample |
|-----|--------|
| {{1}} | Jane |
| {{2}} | GRM-2026-001234 |

- [ ] Submitted to Meta
- [ ] Approved
- [ ] Configured in CD-09 (`status-update-privacy`)

---

### 4. `kisip_case_closed` — case closed

**Body:**
```
Hello {{1}}, 
Your grievance reference {{2}} with {{3}} has been closed. Thank you for using our grievance redress service.
```

**Sample values:**

| Var | Sample |
|-----|--------|
| {{1}} | Jane |
| {{2}} | GRM-2026-001234 |
| {{3}} | KISIP GRM |

- [ ] Submitted to Meta
- [ ] Approved
- [ ] Configured in CD-09 (`case-closed`)

---

### 5. `kisip_satisfaction_request` — satisfaction survey

**Body:**
```
Hello {{1}}, 
Your grievance reference {{2}} with {{3}} has been resolved. Please rate our handling using this link: {{4}} Thank you.
```

**Sample values:**

| Var | Sample |
|-----|--------|
| {{1}} | Jane |
| {{2}} | GRM-2026-001234 |
| {{3}} | KISIP GRM |
| {{4}} | https://grm.kisip.go.ke/track?ref=GRM-2026-001234 |

- [ ] Submitted to Meta
- [ ] Approved
- [ ] Configured in CD-09 (`satisfaction-request`)

---

### 6. `kisip_more_info_needed` — request more information

**Body:**
```
Hello {{1}}, 
We need additional information to progress your grievance reference {{2}} with {{3}}. Please reply or visit this link: {{4}} Thank you.
```

**Sample values:**

| Var | Sample |
|-----|--------|
| {{1}} | Jane |
| {{2}} | GRM-2026-001234 |
| {{3}} | KISIP GRM |
| {{4}} | https://grm.kisip.go.ke/track?ref=GRM-2026-001234 |

- [ ] Submitted to Meta
- [ ] Approved
- [ ] Configured in CD-09 (`more-info-request`)

---

### 7. `kisip_new_message` — new thread message from staff

**Body:**
```
Hello {{1}}, 
You have a new message regarding your grievance reference {{2}} from {{3}}. Read and reply using this link: {{4}} Thank you.
```

**Sample values:**

| Var | Sample |
|-----|--------|
| {{1}} | Jane |
| {{2}} | GRM-2026-001234 |
| {{3}} | KISIP GRM |
| {{4}} | https://grm.kisip.go.ke/track?ref=GRM-2026-001234 |

- [ ] Submitted to Meta
- [ ] Approved
- [ ] Configured in CD-09 (`thread-message-outbound`)

---

## Optional Swahili variants

Create as separate **language** entries in Meta (same template name, language `sw` or `sw_KE`). Update CD-09 `wa_template_language` on Swahili (`sw`) variants when used.

| Meta name | Language | Body |
|-----------|----------|------|
| `kisip_case_registered` | `sw` | `Habari {{1}}, rejeleo la malalamiko {{2}} limepokelewa na {{3}}. Fuatilia hapa: {{4}} Asante.` |
| `kisip_status_update` | `sw` | `Habari {{1}}, kuna taarifa kuhusu malalamiko {{2}} na {{3}}. Hali sasa ni: {{4}}. Tembelea portal kwa maelezo zaidi. Asante.` |
| `kisip_case_closed` | `sw` | `Habari {{1}}, malalamiko {{2}} na {{3}} yamefungwa. Asante kwa kutumia huduma yetu.` |
| `kisip_new_message` | `sw` | `Habari {{1}}, una ujumbe mpya kuhusu malalamiko {{2}} kutoka {{3}}. Soma na jibu hapa: {{4}} Asante.` |

---

## Testing

From repo root (API running, CD-09 saved with token in DB):

```bash
# Template send (default: kisip_case_registered from active CD-09)
node apps/api/scripts/test-wa-post.mjs 2547XXXXXXXX

# Named template
node apps/api/scripts/test-wa-post.mjs 2547XXXXXXXX kisip_status_update

# Plain text (24h session window only)
node apps/api/scripts/test-wa-post.mjs 2547XXXXXXXX --text
```

Replace `2547XXXXXXXX` with E.164 digits (no `+`).

Ensure `NOTIFICATIONS_DEV_LOG_ONLY=0` in `apps/api/.env` for real sends.

---

## Rollout checklist

1. [ ] Create & approve `kisip_case_registered` in Meta
2. [ ] Create & approve `kisip_status_update` in Meta
3. [ ] Configure CD-09 sender + template mappings in Console; publish config
4. [ ] Set `PUBLIC_PORTAL_BASE_URL` on Railway API
5. [ ] Test intake case → WhatsApp delivered
6. [ ] Add remaining templates (`closed`, `satisfaction`, `new_message`, …) as needed
7. [ ] Optional: Swahili language variants

---

## Related code

| Area | Path |
|------|------|
| CD-09 schema & defaults | `packages/config-schemas/src/cd09-notifications.ts` |
| Meta send (template / text) | `packages/notifications/src/whatsapp.ts` |
| Param resolution | `apps/api/src/services/notification-dispatch.ts` → `whatsappSendOptions()` |
| Console editor | `apps/console/app/components/config/NotificationsEditor.vue` |
| Test script | `apps/api/scripts/test-wa-post.mjs` |

Spec reference: notifications spec 06 (CD-09).
