# Kenya administrative units (KISIP)

Source spreadsheets in this folder. **Nothing here is auto-loaded into the database.**

| File | Purpose |
|------|---------|
| `county.xlsx` | 47 counties (`Name`, `Code`) |
| `subcounty.xlsx` | 290 sub-counties (`Name`, `Code`, `CountyId`) |
| `ward.xlsx` | 1,450 wards (`Name`, `Code`, `CountyId`, `SubcountyId`) |
| `settlement*.xlsx` | **1,034 settlements** — leaf rows with `CountyName`, `SubcountyName`, `WardName`, `Code`, `Isactive` |

## Build import workbook

```bash
pnpm build:kisip-units-template
```

Merges all four sources into the **current per-level import format**:

| Sheet | Rows (approx.) |
|-------|----------------|
| Instructions | — |
| National | 1 (Kenya) |
| County | 47 |
| Sub-county | 290 |
| Ward | 1,450 |
| Settlement | 1,034 |

Outputs:

- `kisip-units-import-template.xlsx` (this folder)
- `apps/api/data/kisip-units-import-template.xlsx` (API bundle for download)

## Import

1. Configure CD-02 hierarchy (5 levels — included in KISIP seed).
2. **Admin → Jurisdiction units → Download template** (KISIP: pre-filled workbook above).
3. Edit if needed, then **Import Excel**.

Non-KISIP tenants get a dynamic empty template from CD-02. Units are **not** written during `pnpm db:seed`.
