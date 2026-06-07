# TeksERP — Backend (`Teks-Erp/`)

Express 5 + Prisma 7 + PostgreSQL. See root `CLAUDE.md` for domain facts.

> **Deep reference:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — full schema (52 models, 14 enums), API endpoint map, pattern examples, business rules, performance playbook. Read it when starting non-trivial work.

## Commands

```bash
npm run dev                  # nodemon + ts-node (server.ts)
npm run build                # tsc compile
npm run seed                 # Test verisi yükle
npm run prisma:generate      # Şema değişikliği sonrası ZORUNLU
npm run prisma:migrate       # migrate deploy (production)
npx prisma migrate dev       # Yeni migration oluştur (development)
npm run prisma:studio        # DB GUI
npm run lint                 # ESLint
npx tsc --noEmit             # Type-check
```

### Pull sonrası senkronizasyon (yeni dev / `git pull` sonrası ZORUNLU sıra)

Eksik adım = sessiz bozulma. `prisma generate` atlanırsa TS derlenmez (`Property 'X' does not exist on type Y`); `migrate dev` atlanırsa runtime'da `P2022 — column X does not exist` ile audit log sessizce kaybolur ve server çalışmaya devam eder (best-effort audit). Doğru sıra:

```bash
npm install                  # package.json değiştiyse
npm run prisma:generate      # schema.prisma güncellendiyse client yenilensin
npx prisma migrate dev       # pending migration varsa DB'ye uygula (dev)
npm run dev                  # sunucuyu kaldır
```

Production'da `migrate dev` yerine `npm run prisma:migrate` (= `prisma migrate deploy`) kullanılır.

## Environment (`.env`)

```
PORT=4000
DATABASE_URL="postgresql://oad@localhost:5432/adnansahin_db?schema=public"
JWT_SECRET="..."
```

> Geliştirme tamamen **yerel** PostgreSQL ile çalışır (`localhost:5432/adnansahin_db`). Uzak/paylaşımlı DB yok.

## Architecture (özet)

**Routes → Controllers → Services → Prisma** — alt katman atlamak yasak.

- `controllers/` (15 dosya) — HTTP layer, Zod validate, service çağırır
- `services/` (22 dosya + `helpers/` + `reports/`) — iş mantığı, transaction, `AuditService.log()`
- `routes/` (31 dosya + `reports/`) — Swagger JSDoc + `verifyToken` + `requirePermission`
- `middlewares/` — `auth` (verifyToken), `rbac` (requirePermission), `error` (AppError + Prisma + Zod mapping), `device` (mobil pairing/token), `uuid-param` (UUID path validate)
- `prisma/schema.prisma` — 52 model, 14 enum, `@prisma/adapter-pg`

