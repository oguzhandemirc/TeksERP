# Fason · Kartela

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 23 üye; fason çekirdeğini 6 not taşıyor (kartela · 07-13 son-adım · 08-04 giriş noktası · 08-19 kısmi kabul · 08-21 çekme · 08-21 tek-kaynak), 9 üye başka kümenin malı. Bayat: kök CLAUDE.md:178 'Fason dönüş' domain kuralı (kümeye alınmamış) iki kez ezilmiş — 'kabulde SUBCONTRACTOR_CONSUMED' yalnız TAM kabul, 'barcode null' yalnız ara adım; Teks-Erp/CLAUDE.md:376-379 'admin/123123 hâlâ AÇIK' paragrafı ölü. 08-19'un 'karne fire artık gerçek' iddiası 08-21 ölçümüyle çürüdü (TAM kabulde defter=kalan → fire yine %0), sapma defteri eklendi; iki not tamamlayıcı. En riskli açık: fason istasyonu iki alandan tanınıyor (type=EXTERNAL 8 guard, kind=SUBCONTRACTOR 5 liste) ve bağlayan doğrulama yok; kapanış GUARD 1b açık-sevk koşulunu helper'sız yazıyor, AST bekçisi o kalıbı aramıyor. [doğrulandı: 23 üye, 3 kanıt kontrolü, 19 düzeltme]


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** Fason kabulünde TAM kabul topu `SUBCONTRACTOR_CONSUMED` yapar, makbuzdan `parentReceiptId`li yeni açık-kumaş toplar doğar (`entrySource=SUBCONTRACTOR_RETURN`); KISMİ kabulde top TÜKETİLMEZ — `AT_SUBCONTRACTOR` kalır, `currentQty` atomik decrement ile kalana iner. Her teslimat AYRI makbuz. · bekçi: `scripts/test_fason_partial_receive.ts P1/P5` <sub>(CLAUDE.md:72, arşiv:361)</sub>
- **[ÇEKİRDEK]** Fason rotanın SON adımıysa kabulde doğan açık-kumaş toplar FİNAL üründür: `WAREHOUSE` + tx içinde sıralı barkod (tek rezervasyon, Promise.all YASAK) + `form=ACIK`. Ara adımsa `IN_PRODUCTION` + barkodsuz; kesin ölçüm/etiket sonraki İÇ istasyonun FINISH'inde damgalanır. <sub>(arşiv:361)</sub>
- **[ÇEKİRDEK]** Defter `SubcontractorReceiptItem.receivedQty`+`isPartial` (NULL = eski satır, tamamı). Sevk kalemi YALNIZ TAM (`isPartial=false`, iptal edilmemiş) makbuz satırıyla dönmüş sayılır; tüm outstanding filtreleri bu yüklemi okur — atlanırsa kısmen dönmüş sevk kapalı görünür, ikinci teslimat firma çözemez. · bekçi: `scripts/test_fason_partial_receive.ts + scripts/test_fason_open_dispatch_single_` <sub>(CLAUDE.md:72)</sub>
- **[ÇEKİRDEK]** Fason replay kimliği `SubcontractorReceipt.clientToken @unique`; iptal edilmiş makbuzun token'ı 409 `RECEIPT_CANCELLED`. Küme-eşitliği guard'ı ('aynı top kümesi → cached makbuz') yalnız tam-tüketimli makbuzda; kalemi `isPartial` olan makbuz cached DÖNEMEZ — aynı top meşru olarak tekrar gelir. · bekçi: `scripts/test_fason_partial_receive.ts P3` <sub>(CLAUDE.md:72)</sub>
- **[ÇEKİRDEK]** Parti: ilk teslimat giden partiyi SÜRDÜRÜR; aynı sevkin ikinci+ teslimatında doğan toplar YENİ parti alır (`createBatchTx`, `splitFromId` = kaynak parti — K5 kalan-böl kuralının dönüş aynası). Tespit sevk-kapsamlı ve kendi makbuz satırı yazılmadan ÖNCE sayılır (sıra load-bearing). · bekçi: `scripts/test_fason_partial_receive.ts P2` <sub>(CLAUDE.md:72)</sub>
- **[ÇEKİRDEK]** Makbuz iptali LIFO: aynı topa dokunan daha YENİ aktif makbuz varken eski iptal edilemez (409 `RECEIPT_NOT_LATEST`, önizleme `laterReceipts`). Geri sarma iki dallı — TAM kalem statüyü geri çeker, KISMİ kalem metrajı atomik increment ile GERİ KOYAR (kalan-kapama araya girdiyse 409). · bekçi: `scripts/test_fason_partial_receive.ts P5` <sub>(CLAUDE.md:72)</sub>
- **[ÇEKİRDEK]** Çekme hata değil ölçüm: kabulde `bornTotal − consumedTotal` farkı (eşik 0.01 m) RollVariance'a yazılır — source `SUBCONTRACTOR_RETURN`, eksi SCRAP sistem sebebi `FASON_CEKME`, artı OVERAGE sebepsiz; çok toplu kabulde `allocateShrink` orantılı + artık son satıra. Kısmi kabulde de yazılır. · bekçi: `scripts/test_fason_partial_receive.ts P9 + scripts/test_roll_variance.ts:161-166` <sub>(CLAUDE.md:77)</sub>
- **[ÇEKİRDEK]** WO MANUEL KAPATMA (`completeWorkOrder`) hard-block'u yalnız FASON: `AT_SUBCONTRACTOR`/`RETURNED_FROM_SUBCONTRACTOR` top ya da açık fason sevkine bağlı IN_PRODUCTION top → 409; fason dönüşü top STOCK'a çekilemez (GUARD 3). İPTAL yolu farklı: sert engel 2026-08-17'de kalktı, karar SORULUR. <sub>(CLAUDE.md:124)</sub>
- **[ÇEKİRDEK]** GİRİŞ NOKTASI: iş emrine AŞAĞIDAN katılan top (fason dönüşü çocuğu — fason adımının ÇIKTISI; elle eklenen) yukarıdaki adımları BEKLETEMEZ. Giriş noktası = bu WO'daki EN ERKEN hareketin `stepSequence`'i; küçükse bekleyen sayılmaz; çözülemezse bekleyen say. Bekçi §20 AYNI kuralı söyler. · bekçi: `scripts/test_consistency.ts §20 + scripts/test_fason_wrong_station_guidance.ts S` <sub>(CLAUDE.md:60)</sub>
- **[ÇEKİRDEK]** Kartela fason ÜRETİM fasonundan AYRI ve WO'suz: bitmiş top `KartelaDispatch` ile çıkar (`AT_KARTELA`), `KartelaReceipt` ile N `Swatch` döner, parent `KARTELA_CONSUMED`. `KartelaDispatch`'te `clientToken` YOK; idempotency `SwatchStockReduction.clientToken`'da. Önce `docs/design/KARTELA-TASARIM.md`. <sub>(CLAUDE.md:170)</sub>
- **[ÇEKİRDEK]** Fason DOĞRUDAN SEVK `shipping.orderRequirement` KAPSAMINDADIR (`assertOrderLinkAllowed(resolveOrderRequirement())`); `block` rejiminin kaçışı `orderless` beyanı. Kapı takarken 'bu malın çıktığı BAŞKA yol var mı' sorusu KARDEŞ bayrağın (`invoiceMode`) kapsamına bakılarak sorulur. · bekçi: `scripts/test_shipping_flags.ts` <sub>(CLAUDE.md:106)</sub>
- **[ÇEKİRDEK]** Manuel taşıma fason adımına AT_SUBCONTRACTOR YAPMAZ — mal içeride bekler, çıkış FASON SEVK ile; fason dönüşü top yeniden sevk+kabul edilebilir. Konumu Düzelt'in inline kabulü (`FasonQuickReceivePanel`) HEP TAM kabul gönderir (`receivedQty` yok); kısmi kabul yalnız `FasonReceiveDialog`/tabletten. <sub>(CLAUDE.md:72)</sub>
- **[ÇEKİRDEK]** Fason kabulünde renk: hedef renk `wo.targetColorId`'den (renk istasyon kısıtı DEĞİL, `StationColor` deprecated); renk UYGULAMAYAN fason adımı (zımpara vb.) rengi SİLMEZ (2026-09-01). Fason kategorisinin `appliesColor`'ı 'renk veren adım' sorusunun tek kaynağıdır. · bekçi: `scripts/test_helpers.ts (kilit) + scripts/test_station_capability.ts 8b` <sub>(CLAUDE.md:128)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Fasondan kısmi doğrudan sevkte ebeveynin `initialQty`si DÜŞÜRÜLMEZ — yalnız `currentQty` iner; `initialQty` üretim anı snapshot'ıdır, düşürmek WO üretilen metrajını geriye azaltır ve `rollWhole` kapısını deler (Tambur parent-kısalma bloğunun aynı yasağı; fason yolu 2026-08-29 temizliğinde atlanmıştı). Charge kökte tam durduğu için `computeWoInput` çocuğa AYRI dal açmaz. · bekçi: `test_input_rolls_directship.ts` <sub>(arşiv:2026-09-11)</sub>
- **[ÇEKİRDEK]** Fason 'açık + outstanding sevk' koşulunun TEK KAYNAĞI `helpers/fason-open-dispatch.helper.ts` (`OPEN_OUTSTANDING`·`OUTSTANDING_ITEM`·`outstandingItemOfOpenDispatch`); elle kopya YASAK — eski kopyalar `directShippedAt`/`receipt.cancelledAt` süzgecini taşımıyordu (WO sonsuza dek gizli kalıyordu). · bekçi: `scripts/test_fason_open_dispatch_single_source.ts (AST; muafiyet iki yönlü)` <sub>(CLAUDE.md:75)</sub>
- **[ÇEKİRDEK]** Fasondaki/kartelalık/emekli/sevk edilmiş top (`ALWAYS_BLOCKED`: AT_SUBCONTRACTOR, AT_KARTELA, *_CONSUMED, SHIPPED…) HİÇBİR düzeltme yoluyla (Düzelt / Etiket / dahili çağrı) değiştirilemez; kapsam topun DURUMUNDAN çözülür, `Boolean(reason)` ile genişlemez. · bekçi: `scripts/test_roll_edit_unified.ts` <sub>(CLAUDE.md:126)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Fason kabulü haftalar önce yaratılmış topu BUGÜN depoya alır → 'buraya geliş' ≠ `createdAt`; Ham Stok dışı sekmeler `updatedAt desc` (`rollTabDefaultSortBy`, index `[status, updatedAt]`). Yeni 'topu şu statüye çek' yolu eklerken sıralama sözleşmesini hatırla — operatör topu BULABİLMELİ. · bekçi: `Electron Rolls/service.test.ts:159` <sub>(CLAUDE.md:125)</sub>

