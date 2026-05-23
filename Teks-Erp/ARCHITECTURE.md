# TeksERP — Backend Mimari ve Performans Referansı

> Bu dosya `CLAUDE.md`'nin uzun-form referansıdır. CLAUDE.md sözleşmedir, bu dosya kütüphane.
> Schema değiştiğinde / yeni endpoint eklendiğinde / pattern güncellendiğinde bu dosya da güncellenmelidir.

---

## 1. Tech Stack

| Katman | Teknoloji | Not |
|---|---|---|
| Runtime | Node.js | — |
| Dil | TypeScript (strict) | `any` yasak |
| Framework | Express 5 | `req.params.id` bazen `as string` ister |
| ORM | Prisma 7 + `@prisma/adapter-pg` | Şema değişince `prisma:generate` zorunlu |
| Veritabanı | PostgreSQL | — |
| Auth | JWT (`jsonwebtoken` + `bcryptjs`) | — |
| Validasyon | Zod 4 | `z.record(z.string(), z.unknown())` — iki arg |
| Docs | `swagger-jsdoc` + `swagger-ui-express` | `/api-docs` |
| Güvenlik | `helmet`, `cors` | — |
| Loglama | `morgan` | — |

---

## 2. Dizin Yapısı

```
Teks-Erp/
├── prisma/
│   ├── schema.prisma          # 38 model, 13 enum
│   ├── seed.ts                # Test verisi (6 kullanıcı)
│   └── migrations/
│
├── src/
│   ├── server.ts              # Entry point
│   ├── app.ts                 # Express app + route kayıtları
│   │
│   ├── config/
│   │   └── swagger.ts         # OpenAPI 3.0
│   │
│   ├── lib/
│   │   └── prisma.ts          # PrismaClient singleton (pg adapter)
│   │
│   ├── middlewares/
│   │   ├── auth.middleware.ts  # verifyToken → req.user
│   │   ├── rbac.middleware.ts  # requirePermission, requireAnyPermission
│   │   └── error.middleware.ts # AppError + Prisma error mapping + Zod
│   │
│   ├── controllers/           # 12 dosya — HTTP layer
│   ├── services/              # 17 dosya — iş mantığı
│   ├── routes/                # 21 dosya — Swagger JSDoc + middleware
│   │
│   ├── types/
│   │   ├── api.types.ts       # ApiResponse, PaginatedResponse, JwtPayload
│   │   └── express-augment.ts # Request.user
│   │
│   └── utils/
│       ├── app-error.ts       # 400/401/403/404/409/500
│       └── query-parser.ts    # URL → Prisma where/orderBy/skip/take
│
├── eslint.config.mjs           # tx içinde Promise.all yasağı dahil
├── prisma.config.ts
└── package.json
```

---

## 3. Layered Architecture

```
Routes  →  verifyToken → requirePermission → controller method
            (JWT)         (yetki kontrolü)
                                  ↓
Controllers → Zod validate → service.method() → res.json()

Services  → İş kuralları + Prisma queries + transaction + AuditService.log()

Prisma    → src/lib/prisma.ts (singleton, pg adapter)
```

**Katman kuralı:** Hiçbir katman alt katmanı atlamamalı. Route, Service'i doğrudan çağırmaz. Controller, prisma'yı doğrudan çağırmaz.

---

## 4. Schema — 38 Model + 13 Enum

### Modeller (gruplandırılmış)

| Grup | Modeller | Adet |
|---|---|---|
| RBAC | User, Role, Permission, UserRole, RolePermission | 5 |
| Master Data | Station, Machine, Route, RouteStep | 4 |
| Item & Variant | Item, ItemVariant, CustomerVariantAlias | 3 |
| Inventory | Roll, RollMovement, RollOperation | 3 |
| Sales | Customer, CustomerBranch, Order, OrderLine | 4 |
| Production | WorkOrder, WorkOrderStep, WorkOrderToOrderLine | 3 |
| Quality | QualityGrade, DefectType, RollError | 3 |
| Logistics | OrderAllocation, Shipment, ShipmentItem | 3 |
| Subcontractor | SubcontractorDispatch, SubcontractorDispatchItem, SubcontractorReceipt, SubcontractorReceiptItem | 4 |
| Documents | TravelerCard, TravelerCardScan, Manifest, Swatch | 4 |
| Finance / Logs | CurrentAccount, MachineLog | 2 |
| Audit | SystemLog | 1 |
| **TOPLAM** | | **38** |

