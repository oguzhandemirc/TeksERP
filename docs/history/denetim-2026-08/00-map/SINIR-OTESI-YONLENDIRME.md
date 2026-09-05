# SINIR ÖTESİ NOTLAR — A-L denetim alanlarına yönlendirilmiş birleşik liste (aşama ① KEŞİF)

**Tarih:** 2026-08-28 · HEAD `ce8681d1` · Kaynak: 16 haritanın `## SINIR ÖTESİ NOTLAR` bölümleri. Haritalar notlarını K-harita adı / modül hücresi / serbest alan adıyla yönlendirmişti; burada hepsi görev metnindeki **A-L** alfabesine çevrildi:

| Harf | Alan | Harf | Alan |
|---|---|---|---|
| **A** | Eşzamanlılık (kilit sırası, deadlock, yarış) | **G** | Güvenlik (kimlik, yetki, sır, yüzey) |
| **B** | Mükerrer / idempotency (token, replay, çift kayıt) | **H** | Performans (havuz, CPU, tavansız sorgu) |
| **C** | Veri modeli (şema, FK, denorm, kolon semantiği) | **I** | Hata / gözlemlenebilirlik (audit, log, sessiz yutma) |
| **D** | Tx sınırları (tx içi/dışı, sızıntı, kısmi durum) | **J** | Migration / kurtarma (deploy, yedek, DDL, geri yükleme) |
| **E** | İş kuralı (domain değişmezi, semantik) | **K** | Test (bekçi kapsamı, kör nokta, artık) |
| **F** | API / Express (rota, Zod, yanıt sözleşmesi, middleware) | **L** | Kod kalitesi / hesap tekrarı (kopya formül, ölü kod, bayat yorum) |

Her satır: **Kaynak harita → gözlem (dosya:satır) → not**. Aynı gözlem birden çok alana dokunuyorsa ilk alana yazıldı, diğerleri parantezde. Yargı yok.

---

## A — Eşzamanlılık

| Kaynak | Gözlem (dosya:satır) | Not |
|---|---|---|
| K4 | Havuz-client domain yazımları 114 site (H6): `inventory.service.ts:3452/:4033`, `workorder.service.ts:3281` (koşulsuz), `:6100`, `:6552` (`nextDailySeq` + havuz create), `workorder-link.service.ts:564/:632`, `kartela.service.ts:1204/:1226`, `kursun-qc.service.ts:634/:720/:1697`, `order.service.ts:2694`, `traveler-card.service.ts:499/:608`, `return.service.ts:998`, `shipping.service.ts:1610/:1635/:1669/:1712/:1723`, `printed-document.service.ts:387` | çoğu atomik claim; çok-adımlı akış ortasında tx dışı olanlar ölçülmeli (D ile) |
| K4 | Advisory lock siteleri: `roll-barcode.helper.ts:82`, `batch.service.ts:126` (8022), `inventory.service.ts:844` (8021), `master-data-merge:546`, `code-unique.helper.ts:81`, `shipment-locks.helper.ts:58`, `session-registry.service.ts:79`, `permission-management.service.ts:609`; `order.service.ts:2434 FOR UPDATE`; `device.service.ts:264` havuz `Promise.all` deleteMany+createMany; `db-copy.service.ts:288` JSON RMW | K3 haritaları işledi; bekçisiz 8024/8027 (K) |
| K3a | `createBatchTx` çağıran 8 yer — 8022'den ÖNCE `touchWorkOrderTx` alınıyor mu: subcontractor evet; `workorder:4553`, `manual-move:699` hayır (S2/H-4) | ABBA-1 |
| K3a | `assertTargetColorChange(prisma)` `workorder.service.ts:4697`, `workorder-link.service.ts:525` — karar havuzda; tx içi ikizi var mı (`mismatchRows` claim'de pin'lenmez) | check-then-act |
| K3a | `order-status.helper.ts:205-210` kilit protokolü (alt-küme/tam-küme) — üç uygulayıcı doğrulanmalı; `cancelOrderLine` ihlal (ABBA-4) | |
| K3a | `generateWorkOrderNumberTx` (`workorder-clone.helper.ts:31`) findMany sayacı: çağıranlar `workorder:4181`, `split:471/:639` `withBarcodeRetry` içinde mi | (B) |
| K3b | `kursun-qc.service.ts:613/:812` `assertKursunTabletMayWrite(prisma)` tx DIŞI (inventory'de tx ile) | çift-mod |
| K3b | `touchWorkOrderTx` `updatedAt` yan etkisi: kilit alan her akış (parti taşıma, bypass atama, KK2 kapatma) iş emrini "Son İşlem" listesinde yukarı taşır | (E/L) |
| K5 | `openLoginSession` 8024 tx içinde okumadan önce (sıra doğru); 8025; namespace envanteri | K3b §6 işledi |
| K5 | `bcrypt.compare` (bcryptjs saf JS, maliyet 10) event loop'ta; lockout bcrypt'ten ÖNCE (doğru) | (H) |
| K6 | `withBarcodeRetry` closure'larında tx-dışı iş (`customer.service.ts:290-302` her retry'da `assertTaxNumberAvailable` + `super.create`; `item.service.ts:225-232`; `order.service.ts:1942-1950`) — check-then-act 409'a düşer; `traveler-card.service.ts:212-227` tek retry; `printed-document.service.ts:413-425` kazananı okuma; `latency-persist.service.ts:50/113-116` `inFlush`, `reason-preset.service.ts:135-147` `backgroundRefresh` tek-uçuş bayrakları tek-process'e bağlı; `server.ts:79` `server.on("error")` yok (H-14) | |
| K7a | `attachTotals` RepeatableRead **batch** tx (`shipping:2592-2610`, künyedeki tek `isolationLevel`); `touchOrderLinesTx` sıralı kilit protokolü ve üç uygulayıcısı; `changeWidth` tx **dışı** best-effort (`subcontractor:3264-3275`); çekme sapması tx içi; undo FULL "hepsi-ya-hiç" (`tambur-undo:1496-1498`) | |
| K7b | `buildShipmentListSummary` 5 ayrı `aggregate` **`Promise.all` ile ayrı bağlantı/ayrı görüntü** (`shipping.service.ts:2698-2709`) — iade commit'i aralığa düşerse bant ile satırlar ayrışır (F-SEV-ESZ-002'nin muhasebe bandı ikizi); `_shipped.ts` tek `$queryRaw` (tek görüntü) | |
| K7b | `now() AT TIME ZONE 'UTC'` ile `exitedAt` yazan 11 ham SQL noktası (`workorder` ×4, `subcontractor` ×5, `kursun-bypass:2347`, `kursun-qc:896`) — oturum UTC'ye bağlı doğruluk; WIP/pano süreleri okur | (C/J) |
| K9 | `labelDirty` yazan 11 noktanın çift-mod listesi (§2.a-A8); `shipping.service.ts:1723` havuz `updateMany` çevresindeki tx'in dışında mı; H-2 (import uçuşta çift koşum), H-7 (print-event 3 yazım tx'siz) | (D) |
| K10 | `workorder.service.ts:575-600` İE no tx AÇIKKEN havuz client'ından (sayaç sınıfı) | K3a L1 |
| K11 | `session-registry.service.ts:79`, `master-data-merge.service.ts:546` bekçisiz advisory; `test_shipment_scope_lock.ts:106-117` 1-arg tarama namespace haritası için hazır; `inventory.service.ts:844` sıra bekçisiz | (K) |
| K11 | `test_p2_infra.ts:53` login-lockout bellek atomikliği, `test_backup:315`/`test_db_copy_single_start:62` bellek bayrak/claim — tek-process invariantının fiili bekçileri (beceri §5) | (K) |
| K12 | `shipping.service.ts:2592-2610` batch + RepeatableRead — K3 "per-call override yok" yazmasın; `subcontractor.service.ts` `completeWorkOrderIfStepsDone` 3→4 (`:6209`); barkod sayacı 12 çağrı yeri (7 tx-içi) — K4 satırı bu sayıyla | |
| K2a | `PrintedDocument.version max+1` (H6), `TravelerCard.version read+1` (H7), `RollBarcodeCounter ON CONFLICT`, Batch 8022, RollMovement partial unique (224 açık), WorkSession/Bypass partial unique, `EndpointLatencyDaily` findFirst→create, `SystemSetting.set()` findUnique→upsert | (B) |
| K2b | `roll_barcode_counters` satır kilidi tx boyunca tutulur mu — `generateRollBarcode` çağrı yeri (K3b H-2 cevapladı); ABBA sıra haritası K3'ün işi | |

