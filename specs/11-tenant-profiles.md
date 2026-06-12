# 11 — Worked Tenant Profiles

Proof of genericity: the two known programmes expressed purely as configuration of the same platform. (Abbreviated — full bundles would enumerate every template and unit.)

## 1. Tenant profile: KISIP (informal settlements programme)

```yaml
tenant:
  code: kisip
  name: "Kenya Informal Settlements Improvement Project"
  locales: [en, sw]
  deployment: dedicated   # gov-hosted, own DB

hierarchy:
  levels: [settlement, county, national]      # rank 1..3
  flags:
    settlement: {is_intake_default: true}
    national:   {is_confirmation_authority: true}
  units: {import: kisip_units.csv}            # settlements, 47 counties, 1 national

taxonomy:
  case_types: [grievance, incident]           # incident = separate workflow (safety)
  categories: [land, evictions, compensation, infrastructure, drainage, water,
               sanitation, electricity, waste, environmental, health_safety,
               corruption, discrimination, gbv, labour, information_gap, delays, other]
  category_overrides:
    gbv:        {sensitivity: gbv_seah}
    corruption: {sensitivity: corruption}
  priorities: [normal, high, emergency]
  custom_fields:
    - {key: project_phase, type: select, list: [KISIP 1, KISIP 2], default: KISIP 2}
    - {key: in_court, type: boolean}

workflow: # statuses & transitions as spec 02 §4 example
  initial:
    default: Sorting
    rules:
      - {if: {field: in_court}, then: In Court}
      - {if: {sensitivity: gbv_seah}, then: {status: Sorting, level: national}}
  closure:
    confirmation: {required_when: {resolved_below: national}, authority_level: national}
    satisfaction: {enabled: true, channels: [sms]}
  appeal: {enabled: true, window_days: 30, routes_to: next_level}

sla:
  plans:
    standard: {stage: {Sorting: 7d, Investigation: 14d, Escalated: 14d, Resolved: 21d}}
  calendar: kenya_holidays
  escalation_rules: [overdue-auto-escalate, dissatisfaction-appeal]

channels:
  web: {enabled: true, captcha: true, anonymous: allowed_via_toggle}
  assisted: {enabled: true}
  sms: {enabled: true, provider: advanta, sender_id: KISIP}
  ussd: {enabled: false}
  hotline: {enabled: false}
  chatbot: {enabled: false}

ai_assistance:   # KISIP already runs a document-AI service; formalized under CD-16 governance
  enabled: true
  provider: {kind: openai, profile: kisip_openai, pii_redaction: true}
  capabilities: {kb_answer_assist: true, summarization: true, auto_categorization: false}

numbering: {pattern: "GRM-{YYYY}-{seq:4}", scope: yearly}

notifications:
  rules: default_pack
  overrides:
    - {on: case.status_changed, condition: {to_status: Referred}, to: [], note: "no complainant SMS on internal referral"}

roles:
  grm_officer:        {permissions: [case:*, thread:*, attachment:*], sensitive: []}
  gbv_officer:        {inherits: grm_officer, sensitive: [gbv_seah]}
  county_admin:       {inherits: grm_officer, extra: [report:view_operational]}
  national_grm:       {inherits: grm_officer, extra: [case:confirm_resolution]}
  # scoping done per assignment: role × unit (settlement/county/national subtree)

committees:
  enabled: true
  defs: [{level: settlement, name: SEC}, {level: settlement, name: GRC}]
  workflow_bindings: []   # rosters only (current KISIP practice)
```

**Migration notes (from `plus-admin`):** map statuses 1:1 (they keep their names); legacy `grievance_log` + `grievance_history` → `case_event` stream; `grievance_notification` → `notification_log`; `isgbv` → sensitivity class; settlement/county/ward/subcounty FKs → unit tree references; encrypted name/national_id re-encrypted under app-layer keys; legacy `GRM-YYYY-####` references preserved.

## 2. Tenant profile: KUSP2 (urban programme)

