# TeksERP — Backend (`Teks-Erp/`)

Express 5 + Prisma 7 + PostgreSQL. See root `CLAUDE.md` for domain facts.

> **Deep reference:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — full schema (38 models, 13 enums), API endpoint map, pattern examples, business rules, performance playbook. Read it when starting non-trivial work.

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

## Environment (`.env`)

```
PORT=4000
DATABASE_URL="postgresql://postgres:4747@45.136.6.28:5432/TeksErpDb?schema=public"
JWT_SECRET="..."
```

## Architecture (özet)

**Routes → Controllers → Services → Prisma** — alt katman atlamak yasak.

- `controllers/` (12 dosya) — HTTP layer, Zod validate, service çağırır
- `services/` (17 dosya) — iş mantığı, transaction, `AuditService.log()`
- `routes/` (21 dosya) — Swagger JSDoc + `verifyToken` + `requirePermission`
- `middlewares/` — auth, RBAC, global error handler (`AppError` + Prisma + Zod mapping)
- `prisma/schema.prisma` — 38 model, 13 enum, `@prisma/adapter-pg`

**Master Data CRUD** için yeni kod yazmadan `BaseController` + `BaseService` kullan (`searchFields` config'i yeterli). Detay: ARCHITECTURE.md §8.1.

## Allowed npm Packages

Sadece bunlar. Alternatif tanıtma.

| Category | Packages |
|---|---|
| Core | `express`, `dotenv`, `cors`, `helmet` |
| Database | `prisma`, `@prisma/client`, `pg`, `@prisma/adapter-pg` |
| Auth | `jsonwebtoken`, `bcryptjs` |
| Validation | `zod` |
| Docs | `swagger-ui-express`, `swagger-jsdoc` |
| Logging | `morgan` |
| Util | `uuid` |

## RBAC Permission Kodları

`requirePermission(code)` → `req.user.permissions[]` array. Toplam 20 permission, 6 modül:

| Modül | Permissions |
|---|---|
| SALES | `order:read/write`, `customer:read/write` |
| PRODUCTION | `workorder:read/write`, `roll:read/write`, `station:read/write` |
| MASTER_DATA | `item:read/write` |
| QUALITY | `quality:read/write` |
| LOGISTICS | `shipment:read/write`, `allocation:write` |
| ADMIN | `admin:users`, `admin:roles`, `admin:settings` |

Yeni endpoint yazarken `requirePermission(code)`'daki `code` **seed.ts'te olmalı** (yoksa Admin dışı kullanıcılar 403 alır). Yeni permission ekliyorsan: hem `seed.ts`'i güncelle, hem de canlı DB'ye `INSERT permissions + role_permissions` SQL çalıştır. Detay: ARCHITECTURE.md §6.

## Database Performance Rules (her zaman uygula)

> Üretim yüzbinlerce satır barındıracak; ERP yıllarca yerel sunucuda çalışacak. Detay + örnekler: ARCHITECTURE.md §9, §10.1, §10.2.

1. **FK index zorunlu.** Her `@relation` kolonuna `@@index([fkColumn])` — Prisma otomatik yapmaz.
2. **Composite index sırası:** Eşitlik kolonları önce, range/order sonra. Örn: `[status, createdAt]` ✓, `[createdAt, status]` ✗.
3. **Sık birlikte filtrelenen kolonlar = tek composite.** İki ayrı index bitmap scan'e zorlar.
4. **Soft-delete tablolarda partial index.** `WHERE isActive = true` — raw SQL migration ile (Prisma şemada native değil). Aktif: `items`, `customers`.
5. **Yüksek hacim tablolar (`Roll`, `RollMovement`, `RollOperation`, `SystemLog`, `TravelerCardScan`)** için cursor pagination. `MAX_OFFSET=10000` guard aktif (`query-parser.ts`) — `skip > 10K` → 400.
6. **JSON alan sorgulanacaksa GIN index** raw migration ile, **endpoint yazılmadan ÖNCE**. Şu an hiçbiri sorgulanmıyor (`MachineLog.details`, `WorkOrder.parameters`, `RollOperation.metadata`, snapshot'lar).
7. **`include` yerine `select`** — only-needed-fields, over-fetch'i azaltır. Liste sayfaları için detay ekranındaki tüm alanları çekme.
8. **Karmaşık aggregation → `prisma.$queryRaw`.** Prisma `groupBy` API'si bazen çoklu round-trip yaratır.
9. **`createMany` toplu insert için.** 100+ satır eklerken tek-tek `create` 10-50x yavaş.
10. **Transaction süresi kısa.** External I/O (HTTP, file) tx içinde **yapma** — lock uzar, deadlock riski. DB-level `idle_in_transaction_session_timeout=5min` aktif.
11. **`tx.*` ile `Promise.all` YASAK.** pg adapter tek connection seri çalıştırır; ESLint kuralı yakalar (`eslint.config.mjs`).
12. **EXPLAIN ile doğrula.** Yeni endpoint büyük tabloya değiyorsa `EXPLAIN ANALYZE` koş. `Seq Scan` görürsen index eksik.
13. **Snapshot JSON'ları liste sorgusunda çekme.** `Manifest.snapshot`, `Shipment.printSnapshot`, `SubcontractorDispatch.printSnapshot` — sadece detay/print endpoint'i `select`'ine al.
14. **Canlı DB'de index migration → `CREATE INDEX CONCURRENTLY` + `psql`.** `prisma migrate dev` regular `CREATE INDEX` üretir → milyon-satır tabloda yazma kilidi dakikalarca sürer (operatör mal kabul edemez). Çözüm: SQL'i `CREATE INDEX CONCURRENTLY IF NOT EXISTS` ile yaz; Prisma migrate ve `db execute` transaction'a sarıyor (CONCURRENTLY orada çalışmaz). Uygulama tek komutla:
    ```bash
    npm run migrate:concurrent <migration-adı>
    ```
    Wrapper script (`scripts/migrate-concurrent.sh`) önce SQL'i `psql` ile çalıştırır, sonra Prisma'ya "applied" işaretletir. Migration'da `CONCURRENTLY` yoksa script reddeder — sadece concurrent index migration'ları için. Şema değişiklikleri (`ALTER TABLE`, kolon ekle/sil) normal `migrate dev`/`migrate deploy` akışında. Boş DB'ye baseline kurarken (yeni kurulum) gerek yok — fark yaratmaz.

## Operasyonel Bakım

- **`statement_timeout=50s`** aktif (uzun sorgu otomatik iptal). DB-level: `ALTER DATABASE adnansahin_db SET statement_timeout = '50s'`.
- **Slow query log** (`>500ms`) PostgreSQL log dosyasına düşer.
- **6 ayda bir** `POST /api/admin/system-logs/archive { "monthsToKeep": 6 }` — `archived=0` dönene kadar tekrar et.
- **3 ayda bir** ARCHITECTURE.md §10.2 sağlık kontrol SQL'lerini çalıştır.
- **Yılda bir** `REINDEX TABLE CONCURRENTLY` yüksek hacim tablolarda (rolls, system_logs, roll_movements vb.).

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