## B — Mükerrer / idempotency

| Kaynak | Gözlem | Not |
|---|---|---|
| K3a | `receive` clientToken wBR predicate'siz (#9); `createInitialEntry` replay statüsü (#8); `openSack :275-295` ve `createShipment :1432-1444` predicate+catch çifti (**doğru desen**); `dispatch :742` küme-eşitliği guard'ı (token yok); `createOpenFabric :4221` replay (statü kontrolsüz — yeni top) | |
| K6 | Replay yolları `inventory.service.ts:4218-4262` (herhangi P2002 + token → lookup; `existing` yoksa orijinal hata); iptal edilmiş kayıt replay'i 409 `ENTRY_CANCELLED` yalnız tambur-manual :1049/:1405 + fason makbuz :2348 — **KK1 ham girişte iptal edilmiş Roll için replay dalı var mı** doğrulanmalı (K10 H-1: YOK); H-8 merge önizlemesi `count=0` | |
| K2a | `SubcontractorReceipt.clientToken` dolu 2/143 (H9); `SubcontractorReceiptItem.newRollId` adı yanıltıcı; `receivedQty` NULL 635/638 → rapor `COALESCE` varsayımı; `RETURNED_FROM_SUBCONTRACTOR` saha 0 ama 8 filtre + trigger listesinde | (E) |
| K1a | H18 kartela `dispatch`/`receive` clientToken YOK (kardeş `stock/reduce` taşıyor) → mobil retry mükerrer sevk/makbuz | |
| K1b | H18 `createReturn` clientToken YOK (çoklu iade ≤200) — tekrar denemede claim ikinci yazımı keser mi | |
| K9 | H-2 import: token yalnız tamamlanmış koşum; `order.adapter` create-only → çift sipariş; mobil `printQueue` at-least-once (aynı barkodlu ikinci kâğıt kabul edilen bedel) | |
| K11 | İdempotency 4-durum: iptal-sonrası replay yalnız Roll manuel top ölçülü; Order/WO/Sack/Shipment/Receipt/Import bekçisiz (H-9); `withBarcodeRetry` parti yolunda ne koruyor (H-1) | (K) |
| K5 | Cihaz `announce` idempotent upsert (`deviceId` unique) ama tavan 200 + rate limit yok | (G) |
| K10 | 227 CANCELLED/SCRAP top clientToken taşıyor (replay yüzeyi Q-STK-10) | |

## C — Veri modeli

