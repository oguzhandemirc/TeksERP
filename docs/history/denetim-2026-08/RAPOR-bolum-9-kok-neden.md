# Bölüm 9 — KÖK NEDEN ANALİZİ

**Kaynak:** `audit/findings.json` (243 ayakta bulgu, 24 elenen; üretildi 2026-08-29) · `audit/_rapor-tablolari.md` · `audit/00-map/MATRIX.md §ÇAPRAZ OKUMA` · `audit/00-map/KRITIK-YAZMA-YOLLARI.md` · `audit/00-map/KUNYE.md` · `audit/00-map/ERISILEMEYEN.md` · `audit/03-verify/_hasat.json` · `audit/tours/tur1..tur4.json`
**Kapsam:** Teks-Erp backend (tümü) + ona bağlı mobil/Electron sözleşmeleri. Salt-okunur denetim; kaynak koda dokunulmadı.

---

## 9.0 — Tek cümlelik sonuç

**243 bulgu değil; 10 kök neden ve 243 belirti.**

| Ölçü | Değer | Kaynak |
|---|---:|---|
| Ayakta bulgu | 243 | `findings.json.bulgular` |
| Çürütmede elenen | 24 | `findings.json.elenenler` |
| Şiddet | S1 13 · S2 53 · S3 120 · S4 57 | mekanik sayım |
| Kanıt | K3 26 (repro ile tetiklendi) · K2 92 (veride ölçüldü) · K1 124 · K0 1 | mekanik sayım |
| **Saha kopyasında (`tekserp_saha_0825`) ihlali ÖLÇÜLEN bulgu** | **91** | `veride_ihlal.saha > 0` |
| Dev DB'de ihlali ölçülen | 31 | `veride_ihlal.dev > 0` |
| Tur dağılımı | T1 145 · T2 40 · T3 32 · T4 26 | `findings.json` |
| ≥2 bağımsız bulucudan birleşen bulgu | 55 | `merged_from` |
| Çürütmeden şiddeti düşerek çıkan | 111 (kalan 132 olduğu gibi ayakta) | `curutme.sonuc` |
| Toplam düzeltme eforu | 190,65 gün (P0+P1: 64,25 gün) | `efor_gun` |

---

## 9.1 — Kümeleme yöntemi (sayılar nasıl çıktı)

1. 243 bulgunun tamamı okundu; her bulgu **tek bir birincil kümeye** atandı (çift sayım yok — toplam tam olarak 243).
2. Atama tabanı `findings.json.kategori` alanıdır (A.* eşzamanlılık · B.* idempotency/tekillik · C referans bütünlüğü · D tx sınırı · E iş kuralı · F giriş doğrulama · G yetki · H performans · I gözlemlenebilirlik · J ops/deploy · K bekçi · L tutarlılık/ölü kod). Kategorinin mekanizmayı yanlış anlattığı **108 bulguda** elle birincil küme verildi (ör. `BULGU-T2-001` kategori `E` ama mekanizma "defter yazımı yan etki" → KN-2).
3. "Çapraz desenler" bölümündeki sayılar **ikincil** ölçümdür: bulgu metninin (başlık + çakışma senaryosu + failure_mode + kanıt notları + etkilenen değişmez) düzenli ifadeyle taranmasıyla üretildi; **bir bulgu birden çok desende görünebilir**. Her desende bulgu id listesi verilmiştir, tahmin yok.
4. Fabrika etkisi cümlelerinin arkasında ya bir `veride_ihlal` sayısı ya bir repro logu (`audit/repro/*.log`) vardır.

---

## 9.2 — KÖK NEDEN KÜMELERİ (özet tablo)

| # | Küme adı (kusuru söyleyen cümle) | Bulgu | S1 | S2 | Sahada ölçülen ihlal | Tek müdahale |
|---|---|---:|---:|---:|---:|---|
| **KN-1** | Kapı ile yazım arasında bir pencere var: karar transaction dışında okunuyor, atomik claim yazdığı kararı pinlemiyor | 37 | 3 | 10 | 5 | Yazma yolu iskeleti (kilit→tekrar oku→pinli claim→409) |
| **KN-2** | Sipariş defteri sevk yolunun yan etkisi; kendi kapısı, kilidi ve bekçisi yok | 15 | 3 | 5 | 8 | Tahsis yazımını sevkten ayrı, fail-closed bir kapıya almak |
| **KN-3** | İdempotency ortak katman değil, uç başına yeniden icat edilen refleks — beş durumun ancak ikisi kodlanmış | 12 | 2 | 6 | 3 | Tek `withIdempotency(key, bodyHash)` sarmalayıcısı |
| **KN-4** | Ölçüm ve iz ikinci sınıf iş: sistem ne arızasını ne maliyetini kendi görüyor; yazan var, okuyan yok | 46 | 1 | 6 | 22 | İz/ölçümü ürün parçası yapmak: her sinyale bir tüketici + hüküm |
| **KN-5** | Değişmez yalnız uygulama katmanında; merkezî durum makinesi ve DB seddi yok | 16 | 1 | 3 | 13 | Merkezî `RollStatus` geçiş tablosu + eksik DB kısıt paketi |
| **KN-6** | Aynı iş büyüklüğünün ikinci tanımı: rapor/belge yüzeyi operasyon yolundan ayrı hesaplıyor | 22 | 0 | 1 | 13 | "Rapor tabanı sözlüğü" — her büyüklük tek fonksiyondan |
| **KN-7** | Bekçi kusurla aynı yerde kör ve sahaya çıkan dalda hiç koşmuyor | 21 | 0 | 6 | 5 | CI'yı `adnansahin` dalına bağlamak + yol×sonda kapsam matrisi |
| **KN-8** | İşletme katmanı (kurulum, yedek, migration) kural olarak yazılı, mekanizma olarak yok | 20 | 1 | 5 | 6 | Kurulumun ayarı EZMEMESİ + yedek yaşının bir hükme bağlanması |
| **KN-9** | Yetki kataloğu koda taşındı, atama ve sınır insana kaldı; "sınır" sanılan üç kapı sınır değil | 21 | 1 | 4 | 10 | Politikayı tek doğrulanmış ayar setinden okumak + SoD'yi atamada zorlamak |
| **KN-10** | Sözleşme uç başına yazılıyor: aynı alanın dört sınırı, aynı kararın istemcide kalması | 33 | 1 | 7 | 6 | Alan sözlüğü (tek Zod kaynağı) + "başarı = sunucunun 2xx'i" kuralı |
| | **Toplam** | **243** | **13** | **53** | **91** | |

---

## KN-1 — "Kapı ile yazım arasında bir pencere var"

> Karar (guard) transaction'ın **dışında** okunuyor, yazım transaction'ın **içinde** yapılıyor; aradaki pencerede kararın dayandığı satır değişebiliyor. Atomik claim var ama `WHERE`'i, kararın dayandığı alanları **pinlemiyor**.

### (b) Bulgular — 37

| Şiddet | Bulgular |
|---|---|
| **S1** | T1-001 (mutlak metraj yazımı kesimi eziyor, repro 10/10) · T1-009 (WO iptali fason sevkini kapatamazsa mal ham stoğa düşer) · T3-004 (tambur-undo WO satırını kilitlemiyor → canlı toplu WO COMPLETED) |
| **S2** | T1-002 · T1-003 · T1-004 · T1-085 · T2-008 · T3-007 · T3-011 · T3-012 · T3-015 · T3-016 |
| **S3** | T1-025 · T1-026 · T1-027 · T1-028 · T1-029 · T1-030 · T1-063 · T1-083 · T1-084 · T1-086 · T1-092 · T1-148 · T3-023 · T3-025 · T3-029 · T3-032 · T4-020 |
| **S4** | T1-091 · T1-102 · T1-104 · T1-151 · T1-154 · T4-022 · T4-026 |

Kanıt yoğunluğu: 10'u **K3** (dev DB'de eşzamanlı repro ile tetiklendi — `audit/repro/D-A-01.log`, `KYY-2-32.log`, `D-A-02.log`, `D-B-01.log`).

### (c) MEKANİZMA — neden bu kadar çok yerde tekrar etti

Doğru desen **repoda var, belgeli ve ölçülmüş** — ama ortak katman değil, üç ayrı yerde elle yazılmış:

- `Teks-Erp/src/services/helpers/shipment-locks.helper.ts:44-54` — kilidin korunan okumadan ÖNCE alınması, **üretilmiş bir vakayla** (2026-08-09, 1200 ms) gerekçelendirilmiş.
- `Teks-Erp/src/services/helpers/workorder-locks.helper.ts:50-58` — on bir fason yazma yolu bu disipline uyuyor.
- `Teks-Erp/src/services/shipping.service.ts:1826-1848` — pre-tx kontrol + **kilit altında tekrar** (assertion, filtre değil).

