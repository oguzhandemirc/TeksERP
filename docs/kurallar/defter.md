# Defter · Hareket tablosu · Ters kayıt · Hard delete

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: 2026-09-10 defter-öncelikli mimari notu (`docs/history/CLAUDE-NOT-ARSIVI.md`). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Bu dosya 2026-09-10'da AÇILDI ve kök `CLAUDE.md`'nin "hard delete DÖRT sınıf" cümlesini EZDİ. Doktrin üç ilkedir: hard delete yok · izlenebilirlik defterle · geri alma ters kayıttır. Alan kesişimlidir: sevkiyat, fason, top düzeltme, finans ve yetki dosyalarının hepsini bağlar.

## Doktrin — tek cümlelik hâli

Durum tabloları **"şu an ne"**yi tutar; defterler **"ne oldu"**yu tutar ve "ne oldu" asla değişmez. Bir şeyi geri almak, onu yok etmek değil **tersini yazmaktır**.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Bir bilgi İŞ KARARINA giriyorsa cevabı bir hareket tablosunda ya da KALICI kolonda durur; yalnız denetime giriyorsa audit'e (`system_logs`) yazılır. Audit teknik izdir, 6 ayda arşivlenir ve iş kaynağı OLARAK OKUNAMAZ — audit'e uzanma ihtiyacı hissedilen her yer bir defter eksikliğinin işaretidir. · bekçi: `YOK (yazılacak)` <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** Geri alma, ileri işlemin TERS KAYDINI bugüne yazar; ileri kaydı ne siler ne değiştirir. İşlem sonrası DURUM ileri-öncesi durumla aynı olabilir, DEFTER asla aynı olmaz. · bekçi: `YOK (yazılacak)` <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** Deftere yazan her ileri olayın tipli ters karşılığı enum'da BULUNUR (`*_REVERSAL` / `*_CANCEL`); enum'a ileri değer eklerken ters değeri de eklenir — tersi olmayan ileri olay, geri alınamayan ya da izsiz geri alınan bir iş demektir. · bekçi: `YOK (yazılacak)` <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** Bir varlığın durumunu/miktarını değiştiren HER kod yolu o varlığın defterine satır yazar; tek-kayıt yolu yazıp toplu yol yazmıyorsa bu bir DELİKTİR, üslup farkı değil. Ham `updateMany` ile durum değiştirip defter kapısını atlamak yasaktır. · bekçi: `YOK (yazılacak)` <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** Append-only defter satırı GÜNCELLENMEZ ve SİLİNMEZ; bu yüzden `updatedAt` almaz ve kronolojisi `createdAt`'tir. Bir tablo hem defter hem durum kaynağı OLAMAZ — ikisi gerekiyorsa iki tablodur. · bekçi: `test_db_invariants.ts (kısmi)` <sub>(arşiv:2026-09-10, [DB-09])</sub>
- **[ÇEKİRDEK]** Defter İŞ VERİSİDİR: arşivlenmez, budanmaz. Büyüme index/partition ile karşılanır, satır silerek değil. <sub>(arşiv:2026-09-10)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Defter satırını (`RollOperation` · `RollMovement` · `WarehouseMovement` · `CariTransaction` · `CashTransaction` · `ChequeEvent` · `YarnMovement` · `SwatchStockReduction` · `PaymentAllocation` · `SackAllocation`) `delete`/`deleteMany` ile silmek YASAK — geri alma ters satır yazar. <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** İleri işlemin damgasını `null`'lamak ters kayıt DEĞİLDİR ve YASAKTIR — `dispatchedAt`/`dispatchedById`, `weighedAt`/`weightKg`, `invoicedAt`/`invoiceNo`, `remainderClosedAt` gibi damgalar "bu iş yapıldı" beyanıdır; geri alma bunları silmez, üstüne ters olay yazar. <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** Yeni bir `delete`/`deleteMany` yolu açmak KARARDIR: aşağıdaki iki meşru sınıftan birine girmiyorsa yazılmaz; girdiği sınıf kod yorumunda adıyla anılır. <sub>(arşiv:2026-09-10)</sub>

### Hard delete — yalnız İKİ meşru sınıf

Eski dört sınıf 2026-09-10'da ikiye indi. Diğer her "sil" bir DURUM GEÇİŞİDİR.

