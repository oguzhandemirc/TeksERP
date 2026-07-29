# TeksERP — Backend (`Teks-Erp/`)

Express 5 + Prisma 7 + PostgreSQL. See root `CLAUDE.md` for domain facts.

> **Deep reference:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — full schema (~78 models, ~35 enums), API endpoint map, pattern examples, business rules, performance playbook. Read it when starting non-trivial work. (Not: §4-§6 envanter tabloları/sayıları nokta-anı snapshot'tır ve bayatlar — kanonik kaynak her zaman `schema.prisma`; ARCHITECTURE'ın değeri §7-§10 pattern/gerekçe içeriğindedir.)

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

**Routes → Controllers → Services → Prisma** — alt katman atlamak yasak. (Bilinçli istisna: ince read/ayar endpoint'leri — admin/dashboard/feature-flag/customer-branch/production-balance/station-capability route'ları controller'sız, route içinde Zod parse + servise delege; iş mantığı yine serviste, prisma import'u route/controller'da YASAK.)

- `controllers/` (~20 dosya) — HTTP layer, Zod validate, service çağırır
- `services/` (~45 dosya + `helpers/` + `reports/`) — iş mantığı, transaction, `AuditService.log()`
- `routes/` (~41 dosya + `reports/`) — Swagger JSDoc + `verifyToken` + `requirePermission`
- `middlewares/` — `auth` (verifyToken), `rbac` (requirePermission), `error` (AppError + Prisma + Zod mapping), `device` (mobil allowlist/atama: x-device-id → req.device.machineId), `uuid-param` (UUID path validate), `latency` (per-endpoint gecikme ölçümü), `login-lockout` (PIN/kart giriş kilidi)
- `prisma/schema.prisma` — ~78 model, ~35 enum, `@prisma/adapter-pg`. **İdempotency katmanı:** `clientToken String? @unique @db.Uuid` (Roll/Order/WorkOrder) + `SwatchStockReduction` olay modeli (kartela stok-düşüm/iptal idempotency'sini taşır — KartelaDispatch'te clientToken yok).

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
| Barcode | `bwip-js` |
| Etiket fontu (raster) | `opentype.js` (DejaVu TTF → 1bpp glif; fontlar `assets/fonts/`) |
| Test data | `@faker-js/faker` (dev only) |

## RBAC Permission Kodları

`requirePermission(code)` → `req.user.permissions[]` array. Permissions doğrudan kullanıcıya bağlanır (`UserPermission`), tekrar kullanım için `PermissionTemplate` var (rol modeli **yok**). Toplam **56 permission**, **10 modül**:

| Modül | Permissions |
|---|---|
| SALES | `order:read/write`, `customer:read/write`, `customer-alias:read/write` |
| PRODUCTION | `workorder:read/write`, `roll:read/write`, `roll:manual-adjust`, `station:read/write` |
| MASTER_DATA | `item:read/write` |
| QUALITY | `quality:read/write`, `property:read/write` |
| SUBCONTRACTOR | `subcontractor:read/write` |
| KARTELA | `kartela:read/write` |
| LOGISTICS | `label:read`, `label:print`, `label:edit`, `label-template:read/write`, `shipping:read/write`, `return:read/write` |
| REPORTS | `report:production/sales/quality/inventory/subcontract/customer/audit` |
| ADMIN | `admin:users`, `admin:settings`, `admin:*` (wildcard) |
| MOBILE | `mobile:kk1/kk2-kursun/tambur/depo/fason-sevk/fason-kabul/kartela-sevk/kartela-kabul/tarti-paket/sevkiyat/iade/hizli-is-emri`, `mobile:kk1-desen` (KK1-içi yetenek: seçili operatöre yeni desen oluşturma), `mobile:*` (wildcard) |

> Eski `shipment:*` ve `allocation:*` permission'ları 2026-05-25'te silindi; yeni sevkiyat yazımıyla `shipping:read/write` + `return:read/write` (LOGISTICS) ve mobil ekran izinleri geldi.

Yeni endpoint yazarken `requirePermission(code)`'daki `code` **seed.ts'te olmalı** (yoksa Admin dışı kullanıcılar 403 alır). Yeni permission ekliyorsan: hem `seed.ts`'i güncelle, hem de canlı DB'ye permission + ilgili kullanıcı/template atamalarını INSERT et. Detay: ARCHITECTURE.md §6.

## Database Performance Rules (her zaman uygula)

> Üretim yüzbinlerce satır barındıracak; ERP yıllarca yerel sunucuda çalışacak. Detay + örnekler: ARCHITECTURE.md §9, §10.1, §10.2.

1. **FK index zorunlu.** Her `@relation` kolonuna `@@index([fkColumn])` — Prisma otomatik yapmaz. (Bilinçli istisna: düşük-trafik "kim yaptı" audit FK'ları — `printedById`, `grantedById`, `updatedById` gibi — sorgulanmadıkça indexlenmez; sorgu yolu doğarsa eklenir.)
2. **Composite index sırası:** Eşitlik kolonları önce, range/order sonra. Örn: `[status, createdAt]` ✓, `[createdAt, status]` ✗.
3. **Sık birlikte filtrelenen kolonlar = tek composite.** İki ayrı index bitmap scan'e zorlar.
4. **Null-yoğun / soft-delete tablolarda partial index.** `WHERE col IS NOT NULL` veya `WHERE isActive = true` — raw SQL migration ile (Prisma şemada native değil). **Drift-free yöntem:** şemada `@@index([col])` BIRAK, migration `DROP INDEX ... ; CREATE INDEX ... WHERE ...` ile partial'a çevir — Prisma 7 partial predicate'i drift saymaz (test edildi). Aktif: `rolls` (sackId, shipmentId, parentReceiptId — migration `20260606001717`; `batchSplitId` parti-modeli redesign'ıyla kaldırıldı); `work_order_steps` (stationId,status,isUrgent,priority,startedAt **WHERE status <> 'COMPLETED'** — açık-kart kuyruğu, COMPLETED yığını indekslenmez; migration `20260607010000`). `items`/`customers` partial'ı henüz YOK (gerekirse aynı yöntemle).
5. **Yüksek hacim tablolar (`Roll`, `RollMovement`, `RollOperation`, `SystemLog`, `TravelerCardScan`)** için cursor pagination. `MAX_OFFSET=10000` guard aktif (`query-parser.ts`) — `skip > 10K` → 400.
6. **JSON alan sorgulanacaksa GIN index** raw migration ile, **endpoint yazılmadan ÖNCE**. Şu an hiçbiri sorgulanmıyor (`WorkOrder.parameters`, `RollOperation.metadata`, snapshot'lar). (`MachineLog` modeli 2026-05-25 cleanup'ında silindi.)
7. **`include` yerine `select`** — only-needed-fields, over-fetch'i azaltır. Liste sayfaları için detay ekranındaki tüm alanları çekme.
8. **Karmaşık aggregation → `prisma.$queryRaw`.** Prisma `groupBy` API'si bazen çoklu round-trip yaratır.
9. **`createMany` toplu insert için.** 100+ satır eklerken tek-tek `create` 10-50x yavaş.
10. **Transaction süresi kısa.** External I/O (HTTP, file) tx içinde **yapma** — lock uzar, deadlock riski. DB-level `idle_in_transaction_session_timeout=5min` aktif.
11. **`tx.*` ile `Promise.all` YASAK.** pg adapter tek connection seri çalıştırır; ESLint kuralı yakalar (`eslint.config.mjs`).
12. **EXPLAIN ile doğrula.** Yeni endpoint büyük tabloya değiyorsa `EXPLAIN ANALYZE` koş. `Seq Scan` görürsen index eksik.
13. **Snapshot JSON'ları liste sorgusunda çekme.** `Manifest.snapshot`, `PrintedDocument.snapshot` — sadece detay/print endpoint'i `select`'ine al. (`SubcontractorDispatch.printSnapshot` migration `20260609225307` ile kaldırıldı — donmuş belgeler artık `PrintedDocument`'ta.)
14. **Canlı DB'de index migration → vardiya dışında deploy et.** `CREATE INDEX` büyük tabloda yazma kilidi alır (milyon satırda dakikalarca). `prisma migrate deploy` komutunu gece veya hafta sonu çalıştır — operatörler farkına bile varmaz, sabah index hazır olur. Vardiya saatinde index ekleme yasak. (Sıfır-downtime gerekirse `CREATE INDEX CONCURRENTLY` + psql manuel akışı kurulabilir, şu an ihtiyaç yok.)
    - **⚠️ statement_timeout tuzağı:** App DB'de `statement_timeout=50s` aktif (aşağıdaki operasyonel bakım notu). Bu, **uzun bir DDL'i (büyük tabloda `CREATE INDEX`) 50s'de İPTAL EDER** (doğrulandı: `canceling statement due to statement timeout`). Yüz binlerce+ satıra index ekleyen migration'ın EN BAŞINA `SET statement_timeout = 0;` koy — yoksa migration yarıda kesilir. (Boş/yeni kurulumda risk yok; toplu veri biriktikten sonra index eklerken kritik.)

## Operasyonel Bakım

- **`statement_timeout=50s`** aktif (uzun sorgu otomatik iptal; `pg_db_role_setting`'den 2026-06-12 doğrulandı). DB-level: `ALTER DATABASE <db> SET statement_timeout = '50s'` — migration ile değil, manuel uygulanır. DB adı ortama göre: dev=`adnansahin_db` (.env), Windows production=`TeksErpDb` (installer). Detay: ARCHITECTURE.md §10.1.
- **Slow query log** (`>500ms`) PostgreSQL log dosyasına düşer — **yalnız üretim kurulumunda** (`manage.ps1` conf `log_min_duration_statement=500`). Dev'de kapalı (`-1`); açmak istersen `ALTER DATABASE adnansahin_db SET log_min_duration_statement = 500` (D-16).
- **SystemLog arşivi OTOMATİK** (`jobs/archive-scheduler.ts`, `server.ts`'te aktif — server start +60sn, 24 saatte bir kontrol, 30 günde bir 6 aydan eskiyi taşır). Manuel `POST /api/admin/system-logs/archive { "monthsToKeep": 6 }` yalnız acil disk baskısında (idempotent, `archived=0` dönene kadar). (B-11: eskiden manuel talimattı, artık otomasyon önde.)
- **6 ayda bir** (arşivle birlikte) `POST /api/admin/sessions/purge { "olderThanDays": 90 }` — jti registry'nin ölü satırları temizlenir; aktif oturumlar matematiksel kapsam dışı.
- **3 ayda bir** ARCHITECTURE.md §10.2 sağlık kontrolü + **`psql <db> -f scripts/consistency-check.sql`** (D-9: shippedQty mutabakatı — DB seddi olmayan tek denormalize alan; drift olursa karşılanma/MRP sessizce yanlışlanır).
- **Şema tip konvansiyonu (O-11):** yeni `DateTime` kolonları `@db.Timestamptz`; mevcutlara dokunma (rewrite maliyetli). Raw SQL bakım scriptlerinde `timestamp` kolonuyla karşılaştırırken `now() AT TIME ZONE 'UTC'` kullan (Europe/Istanbul'da 3 saat kayma tuzağı). Yeni UUID taşıyan kolon FK olmasa bile `@db.Uuid` (D-14).
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
- [ ] Dış referans ID'leri (`itemId`/`colorId`/`propertyId`...) var-mı + `isActive` doğrulandı
- [ ] `@unique` numara/barkod üretiyorsa `withBarcodeRetry` + sequence okuma closure/tx İÇİNDE (`utils/barcode-retry.ts`)
- [ ] Durum geçişi/tüketim → **atomik claim**: `updateMany WHERE {id, beklenen-durum}` + `count===0` → 409; `findUnique→if→update` check-then-act YASAK (claim sonrası içerik tx İÇİNDE taze yüklenir)
- [ ] Mobil ekranın dokunacağı endpoint → `requireAnyPermission('<web-izni>', ...MOBILE_X)` (sadece `requirePermission` = saha kullanıcısı 403)
- [ ] Decimal kolonda JS float aritmetiği yok — DB-side `increment`/`decrement` veya `Prisma.Decimal` (`.plus()/.minus()`)
- [ ] Depo çuvalı içeriğine dokunuyorsa önce `touchWarehouseSackTx` (WHERE shipmentId IS NULL — sevkiyata atanmış çuvalı reddeder); PLANNED sevkiyatın çuval kümesini değiştiriyorsan `touchShipmentPlannedTx`; çuval içeriği değişiyorsa `resetSackWeightsTx` (bayat kg irsaliyeye gitmesin)

## Test Scriptleri

Test altyapısı `scripts/test_*.ts` dosyalarıdır — **jest/vitest YOK, kurma** (Allowed Packages listesi). Sözleşme:

- Server'sız entegrasyon: service sınıfı + prisma doğrudan import edilir, HTTP yok; `npx tsx scripts/test_X.ts` ile tek tek koşar. **Toplu koşucu:** `npm test` = `tsx scripts/run-all-tests.ts` (tüm `test_*.ts`'i toplar).
- Fixture: seed master-data'sı business-key ile çözülür (**hardcoded UUID yazma** — reseed'de kırılır); üretilen veri `TEST-` prefix'li benzersiz kodlarla.
- Çıktı: ✅/❌ `check(label, ok)` sayaçları + sonda `=== Sonuç: N geçti, M başarısız ===` + `process.exit(fail > 0 ? 1 : 0)`.
- Cleanup `finally` bloğunda (test kendi yarattığını siler) + `prisma.$disconnect()`.

## Version Gotchas

- **Zod v4:** `z.record(z.string(), z.unknown())` — iki arg.
- **Express 5:** `req.params.id` bazen `as string` cast ister.
- **Prisma 7:** Şema değişikliği sonrası `npm run prisma:generate` zorunlu.