### Enum'lar

| Enum | Değerler |
|---|---|
| `StationType` | INTERNAL, EXTERNAL |
| `StationKind` | RAW_QC, PROCESS_QC, TAMBUR, SUBCONTRACTOR, OTHER (paket/sevkiyat istasyon değildir — fulfillment akışı) |
| `RollOperationType` | KURSUN_APPLIED, QC2_COMPLETED, TAMBUR_PROCESSED, PACKAGED, SUBCONTRACTOR_SENT, SUBCONTRACTOR_RETURNED |
| `ItemType` | YARN, WARP, RAW_FABRIC, DYED_FABRIC, CONSUMABLE |
| `RollStatus` | STOCK, IN_PRODUCTION, PRODUCED, READY_FOR_SHIP, SHIPPED, SCRAP, AT_SUBCONTRACTOR, A1_STOCK, RETURNED_FROM_SUBCONTRACTOR, WAREHOUSE |
| `CompanyType` | CUSTOMER, SUPPLIER, SUBCONTRACTOR, DYEHOUSE |
| `OrderStatus` | PENDING, APPROVED, IN_PRODUCTION, PARTIAL_SHIPPED, COMPLETED, CANCELLED |
| `WorkOrderType` | ORDER_PRODUCTION, STOCK_PRODUCTION, SERVICE_PRODUCTION |
| `WorkOrderStatus` | PLANNED, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED |
| `StepStatus` | PENDING, ACTIVE, COMPLETED, SKIPPED |
| `ShipmentStatus` | PREPARING, SHIPPED, CANCELLED |
| `TravelerCardStatus` | ACTIVE, REPRINTED, VOIDED, COMPLETED |
| `ScanType` | ARRIVAL, DEPARTURE, INFO |

### Schema Kuralları

- **PK:** Tüm modellerde `String @id @default(uuid())`
- **Timestamps:** `createdAt` + `updatedAt` her modelde zorunlu (join tabloları hariç)
- **Soft delete:** Fiziksel DELETE yok — `isActive: false` veya status değişikliği
- **Audit:** Her CUD `SystemLog`'a yazılır → `AuditService.log()` üzerinden
- **`StationKind`** — istasyon **domain rolü**; API davranışını dispatch eder (PROCESS_QC için Kurşun+QC2 akışı vb.)

### Roll Yaşam Döngüsü

```
STOCK ─┬─→ IN_PRODUCTION ─→ AT_SUBCONTRACTOR ─→ RETURNED_FROM_SUBCONTRACTOR ─┐
       │                                                                       │
       └─────────────────────────────────────────────→ IN_PRODUCTION (TAMBUR)─┤
                                                                              ↓
                                                ┌──── SCRAP / A1_STOCK (Tambur kesim)
                                                ↓
                                            WAREHOUSE  (depo — tartı/paket bekliyor)
                                                ↓
                                        READY_FOR_SHIP  (tartı/paket tamamlandı)
                                                ↓
                                             SHIPPED
```

`PRODUCED` statüsü artık yalnızca yedek/legacy yol içindir — normal akışta
Tambur sonrası top doğrudan `WAREHOUSE`'a düşer ve paketleme sonrası
`READY_FOR_SHIP` olur.

---

## 5. API Endpoint Haritası

### Public (auth gerekmez)

| Method | Endpoint | Not |
|---|---|---|
| POST | `/api/auth/login` | JWT döndürür |
| GET | `/health` | Health check |

### Master Data (BaseController CRUD)

| Endpoint | Permission |
|---|---|
| `/api/items` (+`/api/items/:itemId/variants`) | `item:read` / `item:write` |
| `/api/customers` | `customer:read` / `customer:write` |
| `/api/stations` (+`/api/machines`) | `station:read` / `station:write` |
| `/api/routes` | `station:read` / `station:write` |

### Envanter

| Endpoint | Permission |
|---|---|
| `GET /api/rolls`, `/api/rolls/:id`, `/api/rolls/barcode/:barcode`, `/api/rolls/:id/history` | `roll:read` |
| `POST /api/rolls/initial-entry`, `DELETE /api/rolls/:id` | `roll:write` |

### Planlama / Üretim

