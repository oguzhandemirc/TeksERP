# KARTELA HAREKET DEFTERİ — Faz 0 (tasarım, kod yok)

> **Durum:** TASLAK — kullanıcı kararı bekliyor (§6). 9b, 2026-09-26.
> **Kullanıcının sorusu:** *"Kartela ve kartela hareketleri ayrı tablo olsa daha mı iyi olur … anlık değil
> profesyonel bir çözüm üretelim."*
> **Tetik:** B-RM taraması (`test_defter_ters_yol` §14) `reverseStockReductionTx`in geri almada
> `Swatch.cancelledAt`ı `null`'ladığını BORÇ olarak yazdı; "durum kolonu sayılsın mı (A) / borç kalsın mı
> (B)" sorusu kullanıcıya gitti. Kullanıcı soruyu kartela modelinin kendisine genişletti.
> **Kaynaklar:** kod ölçümü `origin/main` `c120e599` (satır numaraları o sürümden) · sektör taraması (§3,
> bağlantılı). Mevcut akışın tasarımı `docs/design/KARTELA-TASARIM.md` (2026-06-04, SABİT).

## 0. Kısa cevap

**Evet — ama "kartela stoğu için ikinci bir stok defteri" değil, KARTELANIN KENDİ OLAY DEFTERİ.**

Kartela (`Swatch`) kendi kimliği (barkod `KRT…`), kendi birimi (ADET, metre değil) ve kendi yaşam
döngüsü (doğar → çuvala girer → sevk edilir / düşülür → geri alınır) olan ayrı bir VARLIKTIR. Bugün bu
döngünün "şu an ne"si bir satırda duruyor, "ne oldu"su ise ya hiçbir yerde (çuval/sevk üyeliği), ya
audit'te, ya da geri alınınca silinen bir damgada (`cancelledAt`). Önerilen:

- `Swatch`a **durum kolonu** (`status`) + **tek yazar**;
- ayrı, append-only **`SwatchEvent` defteri** (evin `WorkOrderEvent` · `ShipmentEvent` · `ChequeEvent`
  emsali);
- rulonun kartelaya giden metresi **bugünkü gibi** `WarehouseMovement`ta kalır (değişmez).

Stok defterine (`WarehouseMovement`) "kartela türü" eklemek (seçenek B) ÖNERİLMEZ: o defter TOP
defteridir (`rollId NOT NULL`, metre, stok kümesi statüleri), kartela ise topu tüketip ADETLE doğan başka
bir nesnedir. Gerekçe §4.

## 1. BUGÜN (ölçüldü)

### 1.1 Modeller

