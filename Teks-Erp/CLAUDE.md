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

`requirePermission(code)` → `req.user.permissions[]` array. Permissions doğrudan kullanıcıya bağlanır (`UserPermission`), tekrar kullanım için `PermissionTemplate` var (rol modeli **yok**). Toplam **58 permission**, **10 modül**:

| Modül | Permissions |
|---|---|
| SALES | `order:read/write`, `customer:read/write`, `customer-alias:read/write` |
| PRODUCTION | `workorder:read/write`, `workorder:distribute` (kurşun dağıtım — bypass düzeni), `roll:read/write`, `roll:manual-adjust`, `station:read/write` |
| MASTER_DATA | `item:read/write` |
| QUALITY | `quality:read/write`, `property:read/write` |
| SUBCONTRACTOR | `subcontractor:read/write` |
| KARTELA | `kartela:read/write` |
| LOGISTICS | `label:read`, `label:print`, `label:edit`, `label-template:read/write`, `shipping:read/write`, `return:read/write` |
| REPORTS | `report:production/sales/quality/inventory/subcontract/customer/audit` |
| ADMIN | `admin:users`, `admin:settings`, `admin:*` (wildcard) |
| MOBILE | `mobile:kk1/kk2-kursun/tambur/depo/fason-sevk/fason-kabul/kartela-sevk/kartela-kabul/tarti-paket/sevkiyat/iade/hizli-is-emri`, `mobile:kursun-dagitim` (Kurşun Dağıtım ekranı — `workorder:distribute`'in mobil ikizi), `mobile:kk1-desen` (KK1-içi yetenek: seçili operatöre yeni desen oluşturma), `mobile:*` (wildcard) |

> Eski `shipment:*` ve `allocation:*` permission'ları 2026-05-25'te silindi; yeni sevkiyat yazımıyla `shipping:read/write` + `return:read/write` (LOGISTICS) ve mobil ekran izinleri geldi.

Yeni endpoint yazarken `requirePermission(code)`'daki `code` **DB'de olmalı** (yoksa Admin dışı kullanıcılar 403 alır). Yeni permission eklerken **İKİ** dosyaya yaz:

1. **`seed.ts`** — taze kurulum için (seed yalnız ilk kurulumda koşar).
2. **Bir veri migration'ı** — mevcut fabrikalar için. `INSERT ... ON CONFLICT ("code") DO NOTHING` ile idempotent. Emsal: `20260801020000_kursun_bypass_permission_catalog`.

**Neden migration (2026-08-01'de değişti):** izin kodu, `requirePermission` yazıldığı anda kodun sözleşmesinin parçası olur ve ortama göre değişmez — yani şema gibi davranır. Eskiden kural "canlı DB'ye elle INSERT et" idi; o adım **unutulabilir bir adımdı ve fiilen unutuldu** (kurşun bypass ekranı canlıya çıktı ama izin satırı olmadığı için kimse göremedi, teşhis saatler aldı). `migrate deploy` zaten deploy'un parçası → katalog kendiliğinden gelir. Migration'da veri değiştirmek repo'da zaten emsalli (`20260713092000_drop_produced_roll_status` toplu `UPDATE` yapıyor).

**Migration'a NE GİRMEZ:** kullanıcı→izin ATAMALARI ve fabrikanın düzenlemiş olabileceği şablon içerikleri — bunlar ortama özgüdür, panelden veya `scripts/sync-*-permissions.ts` deseniyle verilir. Kural: *katalog migration'a, atama script'e.*

Detay: ARCHITECTURE.md §6.

## Database Performance Rules (her zaman uygula)

> Üretim yüzbinlerce satır barındıracak; ERP yıllarca yerel sunucuda çalışacak. Detay + örnekler: ARCHITECTURE.md §9, §10.1, §10.2.

1. **FK index zorunlu.** Her `@relation` kolonuna `@@index([fkColumn])` — Prisma otomatik yapmaz. (Bilinçli istisna: düşük-trafik "kim yaptı" audit FK'ları — `printedById`, `grantedById`, `updatedById` gibi — sorgulanmadıkça indexlenmez; sorgu yolu doğarsa eklenir.)
2. **Composite index sırası:** Eşitlik kolonları önce, range/order sonra. Örn: `[status, createdAt]` ✓, `[createdAt, status]` ✗.
3. **Sık birlikte filtrelenen kolonlar = tek composite.** İki ayrı index bitmap scan'e zorlar.
4. **Null-yoğun / soft-delete tablolarda partial index.** `WHERE col IS NOT NULL` veya `WHERE isActive = true` — raw SQL migration ile (Prisma şemada native değil). **Drift-free yöntem:** şemada `@@index([col])` BIRAK, migration `DROP INDEX ... ; CREATE INDEX ... WHERE ...` ile partial'a çevir — Prisma 7 **predicate** farkını drift saymaz (test edildi) ama **index↔unique** farkını SAYAR (`schema.prisma:1603-1605`: aksi halde `migrate dev` sonsuz CREATE üretir → partial unique için şemada `@@unique` kullan). `items`/`customers` partial'ı henüz YOK (gerekirse aynı yöntemle).
    - **⚠️ Şema-dışı nesneler mekanik korunuyor — `scripts/test_db_invariants.ts`.** Aktif envanter (26 partial index + 25 CHECK constraint + 2 DEFERRABLE composite FK + 1 extended statistics) o dosyada yaşar ve `npm test` ile koşar; predicate düşerse / nesne kaybolursa test DÜŞER. **Yeni partial index veya CHECK eklediğinde beklenen listeye de yaz** (guard envanter-dışı nesneyi uyarı olarak bildirir). Neden gerekli: `20260611084953_native_uuid_pk_fk` FK kolonlarını DROP+ADD ederek 9 partial index'i sessizce TAM index'e çevirdi, `20260612100000` elle onardı — CI `migrate deploy`'u boş DB'de doğruladığı için yakalamadı. Gerekçeli tablo: ARCHITECTURE.md §10.
    - **⚠️ `sacks` composite FK drift'i:** `migrate dev` `rolls_sackId_shipmentId_consistency_fkey` + `swatches_...` FK'larını **her diff'te** DROP etmek ister (datamodel'de temsil edilemezler). `--create-only` ile üret, `DropForeignKey` satırlarını SİL. Bkz. `schema.prisma:2557-2558`.
    - **⚠️ ELLE YAZILAN MIGRATION: `git add` EDİLMEDEN `db execute` KOŞULMAZ.** Sıra **her zaman** `git add` → `prisma db execute` → `migrate resolve --applied` → DOĞRULA. Neden: 2026-07-30'da üç migration dev'e uygulandı ama git'e hiç girmedi; dev tarafında her şey normal görünüyordu (dizinde var + `_prisma_migrations`'ta "uygulandı") ve eksik olan tek şey commit'ti. `migrate deploy` yalnız dizindeki dosyaları uygular → production'da kolon/enum hiç oluşmaz, deploy "başarılı" der, sonra kolonu okuyan **her** yol P2022/500 verir. Mekanik bekçiler: `npm run check:migrations` (git tarafı — untracked/modified migration + untracked `test_*.ts`) ve `npx tsx scripts/test_migration_hygiene.ts` (DB tarafı — DB'de var/dizinde yok, pending, elle-resolve edilmişler).
    - **⚠️ `migrate resolve --applied` SQL'in KOŞTUĞUNU DOĞRULAMAZ** — yalnız `_prisma_migrations`'a `applied_steps_count = 0` ile satır yazar. `statement_timeout=50s` ile yarıda kesilen bir DDL de sessizce "uygulandı" görünür (D-23). Bu yüzden `resolve` sonrası **doğrulama adımı opsiyonel değil**: `\d+ <tablo>` / `pg_enum` / `pg_index.indisvalid`.
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

- **`statement_timeout=50s`** aktif (uzun sorgu otomatik iptal; `pg_db_role_setting`'den 2026-06-12 doğrulandı). DB-level: `ALTER DATABASE <db> SET statement_timeout = '50s'` — migration ile değil, manuel uygulanır. DB adı ortama göre: dev=`adnansahin_db` (.env), sahadaki Windows sunucu=**`tekserp`** (PostgreSQL 16.9, `C:\Etkili-Yazilim\pgsql`; eski installer'ın `TeksErpDb` adı kullanılmadı). Detay: ARCHITECTURE.md §10.1 + `docs/ops/DEPLOY-RUNBOOK.md` "Sahadaki kurulum" tablosu.
- **Slow query log** (`>500ms`) PostgreSQL log dosyasına düşer — **yalnız üretim kurulumunda** (`postgresql.conf` → `log_min_duration_statement=500`; değerlerin kaydı `docs/ops/DEPLOY-RUNBOOK.md §6`). Dev'de kapalı (`-1`); açmak istersen `ALTER DATABASE adnansahin_db SET log_min_duration_statement = 500` (D-16).
- **Yedekleme backend'e ait** (2026-07-30): `services/backup.service.ts` + `jobs/backup-scheduler.ts` — `pg_dump` ayrı child process'te koşar (backend bloklanmaz), sonra bütünlük doğrulama (`verifyBackupFile` → `pg_restore --list`) → 14'lük rotasyon → offsite kopya. `BACKUP_DIR` tanımsızsa **yedek alınmaz**. Yedek saati `SystemSetting backup.hour` (panelden ayarlanır, restart gerekmez). Eski `manage.ps1` + Görev Zamanlayıcı zinciri kaldırıldı.
- **Gece yedeğinin sahibi ORTAMA GÖRE değişir (2026-07-31):** sahadaki sunucuda yedeği bağımsız bir Windows Görev Zamanlayıcı görevi alıyor (`TeksERP-DB-Backup` → `yedekle.ps1`, 02:00, 30 gün) — **backend çökmüşken bile yedek alınsın** diye bilinçli. Orada backend zamanlayıcısı `BACKUP_SCHEDULE_ENABLED=false` ile KAPALI; ikisi birden açık kalırsa her gece iki dump alınır. Saklama **GÜN bazlı** (`BACKUP_RETENTION_DAYS`, varsayılan 30) — eski "en yeni 14 dosya" politikası aynı klasöre yazan harici script'in 30 günlük geçmişini sessizce siliyordu. Yaşına bakılmaksızın en yeni 3 dosya korunur (sistem saati kayması sigortası).
- **Yedek ön ekleri = yaşam döngüsü** (`services/helpers/backup-naming.helper.ts` TEK KAYNAK): `tekserp_` rotasyona **girer** (silinebilir) · `premigrate_` ve `pre-restore_` rotasyon **dışı**. Rotasyon filtresi yalnız `tekserp_`'e bakar — bu, geri yükleme güvenlik ağının dayandığı invariant. Cutoff çözümlemesi `min(ad damgası, mtime)`: ad damgası dump BAŞLANGICI (pg_dump snapshot'ı orada alır), mtime BİTİŞ; mtime tek başına kullanılırsa dump süresince oluşan kayıtlar "kaybolmayacak" sayılır.
- **Kopyaya geri yükleme** (2026-07-30, `db-copy.service.ts` + `db-copy-verify.service.ts` + `routes/db-copy.routes.ts`): yedek CANLI DB'ye değil `<canlı>_restore_<damga>` adlı yeni bir veritabanına yüklenir, doğrulanır, sonra iki `ALTER DATABASE RENAME` ile takas edilir (`DATABASE_URL` değişmez, geri alma = ters rename). **Üç sezgiye aykırı kural:** (1) per-DB ayarlar (`statement_timeout`) `pg_db_role_setting.setdatabase` **OID**'sine bağlı → rename ile TAŞINMAZ, Faz A replay eder ve doğrulama eşitliği `fail` sayar; (2) `CREATE DATABASE` **`TEMPLATE template0`** şart — PG farklı locale'i yalnız onunla kabul eder, canlıyı şablon almak backend bağlı olduğu için hep patlar; (3) doğrulamada **`applied_steps_count` KULLANILMAZ** (D-23: 130 migration'ın 8'i meşru sıfır). Silme **ALLOWLIST**'lidir (`isRestoreCopyName`), `_old_` DB'lerinin silme ucu YOK. Otomatik retention YOK.
- **Geri yükleme bilinçli olarak backend'de DEĞİL** (elle, `pm2 stop` + `pg_restore`) — `pg_restore --clean` şemayı düşürür, backend kendi havuzu ayaktayken bunu güvenilir yapamaz. Panel üç katmanlı onay verir: kayıp önizlemesi (`backup-impact.service.ts`, `GET /api/admin/backups/:name/restore-impact`) → yazarak onaylama (DB adı) → doğrulanmış güvenlik yedeği. **Sayımlar yalnız INSERT yakalar**; UPDATE hacmi audit rollup'ından gelir ve audit kapsamı yetmezse **"ölçülemedi" yazılır, 0 YAZILMAZ**. Komut bloğunun `$LASTEXITCODE = 1` sıfırlaması + `if ($ok)` guard'ı load-bearing (bkz. `docs/ops/DEPLOY-RUNBOOK.md §5`).
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
      - **BİLİNÇLİ İSTİSNA — `Sack.notes` (çuval notu):** `setSackNotes` bu guard'ı **KULLANMAZ** ve `resetSackWeightsTx` de nota **DOKUNMAZ**. Not ne ölçüm ne içeriktir (annotation, `Shipment.dispatchNote` ile aynı gerekçe) → sevkiyata atanmış / sevk EDİLMİŞ çuvala da yazılabilir ("müşteri şikayet etti"). Guard'ı "eksik" sanıp **EKLEME** — eklersen özellik sessizce 409'a düşer. Regresyon testi: `scripts/test_sack_notes.ts` (8b/9).

## Test Scriptleri

Test altyapısı `scripts/test_*.ts` dosyalarıdır — **jest/vitest YOK, kurma** (Allowed Packages listesi). Sözleşme:

- Server'sız entegrasyon: service sınıfı + prisma doğrudan import edilir, HTTP yok; `npx tsx scripts/test_X.ts` ile tek tek koşar. **Toplu koşucu:** `npm test` = `tsx scripts/run-all-tests.ts` (tüm `test_*.ts`'i toplar).
- Fixture: seed master-data'sı business-key ile çözülür (**hardcoded UUID yazma** — reseed'de kırılır); üretilen veri `TEST-` prefix'li benzersiz kodlarla.
- Çıktı: ✅/❌ `check(label, ok)` sayaçları + sonda `=== Sonuç: N geçti, M başarısız ===` + `process.exit(fail > 0 ? 1 : 0)`.
- Cleanup `finally` bloğunda (test kendi yarattığını siler) + `prisma.$disconnect()`.
- **⚠️ ÇIKIŞ: `$disconnect()` TEK BAŞINA YETMEZ.** `lib/prisma.ts` havuzu
  `idleTimeoutMillis: 600_000` ile kuruyor → idle client handle'ı event loop'u 10 dk
  açık tutabilir ve script "bitti ama çıkmadı" durumunda kalır (koşucu 180sn'de
  SIGTERM'ler, test ZAMAN AŞIMI sayılır). İki geçerli kapanış: `process.exit(fail>0?1:0)`
  (çoğu test böyle) **ya da** `await prisma.$disconnect(); await pool.end();`. Uzun
  rapor basan scriptlerde `pool.end()` tercih edilir — `process.exit` boruya yazarken
  stdout'u kırpabilir. (2026-07-30: `test_qc2_idempotency.ts` CI'da tam bu yüzden
  180sn takıldı; yerelde görünmedi çünkü dev DB dolu olduğu için erken-dönüş yoluna
  hiç girilmiyordu.)
- **Ortamdaki veriye BAĞIMLI OLMA.** `findFirst()` ile "herhangi bir çuval/top" bulup
  üzerine test kurma — dev DB dolu olduğu için yerelde geçer, TEMİZ CI DB'sinde düşer.
  Fixture'ı test kendisi yaratır. (CI seed'i `npm run seed` + `npm run seed:fixtures`
  koşar: ilki temiz fabrika, ikincisi PATOS/MAVI/MUS-001 gibi iş fixture'ları.)

## Version Gotchas

- **Zod v4:** `z.record(z.string(), z.unknown())` — iki arg.
- **Express 5:** `req.params.id` bazen `as string` cast ister.
- **Prisma 7:** Şema değişikliği sonrası `npm run prisma:generate` zorunlu.