| Endpoint | Permission |
|---|---|
| `/api/orders` (CRUD) | `order:read` / `order:write` |
| `/api/work-orders` (+ `/attach-rolls`, `/detach-rolls`, `/lock`, `/manifest`, `/travel-card`, `/rolls`, `/shipments`) | `workorder:read` / `workorder:write` |
| `/api/production/active-steps`, `/step-info` | `workorder:read` |
| `/api/production/step-action` | `roll:write` |
| `/api/production/report-error` | `quality:write` |
| `/api/kursun-qc/*` | `quality:read` / `quality:write` |
| `/api/tambur/*` | `quality:read` / `quality:write` |
| `/api/packaging/*` | `roll:read` / `roll:write` |
| `/api/service-production/*` | `roll:read` / `roll:write` |

### Sevkiyat / Lojistik

| Endpoint | Permission |
|---|---|
| `/api/shipping/ready-orders`, `/ready-fason`, `/shipments` (CRUD + `/finalize`, `/print`, `/add-items`) | `shipment:read` / `shipment:write` |
| `/api/subcontractor/dispatches`, `/receipts` | `workorder:read` / `workorder:write` |

### Dokümanlar / Master

| Endpoint | Permission |
|---|---|
| `/api/traveler-cards/*` | `workorder:read` / `workorder:write` |
| `/api/swatches` | `quality:read` |
| `/api/defect-types`, `/api/quality-grades` | `quality:read` / `quality:write` |

Swagger UI: **http://localhost:4000/api-docs** — her endpoint için `summary`, `parameters`, `requestBody`, `responses` (200/201 + 400/401/500) zorunlu.

---

## 6. RBAC Permission Kodları

`requirePermission(code)` middleware'i `req.user.permissions[]` array'ini kontrol eder. Toplam **20 permission**, 6 modül.

| Modül | Permissions |
|---|---|
| SALES | `order:read`, `order:write`, `customer:read`, `customer:write` |
| PRODUCTION | `workorder:read`, `workorder:write`, `roll:read`, `roll:write`, `station:read`, `station:write` |
| MASTER_DATA | `item:read`, `item:write` |
| QUALITY | `quality:read`, `quality:write` |
| LOGISTICS | `shipment:read`, `shipment:write`, `allocation:write` |
| ADMIN | `admin:users`, `admin:roles`, `admin:settings` |

### Rol → Permission Atamaları

| Rol | Permissions |
|---|---|
| Admin | TÜM 20 permission |
| Planlama Şefi | `workorder:read/write`, `roll:read/write`, `station:read`, `item:read/write`, `order:read`, `allocation:write` |
| Üretim Operatörü | `workorder:read`, `roll:read/write`, `station:read`, `item:read` |
| Kalite Kontrol | `quality:read/write`, `roll:read/write`, `workorder:read`, `item:read` |
| Satış Temsilcisi | `order:read/write`, `customer:read/write`, `item:read` |
| Sevkiyatçı | `shipment:read/write`, `order:read`, `roll:read`, `item:read` |

### Yeni Endpoint Yazarken

Yeni `requirePermission(code)` çağrısında:
1. `code` `seed.ts`'in `permissionData` listesinde **olmalı** — yoksa Admin dışı kullanıcılar 403 alır
2. Ekleyen rolde de o permission **olmalı** — yoksa o rol erişemez
3. Hem `seed.ts`'i güncelle hem de canlı DB'yi güncelle (yeni permission INSERT + role_permissions INSERT)

---

## 7. Kritik İş Kuralları

### 7.1 Roll Splitting (Tambur — `tambur.service.ts`)

```
Kurşun'da hata tespit edildi → Tambur'da karar verildi: "KES"
  ↓
Orijinal topun metrajı AZALTILMAZ.
Kesilen parça için YENİ Roll kaydı oluşturulur (yeni barcode).
Yeni Roll → status: SCRAP veya A1_STOCK, parentRollId set
Orijinal Roll → currentQty güncellenir, status: WAREHOUSE,
                currentStepId: null  (saf statü modeli — depo bir istasyon değil;
                paketleme RollMovement'i tartı/paket finalize anında atomic
                açılır + kapanır, READY_FOR_SHIP'e geçer)
```

### 7.2 Fason Dönüş — Ölçüm YOKKEN

```
SubcontractorReceipt'te qty/weight ALINMAZ.
Roll'lar AT_SUBCONTRACTOR → RETURNED_FROM_SUBCONTRACTOR'a geçer (yeni barkod basılmaz).
Ölçüm bir sonraki istasyonun FINISH akışında yapılır
(RollMovement.qtyOut/weightOut alanlarına yazılır).
```

