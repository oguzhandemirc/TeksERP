# Mükerrer · nameFold seddi

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 20 üye, ama konuya AİT olan 4 kök notu: 2026-08-21 (nameFold seddi), 2026-08-22 (mükerrer paneli v2), 2026-08-22 (mutabakat §18), 2026-08-25 ② (renk seddi). Kalan 16 üye "mükerrer" kelimesiyle toplanmış gürültü ve kendi kümelerinde canlı (idempotency/KK1 tuzağı → kk1-idempotency-kuyruk; scanFeedback/ScannerRollStrip mükerrer bipi → mobil; mergeDocsForPrint → belge; keşif/mobil güncelleme/sebep adımı → kendi kümeleri) — burada kural üretilmedi. 2026-08-25'in ① kur.ps1 ve ③ deploy maddeleri deploy-kurulum kümesinin işi. En riskli durum ÇELİŞKİ değil BAYATLIK: iki notun da "sed kapsamı 3 tablo (+renk), items dev'de atlanıyor" cümlesi kodda 2026-08-30/31 ve 09-01 migration'larıyla aşıldı (15+ tablo sedli) ve HİÇBİR not bunu yazmıyor; ayrıca kimlik kuralına 2026-09-01'de yer-tutucu bastırma eklendi.


## Ortak (backend + panel + tablet)


### Değişmezler


