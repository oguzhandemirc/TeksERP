# Tutarlılık Taraması — "Türetilmiş alan / ayrışan yüzey" hata sınıfı (2026-08-21)

**Tetik:** `WorkOrder.type` sonradan bağlanan siparişte STOK kalıyordu (74d92085). Aynı sınıftan
("saklanan ama türetilen alan bir yazma yolunda güncellenir, diğerinde unutulur; aynı gerçek farklı
ekranlarda farklı kaynaktan okunur") başka hata var mı diye üç yolla tarandı:
**A** kod envanteri (3 ajan: WO/adım/kart · top/sipariş/sevkiyat · fason/kartela/sapma),
**B** veri kanıtı (saha yedeği `tekserp_saha`, bugün 11:40'a kadar taze; `test_consistency` §1-§20 + 20 ek SQL),
**C** yüzey kıyası (2 ajan: Electron WO/sipariş · mobil + envanter/sevkiyat). Salt-okunur; hiçbir dosya değişmedi.

## 1) Kesin kod hataları (kanıtlı, dosya:satır)

| # | Bulgu | Etki | Saha verisi | Düzeltme |
|---|---|---|---|---|
| K1 | **Fason "açık+outstanding sevk" koşulu 18 yerde elle kopya; 5'inde `directShippedAt IS NULL` ve `receipt.cancelledAt IS NULL` süzgeçleri YOK** — `workorder.service.ts:1426` (Fason Sevk picker `excludeWithOpenDispatch`), `:3131` (WO iptalinde açık sevkleri kapatma), `traveler-card.service.ts:761` (mobil "açık sevk var" uyarısı), `workorder-fason-quick.service.ts:94,104` (Hızlı Kabul grupları). Kanonik tanım `helpers/batch-dispatch-surgery.helper.ts:64-68` (`OPEN_OUTSTANDING`), export edilmiyor. | Kabul iptali (LIFO) sonrası sevk "kapalı" sanılır → WO Fason Sevk listesine düşmez, WO iptalinde aktif sevk sahipsiz kalır, Hızlı Kabul'de grup kaybolur. Tam doğrudan-sevk sonrası "açık" sanılır → Hızlı Kabul'de hayalet grup (kabul 409). | 0 satır — sahada henüz kabul iptali (0) ve doğrudan sevk (0) olmamış; tetiklenmeyi bekleyen hata | `OPEN_OUTSTANDING`'i export et, 5 yerde kullan; mekanik bekçi: servislerde `receiptItems: { none: { isPartial: false } }` kalıbının yalnız kanonik sabitte geçmesi |
| K2 | **`repointRollsTx` (WO devri + Tebdil/split) 6 tabloyu yeni adıma taşıyor, `KursunBypassAssignment`'ı TAŞIMIYOR** — `helpers/workorder-clone.helper.ts:202-235`; çağıranlar `workorder.service.ts:4071`, `workorder-split.service.ts:472,651`; `supersedeEmptiedSourceWorkOrderTx` (`workorder-split.service.ts:266-291`) bypass temizliği çağırmıyor | TRANSFER'da aynı tx'in sonundaki force-void atamayı iptal eder → makine atfı kaybolur, Tambur "dağıtılmadan kapanış" yoluna düşer (hacim raporu eksik). Tebdil/split'te SUPERSEDED WO'da kalıcı öksüz atama. | 0 satır (bypass sahada yeni) | `repointRollsTx`'e `kursunBypassAssignment.updateMany({workOrderStepId, workOrderId})` ekle; supersede'de `voidStalePendingBypassAssignmentsTx(force)` |
| K3 | **Kartelalık işareti değişince `Roll.labelDirty` yazılmıyor** — `kartela.service.ts:1206-1209`; etikette `kartelaMark` basılıyor (`config/label-fields.ts:86`, `label-field-values.ts:97`) | İşaret sonradan konan/kaldırılan topun etiketi bayat ama "yeniden bas" uyarısı yok | 10 aday top (işaretli + etiketi basılmış + dirty=false) | `update`'e `labelDirty: true` (yalnız `labelPrintedAt` doluysa) |
| K4 | **Sipariş iptali (`order.service.ts:2373,2734` `workOrderToOrderLine.deleteMany`) `markTravelerCardDirtyTx` çağırmıyor** — kardeş yol `workorder-link.service` link/unlink'te çağırıyor | Kart "güncel değil" rozeti yanmaz (kâğıt yine doğru basılır — içerik baskıda canlı) | — | iki silme noktasından sonra `markTravelerCardDirtyTx` |
| K5 | **Electron `TravelerCardPrintDialog.tsx:118` ölü anahtar invalidate ediyor** (`["work-order", id]`; tüketen sorgu yok — gerçek anahtar `["work-order-detail", id]`). Aynı hata `LinkOrderDialog`'da 08-17'de düzeltilmişti | Baskı sonrası WO detayı (kart sürümü/geçmişi) tazelenmez | — | anahtarı düzelt |
| K6 | **Electron `BranchLanes.tsx` parti birleştirme `["work-orders"]` listesini tazelemiyor** (transfer tazeliyor, `:164-166` vs `:180-182`) | Listede "Parti" sütunu eski sayıyı gösterir | — | invalidate ekle |

## 2) Karar gerektiren ayrışmalar (kod "çalışıyor", tanım farklı)

| # | Bulgu | Seçenekler |
|---|---|---|
| D1 | **"Üretilen metraj" liste ≠ detay:** liste `producedMeters` FIRE **ve A1** hariç (`workorder.service.ts:1732-1766`); detay `producedRolls.totalMeters` = WAREHOUSE + **A1** (`:2107-2109`). Saha: A1 çıktısı olan **19 iş emri** iki ekranda farklı rakam. A1 satılabilir kalite (CLAUDE.md). | (a) liste de A1 saysın (önerilen — tek tanım `producedOutputWhere`'e taşınır) · (b) detay A1'i ayrı göstersin · (c) kalsın |
| D2 | **`Sack.labelDirty` yalnız müşteri/şablon değişiminde işaretleniyor** (şema notu bilinçli dar); çuvala top ekle/çıkar, kartela ekle, not yaz (`shipping.service.ts:476-665,1672`) etiketi bayatlatmıyor — etikette top adedi/metraj/kg/not basılıyor | (a) içerik/kg/not değişince de `labelDirty=true` (resetSackWeightsTx + setSackNotes) · (b) kalsın (operatör zaten çuval kapanınca basıyor) |

## 3) Düşük / kozmetik
- `getCompletePreview.orderLinked = _count.orderLinks > 0` — `type` kolonundan bağımsız ikinci kaynak (`workorder.service.ts:3649`); bugün eşit, bekçisiz.
- Mobil Tambur: sipariş rozeti iki ayrı sorgudan (`/tambur/context` + `getById.orderLinks`), senkron elle çift invalidation'a bağlı (`TamburOrderLinkSheet.tsx:160-166`).
- Electron `RollDetailSheet.tsx` üst blok (durum/metraj/renk) liste satırı prop'undan, alt blok taze `detail`'den — sheet açıkken değişirse iki "gerçek".
- `quantity − shippedQty` Electron'da 3 bağımsız kopya (`columns.tsx:268`, `OrderDetailSheet.tsx:44`, `BulkCreateWorkOrderAction.tsx:29`).
- Fason Kabul grup başlığındaki `workOrder.batchNumber` alanı aslında İş Emri No (`subcontractor.service.ts:3791` legacy ad) — görünür etiket yok, adlandırma tuzağı.
- Legacy `DELETE /api/orders/:id` (`softDelete`) yalnız PLANNED WO bağını temizliyor; Electron/mobil çağırmıyor — kapatılabilir.
- Kurşun bypass "N iş bekliyor" sayacı adımı kapanmış (stale) atamayı da sayar (`getVisibility`); ekranda "atama anlamsız" rozeti zaten var.
- `cloneWorkOrderTx orderMode:"keep"` iki WO'yu aynı sipariş satırına bağlar; hiçbir çağıran/test kullanmıyor.
- `Order.changeLineColor` (bugün eklendi) bağlı WO'ya uyumsuzluk uyarısı/kart bayrağı üretmiyor (ters yön üretiyor).

## 4) Bekçi eksikleri — tekrarı önleyecek en ucuz yatırım
`test_consistency.ts`'e eklenmesi önerilen bölümler (hepsi saha yedeğinde bugün **0 satır**, yani temiz doğarlar):
§21 `WO.type` ↔ bağ (STOK ama bağ var / SİPARİŞ ama bağ yok) · §22 `WO.status=IN_PROGRESS` ama tüm adımlar COMPLETED/SKIPPED · §23 açık kurşun bypass ataması + terminal WO · §24 fason açık-sevk predikatı (LIFO-iptal ve doğrudan-sevk SQL'leri) · §25 kartelalık işaretli + etiketi işaretten sonra basılmamış top (audit'li) · §26 (bilgi) depoda top rengi ≠ üretildiği WO hedefi ve sapma kaydı yok.
Ek: servis katmanında `receiptItems: { none: { isPartial: false } }` kalıbını kanonik sabit dışında yasaklayan AST bekçisi.

## 5) Saha yedeği veri bulguları (kod hatası değil, düzeltme kararı)
- `IE1008260014`: 4 top depoda **EKRU**, plan **55-BEYAZ** (17 Ağustos, plan kapısından önce), sapma kaydı yok — bugünkü "Tümünü seç" düzeltmesinin sahadaki ilk adayı (WO tamamlandıysa top bazında Düzelt).
- Depoda (WAREHOUSE) **FIRE** kaliteli 4 top (`T150826F0009/0011`, `T170826F0017`, `T190826F0035`) — "fire çöpe gider" düzeltmesinden önce; sevk edilebilir durumda → dry-run script ile SCRAP'a.
- Fason dönüşü 2 topta `currentQty > initialQty` (492→698,9; 500→520,5; 08-08, 08-14) — metraj düzeltmesi giriş metrajını güncellemiyor; bekçi §13 kırmızı.
- Mükerrer master-data: `bgr 150 şeffaf` (items ×2), `1195-gri`, `altın-ekru` (colors ×2) → mükerrer birleştirme aracı.
- `SIP1008260052` COMPLETED ama 2 m açık (manuel kapatma/tolerans — sorun değil).
- `WorkOrder.type` backfill: `fix_workorder_type_from_links.ts --apply` prod'da hâlâ bekliyor (13 kayıt).

## 6) Temiz çıkanlar
`WorkOrderStep.status` (§20 var) · `Batch.mergedIntoId` · `OrderLine/Order.shippedQty` (§1/§2) · `Roll↔Sack↔Shipment` (DB FK) · `Roll.form` · kartela dispatch/receipt · fason karnesi SQL'i · `Sack.weightKg` reset zinciri · Electron sevkiyat/etiket/sipariş rozetleri (paylaşılan `deriveWoRollup`) · WO.type (bugünkü düzeltme 4 yazma yolunda simetrik).

## 7) UYGULAMA DURUMU (2026-08-21 akşam)
Kullanıcı kararları: A1 her iki ekranda sayılır · çuval etiketi içerik/kg/not değişince bayat · küçük maddeler dahil · veri düzeltmeleri bu turda YOK. Kodlama 4 Opus ajanı (dosya-bazlı paylaşım) + bütünleşik doğrulama.
| # | Durum | Nerede |
|---|---|---|
| K1 | ✅ tek kaynak `helpers/fason-open-dispatch.helper.ts`, 22 site, AST bekçisi + davranış testi | `test_fason_open_dispatch_single_source` 13 · `_semantics` 18 |
| K2 | ✅ `repointPendingBypassAssignmentsTx` (TRANSFER) + split void'leri | `test_kursun_bypass_repoint` 27 |
| K3 | ✅ kartelalık toggle → `labelDirty` (basılmışsa, iki yön) | `test_label_dirty_sources` 18 |
| K4 | ✅ sipariş iptali → kart bayat; legacy softDelete tam temizlik + tip aynası | `test_order_cancel_card_dirty` 20 |
| K5/K6 | ✅ Electron ölü anahtar + liste tazeleme | typecheck + vitest 128 |
| D1 | ✅ üretilen = 1.kalite+A1, kova katalogdan (`loadProducedBuckets`) | `test_produced_buckets` 19 |
| D2 | ✅ `markSackContentChangedTx` + şablon-koşullu not; repair script kopyası | `test_label_dirty_sources`, `test_sack_split_and_relabel` 23 |
| Küçük | ✅ orderLinked→type · RollDetailSheet `detail ?? roll` · `lineOpen` · mobil yorum | — |
| Bekçi | ✅ `consistency-check-derived.sql` + `test_consistency_derived.ts` §21-§26 (+`--probe`) | saha: §21-§25 0, §26 ℹ 4 |
Negatif sondalar: 25 (hepsi kırmızı verdi, geri yüklendi). Migration/izin/APK yok. Davranış değişikliği: kabul iptali sonrası WO Fason Sevk listesinden gizlenir; doğrudan-sevk edilmiş kardeş sevk adımı ACTIVE tutmaz.
Açık: saha verisi düzeltmeleri (§5) ayrı gün; `test_consistency.ts` ana dosyasına §21-§26'nın taşınması (eşzamanlı oturum düzenliyordu).