| Kaynak | Gözlem | Not |
|---|---|---|
| K2a | Saha kopyasında 5 migration eksik; yumuşak kapı index'leri iki ortamda farklı tabloda eksik; `LabelOrientation` ölü enum; `Manifest` 0 satır, `StationColor` deprecated (49 satır); `clientToken` düz↔partial desen tutarsız (4/4); 26 CHECK + 3 trigger + 2 DEFERRABLE FK + 33 GENERATED + 3 expr unique + 39 partial şema-dışı; `SubcontractorDispatchItem`/`ShipmentOrder` mutasyonlu ama `updatedAt`siz | (J) |
| K2a | `Shipment.cancelledAt` yok (H13); `Sack.weightSource` 41/41 NULL; `SackAllocation` çuval×satır (top değil) — "hangi top hangi siparişe" şemadan cevaplanamaz (bilinçli); 2 DEFERRABLE FK tx içi ara tutarsızlığa izin verir | (E) |
| K2a | `Order/OrderLine.shippedQty` denorm saha 0 sapma; `WorkOrderToOrderLine.allocatedQty` 140/140 = 0, kod hep 0 yazıyor → ölü kolon; kalem replace cascade (H3) | (E) |
| K2a | `Roll.qualityGrade` snapshot ↔ `qualityGradeId` 0 sapma; `preCancelStatus` NULL 134/230 (geri alma STOCK'a döner, belgeli); `WorkOrderStep.stepData` 0 dolu (H10); `RollError` partial unique `defectTypeId IS NOT NULL` — `reportError` `defectTypeId` zorunlu mu | (E) |
| K2a | `LabelTemplate.kind/isDefault/fields/lineStepMm/qrScale/lengthBanner` deprecated çift-yazım; saha 4 `isDefault=true` + 3 `LabelContextDefault` → iki kaynak; `TravelerCardTemplate` 0 satır | (L) |
| K4 | `RollBarcodeCounter`/`RouteStepProperty` delegate ile yazılmıyor; `updatedAt` DB default yok (ham yollar bayat bırakır); `finalizedAt/statusChangedAt` `@default(dbgenerated())` işaretsiz; saha eksik 5 migration → `OrderLine.cancelledAt` yazan yollar prod'da yok | |
| K7a | `Roll.weightKg` prod 0/2431 dolu; `WorkOrderToOrderLine.allocatedQty` hep 0; `WorkOrder.targetQuantity/targetWeight` hesapta yok; `SubcontractorReceiptItem.receivedQty` 635/638 NULL; `currentQty ≤ initialQty` CHECK yok; CHECK'lerin tamamı `NOT VALID`→VALIDATE | |
| K7b | `finalizedAt` çıkışta silinmiyor (H2) — düzeltme trigger/migration ister (`prod_risk: yuksek`); `SubcontractorReceiptItem.receivedQty` NULL backfill yok; `orders.orderDate/completedAt/cancelledAt` index yok; `rolls.statusChangedAt` index bilinçli yok; `endpoint_latency_daily` retention DELETE istisna listesinde yok | (J/H) |
| K7b | `Roll.finalizedAt` SHIPPED toplarda dolu; iade **kalite yeniden verirse** (`returnGradingEnabled`, `returnTargetStatus`) damga ile kalite ayrışır | (E) |
| K6 | Prod kopyasında `system_logs` 2026-07-16'dan başlıyor ama 2026-07-23/28 havuz zaman aşımı satırları aktif ve arşivde 0 → nereye gittiği (deploy öncesi temizlik / yedek kesimi) | (J/I) |
| K8 | `EndpointLatencyDaily.day` `@db.Date` (O-11 tek istisna); `system_log_archives` şeması sıcak tabloyla tip-paritesi tutmalı (`deviceId` TEXT 22P02 regresyonu geçmişi) | |
| K10 | `RollBarcodeCounter.day` yorum/veri uyuşmazlığı (H-13); `Order.cancelledAt`/`OrderLine.cancelledAt` sahada yok | (L) |
| K12 | DB'de SET NULL FK 168 (KUNYE'nin 3 sayısı şema annotation'ı); hard-delete guard kapsaması için gerçek sayı bu; `shipment_orders_active_order_uq` bilinçli düştü (DB-MIMARI §0 bayat); `items_nameFold_key` sahada YOK | (J) |
| K1b | Prod kopyası 190/195: `duplicate_reviews`, `roll_plan_deviations` gibi 2026-08-19+ tabloları olmayabilir (K2a: `roll_plan_deviations` VAR, 0 satır); ham SQL 19 dağılımı merge 18 + sub 6 + wo 4 + order 1 + batch-drop 1 (KUNYE ile uzlaştırılmalı) | |
| K5 | Saha `sessions` 10 satır `expiresAt < now() ∧ revokedAt NULL` — middleware `expiresAt`'e bakmıyor (K5 §2.1); `Session.deviceId` FK'sız; `User.quickPin` düz | (G) |

## D — Tx sınırları

| Kaynak | Gözlem | Not |
|---|---|---|
| K6 | 122 tx bloğunda `res`/dış-dünya 0; `AuditService.*`'in tx callback'i içinde çağrılıp çağrılmadığı K6'da taranmadı (K3a/K3b: tümü tx dışı ✓); `AppError` tx içinde fırlatılınca Prisma hatayı değiştirmeden yeniden fırlatır — wBR bunu P2002 saymaz (doğru) | |
| K3a | Tx-dışı çok adımlı orkestrasyonlar (§7): `quickStart` (belgeli), `softDelete → prepareFasonCancelDecision` (belgesiz), `cancelWithActions` (belgesiz), `quickOrderFromRolls` (belgeli), `transferToNextFason` (belgeli), `bulkDispatchStep` SEPARATE (belgesiz, `failed[]` yok), `receive` sonrası `changeWidth/changeTargetColor` (belgeli), `linkOrderLineWithOverride` (belgeli), `workorder-link:564-577/:632-640` claim → havuz dirty (küçük) | |
| K3b | Tx sızıntısı adayları T1-T16 (§4): `fabric-property.update` iki adım (bilinçli), `tambur-manual` FAZ1/FAZ2 (bilinçli), `guarded-hard-remove` guard havuz (T3), `label-template hardDelete` (T4), `printed-document.reissue` snapshot havuz (T5), `reason-preset.duplicate nextFreeCode` (T6), `item.create nextItemCode` (T7, bilinçli), tambur barkod rezervasyonu tx öncesi (T8, bilinçli), `loadStationPropertyCaps(prisma)` (T9), `revokeAllForUser` tx sonrası (T10), `markMerged` (T11), `recordPrintEvent` plan havuz (T12), `archiveOlderThan logsToArchive` (T13), `takenOver` (T14), replace-set diff'leri (T15) | |
| K3b | `printed-document.reissue` snapshot havuzda kuruluyor — "belge yolu da brüt" kuralıyla kesişiyor mu | (E) |
| K9 | `void runBackupJob/runCopyJob` 202 semantiği; import satır satır ayrı tx (bilinçli) + HTTP zaman aşımı yok → uzun istek | (H) |
| K9 | `installation-identity.job.ts:78-81` yorumu (P2002 yarışı) ↔ kod `upsert` (`:141`) ayrışık — tek process'te etkisiz | (L) |

## E — İş kuralı

| Kaynak | Gözlem | Not |
|---|---|---|
| K10 | `kursun-qc.reopenStep` SCRAP'ı üretime geri çeker (H-4) — fire karnesi + `finalizedAt` trigger'ı ile çelişki; `rolls.cancelledAt` 47/52 eksik (H-5); iptal edilmiş sipariş/kalem kolonları saha kopyasında yok; `items` `v-1430` mükerrer (enforce bekliyor — ops kuyruğu); SoD üçlüsü 6/8 kullanıcıda; 40 aktif MOBILE oturumu; `roll_variances` 2 defter-siz aşım + §13'ün 2 satırı — veri düzeltmesi iş kararı (Tur 2 listesi, dry-run script'i, `prod_risk: yuksek`) | |
| K3a | `RollStatus` geçişlerinin claim'leri satır satır; `Roll.status` yazan yabancı servisler (`order.quickOrderFromRolls :2149`, `return :501`, `shipping dispatch :1862`) — bounded context sorusu | (L) |
| K7a | `qtyOut NULL` okuyucuları (`reports/production.report.service.ts:177`, `work-session-activity.service.ts:403`); `reports/subcontract-scorecard:159` işaret kuralı; `_shipped.ts:59-80` brüt SQL union — `attachTotals`/`accounting-export`/`getShipmentById` ile aynı kural mı; `round1` ×2, `fmtTr` ×3 | (L) |
| K7a | Etiket alan değerlerinde metraj biçimi (`label-field-values.ts`); çuval etiketi sayacı "aynı küme" iddiası (`shipping:1185`) | |
| K7a | `inventory.service.ts:2094` `oldestDays = floor(ms/86_400_000)` UTC gün sınırı; `subcontractor:2075` `now() AT TIME ZONE 'UTC'` | (C) |
| K7a | `system-setting.service.ts:1606-1610` `fasonShrinkTolerancePct` yazımı (CLAUDE.md "`<=0→null` YASAK") okunmadı | |
| K7b | Pano RAW_QC "bugün giren" `colorId IS NULL ∧ entrySource ∈ {SUPPLIER_RECEIPT, MANUAL_ENTRY}` — yarı mamul/renkli ham giriş sayılmaz (2026-08-26 mobil KK1 vakasının pano ikizi) | |
| K7b | Mobil çekme yüzdesi (`receivePayload.helper.ts:175-198`) ↔ backend `firePct` (payda giden vs düşülen) | |
| K7b | İş emri "ÇIKAN" `initialQty`, karne `currentQty` — aynı topun iki yüzeyde iki metrajı; "üretilen metraj" 4 tanım (§6.B) | (L) |
| K6 | H-6 (fason kabul sonrası en güncellemesi sessiz), H-7 (barkodsuz etiket basılır), H-11 (yetim WO); `subcontractor.service.ts:2243-2251`, `kursun-bypass.service.ts:1093-1098/1137-1140` yalnız `AppError` toplar (**doğru desen** adayı) | |
| K9 | Metre okumasında sunucu tarafı simülasyon guard'ı yok (§4) — kabul edilen tasarım mı; `LabelKind` enum tüketici sayımı (CLAUDE "4 yer elle"), `RENDERERS` fail-open (H-10) | (L) |
| K2b | Fason: `roll_movements` 15/883 `qtyOut ≠ qtyIn` — kısmi kabul/çekme meşru mu; `AT_SUBCONTRACTOR` 188 topun `currentStepId` dolu — "istasyon-bekleyen" sayaçları dışlıyor mu; sevkiyat: 12 WAREHOUSE top PLANNED çuvalında (`preShipStatus` ne zaman yazılıyor), 5 iade edilen top CANCELLED (iade sonrası iptal akışı mı), 2 TRAVELER_CARD `version=2` v1'siz; pasif kumaşa bağlı 2 yeni top (hangi yol pasif ana veriyi kabul etti — import? KK1?) | (C/B) |
| K1b | `/permanent` sözleşmesi dört anlam (H7) istemci metinleriyle ("kalıcı sil") hizalı mı; `mobile:kk1-yari-mamul` 0 sahip; `master-data:merge`, `mobile:tarti-paket`, `mobile:sevkiyat`, `mobile:kk2-kursun` tek kişide; `shipping:undo-dispatch` 6/8 — SoD niyeti ↔ atama | (G) |