### Kararlar

- **[PROFİL]** Çekme UYARISI sunum katmanındadır: `fason.shrinkWarnEnabled` (varsayılan AÇIK) + `fason.shrinkTolerancePct` (varsayılan %10); uyarı/onay yalnız eşik aşımında. Backend ENFORCE ETMEZ — eşiğin altındaki fark da deftere aynen yazılır. Fark 'ÇEKME' adıyla ve NÖTR renkle basılır. <sub>(CLAUDE.md:77)</sub>
- **[ÇEKİRDEK]** Rota kapsaması ('hedef var ama rotada veren adım yok') REDDETMEZ, UYARIR — create · replace · 'Rengi Değiştir' tek kural, yanıt `ApiResponse.warnings`. Boyahanesiz rota dışarıdan boyalı mal için DOĞRUDUR. `goods` muafiyeti nitelik topların HEPSİNDE varsa (`some` YASAK). · bekçi: `scripts/test_wo_route_coverage_goods.ts` <sub>(arşiv:1445, CLAUDE.md:129)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Kısmi kabulde movement AÇIK kalır; SON teslimatta kapanır, `qtyOut = COALESCE(qtyIn, currentQty)` (sevk edilen TOPLAM). `RollOperation` `SUBCONTRACTOR_RETURNED` unique (rollId, stepId, opType) → ikinci teslimatın op satırı düşer; teslimat izi MAKBUZ KALEMLERİNDEDİR, op 'ilk dönüş olayı'dır. · bekçi: `scripts/test_fason_partial_receive.ts P4` <sub>(CLAUDE.md:72)</sub>
- **[ÇEKİRDEK]** Fazla dönen (`receivedQty` > kalan ya da verilmez) → TAM kabul: deftere kalan yazılır (clamp), `isPartial=false`, top tüketilir — eski APK davranışı birebir. Fiziksel olarak fazla gelen metraj ayrı eksende OVERAGE sapması olur; defter (düşülen) ile fiziksel (doğan) iki ayrı büyüklüktür, karıştırma. · bekçi: `scripts/test_fason_partial_receive.ts P7` <sub>(CLAUDE.md:72, CLAUDE.md:77)</sub>
- **[ÇEKİRDEK]** Fason karnesi: fire YALNIZ KAPANMIŞ kalemlerden; dönen = kabul defteri `SUM(COALESCE(receivedQty, currentQty))` (DISTINCT ON DEĞİL) + sapma defteri neti (SCRAP −, OVERAGE +, `reversedAt IS NULL`); açık bakiye = giden − defter, çekme `openQty`'ye GİRMEZ; doğrudan sevk edilenler fire hesabına girmez. · bekçi: `scripts/test_fason_partial_receive.ts P9` <sub>(CLAUDE.md:72, CLAUDE.md:77)</sub>
- **[ÇEKİRDEK]** Fason firma TEST FIXTURE'ı seed'den ÇÖZÜLMEZ, `fixture-subcontractor.ts` ile ÜRETİLİR (`ensureTestDyeHouse`/`ensureTestSander`/`ensureTestKartela`; `TEST-FASON-*` kodlu, idempotent upsert, SİLİNMEZ). 'Herhangi bir aktif firma bul' ÇÖZÜM DEĞİL — pasif kayıt bulunur, ilk çağrı patlar. <sub>(CLAUDE.md:357)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** `scripts/`+`prisma/` tip kontrolü `npm test`'in ÖN KOŞULU (`tsconfig.scripts.json`; tek testte atlanır, kaçış `SKIP_TYPECHECK=1`; build kök tsconfig). Sessiz desen: olmayan enum üyesiyle süzme (`StationKind.EXTERNAL` — fason `StationType.EXTERNAL`) Prisma'da koşulu ATAR, garanti yok olur. · bekçi: `scripts/run-all-tests.ts typecheckGate` <sub>(CLAUDE.md:86)</sub>

