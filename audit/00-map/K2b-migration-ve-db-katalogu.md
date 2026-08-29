# K2b — Migration ham SQL envanteri + canlı DB kataloğu (dev ↔ saha)

**Aşama:** ① KEŞİF (haritalama; yargı yok, bulgu yok — yalnız HOTSPOT işaretleri).
**Tarih:** 2026-08-28 · dal `adnansahin` · HEAD `ce8681d1` · Yazan: K2b haritalayıcı ajanı.
**Kaynaklar:** `Teks-Erp/prisma/migrations/**/migration.sql` (195 migration dizini + `migration_lock.toml`; 10.022 satır SQL) · `Teks-Erp/prisma/schema.prisma` · `Teks-Erp/scripts/test_db_invariants.ts` (793 satır) · `Teks-Erp/scripts/test_schema_drift.ts` · `Teks-Erp/scripts/test_migration_hygiene.ts` · `scripts/check-migrations.mjs` · `Teks-Erp/src/lib/prisma.ts` · `Teks-Erp/src/server.ts` · `Teks-Erp/src/app.ts` · `Teks-Erp/src/services/audit.service.ts` · `Teks-Erp/CLAUDE.md` (perf kuralları 4/14) · `Teks-Erp/ARCHITECTURE.md §10`.
**DB erişimi:** yalnız `audit/tools/sql-dev.sh` (dev `adnansahin_db`, PG 18.6, 195 migration) ve `audit/tools/sql-saha.sh` (prod'un 2026-08-25 kopyası `tekserp_saha_0825`, aynı PG 18.6 sunucusuna restore, 190 migration). Her ikisi `default_transaction_read_only=on`. Canlı prod'a erişim YOK.
**Yöntem notu:** Sorgu dosyaları scratchpad'de tutuldu (`audit/data`'ya yazılmadı); tablolarda "ölçüm" diye anılan her sayı bu iki araçla 2026-08-28'de alındı. Repo altında hiçbir dosya değiştirilmedi.