| Model | Ne tutar | Durum kolonları | Append-only? |
|---|---|---|---|
| `Swatch` (`schema.prisma:6108-6160`) | tek kartela; barkod, kumaş/renk, doğduğu kabul, ebeveyn top | `shipmentId` · `sackId` (şu anki üyelik) · `cancelledAt` + `cancelReason` (`:6130-6133`) | HAYIR — durum satırı; **status kolonu yok, `cancelledById` yok** |
| `SwatchStockReduction` + `…Item` (`:6167-6215`) | "N adet düş" belgesi + etkilediği kartelalar | `reversedAt/ById/reverseReason` (storno damgası) | EVET (defter; negatif satır `swatch_stock_reductions_count_pos` CHECK'i yüzünden yazılamaz) |
| `KartelaDispatch` + `…Item` (`:6225-6278`) | topun kartela firmasına sevki | `cancelledAt/ById/Reason` | başlık damgalı, kalem satır |
| `KartelaReceipt` + `…Item` (`:6280-6334`) | kartelaların dönüşü, top başına `kartelaCount` | `cancelledAt/ById/Reason` | başlık damgalı, kalem satır |
| `Roll.markedForKartela` (`:2939`) | "kartelalık" işareti | boolean, iki yönde ezilir | — |

### 1.2 Yazım yolları — hangi olay nerede tutuluyor

| Olay | Yol (dosya:satır) | Nerede tutuluyor | Ters mekanizması |
|---|---|---|---|
| Top kartela firmasına | `KartelaService.dispatch` `kartela.service.ts:208-433` | belge + kalem · `WarehouseMovement` EXTERNAL/`KARTELA_DISPATCH` · `roll_status_events` (trigger) | `cancelDispatch` `:438-572`: damga + BAĞLI ters satır `KARTELA_CANCEL` ✅ |
| Kartelalar döner (N adet doğar) | `receive` `:577-821` | belge + kalem · N `Swatch` · top `KARTELA_CONSUMED` (`roll_status_events`) · stok defteri satırı YOK (iki uç da stok dışı — bilinçli, `warehouse-ledger.helper.ts:296-299`) | `cancelReceipt` `:863-995`: belge damgası + kartelalarda `cancelledAt` SET; **kartela için ayrı olay satırı yok**, actor yalnız belgede |
| Kartela stoktan düşülür | `reduceStock` `:1485-1606` | `SwatchStockReduction` + kalem · kartelada `cancelledAt` SET | `reverseStockReductionTx` `:1727-1801`: belgede `reversedAt` damgası ✅ · kartelada **`cancelledAt = null`** ⚑ (§14 BORÇ, `defter-beyan.ts:735-736`) |
| Kartela çuvala | `scanIntoSack` `shipping.service.ts:817-850` · `addKartelaToSack` `:856-887` | yalnız `Swatch.sackId` | çıkarma `:915-937` · dağıtma `:977-1017` · çuval silme `:1664-1704`: **`sackId = null`**; geçmiş YALNIZ audit'te |
| Kartela sevkiyata | `createShipmentCoreTx` `:2481` · `addSacksToShipment` `:3082` | yalnız `Swatch.shipmentId` | `removeSackFromShipment` `:3106` · `cancelPlannedShipmentTx` `:3762`: **`shipmentId = null`** |
| Sevkiyat çıkar | `performDispatchTx` | kartelaya hiçbir şey yazılmaz — "sevk edildi" yalnız `Shipment.status`tan türer | `undoDispatch` kartelaya dokunmaz |
| Top "kartelalık" işaretlenir | `setRollMarkedForKartela` `:1334-1392` | boolean + `labelDirty` | ters yazım aynı kolonun üstüne; geçmiş YALNIZ audit'te |

**Sonuç:** hard delete YOK (22 yazım sitesi, 0 silme). Ama:
1. **Damga silme bir tane** — düşüm stornosu `Swatch.cancelledAt`ı boşaltıyor (§14 BORÇ). Kök kural "geri
   alma ileri kaydı ne siler ne değiştirir".
2. **Tarihçesi hiçbir defterde olmayan dört olay** — çuvala girme/çıkma, sevkiyata girme/çıkma. Kartelanın
   hangi çuvaldan geçtiği bugün yalnız audit'te (audit 6 ayda arşivlenir; kural "audit'ten karar ya da iş
   bilgisi türetilmez").
3. **Aynı damgayı iki anlamda kullanan kolon** — `cancelledAt` hem "düşüldü" hem "kabulü iptal edildi"
   demek; hangisi olduğu ancak başka tabloya bakarak (düşüm kalemi mi, ölü kabul mü) anlaşılıyor.
4. **"Sevk edildi" durumu yok** — kartelanın sevk edilmiş olması `Shipment.status`tan türetiliyor.

### 1.3 Okuyucular

- Rapor servisleri kartela tablolarını HİÇ okumuyor (`reports/**`).
- Stok ekranı `getStock` (`kartela.service.ts:1403-1473`): `shipmentId IS NULL ∧ sackId IS NULL ∧ cancelledAt
  IS NULL` = "stokta".
- ⚠️ **İstatistik hatası:** `tambur.service.getSwatchStats` (`:1745-1775`) yalnız `cancelledAt` süzüyor;
  sevk edilmiş kartelalar "Toplam Kartela"da sayılıyor.
- Panel Kartela Takibi salt okunur (`KartelaPage.tsx`). İptaller tablette
  (`KartelaSevkGecmisiScreen` · `KartelaKabulGecmisiScreen`). Düşüm ve storno: panel `ReduceKartelaStockDialog`,
  `KartelaReductionHistoryDialog`; tablet `KartelaStockReduceModal`.
- Çalışan kodda audit okuyan kartela yolu YOK. Tek okuyan bir bekçi: `test_consistency_derived.ts:314-331`
  (`markedForKartela`).

### 1.4 Kararlar ve çelişki

- **2026-06-04:** kartela iş emirsiz, top komple tükenir (`KARTELA-TASARIM.md:62-65`).
- **2026-06-28:** kartelaya etiket vurulmuyor, yalnız ADET sayılıyor (`:10`). Çuval barkod dalı pratikte ölü.
- **2026-09-11 arşiv notu:** *"`Swatch.cancelledAt` durum kolonudur, defter değil: geri alma onu boşaltır"*
  (`CLAUDE-NOT-ARSIVI.md:6959`).
- **2026-09-25 B-RM:** aynı kolon "BORÇ — karar kullanıcıda" diye yeniden sınıflandı (`:12516-12522`).
  Bu iki not ÇELİŞİYOR.
  - Kökü şu: kolon kim/neden taşıyor (`cancelReason`) ama bu taşıma YARIM. `cancelledById` yok ve düşüm
    ile kabul iptali aynı kolonu paylaşıyor.
  - Defter doktrininin ölçütü bu (`defter.md:34`): *kim/neden/miktar taşıyorsa DAMGA, taşımıyorsa ve "ne
    oldu" bir defterde satırsa DURUM BAYRAĞI*. Kartela bugün iki sınıfın ortasında duruyor.

## 2. Doktrinle karşılaştırma

| İlke (`defter.md`) | Bugün | Öneriyle |
|---|---|---|
| İleri kayıt değişmez; geri alma ters kayıt yazar (:16, :45) | düşüm stornosu `cancelledAt`ı siler | durum kolonu `status` değişir, "ne oldu" `SwatchEvent`te satır; `cancelledAt` durum kolonuna iner, §14 BORÇ kapanır |
| Tekrar edebilen çevrim tek kolona sığmaz; olay defteri ister (:22) | çuvala gir → çık → gir; sevkiyata gir → çık | her giriş/çıkış bir satır |
| Her ileri olayın beyanlı ters mekanizması (:18) | çuval/sevkiyat üyeliğinin ileri kaydı yok | ileri ↔ ters tipli çiftler (§5.2) |
| Audit yalnız ayak izidir | çuval/sevk geçmişi yalnız audit'te | geçmiş defterde, audit okunmaz |
| Mali etkili defterin geçmişi audit'e yazılamaz (:95) | — (kartelanın bugün mali bağı yok; §6 S5) | — |

## 3. Sektör standardı (tarama 2026-09-26; bağlantılar tarayan ajanın raporundan, doğrulama notlarıyla)

- **SAP ECC/S/4HANA:** numune AYRI bir stok dünyası değildir. Tek belge defterinde (S/4 `MATDOC`, yalnız
  ekleme) bir hareket türüdür.
  - Hareket türleri: 333/331/335 numune çekme; müşteriye bedelsiz numune FD/KLN siparişi → 601,
    fiyatsız.
  - İadesi beklenen mal kendi stokunuzda özel stok göstergesiyle durur: W konsinye 631/632, V iade
    ambalajı 621/622.
  - Kaydedilmiş belge değişmez; iptal, eşli türde YENİ belgedir (201↔202, 261↔262, 551↔552).
  - Kaynaklar: SAP Community soru-cevap sayfaları; SAP Help sayfaları yalnız arama özetiyle okundu.
  - SAP'de standart bir "kartela varlığı" bulunamadı; genel bilgi, doğrulanmadı.
- **Logo (STLINE/STFICHE) · Netsis (TBLSTHAR):**
  - Bütün hareketler tek tabloda, fiş türüyle ayrılır (Logo TRCODE: 11 fire · 12 sarf · 25 ambar · 9
    konsinye çıkış; Netsis HTUR/FTIRSIP).
  - Numune/kartela fiş türü yok; uygulamada "numune" notlu sevk irsaliyesi ya da sarf fişi.
  - İptal Logo'da bayrak (`CANCELLED`), Netsis'te silme (fatura silinince stok hareketleri de silinir) —
    iz kaybettiren yol.
- **Tekstile özgü ürünler:**
  - Kartela ayrı bir VARLIK/MODÜL olarak görünüyor; yaşam döngüsü talep → üretim → gönderim → siparişe
    dönüşüm, müşteriye/temsilciye kim verdi.
  - Örnekler: TexBox "Fuar - Kartela" (maykan.net), Pera Kartela Takip (perayazilim.com, yalnız özet),
    Aysis SENIOR (yalnız özet).
  - Miktar etkilerinin ayrı deftere mi stok defterine mi yazıldığı açık kaynakta YOK.
- **Genel ilke:**
  - Fowler "Reversal Adjustment": kayıt değişmez, düzeltme ters + doğru kayıttır.
  - Odoo: tamamlanmış hareket silinmez, iade ile terslenir.
  - IFRS 15 B77–B78: kontrol devredilmediyse (geri çağrılabilir) konsinyedir, stok sizindir; bedelsiz
    numune giderdir.

**Baskın desen:**
- Tek, değişmez hareket defteri + tipli hareketler + eşli ters tip.
- Üstünde yaşam döngüsü taşıyan bir belge/varlık katmanı (tekstil ürünlerinde kartela varlığı).
- Ayrı bir alan-başı MİKTAR defteri gözlenmedi — ama bu ürünlerde "stok defteri" genel malzeme defteridir
  (her birim, her malzeme).

## 4. Seçenekler

| | (A) Kartela olay defteri `SwatchEvent` + `Swatch.status` | (B) `WarehouseMovement`a kartela türleri | (C) Bugünkü gibi (durum kolonları) |
|---|---|---|---|
| Birim | ADET, satır başına tek kartela | defter METRE ve `rollId NOT NULL` — `swatchId` + birim + uç kuralı genişler | — |
| Doktrin | ileri kayıt değişmez, çiftli ters tipler, §14 kapanır | uç şekli iff'i (`defter.md:85`) ve `direction_present` CHECK'i kartelaya uymaz (kartela stok kümesi statüsü taşımaz); K ölçüsü ve stok raporları top varsayar | §14 BORÇ kalır; çuval/sevk geçmişi audit'te |
| Evin emsali | `YarnMovement` (farklı birim, ayrı defter) · `WorkOrderEvent` · `ShipmentEvent` · `ChequeEvent` · `RollStatusEvent` | — | — |
| Sektörle ilişki | tekstil ürünlerindeki "kartela varlığı" + SAP'nin "değişmez belge, eşli ters tür" ilkesi | SAP'nin "tek defter" biçimi — ama bizde tek defter bir genel malzeme defteri değil, TOP defteri | Logo/Netsis KOBİ deseni; iz zayıf |
| Maliyet | yeni tablo + enum + tek yazar + ~10 yazım sitesinin bağlanması | ortak defterin şema ve ölçü kapılarının genişlemesi | 0 |

**ÖNERİ (A).** Gerekçe:
- Evde "ayrı defter" kararının ölçütü BİRİM ve NESNEdir. İplik kg olduğu için `YarnMovement` ayrıdır; iş
  emri kendi olaylarını `WorkOrderEvent`te tutar.
- Kartela da topu tüketip ADETLE doğan ayrı bir nesnedir.
- Rulonun kartelaya giden METRESİ bugünkü gibi `WarehouseMovement`ta kalır (sevk + bağlı iptal zaten
  doğru). Böylece "tek stok defteri" ilkesi kumaş için korunur, kartela kendi adet defterini alır.

## 5. Önerilen model (A)

### 5.1 Şema (yalnız EKLER)

- `enum SwatchStatus { IN_STOCK, IN_SACK, IN_SHIPMENT, SHIPPED, REDUCED, VOIDED }`
  - Stok = `IN_STOCK`.
  - Canlı (çuvalda / sevkiyatta) = `IN_SACK`, `IN_SHIPMENT`.
  - `REDUCED` = düşüldü; storno ile `IN_STOCK`a döner.
  - `VOIDED` = kabulü iptal edildi; terminal, çünkü kabul yeniden açılmaz.
- `Swatch.status SwatchStatus NOT NULL DEFAULT 'IN_STOCK'` + `statusChangedAt`.
  - CHECK çifti: `status` ↔ (`sackId`, `shipmentId`, `cancelledAt`) tutarlılığı. Çift yüklem kuralı,
    DB seddi.
- `model SwatchEvent` → `swatch_events`, append-only. Kolonlar:
  - `id`, `swatchId` (FK Cascade — kartela zaten silinmez), `type SwatchEventType`,
    `fromStatus?`, `toStatus`.
  - `sackId?`, `shipmentId?`, `receiptId?`, `reductionId?`.
  - `reversesEventId?`: BAĞLI ters.
  - `groupId`: tek kullanıcı eylemi.
  - `actorId?`, `channel?`, `reason?`, `preEpoch Boolean` (göç satırı), `createdAt`.
  - Ortak mühür `defter_block_tamper` (K-A3/D1 emsali).
- `cancelledAt`/`cancelReason` KALIR ama DURUM KOLONUNA iner: yalnız tek yazar yazar,
  `REDUCED`/`VOIDED`ta dolu.
  - Kim/neden/ne zaman artık `SwatchEvent` satırındadır; kolon bunu yalnız tekrar eder.
  - Bu, `defter.md:34` ölçütüyle §14'ü (A) yönünde kapatır.

### 5.2 Olay kataloğu ve ters mekanizmaları

| İleri | Ters | Mekanizma | Yazan (bugünkü site) |
|---|---|---|---|
| `BORN` (kabulde doğdu) | `VOIDED` (kabul iptali) | bağlı ters, terminal | `receive` · `cancelReceipt` |
| `SACKED` | `UNSACKED` | net karşı olay (çuval id'si satırda) | `scanIntoSack` / `addKartelaToSack` · `removeSwatchFromSack` / `distributeSackContents` / `removeSack` |
| `SHIPMENT_ADDED` | `SHIPMENT_REMOVED` | net karşı olay | `createShipmentCoreTx` / `addSacksToShipment` · `removeSackFromShipment` / `cancelPlannedShipmentTx` |
| `SHIPPED` | `SHIP_UNDONE` | bağlı ters | `performDispatchTx` · `undoDispatch` |
| `REDUCED` | `REDUCTION_REVERSED` | bağlı ters (+ belgede `reversedAt` bugünkü gibi) | `reduceStock` · `reverseStockReductionTx` |

- Yazımlar TEK boğazdan geçer: `transitionSwatchesTx(tx, {ids, to, type, refs, reason})`. İçinde atomik
  claim (`updateMany WHERE {id IN, status IN beklenen}`, count eşleşmezse 409) ve aynı tx'te olay satırı
  vardır.
- Kilit sırası bugünkü gibidir: düşüm defteri → kartela (`CLAUDE-NOT-ARSIVI:7796-7803`); çuval/sevkiyat
  yollarında önce çuval/sevkiyat satırı, sonra kartela.
- Kapı: AST bekçisi. `Swatch.status/sackId/shipmentId/cancelledAt` yalnız tek yazardan yazılır. WO D1
  deseni `test_workorder_event_yazar`.

### 5.3 Okuyucular

- `getStock`, `getSwatchStats`, stok süzgeçleri `status`tan okunur. Tek yüklem: `IN_STOCK`. §1.3'teki
  istatistik hatası da böylece kapanır.
- Panel Kartela Takibi'ne salt okunur **"Kartela Hareketleri"** gelir: barkod ya da kabul no → olay listesi,
  Excel. Bu, İş Emri Hareketleri'nin aynı sütun modelidir.
- Çuval içerik dökümü değişmez (şu anki üyelikten okur).

### 5.4 Göç ve geriye dönüklük (MV-05)

- **Durum kolonu backfill'i** (migration, tek seferlik, mevcut kolonlardan — audit DEĞİL). Öncelik sırası:
  1. ölü kabule bağlı → `VOIDED`
  2. canlı düşüm kalemindeyse → `REDUCED`
  3. `shipmentId` dolu ve sevkiyat çıkmış → `SHIPPED`; çıkmamış → `IN_SHIPMENT`
  4. `sackId` dolu → `IN_SACK`
  5. kalan → `IN_STOCK`
  - Dry-run listesi sürüm notunda.
- **Geçmiş olaylar:** §6 S3 kararına göre, `preEpoch=true`.
- **Eski istemci:** okuma alanları aynen kalır, `status` yalnız EKTİR. Yazma uçları değişmez; olay satırı
  sunucuda yazılır. Eski panel/tablet bir şey fark etmez. `minVersion` gerekmez.
- **Türetilmiş alan:** `cancelledAt`/`cancelReason` KALIR, çünkü eski istemci okuyor. Kalkma koşulu
  ölçülebilirdir: panel ve tabletin sahadaki sürümünde `cancelledAt` okuyan yer 0 olmalı.

### 5.5 Master veri kapıları

- **MV-01** (kimlik/rol):
  - Kartela kendi kimliğidir (barkod `KRT…`, numara serisinde). "Kartela firması" ayrı kimlik değil,
    fasoncu PROFİLİdir (`KartelaDispatch.subcontractorId`), rol modeliyle uyumlu.
  - Kartela ileride başka bir rol alır mı? Bedelsiz numune ↔ iade beklenen, S5. Bu bir OLAY/DURUM
    farkıdır, kimlik değil.
- **MV-02** (finans kimliği): kartelanın bugün mali bağı YOK. S5'te "iade beklenen" seçilirse mali yüzey
  yine cari kimliğe bağlanır (müşteri kartı), ikinci hesap doğmaz.
- **MV-03** (operasyon verisi profile): sevk/kabul fasoncu profiline bağlı, DEĞİŞMEZ.
- **MV-04** (kod tekilliği): kartela numarası `number_series` kataloğundan doğar, bugünkü gibi. Yeni kod
  alanı yok.
- **MV-05** (geriye dönüklük): §5.4.
- **MV-06** (arşiv kapısı): stoktaki / çuvaldaki / sevkiyattaki kartela, ürün ve renk kartı için canlı
  referans mı? Bugün sayılmıyor, S4.

### 5.6 Dilimler (öneri)

- **K0** bu belge + kullanıcı kararları.
- **K1** şema: enum + `status` + `SwatchEvent` + mühür + CHECK çifti + durum backfill'i, yalnız ekler.
  Tek yazar ve AST kapısı. Bekçiler `test_swatch_event_yazar`, `test_db_invariants`.
- **K2** yazım yolları bağlanır: ~10 site, §5.2. `defter-beyan` satırları eklenir, §14 BORÇ satırı düşer.
  Bekçi `test_swatch_event_ledger` (DB, gerçek yollar, ters çiftler).
- **K3** okuyucular: stok/istatistik `status`tan, Kartela Hareketleri ekranı + Excel.
- **K4** geçmiş aktarımı, S3'e göre.

## 6. Kullanıcıya sorulacaklar (şıklı, önerili)

**S1 — Model**
- **(A) Kartelanın kendi olay defteri + durum kolonu — ÖNERİ.**
- (B) Stok defterine kartela türleri.
- (C) Bugünkü gibi kalsın.

(B) ortak defteri ADETLE ve topsuz satırla genişletir. (C) çuval/sevk geçmişini audit'te bırakır.

**S2 — Düşüm stornosunun `cancelledAt`ı boşaltması (§14)**
- **(A) Durum kolonu sayılsın; tarihçesi yeni defterde — ÖNERİ, S1=A ile birlikte.**
- (B) Borç kalsın.

**S3 — Geçiş öncesi geçmiş**
- **(a) Yalnız kendi kolonlarından türeyen olaylar bir kez aktarılsın — ÖNERİ.** Doğuş kabulden, düşüm
  düşüm belgesinden, `preEpoch`.
- (b) Hiç aktarılmasın; defter bugünden başlar (stok defterinin 2026-09-13 kararıyla aynı).
- (c) Çuval/sevk geçmişi de audit'ten bir kez aktarılsın (beyanlı göç istisnası; audit 6 ay).

**S4 — Stoktaki kartela ürün/renk kartı için "canlı kayıt" mı?**
- **(a) Evet — ÖNERİ.**
  - Satılabilir numune stoğu kartı pasife almayı durdurur.
  - Çıkış yolu düşüm ya da sevk. "Tükenene kadar" kartta kartela akmaya devam eder.
- (b) Hayır. Kartela kartın ömründen bağımsız kalır.

**S5 — Müşteriye giden kartela**
- **(a) Bugünkü gibi hepsi çıkış (bedelsiz numune); sevk edilince `SHIPPED` — ÖNERİ.**
- (b) "İade beklenen" türü eklensin: kartela müşteride sizin malınız olarak durur, `RETURNED` olayıyla
  döner. Konsinye deseni (SAP 631/632, IFRS 15).

(b) ayrı bir dilim ve mali karar ister.

**S6 — Topun "kartelalık" işaret geçmişi (`markedForKartela`)**
- **(a) Kapsam dışı; audit'te ayak izi olarak kalsın — ÖNERİ.** Hiçbir karar onu okumuyor, yalnız
  etiketin bayatlığını tetikliyor.
- (b) Top olay defterine taşınsın.

## 7. Açık notlar

- `KARTELA-TASARIM.md` ve `SEVK-STOK-DEFTERI-BAGLAMA-TASARIM.md:59-60` ters kodu `KARTELA_DISPATCH_CANCEL`
  diye anıyor; kod `KARTELA_CANCEL` diyor (yalnız ad kayması).
- `test_stock_exit_gates.ts:19-20` başlığı "kartela bugün hiç defter satırı yazmıyor" diyor; bayat, sevk
  2026-09-13'ten beri yazıyor.
- `cancelDispatch` defter öncesi (2026-09-13'ten önce) sevkte ters satır yazmıyor (`kartela.service.ts:545`).
  Bilinen sınır, K1–K3 kapsamı dışı.
- `test_phase5_kartela_hardening.ts` adına rağmen kartelayı zayıf ölçüyor. K2'de kartela bekçisi o adı
  değil yeni adı taşır.