| Sınıf | Ne yapar | Neden meşru | Emsal |
|---|---|---|---|
| **④ Deftere hiç yazmamış taslak** | atomik claim'li fiziksel silme | hiçbir bakiye/defter satırı üretmedi — geri alınacak bir "olay" yok | `invoice.service.ts:883` (`deleteMany({id, status: DRAFT})`, `count===0` → taze okuma → 409) |
| **③b Yapılandırma pivotu replace** | üst kayıt yaşar, ayar kümesi yenilenir | satırın parasal/ticari/kalite sonucu yok; cevaplanan soru "bu ayarı kim değiştirdi"dir ve onun yeri KARAR satırıdır, pivot satırı değil | `StationProperty` · `ItemAllowedColor` · `ItemAllowedProperty` · `RouteStepProperty` · `PermissionTemplateItem` · `CustomerTemplateRoute` · `LabelContextDefault` · `PeripheralTemplateRoute` · `SubcontractorToCategory` · `StationColor` |

- **[ÇEKİRDEK]** ③b'de pivot satırı silinebilir ama DEĞİŞİKLİĞİN KENDİSİ bir karar defterine yazılır; yüzlerce ayar satırını versiyonlamak tabloyu şişirir, sorulan soruyu cevaplamaz. <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** ③a TİCARİ pivot (`ItemPrice` · `SackAllocation` · `PaymentAllocation` · `WorkOrderToOrderLine` · `RollProperty` · `WorkOrderTargetProperty` · belge satırları) sil-yaz YAPILMAZ: versiyonlanır (`validFrom`/`validUntil`) ya da ters kayıt alır. `RollProperty`/`WorkOrderTargetProperty` 2026-09-11'de bilinçle ③a'ya kondu — topun özelliği rota kapsamasını belirleyen GERÇEK kısıttır, ayar değil. <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** Eski ① (bağımlılık-guard'lı silme) ve ② (alias/karar satırı) sınıfları KALKTI: guard kalır, silme gider — `isActive:false` / `VOIDED` statüsü / `revokedAt`+`revokedById`. <sub>(arşiv:2026-09-10)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Silmeyi bırakınca UNIQUE kısıtları kırılır: geçersiz satır yaşayanla çakışır. Kısıt `WHERE "revokedAt" IS NULL` partial'ına çevrilir ve `scripts/test_db_invariants.ts` envanterine YAZILIR (iki yönlü, [DB-30]). Emsal: `item_price_default_uq`. <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** Yeni "geçersiz" kolonu açan her model, o kolonu süzen okuma yolunu TEK helper'a bağlar; elle kopyalanan `WHERE` bir gün unutulur ve geçersiz satır listeye sızar (ayrışan yüzey sınıfı). <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** Bir defter "var" diye yeterli değildir: ileri yolu yazıp geri yolu yazmayan defter, hiç olmayandan daha tehlikelidir — toplamı sessizce kayar. Ters yol yazılmadan ileri yol sürüme çıkmaz. <sub>(arşiv:2026-09-10)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Yeni defter açarken sekiz soru: ① hangi olaylar (enum) · ② her ilerinin tersi var mı · ③ append-only mi (`updatedAt` YOK) · ④ aktör kolonu (`createdById`) · ⑤ kaynak belge FK'ları · ⑥ miktar `Decimal` + ölçek kataloğu ([DB-33]) · ⑦ index: `(varlıkId, createdAt)` + olay+tarih · ⑧ mutabakat bekçisi (Σ hareket ↔ canlı durum). <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** Var olan deftere yeni ileri olay eklerken enum'a ters değeri AYNI commit'te ekle ve geri alma yolunu yaz; "sonra ekleriz" ters yolu olmayan olay üretir. <sub>(arşiv:2026-09-10)</sub>

## Alınmış kararlar — henüz UYGULANMADI (2026-09-11)

Kullanıcı kararı; uygulaması ayrı iştir. Bu bölüm iş bitince silinir, kural satırına dönüşür.

- **`WarehouseMovement` GERÇEK STOK DEFTERİNE dönüşecek.** `warehouseId` atayan HER yol deftere bağlanır — statü terfisi (`STOCK → WAREHOUSE`) dahil; bugün terfi bilinçli olarak satır yazmıyor ve defter yalnız dışarıdan gelen malı görüyor. Hedef: Σhareket ↔ canlı stok mutabakatı ve as-of kesit. Ön koşul: `CANCEL_REVERSAL` + `RETURN_REVERSAL` ters yolları.
- **`workSession` geçmişi SİLİNMEYECEK.** `guarded-hard-remove.ts` istasyon/makine silerken oturum satırlarını temizliyor; gerekçesi "denetim SystemLog'da kalır" ama audit 6 ayda arşivlenir, yani gerekçe geçersiz. Yeni hüküm: guard kalır, silme gider — istasyon/makine `isActive:false` olur, oturum geçmişi durur ve kalıcı silmeyi ENGELLER.
- **`RollProperty` / `WorkOrderTargetProperty` ③a'dır** (yukarı bak) — 7 site sil-yazdan versiyonlamaya geçecek.

