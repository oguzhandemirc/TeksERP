# Defter · Hareket tablosu · Ters kayıt · Hard delete
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/defter.md`.

> Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi. Doktrin: hard delete yok · izlenebilirlik defterle · geri alma ters kayıttır.

## Doktrin — tek cümlelik hâli

Durum tabloları "şu an ne"yi, defterler "ne oldu"yu tutar; "ne oldu" asla değişmez. Geri almak yok etmek değil, tersini yazmaktır.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Audit (`system_logs` · `system_log_archives`) yalnız AYAK İZİDİR: yalnız insana iz gösteren yüzeyler okur; ondan karar, sayı, durum, geri alma, join TÜRETME; iş bilgisi kendi defterinde/kolonunda durur. İstisna beyanlı göç script'i; yeni allowlist satırı yönetici onayıyla.
- **[ÇEKİRDEK]** Audit cümlesini okuma anında `src/services/audit-narrative/` anlatıcısında kur; anlatıyı saklama, ondan sayı/karar türetme, sır alanı değerini cümleye koyma; yeni audit çiftine (`tablo:olay|işlem`) şablon yaz.
- **[ÇEKİRDEK]** Panelde audit cümlesini yalnız `components/audit/AuditNarrativeRow` ile çiz; istemci anlatı üretmez, geri yazmaz, listeyi süzmez (süzgeç sorgu parametresi); Teknik ayrıntıda iz alanlarını tek tek seç, istek gövdesini gösterme.
- **[ÇEKİRDEK]** Geri alma ileri işlemin TERS KAYDINI bugüne yazar; ileri kaydı ne siler ne değiştirir. Durum ileri-öncesiyle aynı olabilir, defter asla. Kapanmış hareketi yeniden açmak da ters kayıttır (`reopenClosedMovementsTx`).
- **[ÇEKİRDEK]** Malın çıkışını (sevk topu ve İPLİK ÇIKIŞI) BRÜT yaz, dönen kısmı AYRI satırla kapat (sebep kodu zorunlu); tek "net" satır yazma. Dönenin gideceği yer bayrak değil SEBEP KATALOĞU satırıdır; tartmayan fabrikada iade satırı doğmaz.
- **[ÇEKİRDEK]** Deftere yazan her ileri olayın beyanlı ters MEKANİZMASI olur (damga · ters bağ · tipli enum çifti · net karşı olay · karşı kayıt); ad kalıbı (`*_CANCEL`/`*_REVERSAL`) ölçüt değildir. Yeni ileri olay/sebep kodunun ters mekanizmasını AYNI commit'te beyana gir.
- **[ÇEKİRDEK]** Varlığın durumunu/miktarını değiştiren HER kod yolu (toplu yol dahil) o varlığın defterine satır yazar; ham `updateMany` ile defter kapısını atlamak yasak.
- **[ÇEKİRDEK]** Append-only defter satırını GÜNCELLEME ve SİLME; `updatedAt` almaz, kronolojisi `createdAt`. Bir tablo hem defter hem durum kaynağı olamaz — gerekiyorsa iki tablo.
- **[ÇEKİRDEK]** Negatif/karşı satırı yalnız DB izin veriyorsa yaz; CHECK varsa (`payment_allocations_amount_positive`) `revokedAt`/`revokedById`/`revokeReason` DAMGASI kullan. Damgalı defterde aktif yüklemi TEK helper'dan al (`ACTIVE_ALLOCATION` · `ACTIVE_SACK_ALLOCATION`).
- **[ÇEKİRDEK]** Tekrar edebilen çevrimin izini tek kolona koyma (`undispatchedAt` ikinci turda ezilir); OLAY DEFTERİ kur (`ShipmentEvent`, `ChequeEvent` emsali).
- **[ÇEKİRDEK]** Tekil kısıtlı defteri damgaya çevirirken kısıtı PARTIAL yap (`WHERE "revokedAt" IS NULL`). Prisma `@@unique` INDEX üretir: `DROP INDEX` kullan (`DROP CONSTRAINT IF EXISTS` sessiz no-op); `@@unique`i `map:` ile adlandır.
- **[ÇEKİRDEK]** Durumu defterden sayan yol (`recomputeStepStatus`) her sayımında (açık, kapalı, bekleyen aday, giriş noktası) aktif yüklemi taşır.
- **[ÇEKİRDEK]** Geri alınmış defter satırını bir daha değiştirme (kapatma, yeniden açma, damga silme); tek istisna iş emri bölmede izin topla birlikte klon adıma yeniden bağlanması.
- **[ÇEKİRDEK]** Geçmişi koruyan guard (adım silme, başlamış adımın istasyon/sıra değişimi, makine/istasyon kalıcı silme) geri alınmış defter satırını da SAYAR.
- **[ÇEKİRDEK]** Defter İŞ VERİSİDİR: arşivleme, budama; büyümeyi index/partition ile karşıla.
- **[ÇEKİRDEK]** `WorkSession` geçmişini hiçbir yoldan silme; oturumu olan istasyon/makine kalıcı silinemez (409 `workSessionCount`), pasife alınır.
- **[ÇEKİRDEK]** Sayaç-bazlı düşüm belgesi etkilediği kayıtları KALEM satırına yazar, storno kalemden okur; kalemsiz düşüm geri alınamaz (409), geçmiş audit'ten uydurulmaz.
- **[ÇEKİRDEK]** Sayım fark fişini TEK BELGEDE, yalnız deponun son sayımını (LIFO) storno et; "terslenmiş mi"nin tek cevabı `reversesMovementId`; ileri CANCEL `fromStatus` + sebep kodu, ters `CANCEL_REVERSAL`, sapma `reversedAt`, iplik net ters ADJUST; sayım satırı değişmez.
- **[ÇEKİRDEK]** 0 metrajlı topu sayımda farkla kapatma, gerekçeyle KAPSAM DIŞI bırak (iptal yok, satır yok). Eşik tek yüklem `qtyYazilabilir`; defter yazımındaki kemer sessiz atlamaz, adıyla fırlatır.
- **[ÇEKİRDEK]** Satır taşıyan yıkıcı işlem (master-data birleştirme) taşınan satırın KİMLİĞİNİ deftere yazar (`RETURNING`, silinen çakışmanın TAM fotoğrafı); geri alma defterden, LIFO, geri yazılamayanı sessiz bırakmaz.
- **[ÇEKİRDEK]** Çekin her ileri olayının tipli stornosu olur (`CANCELLED` hariç): ters cari satır `reversesTxnId` ile bağlı, bugüne; durum en yeni ileri olayın (`createdAt`) `fromStatus`una döner; bulunamazsa 409.
- **[ÇEKİRDEK]** DURUM KOLONU ≠ DAMGA: "ne oldu" ayrı append-only defterdeyse kolon durumdur, `null`'a dönebilir ve geri alma o defteri tersler (`remainderClosedAt` · `weighedAt` · `invoicedAt`); tarihçesi yalnız kendisinde olan kolon DAMGADIR, null'lanmaz. Her null'lama sitesi beyanlı.
- **[ÇEKİRDEK]** SNAPSHOT kolonu ne durum ne damga: (a) geri alma girdisi, tüketilince null (`preShipStatus` · `preTamburCloseQty/Status`); (b) donmuş ileri değer, küçülmez, yalnız sapma satırıyla aşım yönünde büyür (`Roll.initialQty`). Canlıdan türetme; sınıf `scripts/lib/snapshot-kolonlari.ts`te.
- **[ÇEKİRDEK]** Raftan üretime giren HER yol (üretime alma · "Konumu Düzelt" · elle top · redye ayırma) `PRODUCTION_ISSUE` yazar; tek yazıcı `helpers/production-issue-ledger.helper.ts`, görüntü claim ÖNCESİ; zaten üretimdeki top satır almaz.
- **[ÇEKİRDEK]** `PRODUCTION_ISSUE`in bağlı tersi `ROLL_DETACH` (Top Çıkar), yalnız hiç işlem görmemiş topa; ters satır `reversesMovementId` ile; İE iptali aynı tersi yazar; metraj değişimi ayrı `PRODUCTION_VARIANCE`; `DISPOSITION` · `RESCUE` bağsız kalır.
- **[ÇEKİRDEK]** Top iş emri değiştirince (devir · renk ayırma · fason taşıma) aynı tx'te eski satırın bağlı tersi `PRODUCTION_ISSUE_TRANSFER` + yeni ileri satır yaz (tek yazar `rebindProductionIssuesTx`, çağıran `repointRollsTx`); `ROLL_DETACH` yalnız İE'den çıkış.
- **[ÇEKİRDEK]** Aynı tx'te aynı varlığa çok satır yazan defterde damga varlık başına KESİN artar (`clock_timestamp()` ms yukarı, son olay + 1 ms); "en son olay" okuyucusu `createdAt` yanına `id` eşitlik bozucusu koyar.
- **[ÇEKİRDEK]** Para okuyucusu kabul-anı metrajını `Roll.initialQty`den değil `RECEIPT_QTY_REASONS` defter satırlarından okur; tek helper `helpers/receipt-qty.helper.ts`, üç sonuç (defter · ufuk-öncesi yedek + `warnings` · 409 `RECEIPT_LEDGER_ROW_MISSING`); ufuk `constants/ledger-horizon.ts`.
- **[ÇEKİRDEK]** Üretimden rafa giren HER yol (`PRODUCTION_RECEIPT` · `TAMBUR_FINALIZE` · `TAMBUR_CUT` · `DISPOSITION` · `RESCUE`) `PRODUCTION` GİRİŞİ yazar; her yazıcı `postStockMove`, 0 metrajda satır yazılmaz; depo kesimi çocuğu satır almaz.

### Yasaklar

- **[ÇEKİRDEK]** Defter satırını (`RollOperation` · `RollMovement` · `WarehouseMovement` · `CariTransaction` · `CashTransaction` · `ChequeEvent` · `YarnMovement` · `SwatchStockReduction` · `SwatchEvent` · `PaymentAllocation` · `SackAllocation`) `delete`/`deleteMany` ile silme.
- **[ÇEKİRDEK]** İleri işlemin damgasını (`dispatchedAt`/`dispatchedById`) `null`'lama; üstüne ters olay yaz.
- **[ÇEKİRDEK]** Yeni `delete`/`deleteMany` yolu yalnız iki meşru sınıftan birine girerse yazılır; sınıf kod yorumunda adıyla anılır.

### Hard delete — meşru sınıflar

Meşru sınıflar: **④ deftere hiç yazmamış taslak** (atomik claim'li silme, `deleteMany({id, status: DRAFT})`, `count===0` → 409) · **③b yapılandırma pivotu replace** (`StationProperty` · `ItemAllowedColor` · `ItemAllowedProperty` · `RouteStepProperty` · `PermissionTemplateItem` · `CustomerTemplateRoute` · `LabelContextDefault` · `PeripheralTemplateRoute` · `SubcontractorToCategory` · `StationColor` · `CustomerItemAlias` · `CustomerColorAlias` · `CustomerItemColorAlias` · `WeftSpecYarn`). Diğer her "sil" DURUM GEÇİŞİDİR.

- **[ÇEKİRDEK]** ③b'de pivot satırı silinebilir ama değişikliği karar defterine yaz; üç müşteri adı pivotunda karar satırı bugün audit — beyanlı borç.
- **[ÇEKİRDEK]** İçe aktarım geri sarması YAZILAN SATIRLARDAN (`ImportRunLine`: `CREATE`/`UPDATE`/`REVIVE` + alanlar + REPLACE fotoğrafı); "alan hâlâ aynıysa" ATOMİK CLAIM ile (`count===0` → ATLANDI); `REVIVE` tersi önceki değer+durum; alias satırı yalnız koşumun yarattığıysa silinir.
- **[ÇEKİRDEK]** ③a TİCARİ pivot (`ItemPrice` · `SackAllocation` · `PaymentAllocation` · `WorkOrderToOrderLine` · `RollProperty` · `WorkOrderTargetProperty` · belge satırları) sil-yaz yok: damga + partial unique sürüm (`validFrom`/`validUntil` DEĞİL) ya da ters kayıt; `CostParameterSet` DURUM+sürüm.
- **[ÇEKİRDEK]** Eski ① ve ② sınıfları kalktı: guard kalır, silme gider — `isActive:false` / `VOIDED` / `revokedAt`+`revokedById`.
- **[ÇEKİRDEK]** Kalıcı silme uçlarının model listesini elle tutma: uçlar route'tan keşfedilir, fiziksel silme iddiası servis dosyasında çapalanır, her FK guard'da sayılır ya da gerekçeli muaftır; uç adında "permanent" kanıt değildir.

### Budanan satırın kuralları — telemetri ekseni

Telemetri hard-delete sınıfı DEĞİLDİR; budanabilirlik model sınıfından bağımsız yaşam süresi eksenidir (⑤ sınıfı reddedildi). Tam kural: § Telemetri ≠ defter.

- **[ÇEKİRDEK]** Yaşa göre budanan tabloyu SINIFI beyan edilmeden budama; budama yüklemi YAŞA bağlı (ad/kimliğe değil), budayan yol TEK dosyada ve beyanla birebir (ölü beyan da kırmızı).
- **[ÇEKİRDEK]** Telemetriyi yargıyla değil sondayla belirle: ham satır silinince raporlanan sayı değişmiyorsa telemetridir; bir KARARI (ör. guard `scanCount`) besliyorsa saklama süresi o kararın UFKUYLA sınırlıdır ya da guard'a kalıcı ikinci tanık verilir.
- **[ÇEKİRDEK]** İş kararına giren her sayı budamadan ÖNCE kalıcı kolona DONAR; budayıcı açık koşuma, açık vardiyaya ve MÜHÜRSÜZ pencereye dokunmaz.
- **[ÇEKİRDEK]** Aynı ölçüt audit'i kapsar: audit telemetri yaşam süresindedir (6 aylık arşivleme bu kuralın örneği); `DEFTER` "iş/kanıt defteri" diye BÖLÜNMEZ.
- **[ÇEKİRDEK]** Audit arşivini `audit.archiveRetentionYears` yıl sakla (varsayılan 3; `0` = budama yok); budama arşivi okumaz, aylık dilimle `createdAt < dilim sonu` siler, ilerlemeyi `audit.archivePurgedThrough`a yazar.
- **[ÇEKİRDEK]** Audit hash zinciri: sıra + özeti yalnız trigger `audit_zincir_bagla` (kilit 8039) yazar, özet kaynağı `audit_zincir_ozet`; taşıma/silme yalnız SECURITY DEFINER `audit_arsivle` (≥1 ay) ve `audit_arsiv_buda` (≥1 yıl, `AUDIT_CHAIN_CUT`); doğrulama gece, sonuç `auditProtection`.
- **[ÇEKİRDEK]** İstek başlığını `request_traces`e yaz, `system_logs`a kolon ekleme; gövde, sorgu dizesi, başlık değeri saklama; tek yazar/okur/budayıcı `services/request-trace.service.ts`, kimlik audit `requestId` (`X-Request-Id`), yazım await'siz, budama yaş (`requestTrace.retentionDays`, 90).
- **[ÇEKİRDEK]** Audit arşivleyicisini ve gece bakım işlerini yalnız fabrika saatiyle 02:00–05:00'te koştur; pencereyi partiler arasında yeniden ölç, birikim bitmeden son-koşu damgası yazma.

Budama izni bekçi yeşil olmadan verilmez; retention işi sondaları ölçen bekçi yeşil vermeden sürüme çıkmaz.

### Tuzaklar

- **[ÇEKİRDEK]** Silmeyi bırakınca UNIQUE'i `WHERE "revokedAt" IS NULL` partial'ına çevir ve `scripts/test_db_invariants.ts` envanterine yaz ([DB-30]; emsal `item_price_default_uq`).
- **[ÇEKİRDEK]** Ters kayıt yazan yol ileri kaydı iptal eden BELGEYİ de kilitler (`FOR SHARE`, kilitten sonra taze okuma); iptal yolu kapsamını tx İÇİNDE, claim arkasında çözer.
- **[ÇEKİRDEK]** Yeni "geçersiz" kolonu açan model, süzen okuma yolunu TEK helper'a bağlar; elle `WHERE` kopyalama.
- **[ÇEKİRDEK]** Süzgeci ilişki okumalarında (`include`/`select`/`_count`, `some`/`none`) ve ham SQL'deki her tablo başvurusunda da taşı; `every` yazma (`none: { ...ACTIVE, NOT: X }`); tarama `scripts/revoke-ast-tarama.ts`.
- **[ÇEKİRDEK]** Partial unique'li damgalı defterde tekil anahtarla `upsert`in `where`ine aktif yüklemi koy (`{ <üçlü>, ...ACTIVE_OPERATION }`).
- **[ÇEKİRDEK]** Şema-dışı partial unique predicate'ini kesintisiz takas et: geçici adla yeni index → `DROP INDEX` eski → `ALTER INDEX … RENAME`; `test_db_invariants.ts` envanterini aynı commit'te güncelle.
- **[ÇEKİRDEK]** Ters yolu yazılmamış ileri yolu sürüme çıkarma.
- **[ÇEKİRDEK]** Ters kayıt KAPSAMI tip düzeyinde zorunlu: "topun tüm izini tersle" ile "şu işlemi geri al" ayrı fonksiyon; kapsam sorgusu iki adımlı (önce damgalı, yoksa damgasız); `OR workOrderStepId IS NULL` tek yüklemde YASAK.
- **[ÇEKİRDEK]** Defter kapısında yazılamaz satır davranışını çağrı yerinde beyan et (`onUnwritable: "skip" | "throw"`, varsayılansız; 0 metraj ve depo ucu yok ikisini de kapsar); meşru atlama da sayılır ve bir yüzeye basılır.
- **[ÇEKİRDEK]** Stok hareketi ucu: `warehouseId === null ⇔ status ∉ WAREHOUSE_STOCK_STATUSES`; stok dışı uç statü taşır; stok dışından stok dışına satır YAZMA (`warehouse_movements_direction_present`).
- **[ÇEKİRDEK]** `warehouse_movements` anını yazar verir (`warehouseMovementStampTx`, top başına KESİN ARTAN); okuyucu sırayı yalnız `MOVEMENT_ASC`/`MOVEMENT_DESC`ten alır, elle `{ createdAt }` sıralama yazma.
- **[ÇEKİRDEK]** Defter damgası SQL'i YALNIZ `helpers/ledger-stamp.helper.ts`te; her damga fonksiyonu kendi defterinin yazarında çağrılır; yeni damga yardımcıya fonksiyon olarak eklenir. Trigger'la damgalanan defter (top durum defteri) kapsam dışı.
- **[ÇEKİRDEK]** Stok kümesinden çıkışta (sevk · transfer · kartela · iptal) ve iade hedefinde deposuz topu 409 + barkodla durdur (`assertRollsHaveWarehouse`); `assertEndShape` son ağdır (500, barkodsuz).
- **[ÇEKİRDEK]** Statüsüz ileri satırın tersini BAĞLI yaz (`reverseLegacyStockMove`; bağ ileri satıra, uçlar canlıdan, metraj ileri satırdan); dal yalnız statüsüz ∧ (`preEpoch` ∨ epoch çizilmemiş); epoch = `OPENING_BALANCE` satırının varlığı.
- **[ÇEKİRDEK]** Defter bekçisinin fikstürünü GERÇEK yazma yolundan geçir.
- **[ÇEKİRDEK]** Kesim/bölünme defterde ÇİFT yazar (ebeveyn çıkışı + çocuk girişi, aynı `transformGroupId`, net sıfır); bir uç yazılamıyorsa HİÇBİRİ yazılmaz.
- **[ÇEKİRDEK]** Stok defteri sebep kodunu sapma kararından değil malın YERİNDEN türet; aşım KEŞİFtir, dönüşüm grubuna GİRMEZ.
- **[ÇEKİRDEK]** Deftere `RESTRICT` bağlı satır eklerken ebeveyni silen her yerde (script, bekçi temizliği dahil) defter satırını önce sil; temizlik süzgeci FİKSTÜR DAMGASINA bağlanır; temizlik hatasını `.catch(() => {})` ile yutma.
- **[ÇEKİRDEK]** Karar defteri de defterdir; `RollPlanDeviation` BORÇ: tasarım `docs/design/PLAN-SAPMA-GERI-ALMA-TASARIM.md` (DAMGA, tanecik `confirmationId`, dört damgalayan dal); okuyuculara `revokedAt IS NULL` süzgeci ve `fason-receipt` damgalaması AYRILMAZ, birlikte iner.
- **[ÇEKİRDEK]** Mali defter geçmişi audit'e yazılmaz: yeniden hesaplanan `SackAllocation` satırını silme, `clearedAt`/`clearedShipmentId`/`clearedById` ile damgala; tek boğaz `clearShipmentAllocationsTx`, partial unique `sack_allocations_active_uq`, Σ okuyan yüzey `ACTIVE_SACK_ALLOCATION` süzer.
- **[ÇEKİRDEK]** `consumable_movements` satırını YALNIZ `helpers/consumable-stock.helper` boğazından yaz; tüketim `rollOperationId`ye bağlı, iz damgalanınca ters kaydı `revokeRollOperations`/kurşun düzeltmesi aynı tx'te yazar; bakiye türetilir, eksi bakiye yalnız uyarı.
- **[PROFİL]** Mal kabulde sarf satırını (`itemType=CONSUMABLE`) yalnız `consumable.stockEnabled` açıkken çiz; sarf satırı TOP DEĞİL ("N top"a girmez; kalem + miktar + fiyat, adet çarpanı yok); ayar kapalıyken form bayt-aynı.

### Reçeteler

- **[ÇEKİRDEK]** Yeni defter sekiz soru: ① olaylar (enum) · ② her ilerinin tersi · ③ append-only (`updatedAt` YOK) · ④ `createdById` · ⑤ kaynak belge FK · ⑥ miktar `Decimal` + ölçek ([DB-33]) · ⑦ index `(varlıkId, createdAt)` + olay+tarih · ⑧ mutabakat bekçisi.
- **[ÇEKİRDEK]** Var olan deftere yeni ileri olayı eklerken ters değeri ve geri alma yolunu AYNI commit'te ekle.
- **[ÇEKİRDEK]** `Roll.initialQty`yi yükselten sapma miktarı satıra yazar (`RollVariance.initialQtyRaise`), tersi aynı miktarı indirir.
- **[ÇEKİRDEK]** `roll_meter_readings` yaratma/damgayı YALNIZ `meter-reading.helper` (`insertMeterReadingTx` · `stampMeterReadingsTx`) ile yap; parçayı iptal eden her yol CUT okumasını aynı tx'te damgalar; `restoreCancelledRoll` okumaları `reinstateCancelledCutReadingsTx` ile YENİ satır kurar.

## Alınmış kararlar — henüz UYGULANMADI (2026-09-11)

- `WarehouseMovement` gerçek stok defterine dönüşecek: `warehouseId` atayan HER yol (statü terfisi `STOCK → WAREHOUSE` dahil) deftere bağlanır; hedef Σhareket ↔ canlı stok mutabakatı ve as-of kesit.

## Mevcut defter envanteri (2026-09-13 ölçümü — kapısı `test_defter_ters_yol`)

`WarehouseMovement` stok defteridir; geçmişi eksik KALACAK (backfill yok, kullanıcı kararı); yazar kümesinin kapalı kalmasını `test_stok_defteri_bag_olcumu` (K = 0 ∧ V) ölçer. Defter → ters mekanizma:

- `WarehouseMovement` → `reversesMovementId` + `reverseStockMove` · `reverseLegacyStockMove` · `reverseAllRollStockMoves` · `reverseLatestScopedStockMove`; açık borçlar `CUT_SPLIT` · `OVERAGE` · `CUT_DISCARD` · `DISPOSITION` (§13)
- `CariTransaction` → `reversesTxnId` · `ChequeEvent` → `*_CANCEL` · `CashTransaction` → `status: CANCELLED` · `YarnMovement` → ADJUST_IN/OUT
- `RollMovement` → `revokedAt` + partial unique, yeniden açma `reopenClosedMovementsTx` · `RollOperation` → `revokedAt` + partial unique · `RollVariance` → `reversedAt`
- `SwatchStockReduction`(+Item) · `PaymentAllocation` → damga · `RollProperty` → `ACTIVE_ROLL_PROPERTY` · `WorkOrderTargetProperty` → `revokedAt` · `WorkOrderToOrderLine` → `unlinkedAt`, `ACTIVE_ORDER_LINK`
- `SackAllocation` · `SackTagAssignment` → `clearedAt` · `PrintedDocument` → `supersededAt`/`voidedAt` · `ShipmentEvent` → DISPATCHED↔UNDISPATCHED, INVOICED↔INVOICE_CLEARED · `SackWeighing` → CLEARED
- `RollPlanDeviation` → ❌ BORÇ (damga yok) · `TravelerCardScan` → TELEMETRİ (budama ufku guard'a bağlı)
- `ImportRunLine` → `revertedAt` + `revertSkipReason` · `MergeOperation` → `revertedAt` (LIFO) · `ShipmentOrder` → `isActive` denorm, `setShipmentOrdersTx` replace
- `MachineRun` → `revokedAt` (tek dosya `machine-run.service.ts`) · `MachineStopEvent` → `revokedAt`, yazma yüzeyi yok · `MachineStopReclass` → KARSI_KAYIT (`reclassifyStop`)
- `WarpBeamEvent` → `WOUND_CANCEL` + `reversesEventId @unique` (tek dosya `warp-beam-wind.service.ts`) · `DoffEvent` → `revokedAt`, yazma yüzeyi yok
- `WorkOrderEvent` → KARŞI KAYIT (`helpers/workorder-event.helper.ts`, `claimWorkOrderStatusTx`) · `WorkOrderCloseSnapshot` → SATIR_EBEVEYN, yeni sürüm (`helpers/workorder-close-snapshot.helper.ts`)
- `SwatchEvent` → KARSI_OLAY `reversesEventId` (`helpers/swatch-event.helper.ts`) · `RollStatusEvent` → KARSI_KAYIT, trigger `rolls_write_status_event`, kodda yazan 0
- `FactoryTimezonePeriod` → TERS_BAG `reversesPeriodId @unique` (`factory-timezone.service.ts`, kilit 8037) · `StandardCostVersion` (+`StandardCostLine`) → YENİ SÜRÜM `restoredFromId` (`standard-cost.service.ts`)

## Telemetri ≠ defter

Telemetri hard-delete sınıfı değildir (⑤ reddedildi). Altı çekirdek kural:

1. Telemetri defter-olmayan satırın yaşam döngüsüdür; ölçütü budanabilirliktir (yeniden yazılan ya da append-only olabilir).
2. Deftere ya da iş kararına giren her sayı budamadan ÖNCE kalıcı kolona DONAR.
3. Budama izni manifest bekçisiyle ölçülerek verilir; bekçi yeşil değilken retention job sürüme çıkmaz.
4. Telemetri okuyan yol TEK DOSYADA yaşar, AST tripwire ile sabit.
5. Aynı tabloda defter + telemetri varsa yüklem TEK helper'da, DB seddiyle ikiz.
6. Retention açık koşuma, açık vardiyaya ve MÜHÜRSÜZ pencereye DOKUNMAZ.

`DEFTER_BEYANI` evreni append-only modellerdir; defter dışı budanan tablo (`Session`) `BUDANAN_DEFTER_DISI` listesinde durur.

## Geçersiz kılınan kurallar

- "Ters karşılık enum'da `*_REVERSAL`/`*_CANCEL` adıyla bulunur" → ters yol MEKANİZMADIR.
- "Depo ucu olmaması politikaya tabi değil" → `onUnwritable` politikasına tabidir.
- "Hard delete DÖRT sınıf" → İKİ sınıf (④ · ③b).
- "Yalnız oturum izi olan makine/istasyon kalıcı silinebilir" → oturum geçmişi silinmez, kalıcı silmeyi engeller.
- "`StockCount.COMPLETED` terminal" → fark fişi tek belgede stornolanır (`reversedAt`).
- "Audit iş kaynağı olarak okunamaz" (kapısız) → audit yalnız ayak izi, `test_audit_okuma_kaynagi` kapısıyla.
- `VERITABANI.md` §9 "sekiz hard delete sitesi" ölçümü bayat.

## Bekçiler

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>`

