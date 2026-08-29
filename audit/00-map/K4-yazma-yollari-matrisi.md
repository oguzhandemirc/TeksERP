# K4 — Varlık × Yazma Yolu Matrisi (aşama ① KEŞİF, salt-okunur harita)

Tarih: 2026-08-28 · Dal `adnansahin` (HEAD ce8681d1) · Kaynak: `Teks-Erp/src` (367 ts), `Teks-Erp/scripts` (test_ OLMAYANLAR), `Teks-Erp/prisma/*.ts`, `prisma/migrations/*.sql`, dev DB `adnansahin_db` ve prod kopyası `tekserp_saha_0825` (salt-okunur).
Bu belge YARGI içermez; yalnız "kim nereye yazıyor" haritasıdır. ② denetçileri için önceliklendirilmiş yerler sondaki **HOTSPOTLAR** bölümündedir.

## 0. Yöntem, sayılar, sınırlar

| Ölçüm | Değer | Nasıl |
|---|---|---|
| Prisma modeli | **91** (`prisma/schema.prisma`, `^model` sayımı) | grep |
| Delegate yazma çağrısı (`<alıcı>.<model>.(create\|createMany\|update\|updateMany\|updateManyAndReturn\|upsert\|delete\|deleteMany)(`) | **867** site: **572** `src/` (458 `tx.` · 114 havuz `prisma.`) · **295** scripts+seed | scratchpad `analyze.mjs` (alıcı: tanımlayıcı zinciri / parantezli ifade; `this.delegate` ayrı ele alındı) |
| Alıcı çeşitliliği | yalnız `tx` ve `prisma` (+ BaseService'te `this.delegate` ×5, order.service.ts:1951/1971 `this.delegate.create`) — `db.`/`client.`/`(tx ?? prisma).` biçimi **0** | `grep -P` negatif lookbehind taraması |
| Yazan dosya (src) | **69** dosya · **83** model delegate ile yazılıyor; delegate ile HİÇ yazılmayan **2** model: `RollBarcodeCounter` (yalnız ham SQL), `RouteStepProperty` (yalnız iç içe/nested) | `agg.mjs zero` |
| Katman dağılımı (src) | services **512** · services/helpers **51** · jobs **8** · services/import **1** · **controllers/routes/lib/middlewares: 0** | `agg.mjs nonservice` |
| Ham SQL çağrısı (`$queryRaw*`/`$executeRaw*`) | **147** site (src+script+seed; iç içe generic `<Array<{…}>>` düzeltmesinden sonra — ilk regex 84 buluyordu, **63 site kaçırıyordu**) → src'de **27 WRITE eşleşmesi** → 2 yanlış pozitif elendi (`reports/audit.report.service.ts:70/115` SELECT içinde `'UPDATE'` literali) → **25 gerçek yazan site** (§3f) | `rawsql.mjs` |
| DB trigger | **3** (`rolls_stamp_production_timestamps`, `system_logs_block_tamper`, `system_log_archives_block_tamper`) — dev ve saha kopyasında **ikisi de mevcut, `tgenabled=O`** | `pg_trigger` sorgusu |
| GENERATED kolon | **33** (`*Fold`, `tr_fold()`), 20 tabloda; uygulama HİÇ yazmıyor | `information_schema.columns is_generated='ALWAYS'` (saha) |
| Veri yazan migration | **27** migration dosyasında satır başı `UPDATE/INSERT/DELETE` | grep |
| Master-data birleştirme kuralı (`$executeRawUnsafe` ile dinamik tablo) | **44** kural (`src/constants/merge-map.ts`) | grep |
| Örtük M:N pivot (`_X` tablosu) | **0** — tüm pivotlar açık model | `pg_tables` |

**Devam koşumu tutarlılık kontrolü (2026-08-28, kesinti sonrası):** sayılar `writes2.tsv`/`rawsql.tsv` ham verisinden yeniden türetildi — 867/572/458/114/295/34 dosya/69 dosya/83 model/147 ham SQL birebir tuttu; düzeltilen üç sayı: ham SQL "27 yazan" → 27 eşleşme / **25 gerçek** (§3f), silme dağılımı 75/92 → **74/93** (toplam 167 değişmedi, §5), script ham SQL 15 → **14 gerçek** (§3c). Ayrıca §4'te fonksiyon adı yerine trigger adı yazıldı (`rolls_stamp_production_timestamps` ↔ `roll_stamp_production_timestamps()`; `system_logs_block_tamper` ↔ `audit_block_tamper()`), §1c'ye üç salt-okuma servisin "yazma 0" notu eklendi. Tablo sütun ayracı denetimi (awk): 0 bozuk satır.

**Yöntem sınırları (KAPSANMAYAN bölümüne de bakın):** (a) "durum alanı yazılıyor" tespiti çağrının argüman metninde `data:`/`create:`/`update:` sonrası `status:` vb. arar; `data: payload` gibi değişkenle kurulan gövdeler **görünmez** (örn. `applyRollDispositionsTx`'in `status: target`ı yakalandı ama değişken-gövde kalıpları yakalanmamış olabilir). (b) İç içe (nested) yazma tespiti yalnız çağrı argümanı içindeki `<ilişki>: { create|createMany|deleteMany|… }` kalıbını tanır; değişkende kurulan nested gövde ve BaseService `nestedCreateFields` dönüşümü elle eklendi (§1b).

---

## 1. VARLIK × YAZMA YOLU MATRİSİ

### 1a. Prisma delegate çağrıları (mekanik tarama; sayı = site sayısı, `havuz N` = `prisma.` alıcısıyla tx DIŞI yazım sayısı)

Sütunlar: **Servis (HTTP→servis; route/controller eşlemesi §1c)** · **Helper / import / rapor** · **Controller / route / job / lib / middleware** · **Script (test_ hariç)** · **Seed (prisma/*.ts)**

#### Stok / Top

| Model | Servis | Helper/import | Ctrl/route/job/lib/mw | Script | Seed |
|---|---|---|---|---|---|
| **Roll** | batch.service.ts (6: updateMany)<br>inventory.service.ts (11: create/updateMany/update; havuz 2)<br>kartela.service.ts (6: updateMany; havuz 2)<br>kursun-bypass.service.ts (2: updateMany)<br>kursun-qc.service.ts (3: updateMany)<br>label.service.ts (2: update; havuz 2)<br>order.service.ts (1: updateMany)<br>return.service.ts (2: updateMany)<br>shipping.service.ts (15: updateMany)<br>subcontractor.service.ts (20: create/updateMany/createMany)<br>tambur-manual.service.ts (1: updateMany)<br>tambur-undo.service.ts (7: updateMany)<br>tambur.service.ts (16: updateMany/create/update)<br>workorder-batch-drop.service.ts (3: updateMany/update)<br>workorder-manual-move.service.ts (5: updateMany)<br>workorder-split.service.ts (4: updateMany)<br>workorder.service.ts (7: updateMany/updateManyAndReturn; havuz 1) | *helper:* roll-disposition.helper.ts (3)<br>roll-finalize.helper.ts (1: update)<br>roll-step.helper.ts (1: update)<br>workorder-clone.helper.ts (2: updateMany) | — | backfill_roll_entry_station.ts (1: updateMany)<br>backfill_roll_fold_and_reason.ts (1: updateMany)<br>backfill_roll_label_customer.ts (1: updateMany)<br>clean_test_residue.ts (3: updateMany/deleteMany)<br>demo_kursun_planlama.ts (2: create/deleteMany)<br>demo_tambur_3parti.ts (1: create)<br>fix_fire_rolls_to_scrap.ts (1: updateMany)<br>fixture-manual-move.ts (2: create/deleteMany)<br>fixture-sack-constraint.ts (1: update)<br>repair_sack_ghost_rolls.ts (1: updateMany)<br>seed-demo-shipments.ts (2)<br>seed-fason-desk-demo.ts (1)<br>seed-kk2-queue.ts (1)<br>seed-kk2-test.ts (1)<br>seed-load-scale.ts (1: createMany)<br>seed-parti-demo.ts (1)<br>seed-tambur-test-roll.ts (3: create/deleteMany)<br>seed-test-full.ts (6)<br>seed-wo-branches.ts (1)<br>smoke_fason_http.ts (3: create/deleteMany) | seed-demo-stations.ts (4: deleteMany/create)<br>seed-shipping-scenario.ts (9: deleteMany/create) |
| **RollProperty** | inventory.service.ts (4: createMany/deleteMany)<br>subcontractor.service.ts (4: createMany/deleteMany)<br>tambur-undo.service.ts (2: createMany)<br>tambur.service.ts (6: createMany/deleteMany)<br>workorder.service.ts (2: deleteMany/createMany) | *helper:* station-capability-transfer.helper.ts (1: upsert) | — | clean_test_residue · demo_kursun_planlama · fixture-manual-move · seed-tambur-test-roll · smoke_fason_http (hepsi deleteMany) | seed-demo-stations.ts (1: deleteMany)<br>seed-shipping-scenario.ts (1: deleteMany) |
| **RollError** | inventory.service.ts (1: createMany)<br>kursun-qc.service.ts (2: create/deleteMany; havuz 2)<br>tambur-undo.service.ts (1: updateMany)<br>tambur.service.ts (3: updateMany/update/create)<br>workorder-split.service.ts (2: updateMany) | *helper:* workorder-clone.helper.ts (2: updateMany) | — | clean_test_residue · demo_kursun_planlama · seed-tambur-test-roll (deleteMany) | seed-shipping-scenario.ts (1: deleteMany) |
| **RollOperation** | inventory.service.ts (1: createMany)<br>kursun-qc.service.ts (2: upsert)<br>subcontractor.service.ts (8: createMany/deleteMany)<br>tambur-undo.service.ts (2: deleteMany)<br>tambur.service.ts (6: createMany/upsert)<br>workorder-manual-move.service.ts (1: deleteMany) | *helper:* workorder-clone.helper.ts (1: updateMany) | — | clean_test_residue · demo_kursun_planlama · fixture-manual-move · seed-tambur-test-roll ×2 · smoke_fason_http (deleteMany); seed-load-scale (createMany) | seed-demo-stations.ts (1: deleteMany)<br>seed-shipping-scenario.ts (2: deleteMany) |
| **RollMovement** | inventory.service.ts (5: update/create/updateMany)<br>kursun-bypass.service.ts (2: createMany)<br>kursun-qc.service.ts (3: createMany/deleteMany/updateMany)<br>subcontractor.service.ts (7: create/createMany/deleteMany/updateMany)<br>tambur-manual.service.ts (2: create)<br>tambur-undo.service.ts (4: update/create)<br>tambur.service.ts (2: updateMany)<br>workorder-manual-move.service.ts (3: deleteMany/updateMany/createMany)<br>workorder-split.service.ts (4: updateMany/createMany)<br>workorder.service.ts (1: createMany) | *helper:* roll-step.helper.ts (1: create)<br>workorder-clone.helper.ts (1: updateMany) | — | clean_test_residue (deleteMany) · demo_kursun_planlama (2) · demo_tambur_3parti (1) · fixture-manual-move (deleteMany) · seed-kk2-test (1) · seed-load-scale (createMany) · seed-tambur-test-roll (3) · seed-test-full (4) · smoke_fason_http (deleteMany) | seed-demo-stations.ts (3)<br>seed-shipping-scenario.ts (3) |
| **RollVariance** | subcontractor.service.ts (1: updateMany)<br>tambur-undo.service.ts (2: updateMany) | *helper:* roll-variance.helper.ts (1: create — `recordVarianceTx`) | — | — | — |
| **RollPlanDeviation** | — | *helper:* tambur-plan-gate.helper.ts (1: createMany — `recordPlanDeviationTx`) | — | — | — |
| **RollBarcodeCounter** | — (delegate ile **HİÇ** yazılmıyor; yalnız ham SQL — §1b) | — | — | — | — |
| **Batch** | batch.service.ts (4: create/delete/updateMany)<br>workorder-split.service.ts (1: update) | — | — | demo_kursun_planlama (2) · demo_tambur_3parti (1) · fixture-manual-move (2) | seed-demo-stations.ts (2)<br>seed-shipping-scenario.ts (1: deleteMany) |

#### Üretim / İş emri

| Model | Servis | Helper/import | Ctrl/route/job/lib/mw | Script | Seed |
|---|---|---|---|---|---|
| **WorkOrder** | kursun-qc.service.ts (1: updateMany)<br>order.service.ts (4: updateMany)<br>tambur-manual.service.ts (1: updateMany)<br>tambur-undo.service.ts (2: updateMany)<br>workorder-link.service.ts (4: updateMany; havuz 2)<br>workorder-manual-move.service.ts (1: updateMany)<br>workorder-split.service.ts (2: updateMany)<br>workorder.service.ts (9: create/updateMany/update; havuz 1) | *helper:* roll-step.helper.ts (2: updateMany)<br>workorder-clone.helper.ts (1: create)<br>workorder-locks.helper.ts (1: updateMany — `touchWorkOrderTx`) | — | demo_kursun_planlama (2) · demo_tambur_3parti (1) · fix_workorder_type_from_links (1: updateMany) · fixture-manual-move (2: create/delete) · seed-fason-desk-demo · seed-kk2-test · seed-load-scale · seed-parti-demo · seed-tambur-test-roll (2) · seed-test-full (3) · smoke_fason_http (2) | seed-demo-stations.ts (3)<br>seed-shipping-scenario.ts (2) |
| **WorkOrderStep** | kursun-qc.service.ts (1: updateMany; havuz 1)<br>subcontractor.service.ts (7: update/updateMany)<br>tambur.service.ts (1: update)<br>workorder-manual-move.service.ts (2: updateMany)<br>workorder.service.ts (7: updateMany/delete/update/create; havuz 1) | *helper:* roll-step.helper.ts (1: update — `recomputeStepStatus`) | — | demo_kursun_planlama · fixture-manual-move · smoke_fason_http (deleteMany) · seed-load-scale (createMany) · seed-tambur-test-roll (2) | seed-demo-stations.ts (1: deleteMany)<br>seed-shipping-scenario.ts (1: deleteMany) |
| **WorkOrderToOrderLine** | order.service.ts (3: deleteMany)<br>workorder-link.service.ts (2: createMany/delete)<br>workorder.service.ts (1: deleteMany) | — (ayrıca nested create: workorder.service.ts:1007/5510, workorder-clone.helper.ts:114) | — | — | seed-shipping-scenario.ts (1: deleteMany; nested create :232) |
| **WorkOrderTargetProperty** | workorder.service.ts (3: deleteMany/createMany; nested create :1007/:5510) | — | — | — | — |
| **KursunBypassAssignment** | kursun-bypass.service.ts (4: updateMany/create) | *helper:* kursun-bypass-guard.helper.ts (2: updateMany — `repointPendingBypassAssignmentsTx`/`voidStalePendingBypassAssignmentsTx`) | — | demo_kursun_planlama (1: deleteMany) | — |
| **TravelerCard** | traveler-card.service.ts (4: create/update/updateMany; havuz 1) | *helper:* traveler-card-dirty.helper.ts (2: updateMany)<br>traveler-card-fanout.helper.ts (1: updateMany — `setWorkOrderCardStatuses`) | — | demo_kursun_planlama (2) · fixture-manual-move · seed-load-scale · seed-tambur-test-roll · smoke_fason_http | seed-demo-stations.ts (3)<br>seed-shipping-scenario.ts (2) |
| **TravelerCardScan** | subcontractor.service.ts (2: create)<br>traveler-card.service.ts (1: create; havuz 1) | — | — | demo_kursun_planlama · seed-load-scale · seed-tambur-test-roll · smoke_fason_http | — |
| **Manifest** | workorder.service.ts (1: create; havuz 1 — `createManifest`) | — | — | — | — |

#### Fason (üretim fasonu + kartela fasonu)

| Model | Servis | Helper/import | Ctrl/route/job/lib/mw | Script | Seed |
|---|---|---|---|---|---|
| **SubcontractorDispatch** | batch.service.ts (3: updateMany)<br>subcontractor.service.ts (5: create/updateMany/update; havuz 1)<br>workorder-split.service.ts (1: update) | *helper:* batch-dispatch-surgery.helper.ts (5: updateMany/create/update — `performDispatchSurgeryTx`) | — | smoke_fason_http (1: deleteMany) | seed-demo-stations.ts (2) |
| **SubcontractorDispatchItem** | batch.service.ts (1: updateMany)<br>subcontractor.service.ts (1: updateMany; **create yalnız nested** :1244) | *helper:* batch-dispatch-surgery.helper.ts (2: updateMany) | — | smoke_fason_http (1: deleteMany) | seed-demo-stations.ts (2) |
| **SubcontractorDirectShipAllocation** | subcontractor.service.ts (1: create) | — | — | — | — |
| **DirectShipment** | shipping.service.ts (1: updateMany; havuz 1 — `setDirectShipmentInvoice`)<br>subcontractor.service.ts (1: create) | — | — | — | — |
| **SubcontractorReceipt** | subcontractor.service.ts (3: create/updateMany) | — | — | smoke_fason_http (1: deleteMany) | — |
| **SubcontractorReceiptProperty** | subcontractor.service.ts (3: createMany/deleteMany) | — | — | smoke_fason_http (1: deleteMany) | — |
| **SubcontractorReceiptItem** | subcontractor.service.ts (1: createMany) | — | — | smoke_fason_http (1: deleteMany) | — |
| **SubcontractorCategory** | subcontractor-management.service.ts (4: update/create; havuz 4) | — | — | seed-kartela-category.ts (1: upsert) | prisma/seed.ts (3: create) |
| **Subcontractor** | subcontractor-management.service.ts (4: updateMany/create/update; havuz 1) | — | — | fixture-subcontractor.ts (1: upsert)<br>seed-kartela-category.ts (1: upsert) | prisma/seed.ts (3: create) |
| **SubcontractorToCategory** | subcontractor-management.service.ts (4: deleteMany/createMany) | — | — | fixture-subcontractor · seed-kartela-category (upsert) | prisma/seed.ts nested create (:269/:278/:287) |
| **Swatch** | kartela.service.ts (3: createMany/updateMany)<br>shipping.service.ts (10: updateMany) | — | — | clean_test_residue (1: deleteMany) | — |
| **SwatchStockReduction** | kartela.service.ts (1: create) | — | — | — | — |
| **KartelaDispatch** | kartela.service.ts (2: create/updateMany) | — | — | — | — |
| **KartelaDispatchItem** | — delegate yok; **yalnız nested create** kartela.service.ts:287 (`items: { create }`) | — | — | clean_test_residue (1: deleteMany) | — |
| **KartelaReceipt** | kartela.service.ts (2: create/updateMany) | — | — | — | — |
| **KartelaReceiptItem** | kartela.service.ts (1: createMany) | — | — | clean_test_residue (1: deleteMany) | — |

#### Çuval / Sevk / İade

| Model | Servis | Helper/import | Ctrl/route/job/lib/mw | Script | Seed |
|---|---|---|---|---|---|
| **Sack** | label.service.ts (1: updateMany; havuz 1 — `recordSackPrintEvent`)<br>shipping.service.ts (14: create/updateMany/update/delete; havuz 2) | *helper:* shipment-locks.helper.ts (1: updateMany — `touchWarehouseSackTx`) | — | repair_sack_ghost_rolls (2: updateMany) · seed-demo-shipments (createMany) · seed-load-scale (createMany) | seed-shipping-scenario.ts (5) |
| **Shipment** | shipping.service.ts (8: create/update/updateMany; havuz 2) | *helper:* shipment-locks.helper.ts (1: updateMany — `touchShipmentPlannedTx`) | — | seed-demo-shipments · seed-load-scale · seed-test-full | seed-shipping-scenario.ts (3) |
| **ShipmentOrder** | shipping.service.ts (5: deleteMany/createMany/updateMany) | — | — | seed-demo-shipments · seed-load-scale (createMany) | seed-shipping-scenario.ts (2) |
| **SackAllocation** | shipping.service.ts (3: deleteMany/createMany) | — | — | seed-demo-shipments · seed-load-scale (createMany) | seed-shipping-scenario.ts (3) |
| **RollReturn** | return.service.ts (4: create/updateMany/update; havuz 1) | — | — | clean_test_residue (deleteMany) · seed-demo-shipments (createMany) | — |

#### Sipariş / Müşteri

| Model | Servis | Helper/import | Ctrl/route/job/lib/mw | Script | Seed |
|---|---|---|---|---|---|
| **Order** | order.service.ts (5: updateMany; + BaseService generic create/update/softDelete/hardDelete — §1b) | *helper:* order-status.helper.ts (1: update — `recomputeOrderStatus`) | — | clean_test_residue (deleteMany) · seed-demo-shipments (3) · seed-load-scale · seed-test-full (4) | seed-shipping-scenario.ts (4) |
| **OrderLine** | label.service.ts (1: update; havuz 1 — `updateOrderLineCustomerNames`)<br>order.service.ts (5: updateMany/deleteMany/update/create; havuz 1; + nested create via `nestedCreateFields:["lines"]`) | *helper:* order-status.helper.ts (2: updateMany/update — `touchOrderLinesTx`) | — | clean_test_residue · seed-demo-shipments · seed-load-scale | seed-shipping-scenario.ts (4) |
| **OrderLineRequiredProperty** | order.service.ts (2: deleteMany/createMany; nested create :2498) | — | — | — | — |
| **Customer** | — delegate yok; **BaseService generic** (`customer.routes.ts:17` `new CustomerService({modelName:"customer"})` → create/update/softDelete/hardDelete) | *import:* customer.adapter.ts → `customerService.create/update` | — | seed-demo-shipments (upsert) | seed-fixtures.ts (upsert) |
| **CustomerBranch** | customer-branch.service.ts (3: create/update; havuz 3) (+ Customer nested `branches` create) | *import:* customer-branch.adapter.ts → `branchService` | — | seed-demo-shipments (create) | seed-fixtures.ts (2) |
| **CustomerItemAlias** | customer-alias.service.ts (2: upsert/delete; havuz 2) | — | — | — | — |
| **CustomerColorAlias** | color.service.ts (5: deleteMany/updateMany/createMany — `syncCustomerAssignments`)<br>customer-alias.service.ts (3: upsert/update/delete; havuz 3) | — | — | — | — |

#### Ana veri (kumaş/renk/özellik/kalite/istasyon/rota/reçete/sebep)

| Model | Servis | Helper/import | Ctrl/route/job/lib/mw | Script | Seed |
|---|---|---|---|---|---|
| **Item** | item.service.ts (4: updateMany/update/create) + BaseService generic (`item.routes.ts:13`) | *import:* item adaptörü → servis | — | normalize-names (update) · seed-demo-shipments · seed-test-full (upsert) | seed-fixtures.ts (upsert) |
| **ItemAllowedProperty** | item.service.ts (4: deleteMany/createMany/upsert; havuz 1) | — | — | seed-test-full (2) | — |
| **ItemAllowedColor** | item.service.ts (4: deleteMany/createMany/upsert; havuz 1) | — | — | seed-test-full (2) | — |
| **Color** | — delegate yok; **BaseService generic** (`color.routes.ts:14`) | *import:* color.adapter.ts → `colorService` | — | normalize-names (update) · seed-demo-shipments (upsert) | seed-fixtures.ts (upsert) |
| **FabricProperty** | — delegate yok; **BaseService generic** (`fabric-property.routes.ts:33`, `nestedCreateFields:["stationCapabilities","values"]`) | *import:* fabric-property.adapter.ts | — | seed_fold_catalog_and_modes (2) | seed-fixtures (upsert) · seed.ts (2: create; nested values :216) |
| **FabricPropertyValue** | fabric-property.service.ts (2: updateMany/upsert) | — | — | seed_fold_catalog_and_modes (upsert) | seed.ts nested (:216) |
| **QualityGrade** | — delegate yok; **BaseService generic** (`quality-grade.routes.ts:58`) | — | — | seed-return (updateMany) | seed.ts (createMany) |
| **ReturnReason** | — delegate yok; **BaseService generic** (`return-reason.routes.ts:14`) | — | — | seed-demo-shipments (upsert) · seed-return (createMany) | seed.ts (createMany) |
| **DefectType** | — delegate yok; **BaseService generic** (`defect-type.routes.ts:16`) | *helper:* guarded-hard-remove.ts (1: delete) · *import:* defect-type.adapter.ts | — | — | seed.ts (createMany) |
| **ReasonPreset** | reason-preset.service.ts (5: create/update/updateMany; havuz 3) | — | *job:* reason-preset-catalog.job.ts:57 (create; havuz) | _seed_custom_reason.ts (servis üzerinden, untracked) | — |
| **DuplicateReview** | duplicate-review.service.ts (3: upsert/delete; havuz 3) | — | — | — | — |
| **Station** | — delegate yok; **BaseService generic** (`station.routes.ts:15`) | *helper:* guarded-hard-remove.ts (1: delete) · *import:* station.adapter.ts | — | seed-tambur-test-roll (create) | seed.ts (6: create) |
| **Machine** | — delegate yok; **BaseService generic** (`station.routes.ts:34` `new BaseService({modelName:"machine"})`) | *helper:* guarded-hard-remove.ts (2: deleteMany/delete) · *import:* machine.adapter.ts | — | — | seed.ts (createMany) |
| **StationColor** | station-capability.service.ts (2: deleteMany/createMany) — tablo **deprecated** (CLAUDE.md 2026-08-02), yazan kod duruyor | — | — | — | — |
| **StationProperty** | fabric-property.service.ts (2: deleteMany/createMany)<br>station-capability.service.ts (3: deleteMany/createMany/updateMany) | (FabricProperty nested `stationCapabilities` create) | — | seed_fold_catalog_and_modes (2) | seed.ts (3: create) |
| **Route** | — delegate yok; **BaseService generic** (`route.service.ts:26` `ROUTE_SERVICE_CONFIG`, `nestedCreateFields:["steps"]`) | *helper:* guarded-hard-remove.ts (1: delete) · *import:* route.adapter.ts (`steps: { deleteMany: {}, create }` nested!) | — | — | seed.ts (2: create; nested steps :592/:602) |
| **RouteStep** | — delegate yok; **yalnız nested** (Route create/update `steps`) | *helper:* guarded-hard-remove.ts (1: deleteMany) | — | — | seed.ts nested |
| **RouteStepProperty** | — delegate yok; **yalnız 2. seviye nested** `route.service.ts:393` (`s.plannedProperties = { create: [...] }` → Route `steps.create`) | — | — | — | — |
| **ProductRecipe** | — delegate yok; **BaseService generic** (`product-recipe.routes.ts:15`, `nestedCreateFields:["properties"]`; `product-recipe.service.ts:176` `this.delegate.update`) | *helper:* guarded-hard-remove.ts (1: delete) · *import:* product-recipe.adapter.ts | — | seed-test-full (upsert) | — |
| **ProductRecipeProperty** | — delegate yok; nested `properties` create | *helper:* guarded-hard-remove.ts (1: deleteMany) | — | — | — |

#### Belge / Etiket

| Model | Servis | Helper/import | Ctrl/route/job/lib/mw | Script | Seed |
|---|---|---|---|---|---|
| **PrintedDocument** | printed-document.service.ts (6: create/updateMany; havuz 1 — `getCurrent` lazy-init)<br>traveler-card.service.ts (2: upsert/updateMany) | — | — | smoke_fason_http (deleteMany) | — |
| **DocumentProfile** | document-profile.service.ts (2: create/update; havuz 2) | *import:* config-bundle.service.ts → servis | — | — | — |
| **FreeDocument** | free-document.service.ts (2: create/update; havuz 2) | *import:* config-bundle.service.ts → servis | — | — | — |
| **TravelerCardTemplate** | traveler-template.service.ts (4: updateMany/update; havuz 2) | *import:* config-bundle.service.ts → servis | — | — | — |
| **LabelTemplate** | label-template.service.ts (12: updateMany/create/update; havuz 1) | — | — | — | seed.ts (4: create; nested variants :640) |
| **LabelTemplateVariant** | label-template.service.ts (4: create/delete/updateMany/update; havuz 1) | — | — | migrate_label_templates_to_canvas (create) | seed.ts nested |
| **CustomerTemplateRoute** | customer-template-route.service.ts (2: deleteMany/upsert; havuz 2)<br>label-template.service.ts (1: deleteMany) | — | — | — | — |
| **CustomerStandaloneLabel** | customer-standalone-label.service.ts (2: deleteMany/createMany) | — | — | — | — |
| **LabelContextDefault** | label-template.service.ts (6: upsert/deleteMany) | — | — | — | seed.ts (1: create) |
| **PeripheralTemplateRoute** | label-template.service.ts (1: deleteMany)<br>peripheral.service.ts (2: deleteMany/upsert; havuz 2) | — | — | — | seed.ts (1: create) |

#### Yetki / Kimlik / Cihaz

| Model | Servis | Helper/import | Ctrl/route/job/lib/mw | Script | Seed |
|---|---|---|---|---|---|
| **User** | auth.service.ts (4: update; havuz 4)<br>permission-management.service.ts (10: update/create; havuz 5) | — | — | fixture-test-user (2) | seed.ts (1: create; nested permissions) |
| **UserPreference** | user-preference.service.ts (2: upsert/update; havuz 2) | — | — | — | — |
| **Session** | session-registry.service.ts (5: updateMany/create/deleteMany; havuz 3) | — | — | — | — |
| **Permission** | — (servis yok) | — | *job:* permission-catalog.job.ts:94 (createMany, havuz) | seed-return · sync-kursun-bypass-permissions · sync-quick-wo-permission (upsert) | seed.ts (createMany) |
| **UserPermission** | permission-management.service.ts (6: upsert/deleteMany/createMany/updateMany; havuz 1) | — | — | fixture-test-user · seed-return · sync-* | seed.ts (createMany) |
| **PermissionTemplate** | permission-management.service.ts (4: create/update/delete; havuz 3) | — | *job:* role-template-catalog.job.ts:118/147 (update/create, havuz) | sync-* (create) | seed.ts (createMany) |
| **PermissionTemplateItem** | permission-management.service.ts (2: deleteMany/createMany) | — | *job:* role-template-catalog.job.ts:172 (createMany, havuz) | sync-kursun-bypass-permissions (createMany) | seed.ts (createMany) |
| **Device** | device.service.ts (8: upsert/updateMany/update/delete; havuz 8) | — | — | — | — |
| **PeripheralDevice** | peripheral.service.ts (2: update; havuz 2) + BaseService generic (`peripheral.routes.ts:22`) | *helper:* guarded-hard-remove.ts (1: updateMany) | — | — | seed.ts (5) |
| **DevicePeripheral** | device.service.ts (2: deleteMany/createMany; havuz 2) | — | — | — | — |
| **WorkSession** | work-session.service.ts (7: updateMany/create; havuz 3) | *helper:* guarded-hard-remove.ts (2: deleteMany)<br>work-session.helper.ts (3: updateMany; havuz 3) | — | — | — |

#### Sistem / Ops

| Model | Servis | Helper/import | Ctrl/route/job/lib/mw | Script | Seed |
|---|---|---|---|---|---|
| **SystemSetting** | db-copy.service.ts (1: upsert; havuz — `writeCopyRecords`)<br>system-setting.service.ts (1: upsert; havuz — `set`) | — | *job:* archive-scheduler.ts:42 · backup-scheduler.ts:53 · installation-identity.job.ts:141 (upsert, havuz) | — | seed.ts (upsert) |
| **SystemLog** | audit.service.ts (4: create/createMany/deleteMany; havuz 3) | — | — | demo_kursun_planlama · fixture-manual-move (3) · seed-tambur-test-roll · smoke_fason_http (deleteMany) · seed-load-scale (createMany) | — |
| **SystemLogArchive** | audit.service.ts (1: createMany — `archiveOlderThan`) | — | — | — | — |
| **EndpointLatencyDaily** | latency-persist.service.ts (3: update/create/deleteMany; havuz 3) | — | — | — | — |
| **ImportRun** | — | *import:* import.service.ts:552 (create; havuz) | — | — | — |

### 1b. Delegate DIŞI yazma yolları (model bazında)

| Model / tablo | BaseService generic (`this.delegate.*`, route'ta örneklenen) | Nested (iç içe) yazma | Ham SQL (`$executeRaw*`/`$queryRaw*`) | Trigger / DB-generated | Migration'da veri yazımı | DB-düzeyi / Prisma dışı |
|---|---|---|---|---|---|---|
| **Roll** (`rolls`) | — | — | `master-data-merge.service.ts:921/938` `UPDATE rolls SET labelDirty=true` (executeRawUnsafe, tx içi); 44 MOVE kuralının 4'ü `rolls.{labelCustomerId,itemId,colorId}` (:629); script `backfill_roll_production_timestamps.ts:176/187` `finalizedAt`/`statusChangedAt` (`IS NULL` guard'lı) | **`rolls_stamp_production_timestamps` BEFORE INSERT OR UPDATE** → `finalizedAt`, `statusChangedAt` (§4) | `20260713092000_drop_produced_roll_status` UPDATE rolls | script `fixture-sack-constraint.ts:49/65` `ALTER TABLE rolls ADD/DROP CONSTRAINT` |
| **RollMovement** (`roll_movements`) | — | — | **13 site** (kapanış = `exitedAt/qtyOut/weightOut/notes`): workorder.service.ts:3531 (`softDelete`) · :4038 (`completeWorkOrder`) · :4330 (`hardDelete`) · :6032 (`detachRolls`); subcontractor.service.ts:2071 (`cancel`) · :2828 (`receive`) · :3455 (`closeRemainder`) · :6093/:6185 (`executeDirectShip`); workorder-batch-drop.service.ts:439 (`dropBatch`); helpers/roll-disposition.helper.ts:378 (`closeOpenMovementsTx`); kursun-bypass.service.ts:2339 (`closeBypassMovementsTx`, $queryRaw RETURNING); kursun-qc.service.ts:888 (`finishStep`, $queryRaw RETURNING) — hepsi `tx.` | — | `20260708140000_faz6_schema_hygiene`, `20260612101000_unique_open_movement_per_roll_step` UPDATE | — |
| **RollBarcodeCounter** (`roll_barcode_counters`) | — | — | **TEK yazma yolu:** helpers/roll-barcode.helper.ts:82 `INSERT … ON CONFLICT ("day","type") DO UPDATE SET n = n + count RETURNING n` (`db: Prisma.TransactionClient`; çağıranlar inventory/tambur/subcontractor/workorder-batch-drop) | — | — | — |
| **WorkOrderStep** (`work_order_steps`) | — | nested create: workorder.service.ts:1007, workorder-clone.helper.ts:114, seed/demo scriptleri (12 site) | kursun-qc.service.ts:1665 `UPDATE work_order_steps SET priority … FROM unnest(...)` (**havuz `prisma.$executeRaw`**, tx dışı, `reorderQueue`); merge MOVE `work_order_steps.plannedSubcontractorId` | — | — | — |
| **WorkOrder** (`work_orders`) | — | — | merge MOVE `targetItemId`/`targetColorId` | — | — | — |
| **WorkOrderToOrderLine / WorkOrderTargetProperty** | — | nested create workorder.service.ts:1007/5510, workorder-clone.helper.ts:114 | — | — | `20260708180000_worklist_updatedat_labeldefault` UPDATE | — |
| **Order / OrderLine / OrderLineRequiredProperty** | **Order:** order.routes.ts:29 → BaseService create (order.service.ts:1951/1971 `this.delegate.create` override) / update / softDelete / hardDelete (`controller.hardRemove` order.routes.ts:928) | `nestedCreateFields:["lines"]` (order.routes.ts:73); order.service.ts:2498 `requiredProperties: { create }` | merge MOVE `orders.customerId`, `order_lines.{itemId,colorId}` | GENERATED `order_lines.customerItemNameFold` | — | — |
| **Customer / CustomerBranch** | customer.routes.ts:17 (CustomerService) create/update/softDelete/hardDelete (:220 permanent) | `nestedCreateFields:["branches"]` (customer.routes.ts:33) | merge: `customers` kaynak satır yok edilmez (tombstone `mergedIntoId`); 7 MOVE kuralı | GENERATED `customers.nameFold`, `customer_branches.{nameFold,cityFold}` | — | — |
| **Item / Color / FabricProperty / QualityGrade / ReturnReason / DefectType / Station / Machine / PeripheralDevice / ProductRecipe / Route** | Route'ta örneklenen BaseService (`item.routes.ts:13`, `color.routes.ts:14`, `fabric-property.routes.ts:33`, `quality-grade.routes.ts:58`, `return-reason.routes.ts:14`, `defect-type.routes.ts:16`, `station.routes.ts:15/34`, `peripheral.routes.ts:22`, `product-recipe.routes.ts:15`, `route.service.ts:26`) → `base.service.ts:1001` create · `:1101/:1198/:1236` update/reactivate/softDelete · `:1270` hardDelete (`delegate.delete`, P2003→409) | `nestedCreateFields`: fabric-property `["stationCapabilities","values"]`, product-recipe `["properties"]`, route `["steps"]` (+ route.service.ts:393 `plannedProperties.create` → RouteStepProperty); route.adapter.ts:296 `steps: { deleteMany: {}, create }` (update yolunda nested **deleteMany**) | merge MOVE: `items`→7 kural, `colors`→9, `subcontractors`→6 (`merge-map.ts:66-…`); CONFLICT/UNION/MERGE_FIELDS dalları `DELETE FROM "<tablo>"` + `UPDATE` (master-data-merge.service.ts:841/848/866/880/892) | GENERATED `nameFold` (+`descriptionFold`/`categoryFold`) 20 tabloda; renk: `colors_nameFoldColor_key` ifade indeksi (`tr_fold_color`) | `20260810010330_station_capability_flags` UPDATE stations; `20260702121000_work_sessions` UPDATE machines/peripheral_devices/stations; `20260820020000/030000` UPDATE quality_grades | scripts `normalize-names.ts:38/41` (Item/Color `name` — fold otomatik) |
| **Sack** (`sacks`) | — | — | master-data-merge.service.ts:928 `UPDATE sacks SET labelDirty=true`; merge MOVE `sacks.customerId` | — | `20260612103000_sack_seq_unique` UPDATE | — |
| **Shipment / ShipmentOrder / SackAllocation / RollReturn / DirectShipment** | — | Shipment `orders` nested create (script seed-test-full.ts:432) | merge MOVE `shipments.customerId`, `direct_shipments.customerId`, `roll_returns.{customerId,itemId,colorId}` | GENERATED `shipments.{carrierFold,driverNameFold,plateNumberFold}`, `roll_returns.{noteFold,reasonTextFold}`, `direct_shipments.reasonFold` | `20260712130000_drop_at_door_shipment_status` UPDATE shipments; `20260612121000_shipment_allocation_unique` DELETE/UPDATE shipment_allocations; `20260708160000` UPDATE shipment_orders | — |
| **SubcontractorDispatch/Item, SubcontractorReceipt, KartelaDispatch/Receipt** | — | SubcontractorDispatch `items` nested create (subcontractor.service.ts:1244); KartelaDispatch `items` nested create (kartela.service.ts:287) | merge MOVE `subcontractor_dispatches/receipts.subcontractorId`, `subcontractor_receipts.appliedColorId`, `kartela_dispatches/receipts.subcontractorId`, `route_steps.{plannedColorId,plannedSubcontractorId}` | — | — | — |
| **Swatch / SwatchStockReduction** | — | — | merge MOVE `swatches.{itemId,colorId}`, `swatch_stock_reductions.{itemId,colorId}` | — | — | — |
| **PrintedDocument / LabelTemplate / LabelTemplateVariant / LabelContextDefault / TravelerCard / TravelerCardScan** | — | LabelTemplate `variants` nested (seed.ts:640) | — | GENERATED `label_templates.nameFold` | `20260728171853` DELETE printed_documents; `20260525230807`, `20260706090000`, `20260820040000/050000` UPDATE/INSERT label_* ; `20260714120000` DELETE/INSERT/UPDATE traveler_cards + traveler_card_scans | — |
| **User / UserPermission / PermissionTemplate / PermissionTemplateItem / Permission** | — | User `permissions` nested (permission-management.service.ts:484); PermissionTemplate `permissions` nested (:838, role-template-catalog.job.ts:147, sync-* scriptleri) | — | GENERATED `permission_templates.nameFold` | `20260801020000_kursun_bypass_permission_catalog` INSERT permissions/templates/items | — |
| **Session / Device / DevicePeripheral / PeripheralDevice** | — | — | — | GENERATED `peripheral_devices.{nameFold,addressFold}` | `20260629140000`, `20260708190000` UPDATE devices; `20260630120000` INSERT device_peripherals; `20260703120000/130000`, `20260706130000` UPDATE peripheral_devices / INSERT+DELETE system_settings; `20260708140000` UPDATE sessions | — |
| **SystemLog / SystemLogArchive** | — | — | audit.service.ts:233 `SET LOCAL teks.audit_purge='on'` (tx içi, `deleteMany`'den ÖNCE); scriptler: `bench_audit_summary.ts:141` **`INSERT INTO system_logs … generate_series`** + `ANALYZE`; `bench_audit_final.ts:53/55/57` `CREATE/DROP STATISTICS`, `ANALYZE`; `reset-operational.ts:20` **`TRUNCATE system_logs, system_log_archives, … (30+ tablo) CASCADE`** | **`system_logs_block_tamper` / `system_log_archives_block_tamper` BEFORE UPDATE OR DELETE OR TRUNCATE FOR EACH STATEMENT** — yalnız `teks.audit_guard='on'` iken ve `teks.audit_purge<>'on'` iken RAISE | — | `ALTER DATABASE … SET teks.audit_guard='on'` ops adımı (`src/server.ts:68` uyarı metni) |
| **SystemSetting** | — | — | — | — | `20260703130000`, `20260712120000` DELETE system_settings; `20260706130000` INSERT | — |
| **(tüm DB)** | — | — | — | — | — | `db-copy.service.ts:320 CREATE DATABASE` · `:500/:716 DROP DATABASE … WITH (FORCE)` · `:619 ALTER DATABASE … SET` (`pg` `Client`, `helpers/pg-admin-client.ts:68`, bakım DB'si üzerinden); `helpers/db-swap-command.helper.ts:77` `ALTER DATABASE … RENAME TO` komut METNİ üretir (çalıştırma ops'ta); `backup.service.ts:247 pg_dump` (yazma DEĞİL, dosya) · `pg_restore --list` (doğrulama) — canlı DB'ye restore uygulama içinden YOK |

### 1c. HTTP giriş noktası → yazan servis eşlemesi (route/controller dosyası; `grep -l "services/<x>"`)

| Servis | HTTP giriş (routes/ · controllers/) |
|---|---|
| inventory.service | inventory.controller.ts |
| tambur.service · tambur-undo.service · kursun-bypass.service | tambur.controller.ts (+ kursun-bypass.controller.ts) |
| tambur-manual.service | tambur-manual.controller.ts |
| kursun-qc.service | kursun-qc.controller.ts |
| workorder.service · workorder-link.service · workorder-fason-quick.service | workorder.controller.ts (workorder-fason-quick: delegate yazma **0** — orkestrasyon, yazma workorder/subcontractor servislerinde) |
| **workorder-split.service · workorder-manual-move.service · workorder-batch-drop.service** | **doğrudan route/controller importu YOK** — yalnız `workorder.service`/`inventory.service` üzerinden çağrılır (`grep -l` sonucu `—`) |
| subcontractor.service | subcontractor.controller.ts |
| subcontractor-management.service | subcontractor-management.controller.ts |
| kartela.service | kartela.controller.ts |
| shipping.service · sack-search.service · accounting-export.service | shipping.controller.ts (sack-search / accounting-export: delegate yazma **0**, salt-okuma) |
| return.service | return.controller.ts |
| order.service | order.routes.ts (BaseController + özel uçlar) |
| batch.service | batch.controller.ts |
| traveler-card.service | traveler-card.controller.ts |
| label.service | label.controller.ts |
| label-template.service | label-template.controller.ts |
| printed-document.service | printed-document.controller.ts |
| master-data-merge.service · duplicate-review.service · duplicate-detection.service | master-data-merge.routes.ts |
| permission-management.service · session-registry.service · auth.service · system-log.service · backup.service · latency-persist.service | admin.routes.ts (+ auth.controller.ts) |
| system-setting.service | admin.routes.ts, feature-flag.routes.ts, auth/device/traveler-card controller'ları |
| device.service | device.controller.ts |
| work-session.service | work-session.routes.ts/controller + station/station-capability/peripheral routes |
| reason-preset.service | reason-preset.routes.ts |
| db-copy.service | db-copy.routes.ts (`db-copy-verify.service` HTTP'den import edilmiyor, db-copy içinden) |
| BaseService (generic) | station.routes.ts, return-reason.routes.ts, customer-branch-list.routes.ts (salt-okuma — yazma ucu mount edilmemiş), quality-grade.routes.ts, defect-type.routes.ts + `BaseController` (color/item/order/fabric-property/product-recipe/peripheral/customer/route routes) |
| helpers/guarded-hard-remove (route → **helper**, controller yok) | station.routes.ts:226/411, product-recipe.routes.ts:186, route.routes.ts:167, defect-type.routes.ts (hepsi `/:id/permanent`) |
| helpers/work-session.helper (`resolveActiveSession`/`getStampContext` WorkSession `updateMany` havuz) | kursun-qc/label/shipping/tambur/tambur-manual/inventory controller'ları + station-capability/peripheral routes |

---

## 2. ÇOK SAHİPLİ MODELLER (≥3 farklı servis/helper dosyasından yazılan) — durum (enum) alanı yazanlar

Sayım `src/services/**` (helper dahil, script/seed hariç). "Durum alanı" = şemada enum tipli alan veya `status/state/isActive`; parantez içi `=X` yazılan literal değer. **Sahiplik sütunu [VARSAYIM]**: dosya adı + CLAUDE.md karar notlarından türetildi, koda yazılı bir sahiplik beyanı yok (`grep "sahib|Bounded"` ARCHITECTURE.md → 0).

| Model | Yazan dosya sayısı | Durum alanı yazanlar (dosya[alan, =değer]) | Sahip [VARSAYIM] / kanonik helper | ② için not |
|---|---|---|---|---|
| **Roll** | **21** (17 servis + 4 helper) | roll-disposition.helper.ts:239 `applyRollDispositionsTx` [status=target değişken, preCancelStatus] · roll-finalize.helper.ts:189 [form] · inventory.service.ts:906 `createInitialEntry` [status,entrySource] · :3253 `softDelete` [status = CANCELLED\|SCRAP moda göre, preCancelStatus] · :3452 `restoreCancelledRoll` [CANCELLED→target, **havuz**] · :3561 `hardDelete` [STOCK→CANCELLED] · :4033 `prepareRawForSale` [STOCK→WAREHOUSE, **havuz**] · :4166 `createOpenFabric` [IN_PRODUCTION\|WAREHOUSE] · :4422 `rescueStuckRoll` [→WAREHOUSE] · kartela.service.ts:323/437/678/821 [AT_KARTELA/WAREHOUSE/KARTELA_CONSUMED] · kursun-qc.service.ts:1128 `reopenStep` [final→IN_PRODUCTION] · order.service.ts:2149 `quickOrderFromRolls` [STOCK→WAREHOUSE] · return.service.ts:501 `createReturn` [SHIPPED→appliedStatus] · :882 `cancelReturn` [→SHIPPED] · shipping.service.ts:1862 `performDispatchTx` [→SHIPPED, preShipStatus] · :2197 `undoDispatch` [SHIPPED→preShipStatus??WAREHOUSE] · subcontractor.service.ts:523/1319/2052/2857/3055/3420/4846/4930/5377/5442/6114 [AT_SUBCONTRACTOR/STOCK/SUBCONTRACTOR_CONSUMED/CANCELLED, entrySource, form] · tambur-manual.service.ts:1151 · tambur-undo.service.ts:1073/1260/1330/1488/1563 [CANCELLED, preTamburCloseStatus] · tambur.service.ts:953/1043/1191/2132/2236/2473/2498/2805/2922/3202/3232 [TAMBUR_CONSUMED/IN_PRODUCTION/WAREHOUSE, preTamburCloseStatus, entrySource] · workorder-batch-drop.service.ts:394 [status=target] · workorder-manual-move.service.ts:599 [IN_PRODUCTION] · workorder-split.service.ts:339/456/498 [IN_PRODUCTION] · workorder.service.ts:3281 `prepareFasonCancelDecision` [IN_PRODUCTION, **havuz**] · :3513 `softDelete` [STOCK] · :4317 `hardDelete` [STOCK] · :4494 `attachRolls` [IN_PRODUCTION, updateManyAndReturn] · :6000 `detachRolls` | Kanonik tek nokta YOK — geçişler istasyon/akış başına dağıtık. Ortak noktalar: finalize `finalizeRollsAtLastStep` (roll-finalize.helper), kapanış dispozisyonu `applyRollDispositionsTx` (roll-disposition.helper; yalnız workorder + batch-drop çağırır), iptal/geri alma `inventory.softDelete/restoreCancelledRoll`, ölü küme `K18_DEAD_STATUSES`; trigger damgası (§4) | "Önceki statü" kolonları ÜÇ ayrı serviste yazılır: `preShipStatus` (shipping:1862/2197), `preCancelStatus` (inventory:3253/3452, disposition:275), `preTamburCloseStatus` (tambur:2581, tambur-undo:1330/1563) — geri alma yollarının çapraz tutarlılığı ② konusu |
| **RollMovement** | **12** (10 servis + 2 helper) | durum enum'u yok; "durum" `exitedAt IS NULL` + `notes` marker metni (`WO_CANCELLED`, `QC2_STEP_FINISHED:<uuid>`, `KURSUN_BYPASS_FINISHED:UNASSIGNED:`, `RETURNED_VIA_RECEIPT:`, `DETACHED_FROM_WO`, `MANUAL_MOVE_OUT`, `REDYE_REWIND`, `BATCH_DROP_STOCK:`) | Açma: roll-step.helper `openMovementForNextStep`; kapanış: **13 ham SQL + 9 Prisma** `exitedAt: new Date()` sitesi (§1b, §4) | İki kapanış mekanizması; `qtyOut` semantiği yerine göre `qtyIn`/`currentQty`/`0`(storno) — bkz. HOTSPOT H4 |
| **WorkOrder** | **11** (8 servis + 3 helper) | roll-step.helper.ts:180 `ensureWorkOrderInProgress` [IN_PROGRESS] · :204 `completeWorkOrderIfStepsDone` [COMPLETED] · workorder-clone.helper.ts:114 [create IN_PROGRESS,type] · kursun-qc.service.ts:1144 `reopenStep` [IN_PROGRESS] · **order.service.ts:3242 `cancelWithActions` [CANCELLED\|COMPLETED\|APPROVED]** + :3210 [type] · tambur-manual.service.ts:1194 [IN_PROGRESS] · tambur-undo.service.ts:1378/1669 [IN_PROGRESS] · workorder-link.service.ts [type] · workorder-manual-move.service.ts:816 [IN_PROGRESS] · workorder-split.service.ts:283 `supersedeEmptiedSourceWorkOrderTx` [SUPERSEDED] · :394 [IN_PROGRESS] · workorder.service.ts:1007 `create` [PLANNED] · :3387 `softDelete` [CANCELLED] · :3866 `completeWorkOrder` [COMPLETED] · :4355 [isActive] · :6100 `lockWorkOrder` [PLANNED→IN_PROGRESS, **havuz**] | workorder.service.ts; geçiş helper'ları roll-step.helper (`ensureWorkOrderInProgress`, `completeWorkOrderIfStepsDone` — terminal guard'lı), `touchWorkOrderTx` (workorder-locks) | IN_PROGRESS diriltmesi 6 serviste DOĞRUDAN `updateMany` (kanonik `ensureWorkOrderInProgress` dururken); order.service iş emrinin durum makinesine yazıyor (7.2 üç koşul) — H2/H3 |
| **WorkOrderStep** | **6** (5 servis + 1 helper) | roll-step.helper.ts:145 `recomputeStepStatus` [status türetilmiş] · subcontractor.service.ts:1108 `dispatch` [ACTIVE] · :2118/:2128 `cancel` [COMPLETED / PENDING] · :2959 `receive` [COMPLETED] · :3474 `closeRemainder` [COMPLETED] · :6175 `executeDirectShip` [COMPLETED] · :6199 [SKIPPED] · workorder-manual-move.service.ts:785/801 [SKIPPED/PENDING] · workorder.service.ts:3547 `softDelete` [SKIPPED] · :4058 `completeWorkOrder` [SKIPPED] · :4344 `hardDelete` [SKIPPED] · (kursun-qc.service.ts:1697 `setQueueUrgent` isUrgent, **havuz**; :1665 ham SQL `priority`) | workorder.service + `recomputeStepStatus` (12 dosyadan çağrılıyor; subcontractor.service de 5 kez çağırıyor AMA 7 sitede ayrıca doğrudan status yazıyor) | H1 |
| **RollOperation** | **7** | operationType (kursun-qc/subcontractor/tambur) — append-only log; **deleteMany 7 site** (§5) | İstasyon servisleri; okuyan rapor `reports/production.report.service.ts:109` (tambur-undo.service.ts:1597 yorumu) | Silinen log = rapor sayımından düşer (bilinçli, yorumlu) |
| **RollError** | **6** | actionTaken (tambur.service, tambur-undo, workorder-split); isProcessed | kursun-qc.service (açar) / tambur.service (kapatır) | kursun-qc.service.ts:720 `deleteError` **havuz** `deleteMany` (isProcessed:false claim) |
| **RollProperty** | **6** | — (küme modeli; `deleteMany`+`createMany` replace deseni ×5) | station-capability-transfer.helper `copyStationCapabilitiesToRoll`; inventory `applyManualProperties` (yalnız FLAG evreni siler, inventory.service.ts:3947) | tambur.service.ts:1208 `finalize` parent'ın TÜM property'lerini siler (CHOICE dahil?) — ② doğrular |
| **SubcontractorDispatch** | **4** | — (`cancelledAt`, `directShippedAt` damgaları; enum yok) | subcontractor.service; parti cerrahisi `performDispatchSurgeryTx` (batch.service→helper) | — |
| **WorkSession** | **3** | endReason (work-session.service ×6, work-session.helper ×3 — **hepsi havuz**) | work-session.service | Yazımlar `updateMany` + `endedAt: null` koşullu (claim benzeri) |
| **WorkOrderToOrderLine** | **3** | — pivot | workorder-link.service (bağ/sök) — order.service iptalde `deleteMany` ×3 | — |
| **TravelerCard** | **3** | traveler-card.service.ts:190 [ACTIVE] · :499 `voidCard` [VOIDED, **havuz** claim] · traveler-card-fanout.helper.ts:26 `setWorkOrderCardStatuses` [status parametrik; 6 servisten çağrılıyor] · traveler-card-dirty.helper (`contentDirty`) | traveler-card.service | Fan-out helper'ı çağıran 6 servis (workorder, manual-move, split, tambur-undo, kursun-qc, tambur-manual) |
| **Sack** | **3** | shipping.service.ts:253/966/1062 [weightSource] · label.service.ts:1742 [labelDirty, havuz] · shipment-locks.helper `touchWarehouseSackTx` | shipping.service | Sack durumu enum değil (`shipmentId`/`sealed` yok) |
| **RollVariance** | **3** | kind (roll-variance.helper `recordVarianceTx`) | roll-variance.helper | subcontractor/tambur-undo `updateMany` (terslemeler) |
| **OrderLine** | **3** | — (shippedQty, cancelledAt) | order.service; `touchOrderLinesTx` (order-status.helper) shipping/subcontractor'dan çağrılıyor | label.service.ts:1391 `updateOrderLineCustomerNames` etiket servisinden sipariş satırı yazıyor (havuz) — H13 |
| **2 dosyalı (bilgi):** Shipment (shipping + shipment-locks) · Order (order + order-status.helper) · PrintedDocument (printed-document + traveler-card: ACTIVE/SUPERSEDED/VOIDED) · User · Batch (batch + workorder-split) · DirectShipment (shipping + subcontractor) · KursunBypassAssignment · Swatch (kartela + shipping ×10) · SystemSetting (system-setting + db-copy) · StationProperty · CustomerColorAlias · CustomerTemplateRoute · PeripheralTemplateRoute · PeripheralDevice · TravelerCardScan | | | | |

**Durum alanına yazan toplam site (src, data-düzeyinde tespit):** 297 satır (`agg.mjs status`); Roll.status 57 site, WorkOrder.status 15, WorkOrderStep.status 13, Shipment.status 4 (shipping.service.ts:1404 PLANNED create · :1812 DISPATCHED · :1966 CANCELLED · :2179 PLANNED), Order.status 4 (order.service.ts:2760/3144 CANCELLED · :3319 COMPLETED · :3397 APPROVED), PrintedDocument.status 8, Device.status 3, TravelerCard.status 3.

---

## 3. SERVİS KATMANINI ATLAYAN YAZMALAR

### 3a. Controller / route / lib / middleware → doğrudan ORM
`grep -rn "lib/prisma\|prisma\.[a-z]" src/routes src/controllers` → **1 vuruş, yorum** (`tambur.controller.ts:45`). Delegate yazma taraması: **0 site.** Route'lar BaseService'i örnekler ama yazma yine `base.service.ts` üzerinden (sanitize + audit) geçer. Tek istisna kalıbı: **route → helper** (`guarded-hard-remove`, `work-session.helper`) — controller'sız ama helper audit yazıyor (guarded-hard-remove.ts:78 `AuditService.log`).

### 3b. Jobs (`src/jobs`) → doğrudan `prisma.` (8 site, hepsi havuz client)

| Job | Site | Model / alan | Audit | Servis katmanı atlanıyor mu |
|---|---|---|---|---|
| permission-catalog.job.ts | :94 | Permission `createMany` (skipDuplicates) | `AuditService.logEvent` :123/:186 | Evet — `permission-management.service` yerine doğrudan; katalog uzlaştırması (bilinçli, "katalog koda, atama panele") |
| role-template-catalog.job.ts | :118 update · :147 create (nested items) · :172 createMany | PermissionTemplate, PermissionTemplateItem | logEvent :202 | Evet |
| reason-preset-catalog.job.ts | :57 | ReasonPreset `create` | **AuditService importu YOK**; `refreshReasonPresetCache()` :72 çağrılıyor | Evet — `ReasonPresetService.create` yerine doğrudan (kod türetme/legacyTexts mantığı atlanır mı → ②) |
| archive-scheduler.ts | :42 `setLastRun` | SystemSetting upsert (job-özel anahtar) | — | `system-setting.service.set` (sanitize/4-kapı) atlanır; anahtar job'a özel |
| backup-scheduler.ts | :53 `setLastRun` | SystemSetting upsert | — | aynı |
| installation-identity.job.ts | :141 | SystemSetting upsert (kimlik JSON, tam değiştirme) | logEvent :100/:113 | aynı |

### 3c. Scriptler (test_ hariç) + prisma seed'leri — delegate ile yazan 34 dosya, 295 site (script 183 · seed 112) + ham SQL **14 gerçek yazan/DDL/bakım sitesi**

Ham SQL sayımı: tarayıcı (`rawsql.tsv`) script/seed'de 17 WRITE eşleşmesi verdi → **6 yanlış pozitif** (SELECT/EXPLAIN gövdesinde `UPDATE`/`ANALYZE` literali: `backfill-record-provenance.ts:99` dry-run sayım sorgusu · `bench_audit_final.ts:31` · `bench_audit_probe.ts:32` · `bench_audit_summary.ts:68/162` · `scale_report.ts:88`) + **3 tarayıcı-körü** değişken-SQL sitesi (`backfill-record-provenance.ts:102` `updSql(...)` · `fixture-sack-constraint.ts:49/71` `CONSTRAINT_SQL`) → gerçek 14: `backfill-record-provenance.ts:102/103` · `backfill_roll_production_timestamps.ts:176/187` · `bench_audit_final.ts:53/55/57` · `bench_audit_summary.ts:141/156` · `fixture-sack-constraint.ts:49/65/71` · `reset-operational.ts:20` · `seed-load-scale.ts:699` (`ANALYZE`, bakım).

| Sınıf | Script | Yazdığı modeller / tablolar | Dry-run/`--apply` | Prod kapısı | Audit izi |
|---|---|---|---|---|---|
| Backfill | backfill_roll_entry_station.ts | Roll.updateMany | var (7) | yok | `AuditService` ×2 |
| Backfill | backfill_roll_fold_and_reason.ts | Roll.updateMany | var | yok | **yok** |
| Backfill | backfill_roll_label_customer.ts | Roll.updateMany | var | yok | **yok** |
| Backfill | backfill_roll_production_timestamps.ts | **ham SQL** `UPDATE rolls SET finalizedAt/statusChangedAt … WHERE … IS NULL` (:176/:187) | var | yok (yalnız metin) | **yok** |
| Backfill | backfill-record-provenance.ts | **ham SQL** `UPDATE "<tablo>" SET createdById/updatedById` (:102/:103; tablo adı `tableNameFor` haritasından) | var | yok | yok |
| Fix | fix_fire_rolls_to_scrap.ts | Roll.updateMany (status→SCRAP, atomik claim :168) | var (9) | yok | ×2 |
| Fix | fix_workorder_type_from_links.ts | WorkOrder.updateMany | var (9) | "PROD" metni 10 (kendi guard'ı) | ×2 |
| Repair | repair_sack_ghost_rolls.ts | Roll/Sack updateMany | var (11) | DATABASE_URL okuması 1 | ×3 |
| Merge köprüsü | apply_merge_decisions.ts · fix_duplicate_master_data.ts | **doğrudan yazma 0** — `MasterDataMergeService.merge` motoru | var | — | motor yazar |
| Normalize | normalize-names.ts | Item.update / Color.update (`name`) | var | yok | **yok** |
| Migrasyon-benzeri | migrate_label_templates_to_canvas.ts | LabelTemplateVariant.create | var (3) | yok | ×3 |
| Katalog | seed_fold_catalog_and_modes.ts · sync-kursun-bypass-permissions.ts · sync-quick-wo-permission.ts · _seed_custom_reason.ts (untracked; servis üzerinden) | FabricProperty/Value/StationProperty · Permission/PermissionTemplate(+nested items)/UserPermission · ReasonPreset | seed_fold: var; sync-*: **yok** | yok | yok |
| **Yıkıcı** | **reset-operational.ts:20** | **`TRUNCATE` 30+ operasyon tablosu CASCADE** (system_logs, rolls, work_orders, shipments, sacks, …) | **yok** | **yok — yalnız yorum satırı uyarısı** | yok |
| Yıkıcı | clean_test_residue.ts | deleteMany: Roll, Order, OrderLine, RollError/Return/Movement/Operation/Property, Swatch, Kartela*Item (+Roll.updateMany) | var (`--apply`) | yok (DB adı kontrolü yok) | yok |
| DDL | fixture-sack-constraint.ts | `ALTER TABLE rolls ADD/DROP CONSTRAINT` (:49/:65/:71) | — | yok | — |
| Bench | bench_audit_summary.ts:141 · bench_audit_final.ts:53-57 | **`INSERT INTO system_logs` sentetik satır** + `ANALYZE` · `CREATE/DROP STATISTICS` | — | "PROD" metni 1 | — |
| Seed/demo/fixture (create+deleteMany) | seed-test-full · seed-demo-shipments · seed-load-scale · seed-tambur-test-roll · smoke_fason_http · demo_kursun_planlama · demo_tambur_3parti · fixture-manual-move · fixture-test-user · fixture-subcontractor · seed-kartela-category · seed-return · seed-kk2-* · seed-parti-demo · seed-fason-desk-demo · seed-wo-branches | Roll/WorkOrder/Batch/Movement/Operation/TravelerCard/Shipment/Sack/Order/… (§1a Script sütunu) | yok | seed-test-full "PROD" metni 13 (kendi kontrolü); diğerleri yok | seed-load-scale SystemLog.createMany (sentetik audit) |

`productionDbGate()` tanımı **yalnız** `scripts/run-all-tests.ts` içinde; yukarıdaki hiçbir script onu import etmiyor (`grep -rn productionDbGate scripts` → tek dosya).

### 3d. Seed'ler (`prisma/*.ts`)
`seed.ts` (40 site: create/createMany/upsert — Permission, User, Station, Route(+nested steps), LabelTemplate(+variants), …; **deleteMany yok**) · `seed-fixtures.ts` (6: upsert/create — Item/Color/FabricProperty/Customer/CustomerBranch) · `seed-demo-stations.ts` (22: **deleteMany ×10 model** + create) · `seed-shipping-scenario.ts` (44: **deleteMany ×15 model** + create). Seed'ler `AuditService` kullanmaz.

### 3e. Migration'da veri yazımı (27 dosya) — servis/audit/trigger dışı
Tablolar: rolls, roll_movements ×2, roll_returns ×2, sessions, devices ×2, device_peripherals, peripheral_devices ×3, machines, stations ×2, sacks, shipments, shipment_allocations, shipment_orders, work_order_to_order_lines, traveler_cards (+scans), printed_documents, label_templates ×2, label_template_variants ×2, label_context_defaults, customer_color_aliases, quality_grades ×3, system_settings ×3, permissions/permission_templates/items. (Liste: `grep -rlE '^\s*(UPDATE|INSERT INTO|DELETE FROM)' prisma/migrations`.)

### 3f. Ham SQL (uygulama içi, **25** gerçek yazan site = roll_movements 13 + work_order_steps 1 + roll_barcode_counters 1 + merge 9 + SET LOCAL 1; tarayıcı 27 eşleşme, 2'si yanlış pozitif) — audit/Prisma `@updatedAt` dışı
- `roll_movements` kapanışı 13 site (§1b) — `tx.` içinde; `updatedAt` **güncellenmez** (kolon `@updatedAt`, DB default YOK — `information_schema` dev: `roll_movements.updatedAt column_default=''`).
- `work_order_steps.priority` (kursun-qc.service.ts:1665, **havuz**, `reorderQueue`; ardından `AuditService.log` :1673).
- `roll_barcode_counters` sayaç (roll-barcode.helper.ts:82).
- `rolls.labelDirty` / `sacks.labelDirty` (merge :921/:928/:938) + 44 MOVE/CONFLICT kuralı (`$executeRawUnsafe`, tablo/kolon adı `merge-map.ts` allowlist'inden string interpolasyonu; `tx.` içinde, `pg_advisory_xact_lock(MERGE_LOCK_NS)` :546).
- `SET LOCAL teks.audit_purge='on'` (audit.service.ts:233).

---

## 4. TRIGGER / DB'NİN YAZDIĞI KOLONLAR ve uygulama tarafındaki çift yazım

| Kolon / tablo | Kim yazar (DB) | Kaynak | Uygulama kodu aynı kolonu yazıyor mu | Not |
|---|---|---|---|---|
| `rolls.finalizedAt` | trigger `rolls_stamp_production_timestamps` → fonksiyon `roll_stamp_production_timestamps()` (migration.sql:45/:93; BEFORE INSERT: status∈{WAREHOUSE,A1_STOCK,SCRAP} ise; BEFORE UPDATE: status DEĞİŞMİŞ **ve** OLD∈{IN_PRODUCTION,STOCK,AT_SUBCONTRACTOR,RETURNED_FROM_SUBCONTRACTOR} **ve** NEW∈{WAREHOUSE,A1_STOCK,SCRAP} ise; **üzerine yazılır**) | `prisma/migrations/20260809090000_roll_production_timestamps/migration.sql:45-96`; saha kopyasında uygulanmış (`_prisma_migrations` finished 2026-08-15), `pg_get_functiondef` ile gövde doğrulandı | **src: 0** (`finalizedAt:`/`statusChangedAt:` data bloğunda hiç geçmiyor; `tambur.service.ts:3355/3402`teki `finalizedAt` `RollOperation.metadata` JSON'u ve audit `newData`sıdır, Roll kolonu DEĞİL). **Script:** `backfill_roll_production_timestamps.ts:176/187` ham SQL, `IS NULL` guard'lı (çift yazım değil, tamamlama) | Şemada `@db.Timestamptz`, `@default(dbgenerated())` **YOK** (schema.prisma:1674/1688) — Prisma create'te alan gönderilmezse trigger doldurur; `createMany`/`create` ile açık `finalizedAt: null` gönderen site **0** |
| `rolls.statusChangedAt` | aynı trigger (INSERT: NULL ise now(); UPDATE: status değişince her geçişte) | aynı | 0 (yalnız backfill) | — |
| `system_logs` / `system_log_archives` (UPDATE/DELETE/TRUNCATE ENGELİ) | trigger'lar `system_logs_block_tamper` / `system_log_archives_block_tamper` (migration.sql:61/:65) → fonksiyon `audit_block_tamper()` (:46), statement-level (BEFORE UPDATE OR DELETE OR TRUNCATE … FOR EACH STATEMENT); yalnız `teks.audit_guard='on'` iken; `teks.audit_purge='on'` (SET LOCAL) meşru istisna | `20260819161000_audit_tamper_guard` (saha: finished 2026-08-24) | Meşru yol: audit.service.ts:233 SET LOCAL → :261 `systemLog.deleteMany` (aynı tx). Guard AÇIKKEN kırılacak yollar: scriptlerin `SystemLog.deleteMany` (demo_kursun_planlama, fixture-manual-move ×3, seed-tambur-test-roll, smoke_fason_http), `reset-operational.ts` TRUNCATE. **INSERT serbest** → `bench_audit_summary.ts:141` sentetik satır ekleyebilir | `teks.audit_guard` DB-düzeyi ayarı restore edilen kopyada doğrulanamadı (pg_db_role_setting sorgusu hatalı kuruldu; kapsam dışı) |
| `*Fold` GENERATED ALWAYS … STORED (33 kolon, 20 tablo; `tr_fold(text)`) | PostgreSQL generated column | `20260819060000_search_fold` + sonraki migration'lar | **0** — uygulama `nameFold` yazmıyor (yalnız `where/select`: duplicate-detection.service.ts:124/145); şemada `@default(dbgenerated())` (schema.prisma:630/727/776/911) | `normalize-names.ts` `name` yazınca fold otomatik tazelenir |
| `colors_nameFoldColor_key` (ifade indeksi, `tr_fold_color(name)`) | index (kolon değil) | `20260825120000_color_name_unique_live` | — | yumuşak kapı (mükerrer varsa atlanır) |
| `createdAt` DEFAULT CURRENT_TIMESTAMP | DB default | tüm tablolar | Uygulama kopya yollarında açık yazar: audit.service.ts:251 (`SystemLogArchive.createdAt = log.createdAt`, :257 `updatedAt = log.createdAt`), installation-identity.job.ts:139 (JSON içi) | — |
| `updatedAt` (`@updatedAt`, **client-side**, DB default YOK) | Prisma client (delegate yolunda) | — | **Açık "touch" yazımları (satır kilidi/claim amaçlı):** tambur.service.ts:1824 (Roll, `status+currentStepId` koşullu claim), workorder.service.ts:4298 (`archiveClaim`) · :5257, helpers/workorder-locks.helper.ts:56 `touchWorkOrderTx`, helpers/shipment-locks.helper.ts:71/90 `touchWarehouseSackTx`/`touchShipmentPlannedTx`. **Ham SQL UPDATE'ler `updatedAt`'i ATLAR:** roll_movements ×13, work_order_steps.priority, rolls.labelDirty (merge), sacks.labelDirty (merge), 44 MOVE kuralı (29 hedef tablo) | CLAUDE.md 2026-07-30: envanter sekmeleri `updatedAt desc` sıralı + "Son İşlem" kolonu — ham yollar bu kolona görünmez (H5) |

**Prod kopyası ölçümü (tekserp_saha_0825, salt-okunur):** `finalizedAt` doluluk — WAREHOUSE 247/250, SHIPPED 689/689, CANCELLED 91/230, TAMBUR_CONSUMED 4/116, AT_SUBCONTRACTOR 3/188, IN_PRODUCTION 1/37, **SCRAP 0/1**, STOCK 0/283, SUBCONTRACTOR_CONSUMED 0/637. Damgasız 4 satır (3 WAREHOUSE + 1 SCRAP) hepsi `createdAt=2026-08-08`, `statusChangedAt` de NULL → trigger öncesi doğmuş, backfill'in "kapsam dışı" bıraktığı satırlar [VARSAYIM: backfill'in `trulyOrphan` listesi]. ⚠️ Trigger kaynak listesinde `WAREHOUSE→SCRAP` (fire ucu `POST /rolls/:id/scrap` → `inventory.softDelete` SCRAP modu, inventory.service.ts:3253; `fix_fire_rolls_to_scrap.ts:168`) **damga TAZELEMEZ** — eski `finalizedAt` kalır (tasarım gereği "üretim çıkışı" listesi; fire raporu sapma defterinden okuyor mu → H9).

---

## 5. SİLME (delete / deleteMany) ENVANTERİ — CLAUDE.md "bilinçli istisna" listesiyle karşılaştırma

CLAUDE.md istisnaları: (a) bağımlılık-guard'lı master-data `DELETE /:id/permanent`, (b) boş çuval silme, (c) cihaz unpair, (d) pivot replace. Toplam delegate `delete/deleteMany` site: **167** (src **74**, script/seed **93** — `writes2.tsv` yeniden sayımı; ayrıca src'de 1 nested `deleteMany`: `route.adapter.ts:296`, §5c).

### 5a. `src/` içindeki 74 delegate sitesi (+1 nested, §5c) — sınıflandırma

| Sınıf | Model (site) | Yer (`dosya:satır` — fonksiyon) | İstisna listesiyle eşleşme |
|---|---|---|---|
| (a) `/:id/permanent` guard'lı hard delete | Station, Machine(+deleteMany), WorkSession(deleteMany ×2), Route, RouteStep, ProductRecipe, ProductRecipeProperty, DefectType | helpers/guarded-hard-remove.ts:183/186/187/217/218/267/268/326/327/351 (`makeGuardedHardRemove`; count-guard + audit :78) | **Eşleşir** (a) |
| (a) BaseService generic `hardDelete` (`this.delegate.delete`, P2003→409) | Item, Order, PeripheralDevice, Customer (route'ta `controller.hardRemove`) + label-template/inventory/workorder kendi `hardDelete`leri | base.service.ts:1270; item.routes.ts:266, order.routes.ts:928, peripheral.routes.ts:119, customer.routes.ts:220 | **Eşleşir** (a) — guard DB FK'sı (P2003) ile |
| (a) Device hard delete | Device (device.service.ts:342 `hardDelete`, çevre birimi bağı guard'lı, audit var) | device.routes.ts:115 `/:id/permanent` (`admin:settings`) | **Eşleşir** (a)/(c) |
| (b) boş çuval | Sack (shipping.service.ts:1017 `removeSack`; dolu çuval 409) | — | **Eşleşir** (b) |
| (c) cihaz unpair / donanım değişimi | DevicePeripheral.deleteMany (device.service.ts:264 `assignHardware`, **havuz**, `Promise.all`?) | — | **Eşleşir** (c) |
| (d) pivot / küme replace (`deleteMany` + `createMany`/`upsert`) | ItemAllowedColor/Property (item.service.ts:257/258/455/463), StationProperty (fabric-property.service.ts:383, station-capability.service.ts:380), StationColor (:369), RollProperty (inventory:3947 FLAG-evreni, subcontractor:4842/5376, tambur:1208, workorder:5700), LabelContextDefault (label-template:447/976), PeripheralTemplateRoute (label-template:580, peripheral:253 havuz), CustomerTemplateRoute (customer-template-route:58 havuz, label-template:583), CustomerStandaloneLabel (:86), SubcontractorToCategory (:540/:669), UserPermission (permission-management:310/393), PermissionTemplateItem (:905), WorkOrderTargetProperty (workorder:5503/5674), WorkOrderToOrderLine (workorder:5502 `replace`; order:493/2814/3219; workorder-link:454 `unlinkOrderLine` tekil), OrderLineRequiredProperty (order:2487), SubcontractorReceiptProperty (subcontractor:4973/5459), ShipmentOrder (shipping:1290 `setShipmentOrdersTx`), SackAllocation (shipping:1345/1976), CustomerColorAlias.deleteMany (color.service:322 `syncCustomerAssignments`) | — | **Eşleşir** (d) |
| Alias / satır silme (istisna listesinde YOK, tekil master-data alt kaydı) | CustomerItemAlias.delete (customer-alias.service.ts:94, havuz), CustomerColorAlias.delete (:198, havuz), LabelTemplateVariant.delete (label-template.service.ts:886 `deleteVariant`, havuz; birincil-varyant guard), PermissionTemplate.delete (permission-management.service.ts:951 `deleteTemplate` — yalnız `code===null` kullanıcı rolü; sistem rolü pasifleşir), DuplicateReview.delete (duplicate-review.service.ts:151 `reopen`, MERGED ise 409) | hepsi audit yazıyor | Listede yok — ② "soft delete kuralı" kapsamına girer mi karar |
| **Operasyon kaydı hard delete (log/pivot değil)** | **Batch.delete** (batch.service.ts:337 `deleteIfEmptyAndTraceless` — boş + izsiz parti) · **WorkOrderStep.delete** (workorder.service.ts:5411 `replace` — refCount=0 guard) · **OrderLine.deleteMany** (order.service.ts:2447 `update` — `FOR UPDATE` :2434 + iş emri bağı guard) | tx içi | Listede yok — H12 |
| Log tablosu satır silme (geri alma / iptal yolları) | RollMovement.deleteMany ×4 (kursun-qc:1097 `reopenStep`; subcontractor:4835 `cancelReceipt`, :5373 `undoTransfer`; workorder-manual-move:643 — CLAUDE.md "hayalet movement'lar silinir") · RollOperation.deleteMany ×7 (subcontractor:2086 `cancel`, :4964 `cancelReceipt`, :5366/:5452 `undoTransfer`; tambur-undo:1353 `applySingleRestore`, :1597 `applyFull`; workorder-manual-move:667) · **RollError.deleteMany** (kursun-qc.service.ts:720 `deleteError`, **havuz**, `isProcessed:false` claim) | çoğu tx; RollError havuz | Listede yok; karar notlarında (manuel taşıma, Tambur geri alma) gerekçeli — H11 |
| Sistem/ops temizliği | SystemLog.deleteMany (audit.service.ts:261 `archiveOlderThan` — arşive kopya sonrası, `SET LOCAL audit_purge`) · Session.deleteMany (session-registry.service.ts:170 `purgeDeadSessions`, havuz) · EndpointLatencyDaily.deleteMany (latency-persist.service.ts:172 retention, havuz) | — | Arşiv/retention — soft-delete kuralının konusu değil |

### 5b. Script/seed silmeleri (93 site: seed-shipping-scenario 18 · smoke_fason_http 15 · seed-tambur-test-roll 13 · clean_test_residue 12 · demo_kursun_planlama 12 · fixture-manual-move 11 · seed-demo-stations 10 · seed-test-full 2) — özet
`clean_test_residue.ts` (11 model), `reset-operational.ts` (TRUNCATE 30+ tablo), demo/fixture/smoke scriptleri (kendi ürettiklerini temizler: Roll/WorkOrder/Batch/Movement/Operation/Property/TravelerCard(+Scan)/SystemLog/…), `seed-demo-stations.ts`/`seed-shipping-scenario.ts` (senaryo sıfırlama deleteMany ×10/×15), `seed-test-full.ts` (ItemAllowed* replace). Hiçbiri CLAUDE.md istisnasına girmez; prod kapısı yok (§3c).

### 5c. Nested / dolaylı silmeler (delegate `delete` görünmez)
- `route.adapter.ts:296` `steps: { deleteMany: {}, create }` → `routeService.update` → BaseService `delegate.update` (RouteStep toplu silme, import yolunda).
- FK `onDelete: Cascade` (42 ilişki) — hard delete'lerde çocuk satırlar DB tarafından silinir (Roll `/:id/permanent` → RollProperty/Movement/Operation?) — kapsam K2a.
- Merge `resolveConflictTx` `DELETE FROM "<tablo>"` (5 site) — çakışan pivot/alias satırları.

---

## HOTSPOTLAR (② denetçileri için — öncelik sırasıyla; hepsi "bak", yargı değil)

| # | Yer | Neden bakılmalı (harita gözlemi) | Hangi ② hücresi |
|---|---|---|---|
| **H1** | `src/services/subcontractor.service.ts:1108, 2118, 2128, 2959, 3474, 6175, 6199` | `WorkOrderStep.status` fason servisinden 7 sitede **doğrudan** yazılıyor (ACTIVE/COMPLETED/PENDING/SKIPPED) — sahip helper `recomputeStepStatus` (`helpers/roll-step.helper.ts:145`) aynı dosyada 5 kez de çağrılıyor. §7.2 üç koşul: alan enum ✔, yazan sahip değil ✔, guard aynı mı → ② doğrular (örn. :2118 "geçmişte kabul var → COMPLETED" ile recompute'un türettiği durum çelişebilir mi) | mimari (bounded context) |
| **H2** | `src/services/order.service.ts:3242 cancelWithActions` (+ :3210 `type`, :2814/:3219 `workOrderToOrderLine.deleteMany`) | Sipariş servisi iş emrinin durum makinesine (`WorkOrder.status` CANCELLED/COMPLETED) yazıyor; iptal gövdesi `workorder.service.softDelete`'ta (3387 + ham movement kapanışı :3531 + adım SKIPPED :3547 + kart VOID) — order tarafı aynı adımları mı tekrarlıyor, `xTx()` mı çağırıyor? | mimari |
| **H3** | `kursun-qc.service.ts:1144`, `tambur-manual.service.ts:1194`, `tambur-undo.service.ts:1378/1669`, `workorder-manual-move.service.ts:816`, `workorder-split.service.ts:394`, `workorder.service.ts:6100` | `WorkOrder.status→IN_PROGRESS` 7 sitede doğrudan `updateMany`; kanonik `ensureWorkOrderInProgress` (`roll-step.helper.ts:180`, "yalnız PLANNED'ı diriltir" — CLAUDE.md manuel taşıma notu) dururken COMPLETED→IN_PROGRESS diriltmesi farklı `where` koşullarıyla dağınık. Terminal guard (CANCELLED/SUPERSEDED asla dirilmez — `completeWorkOrderIfStepsDone`) her sitede var mı? | mimari + eşzamanlılık (claim `where`) |
| **H4** | RollMovement kapanışı: 13 ham SQL (§1b) + 9 Prisma `exitedAt: new Date()` (`workorder-manual-move:649`, `tambur:1180/3332`, `inventory:3237/3589/4410/4768`, `workorder-split:369/486`) | Aynı "hareketi kapat" işi iki mekanizma, `qtyOut` kuralı yere göre farklı (`qtyIn` / `currentQty` / `COALESCE(qtyOut,NULLIF(qtyIn,0),currentQty)` / `0` storno) ve durum `notes` marker metniyle taşınıyor (`QC2_STEP_FINISHED:<uuid>` `finishStep` :888 ↔ reopen :1097 bunu okuyor). OCP/tek kaynak ve "raw UPDATE `updatedAt`'i atlar" | mimari + veri-doğruluk |
| **H5** | Ham SQL yazımlarının tamamı (§3f) + `information_schema`: `updatedAt` DB default YOK | `@updatedAt` client-side: ham yollar (`rolls.labelDirty` merge :921/:938, `sacks.labelDirty` :928, `work_order_steps.priority` :1665, 44 MOVE kuralı, roll_movements ×13) `updatedAt`'i tazelemez. CLAUDE.md 2026-07-30: Bitmiş Depo `updatedAt desc` + "Son İşlem" kolonu → merge sonrası etiket-bayat işareti listede görünmez [VARSAYIM: etki yalnız sıralama/görüntü] | veri-doğruluk (K-rapor/K2'ye devret) |
| **H6** | Havuz client'ıyla domain-durum yazımları: `inventory.service.ts:3452 restoreCancelledRoll`, `:4033 prepareRawForSale`, `workorder.service.ts:3281 prepareFasonCancelDecision` (Roll→IN_PRODUCTION, **koşulsuz** `where:{id in}`), `:6100 lockWorkOrder`, `workorder-link.service.ts:564/632`, `kartela.service.ts:1204/1226`, `kursun-qc.service.ts:634 reportError`/`:720 deleteError`/`:1697 setQueueUrgent`, `order.service.ts:2694`, `traveler-card.service.ts:499 voidCard`/`:608 scan`, `return.service.ts:998`, `shipping.service.ts:1610/1635/1669/1712/1723`, `printed-document.service.ts:387 getCurrent` (lazy-init create), `workorder.service.ts:6552 createManifest` (`nextDailySeq` + havuz create) | 114 havuz sitesinden domain olanlar; çoğu atomik claim (`updateMany`+count) ama bazıları çok-adımlı akışın ortasında tx dışı (3452 sonrası adım recompute var mı; 3281 claim'siz; 6552 sayaç yarışı `withBarcodeRetry` ile mi) — K-eşzamanlılık ajanına liste | eşzamanlılık |
| **H7** | `src/jobs/reason-preset-catalog.job.ts:57`, `role-template-catalog.job.ts:118/147/172`, `permission-catalog.job.ts:94`, SystemSetting upsert ×3 (§3b) | Job'lar servis katmanını atlıyor: reason-preset job'unda **audit yok** ve `ReasonPresetService.create`'in kod/legacyTexts kuralları atlanıyor olabilir; SystemSetting yazımları `system-setting.service.set` sanitize/4-kapı dışından (anahtarlar job-özel — dört kapıya girmiyorsa sorun yok, ② doğrular) | mimari (katman) + audit |
| **H8** | `scripts/reset-operational.ts:20` (TRUNCATE, kapı yok), `scripts/clean_test_residue.ts` (--apply var, DB-adı kapısı yok), `scripts/bench_audit_summary.ts:141` (system_logs'a sentetik INSERT), `scripts/fixture-sack-constraint.ts:49/65` (ALTER TABLE), 4 backfill/normalize scriptinde audit izi yok; `productionDbGate` yalnız `run-all-tests.ts` | CLAUDE.md "toplu DELETE yasak / dry-run varsayılan / --apply öncesi listele" kuralına karşı script envanteri; prod DATABASE_URL ile çalıştırılma riski (ops) | ops / süreç |
| **H9** | Trigger kaynak listesi `20260809090000…migration.sql:73-80` ↔ `inventory.service.ts:3253 softDelete` (SCRAP modu, `POST /rolls/:id/scrap`) ve `scripts/fix_fire_rolls_to_scrap.ts:168` | `WAREHOUSE→SCRAP` geçişi `finalizedAt`'i tazelemez (OLD kaynak listesinde yok); saha kopyasında SCRAP 0/1 damgalı. Fire raporu/kalite karnesi `finalizedAt` mı `RollVariance` mı okuyor → çift kaynak riski; ayrıca 4 damgasız 2026-08-08 satırı (backfill kapsam dışı) | rapor-doğruluk (K-rapor) |
| **H10** | Roll "önceki statü" kolonları: `preShipStatus` (shipping:1862/2197), `preCancelStatus` (inventory:3253/3452, roll-disposition:275 + `resolveRestoreTargetStatus` roll-cancel-restore.helper), `preTamburCloseStatus` (tambur:2581, tambur-undo:1330/1563) | Üç geri-alma yolu üç ayrı kolon ve üç ayrı serviste; bir topun aynı anda birden fazla "önceki" taşıması (iade edilen ve iptal edilen) — geri alma sıralaması/çakışması ② | veri-doğruluk + eşzamanlılık |
| **H11** | `RollOperation.deleteMany` ×7, `RollMovement.deleteMany` ×4, `RollError.deleteMany` (kursun-qc:720 havuz) | Append-only log tablolarında hard delete; `reports/production.report.service.ts:109` RollOperation sayıyor (tambur-undo:1597 yorumu bunu bilerek siliyor). Soft-delete kuralı istisna listesinde yok; audit satırı yazılıyor mu her sitede? | mimari (kural) + audit |
| **H12** | `batch.service.ts:337 deleteIfEmptyAndTraceless` (Batch.delete), `workorder.service.ts:5411 replace` (WorkOrderStep.delete), `order.service.ts:2447 update` (OrderLine.deleteMany) | Operasyon nesnelerinde hard delete, CLAUDE.md istisna listesinde yok (guard'lı: boşluk/refCount/FOR UPDATE). Karar: istisna listesine mi eklenmeli, soft'a mı çevrilmeli | mimari (kural) |
| **H13** | `label.service.ts:1391 updateOrderLineCustomerNames` (OrderLine, havuz), `helpers/order-status.helper.ts` (`touchOrderLinesTx` shipping/subcontractor'dan), `color.service.ts:322 syncCustomerAssignments` (CustomerColorAlias) | Etiket servisi sipariş satırına yazıyor (müşteri adı override'ı) — sınır sızıntısı adayı; guard (order kilitli/iptal?) var mı | mimari |
| **H14** | `master-data-merge.service.ts:629/841/848/866/880/892/921/928/938` (`$executeRawUnsafe`, 44 kural, tablo/kolon adı interpolasyonu `merge-map.ts`ten) | Tek tx + advisory lock (:546) içinde 44 tablo dokunuşu (tx bütçesi 20 s), RESTRICT FK'lı tablolar, audit "MERGED" hook best-effort; allowlist dışı ad üretilemez mi (Zod?) | eşzamanlılık (bütçe) + güvenlik (interpolasyon) |
| **H15** | `helpers/roll-barcode.helper.ts:82 reserveRollBarcodes` (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) — çağıranlar inventory/tambur/subcontractor/workorder-batch-drop | Prisma modeli `RollBarcodeCounter` delegate ile hiç yazılmıyor; satır kilidi tx sonuna kadar tutulur (§5 sayaç kilidi: tx'in NERESİNDE çağrılıyor — gövde başında mı sonunda mı) | eşzamanlılık (sayaç kilidi) |
| **H16** | `db-copy.service.ts:288 writeCopyRecords` (SystemSetting JSON blob oku-değiştir-yaz, havuz) · `:320/:500/:619/:716` CREATE/DROP/ALTER DATABASE (pg admin client) · `helpers/db-swap-command.helper.ts:77` | Uygulama içinden DDL + JSON kolonda RMW (§3.3 lost update; tek yazar mı → `db-copy` dışında `COPIES_SETTING_KEY` yazan var mı 0) | eşzamanlılık + ops |
| **H17** | `StationColor` (station-capability.service.ts:369 deleteMany + createMany) | CLAUDE.md 2026-08-02: tablo **deprecated**, "okuyan kod yok" — yazan kod DURUYOR (`setCapabilities`, `colorIds` açıkça gönderilirse). Ölü yazma yolu | mimari (ölü kod) |
| **H18** | `permission-management.service.ts:484 createUser` (User + nested UserPermission, havuz) · `:1012/1019 applyTemplate` (havuz `createMany` + `update`) | Yetki atama çok adımlı ve tx dışı — kısmi durum (kullanıcı var, izin yok) | eşzamanlılık + güvenlik (izin) |

---

## SINIR ÖTESİ NOTLAR

- **K-eşzamanlılık (tx/kilit/claim):** §1a "havuz N" sütunu ve H6 listesi tx-dışı yazma envanteridir (114 site; `agg.mjs pool` çıktısı scratchpad'de). `roll-barcode.helper.ts:82` sayaç kilidi, `batch.service.ts:126` (8022), `inventory.service.ts:844` (8021), `master-data-merge.service.ts:546`, `code-unique.helper.ts:81`, `shipment-locks.helper.ts:58`, `session-registry.service.ts:79`, `permission-management.service.ts:609` advisory lock siteleri; `order.service.ts:2434 FOR UPDATE`. `device.service.ts:264` `Promise.all` içinde deleteMany+createMany (havuz — ayrı bağlantılar, tx değil). `db-copy.service.ts:288` JSON RMW.
- **K-guard/route:** 12 adet `/:id/permanent` ucu (§5a) ve route→helper (`guarded-hard-remove`) doğrudan çağrısı; `customer-branch-list.routes.ts` BaseService örnekliyor ama yazma ucu mount etmiyor (salt-okuma). `inventory.routes.ts:668 POST /:id/scrap` → `inventory.softDelete` SCRAP modu (`roll:manual-adjust`).
- **K-audit:** Job'lardan `reason-preset-catalog.job.ts` audit yazmıyor; 4 backfill/normalize scripti + sync-* + seed'ler audit yazmıyor; ham SQL sitelerinden `kursun-qc:1665` audit yazıyor, merge MOVE'lar için audit `merge()` düzeyinde [VARSAYIM]. `bench_audit_summary.ts` system_logs'a sentetik satır ekler (guard INSERT'i engellemez).
- **K2 (şema):** `RollBarcodeCounter` ve `RouteStepProperty` delegate ile yazılmıyor (ham SQL / 2. seviye nested); `StationColor` deprecated ama yazılıyor; `updatedAt` DB default yok (ham yollar bayat bırakır); `finalizedAt/statusChangedAt` `@default(dbgenerated())` işaretsiz; 33 generated `*Fold` kolon; saha kopyasında dev'e göre eksik 5 migration (`20260825140000_reason_preset_rework_kind`, `20260826120000_orders_active_created_at_idx`, `20260826130000_reason_preset_order_cancel_kind`, `20260826130100_order_cancel_reason`, `20260827100000_order_line_cancel`) → `OrderLine.cancelledAt`/`Order.cancelReason` yazan yollar (`order.service.ts:493 cancelOrderLine`) prod'da henüz yok.
- **K-rapor:** `production.report.service.ts:109` RollOperation sayımı ↔ 7 deleteMany sitesi; `finalizedAt` kaynak listesi ↔ SCRAP (H9); `quality-scorecard.report.service.ts:327` `finalizedAt: null` süzgeci.
- **K-ops/deploy:** `reset-operational.ts` ve `clean_test_residue.ts` kapısız; `fixture-sack-constraint.ts` prod şemasına ALTER TABLE koşabilir; `db-copy.service` DDL yolu; `teks.audit_guard` DB-düzeyi ayarının prod'da açık olup olmadığı (`ALTER DATABASE … SET`) kopyadan doğrulanamaz.
- **K-mobil/Electron (kapsam dışı):** istemci yazma yolları taranmadı; `mobil/CLAUDE.md` yazıcı kuyruğu vb. bu haritada yok.

## KAPSANMAYAN / ERİŞİLEMEYEN

1. **Değişkenle kurulan `data` gövdeleri** (`data: payload`, `data`nın önce nesneye toplanıp sonra geçirilmesi) — durum-alanı ve nested-yazma tespiti bunları görmez; örn. `applyRollDispositionsTx`'in `status: target` yakalandı ama başka değişken-gövde siteleri kaçmış olabilir. Yazma SİTESİ ve MODEL sayımı bundan etkilenmez (delegate çağrısı yakalanır), yalnız "hangi alan" sütunu eksik kalabilir. Ölçüm: literal grep çapraz kontrolü (`status: RollStatus.X` 100+ vuruş — `where` dahil) ile data-düzeyi tespit (57 Roll sitesi) tutarlı.
2. **`this.delegate` generic yazımları** model bazında route konfigürasyonundan elle eşlendi (§1b); BaseService `create/update`'in DMMF `sanitizeWriteData` ile hangi nested alanlara izin verdiği (relation write'ların sızıp sızmadığı) okunmadı — K-guard/K2.
3. **FK `onDelete: Cascade` ile DB'nin sildiği çocuk satırlar** (42 ilişki) delete envanterine dahil değil — K2a.
4. **`test_*.ts` scriptleri** brief gereği hariç (366 dosya; cleanup'larında yaygın `deleteMany`/`rollVariance.deleteMany` var).
5. **Canlı prod DB / `teks.audit_guard` GUC durumu** — yalnız 2026-08-25 kopyası; `pg_db_role_setting` sorgusu bu oturumda hatalı kuruldu (set-returning fn WHERE'de), tekrar denenmedi; DB-düzeyi ayar restore'da zaten taşınmaz.
6. **Electron / mobil istemci** yazma yolları (OTA, yazıcı kuyruğu, offline kuyruk) — brief kapsamı Teks-Erp backend.
7. **`search.service.ts:134 delegateOf`** dinamik delegate: yazma çağrısı grep'inde 0; derinlemesine okunmadı.
8. **Migration'lardaki `CREATE INDEX … WHERE`/partial unique** (davranışı yazma yolu değil, kısıt) — K2.
9. **`$executeRawUnsafe` tablo adlarının çalışma zamanı allowlist'i** — `merge-map.ts` statik olarak okundu (44 kural), servis içindeki doğrulama (Zod/`MergeEntity` union) okunmadı.
10. **Yazıcı/TCP, `pg_dump`, dosya sistemi yazımları** (backup dosyaları, mobil OTA manifest) — DB yazma yolu değil, haritaya alınmadı.
11. **Enclosing fonksiyon adları** indent-tabanlı sezgisel çözüldü (class metodu = 2 boşluk, top-level `function`/`const`); iç içe closure'larda yanılabilir — kritik siteler bağlam okunarak doğrulandı (H tablosundakiler), geri kalanı [VARSAYIM].
