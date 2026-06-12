# 08 — Reporting, Dashboards & KPIs

Reporting works across tenants because metrics are computed on **semantic status tags** and the **jurisdiction tree**, not tenant-specific names.

## 1. Standard KPI set (platform-computed)

Doctrine KPIs (World Bank presentation + KUSP2 REP-07/08), available to every tenant out of the box:

| KPI | Definition |
|---|---|
| Cases registered | Count by period, channel, category, unit, priority, sensitivity (aggregate-only for sensitive) |
| Acknowledgement time | submitted → acknowledged (clock data); median/p90; % within target |
| First-response time | submitted → first outbound reply; % within target |
| Resolution time | submitted → `resolved` tag; % within target (e.g. ≤30 days) |
| % resolved / closed | by period and dimension |
| **% resolved within SLA** | per clock targets |
| Overdue / at-risk counts | live, by unit and assignee |
| Escalation rate | % of cases escalated ≥1 level; auto vs manual |
| Referral-out rate | by institution |
| Appeal rate / reopen rate | per closure cohort |
| **Complainant satisfaction** | satisfied / not satisfied / N-A-anonymous / no-response distribution |
| Anonymous share | % anonymous submissions |
| Repeat complainants | parties with >N cases (non-sensitive only) |
| Workload | open cases per assignee/team/unit; assignment latency |
| GRM access proxy | submissions per 1,000 target population per unit (population figures = tenant reference data, optional) |

Tenants set **targets** per KPI (CD-13); dashboards show actual vs target.

## 2. Configurable dashboards (CD-15)

Dashboards are **tenant-built configuration**, not code. The design generalizes the production `plus-admin` dynamic-dashboard system (`dashboard` → `dashboard_section` → `dashboard_card`/`dashboard_section_chart` rows, resolved at runtime against generic summary endpoints and rendered by a chart-type catalogue) and fixes its weaknesses.

### 2.1 Structure

```
dashboard (title, icon, audience, is_main, is_public, layout)
  └── section (title, icon, color, order)
        └── widget (kpi card | chart | table | map)
```

Each **widget** is a declarative definition:

| Field | Meaning | plus-admin equivalent |
|---|---|---|
| `dataset` | A named dataset from the **semantic layer** (§2.3), e.g. `cases`, `case_events`, `sla_clocks`, `satisfaction` | `card_model` (raw model name) |
| `measure` + `aggregation` | field + `count / count_distinct / sum / avg / min / max / pct` | `card_model_field` + `aggregation`, `unique`, `computation` |
| `group_by[]` | dimensions: category, status tag, unit (any hierarchy level), channel, priority, time bucket | `groupField`, `categorized` |
| `time_dimension` + `bucket` | for trend charts (`submitted_at`, `resolved_at`, …; day/week/month/quarter/year) | `time_field` |
| `metrics[]` | multiple measures for multi-series charts | `metric_fields` |
| `filters[]` | field/op/value conditions, combinable | `filters` JSONB + `filter_field/value/function/option` |
| `chart_kind` | from renderer catalogue: `kpi_card, bar, stacked_bar, stacked_bar_100, line, multi_line, area, pie, donut, treemap, map, table, pyramid` | integer `type` codes |
| `target` / `thresholds` | target value + warning bands, conditional coloring | (new) |
| `drill_down` | optional link to a saved queue view or child dashboard | dashboard card → list navigation |
| `caption` / `source_note` | localized footer text | hardcoded "National Slum Database" subtitle (now config) |

Dashboard-level config: `audience` (roles and/or jurisdiction levels), `is_main` (the post-login landing dashboard — at most one per audience), `is_public` (renders on the transparency page with extra constraints, §2.4), global filter bar (which dimensions viewers may filter: period, unit, category, phase).

### 2.2 Admin builder

Admin console screens (CRUD per config-governance rules in spec 02 §3): dashboard list, section editor, widget editor with **live preview** against real (scoped) data, drag-and-drop ordering/layout, duplicate-widget, and dashboard duplication across tenants via the config bundle. Widget definitions validate at save time: dataset exists, fields exist in the dataset, group-by dims are exposed by the dataset, chart kind supports the shape (e.g. `multi_line` requires `time_dimension` + `metrics[]`).

### 2.3 The semantic layer (governance — the key fix over plus-admin)

plus-admin's widgets post raw model/field names to generic summary endpoints (`/summary/byfield`, `/summary/group/multiple`), which will aggregate **any table in the schema** for any authenticated user, with location scoping left to the client. The generic platform instead exposes only **curated datasets**:

- A dataset = a platform-defined (versioned) view over the domain model: allowed measures, allowed dimensions, joins pre-resolved (e.g. `cases` exposes unit names at every hierarchy level), and **mandatory row-level security**: viewer's jurisdiction subtree + sensitivity clearance applied server-side on every query.
- Sensitive-class data appears only in `cases_sensitive_aggregate` (pre-aggregated, minimum cell size enforced) regardless of widget configuration.
- PII fields are never exposed as dimensions or measures.
- Query cost guards: max group-by cardinality, max time range, result row caps; per-widget result caching with explicit cache keys and TTL (keeps plus-admin's Redis-cache pattern, but server-managed).

### 2.4 Default dashboard pack & special dashboards

Shipped as config (tenant-editable copies of the structures below):

| Dashboard | Audience | Content |
|---|---|---|
| **Operational** | handlers/supervisors | My/team queues, overdue, at-risk, today's intake, aging buckets |
| **Management** | unit & programme managers | KPI tiles vs targets, trends, drill-down by unit subtree, category heatmap, escalation/appeal funnels |
| **Map view** (optional) | management | Case density / resolution performance on the unit tree's geo data |
| **Sensitive aggregate** | safeguards roles | Aggregate-only widgets per sensitivity policy |
| **Admin/ops** | administrators | Notification failures, channel health, config changes, audit highlights, retention runs (fixed platform widgets) |
| **Public transparency** (`is_public`) | public | Tenant-approved aggregate widgets only; anonymous-safe datasets; cached; no drill-down; no global filters beyond period/unit |

All dashboards respect jurisdiction scope and sensitivity clearance; drill-down stops where permission stops.

## 3. Reports & exports

- **Queue/list exports**: CSV/XLSX of any saved view, columns per export field policy (PII excluded by default; `case:export` + field policy gates).
- **Case file export**: single-case PDF dossier (details, timeline, thread, attachments list, signatures block) for audits/committees — replaces KISIP's ad-hoc PDF endpoints with one templated renderer (tenant-branded).
- **Scheduled reports**: definition (filters, dimensions, format, recipients, cadence); delivered via email with signed links; runs logged.
- **Standard regulator pack**: pre-built monthly/quarterly aggregate report templates (World Bank/ESS10-style), tenant-editable.
- **Data access for BI**: read-only replicated schema or warehouse export (CSV/Parquet), PII stripped/pseudonymized; documented dictionary (DEL-03).

## 4. Implementation notes

- Metrics computed from `case_event` + `sla_clock` streams (event-sourced facts) — no reliance on mutable case columns; nightly materialized aggregates + live counters for queue badges.
- The semantic-layer datasets (§2.3) read from these materialized aggregates where possible, falling back to live queries only for small scoped slices — so admin-built widgets cannot trigger unbounded scans.
- Dimension model: time × unit (tree rollup) × category × channel × priority × status tag × sensitivity (suppressed below cell minimum).
- Performance: dashboards within NFR targets (<3s) at 100k+ cases via pre-aggregation.