Backend: `test_defter_ters_yol`, `test_defter_damgasi_kaynagi`, `test_depo_defteri_damgasi`, `test_stock_ledger_cancel_restore`, `test_stock_ledger_entry`, `test_stock_ledger_helper`, `test_stock_ledger_issue`, `test_stock_ledger_kursun_reopen`, `test_stock_ledger_manual_move`, `test_stock_ledger_production`, `test_stock_ledger_tambur`, `test_stock_ledger_tambur_undo`, `test_stock_ledger_transform`, `test_stock_ledger_production_entry`, `test_stock_ledger_warehouseless`, `test_stock_ledger_fason`, `test_roll_movement_revoke`, `test_revoke_ast_aile`, `test_roll_operation_revoke`, `test_roll_status_events`, `test_roll_property_revoke`, `test_cheque_reversal`, `test_stock_count`, `test_stock_count_reversal`, `test_swatch_stock_reduction_reversal`, `test_swatch_event_ledger`, `test_swatch_event_yazar`, `test_work_session_history_guard`, `test_warehouse_ledger`, `test_warehouse_movements`, `test_master_data_merge_revert`, `test_import_revert`, `test_snapshot_kolonlari`, `test_consistency_derived`, `test_consistency`, `test_db_invariants`, `test_esitlik_bozucu`, `test_stok_defteri_bag_olcumu`, `test_dispatch_report_gross`, `test_payment_allocation`, `test_sack_allocation_cleared`, `test_receipt_qty_readers`, `test_receipt_qty_single_source`, `test_wo_roll_detach`, `test_workorder_event_yazar`, `test_audit_okuma_kaynagi`, `test_audit_anlati`, `test_audit_hash_zinciri`, `test_request_trace`, `test_bakim_isleri`, `test_telemetri_defter_degil`, `test_machine_run`, `test_warp_beam_lifecycle`, `test_order_link_unlink`, `test_item_price_surum`, `test_maliyet_girdileri`, `test_standart_maliyet_surum`, `test_saat_dilimi_donemleri`, `test_fabrika_saat_dilimi`, `test_tambur_olcum_kaynagi`, `test_sarf_stok_defteri`, `test_latency_persist`, `test_import_framework`, `test_import_idempotency`

Genel kapı `test_defter_ters_yol` (beyan `scripts/lib/defter-beyan.ts`).

Electron: `components/audit/AuditNarrativeRow.test.tsx`, `AuditTechnicalDetail.test.tsx`, `pages/System/Activity/activity-view.test.ts`, `pages/Stations/machineDeleteDescription.test.ts`, `receiptConsumableLine.test.tsx`

Eksik kapılar: defter mutabakatı (Σ hareket ↔ canlı durum, depo ve iplik) · yeni `delete`/`deleteMany` AST tripwire'ı.
