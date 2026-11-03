# Top düzeltme · İptal · Fire · Geri alma
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/top-duzeltme.md`.

> Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Silme yalnız soft: `isActive:false` ya da `RollStatus.CANCELLED`; fiziksel DELETE ASLA. İstisnalar: § Doğrulama turu ekleri.
- **[ÇEKİRDEK]** İptal ≠ Fire: İptal=`CANCELLED` "hiç olmamalıydı" — stok düşmez, açık hareket `qtyOut=0`, fire raporuna girmez. Fire=`SCRAP` "vardı, gitti" — stok düşer, `qtyOut=qtyIn`, fire oranına girer; uç `POST /rolls/:id/scrap`, izin `roll:manual-adjust` (`roll:write` yetmez).
- **[ÇEKİRDEK]** İptal edilmiş topun `clientToken`'ı replay edilemez → 409 `ENTRY_CANCELLED` (`assertRollReplayAlive`); yeni top yeni token ister.
- **[ÇEKİRDEK]** İptali geri almada TEK yüklem `resolveRollRestoreBlockReason` (ekran+uç aynı). Sinyaller: CANCELLED · hareket yok · istasyon işlemi yok · çocuk yok · adıma bağlı değil · çuval/sevk yok · fason/kartela sevki yok · Tambur geri alma ürünü değil. `batchId` ENGEL DEĞİL.
- **[ÇEKİRDEK]** Yıkıcı işlemde (iptal/sil/fire) backend cancel-preview döner; arayüz etkilenen HER kaydı adıyla listeler, kayıt bazlı seçim sunar. Engelli top denenmez, engel backend cümlesiyle basılır; izinsiz şık (fire) ÇİZİLMEZ.
- **[ÇEKİRDEK]** Giriş/iptal sebebini KOLONDAN oku (`Roll.entryReason`/`entryReasonCode`, `cancelReason`/`cancelReasonCode`; metin görünen kayıt, kod rapor anahtarı); audit yazımı kalır, kolon boşsa eski kayıtta audit'e düş.
- **[ÇEKİRDEK]** Tambur geri alma DÖRT mod: SINGLE · SINGLE_RESTORE "İş Emrine Geri Al" (tek top dirilir; kardeşe/kapanış sapmasına dokunmaz; RollError yok; `TAMBUR_PROCESSED` silinir; ek izin yok) · FULL (`roll:manual-adjust` + sebep) · MANUAL.
- **[ÇEKİRDEK]** Kesim yalnız `currentQty` düşürür, `initialQty`ye DOKUNMA; geri alma `currentQty`'yi geri koyar, `initialQty`yi yalnız aşımda yükseltir (`initialBump = max(0, yeniCurrent − initial)`); aşım kesimde ebeveyne `TAMBUR_OVERCUT` (`sourceRollId`), bump sapması yalnız karşılanmayan kısma.
- **[ÇEKİRDEK]** SENKRON: restore toplamına giren HER kaynak (`computeRestoredQty`, çocuk-kapsamlı `TAMBUR_UNDO_SINGLE` dahil) applyFull 5b terslemesine de eklenir; sıfır-çocuk + restored>0 → FULL çalışır (F0402).
- **[ÇEKİRDEK]** WO kapatma = kapanış dispozisyonu, "işlemde top var" diye reddetmez; kalan her top için altı karar: STOCK ("Stoğa geri") · WAREHOUSE · A1_STOCK · SCRAP · CANCELLED · TRANSFER (yeni WO klonu; kaynak COMPLETED kalır, SUPERSEDED olmaz). `Roll.form`a dokunma.
- **[ÇEKİRDEK]** Kapanışta hard-block yalnız FASON (AT_SUBCONTRACTOR/RETURNED_FROM_SUBCONTRACTOR ya da açık fason sevki; fason dönüşü STOCK'a çekilemez); kapsam BİREBİR (taze in-flight küme ≠ gönderilen liste → 400); dispozisyonda `workorder:write` + `roll:manual-adjust`.
- **[ÇEKİRDEK]** Kapanışta kaliteyi yalnız WAREHOUSE/A1_STOCK dispozisyonunda sor; varsayılan opsiyonel, `quality.gradeRequiredEnabled` açıkken kalitesiz top 400 `GRADE_REQUIRED`. Satılabilir statüye çekilen barkodsuz top barkod alır.
- **[ÇEKİRDEK]** Kapanış izi: movement `notes='WO_CLOSE_<ACTION>'` + audit `WO_CLOSE_DISPOSITION`; `RollOperationType`a değer ekleme. "Kurtar" (`rescueStuckRoll`, `roll:manual-adjust`) takılı topu WAREHOUSE'a çeker (`qtyOut=qtyIn`, barkod üretir). "Durum Düzelt"/recover-to-production KALKTI.
- **[ÇEKİRDEK]** Top düzeltme TEK sözleşme, kapsam topun DURUMUNDAN: ALWAYS_BLOCKED (fason/kartela/emekli/sevk) red · FREE_STOCK (STOCK/WAREHOUSE/A1_STOCK) sebep opsiyonel · gerisi sebep ZORUNLU + `roll:manual-adjust`. Kapsamı `Boolean(reason)` ile genişletme.
- **[PROFİL]** `production.cancelReasonRequired` (varsayılan KAPALI; etkin `resolveCancelReasonRequired`) yalnız top iptalini (`DELETE /rolls/:id`) kapsar; kapı TEK `helpers/cancel-reason.helper.ts` `assertCancelReasonTx` (`inventory.service.softDelete`, fire hariç) → 400 `CANCEL_REASON_REQUIRED`.
- **[PROFİL]** Her iptal önizlemesi `reasonRequired: boolean` döner (top: bayrak · levent sarım/fason makbuz: true); istemci alanı bundan zorunlu işaretler, bayrağı tahmin etmez; alan yoksa opsiyonel sayar.
- **[ÇEKİRDEK]** Manuel taşıma ("Konumu Düzelt"): top IN_PRODUCTION + `currentStepId`=hedef, hedef adım ACTIVE, COMPLETED WO IN_PROGRESS'e dirilir, kart aktif. Geri taşımada hedef-sonrası kalite/kurşun VOID (grade → Belirsiz), hayalet movement silinir, SKIPPED→PENDING.
- **[ÇEKİRDEK]** Fason adımına manuel taşıma AT_SUBCONTRACTOR yapmaz — çıkış Fason Sevk ile. Fason dönüşü top (`entrySource=SUBCONTRACTOR_RETURN`) yeniden sevk+kabul edilebilir.
- **[ÇEKİRDEK]** Kat (`Roll.foldType`) kalıcı kolondur, MİRAS ALINMAZ: kesimde seçilen yazılır; kanoniklik ZORUNLU (`normalizeFoldType`); beş yazma yolu aynı kural.

### Yasaklar

- **[ÇEKİRDEK]** İkinci iptal motoru yazma: tüm iptal/fire yolları `InventoryService.softDelete(mode CANCEL|SCRAP)`'ten geçer (`TamburUndoService.MANUAL` dahil). Hareket notunu ezme: `'CANCELLED (<eski not>)'` / `'SCRAPPED (…)'`.
- **[ÇEKİRDEK]** CANCELLED/SUPERSEDED iş emrinde manuel taşımayı reddet (409 + önizlemede `woBlocked`); tek kaynak `manualMoveWoBlockReason`; doğru yol topu yeni iş emrine bağlamak.

### Reçeteler

- **[ÇEKİRDEK]** Toplu veri düzeltme script'i DRY-RUN varsayılan, `--apply` öncesi her kaydı somut listeler (`backfill_roll_fold_and_reason` · `fix_tambur_undo_cancel_marker` emsali); geri alma yolu raporda basılır.

### Kararlar

- **[ÇEKİRDEK]** Tambur geri alması iptal ettiği parçanın satırına `cancelReasonCode=TAMBUR_GERI_ALMA` (sistem kodu, seçicide çıkmaz) + `currentQty=0` yazar (`initialQty` korunur); kapı audit'e BAKMAZ.
- **[ÇEKİRDEK]** Elle metraj düzeltmesi (`PATCH /rolls/:id/qty`, `roll:manual-adjust`) stok defterine de yazar: `eventType ADJUST`, `reasonCode MANUAL_ADJUST`, `rollVarianceId` ile bağlı; deposuz top satır almaz. Geri alma yolu YOK: ters düzeltme yeni olgudur (`KARSI_OLAY = MANUAL_ADJUST`).
- **[ÇEKİRDEK]** FULL geri alma kapanış sapmasını damgalarken `rollVarianceId` bağlı stok çıkışını da `TAMBUR_UNDO` ile tersler; kapanışın `scrap` kalanına yalnız FULL (409 `UNDO_SCRAP_REMAINDER_FULL_ONLY`); SINGLE_RESTORE kapanış sapmasına ve bağlı çıkışa dokunmaz.
- **[ÇEKİRDEK]** `fix_tambur_undo_cancel_marker.ts` (dry-run varsayılan) eski parçalara izi satıra taşır; kullanıcı kararıyla bekler, metrajı sıfırlamaz.
- **[ÇEKİRDEK]** `rolls_qty_le_initial` ihlalini 2.15.13 geçişinde kullanıcı onarır: yedek → `fix_tambur_undo_full_asim.ts` teşhis (2 değilse DUR) → `--apply --onay=2 --hedef=<db>` → `convalidated=t` → `unvalidatedConstraints` boş (`docs/ops/DEPLOY-RUNBOOK.md` §3e); oturum dokunmaz.
- **[ÇEKİRDEK]** Ölü etiket onayı KAPI DEĞİL: `confirmLabelPrinted` kabul edilir ama yol açmaz; `labelPrintedAt` baskıda otomatik. 409'u geri koyma. Yeniden-üretime-al'daki ölü etiket UYARISI ayrıdır.
- **[ÇEKİRDEK]** Mutabakat kırmızısı üç şeydir: kod hatası (§13) · iş kararı bekleyen veri (§18) · sorgu kör noktası (§20); eski sapmayı toplu UPDATE ile düzeltme, §13'ü DARALTMA.

## Backend

### Değişmezler

- **[ÇEKİRDEK]** MANUAL geri alma DAR: yalnız elle eklenmiş + hiç işlem görmemiş top (`MANUAL_UNDOABLE_STATUSES`; kesilmemiş, RollOperation yok, tek hareket, çuval/sevk yok); ihlalde blockReason. Parti bağı kalır. Ekleyen geri alır (`mobile:tambur-duzelt`).
- **[ÇEKİRDEK]** Elle eklenen top partisiz doğmaz: tek açık parti → bağla · çok → 400 `BATCH_REQUIRED` + seçenek listesi · hiç → NULL. "Açık" = canlı top (`K18_DEAD_STATUSES`); SCRAP partiyi kapatmaz. Sıra: payload tutarlılığı önce, parti sonra.

### Tuzaklar

- **[ÇEKİRDEK]** Geri alma rafı `preCancelStatus`'tan (`resolveRestoreTargetStatus`); NULL → STOCK. Geri alma iptal izi kolonlarını temizler (geçmiş audit `CANCEL_RESTORED`, açık iş kararı). Mesaj `entrySource`'a bakar.
- **[ÇEKİRDEK]** `restoreCancelledRoll` tx açmaz, recompute koşmaz (guard hareketli topu reddeder); guard gevşetilirse recompute EKLENMEK ZORUNDA.

## Panel (Electron)

### Değişmezler

- **[ÇEKİRDEK]** `roll:history` izni yoksa top detayındaki yaşam döngüsü bölümünü HİÇ çizme. RollOperation istasyon işlem log'udur; geçmiş `GET /rolls/:id/history`'den.

### Tuzaklar

- **[PROFİL]** Sayfa içi arama (Ctrl+F / findInPage) kaldırıldı — sunucu araması kullan. Yeniden denenirse: `findNext` "YENİ OTURUM BAŞLAT" demektir.

### Kararlar

- **[ÇEKİRDEK]** Top Arşivi (`/system/roll-archive`, `admin:settings`) CANCELLED+SCRAP'ı da listeler; "Kayıt Türü" daraltması `statusIn` anahtarıdır (`status` değil).
- **[ÇEKİRDEK]** İki buton: "Düzelt" (`RollEditDialog` — rollId + `GET /api/rolls/:id/relabel-context`) · "Etiket" (önizle/bas/farklı müşteri). `RelabelDialog` ve `ManualAttributesDialog` geri gelmez.

## Geçersiz kılınan kurallar — bunlara UYMA

- 409 `LABEL_PRINTED` + `confirmLabelPrinted` onay kapısı kaldırıldı.
- İptali geri almada "partiye kayıtlı (`batchId`) → red" kaldırıldı.
- Top Arşivi dört statüden altıya çıktı (CANCELLED + SCRAP).
- "Stoktan Kaldır" tek tuşu → İptal / Fire ikilisi; genel X tuşu YASAK aynen.
- Elle top sebep kataloğu kod (`manualReasons.ts`) → DB (`ReasonPreset`); `manualReasons.ts` yalnız APK zemini.
- "Kod saklanmaz" → `entryReasonCode`/`cancelReasonCode` var, kodu sunucu türetir (`resolveReasonCode`).
- Kapanışta kalite "opsiyonel" → varsayılan opsiyonel, bayrakla zorunlu.
- Dispozisyon etiketi "Ham stok" → "Stoğa geri".
- PROCESS_QC kalite notu YAZMAZ; kalite KK1 girişi + Tambur finalize'da doğar.
- "Kalan beş kural" → altıncı sinyal: `TAMBUR_GERI_ALMA` parçası diriltilemez.

## Çözülmüş çelişkiler

- Geri alma kolonları temizliyor ↔ "sebep kolondan okunur": karar verilene dek açık.
- "Fire geri alınamaz" yalnız elle fire (`POST /rolls/:id/scrap`, `restoreCancelledRoll`) içindir; Tambur SCRAP çocuğu kesim geri alınınca iptal edilir.

## Açık sorular

- Altıncı geri alma sinyali için not/dizin satırı yazılmalı; `fix_tambur_undo_cancel_marker.ts` kullanıcı kararı bekliyor.
- `restoreCancelledRoll` iz kolonlarını NULL'lama kararı yok.
- `preCancelStatus` NULL eski iptallerde geri alma STOCK'a döner; ayrı karar bekliyor.
- Bayat kod yorumları: `inventory.service.ts` confirmLabelPrinted bloğu; `roll-cancel-restore.helper.ts` batchId yorumu.
- "Fire geri alınamaz" cümlesi "elle fire" diye daraltılmalı.
- `test_consistency` §20 süzgeci eklenmedi.
- Küme dışı üyeler kendi kümelerinde hakemlenmeli.
- WO kapanış dispozisyonu ve elle-top parti bağı için adlı bekçi belirsiz.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[ÇEKİRDEK]** Barkod topun KİMLİĞİDİR, statü işareti değil; erken doğması sorun değildir.
- **[ÇEKİRDEK]** Top düzeltme audit ayrımı: `reason` varsa olay `MANUAL_ATTRIBUTE`, yoksa `RELABEL`; tablo `ROLL_MANUAL_OVERRIDE`.
- **[ÇEKİRDEK]** Soft delete'in bilinçli istisnaları: master-data `DELETE /:id/permanent`, boş çuval silme, cihaz unpair, pivot replace (`ItemPrice` istisna DEĞİL, damgalı sürüm).

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_audit_p0`⚠️, `test_batch_drop`, `test_cancel_reason_required`, `test_depo_roll_cancel_permission`⚠️, `test_duplicate_rolls`, `test_fason_partial_receive`, `test_fason_receive_cancel_rereceive`, `test_fason_undo_transfer`⚠️, `test_fason_wrong_station_guidance`, `test_fold_catalog`, `test_fold_edit_and_label`, `test_hide_cancelled_lists`, `test_iade_enhancements`, `test_manual_attributes_reason`⚠️, `test_manual_props_claim_pin`, `test_manual_roll_undo`, `test_masterdata_guards`, `test_order_cancellation`, `test_order_line_cancel`, `test_p2_inventory`, `test_phase3_stok_hardening`, `test_property_value_selection`, `test_roll_property_revoke`, `test_reason_presets`, `test_rescue_stuck`, `test_roll_cancel_step_recompute`, `test_roll_cancel_undo`⚠️, `test_roll_edit_unified`, `test_roll_fold_and_reason`, `test_roll_qty_adjust`, `test_roll_relabel`, `test_roll_relabel_context`, `test_roll_variance`, `test_scrap_grade_label`, `test_scrap_scorecard`, `test_shipment_undo_dispatch`, `test_stock_count`, `test_tambur_cut_barcoded`, `test_tambur_manual_field`, `test_tambur_undo`, `test_token_replay_cancelled`, `test_warehouse_ledger`, `test_wo_cancel_disposition`, `test_wo_cancel_fason`, `test_wo_manual_complete`, `test_stock_ledger_tambur_undo`, `test_consistency`, `test_stok_defteri_bag_olcumu`, `test_tambur_undo_marker_backfill`, `test_manual_move`, `test_tambur_manual_batch`, `test_route_auth_coverage`

İstemci: `RelabelStation.test.tsx`, `BulkCancelRollsDialog.test.tsx`, `ReworkRollsDialog.test.tsx`, `qtyAdjust.test.ts`, `service.test.ts`, `tabs-regime.test.ts`, `WorkOrderCompleteDialog.test.tsx`, `cancelDecisions.test.ts`, `activity-utils.test.ts`, `RollCancelModal.test.tsx`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

Arşiv not listesi: `docs/kurallar/ayrinti/top-duzeltme.md` § Arşiv notları.
