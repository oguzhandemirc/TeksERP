# Tambur geri alma — hüküm dosyası (2026-09-13)

> **Durum:** **HÜKÜM VERİLDİ (1e, 2026-09-13) — §11.** Bu dosya her kalem için ÖLÇÜLMÜŞ şıkları, bedellerini ve çürütme sonuçlarını taşır; §0–§10 1c'nin ölçümü, §11 yöneticinin kararı ve iş dağılımı. Kod yazılmadı; sondalar geçici, commit dışı.
> **Taban:** `origin/main` **`c1b973e2`** — içinde 01'in depo-kesimi geri alma düzeltmesi (`c2a10e88`), 6e'nin `initialQty` düzeltmesi (`edbd3ea0`, undo iki dalı `initialBump`; bekçi §12 üç ayak), 82'nin beyan yapısı (`31844dbc`, `CUT_SPLIT` → `BAGLI_TERS`, `TERS_KODU.ileri` küme), dokuma P3 (`44b34d23`). Bütün sondalar bu tabanda koşuldu; ilk tur (`a54e4d54` + 01 cherry-pick) yalnız ④'te fark verdi ve o fark §6'da yazılı.
> **Kalemler:** ① `CUT_DISCARD` (ve kapanış `SCRAP` ikizi) · ② `OVERAGE` · ③ `DISPOSITION` (+ K=0 kapısının körlüğü) · ④ `initialQty` etkileşimi · ⑤ beyan yapısı (kalan iş). Çürütme turu (§9) her kalemde en az bir öncülü düzeltti; düzeltilmiş hâl aşağıdadır, ilk yazım silinmedi, "ÇÜRÜDÜ →" ile işaretli.
> **İlgili:** `docs/kurallar/defter.md` · `docs/kurallar/tambur.md` · `docs/kurallar/top-duzeltme.md` · `Teks-Erp/scripts/lib/defter-beyan.ts` (`STOK_OLAY_BEYANI`) · `Teks-Erp/src/services/tambur-undo.service.ts` · `Teks-Erp/src/services/helpers/warehouse-ledger-reverse.helper.ts` · `Teks-Erp/scripts/lib/stok-defteri-bag-olcumu.ts`

---

## §0 · Özet — kalem başına önerilen şık ve bedeli

| Kalem | Soru | Öneri | Tek cümle gerekçe | Bedel |
|---|---|---|---|---|
| ① `CUT_DISCARD` + kapanış `SCRAP` | kalanın atılması/firesi terminal mi? | **(b) BAĞLI TERS, BAĞ ÜZERİNDEN** (`rollVarianceId`): FULL'de 5b damgasıyla birlikte; **artı** arşiv-SINGLE ile ölmüş çocukların grubu FULL'de terslenir (S9); **artı** kapanışın scrap-kalan çocuğuna SINGLE_RESTORE kapanış sapmasını da damgalar (S10) | FULL zaten sapmayı damgalıyor ve metrajı geri koyuyor; stok satırı aynı kararın *depo etkisi*dir. `SCRAP` sebep kodunun **tek yazıcısı kapanıştır** (elle fire `ROLL_CANCEL` yazar) ⇒ `SCRAP: TERMINAL` beyanı bu koda göre zaten yanlış, `BAGLI_TERS` olur | üç kod noktası (~30 satır) + 5 yeni bekçi ayağı; sürüm notu YOK |
| ② `OVERAGE` | keşif geri alınır mı? | **(a) KEŞİF TERMİNAL — keşif ebeveyne taşınır** (doktrin); **(b) damga** — para yüzeyi ağır basarsa | (a) ölçüm olgusunu korur ama `initialBump`ı korur ve bump **para okuyucularına** (alış faturası taslağı · sipariş karşılama) sızar — bu sızıntı BUGÜN de var; (b) bump'ı gerçek aşımda ortadan kaldırır ama keşfi "olmadı" damgalar ve FULL'de `computeRestoredQty` değişir | (a): üç dal + `sourceRefId` + `test_tambur_undo §11` çevrilir; (b): + `computeRestoredQty` + 5b listesi; ikisi de sürüm notu YOK; **kabul-anı okuyucuları ayrı kalem** (§10.6) |
| ③ `DISPOSITION` | ters yol var mı, olmalı mı? | **KARSI_OLAY = `PRODUCTION_ISSUE`** (küme düzeyi) + beyana "çocuk kapsamında bağlı da terslenir" şerhi; asıl borç satırsız stok↔üretim yolları | "bağımsız WO yeniden açma komutu" yok ama dört yol COMPLETED→IN_PROGRESS çeviriyor (ÇÜRÜDÜ → "yol yok" cümlesi bayat); fiziksel karşı yolların BİRİ satır yazıyor (`attachRolls`), ÜÇÜ yazmıyor | manuel taşıma · elle top · redye satır yazar (iş emri alanı); K=0 kapısına 5 üye (6e); `rescueStuckRoll` + `cutOpenFabric` çocuğu (S11) stok kümesine satırsız GİRİŞ |
| ④ `initialQty` | 6e hükmü ①–③ ile nasıl etkileşir? | **② ile BİRLİKTE** — bump'ın sapma satırı yalnız keşifle KARŞILANMAYAN kısım | `edbd3ea0` tek başına 20 m aşımı 40 m yazıyor (ölçüldü) | §12'ye gerçek-aşım ayağı (6e §12d); `initialQty` okuyucusu 6 değil ≥12, ikisi PARA (§6) |
| ⑤ beyan | kalan iş | `TAMBUR_UNDO.ileri` kümesine `CUT_DISCARD`/`SCRAP`/`OVERAGE` **yalnız kod indikten sonra**; §13'e "BAGLI_TERS beyanının gerçek ters yazıcısı" kolu | yapı `31844dbc` ile hazır (ölçüldü 168/0) ama §13 bir `BAGLI_TERS` beyanını ters YAZICIYA bağlamıyor ⇒ erken eklenirse **yalan söyleyen yeşil** | §13f (yeni kol) + §13d'nin `KARSI_OLAY`ı da denetlemesi |

---

## §1 · Ölçüm tabanı ve yöntem

- **Ağaç:** izole worktree, dal `1c-hukum` (= `c1b973e2`), kendi klon DB'si (ad `_test` ekli, 279/279 migration; DROP kullanıcı kararı). Sondalar `scripts/_sonda_1c_*.ts` (commit dışı; 11 senaryo) ve `tambur-undo.service.ts`e uygulanıp `git checkout` ile geri alınan üç geçici yama (**B1 · BB · BA**; her geri alma `git diff --quiet` ile doğrulandı).
- **Ölçüt her senaryoda aynı:** ebeveynin **durumu** (`currentQty`/`initialQty`) ↔ **stok defteri neti** (Σ giriş − Σ çıkış) ↔ **sapma defteri** (canlı `OVERAGE`/`RECORD_CORRECTION`/`SCRAP`, `reversedAt`).
- **Üç sonuç:** ÖLÇÜLDÜ (sonda koştu, sayı burada) · ÖLÇÜLEMEDİ (kod okumasıyla karar verilemez; ne gerektiği yazılı) · İHLAL (şık çürüdü).
- **Çürütme turu:** 5 iddia × 3 mercek (doktrin · mekanik · sahadaki rakam), 15 Opus ajan, salt-okunur kod okuması, 500 araç çağrısı; sonuçlar §9'da, koşarak doğrulananlar §2'ye S9–S11 olarak girdi. Tur sırasında taban `a54e4d54`ten `c1b973e2`ye taşındı; ajanların "seçenek (i) zaten inmiş" tespiti bundandır.
- **Ölçülmeyen:** üretim dalı (`cutOpenFabric`) için ②(a)/②(b) yamaları (stok satırı yok, §4.4) · fabrika kopyasında geçmiş sayım (6e: geri alınmış depo kesimi **0**) · manuel taşıma/redye ile üretime alınmış raf topu sayısı (§5.2) · panel/tablet'in scrap-kalan çocuğunda "İş emrine geri al"ı gösterip göstermediği (backend sunuyor, S10; istemci okunmadı).

