# Tek senaryoya çakılı varsayım — KARARLAR (yedi karar, uygulama bekliyor)

> **Durum: KARARLAR ONAYLI (yönetici, 2026-09-13), UYGULAMA BAŞLAMADI.**
> Bulguların kendisi `CAKILI-VARSAYIM-TARAMA.md`'de.
>
> Her karar dörtlü merdivenden geçti (`docs/kurallar/modul-bayrak.md`):
> ① [ÇEKİRDEK] → ② VERİ → ③ AKSİYON ANINDA SEÇİM → ④ [PROFİL] BAYRAK.
> **Yedi kararın sonucu: SIFIR yeni bayrak.**
>
> ⚠️ **İkisi sürüm notu doğuruyor** (③ indi ve notu yazıldı; ① ve C henüz değil)
> ⇒ paket kararı kullanıcıya bağlı.
>
> **İNMİŞ OLAN TEK KARAR: ③** (`PeripheralDevice.unit`) — birinci yarısı
> `4e716d91`'de. İkinci yarısı (migration + kolon düşürme) **N+1 sürümüne ait**
> ve ⚠️ **sıra load-bearing**: kolon, eski panel toleransından ÖNCE düşerse
> `unit` gönderen panel bilinmeyen argümana çarpar ve cihaz kaydı
> DÜZENLENEMEZ olur.

---

# Çakılı varsayım — ilk üçün KARARI (2026-09-12 gece, Fable; salt okuma, ağaca yazılmadı)

> Ölçümler fabrikanın dev kopyası (fabrikanın canlı yedeği, `TEST-` hariç) ve ağaç `129cd330`+. Her kararda beş soru: mekanizma+DÜZEY · bugünkü davranışın ölçülmüş korunma cümlesi · geçiş · (③) okut/kaldır · kapsam ("mal başka yoldan girer mi").

---

## ① Kalite kodu literalleri ("FIRE" / "A1" / "1.KALITE", 8 site)

**Ölçüm.** Katalog 3 satır: `1.KALITE → targetStatus WAREHOUSE` · `A1 → targetStatus WAREHOUSE, returnTargetStatus A1_STOCK` · `FIRE → SCRAP`. Toplar: 1.KALITE 5.277 · A1 170 · FIRE 7 (hepsi FK dolu) · kodsuz 26. **Yetim kod (string katalogda yok): 0.**
⚠️ Ölçümün ters köşesi: bu fabrikada **A1'in `targetStatus`u WAREHOUSE**, A1_STOCK değil. Yani mevcut helper `loadProducedBuckets().a1Codes` (= `targetStatus === A1_STOCK` olan kodlar) bu fabrikada **BOŞ** döner. "Literal yerine `a1Codes` kullan" naif düzeltmesi `sack-content-mismatch.helper.ts:226` uyarısını ve `sack-search.service.ts:347` genişletmesini bu fabrikada **sessizce kapatırdı**. `targetStatus` "hangi rafa" sorusunu cevaplar, "bu 2. kalite mi" sorusunu DEĞİL — iki soru, iki alan.

**1. Mekanizma ve düzey — ② VERİ, KATALOG SATIRI düzeyinde, iki alanla:**
- **Kova soruları** ("fire mi" → süz/dışla): `targetStatus = SCRAP` kümesi — mevcut `fireCodes`. Süzgeç FK öncelikli + string yedekli: `qualityGradeId IN scrapIds OR qualityGrade IN scrapCodes` (26 kodsuz top bugün de süzülmüyor, aynı kalır). Siteler: `inventory.service.ts:1483`, `:2259`.
- **Rol soruları** ("1. kalite yaz", "2. kalite yaz", "fire yaz", "2. kalite mi uyar"): katalogda **`role QualityGradeRole?`** (`FIRST | SECOND | SCRAP`) + partial unique `(role) WHERE role IS NOT NULL` — rol başına tek varsayılan satır. Siteler: `tambur.service.ts:2673/3093/3523` (aksiyon → rolün satırı → kod + o satırın `targetStatus`u), `sack-content-mismatch.helper.ts:226` (`role = SECOND` ∪ `status = A1_STOCK`), `sack-search.service.ts:347` (`SECOND` rolünün kodu), tablet `TamburScreen.tsx:203/1932-1945` (varsayılan = `FIRST` rolü; katalogda yoksa **400, WAREHOUSE'a düşmez**), `shortCutQuality.ts:28` (`SECOND` rolü).
- Neden düzey KATALOG, satır değil: kesim başına değişen şey **hangi grade** — o zaten ③ aksiyon anında seçiliyor (tablet listeden seçer, tambur `remainingAction`). Değişmeyen şey "bu fabrikada 1./2./fire hangi satırdır" — kurulum verisi. Neden bayrak değil: kod yolu dallanmıyor, yalnız hangi satırın okunacağı değişiyor.
- Tambur sözleşmesi `remainingAction: keep_1kalite | keep_a1 | scrap | discard` katalog literalinin API'ye sızmış hâli — **korunur** (eski tablet bozulmasın), sunucuda `keep_1kalite → FIRST`, `keep_a1 → SECOND`, `scrap → SCRAP` rol çözümü; yeni alan `remainingGradeId?` (uuid) verilirse rolü ezer. Sürüm notu: "eski istemci aynı davranır".

**2. Bugün korunur (ölçüldü):** rol damgası migration'da MEVCUT KODLA yazılır: `1.KALITE→FIRST`, `A1→SECOND`, `FIRE→SCRAP` (bu migration'da literal MEŞRU: geçiş verisi, son kullanım). Damgadan sonra sekiz site aynı üç kodu üretir/süzer; 5.454 kodlu topun 5.454'ü bu üç kodda, yetim 0 → **sıfır görünür fark**. `A1`'in statüsü WAREHOUSE kalır (rol SECOND, targetStatus WAREHOUSE — ikisi ayrı olduğu için bugünkü tuhaflık da birebir korunur, düzeltilmez).