Kural bir **helper imzası** değil, bir **kültür notu** olarak yaşadığı için her yeni yazma yolu onu yeniden keşfetmek zorunda kaldı. `MATRIX.md §D` bu boşluğun envanterini çıkarıyor: **30 kilit/claim boşluğu**, hepsi aynı üç alt-kalıptan biri —
① kapı havuz client'ıyla okunuyor (`computeWorkOrderLocks(prisma)` `workorder.service.ts:5627`, `assertTargetColorChange(prisma)` `:4697`),
② claim `WHERE`'i kararı pinlemiyor (`inventory.service.ts:3932-3936` — `status` ve `currentQty` yok),
③ kilit doğru ama **sırası** ters (ABBA-1..5, `MATRIX.md §D` #2/#3/#12/#19/#30).

İkinci bir çarpan: `Roll` üzerine **21 dosyadan / 57 siteden** statü yazılıyor (`MATRIX.md §B`). Yazma yolu sayısı arttıkça "her yeni yol kendi kapısını kendi kurar" maliyeti doğrusal değil, çarpımsal büyüdü.

Üçüncüsü ve en zararlısı: **guard'ın ön kabulü kendi kod tabanı tarafından yıkılmış.** `applyManualProperties` `rollWhole = initialQty.equals(currentQty)` diye "bu top hiç kesilmemiş" sanıyor (`inventory.service.ts:3783`), ama depo kesimi ikisini birden düşürüyor (`tambur.service.ts:2218-2246`) — yani guard tx'in içine taşınsa **bile** kör kalırdı (T1-001 + T1-012 aynı satırın iki yüzü).

### (d) Fabrikadaki etkisi

100 m'lik fiziksel top sistemde **140,5 m** görünüyor (T1-001, `audit/repro/D-A-01.log` FAZ1 deterministik, FAZ2 paralel 10/10). İki eşzamanlı Tambur kesimi 100 m'lik toptan **240 m çocuk** üretiyor (T1-002; sahada 37 aşım satırı). Depo operatörü ile süpervizör aynı dakikada aynı topa dokunduğunda kimse hata görmüyor: stok kalıcı olarak şişiyor, eksiklik ancak **sevkiyatta "çuvala koyacak mal yok"** diye ortaya çıkıyor. Fason tarafında ise mal fiziksel olarak dışarıdayken iş emri kapanıyor (T3-004, T1-009) — refakat kartı VOID, top "canlı ama kimsenin okutamadığı" çıkmazda.

### (e) Kümeyi kapatan TEK müdahale

**Para/stok etkili her yazma yolunu tek bir iskeletten geçirmek** (`writeGuardedTx`): ① advisory/satır kilidi tx'in İLK ifadesi · ② kapı kilit altında **yeniden okunur** (pre-tx okuma yalnız erken-401/404 içindir) · ③ `updateMany` claim'inin `WHERE`'i **kararın dayandığı her alanı** pinler (`status`, `currentQty`, `initialQty`, `version`) · ④ `count === 0` → 409 `STALE_STATE`. Üç referans uygulaması hazır (yukarıdaki helper'lar); yapılacak iş yeni desen icat etmek değil, **var olanı zorunlu kapı hâline getirmek**.

Ön koşul: `initialQty` semantiğinin onarılması (T1-012/T2-016) — aksi hâlde iskelet doğru kurulsa bile `rollWhole` guard'ı yanlış cevap vermeye devam eder.

### (f) Kalıcı bekçi

