# Bekçi haritası — DİZİN (alan → dosya)

> **Harita alan başına bölündü (2026-11-03):** satırlar `Teks-Erp/docs/bekci-harita/<alan>.md` dosyalarında; bu dosya yalnız dizindir (≤ 10 KB) — bütün haritayı okuma, alanın dosyasını aç. Bölmeden önceki tek dosya (1,6 MB) git geçmişinde; bölmede `(bu commit)` işaretli ✓B hücreleri o anki blame sha'sıyla yazıldı.
>
> - **Elle bakımlı** — üretici betik YOK. Yeni bekçi satırı YALNIZ kendi alan dosyasına eklenir (çakışma kuralı); yeni alan = yeni dosya + bu dizine `## <alan>` başlığı ve bağlantısı (`test_identity_ledger` dizin ↔ dosya tazeliğini ölçer).
> - **Erişim:** `grep -rn "<servis/konu>" Teks-Erp/docs/bekci-harita/` ya da `Teks-Erp/docs/bekci-harita/<alan>.md`. Büyük dosyalar (lisans · diger · surum-deploy · dokuma · patron-bulutu) de bütün okunmaz — grep ile girilir.
> - **Koşma:** backend tek bekçi `cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>`; tam paket CI'da. Electron `cd Electron && npx vitest run <yol>`; mobil `cd mobil && npx jest <yol>`. Port bekçileri: `bekci-harita/bilerek-kirmizi.md` § Nasıl koşulur.
> - **Satır biçimi:** `| Dosya | Ne ölçüyor | DB | Negatif sonda | |`. "Negatif sonda" hücresi SINIF + SAYI taşır: `✓K<n>` kalıcı sonda · `✓B<n>` bir kezlik + sha ya da `(bu commit)` (sha blame'den türer) — `test_harita_sonda_atfi` ölçer. ⚠️ = bayatlık şüphesi.
> - **Özet satırı zorunlu:** bekçi `=== Sonuç: N geçti, M başarısız ===` basmadan çıkış 0 verirse koşucu KIRMIZI sayar; büyük çıktılı bekçi `process.exitCode` ile biter.
> - **Sayı YAZILMAZ** — güncel dağılım: `grep -c "^| .Teks-Erp/scripts/" Teks-Erp/docs/bekci-harita/*.md`.

## bilerek-kirmizi — (bekçi × VERİ) listesi

[bekci-harita/bilerek-kirmizi.md](bekci-harita/bilerek-kirmizi.md)

## yetki-izin

[bekci-harita/yetki-izin.md](bekci-harita/yetki-izin.md)

## is-emri

[bekci-harita/is-emri.md](bekci-harita/is-emri.md)

## ui-bilesen

[bekci-harita/ui-bilesen.md](bekci-harita/ui-bilesen.md)

## fason

[bekci-harita/fason.md](bekci-harita/fason.md)

## diger

[bekci-harita/diger.md](bekci-harita/diger.md)

## sevkiyat

| Dosya | Ne ölçüyor | DB | Negatif sonda | |
|---|---|---|---|---|
| `Teks-Erp/scripts/test_sevke_hazir.ts` | Sevke hazır işler (D4-J1): hazırlık TEK yüklem `ship-readiness.helper` — her RollStatus tek sınıfta, canlı dışı = K18 ∪ RETURNED_FROM_SUBCONTRACTOR, `readinessClassOf` ↔ `readinessClassSql` boğaz-ikiz · §1 AST (helper dışında hazırlık sınıflayıcı tanımı / `readShippingReadyRule`·`readShippingReadyTolerancePct` çağrısı yok) · müşteri partisi (aynı `customerBatchNo`, biri boşluklu, iki irsaliye, 10 top + tambur çocukları) ALL_DONE'da PARTIAL · METER_THRESHOLD %2/%5 metreye göre READY/PARTIAL · İE hedefi targetQuantity, fire paydadan düşer · hedefsiz birim ALL_DONE'a düşer · top geri açılınca READY→PARTIAL · 4 groupBy, tanınmayan/eksik groupBy ve state 400 · tamamı GİTTİ birim listede yok · limit=1 sayfalama ↔ özet birebir · gelen belge kapalı → deliveryNote/customerBatch 403 MODULE_DISABLED · birim topları ucu · §10 büyüme sınırı (S15c-d1): toplam sorgusu üyeliği CANLI birim kümesiyle süzer (belge birimlerinde alt sorgu, İE/müşteride kimlik listesi), tamamı GİTTİ birim kümede yok; ön süzgeçli toplam (iki biçim) = süzgeçsiz referans dört birimde birebir, yalnız aşağı soydan canlı + yalnız İŞLEMDE belgeyle. `SEVKE_HAZIR_PERF=1`: 500 belge / 30.000 top süre ölçümü (2026-10-30 yerel: deliveryNote 76 ms, customerBatch 78, customer 31, workOrder 17) | ✓ | ✓B3 (bu commit) — ① hedef-yok → ALL_DONE geri düşüş kolu kaldırıldı → §4 ❌ (METER_THRESHOLD/READY) · ② `ready-works.service`e `isShipReadyUnit` yüklemi → §1 ❌ · ③ aynı dosyada `readShippingReadyRule` çağrısı → §1 ❌; md5/cmp ile geri alındı · ✓B (S15c-d1, bu commit) — ④ toplamda ön süzgeç boş listeyle atlandı → §10a ❌ (4 birim) · ⑤ `liveUnitIdsSql` yukarı tırmanış `u.depth < 0` → §10a+§10b ❌ (belge/parti) · ⑥ `liveReadinessSql` yalnız HAZIR → §10a+§10b ❌ (6); md5 ile geri alındı | 2026-11-04 |
| `Teks-Erp/scripts/test_sevk_top_listesi.ts` | Sevk top listesi (D4-J6, Excel kaynağı): satır sayısı = sevkteki top = çeki satırı; metre toplamı = çeki toplamı = fiş totalMeters; kodsuz topta müşteri kodu null; müşteri top no gelen belgeden (Tambur çocuğu atadan); §5 AST — `shipment-roll-list.service` prisma import/sorgu YOK, içerik yalnız `resolveShipmentDispatchContent`, `getDispatchReport` da aynı kaynaktan; §6 storno — irsaliye VOIDED olunca liste `frozen=false`, `voided=true` | ✓ | ✓B2 (bu commit) — servise `prisma.roll.findMany` ikinci toplayıcı → §5a/§5b ❌ (verisi satırlara girerse §2 de); `frozen: Boolean(doc)` geri konunca §6b ❌; geri alındı | 2026-10-31 |
| `Electron/src/pages/Operations/Shipments/rollListExport.test.ts` | Sevk top listesi Excel (D4-J6): satır sayısı = sunucu top sayısı, TOPLAM = sunucu `totals.totalMeters` (ikinci toplayıcı/`reduce` yok), kodsuz hücre boş, gerçek .xlsx okuma; donmamış (`frozen:false`) liste TASLAK işaretli + "Oluşturma Tarihi" + `_TASLAK` dosya adı |  | ✓B1 (bu commit) — `reduce` ile yeniden toplama → 2 ❌; `frozen` dalı kaldırılınca taslak maddesi ❌; geri alındı | 2026-10-31 |
| `Electron/src/pages/Operations/Shipments/ShipmentDocDialog.test.tsx` | Sevk irsaliyesi TEK yüzey (2026-09-10 birleştirme): DIRECT ↔ çuval sevkiyatı ayrı docType + ayrı rapor ucu · Excel/etiket veri seti YALNIZ menü açılınca çekilir · slot'suz `PrintedDocDialog` hiçbir sevkiyat kalemi çizmez |  | ✓ | 2026-09-10 |
| `Electron/src/pages/Operations/Shipments/undo-affected.test.ts` | Sevki Geri Al önizlemesi etkilenen kayıt listesi (saf `undoAffectedRows`): çuval satırı + altında her top (barkod · metre · döneceği raf), emanet sahibi söylenir, barkodsuz top gizlenmez, eski sunucu (rolls yok) çuval no'yu yine basar, çuvalsız top ayrı satır | Saf |  | 2026-09-18 |
| `Teks-Erp/scripts/test_shipment_doc_freeze_timing.ts` | Sevk irsaliyesi sevk ANINDA donar (ilk baskıda değil): okuma yapılmadan v1/ACTIVE belge var; sevkten sonraki müşteri adı değişikliği donmuş belgeye SIZMAZ | ✓ | ✓ | 2026-09-06 |
| `Teks-Erp/scripts/test_shipment_delivery_to.ts` | Sevkiyatta TESLİM YERİ (K18, cevap 24-C, 2026-11-03): alan gelmeyince iki kolon NULL ve snapshot `deliveryTo` anahtarsız (bayt bayt bugünkü) · kurulumda boyahane + adres yazılır, snapshot DOĞARKEN donar (adres boşsa kart adresi; sonradan kart değişse belge değişmez) · yalnız PLANNED düzenlenir (sevk edilmiş 409 `SHIPMENT_NOT_PLANNED`) · pasif / kendi carisi / bulunamayan / carisiz adres 400 `DELIVERY_*` · sahiplik kapısı iki yön (cari sahip + teslim boyahane OK; cari boyahane 409 `OWNER_MISMATCH`) · PLANNED teslim yeri cariyi arşivden korur | ✓ | ✓B3 (bu commit) — ① aynı cari kontrolü düştü → §4b/§4e/§4f/§4g ❌ · ② claim `status: PLANNED` düştü → §0b/§3d ❌ · ③ anahtar her zaman yazıldı → §1b ❌ | 2026-11-03 |
| `Teks-Erp/scripts/test_allocation_repair.ts` | Tahsis: EN toleransı (yalnız en gevşer, RENK ve KUMAŞ pazarlık dışı) · fazla sevk bayrağı (kapalı=aşılamaz, açık=yazılır) · defter onarımı (sipariş büyüyünce boşluk kapanır, onarım sonrası liste düşer) · önizleme onarımın motoruyla ölçülür (ayrı tahmin yok) · liste sipariş **id**'sini de taşır ve `orders` ↔ `orderNumbers` aynı kümedir | ✓ | ✓ | 2026-09-07 |
| `Electron/src/pages/Operations/AllocationRepair/RepairTable.test.tsx` | Onarım ekranında numaralar tıklanabilir: sevkiyat no her zaman, sipariş no YALNIZ id geldiyse (eski sunucuda düz metin, uydurma arama yok) · her numara KENDİ id'sini gönderir · sipariş SOLDAN + iki panel karartmasız (aynı anda açık kalır) · sipariş paneli salt-okunur |  | ✓ | 2026-09-07 |
| `Electron/src/lib/shipping-flags.test.ts` | Sevkiyat enum aynaları: orderRequirement (off/warn/block, varsayılan warn), invoiceMode (dis/ic/ikisi, varsayılan dis), docItemNameMode (bizdeki/muste |  |  | ⚠️ orta: backend kümeleriyle BİREBİRLİK mekanik ölçülmüyor (module-flags.test.ts'in aksine ka |
| `Electron/src/pages/Operations/AccountingDispatch/ShipmentInvoiceDraft.test.tsx` | Satırlar BACKEND UCUNDAN gelir — diyalog eskiden sevk fişi raporundan kendi satırlarını kurup fiyatı hiç çözmüyordu (hepsi 0); taslak ucu çağrılmazsa  |  |  |  |
| `Electron/src/pages/Operations/AccountingDispatch/accounting-export.test.ts` | Sevk fişi 3 sayfa (Kumaş/Çuval/Çeki) + kolon→veri eşlemesi + TOPLAM satırları; Çeki sayfasında totalRow yok · fasondan doğrudan sevkte yine 3 sayfa, Ç |  |  |  |
| `Electron/src/pages/Operations/AccountingDispatch/invoiceDraftLines.test.ts` | Decimal STRING → NUMBER dönüşümü (uç `qty:"500"` döner; string forma girince hata çıkmaz, yalnız biçimlendirme ve tutar önizlemesi sessizce bozulur) · |  |  |  |
| `Electron/src/pages/Operations/AccountingDispatch/invoiceDraftVisibility.test.ts` | 'Faturala (iç)' fabrikada HİÇ çıkmaz (ticaret sıfır-fark) · iç faturası olan satırda çıkmaz (bir sevkiyat → tek aktif fatura; çıkması kesin 409'a yürü |  |  |  |
| `Electron/src/pages/Operations/Orders/OrderShipmentsCard.test.tsx` | Boş listede kart null · satırlar + toplamlar gösterilir · `shipping:read` varsa satır tıklanabilir → doğru route + `onNavigate` · izin yoksa satır TIK |  |  |  |
| `Electron/src/pages/Operations/Returns/returnInvoice.test.ts` | 'Satış İade Faturası' düğmesi fabrikada HİÇ çıkmaz · iptal edilmiş iadede çıkmaz (mal sevkiyata döndü, ortada iade yok) · zaten faturalanmış grupta çı |  |  |  |
| `Electron/src/pages/Operations/Rolls/quickShip.test.ts` | `canQuickShip(tab, financeEnabled)` yalnız FINISHED_STOCK + finans açıkken true; her sekme tek tek ölçülür · fabrikada bu yüzey HİÇ çıkmaz (koşul düşe |  |  | ⚠️ BELİRSİZ: yüklem hâlâ `financeEnabled` — kardeş ticaret yüzeyleri (po-regime, goodsReceipt |
| `Electron/src/pages/Operations/SackContentEdit/SackEditorView.ship.test.tsx` | §1 editörde 'Sevk Et' var ve tıklanınca LİSTEDEKİ İLE AYNI `CreateShipmentDialog` tek elemanlı seçimle açılır (kısayol BYPASS değil: sipariş zorunlulu |  |  |  |
| `Electron/src/pages/Operations/SackContentEdit/ShipmentOrderSelect.test.tsx` | Sevkiyat kur modalinda siparis aramasi: terim SUNUCUYA `search` ile gider (istemcide suzulmez, take:300 kesintisi 'sonuc yok' yalani uretir), bos sonu |  | ✓ |  |
| `Electron/src/pages/Operations/SackStore/DispatchConfirmDialog.test.tsx` | Ortak sevk onay dialogu: cuvallari SOMUT listeler, okutma bilgisi yoksa yumusak dogrulama notu basar, scannedCodes ile X/Y sayaci sackNo eslemesinden  |  |  |  |
| `Electron/src/pages/Operations/SackStore/SackStorePage.test.tsx` | Sevk Kapisi ekrani: PLANNED karti yalniz 'Sevk Et' gosterir (kapi butonlari kaldirildi), onay dialogu cuvallari somut listeler ve dispatch'i cagirir,  |  |  |  |
| `Electron/src/pages/Operations/Shipments/shipmentDetailError.test.tsx` | Sevkiyat + fasondan-sevk detay yuzeyleri hata dalinda 'bulunamadi' DEMEZ: uc non-nullable donduğu icin `!d` yalniz hata (403/ag/5xx) demektir; 'yuklen |  | ✓ |  |
| `Electron/src/pages/Operations/WorkOrders/DirectShipModal.test.tsx` | Fasondan dogrudan sevk modali: onizleme toplari checkbox'la cizer, sebep+musteri zorunlu (ikisi girilene dek buton pasif), payload rollIds+customerId+ |  |  |  |
| `Electron/src/pages/Operations/tile-visibility.test.ts` | Karo/palet gorunurluk matrisi: Kursun Planlama kapisi URETIM modulu (kursun bayragi degil), Sevk Kapisi yalniz confirmationEnabled, Depo Transferi cok |  |  |  |
| `Teks-Erp/scripts/test_accounting_direct_ship.ts` | Fasondan doğrudan sevkin (DirectShipment) muhasebe dökümünde ve sevk fişinde çuvallı sevkiyatlarla AYNI yapıyla (sackCount=0, kg=0) çıkmasını kilitler | ✓ |  |  |
| `Teks-Erp/scripts/test_accounting_export.ts` | Muhasebe Excel dökümünün BRÜT olmasını (iade edilen top geri eklenir) ve shipments/detail/byCustomer/byProduct/returns/totals tutarlılığını + müşteri  | ✓ |  |  |
| `Teks-Erp/scripts/test_auto_draft_shipment.ts` | Sevk onayı sonrası otomatik satış faturası taslağını kilitler: KAPALI parite (bayt-bayt aynı mesaj), açık rejimde ürün kırılımlı taslak, idempotent ka · §10 BRÜT: iade sonrası taslak/önizleme sevk anındaki kümeyi taşır (RollReturn geri-ekleme, bir sonda) | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_barcode_free_flow.ts` | Barkod OKUTMADAN uçtan uca zinciri kilitler: FIFO keşfi, id ile sevk, id ile iade, depo transferi + sevkiyata atanmış çuvalın öneri listesinde çıkmama | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_batch_multibatch_dispatch.ts` | K11'i kilitler: çok-partiye yayılan fason sevk seçiminde strateji yoksa 409 MULTI_BATCH, MERGE → en eskide birleşme, SEPARATE → parti başına ayrı sevk | ✓ |  |  |
| `Teks-Erp/scripts/test_batch_partial_dispatch_autosplit.ts` | K5'i kilitler: kısmi fason sevkte oto-bölme — sevke giren toplar orijinal parti+kartı korur, kalanlar splitFrom'lu yeni parti + yeni karta ayrılır, se | ✓ |  |  |
| `Teks-Erp/scripts/test_batch_trace.ts` | Parti geri izlemenin üç kuralını kilitler: parti no benzersiz değil (arama daima liste), iade edilmiş top müşteri listesinden düşmez, kesim çocukları  | ✓ |  |  |
| `Teks-Erp/scripts/test_branch_code_docs.ts` | Sevk belgelerinde İhracat Kodu'nun TEK satır olmasını kilitler: şube kodu varsa o, yoksa müşteri ihracat kodu; ayrı 'Şube Kodu' satırı yok; toggle kap |  |  |  |
| `Teks-Erp/scripts/test_shipment_destination_chain.ts` | Sevk yönü zinciri `resolveShipmentDestination` (kilit kararı 2026-09-23): şube yönü > cari yönü > null (ilk sevk), kaynak beyanlı; pasif şube yönünü taşır; başka carinin şubesi 400, olmayan cari 404; `customers.branchesEnabled` kapalıyken şube taşıyan sevkiyatta şubenin yönü (bayrak okunmaz; kapalı okunamazsa ÖLÇÜLEMEDİ) · §5 sevk ekranı ucu `readShipmentDestinationLock`: ihracat kodu yalnız yurtdışında, şube kodu cariden önce, gizlenen kod silinmez, hızlı sevk engel gerekçesi · §6 iki belge render'ı `pickExportCode`u çağırır (yorumlar ayıklanarak). | ✓ | ✓B5 (bu commit) — ① zincirde şube/cari sırası ters → 1b/2c/4 ❌ · ② şube sorgusundan `customerId` koşulu düştü → 3a ❌ · ③ bayrak `true` yazıldı → ÖLÇÜLEMEDİ, çıkış 1 · ④ render'a elle `??` zinciri → §6 ❌ · ⑤ kod yönden bağımsız → 5d/5e/5h ❌ |  |
| `Teks-Erp/scripts/test_shipment_destination_lock.ts` | Sevk yönü KİLİDİ (S2, 2026-09-23): kilitliyken farklı istek → kilitli değer + Türkçe uyarı (eski tablet taklidi) · kilitli EXPORT'ta tartı korunur · ilk sevkte yazım zincirin boş kaldığı en alt seviyeye (şube/cari) · örtük seçim yazılmaz · Hızlı Sevk kilitli EXPORT'ta QUICK_SHIP_EXPORT_UNSUPPORTED (kaynak adıyla) · eşzamanlı iki ilk sevk (açık tutulan tx) farklıysa 409 SHIPMENT_DESTINATION_LOCKED, aynıysa başarı · eski sevkiyat donar · setDestination kilitliyken yalnız kilitli değer, boş zincirde açık seçim İLK SEÇİM (aynı yazar `claimFirstDestinationTx`, tek tanım iki çağıran) · şube yönü değişince planlı sevkiyat donar · §13 ESKİ İSTEMCİ taklidi (`destinationChosen` yok → sevkiyata yazılır, kart boş) · §14 `destinationChosen` yalnız true. | ✓ | ✓B12 (bu commit) — ① kilitliyken istek kazanır → 1a ❌ · ② uyarı null → 1b/2b/5c ❌ · ③ claim'den `defaultDestination: null` düştü → 8a/8b ❌ · ④ aynı-seçim toleransı düştü → 8b ❌ · ⑤ şube dalı düştü → 4a/4b ❌ · ⑥ örtük DOMESTIC yazıldı → 6b/7b/10d/10e ❌ · ⑦ setDestination kilitsiz → 10a/10b ❌ · ⑧ setDestination ilk seçimi yazmaz → 10e–10h/12b ❌ · ⑨ setDestination'a kopya claim → 10f–10h/12b/12c ❌ · ⑩ yazarın açık-niyet koşulu düştü → 12d/13b/13d ❌ · ⑪ koşul çağırana taşındı → 12d/12e ❌ · ⑫ Zod false kabul → 14b/14d ❌ |  |
| `Teks-Erp/scripts/test_customer_branch_destination.ts` | Şubenin sevk yönü (S3, 2026-09-23) üç yazma yolunda: route Zod şeması alanı geçirir (sessiz silme yok) · servis create/update (EXPORT yazılır, '' → null, alan yoksa dokunulmaz, enum dışı Türkçe 400 ve kayıt değişmez) · satır-içi şube (satır numaralı 400, bozuk istekte cari doğmaz) · şube yönü değişince planlı sevkiyat donar. | ✓ | ✓B5 (bu commit) — ① Zod'dan alan düştü → 1a/1b ❌ · ② create yazmaz → 2a ❌ · ③ update alan yokken null yazar → 3b/3d ❌ · ④ enum serbest → 2d/4b ❌ · ⑤ satır-içi yazmaz → 4a/4b/4c ❌ |  |
| `Teks-Erp/scripts/test_bulk_dispatch_rollids.ts` | bulkDispatchStep'in top alt-küme seçimini (rollIds) kilitler: yalnız seçilen toplar fasona sevk edilir, seçilmeyenler adımda kalır. | ✓ |  |  |
| `Teks-Erp/scripts/test_consistency.ts` | consistency-check.sql'in mekanik ikizi: denormalize defter alanları + drift taraması (§20 WorkOrderStep.status ve §21-24 ön muhasebe SQL'de yok; levent §34–§41 için KENDİ fikstürü — fikstür kipi hedef ADINDAN fail-closed, salt-okunur kipte tek satır yazmaz; fikstür kipinde kapsam 0 ⏭ değil ❌) | ✓ | ✓K1 — `TEKSERP_SONDA_CONS_FIKSTURSUZ=1` (fikstür kurulmaz) → §34–§41 8 ❌, ⏭ değil · ✓B1 (bu commit) — yarım kurulum (A leventinden sonra throw) → `finally` artık 0, koşum ❌ · ✓B2 (bu commit) — devir bağlaması (`rebindProductionIssuesTx`) kaldırılınca §46 (stok topunun son satırı açık üretime alma) ❌ · ✓B3 (bu commit) — 06 denetimi 14: §46 fikstür kapsamında (`FIKSTUR_KAPSAR`; fikstürsüz sondada kapsam 0 ❌) · eski `>=` yüklemi → §46s ❌ (aynı ms'te küçük kimlikli önceki satır açığı gizliyordu) · .sql stok kümesi / kronoloji TS'ten ayrışınca §46t ❌ |  |
| `Teks-Erp/scripts/test_direct_ship_api.ts` | Fasondan doğrudan sevk ucunun GERÇEK HTTP zinciri: verifyToken + requireAny + uuid-param + Zod + error.middleware → 200/400/403/404/409 + idempotency. | ✓ |  | ⚠️ Başlık yorumu kaldırılmış seed kullanıcısı 'fatma.satis'i izinsiz aktör olarak anlatıyor;  |
| `Teks-Erp/scripts/test_direct_ship_fason.ts` | executeDirectShip ana akışı: toplar SUBCONTRACTOR_CONSUMED, fason adımı COMPLETED + sonraki SKIPPED, WO+kart COMPLETED, donmuş PrintedDocument, sipari | ✓ |  |  |
| `Teks-Erp/scripts/test_direct_ship_scenarios.ts` | Doğrudan sevkin kenar durumları: over-ship tavanı, mükerrer tahsis, çok-satır karşılanma + sipariş statüsü, çoklu açık dispatch, ardışık fason, batchI | ✓ |  |  |
| `Teks-Erp/scripts/test_dispatch_allocation_fresh.ts` | Tahsis SEVK ANINDA taze hesaplanır: storno + kalem küçültme sonrası Σ tahsis ≤ kalem miktarı; tahsis edilemeyen metraj audit'e yazılır; sevk yine de e | ✓ |  |  |
| `Teks-Erp/scripts/test_dispatch_claim_step_match.ts` | Fason sevkinin atomik claim'i: başka adıma bağlı top reddedilir; autoAttach steal'de iki paralel sevkten tam biri kazanır; aynı adıma paralel sevkte b | ✓ |  |  |
| `Teks-Erp/scripts/test_dispatch_cross_wo_batch_guard.ts` | Sevk iptali batchId'yi korur; iptal sonrası serbest top BAŞKA WO'nun sevkine girerse FOREIGN_BATCH 400 (MERGE stratejisi de bypass edemez); meşru yol  | ✓ |  |  |
| `Teks-Erp/scripts/test_dispatch_print_options.ts` | Sevk irsaliyesi baskı seçenekleri: varsayılan ayrı sayfa (ilk liste sayfa açmaz, kapalı bölüm sayaca girmez), listSections tek seferlik ve kalıcı ayar |  |  |  |
| `Teks-Erp/scripts/test_dispatch_report.ts` | Muhasebe sevk fişinin üç listesi: ürün listesi ürün+renk+en bazında gruplanır, çuval listesi metre/kg/paket doğru, çeki listesinde kg yalnız çuvalın i | ✓ |  |  |
| `Teks-Erp/scripts/test_dispatch_report_gross.ts` | Sevk fişi BRÜT: getDispatchReport donmuş snapshot'tan okur, iade rakamı değiştirmez; iade yalnız dipnot; muhasebe export'unda sevk brüt + ayrı iade bö | ✓ |  |  |
| `Teks-Erp/scripts/test_doc_sample_html.ts` | renderSampleHtml önizleme yolu: her belge tipi REGISTRY'de kayıtlı, örnek doc şekli renderer'la uyumlu, docConfig ezmesi akıyor, TASLAK filigranı ve r | ✓ |  |  |
| `Teks-Erp/scripts/test_document_customization.ts` | Belge kişiselleştirme Faz 2-4: kolon motoru (gizle/sırala/toplam), damga+QR, konumlu metin blokları + sanitize sınırı, dil (EN/auto) ve DocumentProfil | ✓ |  |  |
| `Teks-Erp/scripts/test_e2e_full_flow.ts` | Uçtan uca üretim hattı: KK1 girişi → WO/attach → Kurşun+KK2 → Tambur finalize → çuval → PLANNED/DISPATCHED, her geçişte statü assert'i. | ✓ |  |  |
| `Teks-Erp/scripts/test_finance_invoice.ts` | Fatura onay/storno defter disiplinini kilitler: eşzamanlı onay yarışında tek satır, bakiye mutabakatı SUM(defter)=CariBalance, clientToken çift-gönder | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_hide_cancelled_lists.ts` | buildHideCancelledWhere karar mantığını (bayrak yoksa dokunma, açık durum filtresi varsa dokunma) + üç listede uçtan uca gizlemeyi ve WO buildWhereCla | ✓ |  |  |
| `Teks-Erp/scripts/test_iade_enhancements.ts` | İade sertleştirmesini ölçer: sebep zorunluluğu (reasonId ∨ reasonText), returnGradingEnabled açık/kapalı kalite→raf statüsü (FIRE→SCRAP, A1→A1_STOCK), | ✓ |  |  |
| `Teks-Erp/scripts/test_inventory_shipment_scope.ts` | Envanter 'sevkiyat kapsamı' filtresi: free = sackId null VE shipmentId null; committed = ikisinden biri dolu — çuvaldaki-sevksiz top 'serbest' sayılma | ✓ |  |  |
| `Teks-Erp/scripts/test_kartela_stock_and_ship.ts` | Kartela ADET stoğu + çuvala seçerek ekleme: getStock gruplaması (sackId:null), addKartelaToSack happy/yetersiz, PLANNED sevkiyattaki çuvala ekleme 409 | ✓ |  |  |
| `Teks-Erp/scripts/test_manual_sack_count.ts` | Sevk irsaliyesinde operatör beyanı çuval adedi: beyan yokken çıktı bit-bit eskisiyle aynı, beyan sistemle eşitse de basılır, ihracatta İngilizce ('Pac |  |  |  |
| `Teks-Erp/scripts/test_new_documents.ts` | Beş belge tipinin (fason kabul, kalite sertifikası, packing, invoice, iade irsaliyesi) örnek render'ının başlık/numara/alan içermesi + serbest belge C | ✓ |  |  |
| `Teks-Erp/scripts/test_o19_operator_trace.ts` | Çuval/sevkiyat operatör izi: weighSack ve tartılı openSack weighedById+weighedAt yazar, yeniden tartıda son tartan kazanır, dispatchShipment dispatche | ✓ |  |  |
| `Teks-Erp/scripts/test_open_orders_search.ts` | Sevkiyat kur modalındaki sipariş aramasının SUNUCUDA süzüldüğü (take:300 kesmesinden önce) ve controller'ın `search` alanını gerçekten servise geçirdi | ✓ |  |  |
| `Teks-Erp/scripts/test_order_leadtime.ts` | Teslim süresi karnesi: medyan ≠ ortalama (çarpık örneklemle ayrışma), çıpa orderDate, sevk görmemiş sipariş istatistiğe girmez ama sayılır, LEAST(çuva | ✓ |  |  |
| `Teks-Erp/scripts/test_order_shipments.ts` | getOrderShipments drill-down: çuval sevki (DISPATCHED+PLANNED, CANCELLED hariç) + fason direkt sevk birleşir, dispatchedTotal/plannedTotal doğru ve re | ✓ |  |  |
| `Teks-Erp/scripts/test_printed_documents.ts` | Donmuş belge defterinin yaşam döngüsünü kilitler: v1 freeze · kaynak değişse de snapshot sabit · reissue v1 SUPERSEDED+v2 ACTIVE · yeni sevk = yeni be | ✓ |  |  |
| `Teks-Erp/scripts/test_production_flow_api.ts` | Üretim zincirini UÇTAN UCA HTTP'den yürütür (sipariş→KK1→iş emri→kurşun+KK2→tambur→depo→çuval→sevkiyat PLANNED→DISPATCHED→iade→storno); ürünün `app`i gerçekten dinler ve boot uzlaştırması (izin kataloğu + varsayılan depo) iddiadan ÖNCE `await` edilir — depo adımında `warehouseId != null` iddiası, statüye bakan kontrollerin göremediği tek dişli iddiadır | ✓ | ✓ |   ⚠️ §6 YARIŞ KOLU 2026-09-16'da YENİDEN YAZILDI: eski iddia "tam biri 200, diğeri 409" idi ve YANLIŞTI — `prepareRawForSale` başında BİLİNÇLİ bir idempotent dal var (top zaten `WAREHOUSE` ise erken dönüp 200), yani kaybedenin cevabı OKUMA ANINA bağlıdır: kazanan commit etmeden okuduysa 409, sonra okuduysa 200 — İKİSİ DE DOĞRU. Yerelde (hızlı) hep 200/409, CI'da (yüklü) 200/200 çıktı; eski kol makinenin HIZINI ölçüyordu. Yeni kol DEĞİŞMEZE bağlı: geçiş TAM BİR KEZ uygulandı (audit satırı = 1). ⚠️ VE ESKİ KOL ASIL ARIZAYA KÖRDÜ: atomik claim kırılıp geçiş İKİ KEZ uygulandığında `§6b` (son durum WAREHOUSE) YEŞİL kalıyor — sondayla ölçüldü (audit 2 satır, §6b ✓).|
| `Teks-Erp/scripts/test_quick_shipment.ts` | Hızlı sevkin normal sevkle AYNI çekirdekten geçtiğini (tahsis/statü/irsaliye birebir), atomik olduğunu (yarım çuval kalmaz), barkod istemediğini, ihra | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_race_conditions.ts` | Kilit yardımcılarının (touchOrderLinesTx sıralı+dedup, touchWorkOrderTx) sözleşmesini ve üç gerçek yarışı ölçer: fason directShip over-coverage, fason | ✓ |  |  |
| `Teks-Erp/scripts/test_raw_sale_quick_order.ts` | Ham kumaş satış yolunu kilitler: prepareRawForSale serbest STOCK topu WAREHOUSE'a çeker, WO/sevkiyattaki topu reddeder; quickOrderFromRolls spec bazın | ✓ |  |  |
| `Teks-Erp/scripts/test_return_bulk_group.ts` | Çuval bazlı toplu iadenin on bir maddesini kilitler: defter satır bazında (N RollReturn, tek returnGroupId) ama belge grup bazında TEK çok kalemli irs | ✓ |  |  |
| `Teks-Erp/scripts/test_return_document_no.ts` | İade belge numarası `IADE-GGAAYY-<id6>`nın GGAAYY parçası FABRİKA gününden (`ddmmyy` → `factoryYmd`), süreç saat diliminden değil: UTC host'ta 00:00–03:00 arası iade önceki günün numarasını taşıyordu (kimlik kusuru; 2026-09-14) — Negatif sonda: `TZ=UTC` + dört sabit an (21:30Z → ertesi gün, yıl devri); `returnDocumentNo`u eski `getDate()` formülüne çevir → 6/9 ❌, `TZ=Europe/Istanbul` aynı mutasyon yeşil |  | ✓B1 (`935076bb`: `returnDocumentNo` eski `getDate()` formülü + `TZ=UTC` → 3/6 ❌, `TZ=Europe/Istanbul` yeşil) | |
| `Teks-Erp/scripts/test_return_scorecard.ts` | İade Karnesi'nin paydasının BRÜT olduğunu kilitler (iade shipmentId'yi NULL'ladığı için canlı payda oranı şişirir; fixture brüt %10 ↔ net %11,1 ayrımı | ✓ |  |  |
| `Teks-Erp/scripts/test_roll_relabel.ts` | Top etiketi değiştirme davranışını çuval-depo modelinde kilitler: depodaki çuvaldaki top relabel EDİLEBİLİR (mühür yok), atanmış sevkiyattaki top 409, | ✓ |  |  |
| `Teks-Erp/scripts/test_roll_relabel_context.ts` | getRelabelContext'in okuma sözleşmesini kilitler: spec + propertyIds seed, lastLabelSnapshot aynen döner, aday müşteriler WO'nun bağlı siparişinden, d | ✓ |  |  |
| `Teks-Erp/scripts/test_sack_content_dump.ts` | getContentDump'ın top bazlı dökümünü: Decimal→number, çuval başlık alanları, kartela ayrı dizi, hayalet topların düşmesi, sevkiyata göre gruplu sıra v | ✓ |  |  |
| `Teks-Erp/scripts/test_sack_customer_gate.ts` | Paketleme cari kapısını: withSacksOnly süzgeci, müşterisiz kovası sentineli, kapı↔liste tek kaynak (resolveScopeOr) ve Electron aynasının birebirliği. | ✓ |  |  |
| `Teks-Erp/scripts/test_sack_mismatch.ts` | Çuval içeriği uyuşmazlık sinyallerinin NE ZAMAN SUSTUĞUNU: düz müşteri karşılaştırması yok; yalnız şablon rotası/kumaş-renk alias/2. kalite farkı kırm | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_sack_note_document.ts` | Sevk irsaliyesindeki AÇIKLAMA (çuval yorumu) kolonunun görünürlük matrisini (kalıcı ayar OR tek-seferlik bayrak), varsayılan kapalılığını, escape'i ve | ✓ |  |  |
| `Teks-Erp/scripts/test_sack_pool_lifecycle.ts` | Çuval havuzu yaşam döngüsünü: onay bayrağı kapalı (tek adım DISPATCHED) / açık (PLANNED→dispatch), alt küme, fazla mal, siparişsiz sevk, FIFO tahsis,  | ✓ |  |  |
| `Teks-Erp/scripts/test_sack_reassign_customer.ts` | reassignSackCustomer'ı: müşteri/şube atama, yanlış şube 400, müşterisize çekme, şubesiz-müşteri 400 ve sevkiyata bağlı çuvalda 409. | ✓ |  |  |
| `Teks-Erp/scripts/test_sack_search.ts` | Çuval/top arama servisini: içerik (itemId) filtresi, sackCode araması, müşteri+sevkiyatNo filtreleri, DISPATCHED varsayılan gizliliği, getSackContents | ✓ |  |  |
| `Teks-Erp/scripts/test_sack_status_invariant.ts` | "Çuvaldaki top başka yere ALINAMAZ" invariantını dört akışta birden (kartela dispatch, tambur depo kesimi/finalize, fason auto-attach) — depo çuvalınd | ✓ |  |  |
| `Teks-Erp/scripts/test_sack_tag_document.ts` | Sevk irsaliyesindeki İZ (çuval etiketi) kolonunu: not bayrağıyla BİNDİRİLMEMESİ, donmuş snapshot'a GİRMEMESİ ve sevkte temizlenen izin basılmaması (AC | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_sack_tags.ts` | Çuval izlerini: DISPATCH temizler/storno geri getirir, iz yazımı weightKg'ye DOKUNMAZ (weighSack 409 kontrol grubu), rozet↔filtre küme eşitliği, sanit | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_sack_weigh_source.ts` | weighSack kaynak beyanını (SCALE/MANUAL/SIMULATED) ve backend enforce'unu: simulate cihazın çapraz kontrolü, MANUAL muafiyeti, `shipping.simulatedWeightEnabled` bayrağı, içerik değişince kg+kaynak sıfırlanır, audit `source` taşır; §3b kg eşiği UYARIR bloklamaz ve uyarı yanıtla AYNI metinle audit yüküne (`thresholdWarning`) girer, eşik altında anahtar YOK (iki yönlü) | ✓ | ✓B2 — `markSackContentChangedTx` gövdesi koşulsuz `return` → 2 ❌ (2026-09-06, dosya başlığı) · (bu commit) `finishWeigh` audit yükünden `thresholdWarning` spread'i düşürüldü → §3b "YANITLA AYNI" ❌ (26/1) |  |
| `Teks-Erp/scripts/test_shipment_detail_gross.ts` | Sevkiyat DETAYININ (çuval içeriği) brüt olduğunu kilitler: iade edilen top çuvalda `returned` işaretli kalır, `prevSackId` ile geri eklenir, `totalKg` | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_shipment_dispatch_document.ts` | Sevk irsaliyesinin tek kaynak render'ını (yasal başlık, ÜRÜN/ÇUVAL/ÇEKİ bölümleri, filigran, XSS kaçışı, TR sayı biçimi) + PLANNED'da `getHtml ?draft` | ✓ |  |  |
| `Teks-Erp/scripts/test_shipment_doc_batch_column.ts` | Müşteri sevk irsaliyesinde parti no kolonunun BLOCKLIST semantiğiyle varsayılan basıldığını, partinin çuval değil TOP başına taşındığını ve alansız es |  |  |  |
| `Teks-Erp/scripts/test_shipment_doc_customer_name.ts` | Sevk belgesinde müşterideki ürün adı paketini kilitler: `bizdeki` varsayılanında çıktı bayt-bayt dünkü, AD DONAR ama REJİM her baskıda canlı, override | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_shipment_filters.ts` | `listShipments` filtreleri (itemId/colorId/hasReturns/destination), TEK TOP eşleşme ayrımı, eşleşme rozeti (`matchRollCount` filtresizken hiç yok), sh | ✓ |  |  |
| `Teks-Erp/scripts/test_shipment_invoice.ts` | Fatura izi sözleşmesi: DISPATCHED işaretlenir, tarihsizde 'şimdi', PLANNED 400, `invoiceNo:null` tarihi de temizler, `invoiced` filtresi ayırır, Direc | ✓ |  |  |
| `Teks-Erp/scripts/test_shipment_list_gross.ts` | Sevkiyat LİSTESİNİN brüt olduğunu kilitler: metraj+adet canlı+iptal edilmemiş iade, `_count.returns` ayrı durur, iade iptalinde geri-ekleme düşer, kg  | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_shipment_list_sort.ts` | `sortBy=dispatchedAt` sıralamasını kilitler: createdAt sırası bilinçli ters kurulur, NULL (PLANNED) satırlar iki yönde de sonda, union'ın iki tarafı f | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_roll_operation_revoke.ts` | Top operasyon izinin (kurşun/QC2/tambur/fason) geri alınırken SİLİNMEDİĞİNİ damgalandığını; PARTIAL unique sayesinde geri alınmış satır dururken aynı (top, adım, tip) üçlüsünün YENİDEN yazılabildiğini ama iki AKTİF satırın hâlâ reddedildiğin | ✓ |  |  |
| `Teks-Erp/scripts/test_shipment_event_ledger.ts` | Sevk geri alınırken `dispatchedAt`/`dispatchedById`in SİLİNMEDİĞİNİ, `ShipmentEvent` defterinin sevk→geri al→sevk turunu büyüttüğünü, iptal künyesinin dolduğunu ve çuval tartısının `SackWeighing`e (WEIGHED/REWEIGHED/CLEARED) yazıldığın | ✓ |  |  |
| `Teks-Erp/scripts/test_shipment_order_ledger.ts` | Sevkiyat↔sipariş defteri: kalan kapasite diğer sevkiyatların PLANNED tahsislerini de düşer (aşırı sevk), iptal siparişe sevk ön kontrol 400 + kilit al | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_sack_allocation_cleared.ts` | K2 (2026-09-14): `SackAllocation` sil-yaz → DAMGA. Sipariş kümesi değişince/iptalde eski tahsis silinmez `clearedAt`+`clearedShipmentId` damgalanır; aynı (çuval, satır) damgalı dururken yeniden tahsis edilebilir (partial unique `sack_allocations_active_uq`); Σ okuyucular yalnız etkin satır; sevk yeniden hesaplar (satır silmez), storno dokunmaz; §4 AST+tip: `sackAllocation` delegate/ilişki okumaları `ACTIVE_SACK_ALLOCATION` taşır, `delete*` 0, ham SQL `"clearedAt" IS NULL` (revoke-ast-tarama, damga: clearedAt); §5 SQL ikizi süzgeçli; §6 damgalı satırın ileri kaydı değişmez | ✓ | ✓B2 `d05067c3` (kanıt: arşiv 2026-09-14 "K2: ÇUVAL TAHSİSİ" notu + iniş commit mesajı — order-status süzgeci düşürüldü → §4a+§3a ❌; damga deleteMany'e çevrildi → 6 ❌) | 2026-09-14 |
| `Teks-Erp/scripts/test_shipment_scope_lock.ts` | Storno ↔ iade yarışını kapatan sevkiyat kapsamlı advisory kilidin, koruduğu okumadan ÖNCE alındığını (§1 sıra ölçümü) ve kilit uzay numaralarının (802 | ✓ |  |  |
| `Teks-Erp/scripts/test_shipment_scorecard.ts` | OTIF karnesinde termini olmayan siparişin paydadan çıkıp ayrıca sayılmasını ve sevk hacminin İade Karnesi ile AYNI tek tanımdan (`_shipped.ts`) gelmes | ✓ |  |  |
| `Teks-Erp/scripts/test_shipment_undo_dispatch.ts` | Storno ≠ iade: `preShipStatus` ile raf ayrımı korunur, DISPATCHED→PLANNED, sipariş karşılanması geri alınır, irsaliye VOIDED, yeniden sevk v2 üretir,  · [2] 2026-09-18: önizleme çuvalın TOPLARINI somut listeler (`sacks[].rolls[]` barkod + döneceği raf, `looseRolls`) | ✓ |  |  |
| `Teks-Erp/scripts/test_shipping_client_token.ts` | `openSack` ve `createShipment` idempotency'si: aynı clientToken iki kez → tek kayıt (cached yanıt), farklı token yeni kayıt, token'sız çağrı geri uyum | ✓ |  |  |
| `Teks-Erp/scripts/test_shipping_flags.ts` | Dört sevkiyat davranış bayrağının (orderRequirement / weighRequired / manualWeightRestricted / invoiceMode) varsayılanda SIFIR fark bıraktığını ve açı | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_emanet.ts` | EMANET (G3, konsinye mülkiyet): §0 statik (origin_party_ck dört kol · CONSIGNED ADD VALUE saf · grandfathering damgası · modül anahtarı on yer · E4c iki çıkış yolu `assertOwnerMatchesTx` · E2b PATCH şemaları owner'ı dışlar · E4b fatura `warnings` · MERGE_MAP ×3) · §1 kapalı bayt bayt (KK1/levent/lot owner'lı → 403 modul emanet, satır doğmaz; ownersız doğum aynen) · §2 açık (lot A/B/yok · CONSIGNED owner A, taraf 400 · karışık lot sarımı 409 + tx geri · A+ownersız sarım owner KALITIR köken IN_HOUSE · KK1 owner · fason dokuma leventten kalıtım) · §3 sevk kapısı (B'ye 409 yalnız A'nın barkodu; A'ya geçer; ownersız geçer) · §4 CHECK 23514 ×2 + IN_HOUSE+owner OK · §5 E2b updateWarpBeam/lot update owner yazmaz · §6 G3t `GET /rolls/tablet-context` (`roll:write` ∨ `mobile:kk1`, `/:id`den önce; kapalı ⇒ `customers: []`; açık ⇒ yalnız `{id,name}`, vergi no/adres sızmaz, pasif yok) · §3c–§3e sevk önizlemesi sahiplik UYARISI (`findOwnerMismatches` tek yüklem: `[OWNER_MISMATCH]` warnings + `ownerMismatches[]`, sahibi ⇒ boş, müşterisiz ⇒ liste; sonda `[]` → §3a/§3c/§3e ❌) | ✓ | ✓B3 (bu commit) — `NOT: { ownerCustomerId }` düşünce §3b ❌ · bayrak kontrolü düşünce §1a/§1b/§1c ❌ · çoklu-owner 409 düşünce §2d ❌ · tablet bağlamı `select`e taxNumber eklenince §6c ❌ · bağlam bayrak kontrolü düşünce §6b ❌ | 2026-09-15 |
| `Teks-Erp/scripts/test_emanet_sahiplik_geri_doldur.ts` | H10b geri doldurma betiği `fix_emanet_owner_backfill.ts`: sahipli atanın sahipsiz çocuğu/torunu, aynı sahipli kaynaklardan doğan top ve onun çocuğu, kaynağı geri doldurulacak çocuk olan makbuzun doğanı aday (5); sahipli + sahipsiz kaynaklı makbuz BELİRSİZ (yazılmaz), hepsi sahipsiz / sahipsiz ata aday değil; sayı tutmayınca tx geri alınır; uygulama yalnız listelenenleri yazar + audit `EMANET_OWNER_BACKFILL`; ikinci teşhis boş; §5 sevk edilmiş aday: aynı müşteriye sevkli SEVKLİ (varsayılan yazılmaz, `--sevkli-dahil`), başka müşteriye sevkli SEVK-UYUŞMAZ (yazılmaz), CANCELLED listelenmez | ✓ | (2026-10-29) betikte `strict` kaldırılınca → §3/§4 ❌ (10/5); sevk sınıflaması kaldırılınca → §3/§4/§5 ❌ (14/5) |
| `Teks-Erp/scripts/test_emanet_sahip_suzgeci.ts` | P1a (ister 3.2): top listesi `filter[ownerCustomerId]` tekil/CSV · `/rolls/stats` aynı where · cursor sayfalamada süzgeç korunur · emanet KAPALI iken süzgeç yine uygulanır + `/api/consigned-work` 403 MODULE_DISABLED · İçerideki İşler ölü/sevkli/hurda dışlar, kovalar, metre = currentQty ve `/stats` ile birebir · sahip lookup'ı (kapalıyken boş) · §7 her kova = panelin bağlandığı sekmenin rollScope'u + sahip + includeFire `/stats`ı (yarı mamul + fire kaliteli fikstür) | ✓ | (2026-10-29) `where.ownerCustomerId` ataması düşürülünce → §1a/§1b/§1d/§3/§4a/§5f ❌ (12/6); `requireEmanetEnabled` bayrak kontrolü düşürülünce → §4b ❌ (17/1); BUCKET_TAB waitingSemi → RAW_STOCK yapılınca → §7 ❌ (23/1); lookup emanet kapısı düşürülünce → §6b ❌ (23/1) |
| `Teks-Erp/scripts/test_ticaret_links_and_filters.ts` | Ekstre satırının belgeye (invoiceId/paymentId) bağlanmasını, sevkiyatın İÇ fatura bağını (Invoice.shipmentId, iptal fatura görünmez) ve mal kabul / de | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_token_replay_cancelled.ts` | İdempotency'nin dördüncü durumunu kilitler: iptal/fire edilmiş kaydın clientToken'ı replay edilemez (409 ENTRY_CANCELLED / ORDER_CANCELLED / SHIPMENT_ | ✓ |  |  |
| `mobil/src/hooks/useSackWeigh.test.tsx` | Çuval tartısı akışı: kantar okuması, weighSack/setSackNotes çağrıları ve peripheral seçimi (packing.service + useMachinePeripherals + usePeripheralIO  |  |  | ⚠️ 2026-09-03 tartı bayrakları (weighRequired / manualWeightRestricted) mobil tarafta hiç yok |
| `mobil/src/screens/Modules/Sevkiyat/CariHold.test.tsx` | Tablet Sevk Kapısı cari kilit (D4-I4): `held` alanı yoksa çip YOK (eski backend), varsa sunucu `holdText` çipi; Sevk Et 409 `details.code=CARI_HOLD` → tam ekran sunucu mesajıyla, diğer hatalar eski tost; istemci kilit metni üretmez (statik tarama) |  | held koşulu + CARI_HOLD kod koşulu kaldırıldı → 2 ❌ (8/10); geri alındı → 10/10 | 2026-10-31 |
| `mobil/src/screens/Modules/Sevkiyat/ReadyWorks.test.tsx` | Tablet Sevk Kapısı sevke hazır iş çipleri (D4-J4): AYRI tek istek `ready-works?groupBy=customer&state=READY,PARTIAL` (board servisi ready-works'e dokunmaz); eski backend 404 → servis null, şerit/çip YOK; 404 dışı hata fırlar; çip sayısı yanıt satırına eşit; çip → müşterinin hazır işleri, "Paketlemeye geç" mevcut Paketleme akışına |  | servisteki 404 kolu kaldırıldı → 1 ❌ (11/12); geri alındı → 12/12 | 2026-10-31 |
| `Teks-Erp/scripts/test_e_irsaliye_xml.ts` | e-İrsaliye UBL-TR DespatchAdvice üretimi (E4-XML, DB'siz): §1 dört altın örnek (VKN'li · TCKN'li · taşıyıcılı · çok satırlı özel karakterli) bayt-eşit + girdi/XML doğrulamadan geçer · §2 determinizm · §3 beş varlık kaçışı, kontrol karakteri/eşsiz vekil reddi · §4 doğrulayıcı alan alan Türkçe hata (eksik il/ilçe, bozuk VKN/TCKN, 0 metre, numara biçimi/yılı, taşıma kuralı, yurt dışı) · §5 XML denetimi (LineCountNumeric, kök ID/UUID tekilliği, sıra, birim kodu, iyi biçim) · §6 VKN/TCKN sağlaması · §7 snapshot eşlemesi (docNum damgası, ad rejimi, fabrika dilimi, çuval beyanı) · §8 metre hanesi irsaliye QTY'siyle aynı. XSD yok (V3). | Saf | ✓B3 (bu commit) — ① kaçış kaldırıldı → §1/§3/§5 14 ❌ · ② `LineCountNumeric` sabit 1 → §1 çok satırlı iki altın 4 ❌ · ③ VKN sağlaması kaldırıldı → §4b/§4o/§6b 3 ❌ | 2026-10-24 |
| `Teks-Erp/scripts/test_e_irsaliye_db_invariants.ts` | e-İrsaliye DB sedleri DAVRANIŞTA (E1-SEMA; nesnelerin VARLIĞI db-invariant envanterinde): §1 CHECK çift yüklem (numarasız OLUSTURULDU · sentXmlId/sentAt'siz GONDERILDI · sayaç < 0 RED) · §2 partial unique `e_irsaliyeler_kaynak_canli_key` (aynı kaynağa ikinci canlı kayıt RED, IPTAL'den sonra yenisi KABUL) · §3 XML mührü (UPDATE/doğrudan DELETE RED; TASLAK/OLUSTURULDU'ya sürüm KABUL) · §4 gönderilmiş/iptal kayda yeni sürüm RED · §5 olay defteri UPDATE/DELETE RED + doğuş ⇔ fromStatus NULL · §6 GİB numara biçimi (4 karakter ön ek / küçük harf RED) · §7 temizlik: kayıt silinince XML+olay kaskatla gider | ✓ | ✓B3 (bu commit) — ① `e_irsaliyeler_numarali_durum_chk` DROP → §1a ❌ · ② `e_irsaliyeler_kaynak_canli_key` DROP → §2a ❌ | 2026-10-24 |
| `Teks-Erp/scripts/test_e_irsaliye_readiness.ts` | e-İrsaliye hazırlık kapısı (E3-AYAR, sahte istemci; DB'ye yazmaz): §1 varsayılan YAPILANDIRILMAMIS (3 eksik; seri yoksa 4) · §2 tam yapılandırma HAZIR (VKN+dışa aktar, TCKN+simülasyon) · §3 tek bozuk koşul tek eksik (bozuk VKN, vergi dairesi, `yok`, tarih, seri ön eki/hanesi GİB dışı, seri yok, TCKN kişi adı, il/ilçe) · §4 okumada çöp → `yok`/null, künye temizliği · §5 yazma fail-closed (Zod + servis doğrulayıcısı) · §6 eksik cümlesi yol tarifli, teknik ad yok · §7 ikinci hazırlık yüklemi yok (git grep) · §8 gerçek DB okuması + feature-flag yükü | ✓ | ✓B3 (bu commit) — ① VKN sağlaması uzunlukla değiştirildi → §3a ❌ · ② `shipping.service`e `EIRSALIYE_ACTIVE_ADAPTERS.has(` → §7a ❌ | 2026-10-24 |
| `Teks-Erp/scripts/test_e_irsaliye_flow.ts` | e-İrsaliye kayıt motoru: hazırlık kapısı 409 · prepare token replay · üret (numara+ETTN+XML+olay) · eşzamanlı üret tek numara · yeniden üret · elle/simülasyon gönder-sorgula · geri al karşı olay · iptal · audit'te TCKN/XML yok · başlangıç değeri kilidi 8041 · §13 kayıtlar listesi ↔ özet şeridi tek where (E7) · §14 teslim yerli sevk (K18) üretim/yeniden üretim `warnings`, XML cari adresi kalır | ✓ | ✓B4 (bu commit) — claim findUnique+update → 3 ❌ · `requireReady` kaldırıldı → 4 ❌ · olay yazımı çıkarıldı → 5 ❌ · E2 düzeltmesi geri alındı → §12a ❌ · E7: özet süzgeçsiz where → 3 ❌ · s6 düzeltmesi: `deliveryToWarnings` koşulu ters → 3 ❌ (§14a/b/d), geri alındı | 2026-11-03 |
| `Teks-Erp/scripts/test_e_irsaliye_storno.ts` | e-İrsaliye ↔ sevkiyat: kayıtsız storno sıfır fark · OLUSTURULDU storno serbest + kaynakDegisti · gönderilmişte storno 409 (önizleme = mutasyon) · storno+kapat/iptal → IPTAL + olay · iptal gövdesi ikinci sed · liste süzgeci EKSIK/durum/SIMULASYON + özet + cursor · YAPILANDIRILMAMIS 400 · storno ↔ işaret yarışı · kâğıt revizyon kilidi | ✓ | ✓B4 (bu commit) — engel satırı kaldırıldı → 10 ❌ · iptal çağrısı kaldırıldı → 5 ❌ · revizyon kilidi kaldırıldı → §9b ❌ · EKSIK gevşetildi → 4 ❌ · işaret sevk koşulu kaldırıldı → §8a ❌ | 2026-10-25 |
| `Teks-Erp/scripts/test_e_irsaliye_e2e.ts` | e-İrsaliye v1 UÇTAN UCA, HTTP (E8; süreç içi `app.listen(0)`, ikinci backend yok): §1 varsayılan kurulum readiness YAPILANDIRILMAMIS · hazırla 409 · sevkiyat liste/detay/storno önizlemesi yalnız opsiyonel alanla · süzgeç 400 · §2 `PATCH /api/feature-flags` yarım yapılandırma fail-closed · tanınmayan bağdaştırıcı 400 · tam → HAZIR · §3 hazırla (token replay) → üret → GET XML ucu yok → indir (yapısal doğrulama) → gönderildi → storno önizleme = mutasyon 409 → yanıt KABUL → undo'suz 403 / undo'lu geri al · §4 simülasyon gönder+sorgula belirlenimli, süzgeç SIMULASYON · §5 storno+kapat → IPTAL, numara boşluğu önizlemede · §6 izin matrisi · §7 EXPORT 400 · §8 eski panelin e-İrsaliye alansız ayar kaydı yapılandırmayı bozmaz · §3c2/§4a2 üretim zarfı: teslim yersiz `warnings` anahtarsız, teslim yerli 1 uyarı | ✓ | ✓B3 (bu commit) — storno engel satırı (`if (eIrsBlock) return eIrsBlock;`) kaldırıldı → 3 ❌ (§3g/§3h/§3h2); md5 ile geri alındı · s6 düzeltmesi: generate düz `wrap` → §4a2 ❌, geri alındı | 2026-11-03 |
[bekci-harita/sevkiyat.md](bekci-harita/sevkiyat.md)

## etiket

[bekci-harita/etiket.md](bekci-harita/etiket.md)

## finans

[bekci-harita/finans.md](bekci-harita/finans.md)

## siparis

[bekci-harita/siparis.md](bekci-harita/siparis.md)

## modul-bayrak

[bekci-harita/modul-bayrak.md](bekci-harita/modul-bayrak.md)

## belge

[bekci-harita/belge.md](bekci-harita/belge.md)

## ayar

[bekci-harita/ayar.md](bekci-harita/ayar.md)

## cuval

[bekci-harita/cuval.md](bekci-harita/cuval.md)

## rapor

[bekci-harita/rapor.md](bekci-harita/rapor.md)

## kesif-cihaz

[bekci-harita/kesif-cihaz.md](bekci-harita/kesif-cihaz.md)

## tambur

[bekci-harita/tambur.md](bekci-harita/tambur.md)

## depo

[bekci-harita/depo.md](bekci-harita/depo.md)

## parti

[bekci-harita/parti.md](bekci-harita/parti.md)

## renk

[bekci-harita/renk.md](bekci-harita/renk.md)

## db-invariant

[bekci-harita/db-invariant.md](bekci-harita/db-invariant.md)

## iptal-fire

[bekci-harita/iptal-fire.md](bekci-harita/iptal-fire.md)

## refakat-karti

[bekci-harita/refakat-karti.md](bekci-harita/refakat-karti.md)

## audit

[bekci-harita/audit.md](bekci-harita/audit.md)

## tutarlilik

[bekci-harita/tutarlilik.md](bekci-harita/tutarlilik.md)

## top-duzeltme

[bekci-harita/top-duzeltme.md](bekci-harita/top-duzeltme.md)

## kk1

[bekci-harita/kk1.md](bekci-harita/kk1.md)

## mukerrer

[bekci-harita/mukerrer.md](bekci-harita/mukerrer.md)

## kursun

[bekci-harita/kursun.md](bekci-harita/kursun.md)

## kalite

[bekci-harita/kalite.md](bekci-harita/kalite.md)

## surum-deploy

[bekci-harita/surum-deploy.md](bekci-harita/surum-deploy.md)

## rota

[bekci-harita/rota.md](bekci-harita/rota.md)

## offline-kuyruk

[bekci-harita/offline-kuyruk.md](bekci-harita/offline-kuyruk.md)

## superadmin

[bekci-harita/superadmin.md](bekci-harita/superadmin.md)

## ozellik

[bekci-harita/ozellik.md](bekci-harita/ozellik.md)

## kartela

[bekci-harita/kartela.md](bekci-harita/kartela.md)

## sebep-katalogu

[bekci-harita/sebep-katalogu.md](bekci-harita/sebep-katalogu.md)

## iplik

[bekci-harita/iplik.md](bekci-harita/iplik.md)

## uzak-erisim

[bekci-harita/uzak-erisim.md](bekci-harita/uzak-erisim.md)

## yari-mamul

[bekci-harita/yari-mamul.md](bekci-harita/yari-mamul.md)

## dokuma

[bekci-harita/dokuma.md](bekci-harita/dokuma.md)

## urun-yasam-dongusu

[bekci-harita/urun-yasam-dongusu.md](bekci-harita/urun-yasam-dongusu.md)

## lisans

[bekci-harita/lisans.md](bekci-harita/lisans.md)

## patron-bulutu

[bekci-harita/patron-bulutu.md](bekci-harita/patron-bulutu.md)

## bildirim

> Alan 2026-10-24'te doğdu (bildirim sistemi v2, N0-KAT). Plan `docs/design/BILDIRIM-SISTEMI-PLAN.md`; kural dosyası `docs/kurallar/bildirim.md`. Satırlar bu bölümün SONUNA eklenir.

| Dosya | Ne ölçüyor | DB | Negatif sonda | |
|---|---|---|---|---|
| `Teks-Erp/scripts/test_bildirim_katalogu.ts` | Bildirim kataloğu (`src/constants/notification-catalog.ts`) ⇄ SCREEN_CATALOG + izin kataloğu + kendi beyanları: §0 14 tür, `kod` = anahtar, grup, ALARM ⇔ altTur null · §1 `panelEkran`/`tabletEkran` katalogda · §1b `panelYol` ekran adresinin altında · §2 `modul` = ekran modülü · §3 her izin konjonksiyonu ekranın `requires`ından birini içerir, kodlar izin kataloğunda · §4 kilitli tür varsayılan KAPALI değil + `kilitGerekcesi` · §5 yer tutucular ⇄ `payloadAlanlari` iki yönlü + render (eksik alan `—`, eksik yol ekran köküne) · §6 KOSUL/ALARM `cozuldu`, pencere yalnız OLAY'da, kanal kümeleri · §7 param şeması boş nesneyle parse olur ve katıdır · §8 payload adında tutar/sır yok · §9 patron eşlemesi (N5-PATRON): her tür `NOTIFICATION_PATRON_MAP`te, `patronKind` bulut `KIND_RULES` anahtarı (dosya metninden) ya da `null` + gerekçe, haritada katalog dışı tür yok · §5d (N6) metinde sayı Türkçe ondalık (`0,8`), gruplamasız; yolda ham · §3d (D4-KUC3a) beyanlı ekransız görücü (`screenlessViewers`): gerekçe dolu, DNF'de tek başına, ekran requires'ında değil · §3e ⭐ cari kilit türleri `[shipping:write]` ile görünür, risk türü görünmez | ✗ (koşucu `_test` adı ister, bekçi DB'ye dokunmaz) | ✓B3 (bu commit) | S1 `panelEkran` → `yok/ekran` → §1 · §1b · §2 · §3 ❌ · S2 gövdeye `{tutar}` → §5 · §5c ❌ · S3 kilitli türde `varsayilan: "KAPALI"` → §4 ❌; üçü md5 ile geri alındı, 24/0 (2026-10-24) · S4 `patronKind: "yedek-yok"` → §9b ❌ · S5 `yazici.hata` satırı silindi → §9 ❌; md5 ile geri alındı, 28/0 (2026-10-25) · S6 render `forText` yok sayıldı (`String(v)`) → §5d ❌; md5 ile geri alındı, 29/0 (2026-10-26) · S7 (D4-I5, §0 19 tür; §8 yasak adlara limit/risk/amount/balance) `riskLimiti` payload beyanı → §8 · §5b ❌; geri alındı, 29/0 (2026-10-31) | · S8 (D4-KUC3a) `cari.kilitlendi` izinlerinden `[shipping:write]` çıkarıldı → §3d + §3e ❌ (29/2); geri alındı, 31/0 (2026-10-31)
| `Teks-Erp/scripts/test_bildirim_motoru.ts` | Bildirim motoru (N1-MOTOR): §0 dedupeKey/groupKey saf (pencere kovası · KOSUL · ALARM) · §1 rollback → outbox yok · §2 bayrak kapalı → emit no-op · §3 düşen tur attempts++, yeniden başlatma BİR kez işler · §4 pencerede 3 olay → count=3 · §5 10 paralel olay + 2 paralel dağıtıcı → tek satır count=10 · §6 aktör/varsayılan izinsiz/görmeyen/pasif almaz · §7 izin kaybı gizler, modül/kapı kapalı görmez · §8 evaluate hatası koşul kapatmaz · §9 KAPANDI → resolvedAt+okundu, yeniden açılan yeni satır · §10 budama süreleri · §11 gözetmen bayrakla başlatır/durdurur, pg_notify dürtmesi < 2 sn, koparılan LISTEN yeniden kurulur, durunca havuza döner · §12 günlük sayaç · §M 100×≥50 upsert ölçümü | ✓ | ✓B1 (bu commit) | aktör süzgeci etkisizleştirildi → §6a ❌ (35/1); yeniden dinleme çıkarıldı → §11e ❌; UNLISTEN/release çıkarıldı → §11f ❌; birebir geri alındı |
| `Teks-Erp/scripts/test_bildirim_tek_kaynak.ts` | Bildirim tek kaynak (AST): §1 outbox INSERT yalnız emit helper · UPDATE dağıtıcı · DELETE budama · §2 gelen kutusu + sayaç yazımı yalnız dağıtıcı · §3 koşul aç/kapa yalnız koşul tarayıcısı · §4 katalog `izinler`i yalnız görme helper'ı okur, kutuya dokunan dosya görme helper'ını import eder, dağıtıcı `visibleUsersFor` · §5 körlük zemini · §6 saf sondalar | ✗ | ✓K7 · ✓B1 (bu commit) | `order.service.ts`e ikinci outbox yazarı → §1 ❌ (13/1); sha256 ile geri alındı |
| `Teks-Erp/scripts/test_bildirim_api.ts` | Gelen kutusu API'si (N1-ZIL, süreç içi sunucu): §0 bayrak kapalı → `/ozet` 200 `{enabled:false}`, diğer uçlar 409 `BILDIRIM_KAPALI`, yazım yok · §1 özet okunmamış = liste `sayi` = cursor yürüyüşü (tek where), gizli tür yok · §2 cursor limit 2 ile tam bir kez, lastAt↓ · §3 paralel okundu → tek `degisti:true` · §4 başkasının / gizli türün satırı 404 · §5 ertele sekme geçişi · §6 tümünü okundu → ids, geri al yalnız kendi satırı · §7 `filter[tur]` görme kümesiyle kesişir, çıplak/bilinmeyen 400 · §8 katalog görülebilir türler | ✓ | ✓B1 (bu commit) | (a) özet sayımı ayrı where → §1a · §1b · §6b · §6e ❌ (32/4); (b) görme süzgeci where'den çıkarıldı → 8 ❌ (28/8); md5 ile geri alındı · §9 (N4-TABLET) satır süzgeçleri `filter[ozet]`/`filter[tablet]`/`filter[kanal]` sunucuda, `sayi` aynı where'den, satırda `sesli` = kanalTablet ∧ ses ayarı; bozuk değer 400 (sonda: `rowFlagWhere` boş → 4 ❌) |
| `Teks-Erp/scripts/test_bildirim_zil.ts` | İçeriksiz SSE zili (N1-ZIL, süreç içi sunucu + ham `node:http` istemcisi): §1 oturumsuz 401, bayrak kapalı 409 · §2 ⭐ `Accept-Encoding: gzip` ile `merhaba` < 1 sn, gövde sıkıştırılmamış, SSE başlıkları, içeriksiz yük · §3 ping · §4 6. akış en eskiyi kapatır, kopan akış sayaçtan düşer · §5 ⭐ emit → pg_notify → dağıtıcı → kanca → `zil` < 2 sn, içeriksiz · §6 uzun yoklama (eski rev hemen, güncel rev zil gelince) · §7 ⭐ gecikme tablosunda zil/bekle anahtarı yok (özet var) · §8 izin ataması `yetki`, oturum iptali `oturum` ile kapatır · §9 ⭐ `closeAll` akışları bitirir, yeni akış 503, ardından `server.close` < 1 sn; `server.ts` kapanışında zil dinleyicilerden önce | ✓ | ✓B1 (bu commit) | 1b compression filtresi + `no-transform` kaldırıldı → 19/6 (§2a "gelmedi"); 1a yalnız filtre → 25/0 (ikinci kat korur); latency muafiyeti → §7a ❌; yetki kancası → §8a ❌; `closeAll` boş → §9a · §9c ❌ (server.close 4000 ms); md5 ile geri alındı |
| `Teks-Erp/scripts/test_bildirim_patron_siparisi.ts` | Patron siparişi OLAY'ı (N1-OLAY, gerçek `processInboxMessage`): §0 AST — her OLAY türünün `src/`de tek yayma noktası, patron siparişininki `cloud-inbox.service.ts`te `$transaction` geri çağrısı içinde, literal tür katalogda, değişken türlü emit yalnız koşul tarayıcısında, tarayıcı sondası · §1 mesaj → sipariş + tek outbox satırı (aktör teknik kullanıcı); commit'te düşen sipariş tx'i → outbox yok; outbox INSERT'ü düşerse sipariş/makbuz doğmaz · §2 aynı mesaj (sıralı + eşzamanlı) → outbox değişmez · §3 600 sn kovada 3 sipariş → order:write sahibinde tek satır count=3, okuyucu/aktör almaz · §4 ret/çakışma → outbox yok · §5 bayrak kapalı → outbox yok · §6 payload yalnız katalog alanları, tutar yok | ✓ (sonda tetikleyicisi kurar/kaldırır) | ✓B1 (bu commit) | ① emit ayrı tx'e → §1c ❌ (14/1) · ② emit `prisma` ile tx dışına + ret yoluna → §0a · §0b · §1c · §4 ❌ (11/4); md5 ile geri alındı |
| `Teks-Erp/scripts/test_bildirim_yazici_hata.ts` | Yazıcı hatası OLAY'ı (izlenebilirlik A4, gerçek `reportPrintJob`/`recordPrintJob`): §0 AST — `yazici.hata` tek yayma noktası `print-job.service.ts`te `$transaction` içinde · §1 HATA raporu → tek satır + tek outbox (konu yazıcı, aktör basan), payload yalnız katalog alanları · §2 replay → outbox değişmez · §3 600 sn içinde aynı yazıcının iki hatası → izinli alıcıda tek satır count=2, izinsiz/aktör almaz · §4 ILETILDI/IPTAL/BELIRSIZ → outbox yok · §5 sunucu yolu aynı noktadan · §6 bayrak kapalı → satır doğar, outbox yok · §7 outbox düşerse satır da doğmaz | ✓ (sonda tetikleyicisi kurar/kaldırır) | ✓B1 (bu commit) | ① emit `prisma` ile tx dışına → §0b · §7 ❌ (9/2) · ② HATA erken dönüşü kaldırıldı → §4 ❌ (10/1); md5 ile geri alındı |
| `Teks-Erp/scripts/test_bildirim_kosul_sistem.ts` | Sistem koşul kaynakları (N1-KOSUL-SIS, tür 1–4; okuyucular sahteyle, tur gerçek tarayıcı + dağıtıcıdan): her tür için §a bozulur → tek ACILDI + tek kutu satırı · §b sürer (3 tur) → yeni satır yok · §e kaynak fırlatır → açık koşul AÇIK · §c düzelir → KAPANDI, kutu `resolvedAt` + katalog `cozuldu` metni · §d tekrar bozulur → YENİ koşul + YENİ kutu satırı · §f bulut kapalı → açılmaz/kapanır, yedek yapılandırılmamış ve onaylanmış güncelleme → koşul yok · §g ölçülemeyen kaynak (offsite henüz koşmadı · eşitleme ilk ölçüm yok · lisans durumu hazır değil) açık koşulu KORUR · §h tek hatalı eşitleme turu açmaz, art arda ikincisi açar · §i lisans bitişi ≤14 gün → `bitis-yakin` · §M gerçek okuyucularla evaluate süresi | ✓ | ✓B4 (bu commit) — evaluate hatası boş kümeye çevrildi → §e ×4 (+§c) ❌ · konu anahtarına tur damgası (bastırma yok) → §b ❌ · `acikKalsin` boş → §g ×3 ❌ · 8040 envanter satırı silindi → `test_advisory_lock_namespaces` ❌; md5 eşit geri alındı | 2026-10-25 |
| `Teks-Erp/scripts/test_bildirim_kosul_is.ts` | İş koşul kaynakları (N1-KOSUL-IS, tür 6–12; okuyucular sahteyle, karar gerçek koddan, tur gerçek tarayıcı + dağıtıcıdan): her tür için §a bozulur → tek ACILDI (+ modül görünürse tek kutu satırı) · §b sürer (3 tur) → türde tek ACILDI · §e okuyucu fırlatır → açık koşul AÇIK · §c düzelir → KAPANDI + `cozuldu` metni · §d yeniden açılır → YENİ koşul · §T termin geçince yaklaştı kapanır geçti açılır + pencere sınırı · §K KK1 fabrika günü dönüşü (konu `<kumas>:<gün>`), rol yokken koruma, `minMetre` ve eşik paramı · §F fason `daysOpen > gun` + firma kırılımı · §L levent `kalanGun ≤ param` · §G modül kapalı → küme boş · §Y gelen kutusu bayrağı kapalı → koşul tablosu boş · §R gerçek modül kapısı · §B boğaz-ikiz (AST: aynı helper, sayı sabiti beyanlı küme; çıktı: karne byItem/açık liste) · §S termin tek kaynak taraması · §M gerçek okuyucularla evaluate süresi · §W ilk açılış su damgası (servis yolundan kapat→aç: 807 birikmiş → 0 ACILDI/0 kutu, sonra 1 yeni → tek ACILDI; açık→açık damgayı düşürmez; taban turunda kaybolan sessiz kapanır) | ✓ | ✓B4 (bu commit) — sevkiyat konu anahtarına tur damgası → §b ❌ (türde 4 ACILDI) · `const ESIK = 85` → §B2 ❌ · `r.deadline!.getTime() < now` → §S ❌ · 8040 envanter satırı silindi → `test_advisory_lock_namespaces` ❌; md5 eşit geri alındı · N6 (2026-10-26) taban `continue` silindi → §W1 ❌ (807 ACILDI) · bayrak yazımındaki `resetNotificationBaselines` silindi → §W1 ❌ (83.928 kutu satırı); md5 eşit geri alındı | 2026-10-25 |
| `Teks-Erp/scripts/test_bildirim_alarm.ts` | Tezgah alarmı → bildirim kanalı (N2-ALARM, gerçek `runLoomAlarmOnce` + `ackLoomAlarm` + dağıtıcı): §a ⭐ LISTED donmuş alıcılar = gelen kutusu alıcıları (izinli ama listede olmayan almaz) · §b BY_PERMISSION → izin sahipleri, izinsiz almaz · §c RESOLVED → resolvedAt + okundu · §d ⭐ alarm tx'i geri alınınca outbox yok · §e ⭐ zil `alarm` (alarmRev +1, rev değişmez) · §f reason NOBET/ALARM_ALICISI · §g liste ∩ görme süzgeci · §h üstlenme GUNCELLENDI (sayaç/okunma korunur, payload durumu) · §i yeni kademe OLAY (sayaç artar) · §j rozet ALARM'ı saymaz, alarmAcik sayar · §k bayrak kapalı → outbox yok | ✓ | ① LISTED'de izin sahiplerini döndür (yeniden çözme) → §a/§f/§g/§h ❌ (11/4) · ② emit kök istemciyle (tx dışı) → §d ❌ · ③ alarm kullanıcıları `kutu` çalar → §e ❌; md5 ile geri alındı | 2026-10-25 |
| `Teks-Erp/scripts/test_bildirim_tercih.ts` | Tercih katmanı (N4-MOTOR): §1 saf `resolvePreference` — katman yok = katalog (bugünkü davranış) · fabrika KAPALI + kullanıcı açık → açık · HER_ZAMAN kilidi fabrika KAPALI'yı ve kullanıcı kapatmasını yok sayar · profil birleşimi (biri açık ⇒ açık, biri kilitli ⇒ kilitli) · NOBETTE kilidi yalnız nöbettekine · UYGULAMA ∧ OZET kapalı → MASAUSTU kapalı · görmeyen GIZLI · §2 sessiz saat fabrika diliminde (gece yarısını aşan aralık) · §3 teslim kararı: ⭐ donmuş alarm listesi girdi (LISTE eklenmez, girdi değişmez) · nöbetteki ALARM sessiz saati deler, nöbet dışı susar · alarmı kapatan nöbet dışı almaz, nöbetteki alır · UYGULAMA kapalı + OZET açık → `ozet=true` · §4 gerçek dağıtıcı: ⭐ tercih yokken F1 aynen · ⭐ tercih yokken masaüstü gönderimi yok, MASAUSTU'yu açan alır · kullanıcı açınca alır · TAKIPCI alır, BIRAKTI almaz · `yalnizTakip` daraltır · fabrika eşiği kaynağa yansır | ✓ | ① ALARM ek-kaynak kapısı kaldırıldı → §3a ❌ (23/1) · ② sessiz saat UTC'den → §2a §2b §3b ❌ (21/3) · ③ `varsayilan` kapsaması hep doğru → §1a §4a §4d ❌ (21/3) · ④ `resolvePreference` ilk ifadesi görme değil → `test_bildirim_tek_kaynak` §4d ❌; md5 ile geri alındı · ⑤ patron siparişinde katalog MASAUSTU varsayılanı geri açıldı → §1b §4a2 ❌ (23/2) | 2026-10-25 |
| `Teks-Erp/scripts/test_bildirim_tercih_api.ts` | Tercih uçları (N4-MOTOR, HTTP): §1 PUT ⭐ kilitli türde UYGULAMA kapatma 409 `NOTIFICATION_KIND_LOCKED` · görülemeyen tür 400 · kanal dışı 400 · tanınmayan/beyansız kapsam 400 · seyrek yazım (taban ve kilitli açık yazılmaz) · tam gövde · §2 varsayılana dön önizleme + yalnız kendi satırı · §3 ayarlar (kapalı küme 400, gidiş-dönüş) · §4 yönetici: izinsiz 403 · profil POST replay TEK kayıt · kilit önizlemesi doğru kişi · KILITLI hücre kilit+kaynak · arşiv 409 · arşivli profil çözüme katılmaz · eşik 400 · §5 bayrak kapalı 409 | ✓ | `planPreferenceRows` kilit kontrolü kaldırıldı → §1a ❌ (23/1); md5 ile geri alındı | 2026-10-25 |
| `Teks-Erp/scripts/test_bildirim_takip.ts` | Kayıt takibi (N4-MOTOR): §1 üç doğuş (sipariş · iş emri · dokuma işi) aynı tx'te TAKIP/OLUSTURAN; kullanıcısız doğuş yazmaz · §2 dönüş bayt-eşit (statik) · §3 GET/DELETE(BIRAKTI)/PUT(ELLE) · ⭐ BIRAKTI oluşturan otomatiğiyle ezilmez · göremeyen 404 · tanınmayan tür 400 | ✓ | `ON CONFLICT DO NOTHING` → `DO UPDATE SET state='TAKIP'` → §3c §3d ❌ (13/2); md5 ile geri alındı | 2026-10-25 |
| `Teks-Erp/scripts/test_bildirim_onizleme.ts` | Önizleme (Karar Y3): §1 tohumlu sayaç → haftalık bağımsız hesaba ±%10, kaynak `olcum` · §2 taslakta kapatılan tür düşer, taslak kaydedilmez · §3 ⭐ YAZMAZ (tercih/ayar/takip/gelen kutusu/sayaç sayımı önce = sonra) | ✓ | gün sayısı sabit 30 → §1a ❌ (4/1); md5 ile geri alındı | 2026-10-25 |
| `Electron/src/lib/bildirim/masaustu-tercih.test.ts` | N3 → F4 masaüstü geçişi: seçim = sunucu MASAUSTU ACIK ∪ eski anahtar (sıralı, tekil; eski sunucuda yalnız anahtar) · PUT gövdesi diğer kanal satırlarını ve kapsamı korur, görünmeyen türü göndermez, seçicideki türlerin MASAUSTU'sunu yeni kümeye yazar; `MasaustuBildirim.test.tsx` kart (F4: PUT + anahtar budama; eski sunucu: yalnız anahtar) ve köprü (hücrede ACIK tür listeye girer) | ✓ | birleşimden eski anahtar çıkarıldı → masaustu-tercih 2 ❌ (1/2) · köprü `hucreler`i yok saydı → MasaustuBildirim 1 ❌ (9/1); md5 ile geri alındı | 2026-10-25 |
| `mobil/src/services/bildirim/bellTransport.test.ts` | Tablet zil merdiveni (N4-TABLET): arka planda akış iptal, öne dönüşte rev→changed / epoch→full, SSE 404 → `/bekle` → 404 → `/ozet`, merhabasız 3 kopuş → uzun yoklama, bayrak kapalı → akış yok | — | (merdiven panel ikizi) | jest |
| `mobil/src/components/bildirim/NotificationBellButton.test.tsx` · `soundGate.test.ts` · `offline/bildirimMutations.test.ts` | Bayrak kapalı → zil/şerit/uç yok; `/ozet` 404 → çökme yok; şerit sunucu cevabını süzmeden gösterir; ses tekilliği; tercih kuyruğu tek taslak + operatör koruması | — | şerit istemci süzgeci → ❌ · 404'te zil → ❌ · kuyruk ikiledi → ❌ · kullanıcı kontrolü yok → ❌ | jest |
| `mobil/src/components/customerCode/customerCode.render.test.tsx` · `customerCodeLogic.test.ts` · `bindAttempt.test.ts` | D4-F4 tablet müşteri etiketi: okut-bağla başarı (kod + clientToken) · 409 TAKEN Türkçe mesaj · topta kod var → sebepli "Değiştir" · 409 AMBIGUOUS → DOĞRUDAN aday modalı (barkod · müşteri · metre), seçim iç barkodla sürer · eski backend (bayrak alanı yok / uç 404) → düğme gizli · izin yoksa düğme yok · token yalnız belirsiz hatada yapışır | — | ✓B4 (bu commit) — AMBIGUOUS dalında modal yerine ilk aday seçilince render testi ❌; geri alındı | jest |
| `mobil/src/components/customerCode/scanPoints.render.test.tsx` | D4-KUC3b F4 dışı okutma noktaları (Çuval Düzelt · İade Girişi): sahte backend tek boğazı taklit eder — müşteri barkodu → doğru top + "Müşteri barkodu X ile bulundu" notu · iç barkodda not yok · belirsiz kod (409 AMBIGUOUS) → aday modalı, seçim İÇ barkodla yeniden sorulur | — | ✓B1 (bu commit) — okutma boğaz ucu yerine iç barkod aramasına (`rollService.getByBarcode`) döndürülünce 4/5 ❌; geri alındı | jest |
| `mobil/src/screens/Modules/KursunQc/brodePiece.test.tsx` | GK-H1b brode adedi: `pieceInput` PIECE/STITCH iken "Brode adedi" alanı görünür ve adet çıkış okumasına (`meterOut.pieceCount`) girer · METER/eski backend alan yok, gövde anahtarsız · boş/0 adet istek göndermez · ekran bağlantısı (`pieceGatedTap`, sayaç açıkken alan) | — | ✓B1 (bu commit) — `pieceGatedTap` attach atlanınca §1/§1b ❌; `pieceInputOf` hep PIECE → §1b/§2/§4 ❌; geri alındı | jest |
| `mobil/src/screens/Modules/KursunQc/widthPrecheck.test.tsx` | D4-KUC3b gramaj tek dokunuşu: sınır dışı ölçülen en (sunucu `widthLimit`, istemcide eşik yok) istek/kilit/şerit olmadan Türkçe uyarı · sınırdaki en gider · eşik 25 sınırı sunucudan · sınır yoksa (eski backend) ön-denetim yok · boş en anahtarsız | — | ✓B1 (bu commit) — `useGramajTap` precheck kaldırılınca §1 ❌; geri alındı | jest |
| `mobil/src/components/customerCode/scanPointsKalan.render.test.tsx` | D4-KUC3d kalan okutma noktaları (Depo · Fason Sevk · Hızlı Sipariş · Hızlı İş Emri top ekleme; hepsi `GET /rolls/barcode/:code` = `findRollByBarcode`, tek boğaz): belirsiz müşteri barkodu (409 AMBIGUOUS) → aday modalı, seçim İÇ barkodla yeniden sorulur · müşteri koduyla bulunan topta not · eski backend 404 → modal yok. Parti Ekle ve bağımsız Muayene aynı kabulle `WorkOrderAddBatchSheet.test.tsx` / `InspectionScreen.test.tsx` içinde; Çuval Düzelt taşıma dalı `scanPoints.render.test.tsx`; KursunQc ekran bağlantısı `widthPrecheck.test.tsx` §8 | — | ✓B1 (f236feb66/671dbee80) — her noktada `intercept` bağlantısı kaldırılınca o noktanın ⭐ testi ❌ (6/6 + taşıma dalı); `widthGatedTap` precheck kaldırılınca §1 ❌, ekranda ham `complete:` dönünce §8 ❌; geri alındı | jest |
| `Teks-Erp/scripts/test_bildirim_cari.ts` | Cari bildirimleri (D4-I5; gerçek `cariHoldService` + gerçek tarayıcı/dağıtıcı): §0 AST — `cari.kilitlendi`/`cari.kilit-acildi` TEK yayma noktası `cari-hold.service.ts`, `$transaction` İÇİNDE · `notification-sources/` altında risk yüklemi kopyası yok (`riskLimit` okuması / Decimal `.gt/.lt/.cmp`), `cari.ts` `riskExposureTx` + `.exceeded` · §1 koy → tek OLAY, ⭐ token replay ikinci bildirim yok, aktif kilitte 409 bildirimsiz, yük = beyan (tutar/serbest metin yok) · §2 ⭐ finance:read'li görür, finance:read'siz (shipping:write) görmez · §3 aç → tek OLAY, ikinci açma 409 bildirimsiz, açan kendine almaz · §4 KOSUL: ⭐ ilk tur sessiz taban · tabandan sonra yeni aşım tek ACILDI · sürer → yeni yok · limitsiz cari yok · okuyucu fırlatır → açık kalır · limit içine → KAPANDI + `cozuldu` · ön muhasebe kapalı → boş · ⭐ yükte bakiye/limit yok · (D4-KUC3a) §2b sevkçi (shipping:write) kilidi GÖRÜR · §2c derin bağlantı `?focus=<hesapId>` · §3c açılış sevkçiye de gider | ✓ | ① `cari.ts` yüküne `bakiye` → §4h ❌ (23/1); katalogda `riskLimiti` beyanı → `test_bildirim_katalogu` §8 + §5b ❌ (27/2) · ② is.ts'e `riskLimit` + `.gt(` kopya yüklem → §0c ❌ (23/1); geri alındı · ③ (D4-KUC3a) katalog `[shipping:write]` görme DNF'si çıkarılınca `test_bildirim_katalogu` §3d/§3e ❌ | 2026-10-31 |
| `Teks-Erp/scripts/test_bildirim_sevke_hazir.ts` | Sevke hazır bildirimi (D4-J2; gerçek `computeReadyWorks` + gerçek tarayıcı/dağıtıcı): §0 AST — `notification-sources/` altında hazırlık yüklemi kopyası yok (sınıflayıcı/statü kümesi/statü literal'i/sayaç kıyası), `is.ts` `computeReadyWorks(unit, await effectiveShipReadyPolicy())` okur ve yalnız `state`e bakar · §1 ⭐ `notifyUnits` boş → konu/koşul/outbox 0, tek ayar sorgusu · §2 {PARTI}: ilk tur sessiz taban · READY'ye geçen parti tek ACILDI · sürer → yeni yok · PARTIAL konu değil · periyot (`scanMinutes`) dolmadan koşul korunur · top geri açılınca KAPANDI + `cozuldu` · yük = beyan (tutar yok) · shipping:read'li alır, almayan almaz · §3 gelen belge kapalı → PARTI konusu yok · §4 ⭐ sorgu bütçesi 1 ↔ 4 parti EŞİT ve ≤ 9 (S15c-d1: belge toplamı JIT kapalı tek işlemde, sabit +3) · §5 ⭐ (D4-KUC3a) gelen belge modülü kapalıdan açığa: yazım taban damgasını düşürür, ilk tur sessiz (toplu ACILDI yok), açıkken yeniden kayıt / yalnız IE açıkken damga korunur | ✓ | ① `is.ts` süzgeci `r.readyCount > 0 && r.state !== "PARTIAL"` (kopya yüklem) → §0a + §0c ❌ (13/2) · ② döngüye satır başı `prisma.customer.count()` → §4 ❌ 6 ↔ 9 (14/1) · ③ `readShippingReadyNotifyUnits` kayıtsızda `["PARTI"]` → §1 ❌ (14/1); üçü geri alındı, 15/0 · ④ (D4-KUC3a) `setFeatureFlags`teki `resetReadyBaselineOnIncomingDocOpen` çağrısı etkisizleştirildi → §5a + §5b ❌ (`opened:5` toplu bildirim; 21/2); geri alındı, 23/0 | 2026-10-31 |
[bekci-harita/bildirim.md](bekci-harita/bildirim.md)

## maliyet

[bekci-harita/maliyet.md](bekci-harita/maliyet.md)