### Reçeteler

- **[ÇEKİRDEK]** 'Kalan gelmeyecek' = `POST /api/subcontractor/close-remainder` (ELLE, sebep zorunlu, zaman aşımı YOK): top `SUBCONTRACTOR_CONSUMED`, kalan RollVariance SCRAP source `SUBCONTRACTOR_REMAINDER` (ROLL_SCRAP kataloğu, fail-closed), kaleme `remainderClosedAt` damgası (damgasız kalem hep açık). · bekçi: `scripts/test_fason_partial_receive.ts P6` <sub>(CLAUDE.md:72)</sub>

### Kararlar

- **[ÇEKİRDEK]** K1 (2026-08-21): Fason Sevk WO picker'ı `excludeWithOpenDispatch=true` ile açık+outstanding sevki olan WO'ları gizler ve koşul `OPEN_OUTSTANDING`'den gelir → kabul iptali (LIFO) sonrası yeniden açılan sevk de gizlenir, tamamen doğrudan-sevk edilmiş WO listeye döner. · bekçi: `scripts/test_fason_open_dispatch_single_source.ts` <sub>(CLAUDE.md:75)</sub>

## Tablet (mobil)


### Değişmezler

- **[ÇEKİRDEK]** Mobil kısmi kabul TEK soru 'Fasonda kalan var mı?' + tek metraj; `resolveReturns` kalanı BÜYÜK TOPTAN en az topa yığar, tamamı kalan top dönüş listesine GİRMEZ, sıra deterministik. Satır başına 'Gelen (m)' kaçış kapısı; Tek Parça modunda satır HER ZAMAN 1 (`switchReceiveMode`). · bekçi: `mobil FasonKabul/receivePayload.helper.test.ts + newRolls.helper.test.ts` <sub>(CLAUDE.md:77)</sub>
- **[ÇEKİRDEK]** Top okutma geri bildirimi ekran ekran KOPYALANMAZ (Fason Sevk dahil): `scanFeedback.signalScan` (ses+titreşim; ekran Haptics'i doğrudan çağırmaz), `useScanFeedback` (signalScan'i KENDİSİ çağırır; flash + rejects), `ScannerRollStrip` (kamera altı şerit). Yüzeyler birbirinin yerine geçmez. <sub>(CLAUDE.md:385)</sub>

