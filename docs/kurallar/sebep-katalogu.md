# Sebep katalogları

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 6 üye (2 birincil, 4 ikincil; biri mobil alt-CLAUDE, biri arşiv). Hiçbiri komple bayat değil; 3 kısmi ezilme var ve üçü de kodla doğrulandı (KIND_STORES_TEXT'in 'kod saklanmaz' anlamı düştü · TTL null→bayat-döner · üç kopya picker tek bileşene indi). En riskli nokta çelişki değil DRIFT: kök metinler hâlâ 'metin saklayan İKİ kind' diyor, kodda ÜÇ (ORDER_CANCEL 2026-08-27'de eklendi) ve 'beş kapı' reçetesi ORDER_CANCEL'da mobil ayağıyla uygulanmamış. 2026-08-21 üyesinin nameFold yarısı bu kümenin değil master-data/mükerrer kümesinin konusudur (çift sayılmasın). M:2026-08-19 (Boyahaneye Geri Gönder) konu dışı bir üye — yeri mobil/CLAUDE.md.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** Hazır sebep listeleri (fire · kayıt düzeltmesi · elle top ekleme · top iptali · sipariş iptali · yeniden üretim) DB'de yaşar (`ReasonPreset`) ve fabrika kendi diliyle düzenler; `code` doğuşta yazılır ve ASLA düzenlenmez (rapor anahtarı), `label` serbesttir. · bekçi: `test_reason_presets §5` <sub>(CLAUDE.md:73)</sub>
- **[ÇEKİRDEK]** `ReasonPresetKind` ON İKİ yerde yazılıdır (Prisma enum · backend üç tablo · panel üç · tablet beş) ve üç TypeScript projesi arasında paylaşılan tip YOKTUR; yeni kind eklerken on ikisi BİRLİKTE güncellenir. Dokuzu annotated `Record<ReasonPresetKind,…>` ya da exhaustive switch olduğu için derlemede düşer (backend'in üçü `prisma generate` sonrası anında) — gerçekten SESSİZ olan ÜÇ dikiş vardır: panel union · panel `KIND_TABS` · tablet union. YENİ ayna annotated `Record<ReasonPresetKind,…>` ile yazılır, gevşek `Record<string,…>` ile DEĞİL. · bekçi: `test_reason_preset_kind_parity` <sub>(CLAUDE.md:73)</sub>
- **[ÇEKİRDEK]** Fason adımına manuel taşıma malı `AT_SUBCONTRACTOR` YAPMAZ; çıkış ayrıca Fason Sevk ekranından yapılır (taşınan top orada kendiliğinden görünür). <sub>(CLAUDE.md:181)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Sebep satırı SİLİNMEZ, yalnız gizlenir (`isActive=false`); son aktif satırın gizlenmesi 400 ile reddedilir — fire/düzeltme kararında sebep zorunlu olduğu için boş katalog operatörü kilitler. · bekçi: `test_reason_presets` <sub>(CLAUDE.md:73)</sub>

### Kararlar

- **[ÇEKİRDEK]** Mevcut iş emrine sonradan top EKLEME yolu YOK (`attach-rolls` 2026-06-12'de kaldırıldı): yeniden üretim her iki istemcide de YENİ iş emri açar (SAP'ta da rework ayrı emirdir). <sub>(CLAUDE.md:85)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Gizlenmiş (`isActive=false`) kod doğrulamada GEÇERLİ sayılır — gizleme bir görünürlük kararıdır, geçerlilik kararı değil; eski kayıtların kodu okunmaya devam eder. · bekçi: `test_reason_presets` <sub>(CLAUDE.md:73)</sub>
- **[ÇEKİRDEK]** Sebep önbelleğinde TTL TAZELİKTİR, geçerlilik değil: bayat liste DE döner ve arka planda tazelenir (fabrikanın panelden eklediği sebep 60 sn dışında reddedilmez); kod kataloğuna düşme yalnız önbellek HİÇ dolmadıysa kalır (fail-closed). · bekçi: `test_reason_presets` (bayat üç yüklem + §3d soğuk dal) <sub>(CLAUDE.md:53)</sub>
- **[ÇEKİRDEK]** `KIND_STORES_TEXT` true olan kind'ta satıra GÖRÜNEN metin de yazılır (bugün ÜÇ: ROLL_MANUAL_ENTRY · ROLL_CANCEL · ORDER_CANCEL); 2026-08-21'den beri satır KODU DA taşır, yani etiket düzenlemesi geçmiş raporu BÖLMEZ. 'Kod saklanmaz' anlamı düşmüştür. · bekçi: `derleme ("as const satisfies Record<ReasonPresetKind, boolean>" bağı)` <sub>(CLAUDE.md:78)</sub>
- **[ÇEKİRDEK]** Sebep KODUNU sunucu türetir (`resolveReasonCode`): açık kod katalogda doğrulanır (yoksa 400 `REASON_CODE_INVALID`), yoksa metin `label`/`fullText`/`legacyTexts` ile KATLANMIŞ eşlenir; serbest metne kod UYDURULMAZ (NULL kalır). · bekçi: `test_reason_presets §5, §6` <sub>(CLAUDE.md:78)</sub>
- **[ÇEKİRDEK]** `customers` · `items` · `subcontractors` ad seddi partial UNIQUE `<tablo>_nameFold_key` + `WHERE "mergedIntoId" IS NULL`'dır (tombstone aynı adı meşru taşır); RENK bilinçli HARİÇ (`foldColorNameForCompare` DB fold'undan zengin, düz kısıt yanlış güven verir). · bekçi: `test_db_invariants §1 · test_master_data_name_dup §9` <sub>(CLAUDE.md:78)</sub>
- **[ÇEKİRDEK]** Uygulama bekçisi `assertNameNotDuplicate` KALDIRILMAZ — anlaşılır 409'u o verir; DB seddi yalnız yarış, config unutması, içe aktarım ve elle SQL yollarını kapatan sessiz son hattır. Yeni tabloya sed eklemeden önce `find_fold_duplicates.ts` koşturulur. · bekçi: `test_master_data_name_dup §9` <sub>(CLAUDE.md:78)</sub>

