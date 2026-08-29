# K2a — Şema Envanteri (`Teks-Erp/prisma/schema.prisma`)

**Aşama ① KEŞİF — haritalama, yargı yok.** Tarih 2026-08-28 · dal `adnansahin` HEAD `ce8681d1` · dosya 5372 satır · **91 model / 45 enum** (mekanik sayım: `grep -c '^model '` = 91, `grep -c '^enum '` = 45).

## 0. Yöntem, kaynaklar ve künye düzeltmeleri

| Konu | Değer | Kanıt |
|---|---|---|
| Ayrıştırma | Şema, scratchpad'e yazılan salt-okunur bir Node ayrıştırıcıyla (satır sonu `//` yorumları atılır, `///` doküman satırları atlanır) model başına çıkarıldı; her satır numarası **şemanın gerçek satırıdır** | `Teks-Erp/prisma/schema.prisma` |
| DB doğrulama | Yalnız `audit/tools/sql-saha.sh` (prod kopyası `tekserp_saha_0825`, **190/195 migration**) ve `audit/tools/sql-dev.sh` (`adnansahin_db`, 195/195). Her sorgu `default_transaction_read_only=on` ile koştu | brief §2 |
| Saha kopyasında OLMAYAN 5 migration | `20260825140000_reason_preset_rework_kind` · `20260826120000_orders_active_created_at_idx` · `20260826130000_reason_preset_order_cancel_kind` · `20260826130100_order_cancel_reason` · `20260827100000_order_line_cancel` → saha'da `Order.cancelledAt/cancelReason/cancelReasonCode`, `OrderLine.cancelledAt/cancelReason/cancelReasonCode/cancelledById`, `orders_active_createdAt_idx` ve `ReasonPresetKind.WORK_ORDER_REWORK/ORDER_CANCEL` **YOK** (`ReasonPresetKind` sayımı saha'da 6 kind gösterdi — enum değeri o kopyada `ALTER TYPE` ile gelmiş olmalı [VARSAYIM], kolonlar yok) | `_prisma_migrations` diff |
| **Künye düzeltmesi 1 — onDelete sayımı** | Künye "Cascade 42 · Restrict 14 · SetNull 3" diyor; bu `grep -o 'onDelete:'` sayımıdır ve **4 yorum satırını** da sayar (`schema.prisma:1143`, `:2481`, `:4963`, `:5043`). Gerçek `@relation(... onDelete:)` satırları: **Cascade 41 · Restrict 12 · SetNull 3** | `grep -nE '^\s*\w+\s+\w+\??\s+@relation\(.*onDelete'` |
| **Künye düzeltmesi 2 — varsayılanlar** | Şemada `onDelete` yazılmayan 224 FK Prisma varsayılanına düşer: FK zorunluysa **RESTRICT** (59), opsiyonelse **SET NULL** (165). Toplam beklenen: C 41 · R 71 · SN 168. DB (dev, 195 migration): `c=41 r=71 n=168 a=2` — **birebir**. Saha: `n=167` (eksik olan `order_lines.cancelledById`, uygulanmamış migration). `a=2` = iki DEFERRABLE bileşik FK (NO ACTION) | `pg_constraint.confdeltype` |
| Sayısal tipler | **Float 0** · **Decimal 48 alan — hepsinde `@db.Decimal(p,s)` var, varsayılan (65,30) hiç yok** (DB'de 48 `numeric` kolonun tamamı precision'lı) · **Json 25 alan / 18 model** | `grep -cE '^\s+\w+\s+Decimal'` = 48, `grep -v '@db.Decimal'` = 0; `information_schema.columns` |
| PK deseni | 85 modelde `id String @id @default(uuid()) @db.Uuid`; 5 modelde bileşik `@@id` (`PermissionTemplateItem`, `WorkOrderToOrderLine`, `SubcontractorToCategory`, `ShipmentOrder`, `RollBarcodeCounter`); 1 modelde doğal anahtar (`SystemSetting.key`) | tablo §1 |
| Zaman damgası konvansiyonu | 27 modelde `updatedAt` **YOK** (26'sı pivot/append-only, 1'i sayaç), 1 modelde `createdAt` da yok (`RollBarcodeCounter`); `SystemLogArchive.updatedAt` `@updatedAt` DEĞİL elle taşınır | §9 |
| Prisma izolasyon/relationMode | `relationMode` verilmemiş → gerçek FK'lar DB'de (künye ile uyumlu) | `schema.prisma:15-17` |

Aşağıdaki tablolarda **satır numaraları şemaya**, `dosya:satır` kanıtları repo köküne göredir.

## 1. Model haritası (91 model)

Sütun anahtarı: **PK** · **@unique / @@unique** (`?` = anahtarda NULL'lanabilir kolon → PG'de NULL≠NULL, tekillik o satırlarda fiilen çalışmaz) · **@@index** (adet) · **FK → hedef : onDelete** (`C` Cascade · `R` Restrict · `SN` SetNull · `*` = şemada yazılı değil, Prisma varsayılanı) · **Decimal(p,s)** · **Json** · **soft-delete/durum damgası** kolonları · **enum alanları** · **clientToken** · **createdAt/updatedAt** (`c/u` ikisi var · `u YOK` · `u(elle)`).

