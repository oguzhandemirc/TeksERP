# K10 — İş Değişmezleri (Invariant) Envanteri

**Aşama:** ① KEŞİF (haritalama; yargı yok, bulgu yok — yalnız HOTSPOT işaretleri).
**Tarih:** 2026-08-28 · dal `adnansahin` · HEAD `ce8681d1` · Yazan: K10 haritalayıcı ajanı.
**Kaynaklar:** kök `CLAUDE.md` (karar notları dizini) · `docs/history/CLAUDE-NOT-ARSIVI.md` (tam metinler) · `Teks-Erp/CLAUDE.md` · `Teks-Erp/ARCHITECTURE.md` §4/§7/§8/§10.3 · `Teks-Erp/scripts/consistency-check.sql` (§1–§19) · `consistency-check-derived.sql` (§21–§26b) · `scripts/test_consistency.ts` (§20) · `scripts/test_consistency_derived.ts` · `scripts/test_db_invariants.ts` (şema-dışı nesne envanteri) · `prisma/schema.prisma` (yorumlar) · `src/services/**` (zorlama noktaları) · önceki haritalar K2a/K2b/K3a/K3b/K4/K5/K7a (satır referansları oradan alınıp koddan yeniden doğrulandı).
**DB erişimi:** yalnız `audit/tools/sql-saha.sh` (prod'un 2026-08-25 kopyası `tekserp_saha_0825`, 190/195 migration, salt-okunur). Bölüm 8'deki sorguların **tamamı** bu kopyada 2026-08-28'de koşturuldu; "Saha ölçümü" sütunları o koşumdan. Canlı prod'a erişim yok. Repo altında hiçbir dosya değiştirilmedi.

> **Okuma anahtarı.** Bu dosya *"sistem neyi doğru varsayıyor"* sorusunun listesidir. Her satır bir değişmezdir; ihlali bir bulgu **adayıdır**, bulgu değildir — ② denetçileri "Zorlama" ve "Eşzamanlılık" sütunlarındaki boşluklara bakar. "BİLİNÇLİ İHLAL" işaretli satırlar tasarım kararıdır, bulgu yazılmaz (Bölüm 7).

---

## 0. Sözlük — sütunların anlamı

| Sütun | Değerler |
|---|---|
| **Zorlama** | `DB:unique` / `DB:partial-unique` / `DB:CHECK` / `DB:FK` / `DB:trigger` (K2b envanteri) · `KOD` + `dosya:satır` (zorlayan ifade) · `TÜRETİM` (alan başka alandan yeniden hesaplanır, sed yok) · **`HİÇBİR YERDE`** |
| **Eşzamanlılık** | `unique` (DB seddi yarışı da kapatır) · `claim` (`updateMany WHERE {id, beklenen}` + `count`) · `advisory <NS>` (`pg_advisory_xact_lock(NS,…)`) · `FOR UPDATE` · `satır-kilidi` (`touchWorkOrderTx`/`touchOrderLinesTx`/sayaç `ON CONFLICT`) · `RR` (RepeatableRead tx) · **`YOK`** |
| **Bekçi** | `scripts/test_*.ts` adı (366 dosya var; yalnız değişmezi doğrudan ölçen anıldı) |
| **SQL §** | `consistency-check.sql` §1–§19, `test_consistency.ts` §20, `consistency-check-derived.sql` §21–§26b |
| **Q-ID** | Bölüm 8'deki doğrulama sorgusunun kimliği; ölçüm sonucu yanında |
| **Saha** | 2026-08-28 koşumu, kopya `tekserp_saha_0825` (2.431 top · 213 iş emri · 278 sipariş · 40 sevkiyat · 198 parti · 5 iade) |

Kısaltmalar: WO = WorkOrder · R = Roll · OL = OrderLine · SA = SackAllocation · DSA = SubcontractorDirectShipAllocation · RR = RollReturn · SDI = SubcontractorDispatchItem · SRI = SubcontractorReceiptItem · TC = TravelerCard · PD = PrintedDocument.

---

## 1. Global çerçeve (her değişmezin dayandığı üç varsayım)

| ID | Değişmez | Zorlama | Not |
|---|---|---|---|
| INV-SYS-01 | **Tek Express process** — `instances:1` + `exec_mode:"fork"`; bellek-içi presence / feature-flag cache / reason-preset cache / scheduler bayrakları buna dayanır | `ecosystem.config.js:47-48` (+ yorum :42) · `ARCHITECTURE.md:969-989` §10.3 | Kod-içi zorlama YOK (YAGNI, belgeli). Bekçi: yok — `instances:"max"` yapılsa hiçbir test kırmızı vermez ([VARSAYIM] K8/K3b sahibinde) |
| INV-SYS-02 | **Durum geçişi = atomik claim**: `updateMany WHERE {id, gözlenen durum}` + `count===0 → 409`; `findUnique→if→update` YASAK; claim sonrası içerik tx İÇİNDE taze yüklenir | `ARCHITECTURE.md:559-577` §8.8; 24+ nokta / 10 servis; sınıflandırma K3a §6, K3b §5-L13 | İstisnalar (claim'siz karar) K3a §6 #1-#23 ve K3b §5'te listeli — bu dosyada ilgili satırlarda "Eşzamanlılık: YOK/kısmi" olarak işaretlendi |
| INV-SYS-03 | **İdempotency** — kayıt yaratan uçlar `clientToken @unique` taşır (Roll · Order · WorkOrder · Sack · Shipment · SubcontractorReceipt · SwatchStockReduction · ImportRun); token **mantıksal deneme başına bir kez**, yalnız belirsiz hatada (ağ/timeout/5xx) yapışır; iptal edilmiş kaydın replay'i 409 | `schema.prisma:1331/1965/2157/3474/3807/4133/4220/5328` (`DB:partial-unique … IS NOT NULL`, K2b §1.2); replay dalları: `inventory.service.ts:955-1005` (KK1), `subcontractor.service.ts:2345-2360` (fason kabul, iptal → 409), `workorder.service.ts:1083-1089` (`isClientTokenP2002` retry etmez), `kartela.service.ts:1363-1370` | ⚠️ KK1 replay'i (`:963-985`) `existing.status`'e BAKMAZ — iptal/fire edilmiş topun token replay'i `success:true` döner (K3a §6 #13) → **HOTSPOT H-1** (saha: 227 CANCELLED/SCRAP top `clientToken` taşıyor, Q-STK-10) |
| INV-SYS-04 | **Sayaç kilitleri** — belge/parti/barkod üretimi tek noktadan serileşir: 8021 KK1 mükerrer-giriş, 8022 parti no, 8023 sevkiyat kapsamı, 8024 oturum, 8025 son-admin, 8026 kumaş kodu, 8027 birleştirme; top barkodu `roll_barcode_counters` satır kilidi (`ON CONFLICT … n=n+count`); belge no `withBarcodeRetry` + `@unique` P2002 | `duplicate-guard.helper.ts:28`, `batch.service.ts:96/:126`, `shipment-locks.helper.ts:28/:58`, `session-registry.service.ts:79`, `permission-management.service.ts:609`, `code-unique.helper.ts:81`, `master-data-merge.service.ts:546`, `roll-barcode.helper.ts:74-80`, `utils/barcode-retry.ts:15-45` | Sıra load-bearing (kilit korunan okumadan ÖNCE): K3a §3.3 ve K3b §6 doğruladı. 1-argümanlı `pg_advisory_xact_lock(bigint)` kullanımı **0** (bekçi `test_shipment_scope_lock.ts`) |
| INV-SYS-05 | **Audit best-effort** — `AuditService.log` içte try/catch, tx DIŞINDA ve commit SONRASI; yazım düşerse istek düşmez, `/health` sayacı artar | `audit.service.ts:18-20, :110, :153, :193`; `ARCHITECTURE.md:499-516` §8.5 | **BİLİNÇLİ İHLAL** ("her CUD → audit" garantili değil, gözlemlenebilir-kayıplıdır). Ölçüm Q-AUD-01 |
| INV-SYS-06 | **Fiziksel DELETE yok** — soft delete (`isActive:false` / `CANCELLED`); bilinçli istisnalar: bağımlılık-guard'lı master-data `/:id/permanent`, boş çuval silme, cihaz unpair, pivot replace, `sackAllocation.deleteMany` (defter sil-yaz), `system_logs` arşiv taşıma | kök `CLAUDE.md` "Ortak Konvansiyonlar"; envanter K4 §5 (74 site) | Bu dosya silme envanterini yinelemez — K4 §5 |
| INV-SYS-07 | **Zaman** — her `DateTime` `timestamptz`; havuz oturumu UTC (`-c timezone=UTC` load-bearing); fabrika günü `Europe/Istanbul` tek kaynak `constants/time.ts` | `Teks-Erp/CLAUDE.md:267-287`; bekçi `test_timestamptz_contract.ts`, `test_report_day_boundary.ts`, `test_raw_sql_hygiene.ts` | Belge no'daki GGAAYY fabrika günüdür (`dailyCodePrefix`) — Q-DOC-02 buna göre gruplar |

---

## 2. Değişmez envanteri

### 2.1 Metraj / stok (Roll)

| ID | İfade (formül) | Varlık | Zorlama | Eşzamanlılık | Bekçi | SQL § | Q-ID · Saha | Not |
|---|---|---|---|---|---|---|---|---|
| INV-STK-01 | `currentQty ≥ 0 ∧ initialQty ≥ 0 ∧ (weightKg IS NULL ∨ weightKg ≥ 0)`; `OL.quantity > 0`, `OL.shippedQty ≥ 0`, `SA.qty > 0`, `RollVariance.qty > 0`, movement qty'leri ≥ 0, `SDI.dispatchedQty > 0` | R, OL, SA, RM, RV, SDI | **DB:CHECK** (26 kısıt, K2b §1.1: `rolls_currentQty_nonneg` … migration `20260708120000:13-20`, `20260731120000:20-53`, `20260809015353:52`) | unique/CHECK — yarış yok | `test_db_invariants.ts` §2 (:197-229) | §3 | Q-STK-01 · **0** | Kısmi kabul decrement'i `WHERE currentQty > receivedQty` koşuluyla CHECK'e çarpmadan 409 verir (`subcontractor.service.ts:2879-2890`) |
| INV-STK-02 | **Top yalnız kesimle azalır:** `currentQty ≤ initialQty`. Artış yalnız geri almada ve `initialQty` yukarı çekilip `OVERAGE` sapması yazılarak | R | **KOD** — Tambur kesim doğrulaması `tambur.service.ts:732-753` (Decimal, `overQuantityEnabled` açıksa aşım kabul + `OVERAGE` `:1269-1276`); geri alma bump `tambur-undo.service.ts:1130-1141` (`initialBump` → `recordVarianceTx`); şema notu `schema.prisma:1613-1629` | claim `{id, IN_PRODUCTION, currentStepId}` `tambur.service.ts:953-959`; undo `:1143` claim | `test_tambur_undo.ts` §11 (2026-08-22 kör nokta kapatıldı), `test_consistency.ts` §13 | **§13** | Q-STK-02 · **2 satır** (barkodsuz IN_PRODUCTION 492→698,9 ve 500→520,5) | 2 eski satır **BİLEREK düzeltilmedi** (CLAUDE.md 2026-08-22: "toplu UPDATE kök nedeni gizler; bölümü DARALTMA"). DB seddi YOK (CHECK `currentQty <= initialQty` yazılmadı — geri alma bump'ı aynı ifadede yazdığı için yazılabilirdi; ② değerlendirsin) |
| INV-STK-03 | **Kesim çocukları toplamı:** `Σ cuts.length ≤ parent.currentQty` (aşım bayrağı açıksa aşılabilir, o zaman `RollVariance(OVERAGE, TAMBUR_OVERCUT)` yazılır); kalan otomatik son çocuk; parent `TAMBUR_CONSUMED`, `currentQty=0`, `preTamburCloseQty = kapanış anındaki currentQty` | R (parent/child) | **KOD** `tambur.service.ts:732-753` (validasyon), `:1190-1200` (retire), `ARCHITECTURE.md:342-369` §7.1 | claim `:953-959` + `raceLost` idempotent yanıt `:967-969, :1286-1289` | `test_tambur_undo.ts`, `test_tambur_manual_*.ts` | — (§13 dolaylı) | Q-STK-03 · **2 satır** (`T080826F0017` TAMBUR_MANUAL `initialQty=0`, çocuk 20+0 m; `T080826F0020` `initialQty=0`, çocuk 33+6 m — ikisi de 08.08, sapma defteri öncesi) · Q-STK-03b: aşımlı 34 parent, 32'si OVERAGE defterli | `preTamburCloseQty` **kapanış anı** metrajıdır (Top Kesme akışında kesim başına düşürülmüş kalan), toplam DEĞİL — doğrulama `initialQty` üzerinden kurulur. → **HOTSPOT H-3** (parent `initialQty=0` iken tüketilmiş çocuk) |
| INV-STK-04 | `TAMBUR_CONSUMED ⇒ currentQty = 0 ∧ currentStepId IS NULL ∧ ∃ çocuk (parentRollId = id)` | R | **KOD** `tambur.service.ts:1190-1200`, `:2473-2476` (Top Kesme finalize), `:3208` | claim | `test_tambur_undo.ts` | — | Q-STK-04 · **0** | Geri alma parent'ı diriltir (`tambur-undo` `IN_PRODUCTION`'a claim) — terminal DEĞİL |
| INV-STK-05 | **Movement kapanış semantiği:** normal FINISH → `qtyOut = qtyIn`; tekil top iptali (storno) → `qtyOut = 0` ("mal hiç geçmedi"); fire/WO dispozisyonu → `qtyOut = qtyIn`; fason sevk iptali → `qtyOut NULL` (uydurulmaz) | RM | **KOD** `inventory.service.ts:3236-3244` (`isScrap ? qtyIn : 0`), `roll-disposition.helper.ts` `closeOpenMovementsTx`, `subcontractor.service.ts:2071-2083`; muaf desen listesi `test_consistency.ts:280-330` | claim benzeri (`exitedAt IS NULL` koşullu kapanış) | `test_consistency.ts` §12 | **§12** | Tur 2 (§12 test_consistency içinde) | 13 ham SQL + 9 Prisma kapanış sitesi (K4 §2) — iki mekanizma |
| INV-STK-06 | **Serbest arz tanımı:** `status ∈ {WAREHOUSE, A1_STOCK, STOCK} ∧ shipmentId IS NULL ∧ sackId IS NULL`; yarı mamul (`entrySource=SEMI_FINISHED`, statü STOCK) **arza dahil**, ayrı gösterilir | R | **KOD** `production-balance.service.ts:419-429` (`malzemeAcigi = max(0, uretilecek − (ham + yariMamul))`), `order.service.ts:1588-1642` (`freeSemiFinished`), `shipping.service.ts:3330-3353` | — (okuma) | `test_semi_finished_surfaces.ts` (10; §4 "toplam korunuyor") | — | Q-STK-06 · STOCK/SUPPLIER_RECEIPT 283 (29.353 m) · WAREHOUSE/TAMBUR_SPLIT 238 (27.258 m) · SEMI_FINISHED **0** | Kural tek cümle: "yarı mamul ARZDIR, düşülmez" (CLAUDE.md 2026-08-27 3. tur). ⚠️ `RAW_STOCK` kapsamı bilerek GENİŞ (ham+yarı mamul) — daraltılamaz |
| INV-STK-07 | **Satılabilir top barkodlu:** `status ∈ {WAREHOUSE, A1_STOCK} ⇒ barcode IS NOT NULL` | R | **KOD** `roll-finalize.helper.ts:138-199` (barkod yoksa üret, tip `finalBarcodeType` :121-123), dispozisyon motoru `roll-disposition.helper.ts` (`reserveRollBarcodes` :296 K3a §4) | sayaç satır-kilidi | `test_barcode_reservation.ts`, `test_consistency.ts` §8 | **§8** | Q-STK-07 · **0** | `SCRAP` barkodsuz olabilir (fire — `skipLabel`) |
| INV-STK-08 | **Üretim damgası:** `finalizedAt`/`statusChangedAt` yalnız **trigger** yazar; `finalizedAt` = `{IN_PRODUCTION,STOCK,AT_SUBCONTRACTOR,RETURNED…} → {WAREHOUSE,A1_STOCK,SCRAP}` geçişinde (INSERT'te final doğan top dahil); `SHIPPED`/`CANCELLED` kaynak listede **BİLEREK YOK**; üzerine yazılır (write-once değil) | R | **DB:trigger** `rolls_stamp_production_timestamps` (`20260809090000:45-96`), uygulama kodu kolonu yazmaz (K4 §4: src 0) | trigger — yarış yok | `test_db_invariants.ts` §6 (:281-290) | — | Q-STK-08 · WAREHOUSE 3/250 ve SCRAP 1/1 damgasız (hepsi 2026-08-08, trigger öncesi; backfill kapsam dışı [VARSAYIM K4]) | ⚠️ `WAREHOUSE → SCRAP` (fire ucu) damgayı TAZELEMEZ (kaynak listede WAREHOUSE yok) — K4 H9 |
| INV-STK-09 | **Top barkodu tekil + biçim** `T + GGAAYY + {H|F} + NNNN`; sayaç `roll_barcode_counters(day,type)` tek ifadede `n = n + count RETURNING`; boşluk bilinçli (rollback'te numara yanar) | R, RollBarcodeCounter | **DB:unique** `rolls.barcode` (`schema.prisma:1326`) + **satır-kilidi** `roll-barcode.helper.ts:74-80` (belgesi :47-72) | satır kilidi (`ON CONFLICT DO UPDATE`) — tx sonuna dek tutulur | `test_barcode_reservation.ts` | — | Q-STK-09a biçim dışı **0** · Q-STK-09b sayaç geride **0** | Şema yorumu `day = YYMMDD` der (`schema.prisma:2710`), veri **GGAAYY** (`240826` = 24.08.26) — yorum bayat (bilgi). Kilit süresi H-2 (K3b): finalize'da tx içinde |
| INV-STK-10 | **clientToken replay dört durumu** (KK1): kayıt var+geçerli → 200 mevcut; farklı payload → 409 `CLIENT_TOKEN_COLLISION`; token yok → yeni kayıt; **kayıt iptal edilmiş → 409 olmalı** | R | **KOD** `inventory.service.ts:955-1005` (ilk üçü) | `DB:partial-unique` `rolls_clientToken_key` | `test_client_token_idempotency.ts`, `test_kk1_duplicate_guard.ts` | — | Q-STK-10 · **227** iptal/fire top token taşıyor (replay yüzeyi); Q-STK-10b aynı token iki top **0** | Dördüncü durum KK1'de **YOK** (Tambur manual `ENTRY_CANCELLED` ve fason kabul `:2354-2360` uygular) → **H-1** |
| INV-STK-11 | **Bir top bir adımda en fazla BİR açık movement**; bir topun aynı anda birden çok adımda açık movement'ı olmaz | RM | **DB:partial-unique** `roll_movements_one_open_per_roll_step_uq (rollId, workOrderStepId) WHERE exitedAt IS NULL` (`20260612101000:38-40`; şema notu `schema.prisma:3269-3274`) | unique (çift START/SKIP/FINISH kaybedeni P2002) | `test_db_invariants.ts` §1 | §11 (dolaylı) | Q-STK-11a **0** · Q-STK-11b (>1 adımda açık) **0** | İkinci yarısı (farklı adımlar) **HİÇBİR YERDE** DB'de değil; `openMovementForNextStep` önce eskisini kapatır (KOD) |
| INV-STK-12 | `IN_PRODUCTION ⇒ currentStepId IS NOT NULL ∧ WO.status ∉ {CANCELLED, SUPERSEDED}` ("canlı ama okutulamayan top" yok) | R, WO | **KOD** — `manualMoveWoBlockReason` `workorder-manual-move.service.ts:62-70` (409), Tambur finalize guard'ı (`tambur.service.ts` "iptal/devredilmiş iş emrinin topu finalize edilemez"), WO iptali dispozisyon ister (`workorder.service.ts:3387-3400` claim + dispozisyon) | WO claim + roll claim | `test_manual_move.ts`, `test_consistency.ts` §10 | **§10** | Q-STK-12 · **0** | Çıkış yolu "Kurtar" (`rescueStuckRoll`, `roll:manual-adjust`) |
| INV-STK-13 | **Hayalet movement yok:** `exitedAt IS NULL ⇒ roll.status ∉ ölü küme ∧ roll.currentStepId = movement.workOrderStepId` | RM, R | **KOD** — her statü geçişi açık movement'ı kapatır (`closeOpenMovementsTx`, `inventory.softDelete`, finalize) | koşullu kapanış (`exitedAt IS NULL`) | `test_consistency.ts` §11, `test_roll_cancel_step_recompute.ts` | **§11** | Q-STK-13 · **0** | — |
| INV-STK-14 | `currentStepId IS NOT NULL ⇒ status ∈ {IN_PRODUCTION, AT_SUBCONTRACTOR, RETURNED_FROM_SUBCONTRACTOR}` (final/ölü/serbest top adıma bağlı olamaz) | R | **KOD** — finalize `roll-finalize.helper.ts:184-190` (`currentStepId:null`), dispozisyon `roll-disposition.helper.ts:232-241`, fason tüketim `subcontractor.service.ts:2863`, `:3422`, `:6116` | claim | — (doğrudan bekçi yok) | — | Q-STK-14 · **0** | **HİÇBİR YERDE** DB seddi yok; bekçi yalnız dolaylı |
| INV-STK-15 | **Çuvalda hayalet içerik yok:** `sackId IS NOT NULL ⇒ status ∉ SACK_ABSENT_STATUSES` (8 statü; `SHIPPED` bilerek dışarıda) | R, Sack | **KOD** — `sack-invariants.helper.ts:35-44` (tek kaynak), sevkte tx-içi assertion `shipping.service.ts:1835-1849` (fail-closed: filtre değil hata), `scanIntoSack` guard'ı `NON_SACKABLE_STATUSES` | claim (`sackId` pinli) | `test_sack_pool_lifecycle.ts`, `test_consistency.ts` §7/§7b/§7c | **§7, §7b, §7c** | Q-STK-15 · **0** | Onarım aracı `scripts/repair_sack_ghost_rolls.ts` |

### 2.2 Statü makineleri

#### INV-SM-01 — `Roll.status` izinli geçişler (enum `schema.prisma:154-168`; 57 yazma sitesi, K4 §2)

| Geçiş | Yol (dosya:satır) | Eşzamanlılık |
|---|---|---|
| `STOCK → IN_PRODUCTION` | `attachRolls`/`quickStart` (`workorder.service.ts:4444+`, claim :4494), fason `dispatch` autoAttach (:1084) | claim `{id, STOCK}` |
| `WAREHOUSE / A1_STOCK / STOCK → IN_PRODUCTION` (yeniden üretim) | `quickStart`/`attachRolls` (2026-08-25: "her işlem final üretir"); `kursun-qc.reopenStep` `:1124-1135` (**SCRAP dahil!**) | claim |
| `IN_PRODUCTION → AT_SUBCONTRACTOR` | fason `dispatch` `subcontractor.service.ts:1035+` | claim + WO satır-kilidi |
| `AT_SUBCONTRACTOR → STOCK` (sevk iptali, mal hiç çıkmadı) | `subcontractor.service.ts:2052-2062` | claim `{AT_SUB, currentStepId}` |
| `AT_SUBCONTRACTOR → SUBCONTRACTOR_CONSUMED` | tam kabul `:2844-2863`, kalan kapama `:3420-3423`, doğrudan sevk `:6111-6120` | claim |
| `SUBCONTRACTOR_CONSUMED → AT_SUBCONTRACTOR` (makbuz iptali) | `:4918-4935` (LIFO guard :4752-4775) | claim |
| `IN_PRODUCTION → WAREHOUSE / A1_STOCK / SCRAP` (finalize) | `roll-finalize.helper.ts:184-199` (son adım), Tambur çocukları doğuşta final (`tambur.service`), dispozisyon `roll-disposition.helper.ts:232-241` | claim `{id, IN_PRODUCTION, shipmentId:null, sackId:null}` |
| `IN_PRODUCTION → TAMBUR_CONSUMED` | `tambur.service.ts:953-959` | claim + raceLost |
| `TAMBUR_CONSUMED → IN_PRODUCTION` (geri alma) | `tambur-undo.service.ts:1143`, `:1260`, `:1330` | claim; **WO kilidi yok** (K3b H-1) |
| `WAREHOUSE / A1_STOCK → SHIPPED` (+`preShipStatus`) | `performDispatchTx` `shipping.service.ts:1858-1869` | sevkiyat claim :1812 + `updateMany {shipmentId, status}` |
| `SHIPPED → preShipStatus ?? WAREHOUSE` (storno) | `undoDispatch` `:2197-2208` | advisory 8023 + claim :2185 |
| `SHIPPED → appliedStatus (WAREHOUSE/A1/SCRAP)` (iade) | `return.service.ts:501-511` | advisory 8023 + claim `{id, SHIPPED}` |
| `appliedStatus → SHIPPED` (iade iptali) | `return.service.ts:879-890` | claim `{id, expectedStatus, shipmentId:null, sackId:null}`; **8023 alınmıyor** (K3a §6 #15) |
| `WAREHOUSE → AT_KARTELA → KARTELA_CONSUMED` | `kartela.service.ts:323`, `:676-683` | çoklu claim count===len |
| `{STOCK, WAREHOUSE, A1_STOCK, IN_PRODUCTION} → CANCELLED / SCRAP` | `inventory.softDelete` `:3253-3262` (mod: CANCELLED "hiç yoktu" · SCRAP "vardı gitti"), `hardDelete` `:3561-3568` (STOCK→CANCELLED), dispozisyon | claim `{id, status, shipmentId}` |
| `CANCELLED → preCancelStatus ∈ {WAREHOUSE, A1_STOCK, STOCK}` (iptali geri alma) | `inventory.restoreCancelledRoll` `:3396-3460`, kural `roll-cancel-restore.helper.ts:62-116` | claim `{id, CANCELLED}` (havuz client'ında) |
| `IN_PRODUCTION → STOCK / WAREHOUSE / A1_STOCK / SCRAP / CANCELLED` (WO kapanış dispozisyonu) | `roll-disposition.helper.ts:151-262` | claim |
| `IN_PRODUCTION (fason adımı) → IN_PRODUCTION` (manuel taşıma AT_SUBCONTRACTOR YAPMAZ) | `workorder-manual-move.service.ts` | claim |

**Terminal sayılanlar:** `KARTELA_CONSUMED` (dirilten yol bulunmadı [VARSAYIM]); `SUBCONTRACTOR_CONSUMED` ve `TAMBUR_CONSUMED` **geri alınabilir** (iptal/undo); `SCRAP` "fire geri alınamaz" denir (CLAUDE.md 2026-08-25) ama `reopenStep` `:1124-1131` SCRAP'ı `IN_PRODUCTION`'a çeker → **HOTSPOT H-4**. `RETURNED_FROM_SUBCONTRACTOR` legacy. **DB'de geçiş seddi YOK** (enum CHECK'i yok) — tüm makine KOD + claim ile tutulur.

#### INV-SM-02 — `WorkOrder.status` (enum `:207-218`)

| Geçiş | Yol | Eşzamanlılık |
|---|---|---|
| `PLANNED → IN_PROGRESS` | `ensureWorkOrderInProgress` `roll-step.helper.ts:181-189` (yalnız PLANNED'ı hedefler), `lockWorkOrder` `workorder.service.ts:6100` (havuz) | `updateMany {id, PLANNED}` |
| `IN_PROGRESS → COMPLETED` | `completeWorkOrderIfStepsDone` `:193-214` (kalan adım 0 ∧ `notIn` terminal), manuel `completeWorkOrder` claim `workorder.service.ts:3866-3877` | claim; helper çağıranın `touchWorkOrderTx` almasını ister (:190-191) — **tambur-undo almıyor** (K3b H-1) |
| `COMPLETED → IN_PROGRESS` (diriltme) | `manualMove` `:816`, `reopenStep` `kursun-qc.service.ts:1142-1145`, `tambur-undo` `:1378/:1669`, `tambur-manual` `:1194` | `updateMany {id, COMPLETED}` |
| `{PLANNED, IN_PROGRESS} → CANCELLED` | `softDelete` claim `:3387-3400` (`notIn` COMPLETED/CANCELLED/SUPERSEDED) + dispozisyon | claim ÖNCE, fason guard SONRA (F57) |
| `{PLANNED, IN_PROGRESS} → SUPERSEDED` | `supersedeEmptiedSourceWorkOrderTx` `workorder-split.service.ts:276-300` (canlı top 0 ise) | claim `{status in [PLANNED, IN_PROGRESS]}` |
| `CANCELLED / SUPERSEDED → *` | **YASAK** — `completeWorkOrderIfStepsDone` `notIn`, `manualMoveWoBlockReason`, `PLAN_CHANGE_FROZEN_STATUSES` `workorder-target-color.helper.ts:56-60` | — |

Türetilmiş kural: `IN_PROGRESS ∧ ∀adım ∈ {COMPLETED, SKIPPED} ⇒ drift` (INV-WO-04, §22). `type` bağın aynası (INV-WO-01). `STOCK_PRODUCTION ⇒ targetItemId NOT NULL` (**DB:CHECK** `work_orders_stockprod_targetItem`).

#### INV-SM-03 — `WorkOrderStep.status` TÜRETİLMİŞ alandır (enum `:220-225`)

| ID | İfade | Zorlama | Eşzamanlılık | Bekçi | SQL § | Q-ID · Saha | Not |
|---|---|---|---|---|---|---|---|
| INV-SM-03 | Tek yazıcı `recomputeStepStatus` (`roll-step.helper.ts:29-150`): `SKIPPED` dokunulmaz; `open>0 → ACTIVE`; `closed=0 ∧ pending=0 → PENDING`; `closed>0 ∧ pending=0 → COMPLETED`; aksi `ACTIVE`/`PENDING`. **Giriş noktası kuralı:** top, iş emrine girdiği adımdan ÖNCEKİ adımlar için bekleyen DEĞİLDİR (`entrySeq ≤ stepSequence`, `:123-126`); çözülemezse bekleyen say (fail-safe) | **TÜRETİM** (sed yok); ⚠️ `subcontractor.service.ts` 7 sitede statüyü DOĞRUDAN yazıyor (`:1108`, `:2118/2128`, `:2959`, `:3474`, `:6175`, `:6199` — K4 §2) | çağıran WO satır-kilidi | `test_consistency.ts` **§20** (`:436-520`), `test_roll_cancel_step_recompute.ts`, `test_manual_move_backflush.ts` | **§20** | Tur 2 (test_consistency §20; saha yedeğinde §20 0 satır — `test_consistency_derived.ts:65`) | `WO CANCELLED ⇒ adımlar SKIPPED` kuralı yalnız 2026-08-05 sonrası: Q-SM-02b **3 CANCELLED WO'da PENDING adım** (IE2207260003/4, IE2807260001 — Temmuz kayıtları, bilgi) |

#### INV-SM-04 — `Shipment.status` (enum `:4106-4110`)

| Geçiş | Yol | Eşzamanlılık |
|---|---|---|
| `∅ → PLANNED` (onay AÇIK) / `∅ → DISPATCHED` (onay KAPALI, aynı tx) | `createShipment` `shipping.service.ts:1397-1428` | `withBarcodeRetry` + çuval claim `{id, shipmentId:null}` :1414-1419 |
| `PLANNED → DISPATCHED` | `performDispatchTx` `:1812-1822` | claim |
| `PLANNED → CANCELLED` | `cancelPlannedShipmentTx` `:1961-1985` | claim |
| `DISPATCHED → PLANNED` (storno) | `undoDispatch` `:2185-2189`; bloklar: fatura işareti / aktif iade / aynı-gün bayrağı (`resolveUndoBlockReason`) | advisory 8023 (:2159, `rollReturn.count`'tan ÖNCE) + claim |
| `DISPATCHED → CANCELLED` | yalnız storno + kapatma zinciri (`releaseSacks`, aynı tx) | — |

Denorm: `ShipmentOrder.isActive ⇔ status = PLANNED` (§5, Q-SEV-11 **0**); `dispatchedAt IS NOT NULL ⇔ DISPATCHED` (Q-SM-04 **0**); `Sack.seq IS NOT NULL ⇔ Sack.shipmentId IS NOT NULL` (§6, Q-SEV-09 **0**). **DB'de statü seddi YOK.**

#### INV-SM-05…SM-11 — diğer makineler

| ID | Varlık | İfade | Zorlama | Eşzamanlılık | Bekçi / SQL | Q-ID · Saha |
|---|---|---|---|---|---|---|
| INV-SM-05 | Sack | Statü enum'u YOK: `shipmentId NULL` = depoda (her an düzenlenebilir), dolu = sevkiyatta (içerik değişmez). Depo çuvalı içeriğine dokunan her tx İLK işi `touchWarehouseSackTx` (`WHERE shipmentId IS NULL`, 0 → 409); PLANNED çuval kümesi `touchShipmentPlannedTx`; içerik değişince `resetSackWeightsTx`. **İstisna:** `Sack.notes` guard'sız (annotation) | **KOD** `shipment-locks.helper.ts:65-96`; `ARCHITECTURE.md:589-597` §8.10 | koşullu dokunuş = claim | `test_sack_pool_lifecycle.ts`, `test_sack_notes.ts` | Q-SEV-09/-17/-18 **0** |
| INV-SM-06 | SubcontractorDispatch | Enum yok; `cancelledAt` / `directShippedAt` damgaları. "Mal dışarıda" = **OPEN_OUTSTANDING dörtlüsü**: iptal değil ∧ doğrudan-sevk değil ∧ kalemde `remainderClosedAt NULL` ∧ kalemin iptal edilmemiş **TAM** (`isPartial=false`) makbuzu yok | **KOD tek kaynak** `fason-open-dispatch.helper.ts:48-80`; kopya AST bekçisiyle YASAK | — | `test_fason_open_dispatch_single_source.ts`, `…_semantics.ts`; **§24a/§24b** | Q-FAS-02 (§24b) **0** |
| INV-SM-07 | Batch | Statü yok. "Açık parti" = canlı topu var (`K18_DEAD_STATUSES` dışında; `SCRAP` partiyi KAPATMAZ); `mergedIntoId` = tombstone; kimlik `id` | **KOD** `batch.service.ts:55-60` | — | `test_tambur_manual_batch.ts` | Q-PAR-05: 13/198 partinin canlı topu yok (bilgi) · Q-PAR-07 tombstone partide top **0** |
| INV-SM-08 | Order | `PENDING → APPROVED → PARTIAL_SHIPPED → COMPLETED / CANCELLED` (`schema.prisma:190-200`). Tek yazıcı `recomputeOrderStatus`: `shipped ≤ 0 → APPROVED`; `totalRequired − shipped ≤ tolerans (varsayılan 5 m) → COMPLETED`; aksi `PARTIAL_SHIPPED`; `CANCELLED` ve manuel-kapalı `COMPLETED` terminal (denorm yine yazılır); iptal kalem toplama `quantity` DEĞİL `shipped` katar; tüm kalemler iptal → `shipped>0 ? COMPLETED : CANCELLED` | **TÜRETİM** `order-status.helper.ts:96-199`; manuel iptal claim `order.service.ts:3141-3148`, reopen claim `:3397-3410` | claim + `touchOrderLinesTx` protokolü (`:203-211`); ⚠️ `reopen` (:3411) ve `update` (:2537) recompute'u **kilitsiz** çağırıyor (K3a §6 #23) | `test_order_cancellation.ts`, `test_order_line_scope_single_source.ts`, `test_helpers.ts` | Q-SM-08 (saha varyantı, kalem iptali kolonu yok) **0** |
| INV-SM-09 | TravelerCard | `ACTIVE → COMPLETED` (WO COMPLETED), `ACTIVE → VOIDED` (WO iptal/tebdil, tekil void), `COMPLETED → ACTIVE` (reopen/diriltme); `REPRINTED` eski; bir WO = TEK kart | **DB:unique** `traveler_cards.workOrderId` (`schema.prisma:3166`); fan-out `traveler-card-fanout.helper.ts:19-40` (6 servis çağırır) | `updateMany {workOrderId, status in from}` | `test_traveler_card_stale.ts`, `test_traveler_print_active_card.ts`; **§16** | Q-WO-05 **0** · Q-WO-06 (kart↔WO) **0** |
| INV-SM-10 | PrintedDocument | `ACTIVE → SUPERSEDED` (reissue, gerekçe zorunlu) / `ACTIVE → VOIDED` (kaynak iptal/storno); `version = max(version)+1` (sabit 1 DEĞİL — storno sonrası ikinci dondurma); kaynakta tek ACTIVE; `TRAVELER_CARD` tipi kendi kendini yönetir (generic freeze/reissue kapalı) | **DB:unique** `(docType, sourceId, version)` `:4038`; **KOD** `printed-document.service.ts:313-347` (version :332-341), `SELF_MANAGED_DOC_TYPES` `:169-172` | claim (`:674/:761` K3b L13); `version` sayımı **kilitsiz** `findFirst` (K3b L4/L5) | `test_printed_documents.ts`, `test_printed_doc_builders.ts`, `test_traveler_card_versions.ts` | Q-DOC-04a **0** · Q-DOC-04b (>1 ACTIVE) **0** · Q-DOC-03b **0** |
| INV-SM-11 | KursunBypassAssignment | Append-only; adım başına ≤1 **açık** (`completedAt NULL ∧ cancelledAt NULL`) atama; açık atama ⇒ sahibi WO canlı (devir/tebdil/iptalde repoint ya da void) | **DB:partial-unique** `kursun_bypass_one_pending_per_step_uq` (`20260731120000:91-93`; P2002 → anlamlı hata `kursun-bypass.service.ts:994-996`); **KOD** `repointPendingBypassAssignmentsTx` `kursun-bypass-guard.helper.ts:149-175`, `voidStalePendingBypassAssignmentsTx` `:199+` | unique + claim (`:955/:1176/:2272`) | `test_kursun_bypass.ts`, `test_kursun_bypass_repoint.ts`; **§23** | Q-SM-11 **0** · Q-SM-11b **0** (saha: 2 atama, 0 açık) |

### 2.3 Sevk / çuval

| ID | İfade (formül) | Varlık | Zorlama | Eşzamanlılık | Bekçi | SQL § | Q-ID · Saha | Not |
|---|---|---|---|---|---|---|---|---|
| INV-SEV-01 | **Defter-otoritatif sevk toplamı:** `OL.shippedQty = Σ SA.qty [sack.shipment.status = DISPATCHED] + Σ DSA.qty`; `Order.shippedQty = Σ OL.shippedQty`; **PLANNED tahsis SAYILMAZ**; rezerv/packedQty YOK | OL, Order, SA, DSA | **TÜRETİM** `computeLineLedger` `order-status.helper.ts:48-81`, `recomputeOrderStatus` `:96-199`; DB seddi YOK (dosya başlığı: "DB seddi olmayan tek denormalize alan") | `touchOrderLinesTx` tam-küme sıralı satır kilidi + recompute (`performDispatchTx :1877-1879`, `cancelPlannedShipmentTx :1975-1984`, storno `:2216`, fason directShip); kilitsiz çağıranlar: `order.reopen :3411`, `order.update :2537` | `test_consistency.ts` §1/§2, `test_sack_pool_lifecycle.ts`, `test_dispatch_claim_step_match.ts` | **§1, §2** | Q-SEV-01 **0** · Q-SEV-01b **0** | Tolerans `shipping.toleranceMeters` (`system-setting.service.ts:58`; prod'da satır yok → 5) |
| INV-SEV-02 | **Tahsis yazımı sevk kurulurken** (`writeShipmentAllocationsTx`, spec+şube FIFO `distributeSacksToLines`); sipariş kümesi kullanıcı seçimi (`ShipmentOrder`); tahsis ⊆ sevkiyatın sipariş kümesi; çuval tahsis toplamı ≤ çuvalın brüt içeriği | SA, ShipmentOrder | **KOD** `shipping.service.ts:1301-1353`, `allocation.helper.ts:93-117` (`take = min(need, remaining)`); **DB:unique** `(sackId, orderLineId)` `:4352`; **DB:FK Restrict** `SA.sack`, `ShipmentOrder.shipment` (muhasebe defteri silinmesin) | sevkiyat kurulum tx'i | `test_sack_pool_lifecycle.ts` | — | Q-SEV-17 **0** · Q-SEV-18 **0** | `need = quantity − shippedQty` (yalnız DISPATCHED'i düşer) → **iki PLANNED sevkiyat aynı ihtiyacı iki kez tahsis edebilir** (bkz. INV-SEV-08) |
| INV-SEV-03 | **Roll ↔ Sack ↔ Shipment:** `R.sackId = S.id ⇒ R.shipmentId = S.shipmentId` (bileşik FK); `R.status = SHIPPED ⇔ çuvalın sevkiyatı DISPATCHED` (hayalet hariç) | R, Sack, Shipment | **DB:FK DEFERRABLE INITIALLY DEFERRED** `rolls_sackId_shipmentId_consistency_fkey` + `swatches_…` (K2b §1.6; `schema.prisma:4197-4202`) — tx içi ara tutarsızlık meşru; **KOD** dispatch flip `:1858-1869`, iptal `:1979-1981` | FK commit'te doğrular | `test_db_invariants.ts` §3; `test_consistency.ts` §4/§9 | **§4, §9** | Q-SEV-03a **0** · Q-SEV-03b (iki yön) **0** | `migrate dev` bu iki FK'yı her diff'te DROP etmek ister — en aktif drift kaynağı (K2b) |
| INV-SEV-04 | **Sevk öncesi raf hafızası:** `SHIPPED ⇒ preShipStatus ∈ {WAREHOUSE, A1_STOCK}` (2026-08-05 sonrası); storno `preShipStatus ?? WAREHOUSE`'a döndürüp alanı temizler; iptali geri alma `preCancelStatus`, Tambur kapanışı `preTamburCloseQty` aynı aile | R | **KOD** `shipping.service.ts:1858-1869`, `:2197-2208`; şema notu `:1583` | grup bazlı `updateMany` | `test_shipment_undo_dispatch.ts` | — | Q-SEV-04 · WAREHOUSE 688 · NULL **1** (karar öncesi sevk, bilgi) | **HİÇBİR YERDE** DB seddi (CHECK `status='SHIPPED' → preShipStatus NOT NULL` yok — eski satır yüzünden konamaz) |
| INV-SEV-05 | **BRÜT kuralı:** sevk rakamı (irsaliye/fiş/liste/detay/Excel/belge üreticisi) iadeyle DÜŞMEZ; iade AYRI belgeyle (`RETURN_DISPATCH`) kapanır; `shippedQty`/`SackAllocation` iadede DOKUNULMAZ; `RR.qty = topun iade anındaki currentQty` (kısmi iade yok), `RR.qty ≤ R.initialQty`; iade yalnız `SHIPPED` topa, tek sevkiyat/belge; iade edilen top `shipmentId = sackId = NULL`, `prevSackId` geri-ekleme için | RR, R, Shipment | **KOD** `return.service.ts:12, :388-396, :501-530`; brüt yüzeyler `shipping.service.ts:2569-2627` (`attachTotals`, **RR** tx), `:2861-3054` (detay), `:3435-3520` (belge), `accounting-export.service.ts:347-382`, `reports/_shipped.ts:59-80` | claim `{id, SHIPPED}` + advisory 8023 | `test_dispatch_report_gross.ts` (§2b), `test_shipment_list_gross.ts`, `test_shipment_detail_gross.ts`, `test_return_bulk_group.ts` | — | Q-SEV-05a/b/c **0** | Muhasebe export'unda "sevk − iade = net" doğru (çift düşüm kapatıldı, 2026-08-02) |
| INV-SEV-06 | **Storno ≠ iade:** storno yalnız `DISPATCHED ∧ invoiceNo IS NULL ∧ aktif iade yok (∧ aynı gün bayrağı)`; belge VOIDED, tahsis SİLİNMEZ (PLANNED'a dönünce shippedQty kendiliğinden düşer), toplar `preShipStatus`'a; iade defterine GİRMEZ; `releaseSacks` ile aynı tx'te CANCELLED'a kapatılabilir | Shipment, RR, PD | **KOD** `undoDispatch` `:2141-2220`; izin `shipping:undo-dispatch` (`shipping:write` kapsamaz) | advisory 8023 (`rollReturn.count` phantom'unu kapatır) + claim; ⚠️ `cancelReturn` 8023 almaz (K3a §6 #15) | `test_shipment_undo_dispatch.ts` §10, `test_shipment_scope_lock.ts` | — | Q-SEV-06 (aktif iade ∧ sevkiyat ≠ DISPATCHED) **0** | — |
| INV-SEV-07 | ~~Bir sipariş tek aktif sevkiyatta~~ — **KALDIRILDI** (havuz modeli: mal iki planlı sevkiyata bölünebilir; eski partial unique `shipment_orders_active_order_uq` düşürüldü `20260711120000:87`) | ShipmentOrder | — | — | — | — | Q-SEV-07 **0** (bilgi) | **BİLİNÇLİ İHLAL** |
| INV-SEV-08 | `Σ sevk(DISPATCHED) per OL ≤ OL.quantity` (+tolerans) — **HİÇBİR YERDE ZORLANMAZ**; `COMPLETED` toleransla belirlenir, fazla sevk "Açık" negatifini UI kelepçeler (13 kopya hesap K7a §4.1) | OL | HİÇBİR YERDE | — | — | — | Q-SEV-08a **0** · Q-SEV-08b (sevk + PLANNED tahsis > istenen) **0** | K7a HOTSPOT #6 ile aynı sınıf; ② failure_mode: iki panel aynı satır için iki PLANNED sevkiyat kurar → ikisi de dispatch'te sayılır |
| INV-SEV-09 | `sackNo` tekil = barkod (`CV+GGAAYY+NNNN`, ayrı barcode kolonu YOK); `(shipmentId, seq)` tekil; `seq NOT NULL ⇔ shipmentId NOT NULL` | Sack | **DB:unique** `:4129`, `:4195`; **KOD** `:1414-1418` (seq = i+1), `:1981` (null) | çuval claim `{id, shipmentId:null}` | `test_sack_pool_lifecycle.ts`, `test_consistency.ts` §6 | **§6** | Q-SEV-09 **0** | Sıralama ABBA-3 (K3a §3.2: istemci `sackIds` sırası) |
| INV-SEV-10 | **İçerik mutasyonu kilidi:** depo çuvalı içeriği yalnız `touchWarehouseSackTx` altında; sevkiyata atanmış çuvalın içeriği değişmez; taşımada kaynak+hedef çuval kilitlenir | Sack, R | **KOD** `shipment-locks.helper.ts:65-77`; `ARCHITECTURE.md:589-597` | koşullu dokunuş (claim) — çuval kilit sırası id'siz (ABBA-2, K3a) | `test_sack_pool_lifecycle.ts` | — | — | — |
| INV-SEV-11 | `ShipmentOrder.isActive ⇔ Shipment.status = PLANNED` (denorm; bakım uygulama katmanında) | ShipmentOrder | **KOD** `:1851`, `:1978`, `:2192` | — | `test_consistency.ts` §5 | **§5** | Q-SEV-11 **0** | — |
| INV-SEV-12 | `destination = EXPORT ⇒ her çuval weightKg > 0` (yurtiçi kg'sız sevk edilebilir) | Shipment, Sack | **KOD** `shipping.service.ts:1283`, `:1895-1903` (pre-tx) | ⚠️ kontrol pre-tx, claim sonrası tekrar YOK (K3a §6 #17 dar pencere) | — | — | Q-SEV-12 **0** | — |
| INV-SEV-13 | `DISPATCHED ⇒ ∃ çuval` (boş sevkiyat sevk edilemez) | Shipment | **KOD** `:1895` (pre-tx) | dar pencere (removeSack ∥ dispatch) | — | — | Q-SEV-13 **0** | — |
| INV-SEV-14 | Fatura izi: `invoiceNo ≠ NULL ⇒ status = DISPATCHED ∧ invoicedAt ≠ NULL`; `invoiceNo = NULL ⇒ invoicedAt = NULL`; ERP fatura KESMEZ | Shipment, DirectShipment | **KOD** (atomik claim, `shipping:invoice` izni) — CLAUDE.md 2026-08-02 | claim | `test_shipment_invoice.ts` | — | Q-SEV-14 **0** | — |
| INV-SEV-15 | Snapshot toplamları: `SubcontractorDispatch.totalQty = Σ SDI.dispatchedQty`; `DirectShipment.totalQty = Σ DSA.qty`, `rollCount > 0` | SD, DS | **KOD** (6 yazıcı, K7a §4.5); **DB:CHECK** `direct_shipments_totalQty_pos/rollCount_pos` | — | `test_consistency.ts` §19 | **§19** | Q-SEV-15 **0** | Kısmi kabul modelinde `totalQty` giden metrajdır, dönenle değişmez |
| INV-SEV-16 | **Sevk belgesi donar:** `DISPATCHED ⇒ PD(SHIPMENT_DISPATCH) v1` aynı tx'te (`freezeForSource :1881`); storno → VOIDED; yeniden sevk → v2; eski kayıt lazy-init | PD, Shipment | **KOD** `printed-document.service.ts:313-347` | tx içi | `test_dispatch_report_gross.ts`, `test_printed_documents.ts` | — | Q-DOC-05 **0** · Q-DOC-04a **0** | — |

### 2.4 Sipariş

| ID | İfade | Varlık | Zorlama | Eşzamanlılık | Bekçi | SQL § | Q-ID · Saha | Not |
|---|---|---|---|---|---|---|---|---|
| INV-SIP-01 | **İstenen \| Sevk \| Açık:** `Açık = quantity − shippedQty` (rezerv YOK; düşüş yalnız sevkte); "açık talep" süzgeci tek kaynak `openLineWhere = {cancelledAt: null, quantity > shippedQty}` — GELECEK sorusu süzer, GEÇMİŞ (defter) süzmez | OL | **KOD** `order-line-scope.helper.ts:26-49`; 13 kopya hesap (K7a §4.1, kelepçe farkları) | — | `test_order_line_scope_single_source.ts` (AST) | — | — | `netGap` `order.service.ts:1525-1543` **`max(0)` YOK** (K7a #8) |
| INV-SIP-02 | **Kalem iptali SOFT:** `OL.cancelledAt` (satır silinmez, sevk edilmiş metraj defterde kalır); `recomputeOrderStatus` iptal kalemin `quantity`sini değil `shipped`ini toplar; `cancelledAt == null` GEVŞEK karşılaştırma bilinçli (`select`'e almayan çağıran tüm kalemleri iptal saydırmasın) | OL, Order | **KOD** `order-status.helper.ts:141-146`; kalem iptal claim `order.service.ts:478` (K3a ABBA-4) | claim `L(tek)` → `L(hepsi sıralı)` iki-parti edinim (K3a ABBA-4) | `test_order_cancellation.ts`, `test_order_cancel_reason.ts` | — | Saha kopyasında `OrderLine.cancelledAt` **YOK** (migration `20260827100000` uygulanmamış) → yalnız dev'de ölçülebilir (Q-SM-08 dev varyantı) | Şube/tip kuralı: iptalde `UNLINK_ONLY` tek-siparişli WO'yu STOK'a döndürür |
| INV-SIP-03 | `orderNumber` tekil, biçim `SIP+GGAAYY+NNNN`, sayaç `nextDailySeq = max+1` (`gte/startsWith` aralık), boşluksuz (silme yok, P2002 → retry) | Order | **DB:unique** `:1961`; **KOD** `order.service.ts:1942-1970` + `utils/code-format.ts:96-107` | `withBarcodeRetry` (P2002 → tx baştan) | `test_item_code_autogen.ts` (kod ailesi) | — | Q-DOC-01 (SIP dışı) **0** · Q-DOC-02 (boşluk) **0** | Sayaç okuması tx içinde (`:1967`) |
| INV-SIP-04 | `quantity > 0`, `shippedQty ≥ 0` | OL | **DB:CHECK** `order_lines_quantity_pos`, `order_lines_shippedQty_nonneg` | — | `test_db_invariants.ts` §2 | §3 | Q-STK-01 **0** | — |
| INV-SIP-05 | **Sevkiyat ↔ sipariş uyumu:** sevkiyatın siparişleri aynı müşteriye ait; şube (varsa) eşleşir (`assertOrdersBelong`) | Shipment, Order | **KOD** `shipping.service.ts:1395` | pre-tx (K3a §6 #10: iptal edilmiş siparişe PLANNED sevkiyat bağlı kalabilir) | — | — | Q-SIP-06 **0** | `Order.branchId` opsiyonel (eski kayıtlar null) |
| INV-SIP-06 | **Sipariş iptali:** `CANCELLED` terminal; iptal claim `notIn [CANCELLED, COMPLETED]`; bağlı WO'lar CANCEL_WO / UNLINK_ONLY kararıyla; `cancelReason` + `cancelReasonCode` (sunucu türetir) | Order | **KOD** `order.service.ts:3141-3148` (claim), WO softDelete zinciri `:3129-3135` **tx dışı** (K3a §7) | claim; WO iptalleri ayrı tx'ler (telafi yok) | `test_order_cancellation.ts`, `test_order_cancel_card_dirty.ts` | — | Saha: 4 CANCELLED sipariş; `cancelledAt` kolonu kopyada YOK | — |
| INV-SIP-07 | Manuel kapatılmış sipariş (`manualClosedById`) terminal — recompute statüye dokunmaz; `reopen` claim `{manualClosedById not null}` → APPROVED + recompute | Order | **KOD** `order-status.helper.ts:160-165`, `order.service.ts:3397-3410` | claim; recompute kilitsiz (K3a #23) | — | — | Q-SM-08 manuel-kapalı hariç **0** | — |

### 2.5 Fason

| ID | İfade | Varlık | Zorlama | Eşzamanlılık | Bekçi | SQL § | Q-ID · Saha | Not |
|---|---|---|---|---|---|---|---|---|
| INV-FAS-01 | `AT_SUBCONTRACTOR ⇒ ∃ SDI (dispatch.cancelledAt IS NULL)` — fasondaki topun açık sevk kaydı var | R, SDI | **KOD** dispatch tx (`subcontractor.service.ts:1035+`, WO kilidi :1041) | claim + WO satır-kilidi | `test_consistency.ts` §15 | **§15** | Q-FAS-01 **0** (saha 188 AT_SUB) | Seed'li DEV'de yanlış pozitif (SQL başlığı) |
| INV-FAS-02 | **Kalem yalnız TAM satırla kapanır:** kalem "dönmüş" ⇔ ∃ SRI(`isPartial=false`, `receipt.cancelledAt IS NULL`) ∨ `remainderClosedAt ≠ NULL` ∨ `dispatch.directShippedAt ≠ NULL`; kısmi makbuz kalemi KAPATMAZ; makbuz iptali kalemi yeniden AÇAR | SDI, SRI | **KOD tek kaynak** `fason-open-dispatch.helper.ts:48-80` (21 nokta `isPartial:false` okur); şema notu `:3579-3585` | — | `test_fason_partial_receive.ts`, `test_fason_open_dispatch_*` ; **§24a, §24b** | **§24a, §24b** | Q-FAS-02 (§24b) **0**; §24a Tur 2 | — |
| INV-FAS-03 | **Kısmi kabul:** top `AT_SUBCONTRACTOR` kalır, `currentQty −= receivedQty` (guard `currentQty > receivedQty`, eşitlik tam kabul); `Σ receivedQty(aktif makbuzlar) ≤ dispatchedQty`; her teslimat ayrı makbuz; 2.+ teslimatın topları YENİ parti; replay kimliği `SubcontractorReceipt.clientToken` | R, SRI | **KOD** `subcontractor.service.ts:2736-2751` (plan), `:2878-2890` (decrement), `:2345-2360` (token) | claim `{id, AT_SUB, currentQty > x}` + `decrement` (DB-side) | `test_fason_partial_receive.ts`, `test_fason_partial_receive_overcount.ts` | — | Q-FAS-03a **0** · Q-FAS-03b **0** | ⚠️ `receive` `withBarcodeRetry` predicate'siz — token P2002'sini 5 kez tekrar dener (K3a §6 #9) |
| INV-FAS-04 | **Tam kabul = tüket + doğur:** orijinal `SUBCONTRACTOR_CONSUMED` (`currentStepId NULL`) ∧ makbuzdan ≥1 çocuk (`entrySource=SUBCONTRACTOR_RETURN`, `parentReceiptId` dolu, barkodsuz doğar, `qty` zorunlu); `entrySource = SUBCONTRACTOR_RETURN ⇔ parentReceiptId IS NOT NULL` | R, SR | **KOD** `:2844-2863`, `:2994-3092`; `ARCHITECTURE.md:371-381` §7.2 | çoklu claim count===len | `test_fason_partial_receive.ts`, `test_manual_move_fason_receive.ts`; **§14** | **§14** | Q-FAS-04a **0** · Q-FAS-04b **0** · Q-FAS-04c **0** | Kesin ölçüm sonraki istasyonun FINISH'inde |
| INV-FAS-05 | **Doğrudan sevk terminal:** `directShippedAt ≠ NULL ⇒ sevk edilen toplar SUBCONTRACTOR_CONSUMED` (aynı tx); `DSA` append-only, `shippedQty`'ye sayılır; tahsis `qty ≤ remaining` (pre-tx + tx içi) | SD, R, DSA | **KOD** `:6111-6120`, `:5985-5995`, `:6275-6294` | claim + `touchOrderLinesTx` | `test_direct_ship_api.ts` (HTTP; seed şifresine bağımlı) | **§24b** | Q-FAS-02 **0** | Saha: 0 doğrudan sevk |
| INV-FAS-06 | **Çekme defteri:** `|Σ doğan − Σ tüketilen| > 0,01 m ⇒ RollVariance(SUBCONTRACTOR_RETURN, SCRAP[FASON_CEKME] | OVERAGE, sourceRefId = receipt.id)`, çok toplu kabulde orantılı dağıtım (`allocateShrink`, artık son satıra); makbuz iptalinde `sourceRefId` ile terslenir (`reversedAt`); uyarı yalnız `fason.shrinkTolerancePct` aşılınca (`<=0 → null` YASAK) | RV, SR | **KOD** `:3172-3207`, `subcontractor-shrink.helper.ts:50-74`, `:4986-4993`; tek yazıcı `roll-variance.helper.ts:50-78` (tx İÇİNDE) | tx içi | `test_fason_partial_receive.ts`, `test_scrap_scorecard.ts` | — | Q-FAS-06 (2026-08-21+ makbuz) **0** (saha kopyasında bu kaynaktan 0 satır — deploy 08-25) | Fason karnesi fire'ı defterden okur (eski kod %0 basıyordu) |
| INV-FAS-07 | **Makbuz iptali LIFO:** aynı topa dokunan daha yeni aktif makbuz varken iptal 409 `RECEIPT_NOT_LATEST`; kısmi kalem `currentQty += receivedQty` geri konur | SR, R | **KOD** `:4752-4775` (pre-tx), `:4946-4960` | ⚠️ pre-tx guard, tx'te tekrar yok (K3a §6 #7) | `test_fason_partial_receive.ts` | — | sorgu yazılamaz — sıra tarihsel (iptal anı ile sonraki makbuz doğuşu karşılaştırılamaz) | — |
| INV-FAS-08 | **Bir sevk = bir parti:** `SD.batchId` zorunlu, `batch.workOrderId = SD.workOrderId`; sevk iptali toplar → `STOCK`, hareket `qtyOut NULL`; kalan-kapama: `SUBCONTRACTOR_CONSUMED` + `RollVariance(SCRAP, SUBCONTRACTOR_REMAINDER)` + `remainderClosedAt` (metraj sıfırlanmaz) | SD, R | **KOD** `:2052-2062`, `:3398-3441`; cross-WO parti guard'ı `FOREIGN_BATCH` | claim + WO kilidi | `test_fason_partial_receive.ts` | — | Q-FAS-08 **0** | — |
| INV-FAS-09 | **Kabul rengi taze:** `expectedTargetColorId` gönderildiyse ≠ taze hedef → 409 `TARGET_COLOR_CHANGED`; plandan farklı renkte tek soru `planColorAction` (APPLY_TO_PLAN / ROLLS_ONLY → `RollPlanDeviation source="fason-receipt"`, Tambur kapısı tekrar SORMAZ) | SR, WO, RPD | **KOD** `:2685-2700`, `tambur-plan-gate.helper.ts:88-100` | tx içi taze okuma (WO kilidi altında) | `test_wo_target_color_guard.ts` (59), `test_tambur_plan_gate.ts` | — | Saha: `roll_plan_deviations` **0** (kapı deploy'dan sonra) | §26 BİLGİ / §26b KAPI eşiği `PLAN_GATE_SINCE` |
| INV-FAS-10 | **WO kapatma hard-block yalnız FASON:** `AT_SUBCONTRACTOR`/`RETURNED…` ya da açık fason sevke bağlı top varken WO kapatılamaz; fason dönüşü top `STOCK`'a çekilemez; `COMPLETED WO ⇒ adımlarında AT_SUBCONTRACTOR top yok` | WO, R | **KOD** `workorder.service.ts:3888-3895` (claim SONRASI guard), `roll-disposition.helper.ts` | WO claim | `test_wo_close_*` (K4) — bu turda dosya adı doğrulanmadı [VARSAYIM] | — | Q-SM-02a **0** | — |
| INV-FAS-11 | Tekillik: `(dispatchId, rollId)`, `(receiptId, newRollId)` (aynı top iptal edilmiş makbuzlarda tekrar yaşayabilir), `receiptNo`/`dispatchNo` tekil, `SubcontractorReceipt.clientToken` partial unique | SDI, SRI, SR, SD | **DB:unique** `:3376`, `:3592`, `:3468`, `:3474` | unique | `test_db_invariants.ts` | — | — | — |

### 2.6 Parti

| ID | İfade | Varlık | Zorlama | Eşzamanlılık | Bekçi | SQL § | Q-ID · Saha | Not |
|---|---|---|---|---|---|---|---|---|
| INV-PAR-01 | **Parti no benzersiz DEĞİL** (bilinçli): bayrak `batch.shortNumberEnabled` (varsayılan AÇIK) → `P01…P99` körlemesine sarar; KAPALI → `P+GGAAYY+sıra` (dolgusuz); `@unique` KALDIRILDI (`20260805120000`); kimlik yalnız `id`; **`batchNumber` ile lookup/sıralama YAPILMAZ** | Batch | **KOD** `batch.service.ts:122-142`; şema notu `:2263-2270` | **advisory 8022 (sabit anahtar, `generateBatchNumberTx` İLK ifadesi)** — kilit tx'in kalanı boyunca tutulur (K3b §6) | `test_batch_number_format.ts` (39; dört negatif sonda) | — | Q-PAR-01a **92 mükerrer grup / 184 satır** (BİLİNÇLİ) · Q-PAR-01b biçim dışı **0** | **BİLİNÇLİ İHLAL** (fiziksel plaka düzeni); arama daima aday listesi |
| INV-PAR-02 | **Sayaç veriden türer:** sıradaki = (son doğan kısa parti `createdAt DESC LIMIT 1`, regex `^P(0[1-9]|[1-9][0-9])$`) + 1, 99 → 01; ardışık kısa partiler kopuksuz | Batch | **KOD** `batch.service.ts:162-165` (regex load-bearing) | advisory 8022 | `test_batch_number_format.ts` | — | Q-PAR-02 (sıra kopuk) **0** | Sıfırlama düğmesi BİLİNÇLİ YOK |
| INV-PAR-03 | **Parti tek iş emrine ait:** `Batch.workOrderId`; topun partisi ile bulunduğu adımın iş emri aynı (tebdil/devirde parti ile birlikte taşınır) | Batch, R | **KOD** (split/manual-move parti cerrahisi `workorder-split.service.ts`, `batch-dispatch-surgery.helper.ts`) | claim `{batchId, status, sack/shipment}` | `test_split_per_roll.ts`, `test_split_card_lineage.ts` | — | Q-PAR-03 **0** | **HİÇBİR YERDE** DB seddi |
| INV-PAR-04 | **Elle eklenen top partisiz doğmaz:** tek açık parti → sormadan bağla · çok → 400 `BATCH_REQUIRED` · hiç → NULL; sıra: payload tutarlılığı ÖNCE, parti SONRA; `SCRAP` partiyi kapatmaz | R (TAMBUR_MANUAL) | **KOD** `tambur-manual.service.ts` (CLAUDE.md 2026-08-04) | tx içi | `test_tambur_manual_batch.ts` | — | Q-PAR-04 · 2/2 TAMBUR_MANUAL partisiz (08.08 — kural öncesi, bilgi) | — |
| INV-PAR-05 | **Fason dönüşü parti kalıtımı:** ilk teslimat giden partiyi sürdürür, 2.+ teslimat YENİ parti (K5 aynası); Tambur çocukları parent partisini kalıtır; sevk iptalinde `batchId` korunur | R, Batch | **KOD** `subcontractor.service.ts:2752-2760`, `tambur.service` | — | `test_fason_partial_receive.ts` | — | sorgu yazılamaz — "hangi teslimat kaçıncı" tarihsel sıra ister; Q-PAR-05 kapalı parti 13/198 (bilgi) | — |
| INV-PAR-06 | Birleştirilmiş parti (`mergedIntoId`) tarihçedir: topu kalmaz, listelenmez, kart bloğunda basılmaz | Batch | **KOD** (K17 merge `batch.service.ts:748-798`) | çoklu claim `:810` | — | — | Q-PAR-07 **0** | — |

### 2.7 Belge numarası / barkod / donmuş belge

| ID | İfade | Varlık | Zorlama | Eşzamanlılık | Bekçi | Q-ID · Saha | Not |
|---|---|---|---|---|---|---|---|
| INV-DOC-01 | **Belge no backend-authoritative, biçim `PREFIX+GGAAYY+NNNN`** (4 hane dolgu): `IE` iş emri · `SIP` sipariş · `SVK` sevkiyat · `CV` çuval · `FS` fason sevk · `FK` fason kabul · `MUS` müşteri · kartela `KD/KR` [VARSAYIM, saha 0 satır] · parti `P` **İSTİSNA** (dolgusuz / kısa). Refakat kartı no = barkod = `workOrderNumber` (tek kod) | tüm belge tabloları | **DB:unique** her no kolonu; **KOD** `utils/code-format.ts:82-113` (`buildDailyCode`, `nextDailySeq`, `isDailyCode`); üreticiler `shipping.service.ts:161/171`, `workorder.service.ts:575-600` (**havuz client'ı, tx dışı okuma** — K3a L1), `workorder-clone.helper.ts:31-45` (tx ikizi), `subcontractor.service.ts:648`, `customer.service.ts:61`, `base.service.ts:976` | `withBarcodeRetry` (P2002 → tx baştan, max 5, jitter) | `test_item_code_autogen.ts`, `test_barcode_reservation.ts` | Q-DOC-01: IE/SIP/SVK/CV/FS/FK biçim dışı **0**; `items` 209 elle kod (meşru — `STK-` yalnız otomatik) | Manuel `workOrderNumber` (harf kuyruklu) izinli — `nextDailySeq` `parseInt` NaN'ı atlar |
| INV-DOC-02 | **Günlük sayaç boşluksuz:** `max(sıra) = adet` (silme yok; P2002'de tekrar dene); top barkodunda boşluk **bilinçli** (rezervasyon rollback'te yanar) | belge tabloları | **KOD** `nextDailySeq` = max+1 | retry | — | Q-DOC-02 **0 boşluk** (IE/SIP/SVK/CV/FS/FK tüm günler) | WO `hardDelete` satırı siler mi? `isActive:false` (satır kalır, K2a) |
| INV-DOC-03 | **Donmuş belge = kaynağın sevk/iade anındaki hâli:** `SHIPMENT_DISPATCH` dispatch tx'inde, `RETURN_DISPATCH` iade tx'inde (2026-08-02+, grup lideri `returnGroupId`), `SUBCONTRACTOR_DISPATCH` fason sevkte; kaynak iptal → VOIDED; `reissue` gerekçeli v+1; `getDispatchReport` snapshot'tan okur | PD | **KOD** `printed-document.service.ts`, `return.service.ts:564/920/927`, `subcontractor.service.ts:1283/2037` | tx içi | `test_printed_documents.ts`, `test_dispatch_report_gross.ts` | Q-DOC-05 **0** · Q-DOC-06 **0** · Q-DOC-03a **0** · Q-DOC-03b **0** | Belge yolu da BRÜT (2026-08-05): `collectShipmentDocContent` sevkten sonra da çağrılır (reissue/lazy-init) |
| INV-DOC-04 | **Refakat kartı sürümü:** `recordPrintEvent` basılan planı kaydeder, içerik değiştiyse `version++` (`resolvePrintPlan` tek karar noktası — önizlemedeki `v` = bu baskının alacağı sürüm); her sürüm `PD(TRAVELER_CARD, sourceId=card.id, version)` deftere (aynı tx); ACTIVE olmayan kart revize edilmez; snapshot NULL eski kartta sürüm artmaz; `planKey` sıra-bağımsız | TC, PD | **KOD** `traveler-card.service.ts:350-392` | ⚠️ `version: plan.version` koşulsuz, havuzda çözüldü (K3b L5, dokümante sınır :340-347); `reprint` `version+1` claim'siz (L4, uç çağrılmıyor) | `test_traveler_card_stale.ts` §6, `test_traveler_template.ts`, `test_traveler_card_versions.ts` | Q-WO-13 (kart < defter max) **0** | — |
| INV-DOC-05 | **Etiket:** SACK etiketi barkodu = `sackNo`; şablon çözülemezse **FAIL-CLOSED 400** (roll'a sapmaz); kalitesiz topta koşullu eleman basılmaz; `labelDirty` "basılı etiket veriyle uyuşuyor mu" tek cevabı, `recordPrintEvent` temizler | Sack, R | **KOD** `label.service.ts:1629` (FAIL-CLOSED), `prepareElements` | — | `test_label_element_condition.ts`, `test_label_dirty_sources.ts`; **§25** | §25 Tur 2 | §25 kanıtı audit'ten okur (6 ay sınırı) |

### 2.8 İş emri / refakat kartı

| ID | İfade | Varlık | Zorlama | Eşzamanlılık | Bekçi | SQL § | Q-ID · Saha | Not |
|---|---|---|---|---|---|---|---|---|
| INV-WO-01 | **Tip = bağın aynası:** `type = ORDER_PRODUCTION ⇔ ∃ WorkOrderToOrderLine` (CANCELLED/SUPERSEDED hariç); ilk bağ STOK→ORDER (`updateMany WHERE type=STOCK`), son bağ sökülünce ORDER→STOK (hedef kumaşsız WO STOK olamaz → 400); create/replace da aynı kural; sipariş satırı silinince pivot Cascade düşer, tipe kimse dokunmaz (§21 gerekçesi) | WO | **KOD** `workorder-link.service.ts:380-385`, `:444-467`; `workorder.service.ts` create; onarım `scripts/fix_workorder_type_from_links.ts` (dry-run) | `updateMany {id, type}` — **WO satır-kilidi yok**, statü guard'sız (K3a §6 #19/#20) | `test_consistency_derived.ts` §21 (+ gürültü bedeli sondası) | **§21** | Q-WO-01 **0** | DB seddi yok (pivot ↔ enum türetimi CHECK'le yazılamaz) |
| INV-WO-02 | `STOCK_PRODUCTION ⇒ targetItemId IS NOT NULL` | WO | **DB:CHECK** `work_orders_stockprod_targetItem` (`20260731120000:52-53`) | CHECK | `test_db_invariants.ts` §2 | — | Q-WO-02 **0** | `cancelOrderLine` tip flip'i guard'sız (K3a #9b) — CHECK yakalar (500/409?) |
| INV-WO-03 | **Adım durumu türetilmiş + giriş noktası kuralı** (bkz. INV-SM-03) | WOS | TÜRETİM | — | §20 | **§20** | Tur 2 | — |
| INV-WO-04 | `IN_PROGRESS ∧ ∀ adım ∈ {COMPLETED, SKIPPED} ⇒ WO COMPLETED` (`completeWorkOrderIfStepsDone` kaçırılmamış) | WO | **KOD** `roll-step.helper.ts:193-214` | WO satır-kilidi (çağıran) | `test_consistency_derived.ts` §22 | **§22** | Q-WO-04 **0** | Adımsız WO §22 dışı |
| INV-WO-05 | **Bir WO = tek kart, kart WO açılışında doğar** (`create` tx'inde `createForWorkOrder`), `cardNumber = barcode = workOrderNumber`, `version` 1'den, Parti kart üretmez | TC | **DB:unique** `workOrderId`, `cardNumber`, `barcode` (`:3164-3166`); **KOD** `workorder.service.ts:1081`, `traveler-card.service.ts:175-200` | tx içi | `test_consistency.ts` §16 (cutover 2026-07-14) | **§16** | Q-WO-05 (kartsız/çok kartlı, 2026-07-14+) **0** | Eski partial unique'ler (`traveler_cards_wo_active_uniq`) düşürüldü → tam unique |
| INV-WO-06 | **Kart durumu ↔ WO durumu:** `WO COMPLETED ⇒ kart ∉ ACTIVE`; `WO CANCELLED/SUPERSEDED ⇒ kart VOIDED`; `WO PLANNED/IN_PROGRESS ⇒ kart ACTIVE`; `contentDirty` bayat işareti tek yazma noktası `markTravelerCardDirtyTx` (fazla işaretlemek güvenli) | TC, WO | **KOD** fan-out `traveler-card-fanout.helper.ts:19-40`; `traveler-card-dirty.helper.ts:34` | `updateMany {workOrderId, status in}` | `test_traveler_card_stale.ts`, `test_order_cancel_card_dirty.ts` | — | Q-WO-06 **0** | ⚠️ `workorder-link.service.ts:577/:640` dirty işaretini havuz client'ıyla, claim'den AYRI yazıyor (K3a §4) |
| INV-WO-07 | `(workOrderId, stepSequence)` tekil; `completedAt ≥ startedAt`; adım sırası 1..n | WOS | **DB:unique** `:2386`; **DB:CHECK** `work_order_steps_time_order` | — | `test_db_invariants.ts` | — | Q-WO-07 **0** | — |
| INV-WO-08 | **Plan değişikliği kilidi MALA bakar:** COMPLETED/CANCELLED/SUPERSEDED'da plan değişikliği kapalı (`PLAN_CHANGE_FROZEN_STATUSES`); renk değişikliğinde mal–plan uyumu (`recolorRollIds`; tam uyum serbest · kısmi 409 `COLOR_PARTIAL_CONFIRM` · boyanacak yok 409 `COLOR_DYED_BLOCKED`); `allowedColors`; rota kapsaması **UYARI** (`ApiResponse.warnings`), adım statüsü kilit DEĞİL | WO | **KOD** `workorder-target-color.helper.ts:56-60, :87-96, :109+` (tek bekçi; "Düzenle" ve "Rengi Değiştir" aynı kural) | pre-tx + tx (F58 çifti); `changeTargetColor` claim `targetColorId` pin'i, `mismatchRows` pin'lenmez (K3a §4 [VARSAYIM]) | `test_wo_target_color_guard.ts` (59), `test_wo_route_coverage_goods.ts` (7) | — | — | ⚠️ `updateTargetProperties` (`workorder.service.ts:5602-5719`) statü guard'sız (K3a §6 #2) → **H-6** |
| INV-WO-09 | **Kapanış dispozisyonu:** manuel kapatma in-flight top varsa reddetmez; her top için karar (STOCK · WAREHOUSE · A1_STOCK · SCRAP · CANCELLED · TRANSFER); kapsam birebir (tx içi taze küme ≠ liste → 400); dispozisyon varsa `workorder:write` + `roll:manual-adjust`; iz `movement.notes='WO_CLOSE_<ACTION>'` + audit `WO_CLOSE_DISPOSITION`; TRANSFER'de kaynak COMPLETED kalır (SUPERSEDED olmaz), açık bypass ataması yeni WO'ya repoint | WO, R | **KOD** `workorder.service.ts:3861-4060`, `roll-disposition.helper.ts:151-262`, `repointPendingBypassAssignmentsTx :4228` | WO claim + roll çoklu claim (hepsi-ya-hiç) | K4/K3a: `test_*` [VARSAYIM: kapanış dispozisyon bekçisi adı bu turda doğrulanmadı] | — | — | — |
| INV-WO-10 | **Üretim çıktısı kümesi tek kaynak** `producedOutputWhere`: Tambur birinci-nesil çocukları ∨ (SPLIT olmayan ∧ status ∈ {WAREHOUSE, A1_STOCK, SCRAP, SHIPPED, AT_KARTELA, KARTELA_CONSUMED}); üretilen metraj = 1.kalite + A1 (kova katalogdan, `isActive` süzgeci YOK) | WO, R | **KOD** `workorder.service.ts:1690-1718`, `roll-finalize.helper.ts:75-106` | — | `test_semi_finished_surfaces.ts`, `test_scrap_scorecard.ts` | — | — | Liste `:1882` float toplama, detay Decimal (K7a M3/M5) |
| INV-WO-11 | **Manuel taşıma:** CANCELLED/SUPERSEDED WO'da REDDEDİLİR (409); COMPLETED → IN_PROGRESS diriltilir, kart yeniden ACTIVE; fason adımına taşıma `AT_SUBCONTRACTOR` YAPMAZ; geri taşımada hedef-sonrası kararlar VOID, hayalet movement'lar silinir, SKIPPED → PENDING | WO, R | **KOD** `workorder-manual-move.service.ts:62-70`, `:538-583` | claim; bağlam pre-tx (K3a §6 #22) | `test_manual_move*.ts` (5 dosya) | — | — | — |
| INV-WO-12 | **Rota kapsaması reddetmez, uyarır** (create · replace · Rengi Değiştir tek kural); dar kapı: `goods` verildiyse nitelik topların HEPSİNDE varsa kontrol atlanır (`every`, `some` DEĞİL) | WO | **KOD** `workorder.service.ts:213-220` (`warnings.push`), `assertRouteCoversTargets` :659/:1267 | — | `test_wo_route_coverage_goods.ts` (7, iki negatif sonda) | — | — | **BİLİNÇLİ RİSK:** eksik rotayla WO açılabilir (CLAUDE.md 2026-08-27) |
| INV-WO-13 | `workOrderNumber` tekil, `IE+GGAAYY+NNNN`; `clientToken` partial unique; `hardDelete` token'ı NULL'lar (taze deneme) | WO | **DB:unique** `:2152`, `:2157` | `withBarcodeRetry` (manuel modda P2002 retry EDİLMEZ) | — | — | Q-DOC-01 IE **0** · Q-DOC-02 **0** | Numara üretimi tx AÇIKKEN havuz client'ından (K3a L1) |

### 2.9 Yarı mamul

| ID | İfade | Zorlama | Bekçi | Q-ID · Saha | Not |
|---|---|---|---|---|---|
| INV-YM-01 | `entrySource = SEMI_FINISHED` topu STOCK statüsündedir, ayrı DEPO yoktur; **arzdan düşülmez, ayrı gösterilir** (Ürün Dengesi `yariMamul` kovası, `malzemeAcigi` ikisini birden düşer; sipariş karşılama `freeSemiFinished`, `netGap` değişmez; Kanban/mobil ayrı kolon/sekme) | **KOD** `production-balance.service.ts:419-429`, `order.service.ts:1588-1642` | `test_semi_finished_surfaces.ts` (10; §4 toplam korunuyor), `test_semi_finished_entry.ts` | Q-YM-01 **0 satır** (prod'da hiç yarı mamul girişi yok) | Negatif sonda: arzdan düşünce 400 m talepte 200 m sahte açık |
| INV-YM-02 | Kapsam anahtarları: `RAW_STOCK` **BİLEREK GENİŞ** (ham + yarı mamul; mobil Hızlı İş Emri top seçicisi), masaüstü dar ikizleri `RAW_STOCK_PURE` / `SEMI_FINISHED`; `rollScope` FAIL-CLOSED | **KOD** `inventory.service` `rollScope` | `test_semi_finished_entry.ts` | — | Daraltma = tablette toplar kaybolur |

### 2.10 Audit / izlenebilirlik

| ID | İfade | Zorlama | Eşzamanlılık | Bekçi | Q-ID · Saha | Not |
|---|---|---|---|---|---|---|
| INV-AUD-01 | **Her CUD → `SystemLog`** (`AuditService.log`, `BaseService` otomatik; özel servisler elle); tx DIŞI, best-effort | **KOD** `audit.service.ts`; `ARCHITECTURE.md:499-516` | — | `test_audit_p0.ts`, `test_audit_depth.ts`, `test_audit_labels.ts`, `test_audit_followups.ts` | Q-AUD-01b: son 30 günde doğan 2.391 topun **55'i** için hiçbir audit satırı yok (33 fason dönüşü çocuğu, 22 Tambur çocuğu) — olay bazlı audit (makbuz/parent kaydına yazılıyor) [VARSAYIM] | **BİLİNÇLİ İHLAL** (best-effort) + kayıt düzeyinde kapsama boşluğu → **H-7** (AUD hücresine) |
| INV-AUD-02 | **Audit değiştirilemez:** `system_logs` / `system_log_archives` üzerinde UPDATE/DELETE/TRUNCATE trigger ile reddedilir — **yalnız `teks.audit_guard='on'` iken**; arşivleyici `SET LOCAL teks.audit_purge='on'` ile geçer (tx'e özel, `deleteMany`'den ÖNCE) | **DB:trigger** `audit_block_tamper()` (`20260819161000:46-67`); **KOD** `audit.service.ts:233-261` | tx içi | `test_db_invariants.ts` §6, `test_audit_depth.ts` §10 (kaynak sırası) | GUC prod'da açık mı: kopyada doğrulanamadı (`pg_db_role_setting` taşınmaz — K2b/K4) | Varsayılan KAPALI → prod'da açılması ops görevi (`SURUM-2.9.0 §7b`) |
| INV-AUD-03 | **Arşiv 6 ay:** `archive-scheduler` 30 günde bir 6 aydan eskiyi taşır; bu yüzden gerekçe/künye alanları KOLONDA yaşar (`entryReason`, `cancelReason`, `cancelledById`, `createdById`…), audit'ten OKUNMAZ | **KOD** `archive-scheduler.ts:21` (`MONTHS_TO_KEEP=6`) | process-local `lastRun` (K8) | `test_audit_depth.ts` | Q-AUD-03: `system_logs` 2026-07-16…08-25, 10.485 satır; arşiv **0** | — |
| INV-AUD-04 | **İptal izi kolonda:** `CANCELLED ⇒ cancelledAt ∧ cancelledById ∧ (cancelReason, cancelReasonCode)`; kod sunucu türetir (`resolveReasonCode`; açık kod katalogda yoksa 400 `REASON_CODE_INVALID`; serbest metin → NULL); fire (`SCRAP`) ayrı kapı `validateVarianceReason` | **KOD** `inventory.service.ts:3253-3262`, `roll-disposition.helper.ts:223-231`, `reason-preset.service.ts:293-304` | — | `test_roll_cancel_undo.ts`, `test_reason_presets.ts` §5/§6 | Q-AUD-05b: statüsü 2026-08-17+ CANCELLED olan **52 topun 47'si `cancelledAt` taşımıyor** (17.08: 15/16 · 18.08: 17/20 · 19.08: 7/7 · 20.08: 7/8 · 21.08: 1/1) | **HOTSPOT H-5** — kolon 2026-08-05'ten beri var (`20260805170000`); hangi iptal yolu damgalamıyor? (deploy tarihi 08-24/25 ile ilişkisi ② ölçsün) |
| INV-AUD-05 | **Sapma defteri tam:** her metraj sapması (fire · kayıt düzeltmesi · aşım · fason çekme/kalan) `RollVariance` satırıdır, `qty > 0`, yön `kind`; tek yazıcı `recordVarianceTx` **tx içinde**; tersleme `reversedAt` (dönem raporları süzmeli); `sourceRefId` terslemenin adresi | **KOD** `roll-variance.helper.ts:50-78`; **DB:CHECK** `roll_variances_qty_positive` | tx içi | `test_tambur_undo.ts` §11, `test_scrap_scorecard.ts`, `test_plan_deviation_scorecard.ts` | Saha: 75 satır (OVERAGE 37 · RECORD_CORRECTION 36 · SCRAP 2); Q-STK-03b aşımlı 34 parent / 32 defterli | 2 defter-siz aşım (H-3) |
| INV-AUD-06 | **Plan-sapma defteri:** Tambur kapısı renk/en (±10 cm) sapmasını onayla geçirir, `RollPlanDeviation` (`confirmationId` çift-sayım kilidi, granülerlik geçiş×alan) yazar; kapı geriye dönük DEĞİL (§26 bilgi, §26b tarih eşikli kapı) | **KOD** `tambur-plan-gate.helper.ts:65-135`, `constants/tambur-plan-gate.ts:38` | tx içi (`recordPlanDeviationTx`) | `test_tambur_plan_gate.ts`; **§26/§26b** | Saha: 0 satır → §26b **vakumen yeşil** (test bunu uyarı basar) | — |

### 2.11 Ana veri

| ID | İfade | Zorlama | Eşzamanlılık | Bekçi | Q-ID · Saha | Not |
|---|---|---|---|---|---|---|
| INV-MD-01 | **Katlanmış ad tekilliği:** `customers/items/subcontractors` `nameFold` partial UNIQUE `WHERE mergedIntoId IS NULL` (tombstone aynı adı taşır); renk `tr_fold_color(name)` ifade index'i (ayraç + sayı-sırası bağımsız); uygulama bekçisi `assertNameNotDuplicate` KALIR (mesajı o verir) | **DB:partial-unique** (`20260821150000:69-71`, `20260825120000:73-74`) — **YUMUŞAK KAPI** (mükerrer varken index atlanır); **KOD** `base.service.ts:729`, `:1030/:1059/:1064` | unique (varsa); uygulama bekçisi check-then-act (havuz) | `test_master_data_name_dup.ts` §9, `test_db_invariants.ts` §1/§5, `test_fold_contract.ts` §2b, `test_consistency.ts` §18 | Q-MD-01a: `items` **1 canlı mükerrer** (`v-1430` ×2); Q-MD-01b: `items_nameFold_key` sahada **YOK** (enforce bekliyor); diğer üç sed var | **BİLİNÇLİ GEÇİCİ İHLAL** ("enforce bekliyor" sinyali) — §18/`test_db_invariants` §1 bilerek kırmızı |
| INV-MD-02 | **Tombstone:** `mergedIntoId` dolu kayıt yeni referans almaz, listelenmez; birleştirme motoru 42 kurallık haritayla referansları survivor'a taşır (ham UPDATE haritayı ve audit'i atlar) | **KOD** `master-data-merge.service.ts:540-712` (advisory 8027 İLK ifade, 120 s timeout) | advisory 8027 (sabit anahtar) | `test_master_data_merge*.ts` (3), `test_merge_field_picks.ts` | Q-MD-02: tombstone'a referans **0** (5 ilişki) | — |
| INV-MD-03 | **Kod tekilliği:** `code @unique` (Item/Customer/Subcontractor/Color/Station…); katlanmış kod (`foldCodeForCompare`, i-ailesi) tekilliği yalnız Item'da kilitli (8026) | **DB:unique**; **KOD** `code-unique.helper.ts:81` (yalnız `item.service.ts:237`) | advisory 8026 yalnız Item; diğerleri kilitsiz (K3b H-6) | `test_item_code_case_uniqueness.ts` (yalnız Item) | Q-DOC-01 items 209 elle kod (meşru) | — |
| INV-MD-04 | **Kalite kataloğu:** `Roll.qualityGrade` = seçilen `QualityGrade.code` snapshot'ı; final statü `targetStatus`'tan çözülür (1.KALITE/A1 → WAREHOUSE, FİRE → SCRAP `seed.ts:172`; null → WAREHOUSE); üretilen kova katalogdan | **KOD** `roll-finalize.helper.ts:75-123`, Tambur `resolveCutStatus` | — | `test_scrap_grade_label.ts`, `test_helpers.ts` | Q-MD-04a snapshot ≠ kod **0** · Q-MD-04b: **FIRE kaliteli 4 top WAREHOUSE'ta** (2026-08-20 "fire çöpe gider" kararı öncesi; onarım `fix_fire_rolls_to_scrap.ts`) | Plan kapısı/override meşru sapma üretebilir → bilgi |
| INV-MD-05 | **Renk istasyon kısıtı DEĞİL** (`StationColor` deprecated, okuyan kod yok); "renk veren adım" tek yüklem `stepCanApplyColor` (`station.appliesColor ∨ requiredCategory.appliesColor`); rota adımında `hasDefaultCategory` DE aranır | **KOD** `step-capability.helper.ts:41-46`, `route.service.applyStepTargets` | — | `test_station_capability.ts` (8b), `test_route_step_targets.ts` (20) | — | — |
| INV-MD-06 | **Özellik istasyon kısıtı KALIR, boş doğamaz:** `FabricProperty` `stationIds` zorunlu (aynı insert), `update`'te verilmezse bağa dokunulmaz; `StationProperty` iki iş (planlama filtresi + `copyStationCapabilitiesToRoll`); SEÇİM tipli özellik hedef seçicilerden süzülür | **KOD** `fabric-property.service.ts` (`nestedCreateFields`) | — | `test_property_station_binding.ts` (negatif sonda) | Q-MD-08 istasyonsuz aktif özellik **0** | — |
| INV-MD-07 | **Sebep katalogları:** `(kind, code)` tekil; `code` rapor anahtarı ASLA değişmez, `label` serbest (`legacyTexts[]` eski-ad sözlüğü); son aktif satır gizlenemez, silme yok; senkron önbellek bayat dönebilir ama boş dönmez (fail-closed yalnız hiç dolmadıysa) | **DB:unique** `reason_presets(kind, code)`; **KOD** `reason-preset.service.ts` | — | `test_reason_presets.ts` §3b/c/d, §5, §6 | Q-MD-09: 5 kind, hepsinde aktif satır var (`ORDER_CANCEL` kind'ı kopyada yok) | — |
| INV-MD-08 | **İzin kataloğu ⊆ DB** (boot uzlaştırması ekler, silmez, ATAMAZ); rol şablonu kimliği `code`, sistem rolü silinmez pasifleştirilir; katalog dışı kod DB'de olamaz | **KOD** `permission-catalog.job.ts:67-131`, `role-template-catalog.job.ts` | boot | `test_permission_catalog.ts`, `test_role_template_catalog.ts` | K5 §8.2: 70 = 70, katalog dışı 0 | — |

### 2.12 Yetki

| ID | İfade | Zorlama | Eşzamanlılık | Bekçi | Q-ID · Saha | Not |
|---|---|---|---|---|---|---|
| INV-YT-01 | **READ ⊇ WRITE:** yazabilen okuyabilir (`DOCUMENT_DESIGN_READ ⊇ DOCUMENT_DESIGN_WRITE`, `admin:settings` her ikisinde); `label-template:read/write` çiftinde bu YAPILMADI (bilinen tuzak); `PATCH /feature-flags` anahtar-kapsamlı fail-closed | **KOD** `constants/document-design.ts:37-44`; kart ↔ route aynı liste (Electron aynası) | — | `test_document_template_permission.ts` (81; üç negatif sonda) | — | — |
| INV-YT-02 | **SoD (tasarım):** `shipping:invoice` yalnız Muhasebe rolü; `shipping:undo-dispatch` ve `roll:manual-adjust` yalnız Üretim Süpervizörü; `admin:*` yalnız Tam Yetki; katalog ATAMAZ (atama panele) | **KOD** `role-template-catalog.ts:149-166`, `:235-254`, `ROLE_COVERAGE_EXEMPT :392-400` | — | `test_role_template_catalog.ts` (kapsam iki yönlü) | Q-YT-01: 6 aktif kullanıcı `undo-dispatch`+`manual-adjust`+`shipping:write` birlikte; 2'si ayrıca `shipping:invoice` (K5 H7 ile aynı ölçüm) | Tasarım ≠ atama: bulgu değil, ② G hücresine (K5) |
| INV-YT-03 | **Son admin koruması:** en az bir etkin (`validFrom/validUntil` penceresinde, aktif, silinmemiş) `admin:users`/`admin:*` kullanıcı kalır; set/revoke/deactivate/delete kapsar | **KOD** `permission-management.service.ts:582-665` | advisory 8025 (:609) tx içinde | `test_permission_management.ts` | Q-YT-02 etkin admin **4** | ⚠️ `validUntil` geçmişe çekilerek son admin söndürülebilir (K3b H-3, mantık boşluğu) |
| INV-YT-04 | `user_permissions(userId, permissionId)` tekil; JWT izin listesi bayat olabilir (yeniden giriş) — `tokenVersion` DB-backed | **DB:unique**; **KOD** `auth.middleware.ts` | — | — | — | — |
| INV-YT-05 | **Oturum politikası:** `(userId, deviceType)` başına aktif oturum politikası `off/notify/kick` (`kick` → eski oturumlar `revokedAt`); `work_sessions` makine/cihaz başına TEK aktif (partial unique) | **KOD** `session-registry.service.ts:72-119` (8024); **DB:partial-unique** `work_sessions_active_machine_uq/device_uq` | advisory 8024 (bekçisiz, K3b H-7) | `test_session_registry.ts` | Q-YT-04: bir kullanıcıda 40'a kadar aktif MOBILE oturumu (politika `off`/purge yapılmamış — bilgi) | 6 ayda bir `sessions/purge` ops görevi |
| INV-YT-06 | **Servis katmanı izin kontrolleri (F221 deseni):** `opts.permissions` verilmezse enforcement atlanır (dahili çağrı); kapsam topun DURUMUNDAN çözülür (`ALWAYS_BLOCKED` / `FREE_STOCK` / `roll:manual-adjust`+sebep) | **KOD** `inventory.service.applyManualProperties` `:3742-3783` | ⚠️ statü kapsamı pre-tx (K3a §6 #12) | `test_roll_edit_unified.ts` | — | — |

---

## 3. `consistency-check` bölümleri tek cümlede + INV eşlemesi

| § | Tek cümle | INV | Saha (kopya 0825) |
|---|---|---|---|
| 1 | `OL.shippedQty` = Σ DISPATCHED çuval tahsisi + Σ doğrudan sevk tahsisi | SEV-01 | 0 |
| 2 | `Order.shippedQty` = Σ satır | SEV-01 | 0 |
| 3 | Negatif/sıfır miktar yok (CHECK backstop) | STK-01, SIP-04 | 0 |
| 4 | Çuvaldaki topun `shipmentId` = çuvalın `shipmentId` (DEFERRABLE FK backstop) | SEV-03 | 0 |
| 5 | `shipment_orders.isActive` = (sevkiyat PLANNED) | SEV-11 | 0 |
| 6 | Çuval `seq` dolu ⇔ sevkiyata atanmış | SEV-09 | 0 |
| 7 | Çuvalda kayıtlı ama binada olmayan top yok (`SACK_ABSENT_STATUSES`; SHIPPED bilerek hariç) | STK-15 | 0 |
| 7b | Sevk edilmiş top aynı anda kartela/fason sevkinde değil (geçmiş çift-sayım; düzeltme yalnız insan kararı) | STK-15 | Tur 2 |
| 7c | İptal edilmiş kartela çuvalda değil | STK-15 | Tur 2 |
| 8 | Satılabilir top barkodlu | STK-07 | 0 |
| 9 | SHIPPED top ⇒ çuvalı var ∧ sevkiyatı DISPATCHED | SEV-03 | 0 |
| 10 | IN_PRODUCTION top ⇒ adımı var ∧ WO canlı | STK-12 | 0 |
| 11 | Açık movement ⇒ top canlı ∧ aynı adımda | STK-13 | 0 |
| 12 | Kapanmış movement'ta `qtyOut = qtyIn` (storno/dispozisyon/iptal desenleri muaf) | STK-05 | Tur 2 |
| 13 | `currentQty ≤ initialQty` | STK-02 | **2** (bilinçli) |
| 14 | Tüketilmiş fason topunun makbuzundan çocuk doğmuş | FAS-04 | 0 |
| 15 | AT_SUBCONTRACTOR top ⇒ açık fason sevk kaydı | FAS-01 | 0 |
| 16 | 2026-07-14 sonrası her WO'nun kartı var | WO-05 | 0 |
| 17 | Açık RollError'ın topu ölü değil | (SM-01) | 0 |
| 18 | Aktif master-data adı mükerrer değil (customers'ta tombstone süzgeci) | MD-01 | items 1 (bilinçli) |
| 19 | Fason sevk / doğrudan sevk `totalQty` = kalem toplamı | SEV-15 | 0 |
| 20 | `WorkOrderStep.status` = movement'lardan türetilen değer (giriş noktası kuralı) | SM-03 | Tur 2 |
| 21 | `WO.type = ORDER_PRODUCTION` ⇔ sipariş bağı var | WO-01 | 0 |
| 22 | IN_PROGRESS WO'nun tüm adımları bitmiş olamaz | WO-04 | 0 |
| 23 | Açık kurşun bypass ataması ⇒ WO canlı | SM-11 | 0 |
| 24a | Fason kalemin tek tam makbuzu iptal edilmişse kalem yeniden AÇIK (predikat kopyası tuzağı) | FAS-02 | Tur 2 |
| 24b | Doğrudan sevk edilmiş sevkin topu fasonda kalamaz | FAS-05 | 0 |
| 25 | Kartelalık işareti etiket basıldıktan sonra değiştiyse etiket bayat olmalı (kanıt audit'ten, 6 ay sınırı) | DOC-05 | Tur 2 |
| 26 / 26b | Depodaki top rengi ≠ hedef renk ⇒ sapma defterinde iz (26 bilgi; 26b kapı, `PLAN_GATE_SINCE` eşikli) | AUD-06 | 0 (defter boş → vakumen yeşil) |

---

## 4. HİÇBİR YERDE ZORLANMAYAN değişmezler (kod guard'ı da yok ya da yalnız türetim/gözlem)

| ID | Değişmez | Neden zorlanamıyor / durum | Ölçüm |
|---|---|---|---|
| INV-SEV-08 | Satır başına sevk (DISPATCHED) ≤ istenen (+tolerans); iki PLANNED sevkiyat aynı ihtiyacı iki kez tahsis edebilir | `allocate` yalnız DISPATCHED'i düşer; dispatch'te yeniden tahsis yok | Q-SEV-08a/b **0** (bugün) |
| INV-STK-14 | `currentStepId` dolu ⇒ üretim statüsü | yalnız yazma yollarının disiplini; bekçi yok | 0 |
| INV-STK-11(b) | Bir top aynı anda tek adımda açık | partial unique yalnız (roll, step) çifti | 0 |
| INV-SEV-04 | SHIPPED ⇒ `preShipStatus` dolu | eski satırlar yüzünden CHECK konamaz | 1 eski satır |
| INV-PAR-03 | Topun partisi ile adımının iş emri aynı | pivot/tx disiplini; sed yok | 0 |
| INV-WO-01 | Tip ↔ bağ | türetim CHECK'le yazılamaz; §21 yakalar | 0 |
| INV-AUD-04 | CANCELLED ⇒ iptal izi kolonları dolu | kolon nullable (eski kayıt); yazma yolu başına disiplin | **47/52 eksik** (H-5) |
| INV-AUD-01 | Her kayıt için audit satırı | best-effort + olay bazlı yazım | 55/2.391 (H-7) |
| INV-SEV-12/13 | EXPORT çuval tartılı / boş sevkiyat yok | pre-tx kontrol, claim sonrası tekrar yok | 0 |
| INV-FAS-07 | Makbuz iptali LIFO | pre-tx sıra kontrolü; tx içi ikizi yok | sorgu yazılamaz |
| INV-SM-01 (geçiş matrisi) | Roll statü geçişleri yalnız izinli kenarlar | DB'de enum geçiş seddi yok; 57 yazma sitesi | — |
| INV-DOC-01 (P istisnası) | Parti no benzersizliği | bilinçli kaldırıldı | 92 grup |

## 5. YALNIZ KODDA, EŞZAMANLILIK KORUMASIZ (ya da kısmi) — ② için

| ID | Yer | Boşluk | Kaynak |
|---|---|---|---|
| INV-SYS-03 / STK-10 | `inventory.service.ts:963-985` | İptal edilmiş topun clientToken replay'i statü kontrolsüz | K3a §6 #13 |
| INV-SEV-01 | `order.service.ts:3411` (`reopen`), `:2537` (`update`) | `recomputeOrderStatus` tam-küme `touchOrderLinesTx` olmadan → lost-update penceresi (S21 ∥ O7) | K3a §6 #23 |
| INV-SEV-06 | `return.service.ts:879-890` (`cancelReturn`) | 8023 alınmıyor, sevkiyat statüsü okunmuyor → `Roll SHIPPED, shipmentId=X` iken `Shipment X` PLANNED/CANCELLED olabilir | K3a §6 #15 |
| INV-SM-02 | `tambur-undo.service.ts:1246-1256, :1377, :1668` | WO guard kilitsiz okunuyor; `touchWorkOrderTx` yok; edinim sırası Step→WO (ABBA) | K3b H-1 |
| INV-WO-01 / WO-08 | `workorder-link.service.ts:279-342, :445`; `workorder.service.ts:5602-5719` | Tip flip / hedef özellik yazımı WO statü guard'sız, satır-kilitsiz | K3a §6 #2, #19, #20 |
| INV-WO-02 | `order.service.ts:500` (`cancelOrderLine` tip flip) | `targetItemId` guard'sız → CHECK'e çarpar (500/409 haritası?) | K3a §6 #9b |
| INV-FAS-03 | `subcontractor.service.ts:2677-2678` | `receive` wBR predicate'siz: token P2002'sini 5 kez baştan koşturur | K3a §6 #9 |
| INV-FAS-07 | `subcontractor.service.ts:4757-4775` | LIFO guard pre-tx; kısmi teslimat metrajının çift geri konması senaryosu | K3a §6 #7 |
| INV-DOC-04 | `traveler-card.service.ts:269-291` (`reprint`) | `version+1` claim'siz (uç çağrılmıyor) | K3b L4 |
| INV-MD-03 | `subcontractor-management.service.ts:512-526, :635-663`, `base.service.ts:1052` | katlanmış kod tekilliği kilitsiz (yalnız Item 8026) | K3b H-6 |
| INV-MD-01 | `master-data-merge.service.ts:686-698`; sıradan `customer.update` | ad çakışma kontrolü havuzda; DB seddi yumuşak kapı (items'ta yok) | K3b L7 |
| INV-YT-03 | `permission-management.service.ts:187-221, :285-302` | `validUntil` geçmişe çekme guard'ı atlar | K3b H-3 |
| INV-YT-05 | `session-registry.service.ts:72-119` | 8024 bekçisiz (kilit silinse test yeşil) | K3b H-7 |
| INV-SEV-12/13 | `shipping.service.ts:1895-1903` | pre-tx kontrol, claim sonrası tekrar yok | K3a §6 #17 |
| INV-YT-06 | `inventory.service.ts:3742-3783` | statü kapsamı pre-tx; claim yalnız `shipmentId/sackId` pin'ler; `currentQty/initialQty` kesilmiş topa yazılabilir | K3a §6 #12 |
| INV-SM-01 | `inventory.service.ts:3452` (`restoreCancelledRoll`), `:4033` (`prepareRawForSale`), `workorder.service.ts:6100` (`lockWorkOrder`) | statü yazımı **havuz client'ında** (tx yok; claim var) | K4 §2 |

## 6. BİLİNÇLİ İHLALLER / tasarım kararları (bulgu yazılmaz)

| ID | Karar | Kaynak |
|---|---|---|
| INV-PAR-01 | Parti no benzersiz değil (P01…P99 körlemesine sarma; 92 grup) | CLAUDE.md 2026-08-05 |
| INV-SYS-05 / AUD-01 | Audit best-effort, tx dışı; garantili değil | ARCHITECTURE §8.5 |
| INV-SEV-07 | Bir sipariş birden çok PLANNED sevkiyatta olabilir (unique kaldırıldı) | `schema.prisma:4315-4318` |
| INV-STK-02 | §13'teki 2 eski satır düzeltilmedi (kök nedeni gizlememek için) | CLAUDE.md 2026-08-22 |
| INV-MD-01 | nameFold seddi YUMUŞAK KAPI — mükerrer varken index atlanır (items sahada yok) | CLAUDE.md 2026-08-22 |
| INV-MD-04 | FIRE kaliteli 4 WAREHOUSE topu (karar öncesi); Customer VKN tekilliği YOK (P5) | CLAUDE.md 2026-08-20/22 |
| INV-WO-12 | Rota kapsaması uyarır, reddetmez (eksik rotayla WO açılabilir) | CLAUDE.md 2026-08-27 |
| INV-STK-09 | Barkod sayacında boşluk (rollback) | `roll-barcode.helper.ts:66-71` |
| INV-STK-08 | `SHIPPED`/`CANCELLED` `finalizedAt` kaynak listesinde yok; `WAREHOUSE→SCRAP` damgayı tazelemez | migration `20260809090000:71-77` |
| INV-SEV-05 | Sevk rakamı brüt, iade düşmez; `totalKg` iadeyle değişmez | CLAUDE.md 2026-08-02/03/05 |
| INV-YM-01 | Yarı mamul arza dahil (ayrı depo yok) | CLAUDE.md 2026-08-27 |
| INV-FAS-06 | Çekme hata değil ölçülen gerçek; `FASON_CEKME` `SCRAP_REASONS`'a eklenmez | CLAUDE.md 2026-08-21 |
| INV-SM-08 | Sipariş `COMPLETED` toleransla (5 m); fazla sevk mümkün | `order-status.helper.ts:167-181` |
| INV-SYS-01 | Tek process, kod-içi zorlama yok (YAGNI) | ARCHITECTURE §10.3 |
| INV-AUD-02 | Audit tamper trigger'ı varsayılan KAPALI (GUC ile açılır) | migration `20260819161000` |
| INV-SM-11 / bypass | Dağıtım ön koşul DEĞİL (milestone confirmation); parçalı sonuç `failed[]` | CLAUDE.md 2026-08-05/06 |
| INV-STK-03 | Aşım bayrağı (`tambur.overQuantityEnabled`) varsayılan AÇIK → aşım kabul edilir, OVERAGE yazılır | `tambur.service.ts:744-753` |

---

## 7. Doğrulama sorguları (salt-okunur; Tur 2'de `tekserp_saha_0825`'te koşulacak)

Tablo/kolon adları `schema.prisma` `@@map`/kolon adlarından ve `information_schema` sorgusuyla (2026-08-28) doğrulandı. Hepsi **2026-08-28'de saha kopyasında koştu** (sonuçlar Bölüm 2'deki "Saha" sütunlarında). Koşum: `audit/tools/sql-saha.sh -v ON_ERROR_STOP=0 -A -f <dosya>`. `consistency-check*.sql` §'lerinin birebir kopyası olan sorgular (§1-§19, §21-§26b) burada tekrarlanmadı — o dosyalar doğrudan koşulur (`psql -f`); §20 `test_consistency.ts:462-520`'dedir. ⚠️ Saha kopyasında `orders.cancelledAt` / `order_lines.cancelledAt` **YOK** (5 migration eksik) — Q-SM-08 saha varyantıdır; dev varyantı notta.

```sql
-- ==== Q-STK-01 · negatif/sıfır miktar (CHECK backstop; beklenen 0) ====
SELECT 'rolls' AS tablo, id::text AS kayit FROM rolls
  WHERE "currentQty" < 0 OR "initialQty" < 0 OR ("weightKg" IS NOT NULL AND "weightKg" < 0)
UNION ALL SELECT 'order_lines', id::text FROM order_lines WHERE "quantity" <= 0 OR "shippedQty" < 0
UNION ALL SELECT 'sack_allocations', id::text FROM sack_allocations WHERE qty <= 0
UNION ALL SELECT 'roll_variances', id::text FROM roll_variances WHERE qty <= 0;

-- ==== Q-STK-02 · currentQty > initialQty (bilinçli 2 eski satır) ====
SELECT id, barcode, "initialQty", "currentQty", status FROM rolls WHERE "currentQty" > "initialQty";

-- ==== Q-STK-03 · Tambur çocuk toplamı > parent GİRİŞ metrajı ∧ OVERAGE defter satırı yok ====
-- (preTamburCloseQty KAPANIŞ ANI kalanıdır, toplam değil — initialQty üzerinden ölçülür)
SELECT p.id, p.barcode, p."initialQty", SUM(c."initialQty") AS cocuk_toplam
FROM rolls p JOIN rolls c ON c."parentRollId" = p.id AND c.status <> 'CANCELLED'
WHERE p.status = 'TAMBUR_CONSUMED'
GROUP BY p.id, p.barcode, p."initialQty"
HAVING SUM(c."initialQty") > p."initialQty" + 0.001
   AND NOT EXISTS (SELECT 1 FROM roll_variances v WHERE v."rollId" = p.id AND v.kind = 'OVERAGE' AND v."reversedAt" IS NULL);
-- Q-STK-03b (bilgi): aşımlı parent / defterli
SELECT count(*) AS asimli_parent, count(*) FILTER (WHERE has_var) AS defterli FROM (
  SELECT p.id, SUM(c."initialQty") > p."initialQty" + 0.001 AS asim,
         EXISTS (SELECT 1 FROM roll_variances v WHERE v."rollId" = p.id AND v.kind = 'OVERAGE' AND v."reversedAt" IS NULL) AS has_var
  FROM rolls p JOIN rolls c ON c."parentRollId" = p.id AND c.status <> 'CANCELLED'
  WHERE p.status = 'TAMBUR_CONSUMED' GROUP BY p.id, p."initialQty") q WHERE asim;

-- ==== Q-STK-04 · TAMBUR_CONSUMED parent: currentQty=0 ∧ adım yok ∧ ≥1 çocuk ====
SELECT p.id, p.barcode, p."currentQty", p."currentStepId", (SELECT count(*) FROM rolls c WHERE c."parentRollId" = p.id) AS cocuk
FROM rolls p WHERE p.status = 'TAMBUR_CONSUMED'
  AND (p."currentQty" <> 0 OR p."currentStepId" IS NOT NULL OR NOT EXISTS (SELECT 1 FROM rolls c WHERE c."parentRollId" = p.id));

-- ==== Q-STK-06 · serbest arz kovaları (bilgi) ====
SELECT status, "entrySource", count(*) AS adet, SUM("currentQty") AS metraj FROM rolls
WHERE status IN ('WAREHOUSE','A1_STOCK','STOCK') AND "shipmentId" IS NULL AND "sackId" IS NULL GROUP BY 1,2 ORDER BY 1,2;

-- ==== Q-STK-07 · barkodsuz satılabilir top ====
SELECT id, status, "currentQty", "updatedAt" FROM rolls WHERE status IN ('WAREHOUSE','A1_STOCK') AND barcode IS NULL;

-- ==== Q-STK-08 · finalizedAt damgası (bilgi) ====
SELECT status, count(*) FILTER (WHERE "finalizedAt" IS NULL) AS damgasiz, count(*) AS toplam
FROM rolls WHERE status IN ('WAREHOUSE','A1_STOCK','SCRAP','SHIPPED') GROUP BY 1;

-- ==== Q-STK-09a · barkod biçimi T+GGAAYY+{H|F}+NNNN dışı ====
SELECT id, barcode FROM rolls WHERE barcode IS NOT NULL AND barcode !~ '^T[0-9]{6}[HF][0-9]{4}$';
-- ==== Q-STK-09b · sayaç geride (kullanılan max sıra > counter.n) ====
SELECT x.d AS gun, x.t AS tip, x.max_seq, c.n AS sayac
FROM (SELECT substr(barcode,2,6) AS d, substr(barcode,8,1) AS t, max(substr(barcode,9,4)::int) AS max_seq
      FROM rolls WHERE barcode ~ '^T[0-9]{6}[HF][0-9]{4}$' GROUP BY 1,2) x
LEFT JOIN roll_barcode_counters c ON c.day = x.d AND c.type = x.t
WHERE c.n IS NULL OR x.max_seq > c.n;

-- ==== Q-STK-10 · iptal/fire top ama clientToken taşıyor (replay yüzeyi, bilgi) ====
SELECT count(*) AS adet FROM rolls WHERE "clientToken" IS NOT NULL AND status IN ('CANCELLED','SCRAP');
-- Q-STK-10b · aynı token iki top (unique → 0)
SELECT count(*) FROM rolls r1 JOIN rolls r2 ON r2."clientToken" = r1."clientToken" AND r2.id <> r1.id;

-- ==== Q-STK-11a · aynı top+adımda >1 açık hareket ==== / Q-STK-11b · aynı top >1 adımda açık
SELECT "rollId", "workOrderStepId", count(*) FROM roll_movements WHERE "exitedAt" IS NULL GROUP BY 1,2 HAVING count(*) > 1;
SELECT "rollId", count(DISTINCT "workOrderStepId") AS adim FROM roll_movements WHERE "exitedAt" IS NULL GROUP BY 1 HAVING count(DISTINCT "workOrderStepId") > 1;

-- ==== Q-STK-12 · IN_PRODUCTION ama adım yok / WO terminal (§10) ====
SELECT r.id, r.barcode, r."currentStepId", wos."workOrderId", wo.status AS wo_durumu
FROM rolls r LEFT JOIN work_order_steps wos ON wos.id = r."currentStepId" LEFT JOIN work_orders wo ON wo.id = wos."workOrderId"
WHERE r.status = 'IN_PRODUCTION' AND (r."currentStepId" IS NULL OR wo.id IS NULL OR wo.status IN ('CANCELLED','SUPERSEDED'));

-- ==== Q-STK-13 · hayalet açık hareket (§11) ====
SELECT rm.id, rm."rollId", r.barcode, r.status, rm."workOrderStepId", r."currentStepId"
FROM roll_movements rm JOIN rolls r ON r.id = rm."rollId"
WHERE rm."exitedAt" IS NULL
  AND (r.status IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED') OR r."currentStepId" IS DISTINCT FROM rm."workOrderStepId");

-- ==== Q-STK-14 · adıma bağlı ama üretim-dışı statü ====
SELECT id, barcode, status, "currentStepId" FROM rolls
WHERE "currentStepId" IS NOT NULL AND status NOT IN ('IN_PRODUCTION','AT_SUBCONTRACTOR','RETURNED_FROM_SUBCONTRACTOR');

-- ==== Q-STK-15 · çuvalda hayalet içerik (§7) ====
SELECT r.id, r.barcode, r.status, s."sackNo", sh."shipmentNo", sh.status AS sevk
FROM rolls r JOIN sacks s ON s.id = r."sackId" LEFT JOIN shipments sh ON sh.id = s."shipmentId"
WHERE r.status IN ('CANCELLED','SCRAP','IN_PRODUCTION','AT_SUBCONTRACTOR','SUBCONTRACTOR_CONSUMED','AT_KARTELA','KARTELA_CONSUMED','TAMBUR_CONSUMED');

-- ==== Q-SM-02a · terminal/COMPLETED iş emrinde fasonda top ====
SELECT r.id, r.barcode, r.status, wo."workOrderNumber", wo.status AS wo_durumu
FROM rolls r JOIN work_order_steps s ON s.id = r."currentStepId" JOIN work_orders wo ON wo.id = s."workOrderId"
WHERE r.status IN ('AT_SUBCONTRACTOR','RETURNED_FROM_SUBCONTRACTOR') AND wo.status IN ('COMPLETED','CANCELLED','SUPERSEDED');
-- ==== Q-SM-02b · CANCELLED iş emrinde ACTIVE/PENDING adım (bilgi) ====
SELECT wo."workOrderNumber", wo."cancelledAt", string_agg(s.status::text, ',') FROM work_orders wo JOIN work_order_steps s ON s."workOrderId" = wo.id
WHERE wo.status = 'CANCELLED' AND s.status IN ('ACTIVE','PENDING') GROUP BY 1,2;

-- ==== Q-SM-04 · sevkiyat statü ↔ dispatchedAt ====
SELECT id, "shipmentNo", status, "dispatchedAt" FROM shipments
WHERE (status = 'DISPATCHED' AND "dispatchedAt" IS NULL) OR (status <> 'DISPATCHED' AND "dispatchedAt" IS NOT NULL);

-- ==== Q-SM-08 · sipariş statüsü türetilmiş değerden sapıyor (SAHA varyantı) ====
-- DEV varyantı: `led`'e ol."cancelledAt" ekle; istenen = Σ(cancelledAt IS NULL ? quantity : shipped);
-- tüm kalemler iptal ∧ kalem>0 → shipped>0 ? COMPLETED : CANCELLED (order-status.helper.ts:141-181)
WITH tol AS (SELECT COALESCE((SELECT (value #>> '{}')::numeric FROM system_settings WHERE key = 'shipping.toleranceMeters'), 5) AS t),
led AS (
  SELECT ol.id, ol."orderId", ol.quantity,
         COALESCE((SELECT SUM(sa.qty) FROM sack_allocations sa JOIN sacks sk ON sk.id = sa."sackId" JOIN shipments sh ON sh.id = sk."shipmentId"
                   WHERE sa."orderLineId" = ol.id AND sh.status = 'DISPATCHED'), 0)
       + COALESCE((SELECT SUM(d.qty) FROM subcontractor_direct_ship_allocations d WHERE d."orderLineId" = ol.id), 0) AS shipped
  FROM order_lines ol),
agg AS (
  SELECT o.id, o."orderNumber", o.status AS kayitli, SUM(led.quantity) AS istenen, SUM(led.shipped) AS sevk
  FROM orders o JOIN led ON led."orderId" = o.id
  WHERE o.status <> 'CANCELLED' AND o."manualClosedById" IS NULL
  GROUP BY o.id, o."orderNumber", o.status)
SELECT a.*, CASE WHEN a.sevk <= 0 THEN (CASE WHEN a.kayitli = 'PENDING' THEN 'PENDING' ELSE 'APPROVED' END)
                 WHEN a.istenen - a.sevk <= (SELECT t FROM tol) THEN 'COMPLETED' ELSE 'PARTIAL_SHIPPED' END AS beklenen
FROM agg a
WHERE a.kayitli::text <> CASE WHEN a.sevk <= 0 THEN (CASE WHEN a.kayitli = 'PENDING' THEN 'PENDING' ELSE 'APPROVED' END)
                              WHEN a.istenen - a.sevk <= (SELECT t FROM tol) THEN 'COMPLETED' ELSE 'PARTIAL_SHIPPED' END;

-- ==== Q-SEV-01 / Q-SEV-01b · defter mutabakatı = consistency-check.sql §1 / §2 (kopyalanmadı) ====
-- ==== Q-SEV-03a · = §4 ; Q-SEV-03b · SHIPPED ⇔ DISPATCHED (§9 + ters yön) ====
SELECT r.id, r.barcode, r.status, sh.status AS sevk FROM rolls r LEFT JOIN sacks s ON s.id = r."sackId" LEFT JOIN shipments sh ON sh.id = s."shipmentId"
WHERE (r.status = 'SHIPPED' AND (r."sackId" IS NULL OR sh.status IS DISTINCT FROM 'DISPATCHED'))
   OR (r.status <> 'SHIPPED' AND sh.status = 'DISPATCHED'
       AND r.status NOT IN ('CANCELLED','SCRAP','IN_PRODUCTION','AT_SUBCONTRACTOR','SUBCONTRACTOR_CONSUMED','AT_KARTELA','KARTELA_CONSUMED','TAMBUR_CONSUMED'));

-- ==== Q-SEV-04 · preShipStatus dağılımı (bilgi) ====
SELECT "preShipStatus", count(*) FROM rolls WHERE status = 'SHIPPED' GROUP BY 1;

-- ==== Q-SEV-05a/b/c · iade defteri ====
SELECT rr.id, r.barcode, r.status, r."shipmentId" FROM roll_returns rr JOIN rolls r ON r.id = rr."rollId" WHERE rr."cancelledAt" IS NULL AND (r.status = 'SHIPPED' OR r."shipmentId" IS NOT NULL);
SELECT "rollId", count(*) FROM roll_returns WHERE "cancelledAt" IS NULL GROUP BY 1 HAVING count(*) > 1;
SELECT rr.id, rr.qty, r."initialQty" FROM roll_returns rr JOIN rolls r ON r.id = rr."rollId" WHERE rr.qty > r."initialQty";
-- ==== Q-SEV-06 · aktif iadenin sevkiyatı DISPATCHED değil ====
SELECT rr.id, sh."shipmentNo", sh.status FROM roll_returns rr JOIN shipments sh ON sh.id = rr."fromShipmentId" WHERE rr."cancelledAt" IS NULL AND sh.status <> 'DISPATCHED';
-- ==== Q-SEV-07 · sipariş >1 PLANNED sevkiyatta (bilgi) ====
SELECT so."orderId", count(*) FROM shipment_orders so JOIN shipments sh ON sh.id = so."shipmentId" WHERE sh.status = 'PLANNED' GROUP BY 1 HAVING count(*) > 1;
-- ==== Q-SEV-08a · sevk > istenen ; Q-SEV-08b · sevk + PLANNED tahsis > istenen ====
SELECT ol.id, ol.quantity, ol."shippedQty", ol."shippedQty" - ol.quantity AS fazla FROM order_lines ol WHERE ol."shippedQty" > ol.quantity;
SELECT ol.id, ol.quantity, ol."shippedQty", SUM(sa.qty) FILTER (WHERE sh.status = 'PLANNED') AS planli
FROM order_lines ol JOIN sack_allocations sa ON sa."orderLineId" = ol.id JOIN sacks sk ON sk.id = sa."sackId" JOIN shipments sh ON sh.id = sk."shipmentId"
GROUP BY ol.id, ol.quantity, ol."shippedQty"
HAVING ol."shippedQty" + COALESCE(SUM(sa.qty) FILTER (WHERE sh.status = 'PLANNED'), 0) > ol.quantity;
-- ==== Q-SEV-09 · seq ↔ shipmentId (§6) + çuval no biçimi ====
SELECT id, "sackNo", "shipmentId", seq FROM sacks WHERE ("shipmentId" IS NULL AND seq IS NOT NULL) OR ("shipmentId" IS NOT NULL AND seq IS NULL) OR "sackNo" !~ '^CV[0-9]{10}$';
-- ==== Q-SEV-11 · = §5 ; Q-SEV-12 · EXPORT tartısız çuval ; Q-SEV-13 · çuvalsız DISPATCHED ; Q-SEV-14 · fatura izi ====
SELECT sh."shipmentNo", sk."sackNo", sk."weightKg" FROM shipments sh JOIN sacks sk ON sk."shipmentId" = sh.id WHERE sh.status = 'DISPATCHED' AND sh.destination = 'EXPORT' AND (sk."weightKg" IS NULL OR sk."weightKg" <= 0);
SELECT sh.id, sh."shipmentNo" FROM shipments sh WHERE sh.status = 'DISPATCHED' AND NOT EXISTS (SELECT 1 FROM sacks sk WHERE sk."shipmentId" = sh.id);
SELECT id, "shipmentNo", status, "invoiceNo", "invoicedAt" FROM shipments WHERE ("invoiceNo" IS NOT NULL AND (status <> 'DISPATCHED' OR "invoicedAt" IS NULL)) OR ("invoiceNo" IS NULL AND "invoicedAt" IS NOT NULL);
-- ==== Q-SEV-15 · = §19 ====
-- ==== Q-SEV-17 · tahsis sipariş kümesi dışında / çuval sevkiyatsız ====
SELECT sa.id, sk."sackNo", ol."orderId", sk."shipmentId" FROM sack_allocations sa JOIN sacks sk ON sk.id = sa."sackId" JOIN order_lines ol ON ol.id = sa."orderLineId"
WHERE sk."shipmentId" IS NULL OR NOT EXISTS (SELECT 1 FROM shipment_orders so WHERE so."shipmentId" = sk."shipmentId" AND so."orderId" = ol."orderId");
-- ==== Q-SEV-18 · çuval tahsis toplamı > çuval brüt içeriği (iade geri-eklemeli) ====
SELECT sk."sackNo", SUM(sa.qty) AS tahsis,
  (SELECT COALESCE(SUM(r."currentQty"),0) FROM rolls r WHERE r."sackId" = sk.id AND r.status NOT IN ('CANCELLED','SCRAP','IN_PRODUCTION','AT_SUBCONTRACTOR','SUBCONTRACTOR_CONSUMED','AT_KARTELA','KARTELA_CONSUMED','TAMBUR_CONSUMED'))
  + (SELECT COALESCE(SUM(rr.qty),0) FROM roll_returns rr WHERE rr."prevSackId" = sk.id AND rr."cancelledAt" IS NULL) AS brut_icerik
FROM sack_allocations sa JOIN sacks sk ON sk.id = sa."sackId" GROUP BY sk.id, sk."sackNo"
HAVING SUM(sa.qty) > (SELECT COALESCE(SUM(r."currentQty"),0) FROM rolls r WHERE r."sackId" = sk.id AND r.status NOT IN ('CANCELLED','SCRAP','IN_PRODUCTION','AT_SUBCONTRACTOR','SUBCONTRACTOR_CONSUMED','AT_KARTELA','KARTELA_CONSUMED','TAMBUR_CONSUMED'))
  + (SELECT COALESCE(SUM(rr.qty),0) FROM roll_returns rr WHERE rr."prevSackId" = sk.id AND rr."cancelledAt" IS NULL) + 0.001;

-- ==== Q-SIP-06 · sevkiyat ↔ sipariş müşteri/şube uyumu ====
SELECT sh."shipmentNo", o."orderNumber", sh."customerId" = o."customerId" AS musteri_ok, sh."branchId", o."branchId" AS siparis_sube
FROM shipment_orders so JOIN shipments sh ON sh.id = so."shipmentId" JOIN orders o ON o.id = so."orderId"
WHERE sh."customerId" <> o."customerId" OR (sh."branchId" IS NOT NULL AND o."branchId" IS NOT NULL AND sh."branchId" <> o."branchId");

-- ==== Q-DOC-01 · belge no biçimi dışı (customers/items elle kod alabilir → bilgi) ====
SELECT 'work_orders' AS t, "workOrderNumber" AS v FROM work_orders WHERE "workOrderNumber" !~ '^IE[0-9]{10}$'
UNION ALL SELECT 'orders', "orderNumber" FROM orders WHERE "orderNumber" !~ '^SIP[0-9]{10}$'
UNION ALL SELECT 'shipments', "shipmentNo" FROM shipments WHERE "shipmentNo" !~ '^SVK[0-9]{10}$'
UNION ALL SELECT 'sacks', "sackNo" FROM sacks WHERE "sackNo" !~ '^CV[0-9]{10}$'
UNION ALL SELECT 'subcontractor_dispatches', "dispatchNo" FROM subcontractor_dispatches WHERE "dispatchNo" !~ '^FS[0-9]{10}$'
UNION ALL SELECT 'subcontractor_receipts', "receiptNo" FROM subcontractor_receipts WHERE "receiptNo" !~ '^FK[0-9]{10}$'
UNION ALL SELECT 'customers(bilgi)', code FROM customers WHERE code !~ '^MUS[0-9]{10}$'
UNION ALL SELECT 'items(bilgi)', code FROM items WHERE code !~ '^STK-[0-9]{6}$';
-- ==== Q-DOC-02 · günlük sayaç boşlukları ====
WITH k AS (
  SELECT 'IE' AS p, "workOrderNumber" AS v FROM work_orders WHERE "workOrderNumber" ~ '^IE[0-9]{10}$'
  UNION ALL SELECT 'SIP', "orderNumber" FROM orders WHERE "orderNumber" ~ '^SIP[0-9]{10}$'
  UNION ALL SELECT 'SVK', "shipmentNo" FROM shipments WHERE "shipmentNo" ~ '^SVK[0-9]{10}$'
  UNION ALL SELECT 'CV', "sackNo" FROM sacks WHERE "sackNo" ~ '^CV[0-9]{10}$'
  UNION ALL SELECT 'FS', "dispatchNo" FROM subcontractor_dispatches WHERE "dispatchNo" ~ '^FS[0-9]{10}$'
  UNION ALL SELECT 'FK', "receiptNo" FROM subcontractor_receipts WHERE "receiptNo" ~ '^FK[0-9]{10}$')
SELECT p, substr(v, length(p)+1, 6) AS gun, max(substr(v, length(p)+7)::int) AS max_sira, count(*) AS adet
FROM k GROUP BY 1,2 HAVING max(substr(v, length(p)+7)::int) <> count(*) ORDER BY 1,2;
-- ==== Q-DOC-03a/b · fason sevk belgesi var / VOIDED ↔ cancelledAt ====
SELECT sd."dispatchNo" FROM subcontractor_dispatches sd WHERE NOT EXISTS (SELECT 1 FROM printed_documents pd WHERE pd."docType" = 'SUBCONTRACTOR_DISPATCH' AND pd."sourceId" = sd.id);
SELECT pd."documentNo", pd.status, pd.version, sd."cancelledAt" FROM printed_documents pd JOIN subcontractor_dispatches sd ON sd.id = pd."sourceId"
WHERE pd."docType" = 'SUBCONTRACTOR_DISPATCH' AND ((pd.status = 'ACTIVE' AND sd."cancelledAt" IS NOT NULL) OR (pd.status = 'VOIDED' AND sd."cancelledAt" IS NULL));
-- ==== Q-DOC-04a/b · ACTIVE irsaliye ↔ sevkiyat DISPATCHED ; kaynakta >1 ACTIVE ====
SELECT pd."documentNo", pd.status, sh.status AS sevk FROM printed_documents pd JOIN shipments sh ON sh.id = pd."sourceId" WHERE pd."docType" = 'SHIPMENT_DISPATCH' AND pd.status = 'ACTIVE' AND sh.status <> 'DISPATCHED';
SELECT "docType", "sourceId", count(*) FROM printed_documents WHERE status = 'ACTIVE' GROUP BY 1,2 HAVING count(*) > 1;
-- ==== Q-DOC-05 · DISPATCHED ama donmuş irsaliye yok ; Q-DOC-06 · aktif iade (2026-08-02+) ama iade irsaliyesi yok ====
SELECT sh."shipmentNo", sh."dispatchedAt" FROM shipments sh WHERE sh.status = 'DISPATCHED' AND NOT EXISTS (SELECT 1 FROM printed_documents pd WHERE pd."docType" = 'SHIPMENT_DISPATCH' AND pd."sourceId" = sh.id);
SELECT rr.id, rr."createdAt" FROM roll_returns rr WHERE rr."cancelledAt" IS NULL AND rr."createdAt" >= '2026-08-02'
  AND NOT EXISTS (SELECT 1 FROM printed_documents pd WHERE pd."docType" = 'RETURN_DISPATCH' AND pd."sourceId" = COALESCE(rr."returnGroupId", rr.id));

-- ==== Q-FAS-01 · = §15 ; Q-FAS-02 · = §24a/§24b ====
-- ==== Q-FAS-03a · kabul toplamı > sevk kalemi metrajı ; Q-FAS-03b · kısmi makbuz ama top fason dışında ====
SELECT sdi.id, sd."dispatchNo", r.barcode, sdi."dispatchedQty", SUM(COALESCE(sri."receivedQty", 0)) AS kabul
FROM subcontractor_dispatch_items sdi JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId" JOIN rolls r ON r.id = sdi."rollId"
JOIN subcontractor_receipt_items sri ON sri."sourceDispatchItemId" = sdi.id JOIN subcontractor_receipts sr ON sr.id = sri."receiptId" AND sr."cancelledAt" IS NULL
GROUP BY sdi.id, sd."dispatchNo", r.barcode, sdi."dispatchedQty" HAVING SUM(COALESCE(sri."receivedQty", 0)) > sdi."dispatchedQty" + 0.001;
SELECT sri.id, r.barcode, r.status FROM subcontractor_receipt_items sri JOIN subcontractor_receipts sr ON sr.id = sri."receiptId" AND sr."cancelledAt" IS NULL JOIN rolls r ON r.id = sri."newRollId"
WHERE sri."isPartial" AND r.status NOT IN ('AT_SUBCONTRACTOR','SUBCONTRACTOR_CONSUMED');
-- ==== Q-FAS-04a · = §14 ; Q-FAS-04b · CONSUMED ama tam makbuz/kalan-kapama/doğrudan sevk izi yok ; Q-FAS-04c · entrySource ⇔ parentReceiptId ====
SELECT r.id, r.barcode FROM rolls r WHERE r.status = 'SUBCONTRACTOR_CONSUMED'
  AND NOT EXISTS (SELECT 1 FROM subcontractor_receipt_items sri JOIN subcontractor_receipts sr ON sr.id = sri."receiptId" WHERE sri."newRollId" = r.id AND sri."isPartial" = false AND sr."cancelledAt" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM subcontractor_dispatch_items sdi JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId" WHERE sdi."rollId" = r.id AND (sdi."remainderClosedAt" IS NOT NULL OR sd."directShippedAt" IS NOT NULL));
SELECT id, barcode, "entrySource", "parentReceiptId" FROM rolls WHERE ("entrySource" = 'SUBCONTRACTOR_RETURN') <> ("parentReceiptId" IS NOT NULL);
-- ==== Q-FAS-06 · çekme defteri (2026-08-21+ makbuz): doğan ≠ tüketilen ∧ defter satırı yok ====
SELECT * FROM (
  SELECT sr.id, sr."receiptNo",
    (SELECT COALESCE(SUM(COALESCE(sri."receivedQty", sdi."dispatchedQty")),0) FROM subcontractor_receipt_items sri LEFT JOIN subcontractor_dispatch_items sdi ON sdi.id = sri."sourceDispatchItemId" WHERE sri."receiptId" = sr.id) AS tuketilen,
    (SELECT COALESCE(SUM(c."initialQty"),0) FROM rolls c WHERE c."parentReceiptId" = sr.id) AS dogan,
    EXISTS (SELECT 1 FROM roll_variances v WHERE v."sourceRefId" = sr.id AND v."reversedAt" IS NULL) AS defter
  FROM subcontractor_receipts sr WHERE sr."cancelledAt" IS NULL AND sr."createdAt" >= '2026-08-21') q
WHERE abs(q.dogan - q.tuketilen) > 0.01 AND NOT q.defter;
-- ==== Q-FAS-08 · fason sevkin partisi başka iş emrine ait ====
SELECT sd."dispatchNo", b."batchNumber" FROM subcontractor_dispatches sd JOIN batches b ON b.id = sd."batchId" WHERE b."workOrderId" <> sd."workOrderId";

-- ==== Q-PAR-01a · mükerrer parti no grupları (BİLİNÇLİ) ; Q-PAR-01b · biçim dışı ====
SELECT count(*) AS mukerrer_grup, sum(n) AS satir FROM (SELECT "batchNumber", count(*) AS n FROM batches GROUP BY 1 HAVING count(*) > 1) g;
SELECT id, "batchNumber" FROM batches WHERE "batchNumber" !~ '^(P(0[1-9]|[1-9][0-9])|P[0-9]{6}[0-9]+)$';
-- ==== Q-PAR-02 · kısa parti sırası kopuk ====
WITH s AS (SELECT id, "batchNumber", "createdAt", substr("batchNumber",2)::int AS seq,
                  lag(substr("batchNumber",2)::int) OVER (ORDER BY "createdAt", id) AS prev
           FROM batches WHERE "batchNumber" ~ '^P(0[1-9]|[1-9][0-9])$')
SELECT "batchNumber", prev, "createdAt" FROM s WHERE prev IS NOT NULL AND seq <> (prev % 99) + 1;
-- ==== Q-PAR-03 · parti WO ≠ adım WO ; Q-PAR-04 · TAMBUR_MANUAL partisiz (bilgi) ; Q-PAR-05 · canlı topsuz parti (bilgi) ; Q-PAR-07 · tombstone partide top ====
SELECT r.id, r.barcode, b."batchNumber", b."workOrderId" AS parti_wo, s."workOrderId" AS adim_wo FROM rolls r JOIN batches b ON b.id = r."batchId" JOIN work_order_steps s ON s.id = r."currentStepId" WHERE b."workOrderId" <> s."workOrderId";
SELECT count(*) FILTER (WHERE "batchId" IS NULL) AS partisiz, count(*) AS toplam FROM rolls WHERE "entrySource" = 'TAMBUR_MANUAL';
SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM rolls r WHERE r."batchId" = b.id AND r.status NOT IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED'))) AS kapali_parti, count(*) AS toplam FROM batches b WHERE b."mergedIntoId" IS NULL;
SELECT b."batchNumber", count(r.id) FROM batches b JOIN rolls r ON r."batchId" = b.id WHERE b."mergedIntoId" IS NOT NULL GROUP BY 1;

-- ==== Q-WO-01 · = §21 ; Q-WO-02 · STOK hedef kumaşsız ; Q-WO-04 · = §22 ; Q-WO-05 · kartsız/çok kartlı (§16 geniş) ; Q-WO-06 · kart ↔ WO ; Q-WO-07 · adım zaman sırası ; Q-WO-13 · kart sürümü < defter ====
SELECT id, "workOrderNumber" FROM work_orders WHERE type = 'STOCK_PRODUCTION' AND "targetItemId" IS NULL;
SELECT wo."workOrderNumber", count(tc.id) AS kart FROM work_orders wo LEFT JOIN traveler_cards tc ON tc."workOrderId" = wo.id WHERE wo."createdAt" >= '2026-07-14' GROUP BY wo.id, wo."workOrderNumber" HAVING count(tc.id) <> 1;
SELECT wo."workOrderNumber", wo.status AS wo, tc.status AS kart FROM work_orders wo JOIN traveler_cards tc ON tc."workOrderId" = wo.id
WHERE (wo.status = 'COMPLETED' AND tc.status = 'ACTIVE') OR (wo.status IN ('CANCELLED','SUPERSEDED') AND tc.status NOT IN ('VOIDED','COMPLETED')) OR (wo.status IN ('PLANNED','IN_PROGRESS') AND tc.status <> 'ACTIVE');
SELECT id FROM work_order_steps WHERE "completedAt" IS NOT NULL AND "startedAt" IS NOT NULL AND "completedAt" < "startedAt";
SELECT tc."cardNumber", tc.version, m.mx FROM traveler_cards tc JOIN LATERAL (SELECT max(version) AS mx FROM printed_documents pd WHERE pd."docType" = 'TRAVELER_CARD' AND pd."sourceId" = tc.id) m ON true WHERE m.mx > tc.version;
-- ==== Q-SM-11 · = §23 ; Q-SM-11b · adım başına >1 açık bypass ====
SELECT "workOrderStepId", count(*) FROM kursun_bypass_assignments WHERE "completedAt" IS NULL AND "cancelledAt" IS NULL GROUP BY 1 HAVING count(*) > 1;

-- ==== Q-YM-01 · yarı mamul dağılımı (bilgi) ====
SELECT status, count(*) FROM rolls WHERE "entrySource" = 'SEMI_FINISHED' GROUP BY 1;

-- ==== Q-AUD-01b · son 30 günde doğan top ama HİÇBİR audit satırı yok (bilgi) ====
SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM system_logs sl WHERE sl."recordId" = r.id::text)) AS auditsiz, count(*) AS toplam,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM system_logs sl WHERE sl."recordId" = r.id::text) AND r."entrySource" = 'TAMBUR_SPLIT') AS auditsiz_tambur_cocugu
FROM rolls r WHERE r."createdAt" >= (SELECT max("createdAt") FROM rolls) - interval '30 days';
-- ==== Q-AUD-03 · audit yaşı / arşiv (bilgi) ====
SELECT 'system_logs' AS t, min("createdAt")::date, max("createdAt")::date, count(*) FROM system_logs
UNION ALL SELECT 'system_log_archives', min("createdAt")::date, max("createdAt")::date, count(*) FROM system_log_archives;
-- ==== Q-AUD-05b · statüsü 2026-08-17+ CANCELLED olan top ama cancelledAt yok (gün kırılımı) ====
SELECT "statusChangedAt"::date AS gun, count(*) FILTER (WHERE "cancelledAt" IS NULL) AS damgasiz, count(*) AS toplam
FROM rolls WHERE status = 'CANCELLED' AND "statusChangedAt" >= '2026-08-17' GROUP BY 1 ORDER BY 1;

-- ==== Q-MD-01a · katlanmış ad mükerrerleri ; Q-MD-01b · sed index'leri var mı ====
SELECT 'customers' AS t, "nameFold", count(*) FROM customers WHERE "mergedIntoId" IS NULL GROUP BY 2 HAVING count(*) > 1
UNION ALL SELECT 'items', "nameFold", count(*) FROM items WHERE "mergedIntoId" IS NULL GROUP BY 2 HAVING count(*) > 1
UNION ALL SELECT 'subcontractors', "nameFold", count(*) FROM subcontractors WHERE "mergedIntoId" IS NULL GROUP BY 2 HAVING count(*) > 1
UNION ALL SELECT 'colors', public.tr_fold_color(name), count(*) FROM colors WHERE "mergedIntoId" IS NULL GROUP BY 2 HAVING count(*) > 1;
SELECT n FROM unnest(ARRAY['customers_nameFold_key','items_nameFold_key','subcontractors_nameFold_key','colors_nameFoldColor_key']) n
WHERE n NOT IN (SELECT indexname FROM pg_indexes WHERE schemaname = 'public');
-- ==== Q-MD-02 · tombstone'a referans ====
SELECT 'rolls→items' AS t, count(*) FROM rolls r JOIN items i ON i.id = r."itemId" WHERE i."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'order_lines→items', count(*) FROM order_lines ol JOIN items i ON i.id = ol."itemId" WHERE i."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'orders→customers', count(*) FROM orders o JOIN customers c ON c.id = o."customerId" WHERE c."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'rolls→colors', count(*) FROM rolls r JOIN colors c ON c.id = r."colorId" WHERE c."mergedIntoId" IS NOT NULL
UNION ALL SELECT 'dispatches→subcontractors', count(*) FROM subcontractor_dispatches d JOIN subcontractors s ON s.id = d."subcontractorId" WHERE s."mergedIntoId" IS NOT NULL;
-- ==== Q-MD-04a · kalite snapshot ≠ katalog kodu ; Q-MD-04b · final statü ≠ kalitenin hedef statüsü (bilgi) ====
SELECT r.id, r.barcode, r."qualityGrade", q.code FROM rolls r JOIN quality_grades q ON q.id = r."qualityGradeId" WHERE r."qualityGrade" IS DISTINCT FROM q.code;
SELECT q.code, q."targetStatus", r.status, count(*) FROM rolls r JOIN quality_grades q ON q.id = r."qualityGradeId" WHERE r.status IN ('WAREHOUSE','A1_STOCK','SCRAP') AND r.status <> q."targetStatus" GROUP BY 1,2,3;
-- ==== Q-MD-08 · istasyonsuz aktif özellik ; Q-MD-09 · sebep kataloğu kind başına aktif ====
SELECT fp.code FROM fabric_properties fp WHERE fp."isActive" AND NOT EXISTS (SELECT 1 FROM station_properties sp WHERE sp."propertyId" = fp.id);
SELECT kind, count(*) FILTER (WHERE "isActive") AS aktif, count(*) AS toplam FROM reason_presets GROUP BY 1;

-- ==== Q-YT-01 · SoD kodlarını taşıyan aktif kullanıcılar (maskeli) ; Q-YT-02 · etkin admin sayısı ; Q-YT-04 · çoklu aktif oturum (bilgi) ====
SELECT left(u.username,2) || '***' AS kullanici, string_agg(p.code, ',' ORDER BY p.code)
FROM users u JOIN user_permissions up ON up."userId" = u.id JOIN permissions p ON p.id = up."permissionId"
WHERE u."isActive" AND u."deletedAt" IS NULL AND p.code IN ('shipping:write','shipping:invoice','shipping:undo-dispatch','roll:manual-adjust','admin:*','admin:users')
GROUP BY u.id, u.username ORDER BY 1;
SELECT count(DISTINCT u.id) AS etkin_admin FROM users u JOIN user_permissions up ON up."userId" = u.id JOIN permissions p ON p.id = up."permissionId"
WHERE u."isActive" AND u."deletedAt" IS NULL AND p.code IN ('admin:users','admin:*')
  AND (up."validUntil" IS NULL OR up."validUntil" > now()) AND (up."validFrom" IS NULL OR up."validFrom" <= now());
SELECT left("userId"::text,8) AS kullanici, "deviceType", count(*) FROM sessions WHERE "revokedAt" IS NULL AND "expiresAt" > now() GROUP BY 1,2 HAVING count(*) > 1;
```

---

## HOTSPOTLAR

② denetçilerinin öncelikle bakması gereken yerler. Yargı yok; "neden bakılmalı" var. Sıra: veri kaybı/yanlış rakam potansiyeli önce.

| # | dosya:satır | INV | Neden bakılmalı |
|---|---|---|---|
| **H-1** | `Teks-Erp/src/services/inventory.service.ts:963-985` (`createInitialEntry` replay dalı) | INV-SYS-03, INV-STK-10 | Replay yalnız `itemId/colorId/initialQty` eşitliğine bakar, `existing.status`'e BAKMAZ: iptal/fire edilmiş topun `clientToken`'ı tekrar gelirse `success:true` + o topun barkodu döner (beceri §8 "en pahalı hata"). Aynı sözleşme `tambur-manual` (409 `ENTRY_CANCELLED`) ve fason kabulde (`subcontractor.service.ts:2354-2360`) uygulanmış. Saha: 227 CANCELLED/SCRAP top token taşıyor (Q-STK-10). Ölçüm: KK1'de token'lı giriş → iptal → aynı token replay. |
| **H-2** | `Teks-Erp/src/services/helpers/allocation.helper.ts:93-117` + `shipping.service.ts:1301-1353` (`computeSackAllocations` / `writeShipmentAllocationsTx`) | INV-SEV-02, INV-SEV-08 | `need = quantity − shippedQty` yalnız DISPATCHED'i düşer; iki PLANNED sevkiyat aynı satır için ihtiyacın tamamını iki kez tahsis eder ve her ikisi dispatch'te `shippedQty`'ye sayılır (fazla sevk hiçbir yerde engellenmez, `COMPLETED` toleransla). Bugün 0 (Q-SEV-08b) ama sevk onayı kapalı rejimde (sahada `confirmationEnabled=false`) PLANNED pencere kısa; onay açılırsa pencere büyür. K7a HOTSPOT #6 ile birlikte. |
| **H-3** | saha kayıtları `T080826F0017` (TAMBUR_MANUAL, `initialQty=0`, çocuk 20+0 m) ve `T080826F0020` (TAMBUR_SPLIT, `initialQty=0`, çocuk 33+6 m); kod: `tambur-undo.service.ts` MANUAL storno + yeniden kesim yolu | INV-STK-03, INV-AUD-05 | `TAMBUR_CONSUMED` parent `initialQty=0` iken tüketilmiş çocukları var ve OVERAGE defter satırı yok (Q-STK-03). 2026-08-08 tarihli (sapma defteri 08-09'da geldi) — "eski kalıntı mı, bugün de üretilebilir mi" sorusu ② için: `initialQty=0` yazan yol hangisi (`softDelete` MANUAL storno `qtyOut=0` mi, undo `restored` mi)? Aşımlı 34 parent'ın 32'si defterli. |
| **H-4** | `Teks-Erp/src/services/kursun-qc.service.ts:1124-1146` (`reopenStep` son-adım dalı) | INV-SM-01 | Claim `status in [WAREHOUSE, A1_STOCK, SCRAP]` → `IN_PRODUCTION`: **SCRAP (fire) topu üretime geri çeker**. CLAUDE.md 2026-08-25: "fire geri alınamaz"; fire sapma defteri (`RollVariance SCRAP`) terslenmez, `finalizedAt` trigger listesinde `SCRAP→IN_PRODUCTION` yok → fire karnesi + üretim damgası çelişir. failure_mode adayı: QC2 adımı yeniden açılınca fire edilmiş top rafa döner, fire raporu düşmez. |
| **H-5** | `rolls.cancelledAt/cancelledById/cancelReason` yazan yollar: `inventory.service.ts:3253-3262` (softDelete), `roll-disposition.helper.ts:223-231`, `hardDelete :3561-3568` (iz YAZMIYOR), `workorder-batch-drop`, mobil Depo "stoktan kaldır" | INV-AUD-04 | Saha: statüsü 2026-08-17+ CANCELLED olan 52 topun **47'si iptal damgası taşımıyor** (17.08: 15/16 · 18.08: 17/20 · 19.08: 7/7 · 20.08: 7/8). Kolon 2026-08-05'ten beri var. Ya deploy o günlerde eski koddu (SURUM-2.9.0 08-24/25) ya da bir iptal yolu izi yazmıyor (`hardDelete` :3561 açıkça yazmıyor). İz audit'ten okunmuyor (6 ay arşiv) → "neden iptal edildi" kalıcı olarak kaybolur. ② hangi yolun olduğunu `system_logs` (`tableName='ROLL'`, `action`) ile ayırsın. |
| **H-6** | `Teks-Erp/src/services/workorder.service.ts:5602-5719` (`updateTargetProperties`), `workorder-link.service.ts:279-342/:445` | INV-WO-01, INV-WO-08 | Plan değişikliği kilidi (`PLAN_CHANGE_FROZEN_STATUSES`) `update`/`replace`/`changeTargetColor`'da var, **hedef özellik yazımında yok**; tip flip statü guard'sız. COMPLETED/CANCELLED WO'nun hedef özellikleri ve bağlı topların FLAG özellikleri yeniden yazılabilir (K3a §6 #2, #19, #20). |
| **H-7** | `Teks-Erp/src/services/subcontractor.service.ts` kabul audit'i (makbuz kaydı), `tambur.service.ts` finalize audit'i (parent kaydı) | INV-AUD-01 | Son 30 günde doğan 2.391 topun 55'i için hiçbir `system_logs` satırı yok (33 fason dönüşü çocuğu, 22 Tambur çocuğu — Q-AUD-01b). Audit best-effort ve olay bazlı (bilinçli) ama "her CUD → SystemLog" kayıt düzeyinde tutmuyor; `entryReason` gibi künye kolonları bu boşluğu kapatıyor mu, ② AUD hücresinde değerlendirsin (bulgu değil, kapsam sorusu). |
| **H-8** | `Teks-Erp/src/services/return.service.ts:879-890` (`cancelReturn`) ↔ `shipping.service.ts:2159` (`undoDispatch` 8023) | INV-SEV-06 | İade iptali sevkiyat kapsam kilidini almaz ve sevkiyat statüsünü okumaz; storno ile yarışırsa top `SHIPPED, shipmentId=X` iken `Shipment X` PLANNED/CANCELLED olabilir (K3a §6 #15 ölçüm önerisi: storno ∥ cancelReturn paralel sonda). Saha bugün 0 (Q-SEV-06). |
| **H-9** | `Teks-Erp/src/services/order.service.ts:3411` (`reopen`), `:2537` (`update`) | INV-SEV-01, INV-SM-08 | `recomputeOrderStatus` tam-küme `touchOrderLinesTx` olmadan çağrılıyor; eşzamanlı dispatch recompute'u ile `shippedQty` lost-update (helper protokolü `order-status.helper.ts:203-211` bunu yasaklıyor). |
| **H-10** | `Teks-Erp/src/services/tambur-undo.service.ts:1221-1395, :1434-1692` | INV-SM-02, INV-STK-02 | WO satır-kilidi alınmadan `WorkOrderStep`+`work_orders` (COMPLETED→IN_PROGRESS) yazımı; `completeWorkOrderIfStepsDone` sözleşmesi (:190-191) karşılanmıyor; K3b H-1 ile aynı — K10 açısından: `currentQty ≤ initialQty` bump'ı da bu kilitsiz gövdede. |
| **H-11** | `Teks-Erp/src/services/batch.service.ts:126` (8022 sabit anahtar, tx kalanı boyunca) ↔ `workorder.service.ts:4553→4566` | INV-PAR-01/02 | Parti sayacı kilidi WO satır-kilidinden sonra alınıyor (ters sıra, K3b H-4 / K3a ABBA-1); parti doğuşu seyrek ama kilit sistem geneli tek anahtar. |
| **H-12** | `Teks-Erp/src/services/inventory.service.ts:3742-3783, :3866-3868` (`applyManualProperties`) | INV-YT-06, INV-STK-02 | Statü kapsamı pre-tx, claim yalnız `shipmentId/sackId` pin'ler; `currentQty/initialQty` kesilmiş topa yazılabilir → `currentQty ≤ initialQty` bekçisiz aşılabilir (K3a §6 #12). |
| **H-13** | `Teks-Erp/prisma/schema.prisma:2710` (`RollBarcodeCounter.day /// YYMMDD`) ↔ veri `240826` (GGAAYY) | INV-STK-09 | Yorum ↔ veri uyuşmazlığı (bilgi düzeyi): sayaç günü fabrika `GGAAYY` ile yazılıyor; yorum bayat. Yalnız `test_barcode_reservation.ts` doğru semantiği ölçüyorsa sorun değil — ② doğrulasın. |

---

## SINIR ÖTESİ NOTLAR

| Gözlem | Yönlendirme |
|---|---|
| `kursun-qc.reopenStep` SCRAP'ı üretime geri çekiyor (H-4) — Roll statü makinesi sahibi ÜRETİM/Tambur hücresi; fire karnesi ve `finalizedAt` trigger'ı ile çelişki | ② ÜRE (üretim/Tambur) + RAPOR hücresi (K7a) |
| `rolls.cancelledAt` iptal izinin 47/52 eksikliği (H-5) — hangi iptal yolu yazmıyor / deploy tarihi | ② ENV (envanter) + AUD hücresi; ops: canlı prod'da aynı sorgu (`Q-AUD-05b`) koşulmalı |
| Audit kayıt-düzeyi kapsama boşluğu (55/2.391 top, fason+Tambur çocukları) | ② AUD hücresi (K4 §2 RollOperation/`AuditService.logMany` tarafı) |
| `Order.cancelledAt` / `OrderLine.cancelledAt` saha kopyasında yok (5 migration uygulanmamış) → INV-SIP-02 ve Q-SM-08 dev varyantı yalnız dev'de ölçülebilir; deploy sonrası saha'da yeniden koşulmalı | Tur 2 / OPS (K2b §2.6 ile aynı) |
| `items_nameFold_key` sahada yok, `v-1430` mükerrer canlı (bilinçli "enforce bekliyor") | ② ANA VERİ hücresi (K5/K2b) — bulgu değil, ops kuyruğu (birleştirme + migration'ı yeniden koş) |
| SoD üçlüsü 6/8 masaüstü kullanıcıda (Q-YT-01) — tasarım ≠ atama | ② G/KIM hücresi (K5 H7) |
| Bir kullanıcıda 40 aktif MOBILE oturumu (Q-YT-04) — oturum politikası `off` mu, purge çalışmıyor mu | ② KIM hücresi; ops: `POST /api/admin/sessions/purge` |
| `workorder.service.ts:575-600` iş emri numarası tx AÇIKKEN havuz client'ından okunuyor (K3a L1) — sayaç sınıfı | ② CORE/ÜRE eşzamanlılık hücresi (K3a sahibi) |
| `shipping.service.ts:2610` tek `RepeatableRead` tx (brüt liste toplamı) — izolasyon seçimi belgeli, bulgu değil | bilgi (K3a) |
| `RollBarcodeCounter.day` yorum/veri uyuşmazlığı (H-13) | ② CORE (kod hijyeni) — düşük |
| `roll_variances` 2 defter-siz aşım (H-3) ve §13'ün 2 satırı veri düzeltmesi ister mi — iş kararı | Tur 2 veri düzeltme listesi (dry-run script'i ister; `prod_risk: yuksek`) |

---

## KAPSANMAYAN / ERİŞİLEMEYEN

| Madde | Sebep / durum |
|---|---|
| §7b, §7c, §12, §20, §24a, §25 saha koşumu | `consistency-check*.sql` ve `test_consistency.ts` §20 bu turda saha kopyasında **koşulmadı** (yalnız K10 sorguları koştu); Tur 2'de `psql -f` ile koşulacak — sorgular hazır, metin kopyalanmadı |
| INV-FAS-07 (LIFO), INV-PAR-05 (2.+ teslimat yeni parti) | Doğrulama sorgusu **yazılamaz** — kural tarihsel sıra/olay anına bağlı, mevcut satır durumundan türetilemez; yalnız bekçi (`test_fason_partial_receive.ts`) ölçer |
| INV-SM-01 tam geçiş matrisi (57 yazma sitesi) | K4 §2 listesinden ve 18 okunmuş yoldan derlendi; **tüm 57 site tek tek açılmadı** — `KARTELA_CONSUMED` diriltme yolu yok iddiası [VARSAYIM]; kapanış dispozisyonu / WO-close bekçi dosya adları doğrulanmadı [VARSAYIM] |
| `teks.audit_guard` GUC'unun prod'da açık olup olmadığı | restore edilen kopyada `pg_db_role_setting` taşınmaz; canlı prod'a erişim yok |
| Canlı prod ölçümü | Yalnız 2026-08-25 kopyası; 08-25 sonrası veri (2.9.0 deploy'undan sonraki 3 gün) görülmedi |
| Mobil/Electron istemci tarafı değişmezleri (token yapışma kuralı `mobil/src/offline/entryAttempt.ts`, `scanClassify`, `resolveReturns` büyük-toptan dağıtım) | Backend denetimi kapsamı; yalnız backend'e vardığı noktada anıldı (INV-SYS-03, INV-FAS-06 J19) |
| Kartela (Swatch) alanı değişmezleri (stok düşüm idempotency, AT_KARTELA↔çuval) | Yalnız INV-SM-01 kenarları + §7b/§7c ile kapsandı; `kartela.service.ts` ayrı satır satır haritalanmadı — K3b §1.6 |
| İçe aktarım (`ImportRun`) ve belge şablonu/etiket stüdyosu değişmezleri | Bu dosyanın alanı dışında (K5/K3b); yalnız `clientToken` ve FAIL-CLOSED etiket kuralı anıldı |
| Ölçüm doğruluğu: Q-SM-08 (sipariş statüsü türetimi) | `PENDING` siparişler için "recompute hiç koşmamış" varsayımı ile muaf tutuldu; tolerans `system_settings`'te yoksa 5 kabul edildi (`system-setting.service.ts` varsayılanı doğrulanmadı [VARSAYIM]) |
| Q-AUD-01b yorumu | "Olay bazlı audit" açıklaması [VARSAYIM] — hangi audit çağrısının hangi `recordId`'yi yazdığı (`AuditService.logMany`) okunmadı |
| Bekçi negatif sonda doğrulaması | Bu turda hiçbir bekçi koşturulmadı/kırılmadı (salt-okunur keşif); "bekçi var" iddiaları dosya varlığı + CLAUDE.md beyanına dayanır |