### Yasaklar

- **[ÇEKİRDEK]** RN Paper `SegmentedButtons` `flexDirection:'row'` kabının doğrudan çocuğu OLAMAZ (Yoga onu satırın tamamına açar, yanındaki başlık sıfır genişliğe iner, soru ekrana çıkmaz); yanına bir şey konacaksa AÇIK `width` (minWidth YETMEZ). Yerleşim şikâyetinde tahmin değil cihaz ölçümü. · bekçi: `mobil/src/test/segmented-buttons-row.guard.test.ts` <sub>(arşiv:840)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Yeniden üretim sebebi İKİ hedefe: metin → 1. adım notu → FASON ÇEKİSİNE TALİMAT; kod → `WorkOrder.parameters.rework` (migration YOK). Ölü etiket uyarısı onay adımında, DAR koşul (etiketli VE ilk adım fason) — fason kabulünde top SUBCONTRACTOR_CONSUMED olur, barkod geçersizleşir; bilgi, engel değil. · bekçi: `mobil reworkPayload.test.ts (8)` <sub>(CLAUDE.md:85, arşiv:840)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `CLAUDE.md:178 «Fason dönüş» domain kuralı (küme dışı, kök)` → `R:2026-08-19__2026-08-19-fason-kismi-kabul`: 'Kabulde orijinal rulolar SUBCONTRACTOR_CONSUMED ile emekliye ayrılır' artık yalnız TAM kabul için doğru; KISMİ kabulde top tüketilmez, AT_SUBCONTRACTOR kalır ve currentQty atomik decrement ile kalana iner. Kök domain kuralı koşulsuz duruyor. ✅ çürütmeden geçti
- **KISMI** `CLAUDE.md:178 «Fason dönüş» domain kuralı (küme dışı, kök) — 'barcode null'` → `A:2026-07-13__2026-07-13-her-rota-final`: Doğan açık-kumaş topların barkodsuz doğması yalnız ARA adım için geçerli; fason SON adımsa toplar final üründür → WAREHOUSE + sıralı barkod + form=ACIK. Kök cümle koşulsuz 'barcode null' diyor. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-19__2026-08-19-fason-kismi-kabul` → `R:2026-08-21__2026-08-21-fason-kabulu-cekme`: Mobil kısmi kabul modeli değişti: satır başına 'Gelen (m)' girişi (düşürmek = kısmi) yerine TEK soru 'Fasonda kalan var mı?' + tek metraj; dağıtımı resolveReturns büyük toptan yapar. Satır başına 'Gelen (m)' yalnız kaçış kapısı olarak kaldı; Electron FasonReceiveDialog satır bazlı 'Gelen' modelini korudu. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-19__2026-08-19-fason-kismi-kabul` → `R:2026-08-21__2026-08-21-fason-kabulu-cekme`: Karne 'dönen' tanımı genişledi: 08-19 dönen metrajı kabul DEFTERİNDEN okutup 'fire artık gerçek' dedi; 08-21 ölçtü — TAM kabulde defter satırı kalanın kendisi olduğundan fark HEP 0 kalıyordu. Gerçek dönen = defter + sapma defteri (SUBCONTRACTOR_RETURN: SCRAP −, OVERAGE +); çekme openQty'ye girmez. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-02__ozellik-istasyon-kisiti-kalir-ama-bos` → `A:2026-08-27__2026-08-27-siparis-baglarsam-hata`: Özellik/renk-başına rota kapsaması kontrolü koşmaya devam eder ama sonucu artık RED (400/409) değil UYARI: create · replace · 'Rengi Değiştir' tek kural, yanıt ApiResponse.warnings taşır; boyahanesiz rota dışarıdan boyalı mal için meşru; goods muafiyeti nitelik topların HEPSİNDE varsa. ⚠️ çürütücü itiraz etti — ihtiyatla
- **KISMI** `B:undated__fixture-seed-master-data-si-business (son paragraf: admin/123123 hâlâ AÇIK)` → `kod: Teks-Erp/scripts/fixture-test-user.ts (ensureTestAdmin)`: 'test_direct_ship_api, test_quickstart_dispatch_api, test_http_api, smoke_fason_http HTTP login'i seed şifresine güveniyor … dördü de düşüyor' cümlesi ölü: dördü de kendi kullanıcısını üretiyor. Paragraf silinmeli. ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `CLAUDE.md:178 «Fason dönüş» domain kuralı (kök, küme dışı)` ↔ `R:2026-08-19__2026-08-19-fason-kismi-kabul`: Kod B'yi uyguluyor: TAM kabul tüketir, KISMİ kabul tüketmez; barkod yalnız fason son adımsa doğar. Kök:178 metnine 'TAM kabulde' ve 'ara adımda barkodsuz' şerhi eklenmeli (kural yanlış değil, eksik).
- `R:2026-08-21__2026-08-21-aksam-tutarlilik-taramasi` ↔ `R:2026-07-30__wo-kapatma-kapanis-dispozisyonu-2026-07 (kapanış GUARD 1b uygulaması)`: GUARD 1b helper'ın kopyası DEĞİL, ikinci ve DAHA DAR bir yüklem: 'top iptal edilmemiş bir sevke bağlı mı' (outstanding/directShippedAt süzgeci yok). İkinci çağrı noktası inventory.service.ts:4935 (rescueStuckRoll); kod yorumu da öyle diyor. Bekçi ayırıcı olarak remainderClosedAt aradığı için bu kalıbı yakalamıyor. Karar: dar yüklem meşru mu, tek kaynağa mı çekilmeli.

