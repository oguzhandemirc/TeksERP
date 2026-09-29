# Patron bulutu — eşitleme sözleşmesi v1 (B1 · B3 protokolleri)

> **Durum:** B1 TASARIM dilimi (2026-09-29) — **bağlayıcı sözleşme TASLAĞI**; üretim kodu YOK. B1-kod (fabrika `Teks-Erp/src/cloud-sync/`), B2 (`patron/sunucu`) ve B3 (gelen kutusu) dilimleri buna karşı yazılır. Onaydan sonra `LISANS-PROTOKOLU.md` gibi DONAR; değişiklik bu belgenin §14'üne sapma satırıyla girer.
> **Üst belgeler:** `docs/design/PATRON-BULUTU.md` (Plan B, kullanıcı kararları) · `docs/design/LISANS-PROTOKOLU.md` (imza biçimi, İSTEK, zil konuları, `esitle` amacı, KİRA'daki `esitlemeAraligiDk`/`patronBulutBitis`). Çelişkide plan kazanır; bu belgenin plandan bilinçli sapmaları §14'te.
> **Tek kaynak geçişi (TAMAMLANDI, B1-kod 2026-09-29):** §3'ün makinece okunur hâli artık KODDUR — `Teks-Erp/src/cloud-sync/projections.ts` (+ `catalog-facts.ts`, `projection-types.ts`); ölçüm betiklerinin `scripts/olcum/patron-katalog.ts`i yalnız onun Türkçe görünümüdür. Bu belgenin §3 tabloları tasarım anının dökümüdür; farkta KOD kazanır (sapmalar §14 S13–S25).
> **Ölçüm:** üç betik (§15) — kataloğu ŞEMAYA (`patron-sema-olcumu`), KODA (`patron-yazim-noktalari`) ve HACME (`patron-hacim-olcumu`) karşı ölçer. Bu belgedeki bütün sayılar 2026-09-29'da `tekserp_patb1_test` (363 migration, seed + bekçi fikstürü — fabrika verisi YOK) üzerinde basıldı.

## 0. Sözlük ve adlandırma

| Terim | Anlam |
|---|---|
| **Projeksiyon** | Buluta giden OPT-IN bir görünüm. `KAYIT` = satır satır (kök tablo + id), `ANLIK` = her turda bütünüyle yeniden hesaplanan toplam. |
| **BOYUT / OLGU** | BOYUT = ad/kod sözlüğü (ürün, renk, cari kart…); OLGU = iş kaydı (sipariş, sevkiyat, fatura…). OLGU boyuta yalnız id ile işaret eder. |
| **tel** | Paketteki alan adı (Türkçe, sözleşmedir). `kaynak` = fabrika DB kolonu. Fabrika kolonu yeniden adlandırılsa da tel adı değişmez. |
| **Filigran** | Değişiklik tespitinin kaldığı yer: `(zaman, eşitlik bozucu)` çifti. |
| **Güvenli ufuk (H)** | Bir turda okunabilecek en geç zaman; kendisinden önce başlamış açık tx kalmamış an (§4.1). |
| **İşaret** | DB tetikleyicisinin `sync_marks` tablosuna yazdığı `SILINDI` / `KIRLI` satırı (§4.3–4.4). |
| **Tur** | Eşitleme işinin bir koşumu (aralık kiradan; zil `ozet` ile anında). |
| **Paket** | Bir turun buluta giden, imzalı, gzip'li, idempotent gövdesi (§6). |

Adlandırma (kök kural): `src`'de yeni bildirim adları İNGİLİZCE; tel/şema anahtarları, kod değerleri, kullanıcı metinleri Türkçe. Plan adı → kod adı:

| Plan / belge adı | Kod adı (fabrika) | Tablo |
|---|---|---|
| EsitlemeSilmeDamgasi (plan) → eşitleme işareti | `SyncMark` | `sync_marks` |
| eşitleme filigranı | `SyncWatermark` | `sync_watermarks` |
| BulutGelenKutusuMakbuzu (plan) | `CloudInboxReceipt` | `cloud_inbox_receipts` |
| eşitleme işi | `jobs/cloud-sync.job.ts` · `jobs/cloud-inbox.job.ts` | — |
| projeksiyon kataloğu | `src/cloud-sync/projections.ts` | — |

Bulut tarafı (`patron/sunucu`) kendi alt projesidir; tablo/kolon adları orada da İngilizce, tel anahtarları Türkçe (§9).

## 1. Değişmezler (bu belgenin kuralları)

1. **Fabrika tek yazardır, bulut hesap yapmaz.** Türetilmiş her alan (açık miktar, bakiye, gecikmiş, toplam metre) fabrikadaki TEK KAYNAK yardımcıyla hesaplanıp projeksiyona girer; bulut saklar, süzer, sıralar, gösterir — aritmetik yapmaz (tarih karşılaştırması dahil: "gecikmiş" fabrikadan gelir, §4.3c).
2. **Kolon listesi OPT-IN'dir.** Katalogda yazmayan kolon gitmez; blocklist yoktur. `ANLIK` projeksiyonlar da opt-in'dir: servis çıktısı katı (strict) tel şemasından geçer, tanınmayan anahtar DÜŞER (ör. istasyon canlı durumundaki operatör adı).
3. **Değişiklik tespiti audit'ten türetilmez** (kök kural: audit yalnız ayak izidir). Kaynaklar: `updatedAt`/`createdAt` filigranı, `sync_marks` işaretleri, `merge_operations` defteri.
4. **`patron-bulut` bir ÖN KOŞULDUR, tavan değil — FAIL-CLOSED.** Eşitleme yalnız şu dördü birden doğruyken çalışır: kullanılabilir HAK `sinif = URETIM` ∧ `HAK.moduller ∋ "patron-bulut"` ∧ son geçerli kirada `patronBulutBitis > şimdi` ∧ `devredildi = false`. Belirsizlik (ÖLÇÜLEMEDİ, etkinleşmemiş, HAK yok) GÖNDERMEZ. Bu, modül tavanının belirsizlikte fail-open davranışının BİLİNÇLİ tersidir: tavan bugünkü davranışı korur, eşitleme ise yeni bir dışarı veri kanalıdır — varsayılanı "gitmez"dir.
5. **Aralık ve aç/kapa KİRADAN gelir** (`esitlemeAraligiDk`, `patronBulutBitis`), yerel DB ayarından değil — döküm taşınınca taşınmasın, yerel yönetici değiştiremesin. `esitlemeAraligiDk = null` ⇒ eşitleme kapalı.
6. **Lisans kademesi eşitlemeyi durdurmaz** (veri erişimi her kademede açıktır — `lisans.md` çekirdek kuralı); durduran yalnız §1.4'ün koşullarıdır. Gelen kutusu ise YAZMADIR ve `licenseGate` ile aynı yüklemden geçer (§8.6).
7. **Her dış çağrı kurulum anahtarıyla imzalı İSTEK'tir** (`amac: "esitle"`); imzasız dış çağrı yazılmaz.
8. **Ters yol:** bulut hiçbir fabrika satırını değiştiremez; tek yazma kanalı gelen kutusudur ve fabrikada NORMAL servis yolundan, idempotent geçer.

## 2. Akış

```
fabrika backend süreci (tek process)                           patron-bulut (VDS, ayrı konteyner + DB)
─────────────────────────────────────                           ─────────────────────────────────────────
jobs/cloud-sync.job.ts  (aralık: kira.esitlemeAraligiDk)
  ① ön koşul (§1.4) — yoksa tur YOK
  ② H = güvenli ufuk (§4.1)
  ③ her filigran kaynağından (w, H] → kirli kök kimlikleri
  ④ sync_marks (w, H] → SILINDI / KIRLI
  ⑤ merge_operations (w, H] → kirli kökler (§4.5)
  ⑥ kökleri yeniden kur (opt-in kolon + türetilmiş)
  ⑦ ANLIK: yeniden hesapla, içerik özeti değiştiyse ekle
  ⑧ paket(ler) → POST /v1/esitle  ───────────────────────────►  imza · sınıf · hak · zincir (§6.4)
  ⑨ onaylanan filigranları ilerlet  ◄──────────────────────────  {kabul, ret, istenen}
zil (lisans SSE kanalı, konu ozet|rapor|gelen-kutusu)  ◄────────  portal/uygulama olayı
jobs/cloud-inbox.job.ts  (zil gelen-kutusu + her turda yoklama)
  POST /v1/gelen-kutusu/al → işle (normal servis) → POST /v1/gelen-kutusu/sonuc   (§8)
rapor isteği işleyicisi (zil rapor + her turda yoklama)
  POST /v1/rapor/al → hesapla (rapor servisi) → POST /v1/rapor/sonuc               (§7)
```

İşler `exchange-rate.job.ts` kalıbındadır (gecikme + `running` koruması + `runOnce(fetchImpl)` test enjeksiyonu); `whenIdentityReady` beklenir; kapanışta istek iptal edilir; beklenen ağ hatası `reportJobFailure`'a YAZILMAZ; proxy `lib/http-egress.ts` üzerinden (Plan A 1c). Tek turda tek paket akışı: bir tur bitmeden (onay ya da hata) ikincisi başlamaz.

## 3. Projeksiyon kataloğu v1

### 3.1 Özet

24 `KAYIT` (7 BOYUT + 17 OLGU) + 6 `ANLIK`. Kök tablo başına opt-in/toplam kolon ve dışarıda kalanlar `patron-sema-olcumu` ①'de basılır (ör. `customers` 16/28 — `taxNumber`, `address`, `email`, `notes` dışarıda; `shipments` 11/30 — plaka, sürücü, taşıyıcı dışarıda). Her kolonun VERİ SINIFI (`ISLEM` varsayılan · `FINANS` · `KISISEL`) katalogda etiketlidir; KVKK eki (B7) kategori listesini bu etiketlerden üretir.

**Kolon sınıfı → alt satır (izin sınırı):** FINANS ve KISISEL sınıflı kolonlar kök satırla GİTMEZ; aynı `id` ile ayrı alt kayda bölünür: `<projeksiyon>.finans`, `<projeksiyon>.kisisel`. Bulutta izin sınırı projeksiyon ADIDIR ve RLS'le uygulanır (§9.3) — "sipariş görür ama tutar görmez" hesap, DB düzeyinde tutarı okuyamaz. Alt satır izinleri: `.finans` → finans projeksiyonlarında kendi izni, finans DIŞI projeksiyonlarda `bulut:fiyat:oku` · `.kisisel` → `bulut:cari:oku`.

**Serbest metin alanları** (`aciklama`, `referans`, `disFaturaNo`, `musteriUrunAdi`) v1'de dahildir, katalogda `ISLEM`dir; KVKK ekinde "serbest metin (kişisel veri içerebilir)" kategorisi olarak ayrıca yazılır. `notes` kolonlarının HİÇBİRİ gitmez.

### 3.2 Kayıt projeksiyonları (katalogdan basıldı)

`⟨FINANS⟩`/`⟨KISISEL⟩` = alt satıra bölünen kolon · `⏱` = zamana bağlı türetilmiş alan (§4.3c) · "YOK:" ile başlayan yardımcı = tek kaynak bugün bir servisin İÇİNDE; B1-kod onu adlı bir yardımcıya ÇIKARIR (kopyalamaz) ve liste ekranı ile projeksiyon aynı yardımcıyı çağırır (türetilmiş alan / ayrışan yüzey kuralı). **B1-kod: dokuz "YOK:" yardımcısı çıkarıldı** (`helpers/shipment-gross-totals` · `helpers/sack-content-totals` · `helpers/work-order-current-step` · `helpers/order-deadline` · `finance.helper invoiceOpenAmount/unallocatedAmount` · `finance-aging resolveEffectiveDue/daysOverdueAt/isOverdueBucket` · `workorder.service withProductionMeters` dışa açık); güncel yardımcı adları katalog kodundadır.

#### `urun` — BOYUT · kök `items` (Item) · izin `bulut:oturum` · silme **DAMGA**
- Kolonlar (tel ← kaynak): `id`←id · `kod`←code · `ad`←name · `tur`←itemType · `birim`←unit · `yasamDurumu`←lifecycleStatus · `aktif`←isActive · `birlestigiKayit`←mergedIntoId
- Değişiklik kaynakları: `items`.updatedAt (self)

#### `renk` — BOYUT · kök `colors` (Color) · izin `bulut:oturum` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `kod`←code · `ad`←name · `hex`←hex · `aktif`←isActive · `birlestigiKayit`←mergedIntoId
- Değişiklik kaynakları: `colors`.updatedAt (self)

#### `depo` — BOYUT · kök `warehouses` (Warehouse) · izin `bulut:oturum` · silme **DAMGA**
- Kolonlar (tel ← kaynak): `id`←id · `kod`←code · `ad`←name · `varsayilan`←isDefault · `aktif`←isActive
- Değişiklik kaynakları: `warehouses`.updatedAt (self)

#### `istasyon` — BOYUT · kök `stations` (Station) · izin `bulut:oturum` · silme **DAMGA**
- Kolonlar (tel ← kaynak): `id`←id · `kod`←code · `ad`←name · `tur`←type · `aktif`←isActive
- Değişiklik kaynakları: `stations`.updatedAt (self)

#### `cari-kart` — BOYUT · kök `customers` (Customer) · izin `bulut:oturum` · silme **DAMGA**
- Kolonlar (tel ← kaynak): `id`←id · `kod`←code · `ad`←name · `tur`←type · `musteriRolu`←isCustomerRole · `tedarikciRolu`←isSupplierRole · `fasonRolu`←isSubcontractorRole · `il`←city · `ilce`←district · `ulke`←country · `varsayilanYon`←defaultDestination · `yetkili`←contactName ⟨KISISEL⟩ · `telefon`←contactPhone ⟨KISISEL⟩ · `aktif`←isActive · `birlestigiKayit`←mergedIntoId · `olusturulma`←createdAt
- Değişiklik kaynakları: `customers`.updatedAt (self)

#### `sube` — BOYUT · kök `customer_branches` (CustomerBranch) · izin `bulut:oturum` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `cariKartId`←customerId · `kod`←code · `ad`←name · `il`←city · `ilce`←district · `varsayilanYon`←defaultDestination · `aktif`←isActive
- Değişiklik kaynakları: `customer_branches`.updatedAt (self)

#### `fason-firma` — BOYUT · kök `subcontractors` (Subcontractor) · izin `bulut:oturum` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `kod`←code · `ad`←name · `cariKartId`←customerId · `aktif`←isActive · `birlestigiKayit`←mergedIntoId
- Değişiklik kaynakları: `subcontractors`.updatedAt (self)

#### `siparis` — OLGU · kök `orders` (Order) · izin `bulut:siparis:oku` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `siparisNo`←orderNumber · `cariKartId`←customerId · `subeId`←branchId · `yon`←destination · `doviz`←currency · `tutar`←totalAmount ⟨FINANS⟩ · `durum`←status · `siparisTarihi`←orderDate · `termin`←deadline · `sevkMiktari`←shippedQty · `tamamlanma`←completedAt · `iptalTarihi`←cancelledAt · `iptalSebepKodu`←cancelReasonCode · `olusturulma`←createdAt
- Türetilmiş (fabrikada hesaplanır): `acikMiktar` — helpers/order-line-scope.helper.ts isActiveLine+isMeasuredLine (Σ quantity − shippedQty) · `kalemSayisi` — helpers/order-line-scope.helper.ts isActiveLine · `gecikmis` ⏱ — YOK: open-order-coverage 'overdue' tanımı (termin < fabrika günü ∧ açık) yardımcıya çıkarılacak
- Değişiklik kaynakları: `orders`.updatedAt (self) · `order_lines`.updatedAt (order_lines.orderId)

#### `siparis-kalemi` — OLGU · kök `order_lines` (OrderLine) · izin `bulut:siparis:oku` · silme **DAMGA**
- Kolonlar (tel ← kaynak): `id`←id · `siparisId`←orderId · `urunId`←itemId · `renkId`←colorId · `miktar`←quantity · `birim`←unit · `birimFiyat`←unitPrice ⟨FINANS⟩ · `en`←width · `sevkMiktari`←shippedQty · `parcaBoyu`←pieceLengthM · `musteriUrunAdi`←customerItemName · `musteriRenkAdi`←customerColorName · `iptalTarihi`←cancelledAt · `iptalSebepKodu`←cancelReasonCode · `olusturulma`←createdAt
- Türetilmiş (fabrikada hesaplanır): `acikMiktar` — helpers/order-line-scope.helper.ts isActiveLine+isMeasuredLine (ölçülmeyen birimde null)
- Değişiklik kaynakları: `order_lines`.updatedAt (self)

#### `sevkiyat` — OLGU · kök `shipments` (Shipment) · izin `bulut:sevkiyat:oku` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `sevkNo`←shipmentNo · `durum`←status · `cariKartId`←customerId · `subeId`←branchId · `yon`←destination · `cikisTarihi`←dispatchedAt · `disFaturaNo`←invoiceNo · `faturalanma`←invoicedAt · `iptalTarihi`←cancelledAt · `olusturulma`←createdAt
- Türetilmiş (fabrikada hesaplanır): `toplamMetre` — YOK: shipping.service listShipments.attachTotals (BRÜT: canlı Σ + iade geri-eklemesi, tek RR anlık görüntü) yardımcıya çıkarılacak · `toplamKg` — YOK: aynı attachTotals · `cuvalSayisi` — listShipments _count.sacks · `topSayisi` — listShipments _count.rolls · `siparisIdleri` — shipment_orders isActive=true
- Değişiklik kaynakları: `shipments`.updatedAt (self) · `sacks`.updatedAt (sacks.shipmentId (ESKİ sevkiyat ayrılmada görünmez → FK tetikleyicisi, §4.3)) · `rolls`.updatedAt (rolls.shipmentId (ESKİ sevkiyat ayrılmada görünmez → FK tetikleyicisi, §4.3)) · `roll_returns`.updatedAt (roll_returns.fromShipmentId) · `shipment_orders`.isaret (shipment_orders.shipmentId (updatedAt/id YOK, küme deleteMany+create ile yenilenir — §4.3))

#### `dogrudan-sevk` — OLGU · kök `direct_shipments` (DirectShipment) · izin `bulut:sevkiyat:oku` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `sevkNo`←shipmentNo · `cariKartId`←customerId · `subeId`←branchId · `toplamMetre`←totalQty · `topSayisi`←rollCount · `cikisTarihi`←shippedAt · `disFaturaNo`←invoiceNo · `faturalanma`←invoicedAt · `olusturulma`←createdAt
- Değişiklik kaynakları: `direct_shipments`.updatedAt (self)

#### `cuval` — OLGU · kök `sacks` (Sack) · izin `bulut:sevkiyat:oku` · silme **DAMGA**
- Kolonlar (tel ← kaynak): `id`←id · `cuvalNo`←sackNo · `sevkiyatId`←shipmentId · `cariKartId`←customerId · `subeId`←branchId · `depoId`←warehouseId · `partiId`←packingGroupId · `ambalajNo`←packageNo · `kg`←weightKg · `tartilma`←weighedAt · `olusturulma`←createdAt
- Türetilmiş (fabrikada hesaplanır): `topSayisi` — YOK: listSackStoreBoard/attachTotals içindeki roll.groupBy(sackId) yardımcıya çıkarılacak · `metre` — YOK: aynı (Σ rolls.currentQty, sackId)
- Değişiklik kaynakları: `sacks`.updatedAt (self) · `rolls`.updatedAt (rolls.sackId (ESKİ çuval ayrılmada görünmez → FK tetikleyicisi, §4.3))

#### `is-emri` — OLGU · kök `work_orders` (WorkOrder) · izin `bulut:uretim:oku` · modül `production.enabled` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `isEmriNo`←workOrderNumber · `tur`←type · `durum`←status · `urunId`←targetItemId · `renkId`←targetColorId · `hedefMiktar`←targetQuantity · `en`←width · `planBaslangic`←plannedStartDate · `planBitis`←plannedEndDate · `aktif`←isActive · `iptalTarihi`←cancelledAt · `olusturulma`←createdAt
- Türetilmiş (fabrikada hesaplanır): `uretilenMetre` — workorder.service.ts withProductionMeters (private → dışa açılacak) · `girenMetre` — workorder.service.ts withProductionMeters → computeWoInput · `siparisMetre` — workorder.service.ts withProductionMeters · `cariKartIdleri` — helpers/work-order-customers.helper.ts rollupWorkOrderCustomers · `aktifIstasyonId` — YOK: adım durumundan (work_order_steps IN_PROGRESS/PENDING ilk) — liste detayındaki tanım yardımcıya çıkarılacak
- Değişiklik kaynakları: `work_orders`.updatedAt (self) · `work_order_steps`.updatedAt (work_order_steps.workOrderId) · `rolls`.updatedAt (rolls.producedInStepId|currentStepId → work_order_steps.workOrderId (ESKİ adım ayrılmada görünmez → FK tetikleyicisi, §4.3)) · `work_order_to_order_lines`.updatedAt (work_order_to_order_lines.workOrderId)

#### `cari-hesap` — OLGU · kök `cari_accounts` (CariAccount) · izin `bulut:cari-bakiye:oku` · modül `finance.enabled` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `tur`←kind · `cariKartId`←customerId · `fasonFirmaId`←subcontractorId · `varsayilanDoviz`←defaultCurrency · `vadeGun`←paymentTermDays ⟨FINANS⟩ · `riskLimiti`←riskLimit ⟨FINANS⟩ · `aktif`←isActive
- Türetilmiş (fabrikada hesaplanır): `bakiyeler` ⟨FINANS⟩ — cari.service.ts list (cari_balances, sıfır olmayan, para birimi bazında) · `gecikmis` ⟨FINANS⟩ ⏱ — reports/finance-aging.report.ts collectAgingRows (asOf=şimdi) — cari listesinin withOverdue'su ile AYNI çekirdek
- Değişiklik kaynakları: `cari_accounts`.updatedAt (self) · `cari_balances`.updatedAt (cari_balances.cariId) · `invoices`.updatedAt (invoices.cariId) · `payments`.updatedAt (payments.cariId) · `cheques`.updatedAt (cheques.cariId)

#### `cari-hareket` — OLGU · kök `cari_transactions` (CariTransaction) · izin `bulut:cari-bakiye:oku` · modül `finance.enabled` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `cariHesapId`←cariId · `doviz`←currency · `tarih`←txnDate · `borc`←debit ⟨FINANS⟩ · `alacak`←credit ⟨FINANS⟩ · `tutarTl`←amountTry ⟨FINANS⟩ · `kur`←exchangeRate ⟨FINANS⟩ · `kaynak`←sourceType · `faturaId`←invoiceId · `tahsilatOdemeId`←paymentId · `cekId`←chequeId · `tersKayitId`←reversesTxnId · `aciklama`←description · `olusturulma`←createdAt
- Değişiklik kaynakları: `cari_transactions`.createdAt (self)

#### `kasa` — OLGU · kök `cash_boxes` (CashBox) · izin `bulut:kasa:oku` · modül `finance.enabled` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `kod`←code · `ad`←name · `doviz`←currency · `bakiye`←balance ⟨FINANS⟩ · `aktif`←isActive
- Değişiklik kaynakları: `cash_boxes`.updatedAt (self)

#### `banka` — OLGU · kök `bank_accounts` (BankAccount) · izin `bulut:kasa:oku` · modül `finance.enabled` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `kod`←code · `ad`←name · `banka`←bankName · `doviz`←currency · `bakiye`←balance ⟨FINANS⟩ · `aktif`←isActive
- Değişiklik kaynakları: `bank_accounts`.updatedAt (self)

#### `kasa-hareketi` — OLGU · kök `cash_transactions` (CashTransaction) · izin `bulut:kasa:oku` · modül `finance.enabled` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `belgeNo`←docNo · `tur`←kind · `yon`←direction · `durum`←status · `kasaId`←cashBoxId · `bankaId`←bankAccountId · `doviz`←currency · `tutar`←amount ⟨FINANS⟩ · `tutarTl`←amountTry ⟨FINANS⟩ · `tarih`←txnDate · `kategori`←category · `aciklama`←description · `transferGrubu`←transferGroupId · `tahsilatOdemeId`←paymentId · `iptalTarihi`←cancelledAt · `olusturulma`←createdAt
- Değişiklik kaynakları: `cash_transactions`.updatedAt (self)

#### `cek-senet` — OLGU · kök `cheques` (Cheque) · izin `bulut:cek:oku` · modül `finance.enabled` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `belgeNo`←docNo · `tur`←kind · `belgeTuru`←docType · `durum`←status · `cariHesapId`←cariId · `cirolananCariHesapId`←endorsedToCariId · `bankaId`←bankAccountId · `doviz`←currency · `tutar`←amount ⟨FINANS⟩ · `tutarTl`←amountTry ⟨FINANS⟩ · `eslesen`←allocatedTotal ⟨FINANS⟩ · `duzenleme`←issueDate · `vade`←dueDate · `kayitTarihi`←postingDate · `seriNo`←serialNo · `banka`←bankName · `kesideci`←drawerName ⟨KISISEL⟩ · `iptalTarihi`←cancelledAt · `olusturulma`←createdAt
- Değişiklik kaynakları: `cheques`.updatedAt (self)

#### `cek-hareketi` — OLGU · kök `cheque_events` (ChequeEvent) · izin `bulut:cek:oku` · modül `finance.enabled` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `cekId`←chequeId · `tur`←type · `onceki`←fromStatus · `sonraki`←toStatus · `tarih`←eventDate · `karsiCariHesapId`←counterCariId · `olusturulma`←createdAt
- Değişiklik kaynakları: `cheque_events`.createdAt (self)

#### `fatura` — OLGU · kök `invoices` (Invoice) · izin `bulut:fatura:oku` · modül `finance.enabled` · silme **KAPSAM_DISI**
- Kapsam: status <> 'DRAFT' (taslak buluta GİRMEZ; taslağın silinmesi kapsam dışı)
- Kolonlar (tel ← kaynak): `id`←id · `belgeNo`←docNo · `tur`←type · `durum`←status · `cariHesapId`←cariId · `doviz`←currency · `kur`←exchangeRate ⟨FINANS⟩ · `tarih`←issueDate · `vade`←dueDate · `disNo`←externalNo · `araToplam`←subtotal ⟨FINANS⟩ · `iskonto`←discountTotal ⟨FINANS⟩ · `kdv`←vatTotal ⟨FINANS⟩ · `tevkifat`←withholdingTotal ⟨FINANS⟩ · `genelToplam`←grandTotal ⟨FINANS⟩ · `genelToplamTl`←grandTotalTry ⟨FINANS⟩ · `odenen`←paidTotal ⟨FINANS⟩ · `sevkiyatId`←shipmentId · `dogrudanSevkId`←directShipmentId · `onay`←confirmedAt · `iptalTarihi`←cancelledAt · `olusturulma`←createdAt
- Türetilmiş (fabrikada hesaplanır): `acikTutar` ⟨FINANS⟩ — reports/finance-aging.report.ts collectAgingRows açık tutar tanımı (grandTotal − paidTotal) yardımcıya çıkarılacak · `vadesiGecti` ⏱ — reports/finance-aging.report.ts efektif vade (belge vadesi → tarih + cari vade günü)
- Değişiklik kaynakları: `invoices`.updatedAt (self)

#### `fatura-kalemi` — OLGU · kök `invoice_lines` (InvoiceLine) · izin `bulut:fatura:oku` · modül `finance.enabled` · silme **KAPSAM_DISI**
- Kapsam: üst fatura status <> 'DRAFT' (onaydan sonra kalem değişmez — ölç)
- Kolonlar (tel ← kaynak): `id`←id · `faturaId`←invoiceId · `sira`←lineNo · `urunId`←itemId · `aciklama`←description · `miktar`←qty · `birim`←unit · `birimFiyat`←unitPrice ⟨FINANS⟩ · `iskontoOrani`←discountRate ⟨FINANS⟩ · `kdvOrani`←vatRate ⟨FINANS⟩ · `tevkifatOrani`←withholdingRate ⟨FINANS⟩ · `tutar`←lineTotal ⟨FINANS⟩ · `kdvTutari`←vatAmount ⟨FINANS⟩
- Değişiklik kaynakları: `invoices`.updatedAt (invoice_lines.invoiceId (kalem üst faturayla birlikte gider))

#### `tahsilat-odeme` — OLGU · kök `payments` (Payment) · izin `bulut:tahsilat:oku` · modül `finance.enabled` · silme **YOK**
- Kolonlar (tel ← kaynak): `id`←id · `belgeNo`←docNo · `yon`←direction · `yontem`←method · `durum`←status · `cariHesapId`←cariId · `doviz`←currency · `tutar`←amount ⟨FINANS⟩ · `tutarTl`←amountTry ⟨FINANS⟩ · `eslesen`←allocatedTotal ⟨FINANS⟩ · `kasaId`←cashBoxId · `bankaId`←bankAccountId · `tarih`←paymentDate · `referans`←reference · `iptalTarihi`←cancelledAt · `olusturulma`←createdAt
- Türetilmiş (fabrikada hesaplanır): `eslesmemis` ⟨FINANS⟩ — YOK: amount − allocatedTotal (payment-allocation.service sayaç sözleşmesi) yardımcıya çıkarılacak
- Değişiklik kaynakları: `payments`.updatedAt (self)

#### `fiyat` — OLGU · kök `item_prices` (ItemPrice) · izin `bulut:fiyat:oku` · modül `finance.enabled` · silme **DAMGA**
- Kolonlar (tel ← kaynak): `id`←id · `urunId`←itemId · `cariKartId`←customerId · `tur`←kind · `doviz`←currency · `fiyat`←price ⟨FINANS⟩ · `degisim`←updatedAt
- Değişiklik kaynakları: `item_prices`.updatedAt (self)

| Anlık | Kaynak (tek kaynak) | Sıklık | İzin | Modül | Okuduğu tablolar |
|---|---|---|---|---|---|
| `ozet` | services/boss/overview.service.ts getBossOverview (izin süzmesiz çekirdek; bölüm başına alt kayıt ve bulut izni — tasarım §3.3) | HER_TUR | `bulut:ozet:oku` | — | rolls, order_lines, orders, sacks, shipments, work_order_steps, subcontractor_dispatches, subcontractor_dispatch_items |
| `ozet-finans` | YENİ bölüm: kasa/banka bakiyeleri (stored) + ChequeService.summary/dueSummary + collectAgingRows toplamı | HER_TUR | `bulut:cari-bakiye:oku` | finance.enabled | cash_boxes, bank_accounts, cheques, invoices, payments, payment_allocations, cari_accounts |
| `stok-karnesi` | reports/stock-scorecard.report.service.ts getStockScorecard | SAATLIK | `bulut:stok:oku` | — | rolls, order_lines, orders, items, colors |
| `acik-siparis-karsilama` | reports/open-order-coverage.report.service.ts getOpenOrderCoverage | SAATLIK | `bulut:siparis:oku` | — | order_lines, orders, rolls |
| `rapor-katalogu` | constants/report-catalog.ts (audit/* ailesi HARİÇ; anahtar, başlık, parametre şeması, aile) | GUNLUK | `bulut:oturum` | — |  |
| `uretim-akisi` | inventory.service.ts getProductionFlow({includeQueues,includeSevk}) + DashboardService.getStationsLiveState | HER_TUR | `bulut:uretim:oku` | production.enabled | rolls, work_order_steps, stations, sacks, shipments |

### 3.3 Anlık projeksiyonların iç yapısı

- **`ozet`** `getBossOverview` çekirdeğini izin süzmesiz çağırır ve BÖLÜM başına ayrı alt kayıt üretir: `ozet.stok` (`bulut:stok:oku`) · `ozet.siparis` (`bulut:siparis:oku`) · `ozet.uretim` (`bulut:uretim:oku`) · `ozet.sevkiyat` (`bulut:sevkiyat:oku`) · `ozet.fason` (`bulut:uretim:oku`). Bugünkü `BOSS_SECTION_PERMISSIONS` (fabrika izinleri) buluta taşınmaz; eşleme bulut izin kataloğundadır (§10). B6'da tünel kalkınca özet üretimi `cloud-sync`e taşınır, tek kaynak korunur.
- **`ozet-finans` YENİ bölümdür:** kasa/banka bakiyeleri (saklı kolon), `ChequeService.summary/dueSummary`, `collectAgingRows` toplamı (vade kovaları). Fabrika panelinde karşılığı yoksa aynı yardımcı panel özetine de bağlanır — ekranda görünmeyen sayı bulutta doğmaz.
- **Standart dönemli toplamlar** (`ozet`in 30 günlük penceresi) "bugün · bu ay · geçen ay · son 30 gün" dört penceresiyle üretilir; pencere sınırı fabrika günüdür (`src/constants/time.ts`, Europe/Istanbul).
- Her ANLIK çıktının sha256 içerik özeti tutulur; bir önceki GÖNDERİLENLE aynıysa paketlenmez.

### 3.4 v1 dışında kalanlar

`BILINCLI_DISARIDA` (katalogda) gerekçesiyle: audit (`system_logs`, arşivi) — ayak izi yerel yüzeydir · fabrika kullanıcıları, izinler, TOTP, kurtarma kodları, oturumlar · `system_settings` (şifre özetleri, kurulum kimliği) · telemetri · **top düzeyi (`rolls`) ve stok hareket defterleri** (hacim; stok karnesi + sevkiyat/çuval toplamları yeter, ayrıntı rapor isteğiyle) · şablonlar · v2 adayları (parti, sevk partisi, alış siparişi, mal kabul, dokuma/levent/iplik). `patron-sema-olcumu` ⑤ şemadaki her tabloyu kataloğa + bu listeye karşı ölçer; 2026-09-29'da **87 tablo gerekçesiz dışarıda** (opt-in gereği gitmezler; liste v2 kapsam turunun girdisidir).

**Maliyet v1'de YOKTUR (ölçüldü):** şemada birim maliyet kolonu ya da maliyet defteri yok (`patron-sema-olcumu`, `schema.prisma` taraması 2026-09-29). B-Tur kararı "fiyat/maliyet" diyor; "yetenek VAR = motor + çıkış yüzeyi + izin" kuralı gereği `bulut:maliyet:oku` izni motoru doğmadan kataloğa girmez (§16 açık soru).

## 4. Değişiklik tespiti

### 4.1 Filigran ve güvenli ufuk

- **Filigran** filigran kaynağı (tablo) başına `(zaman, eşitlik bozucu)` çiftidir; eşitlik bozucu `id`, `id` yoksa birincil anahtarın kolonlarıdır (`cari_balances (cariId, currency)`). Tarama `WHERE (t, bozucu) > (w_t, w_bozucu) AND t < H ORDER BY t, bozucu LIMIT n` — satır değeri karşılaştırması indeksle sayfalanır.
- **Neden ufuk:** `updatedAt` (Prisma `@updatedAt`) uygulama saatiyle deyim anında yazılır; ham SQL `now()` tx BAŞLANGICIDIR; ikisi de COMMIT'ten öncedir. Tx A `t=10:00:00` yazıp 10:00:05'te commit ederken okuyucu 10:00:03'te `t ≤ 10:00:03`ü okuyup filigranı ilerletirse A'nın satırı sonsuza dek kaçar. Çare: **H = min(açık tx'lerin `xact_start`i, DB şimdi) − pay**. H'den önce başlamış açık tx kalmadığından, `t < H` olan her satırın tx'i bitmiştir.
  ```sql
  SELECT now() AS db_simdi,
         min(xact_start) FILTER (WHERE pid <> pg_backend_pid() AND xact_start IS NOT NULL) AS en_eski_tx
    FROM pg_stat_activity WHERE datname = current_database();
  ```
  `pay = 2 sn + |uygulama saati − db_simdi|` (Prisma damgası uygulama saatidir; fabrikada backend ile PG aynı makinededir, fark ölçülerek eklenir).
- **Görünürlük ön koşulu:** `pg_stat_activity.xact_start` yalnız aynı rolün oturumlarında ya da `pg_read_all_stats` üyesine görünür. Backend'in bütün bağlantıları tek uygulama rolüyle açıldığından yeterlidir; **thinkpad-1'de süper olmayan uygulama rolüyle ölçülür** (Senaryo T'ye P-T1 olarak eklenir). Test DB'sinde rol süper olduğundan `patron-sema-olcumu` ⑥ bunu kanıtlayamaz (dürüst sınır).
- **Takılan ufuk:** saatlerce açık kalan bir tx ufku dondurur → eşitleme DURUR ama veri kaybetmez (doğruluk önce). 15 dk'dan uzun donmada tur "ufuk takıldı" durumunu bulutun "son eşitleme" damgasına yazar (bulut bandı + B5 sistem sağlığı bildirimi). Ufku zorla ileri almak YASAK.
- **`createdAt` filigranlı defterler** (`cari_transactions`, `cheque_events`, `merge_operations`, `sync_marks`) aynı ufukla okunur. "Aynı tx'te çok olay = son olay + 1 ms" kuralıyla yazılan `createdAt` tx başlangıcından ≥ olduğundan ufuk onları da doğru dışarıda tutar.
- **Filigran deposu** `sync_watermarks` (kaynak başına bir satır: `source`, `t`, `tieBreaker`, `updatedAt`) — durum tablosudur, DEFTER DEĞİL; ilerletme yalnız bulut onayından sonra (§6.4). Döküm başka makineye taşınırsa filigran da taşınır; bulut zincir denetimi (§6.4) kopukluğu yakalar ve TAM gönderim ister.

### 4.2 `updatedAt` güvenilirliği — ölçüldü (`patron-yazim-noktalari` ②)

- Prisma `update`/`updateMany`/`upsert` `@updatedAt`i yazar; **ham SQL yazmaz**. Katalog tablolarındaki 16 ham UPDATE'in dökümü:
  - `payment-allocation.service.ts` 6 ham UPDATE (`invoices.paidTotal`, `payments.allocatedTotal`, `cheques.allocatedTotal`) **`updatedAt`i açıkça YAZAR** — planın "filigrana güvenmeden önce ölçülür" maddesi KAPANDI: güvenilir.
  - `item-price.service.ts` ham `INSERT … ON CONFLICT DO UPDATE` `"updatedAt" = now()` yazar — güvenilir.
  - `master-data-merge` (3: `rolls`/`sacks` `labelDirty`, 1 dinamik alias) ve `master-data-unmerge` (2 dinamik: kaynak kartın `mergedIntoId/isActive/name`'i, alan seçimleri) **YAZMAZ** → §4.5.
  - `merge-ledger.helper.ts` 4 dinamik UPDATE (FK taşıma) **YAZMAZ** → §4.5.
- **Filigrana görünmez güncelleme (opt-in kolon değişir, `updatedAt` yazılmaz, tablo adı sabit): 0.** Dinamik tablolu 7 ham yazım ayrıca listelenir; hepsi birleştirme ailesidir.

### 4.3 Filigranın göremediği dört değişiklik

**(a) Ayrılma körlüğü.** Çocuk satır ebeveynden AYRILINCA (`rolls.sackId: X → null`) çocuğun `updatedAt`i değişir ama artık ESKİ ebeveyni göstermez; X'in toplamı (top sayısı, metre) değişmiştir ve kimse X'i kirletmez. Katalogda beş yol: `rolls.sackId` (çuval), `rolls.shipmentId` (sevkiyat), `rolls.currentStepId/producedInStepId` (iş emri), `sacks.shipmentId` (sevkiyat — çuval sevkiyattan çıkarılınca). Çare DB tetikleyicisi — yalnız FK değiştiğinde ateşlenir, sıcak yolda maliyeti yok:
```sql
CREATE TRIGGER rolls_sync_parent_moved AFTER UPDATE OF "sackId", "shipmentId", "currentStepId", "producedInStepId" ON rolls
  FOR EACH ROW WHEN (OLD."sackId" IS DISTINCT FROM NEW."sackId" OR OLD."shipmentId" IS DISTINCT FROM NEW."shipmentId"
                  OR OLD."currentStepId" IS DISTINCT FROM NEW."currentStepId" OR OLD."producedInStepId" IS DISTINCT FROM NEW."producedInStepId")
  EXECUTE FUNCTION sync_mark_old_parents();   -- ESKİ ebeveynleri KIRLI işaretler (yeni ebeveyn filigrandan zaten görünür)
-- aynısı sacks için: AFTER UPDATE OF "shipmentId" ON sacks … WHEN (OLD."shipmentId" IS DISTINCT FROM NEW."shipmentId")
```
**(b) Filigransız tablo.** `shipment_orders` ne `id` ne `updatedAt` taşır ve küme `deleteMany` + yeniden yazımla yenilenir (`shipping.service.ts:2082`); `isActive` geçişi de görünmez. Çare: INSERT/UPDATE/DELETE tetikleyicisi `shipmentId`yi `KIRLI` işaretler. `invoice_lines` de `updatedAt` taşımaz ama kalem yalnız TASLAKTA değişir (`invoice.service.ts` düzenleme claim'i `status = DRAFT`) ve taslak kapsam dışıdır → kalem üst faturayla birlikte gider, tetikleyici gerekmez (§14 S5'te ölçüm borcu).

**(c) Zamana bağlı türetilmiş alan (⏱).** `gecikmis` (sipariş, cari), `vadesiGecti` (fatura) hiçbir satır değişmeden fabrika gününün dönmesiyle değişir. Çare: fabrika günü dönümünde (00:05 Europe/Istanbul) HEDEFLİ yeniden hesap — yalnız değeri dün→bugün çevrilebilecek kökler (`termin`/efektif vade = dün ∧ açık). Bulut tarih karşılaştırması YAPMAZ (§1.1).

**(d) Türetilmiş toplamın kaynağı başka tabloda.** Çuval metresi `rolls.currentQty`nin toplamıdır; kök `sacks` satırı değişmez. Çare katalogdaki `bagimliliklar`dır: her filigran kaynağından köke yol tanımlıdır ve tur o kökleri yeniden kurar. Kaynağa yeni bir türetilmiş alan eklemek, kaynağını da `bagimliliklar`a eklemeyi GEREKTİRİR (B1-kod bekçisi: türetilmiş alanın okuduğu her tablo ya kökte ya bağımlılıkta).

### 4.4 Silme: `sync_marks` tetikleyicisi + günlük uzlaştırma

**Ölçüm (`patron-yazim-noktalari` ①/①b, `patron-sema-olcumu` ③):** katalog tablolarında 11 uygulama silme yolu — `order_lines` (sipariş düzenleme), `sacks` (boş çuval), `item_prices` (fiyat satırı kaldırma), `stations` (guard'lı kalıcı silme), `work_order_steps` (bekleyen adım), `invoices` + `invoice_lines` (TASLAK), `shipment_orders` (küme yenileme) ve **`customers`/`items`/`warehouses` — `BaseController.hardRemove → super.hardDelete` (guard'lı, bağımsız kart kalıcı silinebilir).** Son üçü delegate'i DİNAMİK olduğu için ilk taramada GÖRÜNMEDİ (bu dilimde ölçülüp betiğe ①b olarak eklendi). Ayrıca 29 `ON DELETE CASCADE` FK kök tablolara bağlı (ör. `orders → order_lines`, `customers → item_prices`, `cari_accounts → cari_balances`) ve birleştirme çakışma politikası alias tablolarından dinamik tabloyla siler.

**Karar:** statik tarama kördür (üç ayrı körlük ölçüldü: dinamik delegate, kaskad, dinamik tablo) ⇒ silme tespiti koda değil DB'ye bağlanır:
```sql
CREATE TABLE sync_marks (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tableName" varchar(63) NOT NULL,     -- katalog kök tablosu
  "rowId" uuid NOT NULL,
  "kind" "SyncMarkKind" NOT NULL,       -- DELETED | DIRTY
  "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sync_marks_createdAt_id_idx ON sync_marks ("createdAt", "id");
-- 24 kök tablonun HER BİRİNE (silme yolu ölçülmüş olsun olmasın):
CREATE TRIGGER <tablo>_sync_deleted AFTER DELETE ON <tablo> FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
```
- Satır düzeyi tetikleyici KASKADLA silinen satırda da ateşlenir; silen yolun dili (Prisma, ham SQL, dinamik) önemsizdir.
- Aynı tx'te yazılır ⇒ silme ile işaret birlikte commit olur ya da birlikte geri alınır (planın "AYNI tx" şartı, uygulama kodu olmadan).
- `sync_marks` **telemetri sınıfıdır, DEFTER DEĞİL** (kök kural testi: satır silindiğinde raporlanan hiçbir sayı değişmez): bulutun onayladığı filigranın gerisinde kalan ve 7 günden eski satırlar budanır; budama beyanı `test_telemetri_defter_degil`e girer. Audit muafiyeti "sistem işi" sınıfıyla beyanlıdır (tetikleyici yazar, uygulama CUD'u değil).
- **Günlük uzlaştırma (güvenlik ağı):** gece (fabrika günü 03:30, yedekten sonra) her KAYIT projeksiyonu için `(adet, md5(string_agg(id::text, ',' ORDER BY id)))` saklama ufku içinde hesaplanıp `UZLASTIRMA` paketiyle gider; bulut kendi canlı kümesiyle karşılaştırır, uyuşmazlıkta o projeksiyon için `istenen: TAM` döner (§6.5). Tetikleyici birincil yoldur; uzlaştırma, tetikleyicinin kurulmadığı/düşürüldüğü (ör. elle restore) durumu yakalar.

### 4.5 Birleştirme (`master-data-merge`) ve geri alma

Birleştirme FK'ları ham UPDATE ile taşır ve `updatedAt`e dokunmaz (§4.2); geri alma kaynak kartı ham UPDATE ile diriltir. Bunlar audit'ten değil birleştirme DEFTERİNDEN okunur:
- `merge_operations.createdAt` (yeni birleştirme) ve `merge_operations.revertedAt` (geri alma) ikisi de filigran kaynağıdır; ikincisi değişebilir bir damgadır → kendi `(revertedAt, id)` indeksiyle ayrı taranır.
- Görülen her operasyon için kirli kökler: `survivorId` + `merge_operation_sources.sourceId` (BOYUT tablosunda) + `merge_operation_refs` satırlarındaki `(tableName, rowIds)` — yalnız katalog kök tablolarına düşenler. `rowIds` tek kolon PK içindir; bileşik PK'lı tek tablo (`subcontractor_category_links`) katalogda değildir.
- Emniyet: bir operasyonun `refs` toplamı 50 000 satırı aşarsa etkilenen projeksiyonlar için doğrudan TAM gönderim istenir (kirli küme yerine).

### 4.6 Kapsamdan çıkış ve modül kapanışı

- Kapsam yüklemi (ör. `fatura`: `status <> 'DRAFT'`) gönderim anında değerlendirilir. Değişmiş ama yüklemi GEÇMEYEN kök `silinenler`e `neden: KAPSAM_DISI` ile girer — bulut satırı kaldırır. (Bugün onaylı fatura taslağa dönmez; kural yine de geneldir.)
- Modül bayrağı kapanınca (`finance.enabled = false`) o modülün projeksiyonları GÖNDERİLMEZ; bulut son veriyi "modül fabrikada kapalı · son eşitleme <tarih>" bandıyla gösterir, silmez (saklama işi normal akışla budar). Modül okuması `readXRaw` DEĞİL enforcement varyantı `readX`tir (lisans tavanı dahil).

## 5. Hacim ölçümü (`patron-hacim-olcumu`)

**Yöntem:** fabrika verisi YOK. Her KAYIT projeksiyonu için iki ölçü: (1) fikstürde satır varsa opt-in kolonların `json_build_object` uzunluğu (tel adlarıyla, gerçek değerle) + türetilmiş pay, (2) kolon TİPLERİNDEN üst-yaklaşık JSON genişliği. Planlama birimi büyüğüdür. gzip oranı yalnız fikstür satırı ≥ 3 olan projeksiyonda anlamlıdır (0,26–0,49 arası ölçüldü); planlamada **0,40** kullanılır. Fabrikanın satır SAYILARI bu belgede UYDURULMAZ — kurulumun sayımı B1-kod diliminde thinkpad-1'de ve (kullanıcı cümlesiyle) sahada ölçülür.

| Projeksiyon | Kolon + türetilmiş | Tip tahmini (bayt/satır) | 1.000 satır ham | 1.000 satır gzip (×0,40) |
|---|---|---|---|---|
| urun · renk · depo · istasyon · sube · fason-firma | 5–8 | 168–318 | 164–311 KB | 66–124 KB |
| cari-kart | 16 | 613 | 599 KB | 240 KB |
| siparis | 15 + 3 | 666 | 650 KB | 260 KB |
| siparis-kalemi | 15 + 1 | 606 | 592 KB | 237 KB |
| sevkiyat | 11 + 5 | 615 | 601 KB | 240 KB |
| cuval | 11 + 2 | 518 | 506 KB | 202 KB |
| is-emri | 13 + 5 | 627 | 612 KB | 245 KB |
| cari-hareket | 15 | 567 | 554 KB | 222 KB |
| kasa-hareketi | 17 | 657 | 642 KB | 257 KB |
| cek-senet | 20 | 769 | 751 KB | 300 KB |
| fatura | 22 + 2 | 803 | 784 KB | 314 KB |
| fatura-kalemi | 13 | 414 | 404 KB | 162 KB |
| tahsilat-odeme | 16 + 1 | 600 | 586 KB | 234 KB |
| fiyat | 7 | 248 | 242 KB | 97 KB |

Anlık projeksiyonlar (fikstürde, gerçekten hesaplatılarak): `ozet` (5 bölüm, 30 gün) 1.512 B / gzip 638 B / 197 ms · `stok-karnesi` 1.064 B / 467 B / 3 ms · `acik-siparis-karsilama` 2.158 B / 615 B / 12 ms. Ölçek satır sayısıyla (ürün×renk, açık kalem) büyür; fabrikada ölçülür.

**Sonuçlar (sözleşmeye giren):**
- Paket sınırı: **≤ 4 MB sıkıştırılmış gövde ve ≤ 5.000 kayıt** (hangisi önce dolarsa); ilk TAM gönderim sayfalanır. 5.000 OLGU satırı ≈ 3,3 MB ham ≈ 1,3 MB gzip — sınırın altında.
- Yardımcı hesap: `ilk TAM ≈ Σ(satır × tip tahmini) × 0,40`. Ör. 50.000 sipariş kalemi ≈ 30 MB ham ≈ 12 MB gzip ≈ 10 paket.
- Artımlı turun hacmi değişen satır sayısıyla orantılıdır; 5 dk'lık turda tipik fabrika günü yüzlerce satırdır (ölçülecek), KB mertebesi.

## 6. Eşitleme sözleşmesi v1 — paket

### 6.1 Uç ve imza

- `POST https://<patron-bulut>/v1/esitle` · başlık `X-TKL-Istek: <İSTEK JWS>` (`amac: "esitle"`, `kurulumId`, `zaman` ±10 dk, `nonce`, `govdeOzeti`) · `Content-Type: application/json` · `Content-Encoding: gzip`.
- **`govdeOzeti` SIKIŞTIRILMIŞ ham baytların** sha256'sıdır (sunucu açmadan ÖNCE özetler — protokol §4 "ham bayt" kuralı). Açılmış gövde ≤ 32 MB (sıkıştırma bombası sınırı), aşılırsa 413 `PAKET_BUYUK`.
- Bulut İSTEK'i `LISANS-PROTOKOLU.md` §4 sırasıyla doğrular; kurulumun açık anahtarı, sınıfı, HAK modülleri ve `tesisId`si satıcının İÇ API'sinden gelir (iç ağ, 5 dk önbellek; önbellek TAZELİKTİR — satıcıya ulaşılamıyorsa bayat kayıtla devam, hiç dolmadıysa RED). `nonce` `(kurulumId, nonce)` UNIQUE, 15 dk.
- Sınıf `URETIM` değilse 403 `SINIF_GONDEREMEZ`; `patron-bulut` hakkı yoksa ya da abonelik bittiyse 403 `PATRON_BULUT_KAPALI`. (Fabrika zaten göndermez — §1.4; bulut ikinci kapıdır.)

### 6.2 Gövde (açılmış, KATI şema — tanınmayan anahtar 400 `GOVDE_GECERSIZ`)

```jsonc
{
  "v": 1,                          // paket zarfı sürümü
  "sozlesme": 1,                   // eşitleme sözleşmesi sürümü (§6.6)
  "paketId": "uuid",               // idempotency anahtarı
  "kurulumId": "uuid",             // İSTEK'teki ile AYNI olmalı
  "tur": "ARTIMLI",                // ARTIMLI | TAM | UZLASTIRMA
  "ufuk": "2026-09-29T12:00:00.000Z",   // H — bu paketin sürüm anı (§6.3)
  "uretimBilgisi": { "uygulamaSurum": "2.12.0", "katalogSurum": 1 },
  "kayitlar": [{
    "projeksiyon": "siparis",      // ya da alt satır: "siparis.finans"
    "katalogSurum": 1,             // bu projeksiyonun kolon kümesi sürümü
    "yaz": [{ "id": "uuid", "…tel alanları…": "…" }],
    "sil": [{ "id": "uuid", "neden": "SILINDI" }],   // SILINDI | KAPSAM_DISI
    "filigran": { "onceki": { "t": "…", "k": "…" } | null, "yeni": { "t": "…", "k": "…" } },
    "tam": { "parca": 1, "toplamParca": 7, "baslangic": "…" } | null
  }],
  "anliklar": [{ "projeksiyon": "ozet.stok", "icerikOzeti": "sha256", "veri": { } }],
  "uzlastirma": [{ "projeksiyon": "siparis", "adet": 1234, "ozet": "md5", "ufukTarihi": "…" }]
}
```
- `filigran` projeksiyon başınadır (bulut kaynağın tablo ayrıntısını bilmez); fabrikada kaynak-tablo filigranlarından türetilir: `yeni` = paketin ufku (H) + turun sıra sayacı.
- Sayılar (Decimal) DİZİ olarak gider (`"1234.5000"`); para ve metraj bulutta da `numeric`tir, float'a düşmez. Zamanlar ISO-8601 UTC `Z`.

### 6.3 Bulutta uygulama (tek tx, tesis başına sıralı)

1. `paket_receipts (tesisId, paketId)` UNIQUE — tekrar gelen paket saklı yanıtla cevaplanır (ağ tekrarı idempotent).
2. Tesis başına advisory kilit tx'in İLK ifadesidir (bulutun kendi kilit envanteri; fabrikanın 80xx uzayından bağımsız).
3. `yaz`: `INSERT … ON CONFLICT (tesis_id, projeksiyon, kayit_id) DO UPDATE … WHERE stored.surum_ani <= EXCLUDED.surum_ani` — **sürüm anı paketin `ufuk`udur** (monoton; kök satırın kendi `updatedAt`i değil: bağımlılıkla yeniden kurulan kökün `updatedAt`i değişmemiştir). Eski paket yeni veriyi ezemez.
4. `sil`: satır `silindi_ani = ufuk` ile işaretlenir (okuma yüzeyinden düşer); fiziksel silme saklama işinde.
5. `tam`: parça 1 geldiğinde projeksiyonun o anki satırları "tarama" kümesine alınır; son parça onaylanınca `surum_ani < baslangic` kalan her satır silinir (işaretle-süpür). Kaçmış silmeleri de böyle temizler.

### 6.4 Filigran onayı ve zincir

Yanıt (GEVŞEK şema):
```jsonc
{ "v": 1, "paketId": "uuid",
  "kabul":   [{ "projeksiyon": "siparis", "filigran": { "t": "…", "k": "…" } }],
  "ret":     [{ "projeksiyon": "fiyat", "kod": "KATALOG_SURUMU" }],
  "istenen": [{ "projeksiyon": "cuval", "tur": "TAM", "neden": "FILIGRAN_KOPUK" }],
  "ufukTarihi": { "siparis": "2025-09-01T00:00:00Z" },     // saklama ufku (§9.5)
  "sozlesmeUyarisi": null | "FABRIKA_SURUMU_ESKI" }
```
- Bulut `onceki`yi kendi sakladığıyla karşılaştırır: `onceki ≤ saklanan` → KABUL (örtüşme zararsızdır, 3. madde ezmeyi engeller; onayı kaybolmuş bir paketin tekrarı da böyle geçer); `onceki > saklanan` ya da saklanan yokken `onceki ≠ null` → **boşluk** ⇒ o projeksiyon için `istenen: TAM` (`FILIGRAN_KOPUK`). DR devralımı, döküm taşıma, bulut restore'u hep bu yoldan kendiliğinden onarılır.
- Fabrika filigranı YALNIZ `kabul`de ilerletir (`sync_watermarks`, tek tx). Onaysız paket bir sonraki turda aynı filigrandan yeniden kurulur (yeni `paketId`; içerik aynı olabilir, bulut 3. maddeyle idempotent). `paketId` bir paketin AĞ TEKRARLARI boyunca sabittir (istemci token kuralının karşılığı: mantıksal deneme başına bir kez).

### 6.5 Tur tipleri

- `ARTIMLI` — varsayılan; aralık `esitlemeAraligiDk` (portalda kurulum başına; plan varsayılanı 5). Zil `ozet` geldiğinde ANLIK projeksiyonlar aralık beklenmeden gönderilir (ekran açıkken anında tazeleme; zil içerik taşımaz, sahte zil yalnız fazladan tur yaptırır — 30 sn'de en çok bir).
- `TAM` — ilk eşitleme, `istenen: TAM`, katalog sürümü artışı, `UZLASTIRMA` uyuşmazlığı. Sayfalı; OLGU kökleri bulutun `ufukTarihi`nden yenileriyle sınırlanır (saklamanın dışındakini göndermez), BOYUT'lar hepsi.
- `UZLASTIRMA` — günlük (§4.4).

### 6.6 Sürüm ve N-1 uyumu

- **`sozlesme`**: bulut **N ve N−1**'i kabul eder. N−1 fabrikaya yanıtta `sozlesmeUyarisi: FABRIKA_SURUMU_ESKI` döner; uygulama/web ekranında "fabrika programı eski — bazı alanlar eksik" bandı (Senaryo P14). N−2 ve daha eski: 400 `SOZLESME_ESKI`, eşitleme durur, bant "güncelleme gerekli".
- **`katalogSurum`** (projeksiyon başına): aynı `sozlesme` içinde tel alanı SİLİNMEZ, yeniden ADLANDIRILMAZ, anlamı DEĞİŞMEZ; yeni alan EKLEMEK sürümü artırmaz (bulut bilmediği tel alanını saklar ama göstermez — gevşek okuma). Alan çıkarmak/anlam değiştirmek `katalogSurum` artırır ve o projeksiyonu TAM gönderime sokar.
- Protokol ile ilişki: İSTEK/JWS biçimi `LISANS-PROTOKOLU.md` v:1'dir; `esitle` amacı ve KİRA alanları orada donmuştur — bu belge protokol sürümünü ARTIRMAZ.

### 6.7 Hata kodları (`details.code`, gövde `{success:false, message:<TR>, details:{code}}`)

| Kod | HTTP | Ne zaman |
|---|---|---|
| `GOVDE_GECERSIZ` | 400 | şema dışı / tanınmayan anahtar / `kurulumId` İSTEK'le uyuşmuyor |
| `SOZLESME_ESKI` | 400 | `sozlesme` < N−1 |
| protokol kodları (`ISTEK_*`, `JWS_*`) | 401 | imzalı istek doğrulanamadı |
| `SINIF_GONDEREMEZ` | 403 | HAK sınıfı `URETIM` değil |
| `PATRON_BULUT_KAPALI` | 403 | hak yok / abonelik bitti |
| `ISTEK_TEKRAR` | 409 | nonce görüldü |
| `PAKET_ISLENIYOR` | 409 | aynı tesiste başka paket kilitte (fabrika bekleyip tekrar dener) |
| `PAKET_BUYUK` | 413 | sıkıştırılmış > 4 MB ya da açılmış > 32 MB |
| `SUNUCU_HATASI` | 500 | 503 kullanılmaz |

## 7. Rapor isteği protokolü

- **Katalog:** `constants/report-catalog.ts` 32 rapor anahtarı taşır (ölçüldü 2026-09-29); `audit/*` ailesi (2) buluta GİTMEZ ve istenemez. Bulut istenebilir listeyi fabrikanın gönderdiği `rapor-katalogu` ANLIK kaydından okur (anahtar, başlık, parametre şeması, gereken aile) — liste bulutta elle yazılmaz.
- **Standart anlık görüntüler (saatlik):** karne ailesi — `sales/order-intake`, `sales/shipment-scorecard`, `inventory/scorecard`, `quality/scorecard`, `subcontract/scorecard`, `customer/scorecard`, `finance/aging`, `finance/cheque-due` × dönemler {bugün, bu ay, geçen ay}. Diğerleri yalnız istekle.
- **Bulut tablosu** `report_requests {id, tesisId, hesapId, raporAnahtari, parametreler jsonb, durum BEKLIYOR→HESAPLANIYOR→HAZIR|HATA|IPTAL, sahipKurulumId, claimBitis, sonucId, hataKodu, createdAt, updatedAt}`; sonuç `report_results {id, tesisId, raporAnahtari, parametreOzeti, veri jsonb, hesaplandi, kaynakUfuk}` — aynı parametre özetiyle 5 dk içindeki ikinci istek mevcut sonuçtan cevaplanır.
- **Akış:** hesap isteği yazar (BEKLIYOR) → zil `rapor` → fabrika `POST /v1/rapor/al {enFazla: 3}` (imzalı, `amac: esitle`) → bulut ATOMİK CLAIM (`UPDATE … SET durum='HESAPLANIYOR', sahipKurulumId, claimBitis = now()+5dk WHERE durum='BEKLIYOR' … RETURNING`) → fabrika her isteği kendi rapor servisiyle ve **kendi Zod parametre şemasıyla** yeniden doğrular (bulut doğrulaması yetmez; tanınmayan anahtar → `HATA: RAPOR_BILINMIYOR`, geçersiz parametre → `HATA: PARAMETRE_GECERSIZ`) → `POST /v1/rapor/sonuc {istekId, durum, veri (gzip, ≤ 4 MB), hesaplandi, kaynakUfuk}` → bulut `HESAPLANIYOR→HAZIR` (WHERE durum='HESAPLANIYOR' AND sahipKurulumId eşleşir).
- **Zaman:** fabrika tarafı rapor başına 60 sn (`statement_timeout` ile); `claimBitis` geçen istek bulut işiyle BEKLIYOR'a döner (bir kez), ikincide `HATA: ZAMAN_ASIMI`. Zil kaçarsa her eşitleme turu `rapor/al`ı da yoklar (en geç aralık kadar gecikme).
- **Yetki:** istek için `bulut:rapor:oku` + raporun ailesine düşen okuma izni (finans raporları finans izni; eşleme §10). Sonuç kaydı da aynı projeksiyon-adı RLS'iyle korunur (`rapor.<aile>`).
- Rapor sonucu fabrikada hesaplanır ⇒ "bulut hesap yapmaz" korunur; rapor içeriği yine opt-in'dir: rapor servisinin çıktısı raporun tel şemasından geçer (kullanıcı adı taşıyan alan — ör. `production/operator-performance` operatör adı — `KISISEL` alt kayda ayrılır ya da rapor listeden çıkarılır; B1-kod her rapor için bu kararı katalogda beyan eder).

## 8. Gelen kutusu protokolü (B3)

### 8.1 Bulut kaydı
`inbox_messages {id, tesisId, mesajId uuid, tur SIPARIS|CARI, govde jsonb, hesapId, hesapAdi, durum, sahipKurulumId, claimBitis, sonuc jsonb {varlikId, belgeNo, kod, mesaj}, createdAt, updatedAt}` · `UNIQUE (tesisId, mesajId)` · `mesajId` istemcide MANTIKSAL DENEME başına bir kez üretilir (kök idempotency kuralı; yalnız belirsiz hatada yapışır).

Durum makinesi (hepsi atomik claim):
```
BEKLIYOR ──(yazar iptal)──► IPTAL
BEKLIYOR ──(fabrika al)───► ISLENIYOR ──(fabrika sonuç)──► ISLENDI | REDDEDILDI
ISLENIYOR ──(claimBitis geçti, bulut işi)──► BEKLIYOR        (fabrika makbuzu tekrar işlemeyi idempotent kılar)
```

### 8.2 Akış
Hesap kaydı yazar → zil `gelen-kutusu` → fabrika `POST /v1/gelen-kutusu/al {enFazla: 20}` → bulut claim (`claimBitis = now()+10dk`) → fabrika kayıtları `createdAt` sırasıyla, TEK SÜREÇTE işler (bir kaydın hatası diğerlerini durdurmaz) → `POST /v1/gelen-kutusu/sonuc [{mesajId, durum, varlikId, belgeNo, kod, mesaj}]` → bulut `ISLENIYOR→ISLENDI|REDDEDILDI` (WHERE durum='ISLENIYOR' AND sahipKurulumId eşleşir) + push kaydı (B5). Zil kaçarsa her eşitleme turu `al`ı yoklar.

### 8.3 Fabrikada işleme — idempotency ve makbuz
- `cloud_inbox_receipts {id, messageId @unique, kind, entityId, cloudAccountId, cloudAccountName, result jsonb, createdAt}` — ekleme-yalnız, DEFTER sınıfı (hangi bulut mesajının hangi varlığı doğurduğunun tek kaydı; silinmez).
- Tek boğaz: `tx` açılır → **makbuz kilidi tx'in İLK ifadesi** (mevcut 8036 token kilidi `lockClientTokenTx(tx, mesajId)` — yeni advisory uzay GEREKMEZ) → makbuz VARSA saklı `result` döner (iş kuralı yeniden koşmaz; kök `tokenReplay` sözleşmesinin aynısı) → yoksa varlık AYNI tx'te normal servis yolundan yaratılır → makbuz yazılır → commit.
- **Sipariş:** `OrderService.create` yolu (`prepareOrderCreate` doğrulaması) `clientToken = mesajId` ile; siparişin kendi `clientToken @unique`'i ikinci kilittir. **Cari:** `customer.service` yaratma yolu; kod backend'de üretilir. İKİ servis de bugün kendi `$transaction`'ını açar (`customer.service.ts:264` `createCardTx`, sipariş yaratma) ⇒ B3 dilimi tx-alan bir dikiş (`createInTx(tx, …)`) açar; mevcut uç o dikişi çağırır (davranış aynı, tek yol). Atomik değilse idempotency yoktur.
- Order/Customer'a kolon EKLENMEZ (yeni skaler kolon = yeni yazılabilir alan tuzağı); kaynak bilgisi makbuzda ve audit `meta`sında (`kaynak: "PATRON_BULUTU"`, `bulutHesapId`, `bulutHesapAdi`, `mesajId`) durur.

### 8.4 Teknik kullanıcı
`createdById` bir `User` FK'sidir ⇒ kurulum başına bir teknik kullanıcı "Patron Bulutu": parolası, PIN'i, kartı YOK (giriş yöntemi yok), izinleri yalnız `order:write` + `customer:write`, panelde "Patron bulutunu etkinleştir" eylemiyle normal kullanıcı servisinden audit'li doğar. Kimliği `system_settings` anahtarında (`patronBulutu.teknikKullaniciId`) durur — `User`a işaret kolonu EKLENMEZ. Kimliksiz `GET /api/auth/login-methods` ve `GET /api/auth/mobile-users` listelerinden BEYANLI hariçtir (bekçili; Senaryo P12).

### 8.5 Tel şemaları (KATI; alan kümesi fabrikanın yaratma şemasının ALT kümesidir — B3 dilimi fabrikanın Zod'undan türetir, elle kopyalamaz)
- `SIPARIS`: `cariKartId` · `subeId?` · `termin?` · `doviz` · `aciklama?` · `kalemler[1..200]: {urunId, renkId?, miktar, birim?, birimFiyat?, en?, musteriUrunAdi?, musteriRenkAdi?}`. Sipariş no, yön, durum fabrikada doğar.
- `CARI`: `ad` · `roller {musteri, tedarikci}` · `il?` · `ilce?` · `ulke?` · `vergiNo?` · `vergiDairesi?` · `adres?` · `yetkili?` · `telefon?` · `eposta?`. Kod fabrikada doğar; fason rolü buluttan açılmaz.

### 8.6 Ret ve bekletme
- Ret (`REDDEDILDI`, TR mesaj + `kod`): `GOVDE_GECERSIZ` · `CARI_AD_MUKERRER` (fabrikanın 409 `CUSTOMER_NAME_DUPLICATE`i) · `CARI_BULUNAMADI` · `URUN_BULUNAMADI` · `RENK_BULUNAMADI` · `MODUL_KAPALI` · `IS_KURALI` (servisin diğer 4xx'i; mesajı aynen). 5xx/ağ hatası ret DEĞİLDİR: kayıt `ISLENIYOR` kalır, claim süresi dolunca yeniden denenir.
- **Lisans:** işleyici HTTP kapısından geçmez ⇒ `licenseGate`in yazma yüklemini (tek kaynak, `constants/license-routes.ts` ile aynı karar) doğrudan çağırır: `zorla` kipinde KISITLI/DURDURULMUŞ iken `al` ÇAĞRILMAZ, kayıtlar `BEKLIYOR` kalır ve bulut "fabrika kısıtlı kipte — işlenmeyi bekliyor" gösterir. Gözlem kipinde (sıfır fark) işlenir.

## 9. Bulut veri modeli ve RLS (B2 taslağı)

### 9.1 Depolama biçimi
Tek genel tablo, projeksiyon başına ifade indeksleri — sözleşme N−1 esnekliği ve tek RLS politikası için:
```sql
CREATE TABLE projection_rows (
  tesis_id     uuid        NOT NULL,
  projeksiyon  text        NOT NULL,          -- "siparis" | "siparis.finans" | "ozet.stok" …
  kayit_id     uuid        NOT NULL,
  veri         jsonb       NOT NULL,
  surum_ani    timestamptz NOT NULL,          -- paketin ufku (§6.3)
  silindi_ani  timestamptz,
  saklama_tarihi timestamptz,                 -- OLGU'nun iş tarihi (§9.5); BOYUT'ta NULL
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tesis_id, projeksiyon, kayit_id)
);
CREATE INDEX ON projection_rows (tesis_id, projeksiyon, ((veri->>'durum'))) WHERE silindi_ani IS NULL;
CREATE INDEX ON projection_rows (tesis_id, projeksiyon, ((veri->>'cariKartId'))) WHERE silindi_ani IS NULL;
-- liste ekranlarının süzgeçleri B4 ekran envanterinden çıkarılır; her indeks bir ekran sorgusuna bağlanır.
```
Diğer tablolar: `sync_watermarks_cloud (tesis_id, projeksiyon, t, k)`, `paket_receipts`, `report_requests`, `report_results`, `inbox_messages`, `accounts`, `account_permissions`, `account_audit` (bulut denetimi), bildirim tabloları (B5). Hepsinde `tesis_id` ve aynı RLS.

### 9.2 Kiracı yalıtımı (satır)
```sql
ALTER TABLE projection_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection_rows FORCE ROW LEVEL SECURITY;          -- tablo sahibi de politikaya tabi
CREATE POLICY tesis_yalitimi ON projection_rows
  USING      (tesis_id = current_setting('app.tesis_id')::uuid)
  WITH CHECK (tesis_id = current_setting('app.tesis_id')::uuid);
```
- Uygulama rolü `patron_app`: `NOSUPERUSER NOBYPASSRLS`, tablo sahibi DEĞİL (sahip ayrı göç rolü); `REVOKE CONNECT … FROM PUBLIC`.
- `SET LOCAL app.tesis_id = $1` HER istek tx'inin İLK ifadesidir (tek yardımcı `withTesis(tesisId, fn)`); havuzlu bağlantıda tx bitince sıfırlanır. Ayarlanmamış (`current_setting` hata) ya da sıfırlanmış (`''::uuid` hata) bağlantıda sorgu HATA verir ⇒ fail-closed, sıfır satır (Senaryo P13 her iki hâli ayrı ölçer).
- Eşitleme yazımı da aynı yardımcıdan geçer: `tesisId` İSTEK'in kurulumundan (satıcı iç API) çözülür, gövdeden ALINMAZ.

### 9.3 Alan düzeyi izin (projeksiyon adı)
```sql
CREATE POLICY izinli_projeksiyon ON projection_rows AS RESTRICTIVE
  USING (projeksiyon = ANY (string_to_array(current_setting('app.projeksiyonlar'), ',')));
```
`withTesis` hesabın izinlerinden izinli projeksiyon adlarını (§10 eşlemesi, tek kaynak) hesaplayıp `SET LOCAL app.projeksiyonlar` yazar. RESTRICTIVE politika tesis politikasıyla VE'lenir: "sipariş görür, tutar görmez" hesap `siparis.finans` satırını DB düzeyinde okuyamaz (Senaryo P4: API + RLS). Eşitleme yazıcısı `app.projeksiyonlar = '*'` KULLANMAZ; yazım rolü ayrı (`patron_sync`) ve yalnız INSERT/UPDATE politikasına sahiptir.

### 9.4 Hesaplar
`accounts {id, tesisId, eposta (tesis içinde tekil), ad, parolaOzeti (scrypt), totpSirri (şifreli), durum AKTIF|KILITLI|PASIF, sonGiris, createdAt, updatedAt}` · parola + TOTP zorunlu · hesap başına TEK tesis · ilk yöneticiyi satıcı portalı davet bağlantısıyla açar (e-posta altyapısı v1'de yok) · kurtarma kodu YOK (yönetici kararı i: kayıpta tesis yöneticisi sıfırlar, yönetici yoksa satıcı CLI'si) · bulut denetimi `account_audit` (defter DEĞİL; saklama satıcı `Denetim`iyle aynı: başarısız giriş 90 gün, diğerleri 2 yıl — yönetici kararı h).

### 9.5 Saklama ve imha
Portal ayarı `saklamaAy ∈ {3, 13, 25, null=tümü}` (varsayılan 13). Saklama işi günlük: `saklama_tarihi < now() − saklamaAy` olan OLGU satırlarını ve `silindi_ani`sı 7 günü geçmiş satırları fiziksel siler; BOYUT'lar budanmaz. Her OLGU projeksiyonunun `saklama_tarihi` kaynağı katalogda beyan edilir (sipariş: `siparisTarihi`, sevkiyat: `cikisTarihi ?? olusturulma`, fatura: `tarih`…). Yanıttaki `ufukTarihi` (§6.4) fabrikanın TAM gönderimini aynı ufukla sınırlar. Abonelik bitişinde (`patronBulutBitis`) eşitleme durur; veri sözleşme süresi sonunda imha edilir, öncesinde dışa aktarma sunulur.

## 10. Bulut izin kataloğu

| İzin | Açtığı projeksiyonlar |
|---|---|
| `bulut:oturum` (her hesap) | BOYUT: `urun`, `renk`, `depo`, `istasyon`, `cari-kart`, `sube`, `fason-firma`, `rapor-katalogu` |
| `bulut:ozet:oku` | `ozet.*` bölümleri — her bölüm AYRICA kendi aile iznini ister (aşağıdaki satırlar) |
| `bulut:siparis:oku` | `siparis`, `siparis-kalemi`, `acik-siparis-karsilama`, `ozet.siparis` |
| `bulut:sevkiyat:oku` | `sevkiyat`, `dogrudan-sevk`, `cuval`, `ozet.sevkiyat` |
| `bulut:uretim:oku` | `is-emri`, `uretim-akisi`, `ozet.uretim`, `ozet.fason` |
| `bulut:stok:oku` | `stok-karnesi`, `ozet.stok` |
| `bulut:cari:oku` | `*.kisisel` alt satırları (yetkili, telefon, keşideci) |
| `bulut:cari-bakiye:oku` | `cari-hesap`, `cari-hareket`, `ozet-finans` |
| `bulut:kasa:oku` | `kasa`, `banka`, `kasa-hareketi` |
| `bulut:cek:oku` | `cek-senet`, `cek-hareketi` |
| `bulut:fatura:oku` | `fatura`, `fatura-kalemi` |
| `bulut:tahsilat:oku` | `tahsilat-odeme` |
| `bulut:fiyat:oku` | `fiyat` + finans DIŞI projeksiyonların `.finans` alt satırları (sipariş tutarı, kalem birim fiyatı) |
| `bulut:rapor:oku` | rapor isteği/sonucu — raporun ailesinin okuma izniyle birlikte |
| `bulut:siparis:yaz` | gelen kutusu `SIPARIS` |
| `bulut:cari:yaz` | gelen kutusu `CARI` |
| `bulut:hesap:yonet` | hesap aç/kilitle/izin ata, bulut denetimini gör |

- Finans projeksiyonlarının `.finans` alt satırları kendi projeksiyonunun iznine bağlıdır (ör. `cari-hareket.finans` → `bulut:cari-bakiye:oku`).
- Rol şablonları (kolaylık, kaynak değil): **Patron** (hepsi) · **Muhasebe** (finans okuma + cari okuma/yazma + rapor) · **Satış** (sipariş/sevkiyat/cari okuma + sipariş/cari yazma, finans YOK). İzin kataloğu KODDA (`patron/sunucu`), atama tesis yöneticisinin panelinde; süper yetki yoktur.
- Projeksiyon → izin eşlemesi TEK KAYNAKTIR ve katalogla birlikte değişir (bekçi: katalogdaki her projeksiyon ve alt satır tam bir izne eşlenir; eşlenmeyen = hiçbir hesaba görünmez değil, **kurulumda RED** — fail-closed).

## 11. Güvenlik, sır, KVKK

- Giden veri kategorileri katalog sınıflarından türetilir: İŞLEM (sipariş, sevk, üretim, stok, ürün/renk adları) · FİNANS (tutarlar, bakiyeler, fiyatlar) · KİŞİSEL (cari yetkili adı/telefonu, çek keşidecisi) · serbest metin (açıklamalar). Fabrika kullanıcı adları ve kimlikleri (`createdById` vb.) HİÇBİR projeksiyonda yoktur; ANLIK ve rapor çıktıları katı tel şemasından geçer.
- Sırlar: kurulum özel anahtarı `LICENSE_DIR`de kalır; bulut açık anahtarı satıcıdan alır; bulut hesap parolası/TOTP sırrı fabrikaya hiç gelmez; gelen kutusu kayıtlarında parola/sır alanı yoktur.
- Taşıma: TLS (Cloudflare proxy) + İSTEK imzası + gövde özeti ⇒ yol üstünde değiştirilen paket reddedilir.

## 12. Fabrika tarafı ek yüzeyler

- Panel "Bulut hesapları" salt-okunur listesi (bulut `accounts` özetinden, imzalı istekle çekilir) + "kilitle" isteği (imzalı; bulut atomik claim) — B6 ile birlikte.
- Sağlık özeti (`saglik`) protokolde DONMUŞ bir allowlist'tir; eşitleme gecikmesi oraya EKLENMEZ — gecikmeyi bulut kendisi ölçer (son kabul edilen paket) ve B5 "eşitleme N dk gelmedi" bildirimini üretir.

## 13. Doğrulama — Senaryo P genişletmesi

Plan P1–P16 aynen geçerlidir. Bu tasarımın ölçtüğü yeni riskler için eklenir:
- **P17** ayrılma körlüğü: top çuvaldan çıkarılır → ESKİ çuvalın top sayısı/metresi ≤ aralık içinde bulutta düşer.
- **P18** `customers`/`items`/`warehouses` guard'lı kalıcı silme → `sync_marks` SILINDI → bulutta satır düşer (statik taramanın kör olduğu yol).
- **P19** birleştirme → taşınan siparişlerin `cariKartId`si bulutta survivor olur; geri alma → eski hâle döner.
- **P20** `shipment_orders` küme yenileme → sevkiyatın `siparisIdleri` bulutta güncellenir.
- **P21** güvenli ufuk: tx açık tutulur, eşitleme turu koşar → satır ATLANMAZ; tx commit sonrası turda gelir. Uzun açık tx'te tur "ufuk takıldı" damgası yazar, filigran ilerlemez.
- **P22** zincir kopukluğu: bulut filigranı elle geri alınır → sonraki pakette `istenen: TAM`, TAM sonrası uzlaştırma eşit.
- **P23** gelen kutusu `zorla`+KISITLI → kayıt BEKLIYOR kalır, kademe NORMAL'e dönünce işlenir.
- **P24** RLS alan izni: `bulut:siparis:oku` var `bulut:fiyat:oku` yok → `siparis` görünür, `siparis.finans` doğrudan SQL'le de 0 satır.
- **P25** ANLIK opt-in: `uretim-akisi` çıktısında operatör adı yoktur.

## 14. Plandan sapmalar ve genişlemeler (gözden geçirilecek)

- **S1 — silme tespiti tetikleyiciyle, 24 kökün hepsinde.** Plan: finansa dokunan hard delete'ler uygulama katmanında aynı tx'te damga, diğerleri günlük uzlaştırma. Neden sapıldı: statik tarama üç ayrı biçimde kör ölçüldü (dinamik delegate — 3 tablo ilk taramada görünmedi; 29 kaskad FK; dinamik tablolu birleştirme silmesi); tetikleyici aynı tx'te yazar (planın şartı) ve silen yolun dilinden bağımsızdır. Günlük uzlaştırma güvenlik ağı olarak KALIR.
- **S2 — `payment-allocation` ölçüldü:** 6 ham UPDATE `updatedAt`i yazar; filigran güvenilir (plan "ölçülür" demişti).
- **S3 — FINANS/KISISEL kolonlar alt satıra bölünür**; alan izni RLS ile projeksiyon adından (plan "API + RLS" diyordu, mekanizmayı bu belge koyar).
- **S4 — maliyet v1'de yok** (kaynak kolon yok, ölçüldü); izin de doğmaz.
- **S5 — `invoice_lines` tetikleyicisiz:** kalem yalnız TASLAKTA değişir varsayımı `invoice.service` düzenleme claim'inden okundu; B1-kod dilimi bunu bir bekçiyle ölçmeli (onaylı faturanın kalemine yazan yol = 0).
- **S6 — güvenli ufuk** (`xact_start`) plan metninde yoktu; `updatedAt` filigranının commit sırası açığını kapatır.
- **S7 — ayrılma körlüğü ve filigransız tablo** (`rolls` FK tetikleyicisi, `shipment_orders` tetikleyicisi) planda yoktu.
- **S8 — `patron-bulut` fail-closed** (modül tavanının fail-open'ının tersi) açık kural olarak yazıldı.
- **S9 — gelen kutusu KISITLI'da çekilmez** (`licenseGate` yüklemi iş içinden çağrılır).
- **S10 — BOYUT'lar `bulut:oturum`** ile açılır (sözlük olmadan olgu okunamaz); KISISEL kolonları alt satırda kalır.
- **S11 — bulut deposu genel `projection_rows` + ifade indeksleri** (tip başına tablo değil) — N−1 esnekliği ve tek politika.
- **S12 — `sync_marks` telemetri sınıfı**, budanır; `test_telemetri_defter_degil` beyanına girer.

**B1-kod (2026-09-29) — uygulamada netleşen / eklenen (B2 bunları uygular):**
- **S13 — standart rapor görüntüleri** §7'de tel biçimi yoktu: `POST /v1/rapor/sonuc` ile `istekId: null` + `donem` (`bugun` · `bu-ay` · `gecen-ay`; kesit raporda `null`) gider; bulut bunu `report_results`e sonuç satırı olarak yazar (aynı parametre özetiyle gelen istek oradan cevaplanır). Gövde KATI (`ReportResultSchema`), gzip'li.
- **S14 — rapor hata kodları** genişledi: `RAPOR_BILINMIYOR` · `PARAMETRE_GECERSIZ` · `ZAMAN_ASIMI` + `RAPOR_KAPALI` (rapor görünürlük listesinde kapalı ya da liste ölçülemedi) · `MODUL_KAPALI` · `SONUC_BUYUK` (sıkıştırılmış > 4 MB). `rapor/al` yanıtı `{v:1, istekler:[{istekId, raporAnahtari, parametreler}]}`; `rapor/al` gövdesi gzip'SİZ (küçük), `esitle` ve `rapor/sonuc` gzip'li.
- **S15 — TAM'ın ilk parçası zinciri SIFIRDAN kurar** (`filigran.onceki: null`); sonraki parçalar zinciri sürdürür. §6.4 kuralı ("saklanan yokken önceki ≠ null → boşluk") TAM'a da uygulanır; bu yüzden TAM önceki değer taşımaz, yoksa kopuk zincirde TAM da reddedilip sonsuz döngü doğardı.
- **S16 — zamana bağlı alan GEÇİŞ kaynağıyla** (§4.3c'deki 00:05 toplu yeniden hesap yerine): her turda termin/efektif vade (önceki konum, ufuk] aralığına düşen kökler kirlenir (katalog `crossings`). `gecikmis` (sipariş) ve `vadesiGecti` (fatura) BOOLEAN'dır — gün sayısı her gün değişip bütün gecikmiş kümeyi yeniden gönderttirirdi; cari hesabın `gecikmis`i para birimi başına tutar listesidir (yaşlandırma çekirdeği, geçişte değişir).
- **S17 — bulut adresi** `PATRON_CLOUD_URL` (tek okuyucu `src/cloud-sync/cloud-url.ts`; verilmezse `https://patron.etkiliyazilim.com`, `kapali` → çıkış yok, düz HTTP yalnız döngü adresine). Adres tek başına eşitleme açmaz (§1.4).
- **S18 — kurulum kimliği** (İSTEK `kurulumId` + paket `kurulumId`) kullanılabilir HAK'ın `kurulumId`sidir (yönetici kararı D14: lisans kimliği LICENSE_DIR'de; DB `installationId` yalnız etiket).
- **S19 — `sevkiyat.siparisIdleri`** `shipment_orders` kümesinin TAMAMIDIR (liste `_count.orders` ile aynı); `isActive` yalnız "sevkiyat PLANNED" denormudur, sevk sonrası false olur ve süzülmez.
- **S20 — uzlaştırma yalnız son ONAYLI ufuktan önce doğan satırları sayar** (`createdAt < zincir.t`) — sonra doğan satır henüz bulutta değildir, sahte uyuşmazlık doğmasın. Bulut kendi canlı kümesini sınırsız sayar; uyuşmazlık = TAM.
- **S21 — anlık kapsam daraltması (v1):** `acik-siparis-karsilama` satır listesini (`lines`: sipariş no · müşteri · ürün adı) TAŞIMAZ (özet + müşteri/ürün kırılımı); `stok-karnesi` en eski top listesini (barkod · top kimliği) TAŞIMAZ (top düzeyi v1 dışı). `ozet.uretim` yalnız `production.enabled` açıkken; `ozet.sevkiyat`/`ozet.fason` dört pencere (`bugun` · `buAy` · `gecenAy` · `son30Gun`).
- **S22 — `sync_marks (tableName, createdAt, id)` indeksi** eklendi (projeksiyon başına tarama); migration 33 indeks.
- **S23 — `fatura-kalemi` saklama tarihi ebeveynden** (`retention.parent: fatura.faturaId`) — kalemin kendi tarihi yok.
- **S24 — rapor çıktısı tel şeması (v1):** rapor başına katı şema YOK; yerine uzak rapor listesi dar (8 karne) ve her biri `personalData: "YOK"` beyanlıdır, çıktı panel süzgeç seçeneklerinden (`secenekler`) arındırılır ve bekçi sondası (kişi/kullanıcı alanı) koşar. Rapor başına katı tel şeması v1.1 borcu.
- **S25 — ham UPDATE beyanı** (`scripts/lib/bulut-ham-update-beyan.ts`, bekçi `test_bulut_ham_update`): §4.2'deki 16 → 24 ham UPDATE ölçüldü (roll_movements'in 8 çıkış-ölçüsü yazımı eklendi: `updatedAt` yazmaz ama türetmenin okuduğu kolona dokunmaz); `updatedAt`siz her ham UPDATE beyanlı, ölü beyan kırmızı.

## 15. Ölçüm betikleri (bu dilimin çıktısı)

| Betik | DB | Ne ölçer | Çıkış |
|---|---|---|---|
| `scripts/olcum/patron-katalog.ts` | — | kataloğun makinece okunur taslağı (§3) | — |
| `scripts/olcum/patron-sema-olcumu.ts` | `_test` (salt okuma) | ① opt-in kolonlar şemada var mı · ② filigran kolonu + KISMİ OLMAYAN indeks + `(filigran, id\|PK)` → migration önerisi · ③ kaskadlar · ④ dışarıda kalan kolonlar · ⑤ sınıflanmamış tablolar · ⑥ ufuk ön koşulu | hata varsa 1 |
| `scripts/olcum/patron-yazim-noktalari.ts` | yok (tipli AST) | ① silen yollar (delegate + iç içe + ham) · ①b `/:id/permanent` → `BaseService.hardDelete` · ② ham UPDATE'lerin `updatedAt` yazıp yazmadığı · katalog `silme` ↔ kod uyumu | uyumsuzluk varsa 1 |
| `scripts/olcum/patron-hacim-olcumu.ts` | `_test` (salt okuma) | satır başına tel boyu (fikstür + tip tahmini), gzip oranı, ANLIK boyutları | — |

Koşum: `cd Teks-Erp && node ../scripts/agir-is.mjs -- npx tsx scripts/olcum/<betik>.ts` — hedef `hedef-db-kapisi` ile `_test` kalıbına kilitli, fabrika ölçeğinde top taşıyan DB'de DURUR. Negatif sondalar (2026-09-29): katalogda `items` silmesi `YOK` yapılınca `patron-yazim-noktalari` "1 uyumsuzluk" · var olmayan opt-in kolon yazılınca `patron-sema-olcumu` "Hatalar (1)" basar.

**B1-kod migration önerisi (yalnız ekler; düz `CREATE INDEX IF NOT EXISTS` — Prisma migration tek tx'te koşar, `CONCURRENTLY` yazılmaz [DB-26]):** 28 filigran kaynağına `(filigran, id|PK)` indeksi + birleştirme defterine 3 indeks (`patron-sema-olcumu` ② "öneri" satırları, toplam 31; `rolls` dahil — mevcut `rolls_depo_updatedAt_idx` KISMİDİR, tam taramaya yaramaz) + `sync_marks` tablosu, enum'u ve tetikleyicileri + `sync_watermarks` + `cloud_inbox_receipts`. İndeks yapımı yazmayı kilitler: kurulum `kur.ps1` migration adımında backend durmuşken koşar; `rolls` büyüklüğü sahada ölçülüp süre tahmini runbook'a yazılır. Şema provası en eski canlı dökümde (kök kural).

## 16. Açık sorular (kullanıcı / 1e)

1. **Maliyet** kaynağı ne olacak (ürün kartında standart maliyet mi, reçeteden mi)? Karar gelene kadar `bulut:maliyet:oku` yok.
2. **Standart rapor listesi** (§7) ve dönemleri onayı.
3. **Aralık alt sınırı:** KİRA şeması `esitlemeAraligiDk`yı sınırlamıyor (int \| null); öneri 1–60 dk, portal doğrulaması.
4. **v2 kapsamı:** parti, sevk partisi, alış siparişi, mal kabul, dokuma/levent/iplik, top düzeyi — §3.4 listesi.
5. **Rapor kişisel alanları:** `production/operator-performance` gibi kullanıcı adı taşıyan raporlar bulutta hiç sunulmasın mı, yoksa `.kisisel` alt kaydıyla mı?

**B1-kod'da uygulanan varsayılanlar (yönetici kararı, kullanıcı teyidine açık):** 1 maliyet v1'de YOK (`bulut:maliyet:oku` doğmadı) · 2 standart görüntüler = uzak rapor listesinin karne ailesi (`sales/order-intake` · `sales/shipment-scorecard` · `customer/scorecard` · `quality/scorecard` · `subcontract/scorecard` dönemli; `inventory/scorecard` · `finance/aging` · `finance/cheque-due` kesit) — `src/cloud-sync/report-requests.ts` `REMOTE_REPORTS` · 3 aralık fabrikada 1–60 dk'ya kıstırılır (`clampInterval`) · 4 v2 = B2–B6 sonrası · 5 kişi adı taşıyan rapor (operatör performansı) v1'de buluttan istenemez.