- **[ÇEKİRDEK]** Tekillik TABLOLAR ARASI sorulur: aynı gerçek nesneyi iki master tabloda tutan bir tasarımda tek tablo içi `@@unique([nameFold])` çakışmayı GÖRMEZ; yeni bir master model, ROL bayrağı mı yoksa ayrı KİMLİK mi olduğu ölçülmeden doğmaz ve iki master tabloyu XOR ile bağlayan her alan çifti SINIFIYLA (borç ↔ iki-rol) beyan edilir. · bekçi: `scripts/test_master_data_kimlik_tekilligi.ts` <sub>(çapa: `docs/standart/MASTER-VERI-TASARIMI.md`)</sub>
- **[ÇEKİRDEK]** Türkçe harf katlaması TEK helper'dan (`utils/tr-case.ts` `upperTr`/`lowerTr`; `"tr-TR"` yalnız orada yazılır) — AD içindir, KOD için `foldCodeForCompare` (i/İ); içe aktarımda KOD anahtarı `importKey` (= `foldCodeForCompare`, `services/import/import-key.ts`) — yazan (`import.service`) ↔ okuyan (adaptör `findExisting`) aynı helper'ı çağırır, tek yanlı taşıma bugün olmayan kusuru doğurur. · bekçi: `scripts/test_tr_case.ts (DB'siz; i/İ oracle + adaptör simetrisi)`
- **[ÇEKİRDEK]** Birleştirme artık DEFTERLİ ve geri alınabilir: `MergeOperation` + kaynak künyesi + taşınan/silinen/zenginleşen referans satırları yazılır; geri alma en yeniden eskiye (LIFO) yapılır, adı çakışan kaynak için YENİ AD ister, geri yazılamayan satırı `skippedRows` olarak bildirir, defter öncesi birleştirmeyi reddeder. · bekçi: `test_master_data_merge_revert.ts` <sub>(arşiv:2026-09-12)</sub>- **[ÇEKİRDEK]** Ad mükerrerinin son hattı DB seddidir: `<tablo>_nameFold_key` UNIQUE. Ana veri BİRLEŞTİRMESİNE katılan tabloda partial (`WHERE "mergedIntoId" IS NULL` — mezar taşı aynı adı meşruen taşır), katılmayanda DÜZ UNIQUE. Sed uygulama guard'ının AYNASIDIR, ondan gevşek olamaz. · bekçi: `test_db_invariants PARTIAL_INDEXES + test_master_data_name_dup §10` <sub>(CLAUDE.md:78)</sub>
- **[ÇEKİRDEK]** Uygulama bekçisi `assertNameNotDuplicate` KALDIRILMAZ — Türkçe, kod bilgili 409'u ('zaten var' ↔ 'PASİF, aktifleştirin') o verir. Ama KİLİTSİZ check-then-act'tir (`create()` tx bile açmaz): yarışı, `duplicateNameField` unutulmasını, içe aktarım fail-open'ını ve elle SQL'i yalnız DB seddi kapatır. · bekçi: `test_master_data_name_dup §9/§10` <sub>(CLAUDE.md:78)</sub>
- **[ÇEKİRDEK]** Survivorship'te (P2) seçim DEĞER değil KAYIT üzerindendir (`fieldPicks[alan]=kayıtId`) — serbest metin uçu sınırsız alan düzenleme API'sine çevirirdi; `code` ve kimlik alanları seçilemez. ⚠️ SIRA LOAD-BEARING: survivor alan yazımı ATOMİK CLAIM'DEN SONRA, yoksa ad taşıma P2002 verir. · bekçi: `test_merge_field_picks` <sub>(CLAUDE.md:80)</sub>
- **[ÇEKİRDEK]** Mükerrer TOP birleştirilmez, İPTAL edilir (`MUKERRER`): top işlem kaydıdır, birleştirmek metrajı toplamak olurdu. İptal topun KENDİ ucundan yapılır (etiket/çuval/sevk guard'ları atlanmasın), toplu iptal ucu BİLİNÇLİ YOK; 'asıl' = etiketi BASILAN top; tespit `duplicate-rolls.service`te. · bekçi: `test_duplicate_rolls` <sub>(CLAUDE.md:80)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Renge DÜZ `nameFold` seddi KOYMA: renk mükerreri ayraç ve sayı-sırası bağımsızdır (`foldColorNameForCompare`), düz kısıt uygulama kuralından zayıf kalıp yanlış güven verir. Sed `tr_fold_color(name)` İFADESİ üzerinde partial UNIQUE'tir (`colors_nameFoldColor_key`). · bekçi: `test_db_invariants EXPRESSION_UNIQUES (test_db_invariants.ts:473-477)` <sub>(CLAUDE.md:84)</sub>

### Kararlar

- **[ÇEKİRDEK]** Enforce bekleyen kurulumda `test_db_invariants` §1 / EXPRESSION_UNIQUES satırının KIRMIZI kalması BİLİNÇLİDİR ('enforce bekliyor' sinyali, unutulmasın diye) — bekçiyi bu yüzden daraltma; ad mükerrerini temizlemek mükerrer panelinin ve iş kararının işidir, toplu UPDATE'in değil. · bekçi: `test_db_invariants §1` <sub>(CLAUDE.md:78, CLAUDE.md:81)</sub>
- **[ÇEKİRDEK]** Kimlik alanına (VKN vb.) DB seddi BİLİNÇLİ KONULMAZ: aynı tüzel kişiye ikinci cari kart meşru bir iş kararı olabilir; kimlik alanı sektörde EŞLEŞTİRME SİNYALİDİR, tekillik kısıtı değil — aday kuyruğa düşer, yazma engellenmez. <sub>(CLAUDE.md:80)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Mükerrer kararı ÇİFT bazlıdır (`duplicate_reviews`, `pairKey = min(aId,bId):max(aId,bId)`): NOT_DUPLICATE çifti kalıcı gizler, DEFERRED işaretler, MERGED'i motor yazar (`MasterDataMergeService.merge` sonrası best-effort hook). · bekçi: `test_duplicate_detection` <sub>(CLAUDE.md:80)</sub>
- **[ÇEKİRDEK]** `GET /<kaynak>/similar-names` route dosyasında `/:id`den ÖNCE tanımlanır; sonra gelirse Express onu id sanar, `assertValidUuid` 400 verir ve panelde uyarı ÇİZİLMEZ — yerine geliştirici jargonlu bir hata toast'ı çıkar (apiClient'ın 4xx dalı bileşenin catch'inden önce koşar). `SimilarNamesWarning` çizen her ekranın router'ında bu uç vardır. <sub>(2026-09-12 devere denetimi)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `R:2026-08-21__2026-08-21-namefold-db-seddi` → `R:2026-08-22__2026-08-22-mukerrer-paneli-v2`: Sed migration'ının kapısı: 'mükerrer varsa RAISE EXCEPTION, deploy DÜŞER' → 'yumuşak kapı: o tablonun index'i ATLANIR + NOTICE, deploy geçer; temizlik sonrası aynı dosya yeniden koşulur (idempotent enforce)'. Sebep: sıfırlama rafa kalkınca kısıt prod'daki her deploy'u bloke ederdi (expand→backfill→contract). ✅ çürütmeden geçti
- **KISMI** `R:2026-08-21__2026-08-21-namefold-db-seddi` → `R:2026-08-25__2026-08-25-prod-un-uc`: 'Renk BİLİNÇLİ HARİÇ (renge sed yok)' → renge sed KURULDU, ama düz nameFold üzerinde değil `tr_fold_color(name)` İFADESİ üzerinde partial UNIQUE (`colors_nameFoldColor_key`, mergedIntoId IS NULL, yumuşak kapı). 'Düz nameFold renkte zayıf' gerekçesi korundu, sonucu tersine döndü. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-21__2026-08-21-namefold-db-seddi` → `KOD:20260831120000_namefold_sed_kalan_tablolar + 20260901130000_name_fold_sed_depo_finans (nota yazılmamış)`: Sed kapsamı '3 tablo (customers·items·subcontractors)' değil: 2026-08-31'de defect_types·fabric_properties·peripheral_devices·product_recipes·quality_grades·return_reasons·routes + machines (KAPSAMLI: stationId,nameFold), 2026-09-01'de warehouses·cash_boxes·bank_accounts (mergedIntoId YOK → DÜZ unique) eklendi. Envanter bekçisi §10 doğdu. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-25__2026-08-25-prod-un-uc` → `KOD:20260830090000_items_ad_kod_seddi + scripts/fix_kumas_kod_cakismasi.ts (nota yazılmamış)`: 'V-1430 kaldı → items seddi dev'de atlanır (dev'in tek kırmızısı)' bitti: 6 sıfır-kullanımlı kayıt temizlik script'iyle silindi, ardından items'a HEM ad (items_nameFold_key) HEM harf-duyarsız KOD seddi (items_code_fold_key ON upper(code)) sert olarak kuruldu. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-22__2026-08-22-mukerrer-paneli-v2` → `KOD:bba838ce 2026-09-01 duplicate-detection.service (nota yazılmamış)`: Kimlik kuralı artık her eşit değeri aday çift saymıyor: bir kimlik DEĞERİ IDENTITY_MAX_GROUP(=4) kayıttan fazlasında geçiyorsa YER TUTUCU sayılır ve çift ÜRETMEZ; bastırılan değer `suppressedIdentities` ile raporlanır. 'Kuyruğa aday düşer, yazma engellenmez' cümlesi bu kapsamda daraldı. ✅ çürütmeden geçti
- **TAM** `R:2026-08-22__2026-08-22-mukerrer-paneli-v2` → `R:2026-08-22__2026-08-22-mukerrer-paneli-v2`: Aynı notun arşiv metni içinde: 1-3. turun 'string-similarity.ts (Jaro-Winkler, token-SORT…)' kod tarifi 4. turda geçersiz — JW KALDIRILDI, skor sıralı KELİME hizalaması oldu (FIRM ortalama / PRODUCT en düşük çift). Arşivi okuyan JW'yi canlı sanabilir. ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `R:2026-08-22__2026-08-22-mukerrer-paneli-v2` ↔ `KOD:20260830090000_items_ad_kod_seddi`: İkisi de yürürlükte, ölçüt FARKLI: mükerrer VARKEN ya da bilinmezken sed yumuşak kapıyla iner (20260821/20260825/20260831 emsali); temizlik script'i önce koşup 0 çakışma ÖLÇÜLDÜYSE sed sert inebilir (20260830 emsali) — o durumda sıra pazarlık dışıdır. Yani 'yumuşak kapı' evrensel desen değil, ölçülmemiş veriye karşı savunmadır.

## Açık sorular

- `find_fold_duplicates.ts` TABLES/`enforce` haritası 2026-08-31 ve 2026-09-01 sedlerini TANIMIYOR: 8 yeni sedli tablo (defect_types, routes, machines…) `enforce` etiketi almamış, `warehouses`/`cash_boxes`/`bank_accounts` ise hiç taranmıyor (find_fold_duplicates.ts:62-72). 'Sed eklemeden önce bu script'i koştur' reçetesi bu tablolarda enforce durumunu yanlış (temiz) gösterir — bilinçli kapsam kararı mı bayatlık mı BELİRSİZ, notlarda kaydı yok.
- 2026-08-22 notu paneli 'DuplicatesPage (gerekçeli gruplar, çift başına Ertele/Mükerrer değil/Geri aç, CSV)' diye tarif ediyor; aynı gün `c6563fb4` 'panel v3 — ana ekran TAM LİSTE, yan yana karşılaştırma, listeden birleştirme' geldi (MergeDialog.tsx +212, DuplicatesPage.tsx 700 satır değişti). Kural değişmedi ama notun ekran tarifi bayat; hangi tarifin kalıcı olduğu notlardan çözülemiyor.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[PROFİL]** Mükerrer paneli P3a/b (şube · istasyon · makine · kategori sekmeleri) ÖLÇÜMLE ERTELENDİ — canlıda 0 mükerrer; reçete `docs/design/MUKERRER-PANELI-TASARIM.md` §9; yeniden önerilmeden önce ölçüm tekrarlanır. Bulanık eşleme ayarları `duplicatesFuzzyEnabled` / `duplicatesFuzzyThresholdPct` (Ayarlar → Müşteriler; dört kapı). <sub>(kök 2026-08-22)</sub>

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_color_name_dup`, `test_tr_case`, `test_consistency`, `test_data_integrity_gaps`, `test_db_invariants`, `test_duplicate_detection`, `test_duplicate_rolls`, `test_fold_contract`, `test_item_code_case_uniqueness`, `test_master_data_merge`, `test_master_data_merge_conflicts`, `test_master_data_merge_fk_coverage`, `test_master_data_merge_race`, `test_master_data_merge_revert`, `test_master_data_name_dup`, `test_merge_field_picks`, `test_name_normalization`, `test_name_uppercase_storage`, `test_similar_names`, `test_subcontractor_management`, `test_turkish_search_fold`, `test_master_data_kimlik_tekilligi`

İstemci: `SimilarNamesWarning.test.tsx`⚠️, `similar-names-coverage.test.ts`⚠️, `searchFold.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-21 · 2026-08-21 — SIFIRLAMA PENCERESİ: nameFold DB SEDDİ (3 tablo) + sebep KODU topun satırında — `CLAUDE-NOT-ARSIVI.md:452-463`
- 2026-08-22 · 2026-08-22 — SIFIRLAMA RAFA KALKTI: nameFold seddi YUMUŞAK KAPIYA çevrildi; mükerrer paneli tasarımı — `CLAUDE-NOT-ARSIVI.md:469-472`
- 2026-08-22 · 2026-08-22 — MÜKERRER PANELİ v2 P1 UYGULANDI — `CLAUDE-NOT-ARSIVI.md:481-484`
- 2026-08-25 · 2026-08-25 — Prod oturumunun üç "dev'de yapılacaklar" notu teyit edildi ve uygulandı (kur.ps1 · renk seddi · d — `CLAUDE-NOT-ARSIVI.md:810-839`
- 2026-09-17 · 2026-09-17 — Master veri kimlik tekilliği: tekillik TABLOLAR ARASI sorulur [ÇEKİRDEK] — `CLAUDE-NOT-ARSIVI.md` §2026-09-17 master veri