> Terim: **"şema-dışı nesne"** = `schema.prisma`'nın ifade EDEMEDİĞİ, ham SQL migration'la kurulan PostgreSQL nesnesi (partial index predicate'i, CHECK, DEFERRABLE composite FK, expression index, trigger, fonksiyon, collation, GENERATED kolon, extended statistics, extension). Repo bunları `scripts/test_db_invariants.ts` ile iki yönlü envanterliyor (`Teks-Erp/CLAUDE.md:239`).

---

## 0. Özet sayılar

| Ölçüt | Migration dosyaları (repo) | DEV canlı | SAHA kopyası canlı |
|---|---|---|---|
| Migration | 195 dizin | 195 uygulanmış (**40'ı `applied_steps_count=0` = `migrate resolve --applied`**) | 190 uygulanmış (hepsi `applied_steps_count=1`); eksik 5 → §2.6 |
| CHECK kısıtı | 27 `ADD CONSTRAINT … CHECK` (26 `NOT VALID`+`VALIDATE`, 1 doğrudan) | 26, hepsi `convalidated=t` | 26, hepsi `convalidated=t` |
| UNIQUE constraint (`contype=u`) | 1 (`sacks_id_shipmentId_key`) | 1 | 1 |
| UNIQUE index (constraint'siz) | — | 192 | 192 |
| Toplam index | 621 `CREATE INDEX` ifadesi (init dahil), 92 `DROP INDEX` | 473 | 472 |
| Partial index (`WHERE`) | ~45 CREATE (bazıları sonradan düşürüldü) | **38** (15 UNIQUE) | **37** |
| Expression index | 3 | 2 | 3 |
| TRIGGER | 3 (2 migration) | 3 (`tgenabled='O'`) | 3 |
| FUNCTION (public, uzantı dışı) | 4 | 4 | 4 |
| EXCLUDE | **0** | 0 | 0 |
| `CREATE INDEX CONCURRENTLY` | **0** | — | — |
| `SET statement_timeout = 0` | **32 dosya** | — | — |
| `DO $$` bloğu | 8 blok / 5 dosya (§1.10) | — | — |
| FK | 147 tek migration'da (`native_uuid`) + sonrakiler | 282 (`a`=2 · `c`=41 · `n`=168 · `r`=71) | 281 (`n`=167) |
| GENERATED STORED kolon | 33 (31 `search_fold` + 2 `alias_search`) | 33 kolon / 23 tablo | 33 / 23 |
| Extended statistics | 1 (`sl_day_exact`, iki kez tanımlandı) | 1 | 1 |
| Collation | 1 (`tr_sort`) | `tr_sort` ICU `tr-u-kn` | aynı |
| Extension | `pg_trgm` (fail-soft) | `pg_trgm 1.6`, `unaccent 1.1` (elle), `plpgsql` | `pg_trgm 1.6`, `plpgsql` |
| Enum | 45 tip; 21 `ADD VALUE`, 8 `DROP TYPE` | 45 | 45 (ReasonPresetKind'da 1 değer eksik) |
| Tablo | 92 | 92 | 92 |
| `timestamp without time zone` kolon | 183 → `timestamptz` (20260801040000) | **0** | **0** |
| Sequence | 0 (sayaçlar tablo/uygulama) | 0 | 0 |
| PK'siz tablo | — | 0 | 0 |
| Geçersiz index (`indisvalid=false`) | — | 0 | 0 |

---

## 1. HAM YAPI ENVANTERİ (Prisma'nın modellemediği nesneler, migration + satır)

### 1.1 CHECK kısıtları (27 ifade; 26 canlı — `shipment_allocations_qty_pos` tablosuyla birlikte düştü)

| # | Tablo.kısıt | Koşul | Migration:satır | Desen |
|---|---|---|---|---|
| 1 | `rolls.rolls_currentQty_nonneg` | `currentQty >= 0` | `20260708120000_faz4_db_constraint_hardening:13` (+VALIDATE :22) | NOT VALID → VALIDATE |
| 2 | `rolls.rolls_initialQty_nonneg` | `initialQty >= 0` | `…faz4:14` (:23) | " |
| 3 | `rolls.rolls_weightKg_nonneg` | `weightKg IS NULL OR >= 0` | `…faz4:15` (:24) | " |
| 4 | `order_lines.order_lines_quantity_pos` | `quantity > 0` | `…faz4:16` (:25) | " |
| 5 | `order_lines.order_lines_shippedQty_nonneg` | `shippedQty >= 0` | `…faz4:17` (:26) | " |
| 6 | ~~`shipment_allocations_qty_pos`~~ | `qty > 0` | `…faz4:18` — tablo `20260711120000_cuval_havuzu_remodel:65`'te DROP | **canlıda yok** |
| 7 | `sacks.sacks_weightKg_nonneg` | `weightKg IS NULL OR >= 0` | `…faz4:19` (:28) | " |
| 8 | `work_order_steps.work_order_steps_time_order` | `completedAt IS NULL OR startedAt IS NULL OR completedAt >= startedAt` | `…faz4:20` (:29) | " |
| 9-12 | `roll_movements.{qtyIn,qtyOut,weightIn,weightOut}_nonneg` | `>= 0` (null-toleranslı) | `20260731120000_audit_check_hardening:20-23` (VALIDATE :59-62) | " |
| 13 | `roll_errors.roll_errors_startMeter_nonneg` | `startMeter >= 0` | `…audit_check:24` (:63) | " |
| 14 | `sack_allocations.sack_allocations_qty_pos` | `qty > 0` | `…audit_check:31` (:64) | " |
| 15 | `subcontractor_direct_ship_allocations_qty_pos` | `qty > 0` | `…audit_check:32` (:65) | " |
| 16 | `work_order_to_order_lines_allocatedQty_nonneg` | `allocatedQty >= 0` | `…audit_check:33` (:66) | " |
| 17-18 | `subcontractor_dispatch_items.dispatchedQty_pos / dispatchedWeight_nonneg` | `> 0` / `IS NULL OR >= 0` | `…audit_check:38-39` (:67-68) | " |
| 19-20 | `kartela_dispatch_items.dispatchedQty_pos / dispatchedWeight_nonneg` | " | `…audit_check:40-41` (:69-70) | " |
| 21 | `kartela_receipt_items_kartelaCount_pos` | `kartelaCount > 0` | `…audit_check:42` (:71) | " |
| 22 | `swatch_stock_reductions_count_pos` | `count > 0` | `…audit_check:43` (:72) | " |
| 23-24 | `direct_shipments.totalQty_pos / rollCount_pos` | `> 0` | `…audit_check:44-45` (:73-74) | " |
| 25 | `roll_returns.roll_returns_qty_pos` | `qty > 0` | `…audit_check:51` (:75) | " |
| 26 | `work_orders.work_orders_stockprod_targetItem` | `type <> 'STOCK_PRODUCTION' OR targetItemId IS NOT NULL` | `…audit_check:52-53` (:76) | koşullu zorunluluk |
| 27 | `roll_variances.roll_variances_qty_positive` | `qty > 0` | `20260809015353_roll_variance_ledger:52` | doğrudan (yeni tablo) |

Repo envanteri `scripts/test_db_invariants.ts:197-236` (`CHECK_CONSTRAINTS`, 26 kayıt) canlıyla **birebir** (iki DB'de de 26/26 doğrulanmış). Not: `Teks-Erp/CLAUDE.md:239` "27 CHECK" der — bayat sayı (dosya kendisi "sayılar bayatlar" diye uyarıyor).

### 1.2 Partial UNIQUE index'ler (iş kuralı seddi olanlar)

| Index | Tablo(kolon) | Predicate | Migration:satır | Şemadaki karşılığı |
|---|---|---|---|---|
| `roll_movements_one_open_per_roll_step_uq` | `roll_movements(rollId, workOrderStepId)` | `exitedAt IS NULL` | `20260612101000_unique_open_movement_per_roll_step:38-40` (öncesinde dedup UPDATE :18-35) | YOK (bilinçli, `schema.prisma:3269`) |
| `kursun_bypass_one_pending_per_step_uq` | `kursun_bypass_assignments(workOrderStepId)` | `completedAt IS NULL AND cancelledAt IS NULL` | `20260731120000_add_kursun_bypass_assignment:91-93` | YOK (`schema.prisma:2442-2447`) |
| `roll_errors_roll_meter_defect_uq` | `roll_errors(rollId, startMeter, defectTypeId)` | `defectTypeId IS NOT NULL` | `20260623100000_roll_error_dup_partial_unique:9-11` | `@@unique` (`schema.prisma:2760`) |
| `work_sessions_active_machine_uq` | `work_sessions(machineId)` | `endedAt IS NULL AND machineId IS NOT NULL` | `20260702121000_work_sessions:36` | YOK (`schema.prisma:1031-1036`) |
| `work_sessions_active_device_uq` | `work_sessions(deviceId)` | `endedAt IS NULL` | `…work_sessions:37` | YOK |
| `label_templates_one_default_per_kind` | `label_templates(kind)` | `isDefault = true` | `20260622120100:9` → DROP `20260706090000_label_studio_schema:30` → GERİ `20260708180000_worklist_updatedat_labeldefault:15` | YOK (`schema.prisma:4905`) |
| `label_template_variants_one_primary` | `label_template_variants(templateId)` | `isPrimary = true` | `20260706090000_label_studio_schema:61-62` | YOK (`schema.prisma:4923`) |
| `traveler_card_templates_isDefault_key` | `traveler_card_templates(isDefault)` | `isDefault = true` | `20260803183003_traveler_card_template:41-43` | `@@unique` (PARTIAL olmak ZORUNDA — düz unique 2 şablonla sınırlardı, dosya başlığı :7-13) |
| `rolls_clientToken_key` | `rolls(clientToken)` | `clientToken IS NOT NULL` | `20260709100000_roll_barcode_client_token:5` | `@unique` |
| `orders_clientToken_key` / `work_orders_clientToken_key` / `swatch_stock_reductions_clientToken_key` | `(clientToken)` | `IS NOT NULL` | `20260714150000_client_token_idempotency:27,30,33` | `@unique` |
| `customers_nameFold_key` · `items_nameFold_key` · `subcontractors_nameFold_key` | `(nameFold)` | `mergedIntoId IS NULL` | `20260821150000_name_fold_unique_live:69-71` (DO bloğu, **YUMUŞAK KAPI**) | `@@unique([nameFold])` (`schema.prisma:1317,1889,3726`) |
| `colors_nameFoldColor_key` | `colors(tr_fold_color(name))` — **expression + partial** | `mergedIntoId IS NULL` | `20260825120000_color_name_unique_live:73-74` (DO bloğu, YUMUŞAK KAPI) | YOK (expression modellenemez; `schema.prisma:4547-4549`) |

Tarihsel (düşürülmüş) partial unique'ler — kural yer değiştirdi: `sacks_manualCode_idx` (AMB regex `20260622120000:15` → `IS NOT NULL` `20260711120000:32` → kolon düştü `20260712120000:11`), `sacks_shipmentId_manualCode_idx` (`20260708120000:45` → `20260711120000:28`), `shipment_orders_active_order_uq` (`20260708160000:18` → `20260711120000:87`; "bir sipariş tek aktif sevkiyatta" kuralı DB'den KALKTI), `traveler_cards_wo_active_uniq` (`20260623110000:9` → `20260713120000:23`) ve `traveler_cards_batch_active_uniq` (`20260713120000:63` → `20260714120000:68`) — yerine **tam** unique `traveler_cards_workOrderId_key` (`20260714120000:74`, WO başına tek kart, statü bağımsız).

### 1.3 Partial (non-unique) index'ler — null-yoğun FK / kuyruk süzgeçleri

| Index | Predicate | Migration:satır |
|---|---|---|
| `rolls_sackId_idx` · `rolls_shipmentId_idx` · `rolls_parentReceiptId_idx` | `IS NOT NULL` | ilk `20260606001717:9,12,15` → `native_uuid` düşürdü → onarım `20260612100000_repartialize_after_native_uuid:20,23,26` |
| `rolls_batchId_idx` | `batchId IS NOT NULL` | `20260713120000_parti_modeli:57` |
| `rolls_markedForKartela_idx` | `= true` | `20260607020000:7` |
| `rolls_labelCustomerId_idx` | `IS NOT NULL` | `20260809023731:17` |
| `rolls_finalizedAt_idx` | `IS NOT NULL` | `20260809090000:33-35` |
| `swatches_createdAt_idx` | `cancelledAt IS NULL` | `20260607030000:10` |
| `swatches_{parentReceiptId,shipmentId,sackId}_idx` | `IS NOT NULL` | `20260612100000:30,33,36` |
| `work_orders_splitFromId_idx` | `IS NOT NULL` | `20260612100000:43` |
| `work_order_steps_stationId_status_isUrgent_priority_started_idx` | `status <> 'COMPLETED'` | `20260607010000:23-25` |
| `roll_movements_exitedAt_idx` | `IS NOT NULL` | `20260612102000:23-25` |
| `roll_errors_isProcessed_idx` | `= false` | `20260708130000_faz5_index_cleanup:49` |
| `roll_returns_returnGroupId_idx` | `IS NOT NULL` | `20260805100000:20-21` |
| `orders_active_createdAt_idx` (`createdAt DESC, id DESC`) | `status <> 'CANCELLED'` | `20260826120000:28-29` — **sahada YOK** |
| `batches_splitFromId_idx` · `batches_mergedIntoId_idx` | `IS NOT NULL` | `20260713120000:54` · `20260715233000:18` |
| `{customers,items,colors,subcontractors}_mergedIntoId_idx` | `IS NOT NULL` | `20260819210000_master_data_merge_lineage:70-73` (önce DROP :65-68 — dev'de Prisma tam index yaratmıştı) |

Düşürülmüş partial non-unique: `rolls_batchSplitId_idx` (`20260606001717:18`, kolon `20260713120000:27`'de düştü), `sacks_shipmentId_idx` (`20260609120000:23` → `20260708130000:41` sol-prefix redundant), `rolls_supplierLotNo_idx` (`20260708150000:35` → kolon `20260708170000:11`).

### 1.4 Expression index'ler (3)

| Index | İfade | Migration:satır | Not |
|---|---|---|---|
| `users_username_lower_uq` | `lower(username)` UNIQUE | `20260731160000_lowprio_unique_hardening:20` | app `mode:'insensitive'` kontrolünün yarış seddi (dosya :14-19); username ASCII → `lower()` güvenli |
| `permission_templates_name_lower_uq` | `lower(name)` UNIQUE | `…lowprio:21` | " |
| `colors_nameFoldColor_key` | `public.tr_fold_color(name)` UNIQUE + `WHERE mergedIntoId IS NULL` | `20260825120000:73-74` | fonksiyon `IMMUTABLE STRICT` zorunlu (:46-47); ayırıcı sınıfı JS `\s` kümesinin açık listesi (:17-22, `\s` YASAK — ctype bağımlı) |

### 1.5 TRIGGER + FUNCTION

| Nesne | Tanım | Migration:satır | Koruduğu/yaptığı şey |
|---|---|---|---|
| FN `roll_stamp_production_timestamps()` plpgsql, VOLATILE | BEFORE INSERT/UPDATE, `FOR EACH ROW` | `20260809090000_roll_production_timestamps:45-91` | `statusChangedAt` (statü GERÇEKTEN değişince, `IS DISTINCT FROM` :66) ve `finalizedAt` (INSERT'te final statüde doğan :56-59; UPDATE'te kaynak `IN_PRODUCTION/STOCK/AT_SUBCONTRACTOR/RETURNED_FROM_SUBCONTRACTOR` → hedef `WAREHOUSE/A1_STOCK/SCRAP` :79-86). **`SHIPPED`/`CANCELLED` kaynak listesinde BİLEREK YOK** (:71-77). Üzerine yazılır (write-once değil :81-84) |
| TRG `rolls_stamp_production_timestamps` | `ON rolls` | `…:93-96` | tek yazma noktası; 40+ uygulama çağrı noktasına güvenilmiyor (:16-19) |
| FN `audit_block_tamper()` plpgsql | statement-level, `RETURN NULL` | `20260819161000_audit_tamper_guard:46-59` | `teks.audit_guard='on'` **ve** `teks.audit_purge<>'on'` ise UPDATE/DELETE/TRUNCATE'i `insufficient_privilege` ile reddeder. **Varsayılan KAPALI** (GUC set edilmemişse `coalesce(...,'')` → geçer :29-31) |
| TRG `system_logs_block_tamper` | `BEFORE UPDATE OR DELETE OR TRUNCATE ON system_logs FOR EACH STATEMENT` | `…:61-63` | audit değiştirilemezliği (ISO 27001 A.8.15) |
| TRG `system_log_archives_block_tamper` | aynı, `system_log_archives` | `…:65-67` | arşiv de audit'tir; **ayrı ad zorunlu** (bekçi ada göre haritalıyor :39-41) |
| FN `tr_fold(text)` SQL, `IMMUTABLE STRICT PARALLEL SAFE` | NFD → işaret at → istisna tablosu → `lower(... COLLATE "C")` → boşluk tekle | `20260819060000_search_fold:88-103` | 33 GENERATED kolonun ve trigram aramanın temeli; JS ikizi `src/utils/search-fold.ts` (parite bekçisi `scripts/test_fold_contract.ts`) |
| FN `tr_fold_color(text)` SQL, IMMUTABLE STRICT | `tr_fold` + token böl + sayısal-önce sırala + `string_agg` | `20260825120000:46-56` | renk ad seddinin ifadesi; JS ikizi `foldColorNameForCompare` |

Uygulama tarafı: meşru arşiv silmesi `SET LOCAL teks.audit_purge = 'on'` — `src/services/audit.service.ts:233` (tx'in İLK ifadesi, `deleteMany`'den önce; sıra load-bearing :229-232). Koruma durumu iki yüzeyde görünür: boot uyarısı `src/server.ts:59-75` (yalnız `NODE_ENV=production`) ve `/api/admin/health` → `auditGuard` (`src/app.ts:375`). Açma komutu ops adımı: `docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md:635` (`ALTER DATABASE tekserp SET teks.audit_guard = 'on'`); kontrol listesi :1080 satırı `☐` (işaretsiz) — **prod'da açılıp açılmadığı bu kopyadan doğrulanamaz** (§2.5).

### 1.6 Diğer şema-dışı nesneler

| Sınıf | Nesne | Migration:satır | Not |
|---|---|---|---|
| UNIQUE constraint | `sacks_id_shipmentId_key UNIQUE(id, shipmentId)` | `20260708120000_faz4:77` | composite FK'nın hedefi; şemada `@@unique([id, shipmentId])` (`schema.prisma:4202`) |
| DEFERRABLE composite FK | `rolls_sackId_shipmentId_consistency_fkey (sackId, shipmentId) → sacks(id, shipmentId)` `ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED` | `…faz4:79-81` | O-22: top çuvaldaysa `shipmentId` çuvalınkiyle aynı olmalı; MATCH SIMPLE (biri NULL → atlanır); **`ON UPDATE CASCADE` = çuval başka sevkiyata taşınınca topların `shipmentId`'si uygulama DIŞINDA değişir** (:74-75) |
| DEFERRABLE composite FK | `swatches_sackId_shipmentId_consistency_fkey` | `…faz4:83-85` | aynı kural, kartela |
| Extended statistics | `sl_day_exact ON ((DATE_TRUNC('day', "createdAt" AT TIME ZONE 'Europe/Istanbul')::date)) FROM system_logs` | `20260614120000:31-33` → DROP+CREATE `20260801050000:32-36` (+`ANALYZE system_logs` :40) | ifade `src/constants/time.ts` `factoryDaySql` metniyle BİREBİR eşleşmeli; ayrışırsa sessizce devre dışı (yalnız plan, sonuç doğru) |
| Collation | `public.tr_sort` ICU `tr-u-kn-true` (libc `tr_TR.UTF-8` yedeği; ikisi yoksa NOTICE) | `20260819060000:124-142`; 18 ad kolonuna uygulama :148-173 | `ALTER COLUMN … TYPE … COLLATE` = küçük tablolarda rewrite; **generated kolondan ÖNCE** (:9-13, PG reddeder) |
| GENERATED STORED | 31 `<kolon>Fold` (`customers/items/colors/stations/…/shipments/roll_returns`) | `20260819060000:179-209` | + 2 `aliasFold` `20260819140000_alias_search:24-25`; uygulama HİÇ yazmaz, `base.service` `Fold` son ekine bakarak süzer (`test_db_invariants.ts` §9 çift yönlü sözleşme) |
| Extension | `pg_trgm` — `CREATE EXTENSION` EXCEPTION ile sarılı (fail-soft) | `20260819060000:60-72` | yoksa deploy DURMAZ, 9+2 GIN index atlanır (:263-282, `20260819140000:33-45`), bekçiler kırmızı kalır |
| GIN trigram index | 9 (`customers/items/colors nameFold`, `order_lines.customerItemNameFold`, `orders.orderNumber`, `work_orders.workOrderNumber`, `shipments.shipmentNo`, `batches.batchNumber`, `sacks.sackNo`) + 2 alias | `20260819060000:270-278`, `20260819140000:40-41` | canlıda 11/11 (iki DB) |
| Sayaç tablosu | `roll_barcode_counters(day, type, n)` PK(day,type) | `20260709110000_roll_barcode_counter:4-9` | uygulama `INSERT … ON CONFLICT DO UPDATE SET n=n+1 RETURNING n` (satır kilidi; sequence DEĞİL) |
| Advisory lock | — (DB nesnesi değil) | uygulama: `pg_advisory_xact_lock(8021,…)` KK1 mükerrer, `(8022,1)` parti no (`20260805120000:9-15` gerekçesi) | `batches_batchNumber_key` DROP edilince yarış koruması kilide taşındı |

### 1.7 `SET statement_timeout = 0` satırları (32 dosya)

`20260607010000:20` · `20260607020000:4` · `20260607030000:7` · `20260609120000:11` · `20260612100000:16` · `20260612101000:14` · `20260612102000:16` · `20260612103000:6` · `20260614120000:29` · `20260627001848:4` · `20260708120000:8` · `20260708130000:9` · `20260708140000:3` · `20260708150000:5` · `20260708160000:8` · `20260708170000:7` · `20260708180000:2` · `20260708190000:4` · `20260708200000:9` · `20260708210000:7` · `20260711120000:6` · `20260713120000:17` · `20260730170000:13` · `20260731120000_add_kursun_bypass_assignment:31` · `20260731120000_audit_check_hardening:14` · `20260731150000:6` · `20260731160000:3` · `20260731210000:47` · `20260801040000:85` · `20260801050000:30` · `20260819060000:39` · `20260819140000:22`.
Gerekçe her dosyada aynı: app DB'sinde per-DB `statement_timeout=50s` (`ALTER DATABASE … SET`, `Teks-Erp/CLAUDE.md:253,257`) uzun DDL'i keser. Bilinçli olarak KONMAYAN dosyalar gerekçesini yazıyor (`20260805090000:22`, `20260805120000:18`, `20260821150000:49`, `20260821150100:20`, `20260825120000:42`, `20260826120000:27` — "tablo küçük / metadata-only").
`lock_timeout` hiçbir migration'da YOK; `SET LOCAL`/`SET SESSION` YOK.

### 1.8 Zero-downtime açısından riskli DDL sınıfları

| Sınıf | Adet | Nerede | Kilit / rewrite | Uygulama zamanı |
|---|---|---|---|---|
| **PK/FK tip değişimi (text→uuid) DROP COLUMN id + ADD COLUMN id NOT NULL** | 60+ tablo, 211 `DROP CONSTRAINT`, 147 `ADD … FOREIGN KEY` | `20260611084953_native_uuid_pk_fk` (2.254 satır; :721-1391) | veri taşımaz — dolu tabloda **veri kaybı** (Prisma'nın kendi uyarısı :1-80) | 2026-06-11, prod canlı DEĞİLDİ (fabrika 2026-07-31'de açıldı); yeni kurulumda boş tabloda koşar |
| `timestamp` → `timestamptz` (183 kolon / 80 tablo, `USING c AT TIME ZONE 'UTC'`) | 183 | `20260801040000_timestamptz_conversion:87-428` | tam tablo rewrite + ACCESS EXCLUSIVE; ölçüm 38k log + 15k roll'da ≈2,1 sn (`Teks-Erp/CLAUDE.md:270`) | "kapanan pencere" — üretim verisi yokken (:36-43) |
| Enum değeri SİLME = tip yeniden yarat (`RENAME TO _old` + `CREATE TYPE` + `ALTER COLUMN TYPE USING` + `DROP TYPE`) | 6 | `20260708210000` (WorkOrderStatus), `20260711120000:77-82` + `20260712130000` (ShipmentStatus ×2), `20260713092000` (RollStatus — `rolls` + 3 tablo :18-27), `20260728171853` (PrintedDocType) | enum kolonlu tablonun **tam rewrite'ı** + ACCESS EXCLUSIVE (`rolls` dahil) | hepsi 2026-07-28 öncesi (canlı öncesi) |
| Collation değişimi `ALTER COLUMN name TYPE … COLLATE tr_sort` | 18 kolon | `20260819060000:155-172` | rewrite; master-data tabloları küçük | prod'a 2.9.0 ile gitti (saha ledger'da var) |
| `ALTER COLUMN … TYPE` (uuid cast, deviceId uuid→text) | 4 + 1 | `20260708140000_faz6:38-41`, `20260819160000:26-27` | rewrite (kolon zaten NULL/küçük) | |
| `SET NOT NULL` (backfill sonrası) | 6 | `20260711120000:22`, `20260714120000:65`, `20260708140000:22,26,30`, `20260708180000:9` | tam tarama, ACCESS EXCLUSIVE | küçük tablolar / boş DB |
| `ADD COLUMN … NOT NULL` DEFAULT'suz | 4 (native_uuid dışı) | `20260713120000:30,33,36` (batchId ×2, workOrderNumber — "operasyonel tablolar reset sonrası BOŞ" :10-11), `20260731210000:68` (tablo boş :23-25) | dolu tabloda DÜŞER | boş tablo varsayımıyla |
| `ADD COLUMN … NOT NULL DEFAULT` | 32 satır | çeşitli | PG11+ fast-default → rewrite YOK | güvenli |
| `CREATE INDEX` (CONCURRENTLY'siz) | 621 ifade; `rolls` üzerinde 12, `roll_operations` 2, `work_order_steps` 1 | örn. `20260730170000:15` (`rolls(status, updatedAt)`), `20260612102000:18-25` | SHARE kilidi — yazma bloklanır, süre satır sayısıyla | kural 14 "vardiya dışı" (`Teks-Erp/CLAUDE.md:252`); CONCURRENTLY "şu an ihtiyaç yok" |
| `DROP INDEX` | 92 satır | `20260525180120` (19), `20260708130000` (9), unique'e yükseltme çiftleri | anlık ama sorgu planı değişir | |
| `DROP COLUMN` | 248 satır (≈215'i native_uuid; 30 gerçek kolon düşürme) | `20260601110343:53-71`, `20260627120000:6`, `20260708140000:12-13`, `20260708170000:10-11`, `20260712000000:6-13`, `20260712120000:11`, `20260713120000:27,32,35`, `20260731210000:62-63`, `20260819034413:16` (`system_logs.updatedAt`) | metadata (anlık) ama eski kodu kırar → "backend ÖNCE" sırası | |
| `RENAME COLUMN` | 1 | `20260627120000:7` (`subcontractor_dispatches.dyehouseNote → instruction`) | anlık; eski kod P2022 | |
| `DROP TABLE` | 7 | `20260629130000/140000`, `20260703120000:29`, `20260707100000:13`, `20260708170000:14`, `20260711120000:65` | geri alınamaz | canlı öncesi |
| FK ekleme (NOT VALID'siz) | 147 (native_uuid) + ~60 | her `ADD CONSTRAINT … FOREIGN KEY` | iki tabloda SHARE ROW EXCLUSIVE + tarama | çoğu canlı öncesi; sonrakiler nullable audit FK'ları (küçük) |
| `VALIDATE CONSTRAINT` | 26 | §1.1 | SHARE UPDATE EXCLUSIVE (hafif) — bilinçli desen (`faz4:6-7`) | |
| `ANALYZE` | 2 | `20260614120000:37`, `20260801050000:40` | hafif | |

### 1.9 Migration İÇİNDE veri değişikliği (backfill / dönüşüm / katalog)

| Migration:satır | İfade | Sınıf | Not |
|---|---|---|---|
| `20260525230807:11` | `UPDATE label_templates SET kind='ROLL_FINISHED' WHERE kind='ROLL'` | enum dönüşümü | |
| `20260608191754:6` | `UPDATE customer_color_aliases SET assigned=true WHERE alias IS NULL` | backfill | |
| `20260612101000:18-35` | `UPDATE roll_movements SET exitedAt=NOW(), notes='…DEDUP_OPEN_MOVEMENT'` (mükerrer açık hareketleri kapat) | **veri onarımı** (unique öncesi) | `NOW()` çıplak — o tarihte kolon `timestamp` idi (timestamptz 2026-08-01'de geldi) |
| `20260612121000:4-22` | `UPDATE … SET qty=SUM` + **`DELETE FROM shipment_allocations`** (mükerrerleri tek satıra topla) | veri onarımı + silme | |
| `20260612103000:10-28` | `UPDATE sacks SET seq=…` (çift seq yeniden numaralandır) | veri onarımı | |
| `20260629140000:7` | `UPDATE devices SET status='APPROVED' WHERE machineId IS NOT NULL` | backfill | |
| `20260630120000:17` | `INSERT INTO device_peripherals … SELECT` | taşıma | |
| `20260702121000:8,53-60` | `UPDATE stations SET kind='SHIPPING'`, kantarı makineden istasyona taşı, `UPDATE machines SET isActive=false WHERE code='SEVK-M1'` | **iş verisi dönüşümü** (kod sabitleriyle) | |
| `20260703120000:8-17`, `20260703130000:4`, `20260706130000:17,28`, `20260712120000:14` | `peripheral_devices` alan taşıma; `DELETE FROM system_settings WHERE key=…`; `INSERT INTO system_settings` | ayar/katalog | |
| `20260706090000:13-21,107-110` | ad çakışmasında sonek ekle; `INSERT INTO label_context_defaults … SELECT` | backfill | |
| `20260708140000:21,25,29`, `20260708180000:8` | `UPDATE … SET updatedAt=createdAt` (SET NOT NULL öncesi) | backfill | |
| `20260708160000:13-15` | `UPDATE shipment_orders SET isActive=false` (DISPATCHED/CANCELLED) | denorm backfill | |
| `20260708190000:7` | `UPDATE devices SET kind=upper(kind)` | güvenlik ağı | |
| `20260712130000:6`, `20260713092000:6-9` | `UPDATE shipments SET status='PLANNED' WHERE 'AT_DOOR'`; `PRODUCED → WAREHOUSE` 4 kolonda | enum daraltma öncesi | |
| `20260714120000:11-62` | workOrderId backfill; taramaları survivor'a taşı; **`DELETE FROM traveler_cards`** (WO başına en yeni kalır); barkod=İE no; kartsız WO'lara **`INSERT INTO traveler_cards`** | **veri onarımı + üretim** | |
| `20260728171853:4` | `DELETE FROM printed_documents WHERE docType IN (…)` | enum daraltma öncesi (0 satır doğrulanmış) | |
| `20260801020000:29-58` | `INSERT INTO permissions / permission_templates / permission_template_items … ON CONFLICT DO NOTHING` | **izin kataloğu migration'la** (idempotent) | `now() AT TIME ZONE 'UTC'` — timestamptz öncesi yazım |
| `20260810010330:21-25` | `UPDATE stations SET appliesColor/appliesProperty FROM subcontractor_categories` | davranış-koruyan backfill | |
| `20260820020000:15`, `20260820030000:27` | `UPDATE quality_grades SET skipLabel=true / targetStatus='SCRAP' WHERE code='FIRE'` | **iş kuralı verisi** (`code` sabitiyle) | |
| `20260820040000:28-50`, `20260820050000:21-49` | `UPDATE label_template_variants SET elements = jsonb_set(…)` (fire işareti ekle / kalite elemanının `showIf` listesine FIRE ekle) | **JSONB şablon içeriği** migration'la düzenleniyor (idempotent EXISTS/NOT EXISTS) | fabrikanın düzenlediği veriye migration dokunuyor |

Toplam: 33 `UPDATE`, 7 `INSERT`, 5 `DELETE` satırı (grep). Hiçbirinde `--apply`/dry-run yok (migration doğası gereği); geri alma = yedek (`deploy/kur.ps1:31,177-179` `premigrate_` dump).

### 1.10 "Yumuşak kapı" ve fail-soft `DO $$` blokları (8)

| Migration:satır | Blok | Davranış | Sonuç |
|---|---|---|---|
| `20260821150000_name_fold_unique_live:52-76` | `$sed$` — `customers/items/subcontractors` için mükerrer grup say; **>0 ise `RAISE NOTICE` + index ATLA**, 0 ise `CREATE UNIQUE INDEX IF NOT EXISTS` | **YUMUŞAK KAPI** (2026-08-22'de RAISE EXCEPTION'dan çevrildi :10-24) | index eksikse yeniden koşum ELLE: `npx prisma db execute --file …` (:19) |
| `20260825120000_color_name_unique_live:58-78` | `$sed$` — `colors` için `tr_fold_color(name)` mükerreri | YUMUŞAK KAPI | aynı |
| `20260819060000_search_fold:60-72` | `$ext$` — `CREATE EXTENSION pg_trgm` EXCEPTION'la sarılı | fail-soft (WARNING, deploy sürer) | GIN'ler atlanır |
| `20260819060000:124-142` | `$$` — `tr_sort` ICU → libc → NOTICE | fail-soft | sıralama eski kalabilir |
| `20260819060000:148-173` | `$$` — collation yoksa kolon collation adımını atla | fail-soft | |
| `20260819060000:263-282` | `$gin$` — `pg_trgm` yoksa 9 GIN atla | fail-soft | |
| `20260819140000_alias_search:33-45` | `$gin$` — 2 alias GIN | fail-soft | |
| `20260819210000_master_data_merge_lineage:45-61` | `$fk$` — `IF NOT EXISTS (pg_constraint)` ile 8 FK ekle | idempotent (dev'de kolonlar migration'dan ÖNCE doğmuştu :7-13) | |

Ortak özellik: **bu blokların sonucu `_prisma_migrations`'a yansımaz** (migration "uygulandı" görünür, nesne yoktur). Görünürlük yalnız `scripts/test_db_invariants.ts` §1/§5/§7 kırmızısı (bilerek — "enforce bekliyor" sinyali, `test_db_invariants.ts:157-163,273-275`).

### 1.11 Enum işlemleri

`ALTER TYPE … ADD VALUE` 21 ifade (`RollStatus` +3, `SackStatus` +1, `ShipmentStatus` +2, `PrintedDocType` +7, `StationKind` +1, `RollEntrySource` +3, `WorkOrderStatus` +1, `LabelKind` +1, `ReasonPresetKind` +2). Değeri kullanan ifadeyle aynı dosyada olamaz (55P04) → tek-ifadeli ayrı dosyalar (`20260702120000:4-7`, `20260730120500:5-8`, `20260803060000:14-18`, `20260825140000:13-15`, `20260826130000:12-15`). `DROP TYPE` 8 (6'sı rename-recreate deseni, §1.8). Enum değeri eklemek geri alınamaz (PG değer düşürmeyi desteklemez — `20260730120500:14-15`).

### 1.12 Elle uygulanan migration'lar

27 dosya başlığında "psql apply + `migrate resolve --applied`" / "ELLE YAZILDI / `db execute`" notu var (`20260630130000`, `20260702120000/121000/150000/170000`, `20260703120000/140000/150000`, `20260704120000`, `20260630120000/140000`, `20260706090000/130000`, `20260707120000`, `20260730120000/120500/190000/200000`, `20260731120000/150000/210000`, `20260801040000`, `20260819034413/060000/210000`, `20260821150000`, `20260825120000`). Gerekçe iki sınıf: (a) `migrate dev` iki DEFERRABLE composite FK'yı her diff'te DROP etmek ister (`schema.prisma:4203-4204`; 20+ dosya başlığında "DropForeignKey satırları ELLE SİLİNDİ"), (b) partial UNIQUE/expression/trigger şemada ifade edilemez. **Dev defterinde 40 satır `applied_steps_count=0`** (`20260803060000`'den `20260827100000`'e kadar KESİNTİSİZ — son 40 migration'ın hepsi dev'e `resolve` ile işaretlenmiş); saha defterinde 190/190 `applied_steps_count=1` (`migrate deploy` ile gerçekten koşmuş). `resolve` SQL'in koştuğunu doğrulamaz (`Teks-Erp/CLAUDE.md:242`, `test_migration_hygiene.ts:15-21`).

---

## 2. CANLI KATALOG KARŞILAŞTIRMASI — dev `adnansahin_db` ↔ saha `tekserp_saha_0825`

### 2.1 Aynı olanlar (fark yok)
26 CHECK (hepsi validated) · 1 UNIQUE constraint · 2 DEFERRABLE composite FK (`condeferrable=t, condeferred=t`) · 3 trigger (`tgenabled='O'`) · 4 fonksiyon (`tr_fold`/`tr_fold_color` `provolatile='i'`, `proisstrict=t`; iki trigger fonksiyonu `v`) · `tr_sort` (ICU `tr-u-kn`) · 33 GENERATED kolon / 23 tablo · 11 GIN trigram index · `sl_day_exact` · 92 tablo · 192 UNIQUE index · 0 `timestamp without time zone` · 0 sequence · 0 geçersiz index · 0 PK'siz tablo · `audit_block_tamper` gövdesi migration metniyle birebir (canlı `prosrc` karşılaştırıldı).

### 2.2 Farklar (tam liste — index/constraint/kolon/enum/tablo diff'i)

| Nesne | DEV | SAHA | Sebep |
|---|---|---|---|
| `items_nameFold_key` (partial UNIQUE) | **VAR** | **YOK** | yumuşak kapı: sahada `items` 1 mükerrer grup (ölçüm) → index atlandı; dev'de 0 grup |
| `colors_nameFoldColor_key` (expression+partial UNIQUE) | **YOK** | **VAR** | yumuşak kapı: dev'de `colors` 1 mükerrer grup (`tr_fold_color`) → atlandı; sahada 0 |
| `customers_nameFold_key` · `subcontractors_nameFold_key` | VAR | VAR | iki ortamda da 0 grup |
| `orders_active_createdAt_idx` (partial) | VAR | YOK | migration `20260826120000` sahada uygulanmadı |
| `order_lines_cancelledById_fkey` | VAR | YOK | `20260827100000` |
| Kolon `orders.cancelledAt / cancelReason / cancelReasonCode` | VAR | YOK | `20260826130100` |
| Kolon `order_lines.cancelledAt / cancelReason / cancelReasonCode / cancelledById` | VAR | YOK | `20260827100000` |
| Enum `ReasonPresetKind` | `…,WORK_ORDER_REWORK,ORDER_CANCEL` | `…,WORK_ORDER_REWORK` | `20260826130000` (sahada `WORK_ORDER_REWORK` **VAR** — `20260825140000` dosya defterde yokken enum'da değer var, bkz. §2.6 not) |
| FK sayısı | 282 | 281 | yukarıdaki FK |
| Index sayısı | 473 | 472 | +2 −1 |
| Partial index | 38 | 37 | |
| Expression index | 2 | 3 | |
| Extension | `pg_trgm 1.6`, `unaccent 1.1`, `plpgsql` | `pg_trgm 1.6`, `plpgsql` | `unaccent` dev'de elle (repo'da hiçbir migration kurmuyor; `test_db_invariants.ts` `TOLERATED_EXTENSIONS`) |

`test_db_invariants.ts` beklentisine göre: **dev'de §5 kırmızı** (`colors_nameFoldColor_key` yok), **sahada §1 kırmızı** (`items_nameFold_key` yok) + sahada `orders_active_createdAt_idx` yok (migration bekliyor). İkisi de tasarımın kabul ettiği "enforce bekliyor" durumu (`test_db_invariants.ts:157-163`).

### 2.3 Yumuşak kapı mükerrer grup ölçümü (predicate dışı tombstone'lar sayılmadı)

| Tablo | DEV grup | SAHA grup | Sed durumu |
|---|---|---|---|
| customers (`nameFold`) | 0 | 0 | ikisinde de VAR |
| items (`nameFold`) | 0 | **1** | dev VAR / saha YOK |
| subcontractors (`nameFold`) | 0 | 0 | ikisinde de VAR |
| colors (`tr_fold_color(name)`) | **1** | 0 | dev YOK / saha VAR |

### 2.4 Ayarlar (GUC) — `pg_db_role_setting` + `pg_settings`

| Ayar | DEV (`adnansahin_db`) | SAHA kopyası (`tekserp_saha_0825`) | Not |
|---|---|---|---|
| `pg_db_role_setting` | `{statement_timeout=50s, idle_in_transaction_session_timeout=5min}` (ayrıca `_old_20260802_0401`, `_restore_20260730_202502`, `adnansahin_ticaret` DB'lerinde) | **satır YOK** | per-DB ayarlar `setdatabase` OID'ine bağlı, `pg_dump`/restore ile TAŞINMAZ (`Teks-Erp/CLAUDE.md:262` (1)) → **prod'un gerçek `statement_timeout`/`idle_in_transaction` değeri bu kopyadan okunamaz**; repo iddiası: `ALTER DATABASE tekserp SET statement_timeout='50s'` elle (`CLAUDE.md:257`) |
| `statement_timeout` (oturum) | 120000 (client — audit aracının `PGOPTIONS`'ı) | 120000 (aynı) | araç artefaktı, DB'nin değil |
| `idle_in_transaction_session_timeout` | 300000 (source=`database`) | 0 (default) | kopyada kayıp (yukarıdaki sebep) |
| `lock_timeout` / `idle_session_timeout` / `deadlock_timeout` | 0 / 0 / 1000 | aynı | `idle_session_timeout=0` havuzun 10 dk idle ön koşulu (`src/lib/prisma.ts:38-40`) |
| `TimeZone` | `Europe/Istanbul` (postgresql.conf, dev Postgres.app) | aynı sunucu | uygulama havuzu `-c timezone=UTC` ile ezer (`src/lib/prisma.ts:60-65,79-85`, `PG_SESSION_OPTIONS` LOAD-BEARING) |
| `default_transaction_isolation` | read committed | aynı | |
| `teks.audit_guard` / `teks.audit_purge` | boş / boş | boş / boş | kopyada per-DB ayar olmadığı için **prod'daki gerçek değer BİLİNMİYOR**; docker-compose (prod'da KULLANILMIYOR) `statement_timeout=50s`, `idle…=300000`, `TZ/PGTZ=Europe/Istanbul` (`docker-compose.yml:10-11,26,28`) |
| `max_connections` | 100 | aynı (dev sunucu) | prod bilinmiyor; havuz `max 30` (`prisma.ts:79-85`) |
| DB locale | `en_US.UTF-8` ICU | aynı | kopya yerel PG18'e restore edildi; prod'un `C` locale olduğu repo notu (`20260819060000:82-83,108`) buradan doğrulanamaz |

### 2.5 Uzantı/tr_sort/pg_trgm saha durumu
Saha KOPYASINDA 11 GIN `gin_trgm_ops` index'i ve `pg_trgm 1.6` mevcut → dump alınırken (2026-08-25) prod'da `pg_trgm` kuruluydu ve GIN'ler yaratılmıştı (aksi hâlde dump'ta index tanımı olmazdı). Hafızadaki "canlıda pg_trgm yok" notu (2026-08-14 yedeği) **bu kopyaya göre bayat**. `tr_sort` ICU ile kurulu (prod PG 16.9'un ICU'lu olup olmadığı → kopyada `collprovider='i'` görünür, restore sırasında yeniden yaratıldığı için [VARSAYIM] prod'da da ICU).

### 2.6 Sahada eksik 5 migration'ın nesneleri

| Migration | Nesne | Sınıf | Risk sınıfı (deploy) |
|---|---|---|---|
| `20260825140000_reason_preset_rework_kind` | `ReasonPresetKind += 'WORK_ORDER_REWORK'` | enum ADD VALUE (IF NOT EXISTS) | **saha enum'unda değer ZATEN VAR** ama `_prisma_migrations`'ta satır YOK → [VARSAYIM] değer elle/`db execute` ile açılmış ya da 2.9.6 APK/backend hotfix'iyle eklenmiş; `migrate deploy` `IF NOT EXISTS` sayesinde geçer, defter satırı o zaman yazılır |
| `20260826120000_orders_active_created_at_idx` | `orders_active_createdAt_idx` partial | CREATE INDEX (orders 278 satır) | anlık; `test_db_invariants` §1 sahada bu index'i de bekler |
| `20260826130000_reason_preset_order_cancel_kind` | `ReasonPresetKind += 'ORDER_CANCEL'` | enum | tek ifade |
| `20260826130100_order_cancel_reason` | `orders.cancelledAt/cancelReason/cancelReasonCode` (nullable, `IF NOT EXISTS`) | ADD COLUMN | metadata-only |
| `20260827100000_order_line_cancel` | `order_lines.cancelledAt/cancelReason/cancelReasonCode/cancelledById` + FK `order_lines_cancelledById_fkey` (SET NULL) | ADD COLUMN + FK | metadata; index bilinçli YOK (:34-40) |

HEAD kodu bu kolonları **okuyor**: `src/services/helpers/order-line-scope.helper.ts:26` (`ACTIVE_LINE = { cancelledAt: null }`), `order-status.helper.ts`, `order.service.ts` → backend, migration'lar koşmadan sahaya çıkarsa sipariş listeleri P2022/500 (deploy sırası: `deploy/kur.ps1:287` `npx prisma migrate deploy` adımı var, `premigrate_` yedeği :177-179).

### 2.7 Büyüklükler (kilit riski için)

| Tablo | DEV satır / boyut | SAHA satır / boyut |
|---|---|---|
| system_logs | 152.892 / 103 MB | 10.485 / 6,6 MB |
| rolls | 296 / 6 MB | 2.431 / 2,7 MB |
| roll_movements | — | 1.107 |
| roll_operations | — | 1.586 |
| roll_properties | — | 2.256 |
| printed_documents | 11.637 / 25 MB | 328 / 1,2 MB |
| work_order_steps | 293 | 635 |
| orders / order_lines | — | 278 / 281 |

Bugünkü hacimde (binler) hiçbir DDL sınıfı vardiyayı durduracak sürede değil; §1.8'deki riskler **büyüme** ile doğar (repo bunu ölçmüş: `roll_movements` milyona çıkınca dakikalar — `CLAUDE.md:270`).

---

## 3. DB'NİN KORUDUĞU İŞ KURALLARI (düz Türkçe)

| # | Kural | Mekanizma | Kaynak |
|---|---|---|---|
| K-1 | Topun metrajı (mevcut ve giriş), kg'ı, hareket giriş/çıkış metrajı ve kg'ı, hata başlangıç metresi **eksi olamaz** | CHECK ×11 | §1.1 #1-3, 9-13 |
| K-2 | Sipariş kalemi miktarı, sevk tahsisi, fason/kartela sevk kalemi, kartela adedi, kartela stok düşümü, doğrudan sevk toplamı/adedi, iade metrajı, sapma metrajı **sıfırdan büyük** olmak zorunda | CHECK ×13 | §1.1 #4, 14-15, 17-25, 27 |
| K-3 | Sevk edilen ve tahsis edilen metrajlar **eksiye düşemez** | CHECK | #5, 16 |
| K-4 | Adım bitiş zamanı başlangıçtan önce olamaz | CHECK | #8 |
| K-5 | Stok üretimi iş emrinin hedef kumaşı olmak zorunda | CHECK | #26 |
| K-6 | Bir top bir adımda aynı anda **en fazla BİR açık harekette** olabilir | partial UNIQUE | `roll_movements_one_open_per_roll_step_uq` |
| K-7 | Bir adımda aynı anda **en fazla BİR açık kurşun-bypass ataması** | partial UNIQUE | `kursun_bypass_one_pending_per_step_uq` |
| K-8 | Aynı topta aynı metrede aynı hata türü ikinci kez açılamaz | partial UNIQUE | `roll_errors_roll_meter_defect_uq` |
| K-9 | Bir makinede ve bir cihazda **tek aktif çalışma oturumu** | partial UNIQUE ×2 | `work_sessions_active_*_uq` |
| K-10 | Etiket türü başına tek varsayılan şablon; şablon başına tek birincil varyant; sistemde tek varsayılan refakat kartı şablonu; bağlam başına tek varsayılan (`label_context_defaults.kind`) | partial UNIQUE ×3 + UNIQUE | §1.2 + `label_context_defaults_kind_key` |
| K-11 | Aynı istemci token'ı ile ikinci kayıt oluşmaz (top, sipariş, iş emri, çuval, sevkiyat, fason makbuzu, kartela düşümü, içe aktarım) | (partial) UNIQUE ×8 | `*_clientToken_key` |
| K-12 | Müşteri / kumaş / fason firması adı **katlanmış hâliyle** ikinci kez girilemez (tombstone hariç); renk adı ayraç/sayı-sırası bağımsız katlanmış hâliyle ikinci kez girilemez | partial UNIQUE (yumuşak kapı) | **ortama göre eksik** (§2.3) |
| K-13 | Kullanıcı adı ve yetki şablonu adı büyük/küçük harf ayrımsız tekil | expression UNIQUE | §1.4 |
| K-14 | Belge numaraları (`orderNumber`, `workOrderNumber`, `shipmentNo`, `dispatchNo`, `receiptNo`, `sackNo`, kart no/barkod), top barkodu, kod alanları (`items/customers/colors/machines/stations/subcontractors/permissions.code`) tekil | UNIQUE index (Prisma) | §"belge no" listesi |
| K-15 | Bir iş emrinin **tek refakat kartı** olur (statü bağımsız) | UNIQUE | `traveler_cards_workOrderId_key` |
| K-16 | Aynı iş emrinde iki adım aynı sıraya; aynı rotada iki adım aynı sıraya oturamaz | UNIQUE | `work_order_steps_workOrderId_stepSequence_key`, `route_steps_routeId_sequence_key` |
| K-17 | Aynı top aynı fason/kartela sevkine iki satır yazılamaz; aynı çuval aynı sipariş kalemine iki tahsis; aynı sevkiyatta iki çuval aynı sıra numarasını alamaz; aynı belge aynı sürümle iki kez donmaz | UNIQUE | `*_dispatchId_rollId_key`, `sack_allocations_sackId_orderLineId_key`, `sacks_shipmentId_seq_key`, `printed_documents_docType_sourceId_version_key` |
| K-18 | Çuvaldaki top/kartelanın sevkiyatı **çuvalın sevkiyatıyla aynı** olmak zorunda (commit anında) | DEFERRABLE composite FK ×2 | `rolls/swatches_sackId_shipmentId_consistency_fkey` |
| K-19 | Topun üretiminin bittiği an (`finalizedAt`) ve statü değişim anı **DB tarafından** damgalanır; uygulama atlasa da yazılır | trigger | `rolls_stamp_production_timestamps` |
| K-20 | Audit kaydı değiştirilemez/silinemez (arşivleyici hariç) — **yalnız `teks.audit_guard='on'` ise** | trigger + GUC | `system_logs_block_tamper`, `system_log_archives_block_tamper` |
| K-21 | Barkod sayacı gün+tip başına çakışmasız artar | PK + `ON CONFLICT DO UPDATE` (satır kilidi) | `roll_barcode_counters` |
| K-22 | Referans bütünlüğü: 282 FK; silme politikası `SET NULL` 168 (künye/audit FK'ları), `RESTRICT` 71 (defter/izler), `CASCADE` 41 (bağımlı alt satırlar), `NO ACTION` 2 (composite) | FK | §0 |
| K-23 | Audit satırı olan kullanıcı fiziksel silinemez | FK RESTRICT (`system_logs.userId`) | `20260819161000:17-19` notu |
| K-24 | Arama katlaması DB'de üretilir (uygulama yazamaz), Türkçe sıralama collation'ı ad kolonlarında | GENERATED + collation | §1.6 |

---

## 4. DB'NİN KORUMADIĞI — yalnız uygulama kodunda (K10 değişmez adayları)

Her satır: kural · uygulama kodu yeri · canlı ölçüm (dev / saha) · DB'de ne var.

| # | Değişmez (aday) | Uygulama kodu | Ölçüm DEV / SAHA | DB'deki karşılığı |
|---|---|---|---|---|
| A-1 | `Roll.currentQty <= Roll.initialQty` | `src/services/tambur-undo.service.ts:1512-1575` (aşımda `initialQty` yukarı çekilir + `OVERAGE` defteri), `inventory.service.ts:3780-3789` (kısmen tüketilmişte metraj düzeltmesi red) | **0 / 2** (sahadaki 2 satır 2026-08-22 notunda "bilerek düzeltilmedi", `test_consistency` §13) | yalnız `>= 0` CHECK'leri; ilişki CHECK'i YOK |
| A-2 | `OrderLine.shippedQty <= OrderLine.quantity` | `shippedQty` defterden türer: `helpers/order-status.helper.ts:132` (`data: { shippedQty: led.shipped }`) | 0 / 0 | yalnız `shippedQty >= 0`, `quantity > 0` |
| A-3 | `OrderLine.shippedQty = Σ SackAllocation[DISPATCHED] + Σ DirectShipAlloc` (türetilmiş denorm) | `order-status.helper.ts:96-140` (`recomputeOrderStatus`) | naif toplam farkı 1 / 1 (repo'nun kendi kesin sorgusu `scripts/consistency-check.sql §1`) | trigger YOK |
| A-4 | `Order.shippedQty = Σ OrderLine.shippedQty`; `Order.status` kalemlerden türer (`PENDING→APPROVED→PARTIAL_SHIPPED→COMPLETED/CANCELLED`, `schema.prisma:193`) | `recomputeOrderStatus` (aynı helper), iptal kalem `shipped` ile sayılır | `consistency-check.sql §2` | trigger YOK; enum yalnız değer kümesini sınırlar |
| A-5 | `WorkOrder.status ← adım durumları` (tüm adımlar COMPLETED/SKIPPED → COMPLETED; CANCELLED/SUPERSEDED terminal) | `helpers/roll-step.helper.ts:176` (`ensureWorkOrderInProgress`), `:193` (`completeWorkOrderIfStepsDone`, terminal guard) | COMPLETED-ama-açık-adım **0 / 0**; açık-ama-tüm-adımlar-bitmiş 0 / 0 | YOK (`consistency-check-derived.sql §22`) |
| A-6 | `WorkOrder.type ← sipariş bağının varlığı` (STOCK_PRODUCTION ⇔ 0 bağ) | `workorder-link.service.ts` (`linkOrderLines`/`unlinkOrderLine` tx içinde `updateMany WHERE type=…`), `scripts/fix_workorder_type_from_links.ts` | `consistency-check-derived.sql §21` | yalnız `work_orders_stockprod_targetItem` CHECK (dolaylı) |
| A-7 | **Top statü makinesi** (13 değer; `STOCK→IN_PRODUCTION→WAREHOUSE/A1_STOCK/SCRAP→SHIPPED`, fason/kartela dalları, `TAMBUR_CONSUMED`, `CANCELLED`) — geçiş tablosu | **merkezi geçiş tablosu YOK** (grep `assertRollStatusTransition|ROLL_STATUS_TRANSITIONS|canTransition|StatusTransition` = 0); akış başına izin listeleri: `inventory.service.ts:392` (`CANCELABLE_ROLL_STATUSES`), `workorder-manual-move.service.ts:40` (`MOVABLE_STATUSES`), `batch.service.ts:55,75` (`K18_DEAD_STATUSES`, `NO_LIVE_MATERIAL_STATUSES`), `helpers/sack-invariants.helper.ts:35,53`, `helpers/roll-disposition.helper.ts:53`, `tambur-undo.service.ts:106,114`, `subcontractor.service.ts:331`, `workorder.service.ts:260,266,476-485,5939`, `label.service.ts:39`, `duplicate-rolls.service.ts:27`, `workorder-split.service.ts:42` (13+ ayrı liste) | statü dağılımı saha: SHIPPED 689 · SUBCONTRACTOR_CONSUMED 637 · STOCK 283 · WAREHOUSE 250 · CANCELLED 230 · AT_SUBCONTRACTOR 188 · TAMBUR_CONSUMED 116 · IN_PRODUCTION 37 · SCRAP 1 | enum yalnız küme; geçiş kısıtı YOK; `finalizedAt` trigger'ı kaynak/hedef listesini **kendi içinde** tekrarlar (`20260809090000:57,79-80`) |
| A-8 | `Roll.shipmentId` dolu ⇒ `status=SHIPPED` **yalnız DISPATCH sonrası**; PLANNED sevkiyatta top WAREHOUSE kalır (kök `CLAUDE.md` "stok yalnız DISPATCH'te SHIPPED düşer") | `shipping.service.ts` (`performDispatchTx`, `preShipStatus`) | 0 / **12** (12'si WAREHOUSE + çuvalda + sevkiyat PLANNED → tasarımla tutarlı) | composite FK yalnız çuval↔sevkiyat eşitliğini korur, statüyü değil |
| A-9 | Çuvala giremez/çuvalda bulunamaz statüler (`NON_SACKABLE_STATUSES`) | `helpers/sack-invariants.helper.ts:35-56`; `consistency-check.sql §7/§7b/§7c` (hayalet içerik) | çuvalda-ama-fiziksel-dışarıda 0 / 0 | YOK |
| A-10 | `Roll.currentStepId` ⇔ `IN_PRODUCTION` (istisna: `AT_SUBCONTRACTOR` adımda kalır) | `roll-step.helper.ts`, `roll-finalize.helper.ts` | IN_PRODUCTION+NULL adım 0 / 0; adımlı-ama-üretimde-değil: dev 7 (SUBCONTRACTOR_CONSUMED 6, AT_SUB 1) / saha 188 (hepsi AT_SUBCONTRACTOR — tasarım) | YOK |
| A-11 | Parti no `P01…P99` döner, **benzersiz DEĞİL**; aynı gün iki parti aynı kodu almasın | `batch.service.generateBatchNumberTx` — `pg_advisory_xact_lock(8022,1)` İLK ifade | mükerrer `batchNumber` grubu 99 / 92 (tasarım gereği) | `batches_batchNumber_key` **DROP edildi** (`20260805120000:22`); index `batches_createdAt_idx` sayaç kaynağı |
| A-12 | Belge no biçimi `PREFIX+GGAAYY+NNNN` ve günlük sıra sürekliliği | `nextDailySeq` + `withBarcodeRetry` (P2002 → tekrar) | — | yalnız tekillik (UNIQUE); biçim/sıra DB'de yok |
| A-13 | Top barkodu biçimi (`TEKS+YYMMDD+H/F+A001…`) ve KK1 mükerrer tuzağı (90 sn) | `generateRollBarcode` + `roll_barcode_counters`; `pg_advisory_xact_lock(8021,…)` (`kk1.duplicateGuardEnabled`) | barkodsuz top 83/296 · 148/2431 (açık kumaş, tasarım) | sayaç satır kilidi VAR; biçim YOK |
| A-14 | Fason kısmi kabul: `receivedQty <= dispatchedQty`, kalem yalnız `isPartial=false` ile kapanır; "kalan gelmeyecek" = `remainderClosedAt` | `subcontractor.service.ts` (21 outstanding filtresi `isPartial:false`), `helpers/fason-open-dispatch.helper.ts` (AST bekçili tek kaynak) | 0 / 0 | CHECK YOK (`receivedQty` nullable, kısıtsız) |
| A-15 | İade metrajı ≤ sevk edilen metraj; iade edilen top çuvalda kalır `returned` işaretli | `return.service.ts`, `shipping.service.ts` (brüt kuralı) | iade > initialQty 0 / 0; iade edilen top statüsü dev CANCELLED 1 / saha CANCELLED 5 [VARSAYIM: iade sonrası iptal — akış K? denetçisine] | `roll_returns_qty_pos` yalnız `> 0` |
| A-16 | `work_order_to_order_lines.allocatedQty <= orderLine.quantity` | `workorder-link.service.ts` | 0 / 0 | yalnız `>= 0` |
| A-17 | Bir sipariş aynı anda tek aktif (PLANNED) sevkiyatta | eskiden DB (`shipment_orders_active_order_uq`, `20260708160000`) → `20260711120000:87`'de DROP; artık `isActive` denorm + uygulama | isActive/durum drift'i: dev `f/DISPATCHED 1`; saha `f/DISPATCHED 54`, `t/PLANNED 1` (tutarlı) | **DB seddi KALDIRILDI** (`schema.prisma:4318`) |
| A-18 | `shipment_orders.isActive` bakımı sevkiyat geçişlerinde (dispatch/cancel → false) | `shipping.service.ts` | `consistency-check.sql §5` | partial unique yoktu artık → yalnız denorm |
| A-19 | `Sack.seq` havuzda NULL, sevkiyatta dolu (`§6`) | `shipping.service.ts` (`max(seq)+1`) | — | `sacks_shipmentId_seq_key` (NULL'lar çakışmaz) |
| A-20 | Etiket türü başına varsayılan şablon **iki kaynakta** (`label_templates.isDefault` partial unique + `label_context_defaults.kind` unique) çift-yazımla senkron | `label-template.service.ts:319-342, 432-447, 499-509` (tx içinde `updateMany isDefault:false` + `labelContextDefault.upsert`) | — | iki ayrı DB seddi var ama **birbirine bağlı değil** (ikisi farklı şablonu gösterebilir) |
| A-21 | Refakat kartı yaşam döngüsü `ACTIVE→REPRINTED/VOIDED/COMPLETED`; ACTIVE kart iş emrinin canlı planını basar, sürüm `planKey` değişince artar | `traveler-card.service.ts` (`resolvePrintPlan`) | kart/WO >1: 0 / 0; saha statüler ACTIVE 85 · COMPLETED 106 · VOIDED 22 | yalnız `traveler_cards_workOrderId_key` (kart başına 1) |
| A-22 | Basılı belge sürümü `max+1`, VOIDED belge revize edilemez | `printed-document.service.ts:660,685,730` | `(docType,sourceId)` için `max(version) ≠ count`: dev 0 / saha **2** (ikisi `TRAVELER_CARD`, tek satır `version=2` ACTIVE — v1 hiç dondurulmamış; belge/kart akışı denetçisine not) | UNIQUE `(docType, sourceId, version)` yalnız çakışmayı önler, sürekliliği değil |
| A-23 | Hareket kapanışında `qtyOut = qtyIn` (kök `CLAUDE.md` Tambur finalize disiplini) | `roll-step.helper.ts`, `roll-finalize.helper.ts` | `qtyOut ≠ qtyIn` kapanmış hareket: dev 7/42, saha **15/883** (kısmi kabul/fason yolları meşru olabilir — akış denetçisine) | yalnız `>= 0` |
| A-24 | `finalizedAt`/`statusChangedAt` trigger ÖNCESİ kayıtlar backfill'e muhtaç | migration backfill YOK (`20260809090000` yalnız trigger) | final statüde `finalizedAt IS NULL`: **4 / 4**; `statusChangedAt IS NULL`: 25 / 39 | trigger yalnız yeni yazımları damgalar |
| A-25 | Pasif (soft-deleted) ana veri yeni kayıtta kullanılamaz | servis doğrulamaları (`isActive` kontrolü) | son 30 günde pasif kumaşa bağlı top: 0 / **2** | FK pasifliğe bakmaz |
| A-26 | `users.deletedAt` dolu ⇒ `isActive=false`; kullanıcı yalnız soft delete | `user.service` | 0 / 0 (soft-deleted 5/72 · 0/9) | K-23 FK hard delete'i zaten engeller |
| A-27 | Her CUD → `SystemLog` (best-effort, tx dışında) | `AuditService.log()` | `/health` audit sayacı | DB yalnız yazılanın değişmezliğini korur (K-20, GUC'a bağlı) |
| A-28 | `ReasonPreset.code` değişmez, etiket serbest; gizli kodu da doğrulama kabul eder; son aktif satır gizlenemez | `reason-preset.service.ts`, senkron önbellek | — | UNIQUE `(kind, code)` yalnız |
| A-29 | Kat (`Roll.foldType`) kanonik biçimde yazılır; sebep kodu katalogda doğrulanır (`REASON_CODE_INVALID`) | `resolveFoldTypeForWrite`, `resolveReasonCode` | — | `VARCHAR(64)`, kısıt yok |
| A-30 | İş emri adım sırası 1..N boşluksuz | `workorder.service.ts` (create/replace) | 0 / 0 | UNIQUE sıra çakışmasını önler, boşluğu değil |
| A-31 | Sevkiyat durum makinesi `PLANNED→DISPATCHED/CANCELLED`; storno = iptal gövdesi tek kaynak (`cancelPlannedShipmentTx`) + `RepeatableRead` tek yer (`shipping.service.ts:2610`) | atomik claim `updateMany WHERE {id, status}` | saha: DISPATCHED 40 çuval, PLANNED 1 | enum + yok |
| A-32 | KK1 (RAW_QC) kalite yazabilir; kalite yalnız kalite istasyonlarında | `createInitialEntry` parite notu `inventory.service.ts:3870-3878` (`resolveQualityGradeIdStrict`) | STOCK'ta kalite dolu 46 / 283; AT_SUBCONTRACTOR 188 | `qualityGradeId` nullable, kısıt yok |

Hepsi için ortak nokta: uygulama guard'ları **check-then-act** (`findFirst → if → update`); DB tarafında karşılığı olmayan her kural, servisi atlayan yollarda (script, elle SQL, içe aktarım, geri yükleme) ve READ COMMITTED yarışlarında yalnız advisory lock / atomik claim ile korunur. Hangi yolun hangi kilidi tuttuğu K2b'nin değil eşzamanlılık haritalarının (K4/K5) konusu.

---

## 5. MİGRATION HİJYENİ GÖZLEMLERİ

| # | Gözlem | Kanıt |
|---|---|---|
| H-1 | **`CREATE INDEX CONCURRENTLY` hiç kullanılmamış** (0/621). Repo bunu bilinçli erteliyor ("sıfır-downtime gerekirse … psql manuel akışı kurulabilir, şu an ihtiyaç yok"). Prisma her migration dosyasını tek transaction'da koşuyorsa (`20260702120000:6`, `20260730120500:6-7` böyle yazıyor) CONCURRENTLY o dosyada **zaten çalışamaz** — ayrı psql adımı gerekir. | `Teks-Erp/CLAUDE.md:252`; grep CONCURRENTLY = 0 |
| H-2 | Prisma transaction semantiği repo içinde **çelişkili** anlatılıyor: `20260714120000:4-5` "Prisma statement'ları tek tx'te çalışmadığından kısmi uygulamaya karşı IF EXISTS" derken `20260702120000:4-7` ve `20260730120500:5-7` "her migration'ı tek tx'te koşar (55P04)" diyor. [VARSAYIM] Doğrusu ikincisi: Prisma migration script'ini tek simple-query paketi olarak gönderir → PostgreSQL örtük tek transaction (bu yüzden ADD VALUE + kullanım aynı dosyada 55P04 verir); dolayısıyla yarıda düşen migration **tamamen geri alınır**, kısmi uygulama yalnız `statement_timeout`/`resolve` yolunda doğar. Bu varsayım ② aşamasında `_prisma_migrations.logs` ya da `pg_stat_statements` ile değil, bir deneme DB'sinde kasıtlı bozuk migration ile ölçülmeli. | dosya başlıkları |
| H-3 | `SET statement_timeout = 0` 32 dosyada; ama **`lock_timeout` hiçbir yerde yok** → uzun süren bir `ALTER TABLE`/`CREATE INDEX` kilit kuyruğunda beklerken arkasındaki tüm okuma/yazmaları da bekletir (kilit kuyruğu etkisi); `statement_timeout=0` bunu uzatır. Bugünkü hacimde etkisiz, büyümede kural 14 ("vardiya dışı") tek koruma. | §1.7, `CLAUDE.md:252-253` |
| H-4 | **`NOT VALID` + `VALIDATE` deseni** CHECK'lerde tutarlı (26/26); FK eklemelerinde kullanılmıyor (147+ FK doğrudan). Canlı öncesi olduğu için sorun çıkmadı; ileride dolu tabloya FK eklemede aynı desen gerekir. | `faz4:6-7` |
| H-5 | **Dev defteri 40 `resolve --applied`** (son 40 migration'ın TAMAMI) — dev'de hiçbir yeni migration `migrate deploy`/`migrate dev` ile koşmamış; SQL'in gerçekten koştuğunu yalnız `test_schema_drift.ts` (allowlist: 2 composite FK) + `test_db_invariants.ts` gösteriyor. Saha 190/190 gerçek deploy. Gerekçe belgeli (composite FK drift'i); bedeli "dosya ↔ DB" eşitliğinin bekçilere devredilmesi. | §1.12; `test_schema_drift.ts:1-40`; `test_migration_hygiene.ts:15-21` |
| H-6 | **Uygulandıktan sonra düzenlenen migration'lar**: `20260819060000` (2 kez, :21-34) ve `20260821150000` (:10-24) — prod'a gitmeden düzenlendi, dev checksum'ı `resolve` ile yenilendi. İkisi de artık sahada uygulanmış → **bundan sonra gerçekten donmuş**; `check-migrations.mjs` GATE 2 modified dosyayı yakalar. (Checksum'ları bu haritada doğrulanamadı — Prisma'nın checksum algoritması `shasum -a 256` ile birebir eşleşmedi, tüm 195 satır farklı çıktı → yöntem hatası, iddia yok.) | dosya başlıkları; `scripts/check-migrations.mjs:20-24` |
| H-7 | **Yumuşak kapı nesneleri `_prisma_migrations`'a görünmez**: migration "uygulandı" sayılır, index yoktur; yeniden koşum elle (`prisma db execute --file`). İki ortamda iki farklı index eksik (§2.2) — enforce durumu ortam başına ayrı takip ister; tek sinyal `test_db_invariants` kırmızısı. | §1.10, §2.3 |
| H-8 | Migration'lar **iş kuralı verisine** dokunuyor: `quality_grades.code='FIRE'` hedefi/etiketi, `stations.code='SEVK_1'`, `machines.code='SEVK-M1'`, JSONB etiket şablonu `jsonb_set` (`20260820040000/050000`). Fabrikanın panelden düzenlediği veriyle çakışma idempotent EXISTS kontrolleriyle yumuşatılmış; ama kod sabitleri (`'FIRE'`) migration'a gömülü. | §1.9 |
| H-9 | **Şema-dışı nesne envanteri iki yönlü ve mekanik** (`test_db_invariants.ts`: 38 partial + 26 CHECK + 2 DEFERRABLE FK + 1 stats + 3 expression + 3 trigger + 2 fonksiyon + 1 collation + 2 uzantı + 33 GENERATED); canlı katalogla birebir örtüşüyor (dev'de yalnız `colors_nameFoldColor_key` eksik → §5 kırmızı beklenir). `CLAUDE.md:239`'daki sayılar bayat (27 CHECK). | §1, §2 |
| H-10 | `20260611084953_native_uuid_pk_fk` yeni kurulumda boş tabloda çalışır; **dolu bir DB'de veri kaybı** (DROP COLUMN id). Tarihsel; deploy zinciri sırasında DB boş olduğu için sorunsuz ama bir gün "taze kurulum + veri içe aktarım" sırası ters kurulursa yıkıcı. | `:721-1391`; ARCHITECTURE.md:800 |
| H-11 | Timestamptz dönüşümü ve enum-recreate'ler **canlı öncesi pencerede** yapılmış (bilinçli); repo bu sınıfın ilerideki maliyetini ölçmüş. Yeni enum değeri **silme** ihtiyacı doğarsa `rolls` rewrite'ı kaçınılmaz. | §1.8 |
| H-12 | `ADD COLUMN` politikası tutarlı: nullable/DEFAULT'lu → metadata-only (PG11+); NOT NULL DEFAULT'suz yalnız boş tabloda (4 yer, gerekçeli). | §1.8 |
| H-13 | Enum ADD VALUE ayrı dosya disiplini 5 yerde açıkça uygulanmış; `IF NOT EXISTS` 13/21'inde var, 8'inde yok (eski dosyalar) — yeniden koşumda hata verir, idempotent değil (yalnız `migrate deploy` bir kez koştuğu için sorun değil). | §1.11 |
| H-14 | Sahadaki `ReasonPresetKind.WORK_ORDER_REWORK` değeri, migration defterde yokken enum'da var (§2.6) → değer migration DIŞI bir yolla açılmış [VARSAYIM]; `migrate deploy` `IF NOT EXISTS` sayesinde sessiz geçer, iz `_prisma_migrations`'ta kalmaz. | `pg_enum` ölçümü |
| H-15 | Per-DB GUC'lar (`statement_timeout=50s`, `idle_in_transaction_session_timeout=5min`, `teks.audit_guard`) migration'da değil ops adımında; kopyaya taşınmadığı için **prod'daki gerçek değerleri bu denetim doğrulayamaz**. `db-copy-verify.service.ts:157-171` bunu deploy zamanında "guc" kontrolü olarak ölçüyor; `/health` `auditGuard` alanı (`app.ts:375`) canlıda okunabilir. | §2.4 |
| H-16 | Dev DB `pg_db_role_setting`'inde `adnansahin_db_old_20260802_0401` ve `adnansahin_db_restore_20260730_202502` kopyaları duruyor (unutulmuş geri yükleme kopyaları sınıfı — `app.ts:376-381` sayıyor). Dev hijyeni, prod değil. | §2.4 |

---

## HOTSPOTLAR (② denetçileri için — dosya:satır + neden)

1. **`Teks-Erp/prisma/migrations/20260821150000_name_fold_unique_live/migration.sql:52-76` + `20260825120000_color_name_unique_live/migration.sql:58-78`** — Yumuşak kapı: sahada `items_nameFold_key` YOK (1 mükerrer grup), dev'de `colors_nameFoldColor_key` YOK. Uygulama bekçisi `assertNameNotDuplicate` / `ColorService.assertNameAvailable` check-then-act (dosya :26-35 kendisi yazıyor: yarış, `duplicateNameField` unutması, içe aktarım fail-open, elle SQL). Sahada `items` için yarış penceresi ve içe aktarım yolu DB'siz. Enforce adımı elle `prisma db execute` — kim/ne zaman? (K-master-data / K-import denetçisi)
2. **`20260819161000_audit_tamper_guard/migration.sql:46-59` + `src/server.ts:59-75` + `docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md:635,1080`** — Trigger varsayılan KAPALI; prod'da `teks.audit_guard='on'` yapıldığı **doğrulanamıyor** (kopyada per-DB ayar yok, checklist `☐`). Kapalıysa K-20 kâğıt üstünde; `/health.auditGuard` canlıda okunmalı. (K-audit denetçisi)
3. **`20260809090000_roll_production_timestamps/migration.sql:57,79-80`** — `finalizedAt` trigger'ının kaynak/hedef statü listeleri sabit; `RollStatus`'a yeni değer eklenirse trigger sessizce damgalamaz (fail-open, hata yok). Aynı listeyi uygulama `producedOutputWhere`/karneler tekrarlıyor → OCP ayrışma adayı. Ayrıca A-24: 4 top final statüde `finalizedAt=NULL` (backfill yapılmamış) — karneler o topları hiç görmez. (K-rapor denetçisi)
4. **`20260708120000_faz4_db_constraint_hardening/migration.sql:79-85`** — composite FK `ON UPDATE CASCADE`: `sacks.shipmentId` değişince `rolls.shipmentId`/`swatches.shipmentId` **DB tarafından** yazılır (uygulama, audit ve `preShipStatus` mantığı devre dışı). `shipping.service.ts`'te çuvalı sevkiyata bağlayan/çözen her yol bu cascade'i hesaba katıyor mu? (K-sevkiyat / K4 denetçisi)
5. **`20260711120000_cuval_havuzu_remodel/migration.sql:87` + `schema.prisma:4318`** — "bir sipariş tek aktif sevkiyatta" DB seddi KALDIRILDI; yerine yalnız `shipment_orders.isActive` denorm + uygulama. Aynı siparişe iki PLANNED sevkiyat yarışı artık DB'de bloklanmıyor (ölçüm bugün tutarlı: saha `t/PLANNED 1`). (K-sevkiyat denetçisi)
6. **`src/services/label-template.service.ts:319-342, 432-447, 499-509`** — "kind başına tek varsayılan" iki bağımsız DB seddiyle (`label_templates_one_default_per_kind` + `label_context_defaults_kind_key`) çift-yazım; iki kaynak farklı şablonu gösterebilir, DB bunu engellemez (A-20). (K-etiket denetçisi)
7. **`20260805120000_batch_short_number/migration.sql:22` + `batch.service.generateBatchNumberTx`** — `batches_batchNumber_key` DROP edildi; tek koruma `pg_advisory_xact_lock(8022,1)`'in tx'in İLK ifadesi olması (sıra load-bearing). Bekçi kilidin VARLIĞINI mı SIRASINI mı ölçüyor? (`scripts/test_batch_number_format.ts`; K4 eşzamanlılık denetçisi)
8. **Roll statü makinesi — merkezi geçiş tablosu YOK** (grep 0); 13+ akış-başına liste (§4 A-7 satırı). Yeni statü/yeni akış eklendiğinde hangi listelerin sessizce eski davranışa düştüğü (fail-open) ölçülmeli — `finalizedAt` trigger'ı dahil. (K10 değişmezler / K-mimari denetçisi)
9. **`20260827100000_order_line_cancel/migration.sql` ↔ `src/services/helpers/order-line-scope.helper.ts:26`** — HEAD kodu sahada OLMAYAN `order_lines.cancelledAt` kolonunu her sipariş sorgusunda okuyor; deploy sırası (migration ÖNCE) `deploy/kur.ps1:287`'de var ama backend'in migration'sız çıkması P2022 → tüm sipariş listeleri 500. Ayrıca sahada `ReasonPresetKind.WORK_ORDER_REWORK` defter dışı açılmış (H-14). (K-deploy denetçisi)
10. **`20260714120000_traveler_card_per_workorder/migration.sql:4-5` ↔ `20260702120000:4-7`** — Prisma tx semantiği çelişkisi (H-2). Hangisi doğruysa "yarıda kesilen migration" senaryosunun sonucu (tam geri alma mı, kısmi uygulama mı) değişir; `statement_timeout=0` ve `resolve` yollarıyla birleşince kısmi uygulama riski. (K-deploy / hijyen denetçisi)
11. **`test_db_invariants.ts` sahada §1 kırmızı (items key + orders_active idx), dev'de §5 kırmızı (colors key)** — bekçi "bilerek kırmızı" politikası (`:157-163`) `npm test`'i kalıcı kırmızıya alışkın kılabilir (kırmızı körlüğü). Hangi bekçinin gerçekten kırmızı olduğu ② aşamasında koşularak ölçülmeli. (K-bekçi denetçisi)
12. **A-1 sahada 2 satır `currentQty > initialQty`** — CHECK yok, bilerek düzeltilmemiş (`test_consistency §13`); yeni bir aşım yolunun (Tambur undo dışı) sessizce satır üretip üretmediği `tambur-undo.service.ts:1512-1575` ve `tambur.service.ts:1198` karşılaştırmasıyla ölçülmeli. (K-tambur denetçisi)

---

## SINIR ÖTESİ NOTLAR (kendi alanım dışında görülenler → yönlendirme)

- **K4/K5 (eşzamanlılık):** `roll_barcode_counters` `ON CONFLICT DO UPDATE` satır kilidi tx boyunca tutulur mu (sayaç kilidi tx'in neresinde alınıyor?) — `generateRollBarcode` çağrı yeri incelenmeli. Advisory lock namespace'leri: 8021 (KK1), 8022 (parti); KUNYE'de 8 kullanım noktası sayılmış, ABBA sırası haritası K4'ün işi.
- **K-sevkiyat:** saha kopyasında 12 WAREHOUSE top PLANNED sevkiyatın çuvalında (`shipmentId` dolu) — tasarımla tutarlı ama `preShipStatus` PLANNED aşamasında mı DISPATCH'te mi yazılıyor, storno geri dönüşü hangi statüye? · `roll_returns` iade edilen topların 5'i `CANCELLED` (saha) — iade sonrası iptal akışı mı? · `printed_documents` 2 TRAVELER_CARD `version=2` tek satır (v1 yok).
- **K-rapor:** `finalizedAt IS NULL` 4 final top (saha) + `statusChangedAt IS NULL` 39 — karne dönem taramaları bunları göremez; `sl_day_exact` ifadesi `factoryDaySql` ile metin-eşleşmeli (bekçi `test_report_day_boundary.ts` §5).
- **K-fason:** `roll_movements` kapanmış 883 hareketin 15'inde `qtyOut ≠ qtyIn` (saha) — kısmi kabul/çekme yollarında meşru mu? `AT_SUBCONTRACTOR` 188 topun `currentStepId` dolu (tasarım) — envanter "istasyon-bekleyen" sayaçları bunu dışlıyor mu?
- **K-master-data / K-import:** pasif kumaşa bağlı 2 yeni top (son 30 gün, saha) — hangi yol pasif ana veriyi kabul etti (içe aktarım? KK1?). `unaccent` dev'de elle kurulu, kod kullanmıyor.
- **K-audit:** `system_logs` dev'de 152.892 satır / 103 MB (test kalıntısı) vs saha 10.485; arşivleyici 6 ayda bir; `deviceId` TEXT (`x-device-id` başlığından serbest metin) — arşiv tip düzeltmesi `20260819160000` yapıldı, `requestId` UUID.
- **K-deploy/ops:** `deploy/kur.ps1:287` `migrate deploy` + `premigrate_` yedeği; per-DB GUC'lar (`statement_timeout`, `audit_guard`) deploy adımı — `db-copy-verify.service.ts:157-171` kopya takasında "guc" replay/doğrulama var; canlı prod GUC'ları bu denetimin dışında.
- **K-bekçi:** `test_db_invariants.ts` envanter sayıları `CLAUDE.md:239`'da bayat; `test_migration_hygiene.ts` `applied_steps_count=0` satırlarını UYARI (FAIL değil) basıyor — dev'de 40 uyarı.
- **K-kimlik/güvenlik:** `users_username_lower_uq` + `users_cardToken_key` + `users_quickPin_key` (nullable unique) — PIN tekilliği DB'de; PIN uzunluğu/karmaşıklığı uygulamada (kapsam dışı, not).

---

## KAPSANMAYAN / ERİŞİLEMEYEN

- **Canlı prod DB:** erişim yok. Per-DB GUC'lar (`statement_timeout`, `idle_in_transaction_session_timeout`, `teks.audit_guard`), `max_connections`, gerçek locale/ICU durumu, `pg_stat_*` istatistikleri, bloat, gerçek kilit/bekleme ölçümleri **kopyadan okunamaz** (restore per-DB ayarları ve istatistikleri taşımaz). Sahaya dair her GUC cümlesi repo notuna dayanır, ölçüme değil.
- **Migration checksum bütünlüğü:** `_prisma_migrations.checksum` ile dosya sha256'sı karşılaştırılamadı (algoritma eşleşmedi; tüm satırlar farklı çıktı → yöntem hatası). "Uygulandıktan sonra düzenlenen dosya var mı" sorusu bu haritada yanıtsız; ② aşaması `prisma migrate status`/`diff` ile ölçebilir.
- **Prisma migration transaction semantiği:** repo içi çelişki (H-2) çalıştırılarak doğrulanmadı (yazma/deneme DB'si yok — salt-okunur kural).
- **`CREATE INDEX` süreleri / kilit etkisi:** bugünkü hacimde ölçüm anlamsız (binler); büyüme senaryosu repo ölçümlerinden alıntı.
- **`20260611084953_native_uuid_pk_fk` (2.254 satır) ve `20260525174522_init` (1.678 satır):** satır satır okunmadı; grep + baş/kilit noktaları incelendi.
- **`scripts/consistency-check.sql` / `-derived.sql`:** koşulmadı (repo'nun kendi kapıları; salt-okunur olsalar da bu haritanın işi katalogdu) — yalnız bölüm başlıkları referans alındı. §4'teki ölçümler bu dosyaların sadeleştirilmiş ikizleridir, birebir aynı sorgular değildir (örn. A-3 naif toplam).
- **K10 haritası:** `audit/00-map/` altında henüz K10 dosyası yok; §4 numaraları (A-1…A-32) K10 yazarı için aday listesidir, eşleme ② aşamasında yapılmalı.
- **Uygulama katmanı guard'larının tam listesi** (hangi servis hangi kuralı, hangi kilitle): K2b kapsamı dışı — K4/K5/K10'a bırakıldı; burada yalnız DB'de karşılığı OLMAYAN kuralların varlığı ve tek örnek dosya:satır verildi.
- `_FINDER-BRIEF.md` (dizinde bir ara görünüp kayboldu) okunamadı.
