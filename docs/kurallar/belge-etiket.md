# Belge · Etiket · Şablon
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/belge-etiket.md`.

Sınıf: [ÇEKİRDEK] her kurulumda aynı · [PROFİL] bu fabrikanın seçimi. Refakat kartı ayrıntısı: `refakat-karti.md`.

## Ortak (backend + panel + tablet)

### Değişmezler

- [ÇEKİRDEK] Belgedeki tarih/saat yalnız `document-render/fmt-date.ts` (`factoryDateTr`/`factoryDateTimeTr`) ile, kaydın anındaki FABRİKA diliminden basılır (etiket `formatDate`, basım damgası dahil); renderer kendi `fmtDate`ini yazmaz.
- [ÇEKİRDEK] Refakat kartı: içerik ≠ sunum, ikisi canlı; tek karar noktası `resolvePrintPlan`; `planKey` config/template'i DIŞLAR; arşiv `?version=N`de yalnız içerik donuk — tüm kart kuralları `refakat-karti.md`.
- [ÇEKİRDEK] Kullanıcı HTML'i (RAW_HTML · RASTER_HTML) iki katman: ① İZİN LİSTESİ `document-render/template-html.sanitize.ts` kayıtta, render'da, DOLDURMA SONRASI (sunucu SVG'si sonra; dış http(s) `<img>`/`<a>` serbest; kayıtta "kes + uyar", 400 değil) ② escapeHtml. Kara listeye dönme.
- [ÇEKİRDEK] Temizleyici SVG/MathML, form, `on*`, göreli/`file:`/`javascript:` adres ve kaynak yükleyen CSS'i keser.
- [ÇEKİRDEK] CSV metin hücresi `=` `+` `-` `@` sekme/CR ile başlıyorsa `'` öneki (panel `csvCell`, backend `csvTextCell`); sayı hücresi öneksiz (`csvNumberCell`); içe aktarım öneki geri alır (`unguardCsvCell`).
- [ÇEKİRDEK] İç veri kolonu OPT-IN doğar: `columns[tablo].hidden` BLOCKLIST'tir; opt-in kolon = `DocCol.defaultHidden` + `columns[tablo].shown` allowlist; sıra `columns[tablo].order`.
- [ÇEKİRDEK] Sevk belgesinde müşterideki AD DONAR (snapshot `products[].customerName`, `cekiRows[].customerDesen/Varyant`), REJİM DONMAZ (`shipping.docItemNameMode` her baskıda canlı → `meta.itemNameMode`).
- [ÇEKİRDEK] Müşteri adı zinciri etiketle AYNI (`shipment-customer-name.helper`: `OrderLine.customerItemName` > `CustomerItemAlias`; renk: satır adı kumaş+renk > `CustomerItemColorAlias` > satır adı renk > `CustomerColorAlias`); ikinci semantik açma.
- [ÇEKİRDEK] Müşteri ürün adı / kumaşa özel renk adı yalnız stok kalemine yazılır: kapı `assertAliasItem` (hizmet kalemi 400 `ALIAS_ITEM_NOT_STOCK`); panel seçicisi `STOCK_ITEM_TYPES` ile sunucuda süzer.
- [ÇEKİRDEK] Renk ad tablolarını yalnız `customer-name.helper#loadCustomerColorIndex` okur (sıra `pickShipmentColorName`).
- [ÇEKİRDEK] SEVK RAKAMI BRÜT: `getDispatchReport` donmuş snapshot'tan (PLANNED'de `collectShipmentDocContent`); `collectShipmentDocContent` de brüt kurar (iptalsiz RollReturn `prevSackId` ile çuvala geri eklenir).
- [ÇEKİRDEK] İade sevk belgesini DEĞİŞTİRMEZ; ayrı belge (RETURN_DISPATCH iade anında donar, iptalde VOIDED). 'Güncel' rozeti = son sürüm, 'içerik güncel' değil.
- [ÇEKİRDEK] SACK etiketi barkod + QR = `Sack.sackNo`; Sack'e ayrı barcode kolonu EKLENMEZ; katalogda ürün/renk/kat alanı YOK; çuval kodu top alanına okutulursa anlamlı 400; mobil Paketleme çuvalı aktif yapar.
- [ÇEKİRDEK] SACK baskısı FAIL-CLOSED: şablon çözülemez/bağlama uymazsa 400, roll/swatch'a SAPMAZ; uyum `LabelTemplate.kind`a BAKMAZ (DEPRECATED), bağlanan alanlardan (`analyzeContextFit`: kanvas varyantı + sackNo bind ŞART).
- [ÇEKİRDEK] MACHINE/WARP_BEAM: barkod = `Machine.code`/`WarpBeam.beamNo` (ayrı kolon yok), FAIL-CLOSED (şablonsuz 400, kimlik bind şart), dokuma dışı 400 `MACHINE_NOT_LOOM`, copies 1-200; `GET /label-templates/catalog` `?kinds=all` olmadan yalnız 4 eski bağlam.
- [ÇEKİRDEK] showIf: koşul ELEMANDA, değer `QualityGrade.code`; `toLocaleUpperCase("tr")` YASAK; kalitesiz topta koşullu eleman BASILMAZ; tek nokta `prepareElements`; yeni emitter `expandMultilineText` çağırmaz; koşullu alan bağlam kimliği sayılmaz.
- [ÇEKİRDEK] Etikete katalog KODU basılır, ad değil; değersiz alan `present:false` → ATLANIR.
- [ÇEKİRDEK] Belge tasarımı ayrı yetki: `/documents` kökünün dört ekranı `document-template:read/write`; kategori web, hasAdminAccess saymaz, taşıyan Yönetim menüsünü/Sistem hub'ını görmez.
- [ÇEKİRDEK] İzin kümeleri TEK kaynak `constants/document-design.ts` (saf literal); Electron `lib/permissions.ts` aynası; `tile-config.permissionAny` ↔ `content-routes.requireAnyPermission` BİREBİR.
- [ÇEKİRDEK] `PATCH /api/feature-flags` guard'ı ANAHTAR-KAPSAMLI, düz OR'a ÇEVRİLMEZ: yalnız `DOCUMENT_DESIGN_FLAG_KEYS` (documentsConfig, travelerCardConfig) → DOCUMENT_DESIGN_WRITE; yabancı anahtar/boş gövde → admin:settings. Aynı yüklem ayar-şifresi belge muafiyetidir.
- [ÇEKİRDEK] Akış etiketi adedini yalnız `services/helpers/label-copies.helper.ts` (`resolveFlowLabelCopies`) çözer; `label.service` `readLabelCopies`i çağırmaz; tezgah/levent toplu ve serbest şablon dışarıda.
- [ÇEKİRDEK] `label.copiesSource=GLOBAL` (varsayılan): istek 1–5'e kırpılır; `STATION`: istek 1–5 (dışı 400 `LABEL_COPIES_RANGE`) > istasyon `defaultLabelCopies` > genel.
- [ÇEKİRDEK] Basım hareketini yalnız `recordPrintJob`/`reportPrintJob` (`services/print-job.service.ts`) yazar; `print_jobs` telemetridir (karar okumaz, iptal guard'ı `labelPrintedAt` okur), audit'ten türetilmez, kullanıcı token'dan, yaşa göre budanır.
- [ÇEKİRDEK] Barkod/QR değerini yalnız `scanElementValue` (`source`: yok/ROLL iç barkod, CUSTOMER_CODE müşteri kodu) verir.
- [ÇEKİRDEK] Eksik müşteri kodu kararı render'dan önce `applyCustomerCodeGate` (`label.customerCodeMissing`: BLOCK → 400 `CUSTOMER_CODE_MISSING`, `print_jobs` yok · ROLL_BARCODE → iç barkod + uyarı).
- [ÇEKİRDEK] Çeki `customerCode` sevkte donar, kolon opt-in; çuval bağlamında CUSTOMER_CODE elemanı 400 `CUSTOMER_CODE_SOURCE_NOT_ROLL` (ayar esnetmez); tablet BLOCK'ta okut-bağla sayfasını açar.
- [ÇEKİRDEK] Toplu top etiketi de `labelPrintedAt` damgalar; damgayı yalnız `label.service#stampRollLabelPrinted` yazar.
- [ÇEKİRDEK] Panelde her basım `lib/print.ts` boğazından (`printTracked` · `trackPdfSave` · `reportLabelSend`); iş ucu olan türde künye iş ucuna (başarıda `/print-jobs`a ayrıca yazma), iptal/hatada iş ucu çağrılmaz; sessiz basımı yalnız bilgisayar ayarı açar.
- [ÇEKİRDEK] Yazdırma geçmişinde süzme/sayma sunucuda (`/api/print-jobs` + `?ozet=1` aynı where); gün çipi fabrika günü anahtarı; `Electron/src/lib/print-error-hints.ts` panel ∪ sunucu hata kodlarına eşit.
- [ÇEKİRDEK] Tablette her basım sonucu `mobil/src/services/printJob.service.ts` kuyruğundan: token mantıksal deneme başına; başarıda iş ucu, hata/iptal ve iş ucusuz türde `/print-jobs`; `Print.printAsync`/`printHtml` raporsuz kalmaz (`printHtmlReported`).
- [ÇEKİRDEK] Müşteri barkodu yalnız EMANET topa (`POST /api/rolls/:id/customer-code`, `clientToken` zorunlu); serimize benzeyen/top barkoduna eşit kod 409 `CUSTOMER_CODE_COLLIDES`; müşteride aktif kod tekil.
- [ÇEKİRDEK] Müşteri kodu değişimi = sebepli kaldırma damgası + yeni bağ (satır silme yok); Tambur çocuğuna/fason dönüşüne kalıtma.
- [ÇEKİRDEK] Bağla/kaldır uçları `roll:write` ∨ `mobile:tambur` ∨ `roll:customer-code` (dar izin: Tambur operatörü + Süpervizör şablonu); 409 `CUSTOMER_CODE_AMBIGUOUS` adayı `barcode` + `customerName` + `currentQty` taşır.

### Yasaklar

- [ÇEKİRDEK] Renderer'da HER iframe sandbox taşır: baskı (`lib/print.ts`) "allow-same-origin allow-modals" (kırpma), önizleme `sandbox=""`; `allow-scripts` / `allow-top-navigation*` / `allow-popups*` HİÇBİRİNDE yok.
- [ÇEKİRDEK] `Sack.notes` ANNOTATION'dır: `setSackNotes` `touchWarehouseSackTx` guard'ını UYGULAMAZ, `markSackContentChangedTx` nota dokunmaz — guard EKLEME.
- [ÇEKİRDEK] admin:settings DOCUMENT_DESIGN kümelerinden DÜŞÜRÜLMEZ; boot yeni izni getirir, ATAMAZ; READ ⊇ WRITE; atama elle.
- [ÇEKİRDEK] `DOCUMENT_DESIGN_FLAG_KEYS` DAR: companyName / companyLetterhead / belge logosu EKLENMEZ; ölçüt: yanlış girilirse etkisi belge çıktısıyla sınırlı mı.

### Tuzaklar

- [PROFİL] A5 seçili + A4 kâğıt = küçük baskı; panel bunu yazar. Eski belgede çare tek seferlik `?pageSize=`, donmuş katmana dokunma.
- [ÇEKİRDEK] Kâğıt boyu seçicisinde belgenin kendi boyutu yalnız EZME YOKKEN `@page`ten okunur (`readDocPageSize`).
- [ÇEKİRDEK] Belge bölümleri: `sections` BLOCKLIST; iç veri bölümü `DocSectionDef.defaultHidden` ALLOWLIST, HEM renderer HEM panelde işaretlenir.
- [ÇEKİRDEK] Top↔sipariş bağı yok: override kümesi sevkiyat kapsamında (tahsis + sipariş bağı) toplanır, (itemId,colorId) eşlenir, sıra deterministik (tahsisli→createdAt→id); gruplama bizim adımız, kolon anahtarları ayrı (name↔customerName); iade aynı zincir.
- [ÇEKİRDEK] Brüt belge üreticisi: çuval satırı + ürün özeti + çeki TEK `sacksGross`tan; iade sorgusu canlı id kümesiyle DEDUP; totalKg DEĞİŞMEZ. Yeni sevk-içeriği yüzeyi sevkten sonra da koşar.
- [ÇEKİRDEK] `label-template:read/write`te READ WRITE'ı KAPSAMAZ — yeni çiftte tekrarlama; Etiketler ekranı document-template kapsamı DIŞINDA.
- [ÇEKİRDEK] Müşteri belgesindeki iç kolon TEK KAPIDAN (`defaultHidden` + `columns.<tablo>.shown`); ikinci GLOBAL anahtara bağlama.
- [ÇEKİRDEK] Belge başlığı (`titleOverride` dahil) yalnız `document-render/doc-style.ts` `docTitle` ile büyütülür (TR `upperTr`, EN düz); çizicide çıplak `toUpperCase()` yok.
- [ÇEKİRDEK] Kolon başlığında boş dize = varsayılana dön; başlıksız = `columns.<tablo>.blankLabels`; ikisi birlikte → boşluk kazanır.
- [ÇEKİRDEK] Kolon kataloğu renderer ↔ panel AYNA bekçisiyle eşit tutulur.

### Kararlar

- [PROFİL] Kart varsayılan A5 (`DEFAULT_TRAVELER_CARD_CONFIG.pageSize`); A4 panelden/baskı diyaloğundan; kurulum ayarı.
- [PROFİL] `docItemNameMode`: bizdeki (VARSAYILAN) | musterideki (FAIL-OPEN: karşılık yoksa bizim ad) | ikisi; dört kapı + `test_feature_flag_contract §16` aEnum + panel enumFlags + Electron aynası.
- [PROFİL] `docItemNameMode` kapsamı yalnız SHIPMENT_DISPATCH + muhasebe fişi; SUBCONTRACTOR_DIRECT_SHIP ve muhasebe Excel dışarıda.
- [PROFİL] Liste sayfası kimlik şeridi `sections.listHeader` OPT-IN (`=== true`, `sectionOn` değil), `thead`'e girer; ilk listeye ve `?merge=1`de konmaz.
- [ÇEKİRDEK] Çek teslim bordrosu ANLIK: donmuş PrintedDocument yok, no/sürüm yok, basmak çek durumunu değiştirmez; donmuş istenirse önce kaynak model.
- [ÇEKİRDEK] Çeki Listesi ilk basımda `Manifest` (`sourceKind=SACK_SELECTION`) doğurur, CL no + içerik donar (render'da üretilmez); aynı içerik → aynı no, farklı → yeni; sürümlenmez; no sağ üstte, aç/kapa yok.
- [PROFİL] Fason çekisi: `placements.batchInfo`, `sections.accountNo` OPT-IN (kapalı), `sections.fabricHeader` OPT-IN, `gridGroups` 3/4/5 × `gridRows` 1-40 (varsayılan 5×10).
- [ÇEKİRDEK] `SALES_QUOTE` SENT, `PRICE_LIST` PUBLISHED geçiş tx'inde claim'den sonra donar (lazy yalnız eski kayıt); DRAFT yalnız TASLAK önizlenir; iptal/revizyon belgeyi aynı tx'te VOIDED yapar, liste arşivi yapmaz; sözleşme/`select`e maliyet/kâr/öneri/iç not koyma.
- [ÇEKİRDEK] Kanvas alanı `customerBatchNo` = `labelBatchNo` (boşluk = yok) > gelen belge partisi (`payload.deliveryNoteBatchNo`, yalnız satırlı topta anahtar var); OPT-IN, akış düzenlerine girmez; zincir yalnız `fieldDisplayValue`da (bekçi `test_tambur_parti_varsayilan`). <sub>(arşiv:2026-11-10 Tambur parti no varsayılanı)</sub>
- [ÇEKİRDEK] Kanvas alanı `consigneeName` (etiket alıcısı adı) OPT-IN; alıcısız topta present:false, akış düzenlerine girmez (bekçi `test_tambur_etiket_alanlari`). <sub>(arşiv:2026-11-10 Tambur fason etiketi)</sub>
- [PROFİL] Varsayılan top etiket düzenleri müşteri parti no (`labelBatchNo`) doluyken "Parti: <değer>" basar ve bizim parti no'yu BASMAZ (etikette iki "Parti" olmasın; izlenebilirlik barkoddan sürer); boşken bugünkü baskı aynen.
- [ÇEKİRDEK] Top etiketinin türünü yalnız `Roll.stage`ten türet (`roll-stage.helper` `resolveRollLabelKind`: RAW/SEMI_FINISHED → ROLL_RAW, FINISHED → ROLL_FINISHED; açık `kind` elle seçimdir ve kazanır); renkten, istasyondan, statüden tahmin etme — tekil, toplu, print-event ve çuval bayatlaması aynı helper (bekçi `test_roll_asama_etiket`). <sub>(arşiv:2026-11-10 Top aşaması)</sub>

### Belge şablon tasarımcısı (GrapesJS + LiquidJS; plan `docs/design/BELGE-SABLON-TASARIMCISI-PLAN.md`)

- [ÇEKİRDEK] Sistem şablonu (TS renderer `document-render/*`) SALT-OKUNUR: önizlenir/kopyalanır; düzenleme "Kopyala ve düzenle" ile Liquid eşleniği kopyasında (eşleniksiz tür 409 `NO_SYSTEM_EQUIVALENT`).
- [ÇEKİRDEK] Şablonda HESAP YAPMA: toplam, brüt, belge no, ad rejimi backend'in donmuş değerinden; Liquid'de aritmetik filtre yok.
- [ÇEKİRDEK] İç alan tek kapı: Sistem'de `columns.shown`, tasarımcıda `internalFields`; kopyada iç kolonlar `internalFields`e taşınır; müşteri belgesinde varsayılan YOK.
- [ÇEKİRDEK] Tasarımcı bayrağı `documents.designerEnabled` (KAPALI); karo hep görünür, kapalıyken Genel Ayarlar'a çıkış; uçlar 403 `DOCUMENT_DESIGNER_DISABLED` (`GET /contracts` hariç); bayrak `DOCUMENT_DESIGN_FLAG_KEYS`e girmez.
- [ÇEKİRDEK] Tasarım `document-template:design`, yayın `document-template:publish` (yeni `documents:*` ailesi yok, migration yok); `documents.publishSodEnabled` sistem ayarı (kapalı; açıkken 403 `PUBLISH_SOD`), profile konmaz.
- [ÇEKİRDEK] Kopyada stil şablon CSS'inden: kopya anındaki etkin ayar sürüme donar (`settings`, müşteri ezmesi hariç, `language` → `tr`); Belge ayarları paneli yalnız sözleşme ayarlarını düzenler, stil/damga/QR/blok salt-okunur.
- [ÇEKİRDEK] Kart ve serbest belge tasarımcı şablonuna DONMAZ: her basımda `live-binding.resolveLiveTemplate` (bayrak kapalı/varsayılan yoksa bayt-eşit).
- [ÇEKİRDEK] Karta yalnız tasarım İZİ yazılır (`snapshot.designTemplate` + audit `templateVersionId`), `planKey` izi dışlar; karar yalnız `resolvePrintPlan`/`resolveArchivedPlan`.
- [ÇEKİRDEK] GrapesJS düzenleme kanvası: `sandbox="allow-same-origin"` (`frameSandboxPlugin`) + `telemetry: false` zorunlu; önizleme/PDF sıkı kuralda; editör e2e'de ölçülür (`adimlar-belge-tasarimci.mjs`).
- [ÇEKİRDEK] Tasarımcı şablonu yalnız `document-template/motor/render.ts`: katı LiquidJS (izin listesi, tanımsız hata, 2000 ms · bellek · 4 MB) → doldurma sonrası `sanitizeUserHtml({strict:true})` (dış http(s) ve `@font-face` kesilir) → filigran/künye.
- [ÇEKİRDEK] Biçim yalnız Türkçe filtrelerle (`tarih`, `sayi`, `para`, `yaziyla` …; `date`, aritmetik, `raw`, `json` RED); şablon CSS'i `tekserp` adını, `@bottom-left`i, sözde-işlevde `#`'yi, `@page` kenarını YAZAMAZ; RAW_HTML kart/etiket varsayılan temizleyici kipinde.
- [ÇEKİRDEK] Şablon yalnız veri sözleşmesi bağlamını görür (`services/document-template/sozlesme/`, `getContract(docType)`; bilinmeyen 400 `DOCUMENT_CONTRACT_UNKNOWN`); iç alan yalnız `internalFields` (`ic_acik.<kod>` mantıksal); toplamlar donmuş snapshot'tan.
- [ÇEKİRDEK] Sözleşme yalnız BÜYÜR (alan silinmez, tür değişmez, `ic → musteri` olmaz; alan eklenince `contractVersion` +1, özet `scripts/lib/belge-sozlesme-ozeti.json`); kod İngilizce, bağlam anahtarları Türkçe.
- [ÇEKİRDEK] Şablon sürümü DEĞİŞMEZ: yeni içerik yeni sürüm (`baseVersionId` + `latestVersionNo` claim, 409 `TEMPLATE_VERSION_STALE`); yayın `publishedVersionId` claim'i (`expectedPublishedVersionId`, 409 `TEMPLATE_PUBLISH_CONFLICT`) + tüm senaryolarda katı render + sıkı temizleyici geçerse.
- [ÇEKİRDEK] Yayınlanmış şablon silinmez, arşivlenir (atanmışsa 409 + liste); hard delete yalnız hiç yayınlanmamış taslak; geri alma YENİ sürüm açar; trigger `document_template_versions_block_tamper` içerik UPDATE'i ve yayınlı DELETE'i reddeder.
- [ÇEKİRDEK] Basılan belgeye şablon kimliği + sürümü donar (`snapshot.template`, `schemaVersion` 1): `documents.designerEnabled` açıkken profil → tür varsayılanı → Sistem (yayında değilse atla + `templateWarnings`).
- [ÇEKİRDEK] Yeniden baskı donmuş şablonla, reissue ve "Güncel şablonla bas" canlı; bayrak kapanınca donmuş şablonla basılır.
- [ÇEKİRDEK] Şablonlu belgenin ayarı sürüm `ayar`ı + profil ezmesi, etkin ayar `docConfigOverride`a donar; render hatası 422 `TEMPLATE_RENDER_FAILED`, çıkış yalnız `?sistemSablonu=1` (audit); `template` yoksa Sistem renderer'ı DEĞİŞMEDEN koşar.
- [ÇEKİRDEK] Liquid eşleniği (`document-template/sistem/<doc>.ts`, `sistem/index.ts`) Sistem renderer'ına normalize HTML eşitliğiyle kilitli: farkı eşlenikte gider, `document-render/*`a dokunma; CSS ve `pageSettings` `ayar`dan (`materializeEquivalent`).
- [ÇEKİRDEK] Eşitlik bekçisinde yalnız ÖLÜ CSS kuralı atılır (`pruneDeadExtras`); toleransı genişletme. Fason çeki taslağı ayrı tür değil, `SUBCONTRACTOR_DISPATCH`te `taslak` senaryosu.
- [ÇEKİRDEK] `DocumentDesigner/binding/*` değişince fikstürü iki uçtan tazele (`TASARIMCI_FIKSTUR_YAZ=1 npx vitest run …/binding/roundtrip.test.ts`; sözleşme değişince `test_belge_tasarimci_gidis_donus.ts --yaz`), derleyici + önizlemeyi ölç; panel `language`ı `tr`ye kilitler.
- [ÇEKİRDEK] Şablonlu belge Excel'i sözleşme bağlamı (`insa`) + `tableBindings`ten (`document-template/excel-tables.ts`); iç kolon yalnız `internalFields`; bağsızda Sistem tabloları + `warnings`; sıra kaynak HTML'den. `itemTable.ts`/üretici/`/tables` değişince iki Excel eşitlik bekçisini koş.
- [ÇEKİRDEK] Kod sekmesi/önizlemede Liquid istemcide ÇALIŞMAZ: önizleme `POST /preview` (400 ms debounce, son cevap) → `sandbox=""` iframe; PDF önizleme `pdf:preview` ile `pdf:save` kapısından, köprüsüz ayrık pencerede.
- [ÇEKİRDEK] Muayene raporu `INSPECTION_REPORT` sözleşmesi + `buildShipmentInspectionSummary` tek kaynağından; iç kolonlar (operatör · istasyon · cihaz) opt-in; Excel aynı çözücüden.

## Backend

### Değişmezler

- [ÇEKİRDEK] Belge tasarım önizleme ucu ekranı açan izinle aynı kümeyi taşır (`DOCUMENT_DESIGN_READ`), `admin:settings` ile DARALTILMAZ.
- [ÇEKİRDEK] "Hangi ad basılır" TEK helper `document-render/shipment-name-mode.cozAdRejimi` (`devral`, fail-open `musteriAdiVeya`); irsaliye HTML'i DE muhasebe fişi DE oradan sorar; rejim snapshot'a GİRMEZ.
- [ÇEKİRDEK] Muhasebe fişi Excel'i ayrık kipi (`shipping.docProductColorSplit`) irsaliyeyle hücre hücre AYNI uygular; "iç dosya" muafiyeti yok; dönem dökümü kapsam dışı.
- [ÇEKİRDEK] PDF ile Excel aynı çözücüden: `DocColSpec` (`document-render/doc-model.ts`); HTML `toHtmlCols → buildDocTable`, Excel `resolveDocTable → GET /api/printed-documents/:type/:id/tables` (aynı izin); panelde elle kolon listesi YAZILMAZ.
- [ÇEKİRDEK] Opt-in kolon iki çıktıda birlikte; Excel'e PDF'te basılan haneye yuvarlanmış değer gider. Kapsam SHIPMENT_DISPATCH + SUBCONTRACTOR_DIRECT_SHIP + panel Çuval İçerik Dökümü (`sackDump/dumpModel.ts` tek model).
- [ÇEKİRDEK] Kart backend kuralları (ACTIVE dışı revize yok, snapshot fallback/NULL, `resolveLiveBatches`, `traveler-card.density.ts`, `contentDirty`/`print-event`, üç kademe, FAIL-CLOSED `templateId` 404, `traveler_card_templates_isDefault_key` partial unique) `refakat-karti.md`dedir.
- [ÇEKİRDEK] Kart ek: çözüm zinciri açık seçim > varsayılan > sistem ayarı, varsayılanı kaldırmak yerleşiğe dönüştür, kapalı blokta tek bayt basılmaz.
- [ÇEKİRDEK] Tek seferlik bayraklar (kart `?pageSize=A4|A5`, belge `?rowNotes=1` / `?rowTags=1` / `?sections=`) ayarı EZER (pure OR, renderer'da TEK nokta), yazılmaz, sürüm doğurmaz, geçersiz değer sessizce yok sayılır; rowNotes ≠ rowTags.
- [ÇEKİRDEK] Donmuş belge HTML değil JSON (`PrintedDocument.snapshot` = company + docConfigOverride + doc); donan AYAR, kod değil → renderer'a görünür ekleme OPT-IN doğar.
- [ÇEKİRDEK] Belgedeki sayı yalnız `docNum(snapshot)` (ticari yuvarlama, PDF = Excel); rejim donmuş zarfta (`numberRounding`, tek yazar `envelopeHead`); damgasız belge eski yuvarlamayla; "Güncel şablonla bas" damgayı tazelemez; CSS ölçüsü `cssFixed`; çıplak `toFixed` yok.
- [ÇEKİRDEK] A4→A5 tek `scale()` YASAK, iki oran (genişlik ~0.68, yazı ~0.85), A4 bayt-bayt; profiller `doc-density.ts` (altı belge) + `fason-ceki.density.ts` + `traveler-card.density.ts`; belge kendi A4 sayısını verir, `scaleW`/`scaleF` uygular.
- [ÇEKİRDEK] Fason çekisinde parti TEKİL `batchNumber`, kabul makbuzunda ÇOĞUL `batchNumbers`; çekide parti TOP başına; eski donmuş belge geriye dönük doldurulmaz, tazeleme yalnız reissue.

### Yasaklar

- [ÇEKİRDEK] Toplu iade: N RollReturn + TEK irsaliye (`returnGroupId` = lider id); belge üye id'siyle ÇÖZÜLMEZ, `documentSourceId` (returnGroupId ?? id) kullanılır.
- [ÇEKİRDEK] Snapshot JSON'ları (`PrintedDocument.snapshot`, `Manifest.snapshot`) liste sorgusunda ÇEKİLMEZ.

### Tuzaklar

- [ÇEKİRDEK] Dondurma sürümü `freezeForSource`ta max+1; sabit 1 yazma.
- [ÇEKİRDEK] `gridRows`: sayı aralığa KIRPILIR, sayı olmayan varsayılana düşer; anahtarsız eski çeki 50'ye düşer; slot kontrolü `hasSlot` ile kesin (düz `includes` yok).

### Reçeteler

- [ÇEKİRDEK] Belgeye özel CSS ortak katmandan SONRA basılır; `DOC_PAGINATION_CSS` ortak katmanda; `totRow:false` iade irsaliyesine özel.
- [ÇEKİRDEK] Çuval notu `labelDirty`'yi yalnız etkin çuval şablonu sackNote basıyorsa işaretler (`sackNoteAppearsOnLabel`); belge satır notları canlı (`resolveLiveRowNotes`).

### Kararlar

- [ÇEKİRDEK] Etiket fontu raster opentype.js (DejaVu TTF → 1bpp, `assets/fonts/`); barkod bwip-js.
- [ÇEKİRDEK] Barkod SVG yalnız `helpers/barcode-svg.helper.ts`; çıplak `bwipjs.toSVG` yazma; toplu etiket döngüsü `createSliceYielder` ile event-loop'a döner.

## Panel (Electron)

### Değişmezler

- [ÇEKİRDEK] "PDF Kaydet" penceresi (`electron/ipc/pdf.ipc.ts`) JS KAPALI, preload'suz, ayrık oturum `tekserp-pdf` (yalnız data:/blob:/about: + `tekserp-pdf://doc/`, izin isteği RED); gezinme/webview/yeni pencere engelli, OS'e adres devretmez; dış kaynak PDF/ekran/baskıda yüklenmez.
- [ÇEKİRDEK] "PDF Kaydet" belgeyi URL'ye gömmez, diske yazmaz (`tekserp-pdf://doc/<uuid>`); bayt kapısı (`Electron/shared/pdf-limits.ts`) kaydet diyaloğundan ÖNCE; tek kuyruk, süre sınırlı; hata sabit Türkçe + `ERR_` kodu, ham Chromium mesajı dönmez.
- [ÇEKİRDEK] Türe özgü araç çubuğu kalemi `PrintedDocDialog`a GÖMÜLMEZ, slotla gelir (`toolbarPrintMenu` · `toolbarDownloads` · `optionsExtras` · `infoBar` · `printParams`).
- [ÇEKİRDEK] Sevk irsaliyesinin TEK yüzeyi `ShipmentDocDialog`; `allowDraft` sevkiyat durumundan türer; `reissueOnlyWhenReconstructed` düşürülmez.
- [ÇEKİRDEK] Toplu belge listesi TEK kaynak `GET /work-orders/:id/documents`; tür kutuları bulunanlardan; Yazdır = tek iş (`print-merge.ts`), PDF Kaydet = her belge ayrı dosya.
- [ÇEKİRDEK] Toplu belgede atlanan hiçbir şey sessiz değil: belgesiz/listesi alınamayan iş emri, HTML'i alınamayan ve birleştirilemeyen belge ayrı raporlanır.
- [ÇEKİRDEK] Birleştirmede `position:fixed` → `absolute` (filigran belgede bir kez).

### Yasaklar

- [ÇEKİRDEK] Belge birleştirmede `getBulkRollLabelsHtml` paterni YASAK; her belge kendi gölge kökünde (`<template shadowrootmode="open">`).
- [ÇEKİRDEK] Birleştirme kabı iframe DEĞİL; tek belgede birleştirme YAPILMAZ (HTML aynen); gövdesinde `</template>` geçen belge dışarıda bırakılır ve söylenir.

### Tuzaklar

- [ÇEKİRDEK] `@page` gövde CSS'inde KALAMAZ: `@page wdocN {…}` + `page:wdocN`.
- [ÇEKİRDEK] CSS yorumları önce silinir (`stripCssComments`, sıra zorunlu); `pageSizeOf`ta da.

### Reçeteler

- [ÇEKİRDEK] Salt-okuma yüzeyi gerçek çizilir: `document-template:read` ile ekran + önizleme çalışır, Kaydet kapalı, yazma aksiyonları HİÇ çizilmez.

### Kararlar

- [ÇEKİRDEK] Etiketler kartı ve route aynı ikili `["station:read","label-template:read"]`.

## Tablet (mobil)

### Değişmezler

- [ÇEKİRDEK] 409 `CUSTOMER_CODE_AMBIGUOUS` → doğrudan `CustomerCodeCandidateModal` (`useAmbiguousScanPicker`; Tambur + Paketleme); kendiliğinden seçme, seçilen topun iç barkoduyla sür.
- [ÇEKİRDEK] "Müşteri etiketini okut" yalnız izin ∧ emanet ∧ `scanCustomerCodeLookupEnabled` ∧ emanet top iken; uç 404 → oturum boyu gizle.
- [ÇEKİRDEK] Baskı audit `rollId`si mutation DEĞİŞKENİNDEN geçer, kapanıştan okunmaz (yoksa `LABEL_PRINTED` audit kaybolur).
- [ÇEKİRDEK] Etiket yazıcısı OTURUMDAN: `peripheralService.getForSession('LABEL_PRINTER')` (yoksa boş, fail-closed); taşıma BT-Classic/SPP (`hal/btClassic.transport`), yalnız BLUETOOTH_SPP device-direct; manuel seçim/btPrinterStore yok.

### Reçeteler

- [ÇEKİRDEK] Çuval kartında yalnız sık kullanılan; 'elle gir / etiket bas / not ekle / sil' `SackActionsSheet` ⋮ (AppModal bottom, satır ≥56dp); yıkıcıda ONAY DİYALOĞU korunur; tartı tek dokunuş (⚖ → oku → kaydet).

### Kararlar

- [ÇEKİRDEK] Uydurulmuş çuval kg'si canlı veriye girmez: istemci `source:'SIMULATED'`, `shipping.simulatedWeightEnabled` kapalıyken 400; METER simüle doğar, SCALE doğmaz; MANUAL muaf.
- [ÇEKİRDEK] Tablet basımında (`expo-print`) kâğıt boyunu `@page size`'tan bekleme; kenar kutuları WebView ≥131 ister.

## Geçersiz kılınan kurallar — bunlara UYMA

- GEÇERSİZ: şablonlu basımda profil ezmesi uygulanmaz (R4).
- GEÇERSİZ: tasarımcıda koşul/ifade yok · sanitize kara listesi · şablon/sayfa boyutu karta donar · stüdyo yalnız admin:settings · Etiketler kartı yalnız station:read · LabelKind 4 literal z.enum (backend `z.nativeEnum`)
- GEÇERSİZ: `resetSackWeightsTx` (→ `markSackContentChangedTx`) · `contentDirty` rozet yüzeyleri · donmuş snapshot tek brüt koruma.

## Çözülmüş çelişkiler

- `buildSnapshot` baskı yolunda yalnız snapshot-NULL fallback'te; BLE yolu ölü (yazıcı oturumdan, BT-Classic).

## Açık sorular

- `resolveForPrint(templateId)` dalının canlı çağıranı yok — ölü mü, gelecek sözleşme mi?
- Brüt-sevk/belge-sürüm kuralları bekçi adları sevkiyat hakemince doğrulanmalı; küme dışı notlar ayrıntıda.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- [ÇEKİRDEK] Toplu PDF birleştirme motorunu kullanmaz: `pdf:saveBatch` (`htmlsToPdfs`) tek gizli pencerede ardışık, kuyruk yuvası iş boyunca, zaman aşımı belge başına, her belgeden sonra `pdf:batch-progress`.
- [ÇEKİRDEK] PDF kâğıdını `@page { size }` belirler: tekil/toplu tek seçenek `PDF_PRINT_OPTIONS` (`preferCSSPageSize: true`, boyutsuzda `pageSize: 'A4'`); yerinde yazılmaz.
- [ÇEKİRDEK] Liste Excel'i tek giriş `list-export.exportRowsToXlsx`: `XLSX_STREAM_MIN_ROWS` (20K) üstü akışla (`xlsx:stream*`, `.part`, parça ≤10K), `buildWorkbook` çıktısıyla eşit; 100K üstü "tümünü indir" `ConfirmDialog` ister.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_roll_asama_etiket`, `test_roll_asama_geri_doldurma`, `test_belge_excel_esit`, `test_belge_sablon_excel_esit`, `test_belge_sablon_temizleyici`, `test_belge_baslik_harf`, `test_belge_ticari_yuvarlama`, `test_belge_yuvarlama_damgasi`, `test_sevk_belge_excel_esit`, `test_sevk_belge_altin`, `test_accounting_direct_ship`, `test_accounting_export`, `test_audit_followups`, `test_barcode_free_flow`, `test_barcode_reservation`, `test_batch_k15_merge`, `test_batch_k16_split_move`, `test_blank_grid`, `test_branch_code_docs`, `test_export_code_snapshot_gate`, `test_bulk_label_batched`, `test_bulk_labels`, `test_barcode_svg`, `test_canvas_preview_peripheral_lang`, `test_consistency_derived`, `test_customer_standalone_label`⚠️, `test_customer_template_route`, `test_direct_ship_api`⚠️, `test_direct_ship_fason`, `test_direct_ship_scenarios`, `test_dispatch_print_options`, `test_dispatch_report`, `test_dispatch_report_gross`, `test_dispatch_without_color`, `test_doc_density_fields`, `test_doc_pagesize_override`, `test_doc_fmt_date`, `test_doc_render_html`, `test_doc_sample_html`, `test_document_customization`, `test_document_style`, `test_document_template_permission`, `test_fason_ceki_draft`, `test_fason_ceki_html`, `test_fason_step_note_flow`, `test_finalize_last_step`⚠️, `test_finance_documents`, `test_fold_edit_and_label`, `test_goods_receipt`, `test_label_bulk_seed`, `test_label_canvas_equivalence`⚠️, `test_label_canvas_human_bold`, `test_label_canvas_renderer`, `test_label_context_default`, `test_label_context_fit`, `test_label_copies`, `test_label_copies_source`, `test_label_defs_lifecycle`, `test_label_dirty_sources`, `test_label_element_condition`, `test_label_format_resolver`, `test_label_html_format`, `test_label_icons`, `test_label_machine_beam`, `test_label_native_languages`, `test_label_ppla`, `test_label_preview_single_copy`, `test_label_rawcode`, `test_label_routing_resolver`, `test_label_snapshot_audit_split`, `test_label_template_io`, `test_label_template_layout`, `test_label_variant_selection`, `test_label_width_gate`, `test_manual_sack_count`, `test_native_preview`, `test_native_template_honoring`, `test_new_documents`, `test_official_finance_docs`, `test_peripheral_registry_crud`, `test_printed_doc_builders`, `test_printed_documents`, `test_printer_transport`, `test_purchase_order`, `test_quickstart_dispatch`, `test_quickstart_dispatch_api`, `test_raster_bitmap`, `test_raster_canvas`, `test_raster_contract`, `test_raster_envelope`, `test_raster_text`, `test_raw_tambur_cut`, `test_recent_output_filters`, `test_rescue_stuck`, `test_return_bulk_group`, `test_roll_barcode`, `test_roll_cancel_undo`⚠️, `test_roll_label_cut_seed_snapshot`, `test_roll_relabel`, `test_roll_relabel_context`, `test_roll_search_barcode`, `test_sack_label`, `test_sack_mismatch`, `test_sack_note_document`, `test_sack_split_and_relabel`, `test_sack_status_invariant`, `test_sack_tag_document`, `test_sack_tags`, `test_scan_code_case`, `test_scrap_grade_label`, `test_shipment_dispatch_document`, `test_shipment_doc_batch_column`, `test_shipment_doc_customer_name`, `test_shipment_list_gross`, `test_shipment_undo_dispatch`, `test_standalone_label`, `test_status_labels`, `test_stock_count`, `test_stock_label_no_customer_inference`, `test_tambur_manual_produce`, `test_tambur_recent_output_filter`, `test_traveler_card_a5_batches`, `test_traveler_card_fields`, `test_traveler_card_stale`, `test_traveler_card_versions`, `test_traveler_template`⚠️, `test_warehouse_transfer`, `test_workorder_documents`, `test_belge_sozlesme`, `test_belge_liquid_kati`, `test_belge_liquid_filtre`, `test_belge_yonerge_derleyici`, `test_belge_sablon_guvenlik`, `test_belge_sablon_modeli`, `test_belge_sablon_uclari`, `test_belge_sistem_esdegeri`, `test_belge_sablon_basim`, `test_etiket_birim`, `test_etiket_ie_bilgisi`, `test_alias_hizmet_kalemi`, `test_tambur_parti_varsayilan`, `test_tambur_etiket_alanlari`

İstemci: `pdf-window-hardening.test.ts`, `pdf-page-size.test.ts`, `xlsx-stream.equal.test.ts`, `useExportConfirm.test.tsx`, `ReportExportBar.pdfGate.test.tsx`, `iframe-sandbox.test.ts`, `doc-tables-export.test.ts`, `dumpEsitlik.test.ts`, `dumpHtml.altin.test.ts`, `ScanField.test.tsx`⚠️, `useContinuousScan.test.tsx`⚠️, `print-merge.test.ts`⚠️, `barcode-kind.test.ts`⚠️, `scan-framer.test.ts`⚠️, `wedge-detector.test.ts`⚠️, `chequeBordro.test.ts`, `chequeDeliveryNote.test.ts`, `chequeExport.test.ts`, `officialDocs.test.ts`, `reconciliationLetter.test.ts`, `DocumentConfigSection.regime.test.tsx`⚠️, `docRows.test.ts`, `PrintPageSizeToggle.test.tsx`, `ShipmentDocDialog.test.tsx`, `canvas-model.test.ts`, `condition-edit.test.ts`, `useCanvasLint.test.ts`, `templateRowActions.test.tsx`, `contextDefaultRow.align.test.tsx`, `RelabelStation.test.tsx`, `dumpSheets.test.ts`, `sackTagBulk.test.ts`, `schema.test.ts`, `chequeDueExport.test.ts`, `reportExport.test.ts`, `print-event-toast.test.ts`, `RollCancelModal.test.tsx`, `printQueue.test.ts`, `LabelNamePreview.logic.test.ts`, `LabelNamePreview.test.tsx`, `labelNameSave.test.ts`, `LabelPreviewSheet.test.tsx`, `btPrinter.service.test.ts`, `tambur.service.test.ts`, `docPageSize.test.ts`⚠️

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- Arşiv bağlantıları ayrıntı dosyasında (`arsiv/2026-09.md`, `arsiv/2026-10.md`, `CLAUDE-NOT-ARSIVI.md`).
- [PROFİL] Belge/etiket/refakat karoları `/documents` kataloğunda (`pages/Documents/tile-config.ts`); adresler `/definitions/*` kalır; Tanımlar'a çıktı karosu ekleme.
- [PROFİL] Müşteri belgesi kumaş/renk (`deliveryNoteItemText`/`deliveryNoteColorText`) etikette OPT-IN, çeki listesinde varsayılan KAPALI; yalnız metin doluyken yüke/gruba girer; belgesiz top çıktısı ve `pickListContentKey` bayt-aynı.
- [PROFİL] Müşteri top no (`deliveryNoteRollNo`) etikette OPT-IN; `senderRollNo` yalnız `resolveDeliveryNoteLinesForRolls`'tan (Tambur çocuğu atanınkini taşır); satırsız topta yüke girmez.
- [PROFİL] Etiket birimi şablonun `unitSettings`i, yalnız `config/label-units.ts` biçimler; `WorkOrder.labelOverrides` ("" = boş bas) tek yazarı `label-override.service`, `getRollLabel` tekil + toplu uygular; ikisi null iken çıktı bayt-aynı.
