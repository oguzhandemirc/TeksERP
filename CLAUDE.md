# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a full-stack **Textile ERP (TeksERP)** system for managing textile factory production. It consists of two projects:

- **`Teks-Erp/`** — Express 5 + Prisma 7 + PostgreSQL backend (port 4000)
- **`React/`** — React 19 + Vite + TypeScript frontend (port 5173)

## Commands

### Backend (`Teks-Erp/`)
```bash
npm run dev              # Start with nodemon (ts-node)
npm run build            # TypeScript compilation
npm run seed             # Seed database with test data
npm run prisma:generate  # Regenerate Prisma client after schema changes
npm run prisma:migrate   # Run migrations
npm run prisma:studio    # Open Prisma Studio GUI
```

### Frontend (`React/`)
```bash
npm run dev      # Vite dev server
npm run build    # tsc + Vite production build
npm run lint     # ESLint
npm run preview  # Preview production build
```

## Architecture

### Production Flow
The core business process flows linearly:
```
Inventory (Rolls) → Work Orders → Production (Stations/Machines) → Tambur (QC2) → Shipping
```

### Backend Architecture (`Teks-Erp/src/`)

Layered: **Routes → Controllers → Services → Prisma**

- `controllers/` — Request/response handlers; master data endpoints (items, customers, stations, etc.) use `BaseController` — no new code needed for basic CRUD
- `services/` — Business logic; `baseService` handles dynamic filtering/sorting/pagination → Prisma query conversion automatically
- `routes/` — REST endpoints grouped by domain; every route must have Swagger JSDoc comments
- `middlewares/` — JWT auth, RBAC (permission code per module e.g. `order:write`), global error handler
- `prisma/schema.prisma` — 23+ models, PostgreSQL via `@prisma/adapter-pg`. Key enums: `StationKind` (dispatches API behavior: `RAW_QC` / `PROCESS_QC` / `TAMBUR` / `SUBCONTRACTOR` / `PACKAGING` / `SHIPPING` / `OTHER`) and `RollOperationType` (per-roll log: `KURSUN_APPLIED`, `QC2_COMPLETED`, `TAMBUR_PROCESSED`, `PACKAGED`, `SUBCONTRACTOR_SENT`, `SUBCONTRACTOR_RETURNED`).

**Key conventions:**
- All models use UUID primary keys and `createdAt`/`updatedAt` timestamps
- Soft deletes only — use `isActive: false` or `RollStatus.SCRAP`; never physical DELETE
- Every CUD operation must call `AuditService.log()` → recorded in `SystemLog` table
- Zod v4 for all input validation; messages are in Turkish
- Swagger UI available at `http://localhost:4000/api-docs`
- Every Swagger endpoint must document: `summary`, `parameters`, `requestBody`, `responses` (200/201 + 400/401/500)

**API base routes:** `/api/auth`, `/api/items`, `/api/customers`, `/api/stations`, `/api/machines`, `/api/routes`, `/api/rolls`, `/api/orders`, `/api/work-orders`, `/api/production`, `/api/kursun-qc`, `/api/tambur`, `/api/shipping`, `/api/traveler-cards`, `/api/subcontractor`, `/api/swatches`

### Frontend Architecture (`React/src/`)

- `pages/` — 20+ feature modules (Auth, Dashboard, Items, Orders, Production, Tambur, Shipping, Reports, etc.)
- `components/` — Shared UI kit built on shadcn/ui (Radix-based), TanStack Table, Recharts
- `services/` — Axios-based API clients, one file per domain
- `hooks/` — `useDataTable`, `useCrudMutations`, `useRoleAccess` and others
- `store/` — Zustand stores for auth and theme
- `types/` — TypeScript interfaces mirroring backend Prisma models and enums

**State management split:**
- **Zustand** — user session (auth), UI preferences (theme)
- **TanStack React Query** — all server state; defaults: 1 retry, no refetch-on-focus, 5-minute stale time

**Forms:** React Hook Form + Zod v4 (same schemas as backend where possible)

**Path alias:** `@/*` → `./src/*` (configured in both `vite.config.ts` and `tsconfig.json`)

**Routing:** React Router DOM v7 with role-based route guards (`useRoleAccess` hook). Roles: `Admin`, `Tambur Operator`, `Shipping`.

**Tambur page** is mobile-first — a dedicated workflow for QC2 operators on handheld devices.

## Environment

**Frontend** (`.env`):
```
VITE_API_BASE_URL=http://localhost:4000
```

**Backend** (`.env`):
```
PORT=4000
DATABASE_URL="postgresql://postgres:4747@45.136.6.28:5432/TeksErpDb?schema=public"
JWT_SECRET="..."
```

## Known Version Gotchas

- **Zod v4:** `z.record()` requires two parameters — `z.record(z.string(), z.unknown())`, not one.
- **Express 5:** `req.params.id` may need `as string` cast in some controller patterns.
- **Prisma 7:** Run `npm run prisma:generate` after every schema change or the client will be stale.
- **`prisma.$transaction` + `pg` adapter:** Inside a `$transaction(async (tx) => ...)` block, **never** use `Promise.all` with `tx.*` calls. The tx client is a single pg connection — parallelism is illusory (pg serializes internally) and becomes a hard error in `pg@9`. Use sequential `await`. The backend ESLint config (`Teks-Erp/eslint.config.mjs`) catches regressions via `no-restricted-syntax`. `Promise.all` with top-level `prisma.*` (outside transactions) is fine — it uses the connection pool.

## Test Credentials (Seeded)

