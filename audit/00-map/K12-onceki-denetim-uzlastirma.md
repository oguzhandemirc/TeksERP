# K12 — Önceki denetimlerle uzlaştırma (aşama ① KEŞİF, 2026-08-28)

> **Ne bu:** 2026-08-09/10 defterinin (`audit/FINDINGS.jsonl`, 49 bulgu) ve 2026-07-08 DB denetiminin
> (`Teks-Erp/DB-MIMARI-DENETIM.md` §0/§0.1) **güncel koda karşı** uzlaştırması + yüzey belgelerinin
> (`audit/surface/09`, `12`, `PLAN.md §1`) sayısal iddialarının yeniden ölçümü. **Yargı yok, bulgu yok** —
> yalnız harita ve ② denetçileri için HOTSPOT işaretleri.
>
> **Ölçüm ortamı:** dal `adnansahin`, HEAD `ce8681d1`; dev DB `adnansahin_db` (195 migration, test kalıntılı)
> ve prod kopyası `tekserp_saha_0825` (190 migration) — ikisi de `audit/tools/sql-*.sh` ile salt-okunur.
> Canlı sunucuya erişim YOK; "sunucu tarafı" diyen her satır doğrulanamamıştır ve öyle işaretlidir.
> Her satır `dosya:satır` kanıtlıdır (yol repo köküne göre); emin olunmayanlar `[VARSAYIM]`.
>
> **Yöntem:** `jq -s 'group_by(.id)|map(.[-1])'` ile 49 geçerli satır → her biri için evidence/fix_sketch/
> verification alanındaki somut iddia güncel kodda grep/sed ile arandı; bekçi dosyaları `ls` + `git log -1`
> ile tarihlendi; DB olguları iki kopyada sorgulandı. Sınıflar: **KAPANMIŞ** (düzeltme kodda, kanıt satırı var) ·
> **RED GEÇERLİ** (reddedilme gerekçesi bugün de tutuyor) · **HÂLÂ AÇIK** (aksiyon bekliyor) ·
> **GEÇERLİ ÖLÇÜM** (bulgu değil, kayıt; hâlâ doğru — bayatsa belirtildi) · **KISMEN** ·
> **GEÇERSİZ** (kod değişti ya da defterin kendi ölçümü yanlıştı) · **DOĞRULANAMADI**.

---

## 0. Özet