### Reçeteler

- **[ÇEKİRDEK]** `legacyTexts[]` eski-ad sözlüğüdür: tek yazar `update()`, sınır 20 kayıt, güncel ad öncelikli, iki satır aynı eski metni taşıyorsa sonuç null (belirsizlik uydurulmaz). · bekçi: `test_reason_presets §6` <sub>(CLAUDE.md:78)</sub>

### Kararlar

- **[ÇEKİRDEK]** Yazma yetkisi için YENİ izin kodu üretilmez: `roll:manual-adjust` ∨ `mobile:tambur-duzelt` (create/update/duplicate/reorder aynı kapıdan); `GET /api/reason-presets` yalnız token ister. <sub>(CLAUDE.md:73)</sub>
- **[ÇEKİRDEK]** Sed migration'ı mükerrer bulunan tabloda index'i ATLAR (RAISE NOTICE) ve deploy'u DÜŞÜRMEZ; temizlik sonrası aynı dosya yeniden koşulur. Enforce bekleyen kurulumda `test_db_invariants` §1'in kırmızı kalması BİLİNÇLİDİR — bekçiyi bu yüzden daraltma. · bekçi: `test_db_invariants §1` <sub>(CLAUDE.md:78)</sub>

## Tablet (mobil)


### Değişmezler