## F — API / Express

| Kaynak | Gözlem | Not |
|---|---|---|
| K1a | `test_route_auth_coverage` HEAD'de kırmızı; EXEMPT `/api/mobile/updates/*` uçlarını taşıyor; route-level `jsonBig` etkisizliği `master-data-merge`/`order`/`shipping`'de de `express.json` varsa aynı sınıf (`grep -rn 'express.json' src/routes`); bare-chain tabanı 12'nin 3'ü (`record-info`, `reason-presets`, `search`) handler-içi dinamik izin | (K) |
| K1a | Bellek-içi durum taşıyıcıları: `lastSeenWrites`, `failCounts` lockout, `featureFlagsCache`, `isCopyJobRunning`/`isBackupRunning`, latency sayaçları, `presence` — tek-process invariant | (A) |
| K1a | `AuditService.logEvent` route katmanından `await` ×8 — best-effort sözleşmesi servis içinde mi (K6 §1.6: evet, fırlatmaz); `stats-batch` paralel `roll.aggregate` ×≤12 (havuz 30); `customer-branch-list.routes`/`defect-type.routes` route dosyasında `new BaseService` | (H/L) |
| K1a | `label.routes.ts` `resolveFormatOpts` `req.device.id` ile cihaz yönlendirme; sahte `x-device-id` `resolveDevice`'a bağlı | (G) |
| K1b | K1a dosyaları (`/api/rolls/:id/scrap` fire ucu ↔ tambur/kursun damga sözleşmesi); CORE: uuid✗ handler'ların tek koruması P2023/P2007 → 400; global `express.json 1mb`; `resolveDevice` fail-open bilinçli; Swagger `PrintedDocType` enum'ları yalnız 4 üye listeler (gerçek 8); H15 hayalet uçlar | |
| K5 | `GET /api/feature-flags` 54 anahtarı her kimlikli kullanıcıya döner; `GET /api/admin/settings` 34 satır ham (`updatedBy` dahil); `DOC_PERMISSIONS.TRAVELER_CARD.write` listede ama uç 400; Swagger `NODE_ENV` vs morgan `APP_ENV ?? NODE_ENV` iki bayrak | (G/L) |
| K6 | Express 5 yolu doğrulandı (§1.2); try'sız 8 handler; H-4 statü nesneleri dal 9; H-13 `Retry-After` CORS `exposedHeaders`'ta yok (bekçi listeyi kilitliyor); H-22 cursor; 200-gövdesinde-başarısızlık sözleşmeleri (`delivered/seeded/failed[]/postWarnings/dispatchWarning/warnings/idempotentReplay`) istemcide doğrulanmalı; `/api` 404 mesajı `req.originalUrl` yansıtır | |
| K6 | H-21 `traveler-card print` ikinci yarış → ham P2002 teknik mesaj ("Bu 'workOrderId' değeri zaten mevcut (unique constraint)") | (A) |
| K7a | Zod: ondalık kısıtı yok; en tavanları 1 000 / 999 999 / 999 999 999 / 100 000 (H12); `receivedQty` `positive().nullish()`; `appliedWidth` `max(999_999_999)`; `weightKg` `positive` (0 kg reddedilir) | |
| K3b | Tavansız diziler: `label-template.controller.ts:130 variants`, `batch.controller.ts:19/:23/:26`, `kartela.controller.ts:12 rollIds` + `:32 returns`, `admin.routes.ts:390-391/:646/:667`, `reason-preset.routes.ts:57`, `station-capability.routes.ts:22/:27`, `tambur.controller.ts:36 relatedErrorIds`; `kursun-bypass` `rollIds` controller şeması okunmadı; `item.service.update restData` → `sanitizeWriteData` | (H) |
| K9 | H-1 kökü `app.ts:141` global parser sırası — çözüm yönü (path bazlı `type`/`skip` ya da router'ı parser'dan önce mount) | |
| K12 | `req.user!` 4. kullanım `config-bundle.routes.ts:51` — çağrıldığı her yol verifyToken'lı mı (H12) | (G) |

## G — Güvenlik

