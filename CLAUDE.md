# TeksERP — Monorepo Root

Textile factory ERP system. Two sub-projects:

| Project | Stack | Port |
|---|---|---|
| `Teks-Erp/` | Express 5 + Prisma 7 + PostgreSQL | 4000 |
| `React/` | React 19 + Vite + TypeScript | 5173 |

Each sub-project has its own `CLAUDE.md` with detailed guidance.

## Production Flow

```
Inventory (Rolls) → Work Orders → Production (Stations/Machines) → Tambur (QC2)
  → Depo (RollStatus.WAREHOUSE) → Tartı/Paket → Shipping
```

Tambur'dan çıkan top **kesinlikle önce depoya** geçer (`status=WAREHOUSE`).
Depo bir istasyon değil, tartı/paket öncesi bekleme statüsüdür. Tartı/paket
operatörü depodan çekip tartar + paketler; rulo doğrudan `READY_FOR_SHIP`
olur — sevkiyatta tekrar barkod okutulmaz.

## Domain Facts

- **Phase 1:** COM port / hardware integrations are simulated only — never implement real hardware.
- **All data is test data** — optimize for long-term correctness, not backwards compat with seeded rows.
- **Work order flexibility:** A work order can link to multiple orders OR be produced for stock without any order. Shipping an order does NOT require a work order — stock can be shipped directly.
- **Order completion trigger:** When a shipment is confirmed, if `shippedQty >= quantity` the order status MUST auto-update to `COMPLETED`; otherwise `PARTIAL_SHIPPED`.
- **Traveler Card (Refakat Kartı):** Barcoded card generated when a work order is finalized; physically travels with goods and triggers station processes when scanned.
- **Kurşun + QC2 = one physical station (`StationKind.PROCESS_QC`):** Modeled as ONE `WorkOrderStep`. Per-roll `RollOperation` log tracks `KURSUN_APPLIED` / `QC2_COMPLETED` — not every roll gets Kurşun.
- **Defect lifecycle:** `RollError` opened at PROCESS_QC, closed at Tambur (`isProcessed = true`).
- **Fason return:** Original rolls' status transitions in place (no new `Roll` records). Qty/weight is **NOT** measured at receipt — next station's `FINISH` records it via `RollMovement`.
- **Roll split:** Only happens at Tambur (`CUT` decision) — creates child roll with `parentRollId` + new barcode.
- **Flexible shipping:** Goods can be reassigned from customer A to B at shipping time. **EXCEPTION:** if `Roll.ownerCustomerId` is set (SERVICE_PRODUCTION — customer brought their own goods), it can NEVER be reassigned to another customer.
- **Finance module (`CurrentAccount`):** Schema placeholder only — no UI.
- **Loom Monitoring:** Manual dashboard only, no automation.

## Shared Conventions

- UUID primary keys, `createdAt`/`updatedAt` on all models.
- Soft deletes only — `isActive: false` or `RollStatus.SCRAP`; never physical DELETE.
- Every CUD operation → `AuditService.log()` → `SystemLog` table.
- Validation error messages in Turkish.

## Test Credentials

Most-used: `admin` / `admin123` (full access). All 6 seeded users (planning, production, quality, sales, shipping operators) listed in `Teks-Erp/ARCHITECTURE.md §13`. All non-admin users use password `test123`.