### 7.3 Esnek Müşteri Ataması (`shipping.service.ts`)

```
Müşteri A'ya tahsisli top → Müşteri B'nin sevkiyatına eklenebilir:
  → Eski OrderAllocation silinir
  → Top yeni Shipment'a ShipmentItem olarak eklenir
İSTİSNA: Roll.ownerCustomerId varsa (SERVICE_PRODUCTION) o müşteriden
        çıkarılamaz — fason üretim kabulü.
```

### 7.4 Otomatik Sipariş Tamamlama (`shipping.service.ts`)

```
Shipment finalize → SHIPPED:
  → Etkilenen her Order için toplam shippedQty hesaplanır
  → shippedQty >= quantity → Order.status = COMPLETED
  → Aksi halde → Order.status = PARTIAL_SHIPPED
```

### 7.5 İş Emri Esnekliği (`workorder.service.ts`)

```
- WorkOrder siparişsiz olabilir (STOCK_PRODUCTION, SERVICE_PRODUCTION)
- WorkOrder birden fazla OrderLine'a bağlanabilir (WorkOrderToOrderLine N:N)
- Sevkiyat WO görmez, sadece Order/ShipmentItem üzerinden çalışır
```

### 7.6 Refakat Kartı (`TravelerCard`)

```
WorkOrder finalize edildiğinde TravelerCard üretilir (cardNumber, barcode).
Mal ile birlikte fiziksel olarak gezer.
İstasyonda barkod taranınca → TravelerCardScan kaydı + step ilerletme.
Reprint → eski kart REPRINTED'e döner, yeni kart ACTIVE.
WO COMPLETED → tüm kartlar COMPLETED'a düşer.
```

### 7.7 RollOperation Idempotent

```
@@unique([rollId, workOrderStepId, operationType])
→ Aynı operasyon iki kez çağrılırsa Prisma P2002 atar.
→ İdempotent retry için: önce findUnique, varsa skip; yoksa create.
```

---

## 8. Geliştirme Pattern'leri

### 8.1 Yeni Master Data Modülü (BaseController kullanımı)

`Warehouse` gibi basit bir tablo için:

```typescript
// src/services/warehouse.service.ts
import { BaseService } from "./base.service";
export const warehouseService = new BaseService({
  modelName: "warehouse",       // Prisma model adı (camelCase)
  tableName: "WAREHOUSE",       // SystemLog için tablo adı
  searchFields: ["code", "name"],
});

// src/controllers/warehouse.controller.ts
import { BaseController } from "./base.controller";
import { warehouseService } from "../services/warehouse.service";
export const warehouseController = new BaseController(warehouseService);

// src/routes/warehouse.routes.ts
import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { warehouseController } from "../controllers/warehouse.controller";

const router = Router();
router.get("/", verifyToken, requirePermission("station:read"), warehouseController.findAll);
router.post("/", verifyToken, requirePermission("station:write"), warehouseController.create);
// ...
export default router;

// src/app.ts
app.use("/api/warehouses", warehouseRoutes);
```

