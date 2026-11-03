# Numaralandırma · numara serisi · ön ek
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/numaralandirma.md`.

Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Numarayı DOĞUŞTA tam string olarak kendi kolonuna yaz; ekran/belge/Excel/barkod o kolonu okur, sunumda biçimlendirici ÇAĞIRMA.
- **[ÇEKİRDEK]** Render'da biçimlenen tek istisna varsayılanı KAPALI "eski belgeler de değişsin" bayraklı alandır (bugün `shipping.sackSeqPrefixLive`, ön ek `Shipment.sackSeqPrefix`te donar); ekran ve belge AYNI resolver'ı çağırır.
- **[ÇEKİRDEK]** Seri KİMLİĞİ koda (`src/constants/number-series-catalog.ts`), BİÇİMİ veriye (`number_series`); boot uzlaştırması eksik seriyi doğurur, `label`/`scanned`/`editable` tazeler, `prefix`/`dateSegment`/`digits`/`separator`/`retiredPrefixes`e ASLA dokunmaz.
- **[ÇEKİRDEK]** Sıfırlama dönemi tarih segmentinden türer (ayrı ayar yok); sayaç "aynı sabit baş SAYISAL max + 1"; yeni advisory uzayı açma. İstisna `number_series_counters` (`doffEvent`, `customerDeliveryNote`): satır yoksa aynı türetimle tohumla, kapsam = tam ön ek + biçim/sayaç parmak izi.
- **[ÇEKİRDEK]** Sıra `10^digits`'i aşarsa kod GENİŞLER, SARMAZ; tam-format doğrulaması `\d{digits,}` kabul eder.
- **[ÇEKİRDEK]** Master veri kodunu İSTEMCİ ÜRETMEZ: kod yoksa sunucu seriden üretir (`FSN`, `KAT` dahil); istemci kod gönderirse aynen kullanılır (içe aktarma).
- **[ÇEKİRDEK]** İstemcide gevşek ön ek çapası ön ekten SONRA rakam/ayraç ister (tüm ön eklere); bu `FSN…` firma kodunun `FS…` fason sevk belgesine düşmesini de engeller.
- **[ÇEKİRDEK]** ELLE kodlar (`manualSackNo`) seri biçimi dışındadır; okutma yüzeyinde ARAMA sınıflandırmadan ÖNCE koşar, tanınmayan kod aramaya düşer.
- **[ÇEKİRDEK]** Okutulan kodun türünü yalnız `classifyScannedCode` çözer; istemci ön eki REGEX ile sabitlemez, backend'de ikinci tam-format tablosu yazma.
- **[ÇEKİRDEK]** `/api/scan/series` ve `/api/scan/resolve` izin kodu TAŞIMAZ (yalnız `verifyToken`); yalnız BİÇİM meta verisi döner, `/resolve` KAYIT tablolarına inmez (yalnız `number_series` önbelleğini tazeleyebilir).
- **[ÇEKİRDEK]** Sayaç kapsamı biçim yürürlüğe girdikten sonra doğan kodlardır (`NumberSeries.formatChangedAt`); `matchesSeries` ile eleme sahte çözüm; üretilen kod var olanların üstünden atlar (tavan 10.000, dayanırsa açık hata).
- **[ÇEKİRDEK]** İade belge no listede KİMLİK SÜTUNUDUR, SUNUCUDA aranır (`RETURN_CODE_SEARCH_FIELDS`); panel numarayı yalnız OKUR, "lider kim" kuralını ve biçimlendiriciyi istemciye kopyalama.
- **[ÇEKİRDEK]** Müşteri kodunun biçimini `CustomerBarcodeSeries`te tut (`number_series` DEĞİL), sayacını `NumberSeriesCounter`dan al, doğuşta materyalize et; `Roll.barcode`a yazma, `RollCustomerCode` ile bağla, okutmada yalnız `resolveRollByScanCode` (belirsizlik 409 `CUSTOMER_CODE_AMBIGUOUS`).
- **[ÇEKİRDEK]** Müşteri kodunu yalnız `birthCustomerCodesTx` ile topu doğuran tx İÇİNDE üret (`label.customerCodeAt=TAMBUR_OUTPUT`, varsayılan `NONE`); sayaç kapsamı `counterScopeKey` + `formatChangedAt`; `formatChangedAt`i görünür biçim değişince yenile, tohumu aynı ön ekli TÜM kodlardan al.
- **[ÇEKİRDEK]** Müşteri serisini yalnız `expectedUpdatedAt` atomik claim'iyle değiştir (0 → 409 `SERIES_CHANGED`); seri tükenince üretimi durdurma (kodsuz top + `warnings`); müşteride kullanılmış (kaldırılmış dahil) kodu yeniden verme.
- **[ÇEKİRDEK]** İade no `RollReturn.returnNo` kolonundan okunur, türetilmez; numara BELGEYE aittir (`returnGroupId ?? id`), üyeler liderin numarasını kopyalar; tekillik belge başına (`returnGroupId IS NULL OR = id`); numarayı belge başına TEK KEZ üret, döngüde sayaç çağırma.
- **[ÇEKİRDEK]** Serbest metin ön ekte YAZMA yüklemi DAR (eğik çizgi reddedilir; `safeFileName`/`sheetBase`), OKUMA yüklemi GENİŞ kalır (donmuş ön eki süzer); Türkçe harf kalır.
- **[ÇEKİRDEK]** Numaralandırma ekranı KİLİTLİ serileri de çizer, kilidi `lockKind` ile ÜÇ ayrı cümleyle anlatır: yapısal · sayaç hazır değil · saha eski; kilitliyi gizleme.
- **[ÇEKİRDEK]** Kilit cümlesinin TEK KAYNAĞI sunucudur: `lockedReason` (neden) · `lockUnlock` (ne zaman) · `lockActor` (kim); panel yalnız rozet/vurgu taşır, cümle yazmaz; jargon yasak, ne YAPILABİLDİĞİNİ söyle.
- **[ÇEKİRDEK]** Kilidin OKUMA kolu (`seriesLock`) ile YAZMA kapısı (`assertSeriesFormatWritable`) aynı fazları (Faz B + Faz D) arar.
- **[ÇEKİRDEK]** Kilitli seride biçim alanları gizlenmez, PASİFLEŞİR ve önizleme ucuna istek atılmaz; hata BÖLÜMÜNE aittir, biçim hatası yalnız biçim kaydını bağlar.
- **[ÇEKİRDEK]** Sürekli bağlı düzenleme diyaloğunda taslağı satırın ANAHTARINA bağla; anahtarı uyuşmayan taslakla istek atma.
- **[ÇEKİRDEK]** Yazarken koşan uçlar (önizleme) global toast'u bastırır (`suppressErrorToast`), hatayı alan yanında gösterir; Zod doğrulama mesajları TÜRKÇE yazılır.
- **[ÇEKİRDEK]** Biçim kapıları SIRALI: YAPISAL (`lockedReason`) → SAYAÇ (`scopedCounter`) → İSTEMCİ (C0b) → DEĞER (`assertSeriesFormatAllowed`); panel aynı üçlüyü `lockKind` ile ayrı cümlelerle gösterir.
- **[ÇEKİRDEK]** Etki cümlesindeki sayının BİRİMİ beyanlı (`countTable.birim`: kayıt ↔ belge); sayım alanı zorunlu kolon olur ya da null eleyen KAPALI kapsam beyan eder (katalog ad yazar, yüklemi servis kurar).
- **[ÇEKİRDEK]** "Bugüne kadarki N … değişmez" sayısı ÖLÇÜLÜR (`countTable`); kaynağı olmayan seri sayı YAZMAZ ("0" deme).
- **[ÇEKİRDEK]** Önizleme SUNUCUDA hesaplanır, panel biçimlendirici yazmaz; biçim kapısı (karakter · hane · ayraç · ön ek çakışması) önizlemede de koşar.
- **[ÇEKİRDEK]** OKUTULAN serinin biçimi sahadaki panel VE tablet sunucu tabanlı sınıflandırmayı taşımadan değişmez (400 `NUMBER_SERIES_CLIENT_TOO_OLD`); eşik yeteneği taşımayan SON sürümdür (`FAZ_B_ONCESI`), tahmin değil; `web` muaftır.
- **[ÇEKİRDEK]** Okutulan serinin istemci kilidi EKSEN düzeyinde ve ÖLÇÜMDEN (`SCANNED_CLIENT_BREAKING_AXES`); kırılmayan seri kilitlenmez; tablo ↔ simülasyon iki yönlü eşlenir; kırılma = yanlış türe çözülme VE hiç tanınmama.
- **[ÇEKİRDEK]** Sayacı kapsam damgasına hazır olmayan serinin biçimi değiştirilemez (`scopedCounter` yoksa 400 `NUMBER_SERIES_COUNTER_NOT_SCOPED`); kapı KONFİGÜRASYON sınırındadır, üretimde değil; beyan katalogda.
- **[ÇEKİRDEK]** Tarih ile sıra arasındaki sabit parça (top barkodu `[HF]`) katalogdaki `infix` alanında yaşar ve biçimle BİRLİKTE taşınır; ayrı parametre yapma.
- **[ÇEKİRDEK]** Biçim değişimi GEÇMİŞE DOKUNMAZ: eski ön ek `retiredPrefixes`e düşer ve okutulur; geçmişi yeniden numaralandırma seçeneği SUNMA.
- **[ÇEKİRDEK]** Biçim açılan HER seri geriye uyumluluk matrisinden geçer (katalogdan keşif; eski kod tanınır · yeni kod tekil · sayaç İLK BOŞ sıradan · eski+yeni birlikte aranır); matris üretim yolunun KENDİ hesabını çağırır.
- **[ÇEKİRDEK]** Seriyi biçime AÇMAK üretecini `nextSeriesNo` (C0) yoluna taşımaktır; `scopedCounter: "hazir"` beyanlı her serinin üretecinin gerçekten o yoldan geçtiği ölçülür.
- **[ÇEKİRDEK]** Açılan her seri kayıt ekseninde (L2) servis yolundan fikstürle ölçülür; maliyet yüksekse "L1'de kaldı" GEREKÇEYLE beyan edilir; beyansız sessizlik kırmızıdır.
- **[ÇEKİRDEK]** Emekli liste geçmiş beyanıdır: yürürlükteki ön ek orada duramaz (`number_series_retired_not_current`); eskiye dönmek onu çıkarır; hiç kod üretmemiş ön ek emekliye ayrılmaz; kullanım `null` ise KORUNUR, düşürme yalnız ölçülmüş sıfırda.
- **[ÇEKİRDEK]** Katalog TOHUMU emekli ön ekler (`workOrder` → `RK`) hiç düşürülmez; kirli veri onarımı idempotent, damgasız, dry-run varsayılan: `scripts/fix_number_series_retired_prefixes.ts`.
- **[ÇEKİRDEK]** Ön ek çakışması kapısı yalnız TARAMA UZAYINDA (`scanned`) küreseldir, emekliler dahil; okutulmayan serilerde çakışma meşrudur (`KS`, `IADE`, `P`).
- **[ÇEKİRDEK]** SONUÇ kapısı: aday biçimin örnek kodu (ilk + taşmış sıra) başka okutulan türe çözülürse 409 `NUMBER_SERIES_SCAN_COLLISION`; okutulmayan serilerde de koşar; bugünkü biçimin de düştüğü tür devralınmıştır, engellenmez.
- **[ÇEKİRDEK]** Kullanıcı metinlerinde (seri adı · kilit/sayaç gerekçesi · açılma koşulu) tablo/fonksiyon/dosya adı, backtick, İngilizce tanımlayıcı GEÇMEZ.
- **[ÇEKİRDEK]** Panel hata mesajını yalnız `apiErrorMessage`den okur (`errors[0].message` dahil); ekran kendi okumasını yazmaz.
- **[ÇEKİRDEK]** Okutulan serinin ön eki ASCII büyük harf + rakam, en çok 6 karakter.
- **[ÇEKİRDEK]** Sınırda davranış veridir: `number_series.wrap` `false` → 409, `true` → `startValue`a sarar (bilerek mükerrer); sarma yalnız üst sınırla (`NUMBER_SERIES_WRAP_WITHOUT_MAX`); sarmalıda kaynak EN SON DOĞAN kod (`seriesCounterReadsLastBorn`).
- **[ÇEKİRDEK]** Aynı kolonu paylaşan iki seri ön ek tekilliğine takılır; istisna yalnız beyanlı, çift yönlü `exclusiveWith` ikizleridir.
- **[ÇEKİRDEK]** `infix` taşıyan seride tarih bölümü KALDIRILAMAZ (400 `NUMBER_SERIES_INFIX_NEEDS_DATE`).
- **[ÇEKİRDEK]** Okutulan seri istemci kilidinin gerekçesi iki yüzeyden ölçülür: sınıflandırma VE TAM-BİÇİM KAPISI (doğru çözülüp "aç/okut" sessizce çalışmaması).
- **[ÇEKİRDEK]** Top listelerinin sırası `ROLL_DISPLAY_ORDER` (doğuş anı birincil, barkod ikincil); barkodla metin sıralaması yapma.
- **[ÇEKİRDEK]** Biçim değişimi ETKİN etiket şablonunda barkodu taşırırsa 409 `NUMBER_SERIES_LABEL_OVERFLOW` (şablonları adıyla say); ölçülemeyen şablon `warnings`; genişlik Code128 kodlayıcısının KENDİ ölçümünden, emitter formülünden değil; kapsam `roll` + `sack`.

### Yasaklar

- **[ÇEKİRDEK]** Ön eki servis içinde LİTERAL yazma; `utils/code-format.ts` biçimlendiricilerini (`dailyCodePrefix` · `buildDailyCode` · `nextDailySeq`) yalnız `services/number-series.service.ts` import eder.
- **[ÇEKİRDEK]** Her seri bir `panelGroup`a ait OLMAK ZORUNDA; kilitli seri de çizilir; bölüm sırası ve başlığı sunucudan gelir, panelde kopyalanmaz.
- **[ÇEKİRDEK]** `countTable` olmayan seri `uretecBagi` ile BEYAN edilir.
- **[ÇEKİRDEK]** `countTable.model` Prisma DELEGE adıdır; her kaynaklı seri bir kez GERÇEKTEN saydırılır.
- **[ÇEKİRDEK]** Tablo paylaşan seriler (`Invoice.docNo` ×4 · `Cheque.docNo` ×4 · `Payment.docNo` ×2) sayımı `kapsam: "seri-onekli"` ile beyan eder; kapsam yürürlükteki + EMEKLİ ön eklerle sınırlı.
- **[ÇEKİRDEK]** Aynı tabloyu paylaşan serilerin ön ekleri birbirinin BAŞLANGICI olamaz (`SF` yanına `SFX` yok).
- **[ÇEKİRDEK]** Tanınmayan `kapsam` FAIL-CLOSED: sayım `null` döner, "hepsini say"a düşmez; `never` atamasıyla derlemede de yakalanır.
- **[ÇEKİRDEK]** Numara TEK OKUMADAN doğar: `resolveSeriesFormat` bir kez; `seriesPrefix`, `seriesSeqFrom`, `formatSeriesCode` aynı biçim nesnesinden; anahtardan kendi okumasını yapan sarmalayıcı yazma.
- **[ÇEKİRDEK]** Ön eki biçimden alıp HANEYİ literal yazma; kodu her zaman `formatSeriesCode` kurar.
- **[ÇEKİRDEK]** Numara kaynağı üç değerli (`FREE` · `SYSTEM` · `MANUAL`), varsayılan `FREE`.
- **[ÇEKİRDEK]** REJİMİ üretim anı, tarih segmenti DEĞERİNİ belge tarihi verir: üreteçler `resolveSeriesFormat`ı TARİHSİZ çağırır; `at` YALNIZ önizleme içindir.
- **[ÇEKİRDEK]** Biçim geçişi ileri tarihe yazılır, GEÇMİŞE yazılamaz (400 `NUMBER_SERIES_EFFECTIVE_FROM_PAST`); ileri tarihli yazma bugünkü biçime dokunmaz, vadede önbellek tazelemesi yürürlüğe alır (ayrı zamanlayıcı YOK).
- **[ÇEKİRDEK]** BEKLEYEN biçim panelde görünür, aynı tarihe kayıt onu değiştirir, iptal edilebilir; iptal SERT SİLME (taslak sınıfı, `revokedAt` YOK), atomik claim `effectiveFrom > now`, 0 → 409 `NUMBER_SERIES_NO_PENDING`; iptal audit'e yazılır.
- **[ÇEKİRDEK]** Panelde "biçim örneği" (sıra 1) ile "sıradaki numara" (sayacı tüketmeden, üretim yolunun KENDİ hesabıyla) ayrı gösterilir; ölçülemeyen seride "—", sayı uydurma.
- **[ÇEKİRDEK]** Üreteci olan seride örnek kod o üreteçten kurulur (`previewSeriesCode` `infix` yazmaz); tükenme uyarısı listede de görünür.
- **[ÇEKİRDEK]** Okutulan seriyle aynı kod şeklini bugün üreten seri panelde BİLGİ satırı taşır (engel değil); bugün `KS` ↔ `KS`.
- **[ÇEKİRDEK]** Okutulan kod EMEKLİ BİÇİMLERLE (her satır kendi segment/hane/ayracıyla) de denenir; emekli biçim eklemek üst kümedir.
- **[ÇEKİRDEK]** C0b biçim kilidi Faz B ve Faz D eşiklerine BİRLİKTE bakar; "minVersion yükseldi" tek başına kilidi AÇMAZ.
- **[ÇEKİRDEK]** Sınıflandırma tablosuna alan EKLE, var olanı DEĞİŞTİRME (`retiredFormats` opsiyonel; `prefixes` yerine konmaz).
- **[ÇEKİRDEK]** Biçim satırının kökeni veride beyanlı (`origin`: `MIGRATED_GUESS` · `RECORDED`); `isSentinel` biçimin tahmin olduğunu söylemez, ayrı sorudur.
- **[ÇEKİRDEK]** Biçimin gerçek kaynağı `number_series_lines`; `number_series` biçim kolonları yürürlükteki satırın önbelleğidir, TEK YAZAR ikisini AYNI TX'te yazar; `effectiveFrom` = `formatChangedAt`.
- **[ÇEKİRDEK]** `retiredPrefixes` geçmiş satırlarla iki yönlü eşleşir; tarihi bilinmeyen satır `isSentinel` beyanlıdır, sentinel tarih yalnız SIRALAMA taşır.
- **[ÇEKİRDEK]** İş emri numara kaynağı yalnız `workOrder.numberSource`; `workorder.partyCodeAuto` ondan TÜRER (FREE/SYSTEM→true · MANUAL→false), eski anahtara yazmak `numberSource`a yazar, DEĞİŞMEDİYSE yazılmaz.
- **[ÇEKİRDEK]** Eski bayraktan göç TEK SEFERLİK ve DAMGALI (`numbering.partyCodeAutoMigratedAt`), seri satırları yaratıldıktan SONRA koşar; ayar satırı yoksa `FREE` yazılır.
- **[ÇEKİRDEK]** Dört elle numara yolu (çuval · iş emri · sipariş · sevk partisi adı) `assertManualNumberAllowed`dan geçer (`SYSTEM`de elle 400, `MANUAL`de eksik 400, `FREE` bugünkü); her yolun kapıyı gerçekten çağırdığı ölçülür.
- **[ÇEKİRDEK]** OKUTULAN serinin (çuval, iş emri) elle değeri ASCII büyük harf/rakam olmalı ve `classifyScannedCode` onu KENDİ türüne çözmeli, yoksa 400; yalnız YENİ kayda uygulanır.
- **[ÇEKİRDEK]** Form için mod listesi `GET /api/feature-flags` yanıtına eklenir; YENİ bare-auth uç AÇMA.
- **[ÇEKİRDEK]** Numara kaynağı ayarı yalnız `manualEntry` beyanlı serilerde (bugün 4) anlamlı; bekçi dosyanın varlığını ölçer; diğer serilerde uç 400, panel alanı HİÇ ÇİZMEZ.
- **[ÇEKİRDEK]** Biçim kapısı hedef kolon genişliğine bakar: en kısa kod `@db.VarChar(n)`e sığmazsa 400 `NUMBER_SERIES_CODE_TOO_LONG`; envanter `constants/number-series-capacity.ts` (şemayla birebir); beyansız seride kontrol yapma.
- **[ÇEKİRDEK]** Tükenme uyarısı ÜÇ SONUÇLU (≥ %90 · uzak · ölçülemedi); üst sınırsız ve SARMALI seride yüzde `null` (gerekçeli), `digits` vekil sınır değil; yüzde yürürlükteki dönemin; eşik/hesap tek helper'da, panel ve `/api/admin/health` oradan okur.
- **[ÇEKİRDEK]** Tükenme `seriesUsedMaxFrom` ile okunur, `seriesSeqFrom` ile DEĞİL; kullanım üreteçle aynı kapsam (`formatChangedAt`) ve süzgeçten (`codeCountsForCounter`); ikiz rejimin kodu sayılmaz.
- **[ÇEKİRDEK]** Sayaç ayarları (başlangıç · adım · üst sınır) biçimden AYRI uç ve AYRI kilit; biçimi yapısal kilitli serinin sayacı ayarlanabilir.
- **[ÇEKİRDEK]** `ownCounter` seri (top barkodu · kısa parti no · sevk partisi adı) sayaç ayarlarını 400 ile reddeder; sessiz etkisizlik yasak.
- **[ÇEKİRDEK]** Kendi sayaç satırlı seride (`ownCounter` · `number_series_counters`) numarayı yazma tx'inden ÖNCE al; boşluk serbest, tekillik `@unique` + tx içi claim; top barkodunun tx içi devralınan yolları bekçi tabanında, yalnız düşer.
- **[ÇEKİRDEK]** Sayaç SIFIRLAMA yok (ölçülmüş): ekranda gerekçesiyle kapalı; ileri alma başlangıç değeriyle.
- **[ÇEKİRDEK]** Sayaç ayarı `formatChangedAt`e DOKUNMAZ.
- **[ÇEKİRDEK]** Sayaç kolonları NULL doğar, NULL = BUGÜNKÜ DAVRANIŞ (1, 1, sınırsız); varsayılan satırla üretilen kodun bugünküyle aynı olduğu ayrı kolla ölçülür.
- **[ÇEKİRDEK]** Başlangıç/adım/sınır hesabı tek saf helper'da (`helpers/series-counter.helper.ts`), `seriesSeqFrom` ve `nextSeriesNo` oradan geçer; ayarsız `max + 1`; atlama ADIM kadar ilerler, sınır DENEME sayar.
- **[ÇEKİRDEK]** Hane DOLGUDUR, kapasite değil; sayacı yalnız `maxValue` durdurur (409 `NUMBER_SERIES_RANGE_EXHAUSTED`) ve panel bunu söyler.
- **[ÇEKİRDEK]** Üretecini sürmeyen katalog satırı `uretecBagi` ile beyan edilir ve `lockedReason` taşır (bugün `roll`).
- **[ÇEKİRDEK]** Ön ek ile kodu İKİ AYRI `new Date()`ten kurma: `seriesCodePrefix` ve `buildSeriesCode` aynı açık tarihi alır.
- **[ÇEKİRDEK]** Tarih segmentinin hane ve çıktısı tek tabloda (`DATE_SEGMENTS`); istemci `DATE_LEN` haritaları aynadır, bekçiyle ölçülür; tanınmayan segment fallback değil hata verir.
- **[ÇEKİRDEK]** İstemci sunucunun seri tablosunu HEP-YA-HİÇ reddetmez: tanımadığı satırı atar, gerisini kullanır.
- **[ÇEKİRDEK]** İki eklem yeri (ön ek|tarih, tarih|sayaç) `seriesJoints`ten gelir; `separator2` yoksa `separator`; tarih yoksa ikinci eklem kurulmaz.
- **[ÇEKİRDEK]** Biçim satırı göçü SERİ BAŞINA idempotent: satırsız seri her boot'ta kolon önbelleğinden onarılır, satırlıya dokunulmaz.
- **[ÇEKİRDEK]** Yapılandırma paketinde numara serisi YAZMASI `updateSeriesFormat`tan geçer, kapı atlayan içe aktarım modu yok; önizleme kuru koşar, ÖNCESİ → SONRASI listeler; sayaç taşınmaz, beyanlıdır.
- **[ÇEKİRDEK]** Paketin numara serisi taşıması AYAR ŞİFRESİ ister; kapı İÇERİĞE takılır, bu türü taşımayan pakette şifre sorulmaz.
- **[ÇEKİRDEK]** Kaynakta örnek kod LİTERALİ yazma; örneği o kodu GERÇEKTEN üreten yoldan türet (`infix`li seride kendi üreteci).
- **[ÇEKİRDEK]** Seriden türetilen örnek İSTEK ANINDA üretilir (fonksiyon/getter), modül yüklenirken DEĞİL.
- **[ÇEKİRDEK]** YAPISAL kilit (`lockedReason`) kümesi KAPALI, bugün iki üye: top barkodu ve kısa parti no; gerekçesi çürüyen kilit kaldırılır; yeni kilitte gerekçe önce ölçülür.
- **[ÇEKİRDEK]** Üreteç birden çok dosyadaysa `scopedCounter.uretec` LİSTEDİR ve kapı her dosyayı açar (bugün iş emri, fason sevk).
- **[ÇEKİRDEK]** Kapsam damgası yalnız yükleyici DOĞUŞ ANINI taşırsa uygulanır; çıplak string listesi döndüren yükleyici yasak, satır biçimi de ölçülür.
- **[ÇEKİRDEK]** Kodu çağıranın kurduğu toplu yollar (kartela kabulü) SIRAYI `scopedNextSeq` çekirdeğinden alır; ikinci sıra hesabı yazma.
- **[ÇEKİRDEK]** KISMİ kilit seri kilidi DEĞİLDİR: `ISTEMCI` kilidi eksen düzeyinde, kilitsiz eksenler bugün düzenlenir; ölçüm ve panel bu ayrımı yapar.
- **[ÇEKİRDEK]** Kilitli serileri ölçen bekçi hedefi KEŞİFLE bulur; kilitli seri kalmayınca "ölçülemedi — iddia gereksiz" üçüncü sonucunu basar.
- **[ÇEKİRDEK]** Devralınan tarama çakışması istisnası serinin BÜTÜN zaman çizgisini (yürürlükteki · emekli · katalog tohumu) kapsar; hiç kullanılmamış çakışan şekil reddedilir.
- **[ÇEKİRDEK]** Aynı kod kolonunu paylaşan seriler (`docNo`) EŞİT ya da BAŞLANGIÇ ön eki taşıyamaz, emekliler dahil; bu SAYAÇ uzayı kapısıdır, tarama kapısından ayrıdır.
- **[ÇEKİRDEK]** Paket önizlemesi üç yüklemi birden kuru koşar: `assertSeriesFormatWritable` · `assertAxesAllowed` · `assertSeriesFormatAllowed`.
- **[ÇEKİRDEK]** Fatura numarasının ekran = belge eşitliği AYRI ölçülür.
- **[ÇEKİRDEK]** Sayaç taramasında seriye aitlik yüklemi elle REGEX değil yürürlükteki biçimden (`codeCountsForCounter` → `matchesSeries`); hane tavanı 12 (`parseInt` taşması).
- **[ÇEKİRDEK]** "Sıradaki numara" ile üretim aynı yükleyici ve süzgeçten; aday biçim `candidateSeriesFormat` ile yürürlüktekinin üstüne kurulur (sayaç, sarma, emekliler, `infix` korunur; eksen değiştiyse kapsam ŞİMDİ başlar); satırlar `createdAt desc` okunur.

### Kararlar

- **[PROFİL]** Seçilebilir tarih segmentleri: tarihsiz · `GGAAYY` · `GGAAYYYY` · `YYYYAAGG` · `YYAA` · `AAYY` · `YYYYAA` · `YY` · `YYYY`; enum KİMLİĞİ İngilizce (`DDMMYYYY`…), ekranda Türkçe etiket + örnek.
- **[PROFİL]** Bugünkü biçimler: `CV`/`SVK`/`KRT`/`T…H|F` + GGAAYY + NNNN · `PRT-YYMM-NNNN` · `P-n` · `STK-NNNNNN` · `IADE-GGAAYY-<id6>`; hepsi `number-series-catalog.ts`te tohum.
- **[ÇEKİRDEK]** Seri önbelleği BEYANLI fail-SAFE'tir: seri okunamazsa katalog tohumuna düşülür.
- **[ÇEKİRDEK]** Dış standart serisi (`fixedShape`, e-İrsaliye): yalnız ön ek veridir; tarih/hane/ayraç kilitli, tavanda 409; sayaçta yalnız yıla bağlı başlangıç açık, o yılın ilk numarasıyla kilitlenir.

**Bekçiler:** `scripts/test_number_series_lines.ts` · `scripts/test_number_series_sorgu_butcesi.ts` · `scripts/test_number_source_migration.ts` · `scripts/test_number_series.ts` · `scripts/test_number_series_scope.ts` · `scripts/test_number_series_geri_uyumluluk.ts` · `scripts/test_eski_istemci_okutma.ts` · `scripts/test_number_series_panel.ts` · `scripts/test_number_series_siradaki.ts` · `scripts/test_return_no_backfill.ts` · `scripts/test_scan_series.ts` · `scripts/test_tarih_segmenti_aynasi.ts` · `scripts/test_subcontractor_code_autogen.ts` · `scripts/test_belge_ekran_ayni.ts` · `scripts/test_label_width_gate.ts` · `scripts/test_sack_seq_label.ts` · `scripts/test_db_invariants.ts` · `scripts/test_packing_group.ts` · `scripts/test_sevk_partisi.ts`

Madde içi bekçiler: `test_sack_seq_label` · `test_perf_doff_sayac` · `test_musteri_barkodu` · `test_musteri_barkod_serisi` · `test_route_auth_coverage` · `test_perf_sayac_tx_disi` · `test_config_bundle` · `test_bayat_kod_literali` · `test_seri_modul_yuklemesi` · `test_batch_number_format` · `test_roll_barcode` · `scanSeries.service.test` · `barcode-kind.test` · `resolvePoolScan.test` · `returnNo.test` · `lockText.test` · `NumberingFormDialog.bolum.test` · `NumberingFormDialog.bayat.test`