---

## §2 · Bugünkü durum — ölçülmüş (`c1b973e2`, yama yok)

| # | Senaryo | Geri alma | Ebeveyn durum | Defter neti | Sapma defteri | Hüküm |
|---|---|---|---|---|---|---|
| S1 | depo 100 → kes 40 → kapanış **discard** | SINGLE (arşiv) | `TAMBUR_CONSUMED` 0/100 | 0 | ebeveyn `RECORD_CORRECTION`:60 canlı · çocuk `RECORD_CORRECTION`:40 | **tutuyor** — kapanış kararı ayakta |
| S2 | aynı | **FULL** | `WAREHOUSE` **100**/100 | **40** | ebeveyn 60 **damgalı** | **AYRIŞIYOR** — sapma geri alındı, `CUT_DISCARD` −60 yerinde |
| S3 | aynı | SINGLE_RESTORE | `WAREHOUSE` 40/100 | 40 | 60 canlı | tutuyor (`edbd3ea0` şişmeyi kapattı: eski tabanda 40/140) |
| S4 | **ham** 100 (`STOCK`) → kes 40 → kapanış **scrap** | FULL | `STOCK` **100**/100 | **40** | `SCRAP`:60 **damgalı** | **AYRIŞIYOR** — FULL fire kararını damgalıyor, satırı bırakıyor |
| S5 | depo 100 → kes **120** (aşım 20) → kapanış discard (kalan 0) | FULL | `WAREHOUSE` **120**/120 | **100** | `OVERAGE/TAMBUR_OVERCUT`:20 + `OVERAGE/TAMBUR_UNDO_FULL`:20 → **canlı Σ 40** | **AYRIŞIYOR** + **çift aşım** |
| S6 | depo 100 → kes 40·40·40 (3.'de aşım 20) | SINGLE ×3 | `WAREHOUSE` **120**/120 | **100** | `TAMBUR_OVERCUT`:20 + `TAMBUR_UNDO_RESTORE`:20 → **Σ 40** | **AYRIŞIYOR** + **çift aşım** (`edbd3ea0` ile depo dalına geldi) |
| S7 | **üretim** dalı (`cutOpenFabric`) 40·40·40 | SINGLE ×3 | `IN_PRODUCTION` 120/120 | (satır yok) | `TAMBUR_OVERCUT`:20 + `TAMBUR_UNDO_RESTORE`:20 → **Σ 40** | **çift aşım** — `test_tambur_undo §11` ✅ ölçüyor |
| S8 | `WAREHOUSE` top → **Konumu Düzelt** (manuel taşıma) adıma | — | `IN_PRODUCTION` 100 | **+100 duruyor** | — | stok→üretim **satırsız** |
| **S9** | S1 sonrası ebeveyne **FULL** (arşiv-SINGLE → FULL) | FULL | `WAREHOUSE` **100**/100 | **0** | ebeveyn 60 damgalı · çocuk 40 damgalı | **AYRIŞIYOR (100↔0)** — çocuk kümesi boş ⇒ grup terslemesi hiç koşmuyor, `CUT_SPLIT` −40 **ve** `CUT_DISCARD` −60 yetim |
| **S10** | S4'ün **scrap-kalan çocuğuna** SINGLE_RESTORE (backend üç modu da sunuyor) | SINGLE_RESTORE | `STOCK` **60**/100 | **0** | `SCRAP`:60 **canlı** | **AYRIŞIYOR (60↔0)** ve **kalıcı**: ebeveyn dirildiği için FULL bir daha sunulmuyor; 60 m fire hem sapmada duruyor hem rafta |
| **S11** | üretim dalı `cutOpenFabric` çocuğu (`WAREHOUSE`, deposu dolu) | — | çocuk `WAREHOUSE` 40/40 | **satır yok** | — | stok kümesine **satırsız GİRİŞ** — üretim dalının kesim çocukları stok defterine hiç girmiyor |

Okuma: S1/S3 tutuyor çünkü kapanış kararı geçerli kalıyor; S2/S4/S9/S10 ayrışıyor çünkü **sapma defteri kararı geri aldı (ya da metraj geri döndü), stok defteri almadı**. S5–S7 aşım kalemi; S8/S11 defter kapsamı boşlukları (③ ve K=0).

---

## §3 · Kalem ① — `CUT_DISCARD` (ve kapanış `SCRAP` ikizi)

**Soru (1e):** keşif/fire terminal mi? (a) terminal ⇒ satır `TERMINAL` sınıfı, geri alma 409 · (b) terslenir ⇒ hangi mekanizma, hangi bekçi bölümü.

**Olgu:** `CUT_DISCARD` bir keşif değil, `RECORD_CORRECTION`'ın depo etkisidir ("mal hiç yoktu"). Aynı bloktan ham ebeveynde `SCRAP` çıkışı yazılır; **iki satır da `rollVarianceId` ile sapmaya bağlıdır** ve stok satırına `rollVarianceId` yazan yalnız iki yer vardır (kapanış çıkışı · çocuk `OVERAGE`). **ÇÜRÜDÜ →** ilk yazım "SCRAP'ın iki yazıcısı var (elle fire terminal, kapanış scrap'ı FULL ile döner)" diyordu; `STOCK_MOVE_REASON.SCRAP`ın **tek** yazıcısı kapanıştır (`tambur.service.ts:2938`), elle fire `ROLL_CANCEL` yazar (`inventory.service.ts:3720`). Dolayısıyla ①(b) kabul edilirse `SCRAP` kodlu satırların **%100'ü** terslenebilir olur ve beyandaki `SCRAP: TERMINAL` satırı bir şerhle kurtarılamaz, `BAGLI_TERS` olur. "Fire kararı terminaldir" doktrini stok defterinde değil, `restoreCancelledRoll` guard'ında ve `ROLL_CANCEL` yolunda yaşamaya devam eder.

### §3.1 Şık (a) — TERMINAL, FULL reddeder

| Ölçüt | Sonuç |
|---|---|
| Doktrin | Terminal olsaydı FULL'ün sapmayı damgalaması (5b) ve `computeRestoredQty`'nin atılan 60 m'yi geri sayması (F0402, 2026-08-12) da yanlış olurdu — (a) yalnız stok satırını değil **var olan geri alma tasarımını** terminal yapar. |
| Değişen kod | `applyFull`: `discardedAgg` kaldırılır, 5b süzgeci `RECORD_CORRECTION`/`SCRAP` kaynaklarını dışlar, kapanış-sonrası FULL 409. |
| Bekçi | `test_tambur_undo §7` (sapma terslenir) ve `§10` (F0402: discard'lı kapanışta FULL `canApply=true`, ebeveyn 100 m dirilir) **kırmızıya döner**. |
| Sahadaki rakam | FULL'ün `restoredQty`'si 100→40; "kumaş elimde, kaydı yanlış" (08-12 saha sorusu) kapanır. **Sürüm notu sınıfı.** |
| Çürütme | **İHLAL:** F0402 ve 08-12 kararlarıyla çelişir; S4 gösteriyor ki durum katmanı kapanış firesini bugün de terminal saymıyor. |

### §3.2 Şık (b) — BAĞLI TERS, **bağ üzerinden** (öneri; üç parça)

**(b1) FULL — 5b damgası + depo etkisi (ölçüldü, yama B1):** 5b'de damgalanacak sapmalar önce `findMany` ile alınır; damgadan sonra `warehouseMovement WHERE rollVarianceId IN (…) AND terslenmemiş` satırları `reverseStockMove` ile `TAMBUR_UNDO` sebebiyle bugüne terslenir. Sebep koduna bakılmaz. Sonuç: S2 100=100 · S4 100=100 · `stock_ledger_tambur_undo` 41/0 · `tambur_undo` 57/0 · `stock_ledger_transform` 28/0 (mevcut hiçbir bekçi bu boşluğu ölçmüyor ⇒ kapı yok, yeni § gerekir).

**(b2) FULL — arşiv-SINGLE ile ölmüş çocukların grubu (S9, çürütme turu buldu, koşarak doğrulandı):** FULL'ün çocuk sorgusu `status ≠ CANCELLED` olduğu için arşiv-SINGLE ile iptal edilmiş çocuk kümeye girmez; `reverseTransformGroupsOf(ids)` boş kümeyle döner; ebeveynin `CUT_SPLIT` çıkışı yetim kalır (100↔0, (b1) ile 100↔60). Oysa `computeRestoredQty` o çocukların `TAMBUR_UNDO_SINGLE` sapmasını geri **sayıyor** ve 5b onları **damgalıyor** ("senkron sözleşmesi", `top-duzeltme.md`). Sözleşmenin defter ayağı eksik: FULL, 5b'de damgaladığı `TAMBUR_UNDO_SINGLE` sapmalarının **çocuklarının** (cancelReasonCode = Tambur geri alma) açık TRANSFORM gruplarını da tersler. Mekanizma yine bağ: damgalanan sapmanın `rollId`si = ölü çocuk ⇒ `reverseTransformGroupsOf([o çocuklar])`.

**(b3) SINGLE_RESTORE — kapanışın scrap-kalan çocuğu (S10, çürütme turu buldu, koşarak doğrulandı):** ham ebeveynde `scrap` kapanışı **gerçek bir çocuk** doğurur (SCRAP statüsü, ebeveynde `SCRAP` çıkışı, sapma ebeveynde). Backend o çocuğa üç modu da sunuyor; SINGLE_RESTORE metrajı ebeveyne geri koyuyor, sapma canlı kalıyor, satır terslenmiyor, ebeveyn dirildiği için FULL bir daha sunulmuyor ⇒ **kalıcı** 60↔0 ve fire hem defterde hem rafta. Kural: "SINGLE_RESTORE kapanış sapmalarını terslemez" cümlesinin istisnası — geri alınan çocuk kapanışın **kalanının kendisiyse** (`entrySource=TAMBUR_SPLIT` ∧ doğuşu `finalizeWarehouseCut` ∧ ebeveynde o çocuğun metrajına eşit `TAMBUR_WAREHOUSE_FINALIZE` sapması), o sapma damgalanır ve depo etkisi (b1) ile terslenir. Kalanın `keep` çocuğu TRANSFORM çiftiyle doğduğu için zaten `reverseTransformGroupsOf` ile tutuyor (§11D). Alternatif: scrap-kalan çocuğuna SINGLE/SINGLE_RESTORE **sunulmaz**, yalnız FULL (kapanışın kalanı bir "kesim parçası" değildir) — daha dar, daha ucuz; 1e kararı (§10.5).

| Ölçüt | Sonuç |
|---|---|
| Doktrin | İleri satır ne silinir ne değişir; ters satır bugüne, `reversesMovementId` bağlı; aynı satır iki kez terslenemez. Sapma damgası ile depo etkisi **tek karar**ın iki defteri — birlikte döner. Beyan: `CUT_DISCARD` → `BAGLI_TERS`/`TAMBUR_UNDO`; **`SCRAP` → `BAGLI_TERS`/`TAMBUR_UNDO`** (tek yazıcı kapanış); ikisi `TAMBUR_UNDO.ileri` kümesine **kod indikten sonra** (§7). |
| Değişen kod | `applyFull` 5b bloğu (~12 satır: `findMany` + mevcut `updateMany` + bağlı `reverseStockMove` döngüsü) · `applyFull` çocuk kümesine "Tambur geri almasıyla iptal edilmiş + grubu açık" çocukların grup terslemesi (~8 satır) · `applySingleRestore`da kalan-çocuk tanıma + damga (~12 satır). `applySingle` dokunulmaz (S1 tutuyor). |
| Bekçi | `test_stock_ledger_tambur_undo` **§13** FULL discard 100=100 (`CUT_DISCARD` bağlı terslendi) · **§14** ham scrap FULL 100=100 · **§15** SINGLE_RESTORE'da (`keep`/`discard` kapanışı) satır terslenmedi (40=40) · **§18** arşiv-SINGLE → FULL 100=100 (S9) · **§19** scrap-kalan çocuğuna SINGLE_RESTORE 60=60 ∧ `SCRAP` sapması damgalı (S10). Negatif: döngü/grup/damga kaldırılınca ilgili ayak kırmızı; pozitif: `test_consistency` yeni kalem "sapması damgalı, bağlı satırı terslenmemiş ebeveyn" sonda DB'de 0. |
| Sahadaki rakam | Stok as-of/Σ yalnız geri alınmış kapanışlı ebeveynlerde değişir; fabrika kopyası: geri alınmış depo kesimi **0**. Rapor kırılımı sebep kodu okumuyor. **Sürüm notu: hayır.** |
| Geri alınabilirlik | Ters satır bağlı ve damgalı; yanlış hükümse yeni ileri satır yazılır. |
| Çürütme | ÖLÇÜLDÜ: 5b süzgeci `source` kapsamlı, `kind` yok ⇒ yarın `TAMBUR_*FINALIZE` kaynağıyla yazılan **her** sapma kendiliğinden bu kurala girer — beyan edilir. ÖLÇÜLDÜ: üretim kapanışı (`finalizeOpenFabric`, source `TAMBUR_FINALIZE`) stok satırı yazmadığı için kural orada no-op (doğru; ama "kapandı" sanılmamalı — üretim dalının kendi defteri yok, S11). ÖLÇÜLDÜ: çok kapanışlı zincirde 5b bugün de **tüm canlı** kapanış sapmalarını damgalıyor; bağ-güdümlü tersleme aynı kümeyi izler (kapanış kimliği §10.1). |

**Öneri: (b1)+(b2)+(b3).** Aynı kararın iki defteri birlikte döner; `SCRAP` beyanı `BAGLI_TERS` olur.

---

## §4 · Kalem ② — `OVERAGE`

**Soru (1e):** stok satırı ÇOCUKTA terslenir (S5/S6: çocuk net 0 ✅), sapma EBEVEYNDE terslenmez. 82'nin iki dallı koşulu: (a) keşif terminal ⇒ `BAGLI_TERS` + `RollVariance` şerhi · (b) geri alma sapmayı damgalar ⇒ 5b yüklemi `OVERAGE`'ı kapsar.

**Olgu:** aşım bir DEVİR değil KEŞİFtir; satır çocuğa, sapma ebeveyne yazılır (`TAMBUR_OVERCUT`). Çocuk iptal edilince satır **zaten** bağlı tersleniyor. **Üç aşım yazıcısı var** (ÇÜRÜDÜ → ilk yazım ikiyi sayıyordu): depo kesimi (`cutWarehouseRoll`, sapma ebeveynde + çocukta `ADJUST` stok satırı, `rollVarianceId` bağlı) · üretim kesimi (`cutOpenFabric`, **yalnız sapma**, stok satırı yok — S11: çocuk raftadır ama defterde yoktur) · klasik finalize (`processTamburDecision`, N çocuk için **tek kümülatif** sapma, çocuk atfı tanımsız). Ayrıca `OVERAGE` **kind**'ını sayım düzeltmesi ve fason kabulü de yazıyor ⇒ her yüklem `source = TAMBUR_OVERCUT` kapsamlı olmak zorunda, `kind` değil.

### §4.1 Bugünkü davranış (ölçüldü) — iki kusur birden
Ebeveyne `len` döner (çocuğun metrajı, ebeveynin kaybettiği devir değil) → durum 120 ↔ defter 100 (S5/S6). `newCurrent`/`restored` > `initialQty` ⇒ `initialBump` 20 **ve** yeni `OVERAGE` satırı ⇒ aynı 20 m için **iki canlı sapma** (S5 FULL, S6 depo SINGLE, S7 üretim SINGLE). FULL'de `restored` = Σ çocuk `initialQty` (aşım dahil), yani bump kaynağı SINGLE'dan farklı (ÇÜRÜDÜ → ②(b)'nin "bump doğmaz" cümlesi FULL'de yanlış; §4.3).

### §4.2 Şık (a) — KEŞİF TERMİNAL, keşif ebeveyne taşınır

**Mekanizma (depo dalı; ölçüldü, yama BA):** çocuğun terslenmemiş `OVERAGE` stok satırları okunur (`qty`, `rollVarianceId`); çocuk satırları bağlı terslenir; ebeveyne `len` döner; ebeveyne yeni `ADJUST` +aşım satırı, `reasonCode: OVERAGE`, **aynı `rollVarianceId`**; `initialBump = max(0, yeniCur − init)`; yeni sapma satırı yalnız `initialBump − Σtaşınan > 0` ise. **Üretim dalı (ÇÜRÜDÜ → ilk yazım "aynı desen" diyordu):** ebeveyn `IN_PRODUCTION` = stok dışı, `postStockMove` **fırlatır** ⇒ orada taşıma satırı yazılamaz ve gerekmez (çocuğun da satırı yok, S11); (a) üretim dalında **sapma-yalnız**dır: `TAMBUR_OVERCUT` canlı kalır, `initialBump` yazılır ama keşifle karşılanan kısım için yeni sapma **yazılmaz** — karşılama ölçüsü `sourceRefId=childId` (§4.4). Klasik finalize'da atıf tanımsız ⇒ bugünkü davranış (ölçülen çift kayıt) **beyan edilerek** kalır.

| Ölçüt | Sonuç |
|---|---|
| Doktrin | Ölçüm bir olgudur ("Tambur asıl ölçüm noktasıdır"; 2026-08-09 kararı "aşım da sapma olarak kayda geçsin"); kesimi geri almak kumaşı geri ölçmez. Taşıma satırı yeni ileri satırdır ama yeni olgu değildir. **Sözleşme bedeli (ÇÜRÜTME):** aynı `rollVarianceId`ye bağlı **üç** stok satırı doğar (ileri çocuk · ters çocuk · taşınan ebeveyn); bugün bu bağı okuyan sorgu yok, sözleşme yazılır. |
| Değişen kod | `applySingle` depo dalı (~25 satır) · `applySingleRestore` depo dalı · `applyFull` (çocukların `OVERAGE` satırları taşınır, bump sapması karşılanmayan kısım) · üretim dalı sapma-yalnız kolu · `postStockMove` importu · `sourceRefId` iki yazıcıda. |
| Bekçi | **§16** aşımlı depo SINGLE → 120=120, canlı `OVERAGE` **n=1 Σ=20**, ebeveynde aynı `rollVarianceId` (6e §12d ile aynı ölçüt) · **§17** aşımlı FULL (S5 → 120=120, Σ 20). ⚠️ **`test_tambur_undo §11` ÖNCE ÇEVRİLİR** — bugün "`TAMBUR_UNDO_RESTORE` tek satır 20" bekliyor, değişmezin **tersini** kilitliyor (6e mutabık). |
| Sahadaki rakam | Ölçüldü (BA): S6 → 120=120, Σ 20; `stock_ledger_tambur_undo` 41/0 · `tambur_undo` 57/0 · `stock_ledger_transform` 28/0 (§12 üç ayak dahil). Tambur aşımını toplayan rapor **yok** (fason karnesi `source='SUBCONTRACTOR_RETURN'` dar). **Ama** `initialBump` `initialQty`yi değiştirir ve o kolonun **para okuyucuları** var (§6) — (a) bunu korur (bugünkü davranış). **Sürüm notu: hayır**, kabul-anı okuyucuları ayrı kalem (§10.6). |
| Geri alınabilirlik | Taşıma satırı bağlı; yanlışsa ters satır + damga. |
| Çürütme | ÖLÇÜLDÜ: aşımsız çocukta desen bugünkü koda indirgenir (§12a/§12b yeşil). İHLAL (düzeltildi): üretim dalında taşıma yazılamaz — hüküm iki biçimli. ÖLÇÜLEMEDİ: klasik finalize'da per-çocuk atıf. |

### §4.3 Şık (b) — geri alma keşfi damgalar

**Mekanizma (depo SINGLE; ölçüldü, yama BB):** çocuğun `OVERAGE` satırlarının `rollVarianceId`si damgalanır; ebeveyne `len − Σaşım` döner. **FULL (ÇÜRÜDÜ → bağ gerekmez):** 5b `source` listesine `TAMBUR_OVERCUT` eklenir ve `computeRestoredQty`den damgalanan aşım düşülür (`restored` = Σ devir) — iki dalda da bağsız çalışır. **Üretim SINGLE:** per-çocuk atıf `sourceRefId` ister (§4.4). **Bump fallback (İHLAL, ölçüldü):** "initialQty'ye dokunulmaz" yanlış — `§12c` (keşifsiz eski veri, `initialQty` elle 60) BB altında DB CHECK `rolls_qty_le_initial` ile **23514 çöktü**; (b) de `initialBump`ı keşifsiz artış için korur.

| Ölçüt | Sonuç |
|---|---|
| Doktrin | Damga meşru mekanizma; satır silinmez, "ölçüldü ve kesim geri alındı" olarak durur. Bedel: 120 m'lik top 100 m görünür, yeniden kesimde yeniden keşfedilir (ilk satır damgalı, rapor doğru). 2026-08-09 kararı ("aşım kayda geçsin") satır durduğu için çiğnenmez, ama "canlı" sayılmaz. |
| Değişen kod | Üç dal + `computeRestoredQty` (senkron sözleşmesi genişler) + 5b listesi + `sourceRefId`; (a)'dan bir dosya fazla. |
| Bekçi | §16/§17 ölçütü "100=100, canlı `OVERAGE` 0, `initialQty` 100"; `test_tambur_undo §11` yine çevrilir. |
| Sahadaki rakam | Ölçüldü (BB): S6 → 100=100, Σ 0, `initialQty` 100 — **gerçek aşımda bump doğmaz ⇒ para okuyucuları etkilenmez** (§6); keşifsiz eski veride bugünkü bump kalır. Sürüm notu: hayır. |
| Çürütme | İHLAL (mekanik, düzeltildi): CHECK çarpışması → fallback. ÖLÇÜLDÜ: doktrinle çelişmez (damga beyanlı mekanizma). Kalan bedel: ölçüm olgusu canlı değil damgalı. |

### §4.4 Üretim dalı — ortak ön koşul `sourceRefId`
`cutOpenFabric` çocuğuna stok satırı yazılmıyor (S11) ⇒ `rollVarianceId` bağı yok ⇒ "bu keşif hangi çocuğun" sorusu ancak `RollVariance.sourceRefId = child.id` ile cevaplanır. **ÇÜRÜDÜ →** ilk yazım kolonu "yalnız `SUBCONTRACTOR_RETURN` yazıyor" diyordu; sayım da yazıyor (`stock-count.service.ts:678`, fiş kimliği) — kolon **belge kimliği** taşıyor, top kimliği yazmak onu polimorfik yapar; mevcut iki okuyucu `source` ile kapsandığı için kırılmaz ama şema şerhi (`prisma/schema.prisma` "bugün yalnız SUBCONTRACTOR_RETURN") bayat, düzeltilir. Klasik finalize (`processTamburDecision`) kümülatif sapma yazar ⇒ `sourceRefId` NULL kalır, bugünkü davranış beyanla korunur. Şema değişikliği yok.

### §4.5 FULL modu
(a): çocukların `OVERAGE` satırları ebeveyne taşınır (depo), `initialBump − Σtaşınan` sapma; (b): 5b += `TAMBUR_OVERCUT`, `restored −= Σdamgalanan`. Bekçi §17.

**Öneri:** doktrin ağırlıklıysa **(a)** (ölçüm canlı kalır, `computeRestoredQty` değişmez, üretim dalı bugünkü davranışını korur); **para yüzeyi** ağırlıklıysa **(b)** (gerçek aşımda `initialQty` hiç oynamaz). İkisinde de `test_tambur_undo §11` çevrilir ve `sourceRefId` iner. Bu turda ölçüm (a)'yı da (b)'yi de ayakta bıraktı; seçim 1e'nin.

---

## §5 · Kalem ③ — `DISPOSITION`

**Soru (1e):** beyanda BORC; ters yol var mı, olmalı mı? Ek: manuel taşıma bulgusu K=0 iddiasının çürütülmesi mi — kapı beyanlı kapsam dışı mı, kör mü?

### §5.1 Olgu (ölçüldü + çürütme turu)
- Yazar tek: `roll-disposition.helper.ts` (WO kapanış/iptal/parti düşürme dispozisyonu; hedef stok statüsüyse `PRODUCTION` + `DISPOSITION`, stok kümesine GİRİŞ; `workOrderStepId` damgası **yok**).
- **ÇÜRÜDÜ →** "WO yeniden açma yolu yok" cümlesi (beyanın kanıtı ve ilk yazımım) bayat: bağımsız bir "yeniden aç" komutu yok ama **dört yol** COMPLETED→IN_PROGRESS çeviriyor — manuel taşıma, elle top ekleme (`tambur-manual`), tambur-undo SINGLE_RESTORE/FULL ("iş emri yeniden açıldı" mesajı), kurşun yeniden açma. Borcun "kapanır" koşulu bugün **fiilen sağlanıyor** ve hiçbiri dispozisyon satırına dokunmuyor.
- Karşı olay `PRODUCTION_ISSUE` (raftan üretime): **`attachRolls` ("Yeniden Üretime Al") yazıyor** ve STOCK/WAREHOUSE/A1_STOCK kabul ediyor — dispozisyon almış topun satır **yazan** dönüş yolu bu (ÇÜRÜDÜ → ilk yazım "karşı yol satır yazmıyor" diye genellemişti). A1_STOCK dispozisyonunun tek dönüş yolu zaten `attachRolls` (manuel taşıma A1_STOCK'u kabul etmez).
- **Satırsız stok→üretim yolları:** manuel taşıma (S8, ölçüldü) · elle top "Mevcut Topu Buraya Al" (`tambur-manual.service.ts:1179-1194`, statik) · redye ayırma (`workorder-split.service.ts:43-47,465`, statik). **Satırsız stok kümesine GİRİŞ:** `rescueStuckRoll` (`inventory.service.ts:5238-5251`, statik) · `cutOpenFabric` çocuğu (S11, ölçüldü).
- Tambur-undo FULL/SINGLE `reverseAllRollStockMoves(çocuklar)` sebep kodu süzmez ⇒ çocuk üstündeki `DISPOSITION` satırı da `TAMBUR_UNDO` ile **bağlı terslenir** (çocuk başka WO'ya alınıp dispozisyonla rafa dönmüşse; ölü çocukta net 0 doğru). ⇒ `DISPOSITION`ın tersi **iki mekanizmalı**: küme düzeyinde karşı olay, çocuk kapsamında bağlı ters. Beyan tipolojisi bunu ifade edemiyor; `KARSI_OLAY` seçilirse bağlı tersleyici beyansız kalır ve §13d yalnız `BAGLI_TERS`i denetlediği için görmez (§7).
- Analoji sınırı (çürütme turu): `ENTRY_RECEIPT↔ROLL_CANCEL` tek atımlıktır; `DISPOSITION↔PRODUCTION_ISSUE` top başına tekrarlanır ve `DISPOSITION` adım damgası taşımaz ⇒ olay düzeyi eşleme yok, yalnız küme neti kapanır. `KARSI_OLAY` sınıfının vaadi de zaten budur.
- Ayrı tutarsızlık (82'ye): `WO_DETACH` yazıcısı yorumunda "TERS KAYIT DEĞİL, yeni ileri satır" der, beyan onu `TERS_KODU` ilan eder.

### §5.2 K=0 kapısı (`test_stok_defteri_bag_olcumu`) bu yolu neden görmüyor — iki sonuçtan hangisi?

| Ölçüm | Sonuç |
|---|---|
| Kapının sorusu | "Sevkiyat ve kardeşleri stok defterine bağlı mı" — K = (i) eski kapı `writeWarehouseMovement(s)` çağıranları (AST) + (ii) `BILINEN_KAPISIZ_YOLLAR` (elle liste). |
| (i) | manuel taşıma/elle top/redye/rescue/cutOpenFabric hiçbir kapıyı çağırmaz ⇒ AST'ye **görünmez** (kütüphanenin kendi şerhi: "kendini ilan ETMEZ"). |
| (ii) | liste: fason sevki · kartela sevki · kartela sevk iptali. Beş yol **YOK**. `KapisizYol` tanımı ("topu stok kümesine sokan/çıkaran ama hiçbir kapıyı çağırmayan yol") beşine birebir uyar. |
| Kütüphanenin "yeni üye" reçetesi ① | `grep -c "postStockMove\|writeWarehouseMovement"` → manuel taşıma **0**, redye **0**, tambur-manual **0**, stok kümesinden çıkaran yol varken — reçete uygulanınca üye çıkıyor. |
| Veri ayağı (`test_consistency` asimetri) | `STOK_DISI_STATULER`de `IN_PRODUCTION` **yok** ⇒ veri ayağı da görmez. |
| Beyan | Kapsam dışı beyanı **yok**; şerh "liste elle tutuluyor ve eksik olabilir — bir kez eksik çıktı" diyor. |

**Sonuç: KÖR (kapı borcu), beyanlı kapsam dışı değil.** K=0 iddiası çürütülmüştür: K ≥ 5 (biri ölçüldü, biri S11 ile ölçüldü, üçü statik). Kapanış: `BILINEN_KAPISIZ_YOLLAR`a beş üye — kapı hemen kırmızıya döner ve doğru sayıyı basar; veri ayağına `IN_PRODUCTION` için "girişi var ∧ çıkışı yok ∧ üretimde" asimetrisi. **Kalem 6e'ye açılır**; yazımın kendisi iş emri alanı (manuel taşıma · elle top · redye · rescue) ve tambur alanı (`cutOpenFabric` çocuğu — üretim dalının kendi defteri).

### §5.3 Şıklar

| Şık | Ne | Doktrin | Kod | Bekçi | Rakam |
|---|---|---|---|---|---|
| (a) BORC kalır, "Kapanır" düzeltilir | beyan: "reopen yok" cümlesi silinir; kapanış "satırsız yollar `PRODUCTION_ISSUE` yazınca" | borç görünür | 0 | `test_defter_ters_yol §13` yeşil | — |
| **(b) `KARSI_OLAY = PRODUCTION_ISSUE` + şerh (öneri)** + üç yol satır yazar | beyan `DISPOSITION: { KARSI_OLAY, kod: PRODUCTION_ISSUE }` + "çocuk kapsamında `TAMBUR_UNDO` ile bağlı da terslenir" şerhi; manuel taşıma / elle top / redye claim sonrası stok kümesinden çıkan her top için `PRODUCTION_ISSUE` (`attachRolls` deseni, `workOrderStepId` hedef adım; claim ÖNCESİ statü/depo/metraj) | karşı olay meşru sınıf, küme düzeyi; `PRODUCTION_ISSUE` zaten `WO_DETACH`ın karşısı | üç dosyada ~12'şer satır | yeni `test_stock_ledger_manual_move` (üç yol: WAREHOUSE→adım −100 · IN_PRODUCTION→adım satırsız · §H boşluk 0); K=0 kapısı üyeleri | stok as-of: üretime alınan raf topu raftan **düşer** (bugün hayalet). Fabrika kopyasında bu yollarla üretime alınmış raf topu **ÖLÇÜLMEDİ** — iniş öncesi; >0 ise "onarım yok, ufuk sonrası". Bu satırları okuyan rapor yok |
| (c) TERMINAL | dispozisyon nihai | İHLAL: rafa giriş terminal olamaz | — | — | — |

**Öneri: (b).** Borç yer değiştirir ve **görünür** olur: `DISPOSITION` beyanı kapanır, satırsız yollar K=0 kapısında üye olarak kırmızı basar; `rescueStuckRoll` ve `cutOpenFabric` çocuğu (giriş yönü) aynı listeye, sahipleri ayrı.

---

## §6 · Kalem ④ — `initialQty` (6e hükmü ile etkileşim)

**6e/1e hükmü (`edbd3ea0`, `top-duzeltme.md:20`):** kesim `initialQty`ye dokunmaz; geri alma `currentQty`yi geri koyar, `initialQty`yi yalnız aşımda `initialBump` ile çeker **+ `OVERAGE/TAMBUR_UNDO_RESTORE` satırı**; bekçi §12 (a/b/c).

**Etkileşim (ölçüldü):** S6 → `initialQty` 220→**120** ✓ **ama** durum 120 ↔ defter 100 sürer ve canlı `OVERAGE` **n=2 Σ=40**. ④ tek başına ②'nin çift-sapma kusurunu **depo dalına da taşıdı**. `§12` görmez: `§12c`'nin aşımı yapay (kesim anı `OVERAGE` yok; yorumunda beyanlı). 6e mutabık: §12d gerçek-aşım fikstürü hüküm sonrası.

**Sed tarafı (6e bulgusu, BB ile yeniden ölçüldü):** CHECK `rolls_qty_le_initial` yalnız `cur ≤ init`; yukarı kayma kör. "Artış yalnız `OVERAGE` eşliğinde" satırlar arası ⇒ uygulama kapısı: **`initialQty = giriş metrajı + Σ canlı OVERAGE(ebeveyn, source TAMBUR_*)`** — `test_consistency` sonda kalemi; fabrika kopyası 0.

**Okuyucular (ÇÜRÜDÜ → "altı okuyucu"):** `initialQty`yi okuyan ≥12 yer var; listede olmayan ikisi **PARA**: alış faturası taslağı satır miktarı (`invoice.service.ts:613-627`, şerhi "fatura MAL KABUL ANINI belgeler… borcumuz değişmez") ve sipariş karşılama (`purchase-order.service.ts:252-259`, "ısmarladığımız miktar değişmez"). İkisi de kolonu **değişmez** ilan ediyor; `initialBump` bir mal-kabul topunda koşarsa (depo kesimi barkodlu WAREHOUSE/STOCK topu ister, kabul topu buna dahil) fatura taslağı ve karşılama bump kadar büyür. Bu sızıntı **bugün** var (FULL 08-09'dan, depo SINGLE `edbd3ea0`dan beri); ②(a) korur, ②(b) gerçek aşımda kaldırır. Listedeki "etiket" ise `initialQty` değil `currentQty` okuyor (`label.service.ts:430`). Kalıcı çözüm ② seçiminden bağımsız: kabul anı metrajı kendi kolonunda ya da okuyucular `initialQty − Σ canlı TAMBUR OVERAGE` okur (§10.6).

**Hüküm önerisi:** ④'ün "+ `OVERAGE/TAMBUR_UNDO_RESTORE` satırı" parçası ② ile birlikte yazılır — sapma satırı yalnız **karşılanmayan kısım** için ((a): `initialBump − Σtaşınan/atfedilen`; (b): gerçek aşımda bump doğmaz, keşifsiz eski veride bugünkü). Kural cümlesi `top-duzeltme.md:20` ve `tambur.md:27` buna göre daralır; arşive "KISMİ → 2026-09-13".

---

## §7 · Beyan yapısı — kalan iş

`31844dbc` yapıyı kurdu (`TERS_KODU.ileri` küme; §13c/§13d küme okur). **Ölçüldü:** `CUT_DISCARD` → `BAGLI_TERS`/`TAMBUR_UNDO` tek başına §13d kırmızı; `TAMBUR_UNDO.ileri`ye eklenince **168/0**, açık olay borcu 4 → 3.

**Çürütme turunun eklediği (üçü de İHLAL):**
1. **Yalan söyleyen yeşil:** §13'ün hiçbir kolu bir `BAGLI_TERS` beyanını **gerçek bir ters yazıcıya** bağlamıyor (§13c atıf katalogda mı, §13d simetri, §13e kod bir yerde geçiyor mu). `CUT_DISCARD`/`SCRAP`/`OVERAGE` kümeye **kod inmeden** eklenirse kapı yeşil kalır ve var olmayan ters yolu onaylar. Sıra: önce kod (§3/§4), sonra beyan; ve §13'e yeni kol **§13f**: her `BAGLI_TERS`/`TERS_KODU` çifti için `tersYazan: {dosya, sembol}` (model düzeyindeki `tersYazan`ın olay düzeyi ikizi).
2. **§13d yalnız `BAGLI_TERS`e bakar:** `KARSI_OLAY` ile yapılan çok-ileri eşlemesi sessizce geçer (emsal: `ENTRY_RECEIPT → KARSI_OLAY ROLL_CANCEL`). ③(b) `KARSI_OLAY` seçerse kapı hiçbir şey ölçmez; §13d'nin `KARSI_OLAY`ı da denetlemesi (karşı kodun beyanı `TERS_KODU` ya da kendi `KARSI_OLAY`ı olmalı) ayrı iş.
3. **(ii) "helper tek reasonCode alıyor" gerekçesi yanlış:** `reverseLatestScopedStockMove` ileri ve ters kodu **ayrı** alır (beş çağrı yeri ileriye özel ters kod yazıyor: `CANCEL_RESTORE` · `TRANSFER_CANCEL` · `SHIPMENT_CANCEL` · `KURSUN_REOPEN` · `FASON_*_CANCEL`). Gerçek engel yalnız kapsamsız `reverseAllRollStockMoves` (sebep kodu süzmez; çocuğun üstündeki TRANSFER/DISPOSITION satırı da `TAMBUR_UNDO` olur ⇒ küme **veriye bağlı**, statik dizi hiçbir zaman tam olamaz). Yani çok-ileri ters kod bir tasarım tercihi değil, kapsamsız helper'ın **kaçınılmaz** sonucudur; bu beyanda yazılır.

`SCRAP` beyanı: `BAGLI_TERS`/`TAMBUR_UNDO` (tek yazıcı kapanış, §3). `CUT_SCRAP` alternatifi (§10.4) `SCRAP`ı yazıcısız bırakır ⇒ §13e kırmızı ⇒ katalogdan düşer; rakam etkisi yok.

---

## §8 · Kapanış bekçileri ve iki-sonda zorunluluğu

| Bekçi | Bölüm | Negatif sonda (taban artar) | Pozitif sonda (taban düşer) |
|---|---|---|---|
| `test_stock_ledger_tambur_undo` | §13 FULL discard 100=100 · §14 ham scrap FULL 100=100 · §15 SINGLE_RESTORE (`keep`/`discard`) satır terslenmez · §16 aşımlı SINGLE (= 6e §12d) · §17 aşımlı FULL · §18 arşiv-SINGLE → FULL (S9) · §19 scrap-kalan çocuğu SINGLE_RESTORE (S10) | bağlı döngü / grup / damga / taşıma kaldırılınca ilgili ayak kırmızı | `test_consistency` yeni kalem "sapması damgalı, bağlı satırı terslenmemiş ebeveyn" 0 |
| `test_tambur_undo` | §11 "Σ canlı `OVERAGE` = gerçek aşım" (bugün **tersini** kilitliyor — kod değişmeden ÖNCE çevrilir) | — | — |
| `test_consistency` (④) | `initialQty ≠ ENTRY metrajı + Σ canlı OVERAGE(ebeveyn, TAMBUR_*)` | fikstürde `initialQty` elle artırılınca +1 | fabrika kopyası 0 |
| `test_stock_ledger_manual_move` (yeni, ③) | manuel taşıma · elle top · redye: stok→adım `PRODUCTION_ISSUE`; üretim→adım satırsız; §H boşluk 0 | yazım kaldırılınca kırmızı | fabrika kopyasında bu yollarla üretime girmiş raf topu (iniş öncesi ölçülür) |
| `test_stok_defteri_bag_olcumu` (6e, ③) | `BILINEN_KAPISIZ_YOLLAR` +5 (3 çıkış · 2 giriş); veri ayağına `IN_PRODUCTION` asimetrisi | üye eklenince K=5 kırmızı (bugünkü kod) | satırlar yazılınca K=0 |
| `test_defter_ters_yol` | §13f (ters yazan sembolü olay düzeyinde) · §13d `KARSI_OLAY` denetimi · `CUT_DISCARD`/`SCRAP`/`OVERAGE` → `BAGLI_TERS` (kod sonrası) · `DISPOSITION` → `KARSI_OLAY` + şerh | ters yazan olmadan beyan kırmızı | açık olay borcu 4 → **1** |

Ölçüm disiplini (kök CLAUDE.md): her yeni § iki sondayla iner; tek fikstür yasak.

---

## §9 · Çürütme turu — sonuç tablosu

15 çürütmenin 15'i "refuted=true" döndü; hiçbirinde **çekirdek** (önerilen mekanizma) çürümedi, hepsinde **öncül/gerekçe/kapsam** düzeltildi. Koşarak doğrulananlar: S9 · S10 · S11 (§2). Kod okumasıyla doğrulananlar aşağıda; ÖLÇÜLEMEDİ kalanlar §1'de.

| İddia | Çekirdek | Çürüyen öncül (dosya:satır) | Belgeye etkisi |
|---|---|---|---|
| ① discard/scrap | ayakta (bağ-güdümlü tersleme dar, çakışmasız; (a) §7/§10'u kırar) | "SCRAP'ın iki yazıcısı" — tek yazıcı `tambur.service.ts:2938`, elle fire `ROLL_CANCEL` (`inventory.service.ts:3720`) · "SINGLE_RESTORE'da durum=defter" — scrap-kalan çocuğunda 60↔0 (S10) · "(b) durum=defter getirir" — arşiv-SINGLE → FULL 100↔0 (S9) · 5b `kind`süz, genişler · üretim kapanışı bağsız (no-op) | §3: `SCRAP` → `BAGLI_TERS`; (b2) ve (b3) eklendi; §8'e §18/§19 |
| ② overage | ayakta (a/b ikisi de uygulanabilir) | "`sourceRefId` yalnız fason" — sayım da yazıyor (`stock-count.service.ts:678`) · "mekanizma bağdır" — FULL bağsız çalışır (`tambur-undo.service.ts:1858-1871` `source` yüklemi) · üçüncü yazıcı klasik finalize (`tambur.service.ts:1341-1348`, kümülatif) · (a) üretim dalında `postStockMove` fırlatır (ebeveyn `IN_PRODUCTION`) · `OVERAGE` kind'ını sayım/fason da yazıyor (`inventory.service.ts:4695`, `subcontractor.service.ts:3491`) · (a) aynı `rollVarianceId`ye 3 satır · **`cutOpenFabric` stok satırı yazmıyor** (S11) | §4: üç yazıcı; (a) iki biçimli; (b) FULL bağsız + `computeRestoredQty`; yüklem `source` kapsamlı; S11 ③'e |
| ③ disposition | ayakta (`KARSI_OLAY` küme düzeyinde; "reopen komutu yok") | "reopen yolu yok" — dört yol COMPLETED→IN_PROGRESS (`workorder-manual-move.service.ts:862-869`, `tambur-manual.service.ts:1222`, `tambur-undo.service.ts:1550/1902`, `kursun-qc.service.ts:1192`) · "karşı yol satır yazmıyor" — `attachRolls` yazıyor (`workorder.service.ts:4818-4829`), A1_STOCK'un tek yolu o · bağlı ters bugün var (çocuk kapsamı, `reverseAllRollStockMoves` süzmez) · analoji olay düzeyinde tutmaz · üç satırsız çıkış + iki satırsız giriş | §5: olgu düzeltildi; şerhli `KARSI_OLAY`; K=0'a beş üye; `WO_DETACH` tutarsızlığı 82'ye |
| ④ initialQty | ayakta (④+② birlikte) | "(b) bump doğmaz" — FULL `restored`=Σ çocuk `initialQty` (`tambur-undo.service.ts:365/1741`) · üretim dalında çocuk stok satırı yok · "altı okuyucu" — ≥12, ikisi para (`invoice.service.ts:613-627`, `purchase-order.service.ts:252-259`), etiket `currentQty` okur (`label.service.ts:430`) · CHECK (BB 23514) | §6: para yüzeyi; (b) fallback; §10.6 yeni kalem |
| ⑤ beyan | ayakta (çok-ileri ters kod gerçek) | (i) zaten inmiş (`31844dbc`) · `CUT_DISCARD`/`SCRAP` bugün terslenmiyor — kümeye erken eklemek yalan yeşil (`test_defter_ters_yol.ts` §13'te ters yazıcı kolu yok) · §13d yalnız `BAGLI_TERS` · (ii) helper engeli yanlış, gerçek engel `reverseAllRollStockMoves` (küme veriye bağlı) | §7: sıra "önce kod", §13f, §13d `KARSI_OLAY` |

---

## §10 · 1e kararı bekleyen açık sorular

1. **Kapanış kimliği:** 5b ebeveynin **tüm canlı** `TAMBUR_WAREHOUSE_FINALIZE` sapmalarını damgalıyor; ①(b) aynı kümeyi izler. Kapanış kimliği (`RollVariance.sourceRefId` = kapanış izi) ayrı kalem mi?
2. **`sourceRefId` ön koşulu (②):** kesim anı `OVERAGE`'a `child.id` — kolon belge kimliği taşıyor (makbuz · sayım), top kimliği eklemek polimorfikleştirir; kabul mü, yoksa ayrı kolon mu (`childRollId`)?
3. **Satırsız stok↔üretim yolları (③):** üç çıkış (iş emri alanı) + iki giriş (`rescueStuckRoll` iş emri; `cutOpenFabric` çocuğu tambur alanı — üretim dalının defteri **hiç yok**, ②'den bağımsız kalem). K=0 üyeliği 6e. İniş öncesi fabrika kopyası ölçümü kimde?
4. **`CUT_SCRAP`:** gereksiz — `SCRAP`ın tek yazıcısı kapanış olduğundan beyan `BAGLI_TERS`e döner; `CUT_SCRAP` açılırsa `SCRAP` yazıcısız kalır (§13e).
5. **Scrap-kalan çocuğu (①b3):** SINGLE_RESTORE sapmayı da damgalasın mı, yoksa o çocuğa yalnız FULL mü sunulsun? İkincisi daha dar; istemcinin bugün ne gösterdiği ölçülmedi.
6. **Kabul-anı okuyucuları (④):** alış faturası / sipariş karşılama `initialQty`yi "değişmez" varsayıyor, `initialBump` bunu bugün de bozuyor. Kalıcı çözüm ②'den bağımsız: kabul anı metrajı kendi kolonunda (mal kabul satırı) ya da okuyucular `initialQty − Σ canlı TAMBUR OVERAGE`. Sahibi finans/mal kabul alanı. **⇒ formül ÇÜRÜDÜ (9b sondası 2026-09-13: gerçek fiş topu, altı durum, `initialQty − Σ canlı TAMBUR OVERAGE` dördünde yanlış — keşif kesimde, bump geri almada doğar) → §11 (B): kabul-anı metrajı depo defterinin ENTRY satırından okunur (`helpers/receipt-qty.helper.ts`, üç sonuç: defter · ufuk-öncesi yedek+uyarı · ufuk-sonrası 409).**
7. **Sıra önerisi:** ⑤ §13f + §13d (statik, kapı önce) → ① (b1+b2+b3, §13–§15/§18/§19) → `test_tambur_undo §11` çevrimi + `sourceRefId` → ④+② (a ya da b, §16–§17, 6e §12d) → ③ (üç yol + K=0 üyeleri + yeni bekçi) → §10.6 ayrı dilim.

---

## §11 · HÜKÜM (1e, 2026-09-13) — karar, gerekçe, iş dağılımı

Ölçüt tek: **ledger-first** — "ne oldu" değişmez, ters kayıt bugüne ve bağlı; aynı kararın iki defteri birlikte döner; keşif bir olgudur. Şıklar 1c'nin ölçümüyle seçildi, ölçülmeyen yerde dar olan tercih edildi.

| Kalem | Karar | Gerekçe (tek cümle) | Sahip |
|---|---|---|---|
| ① `CUT_DISCARD` + kapanış `SCRAP` | **(b1)+(b2)+(b3-DAR)**: FULL 5b damgasıyla bağlı satırlar terslenir; arşiv-SINGLE ile ölmüş çocukların grubu FULL'de terslenir (S9); **scrap-kalan çocuğuna SINGLE/SINGLE_RESTORE SUNULMAZ, yalnız FULL** (409, sebep metni) — §10.5 dar şık | sapma damgası ile depo etkisi tek kararın iki defteri; kapanışın kalanı bir kesim parçası değildir, ona parça geri alması vermek 60↔0'ı KALICI kılıyor (S10) | **6e** (kod + §13/§14/§15/§18/§19) · **ea** sürüm notu tek cümle (b3-dar davranış değişikliği) · istemci "iş emrine geri al" görünürlüğü ölçülür, tablet alanı |
| ② `OVERAGE` | **(a) KEŞİF TERMİNAL — keşif ebeveyne taşınır** (depo dalı taşıma satırı aynı bağla; üretim dalı sapma-yalnız; klasik finalize bugünkü davranış BEYANLA); bump sapması yalnız karşılanmayan kısım | ölçüm olgudur, kesimi geri almak kumaşı geri ölçmez; para okuyucularına sızıntı BUGÜN de var ve ②'den bağımsız kalemdir (§10.6) | **6e** (üç dal + §16/§17 + 6e §12d); `test_tambur_undo §11` ÖNCE çevrilir |
| §10.2 `sourceRefId` | **AYRI KOLON**: `RollVariance.sourceRollId` (nullable `@db.Uuid`, FK `Roll` Restrict, add-only migration); `sourceRefId` belge kimliği kalır, polimorfikleşmez | kolonun anlamı iddiadır; iki anlam tek kolonda okuyucuyu kör eder | **6e** (② ile aynı dilim; şema penceresi 1e'den) |
| ③ `DISPOSITION` | **(b)** beyan `KARSI_OLAY = PRODUCTION_ISSUE` + "çocuk kapsamında `TAMBUR_UNDO` ile bağlı da terslenir" şerhi; **üç satırsız çıkış yolu `PRODUCTION_ISSUE` yazar** (manuel taşıma · elle top · redye; `attachRolls` deseni) + yeni `test_stock_ledger_manual_move`; `BILINEN_KAPISIZ_YOLLAR` +5 (kapı kırmızıya DÖNER, borç görünür) | rafa giriş terminal olamaz; K=0 iddiası çürüdü (K ≥ 5, kör), borç görünür yer değiştirir | **1c** (üç yol + bekçi + iniş öncesi fabrika kopyasında "bu yollarla üretime alınmış raf topu" sayısı; >0 ise onarım yok, ufuk sonrası) · liste üyeleri **6e** onayıyla · `rescueStuckRoll` + `cutOpenFabric` çocuğu (giriş yönü, üretim dalının defteri) **AYRI KALEM**, 01 doff'tan sonra |
| ④ `initialQty` | ② ile birlikte: sapma satırı yalnız karşılanmayan kısım; `top-duzeltme.md:20` + `tambur.md:27` daralır, arşive "KISMİ → 2026-09-13"; `test_consistency` sonda kalemi `initialQty = giriş + Σ canlı OVERAGE(ebeveyn, TAMBUR_*)` | `edbd3ea0` tek başına 20 m aşımı 40 m yazıyor (S6) | **6e** |
| ⑤ beyan | **önce statik**: §13f (olay düzeyi `tersYazan`) + §13d `KARSI_OLAY` denetimi; `WO_DETACH` tutarsızlığı; **sonra kod indikçe**: `CUT_DISCARD`/`SCRAP`/`OVERAGE` → `BAGLI_TERS`, `DISPOSITION` → `KARSI_OLAY` | erken beyan yalan söyleyen yeşil | **82** |
| §10.1 kapanış kimliği | AYRI KALEM, ertelendi (5b bugün tüm canlı kapanış sapmalarını damgalıyor, ① aynı kümeyi izler — tutarlı) | bloklayan yok | — |
| §10.4 `CUT_SCRAP` | AÇILMAZ | `SCRAP`ın tek yazıcısı kapanış | — |
| §10.6 kabul-anı okuyucuları | AYRI KALEM: alış faturası taslağı + sipariş karşılama `initialQty − Σ canlı TAMBUR OVERAGE` okur (kolon açmadan) | sızıntı bugün var, ② seçiminden bağımsız | **9b** (finans), ekran diliminden sonra |

**Sıra (§10.7 aynen):** ⑤ statik (82) → ① (6e) → `§11` çevrimi + `sourceRollId` (6e, şema penceresi) → ②+④ (6e) → ③ (1c) → §10.6 (9b). Her § iki sondayla; tek fikstür yasak; sürüm notu yalnız ①(b3-dar).

## §12 · Doğrulama — §11 ③ giriş kalemi (`TAMBUR_CUT` · `RESCUE` · finalize kalanı) (2026-09-14, 47)

**Sonuç: giriş ikilisi + finalize kalanı DOĞRU bağlandı; K = 0 ölçüldü; FULL geri alma da tersliyor.** Kod: `7b6ee345` (giriş ikilisi) · `f4fdb2b1` (kapı fonksiyonları helper'a — K tarayıcısı sınıf metodunu görmüyordu) · `d33e019b` (finalize kalanı) · `c45ef626` (K_TABAN 2 → 0).

| ne | sonuç | nasıl |
|---|---|---|
| `cutOpenFabric` çocuğu TEK `PRODUCTION`/`TAMBUR_CUT` girişi, depo/WAREHOUSE, adım damgalı, ebeveyn satırsız | ✅ | `test_stock_ledger_production_entry` §1 (10/0) |
| SINGLE geri alma (adım-restore · kaynak-arşivde) `TAMBUR_UNDO` bağlı ters, net 0 | ✅ | §2/§3 |
| `rescueStuckRoll` `RESCUE` girişi claim'den SONRA taze; 0 metrajda satır yok | ✅ | §4/§5 |
| finalize KALANI aynı giriş; SINGLE tersler | ✅ | §7a/§7b |
| **FULL geri alma**: ebeveyn 100 → kesim 40 + 30 + kalan 30; üç çocuğun girişi bağlı terslendi, her çocuk 2 satır net 0, ebeveyn 100 IN_PRODUCTION | ✅ | sonda P3 (`_sonda_47_is3.ts`; bekçi FULL'ü ölçmüyordu — §7c olarak eklenmeli) |
| K tarayıcısı: `YENI_KAPI_HELPERLARI` + iki fonksiyon adı; §4e K=0, §4f taban 0 | ✅ | `test_stok_defteri_bag_olcumu` 33/0 |
| beyan: `TAMBUR_CUT` BAGLI_TERS → `TAMBUR_UNDO`; `RESCUE` KARSI_OLAY → `PRODUCTION_ISSUE`; `PRODUCTION_ISSUE.kod` üçlü; `TAMBUR_UNDO.ileri` altılı | ✅ | `test_defter_ters_yol` 185/0 |
| komşular | ✅ | `stock_ledger_tambur_undo` 65/0 · `stock_ledger_transform` 28/0 · `tambur_undo` 58/0 · `rescue_stuck` 10/0 · `raw_tambur_cut` 15/0 · `consistency_derived` 25/0 · `stock_ledger_manual_move` 16/0 |

Bağımsız defter okuyucusu ÖLÇÜLEMEDİ (oturum limiti); bu bölüm 47'nin bekçi koşumu + sondası + statik okumasıdır. Statik okumada açık kalan: `finalizeOpenFabric` yolu K tarayıcısının yol listesinde görünmüyor (tipli `rollData`) — çağrı silinirse yalnız `production_entry §7` kırmızı verir; FULL modu bekçiye §7c olarak eklenmeli (sonda P3 deseni).