| # | Model → tablo (şema satırları) | PK | @unique · @@unique (? = NULL'lanabilir kolon) | @@index | FK → hedef : onDelete (C=Cascade R=Restrict SN=SetNull, * = Prisma varsayılanı, şemada yazılı değil) | Decimal (p,s) | Json | Soft-delete / durum damgası | Enum alanları | clientToken | createdAt/updatedAt |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **User** → `users` (353-504) | id uuid | `username` · `cardToken`? · `quickPin`? | 0 | createdById→User:SN*; updatedById→User:SN* | — | — | isActive, deletedAt | — | — | c/u |
| 2 | **UserPreference** → `user_preferences` (510-521) | id uuid | `userId` | 0 | userId→User:C | — | preferences | — | — | — | c/u |
| 3 | **Session** → `sessions` (535-553) | id uuid | `jti` | 1 | userId→User:R | — | — | revokedAt | deviceType:ClientType | — | c/u |
| 4 | **Permission** → `permissions` (558-575) | id uuid | `code` | 2 | — | — | — | — | category:PermissionCategory | — | c/u |
| 5 | **UserPermission** → `user_permissions` (582-601) | id uuid | `@@[userId,permissionId]` | 1 | userId→User:C; permissionId→Permission:C; grantedById→User:SN* | — | — | — | — | — | c/u |
| 6 | **PermissionTemplate** → `permission_templates` (607-640) | id uuid | `code`? · `name` | 1 | createdById→User:SN*; updatedById→User:SN* | — | — | isActive | — | — | c/u |
| 7 | **PermissionTemplateItem** → `permission_template_items` (642-654) | @@id([templateId, permissionId]) | — | 1 | templateId→PermissionTemplate:C; permissionId→Permission:C | — | — | — | — | — | c/u YOK |
| 8 | **Station** → `stations` (660-746) | id uuid | `code` | 4 | defaultCategoryId→SubcontractorCategory:SN*; createdById→User:SN*; updatedById→User:SN* | — | — | isActive | type:StationType, kind:StationKind | — | c/u |
| 9 | **Machine** → `machines` (748-793) | id uuid | `code` | 2 | stationId→Station:R*; createdById→User:SN*; updatedById→User:SN* | — | — | isActive | — | — | c/u |
| 10 | **Device** → `devices` (800-824) | id uuid | `deviceId` | 2 | machineId→Machine:SN* | — | — | isActive | status:DeviceStatus, kind:DeviceKind | — | c/u |
| 11 | **PeripheralDevice** → `peripheral_devices` (842-941) | id uuid | `code` | 7 | machineId→Machine:SN; deviceId→Device:SN; stationId→Station:SN; createdById→User:SN*; updatedById→User:SN* | scale?(10,4), labelWidthMm?(6,2), labelHeightMm?(6,2), labelGapMm?(5,2) | — | isActive, deletedAt | kind:PeripheralKind, connectionType:ConnectionType, readMode:PeripheralReadMode, languageOverride:PrinterLanguage?, mediaType:PrinterMediaType? | — | c/u |
| 12 | **DevicePeripheral** → `device_peripherals` (947-958) | id uuid | `@@[deviceId,peripheralId]` | 1 | deviceId→Device:C; peripheralId→PeripheralDevice:C | — | — | — | — | — | c/u YOK |
| 13 | **PeripheralTemplateRoute** → `peripheral_template_routes` (962-976) | id uuid | `@@[peripheralId,kind]` | 1 | peripheralId→PeripheralDevice:C; templateId→LabelTemplate:R | — | — | — | kind:LabelKind | — | c/u |
| 14 | **WorkSession** → `work_sessions` (1001-1039) | id uuid | — | 5 | userId→User:R*; deviceId→Device:R*; machineId→Machine:R; stationId→Station:R* | — | — | endedAt | endReason:WorkSessionEndReason? | — | c/u |
| 15 | **Route** → `routes` (1041-1083) | id uuid | `code`? | 3 | customerId→Customer:SN*; createdById→User:SN*; updatedById→User:SN* | — | — | isActive | — | — | c/u |
| 16 | **RouteStep** → `route_steps` (1085-1137) | id uuid | `@@[routeId,sequence]` | 4 | routeId→Route:C; stationId→Station:R*; requiredCategoryId→SubcontractorCategory:SN*; plannedSubcontractorId→Subcontractor:SN*; plannedColorId→Color:SN* | — | — | — | — | — | c/u |
| 17 | **RouteStepProperty** → `route_step_properties` (1146-1159) | id uuid | `@@[routeStepId,propertyId]` | 1 | routeStepId→RouteStep:C; propertyId→FabricProperty:R* | — | — | — | — | — | c/u YOK |
| 18 | **ProductRecipe** → `product_recipes` (1165-1210) | id uuid | `code` | 4 | itemId→Item:R*; colorId→Color:SN*; routeId→Route:SN*; createdById→User:SN*; updatedById→User:SN* | width?(12,3) | — | isActive | — | — | c/u |
| 19 | **ProductRecipeProperty** → `product_recipe_properties` (1214-1227) | id uuid | `@@[recipeId,propertyId]` | 1 | recipeId→ProductRecipe:C; propertyId→FabricProperty:R* | — | — | — | — | — | c/u YOK |
| 20 | **Item** → `items` (1237-1319) | id uuid | `code` · `@@[nameFold]`?(nameFold) | 4 | createdById→User:SN*; updatedById→User:SN*; mergedIntoId→Item:SN*; mergedById→User:SN* | — | — | isActive, mergedIntoId | itemType:ItemType, unit:ItemUnit | — | c/u |
| 21 | **Roll** → `rolls` (1321-1792) | id uuid | `barcode`? · `clientToken`? | 21 | itemId→Item:R*; colorId→Color:SN*; qualityGradeId→QualityGrade:SN*; parentRollId→Roll:SN*; directShipmentId→DirectShipment:SN*; parentReceiptId→SubcontractorReceipt:SN*; currentStepId→WorkOrderStep:SN*; producedInStepId→WorkOrderStep:SN*; createdById→User:SN*; cancelledById→User:SN*; createdMachineId→Machine:SN*; entryStationId→Station:SN*; labelCustomerId→Customer:SN*; shipmentId→Shipment:SN*; sackId→Sack:SN*; batchId→Batch:SN* | initialQty(12,3), currentQty(12,3), weightKg?(12,3), width?(12,3), preTamburCloseQty?(12,3) | lastLabelSnapshot? | cancelledAt | status:RollStatus, preShipStatus:RollStatus?, form:RollForm, entrySource:RollEntrySource, preCancelStatus:RollStatus?, preTamburCloseStatus:RollStatus? | VAR (unique, null) | c/u |
| 22 | **Customer** → `customers` (1798-1891) | id uuid | `code` · `@@[nameFold]`?(nameFold) | 5 | documentProfileId→DocumentProfile:SN*; createdById→User:SN*; updatedById→User:SN*; mergedIntoId→Customer:SN*; mergedById→User:SN* | — | — | isActive, mergedIntoId | type:CompanyType | — | c/u |
| 23 | **CustomerBranch** → `customer_branches` (1899-1957) | id uuid | `@@[customerId,code]`?(code) | 3 | customerId→Customer:C; createdById→User:SN*; updatedById→User:SN* | — | — | isActive | — | — | c/u |
| 24 | **Order** → `orders` (1959-2040) | id uuid | `orderNumber` · `clientToken`? | 7 | customerId→Customer:R*; branchId→CustomerBranch:SN*; manualClosedById→User:SN*; createdById→User:SN*; updatedById→User:SN* | totalAmount?(14,2), shippedQty(12,3) | — | cancelledAt, completedAt | currency:Currency, status:OrderStatus | VAR (unique, null) | c/u |
| 25 | **OrderLine** → `order_lines` (2046-2127) | id uuid | — | 6 | orderId→Order:C; cancelledById→User:SN*; itemId→Item:R*; colorId→Color:SN* | quantity(12,3), shippedQty(12,3), unitPrice?(12,2), width?(12,3), pieceLengthM?(12,3) | — | cancelledAt | — | — | c/u |
| 26 | **OrderLineRequiredProperty** → `order_line_required_properties` (2131-2144) | id uuid | `@@[orderLineId,propertyId]` | 1 | orderLineId→OrderLine:C; propertyId→FabricProperty:R* | — | — | — | — | — | c/u YOK |
| 27 | **WorkOrder** → `work_orders` (2150-2255) | id uuid | `workOrderNumber` · `clientToken`? | 8 | routeTemplateId→Route:SN*; targetItemId→Item:SN*; targetColorId→Color:SN*; splitFromId→WorkOrder:SN*; cancelledById→User:SN*; createdById→User:SN*; updatedById→User:SN* | width?(12,3), targetQuantity?(12,3), targetWeight?(12,3) | parameters? | isActive, cancelledAt | type:WorkOrderType, status:WorkOrderStatus | VAR (unique, null) | c/u |
| 28 | **Batch** → `batches` (2260-2316) | id uuid | — | 5 | workOrderId→WorkOrder:R*; splitFromId→Batch:SN*; mergedIntoId→Batch:SN*; createdById→User:SN*; updatedById→User:SN* | — | — | mergedIntoId | — | — | c/u |
| 29 | **WorkOrderStep** → `work_order_steps` (2318-2396) | id uuid | `@@[workOrderId,stepSequence]` | 4 | workOrderId→WorkOrder:R*; stationId→Station:R*; requiredCategoryId→SubcontractorCategory:SN*; plannedSubcontractorId→Subcontractor:SN* | — | stepData? | completedAt | status:StepStatus | — | c/u |
| 30 | **KursunBypassAssignment** → `kursun_bypass_assignments` (2454-2497) | id uuid | — | 3 | workOrderId→WorkOrder:R*; workOrderStepId→WorkOrderStep:R*; machineId→Machine:R*; assignedById→User:R*; completedById→User:R; cancelledById→User:R | — | — | completedAt, cancelledAt | completedVia:KursunBypassCompletionSource? | — | c/u |
| 31 | **WorkOrderToOrderLine** → `work_order_to_order_lines` (2501-2515) | @@id([workOrderId, orderLineId]) | — | 1 | workOrderId→WorkOrder:R*; orderLineId→OrderLine:C | allocatedQty(12,3) | — | — | — | — | c/u |
| 32 | **QualityGrade** → `quality_grades` (2524-2604) | id uuid | `code` | 3 | createdById→User:SN*; updatedById→User:SN* | — | — | isActive | targetStatus:RollStatus, returnTargetStatus:RollStatus? | — | c/u |
| 33 | **ReturnReason** → `return_reasons` (2609-2655) | id uuid | `code` | 3 | createdById→User:SN*; updatedById→User:SN* | — | — | isActive | — | — | c/u |
| 34 | **DefectType** → `defect_types` (2659-2703) | id uuid | `code` | 3 | createdById→User:SN*; updatedById→User:SN* | — | — | isActive | severity:DefectSeverity? | — | c/u |
| 35 | **RollBarcodeCounter** → `roll_barcode_counters` (2709-2716) | @@id([day, type]) | — | 0 | — | — | — | — | — | — | c YOK/u YOK |
| 36 | **RollError** → `roll_errors` (2725-2778) | id uuid | `@@[rollId,startMeter,defectTypeId]`?(defectTypeId) | 9 | rollId→Roll:R*; defectTypeId→DefectType:SN*; detectedAtStepId→WorkOrderStep:SN*; processedAtStepId→WorkOrderStep:SN*; detectedByUserId→User:SN*; processedByUserId→User:SN* | startMeter(12,3) | — | — | actionTaken:RollErrorAction? | — | c/u |
| 37 | **RollOperation** → `roll_operations` (2783-2819) | id uuid | `@@[rollId,workOrderStepId,operationType]` | 6 | rollId→Roll:R*; workOrderStepId→WorkOrderStep:R*; operatorId→User:SN*; machineId→Machine:SN*; inheritedFromParentRollId→Roll:SN* | — | metadata? | — | operationType:RollOperationType | — | c/u YOK |
| 38 | **RollVariance** → `roll_variances` (2847-2911) | id uuid | — | 5 | rollId→Roll:R*; workOrderStepId→WorkOrderStep:SN*; createdById→User:SN*; reversedById→User:SN* | qty(12,3) | — | reversedAt | kind:RollVarianceKind | — | c/u YOK |
| 39 | **RollPlanDeviation** → `roll_plan_deviations` (2948-3004) | id uuid | — | 8 | rollId→Roll:R*; childRollId→Roll:SN*; workOrderId→WorkOrder:R*; workOrderStepId→WorkOrderStep:SN*; confirmedById→User:SN* | qtyM(12,3) | — | — | — | — | c/u YOK |
| 40 | **ReasonPreset** → `reason_presets` (3038-3080) | id uuid | `@@[kind,code]` | 1 | — | — | — | isActive | kind:ReasonPresetKind | — | c/u |
| 41 | **DuplicateReview** → `duplicate_reviews` (3110-3131) | id uuid | `@@[entity,pairKey]` | 1 | decidedById→User:SN* | — | evidence? | — | entity:DuplicateReviewEntity, decision:DuplicateReviewDecision | — | c/u |
| 42 | **SystemSetting** → `system_settings` (3138-3152) | key (doğal) | — | 0 | updatedById→User:SN* | — | value | — | — | — | c/u |
| 43 | **TravelerCard** → `traveler_cards` (3162-3202) | id uuid | `cardNumber` · `barcode` · `workOrderId` | 1 | workOrderId→WorkOrder:R*; printedById→User:SN* | — | snapshot? | voidedAt | status:TravelerCardStatus | — | c/u |
| 44 | **TravelerCardScan** → `traveler_card_scans` (3204-3229) | id uuid | — | 4 | cardId→TravelerCard:C; stationId→Station:R*; workOrderStepId→WorkOrderStep:SN*; scannedById→User:SN* | — | — | — | scanType:ScanType | — | c/u YOK |
| 45 | **RollMovement** → `roll_movements` (3235-3275) | id uuid | — | 6 | rollId→Roll:R*; workOrderStepId→WorkOrderStep:R*; operatorId→User:SN*; machineId→Machine:SN* | qtyIn(12,3), qtyOut?(12,3), weightIn?(12,3), weightOut?(12,3) | — | — | — | — | c/u |
| 46 | **SubcontractorDispatch** → `subcontractor_dispatches` (3281-3347) | id uuid | `dispatchNo` | 8 | workOrderId→WorkOrder:R*; batchId→Batch:R*; stepId→WorkOrderStep:R*; subcontractorId→Subcontractor:R*; plannedSubcontractorId→Subcontractor:SN*; dispatchedById→User:SN*; cancelledById→User:SN*; directShippedById→User:SN* | totalQty(12,3) | — | dispatchedAt, cancelledAt | — | — | c/u |
| 47 | **SubcontractorDispatchItem** → `subcontractor_dispatch_items` (3349-3378) | id uuid | `@@[dispatchId,rollId]` | 1 | dispatchId→SubcontractorDispatch:C; rollId→Roll:R* | dispatchedQty(12,3), dispatchedWeight?(12,3) | — | remainderClosedAt | — | — | c/u YOK |
| 48 | **SubcontractorDirectShipAllocation** → `subcontractor_direct_ship_allocations` (3385-3412) | id uuid | `@@[directShipmentId,orderLineId]`?(directShipmentId) | 2 | dispatchId→SubcontractorDispatch:C; orderLineId→OrderLine:R*; directShipmentId→DirectShipment:SN* | qty(12,3) | — | — | — | — | c/u YOK |
| 49 | **DirectShipment** → `direct_shipments` (3420-3464) | id uuid | `shipmentNo` | 4 | dispatchId→SubcontractorDispatch:R; customerId→Customer:R; branchId→CustomerBranch:SN*; shippedById→User:SN*; invoicedById→User:SN* | totalQty(12,3) | — | — | — | — | c/u |
| 50 | **SubcontractorReceipt** → `subcontractor_receipts` (3466-3541) | id uuid | `receiptNo` · `clientToken`? | 6 | workOrderId→WorkOrder:R*; stepId→WorkOrderStep:R*; subcontractorId→Subcontractor:R*; receivedById→User:SN*; cancelledById→User:SN*; appliedColorId→Color:SN* | appliedWidth?(12,3) | — | cancelledAt | — | VAR (unique, null) | c/u |
| 51 | **SubcontractorReceiptProperty** → `subcontractor_receipt_properties` (3547-3560) | id uuid | `@@[receiptId,propertyId]` | 1 | receiptId→SubcontractorReceipt:C; propertyId→FabricProperty:R* | — | — | — | — | — | c/u YOK |
| 52 | **SubcontractorReceiptItem** → `subcontractor_receipt_items` (3562-3597) | id uuid | `@@[receiptId,newRollId]` | 2 | receiptId→SubcontractorReceipt:C; newRollId→Roll:R*; sourceDispatchItemId→SubcontractorDispatchItem:SN* | receivedQty?(12,3) | — | — | — | — | c/u YOK |
| 53 | **SubcontractorCategory** → `subcontractor_categories` (3606-3652) | id uuid | `code` | 1 | createdById→User:SN*; updatedById→User:SN* | — | — | isActive | — | — | c/u |
| 54 | **Subcontractor** → `subcontractors` (3654-3728) | id uuid | `code` · `@@[nameFold]`?(nameFold) | 3 | documentProfileId→DocumentProfile:SN*; createdById→User:SN*; updatedById→User:SN*; mergedIntoId→Subcontractor:SN*; mergedById→User:SN* | — | — | isActive, mergedIntoId | — | — | c/u |
| 55 | **SubcontractorToCategory** → `subcontractor_category_links` (3731-3743) | @@id([subcontractorId, categoryId]) | — | 1 | subcontractorId→Subcontractor:C; categoryId→SubcontractorCategory:C | — | — | — | — | — | c/u YOK |
| 56 | **Swatch** → `swatches` (3749-3800) | id uuid | `cardNumber` · `barcode` | 7 | itemId→Item:R*; colorId→Color:SN*; parentReceiptId→KartelaReceipt:SN*; parentRollId→Roll:SN*; createdById→User:SN*; shipmentId→Shipment:SN*; sackId→Sack:SN* | width?(12,3), length?(12,3), weightKg?(12,3) | — | cancelledAt | — | — | c/u |
| 57 | **SwatchStockReduction** → `swatch_stock_reductions` (3807-3828) | id uuid | `clientToken`? | 2 | itemId→Item:R*; colorId→Color:SN*; createdById→User:SN* | — | — | — | — | VAR (unique, null) | c/u YOK |
| 58 | **KartelaDispatch** → `kartela_dispatches` (3838-3870) | id uuid | `dispatchNo` | 4 | subcontractorId→Subcontractor:R*; dispatchedById→User:SN*; cancelledById→User:SN* | totalQty(12,3) | — | dispatchedAt, cancelledAt | — | — | c/u |
| 59 | **KartelaDispatchItem** → `kartela_dispatch_items` (3872-3891) | id uuid | `@@[dispatchId,rollId]` | 1 | dispatchId→KartelaDispatch:C; rollId→Roll:R* | dispatchedQty(12,3), dispatchedWeight?(12,3) | — | — | — | — | c/u YOK |
| 60 | **KartelaReceipt** → `kartela_receipts` (3893-3925) | id uuid | `receiptNo` | 5 | dispatchId→KartelaDispatch:SN*; subcontractorId→Subcontractor:R*; receivedById→User:SN*; cancelledById→User:SN* | — | — | cancelledAt | — | — | c/u |
| 61 | **KartelaReceiptItem** → `kartela_receipt_items` (3927-3947) | id uuid | `@@[receiptId,consumedRollId]` | 2 | receiptId→KartelaReceipt:C; consumedRollId→Roll:R*; sourceDispatchItemId→KartelaDispatchItem:SN* | — | — | — | — | — | c/u YOK |
| 62 | **Manifest** → `manifests` (3953-3971) | id uuid | `manifestNo` | 1 | workOrderId→WorkOrder:R*; printedById→User:SN* | — | snapshot | — | — | — | c/u |
| 63 | **PrintedDocument** → `printed_documents` (4011-4040) | id uuid | `@@[docType,sourceId,version]` | 2 | printedById→User:SN* | — | snapshot | voidedAt | docType:PrintedDocType, status:PrintedDocStatus | — | c/u |
| 64 | **DocumentProfile** → `document_profiles` (4048-4068) | id uuid | `name` | 0 | createdById→User:SN*; updatedById→User:SN* | — | config | isActive | — | — | c/u |
| 65 | **FreeDocument** → `free_documents` (4075-4093) | id uuid | `documentNo` | 0 | — | — | config | isActive | — | — | c/u |
| 66 | **Sack** → `sacks` (4127-4208) | id uuid | `sackNo` · `clientToken`? · `@@[shipmentId,seq]`?(shipmentId/seq) · `@@[id,shipmentId]`?(shipmentId) | 2 | customerId→Customer:SN*; branchId→CustomerBranch:SN*; shipmentId→Shipment:SN*; weighedById→User:SN* | weightKg?(12,3) | — | — | weightSource:SackWeightSource? | VAR (unique, null) | c/u |
| 67 | **Shipment** → `shipments` (4214-4308) | id uuid | `shipmentNo` · `clientToken`? | 8 | customerId→Customer:R*; dispatchedById→User:SN*; invoicedById→User:SN*; branchId→CustomerBranch:SN*; createdById→User:SN*; updatedById→User:SN* | — | — | dispatchedAt | status:ShipmentStatus, destination:ShipmentDestination | VAR (unique, null) | c/u |
| 68 | **ShipmentOrder** → `shipment_orders` (4312-4331) | @@id([shipmentId, orderId]) | — | 1 | shipmentId→Shipment:R; orderId→Order:R* | — | — | isActive | — | — | c/u YOK |
| 69 | **SackAllocation** → `sack_allocations` (4338-4354) | id uuid | `@@[sackId,orderLineId]` | 1 | sackId→Sack:R; orderLineId→OrderLine:R* | qty(12,3) | — | — | — | — | c/u YOK |
| 70 | **RollReturn** → `roll_returns` (4362-4464) | id uuid | — | 15 | rollId→Roll:R*; fromShipmentId→Shipment:SN*; customerId→Customer:R*; orderId→Order:SN*; itemId→Item:R*; colorId→Color:SN*; reasonId→ReturnReason:SN*; qualityGradeId→QualityGrade:SN*; receivedById→User:R*; cancelledById→User:SN* | width?(12,3), qty(12,3) | — | cancelledAt | appliedStatus:RollStatus? | — | c/u |
| 71 | **Color** → `colors` (4490-4566) | id uuid | `code` | 4 | createdById→User:SN*; updatedById→User:SN*; mergedIntoId→Color:SN*; mergedById→User:SN* | — | — | isActive, mergedIntoId | — | — | c/u |
| 72 | **FabricProperty** → `fabric_properties` (4573-4666) | id uuid | `code` | 5 | createdById→User:SN*; updatedById→User:SN* | — | — | isActive | valueType:FabricPropertyValueType | — | c/u |
| 73 | **FabricPropertyValue** → `fabric_property_values` (4683-4706) | id uuid | `@@[propertyId,code]` | 1 | propertyId→FabricProperty:C | — | — | isActive | — | — | c/u |
| 74 | **ItemAllowedProperty** → `item_allowed_properties` (4711-4724) | id uuid | `@@[itemId,propertyId]` | 1 | itemId→Item:C; propertyId→FabricProperty:R* | — | — | — | — | — | c/u YOK |
| 75 | **ItemAllowedColor** → `item_allowed_colors` (4729-4742) | id uuid | `@@[itemId,colorId]` | 1 | itemId→Item:C; colorId→Color:R* | — | — | — | — | — | c/u YOK |
| 76 | **CustomerItemAlias** → `customer_item_aliases` (4749-4778) | id uuid | `@@[customerId,itemId]` | 3 | customerId→Customer:C; itemId→Item:C; createdById→User:SN*; updatedById→User:SN* | — | — | — | — | — | c/u |
| 77 | **CustomerColorAlias** → `customer_color_aliases` (4782-4823) | id uuid | `@@[customerId,colorId]` | 3 | customerId→Customer:C; colorId→Color:C; createdById→User:SN*; updatedById→User:SN* | — | — | — | — | — | c/u |
| 78 | **LabelTemplate** → `label_templates` (4840-4909) | id uuid | `@@[name]` | 2 | createdById→User:SN*; updatedById→User:SN* | lineStepMm?(4,1) | fields, rawCode? | isActive, deletedAt | kind:LabelKind? | — | c/u |
| 79 | **LabelTemplateVariant** → `label_template_variants` (4916-4934) | id uuid | `@@[templateId,widthMm,heightMm]` | 0 | templateId→LabelTemplate:C | widthMm(6,2), heightMm(6,2) | elements | — | — | — | c/u |
| 80 | **CustomerTemplateRoute** → `customer_template_routes` (4940-4954) | id uuid | `@@[customerId,kind]` | 1 | customerId→Customer:C; templateId→LabelTemplate:R | — | — | — | kind:LabelKind | — | c/u |
| 81 | **CustomerStandaloneLabel** → `customer_standalone_labels` (4964-4983) | id uuid | `@@[customerId,templateId]` | 2 | customerId→Customer:C; templateId→LabelTemplate:C; createdById→User:SN*; updatedById→User:SN* | — | — | — | — | — | c/u YOK |
| 82 | **LabelContextDefault** → `label_context_defaults` (4987-4998) | id uuid | `kind` | 1 | templateId→LabelTemplate:R | — | — | — | kind:LabelKind | — | c/u |
| 83 | **WorkOrderTargetProperty** → `work_order_target_properties` (5003-5016) | id uuid | `@@[workOrderId,propertyId]` | 1 | workOrderId→WorkOrder:C; propertyId→FabricProperty:R* | — | — | — | — | — | c/u YOK |
| 84 | **RollProperty** → `roll_properties` (5022-5056) | id uuid | `@@[rollId,propertyId]` | 2 | rollId→Roll:C; propertyId→FabricProperty:R*; valueId→FabricPropertyValue:R | — | — | — | — | — | c/u YOK |
| 85 | **StationColor** → `station_colors` (5071-5085) | id uuid | `@@[stationId,colorId]` | 1 | stationId→Station:C; colorId→Color:C | — | — | — | — | — | c/u |
| 86 | **StationProperty** → `station_properties` (5115-5143) | id uuid | `@@[stationId,propertyId]` | 1 | stationId→Station:C; propertyId→FabricProperty:C | — | — | — | mode:StationPropertyMode | — | c/u |
| 87 | **SystemLog** → `system_logs` (5149-5201) | id uuid | — | 5 | userId→User:SN* | — | oldData?, newData?, changes? | — | category:SystemLogCategory | — | c/u YOK |
| 88 | **SystemLogArchive** → `system_log_archives` (5206-5240) | id uuid | — | 4 | — | — | changes?, oldData?, newData? | archivedAt | category:SystemLogCategory | — | c/u(elle) |
| 89 | **EndpointLatencyDaily** → `endpoint_latency_daily` (5247-5260) | id uuid | `@@[day,routeKey]` | 0 | — | — | buckets | — | — | — | c/u |
| 90 | **TravelerCardTemplate** → `traveler_card_templates` (5274-5305) | id uuid | `@@[name]` · `@@[isDefault]` | 1 | createdById→User:SN*; updatedById→User:SN* | — | config | isActive, deletedAt | mode:TravelerTemplateMode | — | c/u |
| 91 | **ImportRun** → `import_runs` (5328-5363) | id uuid | `clientToken`? | 3 | userId→User:SN* | — | options?, errorReport? | — | status:ImportRunStatus | VAR (unique, null) | c/u YOK |