```yaml
tenant:
  code: kusp2
  name: "Second Kenya Urban Support Programme"
  locales: [en, sw]
  deployment: dedicated   # gov-hosted preferred (Appendix C Option A)

hierarchy:
  levels: [municipality, county, national]
  flags:
    municipality: {is_intake_default: true}
    national: {is_confirmation_authority: false}   # KUSP2 uses supervisory approval instead
  units: {import: kusp2_units.csv}                 # 79 municipalities, 45 counties, NPCT

taxonomy:
  case_types: [grievance]
  categories: [environmental, social, gbv_seah, corruption_fraud,
               project_implementation, institutional_policy, other]
  category_overrides:
    gbv_seah:         {sensitivity: gbv_seah}
    corruption_fraud: {sensitivity: corruption}
  priorities: [low, normal, high, emergency]
  expected_outcomes: [information, corrective_action, compensation, accountability, other]

workflow:
  statuses:
    - {name: Open/Pending,                tag: open}
    - {name: Awaiting Complainant Info,   tag: on_hold, pauses: [resolution, stage]}
    - {name: Under Investigation,         tag: in_progress}
    - {name: Action in Progress,          tag: in_progress}
    - {name: Escalated,                   tag: in_progress}   # level shown via current_level
    - {name: Referred,                    tag: in_progress}
    - {name: Resolved,                    tag: resolved}
    - {name: Closed,                      tag: closed}
  closure:
    confirmation: {required_when: never}
    supervisory_approval: {when: {priority_gte: high}, or: {sensitivity: any_nonstandard}, or: {escalated: true}}
    checklist: [resolution_summary, complainant_informed, satisfaction_captured]
    satisfaction: {enabled: true, channels: [sms, portal, staff_capture]}
  appeal: {enabled: true, routes_to: next_level, max_rounds: 2}

sla:
  plans:
    standard:
      acknowledge: immediate          # auto-ack on intake
      first_response: 14d_working
      resolve: 30d_working
  calendar: kenya_holidays
  reminders: [{at: T-2d, to: assignee}]
  escalation_rules: [overdue-auto-escalate, dissatisfaction-appeal, emergency-priority]

channels:
  web: {enabled: true, captcha: true, anonymous: allowed, accounts: optional}
  assisted: {enabled: true, scripts: kusp2_intake_scripts}
  email: {outbound: true, inbound: true}
  sms: {enabled: when_gateway_ready}
  ussd: {enabled: when_gateway_ready, min_fields: [unit, summary, category]}
  hotline: {enabled: when_gateway_ready}
  chatbot: {enabled: false}            # FR-PUB-15 prohibits chatbot intake

ai_assistance: {enabled: false}        # CD-16 stays off for KUSP2

numbering: {pattern: "{unit_code}-{YYYY}-{seq:5}", scope: per_unit_yearly}

roles:   # six training tracks → role templates
  administrator: {permissions: [admin:*]}
  supervisor:    {permissions: [case:*, report:*, appeal:decide]}
  grm_handler:   {permissions: [case:read, case:transition, thread:*, task:*]}
  intake_agent:  {permissions: [case:create_assisted, case:read]}
  me_analyst:    {permissions: [report:*], pii: none}
  seash_focal:   {inherits: grm_handler, sensitive: [gbv_seah]}

referral_directory: [CAJ_Ombudsman, EACC, NEMA, gbv_service_providers, world_bank_grs]
reporting:
  kpi_targets: {first_response_days: 14, resolution_days: 30}
  transparency_page: {enabled: true, aggregates: [received, resolved, avg_resolution_days, by_county]}
```

## 3. What the two profiles demonstrate

| Variation | KISIP | KUSP2 | Platform mechanism |
|---|---|---|---|
| Hierarchy | settlement/county/national | municipality/county/national | CD-02 unit tree |
| Closure control | national confirmation | supervisory approval + checklist | CD-04 closure policy |
| SLA style | per-stage durations | ack/response/resolution targets | CD-05 plan types |
| Primary channel | SMS-first | web/email-first, telecom staged | CD-08 + CD-09 |
| Referral notice to complainant | suppressed | standard | notification rule condition |
| Numbering | global yearly `GRM-YYYY-####` | per-unit yearly | CD-07 pattern |
| Sensitive routing | GBV → national | GBV → SEA/SH focals at any level | sensitivity class policy |
| Committees | rosters only | not used (departments/teams) | CD-11 feature flag |

A third hypothetical client (corporate external GRM à la Cassava: 2-day ack, 30-day resolve, GRC committee escalation, anonymous hotline) is expressible with the same domains — no new code paths.