| User | Password | Role |
|------|----------|------|
| `admin` | `admin123` | Admin (full access) |
| `mehmet.planlama` | `test123` | Planlama |
| `veli.sevkiyat` | `test123` | Sevkiyat |

## Project Context

This is a real textile factory ERP. Key domain facts from `proje-aciklama.md`:

- **Phase 1 scope:** COM port integrations (scale/barcode machine automation) are **simulated only** — do not implement real hardware integration.
- **All current data is test data** — schema/API decisions should optimize for long-term correctness, not backwards compatibility with seeded rows.
- **Loom Monitoring:** A simple manual dashboard where operators log which pattern is running on which loom (`MachineLog` model). No automation.
- **Finance module** (`CurrentAccount`) exists in the schema as a future placeholder — do not build UI for it yet.
- **Traveler Card (Refakat Kartı):** A barcoded card generated when a work order is finalized; physically travels with the goods and triggers station processes when scanned.
- **Kurşun + QC2 = one physical station (`StationKind.PROCESS_QC`):** Modeled as ONE `WorkOrderStep`. Per-roll `RollOperation` log tracks `KURSUN_APPLIED` / `QC2_COMPLETED` — not every roll gets Kurşun. Operators self-select carts by scanning the Traveler Card; there is no depo queue or depo role.
- **Defect lifecycle:** `RollError` rows are opened at PROCESS_QC (`detectedAtStepId` / `detectedByUserId` / `detectedAt`) and closed at Tambur (`processedAtStepId` / `processedByUserId` / `processedAt` / `actionTaken`). `isProcessed = true` means Tambur has decided.
- **Fason return DOES NOT print new labels:** On `/api/subcontractor/receive`, the ORIGINAL dispatched rolls are updated in place with `newQty` (and optional `newWeight`), a `SUBCONTRACTOR_RETURNED` `RollOperation` captures the shrinkage, and each roll advances to the next step. Do NOT create new `Roll` records here.
- **Top/Roll allocation:** After Tambur, net rolls can be split across multiple orders (N:N via `OrderAllocation`) or put directly into stock. At Tambur, `CUT` decisions DO create a new child roll (`parentRollId` set, new barcode) — this is the only place roll-splitting happens.
- **Flexible shipping:** Goods reserved for customer A can be reassigned to customer B at shipping time by detaching the order link.
- **Frontend is for API testing only (Phase 1):** The React UI will be rebuilt later. Prioritize API correctness, clear JSON shapes, and Swagger docs over UI polish.

## Creating a New Module

Follow the 5-step pattern used throughout the codebase:
1. Add Prisma model + migration
2. Add backend route + controller + service
3. Add TypeScript types in `React/src/types/`
4. Add Axios service in `React/src/services/`
5. Add page under `React/src/pages/` using `useDataTable` + `useCrudMutations` hooks

See `.cursor/rules/create-new-module.mdc` for detailed step-by-step guidance.

## Frontend Code Rules

### TypeScript
- `any` usage is strictly forbidden — all types must sync with backend Prisma interfaces.
- Component props must always be defined with a TypeScript `interface`.
- Arrow function components only; no class components.

### API Client
- All API calls go through the configured Axios instance (`src/services/apiClient.ts`), never native fetch.
- Request interceptor adds `Authorization: Bearer [TOKEN]` from Zustand/localStorage automatically.
- Response interceptor catches `401`/`403` globally → redirects to `/login` with a toast.
- API errors (400-series business rule violations) must be caught and shown as human-readable toast messages.
- Always use typed generics: `axios.get<WorkOrder[]>(...)`.

### Role-Based Access (RBAC)
- All routes except `/login` are wrapped in `<ProtectedRoute>`.
- Role stored in Zustand auth state as `user.role`. Roles: `Admin`, `Tambur Operator`, `Shipping`.
  - `Admin` → full access.
  - `Tambur Operator` → locked to `/tambur` only; sidebar hidden.
  - `Shipping` → only `/shipping`.
- Hide UI elements per role inline: `{user.role === 'Admin' && <Button>Sil</Button>}`. Do not duplicate pages.

### Styling
- Tailwind CSS v4 utility classes only — avoid custom CSS files.
- Component library: shadcn/ui (Radix-based), Lucide React for icons.
- All transitions minimum `duration-200`; never instant state changes.
- Loading states: Skeleton UI for tables/panels, disabled + spinner for buttons during mutation.
- Success/error feedback via Sonner toasts with the backend's error message.

## Business UI Rules

### Order/Work Order Flow
- Orders display as a **Stepper** visualizing the route chain (Order → Subcontractor → Tambur → Shipping). The user must feel progression as route changes.

### Subcontractor (Fason) Return
- The "Fasondan Döndü" button must immediately open a required modal asking for the updated Kg/Metraj — the modal cannot be dismissed without filling in the field.

### Shipping Completion
- The Shipping page shows only packages/stock "Ready for Shipment", not work orders.
- When shipment is confirmed and `quantity === shippedQty`, the order turns green with a "COMPLETED" badge (stamp effect).

### Tambur Roll Split
- After "Kes" (SCRAP) triggers `Split Roll` API, the new scrap/A1 roll appears immediately in the table as a new row/card with its own barcode.

## Tambur Screen (Mobile-First)

- Target device: vertical tablet (iPad). Touch targets must be large: `h-16 text-xl p-4`.
- No decorative elements or small tables — show only what the operator needs to do next.
- Barcode scanner focus: capture input automatically on scan without manual submit.
- Scan feedback: green flash or toast on success, red on failure.
- QC decision UI: full-width swipe gesture or very large Yes/No buttons.
- After "Kes": lock the screen and show prominent "Etiket Yazdır" (Print Label) step until confirmed.