## Mevcut defter envanteri (2026-09-10 ölçümü)

> ⚠️ **`WarehouseMovement` bir STOK DEFTERİ DEĞİLDİR** (2026-09-11 ölçümü). Satır yalnız topun `warehouseId`'si DOLUYKEN yazılır (`warehouse-ledger.helper.ts:49`); üretimdeki top depoya statü terfisiyle girer ve terfi bilinçli olarak satır yazmaz. Ölçüm: defter sonrası doğan 1.231 topun 751'inde satır var, 87 top depoda ama defterde hiç yok; mutabakat farkı −5.369,3 m; `CANCELLED` 69 topun 0'ında CANCEL satırı var. Bugünkü hâli KENDİ İÇİNDE TUTARLIDIR (girişi olmayanın çıkışı da yok) — ama "depoda ne var" sorusunu CEVAPLAMAZ. Stok defterine dönüşmesi ayrı karardır.

| Defter | Kapsam | Append-only | Ters yol |
|---|---|---|---|
| `WarehouseMovement` `schema.prisma:6099` | depo giriş/çıkış, 7 olay | ✅ | TRANSFER ✅ · SHIPMENT ✅ · **RETURN ❌** · **CANCEL ❌** |
| `CariTransaction` `:6611` | cari borç/alacak, 11 kaynak | ✅ | ✅ `reversesTxnId` |
| `ChequeEvent` `:7183` | çek durum defteri, 10 olay | ✅ | kısmi — **ENDORSE/PAY/BOUNCE/RETURN ❌** |
| `CashTransaction` `:6898` | kasa/banka | yarı (`status: CANCELLED`) | ✅ |
| `YarnMovement` `:7399` | iplik stoğu | ✅ | ✅ ADJUST_IN/OUT |
| `RollMovement` `:3569` | topun adım içi giriş/çıkışı | ❌ `updatedAt` + 4 `deleteMany` | ❌ |
| `RollOperation` `:3108` | kurşun/QC2/tambur/fason kanıtı | ❌ 7 `deleteMany` | ❌ |
| `RollVariance` `:3175` | fire · düzeltme · aşım | ✅ | ✅ `reversedAt` |
| `SwatchStockReduction` `:4159` | kartela düşümü | ✅ | ❌ |
| `PaymentAllocation` `:7249` | fatura kapama | ❌ hard delete | ❌ |
| `SackAllocation` `:4939` | sipariş karşılama | ❌ sil-yaz (rebalance) | ❌ |
| `PrintedDocument` `:4388` | belge versiyonu | ✅ | ✅ SUPERSEDED/VOIDED |
| `RollPlanDeviation` `:3278` · `TravelerCardScan` `:3538` | karar / okutma | ✅ | — |

## Geçersiz kılınan kurallar

- **ESKİ → YENİ:** "Hard delete DÖRT ölçülmüş sınıfla sınırlıdır (① bağımlılık-guard'lı · ② alias/karar satırı · ③ pivot replace · ④ taslak)" → **İKİ sınıf** (④ taslak · ③b yapılandırma pivotu); ① ve ② kalktı, ③ ticari/yapılandırma diye bölündü. Kaynak: kök `CLAUDE.md` (2026-09-10'da düzeltildi) ve `docs/standart/VERITABANI.md` §9.
- **ESKİ → YENİ:** `VERITABANI.md` §9 "sekiz hard delete sitesinin sekizi de meşru" ölçümü BAYAT çıktı — 2026-09-10'da 87 site sayıldı (17 `.delete()` + 70 `.deleteMany()`); eski ölçüm `.deleteMany()`i hiç görmemişti.

## Bekçiler

**Bu alanın kapısı YOK — kurallar bugün ölçülmemiştir** ([DB-35]: kapısız kural bir niyet beyanıdır). Ölçüldü:

- `scripts/test_warehouse_ledger.ts` ve `test_warehouse_movements.ts` yalnız OKUMA/süzme yüzeyini ölçüyor, "hangi olay satır yazmalı" invariant'ını DEĞİL.
- `scripts/consistency-check.sql`'de `warehouse_movements` mutabakatı HİÇ YOK.

Gereken iki kapı (ayrı iş): ① **defter mutabakatı** — Σ hareket ↔ canlı durum, depo ve iplik için · ② **AST tripwire** — yeni `delete`/`deleteMany` sitesi allowlist dışındaysa kırmızı.
