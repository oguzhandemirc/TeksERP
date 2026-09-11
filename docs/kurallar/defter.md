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
- **[ÇEKİRDEK]** Ters kaydın BİÇİMİ deftere göre değişir: negatif/karşı satır ancak DB izin veriyorsa yazılır — `payment_allocations_amount_positive` gibi bir CHECK varsa doğru yol `revokedAt`/`revokedById`/`revokeReason` DAMGASIDIR. Damgalı defterde okuyan HER yol aktif yüklemi TEK helper'dan alır (`ACTIVE_ALLOCATION`). · bekçi: `test_payment_allocation.ts` §15s <sub>(arşiv:2026-09-11)</sub>
- **[ÇEKİRDEK]** Tekrar edebilen bir çevrimin izi TEK KOLONA sığmaz: sevk → geri al → sevk turunda `undispatchedAt` gibi tek damga ikinci turda birincisini ezer. Böyle çevrimler OLAY DEFTERİ ister (`ShipmentEvent`, `ChequeEvent` emsali); durum kolonu güncel gerçeği, defter geçmişi taşır. <sub>(arşiv:2026-09-11)</sub>
- **[ÇEKİRDEK]** Tekil kısıt taşıyan bir defteri damgaya çevirirken kısıt PARTIAL'a döner (`WHERE "revokedAt" IS NULL`) — yoksa geri alınmış satır dururken aynı anahtar yeniden yazılamaz ve iş TEKRARLANAMAZ hâle gelir. ⚠️ Prisma'nın `@@unique`i CONSTRAINT değil INDEX üretir: düşürmek için `DROP INDEX` gerekir, `DROP CONSTRAINT IF EXISTS` SESSİZCE hiçbir şey yapmaz. Şemada `@@unique` `map:` ile adlandırılır ki drift yalnız predicate farkını görsün. · bekçi: `test_roll_operation_revoke.ts` §2/§4 <sub>(arşiv:2026-09-11)</sub>
- **[ÇEKİRDEK]** Durumu defterden SAYARAK türeten yol (`recomputeStepStatus`) her sayımında — açık, kapalı, bekleyen aday, giriş noktası — aktif yüklemi taşır; geri alınmış satır sayılırsa adım hata vermeden yanlış duruma geçer. · bekçi: `test_roll_movement_revoke.ts` §5 <sub>(arşiv:2026-09-11 B-4b)</sub>
- **[ÇEKİRDEK]** Geri alınmış defter satırı bir daha DEĞİŞTİRİLMEZ — kapatılmaz, yeniden açılmaz, damgası silinmez; tek istisna izin yeniden bağlanmasıdır (iş emri bölmede hareket/operasyon izi, geri alınmışlar dahil, topla birlikte aynı istasyonlu klon adıma taşınır). · bekçi: `test_roll_movement_revoke.ts` §5e/§6e <sub>(arşiv:2026-09-11 B-4b)</sub>
- **[ÇEKİRDEK]** Bir kaydın GEÇMİŞİNİ koruyan guard (adım silme, başlamış adımın istasyon/sıra değişimi, makine/istasyon kalıcı silme) geri alınmış defter satırını da SAYAR: geri alma "hiç olmadı" demez, "yapıldı ve geri alındı" der. · bekçi: `test_roll_movement_revoke.ts` §6e · `test_roll_operation_revoke.ts` §7d <sub>(arşiv:2026-09-11 B-4b)</sub>
- **[ÇEKİRDEK]** Defter İŞ VERİSİDİR: arşivlenmez, budanmaz. Büyüme index/partition ile karşılanır, satır silerek değil. <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** Çalışma oturumu (`WorkSession`) geçmişi hiçbir yoldan silinmez; oturumu olan istasyon/makine kalıcı silinemez (409 `workSessionCount`), pasife alınır. · bekçi: `test_work_session_history_guard.ts` <sub>(arşiv:2026-09-11)</sub>
- **[ÇEKİRDEK]** Sayaç-bazlı düşüm belgesi ("N adet düş") etkilediği kayıtları KALEM satırına yazar ve stornosu kalemden okur; kalemsiz düşüm geri alınamaz (409), geçmişi audit'ten uydurulmaz. · bekçi: `test_swatch_stock_reduction_reversal.ts` §1/§6 <sub>(arşiv:2026-09-11)</sub>
- **[ÇEKİRDEK]** Tamamlanmış sayımın fark fişi TEK BELGEDE stornolanır: yalnız deponun en son sayımı (LIFO), sayımın düşürdüğü her top hâlâ onun iptaliyle durmalı (hep-ya-hiç); depo defterine `CANCEL_REVERSAL`, sapmaya `reversedAt`, iplikte net ters ADJUST yazılır, sayım satırı değişmez. · bekçi: `test_stock_count_reversal.ts` <sub>(arşiv:2026-09-11)</sub>
- **[ÇEKİRDEK]** Çekin her ileri olayının tipli stornosu vardır (`CANCELLED` hariç her terminalden tek çıkış): ters cari satır orijinaline `reversesTxnId` ile bağlanır, bugüne yazılır, durum en yeni ileri olayın (`createdAt`) `fromStatus`una döner; olay/satır bulunamazsa 409. · bekçi: `test_cheque_reversal.ts` <sub>(arşiv:2026-09-11)</sub>

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
- **[ÇEKİRDEK]** Ters kayıt yazan yol, ileri kaydı iptal eden BELGEYİ de kilitler (`FOR SHARE`, kilitten SONRA taze okuma): kilitsiz okuma READ COMMITTED'da ölü belgenin kaydını diriltir ve karşı yol bayat listesiyle onu hiç görmez. İptal yolu da kapsamını tx İÇİNDE, claim'in arkasında çözer. · bekçi: `test_swatch_stock_reduction_reversal.ts` §10 <sub>(arşiv:2026-09-12)</sub>
- **[ÇEKİRDEK]** Yeni "geçersiz" kolonu açan her model, o kolonu süzen okuma yolunu TEK helper'a bağlar; elle kopyalanan `WHERE` bir gün unutulur ve geçersiz satır listeye sızar (ayrışan yüzey sınıfı). <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** Süzgeç yalnız delegate çağrısında aranmaz: İLİŞKİ okumaları (`include`/`select`/`_count`, `some`/`none`, tipsiz include sabitleri) ve ham SQL'deki HER tablo başvurusu (alias'ıyla) aynı yüklemi taşır; `every` yazılmaz (`none: { ...ACTIVE, NOT: X }`). Ölçüm tip denetleyicili tarama ile yapılır (`scripts/revoke-ast-tarama.ts`). · bekçi: `test_roll_movement_revoke.ts` §6 · `test_roll_operation_revoke.ts` §7 <sub>(arşiv:2026-09-11 B-4b)</sub>
- **[ÇEKİRDEK]** Partial unique'li damgalı defterde tekil anahtarla `upsert` yazan her çağrı `where`e aktif yüklemi koyar (`{ <üçlü>, ...ACTIVE_OPERATION }`); koymazsa anahtar geri alınmış satırı bulur, `update: {}` hiçbir şey yazmaz ve iş TEKRARLANAMAZ — birden çok geri alınmış satırda Prisma hata atar. · bekçi: `test_roll_operation_revoke.ts` §7a/§8 <sub>(arşiv:2026-09-11 B-4b)</sub>
- **[ÇEKİRDEK]** Şema-dışı partial unique'in predicate'i değişirken sed kesintisiz takas edilir: yeni index geçici adla kurulur → eskisi `DROP INDEX` → `ALTER INDEX … RENAME`; `test_db_invariants.ts` envanterindeki predicate aynı commit'te güncellenir. <sub>(arşiv:2026-09-11 B-4b, migration 20260911190000)</sub>
- **[ÇEKİRDEK]** Bir defter "var" diye yeterli değildir: ileri yolu yazıp geri yolu yazmayan defter, hiç olmayandan daha tehlikelidir — toplamı sessizce kayar. Ters yol yazılmadan ileri yol sürüme çıkmaz. <sub>(arşiv:2026-09-10)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Yeni defter açarken sekiz soru: ① hangi olaylar (enum) · ② her ilerinin tersi var mı · ③ append-only mi (`updatedAt` YOK) · ④ aktör kolonu (`createdById`) · ⑤ kaynak belge FK'ları · ⑥ miktar `Decimal` + ölçek kataloğu ([DB-33]) · ⑦ index: `(varlıkId, createdAt)` + olay+tarih · ⑧ mutabakat bekçisi (Σ hareket ↔ canlı durum). <sub>(arşiv:2026-09-10)</sub>
- **[ÇEKİRDEK]** Var olan deftere yeni ileri olay eklerken enum'a ters değeri AYNI commit'te ekle ve geri alma yolunu yaz; "sonra ekleriz" ters yolu olmayan olay üretir. <sub>(arşiv:2026-09-10)</sub>

## Alınmış kararlar — henüz UYGULANMADI (2026-09-11)

Kullanıcı kararı; uygulaması ayrı iştir. Bu bölüm iş bitince silinir, kural satırına dönüşür.

- **`WarehouseMovement` GERÇEK STOK DEFTERİNE dönüşecek.** `warehouseId` atayan HER yol deftere bağlanır — statü terfisi (`STOCK → WAREHOUSE`) dahil; bugün terfi bilinçli olarak satır yazmıyor ve defter yalnız dışarıdan gelen malı görüyor. Hedef: Σhareket ↔ canlı stok mutabakatı ve as-of kesit. Ön koşul: `RETURN_REVERSAL` ters yolu (`CANCEL_REVERSAL` 2026-09-11'de sayım stornosuyla doğdu; elle "iptali geri al" henüz yazmıyor).
- **`RollProperty` / `WorkOrderTargetProperty` ③a'dır** (yukarı bak) — 7 site sil-yazdan versiyonlamaya geçecek.

## Mevcut defter envanteri (2026-09-10 ölçümü)

> ⚠️ **`WarehouseMovement` bir STOK DEFTERİ DEĞİLDİR** (2026-09-11 ölçümü). Satır yalnız topun `warehouseId`'si DOLUYKEN yazılır (`warehouse-ledger.helper.ts:49`); üretimdeki top depoya statü terfisiyle girer ve terfi bilinçli olarak satır yazmaz. Ölçüm: defter sonrası doğan 1.231 topun 751'inde satır var, 87 top depoda ama defterde hiç yok; mutabakat farkı −5.369,3 m; `CANCELLED` 69 topun 0'ında CANCEL satırı var. Bugünkü hâli KENDİ İÇİNDE TUTARLIDIR (girişi olmayanın çıkışı da yok) — ama "depoda ne var" sorusunu CEVAPLAMAZ. Stok defterine dönüşmesi ayrı karardır.

| Defter | Kapsam | Append-only | Ters yol |
|---|---|---|---|
| `WarehouseMovement` | depo giriş/çıkış, 8 olay | ✅ | TRANSFER ✅ · SHIPMENT ✅ · **RETURN ❌** · CANCEL ⚠️ yalnız sayım stornosu (`CANCEL_REVERSAL`, 2026-09-11) — elle "iptali geri al" hâlâ yazmıyor |
| `CariTransaction` `:6611` | cari borç/alacak, 11 kaynak | ✅ | ✅ `reversesTxnId` |
| `ChequeEvent` `:7208` | çek durum defteri, 14 olay | ✅ | ✅ `*_CANCEL` (2026-09-11) — CANCEL'ın tersi yok (kendisi storno) |
| `CashTransaction` `:6898` | kasa/banka | yarı (`status: CANCELLED`) | ✅ |
| `YarnMovement` `:7399` | iplik stoğu | ✅ | ✅ ADJUST_IN/OUT |
| `RollMovement` `:3587` | topun adım içi giriş/çıkışı | yarı — `updatedAt` (açık satır çıkışta kapanır, Faz 2 açık) · `revokedAt` damgası | ✅ damga + PARTIAL unique (`exitedAt IS NULL AND revokedAt IS NULL`) |
| `RollOperation` `:3108` | kurşun/QC2/tambur/fason kanıtı | ✅ `revokedAt` damgası | ✅ damga + PARTIAL unique |
| `RollVariance` `:3175` | fire · düzeltme · aşım | ✅ | ✅ `reversedAt` |
| `SwatchStockReduction` + `SwatchStockReductionItem` | kartela düşümü + kalemleri | ✅ `reversedAt` damgası | ✅ damga (negatif satır CHECK yüzünden yasak); kalemi ölü kabule bağlı kartela dönmez (2026-09-11) |
| `PaymentAllocation` `:7249` | fatura kapama | ✅ `revokedAt` damgası | ✅ damga (negatif satır CHECK yüzünden yasak) |
| `SackAllocation` `:4939` | sipariş karşılama | ❌ sil-yaz (rebalance) | ❌ |
| `PrintedDocument` `:4388` | belge versiyonu | ✅ | ✅ SUPERSEDED/VOIDED |
| `ShipmentEvent` **(yeni)** | sevkiyat durum defteri, 6 olay | ✅ | ✅ DISPATCHED↔UNDISPATCHED · INVOICED↔INVOICE_CLEARED |
| `SackWeighing` **(yeni)** | çuval tartı ölçümü | ✅ | ✅ CLEARED olayı |
| `RollPlanDeviation` `:3278` · `TravelerCardScan` `:3538` | karar / okutma | ✅ | — |

## Geçersiz kılınan kurallar

- **ESKİ → YENİ:** "Hard delete DÖRT ölçülmüş sınıfla sınırlıdır (① bağımlılık-guard'lı · ② alias/karar satırı · ③ pivot replace · ④ taslak)" → **İKİ sınıf** (④ taslak · ③b yapılandırma pivotu); ① ve ② kalktı, ③ ticari/yapılandırma diye bölündü. Kaynak: kök `CLAUDE.md` (2026-09-10'da düzeltildi) ve `docs/standart/VERITABANI.md` §9.
- **ESKİ → YENİ:** "Yalnız oturum izi olan makine/istasyon kalıcı silinebilir, oturum satırları tx içinde temizlenir (denetim SystemLog'da kalır)" (`guarded-hard-remove.ts` yorumu) → oturum geçmişi silinmez ve kalıcı silmeyi ENGELLER; audit arşivlendiği için gerekçe geçersizdi. Kaynak: arşiv 2026-09-11.
- **ESKİ → YENİ:** `VERITABANI.md` §9 "sekiz hard delete sitesinin sekizi de meşru" ölçümü BAYAT çıktı — 2026-09-10'da 87 site sayıldı (17 `.delete()` + 70 `.deleteMany()`); eski ölçüm `.deleteMany()`i hiç görmemişti.

## Bekçiler

**Bu alanın genel kapısı YOK — kuralların çoğu bugün ölçülmemiştir** ([DB-35]: kapısız kural bir niyet beyanıdır). Tek tek ölçülen kurallar:

- `scripts/test_roll_movement_revoke.ts` — hareket damgası, partial unique, geri alma sonrası adım durumu (recompute), AST+tip taraması (§6).
- `scripts/test_roll_operation_revoke.ts` — operasyon damgası, partial unique, upsert tuzağı (§8), AST+tip taraması (§7).
- `scripts/test_cheque_reversal.ts` — çek ters yolları: bağ (`reversesTxnId`), bugüne yazım, `createdAt` kronolojisi, kasa/cari mutabakatı, tek kaynak tripwire.
- `scripts/test_stock_count_reversal.ts` — sayım stornosu: ileri bağlar, CANCEL durur + CANCEL_REVERSAL, sapma damgası, iplik net ters, LIFO, hep-ya-hiç.
- `scripts/test_swatch_stock_reduction_reversal.ts` — kartela düşüm stornosu: kalem = iptal kümesi, satır değişmez + ters damga, çift storno 409, ölü kabulün kartelası dirilmez, kalemsiz eski düşüm 409.
- `scripts/test_work_session_history_guard.ts` — oturum geçmişi silinmez (istasyon/makine 409 + önizleme dökümü + AST: `src/`de `workSession.delete*` ve ham `DELETE work_sessions` yok). Panel metni: `Electron/src/pages/Stations/machineDeleteDescription.test.ts`.
- `scripts/test_warehouse_ledger.ts` ve `test_warehouse_movements.ts` yalnız OKUMA/süzme yüzeyini ölçüyor, "hangi olay satır yazmalı" invariant'ını DEĞİL.
- `scripts/consistency-check.sql`'de `warehouse_movements` mutabakatı HİÇ YOK.

Gereken iki kapı (ayrı iş): ① **defter mutabakatı** — Σ hareket ↔ canlı durum, depo ve iplik için · ② **AST tripwire** — yeni `delete`/`deleteMany` sitesi allowlist dışındaysa kırmızı.