| Sınıf | Adet | Hangi id'ler |
|---|---:|---|
| **KAPANMIŞ** (kanıt satırı var) | **27** | 26 `duzeltildi` satırının 26'sı + `F-CORE-VER-006` (`acik` idi, kod değişince kapandı) |
| **RED GEÇERLİ** | **8** | `F-CORE-API-004`, `F-CORE-GUV-005`, `F-CORE-OPS-007`, `F-CORE-VER-003`, `F-CORE-VER-007`, `F-KIM-GUV-002`, `F-OPS-VER-007`, `F-SEV-DOG-002` |
| **HÂLÂ AÇIK** (aksiyon bekliyor) | **5** | `F-OPS-VER-001` (`.env` git'te — yüksek), `F-OPS-VER-003` (offsite yapılandırma boş), `F-OPS-VER-006` (logrotate — sunucu; repo tarafı kapandı), `F-CORE-GUV-006` (bekçi yazılmadı), `F-CORE-VER-008` (bilinçli takas) |
| **GEÇERLİ ÖLÇÜM KAYDI** (bulgu değil) | **7** | `F-BLG-MIM-002`, `F-CORE-API-003`, `F-CORE-VER-005` (+ölçüm düzeltmesi), `F-IST-ESZ-002`, `F-OPS-VER-009` (PLAN metni düzeltilmedi), `F-SEV-DOG-001` (kapsam büyüdü), `F-SEV-ESZ-003` (bayat: 42→44) |
| **KISMEN / KOD DEĞİŞTİ** | **1** | `F-FAS-ESZ-002` (kabul şeması yeniden yazıldı — yeniden ölçülmeli) |
| **GEÇERSİZ** (defterin ölçümü yanlıştı) | **1** | `F-OPS-VER-008` (db-copy uçları 2026-07-30'dan beri ÇİFT guard'lı; "tek izin" iddiası dosyanın o günkü hâliyle çelişiyor) |
| **YENİDEN AÇILMASI GEREKEN** (`duzeltildi` denip kodda bulunamayan) | **0** | — (3 satırda defterin KENDİ beyan ettiği "kısmen": `F-CORE-OPS-001`, `F-CORE-VER-002`, `F-KIM-GUV-001`; aşağıda) |

**26 `duzeltildi` satırının 26'sı için düzeltme kodda bulundu ve 25'inin kalıcı bekçisi `scripts/` altında duruyor**
(tek istisna `F-CORE-VER-004`: yalnız yorum düzeltmesi, bekçi gerekmiyor). Düzeltmelerin ana commit'i
`dbb452d9` (2026-08-10, "12 hücrelik backend denetiminin 25 düzeltmesi + 8 yeni bekçi"); barkod rezervasyonu
ve offsite süpürücü ayrı commit'lerde (`b9220fbb`, `d0575389`, `95845f48`).

---

## 1. Uzlaştırma tablosu (49 satır)

Sütunlar: defterdeki son durum · defterdeki çıpa · **güncel sınıf** · güncel kanıt (dosya:satır) / not.
Şiddet defterdeki değerdir. Başlıklar kısaltıldı; tam metin `audit/FINDINGS.jsonl`.

### 1.1 BLG.mimari

| # | id | şiddet | defter | defter çıpası | başlık (kısa) | **GÜNCEL** | kanıt / not |
|---|---|---|---|---|---|---|---|
| 1 | F-BLG-MIM-001 | orta | duzeltildi | `Teks-Erp/src/types/label.types.ts:1` | Etiket tip sözleşmesi 1.991 satırlık servisin içindeydi; value döngüsü riski | **KAPANMIŞ** | Dosya var (5.483 B, son değişiklik 2026-08-13); `^export (const\|function\|let\|class\|enum)` grep **0** → değer ihraç etmiyor; 9 dosya `types/label.types` import ediyor. Bekçi `Teks-Erp/scripts/test_import_cycles.ts` (235 satır, `dbb452d9` 2026-08-10) — value/type kenarlarını ayırıp Tarjan koşturur. |
| 2 | F-BLG-MIM-002 | bilgi | acik | `Teks-Erp/src/config/label-elements.ts:590` | Beş render yolu tek `prepareElements`ten geçiyor; dört kapının bekçisi var | **GEÇERLİ ÖLÇÜM** | 5 çağrı yeri aynen: `label-canvas-native.helper.ts:219,367,499` · `label-canvas-html.helper.ts:76` · `raster/raster-canvas.ts:43`. `expandMultilineText` hâlâ `export` (`label-elements.ts:526`); doğrudan çağıran **0** (yalnız `:594` iç çağrı + 3 yorum satırı). Öneri (export'u kaldırmak) uygulanmadı — risk yalnız yorumla korunuyor (`:586-587`). |

### 1.2 CORE.API

| # | id | şiddet | defter | defter çıpası | başlık (kısa) | **GÜNCEL** | kanıt / not |
|---|---|---|---|---|---|---|---|
| 3 | F-CORE-API-001 | yuksek | duzeltildi | `Teks-Erp/src/services/accounting-export.service.ts:125` | Muhasebe Excel'inde çoklu müşteri filtresi sessizce düşüyordu | **KAPANMIŞ** | `accounting-export.service.ts:30-31` import, `:141-151` `readFilterList` + `readIdCondition` (tek değer düz eşitlik, N değer `{in}`); bekçi `scripts/test_filter_multi_select.ts` §7 (571 satır, `a5926d69` 2026-08-13). |
| 4 | F-CORE-API-002 | orta | duzeltildi | `Teks-Erp/scripts/test_controller_binds.ts:72` | Bind bekçisi yalnız `controller/ctrl/c` değişken adlarını görüyordu | **KAPANMIŞ** | `test_controller_binds.ts:47-48` `MIN_HANDLERS = 120` / `MIN_ROUTE_REFS = 300`; `:108` "binds.size===0 dalı KALDIRILDI (F-CORE-API-002)"; `:115` `handlers.length === 0`. |
| 5 | F-CORE-API-003 | bilgi | acik | `Teks-Erp/src/types/api.types.ts:1` | Yanıt zarfı / durum kodu disiplini ölçüldü — tutarlı | **GEÇERLİ ÖLÇÜM (güncellendi)** | Bugün (controllers+routes): `.json(` **510** (defter 427 `res.json(`), `res.status(201)` **48** (46), `(200)` **385** (336), `(204)` **3**. `details` içine `err.message/stack/sql` grep **0** ✓. `req.user!` **4** (defter 3): `middlewares/rbac.middleware.ts:81`, `controllers/work-session.controller.ts:54,59`, **yeni** `routes/config-bundle.routes.ts:51` (verifyToken'lı route'lardan çağrılan yardımcı; `:106-109`, `:129-132`). `req.device!` 0. Öneri (`details` AST bekçisi) yazılmadı. |
| 6 | F-CORE-API-004 | bilgi | reddedildi | `Teks-Erp/src/utils/cursor.ts:110` | Kurcalanmış cursor 500 üretmiyor, ilk sayfaya düşüyor | **RED GEÇERLİ** | Üç decode yolu da `catch → null`: `cursor.ts:41`, `:135`, `:287`. **Red gerekçesi:** failure_mode yok; fail-safe tercih doğru, cursor filtre yeteneğinin ötesinde bir şey vermiyor. |

### 1.3 CORE.guvenlik

| # | id | şiddet | defter | defter çıpası | başlık (kısa) | **GÜNCEL** | kanıt / not |
|---|---|---|---|---|---|---|---|
| 7 | F-CORE-GUV-001 | orta | duzeltildi | `Teks-Erp/scripts/test_route_auth_coverage.ts:1` | Her ucun `verifyToken` taşıdığının mekanik bekçisi yoktu | **KAPANMIŞ** | Bekçi var (262 satır; son değişiklik `b57c9c68` **2026-08-27** — muaf listesi büyütülmüş: `/health`, `/identity`, 3 login, `/login-methods`, `/mobile-users`, `/announce`, `/status`, `/pairing-required`, `/updates/ota/:runtimeVersion/manifest` …). İki yönlü muaf denetimi `:185-207` (ölü muaf + gereksiz muaf + gerekçe zorunlu). |
| 8 | F-CORE-GUV-002 | orta | duzeltildi | `Teks-Erp/src/app.ts:295` | Kimliksiz `/health` tam operasyon panosu dönüyordu | **KAPANMIŞ** | `app.ts:479-495` public `/health` yalnız `status/message/api/db/version/time` (telemetri alanı yok; `SELECT 1`); `:338` `buildRichHealth`; `:562-567` `GET /api/admin/health` (verifyToken + admin:settings). Bekçi `test_route_auth_coverage.ts:226` §4 alan kümesi kaynaktan dondurulmuş (`message` alanı defterdeki "beş alan" listesine ek — yasak listesinde değil, test yeşil). |
| 9 | F-CORE-GUV-003 | orta | duzeltildi | `Teks-Erp/src/services/device.service.ts:163` | Kimliksiz `POST /announce` sınırsız Device satırı yaratıyordu | **KAPANMIŞ** | `device.service.ts:22` `MAX_PENDING_DEVICES = 200`, `:25` `DEVICE_LIST_LIMIT = 500`, `:89` `take`, `:180-184` 429 `PENDING_DEVICE_LIMIT`. Saha kopyası: **28 APPROVED, 0 PENDING** (defter ölçümü 27 cihaz / 9 PENDING). IP başına hız sınırı hâlâ yok (defterde bilinçli). |
| 10 | F-CORE-GUV-004 | dusuk | duzeltildi | `Teks-Erp/src/middlewares/rbac.middleware.ts:19` | Wildcard yorumu kodun tersini söylüyordu | **KAPANMIŞ** | `rbac.middleware.ts:16-33` yorum düzeltildi (F-CORE-GUV-004 atıflı); bekçi `test_permission_catalog.ts:341-357` "her izin kodu TAM BİR iki nokta taşıyor". Not: yorum "67 kod" der, katalog bugün **70** kod (`permission-catalog.ts` `code:` sayımı) — davranış etkilenmez. |
| 11 | F-CORE-GUV-005 | bilgi | reddedildi | `Teks-Erp/src/app.ts:98` | CORS origin allowlist'i yok ama somut saldırı yolu açmıyor | **RED GEÇERLİ** | `app.ts:114` `cors({ exposedHeaders: [...] })` — origin/credentials verilmemiş; cookie yok, kimlik `Authorization` başlığında. **Red gerekçesi:** CSRF uygulanmıyor; CORS `*`'ın açık bıraktığı tek şey zaten kimliksiz uçlar (ayrı bulgular 002/003). |
| 12 | F-CORE-GUV-006 | bilgi | acik | `Teks-Erp/src/services/base.service.ts:254` | BaseService filtre allowlist'i modelin TÜM skaler kolonları; bekçi yok | **HÂLÂ AÇIK** (bekçi yazılmadı) | `scripts/test_base_service_binding.ts` **YOK**. BaseService'e bağlı model bugün **14** (aynı küme): `new BaseService` → defectType, qualityGrade, machine, returnReason, customerBranch (`routes/*.ts`); `extends BaseService` → fabricProperty, color, productRecipe, order, item, route, station, peripheralDevice, customer. User/Device bağlı DEĞİL ✓. `safeFilters` `base.service.ts:424`; cursor yolunda bilerek içeride `:461-467`. |

### 1.4 CORE.ops

| # | id | şiddet | defter | defter çıpası | başlık (kısa) | **GÜNCEL** | kanıt / not |
|---|---|---|---|---|---|---|---|
| 13 | F-CORE-OPS-001 | orta | duzeltildi | `Teks-Erp/src/services/backup.service.ts:222` | Yarım `pg_dump` çıktısı taze yedek gibi görünüyordu | **KAPANMIŞ** (defter beyanı: KISMEN) | `backup.service.ts:236` `${out}.part`, `:238` `published`, `:243` `sweepStaleParts()`, `:292` yayın, `:350` yalnız yayınlanmamış dosya silinir, `:368-373` bayat `.part` budama. Bekçi `test_backup.ts` (605 satır). **Defterin kendi açık bıraktığı ayak:** kapanış bütçesi ↔ 20 sn tx bütçesi uyumsuzluğu — KUNYE `kill_timeout 8000` diyor (defter "5 sn"); ② OPS doğrulamalı `[VARSAYIM: değer sonradan 8 sn'ye çıkarıldı]`. |
| 14 | F-CORE-OPS-002 | orta | duzeltildi | `Teks-Erp/src/middlewares/error.middleware.ts:129` | Tanınmayan Prisma kodu 400 + audit yok | **KAPANMIŞ** | `error.middleware.ts:150` `SERVER_FAULT_PRISMA_CODES`, `:160` `CLIENT_DATA_PRISMA_CODES`, `:484`, `:548` kullanım. Bekçi `scripts/test_observability_contract.ts` (160 satır, `dbb452d9`). |
| 15 | F-CORE-OPS-003 | dusuk | duzeltildi | `Teks-Erp/src/app.ts:115` | `express.json` morgan/latency'den ÖNCE mount ediliyordu | **KAPANMIŞ** | Ölçülen sıra: helmet `app.ts:102` → cors `:114` → compression `:117` → morgan `:121` → latency `:128` → `express.json` `:141` → static `:158` → `resolveDevice` `:169` → requestContext `:175`. |
| 16 | F-CORE-OPS-004 | dusuk | duzeltildi | `Teks-Erp/src/jobs/job-failure.ts:1` | Havuz zaman aşımı sayacı yalnız HTTP yolundan artıyordu | **KAPANMIŞ** | `jobs/job-failure.ts:34` `reportJobFailure`; çağıranlar `archive-scheduler.ts:93`, `backup-scheduler.ts:114`, `offsite-sweeper.ts:63,71` (yeni iş de bağlı). DB: `JOB_FAILED*` kaydı dev 0 / saha 0. |
| 17 | F-CORE-OPS-005 | dusuk | duzeltildi | `Teks-Erp/src/middlewares/error.middleware.ts:227` | `errorHandler` `headersSent` kontrolü yapmıyordu | **KAPANMIŞ** | `error.middleware.ts:259` `if (res.headersSent) {` — handler'ın başında. |
| 18 | F-CORE-OPS-006 | dusuk | duzeltildi | `Teks-Erp/scripts/test_middleware_order.ts:1` | Middleware sırası kilitsizdi | **KAPANMIŞ** | Bekçi var (128 satır, `dbb452d9`); göreli sıra + errorHandler son halka + helmet/cors load-bearing ayarları. |
| 19 | F-CORE-OPS-007 | bilgi | reddedildi | `Teks-Erp/src/app.ts:352` | `/health` DB düşse de 200 dönüyor — bilinçli | **RED GEÇERLİ** | `app.ts:487` koşulsuz `res.status(200)`. **Red gerekçesi:** durum koduna bakan tüketici yok; 503 Electron'un login-öncesi sunucu testini kırar. Koşul (dış HTTP yoklayıcı gelirse `/health/ready`) hâlâ gerçekleşmedi. |

### 1.5 CORE.veri-performans

| # | id | şiddet | defter | defter çıpası | başlık (kısa) | **GÜNCEL** | kanıt / not |
|---|---|---|---|---|---|---|---|
| 20 | F-CORE-VER-001 | orta | duzeltildi | `Teks-Erp/src/services/helpers/roll-barcode.helper.ts:60` | Barkod sayacı kilidini en uzun tutan üç yol tx öncesine taşındı | **KAPANMIŞ** | `roll-barcode.helper.ts:74` `reserveRollBarcodes`, `:109` `reserveRollBarcodesInOrder`; Tambur'da tx-içi çağrı **0** — `tambur.service.ts:906` (finalize, tx öncesi), `:2462`, `:3178` (`prisma`), `:2116`, `:2775` (`generateRollBarcode(prisma…)`). Kalan **7 tx-içi** çağrı yeri: `inventory.service.ts:905` (KK1), `:4439` (kurtarma), `subcontractor.service.ts:517`, `:3046`, `workorder-batch-drop.service.ts:418`, `helpers/roll-finalize.helper.ts:172`, `helpers/roll-disposition.helper.ts:296` — bekçi muaf listesi `test_barcode_reservation.ts:52-56` (2+2+1+1+1) ile **birebir**. Toplam çağrı yeri 12 (defter 10). |
| 21 | F-CORE-VER-002 | dusuk | duzeltildi | `Teks-Erp/src/app.ts:147` | Her istek 2-3 DB sorgusu ödüyor; statik de dahil | **KAPANMIŞ** (defter beyanı: KISMEN, bilinçli) | `resolveDevice` `app.ts:169`, static `:158`'den SONRA ✓. Önbellek bilinçli yok (anlık iptal garantisi). Yoklama tabanı büyüdü: saha 28 APPROVED cihaz (defter 18). |
| 22 | F-CORE-VER-003 | bilgi | reddedildi | `Teks-Erp/src/services/customer.service.ts:366` | `labelCustomerId` guard'ı eksik sanılmıştı — ayna kolon | **RED GEÇERLİ** | `schema.prisma:1610` kolon, `:1780` partial index notu, `:1829` "SAHİPLİK DEĞİL"; `test_hard_delete_guard_coverage.ts:65-70` allowlist gerekçesi. **Red gerekçesi:** tarihsel kayıt `lastLabelSnapshot` JSON'unda; guard eklemek silinemeyen müşteri yığını üretirdi. |
| 23 | F-CORE-VER-004 | dusuk | duzeltildi | `Teks-Erp/src/controllers/tambur.controller.ts:39` | 200'lük kesim tavanı yanlış (5 sn) gerekçeyle savunuluyordu | **KAPANMIŞ** | `tambur.controller.ts:40-45` gerekçe iş miktarı + kilit süresi; "5s tx timeout" yalnız tarihsel not. Bekçi gerekmiyor (yorum). |
| 24 | F-CORE-VER-005 | bilgi | acik | `Teks-Erp/src/lib/prisma.ts:69` | Havuz 30 / max_connections 100 dengesi; tek kayıtlı olay ALMA bütçesi | **GEÇERLİ ÖLÇÜM + ÖLÇÜM DÜZELTMESİ** | `prisma.ts:69-71` `max 30 / idle 600.000 / connectionTimeout 5.000`, `:90-91` `maxWait 5.000 / timeout 20.000` — değişmedi. **Düzeltme:** `POOL_TIMEOUT` kaydı yalnız **dev DB**'de (1 adet, `2026-08-05 02:11:56+03` = defterdeki `2026-08-04T23:11:56Z`); **prod kopyasında (07-16→08-25, 10.485 satır, arşiv 0) SIFIR**. Dev DB prod'dan 2026-08-02'de çekildi → olay dev makinesine ait `[VARSAYIM: dev DB 08-02'den sonra prod'dan yeniden çekilmedi]`. Yani prod'un kayıtlı geçmişinde hiç havuz tıkanıklığı yok. `max_connections=100` yalnız YEREL sunucuda ölçüldü (prod değeri erişilemez). |
| 25 | F-CORE-VER-006 | bilgi | acik | `Teks-Erp/src/services/base.service.ts:539` | Ad-mükerrer kontrolü limitsiz `findMany` | **KAPANMIŞ (kod değişti)** | `base.service.ts:703-729`: kontrol artık tek `findFirst` + `<kolon>Fold` btree (2026-08-19), limitsiz `findMany` KALKTI; DB seddi partial UNIQUE `customers_nameFold_key`, `subcontractors_nameFold_key`, `colors_nameFoldColor_key` (saha ✓), `items_nameFold_key` **dev'de var, sahada YOK** (yumuşak kapı: mükerrer varken atlanır — kök CLAUDE.md 2026-08-22). Saha satırları: items 228, orders 278, colors 83, customers 27 (defter: 193/76/63/32). |
| 26 | F-CORE-VER-007 | bilgi | reddedildi | `Teks-Erp/src/services/base.service.ts:685` | `reactivate` nested alanları düşürmesi ULAŞILAMAZ kod | **RED GEÇERLİ (yeniden ölçüldü)** | `nestedCreateFields` artık **5** config: `order.routes.ts:73`, `fabric-property.routes.ts:38` (2 alan), `product-recipe.routes.ts:20`, `customer.routes.ts:33`, **yeni** `route.service.ts:29` (`steps`). Route `autoCode: {prefix:"ROT"}` (`route.service.ts:74`) → `create()` autoCode dalı (`base.service.ts:1024-1033`) `uniqueField` reactivate yolunu hiç açmaz; RouteService ayrıca `create/update` override ediyor (`:398`, `:403`). Yol beşinde de kapalı. |
| 27 | F-CORE-VER-008 | dusuk | acik | `Teks-Erp/src/services/tambur.service.ts:2351` | Bilinçli takas: replay tek barkod numarası boşluğu bırakıyor | **HÂLÂ AÇIK (bilinçli, kodda yazılı)** | `tambur.service.ts:2454-2462` (cutWarehouseRoll rezervasyon bloğu + gerekçe), `:3178`. Saha `roll_barcode_counters`: 38 satır, **max n = 262** — 9.999/gün/tip tavanına uzak; kapasite senaryosu teorik kalıyor. Tx-öncesi `clientToken` kapısı (fix_sketch) eklenmedi. |

### 1.6 FAS.eszamanlilik

| # | id | şiddet | defter | defter çıpası | başlık (kısa) | **GÜNCEL** | kanıt / not |
|---|---|---|---|---|---|---|---|
| 28 | F-FAS-ESZ-001 | yuksek | duzeltildi | `Teks-Erp/src/services/subcontractor.service.ts:2057` | Fason servisi WO'yu terminal guard'sız COMPLETED yapıyordu | **KAPANMIŞ** | `subcontractor.service.ts:71` import; `completeWorkOrderIfStepsDone(tx, …)` çağrıları `:2125`, `:2968`, `:3485`, `:6209` (**4** — defter 3; kısmi kabul eklemesi); çıplak `status: WorkOrderStatus.COMPLETED` grep **0**. Bekçi `scripts/test_wo_terminal_guard.ts` (198 satır). |
| 29 | F-FAS-ESZ-002 | bilgi | acik | `Teks-Erp/src/controllers/subcontractor.controller.ts:139` | Üç dev fason tx'inin döngü tavanları var ve gerekçeli | **KISMEN — KOD DEĞİŞTİ** | Sevk `rollIds max(500)` `:14`, doğrudan sevk `:33`, `:47` ✓; `withBarcodeRetry` 9 ✓. **Ama kabul şeması yeniden yazıldı** (kısmi kabul + çekme, 2026-08-19/21): defterin ölçtüğü `newRolls … max(300)` artık YOK; yerine `rollShipQtys: z.record(uuid, number)` (`:77`, **tavansız record**) + `orderLineAllocations … max(200)` (`:84-86`) + `closeRemainderSchema` (`:93-97`). Tavan ölçümü geçersiz → HOTSPOT-3. |

### 1.7 IST.eszamanlilik

| # | id | şiddet | defter | defter çıpası | başlık (kısa) | **GÜNCEL** | kanıt / not |
|---|---|---|---|---|---|---|---|
| 30 | F-IST-ESZ-001 | orta | duzeltildi | `Teks-Erp/src/services/tambur.service.ts:965` | Finalize barkod kilidini tüm döngü boyunca tutuyordu | **KAPANMIŞ** | = F-CORE-VER-001 (aynı kök neden): `tambur.service.ts:819` yorum, `:906` tx öncesi toplu rezervasyon. Bekçi `test_barcode_reservation.ts` (390 satır) T1<100 ms + T2=30/30. |
| 31 | F-IST-ESZ-002 | bilgi | acik | `Teks-Erp/src/services/kursun-bypass.service.ts:102` | Bypass marker ön eki tek kaynaktan; `exitedAt:null` claim işini görüyor | **GEÇERLİ ÖLÇÜM** | `kursun-bypass.service.ts:104` `KURSUN_BYPASS_UNASSIGNED_MARKER_PREFIX = \`${KURSUN_BYPASS_MARKER_PREFIX}:UNASSIGNED\`` (türetilmiş); `exitedAt: null` guard `helpers/roll-step.helper.ts:59`, `:368`, `helpers/kursun-bypass-eligibility.helper.ts:202`. |

### 1.8 KIM.guvenlik

| # | id | şiddet | defter | defter çıpası | başlık (kısa) | **GÜNCEL** | kanıt / not |
|---|---|---|---|---|---|---|---|
| 32 | F-KIM-GUV-001 | yuksek | duzeltildi | `Teks-Erp/src/controllers/auth.controller.ts:119` | Klasik şifre girişinde kilit/hız sınırı yoktu (hesap + DoS) | **KAPANMIŞ** (defter beyanı: KISMEN — çok-IP artık riski) | `auth.controller.ts:14-17` import; `:118-119` `reserveLoginAttempt` **`AuthService`ten ÖNCE**; `:137` reset; `:162` kimlik-dışı hatada release; `:202` ikinci yol. Bekçi `scripts/test_login_lockout_coverage.ts` (132 satır). Global eş zamanlı-bcrypt tavanı hâlâ yok (defterde bilinçli kapsam dışı). ⚠️ Ayar adı `auth.pinLockoutEnabled` şifre girişini de kapsar (defter notu duruyor). |
| 33 | F-KIM-GUV-002 | bilgi | reddedildi | `Teks-Erp/src/services/permission-management.service.ts:967` | `applyTemplate` replace modu `setUserPermissions`a devrediyor; guard orada | **RED GEÇERLİ** | Son-admin guard'ı 4 yolda kodda: `permission-management.service.ts:306-307` (setUserPermissions), `:379-389` (updateUser), `:687`, `:748`; `acquireAdminGuardLock` `:604`. **Not:** `mode === "replace"` metni bu turda grep'te eşleşmedi (satır/ifade değişmiş olabilir) — devir iddiası ② KIM tarafından yeniden okunmalı (HOTSPOT-13, düşük). **Red gerekçesi:** düz grep devri görmedi; koruma devredilen fonksiyonda. |
| 34 | F-KIM-GUV-003 | dusuk | duzeltildi | `Teks-Erp/src/services/session-registry.service.ts:24` | İki alt sistem 1-argümanlı advisory lock uzayını paylaşıyordu | **KAPANMIŞ** | `session-registry.service.ts:32` `SESSION_REGISTRY_LOCK_NS = 8024`, `permission-management.service.ts:21` `PERM_ADMIN_LOCK_NS = 8025`; 1-argümanlı `hashtext` formu src'de **0**. Namespace envanteri bugün **7** (çakışma yok): 8021 `duplicate-guard.helper.ts:28` · 8022 `batch.service.ts:96` · 8023 `shipment-locks.helper.ts:28` · 8024 · 8025 · **8026** `code-unique.helper.ts:57` (yeni) · **8027** `master-data-merge.service.ts:50` (yeni). Bekçi `test_shipment_scope_lock.ts` "1-argümanlı kalmadı" kontrolü. |

### 1.9 OPS.veri-performans

| # | id | şiddet | defter | defter çıpası | başlık (kısa) | **GÜNCEL** | kanıt / not |
|---|---|---|---|---|---|---|---|
| 35 | F-OPS-VER-001 | yuksek | dogrulandi | `Teks-Erp/.env:1` | Sır taşıyan `.env` git ile izleniyor | **HÂLÂ AÇIK** | `git ls-files` → `Teks-Erp/.env` **hâlâ izleniyor**; son dokunan commit `76f9967b` 2026-07-30 ("JWT secret rotasyonu"); `Teks-Erp/.gitignore:3` `.env` (index'te olduğu için etkisiz); `Teks-Erp/.env.example` **YOK**. Sahadaki secret ile aynı mı → doğrulanamaz (sır rapora girmez). fix_sketch adımlarından hiçbiri (rm --cached / example / rotasyon teyidi) kodda görünmüyor. |
| 36 | F-OPS-VER-002 | kritik | duzeltildi | `Teks-Erp/scripts/run-all-tests.ts:69` | Test paketi ortam kontrolsüz `DATABASE_URL`e siliyordu | **KAPANMIŞ** | `run-all-tests.ts:17` `import "dotenv/config"`, `:102` `productionDbGate()` (fail-closed), `:148` `ALLOW_NONLOCAL_TEST_DB` kaçışı (production'da atlanamaz `:115`), `:174` çağrı. **Sınır:** koruma yalnız koşucuda; 366 testin **0**'ında ortam guard'ı → `npx tsx scripts/test_x.ts` doğrudan koşumu kapıdan geçmez (HOTSPOT-9). |
| 37 | F-OPS-VER-003 | yuksek | acik | `Teks-Erp/src/jobs/offsite-sweeper.ts:1` | Offsite yedek: kod hazır, sunucuda rclone + hedef bekliyor | **HÂLÂ AÇIK (sunucu tarafı)** | Kod tamam: `jobs/offsite-sweeper.ts`, `server.ts:11,105` `startOffsiteSweeper()`, bekçi `test_offsite_sweep.ts` (336 satır, `d0575389`). Repo'daki sunucu yapılandırması **BOŞ**: `Teks-Erp/ecosystem.config.js:107` `BACKUP_SCHEDULE_ENABLED:"false"`, `:124` `BACKUP_OFFSITE_DIR:""`, `:143` `BACKUP_RCLONE_REMOTE:""`. Sunucuda rclone kurulu mu → **DOĞRULANAMADI**. PITR/WAL arşivi hâlâ yok (`docs/ops/PM2-GECIS-DEVIR-NOTU.md:189`). |
| 38 | F-OPS-VER-004 | orta | duzeltildi | `Teks-Erp/src/services/helpers/pg-tool.helper.ts:52` | `pg_dump/pg_restore` timeout'suz spawn ediliyordu | **KAPANMIŞ** | `pg-tool.helper.ts:53` `DEFAULT_TOOL_TIMEOUT_MS = 3 saat`, `:108-109` `timeout` + `killSignal: "SIGKILL"`, `:126` `timedOut` bayrağı. |
| 39 | F-OPS-VER-005 | dusuk | duzeltildi | `Teks-Erp/src/jobs/backup-scheduler.ts:94` | Yedek saati süreç saat dilimiyle hesaplanıyordu | **KAPANMIŞ** | `backup-scheduler.ts:30` import, `:95` `factoryDayStart(now).getTime() + hour*3600_000`; src'de üretim `setHours` **0** (3 yorum). Bekçi `test_report_day_boundary.ts` §4 JS tarafı. |
| 40 | F-OPS-VER-006 | orta (supheli) | acik | `ecosystem.config.js:92` | pm2 log rotasyonu repodan doğrulanamıyor; log + DB aynı disk | **KISMEN** (repo tarafı KAPANDI; sunucu doğrulanamaz) | fix_sketch'in repo ayağı yapıldı: `docs/ops/DEPLOY-RUNBOOK.md:560-562` (`pm2 install pm2-logrotate` + `max_size 10M` + `retain 14`), `docs/ops/URETIM-KONTROL-LISTESI.md:90`, `Teks-Erp/ecosystem.config.js:70` yorum. Modülün sunucuda kurulu olup olmadığı, disk doluluğu → **DOĞRULANAMADI**. Not: defterdeki yol `ecosystem.config.js` (kök) — dosya `Teks-Erp/ecosystem.config.js`tedir. `diskUsedPct` eşik uyarısı (2. öneri) → `/api/admin/health` içinde alan var, eşik/panel gösterimi ② OPS ölçmeli. |
| 41 | F-OPS-VER-007 | bilgi | reddedildi | `Teks-Erp/src/services/db-copy.service.ts:431` | Disk guard'ı zaten claim'den SONRA zorlanıyor | **RED GEÇERLİ** | `db-copy.service.ts:432-434` `if (listing.disk && !listing.disk.ok) { currentJob = null; return … }`; `evaluateDiskGuard` `:171`, `:907`. **Red gerekçesi:** `grep <fonksiyon>` dolaylı yolu (`listDbCopies` → `listing.disk`) görmedi; claim-sonrası konum 2026-07-31'de kapatılan yarışın gereği. |
| 42 | F-OPS-VER-008 | bilgi | acik | `Teks-Erp/src/routes/db-copy.routes.ts:48` | db-copy'nin beş ucu TEK izinle, indirme ÇİFT izinle — asimetri meşru | **GEÇERSİZ — defterin ölçümü yanlıştı** | `db-copy.routes.ts` beş ucun **beşi de ÇİFT guard** (`admin:settings` + `admin:users`): `:51-52`, `:80-81`, `:111-112`, `:145-146`, `:180-181`. Dosyanın **tek** commit'i `ea478488` (2026-07-30) → 2026-08-09'da da böyleydi (`git show ea478488:…` 7 `admin:users` eşleşmesi). Asimetri hiç yoktu; karar kaydı boşa yazılmış. ② bu satırı dayanak almasın. |
| 43 | F-OPS-VER-009 | bilgi | acik | `Teks-Erp/src/services/db-copy.service.ts:739` | Backend canlı DB'yi RENAME etmiyor; takas komutları metin | **GEÇERLİ ÖLÇÜM (PLAN metni düzeltilmedi)** | `db-copy.service.ts` `RENAME` grep **0**; `getSwapCommands` `:739`. `audit/PLAN.md:1118` hâlâ "iki ALTER DATABASE RENAME" — fix_sketch'teki düzeltme yapılmadı; ② C2/OPS bu öncülü kullanmasın (HOTSPOT-16). |

### 1.10 SEV.dogruluk / SEV.eszamanlilik

| # | id | şiddet | defter | defter çıpası | başlık (kısa) | **GÜNCEL** | kanıt / not |
|---|---|---|---|---|---|---|---|
| 44 | F-SEV-DOG-001 | bilgi | acik | `Teks-Erp/src/services/reports/_shipped.ts:58` | Brüt kuralı yedi yüzeyde tutarlı; yedinci yüzey `_shipped.ts` | **GEÇERLİ ÖLÇÜM — KAPSAM BÜYÜDÜ** | `_shipped.ts:74-84` `UNION ALL roll_returns … cancelledAt IS NULL` ✓. Kök `CLAUDE.md` 2026-08-09 maddesi `reports/_shipped.ts`i "TEK tanım" ilan etti (fix_sketch'in belge ayağı yapıldı); envanter bekçisi (RollReturn okuyucu listesi) **yazılmadı**. `RollReturn` okuyan servis dosyası **9** (defter 7): + `reports/batch-trace.report.service.ts`, `reports/return-scorecard.report.service.ts`, `backup-impact.service.ts`, `customer.service.ts`. Rapor katmanı **8 → 21** dosya; `_shipped.ts`i yalnız `return-scorecard` + `shipment-scorecard` kullanıyor; `batch-trace`, `order-cancellation`, `order-leadtime`, `stock-scorecard`, `subcontract-scorecard` `SHIPPED/shippedQty/dispatchedAt`i doğrudan okuyor → HOTSPOT-4. |
| 45 | F-SEV-DOG-002 | bilgi | reddedildi | `Teks-Erp/src/services/sack-search.service.ts:1` | Çuval etiketinin NET okuması kusur değil | **RED GEÇERLİ** | `sack-search.service.ts:182,322,393,414` canlı `rolls` okuması duruyor (doğru). **Red gerekçesi:** çuval fiziksel nesnedir; iade edilen top artık içinde değildir; brüt kuralı uzatılırsa etikette olmayan mal basılır. Yalnız metin ayağı yapılmadı: `docs/history/CLAUDE-NOT-ARSIVI.md:51` hâlâ "Kapsam DIŞI (bilinçli, **ayrı iş**)" — "doğru tercih" olarak düzeltilmedi. |
| 46 | F-SEV-ESZ-001 | orta | duzeltildi | `Teks-Erp/src/services/helpers/shipment-locks.helper.ts:18` | Storno bloklaması phantom'a açıktı (eş zamanlı iade) | **KAPANMIŞ** | `shipment-locks.helper.ts:28` `SHIPMENT_LOCK_NS = 8023`, `:52` `lockShipmentScopeTx`; `shipping.service.ts:2159` **tx'in ilk ifadesi** (undoDispatch; 2026-08-22 "storno + `cancelPlannedShipmentTx` aynı tx" değişikliği sonrası da önce); `return.service.ts:490` — **KOŞULLU** `if (lockShipmentId) await lockShipmentScopeTx(…)` (`orderedRolls[0]?.shipmentId`). Bekçi `test_shipment_scope_lock.ts` (182 satır). Koşul → HOTSPOT-1 (shipmentId'siz iade yolu). |
| 47 | F-SEV-ESZ-002 | dusuk | duzeltildi | `Teks-Erp/src/services/shipping.service.ts:2393` | Liste toplamı üç ayrı anlık görüntü topluyordu | **KAPANMIŞ** | `shipping.service.ts:2592` batch `prisma.$transaction([...])`, `:2610` `isolationLevel: RepeatableRead` (kod tabanındaki **tek** isolationLevel; `:145` yorum bayat — "repoda isolationLevel kullanılmıyor" der). Bekçi `test_shipment_list_gross.ts` (257 satır, `c3f6d118` 2026-08-21). |
| 48 | F-SEV-ESZ-003 | bilgi | acik | `Teks-Erp/src/services/shipping.service.ts:1691` | 42 `updateMany` sınıflandırıldı; eksik claim yok | **GEÇERLİ ÖLÇÜM — BAYAT** | `shipping.service.ts` `updateMany(` bugün **44** (defter 42); satırlar: 374 458 467 517 536 565 575 610 636 661 693 732 738 772 853 1015 1016 1062 1068 1413 1420 1421 1552 1556 1557 1574 1576 1577 1610 1635 1669 1712 1723 1812 1849 1862 1966 1977 1979 1980 1981 **2179 2186 2197**. Defterdeki satır numaraları kaydı; yeni satırlar sınıflandırılmalı (HOTSPOT-2). Öneri (claim count AST bekçisi) yazılmadı. |

### 1.11 URE.eszamanlilik

| # | id | şiddet | defter | defter çıpası | başlık (kısa) | **GÜNCEL** | kanıt / not |
|---|---|---|---|---|---|---|---|
| 49 | F-URE-ESZ-001 | dusuk | duzeltildi | `Teks-Erp/src/utils/barcode-retry.ts:48` | P2002 retry beklemesiz 5 kez koşuyordu (livelock eğilimi) | **KAPANMIŞ** | `barcode-retry.ts:37` yorum (F-URE-ESZ-001), `:49-50` `jitterMs = 5 + Math.floor(Math.random()*25)` + `setTimeout`. Bekçi `test_batch_number_format.ts` "bekleme JITTER'lı" kontrolü (394 satır). Retry kapsamı (`subcontractor.service`te 9 tam-tx sarmalama) bilinçli açık. |

---

## 2. YENİDEN AÇILMASI GEREKENLER

**`duzeltildi` denip kodda düzeltmesi bulunamayan satır: 0/26.** Aşağıdakiler yeniden AÇILMAZ ama ② okurken
bilmeli:

| id | Durum | Ne eksik / neden kayda değer |
|---|---|---|
| F-CORE-OPS-001 | KAPANMIŞ ama defter "kısmen" | Kapanış bütçesi ↔ tx bütçesi uyumsuzluğu (defterin kendi beyanı) düzeltme kapsamı dışında bırakıldı; KUNYE `kill_timeout 8000` diyor — ② OPS kapanış senaryosunu (`pm2 restart` sırasında 8-20 sn'lik tx) ayrı ölçsün. |
| F-CORE-VER-002 | KAPANMIŞ ama defter "kısmen" | Sorgu israfı ayağı kapandı; `verifyToken` 2 sorgu + `resolveDevice` 1 sorgu bilinçli (anlık iptal). Cihaz sayısı 18→28 arttı; taban maliyeti yeniden ölçmek isteyen ② CORE.veri-performans `[VARSAYIM: tablet yoklama aralığı hâlâ 5 sn]`. |
| F-KIM-GUV-001 | KAPANMIŞ ama defter "kısmen" | Tek-IP kilidi var; alt ağ genelinden çok-IP doygunluğu (defterin artık riski) kapatılmadı; global bcrypt tavanı yok. |
| F-OPS-VER-008 | **GEÇERSİZ** | Defterin olgusu yanlış (bkz. satır 42). ② "db-copy tek izinle korunuyor" cümlesini hiçbir yerde tekrarlamasın. |
| F-CORE-VER-005 | ölçüm düzeltmesi | "Kayıtlı tek tıkanıklık olayı" prod'a ait değil (bkz. satır 24). 12-tx §2/§3'ün "ölçüldü" dediği olay dev makinesinde. |

---

## 3. HÂLÂ AÇIK (bu oturumun raporuna taşınacak)

| id | şiddet | Güncel durum | ② hangi hücre bakmalı |
|---|---|---|---|
| **F-OPS-VER-001** | yuksek | `Teks-Erp/.env` git'te izleniyor (`76f9967b`), `.env.example` yok, rotasyon teyidi yok | OPS.veri-performans + KIM.guvenlik |
| **F-OPS-VER-003** | yuksek | Offsite kod + bekçi hazır; `ecosystem.config.js:124,143` boş; rclone sunucuda doğrulanamaz; PITR yok | OPS.veri-performans / OPS.ops |
| **F-OPS-VER-006** | orta (supheli) | Repo dokümantasyonu yapıldı (`DEPLOY-RUNBOOK.md:560-562`); sunucu kurulumu doğrulanamaz; diskUsedPct eşiği panelde var mı ölçülmedi | OPS.ops |
| **F-CORE-GUV-006** | bilgi | `test_base_service_binding.ts` yazılmadı; 14 bağlı model, sır kolonlu model bağlı değil | CORE.guvenlik |
| **F-CORE-VER-008** | dusuk | Bilinçli barkod boşluğu; saha sayaç max 262/gün → risk teorik | IST.eszamanlilik (bilgi) |
| F-FAS-ESZ-002 | bilgi → yeniden ölçüm | Kabul şeması değişti: `rollShipQtys` tavansız record; eski 300 tavanı yok | FAS.eszamanlilik |
| F-SEV-ESZ-003 | bilgi → yeniden ölçüm | 42→44 `updateMany`; 2179/2186/2197 yeni | SEV.eszamanlilik |
| F-SEV-DOG-001 | bilgi → yeniden ölçüm | 9 RollReturn okuyucu + 21 rapor; brüt tek tanım dışında 5 rapor | SEV.dogruluk + RAP.dogruluk |
| F-OPS-VER-009 | bilgi | `audit/PLAN.md:1118` yanlış öncül düzeltilmedi | (plan bakımı) |
| F-SEV-DOG-002 | bilgi (red) | `CLAUDE-NOT-ARSIVI.md:51` "ayrı iş" ifadesi düzeltilmedi | (belge bakımı) |

---

## 4. Reddedilenlerin gerekçe özeti (② yeni kanıt olmadan yeniden AÇMASIN)

| id | Reddin özü | Bugün de tutuyor mu |
|---|---|---|
| F-CORE-API-004 | Bozuk cursor `null` → ilk sayfa; 500 yok, Prisma'ya ham değer sızmıyor; cursor filtre yeteneğinin ötesinde yetki vermiyor | Evet (`cursor.ts:41,135,287`) |
| F-CORE-GUV-005 | Cookie yok, `Allow-Credentials` basılmıyor → CSRF uygulanmıyor; CORS `*` yalnız zaten kimliksiz uçları tarayıcıya açıyor (onlar 002/003) | Evet (`app.ts:114`) |
| F-CORE-OPS-007 | `/health` 200: durum koduna bakan tüketici yok; 503 Electron login-öncesi sunucu testini kırar | Evet (`app.ts:487`) |
| F-CORE-VER-003 | `Roll.labelCustomerId` ayna kolon; tarihsel kayıt `lastLabelSnapshot` JSON'unda (id + ad) | Evet (`schema.prisma:1829`; allowlist `test_hard_delete_guard_coverage.ts:65-70`) |
| F-CORE-VER-007 | `reactivate` yalnız istemci-kontrollü `uniqueField` çakışmasında koşar; nested taşıyan modellerin kodu backend-authoritative | Evet — 5. model (`route`) de `autoCode ROT` (`route.service.ts:74`) |
| F-KIM-GUV-002 | Guard devredilen `setUserPermissions`ta; düz grep devri görmedi | Guard'lar duruyor (`:306-307` vd.); devir satırı yeniden okunmalı (HOTSPOT-13) |
| F-OPS-VER-007 | Disk guard'ı `listDbCopies()` üzerinden dolaylı; claim-sonrası konum 2026-07-31 yarış düzeltmesinin gereği | Evet (`db-copy.service.ts:432-434`) |
| F-SEV-DOG-002 | Çuval etiketi fiziksel içerik sorusu; brüt kuralı uzatılırsa etikette olmayan mal | Evet (`sack-search.service.ts:414`) |

**Üç reddin ortak dersi (defterin kendi tespiti):** "guard yok" cümlesi düz grep ile söylenmez — devir
(`applyTemplate→setUserPermissions`), ikinci saklama katmanı (`lastLabelSnapshot`), ara toplayıcı
(`listDbCopies→listing.disk`). ② ajanları `SKILL.md §7.8`'i (altı guard kaynağı) bu üç örnekle birlikte okusun.

---

## 5. EKİBİN DOĞRU YAPTIKLARI — tohum listesi

Kapanmış bulgular + **kalıcı bekçileri** (dosya · satır · son commit). Hepsi `npm test` koşucusuna dahil
(`scripts/test_*.ts`). ② raporunun "güçlü yönler" bölümü buradan beslenmeli.

| Alan | Ne yapıldı | Kalıcı bekçi (`Teks-Erp/scripts/`) |
|---|---|---|
| Kimlik doğrulama kapsaması | Her route layer'ında `verifyToken` + gerekçeli, iki yönlü muaf listesi | `test_route_auth_coverage.ts` 262 · `b57c9c68` 2026-08-27 |
| `/health` ayrımı | Public canlılık (6 alan) ↔ `/api/admin/health` (izinli) | aynı dosya §4 (alan kümesi kaynaktan dondurulmuş) |
| Cihaz tavanı | `announce` 200 PENDING tavanı (bilinen cihaz her zaman geçer) + liste `take 500` | `test_device_activity` / `test_device_assignment` (regresyon) |
| İzin kodu biçimi | Tam bir iki nokta kuralı mekanik | `test_permission_catalog.ts` 627 · `ebbe1825` 2026-08-19 |
| Middleware sırası | Göreli sıra + load-bearing helmet/cors ayarları tek kaynakta | `test_middleware_order.ts` 128 · `dbb452d9` |
| Gözlemlenebilirlik | Prisma kod kümeleri (fail-loud), `express.json` sırası, `reportJobFailure` | `test_observability_contract.ts` 160 · `dbb452d9` |
| Yedek bütünlüğü | `.part` → doğrula → `rename`; `published` guard'ı; child `timeout`+SIGKILL | `test_backup.ts` 605 · `dbb452d9` |
| Yedek saati | `factoryDayStart` — src'de üretim `setHours` 0 | `test_report_day_boundary.ts` 261 §4 |
| Offsite süpürücü | `rclone copy` (sync DEĞİL), kapsam doğrulaması (`lsf`), `/api/admin/health.offsite` | `test_offsite_sweep.ts` 336 · `d0575389` (sahte rclone) |
| Test paketi ortam kapısı | `productionDbGate()` fail-closed, CI kalıbı geçer | `run-all-tests.ts:102` (kendisi kapı) |
| Barkod sayacı | Toplu rezervasyon tx öncesi; kalan 7 tx-içi yer iki yönlü muaf | `test_barcode_reservation.ts` 390 · T1<100 ms, T2=30/30 |
| WO terminal guard | Fason 4 yolda `completeWorkOrderIfStepsDone`; çıplak COMPLETED 0 | `test_wo_terminal_guard.ts` 198 |
| Giriş kilidi | Üç giriş yolunda rezervasyon **AuthService'ten önce** (sıra load-bearing) | `test_login_lockout_coverage.ts` 132 |
| Advisory lock namespace | 7 namespace (8021-8027), 1-argümanlı form 0, envanter dosya yorumlarında | `test_shipment_scope_lock.ts` 182 ("1-arg kalmadı") |
| Sevkiyat kapsam kilidi | `undoDispatch` + `createReturn` tx'in ilk ifadesi | aynı dosya (asıl kontrol SIRA) |
| Liste toplamı tek görüntü | batch tx + `RepeatableRead` (salt-okuma, P2034 riski yok) | `test_shipment_list_gross.ts` 257 · `c3f6d118` |
| Çoklu filtre → export | `readFilterList/readIdCondition` export yüzeyinde | `test_filter_multi_select.ts` 571 §7 |
| Bind bekçisi | Desen tabanlı tarama, körlük zemini 120/300 | `test_controller_binds.ts` 166 |
| Import döngüsü | value/type ayrımı + Tarjan (madge'ın 14 sahte döngüsü elendi) | `test_import_cycles.ts` 235 |
| P2002 retry | jitter'lı bekleme (5-30 ms) | `test_batch_number_format.ts` 394 |
| Ad-mükerrer | JS `findMany` taraması → DB `nameFold` + partial UNIQUE (3 tablo) + `search-fold.ts` JS≡SQL sözleşmesi | `test_fold_contract.ts` (BMP geneli), `test_db_invariants.ts` 793 §9, `test_master_data_name_dup` |
| DB denetimi kapanışları | `transactionOptions` (O-3), `pool.on("error")` (O-23), DEFERRABLE composite FK (O-22), `nextDailySeq` (O-4/O-21), `consistency-check.sql`+`test_consistency` (D-9) | `test_db_invariants.ts`, `test_schema_drift.ts` 236, `test_consistency.ts` 574, `test_consistency_derived.ts` 837, `test_timestamptz_contract.ts` 360 |
| Kültür | 26 düzeltmenin 24'ü **negatif sondayla** kırmızı verdiği kanıtlanmış bekçi taşıyor; iki bekçide ilk yazımın kör olduğu fark edilip düzeltildi (`F-CORE-OPS-001`, `F-CORE-OPS-002`, `F-FAS-ESZ-001` verification alanları) | — |

---

## 6. Modül kısaltmaları ve hücre matrisi (`audit/PLAN.md` §2/§4 — AYNEN)

### 6.1 Modül tablosu (PLAN.md §2 — birebir kopya, 2026-08-09 sayılarıyla)

> Sınıflama anlam esaslıdır ve 152 servis dosyasının tamamı atanmıştır (atanmamış yok).
> `CORE`, servis dosyası olmayan altyapı katmanını (+ jenerik CRUD çekirdeği) temsil eder.

| ID | Modül | Servis satırı | Route satırı | Ctrl satırı | Ana modeller | Not |
|---|---|---|---|---|---|---|
| **BLG** | Belge / Etiket | **16.527** (61 dosya) | 2.202 | 1.446 | LabelTemplate · PrintedDocument · TravelerCard | Kod tabanının en büyük context'i; 3 alt-sistem (etiket motoru, kâğıt belge, refakat kartı); 5 render yolu |
| **URE** | Üretim / İş Emri | **11.719** (16) | 1.042 | 943 | WorkOrder · Batch · Roll | `workorder.service.ts` 6.073 satır (en büyük dosya) |
| **IST** | İstasyon (Tambur + Kurşun/KK2) | **9.783** (8) | 1.515 | 1.086 | Roll · RollMovement · WorkOrderStep · RollError | `tambur.finalize` tek fonksiyonda 377 satırlık tx |
| **FAS** | Fason + Kartela | **8.244** (4) | 1.226 | 924 | SubcontractorDispatch · Receipt · Swatch | Dosya başına 2.061 satır — en yoğun; `subcontractor.service.ts` 6.055 |
| **OPS** | Sistem / Ops | **6.889** (14) | 1.968 | 0 | SystemSetting · SystemLog | Controller katmanı YOK; `admin.routes.ts` 1.293 satır iş mantığı taşıyor |
| **CORE** | Çekirdek / HTTP katmanı | ~**6.459** | — | 112 | — | `app.ts` 462 · `middlewares/` 1.067 · `base.service` 838 · `utils/` 909 · `config/` 1.372 · `lib/` 581 · `jobs/` 646 |
| **SEV** | Sevkiyat / Çuval / İade | **6.123** (7) | 561 | 661 | Sack · Shipment · RollReturn | `shipping.service.ts` 24 `$transaction` (tek dosya rekoru) |
| **ENV** | Envanter / Top | **4.697** (5) | 865 | 595 | Roll · RollMovement | Tek dosyada 4.319 satır |
| **SIP** | Sipariş / Müşteri | **4.083** (7) | 1.343 | 101 | Order · OrderLine · Customer | |
| **KIM** | Kimlik / Yetki / Oturum | **3.218** (8) | 285 + admin.routes yarısı | 846 | User · Session · Device · Permission | |
| **TAN** | Tanım / Master Data | **2.514** (8) | 2.093 | — | Item · Color · Station | 6 model kendi servisi olmadan jenerik CRUD ile yönetiliyor |
| **RAP** | Rapor / Dashboard | **1.780** (9) | 504 | 0 | (ham SQL/aggregate) | Domain servislerini **hiç import etmiyor** → kural kopyası riski |
| **DON** | Donanım / Çevre birim | **652** (4) | 187 | 0 | PeripheralDevice · Machine | RAW TCP yazıcı; varsayılan simüle |

**Kategori kısaltmaları (PLAN §4 / SCHEMA.md):** `eszamanlilik` (ESZ) · `mimari` (MIM) · `guvenlik` (GUV) ·
`veri-performans` (VER) · `dogruluk` (DOG) · `api-sozlesmesi` (API) · `tip-guvenligi` (TIP) · `izolasyon` (IZO) ·
`ops` (OPS). Defter `cell` biçimi `<MODUL>.<kategori>` (ör. `SEV.eszamanlilik`), `id` biçimi `F-<MODUL>-<KAT3>-<NNN>`
(ör. `F-SEV-ESZ-004`). Bu hücrede bugüne kadar kullanılan son numaralar: BLG-MIM 002 · CORE-API 004 · CORE-GUV 006 ·
CORE-OPS 007 · CORE-VER 008 · FAS-ESZ 002 · IST-ESZ 002 · KIM-GUV 003 · OPS-VER 009 · SEV-DOG 002 · SEV-ESZ 003 · URE-ESZ 001.

### 6.2 Hücre matrisi (PLAN.md §4 — birebir kopya)

| Modül | ESZ | MIM | GUV | VER | DOG | API | TIP | IZO | OPS |
|---|---|---|---|---|---|---|---|---|---|
| **CORE** | P1 | P2 | **P0** | **P0** | P2 | **P0** | P1 | atla | **P0** |
| **BLG** | P2 | **P0** | P1 | P1 | P1 | P2 | atla | P1 | atla |
| **URE** | **P0** | P1 | P2 | P1 | P1 | P2 | atla | atla | P2 |
| **IST** | **P0** | P2 | P2 | P1 | P1 | P2 | atla | atla | atla |
| **FAS** | **P0** | P1 | P2 | P1 | P1 | P2 | atla | atla | atla |
| **SEV** | **P0** | P2 | P2 | P1 | **P0** | P2 | atla | atla | atla |
| **ENV** | P1 | P2 | P2 | P1 | P1 | P2 | atla | atla | atla |
| **OPS** | P1 | P2 | P1 | **P0** | P2 | atla | atla | atla | P1 |
| **KIM** | P1 | atla | **P0** | P2 | P2 | P2 | atla | P1 | P2 |
| **SIP** | P2 | P2 | atla | P1 | P1 | P2 | atla | atla | atla |
| **TAN** | atla | P2 | P2 | P2 | P2 | P2 | atla | atla | atla |
| **RAP** | atla | P2 | P2 | P1 | P1 | atla | atla | atla | atla |
| **DON** | atla | atla | P1 | atla | P2 | atla | atla | atla | atla |

P0 = 12 · P1 = 28 · P2 = 35 · atla = 42. 2026-08-09'da koşulan 12 hücre (defterdeki `cell` değerleri): `CORE.guvenlik`,
`CORE.ops`, `CORE.veri-performans`, `CORE.API`, `SEV.eszamanlilik`, `FAS.eszamanlilik`, `IST.eszamanlilik`,
`URE.eszamanlilik`, `SEV.dogruluk`, `KIM.guvenlik`, `OPS.veri-performans`, `BLG.mimari`. P1'in 28'i (PLAN §8) **hiç koşulmadı**.

### 6.3 Modül → dosya eşlemesi (bu oturumda TÜRETİLDİ — PLAN'da dosya listesi yok)

`[TÜRETİLMİŞ]` — PLAN §2 yalnız satır/dosya sayısı verir; aşağıdaki eşleme bugünkü ağaçtan (216 servis dosyası,
63 route, 22 controller) ad ve içerik bazında çıkarıldı; ② ajanı `cell` seçerken bunu kullanır, sınır vakalarda
PLAN kartı (`§7`) önceliklidir. Yollar `Teks-Erp/src/` köküne göre.

| Modül | services/ (üst düzey) | services/helpers/ ve alt dizinler | routes/ · controllers/ · diğer |
|---|---|---|---|
| **CORE** | `base.service` | `code-unique.helper`, `name-normalize.helper`, `hidden-status.helper`, `audit-value-resolver`, `audit-diff.helper` | `app.ts`, `server.ts`; `middlewares/*` (auth, rbac, error, device, latency, login-lockout, uuid-param); `lib/*` (prisma, pool-health, presence, request-context, pg-session, disk-metrics, app-version, lan-addresses, discovery-txt, string-validators, zod-locale); `utils/*` (app-error, barcode-retry, code-format, cursor, json-replacer, p2002, query-parser, search-fold, string-similarity); `controllers/base.controller`; `config/swagger` |
| **BLG** | `label`, `label-template`, `printed-document`, `free-document`, `document-profile`, `traveler-card`, `traveler-template`, `customer-standalone-label`, `customer-template-route` | `label-*.helper` (canvas-html, canvas-native, html, html-landscape, ppla, pplb, zpl, rawcode, renderer.registry, routing.resolver, variant.resolver, format.resolver, field-values, flow-to-canvas, context-fit, intent), `native-label.shared`, `native-preview`, `traveler-card-dirty.helper`, `traveler-card-fanout.helper`, `helpers/raster/*` (11), `document-render/*` (20) | routes: label, label-template, printed-document, free-document, document-profile, traveler-card, traveler-template, customer-standalone-label, customer-template-route; controllers: label, label-template, printed-document, traveler-card; `config/label-*`, `config/traveler-card-fields`, `types/label.types` |
| **URE** | `workorder`, `workorder-batch-drop`, `workorder-fason-quick`, `workorder-link`, `workorder-manual-move`, `workorder-split`, `batch`, `production-balance` | `workorder-clone/locks/rolls/target-color.helper`, `batch-dispatch-surgery.helper`, `roll-step.helper`, `roll-step-scope.helper`, `roll-disposition.helper`, `roll-cancel-restore.helper`, `step-capability.helper`, `targetable-property.helper`, `color-assignment.helper` | routes: workorder, batch, production-balance; controllers: workorder, batch |
| **IST** | `tambur`, `tambur-manual`, `tambur-undo`, `kursun-qc`, `kursun-bypass` | `kursun-bypass-eligibility.helper`, `kursun-bypass-guard.helper`, `tambur-plan-gate.helper`, `roll-variance.helper`, `quality-grade.helper`, `roll-finalize.helper` (URE/ENV ile ortak) | routes: tambur, kursun-qc, kursun-bypass; controllers: tambur, tambur-manual, kursun-qc, kursun-bypass |
| **FAS** | `subcontractor`, `subcontractor-management`, `kartela` | `subcontractor-cancel.helper`, `subcontractor-shrink.helper`, `fason-open-dispatch.helper`, `fason-work-instructions.helper`, `allocation.helper` (SEV ile ortak) | routes: subcontractor, subcontractor-management, kartela, swatch; controllers: subcontractor, subcontractor-management, kartela |
| **SEV** | `shipping`, `return`, `sack-search`, `accounting-export` | `shipment-locks.helper`, `sack-invariants.helper`, `sack-content-mismatch.helper`, `allocation.helper` | routes: shipping, return; controllers: shipping, return |
| **ENV** | `inventory`, `duplicate-rolls` | `roll-barcode.helper`, `roll-entry-station.helper`, `duplicate-guard.helper`, `fold-type` | routes: inventory; controllers: inventory |
| **SIP** | `order`, `customer`, `customer-alias`, `customer-branch` | `order-line-scope.helper`, `order-status.helper`, `coverage.helper`, `customer-name.helper` | routes: order, customer, customer-alias, customer-branch, customer-branch-list, currency; controllers: customer-alias |
| **KIM** | `auth`, `session-registry`, `permission-management`, `device`, `work-session`, `work-session-activity`, `user-preference` | `work-session.helper`, `device-transport` | routes: auth, device, work-session, client-policy; controllers: auth, device, work-session, user-preference; `middlewares/auth`, `rbac`, `login-lockout`, `device` (CORE ile ortak); `constants/permission-catalog`, `role-template-catalog` |
| **OPS** | `backup`, `backup-impact`, `db-copy`, `db-copy-verify`, `system-setting`, `system-log`, `audit`, `latency-persist`, `latency-stats`, `discovery`, `mobile-update`, `master-data-merge`, `duplicate-detection`, `duplicate-review`, `record-info` | `backup-naming.helper`, `offsite-backup.helper`, `pg-admin-client`, `pg-conn.helper`, `pg-tool.helper`, `db-swap-command.helper`; `import/*` (import.service, import-lookup, import-registry, adapters/*, config-bundle.service) | routes: admin, db-copy, feature-flag, config-bundle, import, master-data-merge, mobile-update, discovery, record-info; `jobs/*` (9); `config/client-version-policy`, `config/mobile-update`; `ecosystem.config.js` |
| **TAN** | `item`, `color`, `fabric-property`, `product-recipe`, `route`, `station`, `station-capability`, `reason-preset`, `search` | `guarded-hard-remove`, `station-capability-transfer.helper` | routes: item, color, fabric-property, product-recipe, route, station, station-capability, reason-preset, quality-grade, defect-type, return-reason, search; `constants/search-entities` |
| **RAP** | `dashboard` | `reports/*` (21: `_shared`, `_shipped`, `_breakdown` + 18 rapor servisi) | routes: dashboard, reports/* (audit, customer, inventory, production, quality, sales, subcontract) |
| **DON** | `peripheral` | `printer-transport`, `device-transport` (KIM ile ortak) | routes: peripheral; `jobs/mdns-advertiser.job` (OPS ile ortak) |

---

## 7. `Teks-Erp/DB-MIMARI-DENETIM.md` §0 / §0.1 uzlaştırması

Rapor 2026-07-08 tarihli; §0.1 2026-07-14'e kadar kapanışları koda karşı işlemiş. Aşağıda **bugünkü** kod/DB durumu.

### 7.1 Kapanmış (bugünkü kanıt)

| Bulgu | §0/§0.1 iddiası | Bugün | Kanıt |
|---|---|---|---|
| O-3 tx timeout | global `transactionOptions` | ✓ | `Teks-Erp/src/lib/prisma.ts:89-91` (`maxWait 5_000`, `timeout 20_000`) |
| O-23 pool error / çift shutdown | `pool.on("error")` | ✓ | `prisma.ts:79` |
| B-1 yorum 30s→50s | düzeltildi | ✓ | `prisma.ts:61,86` "50s" |
| O-2 WO oto-tamamlama atomik | `touchWorkOrderTx` | ✓ genişledi | `touchWorkOrderTx(` 31 referans; `completeWorkOrderIfStepsDone` 6 dosyada (terminal guard'lı tek kapı) |
| O-4 / O-21 numara üreticileri | `gte+startsWith` | ✓ | `nextDailySeq(` 19 çağrı / 12 dosya (`utils/code-format.ts` tek kaynak) |
| O-7 `Sack.manualCode` | moot (kolon düştü) | ✓ | şemada yok |
| O-9 `dyehouseNote` drift | kolon kaldırıldı | ✓ | — |
| O-13/O-14 `roll_operations` index | Faz 5 | ✓ | `test_db_invariants.ts` envanteri |
| O-19 operatör izi | `weighedById`/`dispatchedById` | ✓ | şema |
| O-22 Roll↔Sack↔Shipment invariantı | `@@unique([id, shipmentId])` + DEFERRABLE composite FK | ✓ | `schema.prisma:4202`; saha DB `rolls_sackId_shipmentId_consistency_fkey` + `swatches_…` `condeferrable=t` |
| D-14 text UUID kolonlar | `@db.Uuid` | ✓ | — |
| O-15 bellek tuning | runbook | ✓ (belge) | `docs/ops/DEPLOY-RUNBOOK.md §6` (raporun kendi notu) |
| O-17 yedek bütünlüğü | `verifyBackupFile` | ✓ | `backup.service.ts:109`, `:277` (`.part` üzerinde) |
| D-9 mutabakat scripti | `consistency-check.sql` | ✓ + test | `scripts/consistency-check.sql`, `consistency-check-derived.sql`, `test_consistency.ts` (574), `test_consistency_derived.ts` (837) — `npm test`e bağlı |
| **Y-2 / Y-3 collation** | 34 elle-arama sahası `mode:'insensitive'` | ✓ **KAPANDI (2026-08-19 arama katlaması)** | `src/utils/search-fold.ts` (JS ≡ SQL `tr_fold`, üç projede md5-eşit; bekçi `test_fold_contract.ts`), `nameFold` gölge kolonları + GIN trgm (saha DB'de 21 `*_nameFold_idx` + 3 trgm). Kalan `mode:"insensitive"` **28** kullanım: import adaptörleri (17 dosya) + `import-lookup.ts:89,103` + `code-format.ts` (3) + `permission-management` (2) + `db-copy*` (2) + `query-parser` (1) + `base.service` (1) — eski 34 sahanın hiçbiri listede yok. `ILIKE` 20 (ham SQL raporlar; çoğu kod/no alanı `[VARSAYIM]`). |
| Y-4 offsite (kod kısmı) | `BACKUP_OFFSITE_DIR` + sweeper | ✓ kod / ✗ yapılandırma | bkz. F-OPS-VER-003 |
| F103 (Faz 8) `shipment_orders` partial unique | "DB seddi; backend kilidinin yerini alır" | **GEÇERSİZ — bilinçli kaldırıldı** | `20260711120000_cuval_havuzu_remodel` tabloyu yeniden kurdu; index ne dev'de ne sahada var (`pg_indexes`: yalnız pkey + `orderId_idx`); `schema.prisma:4318` yorumu "eski partial unique … migration ile düşürülür"; `ARCHITECTURE.md:830` "Kaldırılanlar" listesinde. Saha: 55 satır / 1 `isActive`, sipariş başına >1 aktif yok. §0'daki Faz 8 satırı **bayat** — "bir sipariş tek aktif sevkiyatta" seddi çuval-depo modelinde yok `[VARSAYIM: kural bilinçli terk edildi; şema yorumu bunu ima ediyor]`. |
| Y-1 tedarikçi/lot | İPTAL (Faz 9) | ✓ | `20260708170000_faz9_drop_goods_receipt` |

### 7.2 Kısmi

| Bulgu | Durum | Kanıt |
|---|---|---|
| D-1 TravelerCardScan idempotency | 10 sn çift-okutma dedup penceresi (UX guard); `clientScanId` DB çapası YOK | `traveler-card.service.ts:582-589` (`DUP_SCAN_WINDOW_MS = 10_000`); şemada `clientScanId` yok |
| O-17 restore tatbikatı | Runbook "6 ayda bir" diyor; yapıldığına dair iz yok | `docs/ops/DEPLOY-RUNBOOK.md:460` |

### 7.3 Hâlâ açık / devredilmiş / ürün kararı

| Bulgu | Sınıf | Bugün | ② hücre |
|---|---|---|---|
| **Y-4 PITR / WAL arşivi** | AÇIK | `archive_mode` yok; runbook'ta kayıtlı (`PM2-GECIS-DEVIR-NOTU.md:189`) | OPS.veri-performans |
| **Y-5 geçmiş DDL `statement_timeout`** | AÇIK (latent) | `SET statement_timeout` taşıyan migration **42/195**; 153'ünde yok (2026-07 sonrası 40+ migration dahil — çoğu küçük DDL `[VARSAYIM]`); lint **yok** (scripts'te yalnız `test_db_copy.ts` bu kelimeyi geçiriyor). D-23: `applied_steps_count=0` **saha 0/190** (temiz `migrate deploy` — iyi haber), **dev 40/195** (elle resolve) | OPS.veri-performans / CORE.veri-performans |
| **O-18 Tambur'suz rotada açık-hata guard'ı** | AÇIK | `helpers/roll-finalize.helper.ts` (136-200) `rollError`/`isProcessed` sorgusu **yok** (grep 0); `isProcessed:false` yalnız `tambur.service.ts` + dashboard'da. `kursun-qc`/`kursun-bypass` → `finalizeRollsAtLastStep` yolu hata kararı istemiyor | IST.dogruluk + URE.dogruluk (HOTSPOT-5) |
| O-16 PG paritesi | raporda "geçersiz" sayıldı | KUNYE: dev 18.6 / prod 16.9 — parite yine yok (bilgi) | — |
| O-20 çuval dara/net | ürün kararı | şemada `tareKg/netKg/grossKg` yok | — |
| D-3 vardiya/maliyet | ürün kararı | `Shift` modeli yok | — |
| Y-2 kalıcı (ICU tr-TR locale) | orta vade | `search-fold` ile ihtiyaç azaldı; `COLLATE "C"` pini bilinçli (`search-fold.ts` başlığı) | TAN.dogruluk (bilgi) |

---

## 8. Yüzey belgelerinin sayısal iddiaları — güncel ölçüm

### 8.1 `audit/surface/09-test-durumu.md` (2026-08-09 → 2026-08-28)

| Ölçü | 08-09 | **08-28** | Yöntem / not |
|---|---:|---:|---|
| `scripts/*.ts` dosya / satır | 312 / 68.884 | **414 / 98.798** | `ls`, `cat \| wc -l` |
| `scripts/test_*.ts` dosya / satır | 273 / 61.498 | **366 / 89.681** | KUNYE ile uyumlu |
| `check(` çağrısı | 5.223 | **7.396** | `grep -o` |
| `src/services/` dosya (satır) | 152 (77.067) | **216 (101.891)** | `find` |
| `src/routes/` (+reports) | 47 + 7 = 54 | **63** | `find` |
| `src/controllers/` | 22 | **22** | |
| `middlewares/` dosya / satır | 7 / 1.067 | **7 / 1.209** | `error.middleware.ts` 515 → **634** |
| HTTP katmanını geçen test | 10 | **12** | `fetch(\|axios\|http://localhost` |
| prisma'ya dokunmayan test | 25 | **38** | `grep -L prisma` |
| `finally` olmayan test | 36 | **55** | `grep -L finally` |
| `lib/prisma` import eden test | 235 | **314** | |
| Testlerdeki `deleteMany` (dosya) | 1.539 (209) | **2.048 (278)** | |
| Testlerdeki `updateMany` | 85 | **88** | |
| Ortam guard'lı test (`NODE_ENV`) | 0 | **0** | koruma koşucuda (`productionDbGate`) — HOTSPOT-9 |
| Paralel çağrı yapan test | 28 | **40** | `Promise.all\|allSettled` |
| "yarış/race/eşzamanlı" geçen test | 26 | **37** | |
| "Seed fixture eksik" guard'ı | 49 | **55** | |
| `readFileSync` kullanan (yapısal bekçi adayı) | 15 | **47** | ölçü daha geniş (her `readFileSync`) — birebir karşılaştırma değil |
| `run-all-tests.ts` | 242 satır, 180 s | **344 satır**, 180 s (`:23`), `maxBuffer` (`:62`) | + `productionDbGate` |
| `any` (src, kelime sınırlı) | 0 (09) / 10 (PLAN) | **1** | regex `(:\|<\|as )\s*any\b` |
| `@ts-ignore/@ts-expect-error` | 0 | **0** | |
| `.catch(() => {})` / `null` yutma | 38 | **9** | dar regex — 09'un regex'i bilinmiyor; yaklaşık |
| bilinçli `void ` öneki | 36 | **55** | |
| `AuditService.log(` | 206 | **227** | |
| ESLint aktif kural | 2 | **2** | `parserOptions.project` hâlâ YOK → type-aware kurallar hâlâ açılamaz (R11 aynen) |
| Rapor testi | 2 | **16** | `test_*report*`/`*scorecard*`/`*trace*`; rapor servisi 8 → **21** |
| `subcontract.report.service` testsiz | evet | **kapandı** | dosya `subcontract-scorecard.report.service.ts`; `test_subcontract_scorecard.ts` var |
| `user-preference.service` testsiz | evet | **hâlâ testsiz** | grep 0 |
| R3 `updateStepPlanning`/`updateTargetProperties` testsiz | evet | **2 testte geçiyor** | `test_property_value_selection`, `test_property_targetable` (adı geçiyor ≠ davranış doğrulanıyor) |
| `getRollHistory` testsiz | evet | 1 test | `test_semi_finished_entry.ts` |
| `permission-management` `deleteTemplate`/`listPermissions` testsiz | evet | **hâlâ 0** | R5 aynen açık |
| `smoke_fason_http.ts` koşucu dışı | evet | **aynen** | dosya duruyor; `_e2e/` de duruyor |

### 8.2 `audit/surface/12-tx-global-gercekler.md`

| Olgu | 08-09 | **08-28** | Kanıt |
|---|---|---|---|
| Süreç | tek process | **aynen** | `Teks-Erp/ecosystem.config.js:47-48` `exec_mode:"fork"`, `instances:1` (+ `:42` "CLUSTER OLAMAZ" yorumu) |
| `transactionOptions` | 5.000 / 20.000, per-call override yok | **aynen; per-call override 1** | `prisma.ts:90-91`; `shipping.service.ts:2610` `RepeatableRead` (salt-okuma batch) |
| `$transaction` toplam | 115 (111 interactive) | **~125 gerçek** | grep 128 = 118 `(async` + 2 `([` + 2 arrow (`traveler-card:213`, `shipping:1905`) + 3 çok satırlı (`shipping:2592`, `reason-preset:505`, `master-data-merge:543`) + 3 yorum (`batch.service:16,103,213`) |
| `isolationLevel` | hiçbir yerde | **1 gerçek** (+1 bayat yorum `shipping.service.ts:145`) | |
| P2028 / P2024 kaydı | yok | **yok** (dev 0, saha 0) | `system_logs.recordId` |
| Tek tıkanıklık olayı `POOL_TIMEOUT` | 1 (2026-08-04T23:11:56Z, `/api/auth/login`) | **dev DB'de 1, saha kopyasında 0** | olay dev makinesine ait (bkz. satır 24) |
| Havuz | 30 / 10 dk / 5 s; PG 100 | **aynen**; 100 yalnız yerel PG | prod `max_connections` ölçülemez |
| Barkod sayacı çağrı yeri | 10 (8 tx / 2 havuz) | **12 (7 tx-içi / 5 tx-öncesi-havuz)** | bkz. satır 20; muaf listesi `test_barcode_reservation.ts:52-56` |
| Advisory namespace | 8021, 8022, 1-arg uzay (2 kullanıcı) | **7 namespace 8021-8027, 1-arg 0** | satır 34 |
| Middleware sırası | helmet→cors→compression→json→morgan→latency→resolveDevice→swagger→static | **helmet→cors→compression→morgan→latency→json→(swagger)→static→resolveDevice→requestContext** | `app.ts:102-175` |
| APPROVED cihaz | 18 | **28** (PENDING 0) | saha `devices` |
| FK `ON DELETE` dağılımı (DB) | SET NULL 99 · RESTRICT 68 · CASCADE 40 · NO ACTION 2 | **dev: n 168 · r 71 · c 41 · a 2 — saha: n 167 · r 71 · c 41 · a 2** | `pg_constraint` (public); KUNYE'deki 42/14/3 şemadaki AÇIK `onDelete` annotation sayısıdır — DB gerçeği bu satır. SET NULL sayısı 69 arttı → `hardDelete` "bağlı kayıt → 409" güvencesi yalnız RESTRICT'te; SET NULL bağlar `test_hard_delete_guard_coverage.ts` allowlist'iyle korunuyor (HOTSPOT-11b) |
| Hard delete guard tablosu | Customer `labelCustomerId` ✘ | **ayna kolon — reddedildi** | satır 22 |

### 8.3 `audit/PLAN.md §1` ölçüm tabanı

| Ölçü | 08-09 | **08-28** |
|---|---:|---:|
| `src/` dosya / satır | 271 / 103.727 | **367 / 136.397** |
| `schema.prisma` satır / model / enum / `@@index` | 3.721 / 85 / 38 / 208 | **5.372 / 91 / 45 / 297** |
| Migration | 154 | **195** (saha DB 190 — son 5 uygulanmamış) |
| `updateMany` (src) | 225 | **255** |
| Ham SQL (`$queryRaw`/`$executeRaw` tüm biçimler) | 65 | **104** (Unsafe 19, `Prisma.raw` 5) |
| Advisory lock çağrısı | 4 | **7** |
| ≥1000 satırlık servis | 16 (42.176) | **20** |
| En büyük dosyalar | workorder 6.073 · subcontractor 6.055 · inventory 4.318 · shipping 3.476 · tambur 3.318 · label 1.984 | **6.627 · 6.818 · 4.849 · 3.698 · 3.756 · 2.208** |
| RAP domain servisi import etmiyor | doğru | **artık ediyor** (7 rapor: `order-line-scope.helper.ACTIVE_LINE`, `batch.service.K18_DEAD_STATUSES`, `production-balance.service`) — "kural kopyası" riski azaldı ama `_shipped.ts` dışı sevk okumaları var (HOTSPOT-4) |

---

## HOTSPOTLAR

② denetçilerinin öncelikle bakması gereken yerler (dosya:satır — neden — hücre). Sıra: yeni/bayat ölçüm riski önce.

1. **`Teks-Erp/src/services/return.service.ts:490`** — `lockShipmentScopeTx` **KOŞULLU** (`if (lockShipmentId)`; `orderedRolls[0]?.shipmentId`). `shipmentId`si olmayan toplar için (DirectShipment/fason doğrudan sevk iadesi, `RETURN_DISPATCH` sonrası?) kilit alınmaz; F-SEV-ESZ-001'in kapattığı phantom'un doğrudan-sevk ikizi var mı? → `SEV.eszamanlilik` (+ `FAS.eszamanlilik` doğrudan sevk geri alma yolu).
2. **`Teks-Erp/src/services/shipping.service.ts:2179,2186,2197`** — F-SEV-ESZ-003 sınıflandırması 42 satır içindi, bugün 44; yeni satırlar 2026-08-22 "storno + `cancelPlannedShipmentTx` aynı tx" bölgesinde `[VARSAYIM]`. Claim mi toplu mu, `count` politikası yazılı mı → `SEV.eszamanlilik`.
3. **`Teks-Erp/src/controllers/subcontractor.controller.ts:77`** — `rollShipQtys: z.record(uuid, number).optional()` **tavansız**; `:84-86` `orderLineAllocations max(200)`; F-FAS-ESZ-002'nin ölçtüğü `newRolls max(300)` şeması artık yok (kısmi kabul/çekme yeniden yazımı). Kabul tx'inin döngü tavanı ve en uzun iş yeniden ölçülmeli → `FAS.eszamanlilik`.
4. **`Teks-Erp/src/services/reports/{batch-trace,order-cancellation,order-leadtime,stock-scorecard,subcontract-scorecard}.report.service.ts`** — `SHIPPED`/`shippedQty`/`dispatchedAt`i `_shipped.ts` (kök CLAUDE.md'ye göre "dönemde sevk edilen metraj TEK tanım") dışında okuyor; RollReturn okuyucu dosya 7→9; brüt/net ayrışması ve "yeni yüzey eklerken tabloya satır ekle" kuralının uygulanıp uygulanmadığı → `SEV.dogruluk` + `RAP.dogruluk`.
5. **`Teks-Erp/src/services/helpers/roll-finalize.helper.ts:136-200`** — `finalizeRollsAtLastStep` açık `RollError` (`isProcessed:false`) sormuyor; DB-MIMARI **O-18** (Tambur'suz rotada karar verilmeden depoya ilerleme) hâlâ açık; `kursun-qc`/`kursun-bypass` bu yoldan finalize ediyor → `IST.dogruluk` / `URE.dogruluk`.
6. **`Teks-Erp/.env`** (git'te, `76f9967b`) — F-OPS-VER-001 hâlâ açık; `.env.example` yok; secret'ın sahadakiyle aynı olup olmadığı bilinmiyor → `OPS.veri-performans` + `KIM.guvenlik`.
7. **`Teks-Erp/ecosystem.config.js:107,124,143`** — `BACKUP_SCHEDULE_ENABLED:"false"`, `BACKUP_OFFSITE_DIR:""`, `BACKUP_RCLONE_REMOTE:""`: offsite kodu ve bekçisi hazır, repo'daki sunucu yapılandırması boş; PITR yok → `OPS.ops` / `OPS.veri-performans` (F-OPS-VER-003, Y-4).
8. **`Teks-Erp/prisma/migrations/`** — 153/195 migration'da `SET statement_timeout` yok, lint yok (Y-5 latent); dev DB `applied_steps_count=0` 40/195 (D-23) → `OPS.veri-performans` (bilgi; prod kopyası 0/190 temiz).
9. **`Teks-Erp/scripts/run-all-tests.ts:102`** — `productionDbGate` yalnız koşucuda; 366 testin 0'ında ortam guard'ı; `npx tsx scripts/test_x.ts` doğrudan koşumu 2.048 `deleteMany` ile kapısız → `OPS.veri-performans`.
10. **`Teks-Erp/src/services/import/import-lookup.ts:89,103` + 17 `import/adapters/*.adapter.ts`** — kalan 28 `mode:"insensitive"` kullanımının çoğu içe aktarım; kod eşleşmesi (`:89`) İ/ı katlaması yapmıyor (Y-3 sınıfı, dar: kodlar ASCII ise etkisiz) → `TAN.dogruluk` / `OPS` (import).
11. **`Teks-Erp/src/services/base.service.ts:424-467`** — F-CORE-GUV-006 bekçisi yazılmadı (14 bağlı model; sır kolonlu model bağlı değil) → `CORE.guvenlik` (bilgi). **11b:** DB'de SET NULL FK 99→168; `hardDelete` 409 güvencesi yalnız RESTRICT'te — `test_hard_delete_guard_coverage.ts` allowlist'i (139 satır, `2a755db0` 2026-08-19) 69 yeni bağı kapsıyor mu → `CORE.veri-performans`.
12. **`Teks-Erp/src/routes/config-bundle.routes.ts:51`** — yeni `req.user!` (4. kullanım); zincir `:106-109`/`:129-132` verifyToken'lı görünüyor, `:51`in çağrıldığı her yol doğrulanmalı → `CORE.tip-guvenligi`.
13. **`Teks-Erp/src/services/permission-management.service.ts`** — F-KIM-GUV-002'nin "replace → `setUserPermissions` devri" satırı (`mode === "replace"`) bu turda grep'te eşleşmedi; guard'lar `:306-307,:379-389,:687,:748` duruyor; devir hâlâ var mı yeniden okunmalı → `KIM.guvenlik` (düşük).
14. **`Teks-Erp/src/services/shipping.service.ts:2159` ve `cancelPlannedShipmentTx`'in diğer çağıranı (`cancelShipment`)** — kilit `undoDispatch`te ilk ifade ✓; `cancelShipment` yolu aynı kilidi alıyor mu (2026-08-22 "iptal gövdesi TEK KAYNAK") → `SEV.eszamanlilik`.
15. **`Teks-Erp/src/services/tambur.service.ts:2454-2462, :3178`** — bilinçli barkod boşluğu (F-CORE-VER-008); saha sayaç max 262/gün; tx-öncesi `clientToken` kapısı yok → `IST.eszamanlilik` (bilgi; yeniden yazma).
16. **`audit/PLAN.md:1118`** — "iki ALTER DATABASE RENAME" öncülü YANLIŞ (F-OPS-VER-009); C2/OPS kartını okuyan ② bunu dayanak almasın. Kod: `db-copy.service.ts` RENAME 0, `getSwapCommands:739` metin döner.
17. **`Teks-Erp/src/services/inventory.service.ts:4439`** — kurtarma yolunda tx-içi `generateRollBarcode(tx)`; bekçi muaf listesi dosya-başına SAYI ile çalıştığı için (`inventory 2`) satır kayması testi kırmaz ✓ — ama üçüncü bir tx-içi çağrı eklenirse kırmızı verir (bilgi, `ENV.eszamanlilik`).
18. **`Teks-Erp/src/services/shipping.service.ts:145`** — bayat yorum "repoda `isolationLevel` kullanılmıyor" (aynı dosya `:2610` kullanıyor) — belge/kod ayrışması, `SEV.eszamanlilik` (bilgi).

---

## SINIR ÖTESİ NOTLAR

Kendi alanım (önceki denetimlerle uzlaştırma) dışında görülenler; yönlendirme ilgili K-haritası + ② hücresi.

- **K3 (transaction envanteri) / SEV.eszamanlilik:** `shipping.service.ts:2592-2610` batch `$transaction` + `RepeatableRead` kod tabanındaki tek izolasyon override'ı; K3 envanterinde "per-call override yok" yazıyorsa düzeltilmeli.
- **K3 / FAS.eszamanlilik:** `subcontractor.service.ts` `completeWorkOrderIfStepsDone` çağrısı 3→4 (`:6209`, kısmi kabul); K3'ün fason tx sayımı 2026-08-19 kısmi kabul + 2026-08-21 çekme değişikliklerini kapsamalı.
- **K2 (şema/migration) / OPS:** `shipment_orders_active_order_uq` (Faz 8 F103) `20260711120000` ile bilinçli düştü; `test_db_invariants` envanterinde yok (doğru); `DB-MIMARI-DENETIM.md §0` satırı bayat. `items_nameFold_key` sahada YOK (yumuşak kapı), dev'de var — K2 migration kataloğu bu farkı "enforce bekliyor" olarak taşımalı.
- **K2 / CORE.veri-performans:** DB'de SET NULL FK 168 (KUNYE'nin 3 sayısı şema annotation'ıdır); hard-delete guard kapsaması için gerçek sayı bu.
- **K5 (yetki kapıları):** `db-copy.routes.ts` beş uç çift guard (`admin:settings`+`admin:users`) — K5 haritası "tek izin" yazmasın. `test_route_auth_coverage` muaf listesi 11+ uç (client-policy, mobile-update, identity dahil) — K5 muaf listesini buradan alsın.
- **K6 (hata yolu):** `error.middleware.ts:302-310` yorumu P2024'ün bu kurulumda **üretilemediğini** (adapter-pg) ve dalın ulaşılamaz olduğunu söylüyor; `classifyPoolTimeout` 503 yolu asıl kapı — K6 bunu işlemeli.
- **K8 (zamanlanmış işler):** `jobs/` 9 dosya; `offsite-sweeper`, `installation-identity`, `mdns-advertiser`, üç katalog uzlaştırıcısı 2026-08-09 sonrası; 12-tx §1'in "dört mekanizma" listesi bayat.
- **K4 (yazma yolları):** barkod sayacı 12 çağrı yeri (7 tx-içi) — K4 matrisi `roll_barcode_counters` satırını bu sayıyla taşımalı.
- **K7 (hesap noktaları) / RAP.dogruluk:** 21 rapor servisinden 5'i sevk rakamını `_shipped.ts` dışından türetiyor (HOTSPOT-4); `order-cancellation`/`order-leadtime` yeni (2026-08-27).
- **K9 (entegrasyon):** `mobile-update.service` + `/api/mobile/updates/*` public uçları 2026-08-26'dan; K9 "kod imzalama koruması" varsayımını `test_mobile_update.ts` (321 satır) üzerinden doğrulasın.
- **Belge bakımı (kimseye değil, nota):** `audit/PLAN.md:1118` RENAME öncülü; `docs/history/CLAUDE-NOT-ARSIVI.md:51` "ayrı iş" ifadesi; `shipping.service.ts:145` bayat yorum; `rbac.middleware.ts` "67 kod" (70).

---

## KAPSANMAYAN / ERİŞİLEMEYEN

| Madde | Neden |
|---|---|
| Canlı sunucu olguları: rclone kurulumu, `pm2-logrotate` modülü, disk doluluğu, prod `max_connections`, `kill_timeout`'un pm2'de etkin değeri, JWT secret'ın rotasyonu | Canlı prod'a erişim yok; yalnız 2026-08-25 kopyası (veri) — yapılandırma dosyaları kopyada değil |
| Saha kopyasında son 5 migration'ın etkisi (`items_nameFold_key`, 2026-08-25 sonrası kolonlar) | Kopya 190/195 migration; dev DB ise test kalıntılı — satır sayıları sahadan, şema-dışı nesneler her ikisinden ayrı ayrı okundu |
| Test paketinin koşulması (yeşil/kırmızı oranı, süre) | Salt-okunur görev; testler dev DB'ye yazar |
| `audit/PLAN.md §7` oturum kartlarının tamamı (yalnız §1, §2, §4, §8 ve C2/4 satırı okundu) | Görev kapsamı §2/§4; kartlar ② ajanlarının kendi okuma listesi |
| `audit/surface/01-08, 10, 13` belgelerinin yeniden ölçümü | Görev yalnız 09 ve 12'yi istedi; 13 (brüt yüzey tablosu) yalnız var olduğu teyit edildi (4.216 B, 2026-08-09) |
| `system_logs`ta `LOGIN_LOCKED`/429 kanıtı | Tablo kolon adı bilinmeden sorgulandı (`details` yok) — sorgu düzeltilmedi, kapsam dışı bırakıldı |
| F-KIM-GUV-002'nin devir satırı (`mode === "replace"`) | grep eşleşmedi; dosya baştan okunmadı — HOTSPOT-13 olarak ②'ye bırakıldı |
| `shipping.service.ts`teki 2 yeni `updateMany`nin sınıflandırması, kabul şemasının döngü tavanı, 5 raporun brüt/net durumu | Aşama ①'de yargı verilmez — HOTSPOT-2/3/4 olarak işaretlendi |
| Hard-delete allowlist'inin 69 yeni SET NULL bağı kapsayıp kapsamadığı | `test_hard_delete_guard_coverage.ts` içeriği okunmadı (yalnız F-CORE-VER-003 satırları) — HOTSPOT-11b |
| Modül→dosya eşlemesinin (§6.3) her satırı | PLAN'da liste yok; eşleme ad/içerikten türetildi ve `[TÜRETİLMİŞ]` etiketli — sınır vakalarda PLAN kartı önceliklidir |
