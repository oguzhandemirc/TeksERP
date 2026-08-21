# Sürüm 2.9.0 — Deploy Reçetesi (TEK DEPLOY: arama · künye · audit · veri aktarımı)

> **Bu notu sunucudaki oturum okuyacak. Deploy'un TEK reçetesi budur.**
>
> Sahaya en son çıkan sürümden bu yana **üç ayrı iş** birikti (arama katlaması,
> kayıt künyesi + audit derinleştirme, veri aktarımı) ve hepsi **aynı `git pull`**
> ile geliyor. Bu yüzden ayrı notlar birleştirildi: sırayla okunacak ikinci bir
> dosya YOK. Eski `SURUM-2026-08-19-ARAMA-DEPLOY.md` bu dosyaya taşındı.
>
> Genel prosedür: [`DEPLOY-RUNBOOK.md`](./DEPLOY-RUNBOOK.md). Bu dosya runbook'un
> yerine GEÇMEZ, yalnız bu sürüme özgü olanı anlatır.
>
> **Yazan oturumlar sahaya BAĞLANMADI.** Aşağıda "ölçüldü" yazan her şey
> fabrikanın `tekserp_20260814_020002.dump` yedeğinden kurulan bir kopyada
> (`tekserp_deploy_test`) **prova edildi**; ölçülmemiş olan açıkça öyle yazıyor.

---

## İLK 5 DAKİKA — sahadaki PostgreSQL neye sahip

Her şey provada geçti. **Bu deploy'u durduran bir senaryo KALMADI** — migration
eksik uzantıda bile devam eder (bkz. "pg_trgm yoksa"). Yine de ne olacağını
ÖNCEDEN bilmek için, oturuma başlar başlamaz şunu koş — **salt-okunur**,
hiçbir şey değiştirmez:

```powershell
psql -U postgres -d tekserp -c "SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name IN ('pg_trgm','unaccent');"
psql -U postgres -d tekserp -c "SELECT count(*) AS icu_collation FROM pg_collation WHERE collprovider='i';"
```

| Çıktı | Anlamı | Ne yap |
|---|---|---|
| `pg_trgm` satırı VAR (`installed_version` boş olabilir) | Uzantı kurulabilir | ✅ Devam et — migration kendisi kuracak |
| `pg_trgm` satırı **YOK** | contrib dosyaları eksik | ⚠️ **Deploy DURMAZ** ama BORÇ doğar → aşağıdaki "pg_trgm yoksa" |
| `icu_collation` > 0 | Türkçe sıralama kurulacak | ✅ |
| `icu_collation` = 0 | ICU yok | ⚠️ Deploy **DURMAZ** — migration libc `tr_TR.UTF-8`'e düşer, o da yoksa NOTICE basıp sıralamayı olduğu gibi bırakır. **Arama etkilenmez.** |

**`unaccent`a İHTİYAÇ YOK.** Tasarım bilerek ondan vazgeçti (gerekçe
`Teks-Erp/src/utils/search-fold.ts` başlığında). Kurulu görünse bile
**hiçbir şey yapma**.

### pg_trgm yoksa — deploy DURMAZ, ama borç doğar

**Migration önce kurmayı DENER** (`CREATE EXTENSION IF NOT EXISTS pg_trgm`).
Başaramazsa **durmaz**: uyarı basar, 9 trigram index'ini atlar ve kalan her şeyi
uygular. İki yol da fabrika verisinin kopyasında **prova edildi** (yol A: 9 index
kuruldu · yol B: uyarı basıldı, çıkış kodu 0, migration tamamlandı).

O sırada ne çalışır, ne çalışmaz:

| | Durum |
|---|---|
| Türkçe-duyarsız arama | ✅ Çalışır (ölçüldü: `sahin`→ADNAN ŞAHİN ÜRETİM, `akkus`→AKKUŞ TEKSTİL) |
| Mükerrer kontrolü, Türkçe sıralama | ✅ Çalışır (uzantıya bağlı değil) |
| Aramanın HIZI | ⚠️ Index'siz — bugünkü hacimde fark edilmez, **veri büyüdükçe doğrusal yavaşlar** (200 bin satırda ölçüldü: 583 ms ↔ 6 ms) |
| `test_db_invariants` / `test_schema_drift` | 🔴 **KIRMIZI kalır** — borç unutulmasın diye. İndexler eklenince ikisi de kendiliğinden yeşile döner (ölçüldü) |

**Borcu kapatma (müsait bir gün, vardiya içinde bile olur):**

Sahadaki PG **16.9**, `C:\Etkili-Yazilim\pgsql`. Uzantı contrib paketinin parçası,
iki dosya ister: `share\extension\pg_trgm*` ve `lib\pg_trgm.dll`. Aynı sürümün
(16.x) resmî zip'inden kopyalanır. Sonra:

```powershell
# 1) Uzantı — PostgreSQL'i yeniden başlatmak GEREKMEZ (PG13+ "trusted")
psql -U postgres -d tekserp -c "CREATE EXTENSION pg_trgm;"

# 2) 9 index — CONCURRENTLY: tablo yazmaya KAPANMAZ, operatörler çalışmaya devam eder
# ⚠️ HER SATIR AYRI KOMUT. Hepsini tek -c "..." içine koyarsan
#    "CREATE INDEX CONCURRENTLY cannot run inside a transaction block" alırsın
#    ve HİÇBİRİ kurulmaz (ama "kuruldu" sanırsın). Bu tuzağa deneyde düşüldü.
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "customers_nameFold_trgm_idx" ON "customers" USING gin ("nameFold" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "items_nameFold_trgm_idx" ON "items" USING gin ("nameFold" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "colors_nameFold_trgm_idx" ON "colors" USING gin ("nameFold" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "order_lines_customerItemNameFold_trgm_idx" ON "order_lines" USING gin ("customerItemNameFold" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "orders_orderNumber_trgm_idx" ON "orders" USING gin ("orderNumber" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "work_orders_workOrderNumber_trgm_idx" ON "work_orders" USING gin ("workOrderNumber" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "shipments_shipmentNo_trgm_idx" ON "shipments" USING gin ("shipmentNo" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "batches_batchNumber_trgm_idx" ON "batches" USING gin ("batchNumber" gin_trgm_ops);'
psql -U postgres -d tekserp -c 'CREATE INDEX CONCURRENTLY "sacks_sackNo_trgm_idx" ON "sacks" USING gin ("sackNo" gin_trgm_ops);'

# 3) Doğrula — 9 olmalı ve GEÇERSİZ index 0 olmalı
psql -U postgres -d tekserp -c "SELECT count(*) FROM pg_class c JOIN pg_am a ON a.oid=c.relam WHERE a.amname='gin' AND c.relname LIKE '%trgm%';"
psql -U postgres -d tekserp -c "SELECT count(*) AS gecersiz FROM pg_index WHERE NOT indisvalid;"

# 4) Bekçiler yeşile dönmeli
npx tsx scripts/test_db_invariants.ts
npx tsx scripts/test_schema_drift.ts
```

> `CONCURRENTLY` yarıda kalırsa PostgreSQL **geçersiz (invalid)** bir index
> bırakır — 3. adımdaki ikinci sorgu bunu yakalar. Çıkarsa `DROP INDEX` ile at
> ve tekrar kur. Sonradan kurulumun tamamı prova edildi: 9 index kuruldu,
> geçersiz 0, iki bekçi de yeşile döndü.

---

## ⛔ CANLI VERİ MUTLAK YASAKLARI

- `prisma migrate reset` · `migrate dev` · reseed · toplu `DELETE` **YASAK**.
- Migration'ı **`migrate deploy`** uygular. `migrate dev` bu repoda her diff'te
  iki DEFERRABLE composite FK'yı DROP etmek ister.
- Elle SQL koşman gerekirse sıra: `git add` → `db execute` → `migrate resolve
  --applied` → **DOĞRULA**. `resolve` SQL'in koştuğunu **kanıtlamaz**.
- **Canlıda `npm test` KOŞMA** — fixture yazar/siler. Güvenli olanlar §6'da.

---

## 0) Bu deploy'da ne var — 26 migration, on bir iş

`migrate status` fabrikanın 14 Ağustos hâline göre **26 bekleyen** gösteriyor.
On biri ayrı iş, hepsi aynı pull'da:

| # | Migration | İş |
|---|---|---|
| 1-4 | `20260809015353` · `20260809020429` · `20260809021552` · `20260809023731` | Sapma defteri (RollVariance), tambur öncesi kapanış, iade tersleme, top etiketi müşterisi |
| 5 | `20260809090000_roll_production_timestamps` | `finalizedAt`/`statusChangedAt` + **TRIGGER** |
| 6-8 | `20260809232529` · `20260810010330` · `20260810233446` | Üretim karakteristiği: kat kataloğu, istasyon yetenek bayrakları, özellik değeri |
| 9-11 | `20260817004721` · `20260817105016` · `20260817121448` | Fabrika talep listesi, WO iptal izi, refakat kartı belge versiyonları |
| 12-13 | `20260819023127` · `20260819032151` | **Künye** — 27 modele "kim oluşturdu / kim değiştirdi" |
| 14-16 | `20260819034413` · `20260819034951` · `20260819035418` | Audit derinleştirme: `system_logs.updatedAt` DROP, `changes`, `deviceId` |
| 17 | `20260819060000_search_fold` | **Arama katlaması** — 31 gölge kolon, 9 trigram GIN, 18 kolona Türkçe collation |
| 18 | `20260819120000_import_runs` | **Veri aktarımı** — yeni tablo + enum (mevcut tabloya dokunmaz) |
| 19 | `20260819140000_alias_search` | **Müşteri alias'ı aranabilir** — iki alias tablosuna gölge kolon + index |
| 20 | `20260819140000_systemlog_archive_changes_device` | Arşive `changes` + `deviceId` — taşınmasaydı B2/B3 6 ay sonra buharlaşırdı |
| 21 | `20260819160000_audit_requestid_devicefix` | **İşlem gruplaması** (`requestId`) + arşiv `deviceId` UUID→TEXT **tip hatası düzeltmesi** |
| 22 | `20260819161000_audit_tamper_guard` | **Audit değiştirilemezliği** — UPDATE/DELETE/TRUNCATE engeli (2 trigger + 1 fonksiyon) |
| 23 | `20260819170000_reason_presets` | **Hazır sebep katalogları** — yeni tablo + enum (mevcut tabloya DOKUNMAZ; satırlar boot'ta gelir) |
| 24 | `20260819210000_master_data_merge_lineage` | **Mükerrer birleştirme soy bağı** — 4 tabloya 3 nullable kolon + FK + partial index (mevcut satırlara DOKUNMAZ, hepsi NULL doğar) |
| 25 | `20260819190000_roll_plan_deviations` | **Plan-sapma defteri** — YENİ tablo (`roll_plan_deviations`) + 8 index + 5 FK. Mevcut tabloya DOKUNMAZ, boş doğar |
| 26 | `20260819200000_fason_partial_receive` | **Fason kısmi kabul** — 3 tabloya 4 nullable kolon (`clientToken` + unique index, `receivedQty`, `isPartial` DEFAULT false, `remainderClosedAt`); mevcut satırlar etkilenmez |

⚠️ **25 ve 26, envanterdeki 24'ten ÖNCEKİ damgayı taşır ama SONRA yazıldı** —
Prisma dizin adına göre sıralar, yani gerçek uygulama sırası 19→20→21 olacak.
Üçü de additive olduğu için sıra fark etmez (hiçbiri diğerinin kolonunu okumaz).

Bu üç iş (25, 26 ve migration'sız Tambur paketleri) **14 Ağustos notundan sonra
eklendi**; bölümleri §8c–§8e'de.

> ⚠️ **20 ve 21 aynı damgayla başlıyor ama farklı işler** (`..._alias_search` ile
> `..._systemlog_archive_changes_device`); Prisma dizin adına göre sıralar,
> alfabetik sıra deterministik — sorun değil.
>
> ⚠️ **22 numaralı migration TEK BAŞINA HİÇBİR ŞEYİ KORUMAZ.** Trigger kurulur
> ama koruma kapalı doğar; açan şey §7b'deki `ALTER DATABASE` adımıdır. Bu
> bilinçli: geliştirme ve test veritabanlarında koruma kapalı kalmalı (79 test
> dosyası cleanup'ta audit satırı siler ZORUNDA — `system_logs.userId → users`
> FK'sı RESTRICT).
>
> ⚠️ **23 numaralı migration BOŞ bir tablo kurar.** 23 sistem sebebi (fire 8 ·
> kayıt düzeltmesi 5 · elle top ekleme 5 · iptal 5) backend AÇILIRKEN yazılır
> (`reason-preset-catalog.job`, izin/rol uzlaştırmasının 3. fazı). Migration'dan
> sonra tabloyu boş görmek NORMALDİR — restart'tan sonra bak. Uzlaştırma
> koşmazsa arayüz APK'ya gömülü zemine düşer (operatör kilitlenmez), ama
> düzenleme yapılamaz.

Diğer notlar (arka plan; deploy adımı içermezler):
`SURUM-2026-08-09-RAPORLAR-DEPLOY.md` · `SURUM-2026-08-10-KAT-KATALOGU-DEPLOY.md` ·
`DEVIR-2026-08-17-FABRIKA-TALEP.md` · tasarım:
[`ARAMA-KATLAMA-SIRALAMA-TASARIM.md`](../design/ARAMA-KATLAMA-SIRALAMA-TASARIM.md) ·
[`IMPORT-EXPORT-TASARIM.md`](../design/IMPORT-EXPORT-TASARIM.md).

### Provada ölçülenler (fabrika verisinin kopyası, `statement_timeout=50s` açık)

| Ölçüm | Sonuç |
|---|---|
| 19 migration | **Hatasız**, toplam **~1 sn** (tablolar küçük: 806 top · 4.449 log · 485 hareket · 190 sipariş) |
| Backend 2.9.0 | **Kalktı**, `/health` → `db: UP` |
| Arama (gerçek veri) | `sahin` → ADNAN ŞAHİN ÜRETİM · `akkus` → AKKUŞ TEKSTİL |
| Eksik izin | **2 tane**: `data:import`, `mobile:kk1-yari-mamul` |
| Backfill'ler | 5'i de DRY-RUN koştu, rakamlar §5'te |

---

## 1) Deploy ÖNCESİ ön-tarama — salt-okunur

```powershell
cd C:\...\Teks-Erp
npx prisma migrate status         # 19 bekleyen görmelisin
git log --oneline -1              # beklenen commit sende mi
pm2 list                          # süreç adını NOT AL (aşağıda gerekiyor)
```

> `migrate status` **19'dan fazla** gösteriyorsa bu not yazıldıktan sonra yeni
> migration eklenmiş demektir; sapma değildir ama listeyi gözden geçir.

---

## 2) Yedek — migration'lardan HEMEN ÖNCE

Runbook §3'teki **`premigrate_`** yedeği **atlanmaz**. Bu sürümde 27 modele kolon
ekleniyor, `system_logs`'tan kolon düşüyor ve 18 kolonun collation'ı değişiyor;
geri dönüş yolu yedektir.

---

## 3) Deploy (vardiya dışı)

`Teks-Erp/` **içinden** koşulur (Prisma komutları çalışma dizinine duyarlı).

```powershell
pm2 stop <süreç-adı>          # pm2 list ile teyit ettiğin ad
git pull
npm ci                        # package.json değiştiyse; değişmediyse npm install
npm run prisma:generate
npm run prisma:migrate        # = migrate deploy
npm run build
pm2 start <süreç-adı>
```

**Sıra pazarlık dışı:** `prisma:generate` → `migrate` → `build`. `build` önce
koşarsa eski client ile derlenir ve yeni kolonlar tipte görünmez.

Sonra **panel (Electron)** aynı pencerede dağıtılır.

> **Backend ÖNCE, panel SONRA.** Yeni panel + eski backend = "İçe Aktar" düğmesi
> görünür ama `/api/import/...` **404** döner. Tersi zararsızdır.

### İstemci sürümleri

| Parça | Durum |
|---|---|
| **Backend** | Bu sürüm. Migration'sız **ÇALIŞMAZ** (`nameFold` yoksa P2022) — kod ile migration **atomik** gider. |
| **Electron** | **Aynı pencerede zorunlu.** Veri Aktarımı ekranı + Türkçe arama/sıralama düzeltmeleri orada. |
| **Mobil (APK)** | **2.9.1 / versionCode 48** — ~~zorunlu değil~~ **artık ÖNERİLİYOR**: fason kısmi kabul, Tambur "Boyahaneye Geri Gönder", kısa-kesim A1, Sipariş Bağla ve kamera yönü tercihi bu APK'da. Eski APK ÇALIŞMAYA DEVAM EDER (sözleşme geriye uyumlu) ama bu özellikleri göremez; ayrıca plan-sapma kapısına çarpınca onay gönderemez (409'u görür, akış kilitlenmez). |

> ⚠️ **APK sürüm tutarlılığı 2026-08-19'da bir kez bozuldu ve düzeltildi**
> (`app.json` 47 ↔ `build.gradle` 48). Derlemeden önce **her zaman**
> `npm run build:apk:check` koş — `android/` git dışıdır, uyuşmazlıkta tablete
> giden sürüm gradle'dakidir ve versionCode düşerse Android kurulumu REDDEDER
> (operatör kaldır-kur yapar, offline kuyruktaki gerçek toplar silinir).

⚠️ **En tehlikeli senaryo:** sunucuda `git pull` yapıp `migrate deploy` KOŞMAMAK.
Kod `adnansahin` branch'inde hazır duruyor ve `nameFold` kolonunu arıyor; pull
edip restart edersen liste ekranları **500** verir. Pull ile migrate **birlikte**.

---

## 4) Deploy SONRASI doğrulama — "başarılı dedi" YETMEZ

`migrate deploy`'un "successfully applied" demesi SQL'in koştuğunu kanıtlamaz.
Şunları **gözle**:

```powershell
psql -U postgres -d tekserp -c "SELECT extname FROM pg_extension;"
psql -U postgres -d tekserp -c "SELECT proname, provolatile FROM pg_proc WHERE proname='tr_fold';"
psql -U postgres -d tekserp -c "SELECT collname, collprovider FROM pg_collation WHERE collname='tr_sort';"
psql -U postgres -d tekserp -c "SELECT count(*) FROM pg_attribute WHERE attgenerated='s' AND attname LIKE '%Fold';"
psql -U postgres -d tekserp -c "SELECT name, \"nameFold\" FROM customers ORDER BY \"nameFold\" LIMIT 5;"
psql -U postgres -d tekserp -c "\d import_runs"
psql -U postgres -d tekserp -c "SELECT column_name FROM information_schema.columns WHERE table_name='system_logs' AND column_name IN ('changes','deviceId','updatedAt');"
# Hazır sebepler — RESTART'TAN SONRA koş (satırları migration değil, boot yazar)
psql -U postgres -d tekserp -c "SELECT kind, count(*) FROM reason_presets GROUP BY kind ORDER BY kind;"
psql -U postgres -d tekserp -c "SELECT code, label FROM reason_presets WHERE kind='ROLL_SCRAP' ORDER BY \"sortOrder\" LIMIT 3;"
# Birleştirme soy bağı (24. migration) — kolon + FK + index PARTIAL mi
psql -U postgres -d tekserp -c "SELECT table_name, count(*) FROM information_schema.columns WHERE column_name IN ('mergedIntoId','mergedAt','mergedById') AND table_name IN ('customers','items','colors','subcontractors') GROUP BY 1 ORDER BY 1;"
psql -U postgres -d tekserp -c "SELECT indexname, indexdef LIKE '%WHERE%' AS partial_mi FROM pg_indexes WHERE tablename IN ('customers','items','colors','subcontractors') AND indexname LIKE '%mergedIntoId_idx' ORDER BY 1;"
psql -U postgres -d tekserp -c "SELECT count(*) FROM pg_constraint WHERE conname ~ '^(customers|items|colors|subcontractors)_merged(IntoId|ById)_fkey';"
```

Beklenen (hepsi provada ölçüldü):

| Kontrol | Beklenen |
|---|---|
| `pg_extension` | `plpgsql`, `pg_trgm` |
| `tr_fold` volatility | `i` (IMMUTABLE) |
| `tr_sort` | var; `collprovider` `i` (ICU) **veya** `c` (libc). ICU ise sayı-duyarlı |
| GENERATED kolon | **33** (31 + 2 alias) |
| `customers.nameFold` | `ADNAN ŞAHİN ÜRETİM` → `adnan sahin uretim` |
| `import_runs` | 17 kolon + 5 index; enum `APPLIED, PARTIAL, FAILED` |
| `system_logs` | `changes` ve `deviceId` VAR, `updatedAt` **YOK** |
| `reason_presets` (restart sonrası) | 4 satır: `ROLL_SCRAP` **8** · `ROLL_RECORD_CORRECTION` **5** · `ROLL_MANUAL_ENTRY` **5** · `ROLL_CANCEL` **5** |
| `ROLL_SCRAP` ilk satırı | **`TOP_BASI` — "Top başı"** (sahanın istediği sıra) |
| Backend log'u | `[reason-presets] 23 yeni sistem sebebi eklendi: …` (ilk açılış) ya da `katalog güncel` |
| Birleştirme kolonları | dört tablonun her birinde **3** (`mergedIntoId`/`mergedAt`/`mergedById`) |
| `*_mergedIntoId_idx` | **4 satır, hepsi `partial_mi = t`** — `f` görürsen index TAM oluşmuş demektir (yanlış değil, sadece gereksiz büyük); `test_db_invariants` bunu KIRMIZI verir. ⚠️ Sorgudaki `tablename IN (...)` süzgeci gerekli: `batches_mergedIntoId_idx` (eski, 2026-07 parti birleştirmesi) da desene uyar ve süzgeç olmadan 5 satır döner |
| Birleştirme FK'ları | **8** |
| Backend log'u (2) | `[permission-catalog] 1 yeni izin eklendi: master-data:merge` (ilk açılış) |

---

## 5) BACKFILL'ler — beşi de DRY-RUN varsayılan

Migration'lar kolonu **ekler**, geçmiş satırları doldurmaz. Beşi de fabrika
verisinin kopyasında prova edildi; parantezdeki sayılar **provada çıkanlar**
(canlıda bir miktar farklı olur, mertebesi aynı):

```powershell
npx tsx scripts/backfill_roll_production_timestamps.ts            # önizleme (finalizedAt 53 · statusChangedAt 752)
npx tsx scripts/backfill_roll_production_timestamps.ts --apply

npx tsx scripts/backfill-record-provenance.ts                     # önizleme (oluşturan 781 · son değiştiren 797)
npx tsx scripts/backfill-record-provenance.ts --apply

npx tsx scripts/backfill_roll_entry_station.ts                    # önizleme (SESSION 113 · RECEIPT 3 · PRODUCED_STEP 10)
npx tsx scripts/backfill_roll_entry_station.ts --apply

npx tsx scripts/backfill_roll_label_customer.ts                   # önizleme
npx tsx scripts/backfill_roll_fold_and_reason.ts                  # önizleme (8 topun sebebi audit'te YOK → NULL kalır; doğrusu bu)
```

**Her birini önce `--apply` OLMADAN koş, çıktıyı OKU, sonra uygula.** Sıra
serbest — birbirlerine bağımlı değiller.

> ⚠️ **ARAMA İÇİN BACKFILL YOKTUR ve gerekmez.** `<kolon>Fold` gölgeleri
> `GENERATED ALWAYS … STORED`'dır: değeri PostgreSQL üretir, kolon eklendiği anda
> tüm satırlar dolar. Uygulama o kolonlara **hiç yazmaz**.

---

### 5b) İş emri TİPİ düzeltmesi — 2026-08-21 saha hatası (DRY-RUN varsayılan)

Saha bildirimi: iş emri siparişe bağlı olduğu hâlde **listede "Stok"** yazıyor,
detay paneli/yan panel siparişi gösteriyor. Kök neden: "Sipariş Bağla"
(`POST /work-orders/:id/order-links`) pivot satırını yazıp `WorkOrder.type`'a
dokunmuyordu. Servis artık ilk bağda tipi aynı tx'te SİPARİŞE ÖZEL yapar
(backend tek başına yeter, istemci değişikliği YOK); geçmişte oluşmuş tutarsız
kayıtlar bu script ile onarılır (2026-08-21 10:33 yedeğinde **13 iş emri**,
hepsi IN_PROGRESS, hepsi "önce stok aç → sonra Sipariş Bağla" sırasıyla):

```powershell
npx tsx scripts/fix_workorder_type_from_links.ts            # önizleme — her iş emrini açılış/ilk bağ/siparişleriyle listeler (provada 13)
npx tsx scripts/fix_workorder_type_from_links.ts --apply    # STOCK_PRODUCTION → ORDER_PRODUCTION; audit TYPE_DERIVED_FROM_LINKS
```

İdempotent (ikinci koşumda 0). CANCELLED/SUPERSEDED dışarıda. Vardiya içinde
koşulabilir (13 satırlık UPDATE). Aynı kural `create()`/`replace()` için de sunucuya alındı (STOK + satır gövdesi → ORDER). Tersini (ORDER ama bağsız) **yapmaz** — o
ayrı bir karardır.

## 6) Canlıda koşulması GÜVENLİ bekçiler

`npm test` **koşma** (fixture yazar). Bunlar salt-okunur:

```powershell
npx tsx scripts/test_db_invariants.ts        # 79 kontrol — şema-dışı DB nesneleri
npx tsx scripts/test_schema_drift.ts         # repo datamodel ↔ canlı DB
npx tsx scripts/find_fold_duplicates.ts      # mükerrer ad raporu (yazmaz)
npx tsx scripts/test_master_data_merge_fk_coverage.ts   # saf statik analiz (şema metni + DMMF), DB'ye HİÇ dokunmaz
```

> ⚠️ **`test_master_data_merge.ts` ve `test_master_data_merge_conflicts.ts`
> CANLIDA KOŞULMAZ.** İkisi de gerçek kayıt yaratıp gerçekten birleştirir
> (`TESTMRG-`/`TESTCNF-` önekli fixture'lar). Adları "merge" diye yukarıdakiyle
> aynı aileye benziyor ama biri okur, diğerleri YAZAR — ayrımı ada bakarak değil
> bu satıra bakarak yap.

`test_schema_drift` yalnız **iki bilinen** DEFERRABLE composite FK farkını
göstermeli; başka fark KIRMIZI'dır.

⚠️ **Yeni işlerin bekçileri canlıda KOŞULMAZ** — üçü de fixture yazar:
`test_tambur_plan_gate` · `test_tambur_send_to_dye` · `test_plan_deviation_scorecard` ·
`test_fason_partial_receive`. Dev'de koşuldular (sırasıyla 48 · 22 · 12 · 43
kontrol, hepsi negatif sondalı). Canlıda karşılıkları §8c–§8e'deki **kabul
testleridir** — onlar gerçek ekrandan, tek kayıt üzerinden yapılır.

`roll_plan_deviations` tablosunun gerçekten kurulduğunu görmek için (salt-okunur):

```powershell
psql -U postgres -d tekserp -c "\d roll_plan_deviations"
psql -U postgres -d tekserp -c "SELECT count(*) FROM roll_plan_deviations;"   # deploy günü 0 NORMALDİR
```

---

## 7) ⏳ ELLE YAPILACAK — izin ataması (ÜÇ izin + bir rol yenileme)

Boot uzlaştırması izni **DB'ye getirir ama KİMSEYE ATAMAZ** (*katalog koda, atama
panele*). Provada ölçülen eksikler:

| İzin | Ne açar | Kime |
|---|---|---|
| **`data:import`** | Sistem → **Veri Aktarımı** ekranı + tanım ekranlarındaki "İçe Aktar" düğmeleri | Kurulum/veri işini yapan kişi + planlama sorumlusu |
| **`mobile:kk1-yari-mamul`** | KK1 — dışarıdan alınan yarı mamül kabulü (renkli giriş) | O işi yapan KK1 operatörleri (**yeni APK gerekir**) |
| **`master-data:merge`** | Sistem → **Mükerrer Kayıtlar** + tanım listelerindeki "Mükerrerler" düğmesi | Ana veriyi TANIYAN kişi (satış / planlama) — §10'daki mükerrer listesini kim temizleyecekse |

Atanmazsa ekran/düğme **hiç görünmez** ve sebebi hiçbir yerde yazmaz.
**Yapılacak:** Yetkilendirme → Kullanıcılar → kişi → Yetkiler → işaretle →
**kullanıcı yeniden giriş yapsın** (JWT'deki izin listesi bayat kalır).

> ⚠️ **`data:import` TEK BAŞINA YETMEZ, bu tasarım gereğidir.** Her uç ayrıca
> hedef verinin kendi yazma iznini arar: kumaş yüklemek için `data:import` **VE**
> `item:write`. Yalnız `data:import` taşıyan kişi ekranı görür, yazamayacağı
> türlerde düğme pasiftir ("Bu veriye yazma yetkiniz yok").
>
> ⚠️ **`admin:*` bu izni VERMEZ** (`settings:workstation` emsali): tek tıkla
> yüzlerce kaydı değiştirebilen bir yüzey wildcard'la sessizce dağıtılmamalı.
>
> ⚠️ **`master-data:merge` için de aynısı geçerli ve bir tuzağı daha var:**
> ikinci kapı varlığın write iznidir ve **renkte o izin `property:write`tir**
> (`color:write` diye bir kod YOKTUR). Yani "renk birleştirsin" isteniyorsa
> `master-data:merge` + `property:write` işaretlenir.
>
> ⚠️ **Ekran Sistem hub'ının altında ama hub `admin:settings` istiyor.** Yalnız
> `master-data:merge` taşıyan bir satış kullanıcısı hub'a giremez; ona
> ulaşacağı iki kapı var ve ikisi de bu sürümde açıldı: **Ctrl+K → "Mükerrer"**
> ve **Müşteri/Kumaş/Renk/Fason listelerindeki "Mükerrerler" düğmesi.**
> Kullanıcıya bu ikisini söyleyin, "Sistem menüsüne bak" DEMEYİN.
>
> ⚠️ **İKİ VARLIKTA ARANAN İZİN DEĞİŞTİ — kapanan bir açık, migration DEĞİL.**
> `renk` ve `ürün reçetesi` adaptörleri yanlış izin beyan ediyordu; toplu yol
> tekil yoldan GEVŞEKTİ ve fark ölçüldü (`test_import_permissions.ts` canlı
> sondası): `data:import` + `quality:write` taşıyan kullanıcı panelden tek renk
> açamıyordu (403) ama **toplu renk yükleyebiliyordu (200)**.
>
> | Varlık | ÖNCE aranan | ŞİMDİ aranan (tekil CRUD ile aynı) |
> |---|---|---|
> | Renk | `quality:write` | **`property:write`** |
> | Ürün reçetesi | `item:write` | **`station:write`** |
>
> **Operasyonel etki:** bu iki türü toplu yükleyen biri varsa ve yalnız eski
> izni taşıyorsa deploy sonrası 403 alır. Çözüm izin ataması (yeni izin KODU
> yok — ikisi de katalogda mevcut), tabloya göre doğru olanı verilir. Hiçbir
> kullanıcı bunu bugün taşımıyorsa yapılacak bir şey yok. Kontrol:
> ```sql
> SELECT u.username FROM users u
>   JOIN user_permissions up ON up."userId" = u.id
>   JOIN permissions p ON p.id = up."permissionId"
>  WHERE p.code = 'data:import';
> ```
> Çıkan her kullanıcı için panelden `property:write` / `station:write` durumuna
> bak — eksikse ver.
>
> **ÖLÇÜLDÜ (2026-08-19, fabrika verisinden çekilmiş dev DB):** `data:import`
> taşıyan 7 kullanıcının **tamamı** `property:write` ve `station:write` de
> taşıyor → **kimse etkilenmiyor, yapılacak atama yok.** Yukarıdaki SQL yine de
> canlıda koşulsun: dev kopyası 2026-08-02 tarihli, sonrasında yetki
> düzenlenmiş olabilir.

Boot log'unda beklenen satırlar (provada ölçüldü):

```
[permission-catalog] 2 EKSİK izin DB'ye yazıldı: data:import, mobile:kk1-yari-mamul
[role-templates] 'ADMIN_FULL' şablonuna 2 eksik izin eklendi: data:import, mobile:kk1-yari-mamul
[role-templates] 'WEB_SYSTEM_ADMIN' şablonuna 1 eksik izin eklendi: data:import
[role-templates] 'MOBILE_PRODUCTION_OPERATOR' şablonuna 2 eksik izin eklendi: customer-alias:write, label:edit
[role-templates] 'MOBILE_TAMBUR' şablonuna 2 eksik izin eklendi: customer-alias:write, label:edit
```

**Şablonu güncellemek, o şablonla AÇILMIŞ kullanıcıları güncellemez** — şablon
yalnız yeniden uygulandığında etki eder.

### ⏳ Bunun somut sonucu: Tambur operatörüne rol YENİDEN uygulanmalı

Boot uzlaştırması `customer-alias:write` + `label:edit`'i **şablona** ekler
(yukarıdaki iki `MOBILE_*` satırı). Sahadaki Tambur operatörü o şablonla **daha
önce** açıldığı için izinleri **almaz** — tablette müşteri-adı düzeltme kartı
görünmez ve sebebi hiçbir yerde yazmaz.

**Yapılacak:** Yetkilendirme → Kullanıcılar → *Tambur operatörü* → **Rol uygula**
→ `Mobil — Tambur Operatörü` → kaydet → **kullanıcı yeniden giriş yapsın**.

| İzin | Ne açar |
|---|---|
| `label:edit` | Bu top/sipariş için **tek seferlik** ad düzeltmesi (etikete basılan ad) |
| `customer-alias:write` | **Kalıcı** müşteri-adı eşlemesi (bundan sonraki tüm siparişler) |

İkisi ayrı bilinçli: tek seferlik düzeltme sistemdeki adı DEĞİŞTİRMEZ, kalıcı
eşleme değiştirir. Operatöre yalnız birini vermek meşru bir karardır.

Doğrulama:
```powershell
psql -U postgres -d tekserp -c "SELECT code FROM permissions WHERE code IN ('data:import','mobile:kk1-yari-mamul');"
```
İki satır dönmeli. Kullanıcıya atama yapılana kadar `user_permissions` boş — normal.

---

## 7b) ⏳ ELLE YAPILACAK — audit değiştirilemezlik korumasını AÇ

Migration trigger'ı **kurar** ama koruma **kapalı doğar**; açan tek şey aşağıdaki
komuttur. Bu, `statement_timeout` ile aynı sınıf bir ayardır: ortama aittir,
migration'a değil.

```powershell
psql -U postgres -d tekserp -c "ALTER DATABASE tekserp SET teks.audit_guard = 'on';"
# Ayar YALNIZ YENİ oturumlara etki eder → backend'i yeniden başlat:
pm2 restart tekserp-backend
```

**Doğrulama (üç yüzey, üçü de aynı şeyi söylemeli):**

```powershell
# 1) Yeni oturumda değer 'on' mu
psql -U postgres -d tekserp -c "SHOW teks.audit_guard;"

# 2) Koruma gerçekten ısırıyor mu — 0 satır etkileyen bir DELETE bile REDDEDİLMELİ
psql -U postgres -d tekserp -c "BEGIN; DELETE FROM system_logs WHERE false; ROLLBACK;"
#    Beklenen: ERROR: Audit kaydı değiştirilemez veya silinemez ...

# 3) Backend ne diyor
curl -s http://localhost:4000/health | findstr auditGuard
#    Beklenen: "auditGuard":"on"
```

Açılış log'unda da görünür: `[audit-guard] koruma AÇIK — audit kayıtları
salt-yazılır.` Kapalıysa aynı yerde ⚠️ uyarısı basar (adım unutulduğunda sessiz
kalmasın diye — 2026-08-01'de bir ops adımı tam da böyle unutulmuştu).

> **Ne yapar:** `system_logs` ve `system_log_archives` üzerinde UPDATE / DELETE /
> TRUNCATE'i reddeder (ISO 27001 A.8.15 — denetim kaydı sonradan oynanamaz).
> **Ne yapmaz:** INSERT'e dokunmaz, performansa etkisi yoktur (trigger yalnız
> engellenen işlemlerde ateşlenir).
>
> **Arşivleme etkilenmez:** `archiveOlderThan` kendi transaction'ında
> `SET LOCAL teks.audit_purge = 'on'` ile geçer. Bu arka kapı değildir —
> uygulama bağlantısından gelen sıradan bir sorgu o ayarı taşımaz. Prova
> edildi: guard açıkken arşivleme koştu, satırlar taşındı.
>
> **Geri alma** (gerekirse): `ALTER DATABASE tekserp RESET teks.audit_guard;`
> + restart. Trigger yerinde kalır, yalnız etkisizleşir.

---

## 8) Veri Aktarımı — 5 dakikalık kabul testi

1. **Sistem → Veri Aktarımı** açılıyor mu? (izni verdiğin kullanıcıyla gir)
2. Bir karttan **"Şablon"** indir → .xlsx üç sayfa olmalı: **Veri · Açıklama · Değerler**.
3. Aynı karttan **"Veriyi indir"** → mevcut kayıtlar şablonla **aynı sütunlarda** gelmeli.
4. İndirdiğin dosyada **tek bir satırı değiştir**, "İçe Aktar" ile yükle →
   önizlemede o satır **"Güncelle"**, diğerleri **"Değişiklik yok"** görünmeli.
   → *En önemli tek doğrulama budur.* Hepsi "Güncelle" görünüyorsa bir dönüştürme
   sorunu var: **UYGULAMA, geri bildir.**
5. **Uygula** → sonuç kartı + Geçmiş tablosunda satır.
6. Herhangi bir listede **"Sütunlar" → "CSV indir"** → Excel'de çift tıkla açılmalı,
   Türkçe karakterler ve sayılar bozulmamış olmalı.

---

## 8b) Hazır sebepler — 3 dakikalık kabul testi (izin ataması GEREKMEZ)

Tambur'da fire/kayıt düzeltmesi, elle top ekleme ve top iptali ekranlarındaki
hazır mesajlar artık **DB'den** geliyor ve fabrika kendisi düzenleyebiliyor.

**Yeni izin kodu YOK** — düzenleme yetkisi zaten atanmış olan `roll:manual-adjust`
(masaüstü süpervizör) **veya** `mobile:tambur-duzelt` (tablette saha düzeltmesi)
ile açılıyor. Yani §7'deki gibi elle atanacak bir şey yok; okuma herkese açık.

1. **Tanımlar → Üretim & Kalite → Hazır Sebepler** açılıyor mu? Dört sekme
   (Fire · Kayıt Düzeltmesi · Elle Top Ekleme · Top İptali) dolu mu?
   → Boşsa boot uzlaştırması koşmamıştır: backend log'unda `[reason-presets]`
   satırını ara, gerekirse **backend'i yeniden başlat**.
2. Fire sekmesinin **ilk satırı "Top başı"** olmalı (sahanın istediği sıra).
3. Bir satırda **kalem** → adını değiştir → kaydet. Liste anında güncellenmeli.
   Aynı satırda **çoğalt** → kopya kaynağın **hemen altına** düşmeli.
4. Tablette Tambur → bir topu bitir → **Fire** → sebep adımında:
   serbest metin kutusu **listenin ÜSTÜNDE** ve hep görünür olmalı; kutuya
   yazmaya başlayınca "Diğer" kendiliğinden seçilmeli.
5. Aynı ekranda bir sebebin yanındaki **kalem/çoğalt** tuşları görünüyor mu?
   → Görünmüyorsa o kullanıcıda `roll:manual-adjust` / `mobile:tambur-duzelt`
   yoktur; bu bir **hata değil**, yetki kararıdır.

> ⚠️ **BACKEND ÖNCE, APK SONRA.** Yeni APK, fabrikanın eklediği bir sebep kodunu
> gönderdiğinde katalogu tanımayan eski bir backend "Geçersiz sebep kodu" der.
> Ters sıra güvenli: yeni backend + eski APK sorunsuz çalışır (eski APK gömülü
> listeyi kullanır).
>
> ⚠️ **SATIR SİLİNMEZ, GİZLENİR** ve **son aktif satır gizlenemez** (400 döner).
> Sebep zorunlu bir alan olduğu için boş liste operatörü kilitlerdi.
>
> ⚠️ **Elle top ekleme ve iptal listelerinde** kayda metnin KENDİSİ yazılıyor →
> metni düzenlemek yalnız SONRAKİ kayıtları etkiler, geçmiş kayıtlar eski metinle
> kalır (ekran bunu uyarıyla söylüyor). Fire/kayıt düzeltmesinde böyle bir risk
> yok — orada satıra kod yazılıyor.

**Bu pakette ayrıca (adım gerektirmez) — CANLI BİR 500 KAPANDI:** "Sipariş Bağla"
akışındaki **süpervizör override** ucu (`POST /work-orders/:id/order-links/override`)
controller'da bind edilmemişti; yani uyumsuz sipariş bağlama onayı **her çağrıldığında
500 veriyordu**. Fabrika bunu "bağlama çalışmıyor" diye bildirmiş olabilir —
deploy sonrası çalıştığını Tambur → Sipariş Bağla → uyumsuz seçim → süpervizör
onayı ile doğrulayın. (Aynı sınıf hata `print-event`te de yaşandı: servis
testleri bunu GÖREMEZ, kırılan HTTP köprüsüdür; artık `test_controller_binds`
mekanik yakalıyor.)

**Bu pakette ayrıca (adım gerektirmez):** barkod araması küçük/BÜYÜK harf
duyarsızlığı üçüncü tur — Tambur "Çıkanlar" listesi + kartela liste/istatistik
aramaları normalize edilmiyordu ("top listede yok ama yan panelde açılıyor").
Saf backend düzeltmesi; doğrulaması Tambur'da barkodu **küçük harfle** yazıp
listede çıktığını görmek.

---

## 8c) Fason KISMİ KABUL — 5 dakikalık kabul testi

**Ne değişti:** Fasona 100 m gitti, 51 m geldi → artık **51'i kabul edip 49'u
açık bırakabiliyorsun** (SAP kısmi mal girişi karşılığı). Öncesinde kabul
ya hep ya hiçti; saha yarım dönüşü ya bekletiyor ya da eksik metrajı tam kabul
edip farkı kayıp yazıyordu.

**Kural (davranışı anlamadan test etme):**
- Kısmi kabulde top **TÜKETİLMEZ**: `AT_SUBCONTRACTOR` kalır, metrajı kalana iner.
- Her teslimat **AYRI makbuz**. Kalem yalnız **TAM** satırla kapanır.
- İkinci+ teslimatın topları **YENİ parti** alır (boya lotu ayrımı — bilinçli).
- "Kalan gelmeyecek" → **`POST /subcontractor/close-remainder`**: fark FİRE olarak
  sapma defterine yazılır (`source=SUBCONTRACTOR_REMAINDER`), kalem damgalanır.
- Makbuz iptali **LIFO**; kısmi iptal metrajı geri koyar.

**Test (kabul için):**
1. Mobil → Fason Kabul → açık bir sevk seç. Satırda **"Gelen (m)"** alanı olmalı.
2. Giden metrajdan AZ bir değer gir → kaydet. Satırda **YARIM rozeti** çıkmalı.
3. İş emri detayında top hâlâ **fasonda** görünmeli, metrajı düşmüş olmalı.
4. Kalanı kabul et → kalem kapanmalı, rozet gitmeli.
5. (Ayrı sevkte) 🔥 **Kalan Kapama** → sebep seç → fire sapma defterine düşmeli
   (Raporlar → Fire Karnesi'nde görünür).

⚠️ **BACKEND ÖNCE.** Eski APK tam kabulle çalışmaya devam eder (kısmi alanı
göndermez → backend tam kabul sayar). Ters sıra (yeni APK + eski backend) 400 verir.

Bekçi: `test_fason_partial_receive.ts` (43 kontrol, 3 negatif sonda).

---

## 8d) TAMBUR — plan-sapma kapısı + Sipariş Bağla + kısa kesim A1 (izin ataması GEREKMEZ)

Üç yüzey, hepsi **mevcut** yetkilere bağlı — atanacak yeni izin YOK. Ama
**davranış değişikliği var**, operatöre önceden söylenmeli (§9).

| Yüzey | Kim görür | Ne yapar |
|---|---|---|
| **Plan-sapma onayı** | Herkes (tambur operatörü) | Topun rengi/eni iş emri hedefinden saparsa bitirme/kesim **onay ister**; onay audit'e + kalıcı deftere düşer |
| **"Boyahaneye Geri Gönder"** | `roll:manual-adjust` \|\| `mobile:tambur-duzelt` | Onay modalının 3. tuşu — topu rotadaki önceki boya adımına geri alır |
| **"Sipariş Bağla"** | `workorder:write` | Tambur üst şeridinden iş emrine sipariş bağlama; uyumsuz seçim yalnız `roll:manual-adjust` taşıyanda |
| **Kısa kesimde otomatik A1** | Ayar: `admin:settings` (panel) · cihaz override: süpervizör çifti | **VARSAYILAN KAPALI** — açılmadan hiçbir şey değişmez |

**Kabul testi (3 dk):**
1. Panel → Genel Ayarlar → Üretim → **Tambur** grubunda "Kısa kesimde kalite
   otomatik A1" toggle'ı + altında **Eşik (metre)** alanı görünmeli.
2. Tablette rengi iş emrinden farklı bir topu bitir → **sarı onay penceresi**
   çıkmalı ("Plan ile top uyuşmuyor"), süpervizörde 3. tuş görünmeli.
3. Onayla → Raporlar → **Plan-Sapma Karnesi**'nde satır belirmeli.

⚠️ **Eşik girilmeden bayrağı açmak kuralı ÇALIŞTIRMAZ** (panel bunu amber
uyarıyla söyler). Fabrika tek eşikte karar kılmalı; tablet override'ı yalnız
istisna içindir ("bu tamburda metre makinesi yok" gibi).

---

## 8e) Plan-Sapma Karnesi — yeni rapor (izin ataması GEREKMEZ)

Raporlar → **Kalite** → **Plan-Sapma Karnesi** (`report:quality` — mevcut izin).
"Bu ay kaç kez plan dışına çıkıldı, ne kadar metraj, hangi kumaş/renkte, kim
onayladı" sorusunu yanıtlar; ISO 9001 düzeltici-faaliyet girdisi olarak da kullanılır.

⚠️ **İlk gün BOŞ görünecek** — defter deploy'dan sonra dolmaya başlar (geçmiş
onaylar yalnız audit'te ve oraya geriye dönük yazılmadı; bilinçli). Bu bir hata
DEĞİL. Rakam birkaç hafta sonra anlamlı olur.

⚠️ **İki sayı, iki ad:** "onay" (imza) ile "olay" (alan) ayrı sayılır — renk VE
en birlikte sapan top **BİR onaydır** ama iki olaydır; metraj bir kez sayılır.
Ekranda ipuçları bunu yazar.

---

## 9) OPERATÖRE ÖNCEDEN SÖYLENECEKLER

Bunlar hata değil **karar**dır; söylenmezse destek çağrısı gelir.

### 9-T1) TAMBUR: yanlış renkte/ende top artık SORU soruyor (yeni APK ile)
Topun rengi ya da eni iş emrinin istediğinden farklıysa "Bitir"/"Kes" anında sarı
bir pencere çıkar: *"Plan ile top uyuşmuyor — yine de bitir?"*.

- **Bu bir ENGEL DEĞİL:** operatör onaylayınca iş normal şekilde tamamlanır ve mal
  OLDUĞU GİBİ depoya iner. Onay yalnız **imza** bırakır (kim, ne zaman, neden).
- **Top başına BİR KEZ sorulur** — aynı topu seri kesiyorsan her parçada sormaz.
- **Onay topun kaydını DEĞİŞTİRMEZ.** Mal mavi ise mavi kalır; yanlış olan iş
  emriyse onu süpervizör "Sipariş Bağla / Düzelt" ile düzeltir.
- **Süpervizörde üçüncü tuş var:** "Boyahaneye Geri Gönder" — top rotadaki önceki
  boya adımına döner. ⚠️ Top o anda Tambur listesinden DÜŞER; nereye gittiğini
  ekrandaki yeşil bildirim yazar (istasyon adıyla). **Fasona giden mal ayrıca
  Fason Sevk ekranından gönderilmeli** — taşıma tek başına sevk değildir.
- **En farkında eşik ±10 cm:** küçük farklar (çekme payı) sormaz.

### 9-T2) TAMBUR: kısa kesimde otomatik A1 (AYAR — varsayılan KAPALI)
Panelden açılırsa: kesim uzunluğu girilen eşiğin altındaysa kalite kendiliğinden
**A1** yazılır. Yalnız **1. Kalite seçiliyken** devreye girer — operatör A1 ya da
Fire'ı kendi seçtiyse dokunmaz; otomatik yazılan A1 elle geri çevrilebilir ve
uzunluk eşiğin üstüne çıkarsa kendiliğinden 1. Kaliteye döner.
**Açılmadan hiçbir şey değişmez.**

### 9-T3) FASON: yarım dönüş artık kabul edilebiliyor (yeni APK ile)
100 m gitti, 51 m geldi → 51'i kabul et, 49 açık kalsın. Satırda **"Gelen (m)"**
alanı ve yarım dönüşlerde **YARIM rozeti** var.

- Kısmi kabulde top **fasonda kalır**, yalnız metrajı düşer.
- Kalan geldiğinde ikinci kabul yapılır; **o toplar yeni parti numarası alır**
  (farklı boya lotu oldukları için — bilinçli).
- Kalan hiç gelmeyecekse 🔥 **Kalan Kapama** ile sebep seçilir; fark **fire**
  olarak deftere yazılır ve Fire Karnesi'nde görünür.

### 9a-0) Ctrl+K artık KAYIT da buluyor (yeni)
Komut paleti bugüne kadar yalnız SAYFA arıyordu. Artık aynı kutuya yazılan terim
müşteri · kumaş · renk · sipariş · iş emri · sevkiyat · çuval · fason · parti
içinde de aranıyor ve sonuçlar listenin **altında** "Kayıtlar" başlığıyla çıkıyor.

- **Sonuçlar neden altta:** sunucudan ~150 ms sonra geliyorlar; üste eklenselerdi
  ok tuşuyla gezen kullanıcının altından liste kayar ve yanlış satır seçilirdi.
- **Tam barkod okutulursa** sonuç EN ÜSTE "Okutulan kod" olarak çıkar.
- **Herkes her şeyi görmez:** kullanıcı yalnız yetkisi olan türleri görür — bir
  kullanıcıda çıkan sonuç diğerinde çıkmıyorsa bu YETKİ farkıdır, arıza değil.

### 9a) Arama artık Türkçe harfe duyarsız
`canakkale` ≡ `ÇANAKKALE`, `sahin` ≡ `ŞAHİN`, `isik`/`ışık`/`IŞIK` aynı sonucu
verir. Çok kelimeli aramada sıra önemsiz ("şahin tekstil" ≡ "tekstil şahin").
Liste **daha çok** sonuç döndürecek — operatör "yanlış kayıt geldi" sanabilir,
doğrusu budur.

### 9b) Aynı ad ikinci kez EKLENEMEZ — kapsam genişledi
`ŞAHİN TEKSTİL` varken `SAHIN TEKSTIL` de mükerrer sayılır, 409 döner. Sahada aynı
firma üç yazımla giriliyordu. **Geçmiş kayıtlara dokunulmaz**, yalnız yeni yazımlar
engellenir.

### 9c-2) Müşterinin verdiği ad da aranabiliyor
Müşteri "BELLE'den 200 metre" dediğinde artık o adı yazan kişi bizim `18152`
kumaşını buluyor (canlı veride 19 alias var). Sonuç listesi her zaman BİZİM
adımızı gösterir.

### 9c-3) Yeni kayıt açarken "benzer kayıtlar" uyarısı çıkabilir
Müşteri/Kumaş formunda ad yazarken benzer kayıtlar sarı bir kutuda listelenir.
**Bu bir engel DEĞİLDİR** — operatör kaydetmeye devam edebilir. Amaç, aynı
firmanın ikinci kez açılmasını yazarken fark ettirmek. Yalnız BİREBİR aynı ad
kaydetmede 409 ile reddedilir (eskiden de öyleydi).

### 9c) Listeler artık Türkçe sıralanıyor
ICU varsa: `Cebeci < Ceyhan < Çanakkale < Işık < İnci < Zonguldak` — ayrıca
**sayı-duyarlı**: `P2 < P10` (sözlüksel sırada tersi görünürdü).
**Öncesi (C locale):** `… Zonguldak < Çanakkale < İnci` — yani Ç/Ğ/İ/Ö/Ş/Ü ile
başlayan **her ad listenin en sonundaydı**. Birçok "kayıt yok" şikayetinin sebebi
buydu.

### 9c-4) Fire sebeplerinde "Top başı" var ve liste artık DÜZENLENEBİLİR
Tambur'da fire girerken çıkan hazır mesajların **başına "Top başı"** eklendi.
Ayrıca yetkili kişi (süpervizör / Tambur düzeltme yetkisi olan) her satırın
yanındaki kalem ve çoğalt tuşlarıyla listeyi kendisi düzenleyebiliyor — yeni
sebep eklemek için artık bizden yeni sürüm beklemek gerekmiyor. Kendi cümlesini
yazmak isteyen operatör için metin kutusu artık **listenin en üstünde**.
Satırlar silinmiyor, **gizleniyor** (eski kayıtların sebebi okunur kalsın diye).

### 9d) Veri aktarımının davranış sözleşmeleri
- **Önizleme hiçbir şey yazmaz.** "Uygula" demeden tek kayıt değişmez.
- **Varsayılan: ya hep ya hiç.** Tek satırda hata varsa hiçbir şey yazılmaz;
  kullanıcı isterse "hatalı satırları atla"yı işaretler.
- **Boş hücre = O ALANA DOKUNMA.** Temizlemek için hücreye `NULL` yazılır.
- **Sunucunun ürettiği kodlar (RNK…, MUS…, ROT…, REC…, IST…, MAK…) dosyadan
  YAZILMAZ.** Yeni kayıtta kod hücresi **boş** bırakılır; dolu ama eşleşmeyen kod
  **hata** verir.
- **`PARTIAL` diye bir sonuç vardır:** doğrulama tüm satırlar için önceden koşar;
  yazarken beklenmedik hata çıkarsa **ilk hatada durulur** ve sonuç *"yazma N.
  satırda durdu"* der. Kısmi sonuç asla sessiz değildir.
- **Sipariş içe aktarımı YALNIZ YENİ SİPARİŞ AÇAR.** Aynı dosya iki kez
  yüklenirse iki sipariş olur. Son 90 günde aynı müşteriye aynı toplam metrajlı
  sipariş varsa **uyarı** verilir, engellenmez.
- **Rota ve Sipariş şablonları gruplu:** her ADIM / her KALEM ayrı satır, anahtar
  sütununa göre gruplanır. Adım/kalem listesi **replace**'tir — dosyada olmayan
  adım rotadan **silinir**.
- **Kalite Sınıfları ekranında "İçe Aktar" düğmesi YOK** (liste bilinçli
  salt-okunur), ama tür Veri Aktarımı ekranından aktarılabilir.
- **Dışa aktarım için ek izin yok** — listeyi görebilen indirebilir.
- **CSV biçimi:** `;` ayraç + ondalık **virgül** + UTF-8 BOM ("Türk Excel'i"
  sözleşmesi). Kendi içe aktarıcımız ayracı/ondalığı **otomatik algılar**, yani
  indir-düzenle-geri yükle çalışır.

---

## 10) BEKLENEN "KIRMIZI" — mükerrer müşteri (kod kusuru DEĞİL)

Deploy sonrası `find_fold_duplicates.ts` (ve `test_consistency` §18) mükerrer
gösterecek. Geliştirme kopyasında ölçülen: **12 grup / 15 fazla satır**:

```
Müşteri: Moda Tekstil [aktif]   |  MODA TEKSTİL [aktif]      ← ikisi de AKTİF
Kumaş  : ACTIVO [aktif]         |  ACTİVO [PASİF]            ← i/İ tuzağı
```

### Kararı hızlandıran ölçüm (salt-okunur, geliştirme kopyasında)

Fabrikaya "birleştirin" demeden önce **hangisinin gerçekten kullanıldığı**
sorulur. Çiftler için tek sorguyla bakılabilir:

```sql
SELECT c.code, c.name, c."isActive",
       (SELECT count(*) FROM orders o            WHERE o."customerId"=c.id)      AS siparis,
       (SELECT count(*) FROM shipments s         WHERE s."customerId"=c.id)      AS sevkiyat,
       (SELECT count(*) FROM customer_branches b WHERE b."customerId"=c.id)      AS sube,
       (SELECT count(*) FROM rolls r             WHERE r."labelCustomerId"=c.id) AS etiketli_top
FROM customers c WHERE c."nameFold" = public.tr_fold('Moda Tekstil');
```

Bu çift için ölçülen (geliştirme kopyası, 2026-08-19):

| Kod | Ad | Sipariş | Sevkiyat | Şube | Etiketli top |
|---|---|---|---|---|---|
| `MUS1707260010` | MODA TEKSTİL | **6** | 0 | 0 | 0 |
| `MUS-002` | Moda Tekstil | 0 | 0 | 1 | 1 |

⚠️ **Bu tablo bir öneri DEĞİL, girdidir.** İkisi de bağlantı taşıyor (biri
siparişleri, diğeri bir şube + bir etiketli top), yani "boş olanı kapat" diye
otomatik bir cevap YOK. Ayrıca `MUS-002` kodu standart `MUS+GGAAYY+NNNN`
biçiminde DEĞİL — kurulum/demo kaynaklı olabilir; bu da kararı fabrikanın
vermesini gerektiren bir sebep, kendi başına birleştirme gerekçesi değil.

Bu **gerçek bir veri sorunudur** ve sürüm onu *yaratmadı*, artık *görebiliyor*
(`name` Türkçe collation'a geçince `lower('İ')` düzeldi ve kontrol daha önce kör
olduğu çifti görüyor). **Otomatik birleştirme YOK ve olmamalı** — hangi kaydın
kalacağı, siparişlerin/topların hangisine bağlı olduğu **işletme kararıdır**.
Raporu fabrikaya ver, birleştirmeyi onlar söylesin. **Veriye kendi başına dokunma.**

### 🆕 Bu sürümde BİRLEŞTİRME ARACI var (Sistem → Mükerrer Kayıtlar)

Yukarıdaki kural DEĞİŞMEDİ — değişen, kararı verenin elinde artık bir araç
olması. Fabrika "birleştirin" dediğinde SQL yazılmaz; ekran kullanılır:

- **Nerede:** `Sistem → Mükerrer Kayıtlar`, ya da Müşteri/Kumaş/Renk/Fason
  listelerindeki **"Mükerrerler"** düğmesi, ya da Ctrl+K → "Mükerrer".
- **Yetki:** `master-data:merge` **+** varlığın kendi write izni (§7'ye bakın —
  atanmadan ekran görünmez).
- **Ne yapar:** kaynak kaydı SİLMEZ; `mergedIntoId` ile hedefe bağlar,
  referansları (sipariş/sevkiyat/top/alias…) hedefe taşır, kaynağı pasifleştirir.
- ⚠️ **GERİ ALINAMAZ.** Emniyet ağı gece yedeği + kopyaya geri yükleme
  (`db-copy.service.ts`). Vardiya dışında yapın.
- ⚠️ **Bu deploy'da HİÇBİR ŞEY otomatik birleşmez.** Araç yalnız operatörün
  dört katmanlı onayıyla çalışır (hedef seçimi → önizleme → gerekçe → hedefin
  KODUNU yazarak onay). Deploy sırasında sizin yapacağınız bir şey YOK.

> `nameFold` üzerinde **DB UNIQUE kısıtı hâlâ KONMADI** — canlıda mükerrer
> satırlar dururken migration tam o satırlarda düşerdi. Kısıt, fabrika listeyi
> temizledikten SONRA ayrı ve 5 satırlık bir migration olur (`WHERE
> "mergedIntoId" IS NULL` predicate'iyle — tombstone'lar kısıta girmez).

---

## 11) Riskler ve sınırlar (veri aktarımı)

| Konu | Durum |
|---|---|
| **Satır tavanı** | İstek başına **10.000 satır**; aşarsa panel dosyayı reddeder ve bölmeyi söyler. |
| **Gövde limiti** | `/api/import` ve `/api/config-bundle` router'ları **10 MB** JSON kabul eder. **Global 1 MB limiti DEĞİŞMEDİ** — gevşeme yalnız bu iki yola özgü. |
| **Performans** | 10.000 satırlık koşum **ölçülmedi**. Yazma mevcut servisler üzerinden satır satır ilerler (guard'lar korunsun diye). İlk gerçek kullanımda **200-500 satırla** başlanmalı. |
| **Yeni npm paketi** | **YOK.** Dosyayı panel ayrıştırır (`exceljs` zaten paneldeydi). |
| **Geri alma** | İçe aktarımın kendisi geri alınamaz (kayıtlar normal kayıttır). Yanlış yükleme panelden düzeltilir/pasife alınır. Bu yüzden "önce önizleme" alışkanlığı sahaya anlatılmalı. |
| **İçe aktarım geçmişi** | `import_runs` **arşivlenmez** — audit 6 ayda arşive taşınır, bu tablo kalır ("bu 400 müşteriyi kim yükledi" yıllar sonra sorulur). |

---

## 12) ROLLBACK

1. `pm2 stop <süreç-adı>`
2. Önceki commit'e dön (`git checkout <önceki>`), `npm ci && npm run build`
3. **DB'yi geri almak için:** `premigrate_` yedeğinden restore (runbook §5).
   Migration'lar geri-alınamaz kabul edilir.
4. Yalnız **veri aktarımını** geri almak: `DROP TABLE import_runs; DROP TYPE
   "ImportRunStatus";` — kaybolan yalnız içe aktarım geçmişidir, iş verisi değil.
5. Yalnız **aramayı** geri almak (nadiren gerekir): DB'ye dokunmadan önceki
   backend sürümüne dönmek yeterli — gölge kolonlar türetilmiştir, varlıkları
   eski kodu bozmaz.
6. Trigram index'leri sorun çıkarırsa (beklenmiyor) tek tek `DROP INDEX
   CONCURRENTLY` ile atılabilir; arama index'siz çalışmaya devam eder.
7. Yalnız **hazır sebep kataloğunu** geri almak: `DROP TABLE reason_presets;
   DROP TYPE "ReasonPresetKind";` — kaybolan yalnız fabrikanın düzenlemeleridir.
   Eski backend zaten koda gömülü listeyi kullanır; **geçmiş fire kayıtları
   etkilenmez** (sebep kodu `roll_variances` satırında saklı, bu tabloya FK YOK).

---

## 13) İLERİDE DOKUNACAK OLAN İÇİN — dört teknik tuzak

1. **Sıra load-bearing:** collation değişimi generated kolondan **ÖNCE** gelmek
   zorunda; tersi PostgreSQL tarafından reddedilir
   (`ERROR: cannot alter type of a column used by a generated column`).
   Katlanmış bir kolonun tipini/collation'ını değiştirecek olan, önce gölge
   kolonu DROP etmeli.
2. **`tr_fold` içindeki `COLLATE "C"` pini süs değil.** Ad kolonları Türkçe
   collation'a geçti; tr collation altında `lower('I')` = `'ı'` olur ve katlama
   i-ailesini **ayırırdı** (arama sessizce bozulurdu). Aynı pin, geliştirme
   ortamı (ICU en-US) ile sahadaki C locale kurulumunun **aynı** cevabı vermesini
   sağlıyor.
3. **`system_logs`'a UPDATE/DELETE yapan GELECEKTEKİ bir veri migration'ı
   `SET LOCAL teks.audit_purge = 'on'` ile BAŞLAMALI.** Koruma açıldıktan sonra
   `prisma migrate deploy` oturumu da guard'ı miras alır — düz bir `UPDATE
   system_logs SET ...` deploy'u yarıda kesip migration'ı yarım uygulanmış
   bırakır. Aynı şey elle `psql` düzeltmeleri için de geçerli.
4. **Trigger adları tablolar arası benzersiz olmak zorunda.**
   `scripts/test_db_invariants.ts` trigger envanterini YALNIZ ADA GÖRE haritalar;
   iki tabloda aynı adı kullanmak Map'te tekini bırakır ve envanter sessizce
   yanlış çalışır. Ayrıca beklenen "timing" metni PG'nin **kanonik** olay
   sırasını taşımalı (`BEFORE DELETE OR UPDATE OR TRUNCATE`) — migration'da ne
   sırayla yazıldığının önemi yok, `pg_get_triggerdef` onu yeniden sıralar.

---

## 14) BİTİNCE — bu bölümü sunucudaki oturum doldursun

```
Deploy tarihi/saati       :
pg_trgm durumu            : (kuruluydu / contrib kopyalandı / …)
ICU (tr_sort provider)    : i (ICU) / c (libc) / kurulamadı
migrate deploy süresi     :
GENERATED kolon sayısı    :        (31 bekleniyor)
import_runs tablosu       : ☐
system_logs changes/device: ☐
Backfill'ler              : timestamps ☐  provenance ☐  entry_station ☐  label_customer ☐  fold_and_reason ☐
İş emri tipi düzeltmesi   : ☐ fix_workorder_type_from_links --apply (§5b — önizlemede ...... iş emri, provada 13)
İzin ataması              : data:import → ................  ·  mobile:kk1-yari-mamul → ................
Tambur rolü yeniden      : ☐ (label:edit + customer-alias:write — kullanıcı: ................)
audit_guard AÇILDI       : ☐  ALTER DATABASE + restart (§7b)
  SHOW teks.audit_guard  : ......      (beklenen: on)
  /health auditGuard     : ......      (beklenen: on)
  DELETE reddedildi mi   : ☐  (0 satırlık DELETE bile hata vermeli)
find_fold_duplicates      : ...... grup / ...... fazla satır  → fabrikaya iletildi mi ☐
Veri Aktarımı kabul testi : ☐ (§8'in 6 adımı)
roll_plan_deviations      : ☐ tablo var   (satır sayısı deploy günü 0 — NORMAL)
Fason kısmi kabul testi   : ☐ (§8c'nin 5 adımı — YARIM rozeti göründü mü)
Tambur plan-sapma testi   : ☐ (§8d — sarı onay penceresi + karnede satır)
Kısa kesim A1 ayarı       : ☐ kapalı bırakıldı  /  ☐ açıldı → eşik: ...... m
Electron sürümü           :
APK sürümü                : (dağıtıldıysa — bu pakette 2.9.1 / versionCode 48)
Sorun / sapma             :
```