- **[ÇEKİRDEK]** Tablette katalog okuması ÜÇ KADEMELİDİR ve sırası anlamlıdır: sunucu → diskteki son bilinen liste → APK'ya gömülü zemin. Üçüncü kademe KALDIRILAMAZ (sebep fire kararında zorunlu; boş liste = malın tamburda kilitlenmesi). Her kademe KARARLI referans döndürür. <sub>(CLAUDE.md:73)</sub>
- **[ÇEKİRDEK]** Sebep adımı ÜÇ BÖLGEDİR: başlık + serbest metin SABİT · sebep listesi kayan (`Animated.ScrollView`, `flexShrink:1`) · Geri/Kaydet SABİT footer. Liste büyüyen tek bölge olduğu için footer'ın ayrı yaşaması zorunludur (sheet tavanı aşılınca kırpılan taraf hep en alttır). <sub>(arşiv:1377)</sub>
- **[ÇEKİRDEK]** Sıra basılı tut-sürükle ile değişir ve `PATCH /api/reason-presets/reorder` ile kalıcıdır; sunucu o kind'ın TÜM id'lerini ister, ekran yalnız AKTİF satırları çizer → köprü `mergeVisibleOrder` (gizli satır KENDİ YUVASINDA kalır); tam liste YAZMA ANINDA çekilir (`list(true)`). · bekçi: `mobil/src/services/reasonPreset.order.test.ts (8; naif uygulamada 4 kırmızı)` <sub>(arşiv:1377)</sub>
- **[PROFİL]** Ölü etiket uyarısı DAR koşulla gösterilir (top etiketli VE ilk adım fason) — orada barkodun geçersizleşmesi KESİNDİR (fason kabulünde top `SUBCONTRACTOR_CONSUMED` olur, mal yeni barkodla döner); uyarı engel değil bilgidir, geniş tutmak gürültüye çevirir. · bekçi: `ReworkRollsDialog.test.tsx (7)` <sub>(CLAUDE.md:85)</sub>
- **[ÇEKİRDEK]** Tambur 'Boyahaneye Geri Gönder' hedef adımını SUNUCU çözer (`/tambur/manual/send-to-dye-preview`) — tablette rota yok ve olsaydı bile 'hangi adım boya veriyor' yüklemi ikinci kez yazılırdı; önizlemesiz uygulama YOK, sebep ≥3 karakter, tuş yalnız yetkilide ve ÇEVRİMİÇİYKEN çizilir. <sub>(CLAUDE.md:181)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Mobil çevrimdışı zemin: metin SAKLAYAN kind'larda kodlar sentetiktir (`BUILTIN_<i>`) ve sunucuya GÖNDERİLMEZ (sunucu metinden türetir); metin SAKLAMAYAN kind'ta (WORK_ORDER_REWORK) zemin GERÇEK katalog kodlarını taşır — uydurma kod rapor anahtarını çöpe çevirir. <sub>(CLAUDE.md:85)</sub>
- **[ÇEKİRDEK]** Yıkıcı aksiyon taşıyan sebep listesine (top iptal chip'leri: dokununca topu iptal eder) satır içi düzenleme kalemi KONMAZ; düzenleme ayrı yüzeyde (`ReasonPresetManagerSheet`) açılır. <sub>(CLAUDE.md:73)</sub>
- **[ÇEKİRDEK]** Tablet `ORDER_CANCEL` kind'ını TİP olarak tanır ama çevrimdışı zemini BİLEREK BOŞTUR: sipariş iptali tablette yapılmıyor, gömülü liste yazmak sunucudaki fabrika metinleriyle sessizce ayrışan ikinci bir katalog üretirdi. Tipin tanıması zorunlu — liste ucu TÜM kind'ları döndürüyor, union taşımazsa `KIND_LABELS[kind]` `undefined` verir ve sebep adsız çizilir. · bekçi: `test_reason_preset_kind_parity` <sub>(2026-09-12 K4 denetimi)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Yerel sıra (`localOrder`) BAŞARIDA temizlenmez (temizlenirse liste bir kare eski sırayı gösterir), hatada temizlenir + toast; sürükleme yalnız `canEditPresets` olan kişide açık ve `builtin:` zemin satırlarında KAPALI (sunucuda karşılığı yok). <sub>(arşiv:1377)</sub>
- **[ÇEKİRDEK]** Hızlı İş Emri okutma kararı satır içi `if` zinciriyle değil TEK saf yüklemde verilir (`scanClassify`) ve sıra load-bearing: iptal → STATÜ → çuval/sevkiyat → kumaş kilidi. `SHIPPED` topa 'çuvaldan çıkarın' demek malın müşteride olduğunu gizler. · bekçi: `scanClassify.test.ts (12)` <sub>(CLAUDE.md:85)</sub>
- **[ÇEKİRDEK]** `RollPickerModal.scopeTabs` sekme anahtarı sorgu anahtarına (`effectiveFilters`) GİRMELİ; girmezse sekme değişince liste tazelenmez. <sub>(CLAUDE.md:85)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Sebep seçimi TEK bileşenden (`ReasonPresetPicker`) geçer: serbest metin kutusu chip listesinin ÜSTÜNDE; yazmaya başlamak `requiresText` satırını kendiliğinden seçer, chip'e dokunmak serbest metni temizler, seçili chip'e tekrar dokunmak (optional iken) seçimi kaldırır. · bekçi: `ReasonPresetPicker.test.tsx (6)` <sub>(CLAUDE.md:85)</sub>
- **[ÇEKİRDEK]** Yeniden üretim sebebi İKİ hedefe yazılır: metin → 1. rota adımının notu → fason çekisine TALİMAT · kod+metin → `WorkOrder.parameters.rework` (rapor anahtarı). Migration açılmaz, `parameters` zaten JSON ve `quick-start` Zod şeması kabul eder. · bekçi: `reworkPayload.test.ts (8)` <sub>(CLAUDE.md:85)</sub>
- **[ÇEKİRDEK]** Başarı toast'ı hedef istasyon adını MUTLAKA taşır — top Tambur listesinden düşer, operatör nereye gittiğini görmezse 'kayboldu' der. <sub>(CLAUDE.md:181)</sub>

### Kararlar

- **[PROFİL]** Hızlı İş Emri bitmiş topu da alır (WAREHOUSE/A1_STOCK); `if (status !== 'STOCK') reject` elemesi kaldırıldı. Ham + bitmiş aynı WO'da serbesttir (rozetle ayrılır), hedef renk BOŞ gelir, sebep İSTEĞE BAĞLIDIR, 2. kalite dahildir. · bekçi: `scanClassify.test.ts` <sub>(CLAUDE.md:85)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `R:2026-08-19__2026-08-19-hazir-sebep-kataloglari` → `R:2026-08-21__2026-08-21-namefold-db-seddi`: 'Metin saklayan İKİ kind kayda kod DEĞİL METİN yazar' kuralının yarısı düştü: satır 2026-08-21'den beri KOD DA taşıyor (Roll.entryReasonCode/cancelReasonCode, VARCHAR 64) ve kodu sunucu metinden türetiyor. Bayrağın 'metin saklanır' anlamı KALIR, 'kod saklanmaz' anlamı DÜŞTÜ — dolayısıyla etiket düzenlemesi artık raporu bölmez. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-19__2026-08-19-hazir-sebep-kataloglari` → `R:2026-08-26__2026-08-26-fabrikanin-ekledigi-sebep`: 'Doğrulama senkron önbellekten beslenir' kuralının uygulaması değişti: eskiden TTL dolunca cachedRows null dönüp KOD kataloğuna düşüyordu (fabrikanın panelden eklediği sebep 60 sn dışında reddediliyordu). Artık bayat liste DE döner ve arka planda tazeleme tetiklenir; kod kataloğuna düşme yalnız önbellek HİÇ dolmadıysa (fail-closed) kalır. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-19__2026-08-19-hazir-sebep-kataloglari` → `R:2026-08-25__2026-08-25-aksam-mobil-hizli`: 'Fire ekranında serbest metin listenin ÜSTÜNDE' reçetesi aynen geçerli ama artık ekran ekran elle uygulanmıyor: kalıp üç kopyadan TEK bileşene (ReasonPresetPicker) indirildi ve sözleşme (yazmaya başlamak requiresText satırını seçer, chip serbest metni temizler) orada yaşıyor. ⚠️ çürütücü itiraz etti — ihtiyatla
- **TAM** `A:2026-08-25__2026-08-25-bitmis-kumas-tekrar` → `R:2026-08-25__2026-08-25-aksam-mobil-hizli`: Arşiv notunun 'AÇIK: tablet hâlâ bitmiş topu okutamıyor (status !== STOCK elemesi duruyor)' maddesi aynı gün kapandı: eleme kaldırıldı, karar saf yükleme (scanClassify) taşındı ve Hızlı İş Emri WAREHOUSE/A1_STOCK topu da kabul ediyor. ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `R:2026-08-21__2026-08-21-namefold-db-seddi` ↔ `R:2026-08-25__2026-08-25-aksam-mobil-hizli`: Çelişki görünürde; kod ikisini de uyguluyor, ayrım KIND'a göre: metin saklayan kind'ların zemini sentetik BUILTIN_<i> kodu taşır ve o kod sunucuya gönderilmez (sunucu metinden türetir); metin saklamayan WORK_ORDER_REWORK'ün zemini GERÇEK katalog kodlarını taşır ve kodu istemci gönderir.

## Açık sorular

- Kök notlar ve kod yorumları hâlâ 'metin saklayan İKİ kind' diyor (CLAUDE.md:73, reason-preset.service.ts:211-215 başlığı), oysa `KIND_STORES_TEXT` bugün ÜÇ true taşıyor (ORDER_CANCEL, order.service.ts:495,3138 üzerinden canlı). Metin drift'i — kural değişmedi, sayı bayat.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_iade_enhancements`, `test_order_cancel_reason`, `test_reason_preset_kind_parity`, `test_reason_presets`, `test_roll_cancel_undo`⚠️, `test_roll_fold_and_reason`

İstemci: `RollCancelModal.test.tsx`, `ReasonPresetPicker.test.tsx`, `varianceReasons.test.ts`⚠️, `useReasonPresets.test.tsx`, `reworkPayload.test.ts`, `reasonPreset.order.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-25 · 2026-08-25 — "Bitmiş kumaş tekrar iş emrine bağlanabiliyor mu?" — evet, ama HİÇBİR istemciden yapılamıyordu — `CLAUDE-NOT-ARSIVI.md:756-809`
- 2026-08-26 · 2026-08-26 — Fabrikanın kendi eklediği sebep 60 saniyelik bir pencerede yaşıyordu ("taze ya da hiç" yanlış tak — `CLAUDE-NOT-ARSIVI.md:892-957`