`BaseController` 6 endpoint sağlar: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` (soft), `DELETE /:id/permanent` (hard).

### 8.2 Karmaşık İş Mantığı Modülü

```
1. Service yaz (src/services/) — iş kuralları + transaction + AuditService.log()
2. Controller yaz (src/controllers/) — Zod validate + service çağrısı
3. Route yaz (src/routes/) — verifyToken + requirePermission + Swagger JSDoc
4. app.ts'e import + app.use() ekle
```

### 8.3 Zod Validasyon

```typescript
import { z } from "zod";
const schema = z.object({
  name: z.string().min(1, "Ad gerekli"),
  quantity: z.number().positive("Miktar pozitif olmalı"),
  type: z.enum(["TYPE_A", "TYPE_B"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(), // Zod v4 — iki arg
});
const data = schema.parse(req.body); // Hata varsa errorHandler ZodError'ı yakalar → 400
```

### 8.4 Transaction

```typescript
const result = await prisma.$transaction(async (tx) => {
  const a = await tx.model1.create({ data: { ... } });
  const b = await tx.model2.update({ where: { id }, data: { ... } });
  return { a, b };
});
```

**ZORUNLU:** `tx` içinde `Promise.all([tx.x, tx.y])` **yasak** — pg adapter'ında tek connection seri çalıştırır, parallelism illüzyon. ESLint kuralı bunu yakalar (`eslint.config.mjs`).

Top-level `prisma.$transaction([prisma.x, prisma.y])` (pool kullanımı) sorun değil.

### 8.5 AuditService

Her CUD işleminde **zorunlu**:

```typescript
await AuditService.log({
  userId: req.user?.userId,
  action: "CREATE",          // | "UPDATE" | "DELETE"
  tableName: "ROLL",         // BÜYÜK HARF
  recordId: record.id,
  oldData: { ... },          // UPDATE/DELETE için
  newData: { ... },          // CREATE/UPDATE için
});
```

`BaseService` bunu otomatik yapar; özel servislerde manuel çağırmak gerekir.

### 8.6 Hata Yönetimi

`AppError` factory'leri (`utils/app-error.ts`):
- `AppError.badRequest(msg)` → 400
- `AppError.unauthorized(msg)` → 401
- `AppError.forbidden(msg)` → 403
- `AppError.notFound(msg)` → 404
- `AppError.conflict(msg)` → 409

`errorHandler` Prisma kodlarını da yakalar:
- `P2002` (unique violation) → 409 + alan adı
- `P2025` (record not found) → 404
- `ZodError` → 400 + `errors[]` array
- `PrismaClientValidationError` → 400 (yanlış veri yapısı)

### 8.7 API Yanıt Formatları

```typescript
// Tekil başarı
{ "success": true, "data": { ... }, "message": "Kayıt oluşturuldu" }

// Sayfalanmış liste (BaseService.findAll)
{
  "success": true,
  "data": [...],
  "pagination": { "page": 1, "pageSize": 20, "total": 150, "totalPages": 8 }
}

// Hata
{ "success": false, "message": "..." }

// Validasyon hatası (Zod)
{
  "success": false,
  "message": "Validasyon hatası",
  "errors": [{ "field": "initialQty", "message": "Miktar pozitif olmalı" }]
}
```

---

## 9. Database Performance Playbook

> **Kritik:** Üretim yüzbinlerce satır barındıracak. İndeks/sorgu hataları erken yakalanmalı.

### 9.1 FK Indeksleri Otomatik Değildir

Prisma her `@relation`'da arka planda FK index oluşturmaz. Yeni FK eklediğinde **`@@index([fkColumn])` zorunlu**.

```prisma
model Order {
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
  @@index([customerId]) // ← unutma
}
```

Etkisi: 10-100x daha hızlı JOIN ve CASCADE delete.

### 9.2 Composite Index Sırası

**Eşitlik kolonları önce, range/order kolonları sonra:**

```prisma
@@index([status, createdAt])  // ✓ status = ?, ORDER BY createdAt
@@index([createdAt, status])  // ✗ Yanlış sıra — leftmost rule başarısız
```

Çift eşitlikte daha selektif olan kolon önce gelir (örn: `[workOrderId, status]` — workOrderId çok daha selektif).

### 9.3 Sık Birlikte Filtrelenen Kolonlar = Tek Composite

```prisma
@@index([customerId])          // ✗ Bitmap scan'e zorlar
@@index([status])              //
                                
@@index([customerId, status])  // ✓ Tek index scan
```

İki ayrı index, `WHERE customerId = ? AND status = ?` için zorunlu olarak bitmap scan yapar.

### 9.4 Soft-Delete Tabloları için Partial Index

`isActive: false` olan kayıtlar tabloda kalıyor. Aktif kayıt sorguları büyüdükçe yavaşlıyor. Çözüm: raw SQL migration'da partial index.

```sql
-- prisma/migrations/YYYYMMDD_partial_active_idx/migration.sql
CREATE INDEX customers_active_code_idx
  ON customers (code)
  WHERE "isActive" = true;
```

Prisma şema syntax'ında native değil (yet). Hacme ulaşan tablolar için (Item, Customer, Station) eklenmeli.

### 9.5 Yüksek Hacimli Tablolar için Cursor Pagination

`BaseService.findAll` `skip/take` (offset) kullanıyor. 100. sayfa = 2000 satır tarama, 1000. sayfa = 20000 satır tarama.

Yüksek hacim tablolarda (`Roll`, `RollMovement`, `RollOperation`, `SystemLog`, `TravelerCardScan`) cursor pagination şablonu:

```typescript
// İlk sayfa
const items = await prisma.roll.findMany({
  orderBy: { createdAt: "desc" },
  take: 20,
});
// Sonraki sayfa — son item'ın createdAt + id'sini cursor olarak kullan
const next = await prisma.roll.findMany({
  cursor: { id: lastId },
  skip: 1, // cursor item'ını atla
  take: 20,
  orderBy: { createdAt: "desc" },
});
```

Tek-kolon `orderBy` için yeterli; çok-kolon sırada `(createdAt, id) > (?, ?)` raw query gerekebilir.

### 9.6 JSON Alan Sorguları → GIN Index

Schema'da Json alanları: `WorkOrder.parameters`, `WorkOrderStep.stepData`, `Shipment.printSnapshot`, `RollOperation.metadata`, `MachineLog.details`, `SystemLog.oldData/newData`, `Manifest.snapshot`.

Eğer içinde sorgulanmıyorsa (yalnızca okunuyor) — index gerekmez.  
Eğer sorgulanacaksa raw migration ile GIN index:

```sql
CREATE INDEX work_orders_parameters_gin
  ON work_orders USING GIN (parameters);
-- Containment query:
SELECT * FROM work_orders WHERE parameters @> '{"dyeRecipe": "R-123"}';
```

### 9.7 N+1 Önleme — `include` ve `select`

```typescript
// ✗ N+1 — her order için ayrı query
const orders = await prisma.order.findMany();
for (const o of orders) {
  const lines = await prisma.orderLine.findMany({ where: { orderId: o.id } });
}

// ✓ Tek query, ilişkiyi include et
const orders = await prisma.order.findMany({
  include: { lines: true },
});

// ✓✓ Daha iyi — sadece ihtiyaç duyulan alanları select et (overshoot azalır)
const orders = await prisma.order.findMany({
  select: {
    id: true,
    orderNumber: true,
    lines: { select: { id: true, quantity: true } },
  },
});
```

### 9.8 Karmaşık Aggregation → Raw SQL

Prisma'nın `aggregate`, `groupBy` API'si bazı durumlarda yetersiz veya çoklu round-trip yaratıyor. Karmaşık raporlar için:

```typescript
const result = await prisma.$queryRaw`
  SELECT customer_id, COUNT(*) as count, SUM(quantity) as total
  FROM order_lines
  GROUP BY customer_id
  ORDER BY total DESC
`;
```

### 9.9 EXPLAIN ile Doğrulama

Yeni endpoint'in büyük tabloya değdiği yerde:

```sql
EXPLAIN ANALYZE SELECT * FROM rolls WHERE status = 'STOCK' ORDER BY "createdAt" DESC LIMIT 20;
```

`Seq Scan` görürsen index eksik. `Index Scan` veya `Index Only Scan` → tamam.

### 9.10 Toplu Insert için `createMany`

100+ satır eklerken tek tek `create` yapma — `createMany` 10-50x hızlıdır:

```typescript
await prisma.rollOperation.createMany({
  data: rolls.map(r => ({ rollId: r.id, ... })),
  skipDuplicates: true, // @@unique varsa
});
```

`createMany` Postgres'te `INSERT ... VALUES (...), (...), ...` formuna çevrilir.

### 9.11 Transaction Süresi Kısa Tut

Uzun transaction = uzun lock süresi = deadlock riski.

```typescript
// ✗ Yavaş — HTTP çağrısı transaction içinde
await prisma.$transaction(async (tx) => {
  const order = await tx.order.create({ ... });
  await fetch("https://external-api/...", { ... }); // ← LOCK uzar
});

// ✓ External work önce, sonra transaction
const externalData = await fetch("...");
await prisma.$transaction(async (tx) => {
  await tx.order.create({ data: { ..., externalData } });
});
```

---

## 10. Mevcut Şema İndeksleri (Audit)

Tüm hot-path tablolarında indeks durumu:

| Tablo | Doğrulanmış İndeksler |
|---|---|
| `rolls` | `itemId`, `variantId`, `status`, `parentRollId`, `currentStepId`, `producedInStepId`, `ownerCustomerId`, **composite `[status, createdAt]`** |
| `roll_movements` | `rollId`, `workOrderStepId`, `enteredAt` |
| `roll_operations` | `@@unique([rollId, workOrderStepId, operationType])`, `rollId`, `workOrderStepId`, `operationType` |
| `roll_errors` | `rollId`, `detectedAtStepId`, `processedAtStepId`, `isProcessed`, `defectTypeId`, **composite `[rollId, isProcessed]`** |
| `work_order_steps` | `[workOrderId, stepSequence]`, `stationId`, **composite `[workOrderId, status]`** |
| `system_logs` | `userId`, `[tableName, recordId]`, **`[createdAt]`** |
| `traveler_card_scans` | `cardId`, `[stationId, scannedAt]`, `workOrderStepId` |
| `orders` | `customerId`, `status` |
| `work_orders` | `status`, `routeTemplateId`, `dyehouseCompanyId` |
| `shipments` | `customerId`, `status` |
| `shipment_items` | `shipmentId`, `rollId @unique` |

### Aktif Partial / Conditional İndeksler (raw SQL migration)

| İndeks | Tablo | Koşul | Migration |
|---|---|---|---|
| `items_active_type_name_idx` | `items` | `WHERE "isActive" = true` üstüne `(itemType, name)` | `20260427150000_add_partial_active_indexes` |
| `customers_active_type_name_idx` | `customers` | `WHERE "isActive" = true` üstüne `(type, name)` | `20260427150000_add_partial_active_indexes` |
| `traveler_cards_workOrderId_active_key` | `traveler_cards` | `WHERE status = 'ACTIVE'` üstüne `workOrderId` (unique) | (mevcut) |

### Gelecekte Düşünülmesi Gerekenler

- `Order @@index([customerId, status])` — eğer "müşterinin açık siparişleri" sorgusu eklenirse
- `WorkOrder @@index([status, plannedEndDate])` — eğer "termin yaklaşan WO" raporu eklenirse
- `RollOperation` BRIN index (`createdAt` üzerinde) — milyon satıra ulaşınca
- `MachineLog`, `WorkOrder.parameters`, `RollOperation.metadata` için **GIN index** — JSON sütununa filtre uygulanmaya başlandığı anda (önce ekle, sonra endpoint yaz)

---

## 10.1 DB Runtime Safety (her zaman aktif)

Yıllarca yerel sunucuda çalışacak ERP'de tek bir kötü sorgu DB'yi kilitlememeli. Migration: `20260427160000_db_runtime_safety`.

| Ayar | Değer | Amaç |
|---|---|---|
| `statement_timeout` | `30s` | Tek sorgu 30 saniyeyi aşarsa otomatik iptal — runaway query koruması |
| `idle_in_transaction_session_timeout` | `5min` | Açık kalmış transaction'lar tablo lock'ı tutmasın |
| `log_min_duration_statement` | `500ms` | 500ms+ süren her sorgu PostgreSQL log'una düşer |
| `log_lock_waits` | `on` | Lock beklemeleri loglansın (deadlock teşhisi) |
| `log_temp_files` | `10MB` | Disk'e dökülen büyük sıralama/JOIN'leri kaydet |
| `MAX_OFFSET` (kod) | `10000` | `skip > 10K` → 400 hatası, kullanıcıyı filtre kullanmaya zorlar (`query-parser.ts`) |

**Mevcut değeri görmek için:**
```sql
SELECT name, setting, unit FROM pg_settings
WHERE name IN ('statement_timeout','idle_in_transaction_session_timeout',
               'log_min_duration_statement','log_lock_waits','log_temp_files');
```

**Tekrar uygulamak gerekirse** (DB taşıma, kurulum vb.):
```bash
psql -h <host> -p <port> -U postgres -d TeksErpDb -f \
  prisma/migrations/20260427160000_db_runtime_safety/migration.sql
```

---

## 10.2 Çeyreklik DB Sağlık Kontrolü

Her **3 ayda bir** admin tarafından çalıştırılır. Çıktıları operasyon defterine kaydedilir.

### A. Tablo boyutu ve büyüme hızı
```sql
SELECT
  schemaname || '.' || relname AS table,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS data_size,
  n_live_tup AS rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 15;
```

### B. SystemLog büyüme + arşivleme tetikleyicisi
```sql
SELECT
  COUNT(*) AS active_rows,
  MIN("createdAt") AS oldest,
  MAX("createdAt") AS newest
FROM system_logs;
```
> Eğer `oldest > 6 ay öncesi` → `POST /api/admin/system-logs/archive { "monthsToKeep": 6 }` çağır.

### C. Kullanılmayan index'leri tespit et (yer kaplıyor, INSERT yavaşlatıyor)
```sql
SELECT schemaname, relname, indexrelname,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size,
       idx_scan AS scans
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND indexrelname NOT LIKE '%_pkey'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### D. Seq scan oranı yüksek tablolar (eksik index sinyali)
```sql
SELECT relname, seq_scan, idx_scan,
       seq_tup_read, idx_tup_fetch,
       CASE WHEN seq_scan + idx_scan = 0 THEN 0
            ELSE seq_scan::float / (seq_scan + idx_scan) END AS seq_ratio
FROM pg_stat_user_tables
WHERE seq_scan > 1000
ORDER BY seq_ratio DESC
LIMIT 10;
```

### E. Index bloat — yıllar içinde şişer, REINDEX gerekir
```sql
-- Yılda bir kez (düşük yoğunluk saatinde):
REINDEX TABLE CONCURRENTLY rolls;
REINDEX TABLE CONCURRENTLY system_logs;
REINDEX TABLE CONCURRENTLY roll_movements;
REINDEX TABLE CONCURRENTLY roll_operations;
REINDEX TABLE CONCURRENTLY traveler_card_scans;
```

### F. PostgreSQL log dosyasında 500ms+ sorgular
```bash
# Linux yerel sunucu (örn. /var/log/postgresql/):
grep "duration:" /var/log/postgresql/postgresql-*.log \
  | sort -t: -k2 -n -r | head -20
```

---

## 11. Ortam Değişkenleri

| Var | Açıklama | Örnek |
|---|---|---|
| `PORT` | Sunucu portu | `4000` |
| `DATABASE_URL` | PostgreSQL bağlantı | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | JWT imzalama anahtarı | `supersecret_key` |

---

## 12. Çalıştırma Komutları

```bash
npm run dev                  # nodemon + ts-node (server.ts)
npm run build                # tsc compile
npm run seed                 # Test verisi yükle
npm run prisma:generate      # Şema değişikliği sonrası ZORUNLU
npm run prisma:migrate       # migrate deploy (production)
npx prisma migrate dev       # Yeni migration oluştur (development)
npm run prisma:studio        # DB GUI
npm run lint                 # ESLint
npx tsc --noEmit             # Type-check (build'siz)
```

---

## 13. Test Kullanıcıları (Seed)

| Username | Şifre | Hedef Rol | Seed Sonrası Yetkiler |
|---|---|---|---|
| `admin` | `admin123` | Admin | ✅ TÜM (~50 permission) |
| `mehmet.planlama` | `test123` | Planlama Şefi | ⚠️ Boş — admin UI'dan atayın |
| `ali.operator` | `test123` | Üretim Operatörü | ⚠️ Boş — admin UI'dan atayın |
| `ayse.kalite` | `test123` | Kalite Kontrol | ⚠️ Boş — admin UI'dan atayın |
| `fatma.satis` | `test123` | Satış | ⚠️ Boş — admin UI'dan atayın |
| `veli.sevkiyat` | `test123` | Sevkiyat | ⚠️ Boş — admin UI'dan atayın |
| `ali.kursun` | `test123` | Mobil — Kurşun/KK2 | ⚠️ Boş — admin UI'dan atayın |
| `ahmet.depo` | `test123` | Mobil — Depo/Sevkiyat/Tambur | ⚠️ Boş — admin UI'dan atayın |

> **Tasarım kararı:** `prisma/seed.ts` yalnız `admin`'e seed'de yetki veriyor (line 163-173). Diğer test kullanıcıları "boş başlar, admin atar" prensibiyle yaratılıyor — production'da rol atamaları runtime yapılır, dev'de de aynı yol izlenir.
>
> "Hedef Rol" kolonu, kullanıcının ileride hangi yetki setine sahip olması beklendiğini gösterir — seed'de değil, admin UI'sındaki atamada karşılık bulur.

---

## 14. Sık Yapılan Hatalar Kontrol Listesi

- [ ] `prisma generate` çalıştırıldı mı? (şema değiştiyse zorunlu)
- [ ] Yeni FK için `@@index([fkColumn])` eklendi mi?
- [ ] `app.ts`'e route eklendi mi?
- [ ] Swagger JSDoc yazıldı mı?
- [ ] Her CUD'de `AuditService.log()` çağrıldı mı?
- [ ] Fiziksel DELETE yerine `isActive: false` mı kullanıldı?
- [ ] Transaction içinde `Promise.all([tx.*])` yok mu?
- [ ] `any` type kullanılmadı mı?
- [ ] Zod `z.record()` iki arg ile mi çağrıldı?
- [ ] Yeni endpoint için RBAC permission kodu seçildi mi (seed'de tanımlı olduğu doğrulandı mı)?