1. **AST bekçisi:** bir fonksiyonda tx dışında okunan alan, aynı fonksiyonun tx-içi `updateMany` claim'inin `WHERE`'inde yoksa → kırmızı. (`test_claim_pins_decision.ts`)
2. **Paralel sonda kapsam matrisi:** `MATRIX.md §C`'deki "eşzamanlılık bekçisi YOK — para/stok etkili" listesinin (6 yol) her satırı için **N ≥ 5, gecikme enjeksiyonlu** sonda. Bugün 33 sondanın 24'ü N=2 ve hiçbirinde gecikme enjeksiyonu yok (T1-139) — dar pencerede yeşil kalabiliyorlar.
3. Her sonda **negatif sonda ile** kırmızı verdiği kanıtlanmadan bekçi sayılmaz (repo kültürü; `_hasat.json`: 26 düzeltmenin 24'ü bu şekilde kanıtlanmış).

---

## KN-2 — "Sipariş defteri sevk yolunun yan etkisi; kendi kapısı yok"

> `SackAllocation` / `OrderLine.shippedQty` bir **defter** olarak tasarlanmış (doğru karar), ama o deftere yazan tek yol sevkiyatın içindeki bir yan etkidir: koşul tutmazsa yazılmaz, yazılmadığı hiçbir yerde görünmez, sonradan düzeltilemez.

### (b) Bulgular — 15

| Şiddet | Bulgular |
|---|---|
| **S1** | T2-001 (7.200,6 m hiçbir sipariş satırına yazılmadı; 5 sevkiyat tamamen defter dışı, 7 kalem hâlâ "0 sevk" — **saha 81**) · T3-002 (tabletten kurulan HER sevkiyat defter yazmadan çıkıyor) · T3-003 (iptal edilmiş talebe mal yazılıyor) |
| **S2** | T1-010 (kalan kapasite hiçbir yerde zorlanmıyor) · T1-036 (saha 19) · T2-003 (deftere hiç audit yok) · T2-005 (saha 2 sipariş kilitli) · T3-009 |
| **S3** | T1-079 (saha 12) · T1-100 (saha 3) · T2-019 (saha 4) · T2-023 (saha 261 m) |
| **S4** | T1-143 · T1-167 (saha 2) · T3-026 |

### (c) MEKANİZMA

`allocation.helper.ts:36-114` tahsisi **`specMatch`** (kumaş+renk+en) üzerinden kuruyor. Eşleşme tutmazsa satır yazılmıyor — ve **bu bir hata değil, sessiz bir "0 satır"**. Üstüne üç çarpan bindi:

1. **Deftere audit yazılmıyor** (T2-003, `shipping.service.ts:1345-1352`) → "bu mal neden siparişten düşmedi" sorusu geriye izlenemez.
2. **Mutabakat kapısının kör noktası kusurla aynı yerde** (T2-004, `consistency-check.sql:27-56`): §1/§2 denormu **deftere karşı** ölçüyor; defterin kendisi eksikse tanım gereği yeşil kalıyor. Bu, 2026-08-22'de `§13` için öğrenilen dersin (`docs/history` — "bekçinin kör noktası hatanın kendisiyle aynı yerdeydi") birebir tekrarı.
3. **Tek yazıcı yok, tek okuyucu var.** `order-status.helper.ts:44-81` `shippedQty`'yi hiç increment etmiyor, her seferinde defterden yeniden hesaplıyor — bu **doğru** tasarım (sahada 0/281 satırda sürüklenme). Ama doğru olan tarafın kusursuzluğu, yanlış tarafın (defterin kendisinin) eksikliğini gizliyor: rakam tutarlı, sadece **eksik**.

### (d) Fabrikadaki etkisi

Mal fiziksel olarak müşteriye gitti; sipariş ekranı hâlâ "0 sevk" diyor. Planlamacı aynı kalem için **ikinci kez** iş emri açıyor ya da sevkiyat kuruyor — ve `Σ sevk ≤ OrderLine.quantity` **hiçbir yerde zorlanmadığı** için (T1-010; `MATRIX.md §A` "OrderLine · **HİÇBİR YERDE**") sistem ikinci sevki de kabul ediyor. Tabletten kurulan sevkiyatlarda bu istisna değil **kural** (T3-002). Sahada ölçülen: **7.200,6 m defter dışı, 5 sevkiyat, 7 kalem** (T2-001, saha 81 satır).

### (e) Kümeyi kapatan TEK müdahale

**Tahsisi sevkin yan etkisi olmaktan çıkarıp kendi kapısı olan bir yazma yolu yapmak:**
`performDispatchTx` içinde (aynı tx, `shipping.service.ts:1806-1882` — bu tx zaten doğru kurulmuş) tahsis ① aktif kalem kontrolünden (`helpers/order-line-scope.helper.ts`) ② kalan kapasite kontrolünden geçer, ③ audit yazar, ④ **`specMatch` tutmayan içerik fail-closed'dır**: ya sevkiyat reddedilir ya da içerik açıkça `siparişsiz sevk` olarak işaretlenir. "Sessizce tahsissiz sevk" seçeneği kaldırılır.

### (f) Kalıcı bekçi

`consistency-check.sql`'e **tersine çevrilmiş** bir bölüm: defteri deftere değil, **MALA** karşı ölç — `Σ (DISPATCHED top metrajı, spec bazında)` ↔ `Σ SackAllocation.qty`; fark > 0 → kırmızı. Bugünkü §1/§2'nin göremediği tam olarak budur (T2-004). Ayrıca `Σ shippedQty ≤ Σ quantity` için ayrı bölüm (T1-010 bugün 0 ihlal veriyor, ama koruma değil **şans**).

---

## KN-3 — "İdempotency ortak katman değil, uç başına refleks"

> `clientToken` sözleşmesi CLAUDE.md'de yazılı (2026-07-14 + 2026-08-03), doğru uygulandığı yerler var — ama **beş durumun** (yok / uçuşta / tamamlandı-aynı gövde / tamamlandı-**farklı gövde** / kayıt **iptal edilmiş**) hangisinin kodlandığı uçtan uca değişiyor.

### (b) Bulgular — 12

| Şiddet | Bulgular |
|---|---|
| **S1** | T1-005 (fason kısmi kabulde replay yerine "Barkod üretimi 5 denemede başarısız" 409'u; aynı teslimat iki kez düşülüyor) · T1-008 (içe aktarımın replay anahtarı EN SONDA yazılıyor → 15 sn timeout sonrası dosyanın tamamı ikinci kez; dev 297) |
| **S2** | T1-006 (iptal edilmiş kaydın token'ı `success:true` dönüyor — **saha 227**) · T2-007 (fason kabulde token her gönderimde yeniden üretiliyor → koruma fiilen kapalı) · T3-006 · T3-010 · T3-013 (finalize'ın idempotency'si KİMLİK taşımıyor) · T4-003 |
| **S3** | T1-088 · T1-089 · T1-146 (yorum mekanizmanın TERSİNİ anlatıyor) · T3-028 |

### (c) MEKANİZMA

`MATRIX.md §C` "İdempotency 4. durum" satırı bunu envanterle söylüyor: **Order / WorkOrder / Sack / Shipment / SubcontractorReceipt / ImportRun** — hepsinde "iptal edilmiş kaydın token replay'i" dalı yok; yalnız `Roll` manuel top yolunda ölçülü. Sebep, kuralın **bir fonksiyonda değil bir kültür notunda** yaşaması: her uç kendi `findFirst({clientToken})` + `if (existing) return existing` satırını yazdı ve herkes **aynı iki durumu** (yok / var) kodladı; diğer üçü uç sahibinin o gün aklına gelip gelmemesine kaldı.

`T4-003` bunu mekanik olarak ölçüyor: "aynı token, FARKLI gövde" kuralı **yalnız 4 uçta** var. `T1-146` ise sınıfın en açık işareti: `finalizeWarehouseCut`'ın yorumu, fonksiyonun idempotency mekanizmasının **tersini** anlatıyor (kardeş fonksiyondan kopyalanmış) — yani kural kopyalanırken **anlamı değil metni** taşındı.

### (d) Fabrikadaki etkisi

Operatör tuşa iki kez bastığında ne olacağı, hangi ekranda olduğuna göre değişiyor. Fasonda: 100 m gitti, 51 m geldi diye kaydedilen bir teslimat **iki kez** düşülüyor (T1-005). İçe aktarımda: 15 sn'de dönmeyen bir dosyada "Tekrar Dene" **tüm dosyayı yeniden yazıyor** (T1-008; sipariş adaptörü create-only). KK1'de: iptal edilmiş 227 topun token'ı hâlâ `success:true` döndürebiliyor (T1-006) — operatör "kaydettim" diyor, ortada canlı kayıt yok. Tambur'da: başka bir yolun kapattığı topta finalize `success:true` diyor ve **operatörün kesim/kalite kararları sessizce kayboluyor**, tablet yabancı çocuklara etiket basıyor (T3-013).

### (e) Kümeyi kapatan TEK müdahale

Tek bir `withIdempotency(scope, clientToken, bodyHash, fn)` sarmalayıcısı; **beş durumu tek yerde** kodlar ve anahtarı **işin BAŞINDA** yazar (T1-008'in kök nedeni, anahtarın sona yazılmasıdır). Farklı gövde → 409 `CLIENT_TOKEN_COLLISION`; iptal edilmiş kayıt → 409 `ENTRY_CANCELLED` (bu kod repoda zaten var, sadece üç uçta uygulanmış).

### (f) Kalıcı bekçi

`K1a/K1b` rota envanterinden türetilen **kapsam bekçisi**: `clientToken` kabul eden her uç için beş durumun beşi de **HTTP üzerinden** sondalanır (servisi doğrudan çağıran sonda bu sınıfı göremez — bkz. T1-075). Envanterde olup sondası olmayan uç → kırmızı.

---

## KN-4 — "Ölçüm ve iz ikinci sınıf iş: yazan var, okuyan yok"

> En kalabalık küme (46 bulgu, 243'ün %19'u) ve **sahada en çok ölçülen** küme (22 bulguda ihlal ölçüldü). İki lobu var ama mekanizması tek: bir sinyal üretiliyor, hiçbir yerde bir **hükme** ya da bir **ekrana** bağlanmıyor.

### (b) Bulgular — 46

| Alt-lob | Bulgular |
|---|---|
| **4a — İz / sessiz arıza** (29) | **S1** T1-024 (gece yedeğinin başarısızlığını gören mekanizma yok; bayatlık sayacı deploy yedeğiyle sıfırlanıyor, saha 8) · **S2** T1-049 · T1-060 (alarmlar PULL: yalnız Sunucu Durumu sayfası açıkken; ölçülen teşhis süresi **31,5 saat**) · T2-011 · T2-014 (**40 günde 175.242 istek, 15 hata satırı, tek bir 409 izi yok**) · T2-015 · T3-022 · **S3** T1-033 (`CANCELLED` yazan ALTI yol iptal izini yazmıyor — **134/230**) · T1-034 · T1-048 · T1-059 · T1-062 (**saha 2.557**) · T1-103 (saha 55) · T1-126 · T1-127 (saha 36) · T1-128 (saha 229) · T1-130 · T2-029 (top statü değişimlerinin **%22'si** kayıt-düzeyi audit bırakmıyor, saha 535) · T4-006 · T4-015 · T4-018 · T4-019 · **S4** T1-119 · T1-131 · T1-132 · T1-164 · T1-165 · T2-026 (saha 115) · T2-038 (**213 kartın 149'u "bayat", bayrağı okuyan yüzey yok**) · T3-024 · T3-033 |
| **4b — Maliyet / kapasite ölçümü** (17) | T1-056 (GET /api/rolls her gün 5-10 sn kuyruk, **2.431 satırlık tabloda**; telemetri nedenini söyleyemiyor) · T1-057 (güncellemelerin **%99,4'ü HOT değil**) · T1-058 · T1-093 · T1-120 · T1-121 · T1-122 · T1-123 (projenin kendi teşhis aracı bozuk) · T1-124 · T1-125 · T1-159 (85 FK kolonu indekssiz) · T1-160 (`pg_stat_statements` yok → "hangi indeks işe yaramıyor" **bugün cevaplanamaz**) · T1-161 · T1-162 · T1-163 · T4-005 · T3-022 |

### (c) MEKANİZMA

Üç ayrı alışkanlık aynı sonuca çıkıyor:

1. **"Best-effort" bir tasarım kararıydı, bir kapı değil.** `AuditService` bilinçli olarak tx dışında ve yutucu (`audit.service.ts:39-56` sayacı var — doğru karar). Ama yutmanın **tüketicisi** kurulmadı: `/api/admin/health`'e "görünsün diye" eklenen altı sessiz-arıza dedektörünü (`auditGuard`, `restoreCopyCount`, `discovery.mdns`, `rollsDeadPct`, `longestQuerySec`, `lastAuditError`) **hiçbir istemci çizmiyor** (T1-059, `app.ts:338-466`).
2. **Kolon eklemek iş sayılıyor, tüketici eklemek sayılmıyor.** `TravelerCard.contentDirty`: ~20 yazma noktası, **sıfır** tüketici (T1-164) — ve iki backend yorumu hâlâ "istemci rozeti bu alandan basar" diyor. `labelDirty`/`labelPrintedAt` de aynı: fiziksel etiket basıldıktan sonraki kayıt yolu ateşle-unut (T1-062, `mobil/src/components/LabelPrinter.tsx:247-249`; saha 2.557).
3. **Ölçüm aracının kendisi ölçülmemiş.** `index-health.sql`'in 10 bölümünün 6'sı koşmuyor ve §9 salt-okunur bir teşhis script'i içinde `CREATE EXTENSION` çalıştırıyor (T1-123). Yavaş-istek defteri **sebebi taşımıyor ve restart'ta siliniyor** (T1-125) — yani sistemin ölçülmüş tek performans anomalisi (T1-056) kendi telemetrisiyle teşhis edilemiyor.

### (d) Fabrikadaki etkisi

Fabrika bir arızayı **ancak fiziksel dünyada** fark ediyor. Gece yedeği düşerse kimse bilmiyor (T1-024) — ve makine dışı kopya da yok (T1-022), yani bu, ERP'nin tamamen kaybedilebileceği tek senaryodur. 40 gün boyunca sisteme 175.242 istek geldi; **kaç tanesinin iş kuralıyla reddedildiğini kimse bilmiyor** (T2-014) — yani "operatörler neyi yapamıyor" sorusunun ölçülmüş cevabı yok. 134 topun neden iptal edildiği artık öğrenilemez (T1-033). "Bu topa ne oldu" sorusu 2.431 topun %22'sinde Denetim Raporu'ndan cevaplanamıyor (T2-029). Refakat kartı sahada karşılıksız: 213 kartın 149'u bayat işaretli, kart hiç okutulmuyor (T2-038) — üretilmiş bir mekanizma, sıfır getiri.

### (e) Kümeyi kapatan TEK müdahale

**Sinyal → hüküm → yüzey zincirini zorunlu kılmak.** Somut: `/api/admin/health`'in `status` alanı sabit `'UP'` olmaktan çıkar (T4-018) ve mevcut altı dedektör + yedek yaşı + 4xx/409 sayaçları bir **hükme** bağlanır (`UP | DEGRADED | DOWN`); panel bu tek alanı çizer. Bu tek değişiklik T1-024, T1-059, T1-060, T4-017, T4-018, T4-019, T2-014'ü aynı anda tüketiciye kavuşturur — çünkü **sinyaller zaten üretiliyor**, eksik olan yalnız hüküm ve alıcı.

### (f) Kalıcı bekçi

1. **"Yazan var, tüketen yok" AST bekçisi:** yeni bir durum bayrağı / sayaç / `/health` alanı eklenirken en az bir okuyucusu (Electron sayfası ya da başka bir servis) olmalı; yoksa kırmızı. Bugün bu sınıfta üç ölçülmüş vaka var: T1-164, T2-038, T1-059.
2. **Yedek bekçisi:** "en taze `nightly` yedek > 26 saat" → `/health DEGRADED` + panel bandı; ve **deploy yedeği bayatlık sayacını sıfırlamaz** (T1-024'ün ikinci yarısı).
3. `pg_stat_statements` kurulumu + `index-health.sql` onarımı ölçüm ön koşuludur (T1-160, T1-123) — onlar olmadan 4b'nin hiçbir bulgusu "düzeldi" diye kapatılamaz.

---

## KN-5 — "Değişmez yalnız uygulama katmanında"

> `MATRIX.md §A` bu kümenin envanteridir: kodda zorlanan ama DB'de karşılığı olmayan **24 değişmez**. Kod düzeltilir, aynı sınıftan ikinci ihlal başka bir yoldan geri gelir.

### (b) Bulgular — 16

| Şiddet | Bulgular |
|---|---|
| **S1** | T1-011 (Tambur geri almasıyla iptal edilen kesim çocuğu "İptali Geri Al" ile diriltilebiliyor — metraj ikinci kez canlanıyor; **saha 50**) |
| **S2** | T1-007 (ad-mükerrer guard'ı kilitsiz check-then-act; DB seddi 17 tablonun 3'ünde ve `items`'te sahada YOK) · T1-039 · T2-010 (saha 3) |
| **S3** | T1-035 (saha 9) · T1-041 · T1-042 (fire topu üretime geri çekiliyor) · T1-044 · T1-087 (saha 63) · T2-009 · T2-016 · T2-025 · T2-028 (saha 8 kod çakışma grubu) |
| **S4** | T1-099 (Roll statü matrisi **hiçbir yerde merkezî değil**: 21 ayrı liste, hepsi fail-open) · T1-150 · T2-027 (saha 61 numara) |

### (c) MEKANİZMA

**T1-044 bu kümenin kanıtıdır ve tek başına mekanizmayı anlatır:** `currentQty ≤ initialQty` için DB CHECK'i yok; kod hatası 2026-08-22'de kapatıldı, **ikinci ihlal düzeltmeden 5 gün SONRA doğdu ve 13 gün fark edilmedi** — üstelik kod yorumu hâlâ "DB'deki TEK böyle satır" diyor. Yani: kod düzeltmesi bir noktayı kapatır, DB seddi **sınıfı** kapatır; sed olmadığında düzeltmenin ömrü, bir sonraki yeni yazma yoluna kadardır.

İkinci sürücü, **merkezî durum makinesinin olmaması** (T1-099): `Roll.status` için 21 ayrı statü listesi (`CANCELABLE_ROLL_STATUSES`, `MOVABLE_STATUSES`, `K18_DEAD`, `SACK_ABSENT`, …) + trigger'ın kendi listesi var; hepsi **fail-open**. Yeni bir statü ya da yeni bir geçiş eklendiğinde 21 listeden kaçının güncelleneceği kimsenin ödevinde değil — repo tarihinde bu sınıfın adı zaten var: *"altıncı enum değeri unutuldu"* (kök CLAUDE.md 2026-08-26, üç ayrı vaka). T1-042 (fire topu `reopenStep` ile üretime dönüyor) ve T1-011 (iptal edilmiş kesim çocuğu diriltiliyor) bu boşluğun iki ucu.

Üçüncüsü, seddin **ortama göre var/yok** olması (T2-009): sahada `items` seddi yok, dev'de `colors` seddi yok — çünkü 28. migration bilinçli olarak **yumuşak kapıya** çevrildi (mükerrer varsa index'i atla, `NOTICE`). Doğru bir deploy kararıydı; ama "enforce adımının sahibi, tarihi ve tetikleyicisi" hiç yazılmadı (T1-066) ve tek sinyal **kalıcı kırmızı bir bekçi** oldu — yani kırmızı körlüğü üretti.

### (d) Fabrikadaki etkisi

50 topta iptal-geri-alma metrajı ebeveyne **ikinci kez** iade edebilecek durumda (T1-011). 8 stok kodu çakışma grubundan biri **iki tarafı da AKTİF ve gerçek stok taşıyor** (T2-028) — yani aynı ürün iki karta bölünmüş, sipariş karşılama iki ayrı havuz görüyor. 1.500 m açık siparişin kumaşı pasife alınmış, 200 m canlı stok pasif kumaşa bağlı (T2-010). 156 canlı partinin 122'si aynı plaka numarasını paylaşıyor (T2-027) — bu **bilinçli** bir karar (dönen `P01..P99`), ama "`batchNumber` ile lookup/sıralama yapma" kuralının mekanik bekçisi yok (T1-150), yani kararın bedeli her yeni ekranda yeniden ödenme riski taşıyor.

### (e) Kümeyi kapatan TEK müdahale

İki parçalı ama tek iş: ① **Merkezî `RollStateMachine`** — izinli kenarlar tek tabloda, tüm statü yazımları o tablodan geçer (bugün 57 site doğrudan yazıyor); ② **eksik sed paketi** (`[PROD'DA ÇALIŞTIRMA]`): `nameFold`/`code` partial unique'lerin enforce edilmesi, `mergedIntoId` `SET NULL` → `RESTRICT` (T1-035), ve `currentQty ≤ initialQty` için — CHECK konamıyorsa (aşım meşru) **en azından bir mutabakat bölümü + sahibi olan bir enforce tarihi**.

### (f) Kalıcı bekçi

`test_db_invariants`'ın **beyan ↔ canlı şema** karşılaştırmasının prod'a karşı da koşabilmesi (bugün yalnız dev'e karşı koşuyor; T2-009 tam bu yüzden iki yönde birden kaçtı). Ayrıca statü matrisi için AST bekçisi: `Roll.status` yazan her site ya merkezî makineden geçer ya gerekçeli muafiyet listesindedir.

---

## KN-6 — "Aynı iş büyüklüğünün ikinci tanımı"

> "Üretilen metraj", "fire", "sevk edilen", "açık talep", "basım tarihi", "fabrika günü" — her biri en az iki yerde, birbirinden bağımsız tanımlanmış. Operasyon ekranı ile rapor aynı gerçeği farklı sayıyla anlatıyor.

### (b) Bulgular — 22

| Şiddet | Bulgular |
|---|---|
| **S2** | T1-012 (depo kesimi `initialQty`'yi de düşürüyor → iş emrinin üretilen metrajı **geriye dönük azalıyor**, IE1408260004: −76,7 m) |
| **S3** | T1-032 (finalizedAt trigger'ı Fire ucunu kapsamıyor) · T1-098 · T2-017 (damgasız 4 final top / 359 m hiçbir dönemin karnesinde yok) · T2-018 (**kapanmış dönem geriye dönük değişiyor**: Temmuz karnesi Ağustos'ta 698 m düştü) · T2-020 (saha 15) · T2-021 · T2-022 (7 "donmuş" belgenin 6'sı sonradan kurulmuş) · T2-024 (saha 42) · T2-034 (**2.431 topun 955'inde damga doğuştan ÖNCE**) · T3-008 · T3-027 · T3-031 · T4-002 · T4-008 · T4-010 · T4-011 · T4-012 |
| **S4** | T1-096 · T1-153 (39 çuvalın 16'sı ayrışıyor) · T2-035 · T2-037 |

### (c) MEKANİZMA

Repo bu sınıfı **biliyor** ve doğru kararı yazmış: *"Dönemde sevk edilen metraj TEK tanım — `reports/_shipped.ts`"* (kök CLAUDE.md 2026-08-09). Tek kaynak kuralı bir büyüklük için uygulandı, **diğerleri için uygulanmadı**. Sonuç:

- "Üretim çıktısı" **iki ayrı statü listesiyle** tanımlı → iptal edilen Tambur çocuğunun metrajı sonsuza dek "üretimde" sayılıyor (T1-080, saha **1.506,9 m**).
- "Fire" **iki farklı kriterle** sayılıyor: Fire Karnesi statüye, Kalite Karnesi kalite koduna bakıyor → aynı ay iki farklı fire rakamı (T1-082, saha 61,4 m).
- Zaman ekseninde **iki saat kaynağı** var: `createdAt`/`updatedAt` uygulamadan, `finalizedAt`/`statusChangedAt` DB'nin `now()`'ından (tx BAŞLANGICI) → 955 topta damga doğuştan önce (T2-034). Gün sınırı tek kaynağa taşınmış (`constants/time.ts` — `_hasat.json` bunu "karar belgesi" olarak övüyor, 183/183 kolon uyumlu) ama **gösterim/belge-no tarafındaki 15 nokta** hâlâ süreç saat diliminde (T4-012).
- "Donmuş belge" sözleşmesi de ikiye ayrılmış: fason kabul makbuzları kabul tx'inde donmuyor, sonradan (5 güne kadar gecikmeyle) yeniden kuruluyor (T2-022).

Kök sebep bir mimari boşluk: **rapor katmanı ile operasyon katmanı arasında bir sözlük yok.** `reports/*` servisleri kendi `WHERE status IN (...)` listelerini yazabiliyor, ve o listeler operasyon tarafındaki listeden ayrı evriliyor.

### (d) Fabrikadaki etkisi

Yönetici iki ekrana bakıp iki farklı rakam görüyor ve hangisinin doğru olduğunu söyleyecek bir merci yok. Daha kötüsü: **kapanmış bir ayın rakamı geriye dönük değişiyor** (T2-018) — Temmuz'da 698 m üretmiş görünen fabrika, Ağustos'ta yapılan bir iptalden sonra Temmuz'da daha az üretmiş oluyor. Bu, karneye dayanan her prim/performans konuşmasını geçersizleştirir. `initialQty`'nin kesimde düşürülmesi (T1-012/T2-016) ayrıca **mutabakat sorgusuna sahte aşım alarmı** ürettiriyor — yani yanlış tanım, kendi bekçisini de yanlış konuşturuyor.

### (e) Kümeyi kapatan TEK müdahale

**Rapor tabanı sözlüğü** (`src/services/reports/_vocabulary.ts`): "üretilen metraj", "fire", "sevk edilen", "açık talep", "aşım", "fabrika günü" için **birer** fonksiyon; rapor servisleri ham statü listesi ya da ham tarih aritmetiği yazamaz. Bugün bu sözlüğün bir maddesi zaten var ve çalışıyor (`reports/_shipped.ts`) — genişletilecek.

Ön koşul: `initialQty` semantiğinin onarılması (T1-012) — "üretilen metraj" tanımı bu kolona dayanıyor.

### (f) Kalıcı bekçi

AST bekçisi: `src/services/reports/**` altında ham `RollStatus` literali / ham statü dizisi / ham `new Date()` **yasak**; yalnız sözlükten import. Artı bir **çapraz mutabakat bölümü**: aynı dönem için Kalite Karnesi ↔ Fire Karnesi ↔ Envanter ↔ Kanban aynı sayıyı basmalı (bu desen 2026-08-27'de bir kez uygulandı — "üç yüzeyde tek rakam doğrulandı, 47 ↔ 47 ↔ 47"; kalıcılaştırılmamış).

---

## KN-7 — "Bekçi kusurla aynı yerde kör ve sahaya çıkan dalda hiç koşmuyor"

### (b) Bulgular — 21

| Şiddet | Bulgular |
|---|---|
| **S2** | T1-015 (**CI yalnız `main`'e tetikleniyor; fabrikaya çıkan `adnansahin` dalında 140 commit, 33 migration, 67 yeni bekçi hiç otomatik koşmadı**) · T1-016 (test paketi HEAD'de KIRMIZI, `npm test` exit 1) · T1-017 (para/stok etkili ALTI P0 yolunda tek bir paralel sonda yok) · T1-018 · T1-074 (yedi advisory noktasının **beşinde** sıra bekçisi, **ikisinde** hiçbir bekçi yok) · T2-004 |
| **S3** | T1-069 (KK2 idempotency'sinin TEK bekçisi servisi hiç çağırmıyor) · T1-070 (dev DB'de 480 test artığı WO, tablonun %63'ü) · T1-071 · T1-073 · T1-075 (**bekçilerin %96'sı servisi doğrudan çağırıyor; HTTP/Zod/middleware katmanı 260 yazma ucunun ~%10'unda koşuyor**) · T1-076 · T1-078 · T1-097 · T1-139 · T1-145 · T2-031 · T2-032 · T2-033 |
| **S4** | T1-138 · T2-036 |

### (c) MEKANİZMA

366 bekçi scripti var (`KUNYE.md`) — bu bir **güç**, ve `_hasat.json` negatif sonda kültürünü haklı olarak övüyor. Kusur kapsamda değil, **konumda**:

1. **Bekçi, kusurun bulunduğu katmanın bir alt katmanında duruyor.** %96'sı servisi doğrudan çağırıyor (T1-075) → HTTP/Zod/middleware/guard katmanı ölçülmüyor. Bunun ölçülmüş bedeli repo tarihinde yazılı: `dispatchWithoutColor` yedi katmanda sessizce düşüyordu ve **servisi çağıran test yeşil kalıyordu** (kök CLAUDE.md 2026-08-25). KN-10'un tamamı bu boşlukta yaşıyor.
2. **Bekçi, kusurla aynı varsayımı paylaşıyor.** `consistency-check.sql §1/§2` denormu deftere karşı ölçüyor; defterin eksikliğini göremiyor (T2-004). `test_qc2_idempotency.ts` Prisma'nın `@@unique`'ini test ediyor, servisi hiç çağırmıyor (T1-069). `test_tambur_undo §5` invariantı yalnız FULL+DEPO kesiminde ölçüyordu — 2026-08-22'de aynı ders alınmıştı, sınıf kapanmadı.
3. **Bekçi koşmuyor.** Kapı `main`'e bağlı, fabrika `adnansahin`'den çıkıyor (T1-015): **140 commit, 33 migration, 67 yeni bekçi** hiç otomatik koşmadı. Üstelik paket HEAD'de zaten kırmızı (T1-016) — yani manuel koşulsa bile "kırmızı normaldir" alışkanlığı doğuyor. `check-migrations.mjs` hiçbir tetikleyiciye bağlı değil ve CI'da bilerek her zaman yeşil (T1-076).
4. **Bekçinin zemini sahayla ayrışmış.** Dev DB'de 72 kullanıcının 46'sı test artığı, 8 admin (sahada 3), 480 `TST-WHA` iş emri (T2-032, T1-070); üstelik bazı bekçiler prod anlık görüntüsü üzerinde koşmuş ve **canlıda AKTİF bir TEST makinesi 4 topa damga vurmuş** (T2-031).

### (d) Fabrikadaki etkisi

Bu küme doğrudan fabrikayı bozmuyor — **diğer dokuz kümenin geri gelmesini garantiliyor.** T1-044'ün ölçülmüş hikâyesi (düzeltmeden 5 gün sonra ikinci ihlal, 13 gün fark edilmedi) bu kümenin fabrikadaki tercümesidir: her düzeltmenin yarı ömrü, onu koruyan bekçinin koştuğu yere kadardır.

### (e) Kümeyi kapatan TEK müdahale

**CI'yı `adnansahin` dalına bağlamak ve paketi yeşile çekmek** (T1-015 + T1-016). Bu tek hamle olmadan bu bölümdeki hiçbir "kalıcı bekçi" önerisi kalıcı değildir — yazılır, koşmaz.

Hemen ardından: **yol × sonda kapsam matrisi** — `MATRIX.md §C`'deki "bekçisi olmayan yazma yolu" listesi bir dosyaya alınır ve eksik satır CI'yı kırar.

### (f) Kalıcı bekçi

`test_guard_coverage.ts`: ① P0 yazma yolu listesi (`KRITIK-YAZMA-YOLLARI.md`'den türetilir) ↔ paralel sonda dosyası eşlemesi; ② her `clientToken` ucu ↔ beş-durum sondası; ③ her advisory namespace ↔ **sıra** bekçisi (bugün 7'nin 5'inde var, T1-074); ④ HTTP-katmanı sondası olmayan yazma ucu sayısı bir tavanı aşarsa kırmızı. Ayrıca `productionDbGate`'in tek-dosya koşumlarını da kapsaması (T1-138) ve `clean_test_residue`'nun tüm önekleri tanıması (T1-070).

---

## KN-8 — "İşletme katmanı kural olarak yazılı, mekanizma olarak yok"

### (b) Bulgular — 20

| Şiddet | Bulgular |
|---|---|
| **S1** | T1-020 (`kur.ps1` her kurulumda `ecosystem.config.js`'i **paketinkiyle eziyor** → sunucudaki yedek/offsite/zamanlayıcı ayarları sessizce repo değerlerine dönüyor; saha 7) |
| **S2** | T1-019 (`reset-operational.ts` ortam kapısı olmadan 30+ tabloyu TRUNCATE ediyor — `system_logs` dahil) · T1-022 (**makine dışı kopya ve PITR yok; RPO/RTO hiçbir yerde yazılı değil**) · T1-023 (**geri yükleme tatbikatı hiç yapılmamış**) · T1-053 (`.env` git'te izleniyor) · T3-021 |
| **S3** | T1-031 · T1-055 · T1-064 (başarısız `migrate deploy` sonrası kurtarma reçetesi hiçbir belgede yok) · T1-065 · T1-066 · T1-068 (sürüm sıfırlaması mobil sürüm kapısını kalıcı etkisizleştirdi) · T1-134 (`CREATE INDEX CONCURRENTLY` hiç yok, `lock_timeout` hiçbir yerde yok) · T3-020 · T4-017 |
| **S4** | T1-121 · T1-133 · T1-135 · T1-136 · T2-039 |

### (c) MEKANİZMA

Fabrika **on-prem** ve tek makinede koşuyor (`KUNYE.md`: PM2 fork, `instances:1`, Windows native PG 16.9). Yani "işletme" ayrı bir ekibin işi değil — **kodun bir parçası**. Ama ops mantığı iki ayrı yerde yaşıyor: repoda `ecosystem.config.js` + `deploy/kur.ps1`, sunucuda elle düzenlenmiş gerçek dosya. `kur.ps1` ikisini uzlaştırmıyor, **eziyor** (T1-020) — yani sunucuda yapılan her ops ayarı bir sonraki deploy'da sessizce kayboluyor, ve bunu görecek bir mekanizma yok (T1-024, KN-4).

İkinci sürücü: **"yazılı vardiya kuralı" bir kontrol sanılıyor.** Migration'larda `CONCURRENTLY` yok, `lock_timeout` yok, 195 migration'ın 34'ünde `SET statement_timeout=0` — büyümede tek koruma "vardiya dışında deploy et" cümlesidir (T1-134). Aynı şekilde `test_db_invariants §1`'in **bilerek kırmızı** bırakılması (yumuşak kapı, T1-066) sinyal değil gürültü üretiyor.

Üçüncüsü: **geri dönüş yolu hiç denenmemiş.** `docs/ops/DEPLOY-RUNBOOK.md:470`'te yazan restore prosedürü prod'da bir kez bile koşmadı (T1-023) ve başarısız `migrate deploy`'dan çıkış reçetesi hiçbir belgede yok (T1-064).

### (d) Fabrikadaki etkisi

Bu kümenin en kötü senaryosu **tekildir ve toplamdır**: yedek her gece alınıyor sanılıyor, alınmadığı görülmüyor (T1-024), alınsa bile aynı makinede duruyor (T1-022), ve geri yükleme yolu hiç denenmedi (T1-023). Üçü birleştiğinde ERP'nin tamamının kaybı **teorik değil, ölçülmüş bir ihtimal**. Deploy tarafında ise: bir migration yarıda kalırsa operatörün elindeki iki seçenek de yanlış ağırlıkta (T1-064) ve fabrika kapalı kalır.

### (e) Kümeyi kapatan TEK müdahale

`kur.ps1`'in **ayarı ezmemesi** (T1-020: paket değerleri ile sunucu değerlerinin birleştirilmesi, ops anahtarları sunucudan korunur) + **yedek yaşının bir hükme bağlanması** (KN-4'ün `/health` müdahalesiyle aynı iş) + **çeyrek dönemde bir zorunlu restore tatbikatı** (T1-023). Üçü tek bir "kurulum & kurtarma" paketi.

### (f) Kalıcı bekçi

① `deploy/kur.ps1` için harness testi: "sunucuda değiştirilmiş bir `ecosystem.config.js` kurulumdan sonra da değiştirilmiş kalır" (bu harness deseni repoda zaten var — 12/12 geçen bir örneği mevcut). ② Restore tatbikatı script'i, çıktısı bir kayıt satırı yazar; **son tatbikat > 90 gün → `/health DEGRADED`**. ③ Migration bekçisi: yeni migration `CREATE INDEX` içeriyorsa `CONCURRENTLY` veya gerekçeli muafiyet ister (T1-134).

---

## KN-9 — "Yetki kataloğu koda taşındı, atama ve sınır insana kaldı"

### (b) Bulgular — 21

| Şiddet | Bulgular |
|---|---|
| **S1** | T1-014 (6 haneli PIN tek başına kimlik; tek savunma IP-anahtarlı bellek kilidi — **3 yönetici hesabının PIN'i var**) |
| **S2** | T1-013 (`admin:users` HER kullanıcının düz PIN'ini **izsiz** okur) · T1-051 (token 30 gün, sınırsız paralel oturum, idle kilit yok, düz HTTP; saha 121) · T2-012 (izinler ops-sql ile doğrudan DB'ye yazılmış: `tokenVersion++` atlanmış, SoD-kritik `shipping:undo-dispatch` **6 kullanıcıya bu yolla** verilmiş) · T2-013 (self-escalation: son-admin koruması yalnız düşüren dalda) |
| **S3** | T1-043 (**8 aktif kullanıcının 6'sı SoD üçlüsünü birlikte taşıyor**) · T1-052 · T1-054 · T1-111 · T1-115 (SSRF, bugün bayrakla kapalı) · T1-116 · T1-118 (hiç hız sınırı yok) · T2-030 (sahadaki oturum ayarlarının tamamı kod varsayılanının **tersine** kapalı; panelde yazan 8 saat ETKİSİZ) · T4-009 |
| **S4** | T1-112 · T1-113 · T1-114 · T1-156 · T1-157 · T1-158 · T2-040 |

### (c) MEKANİZMA

2026-08-06'da alınan karar doğruydu ve yazılı: *"katalog koda, atama panele"* (rol şablonları koda taşındı, boot uzlaştırması izni **getirir ATAMAZ**). Ama bu ayrım bir **boşluk** bıraktı ve boşluğu kapatacak hiçbir mekanizma kurulmadı:

- Katalogda SoD üçlüsü ayrıştırılmış (`role-template-catalog.ts:149-166, 235-254, 392-400`); **atamada 8 kullanıcının 6'sı üçünü birden taşıyor** (T1-043). Yani tasarım doğru, gerçek yanlış, ve aradaki farkı gösteren tek yüzey yok.
- İzinler bir kez de **ops-sql ile doğrudan DB'ye** yazılmış (T2-012, saha 24 satır): `tokenVersion++` atlanmış (yani JWT tazelenmemiş), `grantedById` boş. Yani atama yolu bir kapı değil, **bir öneri**.
- Politika **kod varsayılanı ile canlı ayar arasında ayrışmış**: panelde 8 saatlik oturum ömrü yazıyor, token 30 gün yaşıyor (T2-030 + T1-051, saha 121 oturum).
- "Sınır" sanılan üç kapı sınır değil: masaüstü erişim kapısı gövdeden gelen `clientType`'a bakıyor (T1-156, `auth.controller.ts:24`), cihaz kapısı başlık göndermeyene **hiç** uygulanmıyor (T1-113), Swagger kapısı `NODE_ENV`'e bakıyor ama morgan `APP_ENV ?? NODE_ENV`'e (T1-157). Kod ve arayüz bunların aksini söylüyor.

### (d) Fabrikadaki etkisi

Sistemde "kim ne yaptı" sorusunun cevabı **hukuken zayıf**: `admin:users` taşıyan bir kişi herhangi bir kullanıcının düz PIN'ini izsiz okuyup onun adına işlem yapabilir (T1-013), 6 haneli PIN alt ağdan denenebilir (T1-014), ve token bir ay boyunca kopyalanmış hâlde çalışır (T1-051). SoD tarafında: aynı kişi **sevk ediyor, sevki geri alıyor ve metrajı düzeltiyor** (T1-043, 6/8 kullanıcı) — mal kaybının kasıtlı olduğu bir senaryoda sistemin sunabileceği hiçbir ayrım yok.

### (e) Kümeyi kapatan TEK müdahale

**Politikayı ve atamayı tek doğrulanmış kaynaktan zorlamak:** ① oturum/kilit ayarları için tipli, aralık doğrulamalı **tek** yazma kapısı (bugün `PUT /api/admin/settings/:key` allowlist'siz ve tipsiz — T1-050/T2-039, ve sahada fiilen kullanılmış); ② izin yazımı **yalnız** `permission-management.service` üzerinden (ops-sql yolu kapatılır, `tokenVersion++` garanti); ③ SoD ihlali **atamada** engellenir ya da en azından boot'ta sayılıp `/health` bandına yazılır.

### (f) Kalıcı bekçi

`test_permission_sod.ts`: rol şablonu kataloğuna aykırı **canlı atama** sayısı > 0 → kırmızı (bugün 6 olurdu). Artı: `test_auth_policy.ts` — kod varsayılanı ile canlı `SystemSetting` değerinin ayrıştığı her oturum/kilit anahtarı raporlanır (T2-030 bugün 6 anahtarda ayrışıyor). Artı: her yeni route için "sınır mı, nezaket mi" beyanı zorunlu (T1-156'nın kusuru davranış değil, **belgelenmemiş olması**).

---

## KN-10 — "Sözleşme uç başına yazılıyor; karar istemcide kalıyor"

### (b) Bulgular — 33

| Şiddet | Bulgular |
|---|---|
| **S1** | T3-001 (offline kuyruktan flush edilen KK1 kaydı 409 alırsa **hiçbir iz bırakmadan düşüyor** — fiziksel top sistemde hiç doğmuyor) |
| **S2** | T1-045 · T2-002 · T2-006 (fason firması çözülemezse mal fasona GİTMİYOR; onay ekranı bunu **kullanıcı tercihi gibi** gösteriyor) · T3-014 · T3-017 · T3-018 · T3-019 (Fason Kabul ekranı sunucudan onay gelmeden "tamamlandı" basıp formu siliyor — **KK1'de ölçülüp yasaklanan desen**) |
| **S3** | T1-038 · T1-046 · T1-047 · T1-050 · T1-080 · T1-081 (aynı sorunun **üç farklı cevabı**: 400 / uyarı / 409) · T1-082 · T1-105 · T1-142 · T3-030 · T4-001 · T4-004 · T4-007 · T4-013 (aynı fiziksel alanın **dört farklı üst sınırı**: 1000 cm / 999.999.999 / SINIRSIZ) · T4-014 · T4-016 · T4-021 |
| **S4** | T1-107 · T1-108 (saha 86) · T1-109 · T1-129 · T1-166 · T4-023 · T4-024 · T4-025 |

### (c) MEKANİZMA

İki alışkanlık:

1. **Zod şeması uçun yanında yazılıyor, alanın yanında değil.** Aynı kolona yazan dört uç dört farklı sınır tanımlıyor (T4-013). Toplu yazma tavanı sevkiyat için ölçülüp gerekçesiyle yazılmış (`shipping.controller.ts:60-67`), **altı uçta açık kalmış** (T1-108). `positive()` 0'ı reddediyor ama 0,0004'ü kabul ediyor ve `Decimal(12,3)` onu 0,000'a yuvarlıyor → sıfır metrajlı canlı top (T4-014). Bu, KN-7'nin doğrudan sonucu: bekçilerin %96'sı servisi çağırdığı için **Zod katmanı hiç ölçülmüyor** (T1-075).
2. **Kararın istemcide bırakılması sözleşme sayılıyor.** Storno'nun "sevkiyatı da kapat" kararı istemcide (T3-026) — alanı göndermeyen istemci rejime aykırı `PLANNED` sevkiyat bırakıyor. Sunucu `warnings` üretiyor, **hiçbir istemci okumuyor** (T1-048: "rota kapsaması UYARI'ya indirildi" kararı fiilen ölü). Ve en zararlısı: istemci **sunucudan onay gelmeden başarı basıyor** (T3-019) — bu tam olarak KK1'de 2026-08-12'de ölçülüp yasaklanan desendir (`onMutate` yeşil basmaz), fason ekranında duruyor.

Ortak kök: **istemci ile sunucu arasında bir sözleşme nesnesi yok.** Her ekip (backend uç sahibi / Electron / mobil) kendi tarafında kendi doğrusunu yazıyor ve ikisi arasındaki farkı ölçen tek yer bir insanın dikkati.

### (d) Fabrikadaki etkisi

Operatör "kaydettim" yeşilini görüyor, kayıt yok (T3-001, T3-019). Fabrika sahaya mal göndermeyi seçtiğini sanıyor, mal fasona hiç gitmiyor ve **başarı ekranı bunu hiç söylemiyor** (T2-006). İçe aktarımda `31.02.2026` sessizce 3 Mart oluyor (T4-001) — sipariş termini bir gün kayıyor. Masaüstü panel, yayın sunucusuna erişilemediğinde **çıkışsız kilitleniyor** (T4-007). Ve `apply-attribute-to-rolls` top sayısını sınırlamadığı için toplu düzeltmenin `failed[]`'i kimseye ulaşmıyor (T4-004) — planlamacı 200 topu düzelttiğini sanıyor, 40'ı düşmüş.

### (e) Kümeyi kapatan TEK müdahale

**Alan sözlüğü (`src/schemas/fields.ts`):** her fiziksel büyüklük (metraj, en, ağırlık, sebep metni, id dizisi) için **tek** Zod tanımı; controller şemaları yalnız oradan import eder. İkinci yarısı istemci tarafında ve tek cümledir: **"operatöre gösterilen başarı, sunucunun 2xx'idir"** — `onMutate`/optimistic yeşil yasak, form ancak yanıt geldikten sonra temizlenir.

### (f) Kalıcı bekçi

① AST bekçisi: `src/controllers/**` içindeki Zod şemalarında ham `z.number()`/`z.string()` **yasak**; yalnız sözlükten. ② Mobil/Electron için: "sunucu yanıtı gelmeden başarı gösteren" desen taraması (`mobil/src/**` — bu bekçinin ilk müşterisi T3-019). ③ **HTTP katmanından koşan** sonda oranı için tavan (bugün ~%10, T1-075) — çünkü bu kümedeki bulguların tamamı yalnız HTTP üzerinden görünür.

---

## 9.3 — ÇAPRAZ DESENLER (turlar arası, mekanik sayım)

> Bu bölümdeki sayılar bulgu metninin (başlık + çakışma senaryosu + failure_mode + kanıt notları + etkilenen değişmez) düzenli ifadeyle taranmasıyla üretildi. **Bir bulgu birden çok desende görünebilir** — bu sayılar 243'e toplanmaz. Her satırın id listesi verilmiştir.

| # | Üst-desen | Bulgu | S1 | S2 | Turlar |
|---|---|---:|---:|---:|---|
| **D-1** | Kapı transaction DIŞINDA / havuz client'ıyla okunuyor | **32** | 3 | 9 | T1, T2, T3, T4 |
| **D-2** | Atomik claim yok ya da claim kararı pinlemiyor / kilit alınmıyor | **23** | 4 | 8 | T1, T2, T3, T4 |
| **D-3** | Bekçi yok ya da bekçi kusurla aynı yerde kör | **22** | 1 | 8 | T1, T2, T3, T4 |
| **D-4** | Yazan var, tüketen yok (ölü mekanizma / ölü dal) | **22** | 0 | 4 | T1, T2, T3, T4 |
| **D-5** | Aynı kuralın/büyüklüğün ikinci tanımı (kopya, ikiz, ayrışma) | **44** | 1 | 9 | T1, T2, T3, T4 |
| **D-6** | Değişmez yalnız uygulamada; DB seddi yok / merkezî değil | **18** | 2 | 3 | T1, T2, T4 |
| **D-7** | İdempotency / replay sözleşmesi | **28** | 3 | 10 | T1, T2, T3, T4 |
| **D-8** | Karar istemcide kalıyor / istemci sözleşmesi sunucuda zorlanmıyor | **17** | 0 | 3 | T1, T2, T3, T4 |
| **D-9** | Zaman / gün sınırı / saat dilimi | **11** | 0 | 0 | T1, T2, T3, T4 |
| **D-10** | "Sessiz" düşüş — operatöre hiçbir sinyal ulaşmıyor (sözcüksel tarama) | **85** | 7 | 22 | T1, T2, T3, T4 |

**Bulgu id listeleri:**

- **D-1 (32):** T1-001, T1-002, T1-004, T1-005, T1-007, T1-009, T1-010, T1-029, T1-030, T1-069, T1-084, T1-085, T1-086, T1-091, T1-093, T1-104, T1-105, T1-122, T1-146, T1-148, T1-154, T1-163, T2-008, T3-007, T3-012, T3-016, T3-029, T3-030, T3-031, T3-033, T4-020, T4-022
- **D-2 (23):** T1-001, T1-002, T1-003, T1-005, T1-007, T1-025, T1-029, T1-035, T1-051, T1-068, T1-078, T1-085, T1-086, T1-092, T1-118, T1-148, T2-008, T2-009, T3-003, T3-004, T3-015, T3-016, T4-012
- **D-3 (22):** T1-006, T1-008, T1-016, T1-017, T1-031, T1-052, T1-071, T1-074, T1-078, T1-093, T1-098, T1-142, T1-145, T1-150, T1-158, T2-004, T2-025, T2-033, T3-010, T3-011, T3-022, T4-012
- **D-4 (22):** T1-006, T1-012, T1-026, T1-029, T1-059, T1-060, T1-069, T1-073, T1-081, T1-096, T1-126, T1-145, T1-146, T1-153, T1-164, T1-165, T1-167, T2-038, T3-018, T3-031, T3-033, T4-001
- **D-5 (44):** T1-002, T1-006, T1-007, T1-019, T1-029, T1-030, T1-046, T1-049, T1-063, T1-078, T1-080, T1-081, T1-082, T1-086, T1-096, T1-097, T1-098, T1-099, T1-107, T1-131, T1-142, T1-143, T1-146, T1-153, T1-163, T1-166, T2-004, T2-008, T2-016, T2-017, T2-021, T2-032, T2-034, T3-001, T3-011, T3-030, T3-031, T3-032, T4-003, T4-006, T4-012, T4-013, T4-016, T4-026
- **D-6 (18):** T1-001, T1-002, T1-007, T1-009, T1-010, T1-027, T1-043, T1-044, T1-047, T1-052, T1-078, T1-096, T1-099, T1-150, T2-009, T2-027, T2-028, T4-013
- **D-7 (28):** T1-002, T1-005, T1-006, T1-008, T1-017, T1-023, T1-026, T1-050, T1-059, T1-063, T1-069, T1-089, T1-120, T1-136, T1-146, T1-148, T2-007, T2-014, T2-036, T3-001, T3-010, T3-013, T3-019, T3-023, T3-028, T3-033, T4-003, T4-011
- **D-8 (17):** T1-028, T1-047, T1-048, T1-049, T1-059, T1-075, T1-107, T1-113, T1-115, T1-156, T2-014, T2-034, T3-009, T3-026, T4-007, T4-011, T4-015
- **D-9 (11):** T1-075, T1-098, T1-120, T2-024, T2-034, T3-008, T4-001, T4-002, T4-008, T4-011, T4-012

### 9.3.1 — Desenlerin turlar arası kararlılığı

Dört tur **bağımsız mercekler**di (T1 kod-merkezli 145 · T2 veri-merkezli 40 · T3 senaryo-merkezli 32 · T4 sınır-durum 26). Kök nedenlerin gerçekliğinin en güçlü kanıtı, **her turun aynı desenleri kendi merceğinden yeniden bulmuş olmasıdır**:

| Desen | T1 (kod) | T2 (veri) | T3 (senaryo) | T4 (sınır) | Toplam |
|---|---:|---:|---:|---:|---:|
| D-1 tx dışı kapı | 22 | 1 | 7 | 2 | 32 |
| D-5 ikinci tanım | 26 | 7 | 5 | 6 | 44 |
| D-7 idempotency | 16 | 3 | 7 | 2 | 28 |
| D-3 bekçi kör | 15 | 3 | 3 | 1 | 22 |

Aynı doğrulama `merged_from` alanında da görünüyor: **55 bulgu ≥2 bağımsız bulucudan birleşti** — ör. `BULGU-T1-001` üç ayrı bulucudan (`D-A-01`, `D-E-08`, `KYY-2-01`) aynı satıra işaret etti.

### 9.3.2 — "Bekçi kusurla aynı yerde kör" — sayılan vakalar

Bu, denetimin en tekrar eden meta-deseni ve repo tarihinde **daha önce de öğrenilmiş** bir ders (kök CLAUDE.md 2026-08-22 §13: *"bekçinin kör noktası hatanın kendisiyle aynı yerdeydi"*). Bu denetimde ölçülen vakalar:

| Bulgu | Bekçi | Kör noktanın niteliği |
|---|---|---|
| T2-004 | `consistency-check.sql:27-56` §1/§2 | Denormu **deftere** karşı ölçüyor; defterin eksikliğini tanım gereği göremez |
| T1-069 | `test_qc2_idempotency.ts` | Servisi hiç çağırmıyor, Prisma `@@unique`'ini test ediyor |
| T1-073 | `test_fason_open_dispatch_single_source.ts:48-50` | Yalnız TS nesne literallerini tarıyor; **üç ham-SQL kopyası** kapsam dışı |
| T1-078 | `test_batch_number_format.ts:196-224` | Gerçek DB'de paralel sonda yok; sahte tx üzerinde çağrı sırası sayıyor |
| T1-097 | `consistency-check.sql:182-189` §12 | Mekanik ikizindeki muafiyet listesini taşımıyor → prod'da 15 yanlış-pozitif |
| T2-033 | `test_db_invariants.ts:624-655` | Trigger'ın **gövdesi** hiç doğrulanmıyor; yalnız zamanlaması |
| T1-071 | `test_shipment_scorecard.ts:103-118` | "daily" kelimesi hiç geçmiyor; kardeş karneler ölçüyor |
| T1-139 | 33 eşzamanlılık sondası | 24'ü N=2, hiçbirinde gecikme enjeksiyonu yok — **dar pencerede yeşil kalabilir** (bekçilerin kendi itirafı) |
| T1-075 | 366 bekçinin %96'sı | Servisi doğrudan çağırıyor → HTTP/Zod/middleware katmanı ~%10 kapsamda |
| T2-036 / T2-025 | `test_consistency §21` / `§20` | **Kalıcı kırmızı** → kırmızı körlüğü üretiyor |

### 9.3.3 — Kod yoğunlaşması

| Dosya | Bulgu | Not |
|---|---:|---|
| `Teks-Erp/src/services/shipping.service.ts` | 14 | Aynı dosya `_hasat.json`'daki "doğru yapılanlar"ın da başında (performDispatchTx, 8023 kilidi, hayalet assertion) |
| `Teks-Erp/src/services/subcontractor.service.ts` | 13 | Kısmi kabul + LIFO + kalan kapama — en genç ve en karmaşık alan |
| `Teks-Erp/src/services/workorder.service.ts` | 10 | |
| `Teks-Erp/src/services/inventory.service.ts` | 9 | |
| `Teks-Erp/src/services/tambur.service.ts` | 9 | |
| `import.service.ts` · `app.ts` · `tambur-undo.service.ts` · `order.service.ts` · `error.middleware.ts` · `audit.service.ts` · `return.service.ts` | 5'er | |

**Okunuşu:** bulgular kötü yazılmış modüllerde değil, **en çok yazma yolu taşıyan** modüllerde yoğunlaşıyor. `shipping.service.ts` hem 14 bulgunun hem de projedeki en iyi eşzamanlılık kararlarının adresi. Bu, "bu kod kötü" teşhisini çürütür ve KN-1'in mekanizmasını doğrular: **kusur dosyada değil, dosyalar arası ortak katmanın yokluğunda.**

### 9.3.4 — İstemci tarafının payı

243 bulgunun yalnız **8'i** bir mobil/Electron dosyasına çıpalanmış (T3-001, T3-002, T1-060, T2-006, T3-019, T1-062, T4-007, T4-021) — ama bunların **3'ü S1**. Yani istemci kod hacmi olarak küçük, **risk olarak orantısız**: sunucu doğru davransa bile operatörün gördüğü şey yanlış olabiliyor (KN-10). `ERISILEMEYEN.md §⑤` bu asimetriyi kabul ediyor: istemci tarafı tüm haritalarda kapsam dışıydı — yani bu 8 sayısı **bir taban**, bir tavan değil.

### 9.3.5 — Kanıtın sınırları (dürüstlük notu)

`ERISILEMEYEN.md`'den taşınan ve bu bölümün iddialarını kelepçeleyen üç madde:

1. **Canlı prod'a erişim yok.** Tüm saha sayıları 2026-08-25 kopyasından (`tekserp_saha_0825`, 190/195 migration). Son 5 migration'ın kolonları kopyada **yok** → sipariş kalemi iptali, fason kısmi kabul defteri ve `RollVariance.sourceRefId` etkileri canlı veriyle ölçülemedi.
2. **Bekçilerin hiçbiri koşturulmadı** (salt-okunur kural). "Bekçi kırmızı verir mi" iddiaları kod okumasına dayanıyor; T1-016'nın "paket HEAD'de kırmızı" tespiti tek çalıştırılmış ölçümdür.
3. **Deadlock sondaları (ABBA-1..5) N-paralel koşulmadı.** KN-1'deki kilit sırası bulguları (T1-025, T1-027, T1-028) `[VARSAYIM]` etiketi taşır; tetiklenmiş değil, **çıkarsanmıştır**.

---

## 9.4 — BU DENETİMİN EN ÖNEMLİ TEK CÜMLESİ

> **Bu sistem her doğru kuralı en az bir kez keşfetti, ölçtü ve kodun yanına yazdı — ama hiçbirini bir kapıya dönüştürmediği için, kural yalnız onu keşfeden satırda yaşıyor ve her yeni yazma yolu onu sıfırdan keşfetmek zorunda kalıyor.**

Bunun kanıtı bulguların kendisinde değil, **bulguların yanındaki doğru kodda**: kilidin korunan okumadan önce alınması `shipment-locks.helper.ts:44-54`'te üretilmiş bir vakayla yazılı; barkod sayacının tx dışına alınması `roll-barcode.helper.ts:52-77`'de **iki koşullu bir kabul kriteriyle** (1345 ms → 39 ms, havuz 30/30) belgeli; "sayamadım ≠ yok" kuralı `master-data-merge.service.ts:1023-1026`'da açıkça duruyor; defter-otoritatif denorm `order-status.helper.ts:44-81`'de sürüklenmeyi **yapısal olarak imkânsız** kılıyor (sahada 0/281 sapma); "kısmi sonuç sessiz olamaz" kuralı `TamburScreen.tsx:6320`'de kendi cümlesiyle yazılı.

Ve buna rağmen: aynı kilit sırası **iki advisory noktasında hiç yok** (T1-074), aynı sayaç kararı **kalan çağrı yerlerinde uygulanmadı** (T1-093), "sayamadım ≠ yok" kuralı **iki yerde daha ihlal ediliyor** (T1-129, T1-132), aynı "sessiz kısmi sonuç" yasağı **`bulkDispatchStep`'te ve `apply-attribute-to-rolls`'ta delinmiş** (`MATRIX.md §D` #13, T4-004).

Yani asıl yapısal zaaf bir bilgi eksikliği değil, **bilginin taşıma biçimi**: bu projede kurallar **yorum satırı ve CLAUDE.md maddesi** olarak taşınıyor, **imza, tip ve bekçi** olarak değil. 243 bulgunun 10 kök nedeni de tek bir soruya indirgenir — *"bu kural, onu bilmeyen bir geliştiricinin yolunu kesiyor mu?"* — ve bugün cevap, sistemin en iyi belgelenmiş kararlarında bile **hayır**.

Bu yüzden düzeltme sırası bulgu şiddetiyle değil, **kapı gücüyle** belirlenmelidir: önce CI'yı sahaya çıkan dala bağlamak (T1-015 + T1-016), sonra yazma yolu iskeleti (KN-1), sonra defter kapısı (KN-2). Bu üçü kurulmadan yapılan her nokta düzeltmesinin ölçülmüş yarı ömrü vardır: **5 gün** (T1-044).