## 2. (a) BEKLENEN TEKİLLİK TABLOSU — ana varlıklar

Kaynaklar: şema satırı · saha/dev DB `pg_indexes` (`CREATE UNIQUE`) · veri sayımı (saha kopyası). "DB" sütunu: **düz** = şemadan üretilen sıradan UNIQUE · **partial** = migration'da `WHERE …` predicate'i eklenmiş (Prisma 7 predicate farkını drift saymaz) · **expr** = ifade index'i (şemada temsil edilemez).

| Varlık | Beklenen anahtar | Şemadaki karşılık | DB (saha / dev) | Veri (saha) / not |
|---|---|---|---|---|
| Item | kod | `Item.code @unique` `schema.prisma:1239` | düz ✓/✓ | 228 kumaş |
| Item | ad (katlanmış) | `@@unique([nameFold])` `:1317` (`nameFold` DB-üretimli, NULL'lanabilir) | **partial `WHERE mergedIntoId IS NULL` — saha'da YOK, dev'de var** | saha'da 1 canlı mükerrer grup → yumuşak kapı index'i atladı (`test_db_invariants` §1 orada bilerek kırmızı) |
| Customer | kod · ad | `code @unique :1800` · `@@unique([nameFold]) :1889` | düz ✓ · partial ✓/✓ | 27 müşteri; 0 canlı mükerrer |
| Customer | VKN | `taxNumber String?` `:1802` — **unique YOK (bilinçli, 2026-08-22 P5: aynı tüzel kişiye ikinci cari kart meşru)** | — | 0 dolu-mükerrer |
| Subcontractor | kod · ad | `code @unique :3656` · `@@unique([nameFold]) :3726` | düz ✓ · partial ✓/✓ | — |
| Color | kod · ad | `code @unique :4492`; ad için **şemada kısıt YOK** (`:4541-4556` notu: düz `nameFold` seddi bilinçli reddedildi) | ad: **expr `colors_nameFoldColor_key` ON `tr_fold_color(name)` WHERE mergedIntoId IS NULL — saha ✓, dev YOK** | dev'de 1 canlı mükerrer renk grubu (yumuşak kapı atladı); saha 0 |
| Roll | barkod | `barcode String? @unique` `:1326` | düz (NULL serbest) | 148/2431 NULL (açık kumaş) |
| Roll | idempotency | `clientToken String? @unique` `:1331` | partial `WHERE clientToken IS NOT NULL` | 172 NULL (sunucu üretimi) |
| Roll | barkod sayacı | `RollBarcodeCounter @@id([day,type])` `:2714` — `ON CONFLICT DO UPDATE n=n+1` satır kilidi (`:2705-2708` notu) | pkey | — |
| WorkOrder | İE no · idempotency | `workOrderNumber @unique :2152` · `clientToken? @unique :2157` | düz · partial | 213 iş emri |
| Batch | parti no | **`batchNumber` @unique YOK — BİLİNÇLİ** (`:2263-2270`, migration `20260805120000`); kimlik yalnız `id`; yarış koruması `pg_advisory_xact_lock(8022,1)` | `batches` üzerinde hiçbir unique yok (yalnız pkey) | **92 mükerrer numara grubu** (P01…P99 sarma); kodda `batchNumber` ile lookup yok — tek `where: {batchNumber: {gte, startsWith}}` sayaç kaynağı `Teks-Erp/src/services/batch.service.ts:134` |
| Order | sipariş no · idempotency | `orderNumber @unique :1961` · `clientToken? @unique :1965` | düz · partial | 278 sipariş |
| OrderLine | — | unique YOK (satır kimliği `id`) | — | kalem iptali `cancelledAt` soft (`:2073-2079`, saha'da kolon yok) |
| Shipment | sevk no · idempotency | `shipmentNo @unique :4216` · `clientToken? @unique :4220` | düz · **düz** (partial değil — PG'de NULL'lar zaten çakışmaz) | 40 sevkiyat |
| DirectShipment | no | `shipmentNo String @unique` `:3423` (`@db.VarChar` YOK → `text`) | düz | 0 satır |
| Sack | çuval no (= barkod) · idempotency | `sackNo @unique :4129` (ayrı barkod kolonu YOK, `LabelKind.SACK` notu `:243-247`) · `clientToken? @unique :4133` | düz · düz | 41 çuval |
| Sack | sevkiyat içi sıra | `@@unique([shipmentId, seq])` `:4195` — **iki kolon da NULL'lanabilir** (havuz çuvalı NULL/NULL, bilinçli) | düz | saha: havuz çuvalı 0, sevkiyatta seq NULL 0 |
| Sack | bileşik FK hedefi | `@@unique([id, shipmentId])` `:4202` — yalnız `rolls/swatches (sackId, shipmentId)` DEFERRABLE FK'sının hedefi | düz | Prisma `migrate dev` bu 2 FK'yı DROP etmek ister (`:4196-4201` uyarısı) |
| SackAllocation | beklenen "(shipment, sack, roll?)" | **gerçek: `@@unique([sackId, orderLineId])`** `:4351` — top DEĞİL, çuval × sipariş satırı ("hangi top değil ne kadar metraj", `:4333-4337`); sevkiyat bağı `sack.shipmentId` üzerinden dolaylı | düz | 46 tahsis |
| ShipmentOrder | (shipment, order) · "orderId aktif" | `@@id([shipmentId, orderId])` `:4328`; **"bir sipariş tek aktif sevkiyatta" partial unique BİLİNÇLİ KALDIRILDI** (`:4316-4320`), `isActive` denorm bayrağı uygulama bakımlı | pkey | saha: isActive tutarsız satır 0 |
| TravelerCard | iş emri | `workOrderId @unique :3166` + `cardNumber @unique :3164` + `barcode @unique :3165` — **üçü aynı değeri taşır** (= workOrderNumber, `:3158-3161`) | düz ×3 | 213 kart; üçlü sapma 0 |
| PrintedDocument | (kaynak, versiyon) | `@@unique([docType, sourceId, version])` `:4036`; `sourceId` polimorfik, **FK YOK** (`:4014-4016`) | düz | (docType,sourceId) başına ACTIVE>1 : 0 |
| User | kullanıcı adı | `username @unique :355` + DB **expr `users_username_lower_uq`** (şema-dışı) | düz + expr | **`email` kolonu YOK** (User'da e-posta alanı bulunmuyor) |
| User | kart / PIN | `cardToken? @unique :366` · `quickPin? @unique :371` (düz saklanır, `:362-370` notu) | düz | cardToken 0, quickPin 8/9 |
| Device | tablet kimliği | `deviceId @unique :802`; `Session.deviceId` **FK DEĞİL** serbest string (`:531-533` bilinçli) | düz | 28 cihaz |
| Session | oturum | `jti @unique :539`; `(userId, deviceType)` tekliği **uygulama katmanında** (`:526-530`, `SessionRegistryService`) | düz | 10 süresi dolmuş & `revokedAt` NULL oturum var (bkz. sınır ötesi) |
| SubcontractorDispatch | sevk no · idempotency | `dispatchNo @unique :3283`; **clientToken YOK** | düz | 195 sevk |
| SubcontractorDispatchItem | (sevk, top) | `@@unique([dispatchId, rollId])` `:3375` | düz | — |
| SubcontractorReceipt | makbuz no · idempotency | `receiptNo @unique :3468` · `clientToken? @unique :3474` (kısmi kabulle "replay'in TEK kimliği", `:3469-3473`) | düz · **düz** | 143 makbuz; clientToken dolu **2/143** |
| SubcontractorReceiptItem | (makbuz, top) | `@@unique([receiptId, newRollId])` `:3592` (`newRollId` = ORİJİNAL top, ad yanıltıcı `:3565-3570`) | düz | 638 satır; isPartial 1; receivedQty NULL 635 (2026-08-19 öncesi) |
| SubcontractorDirectShipAllocation | (doğrudan sevk, satır) | `@@unique([directShipmentId, orderLineId])` `:3408` — `directShipmentId` NULL'lanabilir (eski kayıt) | düz (`…_dsId_orderLineId_key`, 63-karakter kısaltma) | NULL 0 |
| RollVariance | tersleme adresi | `sourceRefId String?` — **unique DEĞİL, `@@index([source, sourceRefId])`** `:2909` (bilinçli: aynı top aynı adımda N makbuzda sapma, `:2874-2882`) | index | 75 satır |
| RollPlanDeviation | imza | `confirmationId` — **unique DEĞİL**, `@@index([confirmationId])` `:3003` (alan başına satır, `COUNT(DISTINCT)` ile sayılır `:2931-2935`) | index | 0 satır |
| DuplicateReview | çift | `@@unique([entity, pairKey])` `:3128` (`pairKey = min:max`) | düz | 13 (hepsi MERGED) |
| ReasonPreset | kod | `@@unique([kind, code])` `:3076`; `code` ASLA değişmez, `label` serbest | düz | 29 satır |
| RollOperation | (top, adım, tür) | `@@unique([rollId, workOrderStepId, operationType])` `:2807` — adım başına TEK satır (sapma defterinin ayrı tablo olma gerekçesi) | düz | 1586 |
| RollMovement | tek açık hareket | **şemada YOK**; DB partial `roll_movements_one_open_per_roll_step_uq (rollId, workOrderStepId) WHERE exitedAt IS NULL` (`:3268-3273`) | partial ✓/✓ | 224 açık hareket; aynı roll+step'te >1 açık: 0 |
| WorkOrderStep | adım sırası | `@@unique([workOrderId, stepSequence])` `:2386` | düz | — |
| KursunBypassAssignment | tek açık atama | **şemada YOK**; DB partial `kursun_bypass_one_pending_per_step_uq` (`:2437-2445`) | partial ✓/✓ | 2 satır |
| WorkSession | makine/cihaz başına tek aktif | **şemada YOK**; DB partial `work_sessions_active_machine_uq`, `work_sessions_active_device_uq` (`:1031-1038`) | partial ✓/✓ | 3 açık oturum |
| Permission / UserPermission | kod · (user, perm) | `code @unique :560` · `@@unique([userId, permissionId]) :597` (zaman pencereli grant aynı çift için ikinci satır açamaz) | düz | — |
| PermissionTemplate | kod · ad | `code? @unique :614` · `name @unique :615` + DB expr `permission_templates_name_lower_uq` | düz + expr | — |
| Swatch / Kartela* | kart no · barkod · (sevk, top) · (makbuz, top) | `Swatch.cardNumber/barcode @unique :3751-3752` · `KartelaDispatch.dispatchNo :3840` · `KartelaReceipt.receiptNo :3895` · `KartelaDispatchItem @@unique([dispatchId, rollId]) :3888` · `KartelaReceiptItem @@unique([receiptId, consumedRollId]) :3942` · `SwatchStockReduction.clientToken? :3810` (partial) | düz / partial | kartela akışı saha'da **0 kayıt** |
| LabelTemplate & yönlendirmeler | ad · kind başına tek default · (şablon, boyut) · primary · bağlam · (müşteri/cihaz, kind) | `@@unique([name]) :4902` · DB partial `label_templates_one_default_per_kind` (`:4905-4907`) · `LabelTemplateVariant @@unique([templateId, widthMm, heightMm]) :4932` + DB partial `label_template_variants_one_primary` · `LabelContextDefault.kind @unique :4989` · `CustomerTemplateRoute @@unique([customerId, kind]) :4951` · `PeripheralTemplateRoute @@unique([peripheralId, kind]) :973` | düz + 2 partial | 4 isDefault=true şablon (deprecated çift-yazım `:4844-4849`) |
| TravelerCardTemplate | ad · tek default | `@@unique([name]) :5301` · `@@unique([isDefault]) :5302` — **DB'de partial `WHERE isDefault=true`** (düz olsaydı sistemde toplam 2 şablon tutulabilirdi, `:5278-5281`) | düz + partial | 0 satır |
| Station / Machine / PeripheralDevice / Route / ProductRecipe | kod | `code @unique` `:662` / `:751` / `:844` / `Route.code? :1043` / `:1167` | düz | — |
| QualityGrade / ReturnReason / DefectType / FabricProperty / SubcontractorCategory | kod | `code @unique` `:2526` / `:2611` / `:2661` / `:4575` / `:3608`; `FabricPropertyValue @@unique([propertyId, code]) :4703` | düz | — |
| CustomerBranch | müşteri içi kod | `@@unique([customerId, code])` `:1952` — `code` NULL'lanabilir (kodsuz şube serbest, `:1949-1951` bilinçli) | düz | code NULL 0 |
| RollError | mükerrer hata | `@@unique([rollId, startMeter, defectTypeId])` `:2763` — `defectTypeId` NULL'lanabilir; **DB'de partial `WHERE defectTypeId IS NOT NULL`** | partial | defectTypeId NULL 0 |
| Pivotlar | (a, b) | `RollProperty`, `WorkOrderTargetProperty`, `OrderLineRequiredProperty`, `ProductRecipeProperty`, `RouteStepProperty`, `SubcontractorReceiptProperty`, `ItemAllowedColor/Property`, `CustomerItemAlias/ColorAlias`, `StationColor/Property`, `DevicePeripheral`, `CustomerStandaloneLabel`, `EndpointLatencyDaily @@unique([day, routeKey])` | düz | — |
| SystemSetting | anahtar | `key @id` `:3139` (doğal PK) | pkey | 34 anahtar |
| ImportRun | idempotency | `clientToken? @unique :5339` | düz | 0 satır |

## 3. (b) KISIT MATRİSİ — kritik varlıklar

Sütunlar: **unique** · **index** (adet; kilit olanlar) · **FK dışa** (bu modelin FK'ları : onDelete) · **FK içe** (bu modeli gösteren FK'lar : hedef silinirse ne olur) · **CHECK** (DB, saha+dev doğrulandı; K2b'nin envanteri) · **Json** · **Decimal**. `*` = Prisma varsayılanı.

| Varlık | unique | index | FK dışa | FK içe | CHECK (DB) | Json | Decimal |
|---|---|---|---|---|---|---|---|
| **Roll** `:1321-1792` | `barcode?`, `clientToken?` (partial) | **21** — `[status,createdAt]`, `[status,updatedAt]`, `[status,itemId,colorId,width]`, `[status,currentQty]`, `[currentStepId,status]`, `[producedInStepId,status]`; DB'de 8'i PARTIAL (`sackId`, `shipmentId`, `parentReceiptId`, `batchId`, `markedForKartela`, `labelCustomerId`, `finalizedAt`, `clientToken`) | 16 FK: `itemId` R*; diğer 15'i SN* (`colorId`, `qualityGradeId`, `parentRollId` (soy), `directShipmentId`, `parentReceiptId` (soy), `currentStepId`, `producedInStepId`, `createdById`, `cancelledById`, `createdMachineId`, `entryStationId`, `labelCustomerId`, `shipmentId`, `sackId`, `batchId`) + DB-only bileşik DEFERRABLE `(sackId, shipmentId)→sacks(id, shipmentId)` | R: `roll_movements`, `roll_operations`, `roll_errors`, `roll_variances`, `roll_plan_deviations.rollId`, `subcontractor_dispatch_items`, `subcontractor_receipt_items`, `kartela_dispatch_items`, `kartela_receipt_items`, `roll_returns` · **SN**: `rolls.parentRollId` (çocuklar), `roll_operations.inheritedFromParentRollId`, `roll_plan_deviations.childRollId`, `swatches.parentRollId` · C: `roll_properties` | `currentQty>=0`, `initialQty>=0`, `weightKg IS NULL OR >=0` — **`currentQty <= initialQty` CHECK'i YOK** (aşım meşru, `tambur.overQuantityEnabled`) | `lastLabelSnapshot?` (ayna kolon `labelCustomerId` :1610) | `initialQty`, `currentQty`, `weightKg?`, `width?`, `preTamburCloseQty?` — hepsi (12,3) |
| **WorkOrder** `:2150-2255` | `workOrderNumber`, `clientToken?` (partial) | 8 — `[status,createdAt]`, `[status,plannedEndDate]`, `[isActive]`, `[splitFromId]` (DB partial), trgm | 7 FK hepsi SN*: `routeTemplateId`, `targetItemId`, `targetColorId`, `splitFromId` (soy), `cancelledById`, `createdById`, `updatedById` | R*: `work_order_steps`, `batches`, `traveler_cards`, `manifests`, `subcontractor_dispatches`, `subcontractor_receipts`, `roll_plan_deviations`, `work_order_to_order_lines`, `kursun_bypass_assignments` · SN*: `work_orders.splitFromId` · C: `work_order_target_properties` | `work_orders_stockprod_targetItem` (STOCK_PRODUCTION → targetItemId NOT NULL) | `parameters?` (saha'da 2 dolu; `parameters.rework` rapor anahtarı) | `width?`, `targetQuantity?`, `targetWeight?` (12,3) |
| **WorkOrderStep** `:2318-2396` | `@@[workOrderId,stepSequence]` | 4 — `[workOrderId,status]`, `[stationId,status,isUrgent,priority,startedAt]` (DB partial `status<>'COMPLETED'`) | `workOrderId` R*, `stationId` R*, `requiredCategoryId` SN*, `plannedSubcontractorId` SN* | R*: `roll_movements`, `roll_operations`, `subcontractor_dispatches.stepId`, `subcontractor_receipts.stepId`, `kursun_bypass_assignments` · **SN***: `rolls.currentStepId`, `rolls.producedInStepId`, `roll_errors.detectedAtStepId/processedAtStepId`, `traveler_card_scans`, `roll_variances`, `roll_plan_deviations` | `work_order_steps_time_order` (completedAt >= startedAt) | `stepData?` (saha'da **0 dolu**) | — |
| **Batch** `:2260-2316` | **YOK** (bilinçli) | 5 — `[createdAt]` (kısa sayaç kaynağı), `splitFromId`/`mergedIntoId` DB partial, trgm | `workOrderId` R*, `splitFromId` SN* (soy), `mergedIntoId` SN* (soy), `createdById`/`updatedById` SN* | SN*: `rolls.batchId` · R*: `subcontractor_dispatches.batchId` · SN*: `batches.splitFromId/mergedIntoId` | — | — | — |
| **Order** `:1959-2040` | `orderNumber`, `clientToken?` (partial) | 7 — `[status,createdAt DESC]`, `[createdAt DESC,id DESC]` (DB partial `status<>'CANCELLED'`, **saha'da YOK**), `[deadline]`, trgm | `customerId` R*, `branchId` SN*, `manualClosedById` SN*, `createdById`/`updatedById` SN* | **C**: `order_lines` · R*: `shipment_orders` · SN*: `roll_returns.orderId` | — | — | `totalAmount?` (14,2), `shippedQty` (12,3) denorm |
| **OrderLine** `:2046-2127` | YOK | 6 — `[orderId]`, `[itemId,createdAt]`, `[createdAt]` (cursor), trgm | `orderId` **C**, `itemId` R*, `colorId` SN*, `cancelledById` SN* | **C**: `order_line_required_properties`, `work_order_to_order_lines` · R*: `sack_allocations`, `subcontractor_direct_ship_allocations` | `quantity>0`, `shippedQty>=0` | — | `quantity`, `shippedQty` (denorm), `unitPrice?` (12,2), `width?`, `pieceLengthM?` |
| **Shipment** `:4214-4308` | `shipmentNo`, `clientToken?` (düz) | 8 — `[customerId,status]`, `[status,createdAt]`, `[status,dispatchedAt]`, 3 fold, trgm | `customerId` R*, `branchId` SN*, `dispatchedById`/`invoicedById`/`createdById`/`updatedById` SN* | SN*: `sacks.shipmentId`, `rolls.shipmentId`, `swatches.shipmentId`, `roll_returns.fromShipmentId` · R (açık): `shipment_orders.shipmentId` (D-10) · DB-only: 2 DEFERRABLE bileşik FK | — (**`cancelledAt` kolonu YOK**, iptal yalnız `status=CANCELLED`) | — | — |
| **ShipmentOrder** `:4312-4331` | `@@id([shipmentId,orderId])` | 1 | `shipmentId` R (açık), `orderId` R* | — | — | — | — |
| **Sack** `:4127-4208` | `sackNo`, `clientToken?`, `@@[shipmentId?,seq?]`, `@@[id,shipmentId?]` | 2 — `[customerId,createdAt]` (FIFO), trgm | `customerId` SN*, `branchId` SN*, `shipmentId` SN*, `weighedById` SN* | SN*: `rolls.sackId`, `swatches.sackId` · R (açık): `sack_allocations.sackId` | `weightKg IS NULL OR >=0` | — | `weightKg?` (12,3) |
| **SackAllocation** `:4338-4354` | `@@[sackId,orderLineId]` | 1 | `sackId` R (açık), `orderLineId` R* | — | `qty>0` | — | `qty` (12,3) |
| **RollMovement** `:3235-3275` | şema YOK; DB partial "tek açık" | 6 — `[rollId,enteredAt DESC]`, `[exitedAt]` (DB partial NOT NULL) | `rollId` R*, `workOrderStepId` R*, `operatorId` SN*, `machineId` SN* | — | `qtyIn>=0`, `qtyOut/weightIn/weightOut IS NULL OR >=0` | — | `qtyIn`, `qtyOut?`, `weightIn?`, `weightOut?` (12,3) |
| **RollOperation** `:2783-2819` | `@@[rollId,workOrderStepId,operationType]` | 6 — `[operationType,createdAt]`, `[workOrderStepId,createdAt]`, `[createdAt]` | `rollId` R*, `workOrderStepId` R*, `operatorId` SN*, `machineId` SN*, `inheritedFromParentRollId` SN* | — | — | `metadata?` (1586 dolu; upsert `update: {}` ile ilk yazım kalır — `:2926-2928` notu) | — |
| **RollReturn** `:4362-4464` | YOK | 15 | `rollId` R*, `customerId` R*, `itemId` R*, `receivedById` R*; `fromShipmentId`, `orderId`, `colorId`, `reasonId`, `qualityGradeId`, `cancelledById` SN* | — | `qty>0` | — | `width?`, `qty` (12,3) |
| **RollVariance** `:2847-2911` | YOK (`[source,sourceRefId]` index) | 5 | `rollId` R*, `workOrderStepId` SN*, `createdById`/`reversedById` SN* | — | `qty>0` (işaretsiz; yön `kind`) | — | `qty` (12,3) |
| **RollPlanDeviation** `:2948-3004` | YOK (`[confirmationId]` index) | 8 | `rollId` R*, `workOrderId` R*, `childRollId` SN*, `workOrderStepId` SN*, `confirmedById` SN* | — | — | — | `qtyM` (12,3) |
| **SubcontractorDispatch** `:3281-3347` | `dispatchNo` (clientToken YOK) | 8 | `workOrderId`/`batchId`/`stepId`/`subcontractorId` R*; `plannedSubcontractorId`, `dispatchedById`, `cancelledById`, `directShippedById` SN* | **C**: `subcontractor_dispatch_items`, `subcontractor_direct_ship_allocations` · R (açık): `direct_shipments.dispatchId` | — | — | `totalQty` (12,3) |
| **SubcontractorDispatchItem** `:3349-3378` | `@@[dispatchId,rollId]` | 1 | `dispatchId` **C**, `rollId` R* | SN*: `subcontractor_receipt_items.sourceDispatchItemId` | `dispatchedQty>0`, `dispatchedWeight IS NULL OR >=0` | — | `dispatchedQty`, `dispatchedWeight?` |
| **SubcontractorReceipt** `:3466-3541` | `receiptNo`, `clientToken?` (düz) | 6 | `workOrderId`/`stepId`/`subcontractorId` R*; `receivedById`, `cancelledById`, `appliedColorId` SN* | **C**: `subcontractor_receipt_items`, `subcontractor_receipt_properties` · SN*: `rolls.parentReceiptId` (doğan topların soy bağı) | — | — | `appliedWidth?` (12,3) |
| **SubcontractorReceiptItem** `:3562-3597` | `@@[receiptId,newRollId]` | 2 | `receiptId` **C**, `newRollId` R*, `sourceDispatchItemId` SN* | — | — | — | `receivedQty?` (12,3) |
| **Customer** `:1798-1891` | `code`, `@@[nameFold?]` (partial) | 5 (trgm dahil) | `documentProfileId`, `createdById`, `updatedById`, `mergedIntoId` (soy), `mergedById` — hepsi SN* | R*: `orders`, `shipments`, `direct_shipments` (açık R), `roll_returns` · **C**: `customer_branches`, `customer_item_aliases`, `customer_color_aliases`, `customer_template_routes`, `customer_standalone_labels` · SN*: `sacks.customerId`, `routes.customerId`, `rolls.labelCustomerId`, `customers.mergedIntoId` | — | — | — |
| **Item** `:1237-1319` | `code`, `@@[nameFold?]` (partial; saha'da eksik) | 4 | `createdById`/`updatedById`/`mergedIntoId`/`mergedById` SN* | R*: `rolls`, `order_lines`, `swatches`, `product_recipes`, `roll_returns`, `swatch_stock_reductions` · SN*: `work_orders.targetItemId`, `items.mergedIntoId` · C: `item_allowed_colors/properties`, `customer_item_aliases` | — | — | — |
| **Color** `:4490-4566` | `code`; ad → DB expr (şema-dışı) | 4 | `createdById`/`updatedById`/`mergedIntoId`/`mergedById` SN* | R*: `item_allowed_colors` · **SN***: `rolls.colorId`, `order_lines.colorId`, `work_orders.targetColorId`, `swatches`, `roll_returns`, `product_recipes`, `route_steps.plannedColorId`, `subcontractor_receipts.appliedColorId`, `swatch_stock_reductions`, `colors.mergedIntoId` · C: `customer_color_aliases`, `station_colors` | — | — | — |
| **TravelerCard** `:3162-3202` | `cardNumber`, `barcode`, `workOrderId` | 1 (`[status]`) | `workOrderId` R*, `printedById` SN* | **C**: `traveler_card_scans` | — | `snapshot?` (canlı plan + `version` read+1 `traveler-card.service.ts:284`) | — |
| **PrintedDocument** `:4011-4040` | `@@[docType,sourceId,version]` | 2 | `printedById` SN* (sourceId FK YOK) | — | — | `snapshot` (donmuş, immutable) | — |
| **User / Permission** `:353-654` | `username` (+expr lower), `cardToken?`, `quickPin?`; `Permission.code`; `UserPermission @@[userId,permissionId]` | — | `User.createdById/updatedById` self SN* | R*: `sessions`, `work_sessions`, `kursun_bypass_assignments` (3 FK, açık R), `roll_returns.receivedById` · **C**: `user_permissions`, `user_preferences`, `permission_template_items` · diğer ~90 "kim yaptı" FK'sı SN* | — | `UserPreference.preferences` | — |
| **SystemLog** `:5149-5201` | YOK | 5 — `[tableName,recordId]`, `[createdAt]`, `[category,createdAt]`, `[userId,createdAt]`, `[requestId]` | `userId` SN* | — (arşiv tablosunda FK yok) | trigger `system_logs_block_tamper` (UPDATE/DELETE/TRUNCATE engeli, GUC kapılı) | `oldData?`, `newData?`, `changes?` | — |
| **Device / WorkSession / Session** | `Device.deviceId`; `Session.jti`; WorkSession DB partial ×2 | Device 2, WorkSession 5, Session 1 | `Device.machineId` SN*; `WorkSession` 4 FK: user/device/station R*, machine R (açık); `Session.userId` R (açık) | Device ← `work_sessions` R*, `device_peripherals` C, `peripheral_devices.deviceId` SN (açık) | — | — | — |
| **Kartela*** `:3749-3947` | `Swatch.cardNumber/barcode`; `KartelaDispatch.dispatchNo`; `KartelaReceipt.receiptNo`; item pivot uniques | Swatch 7 (`[createdAt]` DB partial `cancelledAt IS NULL`), diğerleri 4-5 | `Swatch`: itemId R*, 6 SN*; `KartelaReceipt.dispatchId` SN* (bilgi amaçlı) | **C**: `kartela_dispatch_items`, `kartela_receipt_items` · R*: `kartela_*_items.rollId/consumedRollId` | `kartela_dispatch_items_dispatchedQty_pos/_dispatchedWeight_nonneg`, `kartela_receipt_items_kartelaCount_pos`, `swatch_stock_reductions_count_pos` | — | `Swatch.width?/length?/weightKg?`, `KartelaDispatch.totalQty`, `KartelaDispatchItem.dispatchedQty/Weight?` |

Tam CHECK envanteri (26, saha+dev birebir): `rolls` ×3 · `order_lines` ×2 · `sacks` ×1 · `work_order_steps` ×1 · `roll_movements` ×4 · `roll_errors` ×1 · `sack_allocations` ×1 · `subcontractor_direct_ship_allocations` ×1 · `work_order_to_order_lines` ×1 · `subcontractor_dispatch_items` ×2 · `kartela_dispatch_items` ×2 · `kartela_receipt_items` ×1 · `swatch_stock_reductions` ×1 · `direct_shipments` ×2 · `roll_returns` ×1 · `work_orders` ×1 · `roll_variances` ×1 (bekçi envanteri: `Teks-Erp/scripts/test_db_invariants.ts:197-232`).

## 4. (c) CASCADE ilişkileri — 41 (şemada açık) + ERP açısından işaret

"Defter/hareket mi" sütunu **yargı değil işarettir**: satır sevk/kabul/tahsis/okutma miktarı ya da iz taşıyorsa ✔. "Fiziksel silme yolu": ebeveyni fiziksel silen kod var mı (`grep -rnoE '\b(tx|prisma)\.\w+\.(delete|deleteMany)\('` + `/permanent` uçları).

| # | Çocuk.alan → Ebeveyn (şema satırı) | Çocuk ne taşır | Defter/hareket? | Ebeveyni fiziksel silen yol |
|---|---|---|---|---|
| 1 | `OrderLine.order → Order` `:2098` | kalem: `quantity`, **`shippedQty` (sevk defteri toplamı)**, `cancelledAt` | ✔ | **YOK** — `OrderService.hardDelete` = `softDelete` (`Teks-Erp/src/services/order.service.ts:2718-2720`); `/orders/:id/permanent` fiilen iptal |
| 2 | `WorkOrderToOrderLine.orderLine → OrderLine` `:2507` | iş emri↔kalem bağı, `allocatedQty` (saha'da 140/140 satır 0) | ✔ (bağ tarihçesi) | **VAR**: sipariş düzenlemede kalem replace `tx.orderLine.deleteMany` (`order.service.ts:2447`) — guard yalnız CANCELLED/SUPERSEDED **olmayan** WO bağlarını sayar (`:2434-2446`) → iptal edilmiş WO'nun bağı sessizce cascade ile düşer |
| 3 | `OrderLineRequiredProperty.orderLine → OrderLine` `:2136` | pivot | — | aynı yol (#2) |
| 4 | `SubcontractorDispatchItem.dispatch → SubcontractorDispatch` `:3365` | **`dispatchedQty/Weight`, `remainderClosedAt`** | ✔ | YOK (`subcontractorDispatch.delete` çağrısı yok; iptal soft `cancelledAt`) |
| 5 | `SubcontractorDirectShipAllocation.dispatch → SubcontractorDispatch` `:3397` | **`qty` — `OrderLine.shippedQty`'nin ikinci kaynağı** (`:3379-3383`) | ✔ | YOK |
| 6 | `SubcontractorReceiptItem.receipt → SubcontractorReceipt` `:3586` | **`receivedQty`, `isPartial`** (kısmi kabul defteri) | ✔ | YOK (`subcontractorReceipt.delete` yok; iptal soft) |
| 7 | `SubcontractorReceiptProperty.receipt → SubcontractorReceipt` `:3552` | pivot | — | YOK |
| 8 | `KartelaDispatchItem.dispatch → KartelaDispatch` `:3880` | `dispatchedQty/Weight` | ✔ | YOK |
| 9 | `KartelaReceiptItem.receipt → KartelaReceipt` `:3936` | `kartelaCount` | ✔ | YOK |
| 10 | `TravelerCardScan.card → TravelerCard` `:3216` | okutma izi (istasyon, adım, kim, ne zaman) | ✔ | YOK (`travelerCard.delete` çağrısı yok; `batch.service.ts:307` yorumu "kart(lar) fiziksel silinir" **bayat**) |
| 11 | `RollProperty.roll → Roll` `:5046` | topun nitelikleri (+`valueId`) | — | YOK (`InventoryService.hardDelete` STOCK→CANCELLED soft, `inventory.service.ts:3516-3545`) |
| 12 | `WorkOrderTargetProperty.workOrder → WorkOrder` `:5008` | hedef özellik | — | YOK (`WorkOrderService.hardDelete` = `isActive=false` arşiv, `workorder.service.ts:4266`) |
| 13 | `UserPermission.user → User` `:590` | yetki grant'ı (+`grantedById`, pencere) | ✔ (yetki izi) | YOK (`user.delete` yok; `deletedAt`) |
| 14 | `UserPermission.permission → Permission` `:591` | aynı | ✔ | YOK (`permission.delete` çağrısı yok — katalog uzlaştırması izni getirir, silmez) |
| 15 | `UserPreference.user → User` `:515` | UI tercihi | — | YOK |
| 16 | `PermissionTemplateItem.template → PermissionTemplate` `:646` | şablon üyeliği | — | VAR: `permissionTemplate.delete` (`permission-management.service.ts:951`; sistem şablonu pasifleştirilir, fabrika şablonu silinir) |
| 17 | `PermissionTemplateItem.permission → Permission` `:647` | aynı | — | YOK |
| 18 | `CustomerBranch.customer → Customer` `:1912` | şube; `orders/shipments/sacks/direct_shipments.branchId` SN* ile bağlı | ✔ (adres tarihçesi) | VAR: `/customers/:id/permanent` (`customer.service.ts:361-395`) — guard `branchCount>0` bloklar |
| 19-22 | `CustomerItemAlias.customer/item`, `CustomerColorAlias.customer/color` `:4755-4756`, `:4797-4798` | müşteri alias'ı | — | müşteri/kumaş permanent (guard'lı); renk için permanent uç YOK |
| 23 | `CustomerTemplateRoute.customer → Customer` `:4943` | etiket yönlendirmesi | — | müşteri permanent |
| 24-25 | `CustomerStandaloneLabel.customer/template` `:4967-4969` | bağ | — | müşteri permanent; şablon "permanent" = `deletedAt` soft (`label-template.service.ts:566-593`) |
| 26 | `LabelTemplateVariant.template → LabelTemplate` `:4919` | kanvas yerleşimi | — | soft |
| 27-28 | `DevicePeripheral.device/peripheral` `:950-952` | cihaz↔donanım bağı | — | `device.delete` (`device.service.ts:342`, pivot>0 ise bloklar); donanım soft |
| 29 | `PeripheralTemplateRoute.peripheral → PeripheralDevice` `:965` | yönlendirme | — | donanım soft |
| 30 | `FabricPropertyValue.property → FabricProperty` `:4695` | KAT değer kataloğu (`roll_properties.valueId` R ile korunur) | — | permanent uç YOK |
| 31-32 | `ItemAllowedColor/Property.item → Item` `:4734`, `:4716` | izin listesi | — | kumaş permanent (guard: yalnız `workOrder.targetItemId` sayar, `item.service.ts:616-629`; diğerleri R* → P2003→409) |
| 33-34 | `ProductRecipeProperty.recipe`, `RouteStepProperty.routeStep` `:1219`, `:1151` | pivot | — | `guarded-hard-remove.ts` (rota/reçete) |
| 35 | `RouteStep.route → Route` `:1115` | rota adımı | — | `route.delete` (`guarded-hard-remove.ts:218`, WO izi guard'lı) |
| 36-37 | `StationColor.station/color` `:5076-5077` | deprecated tablo (49 satır saha) | — | `station.delete` (`guarded-hard-remove.ts:187`) |
| 38-39 | `StationProperty.station/property` `:5134-5135` | istasyon yeteneği (+`mode`) | — | istasyon permanent; özellik permanent YOK |
| 40-41 | `SubcontractorToCategory.subcontractor/category` `:3735-3736` | pivot | — | permanent uç YOK |

**Özet işaret:** 41 cascade'in **10'u** defter/iz satırı taşır (#1-2, #4-6, #8-10, #13-14, #18); bunların ebeveynini fiziksel silen kod yolu yalnız **#2/#3** (sipariş kalemi replace) ve **#18** (müşteri permanent, guard'lı) için var. Diğerleri yalnız elle SQL / ileride eklenecek bir yolla tetiklenebilir.

## 5. SET NULL (varsayılan) — soy bağı ve defter kolonlarında sessiz kopma adayları

Şemada `onDelete` yazılmadığı için **Prisma varsayılanı SET NULL** olan, ama anlamı "izlenebilirlik zinciri" olan kolonlar (DB `confdeltype='n'` listesinden süzüldü). Kural: ebeveyn silinirse çocuk satır kalır, bağ **sessizce NULL olur** — hata yok, log yok.

| Kolon (şema satırı) | Anlam | Ebeveyni fiziksel silen yol | İşaret |
|---|---|---|---|
| `rolls.parentRollId` `:1702` | Tambur kesim soy bağı | roll fiziksel silme YOK | düşük |
| `rolls.parentReceiptId` `:1705` | fason dönüşü doğum makbuzu | makbuz silme YOK | düşük |
| `rolls.batchId` `:1724` | parti üyeliği | `batch.delete` (`batch.service.ts:337`) yalnız `rollCount=0` iken | düşük |
| `rolls.currentStepId / producedInStepId` `:1713-1714` | konum / üretim adımı | `workOrderStep.delete` (`workorder.service.ts:5411`) — guard `_count` listesi `currentRolls`, `producedRolls`, `movements`, `cardScans`, `dispatches`, `receipts`, `operations`, `detectedErrors`, `processedErrors`, `kursunBypasses` sayar (`:5355-5375`); **`variances` ve `planDeviations` listede YOK** | orta (bkz. HOTSPOT H5) |
| `roll_variances.workOrderStepId` `:2894`, `roll_plan_deviations.workOrderStepId` `:2989` | defter satırının adımı | aynı yol; guard saymıyor | orta |
| `roll_errors.detectedAtStepId / processedAtStepId` `:2748-2749` | hata yaşam döngüsü adımı | aynı yol (guard sayıyor) | düşük |
| `traveler_card_scans.workOrderStepId` `:3218` | okutmanın eşlendiği adım | aynı yol (guard sayıyor) | düşük |
| `items.mergedIntoId`, `customers.mergedIntoId`, `subcontractors.mergedIntoId`, `colors.mergedIntoId` `:1300`, `:1878`, `:3717`, `:4557` | **birleştirme tombstone → survivor** bağı; aynı zamanda `nameFold` partial UNIQUE'in predicate'i (`WHERE mergedIntoId IS NULL`) | `/items/:id/permanent`, `/customers/:id/permanent` (guard'lar `mergedChildren` SAYMIYOR: `item.service.ts:616-629`, `customer.service.ts:361-395`) | **yüksek** (HOTSPOT H1): survivor silinirse tombstone'lar `mergedIntoId=NULL` ile canlıya döner ve partial unique'e yeniden girer |
| `batches.splitFromId / mergedIntoId` `:2283`, `:2285` | parti soy bağı | `batch.delete` guard `childCount`/`mergedChildCount` sayıyor (`batch.service.ts:317-331`) | düşük |
| `work_orders.splitFromId` `:2218` | tebdil/parti ayırma soy bağı | WO fiziksel silme YOK | düşük |
| `roll_operations.inheritedFromParentRollId` `:2803`, `roll_plan_deviations.childRollId` `:2987`, `swatches.parentRollId` `:3780` | top soy bağları | roll fiziksel silme YOK | düşük |
| `subcontractor_receipt_items.sourceDispatchItemId` `:3588`, `kartela_receipt_items.sourceDispatchItemId` `:3938` | kabul ↔ sevk kalemi eşlemesi | dispatch silme YOK | düşük |
| `roll_returns.fromShipmentId / orderId` `:4418`, `:4420` | iadenin kaynağı | sevkiyat/sipariş fiziksel silme YOK | düşük |
| `rolls.shipmentId / sackId`, `sacks.shipmentId`, `swatches.shipmentId / sackId` `:1721-1722`, `:4185`, `:3782-3783` | sevk/çuval bağı | `sack.delete` (`shipping.service.ts:1017`, boş çuval); sevkiyat silme YOK | düşük (bilinçli: iptalde NULL'lanır) |
| `sacks.customerId`, `routes.customerId`, `rolls.labelCustomerId` `:4183`, `:1051`, `:1719` | müşteri bağı | müşteri permanent — guard `sack`/`route` sayıyor, `labelCustomerId` saymıyor (önceki denetim F-CORE-VER-003 **reddedildi**: ayna kolon, kaynak `lastLabelSnapshot`) | düşük |
| `rolls.colorId`, `order_lines.colorId`, `work_orders.targetColorId`, `subcontractor_receipts.appliedColorId`, … (10 FK) | renk kimliği | renk için `/permanent` ucu YOK; `color.service.ts` `hardDelete` override yok → yalnız generic `BaseService.hardDelete` (`base.service.ts:1259-1275`) bir route'a bağlanırsa | düşük bugün, **ileride uç açılırsa yüksek** (10 tablo sessizce renksiz kalır) |
| `work_orders.targetItemId` `:2215` | hedef kumaş | kumaş permanent — guard sayıyor | düşük |
| `devices.machineId`, `peripheral_devices.machineId/stationId/deviceId` (3'ü açık SN `:867-874`) | donanım bağı | `machine.delete` (`guarded-hard-remove.ts:268`, önce `peripheralDevice.updateMany machineId=null` açık) | düşük |
| ~90 "kim yaptı" FK'sı (`createdById`, `updatedById`, `*ById`) | künye | `user.delete` YOK | düşük (bilinçli: künye kaybı yerine SN) |

**Not:** `KursunBypassAssignment.completedBy/cancelledBy` `:2485-2486` ve `Session.user` `:549`, `ShipmentOrder.shipment` `:4323`, `SackAllocation.sack` `:4345`, `WorkSession.machine` `:1019`, `DirectShipment.dispatch/customer` `:3440-3441`, 5 etiket şablonu FK'sı — yani şemada **açıkça** `Restrict` yazılan 12 ilişki — tam da bu sınıfa karşı konmuş bilinçli sedlerdir (her birinin yanında gerekçe yorumu var).

## 6. (d) ENUM listesi — 45 enum, tüm değerler + canlı dağılım (saha kopyası, 2026-08-25)

| Enum (şema satırı) | Değerler | Kullanan alan(lar) | Canlı dağılım (saha) / not |
|---|---|---|---|
| `StationType` `:23` | INTERNAL, EXTERNAL | `Station.type` | INTERNAL 4, EXTERNAL 2 |
| `StationKind` `:30` | RAW_QC, PROCESS_QC, TAMBUR, SUBCONTRACTOR, SHIPPING, OTHER | `Station.kind` (default OTHER) | RAW_QC 1, PROCESS_QC 1, TAMBUR 1, SHIPPING 1, SUBCONTRACTOR 2; **OTHER 0** |
| `FabricPropertyValueType` `:40` | FLAG, CHOICE | `FabricProperty.valueType` | FLAG 9, CHOICE 1 (KAT) |
| `StationPropertyMode` `:53` | AUTO, OPTIONAL, REQUIRED | `StationProperty.mode` (default OPTIONAL) | OPTIONAL 9, AUTO 1; **REQUIRED 0** |
| `RollOperationType` `:61` | KURSUN_APPLIED, QC2_COMPLETED, TAMBUR_PROCESSED, SUBCONTRACTOR_SENT, SUBCONTRACTOR_RETURNED | `RollOperation.operationType` | 7 / 7 / 110 / 825 / 637 |
| `ItemType` `:69` | YARN, FABRIC, CONSUMABLE | `Item.itemType` | FABRIC 228; diğerleri 0 |
| `RollEntrySource` `:77` | SUPPLIER_RECEIPT, MANUAL_ENTRY, TAMBUR_MANUAL, TAMBUR_SPLIT, SUBCONTRACTOR_RETURN, SEMI_FINISHED | `Roll.entrySource` | 1228 / 12 / 2 / 1040 / 149 / **SEMI_FINISHED 0** |
| `RollVarianceKind` `:110` | SCRAP, RECORD_CORRECTION, OVERAGE | `RollVariance.kind` | SCRAP 2, RECORD_CORRECTION 36, OVERAGE 37 (source: TAMBUR_FINALIZE / TAMBUR_OVERCUT) |
| `ReasonPresetKind` `:127` | ROLL_SCRAP, ROLL_RECORD_CORRECTION, ROLL_MANUAL_ENTRY, ROLL_CANCEL, ORDER_CANCEL, WORK_ORDER_REWORK | `ReasonPreset.kind` | 8 / 5 / 5 / 5 / **ORDER_CANCEL 0** / 6 (saha kopyasında ORDER_CANCEL değeri satırsız — migration eksik) |
| `SackWeightSource` `:147` | SCALE, MANUAL, SIMULATED | `Sack.weightSource?` | **41/41 NULL** (kolon tarihsel kayıtlardan sonra geldi; hiç tartı damgası yok) |
| `RollStatus` `:154` | STOCK, IN_PRODUCTION, SCRAP, CANCELLED, AT_SUBCONTRACTOR, A1_STOCK, RETURNED_FROM_SUBCONTRACTOR, WAREHOUSE, SHIPPED, TAMBUR_CONSUMED, SUBCONTRACTOR_CONSUMED, AT_KARTELA, KARTELA_CONSUMED | `Roll.status`, `Roll.preShipStatus?`, `Roll.preCancelStatus?`, `Roll.preTamburCloseStatus?`, `QualityGrade.targetStatus`, `QualityGrade.returnTargetStatus?`, `RollReturn.appliedStatus?` | STOCK 283 · IN_PRODUCTION 37 · SCRAP 1 · CANCELLED 230 · AT_SUBCONTRACTOR 188 · WAREHOUSE 250 · SHIPPED 689 · TAMBUR_CONSUMED 116 · SUBCONTRACTOR_CONSUMED 637 · **A1_STOCK 0 · RETURNED_FROM_SUBCONTRACTOR 0 · AT_KARTELA 0 · KARTELA_CONSUMED 0** (RETURNED_FROM_SUBCONTRACTOR kodda yalnız `in:[…]` filtre listelerinde: `inventory.service.ts:397,1160,1319,3729`, `workorder.service.ts:262,482`, `workorder-manual-move.service.ts:426,774`; trigger kaynak listesinde de var) |
| `RollForm` `:173` | TOP, ACIK | `Roll.form` (default TOP) | TOP 2282, ACIK 149 |
| `CompanyType` `:178` | CUSTOMER, SUPPLIER | `Customer.type` | CUSTOMER 27; SUPPLIER 0 |
| `DeviceKind` `:184` | TABLET, PHONE, DESKTOP | `Device.kind` | TABLET 16, DESKTOP 11, PHONE 1 |
| `OrderStatus` `:194` | PENDING, APPROVED, PARTIAL_SHIPPED, COMPLETED, CANCELLED | `Order.status` | APPROVED 235, PARTIAL_SHIPPED 27, COMPLETED 12, CANCELLED 4; **PENDING 0** |
| `WorkOrderType` `:202` | ORDER_PRODUCTION, STOCK_PRODUCTION | `WorkOrder.type` | 139 / 74 |
| `WorkOrderStatus` `:207` | PLANNED, IN_PROGRESS, COMPLETED, CANCELLED, SUPERSEDED | `WorkOrder.status` | PLANNED 1, IN_PROGRESS 84, COMPLETED 106, CANCELLED 22; **SUPERSEDED 0** |
| `StepStatus` `:220` | PENDING, ACTIVE, COMPLETED, SKIPPED | `WorkOrderStep.status` | 134 / 84 / 355 / 62 |
| `TravelerCardStatus` `:227` | ACTIVE, REPRINTED, VOIDED, COMPLETED | `TravelerCard.status` | ACTIVE 85, VOIDED 22, COMPLETED 106; **REPRINTED 0** (reprint aynı satırda `version++`, `:3159-3160`) |
| `ScanType` `:234` | ARRIVAL, DEPARTURE, INFO | `TravelerCardScan.scanType` | (sayılmadı) |
| `LabelKind` `:248` | ROLL_RAW, ROLL_FINISHED, SWATCH, SACK | `LabelTemplate.kind?` (deprecated), `PeripheralTemplateRoute.kind`, `CustomerTemplateRoute.kind`, `LabelContextDefault.kind` | bağlam default: ROLL_RAW 1, ROLL_FINISHED 1, SACK 1; SWATCH yok |
| `PrinterLanguage` `:258` | RASTER_HTML, PPLA, PPLB, ZPL | `PeripheralDevice.languageOverride?` | — |
| `PrinterMediaType` `:268` | DIRECT_THERMAL, THERMAL_TRANSFER | `PeripheralDevice.mediaType?` | — |
| `LabelOrientation` `:274` | PORTRAIT, LANDSCAPE | **HİÇBİR MODEL ALANI KULLANMIYOR; `src/` altında 0 referans** — ölü PG tipi | — |
| `ConnectionType` `:281` | NETWORK_TCP, BLUETOOTH_SPP, BLE, USB, SERIAL_COM | `PeripheralDevice.connectionType` | BLUETOOTH_SPP 6, NETWORK_TCP 1, USB 2 |
| `PeripheralKind` `:291` | LABEL_PRINTER, SCALE, METER, SIGNAL_SOURCE | `PeripheralDevice.kind` | LABEL_PRINTER 5, METER 3, SCALE 1 |
| `RollErrorAction` `:299` | CUT, NO_CUT | `RollError.actionTaken?` | NO_CUT 3 |
| `DefectSeverity` `:305` | MINOR, MAJOR, CRITICAL | `DefectType.severity?` | — |
| `SystemLogCategory` `:313` | DOMAIN, AUTH, SYSTEM | `SystemLog.category`, `SystemLogArchive.category` | DOMAIN 10037, AUTH 346, SYSTEM 102 |
| `PermissionCategory` `:320` | web, mobile, admin (küçük harf) | `Permission.category` | — |
| `ItemUnit` `:327` | MT, KG, ADET | `Item.unit` | MT 228 |
| `Currency` `:335` | TRY, USD, EUR, GBP | `Order.currency` | TRY 278 |
| `ClientType` `:344` | ELECTRON, MOBILE | `Session.deviceType` | MOBILE 115, ELECTRON 99 |
| `PeripheralReadMode` `:837` | POLL, STREAM | `PeripheralDevice.readMode` | — |
| `DeviceStatus` `:980` | PENDING, APPROVED | `Device.status` | APPROVED 28; PENDING 0 |
| `WorkSessionEndReason` `:987` | LOGOUT, NEW_LOGIN, TAKEOVER, IDLE, ADMIN | `WorkSession.endReason?` | LOGOUT 61, NEW_LOGIN 32, TAKEOVER 10, açık 3; **IDLE 0, ADMIN 0** |
| `KursunBypassCompletionSource` `:2403` | TAMBUR_SCAN, DISTRIBUTION_LAST_STEP | `KursunBypassAssignment.completedVia?` | TAMBUR_SCAN 2 |
| `DuplicateReviewEntity` `:3094` | CUSTOMER, ITEM, COLOR, SUBCONTRACTOR | `DuplicateReview.entity` | ITEM 6, SUBCONTRACTOR 3, COLOR 4 |
| `DuplicateReviewDecision` `:3101` | NOT_DUPLICATE, MERGED, DEFERRED | `DuplicateReview.decision` | MERGED 13 |
| `PrintedDocType` `:3985` | SHIPMENT_DISPATCH, SUBCONTRACTOR_DISPATCH, KARTELA_DISPATCH, SUBCONTRACTOR_DIRECT_SHIP, SUBCONTRACTOR_RECEIPT, QUALITY_CERTIFICATE, RETURN_DISPATCH, TRAVELER_CARD | `PrintedDocument.docType` | SHIPMENT_DISPATCH 40 · SUBCONTRACTOR_DISPATCH 214 · SUBCONTRACTOR_RECEIPT 7 · QUALITY_CERTIFICATE 1 · RETURN_DISPATCH 4 · TRAVELER_CARD 62; KARTELA_DISPATCH / SUBCONTRACTOR_DIRECT_SHIP 0 (`TRAVELER_CARD` "kendi kendini yöneten" tip, `:3996-4002`) |
| `PrintedDocStatus` `:4005` | ACTIVE, SUPERSEDED, VOIDED | `PrintedDocument.status` | ACTIVE 300, SUPERSEDED 22, VOIDED 6 |
| `ShipmentStatus` `:4106` | PLANNED, DISPATCHED, CANCELLED | `Shipment.status` | PLANNED 1, DISPATCHED 39; CANCELLED 0 |
| `ShipmentDestination` `:4115` | DOMESTIC, EXPORT | `Shipment.destination` | DOMESTIC 40 |
| `TravelerTemplateMode` `:5307` | BUILTIN, SECTIONS, RAW_HTML | `TravelerCardTemplate.mode` | 0 satır |
| `ImportRunStatus` `:5365` | APPLIED, PARTIAL, FAILED | `ImportRun.status` | 0 satır |

Enum'ların **mobil/Electron ikizleri** ayrı dosyalarda tutulur (Electron backend'i import edemez — CLAUDE.md); ayrışma bekçileri bu haritanın kapsamı dışında (bkz. sınır ötesi).

## 7. Json alanları — 25 alan / 18 model (oku-değiştir-yaz kayıp güncelleme adayları)

Yöntem: beceri §3.3/§12 grep'leri (`jsonb_set` kullanımı: **0**; `...x.jsonField` yayılımı 5 vuruş; `jsonField: { ...` 1 vuruş) + alan başına `services/` altında yazan dosya sayısı. "RMW sınıfı": **tam-yaz** = her yazım nesnenin tamamını yeniden üretir (kayıp yok) · **oku-yay-yaz** = satır okunup yayılarak geri yazılır · **append** = yalnız create.

| Model.alan (şema satırı) | Yazan dosya (services/) | Desen | RMW sınıfı / not |
|---|---|---|---|
| `UserPreference.preferences` `:513` | `user-preference.service.ts` (upsert :36-53) | tam-yaz, kullanıcı-başına | kayıp yok (tek yazar = kullanıcının kendisi) |
| `WorkOrder.parameters?` `:2162` | `workorder.service.ts:1019` (create), `:5518` (replace), `helpers/workorder-clone.helper.ts:121` (klon) | tam-yaz | `parameters.rework` rapor anahtarı (`buildReworkPlan`); saha'da 2 dolu |
| `WorkOrderStep.stepData?` `:2324` | `tambur.service.ts:1140-1155` — **tx içinde `findUnique → {...existing, tamburDecidedAt, foldType} → update`**; `workorder-clone.helper.ts:137` kopya | **oku-yay-yaz** (tek akış, aynı anahtarlar) | beceri §12 kuralı: tek akış + aynı anahtar → son yazan kazanır, bulgu değil; **saha'da 0 dolu satır** (kolon fiilen kullanılmıyor, Roll.foldType'a taşındı `:1416-1435`) |
| `Roll.lastLabelSnapshot?` `:1534` | `label.service.ts` (tam-yaz + `labelCustomerId` aynası aynı tx `:1590-1610`), `tambur.service.ts`, `inventory.service.ts`, `helpers/sack-content-mismatch.helper.ts` (oku/null) | tam-yaz | 4 dosya ama tek üretici |
| `RollOperation.metadata?` `:2792` | `tambur.service.ts:1212`, `:3340`, `kursun-qc.service.ts:450`, `:470` (upsert), `inventory.service.ts`, `subcontractor.service.ts`, `work-session-activity.service.ts` | upsert (`update: {}` — ikinci çağrı metadata'yı güncellemez, `:2926-2928`) | append benzeri; 1586 dolu |
| `DuplicateReview.evidence?` `:3119` | `duplicate-review.service.ts`, `duplicate-detection.service.ts` | snapshot | — |
| `SystemSetting.value` `:3142` | `system-setting.service.ts:1032-1050` `set()` — anahtar başına `findUnique` (yalnız audit oldData) → `upsert`; `setDocumentsLogo` süreç-içi kuyruk (A8, `:1091-1099`); `jobs/*` ve `db-copy.service.ts:288` upsert | anahtar başına tam-yaz | `documentsConfig`/`travelerCardConfig`/`companyLetterhead` istemciden TAM nesne gelir (`:1510-1560`) → iki admin farklı alt alanı aynı anda düzenlerse **istemci tarafı** son-yazan-kazanır (sunucu RMW değil) |
| `TravelerCard.snapshot?` `:3190` | `traveler-card.service.ts` (`recordPrintEvent` tam-yaz; `:933`/`:1025` yayılımlar RENDER kopyasına, satıra yazmaz) | tam-yaz + `version: existing.version + 1` (`:284`, read+1) | bkz. HOTSPOT H7 |
| `Manifest.snapshot` `:3959` | (0 satır saha; model canlı kullanımda değil) | donmuş | — |
| `PrintedDocument.snapshot` `:4022` | `printed-document.service.ts` (create-only; meta alanları update) | immutable | — |
| `DocumentProfile.config` `:4052` · `FreeDocument.config` `:4084` · `TravelerCardTemplate.config` `:5286` | ilgili servisler | tam-yaz | — |
| `LabelTemplate.fields` `:4857` · `LabelTemplate.rawCode?` `:4861` · `LabelTemplateVariant.elements` `:4927` | `label-template.service.ts` (`:334`, `:662` `...(input.rawCode ? …)` yalnız data-object yayılımı) | tam-yaz | — |
| `SystemLog.oldData?/newData?/changes?` `:5161-5170` · `SystemLogArchive.changes?/oldData?/newData?` `:5224-5230` | `audit.service.ts` | append | trigger ile UPDATE/DELETE engelli |
| `EndpointLatencyDaily.buckets` `:5254` | `latency-persist.service.ts:126-154` — `findFirst → topla → update / create` | **oku-topla-yaz** | tek process + tek flush; `@@unique([day,routeKey])` çakışan create'i P2002 ile düşürür; 3117 satır |
| `ImportRun.options?/errorReport?` `:5353-5355` | `import/import.service.ts` | append | 0 satır |

## 8. Decimal alanları — 48 alan, hepsi `@db.Decimal(p,s)`

| (p,s) | Alanlar |
|---|---|
| **(12,3)** — 40 alan | `Roll.initialQty/currentQty/weightKg?/width?/preTamburCloseQty?` · `OrderLine.quantity/shippedQty/width?/pieceLengthM?` · `Order.shippedQty` · `WorkOrder.width?/targetQuantity?/targetWeight?` · `WorkOrderToOrderLine.allocatedQty` · `RollError.startMeter` · `RollMovement.qtyIn/qtyOut?/weightIn?/weightOut?` · `RollVariance.qty` · `RollPlanDeviation.qtyM` · `SubcontractorDispatch.totalQty` · `SubcontractorDispatchItem.dispatchedQty/dispatchedWeight?` · `SubcontractorDirectShipAllocation.qty` · `DirectShipment.totalQty` · `SubcontractorReceipt.appliedWidth?` · `SubcontractorReceiptItem.receivedQty?` · `Swatch.width?/length?/weightKg?` · `KartelaDispatch.totalQty` · `KartelaDispatchItem.dispatchedQty/dispatchedWeight?` · `Sack.weightKg?` · `SackAllocation.qty` · `RollReturn.width?/qty` · `ProductRecipe.width?` |
| (14,2) | `Order.totalAmount?` |
| (12,2) | `OrderLine.unitPrice?` |
| (10,4) | `PeripheralDevice.scale?` |
| (6,2) | `PeripheralDevice.labelWidthMm?/labelHeightMm?` · `LabelTemplateVariant.widthMm/heightMm` |
| (5,2) | `PeripheralDevice.labelGapMm?` |
| (4,1) | `LabelTemplate.lineStepMm?` |

Metraj/kg/en hepsi (12,3): tavan 999.999.999,999; ölçek 3 (mm hassasiyeti). Float **0** (künye ile uyumlu). DB'de `information_schema.columns` 48 `numeric` kolon, precision NULL olan **0**.

## 9. Soft-delete / durum damgası envanteri + zaman damgası konvansiyonu

| Mekanizma | Modeller |
|---|---|
| `isActive` bayrağı | User, PermissionTemplate, Station, Machine, Device, PeripheralDevice, Route, ProductRecipe, Item, Customer, CustomerBranch, WorkOrder (arşiv = `isActive=false`, `:2191-2198`), QualityGrade, ReturnReason, DefectType, ReasonPreset, SubcontractorCategory, Subcontractor, DocumentProfile, FreeDocument, Color, FabricProperty, FabricPropertyValue, LabelTemplate, TravelerCardTemplate, ShipmentOrder (**denorm "sevkiyat PLANNED mı" bayrağı**, `:4315-4320`) |
| `deletedAt` (kalıcı silinme damgası, ad/kod `DEL-` ile serbest bırakılır) | User `:376`, PeripheralDevice `:895`, LabelTemplate `:4871`, TravelerCardTemplate `:5290` |
| `mergedIntoId` (birleştirme tombstone'u) | Item `:1300`, Customer `:1878`, Subcontractor `:3717`, Color `:4557`, Batch `:2280` |
| `cancelledAt` (+`cancelledById`/`cancelReason`, bazılarında `cancelReasonCode`) | Roll `:1573-1580`, Order `:1985-1993` (saha'da yok), OrderLine `:2073-2079` (saha'da yok), WorkOrder `:2227-2230`, KursunBypassAssignment `:2472-2474`, SubcontractorDispatch `:3305-3307`, SubcontractorReceipt `:3510-3512`, Swatch `:3773-3774`, KartelaDispatch `:3851-3853`, KartelaReceipt `:3903-3905`, RollReturn `:4396-4398` |
| Diğer durum damgaları | `RollVariance.reversedAt` `:2889` (tersleme, silme değil) · `Session.revokedAt` `:544` · `WorkSession.endedAt` `:1010` · `TravelerCard.voidedAt` `:3171` · `PrintedDocument.supersededAt/voidedAt` `:4025-4026` · `SubcontractorDispatchItem.remainderClosedAt` `:3362` · `Order.completedAt` `:1996` · `WorkOrderStep.completedAt` `:2328` · `SubcontractorDispatch.directShippedAt` `:3313` · `SystemLogArchive.archivedAt` `:5231` |
| Statü-tabanlı (kolon yok) | Roll `CANCELLED`/`SCRAP` (+`preCancelStatus`) · WorkOrder `CANCELLED`/`SUPERSEDED` · **Shipment `CANCELLED` — `cancelledAt` kolonu YOK** · Order `CANCELLED` (+`cancelledAt` yeni) |
| Roll üstündeki "önceki hâl" snapshot aile | `preShipStatus` `:1361` (688 dolu / 689 SHIPPED), `preCancelStatus` `:1588` (CANCELLED'ların 134/230'u NULL → geri alma `STOCK` varsayar), `preTamburCloseQty/Status` `:1630`/`:1637` |
| Trigger'lı üretim damgaları | `Roll.finalizedAt` (1035 dolu) / `statusChangedAt` (2392 dolu) — **uygulama yazmaz**, `rolls_stamp_production_timestamps` BEFORE trigger yazar (kaynak statü listesi `IN_PRODUCTION, STOCK, AT_SUBCONTRACTOR, RETURNED_FROM_SUBCONTRACTOR` → hedef `WAREHOUSE, A1_STOCK, SCRAP`; `SHIPPED`/`CANCELLED` bilinçli dışarıda) |

**Zaman damgası konvansiyonu (kök CLAUDE.md: tüm modellerde `createdAt`+`updatedAt`, pivot/append-only'de yalnız `createdAt`):**

| Sınıf | Modeller (`updatedAt` YOK) |
|---|---|
| Pivot (bilinçli) | PermissionTemplateItem, DevicePeripheral, RouteStepProperty, ProductRecipeProperty, OrderLineRequiredProperty, SubcontractorReceiptProperty, SubcontractorToCategory, ItemAllowedProperty, ItemAllowedColor, CustomerStandaloneLabel, WorkOrderTargetProperty, RollProperty (`valueId` taşır ama replace deseniyle yazılır) |
| Append-only defter (bilinçli, yorumlu) | RollOperation, RollVariance (`reversedAt` sonradan yazılır — "işaret, güncelleme değil" `:2879-2889`), RollPlanDeviation, TravelerCardScan, SwatchStockReduction, SystemLog (`:5183-5187` "updatedAt OLMAMALI"), ImportRun, SackAllocation (sil-yaz) |
| **Mutasyona uğrayan ama `updatedAt` taşımayan** (konvansiyonla çelişen adaylar) | **`SubcontractorDispatchItem`** (`remainderClosedAt` sonradan damgalanır `:3362`) · **`SubcontractorReceiptItem`** (`receivedQty/isPartial` doğuşta) · **`ShipmentOrder`** (`isActive` dispatch/cancel'da false'a çekilir `:4317-4318`) · **`KartelaDispatchItem`, `KartelaReceiptItem`** (append) · **`SubcontractorDirectShipAllocation`** (append) |
| `createdAt` da yok | **`RollBarcodeCounter`** `:2709-2716` (sayaç; `updatedAt` de yok) |
| `updatedAt` var ama `@updatedAt` DEĞİL | `SystemLogArchive.updatedAt` `:5233` (arşivleyici `createdAt` değerini kopyalar, `audit.service.ts:255-258`) |

## 10. `clientToken @unique` envanteri (idempotency anahtarı)

| Model (satır) | DB unique biçimi | Yazan yol | Not |
|---|---|---|---|
| Roll `:1331` | partial `WHERE clientToken IS NOT NULL` | KK1 ham giriş (mobil) | 172/2431 NULL (sunucu üretimi: kesim çocuğu, fason dönüşü) |
| Order `:1965` | partial | sipariş formu | — |
| WorkOrder `:2157` | partial | İE formu / Hızlı İE; `hardDelete` (zero-attach telafisi) token'ı NULL'lar `:2156` | — |
| SwatchStockReduction `:3810` | partial | kartela düşüm olayı | 0 satır |
| Sack `:4133` | **düz** | `openSack` replay (A4) | — |
| Shipment `:4220` | **düz** | `createShipment` replay (A4) | — |
| SubcontractorReceipt `:3474` | **düz** | fason kabul (kısmi kabulle replay'in TEK kimliği) | saha'da dolu **2/143** → eski APK'lar token göndermiyor; küme-eşitliği guard'ı yalnız `isPartial=false` için (`:3469-3473`) |
| ImportRun `:5339` | **düz** | içe aktarım | 0 satır |
| **Token YOK** | SubcontractorDispatch, KartelaDispatch, KartelaReceipt, RollReturn, DirectShipment, Batch, RollVariance, RollPlanDeviation, KursunBypassAssignment, TravelerCard print-event | | bu uçların replay koruması (advisory lock / claim / `@@unique`) K-eşzamanlılık denetçisinin konusu |

Düz ↔ partial farkı PG'de davranış farkı yaratmaz (NULL'lar unique'e girmez); yalnız index boyutu ve Prisma drift raporu (`test_db_invariants` §1 partial envanteri) etkilenir.

## 11. Unique anahtarda NULL'lanabilir kolon (PG: NULL ≠ NULL)

| Kısıt (satır) | NULL kolon | Bilinçli mi | Saha verisi |
|---|---|---|---|
| `Roll.barcode? @unique` `:1326` | barcode | evet (açık kumaş barkodsuz, `:1323-1326`) | 148 NULL |
| `Roll/Order/WorkOrder/Sack/Shipment/SubcontractorReceipt/SwatchStockReduction/ImportRun.clientToken?` | clientToken | evet | — |
| `User.cardToken?/quickPin?` `:366/:371` | ikisi | evet | cardToken 9/9 NULL |
| `Route.code?` `:1043`, `PermissionTemplate.code?` `:614` | code | evet | — |
| `CustomerBranch @@unique([customerId, code])` `:1952` | code | evet (kodsuz şube serbest) | 0 NULL |
| `RollError @@unique([rollId, startMeter, defectTypeId])` `:2763` | defectTypeId | evet — DB partial `WHERE defectTypeId IS NOT NULL` | 0 NULL; mükerrer (roll,startMeter) 0 |
| `SubcontractorDirectShipAllocation @@unique([directShipmentId, orderLineId])` `:3408` | directShipmentId | evet (eski kayıt) | 0 NULL |
| `Sack @@unique([shipmentId, seq])` `:4195` | ikisi | evet (havuz çuvalı) | havuz 0, sevkiyatta seq NULL 0 |
| `Sack @@unique([id, shipmentId])` `:4202` | shipmentId | evet (FK hedefi; `id` zaten PK) | — |
| `Item/Customer/Subcontractor @@unique([nameFold])` | nameFold (DB-üretimli; `name` NOT NULL → pratikte NULL değil) | — | — |
| `LabelTemplate.kind?` (deprecated) + DB partial `label_templates_one_default_per_kind (kind) WHERE isDefault=true` | kind | evet (v2 havuzda kind null doğar `:4844-4846`) | kind dolu 5, isDefault 4 |

## 12. Şema-dışı DB nesneleri (K2b'nin alanı — burada yalnız envanter köprüsü)

Prisma şemasının temsil edemediği ve `scripts/test_db_invariants.ts` ile bekçilenen nesneler (saha kopyasında doğrulandı):

| Sınıf | Adet | Örnekler / kaynak |
|---|---|---|
| Partial index | 39 (`pg_indexes … WHERE`) — 15'i UNIQUE | `roll_movements_one_open_per_roll_step_uq`, `kursun_bypass_one_pending_per_step_uq`, `work_sessions_active_*_uq`, `label_templates_one_default_per_kind`, `label_template_variants_one_primary`, `traveler_card_templates_isDefault_key`, `roll_errors_roll_meter_defect_uq`, `*_clientToken_key` ×4, `customers/items/subcontractors_nameFold_key`; null-yoğun FK index'leri (`rolls_*`, `swatches_*`, `batches_*`, `*_mergedIntoId_idx`, `work_orders_splitFromId_idx`, `roll_returns_returnGroupId_idx`), `work_order_steps_stationId_status_…_idx (status<>COMPLETED)`, `roll_errors_isProcessed_idx (=false)`, `orders_active_createdAt_idx (status<>CANCELLED)` (saha'da yok) — envanter `test_db_invariants.ts:96-195` |
| Expression unique | 3 | `users_username_lower_uq`, `permission_templates_name_lower_uq`, `colors_nameFoldColor_key` (`tr_fold_color(name)` + predicate) — `test_db_invariants.ts:263-280` |
| CHECK | 26 | §3 sonu; `test_db_invariants.ts:197-232` |
| Trigger | 3 | `rolls_stamp_production_timestamps` (BEFORE INSERT OR UPDATE, `Roll.finalizedAt/statusChangedAt` tek yazma noktası) · `system_logs_block_tamper` / `system_log_archives_block_tamper` (BEFORE DELETE/UPDATE/TRUNCATE, statement-level; fonksiyon `audit_block_tamper` GUC `teks.audit_guard='on'` iken engeller, `teks.audit_purge='on'` ile arşivleyici geçer — saha kopyasında GUC **tanımsız** = koruma kapalı) — `test_db_invariants.ts:281-322` |
| GENERATED STORED kolon | 33 (`tr_fold(...)`) | `*.nameFold`, `customer_branches.cityFold`, `order_lines.customerItemNameFold`, `shipments.plateNumberFold/driverNameFold/carrierFold`, `roll_returns.reasonTextFold/noteFold`, `direct_shipments.reasonFold`, `*_aliases.aliasFold`, `*.descriptionFold`, `fabric_properties.categoryFold`, `peripheral_devices.addressFold`; şemada `@default(dbgenerated())` ile temsil (`:625-631` notu) |
| DEFERRABLE bileşik FK | 2 | `rolls_sackId_shipmentId_consistency_fkey`, `swatches_sackId_shipmentId_consistency_fkey` → `sacks(id, shipmentId)` ON UPDATE CASCADE, ON DELETE NO ACTION, INITIALLY DEFERRED (`:4196-4201`; `migrate dev` DROP etmek ister) |
| Extended statistics | 1 | `sl_day_exact` (`system_logs`, Europe/Istanbul gün ifadesi) |
| Fonksiyon / collation / uzantı | `tr_fold` (IMMUTABLE, NFD + translate + lower COLLATE "C"), `tr_fold_color`, `tr_sort` collation, `pg_trgm` | `test_db_invariants.ts:324-362` |

## 13. Şema ↔ DB unique diff (mekanik: şemadan üretilen Prisma adları ↔ `pg_indexes`)

| Yön | Saha (190 migration) | Dev (195 migration) |
|---|---|---|
| Şemada var, DB'de YOK | **`items_nameFold_key`** (yumuşak kapı: 1 canlı mükerrer grup) | — (tam) |
| DB'de var, şemada YOK (şema-dışı unique) | `colors_nameFoldColor_key`, `kursun_bypass_one_pending_per_step_uq`, `label_template_variants_one_primary`, `label_templates_one_default_per_kind`, `permission_templates_name_lower_uq`, `roll_movements_one_open_per_roll_step_uq`, `users_username_lower_uq`, `work_sessions_active_device_uq`, `work_sessions_active_machine_uq` (+`_prisma_migrations_pkey`) | aynı liste **eksi `colors_nameFoldColor_key`** (dev'de 1 canlı mükerrer renk grubu → yumuşak kapı atladı) |
| FK aksiyon paritesi | c 41 · r 71 · n **167** · a 2 | c 41 · r 71 · n **168** · a 2 (şema beklentisi 41/71/168 — saha'daki eksik `order_lines.cancelledById`) |
| CHECK / trigger | 26 / 3 | 26 / 3 |

Yani iki ortam da "enforce bekleyen" yumuşak kapı index'i taşıyor, ama **farklı tabloda** (saha: items · dev: colors) — `test_db_invariants` §1/§5 kırmızısı iki ortamda farklı satıra düşer.

## HOTSPOTLAR

② denetçilerinin öncelikle bakması gereken yerler (öncelik sırasıyla; hepsi işaret, yargı değil):

1. **`Teks-Erp/prisma/schema.prisma:1300`, `:1878`, `:3717`, `:4557` (`Item/Customer/Subcontractor/Color.mergedInto` self-FK, `onDelete` yazılmamış → SET NULL) + `Teks-Erp/src/services/item.service.ts:616-629`, `customer.service.ts:361-395`** — `/items/:id/permanent` ve `/customers/:id/permanent` uçları survivor'ı fiziksel siler; guard listeleri `mergedChildren` SAYMIYOR. Survivor silinirse tombstone'lar `mergedIntoId=NULL` ile "canlı"ya döner ve `nameFold` partial UNIQUE'in kapsamına yeniden girer (aynı katlanmış adı taşıyan 2 tombstone → SET NULL'ın kendisi unique ihlaliyle düşer, tek tombstone → sessizce canlı mükerrer). Neden: `mergedIntoId` hem soy bağı hem unique predicate'i; SET NULL ikisini birden bozar. → K2b (drift/kısıt) + master-data birleştirme denetçisi.
2. **`schema.prisma:1017-1020` (WorkSession FK'ları: "Ayak izi tarihçesi korunur — hiçbir taraf silinirken oturum geçmişi kaybolmaz") ↔ `Teks-Erp/src/services/helpers/guarded-hard-remove.ts:183`, `:267`** — istasyon/makine kalıcı silmede `tx.workSession.deleteMany` ile oturum geçmişi fiziksel siliniyor (RESTRICT'i aşmak için). Şema niyeti ile kod çelişiyor; tek kalan iz `SystemLog`. → master-data / audit denetçisi.
3. **`schema.prisma:2098` + `:2507` + `Teks-Erp/src/services/order.service.ts:2434-2447`** — sipariş kalemi replace'i `orderLine.deleteMany` ile kalem siler; `work_order_to_order_lines` CASCADE ile düşer. Guard yalnız `status notIn [CANCELLED, SUPERSEDED]` WO bağlarını sayar → iptal/devredilmiş WO'nun kalem bağı (ve `allocatedQty`) sessizce yok olur; `sack_allocations`/`subcontractor_direct_ship_allocations` RESTRICT'i tx içinde P2003'e düşer (mesaj?). → sipariş denetçisi.
4. **`schema.prisma:3397` (`SubcontractorDirectShipAllocation.dispatch → CASCADE`) ve `:3365`, `:3586`** — `OrderLine.shippedQty`'nin ikinci kaynağı olan tahsis defteri ebeveyn fason sevkine cascade'li; bugün fiziksel silme yolu yok, ama `master-data-merge.service.ts:842-893` ham `DELETE FROM` kuralları ve ileride açılacak bir "sevki sil" ucu bu defteri sessizce boşaltır. → fason/muhasebe denetçisi ("defter satırı cascade" sınıfı, #4-#10).
5. **`Teks-Erp/src/services/workorder.service.ts:5355-5411`** — adım silme guard'ının `_count` listesi `variances` ve `planDeviations` ilişkilerini saymıyor; `roll_variances.workOrderStepId` (`:2894`) ve `roll_plan_deviations.workOrderStepId` (`:2989`) SET NULL → PENDING bir adımın defter satırı varsa (depo kesimi dışı yollarda pratikte movement de olur) bağ sessizce kopar. Düşük olasılık, ama guard listesi ile SET NULL ilişki kümesi ayrışmış. → iş emri denetçisi.
6. **`schema.prisma:4036` + `Teks-Erp/src/services/printed-document.service.ts:329-341`, `:654-685`** — `version = max+1` okuma-sonra-yazma; `@@unique([docType, sourceId, version])` yarışın kaybedenini P2002'ye düşürür. P2002 yakalama yalnız lazy-init dalında (`:414-419`) görünüyor; `reissue` dalında (`:685`) yakalama var mı doğrulanmalı. → belge/eşzamanlılık denetçisi.
7. **`schema.prisma:3190` + `Teks-Erp/src/services/traveler-card.service.ts:284`** — `TravelerCard.version: existing.version + 1` (read+1, `{ increment: 1 }` değil) ve `version` kolonunda tekillik yok; iki eşzamanlı print-event aynı sürümü yazabilir. `PrintedDocument TRAVELER_CARD` satırı `(docType, sourceId, version)` unique'i ile ikinciyi P2002'ye düşürür mü, kart satırı ile belge satırı aynı tx'te mi → belge denetçisi.
8. **`schema.prisma:1340-1341` (`Roll.initialQty/currentQty`; damgalar `:1674`/`:1688`)** — DB'de `currentQty >= 0` ve `initialQty >= 0` var, **`currentQty <= initialQty` YOK** (aşım meşru: `tambur.overQuantityEnabled`). 2026-08-22 §13 vakası (`cur 120 > init 100`) tam bu boşluktan geçti; DB seddi eklenemez, bekçi `test_consistency §13` tek koruma. → K2b/tambur denetçisi (bilgi).
9. **`schema.prisma:3474` (`SubcontractorReceipt.clientToken`)** — kısmi kabulle "replay'in TEK kimliği" ilan edilmiş ama saha'da **2/143** makbuzda dolu; token'sız makbuzda replay koruması küme-eşitliği guard'ına düşer ve o guard yalnız `isPartial=false` için çalışır (`:3469-3473`). → fason/idempotency denetçisi.
10. **`schema.prisma:2324` (`WorkOrderStep.stepData`) + `Teks-Erp/src/services/tambur.service.ts:1140-1155`** — tx içinde `findUnique → {...existing} → update` oku-yay-yaz (READ COMMITTED altında tx koruma vermez, beceri §3.1); aynı adımda N top eşzamanlı finalize olursa `tamburDecidedAt/foldType` son yazan kazanır. Tek akış + aynı anahtar → beceri §12'ye göre bulgu değil; saha'da kolon **0 dolu** (fiilen ölü kolon). → tambur denetçisi (bilgi).
11. **`schema.prisma:3142` (`SystemSetting.value`) + `Teks-Erp/src/services/system-setting.service.ts:1510-1560`** — `documentsConfig`/`travelerCardConfig`/`companyLetterhead` istemciden TAM nesne olarak gelir ve anahtar başına tam-yaz edilir; iki admin farklı alt alanı aynı anda düzenlerse istemci tarafı son-yazan-kazanır. Sunucu RMW yok (`set()` upsert), `setDocumentsLogo` süreç-içi kuyruklu (A8). → ayarlar denetçisi (düşük).
12. **`schema.prisma:274` (`LabelOrientation`)** — hiçbir model alanı ve `src/` altında 0 referans; ölü PG enum tipi. Kaldırılması `DROP TYPE` migration'ı ister (prod canlı). → K2b (bilgi).
13. **`schema.prisma:4106-4110` (`ShipmentStatus.CANCELLED`) + `Shipment` modelinde `cancelledAt` kolonu YOK** — sevkiyat iptali yalnız statüyle izlenir; "kim/ne zaman/neden iptal etti" kolonda değil audit'te (6 ayda arşivlenir — `Roll.cancelledAt` `:1566-1580` notundaki gerekçe burada uygulanmamış). Saha'da CANCELLED 0. → sevkiyat denetçisi (bilgi).
14. **`schema.prisma:3362` (`SubcontractorDispatchItem.remainderClosedAt`) ve `:4317` (`ShipmentOrder.isActive`)** — sonradan mutasyona uğrayan alanlar, model `updatedAt` taşımıyor (kök konvansiyon "append-only'de yalnız createdAt" bu iki modele tam oturmuyor). → K2b (bilgi).
15. **`schema.prisma:1590-1610` (`Roll.labelCustomerId`) + `customer.service.ts:361-395`** — müşteri permanent guard'ı `labelledRolls`'u saymıyor (SET NULL). Önceki denetimde **reddedildi** (ayna kolon, kaynak `lastLabelSnapshot`); yeniden açılmamalı — burada yalnız "bilinçli boşluk" olarak kayıtlı.
16. **`schema.prisma:2260-2316` (`Batch`, unique YOK) — saha'da 92 mükerrer parti numarası grubu; kodda `batchNumber` ile lookup yok (`batch.service.ts:134` yalnız sayaç kaynağı `gte/startsWith`).** Yeni bir `findFirst({ where: { batchNumber } })` yazan her yol yanlış partiyi bulur → AST/grep bekçisi var mı → parti denetçisi.
17. **Defter tablolarında fiziksel silme (konvansiyon "soft delete" ile ayrışan bilinçli istisnalar):** `rollMovement.deleteMany` ×4 (`kursun-qc.service.ts:1097`, `subcontractor.service.ts:4835`, `:5373`, `workorder-manual-move.service.ts:643`), `rollOperation.deleteMany` ×7 (`subcontractor.service.ts:2086`, `:4964`, `:5366`, `:5452`, `tambur-undo.service.ts:1353`, `:1597`, `workorder-manual-move.service.ts:667`), `rollError.deleteMany` (`kursun-qc.service.ts:720`, atomik `isProcessed:false` guard'lı), `rollProperty.deleteMany` ×5, `systemLog.deleteMany` (`audit.service.ts:261`, `SET LOCAL teks.audit_purge` ile), `sackAllocation.deleteMany` ×2, `shipmentOrder.deleteMany`, `workOrderToOrderLine.deleteMany` ×4. Hepsi geri alma/iptal/replace yollarında; **her biri bir "ters kayıt yerine silme" kararı** → undo/iptal denetçileri (`production.report.service.ts:109` sayımı gibi rapor etkileri yorumlarda belgeli).

## SINIR ÖTESİ NOTLAR

- **→ J Migration/kurtarma + C Veri modeli (K2b haritası):** (a) saha kopyasında 5 migration eksik — `Order/OrderLine` iptal kolonları, `orders_active_createdAt_idx`, `ReasonPresetKind` yeni değerleri; (b) yumuşak kapı index'leri iki ortamda farklı tabloda eksik (saha `items_nameFold_key`, dev `colors_nameFoldColor_key`) → `test_db_invariants` §1/§5 her ortamda farklı kırmızı; (c) `LabelOrientation` ölü enum; (d) `Manifest` modeli 0 satır, `StationColor` deprecated (49 satır); (e) `Shipment/Sack/SubcontractorReceipt/ImportRun.clientToken` düz unique, diğer 4'ü partial — desen tutarsız; (f) 26 CHECK + 3 trigger + 2 DEFERRABLE FK + 33 GENERATED + 3 expression unique + 39 partial index şema-dışı; (g) `SubcontractorDispatchItem`/`ShipmentOrder` mutasyonlu ama `updatedAt`'siz.
- **→ A Eşzamanlılık + B Mükerrer/idempotency:** `PrintedDocument.version max+1` (H6), `TravelerCard.version read+1` (H7), `RollBarcodeCounter ON CONFLICT` sayacı (`:2705-2708`), `Batch` advisory lock 8022, `RollMovement` partial unique "tek açık hareket" (224 açık hareket saha), `WorkSession` partial unique'ler, `KursunBypassAssignment` partial unique, `EndpointLatencyDaily` findFirst→create yarışı, `SystemSetting.set()` findUnique→upsert (yalnız audit oldData etkilenir).
- **→ G Güvenlik (kimlik/oturum):** saha'da `sessions` tablosunda **10 satır `expiresAt < now()` ve `revokedAt IS NULL`** — auth middleware `expiresAt`'e de bakıyor mu, yoksa yalnız `revokedAt`'e mi? `Session.deviceId` FK'sız serbest string (bilinçli). `User.quickPin` düz saklanır, sistem genelinde unique (`:367-371`).
- **→ B Mükerrer/idempotency + E İş kuralı (fason):** `SubcontractorReceipt.clientToken` dolu 2/143 (H9); `SubcontractorReceiptItem.newRollId` adı yanıltıcı (orijinal top); `receivedQty` NULL 635/638 → rapor `COALESCE(receivedQty, roll.currentQty)` varsayımı (`:3572-3575`); `RollStatus.RETURNED_FROM_SUBCONTRACTOR` saha'da 0 satır ama 8 filtre listesinde + trigger kaynak listesinde yaşıyor — hâlâ yazan bir yol var mı?
- **→ E İş kuralı + C Veri modeli (sevkiyat):** `Shipment.cancelledAt` yok (H13); `Sack.weightSource` 41/41 NULL (tartı kaynağı hiç damgalanmamış — simüle/gerçek ayrımı saha verisinde yok); `SackAllocation` çuval×satır (top değil) — "hangi top hangi siparişe" sorusu şemadan cevaplanamaz (bilinçli, `:4333-4337`); iki DEFERRABLE bileşik FK tx içinde ara durum tutarsızlığına izin verir (`test_db_invariants.ts:233-247`).
- **→ E İş kuralı + C Veri modeli (sipariş):** `Order.shippedQty`/`OrderLine.shippedQty` denorm — saha'da 0 sapma (278 sipariş); `WorkOrderToOrderLine.allocatedQty` 140/140 satır 0, kod hep 0 yazıyor (`workorder-link.service.ts:377`, `workorder.service.ts:743`) → ölü kolon; kalem replace cascade (H3).
- **→ E İş kuralı + B (tambur/üretim):** `Roll.qualityGrade` (kod snapshot) ↔ `qualityGradeId` saha'da 0 sapma; `preCancelStatus` NULL 134/230 (geri alma STOCK'a döner, belgeli); `WorkOrderStep.stepData` 0 dolu (H10); `RollError` unique partial `defectTypeId IS NOT NULL` — `reportError` `defectTypeId` zorunlu mu (0 NULL saha'da)?
- **→ I Gözlemlenebilirlik + G Güvenlik (audit):** `audit_block_tamper` GUC `teks.audit_guard` saha kopyasında tanımsız = koruma **kapalı** (canlıda açılması ops §7b'de "ZORUNLU" yazıyor — canlı durum bu kopyadan görülemez); `system_logs.requestId` dolu 118/10485, `changes` 343 (Faz B2 yeni); arşiv 0 satır; `guarded-hard-remove` oturum silmesi (H2).
- **→ C Veri modeli + L Kod kalitesi (etiket/belge):** `LabelTemplate.kind/isDefault/fields/lineStepMm/qrScale/lengthBanner` deprecated çift-yazım (`:4844-4871`); saha'da 4 `isDefault=true` + 3 `LabelContextDefault` → iki kaynak; `TravelerCardTemplate` 0 satır (şablon yolu canlıda hiç kullanılmamış).
- **→ K Test + L Kod kalitesi (mobil/Electron ikiz enum bekçileri):** `RollStatus`, `ReasonPresetKind`, `LabelKind`, `PrintedDocType` gibi enum'ların istemci kopyaları bu haritanın dışında; "altıncı enum değeri unutuldu" sınıfı (CLAUDE.md 2026-08-26/27 notları) için üye-başına tüketici sayımı (beceri §7.6) ayrı ölçüm ister.

## KAPSANMAYAN / ERİŞİLEMEYEN

- **Canlı prod DB:** erişim yok; tüm veri sayımları 2026-08-25 kopyası (`tekserp_saha_0825`, 190 migration) üzerinden. Son 5 migration'ın kolon/tablo/index'leri orada doğrulanamadı (dev'de var).
- **`teks.audit_guard` canlı değeri:** kopyada GUC tanımsız; canlıda açık olup olmadığı bu kanaldan ölçülemez.
- **Migration dosyalarının içeriği (196 klasör) ve `migrate diff` drift ölçümü:** K2b'nin alanı; burada yalnız DB'deki sonuç nesneleri envanterlendi. Prisma varsayılan onDelete kuralı (zorunlu→RESTRICT, opsiyonel→SET NULL) DB sayımlarıyla birebir doğrulandı (41/71/168), Prisma dokümantasyonuna ayrıca bakılmadı [VARSAYIM yalnız kuralın adı için; sayılar ölçüldü].
- **`ScanType` canlı dağılımı, `traveler_card_scans` sayısı, `SystemLog.action` dağılımı:** sorgulanmadı (harita için kritik değil).
- **Mobil ve Electron tarafındaki enum/tip ikizleri (`mobil/src/**`, `Electron/src/**`):** bu görevin kapsamı `schema.prisma`; ayrışma bekçileri incelenmedi.
- **`prisma/seed*`, `scripts/seed-fixtures`:** seed'in şema kısıtlarıyla ilişkisi (ör. fixture'ların partial unique'lere çarpması) incelenmedi.
- **JSON alanlarının içerik şemaları** (`AppPreferences`, `DocumentConfig`, `LabelElement`, `TravelerCardSnapshot`): yalnız yazma deseni haritalandı, iç yapı/validasyon (`sanitize*`, `validateElements`) incelenmedi.
- **Index seçicilik / EXPLAIN ölçümü:** `code-review-skill` veri-performans alanı; `rolls` 21 index'inin kullanım oranı (`pg_stat_user_indexes`) sorgulanmadı.
- **`RollBarcodeCounter` ve `nextDailySeq` kilit sırası:** eşzamanlılık denetçisinin konusu; burada yalnız şema modeli işaretlendi.
