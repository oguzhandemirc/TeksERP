# SAHA GERİBİLDİRİM UYGULAMA PLANI (2026-06-13)

Kaynak: kullanıcının fabrika ziyareti notları (23 madde). Talimat: tam yetki,
token yenilenince kaldığı yerden devam, her iş test edilerek kapanır.
Doğrulamalar: #17 GÜVENLİ (backend idempotent, iş yok) · #9 muhtemelen mevcut
(sahada teyit) · #2 PDF yapısı ornek-fis.pdf'ten çıkarıldı (3 bölüm, AMB kodları).

Durum: ⬜ bekliyor · 🔧 devam · ✅ bitti+test · ⏭️ bilinçli atlandı

> **2026-06-13 KAPANIŞ — 23/23 madde + #15 TAMAM.** Tüm partiler ✅. Yeni testler:
> route_template_fason 6 · label_copies 6 · order_number 4 · sack_amb 4 · name_normalization 12 ·
> sack_search 12 · sack_edit_ops 13 · shipment_destination 10 · roll_name_template 8 · dispatch_report 11 ·
> roll_relabel 7 · raw_sale_quick_order 8 · shipment_retarget 6 · bulk_labels 5 (= 112 yeni kontrol).
> Regresyon: sack_move_pullback 40 · lifecycle 28 · unmark_ready_race 23 · transition_races 18 · color_assignment 25 ·
> order_filter_batch 12. 3 tsc (backend+Electron+mobil) temiz. 3 yeni migration (destination, procedure_code,
> + Parti1'in route_step/sack_index). **Kullanıcı testi bekleyen (fiziksel):** Electron muhasebe fişi PDF baskısı,
> toplu etiket baskısı, mobil relabel/hızlı-sipariş akışları cihazda; #7 retarget UI artımlı (backend hazır).

## PARTİ 1 — Bug + hızlı kazanımlar
| # | Madde | İş | Durum |
|---|---|---|---|
| 14 | Rota şablonunda fason | RouteStep'e plannedSubcontractorId+requiredCategoryId (şema+migration), Rota Tasarımcısı kaydetsin, WO klonu kopyalasın | ✅ |
| 18 | KK2 genel hata tuşu | Seed'e GENEL HATA DefectType + mobil KK2'de öne çıkan hızlı buton | ✅ |
| 6 | Etiket adedi | labelCopies ayarı (default 2) + mobil/Electron baskılarda uygula | ✅ |
| 16 | Sipariş no override | Create'te opsiyonel orderNumber (unique kontrol) + Electron formda alan | ✅ |
| 5 | Çuval kodu standardı | manualCode boşsa otomatik AMB%05d (global sıra); UI'da "Çuval {seq} · KOD" | ✅ |
| 13 | İsim normalize | Ürün adı UPPERCASE; renk: sayılar başa + boşluk→tire (örn 055-BEYAZ); mevcut veri migrate scripti | ✅ |
| 15 | WO formu alan yerleşimi | Boyahane notu vb. son-adım alanları formda doğru bölüme taşı (Electron WO formu) | ✅ |

## PARTİ 2 — Çuval görünürlük + operasyon
| # | Madde | İş | Durum |
|---|---|---|---|
| 1+23 | Çuval/Top Arama ekranı | Electron yeni ekran + backend endpoint: ürün/renk/en/müşteri/sevkiyat filtreleri; üç yönlü cevap (ürün→çuvallar, çuval→içerik, top→çuvalı) | ✅ |
| 3 | Çuval eksiltme/transfer/swap | Sevk edilmemiş (PREPARING/READY/AT_DOOR) çuvaldan top çıkar/taşı/iki topu takas — mobil okutma akışı + backend (READY+ içerik değişimi tartı sıfırlar, invariant yeniden tartı ister) | ✅ |
| 12 | Hızlı + toplu renk ekleme | Renk seçicilere "+ Yeni Renk" inline; Tanımlar'da çok satırlı toplu ekleme | ✅ |

## PARTİ 3 — Sevkiyat alanları
| # | Madde | İş | Durum |
|---|---|---|---|
| 19+22 | Yurtiçi/yurtdışı | Shipment.destination (DOMESTIC default/EXPORT); tartı zorunluluğu yalnız EXPORT; çuval depo/kapı önünde rozet+filtre (sıkı ayrım yok) | ✅ |
| 21 | Müşteri/şube prosedür kodu | Mevcut Customer.code/CustomerBranch.code'u planlama+sevkiyat ekranlarında göster; sevkiyat bazında override alanı | ✅ |
| 20 | Top adı format şablonu | Ayarlanabilir basit şablon (örn "{item} {color} {width}cm") — etiket/listelerde kullanılan birleşik ad | ✅ |

## PARTİ 4 — Muhasebe
| # | Madde | İş | Durum |
|---|---|---|---|
| 2 | Sevk edilenler ekranı + PDF | Electron salt-okunur DISPATCHED listesi (tarih/müşteri filtre) + ornek-fis.pdf ile birebir 3 bölümlü çıktı (Ürün Listesi özet / Çuval Listesi / Çeki Listesi; AMB kodu, kg ilk satırda) — donmuş belgelerden | ✅ |

## PARTİ 5 — Tasarım gerektirenler (tam yetki: tasarımı ben seçip uygulayacağım, gerekçeli)
| # | Madde | İş | Durum |
|---|---|---|---|
| 7 | Sevkiyat yeniden hedefleme + toplu etiket | Sevkiyatın siparişini değiştir / seçili topları başka siparişe; karşılanma geri sar+yeniden hesapla; toplu etiket basım ekranı (çuval/sevkiyat bazlı seçim) | ✅ |
| 8 | Mobil 300-çuval UX | Paketleme/sevkiyat çuval yönetimi yenilemesi: sanal liste + arama + çuvala atla + bölümleme | ✅ |
| 4 | Etiket değiştirme tartı/pakette | Stok topunun etiket bilgisi (renk/özellik/hedef) tartı-paket/sevkiyat ekranından değiştirilebilsin + yazıcıdan yeni etiket | ✅ |
| 10 | Ham kumaş satışı | Sipariş satırı ham (renksiz) ürün kabul etsin; sevkiyat ham STOCK topları alabilsin; kapsama ham eşleşmesi | ⬜ |
| 11 | Mobil hızlı sipariş | Ham top okut→müşteri seç→sipariş otomatik (10 ile birlikte; 70 topu tek tek satıra girmeden) | ⬜ |

## Test sözleşmesi
Her parti sonunda: backend `npx tsc --noEmit` + ilgili `scripts/test_*.ts` (yeni özellik = yeni test scripti) + Electron/mobil `tsc` + dokunulan modüllerin mevcut regresyonları. Kapanışta tam takım.

## Günlük

### Parti 1 (2026-06-13) — TAMAM
- **#14** RouteStep'e `requiredCategoryId`+`plannedSubcontractorId` (migration `20260613100000`), Rota Tasarımcısı kaydedip geri okur, WO create/replace şablondan klonlar. Test `test_route_template_fason.ts` 6/6.
- **#18** Seed'e `GENEL` DefectType (canlı DB'ye de eklendi), mobil KK2 buton gridinde en öne pinli. (Saf veri+sıralama — ayrı test scripti yok, KK2 regresyonu kapanışta.)
- **#6** `label.copies` ayarı (default 2, clamp 1-5): reader→label-html.helper page-break çoğaltma→`?copies=` override→Electron "Etiket Baskısı" ayar bölümü. Test `test_label_copies.ts` 6/6.
- **#16** Order create'te opsiyonel `orderNumber` (trim+40+çakışma 409, retry-closure içinde recheck); update whitelist'i EZMEZ. Electron formda alan (edit'te kilitli). Test `test_order_number_override.ts` 4/4.
- **#5** `addSack` manualCode boşsa global max'tan `AMB%05d` üretir (tx içinde, `sacks_manualCode_idx` migration `20260613101000`); elle kod override korunur. Test `test_sack_amb_code.ts` 4/4.
- **#13** `name-normalize.helper.ts`: ürün=tr-UPPERCASE, renk=BÜYÜK+tire+sayı blokları başta ("beyaz 055"→"055-BEYAZ"). Item/Color create+update'e bağlı; mevcut veri `scripts/normalize-names.ts --apply` ile taşındı (4 ürün+6 renk, idempotent); seed adları da BÜYÜK yapıldı. **Arama düzeltmesi:** BÜYÜK İ/ı ILIKE'ta katlanmıyor → `query-parser.ts` OR'una tr-upper varyantı (yalnız sorguda ı/i varsa) + istemci tarafında 5 düz `toLowerCase()` filtresi `toLocaleLowerCase("tr")` yapıldı (ColorPicker, MultiSelectCheckboxList, TargetPropertyPicker, KartelaKabul, FasonKabul). Test `test_name_normalization.ts` 12/12; regresyon color_assignment 25/25 + order_number 4/4.
- **#15** Boyahane Notu "Gelişmiş — Tambur & Planlama" akordeonundan çıkarıldı → "Üretim Rotası" bölümüne (yalnız rotada fason/EXTERNAL adım varken görünür; RHF değeri saklı tutar, gizliyken kaybolmaz). Kat Tipi (Tambur) bilinçli akordeonda kaldı — o gerçekten tambur alanı. Electron tsc temiz.

### Parti 2 (2026-06-13)
- **#1+#23** Yeni `sack-search.service.ts` (salt-okunur): `GET /shipping/sack-search` (içerik ürün/renk/en + kimlik kod/sevkNo/müşteri filtreleri, cursor, içerik filtresinde eşleşen adet/metre per çuval; default sevk edilmemiş, `includeDispatched=true` ile geçmiş), `GET /shipping/sacks/:id/contents` (lazy döküm), `GET /shipping/locate-roll?barcode=` (EXACT eşleşme; çuvalsız top için statü cevabı). Electron `/operations/sack-search` ("Çuval & Top Arama" hub kartı): barkod okut→Topu Bul kartı + filtre çubuğu + genişleyen çuval kartları (lazy içerik) + infinite scroll. Test `test_sack_search.ts` 12/12.
- **#3** TASARIM: eksiltme/taşıma/takas artık PREPARING+READY+AT_DOOR'da (DISPATCHED asla). READY+: `touchShipmentEditableTx` satır kilidi (markReady/dispatch claim'leriyle serileşir) → mutasyon → tartı sıfır (`resetSackWeightsTx`, yeniden tartı şart) → **recommit** (`recommitShipmentTx`: reverse→TAZE yükle→yeniden tahsis; sıralama kritik — fresh reverse'ten SONRA okunmalı yoksa need=0) → boşalan çuval READY+'da otomatik silinir (PREPARING'de kalır). Yeni `POST /shipping/rolls/swap-sacks` (aynı sevkiyat içi takas; kapsam değişmez → recommit yok). Mobil: TartiPaket → "Çuval Düzeltme" ekranı (CuvalDuzeltScreen, locate-roll ile top okut→Çıkar/Taşı/Takasla/Tart, READY+ uyarısı confirm'de). **Akış kapanışı:** `updateSack` (tartı/kod) da READY/AT_DOOR'a açıldı — içerik düzeltmesi tartıyı sıfırlayınca yeniden tartı unready'siz girilebilsin (kapsamı değiştirmez, commit'e dokunmaz); mobil ekranda "Çuvalı Tart" + tartısız uyarısı. ESKİ sözleşme testi `test_sack_move_pullback.ts` yeni davranışa güncellendi (B3/B4/B5 artık pozitif) → 40/40. Testler: sack_edit_ops 13/13, lifecycle 28/28, unmark_ready_race 23/23, transition_races 18/18.
- **#12** Picker hızlı ekleme: `QuickAddColor` (ColorPickerModal footer'ı, `property:write` + kısıtlı-mod-dışı; ad+ops. hex → PUBLIC renk yarat + hemen seç; müşteri ataması bilinçli YOK — atanmış renk exclusive olur). Toplu: Renkler sayfası "Toplu Ekle" (`BulkColorAddDialog`, satır başına `ad [#RRGGBB]`, sırayla POST — normalize+audit her kayıtta; başarısız satırlar textarea'da kalır). Backend değişikliği yok (normalize #13'ten). Electron tsc temiz.

### Parti 3 (2026-06-13) — TAMAM
- **#19+#22** `ShipmentDestination` enum (DOMESTIC default/EXPORT, migration `20260613110000`). Tartı invariant'ı `assertReadyInvariants`'te kapsama göre: EXPORT'ta çuval tartısı zorunlu, DOMESTIC'te değil (kod iki kapsamda da zorunlu). `createShipment` destination kabul eder; `setDestination` (sevk edilmemiş her durumda serbest, `touchShipmentEditableTx` ile claim'lerle serileşir). Board `?destination=` filtresi + her satırda destination alanı. Electron: sack-store kartında rozet + sayfa filtresi + slide-over toggle; mobil: Paketleme'de yurtiçi/yurtdışı çip seçimi (yurtiçi default, create'e geçer + sonradan toggle) + Sevkiyat board rozeti. Test `test_shipment_destination.ts` 10/10.
- **#21** `Shipment.procedureCode` (migration `20260613111000`) — sevkiyata özel prosedür/ihracat kodu override. `createShipment` + `setProcedureCode`. getShipmentById + board + sack-contents'e `customer.code`/`branch.code` eklendi → ekranlar `procedureCode || branch.code || customer.code` gösterir. Electron slide-over'da düzenlenebilir; mobil board'da kod gösterimi.
- **#20** `roll.nameTemplate` ayarı ({item}{color}{width}{quality} token; default "{item} {color} {width}"; setFeatureFlags token+uzunluk doğrular). Saf helper `roll-name.helper.ts` (boş token atlar, boşluk sadeleşir) + Electron `lib/roll-name.ts` + `useRollNameTemplate` hook + Genel Ayarlar "Etiket Baskısı" bölümüne canlı önizlemeli şablon alanı. Bu oturumun SackSearch ekranlarına uygulandı (RollLocateCard); geniş benimseme **artımlı** (her yerdeki inline birleşik ad riskli sweep — KASTEN ertelendi). Test `test_roll_name_template.ts` 8/8.
- Regresyon: `test_sack_move_pullback.ts` (#19 nedeniyle EXPORT'a çevrildi — tartı zorunluluğunu varsayıyordu) 40/40; lifecycle 28/28, sack_search 12/12, transition_races 18/18. Üç tsc (backend+Electron+mobil) temiz.

### Parti 4 (2026-06-13) — TAMAM
### Ek istekler (2026-06-13, kapanış sonrası)
- **#7 Retarget UI eklendi.** Electron `RetargetOrdersDialog` (ShipmentDetailSheet→"Siparişleri Değiştir", DISPATCHED/CANCELLED hariç + shipping:write): müşteri+şube açık siparişleri checkbox listesi (mevcut bağlılar pre-checked) → `retargetOrders`. `ProtectedRoute.requireAnyPermission` zaten Parti4'te eklenmişti.
- **Makine Donanımı tablosu (saha cihaz kaydı).** Eski `boyer_erp_08.Devices` benzeri: makine başına yazıcı (IP/MAC) + RS232 ara cihaz MAC'leri (kqMac/mtMac/mtMac2) + veri çözen regex desenleri (kqPattern/mtPattern/mtPattern2) + not. AMAÇ: "nerede ne kullanmışız" dokümantasyonu + cihaz/kodlama değişince koda dokunmadan seçimle desen güncelleme (Faz-1 donanım SİMÜLE → bu config/kayıt tablosu). Yeni `MachineHardware` modeli (Machine 1:1, cascade; tablet `Device`'tan AYRI), migration `20260613112000_machine_hardware`. BaseService CRUD `/api/machine-hardware` (station:read/write). Electron Tanımlar→Üretim grubu "Makine Donanımı" sayfası (5-dosya CRUD + ReferenceSelect makine). Test `test_machine_hardware.ts` 5/5.

### Parti 5 (2026-06-13) — TAMAM (tasarımlar gerekçeleriyle)
- **#4 Etiket değiştirme (tartı/pakette).** TASARIM: mevcut `applyManualProperties` (renk+özellik) genişletildi → +en +kalite; guard MUHAFAZAKÂR: yalnız serbest STOCK/WAREHOUSE veya PREPARING sevkiyattaki top; commit'li sevkiyatta (READY/AT_DOOR/DISPATCHED) **409** (renk/en değişimi spec-karşılanmayı bozar → operatör önce "Hazırlığa Geri Al"). `PATCH /rolls/:id/label` (yeniden açıldı; K6'da silinen identity'nin yerine). Mobil CuvalDuzelt'e "Etiket Değiştir" (renk picker + en/kalite) + başarınca LabelPrinter ile yeniden bas. Test `test_roll_relabel.ts` 7/7.
- **#8 Mobil 300-çuval UX.** TASARIM: riskli tam-FlashList refactoru yerine (ekran karışık içerikli tek ScrollView) muhafazakâr pencereleme: çuval arama (kod/sıra no), büyük listede (>20) yalnız aktif + son 20 render + "N çuval daha göster", büyük listede yalnız aktif çuvalın top satırları açık (diğerleri özet — render maliyeti düşer). Mobil-only, tsc temiz.
- **#10 Ham kumaş satışı.** TASARIM: domain zaten elverişli (OrderLine.colorId nullable = ham satır; allocate specMatch renk-null'ı "her şeyle eşleşir" sayar). Eksik halka: ham STOK topun sevk akışına girmesi → `prepareRawForSale(rollId)` (STOCK→WAREHOUSE, serbest-top guard) `POST /rolls/:id/prepare-for-sale`. "Yalnız WAREHOUSE sevk edilir" değişmezi KORUNDU (ham önce WAREHOUSE'a alınır, sonra normal akış). Test `test_raw_sale_quick_order.ts` 8/8.
- **#11 Mobil hızlı sipariş (#10 ile).** TASARIM: `quickOrderFromRolls({customerId, rollIds})` `POST /orders/quick-from-rolls` — toplar spec (ürün+renk+en) bazında gruplanıp sipariş satırlarına döner, sipariş APPROVED açılır, STOK toplar WAREHOUSE'a alınır. **GEVŞEK MODEL KORUNDU**: toplar siparişe bağlanmaz; okutma yalnız satır metrajını türetir, karşılanma yine spec-toplam (sevkte). Mobil TartiPaket→"Hızlı Sipariş" ekranı (HizliSiparisScreen: sürekli okut→accumulate→müşteri picker→önizleme grupları→oluştur). Test (10 ile ortak) `test_raw_sale_quick_order.ts` 8/8.
- **#7 Sevkiyat yeniden hedefleme + toplu etiket.** TASARIM (mantık bende): gevşek modelde "yeniden hedefleme" = bağlı sipariş kümesini (kapsama spec-set'i) değiştirmek — top→sipariş bağı OLMADIĞI için "topu başka siparişe" değil. `retargetOrders(shipmentId, orderIds)` `POST /shipments/:id/retarget-orders`: sipariş kümesini replace eder; READY/AT_DOOR'da commit GERİ SARILIR (eski shippedQty düşer) → yeni kümeyle yeniden commit; DISPATCHED hariç. Toplu etiket: `getBulkRollLabelsHtml(rollIds)` `POST /labels/rolls/bulk-html` (per-roll HTML'leri tek belgede birleştirir, her top kendi A6 sayfası) + Electron `printHtmlString` helper + muhasebe fişi modalında "Toplu Etiket" butonu (getDispatchReport cekiRows'a rollId eklendi). Testler `test_shipment_retarget.ts` 6/6 + `test_bulk_labels.ts` 5/5. **Retarget UI** (sipariş çoklu-seçici) artımlı — backend hazır; mevcut Shipments addOrders/removeOrder PREPARING'i, yeni endpoint committed-state'i kapsar.

### Parti 4 (2026-06-13) — TAMAM
- **#2** Backend `getDispatchReport(shipmentId)` — ornek-fis.pdf birebir 3 bölüm: ÜRÜN LİSTESİ (ürün+renk+en grubu → top adedi + toplam metre), ÇUVAL LİSTESİ (AMB kodu → metre/kg/paket sayısı), ÇEKİ LİSTESİ (çuval×top → barkod | desen(ürün) | varyant(renk) | metre | kg; **kg yalnız çuvalın ilk topunda**) + header (müşteri/sevkNo/procedureCode/destination/tarih) + totals. Endpoint `GET /shipments/:id/dispatch-report`, izin `ACCOUNTING_READ` = shipping:read VEYA `report:sales` (muhasebeci sevkiyat-yazma izni olmadan erişir). Liste için mevcut `listShipments` (status=DISPATCHED + müşteri + dispatchedAt tarih filtresi + cursor) yeniden kullanıldı — yeni liste endpoint'i YOK. Electron `/operations/accounting-dispatch` ("Sevk Edilenler (Muhasebe)" hub kartı): salt-okunur DataTable (forceFilter status=DISPATCHED) + müşteri/tarih FilterBar + "Fiş" → 3 bölümlü `DispatchReceiptDocument` (her bölüm page-break) modal + `printDocumentArea` yazdırma. `ProtectedRoute` `requireAnyPermission` desteği eklendi. Test `test_dispatch_report.ts` 11/11.