| Kaynak | Gözlem | Not |
|---|---|---|
| K5 | H1 `.env` git'te (`76f9967b`), `.env.example` yok; H2 `requirePermission(undefined)` → 500; H3 `STATION_KIND_PERM` fail-open; H4 cihaz kimliği sırsız bearer (`closeForDevice`, `NEW_LOGIN` kapatma, yazıcı hedefi); H5 kimliksiz `mobile-users` + PIN-only (10⁶) + IP-anahtarlı bellek lockout (28 cihaz her IP ayrı bütçe, restart'ta sıfır); H6 planlamacı muafiyeti (kullanıcı kararı); H7 SoD sahada uygulanmamış, `INVOICE_WRITE` `shipping:write`'ı kabul eder; H8 30 gün token + sınırsız paralel oturum + HTTP düz metin; H9 `resolveExact` izin süzgeçsiz (çuval no → `customer.name`); H10 raw SQL `base.service.ts:856-932` (düşük); H11 `clientType` gövdeden → mobil-only hesap 54 ayarı okur; H12 `resolveDevice` DB hatasında fail-open; H13 PIN/kart düz + `credentials` ucu + yedek dump'ı düz PIN taşır; H14 tablet şablonları `web` kategorili izin → masaüstü kapısından geçer; H15 statik makine atfı 0; H16 her istekte 2 DB okuması | |
| K1a | H3 `PUT /settings/:key` allowlist yok (strictObject sınırları atlanır); H4 `feature-flags`/`document-profiles` VT-only; H6 `test-native` gövdeden IP'ye RAW TCP (SSRF sınıfı; bayrak kapalı); H9 `offsite/authorize` Drive token rclone config'e, GET config yolu döner; H10 `mobile-users`/`announce`/`health` rate limit yok; H11 lockout `req.ip` trust proxy yok; H12 db-copy `:name` serbest; H13 import `template` WRITE izni, `export` `data:import`suz tam döküm; H16 `credentials` tek izin vs `backups*` AND; H17 `/api-docs` `NODE_ENV` yalnız; H19 `preview-raw` READ izniyle ham kod render; H20 `mobile:*`/`admin:*` joker sahipleri | |
| K1b | H13 PUBLIC dosya ucu (APK dahil kimliksiz); H12 merge 17 raw SQL parametre bağlama; H1 `cancelShipment` sebepsiz mobil WRITE; H20 `DELETE /work-orders/:id` gövdesiz `mobile:hizli-is-emri` | |
| K6 | H-10 `resolveDevice` fail-open; `auth.middleware.ts:35-37` `lastSeenAt` sessiz; logout revoke düşerse registry canlı (tokenVersion bump yok); revoke best-effort ×3; H-12 (201 ama PIN/kart yok); H-17 ham `err.message` 200 gövdesine (`dispatchWarning`, `postWarnings`, `failed[].reason`, import, backup `warnings`); `/api/admin/health.lastAuditError/lastPoolTimeoutError` ham metin (guard'lı); errorHandler `details` olduğu gibi istemciye (uç bazında ne konduğu) | (I) |
| K9 | §12 shell/DDL/FS tablosu: S5/H-6 rclone argüman enjeksiyonu (shell yok), H-3 verify allowlist'siz (herhangi DB'ye bağlanıp sayar + `dbRestore.copies` kaydı), S14 kimliksiz FS okuma (traversal guard var), S21 `test-native` keyfi IP:port (bayrak kapalı), `cors()` origin `*` | |
| K3b | H-3 `validUntil` ile son-admin sönmesi; `session-registry` audit yazmıyor (login yolu AuthService'te mi); `applyTemplate merge` `createMany` `skipDuplicates`siz | (A) |
| K2a | Saha `sessions` 10 süresi dolmuş & `revokedAt NULL`; `Session.deviceId` FK'sız serbest; `User.quickPin` düz unique | (C) |
| K2b | `users_username_lower_uq` + `cardToken/quickPin` nullable unique — PIN tekilliği DB'de; uzunluk/karmaşıklık uygulamada | |
| K4 | 12 `/:id/permanent` ucu + route→helper (`guarded-hard-remove`); `inventory.routes.ts:668 POST /:id/scrap` `roll:manual-adjust` | (F) |
| K12 | H6 `.env`; H11 `test_base_service_binding` yazılmadı (14 bağlı model; sır kolonlu model bağlı değil); H13 `applyTemplate replace` devir satırı yeniden okunmalı | |

## H — Performans

| Kaynak | Gözlem | Not |
|---|---|---|
| K5 | `verifyToken` her kimlikli istekte `user.findUnique` + `session.findUnique` + `lastSeenWrites` Map; 121 aktif oturum × yoklama (tablet 5 sn?) | |
| K3b | `item.service.ts:240` `tx.item.findMany` **tüm ürün tablosu** kilit altında; `label-template.findAvailableName :605` tüm şablon adları; H-10 merge 120 s ↔ DB 50 s; H-2 sayaç kilidi 1345 ms vs 39 ms | |
| K7b | §8.4 tavansız `findMany` 9 yer (stok karnesi tüm serbest toplar; müşteri karnesi tam ömür; plan-sapma 5 ilişki; denge + `computeWoMaterial` 8 sorgu; export 2 000 sevkiyat × iç içe toplar); `orders.orderDate/completedAt/cancelledAt` index yok; `scale_report.ts` yalnız 4 rapor; `_shipped` direkt sevk başına 2 korelasyonlu alt sorgu | |
| K9 | H-8 CPU-bound render (2 senkron `bwipjs.toSVG`/etiket; raster glif tarama; 2000×5 toplu, 25'te bir `setImmediate`); H-12 `listDbCopies` her GET'te `probeCapabilities` + tüm DB boyutları + `statfs`; `readdirSync`/`readFileSync` istek yolunda; import HTTP zaman aşımı yok | |
| K6 | `label.service.ts:1136/1194` raster döngülerinde `setImmediate` yield (tek process); H-1'in 3× retry etkisi (50 s × 3); `auth.controller.ts:100-118` lockout bcrypt'ten önce (doğru) | |
| K1a | `stats-batch` fan-out ×12; K1b H6 `applyAttributeSchema.rollIds` **tavansız** (top başına tekil düzeltme motoru, `recolorRollIds ≤5000` ile asimetrik); H10 fason kabul en uzun tx adayı | (F) |
| K2b | `CREATE INDEX CONCURRENTLY` 0/621; `lock_timeout` hiçbir migration'da yok (H-3); büyüme senaryosu `roll_movements` milyona çıkınca dakikalar | (J) |
| K8 | `db-copy.service` `statementTimeoutMs:0` ile restore (`:501,569,623,728`) — uzun DDL | (J) |

## I — Hata / gözlemlenebilirlik

| Kaynak | Gözlem | Not |
|---|---|---|
| K6 | H-1 (57014/40P01/25P03/53300 generic 500, 503 sinyali yok), H-2 (`AppError.internal` + wBR tükenmesi iz bırakmaz), H-3 (`PrismaClientValidationError` 400 audit'siz), H-4 (statü taşıyan http-errors → 500 + sahte audit), H-5 (`seedRollLabelSnapshot` `{success:true, seeded:false}`), H-7 (barkod/QR patlarsa eleman çizilmez 200), H-8 (merge önizleme `count=0`), H-9 (`files:[]`/`expected:[]` "yok" = "okunamadı"), H-15 (raster → komut moduna sessiz düşüş), H-16 (`package.json` okunamazsa `"1.0.0"` → tüm istemciler "sunucu eski"), H-18 (`POOL_TIMEOUT` audit'i aynı havuzdan; bellek sayacı restart'ta sıfır), H-19 (`installation-identity` 3 deneme sonrası audit YOK; `permission-catalog` yazıyor — tutarsız), H-20 (`unhandledRejection` ayakta tutar; `latency-persist` dış try'da catch yok) | |
| K8 | `audit_guard` SAHA'da KAPALI (canlı ölçüm null) — ISO 27001 A.8.15 koruması fiilen devre dışı; SURUM-2.9.0 §7b beklemede; `system_log_archives` 0 satır; `JOB_FAILED:*` prod 0 (yol hiç tetiklenmemiş) | (J/G) |
| K9 | H-4 yetim `pg_restore --list` child; H-9 scheduler env ayrışması; rclone "hedef yok" yalnız `console.warn` (bilinçli); GUC replay hatası yalnız `console.error`; raster düşüşü sessiz; `LABEL_PRINT_EVENT.language` 2.517 `RASTER_HTML` (yanlış dil izi, düzeltme sonrası doğrulanmalı) | |
| K4 | `reason-preset-catalog.job` audit yazmıyor; 4 backfill/normalize + sync-* + seed'ler audit yazmıyor; `kursun-qc:1665` ham SQL audit yazıyor; merge MOVE audit `merge()` düzeyinde [VARSAYIM]; `bench_audit_summary.ts` sentetik INSERT (guard INSERT'i engellemez) | |
| K10 | `rolls.cancelledAt` 47/52 eksik (hangi iptal yolu; `system_logs tableName='ROLL'` ile ayrılsın; canlıda `Q-AUD-05b` koşulmalı); audit kayıt-düzeyi boşluğu 55/2.391 top (fason+Tambur çocukları; `AuditService.logMany` recordId) | |
| K5 | `req.device.machineId` üretim atfı prod'da hep NULL (cihaz-makine ataması 0); atıf iş oturumundan; enforce'suz 9 uç `machineId=null` sessiz (H15); `closeForDevice` cihazdaki tüm oturumları kapatır | (E) |
| K7a/K7b | `qtyOut NULL` 14 kapalı hareket → `getTravelerTrace:177` `null`, `work-session-activity:403` `null`; WIP okumaz | |
| K2b | `test_migration_hygiene.ts` `applied_steps_count=0` satırlarını UYARI basıyor (dev 40); `test_db_invariants.ts` sayıları `CLAUDE.md:239`'da bayat | (K) |
| K1a | H15 oturum damgası asimetrisi (`open-fabric` damgasız; `finish-step` non-enforcing; baskı non-enforcing) — aynı istasyonun iki yolu farklı makine atfı | (E) |

## J — Migration / kurtarma

| Kaynak | Gözlem | Not |
|---|---|---|
| K2b | H-1 yumuşak kapı (sahada `items_nameFold_key` yok; enforce elle `prisma db execute` — kim/ne zaman); H-2 audit tamper trigger varsayılan KAPALI + checklist ☐; H-3 `finalizedAt` trigger kaynak listesi sabit (yeni `RollStatus`'ta fail-open) + 4 damgasız final top backfill yok; H-4 composite FK ON UPDATE CASCADE (çuval sevkiyat değiştirince toplar DB tarafından yazılır — uygulama/audit/`preShipStatus` devre dışı; `shipping.service` bunu hesaba katıyor mu); H-5 tek aktif sevkiyat seddi kaldırıldı; H-7 `batches_batchNumber_key` DROP → tek koruma 8022 sırası (bekçi VARLIK mı SIRA mı — K11: SIRA sahte-tx); H-9 HEAD kodu sahada OLMAYAN `order_lines.cancelledAt`'i okuyor → migration'sız backend deploy = P2022/500 (`deploy/kur.ps1:287` `migrate deploy` adımı var); H-10 Prisma migration tx semantiği repo içi çelişkili (`20260714120000:4-5` "tek tx değil" vs `20260702120000:4-7` "tek tx") — yarıda kesilen migration senaryosu; H-11 `test_db_invariants` sahada §1 / dev'de §5 bilerek kırmızı (kırmızı körlüğü); H-14 sahada `WORK_ORDER_REWORK` defter dışı açılmış; H-15 per-DB GUC'lar ops adımı, kopyadan doğrulanamaz; H-16 dev `pg_db_role_setting`'de `_old_`/`_restore_` kopyaları | |
| K2b | Migration'lar iş kuralı verisine dokunuyor (`quality_grades.code='FIRE'`, `stations.code='SEVK_1'`, `machines.code='SEVK-M1'`, JSONB etiket şablonu `jsonb_set`); `20260611084953_native_uuid_pk_fk` dolu DB'de veri kaybı (taze kurulum + içe aktarım sırası ters kurulursa); enum değeri silme = `rolls` rewrite; `SET statement_timeout=0` 32 dosya, `lock_timeout` yok; dev defteri 40 `resolve --applied` (dosya↔DB eşitliği bekçilere devredildi); uygulandıktan sonra düzenlenen 2 migration (checksum doğrulanamadı) | |
| K4 | `reset-operational.ts` ve `clean_test_residue.ts` kapısız; `fixture-sack-constraint.ts` prod şemasına ALTER TABLE koşabilir; `db-copy.service` DDL yolu; `teks.audit_guard` kopyadan doğrulanamaz | (G) |
| K8 | H-1 backup damgası BAŞTA + idempotent değil (patlayan gece o gün retry edilmez — bilinçli, `BACKUP_FAILED` görünür); H-2 tek-process invariantı mekanik bekçisiz (dev'de çift-dump yarışı kanıtı); H-3 arşiv purge yolu canlıda hiç koşmadı (`SET LOCAL` aynı oturumda mı; 1M+ satır senaryosu); H-5 offsite-sweeper watchdog yok + F-OPS-VER-003 açık (rclone kurulu değil); H-6 saniye-çözünürlüklü dosya adı rename yarışı; H-7 bozuk kimlik onarım döngüsü (dev 15×); `pg-tool/pg-admin-client/offsite-backup` child process'leri | |
| K9 | H-5 offsite yerel dizin iki gerçek (panel SystemSetting ↔ iş env); H-9 saha `nightly` 1 koşum ↔ `BACKUP_SCHEDULE_ENABLED=false` (iki mekanizma aynı gece iki dump); H-3 verify allowlist; `_old_` DB'lerinin DELETE ucu yok (bilinçli) | |
| K12 | H6 `.env` git'te; H7 `ecosystem.config.js:107,124,143` boş (offsite/PITR yok, Y-4); H8 153/195 migration'da `SET statement_timeout` yok, lint yok (Y-5), dev `applied_steps_count=0` 40/195; H9 `productionDbGate` yalnız koşucuda; H16 `audit/PLAN.md:1118` RENAME öncülü yanlış; F-CORE-OPS-001 kapanış bütçesi ↔ tx bütçesi (`kill_timeout 8000` vs 20 s tx) OPS ayrı ölçsün; O-17 restore tatbikatı 6 ayda bir — iz yok | |
| K6 | H-9 (`files:[]`/`expected:[]`), H-16 (`app-version` fallback); `backup.service.ts:343-357` yayınlanmış yedeği koruma (doğru); `pg-tool.helper.ts:105-109` child timeout + SIGKILL (doğru) | |
| K7b | `finalizedAt` çıkışta silinmiyor — düzeltme trigger/migration ister; `receivedQty` backfill yok | (C) |
| K10 | `Order/OrderLine.cancelledAt` saha kopyasında yok → deploy sonrası saha'da yeniden koşulmalı; `items_nameFold_key` sahada yok (birleştirme + migration'ı yeniden koş) | |

## K — Test

| Kaynak | Gözlem | Not |
|---|---|---|
| K11 | HOTSPOT-1 bayat parti yorumları + gerçek DB paralel parti doğumu yok; HOTSPOT-2 8024/8027 bekçisiz; HOTSPOT-3 `createShipment`/`dispatchShipment` paralel yok (iade×iade, storno×storno); HOTSPOT-4 fason kabul yarışı born=1 (kaybeden 409 mu cached mi bilinmiyor), kısmi kabul/iptal/close-remainder paralel yok; HOTSPOT-5 Tambur undo/finalize→WO/farklı-token paralel kesim bekçisiz; HOTSPOT-6 kapanış dispozisyonu + sipariş bağla/iptal/kalem iptali paralel yok (FOR UPDATE yalnız metin muafı); HOTSPOT-7 `productionDbGate` yalnız koşucuda, host-adı allowlist, bayat sayılar; HOTSPOT-8 `test_wo_warehouse_attach.ts:109-118` 7 satır `.catch(() => {})` → 480 `TST-WHA` WO, `test_import_permissions.ts:224` 41 kullanıcı, 150 dosya/669 sessiz catch, `clean_test_residue` 5 önek; HOTSPOT-9 iptal-sonrası replay 4. durum yalnız Roll manuel top; HOTSPOT-10 `test_kk1_duplicate_guard` bayrak açarak ölçer (dahili çağıranlar kapsam dışı; 8021 sıra bekçisiz); HOTSPOT-11 24/33 sonda N=2, gecikme enjeksiyonu yok ("çoğu zaman yeşil kalır"); HOTSPOT-12 4 dosya hiç test izi yok; HOTSPOT-13 38 test `systemSetting` yazıyor (paylaşımlı DB + bellek önbelleği); HOTSPOT-14 kilit SIRASI yalnız 2 bekçide; HOTSPOT-15 tip geçidi filtreli koşumda atlanır / `SKIP_TYPECHECK` | |
| K11 | `test_consistency.ts` / `test_consistency_derived.ts` salt-okunurdur, `DATABASE_URL=<kopya>` ile prod kopyasına karşı koşulabilir; dev DB'deki 549 test-önekli WO dev'e karşı her ölçümü kirletir; `src/app.ts` job başlatmıyor (15 efemeral-app testi zamanlayıcı yan etkisi üretmez); `Teks-Erp/CLAUDE.md:356-360` `admin/123123` notu bayat olabilir | |
| K3a | Kilit SIRASININ bekçili olup olmadığı ölçülmedi; A21/A22/A23 için "N paralel → tam 1" bekçisi var mı; ABBA-1/-4 için hiçbir bekçi adı geçmiyor | |
| K3b | §2.3: 8021 paralel ✓ (sıra ✗), 8022 sıra ✓ (paralel ✗), 8023 kısmen, 8024 ✗, 8025 ✓, 8026 ✓, 8027 ✗, CNT ✓, WO satır kilidi sıra ✗ | |
| K6 | Bekçisiz yollar: process handler'ları/graceful shutdown, statü-taşıyan http-errors, `AppError.internal`/retry tükenmesi audit'sizliği, 57014/40P01 varış dalı, `PrismaClientValidationError` audit'sizliği; `test_observability_contract`'ın dal 7'yi ölçüp ölçmediği okunmadı | |
| K7b | Fason "açık kalem" AST bekçisi ham SQL'i görmüyor (§6.G); "aktif kalem" bekçisi görüyor — bekçi asimetrisi; `test_shipment_scorecard` daily Σ ölçmüyor (H1); `test_quality_scorecard` rework damgasını sondalamıyor (H2); `test_dashboard` "bugün" sınırı ölçmüyor; `test_order_intake` Σdaily.orderCount? | |
| K2b | `test_db_invariants` bilerek kırmızı politikası; `test_batch_number_format` VARLIK mı SIRA mı (K11: SIRA, sahte tx) | |
| K2a | Mobil/Electron enum ikizi bekçileri ("altıncı enum değeri unutuldu" sınıfı için üye-başına tüketici sayımı) | (L) |
| K9 | `test_offsite_sweep` sahte rclone — argüman enjeksiyonu (H-6) ölçülmüyor; import bekçileri gövde limiti/uçuşta çift koşum ölçmüyor; `test_db_copy` `TEST_DB_COPY=1` kapılı (varsayılan koşumda atlanır); raster CPU süresi ölçülmüyor; `test_mobile_update` kod imzalama koruması buradan doğrulanmalı | |
| K1a | `test_route_auth_coverage` HEAD'de kırmızı (`client-policy` `GET /` beyansız); `label-template.routes.ts:180 /:id` 9 literal yola bağımlı, mekanik bekçi yok | |
| K12 | 26 düzeltmenin 24'ü negatif sondayla kanıtlı bekçi taşıyor (güçlü yön); `test_hard_delete_guard_coverage` 69 yeni SET NULL bağı kapsıyor mu; `test_base_service_binding` yazılmadı; R5 `permission-management deleteTemplate/listPermissions` hâlâ testsiz; `user-preference.service` testsiz | |
| K5 | Bekçisi görünmeyen mekanizmalar: `requirePermission(undefined)`, `STATION_KIND_PERM ↔ SESSIONABLE_STATION_KINDS`, `resolveDevice` dalları, `resolveExact`, raw SQL allowlist'leri, `.env` izlenmemesi | |

## L — Kod kalitesi / hesap tekrarı

| Kaynak | Gözlem | Not |
|---|---|---|
| K7a | "açık = istenen − sevk" 13 nokta (kelepçe farkları, `netGap` kelepçesiz H8); spec eşleşmesi 5 semantik (§4.2); çuval toplamı 6-8 yüzey (ikisi hayalet süzgeçsiz, biri float H14); en eşitliği 3 semantik (H11); `qtyOut` fallback 3 varyant + NULL; çocuk `width` kaynağı 4 varyant (H10); para 2 formül (H16); `fmtTr` ×3, `round1` ×3, `normNum/num` ×2, `specMatch` ×2 (return.service birebir kopya), `D0()` ×5; `computeLoadedByLine` çağıranı bulunamadı (ölü?); `pieceLengthM` hesapta yok; `targetQuantity/targetWeight` hesapta yok; `allocatedQty` ölü | |
| K7a | Dönüşüm-sonrası aritmetik 15 nokta (§3.1: `inventory:2037-2081` çift yuvarlama, `sack-search:424/427`, `workorder:1763/1868/1882/2455/2488-2495/3729/3733/4174`, `shipping:1483/1490/3643/3665`, `order:140-144`, `inventory:4605-4619`, `tambur-plan-gate:112-113`, `subcontractor:3268`); yuvarlama politikası yazılı değil, yüzeye bağlı (§5) | (E) |
| K7b | "dönemde sevk" 8 yüzey / 3 semantik (§6.A); "üretilen metraj" 4 tanım (§6.B); "açık talep" +2 rapor noktası (§6.C); "fire oranı" 4 rakam (§6.D); "çekme oranı" mobil↔backend payda farkı (§6.E); aktif kalem 1 kaynak + 10 ham SQL kopyası (bekçili, §6.F); fason açık kalem helper + 2 ham SQL (bekçisiz, §6.G); `round1/pctOf` 2 tanım + 6 satır içi + Electron toplamları (§6.H); spec anahtarı 4 biçim (§6.I); fason atfı 2 kopya (§6.J); "sipariş adedi" 4 sayım 2 semantik (§6.K); "bitmiş stok/arz" 3 küme (§6.M); kalite kataloğu `isActive` süzgeci hiçbirinde yok (§6.N); `_shared.ts:172-202` `eachDay/ymdLocal` ölü, `production.report.service.ts:18` ölü import (H19); export 90 gün vs rapor 30 gün varsayılan (H20) | |
| K7b | Aynı kavram farklı kolon (§5.2): "sipariş ne zaman kapandı/alındı/iptal edildi", "fason işi ne zaman", "top ne zaman üretildi" (karne bitiş vs liste doğuş), "raftaki mal kaç günlük" (`statusChangedAt` vs `updatedAt`) | (E) |
| K4 | H4 RollMovement iki kapanış mekanizması + `notes` marker metni; H5 ham SQL `updatedAt` tazelemez; H10 üç "önceki statü" kolonu; H11 append-only log silme; H12 operasyon nesnesi hard delete (istisna listesinde yok); H13 `label.service` OrderLine yazımı sınır sızıntısı; H17 `StationColor` ölü yazma yolu; H1/H2/H3 bounded-context sızıntıları (fason WOS.status, order WO.status, IN_PROGRESS 7 site) | (E) |
| K6 | `AppError.isOperational` ölü alan; 27 gereksiz `.catch(() => undefined)` (audit sonrası çift katman); `instanceof` + `constructor.name` çift kontrol; P2002 fallback mesajında İngilizce kırıntı; `catch (`/`next(err)` 492 kez elle kopya (sarmalayıcı yok) | |
| K3b | Bayat yorumlar: 1-arg advisory uzayı (`duplicate-guard.helper.ts:22-23`, `shipment-locks.helper.ts:21-23`, `batch.service.ts:90-91`, `audit/surface/12-tx-global-gercekler.md:91`); `tambur.service.ts:2448-2458` (H-5 yorum↔kod); `traveler-card-dirty.helper` imzası tx ister ama `PrismaClient` yapısal uyar | |
| K12 | Belge bakımı: `audit/PLAN.md:1118` RENAME öncülü; `CLAUDE-NOT-ARSIVI.md:51` "ayrı iş"; `shipping.service.ts:145` bayat yorum; `rbac.middleware.ts` "67 kod" (70); `F-BLG-MIM-002` `expandMultilineText` export'u kaldırılmadı (risk yalnız yorumla); `mode:"insensitive"` kalan 28 (import adaptörleri; İ/ı katlamaz — TAN.dogruluk dar) | |
| K1b | H7 `/permanent` dört anlam (order=soft, workorder=arşiv, peripheral=tombstone, GHR=fiziksel; Swagger "fiziksel" der); H16 `record-info` route allowlist 9 ↔ servis `PROVENANCE_TABLES` 4 eksik (iki liste ayrışması); H15 Swagger hayalet uçlar; Swagger `PrintedDocType` 4/8 | (F) |
| K1a | `customer-branch-list.routes`/`defect-type.routes` route dosyasında `new BaseService` (katman gözlemi) | |
| K2a | `LabelOrientation` ölü enum; `Manifest` 0 satır; `StationColor` deprecated; `LabelTemplate` deprecated çift-yazım alanları; `TravelerCardTemplate` 0 satır (şablon yolu hiç kullanılmamış) | (C) |
| K9 | H-10 `RENDERERS` `Partial<Record>` fail-open ↔ `CONTENT_TYPES` tam `Record` (iki tablo farklı disiplin); `installation-identity` yorum↔kod (upsert); `offsite-backup.helper.ts` adı "helper" ama child process + config yazımı (§7.5 helpers tuzağı — tek çağıran) | |
| K10 | `RollBarcodeCounter.day` yorum bayat (H-13); `shipping.service.ts:2610` tek RepeatableRead belgeli (bilgi) | |
| K8 | `job-failure.ts` → `AuditService` + `pool-health` (job katmanından servise+lib'e; temiz); 12-tx §1 "dört mekanizma" listesi bayat (`jobs/` 9 dosya) | |
| K5 | `applyTemplate merge` batch tx vs `replace` interactive tx — iki farklı tx modeli aynı iş (bilgi); Swagger/morgan iki bayrak | |