**Master Data CRUD** için yeni kod yazmadan `BaseController` + `BaseService` kullan (`searchFields` config'i yeterli). Detay: ARCHITECTURE.md §8.1.

## Allowed npm Packages

Sadece bunlar. Alternatif tanıtma.

| Category | Packages |
|---|---|
| Core | `express`, `dotenv`, `cors`, `helmet`, `compression` |
| Database | `prisma`, `@prisma/client`, `pg`, `@prisma/adapter-pg` |
| Auth | `jsonwebtoken`, `bcryptjs` |
| Validation | `zod` |
| Docs | `swagger-ui-express`, `swagger-jsdoc` |
| Logging | `morgan` |
| Util | `uuid` |
| Test data | `@faker-js/faker` (dev only) |

## RBAC Permission Kodları

`requirePermission(code)` → `req.user.permissions[]` array. Permissions doğrudan kullanıcıya bağlanır (`UserPermission`), tekrar kullanım için `PermissionTemplate` var (rol modeli **yok**). Toplam **42 permission**, **9 modül**:

| Modül | Permissions |
|---|---|
| SALES | `order:read/write`, `customer:read/write`, `customer-alias:read/write` |
| PRODUCTION | `workorder:read/write`, `roll:read/write`, `station:read/write` |
| MASTER_DATA | `item:read/write` |
| QUALITY | `quality:read/write`, `property:read/write` |
| SUBCONTRACTOR | `subcontractor:read/write` |
| LOGISTICS | `label:read`, `label:print`, `label:edit`, `label-template:read/write` |
| REPORTS | `report:production/sales/quality/inventory/subcontract/customer/audit` |
| ADMIN | `admin:users`, `admin:settings`, `admin:*` (wildcard) |
| MOBILE | `mobile:kk1/kk2-kursun/tambur/depo/fason-sevk/fason-kabul`, `mobile:*` (wildcard) |

> Eski LOGISTICS `shipment:*` ve `allocation:*` permission'ları sevkiyat modülü ile birlikte kaldırıldı. Yeni sevkiyat permission'ları yeniden yazımla birlikte gelecek.

Yeni endpoint yazarken `requirePermission(code)`'daki `code` **seed.ts'te olmalı** (yoksa Admin dışı kullanıcılar 403 alır). Yeni permission ekliyorsan: hem `seed.ts`'i güncelle, hem de canlı DB'ye permission + ilgili kullanıcı/template atamalarını INSERT et. Detay: ARCHITECTURE.md §6.

## Database Performance Rules (her zaman uygula)

> Üretim yüzbinlerce satır barındıracak; ERP yıllarca yerel sunucuda çalışacak. Detay + örnekler: ARCHITECTURE.md §9, §10.1, §10.2.

1. **FK index zorunlu.** Her `@relation` kolonuna `@@index([fkColumn])` — Prisma otomatik yapmaz.
2. **Composite index sırası:** Eşitlik kolonları önce, range/order sonra. Örn: `[status, createdAt]` ✓, `[createdAt, status]` ✗.
3. **Sık birlikte filtrelenen kolonlar = tek composite.** İki ayrı index bitmap scan'e zorlar.
4. **Null-yoğun / soft-delete tablolarda partial index.** `WHERE col IS NOT NULL` veya `WHERE isActive = true` — raw SQL migration ile (Prisma şemada native değil). **Drift-free yöntem:** şemada `@@index([col])` BIRAK, migration `DROP INDEX ... ; CREATE INDEX ... WHERE ...` ile partial'a çevir — Prisma 7 partial predicate'i drift saymaz (test edildi). Aktif: `rolls` (sackId, shipmentId, parentReceiptId, batchSplitId — migration `20260606001717`); `work_order_steps` (stationId,status,isUrgent,priority,startedAt **WHERE status <> 'COMPLETED'** — açık-kart kuyruğu, COMPLETED yığını indekslenmez; migration `20260607010000`). `items`/`customers` partial'ı henüz YOK (gerekirse aynı yöntemle).
5. **Yüksek hacim tablolar (`Roll`, `RollMovement`, `RollOperation`, `SystemLog`, `TravelerCardScan`)** için cursor pagination. `MAX_OFFSET=10000` guard aktif (`query-parser.ts`) — `skip > 10K` → 400.
6. **JSON alan sorgulanacaksa GIN index** raw migration ile, **endpoint yazılmadan ÖNCE**. Şu an hiçbiri sorgulanmıyor (`MachineLog.details`, `WorkOrder.parameters`, `RollOperation.metadata`, snapshot'lar).
7. **`include` yerine `select`** — only-needed-fields, over-fetch'i azaltır. Liste sayfaları için detay ekranındaki tüm alanları çekme.
8. **Karmaşık aggregation → `prisma.$queryRaw`.** Prisma `groupBy` API'si bazen çoklu round-trip yaratır.
9. **`createMany` toplu insert için.** 100+ satır eklerken tek-tek `create` 10-50x yavaş.
10. **Transaction süresi kısa.** External I/O (HTTP, file) tx içinde **yapma** — lock uzar, deadlock riski. DB-level `idle_in_transaction_session_timeout=5min` aktif.
11. **`tx.*` ile `Promise.all` YASAK.** pg adapter tek connection seri çalıştırır; ESLint kuralı yakalar (`eslint.config.mjs`).
12. **EXPLAIN ile doğrula.** Yeni endpoint büyük tabloya değiyorsa `EXPLAIN ANALYZE` koş. `Seq Scan` görürsen index eksik.
13. **Snapshot JSON'ları liste sorgusunda çekme.** `Manifest.snapshot`, `SubcontractorDispatch.printSnapshot` — sadece detay/print endpoint'i `select`'ine al.
14. **Canlı DB'de index migration → vardiya dışında deploy et.** `CREATE INDEX` büyük tabloda yazma kilidi alır (milyon satırda dakikalarca). `prisma migrate deploy` komutunu gece veya hafta sonu çalıştır — operatörler farkına bile varmaz, sabah index hazır olur. Vardiya saatinde index ekleme yasak. (Sıfır-downtime gerekirse `CREATE INDEX CONCURRENTLY` + psql manuel akışı kurulabilir, şu an ihtiyaç yok.)
    - **⚠️ statement_timeout tuzağı:** App DB'de `statement_timeout=30s` aktif (aşağıdaki operasyonel bakım notu). Bu, **uzun bir DDL'i (büyük tabloda `CREATE INDEX`) 30s'de İPTAL EDER** (doğrulandı: `canceling statement due to statement timeout`). Yüz binlerce+ satıra index ekleyen migration'ın EN BAŞINA `SET statement_timeout = 0;` koy — yoksa migration yarıda kesilir. (Boş/yeni kurulumda risk yok; toplu veri biriktikten sonra index eklerken kritik.)

## Operasyonel Bakım

- **`statement_timeout=30s`** aktif (uzun sorgu otomatik iptal). DB-level: `ALTER DATABASE "TeksErpDb" SET statement_timeout = '30s'` — migration ile değil, manuel uygulanır. Detay: ARCHITECTURE.md §10.1.
- **Slow query log** (`>500ms`) PostgreSQL log dosyasına düşer.
- **6 ayda bir** `POST /api/admin/system-logs/archive { "monthsToKeep": 6 }` — `archived=0` dönene kadar tekrar et.
- **3 ayda bir** ARCHITECTURE.md §10.2 sağlık kontrol SQL'lerini çalıştır.
- **Bloat ölçülünce** (takvimle değil) `REINDEX INDEX CONCURRENTLY` — `scripts/index-health.sql` §8 (ölü-satır proxy) + §9 (pgstattuple kesin bloat) ile şişen indeksi tespit et, sadece onu reindex et. Tipik eşik: indeks boş-alan >%30 veya tablo ölü-satır >%20. Canlı/dolu DB'de CONCURRENTLY şart (yazma kilidi almaz).

## Yeni Endpoint Kontrol Listesi

- [ ] Yeni FK için `@@index([fkColumn])` eklendi
- [ ] `prisma generate` çalıştırıldı
- [ ] Service: transaction + `AuditService.log()` her CUD'de
- [ ] Controller: Zod validate + service çağır
- [ ] Route: `verifyToken` + `requirePermission(seed'de olan kod)` + Swagger JSDoc
- [ ] `app.ts`'e `app.use("/api/...", routes)` eklendi
- [ ] Fiziksel DELETE değil `isActive: false` veya status değişikliği
- [ ] `any` yok
- [ ] `tx` içinde `Promise.all([tx.*])` yok

## Version Gotchas

- **Zod v4:** `z.record(z.string(), z.unknown())` — iki arg.
- **Express 5:** `req.params.id` bazen `as string` cast ister.
- **Prisma 7:** Şema değişikliği sonrası `npm run prisma:generate` zorunlu.