**3. Geçiş:** top satırlarına DOKUNULMAZ (`qualityGrade` string + FK ikisi kalır, okuyucu FK öncelikli). Yalnız katalog satırları damgalanır (3 UPDATE, `code IN (...)`). Rol damgası olmayan kurulum (ikinci müşteri, katalogu kendi kurar): rol atanmadan tambur kesimi ve tablet kesimi **400 "kalite kataloğunda 1. kalite rolü atanmamış"** (bugün sessiz WAREHOUSE'tu) — fail-closed; katalog ekranında rol seçici. `bucketOf` bilinmeyen kodu `warehouse` sayar (lenient) — kalır ama `unknownCodes > 0` `warnings`a basılır, sessiz kalmaz.

**5. Kapsam — mal başka yoldan girer mi:** grade kodu yazan yollar: KK1 girişi (kullanıcı seçer, FK), tambur kesimi (rol), iade override (FK), fason kabul (ebeveynden miras), import adaptörü (kod → FK, yetim kodu reddediyor mu? **ölçülmedi — sahibi baksın**). Sızdırmazlık için bekçi: **AST tripwire** — `src/` içinde `qualityGrade` ile string literal karşılaştırması / ataması ( `=== "..."`, `qualityGrade: "..."` ) yasak, tek muaf migration ve bu üç kod için geçiş damgası; negatif sonda: literal eklenince kırmızı. Bugün 8 site kırmızı verir, sıfıra iner.

---

## ② Miktar zinciri metre / `Item.unit` (MT|KG|ADET) okunmuyor

**Ölçüm.** `ItemUnit` enum `MT KG ADET`, `Item.unit @default(MT)`. Fabrika: 245 kalemin **245'i FABRIC/MT**; 474 sipariş satırının **474'ü MT kalem**. `OrderLine`da unit kolonu **YOK**; `InvoiceLine.unit String @default("m")` var. `shippedQty` TEK yazar: `helpers/order-status.helper.ts:132` (Σ `SackAllocation.qty` + `DirectShipAllocation.qty`, ikisi de `Roll.currentQty` METRE). 20 okuyucu dosya (order · coverage · allocation · production-balance · boss/overview · beş scorecard raporu · return · shipping · subcontractor · tambur · workorder-link · import order.adapter · system-setting).

**1. Mekanizma ve düzey — ② VERİ, SATIR düzeyinde:** `OrderLine.unit ItemUnit @default(MT)`, satır yaratılırken **kalem kartından kopyalanır**, satırda düzenlenebilir. **Kurulum anahtarı ÇÖKER:** aynı fabrika kumaşı metre, ipliği kilo, kartelayı adet satar — birim satırın özelliğidir. Karşılama kuralı:
- `unit = MT` → bugünkü Σ metre, değişmez.
- `unit ∈ {KG, ADET}` → karşılama **ÖLÇÜLMEZ**: `shippedQty` 0 kalır, satır `fulfillmentMeasured:false` + `ApiResponse.warnings` "birim kg — metre defteri karşılamayı ölçemez"; sipariş otomatik KAPANMAZ (bugün ~1000 m'de kapanıyordu = sessiz yanlış). Fail-closed, sessiz-yanlış yerine görünür-ölçülmemiş.
- Fatura/taslak satırı `unit`i **satırdan** alır; `?? "m"` literal fallback'leri (`invoice.service.ts:399/815`, `shipping.service.ts:5528`, Electron `invoiceDraftLines.ts:72`) kalkar; kalemsiz elle satırda `unit` Zod'da ZORUNLU (bugün opsiyonel → sözleşme tetiği, panel önce).
- ⚠️ **UYGULANDI (2026-09-13, 9b; `221d6b55`→`46b97849`) — ÜÇ DÜZELTME:** Ç1 yukarıdaki "birim satırdan gelir" cümlesi yalnız ELLE girilen satır için doğrudur; defterden türeyen taslak/irsaliye miktarı METRE'dir ve "m" KALIR (**birim miktarın kaynağını izler**), MT-dışı satıra `warnings`; irsaliyeye uyarı gömülmez. Ç2 `fulfillmentMeasured` kolon değil türev. Ç3 mutabakat §1/§2 `unit='MT'`. Sipariş uçlarında Zod YOK → allowlist + enum doğrulaması. Ayrıntı: arşiv 2026-09-13. Kapsam (b) — metre-Σ okuyucular — AYRI commit, kuyrukta.
- **Kilo karşılamanın kendisi bu kararın DIŞINDA** ve dürüstçe yazılır: top başına net kg YOK (`Sack.weightKg` brüt/çuval, şema "tekli top kg tutulmaz"), KK1 girişi metre. Kg satan örmeci için tam destek = `Roll` üzerinde ikinci ölçü (net kg) + giriş + çuval net dağıtımı — **ayrı tasarım ("örme dilimi")**. Bu karar sessiz yanlışı DURDURUR ve birimi satıra koyar; örmeciyi çalıştırmaz, "çalışıyor" yalanını bitirir.

**2. Bugün korunur (ölçüldü):** varsayılan `MT`; backfill `OrderLine.unit = Item.unit` → 474/474 MT; KG/ADET dalı bu fabrikada **hiç koşmaz**; `shippedQty` yazarı MT satırda aynı Σ. Fatura satırı `unit` zaten "m" varsayılanlı → dokunulmaz.

**3. Geçiş:** migration `OrderLine.unit` ekler (default MT) + UPDATE kalemden (durum tablosu, defter değil — `warehouseId` backfill emsali; 474 satır, dry-run listesi gereksiz ama migration çıktısı sayıyı basar). Kapanmış siparişler yeniden yorumlanmaz — MT idiler, MT kalırlar; epoch çizgisi GEREKMEZ çünkü geçmişte MT-dışı satır YOK (ölçüldü). KG-dışı satırı olan bir kurulum gelirse (ikinci müşteri) o satırların bugünkü `shippedQty`si metreyle şişmiştir → migration onları listeler ve `fulfillmentMeasured:false`a çeker (shippedQty'yi SIFIRLAMAZ — yazılmış rakam silinmez, işaretlenir; ayrı onarım kararı).

**5. Kapsam — mal başka yoldan girer mi:** satır YARATAN her yol `unit`i kalemden kopyalamak zorunda (allowlist sınıfı — biri unutulursa MT varsayılanı sessiz yanlış olur): `order.service` (elle), `quickOrderFromRolls` (toplardan), import `order.adapter.ts` (şablona `unit` sütunu + export round-trip), `workorder-link`, sevk otomatik taslağı. Bekçi: "unit ≠ item.unit olan sipariş satırı yok" mutabakat maddesi + Zod↔create data ikizi. `_shipped.ts` (dönem sevk metrajı) METRE KALIR — kumaş defteri metre, doğru; rapor başlığı "m" der.

---

## ③ `PeripheralDevice.unit` — yazılıyor, okunmuyor

**Ölçüm.** Şema `unit VarChar(8) // "m"/"kg"`, `scale Decimal(10,4) // cm→m: 0.01`, `decimals`. Form `PeripheralDeviceFormDialog.tsx:267-275`: "Ondalık" · "Ölçek (cm→m: 0.01)" · "Birim" (serbest metin, placeholder "m / kg"). Tüketici: `useMachineScale.ts:71` `unit:"kg"` SABİT, `scale-read.ts:68-74` yalnız `scale`, mobil `usePeripheralIO.ts:44-49` yalnız `decimals/scale/pattern`, backend 0. Canlı satırlar (silinmemiş): `SCALE kg scale=null decimals=3` ×1 · `METER m scale=null decimals=1` ×2 · yazıcılar null. **Çelişkili satır 0; kaybedilecek bilgi 0** (kg/m = kimlik, scale null→1 zaten aynı şey). Backend ağırlık tavanı `shipping.controller.ts:18,89` `max(999_999_999)` → 14.500 kg **geçer**.

**4. Okut mu, kaldır mı — KALDIR, seçiciye çevir.** Okutmak iki alanı doğrulamayı gerektirir ve "unit=g ∧ scale=1" çelişkisinin doğru cevabı YOKTUR (hangisi yalan?) — çift yüklem sürer. Kaldırmak: saklanan tek yüklem `scale`; form "Birim" serbest metnini **"Cihazın ham birimi" SEÇİCİSİ** ile değiştirir (`kg | g | m | cm | mm`) ve seçici `scale`ı YAZAR (`g→0.001`, `cm→0.01`, `mm→0.001`, `kg/m→1`); "Ölçek" kutusu ileri düzey/salt görünür kalır. Kurulumcu ne görüyorsa o çalışır. Düzey: **CİHAZ satırı** (aynı fabrikada gramlık çuval kantarı + kg'lık palet kantarı olabilir) — kurulum anahtarı çöker.

**1. Mekanizma:** ② VERİ — mevcut `scale` (zaten okunuyor), yeni alan YOK, bir alan EKSİLİYOR.

**2. Bugün korunur (ölçüldü):** `scale null → 1` codec varsayılanı değişmez; üç cihazın üçünde `unit` kimlik değeri (kg/m) ve `scale` null → birebir aynı okuma.

**3. Geçiş (sıra):** (a) backend Zod `unit`i **kabul edip yok sayar** bir sürüm (alan kaldırma = sözleşme tetiği; eski panel 400 almasın); (b) migration ÖNCE dönüştürür: `unit IN ('g','gr') AND scale IS NULL → scale 0.001`, `'cm' → 0.01`, `'mm' → 0.001`, kimlik değerleri dokunulmaz, çelişkili (`unit=g ∧ scale≠null≠0.001`) satır **listelenir ve migration DURUR** (canlı kurulumda dry-run dökümü); (c) kolon düşürülür. Bu fabrikada (b) sıfır satır dönüştürür.

**5. Kapsam — ağırlık başka yoldan girer mi:** üç yol: kantar okuması (scale — bu karar), **elle giriş** (`shipping.manualWeightRestrictedEnabled`), **simüle** (`shipping.simulatedWeightEnabled`, `source:'SIMULATED'`). Üçü de backend'e `weightKg` olarak girer ve tavan pratikte yok. İkinci hat [ÇEKİRDEK]: `weightKg > 1.000` → `warnings` "çuval için olağandışı ağırlık" + audit (BLOK DEĞİL — palet ambalajı gelirse (tarama #7) tavan ambalaj türüne bağlanır; bugün hiçbir kumaş çuvalı bir ton değildir, uyarı eşiği bayrak istemez). Metre cihazı için aynı sınıf: tambur metre okuması `> 10.000 m` uyarı. Her ikisi `ApiResponse.warnings` (kategori düzeyi UYARIR, özellik düzeyi REDDEDER kuralı).

---

## Ortak: bekçi ve sıra
- ①: AST tripwire (grade literal) + katalog rol partial unique envanteri (`test_db_invariants`) + tablet negatif sondası (rolsüz katalogda kesim 400).
- ②: `OrderLine.unit = Item.unit` mutabakatı + Zod↔create allowlist ikizi + KG satırda `shippedQty` yazılmadığının negatif sondası (KG kalemli fixture sevk → shippedQty 0, warnings dolu).
- ③: migration dry-run dökümü + `scale` seçici round-trip testi (g seç → 0.001 yazıldı) + tavan uyarısı bekçisi.
- Sıra önerisi: ③ (bir satır + küçük migration, yasal belge riski) → ① (katalog rolü + 8 site, tek commit yol başına) → ② (şema + allowlist + rapor başlıkları; "örme dilimi" ayrı tasarım olarak kuyruğa).
- Hepsi sürüm notu maddesi: ① rolsüz katalogda 400, ② KG/ADET satırda karşılama ölçülmez uyarısı, ③ form alanı değişti.


---

# Mobil ikinci tur — A/B/C/D KARARI (2026-09-12 gece, Fable; salt okuma, ağaca yazılmadı)

> Ölçüm fabrikanın dev kopyası + ağaç. Beş soru: mekanizma+DÜZEY · bugünkü davranış birebir (ölçülmüş) · geçiş · kapsam. B kısa.

---

## A — `Tambur:1839` `defectTypes[0]?.id` · `KursunQc:250` `code === 'GENEL'`

**Ölçüm.** Katalog 3 satır, ad sırası (tabletin sırası): `GENEL "Genel Hata" MINOR` · `LEKE MINOR` · `YIRTIK MAJOR`. Bu fabrikada `[0]` = GENEL = zararsız; `'GENEL'` terfisi zaten ilk sırada olduğu için no-op. Kayıtlı hata noktası **3** (LEKE 1, GENEL 1, YIRTIK 1) — canlı etki bugün küçük, sınıf (kalite verisi liste sırasından) büyük. Şema `DefectType`: `code · name · description · severity? · isActive` — **`sortOrder` YOK, `isDefault` YOK**. Backend sözleşmesi: `tambur.controller.ts:77 defectTypeId: z.string().uuid()` ZORUNLU, `kursun-qc.controller.ts:41` ZORUNLU ("Hata tipi seçilmelidir"), `inventory.controller.ts:164` opsiyonel. Yani tablet `[0]`ı sözleşmeyi doyurmak için uyduruyor.

**1. Mekanizma + düzey — ② VERİ + ③, ikisi birden (dışlamıyor):**
- `DefectType.isDefault Boolean @default(false)` + partial unique `WHERE isDefault` — **KATALOG satırı** düzeyi (kurulum verisi: "operatör tip belirtmezse hangi kova"). Bayrak değil, satır değil: aynı fabrikada hata başına değişen şey tipin kendisi ve o zaten ③ (operatör seçer).
- Tablet: seçim yoksa `isDefault` satırı; **isDefault de yoksa ekleme 400/blok** ("Hata tipi seçin") — `[0]` dalı SİLİNİR. İki ekran aynı çözücü (`resolveDefaultDefectType(catalog)`), `'GENEL'` terfisi `isDefault` satırını ilk sıraya alır (kod literali gider).
- Panel katalog ekranına "Varsayılan" seçici (tek satır, partial unique çakışınca 409 Türkçe).

**2. Bugün korunur (ölçüldü):** migration `code = 'GENEL'` satırına `isDefault = true` damgalar (geçiş literali, son kullanım; GENEL yoksa hiçbir satır damgalanmaz). Bu fabrikada `[0]` zaten GENEL → tipsiz ekleme aynı satıra yazar, terfi aynı sırayı verir: **sıfır fark**. Varsayılansız kurulumda (ikinci müşteri, GENEL yok) tipsiz ekleme **400** — bugün liste sırasından uyduruyordu; fail-closed, sürüm notu maddesi.

**3. Geçiş:** kayıtlı `roll_errors` DOKUNULMAZ (3 satır; hangisinin "uydurma" olduğu bilinemez, kanıtsız satıra dokunulmaz). Eski tablet `[0]` göndermeye devam eder (sözleşme değişmiyor); yeni tablet isDefault okur.

**5. Kapsam:** hata tipi yazan üç yol (Tambur `reportError` · KursunQc `addDefect` · inventory `errors` opsiyonel) — üçü de `defectTypeId` alır, uydurma yalnız tablette. Panel hata girişi (Electron) `[0]` uyduruyor mu → **ölçülmedi**, sahibi baksın (grep `defectTypes[0]` Electron/src). Bekçi: `test_db_invariants` partial unique envanteri + mobil "isDefault yoksa tipsiz ekleme blok" negatif sondası.

### A — Çelişmeli doğrulama (2026-09-14, 47; ea `297b71ea` → origin `f87cb6e5`, taban `cb435108`)

**Sonuç: mekanizma ayakta — tek boğaz, 400 kodu gerçek dosyada, tek tx, partial unique seddi, GENEL geçişi canlı dump'ta idempotent, mobil eski backend'de kırılmıyor, panel izin/rozet. Karara göre İKİ SAPMA (hüküm 1e): migration GENEL YARATIYOR (karar "GENEL yoksa hiçbir satır damgalanmaz" diyordu) · KursunQc `'GENEL'` literali kaldı (karar "iki ekran aynı çözücü, kod literali gider" diyordu). Üç küçük kalem (ea), K1 envanter kalemi tren sonunda kapandı (`cb435108`).**
Yöntem: klon DB'de 16 bekçi (`default_defect_type` 12/0 · `audit_labels` · `route_auth_coverage` · `quality_code_literal` · `null_quality_visibility` · `phase6_reporterror_concurrency` · `kursun_bulk` · `p2_kk2reopen` · `screen_catalog` · `permission_catalog` · `timestamptz_contract` · `mobil_enum_aynasi` · `swagger_spec` yeşil; `db_invariants` ❌ → K1, `cb435108`te kapandı; `migration_hygiene`/`sabit_liste_aynasi` kırmızısı ortam — dal WOTOL'dan önceydi) · en eski canlı dump provası (`tekserp_47prova_test`, 2026-09-11) · yedi sonda `scripts/` dışından · statik okuma. tsc/eslint ea'nın ölçümü, yeniden koşulmadı (tek ağır koşum kuralı).

| karar maddesi | sonuç | nasıl |
|---|---|---|
| §1 `isDefault` + partial unique `WHERE isDefault`, katalog satırı düzeyi | ✅ | şema + migration `20260914096000`; envanter `test_db_invariants` (`cb435108`) |
| §1 tek çözücü; tipsiz giriş varsayılana düşer, varsayılan yoksa 400 | ✅ backend | `resolveDefaultDefectTypeTx` tek boğaz; tipsiz yazan TEK yol `kursunFinish` (`inventory.controller` `defectTypeId` nullable) — Tambur/KursunQc uçları uuid ZORUNLU (Zod), `DefectType` yazan src'de yalnız BaseService + helper; 400 `DEFAULT_DEFECT_TYPE_MISSING` `details.code`ta, bekçi §2 gerçek katalogda tx geri alarak ölçüyor |
| §1 "iki ekran aynı çözücü, `'GENEL'` terfisi `isDefault` satırını öne alır (kod literali gider)" | ❌ SAPMA | Tambur `find(isDefault)` ✅; **KursunQc `:246-253` hâlâ `code === 'GENEL'` literaliyle sıralıyor** — admin başka tipi varsayılan yapınca KursunQc yine GENEL'i öne koyar; ortak mobil çözücü yok |
| §1 panel "Varsayılan" seçici, tek satır, çakışma 409 Türkçe | ✅ | form kutusu + rozet; `POST /:id/set-default` + `isDefault:true` gövdesi aynı tx'ten (`setDefaultDefectTypeTx`: eski düşer, yeni yükselir); yarışta P2002 → 409 "Bu 'isDefault' değeri zaten mevcut" (etiket haritasında yok — ham kolon adı) |
| §2 migration `code='GENEL'` satırını damgalar; **GENEL yoksa hiçbir satır damgalanmaz**, varsayılansız kurulumda 400 + sürüm notu | ❌ SAPMA | migration GENEL yoksa **YARATIR** (`INSERT … WHERE NOT EXISTS`), pasifse **AKTİFLEŞTİRİR** (S4) — ikinci müşterinin kataloğuna literal adlı satır girer; sürüm notu bunu söylüyor ("GENEL adlı tip oluşturulup varsayılan yapılır") ama karar metni tersini söylüyor. Canlı dump: 3 tip, GENEL zaten var → UPDATE dalı, 3/1 varsayılan; ikinci koşum `INSERT 0 0 / UPDATE 0`; varsayılan başka tipte + GENEL pasif → dokunmaz (S3) |
| §3 `roll_errors` dokunulmaz; eski tablet `[0]` göndermeye devam eder | ✅ | dump'ta tipsiz hata 0 → 0; Tambur/KursunQc sözleşmesi değişmedi |
| §5 Electron `defectTypes[0]` uydurması (ölçülmemişti) | ✅ kapandı | Electron'da hata girişi yüzeyi YOK (`defectTypeId` yalnız audit etiketinde); uydurma 0 |
| §5 bekçi: envanter + mobil negatif sonda | ✅ / ⚠️ | envanter `cb435108`; mobil sonda STATİK (`[0]` yok, `find(isDefault)` var) — "isDefault yoksa blok" davranışı ölçülmüyor, tsx'te toast dalı |
| C1 mobil eski backend'de (`isDefault` undefined) kırılmaz | ✅ | tip `isDefault?`; `find` → undefined → toast "Hata tipi seçilmedi"; liste `isActive:'true'` süzgeçli → pasif varsayılan tablette seçilmez |
| dört kapı / izin | ✅ n/a | yeni ekran yok: `definitions/defect-types` (`quality:read` · capability `quality:write`) mevcut; sayfa `writePermission="quality:write"`; set-default `requirePermission("quality:write")` + audit tx dışında; `route_auth_coverage` · `swagger_spec` yeşil |

**Sondalar (prova DB):** P1 eş zamanlı iki set-default ×12 → 24/24 ok, her turda tam 1 varsayılan; P1b ZORLANMIŞ pencere (A `updateMany`→bekle→`update`, B araya) → B P2002, tek varsayılan A — sed tutuyor · P2 `create(isActive:false)` + `isDefault:true` → setDefault 400 ama kayıt KALDI · P3 varsayılan pasife alınınca `findDefaultDefectType` null → tipsiz giriş 400, pasife alma anında uyarı yok · P4 `PATCH {isDefault:true}` tek başına → `update({})` ok · P5 tek tx set-default tek varsayılan.

**Kalemler (ea)**

- **K1 · `test_db_invariants` envanteri `defect_types_one_default` — KAPANDI `cb435108`** (297b71ea envanter bekçisini koşmamıştı; #60 tam paket ❌ §1).
- **K2 · `writeWithDefault` atomik değil (küçük).** create/update ile `setDefaultDefectType` AYRI iki tx: `POST { isActive:false, isDefault:true }` → kayıt yazılır, sonra 400 "pasif tip varsayılan yapılamaz" — istemci 400 görür, satır kalır (P2). Çare: tek `$transaction` (create + `setDefaultDefectTypeTx`) ya da `wantDefault && isActive === false` ön kontrolü.
- **K3 · Varsayılan pasife alınınca sessizce varsayılansız kalınır (küçük).** `PATCH isActive:false` / `DELETE` (softDelete) mevcut varsayılana dokununca `isDefault` durur ama `findDefaultDefectType` `isActive` ister → tipsiz giriş 400; pasife alma anında ne ret ne `warnings` (P3). Emsal: sebep kataloğu "son aktif satır gizlenemez". Çare: varsayılanı pasife almayı reddet (önce başka tipi varsayılan yap) ya da `isDefault`u düşürüp `warnings` ile söyle.
- **K4 · KursunQc `'GENEL'` literali (karar §1 sapması, küçük; mobil sahibi).** `KursunQcScreen.tsx:246-253` "Saha #18 GENEL ilk tuş" `code === 'GENEL'`; karar `isDefault` satırını öne almayı ve iki ekranın aynı çözücüyü kullanmasını istiyor. Kalite kodu literali kapısı (`test_quality_code_literal`) bu literali görmüyor (kalite kodu değil, hata tipi kodu).

**Hüküm isteyen (1e):** §2 sapması — migration GENEL yaratsın mı (ea'nın seçimi: yükseltmede 400 sürprizi yok, ikinci müşterinin kataloğuna literal satır girer) yoksa karar metni mi (GENEL yoksa damga yok, tipsiz giriş 400 + sürüm notu)? İki metin bugün yan yana: karar §2 ↔ sürüm notu. Hangisi kalırsa öteki "GEÇERSİZ" damgası alır.

**Notlar:** `resolveDefaultDefectTypeTx(prisma, …)` kursunFinish'te tx DIŞINDA çağrılıyor (ad `Tx` ama `prisma`) — çözüm ile yazım arasında varsayılan değişirse eski varsayılan yazılır, pencere ms; kalem değil · BaseController.create/update ince sarmalayıcı (yalnız `service.create` + 201) — route'un doğrudan servise inmesi doğrulama atlatmıyor · `isDefault` yeni skaler = `sanitizeWriteData`dan geçen yazılabilir alan (kök CLAUDE.md uyarısı) — `true` yolu route'ta yakalanıyor, `false` düz; tasarım böyle · Prova DB `tekserp_47prova_test` DROP listesine.

---

## B — `KK1:3379` `isInactive = status === 'SCRAP'` — KISA

**Ölçüm.** KK1 iki listesi (`:762-776` son kayıtlar, `:2725-2742` geçmiş) `status` GÖNDERMİYOR; backend `inventory.service.ts:1360-1369` "statusIn > status > **default STOCK**" → `where.status = STOCK`. Yani CANCELLED de SCRAP de bu listelere **zaten giremiyor** (203 CANCELLED KK1 kaynaklı top var, hiçbiri listeye düşmez). KK1'in kendi yorumu (`:752-753` "status filtresi vermiyoruz ki tüm statüsler görünsün") **yanlış** — backend STOCK'a daraltıyor; KK1'in doğurduğu her top STOCK olduğu (semiFinished `forcedStatus: STOCK`, renksiz STOCK) için görünür fark yok. Sonuç: `=== 'SCRAP'` yüklemi **iki yönde ölü** — yanlış ama bugün ısırmıyor. Ölü küme tek kaynağı `K18_DEAD_STATUSES` (`batch.service.ts:55`: SUBCONTRACTOR_CONSUMED · TAMBUR_CONSUMED · KARTELA_CONSUMED · CANCELLED — SCRAP BİLEREK dışında); mobil aynası yalnız `TamburScreen.tsx:6125 ARCHIVED_ROLL_STATUSES` (dosya-yerel, "backend'e yeni statü eklenirse burası da güncellenmeli" yorumuyla); bekçi `test_tambur_manual_batch.ts:114/213` yalnız backend kümesini ölçüyor, **ayna bekçisi YOK**.

**Karar:** (a) mobil tek kaynak **YENİ dosya** — `mobil/src/constants/` altında `rollStatus.ts` (henüz YOK, bu kararla yazılacak), içinde `DEAD_ROLL_STATUSES` (Tambur'un yerel listesi oraya taşınır), KK1 `isInactive = DEAD_ROLL_STATUSES.includes(status)` (SCRAP ayrı, "fire" rozeti olarak — K18'in bilinçli dışlaması korunur); (b) **ayna bekçisi**: `scripts/test_*` mobil dosyayı metin olarak okuyup `K18_DEAD_STATUSES` ile iki yönlü eşitlik ölçer (`stock_on_hand_statuses()` diller-arası ikiz emsali); (c) KK1 `:752` yorumu düzeltilir. Davranış değişikliği **yok** (ölçüldü: liste STOCK'a daralı). Sürüm notu maddesi yok. Düzey: kod sabiti (çekirdek küme), veri değil.

---

## C — KursunQc istasyon kimliği (5 belirti) — backend #4'ün tablet ikizi

**Ölçüm.** Fabrikada kalite istasyonu **1** (`KURSUN_KK2`, kind PROCESS_QC, appliesQuality ✓) → tek-KK. Route `kursun-qc.routes.ts:40 /by-card/:barcode` ve `:87 /open-cards` **parametre almıyor** (stationId yok). Oturum istasyon DTO'su `work-session.service.ts:67 select { id, code, name, kind }` — **`appliesQuality` telde YOK**; mobil `Station` tipi `kind?` taşır, yetenek taşımaz. `SessionGate.tsx:54` `active.station.kind === expectedKind` (kind, id değil); `stationScreens.ts` 1:1. `KursunStepSummary.stationId/stationName` var, `activeSession.station.id` var — karşılaştırma yok. `:447 cardId: barcode`, `:408` COMPLETED → reopen teklifi.

**1. Mekanizma + düzey — ② VERİ (oturumun istasyonu), backend #4 ile AYNI TURDA:**
- İstek: `by-card/:barcode?stationId=` ve `open-cards?stationId=` (opsiyonel); backend #4 `assertWoAtStepKind`'i kind yerine `step.stationId === stationId` ile çözer, stationId yoksa **bugünkü kind dalı** (eski tablet aynı davranır — zorunlu parametre DEĞİL, minVersion yok).
- Tablet: her çağrıya `activeSession.station.id`; dönen `step.stationId ≠ session.station.id` → **409 banner** "kart bu istasyonun değil (X)" — açılmaz, reopen TEKLİF EDİLMEZ (`:408` teklifi yalnız aynı istasyon + `stepSequence` eşleşmesinde). Reopen ayrıca `mobile:kk2-reopen` izni (SoD sınıfı — Tambur'dan top çeker; bugün her operatöre açık).
- İş kimliği `workOrderStepId` (`:447`); aynı kart ikinci geçişte yeni sekme.
- `open-cards` istasyon filtreli → ACİL rozeti yalnız kendi birikiminden.
- Oturum DTO'suna `appliesQuality` (② telde) → `SessionGate` kind yerine `kind === PROCESS_QC || appliesQuality` (mevcut `QUALITY_STATION_WHERE`'in tablet ikizi); `stationScreens` haritası yetenek alır.
- Neden bayrak değil: aynı fabrika bir rotada tek, ötekinde iki KK kullanır — "hangi istasyondayım" oturum verisidir.

**2. Bugün korunur (ölçüldü):** tek kalite istasyonu → `stationId` gönderilse de aynı adım çözülür; `open-cards` aynı küme; reopen teklifi aynı koşulda çıkar; SessionGate PROCESS_QC istasyonunda aynı. **Sıfır fark.** İki-KK kurulumunda yeni davranış (banner, ayrı sekme, filtreli ACİL) — bugün orada zaten yanlış adıma yazıyordu.

**3. Geçiş:** backend önce (opsiyonel parametre, fallback = kind); tablet sonra. Eski tablet + yeni backend = bugünkü davranış. `appliesQuality` DTO'ya ek alan = kırmayan genişleme.

**5. Kapsam — mal başka yoldan girer mi:** kart açan ikinci yol `open-cards` satırına dokunma (`resolveCard`, aynı istasyon kontrolünden geçer); üçüncü yol elle barkod (`manualBarcodeEntry`) aynı `resolveCard`. Tambur ve KK1 kart okutmaları aynı `assertWoAtStepKind`i kullanıyor (backend #4 onları da kapsar; Tambur tabletine de `stationId` gönderilir — aynı commit). Bekçi: iki-KK fixture (boya öncesi PROCESS_QC + boya sonrası OTHER+appliesQuality) → ikinci istasyondan okutma ikinci adımı döner, birinciden "yeniden aç" teklifi ÇIKMAZ; negatif sonda stationId parametresi düşürülünce kırmızı.

---

## D — `KK1:928` kalite KALICI

**Ölçüm.** `deviceSettingsStore.ts:65 tamburResetQualityAfterCut` (cihazda, "bu tamburda nasıl çalışıyoruz" gerekçesi, varsayılan FALSE = bugünkü davranış); KK1'de karşılığı YOK (`kk1ManualEntry` var). KK1 formunda kalıcı alanlar: ürün · en · kalite (`:928` yorumu); metre/kg temizleniyor. Kalite ön seçimi `:733` (aile ①, karar ①'e bağlı).

**1. Mekanizma + düzey — ③ AKSİYON ANINDA görünürlük + cihaz ayarı, Tambur ikizi:**
- `deviceSettingsStore.kk1ResetQualityAfterSave: boolean` — **CİHAZ** düzeyi (Tambur emsali; aynı fabrikada karışık lot alan rampa ile tek kalite alan rampa farklı çalışır; kurulum anahtarı iki rampayı tek kurala zorlar). Kişiye değil yere bağlı → sunucuya gitmez.
- true → her kayıttan sonra kalite `isDefault`/FIRST rolüne döner (karar ①); false → bugünkü kalıcılık.
- Kalıcılık açıkken **görünürlük**: kalite çipi son kayıttan miras alınmışsa amber "önceki toptan" rozeti (③ — operatör her topta görür, dokunmadan geçmiş olur). Ürün/en kalıcılığı DOKUNULMAZ (lot özelliği, yargı değil).

**2. Bugün korunur (ölçüldü):** varsayılan `false` = kalıcı; rozet yalnız görsel, payload aynı. **Sıfır davranış farkı.**

**3. Geçiş:** cihaz ayarı, migration yok; eski tablet aynı.

**5. Kapsam:** kalite yazan ikinci KK1 yolu — çevrimdışı kuyruk aynı formu kullanır (ayarı okur); Electron "Manuel Top Ekle" panel formu kalıcılık taşıyor mu → **ölçülmedi**. Bekçi: `deviceSettingsStore` varsayılan tablosu testi (`kk1ResetQualityAfterSave === false`) + rozet render sondası.

---

## Sıra ve sürüm notu
- B (sıfır davranış farkı, bekçi + tek kaynak) → D (cihaz ayarı, sıfır fark) → A (migration + panel seçici; varsayılansız kurulumda 400 = sürüm notu) → C (backend #4 ile aynı tur; tek-KK'da sıfır fark, iki-KK'da yeni davranış = sürüm notu).
- Ölçülmedi, sahibine: Electron'da `defectTypes[0]` uydurması; Electron manuel top formunda kalite kalıcılığı.