## Açık sorular

- ⚠️ **AÇIK HATA (2026-09-11, veriyle kanıtlandı — düzeltilmedi):** Fasoncu karnesi kısmi doğrudan sevkte müşteriye giden metreyi FASON FİRESİ ya da AÇIK BAKİYE sayıyor. Kalem `dispatchedQty`si (D) çocuğun müşteriye giden S metresini içeriyor ama "dönen" yalnız makbuzlardan geliyor; bölünme çocuğu hiçbir kümede değil (sevk kalemi değil). Ölçüldü: 300 m → 100 müşteriye → 200 tam kabul = **fire 100 m (%33,3), doğrusu 0**; kısmi kabulle **fire 200 m (%66,7), doğrusu %50**; kalan fasondayken **açık 300 m, doğrusu 200**. Ayrıca alt kümeyle TAM sevk edilen topun kalemi `directShippedAt` NULL kaldığı için **sonsuza dek açık** kalıyor (`OPEN_OUTSTANDING`=1) — bu yalnız karne değil `fason-open-dispatch.helper.ts` sorunudur ve helper'ın 38 tüketicisi var (tüketici etkisi ÖLÇÜLMEDİ). Aynı fonksiyon Patron ekranını da besliyor. Bekçi neden yakalamadı: `test_subcontract_scorecard` yalnız TAM doğrudan sevki kuruyor. Ölçüm script'i: `scripts/olcum_scorecard_kismi_dogrudan_sevk.ts` (`--salt-okuma` canlıda koşar). Düzeltme yönü (uygulanmadı): fasoncunun sorumluluğundaki giden = `dispatchedQty` − Σ müşteriye giden; alt kümeyle tam sevk edilen topun kalemi kapanmış sayılmalı. **Ticari karar boyutu var** (hakediş ve firma seçimi), o yüzden kullanıcı onayı bekliyor.
- Kapanış GUARD 1b (workorder.service.ts:4102-4110) 'açık fason sevkine bağlı top' koşulunu helper'sız `dispatch:{cancelledAt:null}` ile yazıyor; aynı kalıp inventory.service.ts:4935'te de var (rescueStuckRoll). AST bekçisi A zinciri (receiptItems→none→isPartial) ve B ayırıcısı (remainderClosedAt) aradığı için ikisini de görmüyor. İki çağrılı bu dar yüklem bilinçli mi, tek kaynağa mı çekilmeli — karar gerekir.
- Fason istasyonu İKİ alandan tanınıyor: `Station.type=EXTERNAL` (8 guard noktası, subcontractor.service.ts:734,885,1502,1637,1654,1838,2560,3627) ve `Station.kind=SUBCONTRACTOR` (5 liste noktası: listPendingReturns :3825/3870/3896, getPendingReturnGroupDetail :4243, executeDirectShip :6210). İkisini bağlayan doğrulama/CHECK bulunamadı (station.service.ts'te 0 eşleşme; seed ikisini birlikte yazıyor). type=EXTERNAL ∧ kind≠SUBCONTRACTOR bir istasyon guard'dan geçer, listede görünmez.
- Kök CLAUDE.md:178 «Fason dönüş» domain kuralı bu kümeye alınmamış; metni koşulsuz ('kabulde SUBCONTRACTOR_CONSUMED', 'barcode null') ve iki kez ezilmiş (07-13 son-adım barkodu, 08-19 kısmi kabul). Hangi kümenin düzelteceği belirsiz.
- 2026-08-25 (akşam) 'fason kabulünde top SUBCONTRACTOR_CONSUMED olur — geçersizleşme KESİN' cümlesi kısmi kabulde ancak son teslimat/kalan-kapamada gerçekleşir (top AT_SUBCONTRACTOR kalır, barkod yaşar); metin zamanlamayı söylemiyor. Uyarı metni 'sonunda' mi demeli — ürün kararı.
- CLAUDE.md:83 (2026-08-25, küme dışı) 'Fason firma seçicisi LOAD-BEARING — yoksa Fasona gönder sessiz no-op' kuralı fason kümesinin canlı kuralı olmalı; bu turda yalnız kod yorumu değil kök metniyle görüldü, hangi kümenin sahiplendiği belirsiz.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[ÇEKİRDEK]** Mobil fason adımı `dispatchWithoutColor` kutusu: değer HER fason adımı için AÇIKÇA gider (true DE false DA) — alan gönderilmezse kapatma niyeti yutulur; bekçi `test_dispatch_without_color` §1 bilerek METİN tarar (servisi çağıran test yeşil kalır). <sub>(arşiv 2026-08-25)</sub>

## Bekçiler — bu alana dokununca koş (82 backend · 13 istemci)

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_accounting_direct_ship`, `test_batch_k15_merge`, `test_batch_k16_split_move`, `test_batch_k8_tools`, `test_batch_multibatch_dispatch`, `test_batch_partial_dispatch_autosplit`, `test_branch_code_docs`, `test_branch_no_empty`, `test_bulk_dispatch_rollids`, `test_client_token_idempotency`, `test_consecutive_fason`⚠️, `test_consistency`, `test_consistency_derived`, `test_data_integrity_gaps`, `test_direct_ship_api`⚠️, `test_direct_ship_fason`, `test_direct_ship_scenarios`, `test_dispatch_claim_step_match`, `test_dispatch_cross_wo_batch_guard`, `test_dispatch_without_color`, `test_doc_pagesize_override`, `test_doc_render_html`, `test_doc_sample_html`, `test_fason_ceki_draft`, `test_fason_ceki_html`, `test_fason_desk_dispatch`, `test_fason_dispatch_picker`⚠️, `test_fason_kabul_partial_overlap`, `test_fason_open_dispatch_semantics`, `test_fason_open_dispatch_single_source`, `test_fason_parti_grouping`, `test_fason_partial_receive`, `test_fason_partial_receive_overcount`, `test_fason_receipt_color_width`, `test_fason_receive_cancel_rereceive`, `test_fason_receive_crossstep_firm`, `test_fason_receive_idempotency_concurrency`, `test_fason_step_note_flow`, `test_fason_transfer_rollids`, `test_fason_undo_transfer`⚠️, `test_fason_visibility`⚠️, `test_fason_wrong_station_guidance`, `test_filter_multi_select`, `test_input_rolls_directship`, `test_k14_lock_edges`, `test_kartela_stock_and_ship`, `test_label_dirty_sources`, `test_manual_move`, `test_manual_move_fason_receive`, `test_manual_move_field_continuity`, `test_new_documents`, `test_order_shipments`, `test_printed_documents`, `test_quality_scorecard`, `test_quickstart_dispatch`, `test_quickstart_dispatch_api`, `test_race_conditions`, `test_roll_variance`, `test_route_firm_roundtrip`, `test_route_skip_warning`, `test_route_template_fason`, `test_sack_content_dump`, `test_sack_status_invariant`, `test_scan_code_case`, `test_shipment_doc_batch_column`, `test_shipment_order_ledger`, `test_shipping_flags`, `test_split_card_lineage`, `test_split_per_roll`, `test_subcontract_scorecard`, `test_subcontractor_management`, `test_tambur_branch_info`, `test_tambur_send_to_dye`, `test_wo_branch_redye`⚠️, `test_wo_branch_split`⚠️, `test_wo_cancel_fason`, `test_wo_color_change_lock`, `test_wo_fason_quick_receive`, `test_wo_input_attach_window`, `test_wo_manual_complete`, `test_wo_target_color_guard`, `test_workorder_documents`

İstemci: `shipmentDetailError.test.tsx`, `DirectShipModal.test.tsx`, `batch-merge-confirm.test.ts`, `fasonReceive.helper.test.ts`, `subcontractorDefault.test.ts`, `useTebdilWizard.test.tsx`, `workOrderPrefill.test.ts`, `fason-receive-attempt.test.ts`, `ScannerRollStrip.test.tsx`, `newRolls.helper.test.ts`, `receiveAttempt.test.ts`, `receivePayload.helper.test.ts`, `segmented-buttons-row.guard.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-04 · 2026-08-04 — topun KALICI alanları: kat + giriş sebebi; ve elle eklenen top artık PARTİLİ — `CLAUDE-NOT-ARSIVI.md:80-91`
- 2026-08-04 · 2026-08-04 — "GİRİŞ NOKTASI" kuralı: iş emrine AŞAĞIDAN katılan top yukarıdaki adımları bekletemez — `CLAUDE-NOT-ARSIVI.md:226-229`
- 2026-08-19 · 2026-08-19 — Fason KISMİ KABUL + kalan-kapama + parti kuralı — `CLAUDE-NOT-ARSIVI.md:389-403`